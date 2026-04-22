/**
 * Tests for lib/captionCache.ts. Supabase is mocked end-to-end.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  normalizeQuery,
  queryHash,
  getCached,
  writeCached,
  __TEST__,
  CacheReadError,
  CacheWriteError,
  type Caption,
} from "@/lib/captionCache";
import type { SupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// normalizeQuery
// -----------------------------------------------------------------------------

describe("normalizeQuery", () => {
  it("lowercases ASCII", () => {
    expect(normalizeQuery("ANGER")).toBe("anger");
  });
  it("NFC-normalizes combining sequences (café in NFD form)", () => {
    const nfd = "cafe\u0301"; // "café" in NFD
    const nfc = "café"; // precomposed
    expect(nfd).not.toBe(nfc);
    expect(normalizeQuery(nfd)).toBe(normalizeQuery(nfc));
    expect(normalizeQuery(nfd)).toBe("café");
  });
  it("collapses all whitespace runs to a single space", () => {
    expect(normalizeQuery("hello   world\t\nhow are you")).toBe(
      "hello world how are you",
    );
  });
  it("collapses non-breaking spaces", () => {
    expect(normalizeQuery("hello\u00A0world")).toBe("hello world");
  });
  it("trims leading and trailing whitespace", () => {
    expect(normalizeQuery("   anger   ")).toBe("anger");
  });
  it("strips trailing punctuation (single)", () => {
    expect(normalizeQuery("anger?")).toBe("anger");
    expect(normalizeQuery("what is anger!")).toBe("what is anger");
  });
  it("strips trailing runs of punctuation and symbols", () => {
    expect(normalizeQuery("anger?!...")).toBe("anger");
  });
  it("strips trailing punctuation interleaved with whitespace", () => {
    expect(normalizeQuery("anger ?  !")).toBe("anger");
  });
  it("is idempotent", () => {
    const once = normalizeQuery("  What is Anger??  ");
    expect(normalizeQuery(once)).toBe(once);
  });
  it("handles empty / non-string gracefully", () => {
    expect(normalizeQuery("")).toBe("");
    // @ts-expect-error — intentional
    expect(normalizeQuery(null)).toBe("");
    // @ts-expect-error — intentional
    expect(normalizeQuery(undefined)).toBe("");
  });
  it("preserves internal punctuation", () => {
    expect(normalizeQuery("don't be angry")).toBe("don't be angry");
  });
});

// -----------------------------------------------------------------------------
// queryHash
// -----------------------------------------------------------------------------

describe("queryHash", () => {
  it("produces a 64-char hex string (SHA-256)", () => {
    const h = queryHash("anger");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is stable for the same input", () => {
    expect(queryHash("anger")).toBe(queryHash("anger"));
  });
  it("differs for different inputs", () => {
    expect(queryHash("anger")).not.toBe(queryHash("angry"));
  });
  it("hashes the same value for NFC vs NFD when normalizeQuery is applied first", () => {
    const nfd = normalizeQuery("cafe\u0301");
    const nfc = normalizeQuery("café");
    expect(queryHash(nfd)).toBe(queryHash(nfc));
  });
});

// -----------------------------------------------------------------------------
// captionToRow (via __TEST__)
// -----------------------------------------------------------------------------

describe("captionToRow", () => {
  it("writes a null-explanation marker as explanation='' / confidence='low'", () => {
    const caption: Caption = {
      explanation: null,
      confidence: "low",
      guardTriggered: "schema",
      source: "guard",
    };
    const row = __TEST__.captionToRow("h", "s1", caption);
    expect(row).toEqual({
      query_hash: "h",
      shabad_id: "s1",
      explanation: "",
      confidence: "low",
    });
  });

  it("writes a populated caption verbatim", () => {
    const caption: Caption = {
      explanation: "A caption.",
      confidence: "high",
      source: "llm",
    };
    const row = __TEST__.captionToRow("h", "s1", caption);
    expect(row).toEqual({
      query_hash: "h",
      shabad_id: "s1",
      explanation: "A caption.",
      confidence: "high",
    });
  });
});

// -----------------------------------------------------------------------------
// getCached / writeCached — mocked Supabase
// -----------------------------------------------------------------------------

type RpcRow = { explanation: string; confidence: string } | null;

function makeMockClient(
  opts: {
    selectRow?: RpcRow;
    selectError?: { message: string } | null;
    upsertError?: { message: string } | null;
  } = {},
): {
  client: SupabaseClient;
  calls: { from: string[]; upsert: unknown[]; select: string[]; filters: Record<string, unknown>[] };
} {
  const calls = { from: [] as string[], upsert: [] as unknown[], select: [] as string[], filters: [] as Record<string, unknown>[] };

  // Build a chainable mock for .from(x).select().eq().eq().maybeSingle()
  function makeSelectChain() {
    const filters: Record<string, unknown> = {};
    const chain = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
      async maybeSingle() {
        calls.filters.push(filters);
        if (opts.selectError) {
          return { data: null, error: opts.selectError };
        }
        return { data: opts.selectRow ?? null, error: null };
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      calls.from.push(table);
      return {
        select(cols: string) {
          calls.select.push(cols);
          return makeSelectChain();
        },
        async upsert(row: unknown, _opts?: unknown) {
          calls.upsert.push(row);
          if (opts.upsertError) return { error: opts.upsertError };
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe("getCached", () => {
  it("returns null on cache miss", async () => {
    const { client } = makeMockClient({ selectRow: null });
    const res = await getCached("hash123", "s_abc", { client });
    expect(res).toBeNull();
  });

  it("returns a populated caption on cache hit (source='cache')", async () => {
    const { client, calls } = makeMockClient({
      selectRow: { explanation: "A captioned answer.", confidence: "medium" },
    });
    const res = await getCached("hash123", "s_abc", { client });
    expect(res).not.toBeNull();
    expect(res).toMatchObject({
      explanation: "A captioned answer.",
      confidence: "medium",
      source: "cache",
    });
    expect(calls.from).toEqual(["caption_cache"]);
    expect(calls.filters[0]).toEqual({ query_hash: "hash123", shabad_id: "s_abc" });
  });

  it("returns a guard-triggered marker when explanation is empty", async () => {
    const { client } = makeMockClient({
      selectRow: { explanation: "", confidence: "low" },
    });
    const res = await getCached("h", "s", { client });
    expect(res).not.toBeNull();
    expect(res).toMatchObject({
      explanation: null,
      confidence: "low",
      source: "cache",
    });
  });

  it("coerces a numeric shabad_id to string", async () => {
    const { client, calls } = makeMockClient({ selectRow: null });
    await getCached("h", 42, { client });
    expect(calls.filters[0]).toEqual({ query_hash: "h", shabad_id: "42" });
  });

  it("throws CacheReadError on Supabase error", async () => {
    const { client } = makeMockClient({ selectError: { message: "conn refused" } });
    await expect(getCached("h", "s", { client })).rejects.toBeInstanceOf(CacheReadError);
  });

  it("defensively normalizes unknown confidence to 'low'", async () => {
    const { client } = makeMockClient({
      selectRow: { explanation: "x", confidence: "bogus" },
    });
    const res = await getCached("h", "s", { client });
    expect(res).toMatchObject({ confidence: "low" });
  });
});

describe("writeCached", () => {
  it("upserts a populated caption", async () => {
    const { client, calls } = makeMockClient();
    const caption: Caption = { explanation: "A", confidence: "high", source: "llm" };
    await writeCached("h", "s", caption, { client });
    expect(calls.upsert).toHaveLength(1);
    expect(calls.upsert[0]).toEqual({
      query_hash: "h",
      shabad_id: "s",
      explanation: "A",
      confidence: "high",
    });
  });

  it("upserts a no-explanation marker as empty-explanation row", async () => {
    const { client, calls } = makeMockClient();
    const caption: Caption = {
      explanation: null,
      confidence: "low",
      guardTriggered: "gurmukhi",
      source: "guard",
    };
    await writeCached("h", "s", caption, { client });
    expect(calls.upsert[0]).toEqual({
      query_hash: "h",
      shabad_id: "s",
      explanation: "",
      confidence: "low",
    });
  });

  it("throws CacheWriteError on upsert error", async () => {
    const { client } = makeMockClient({ upsertError: { message: "dup key" } });
    const caption: Caption = { explanation: "A", confidence: "high", source: "llm" };
    await expect(writeCached("h", "s", caption, { client })).rejects.toBeInstanceOf(
      CacheWriteError,
    );
  });
});

// round-trip
describe("getCached + writeCached round-trip (fake in-memory cache)", () => {
  function makeInMemoryClient(): SupabaseClient {
    type Row = { query_hash: string; shabad_id: string; explanation: string; confidence: string };
    const rows: Row[] = [];
    return {
      from(_t: string) {
        return {
          select(_c: string) {
            const filters: Record<string, string> = {};
            const chain = {
              eq(col: string, val: string) {
                filters[col] = val;
                return chain;
              },
              async maybeSingle() {
                const found = rows.find(
                  (r) =>
                    r.query_hash === filters.query_hash &&
                    r.shabad_id === filters.shabad_id,
                );
                return { data: found ?? null, error: null };
              },
            };
            return chain;
          },
          async upsert(row: Row, _opts?: unknown) {
            const idx = rows.findIndex(
              (r) =>
                r.query_hash === row.query_hash && r.shabad_id === row.shabad_id,
            );
            if (idx >= 0) rows[idx] = row;
            else rows.push(row);
            return { error: null };
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  it("round-trips a populated caption", async () => {
    const client = makeInMemoryClient();
    const hash = queryHash(normalizeQuery("What is anger?"));
    const caption: Caption = { explanation: "Hello.", confidence: "high", source: "llm" };
    await writeCached(hash, "s1", caption, { client });
    const got = await getCached(hash, "s1", { client });
    expect(got).toMatchObject({ explanation: "Hello.", confidence: "high", source: "cache" });
  });

  it("round-trips a no-explanation marker", async () => {
    const client = makeInMemoryClient();
    const hash = queryHash(normalizeQuery("anger"));
    const caption: Caption = {
      explanation: null,
      confidence: "low",
      guardTriggered: "substring",
      source: "guard",
    };
    await writeCached(hash, "s1", caption, { client });
    const got = await getCached(hash, "s1", { client });
    expect(got).toMatchObject({ explanation: null, confidence: "low", source: "cache" });
  });
});
