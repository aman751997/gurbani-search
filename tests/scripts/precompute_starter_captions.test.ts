// Tests for precompute_starter_captions.
//
// We exercise main() with fully mocked deps so no network is touched. The
// real Groq + Supabase invocation is exercised live when the script is run
// via `npm run precompute:starter` at commit time.

import { describe, it, expect, vi } from "vitest";
import {
  main,
  type Deps,
  type StarterQuery,
  type StarterCaptionEntry,
} from "@/scripts/precompute_starter_captions";
import type { SearchResultRow } from "@/lib/search";
import type { Caption } from "@/lib/caption";

function makeRow(i: number): SearchResultRow {
  return {
    shabad_id: `shabad_${i}`,
    gurmukhi_display: `ਜਪੁ ${i}`,
    transliteration: `jap ${i}`,
    translation_bms: `Translation number ${i}.`,
    translation_source: "ms",
    ang: i,
    author: "Guru Nanak",
    raag: "Asa",
    score: 0.9 - i * 0.01,
    match_highlights: [],
  };
}

function makeSuccessCaption(i: number): Caption {
  return {
    explanation: `Connects the query to theme of shabad ${i}.`,
    confidence: "medium",
    source: "llm",
  };
}

function makeCachedCaption(i: number): Caption {
  return {
    explanation: `Connects cached for ${i}.`,
    confidence: "high",
    source: "cache",
  };
}

function makeGuardCaption(trigger: "schema" | "substring" | "gurmukhi" | "provider-error"): Caption {
  return {
    explanation: null,
    confidence: "low",
    guardTriggered: trigger,
    source: "guard",
  };
}

function makeDeps(
  queries: StarterQuery[],
  captionFactory: (query: string, shabadId: string) => Caption,
  opts: { rowsPerQuery?: number } = {},
): {
  deps: Deps;
  captured: { entries: StarterCaptionEntry[] | null };
  mocks: {
    runSearch: ReturnType<typeof vi.fn>;
    generateCaption: ReturnType<typeof vi.fn>;
    sleep: ReturnType<typeof vi.fn>;
    writeOutput: ReturnType<typeof vi.fn>;
  };
} {
  const rowsPerQuery = opts.rowsPerQuery ?? 10;
  const captured: { entries: StarterCaptionEntry[] | null } = { entries: null };

  const runSearch = vi.fn(async (_q: string) => {
    const rows: SearchResultRow[] = [];
    for (let i = 0; i < rowsPerQuery; i++) rows.push(makeRow(i));
    return rows;
  });
  const generateCaption = vi.fn(async (query: string, shabad: { shabad_id: string | number }) => {
    return captionFactory(query, String(shabad.shabad_id));
  });
  const sleep = vi.fn(async () => {});
  const writeOutput = vi.fn(async (entries: StarterCaptionEntry[]) => {
    captured.entries = entries;
  });

  const deps: Deps = {
    loadQueries: async () => queries,
    runSearch,
    generateCaption,
    writeOutput,
    sleep,
    log: () => {},
  };

  return { deps, captured, mocks: { runSearch, generateCaption, sleep, writeOutput } };
}

describe("precompute_starter_captions.main", () => {
  it("writes 10 queries × 10 results = 100 captions in nested schema", async () => {
    const queries: StarterQuery[] = Array.from({ length: 10 }, (_, i) => ({
      query: `q${i}`,
      slug: `q${i}`,
    }));
    const { deps, captured } = makeDeps(queries, (_q, sid) =>
      makeSuccessCaption(Number(sid.replace("shabad_", ""))),
    );

    const result = await main(deps, { delayMs: 0 });

    expect(result.totalQueries).toBe(10);
    expect(result.totalCaptionsGenerated).toBe(100);
    expect(result.totalGuardTriggers).toBe(0);
    expect(captured.entries).not.toBeNull();
    expect(captured.entries!).toHaveLength(10);
    for (const entry of captured.entries!) {
      expect(entry).toHaveProperty("query");
      expect(entry).toHaveProperty("slug");
      expect(entry.results).toHaveLength(10);
      for (const r of entry.results) {
        expect(r).toHaveProperty("shabad_id");
        expect(r).toHaveProperty("score");
        expect(r).toHaveProperty("gurmukhi_display");
        expect(r).toHaveProperty("transliteration");
        expect(r).toHaveProperty("translation_bms");
        expect(r).toHaveProperty("translation_source");
        expect(r).toHaveProperty("ang");
        expect(r).toHaveProperty("author");
        expect(r).toHaveProperty("raag");
        expect(r.caption).toHaveProperty("explanation");
        expect(r.caption).toHaveProperty("confidence");
        expect(r.caption).toHaveProperty("source");
      }
    }
  });

  it("counts cache hits vs provider calls correctly", async () => {
    const queries: StarterQuery[] = [{ query: "anger", slug: "anger" }];
    let call = 0;
    const { deps, mocks } = makeDeps(queries, () => {
      call++;
      // Alternate cache / llm: 5 llm, 5 cache
      return call % 2 === 1 ? makeSuccessCaption(call) : makeCachedCaption(call);
    });

    const result = await main(deps, { delayMs: 1 });
    expect(result.totalCaptionsGenerated).toBe(10);
    expect(result.totalCacheHits).toBe(5);
    expect(result.totalProviderCalls).toBe(5);
    // sleep only between provider calls, not cache hits
    expect(mocks.sleep).toHaveBeenCalledTimes(5);
  });

  it("surfaces guard triggers and they are returned non-zero", async () => {
    const queries: StarterQuery[] = [
      { query: "anger", slug: "anger" },
      { query: "love", slug: "love" },
    ];
    let call = 0;
    const { deps } = makeDeps(queries, () => {
      call++;
      // every 3rd caption triggers a substring guard
      return call % 3 === 0 ? makeGuardCaption("substring") : makeSuccessCaption(call);
    });

    const result = await main(deps, { delayMs: 0 });
    expect(result.totalGuardTriggers).toBeGreaterThan(0);
    expect(result.guardTriggers.length).toBe(result.totalGuardTriggers);
    for (const g of result.guardTriggers) {
      expect(g.query).toBeTruthy();
      expect(g.shabad_id).toBeTruthy();
      expect(g.trigger).toBe("substring");
    }
  });

  it("idempotency: second run with all cache hits makes zero provider calls", async () => {
    const queries: StarterQuery[] = [{ query: "seva", slug: "seva" }];
    // First deps: all LLM calls.
    const first = makeDeps(queries, (_q, sid) =>
      makeSuccessCaption(Number(sid.replace("shabad_", ""))),
    );
    const r1 = await main(first.deps, { delayMs: 0 });
    expect(r1.totalProviderCalls).toBe(10);
    expect(r1.totalCacheHits).toBe(0);

    // Second deps: all cache hits.
    const second = makeDeps(queries, (_q, sid) =>
      makeCachedCaption(Number(sid.replace("shabad_", ""))),
    );
    const r2 = await main(second.deps, { delayMs: 0 });
    expect(r2.totalProviderCalls).toBe(0);
    expect(r2.totalCacheHits).toBe(10);
    // sleep was never called in the second run (only between provider calls)
    expect(second.mocks.sleep).not.toHaveBeenCalled();
  });

  it("includes guardTriggered field on rejected captions in output", async () => {
    const queries: StarterQuery[] = [{ query: "anger", slug: "anger" }];
    const { deps, captured } = makeDeps(
      queries,
      () => makeGuardCaption("substring"),
      { rowsPerQuery: 3 },
    );
    await main(deps, { delayMs: 0 });
    expect(captured.entries).not.toBeNull();
    const [entry] = captured.entries!;
    expect(entry.results).toHaveLength(3);
    for (const r of entry.results) {
      expect(r.caption.explanation).toBeNull();
      expect(r.caption.guardTriggered).toBe("substring");
    }
  });

  it("respects delayMs between provider calls", async () => {
    const queries: StarterQuery[] = [{ query: "q", slug: "q" }];
    const { deps, mocks } = makeDeps(
      queries,
      (_q, sid) => makeSuccessCaption(Number(sid.replace("shabad_", ""))),
      { rowsPerQuery: 3 },
    );
    await main(deps, { delayMs: 42 });
    // Three provider calls => three sleeps, each with 42ms
    expect(mocks.sleep).toHaveBeenCalledTimes(3);
    expect(mocks.sleep).toHaveBeenCalledWith(42);
  });
});
