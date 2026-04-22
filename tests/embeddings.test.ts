/**
 * Tests for lib/embeddings.ts. Cloudflare HTTP is fully mocked via the
 * injectable fetchImpl parameter — no real network calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { embedQuery, EmbeddingError, EMBED_DIM, __TEST__ } from "@/lib/embeddings";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-acct";
  process.env.CLOUDFLARE_AI_API_TOKEN = "test-token";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

function unitVector(seed = 1): number[] {
  const v = new Array<number>(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) v[i] = (i + seed) / EMBED_DIM;
  let s = 0;
  for (const x of v) s += x * x;
  const inv = 1 / Math.sqrt(s);
  return v.map((x) => x * inv);
}

describe("embedQuery — happy path", () => {
  it("returns a 1024-dim unit vector", async () => {
    const vec = unitVector();
    const fetchImpl = vi.fn(async () =>
      makeResponse({ success: true, result: { data: [vec] } }),
    );
    const out = await embedQuery("anger", { fetchImpl });
    expect(out.length).toBe(EMBED_DIM);
    // Unit-length within tiny epsilon
    let s = 0;
    for (const x of out) s += x * x;
    expect(Math.abs(Math.sqrt(s) - 1)).toBeLessThan(1e-6);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends text array + bearer auth", async () => {
    const vec = unitVector();
    const fetchImpl = vi.fn(async () =>
      makeResponse({ success: true, result: { data: [vec] } }),
    );
    await embedQuery("hello", { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/accounts/test-acct/ai/run/@cf/baai/bge-m3");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ text: ["hello"] });
  });
});

describe("embedQuery — error paths", () => {
  it("throws EmbeddingError on non-2xx", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ success: false, errors: ["boom"] }, { status: 500 }),
    );
    await expect(embedQuery("hi", { fetchImpl })).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError on success=false payload", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ success: false, errors: [{ code: 1, message: "bad" }] }),
    );
    await expect(embedQuery("hi", { fetchImpl })).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError on wrong vector length", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ success: true, result: { data: [[0, 1, 2]] } }),
    );
    await expect(embedQuery("hi", { fetchImpl })).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError on network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENETUNREACH");
    });
    await expect(embedQuery("hi", { fetchImpl })).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError on empty input", async () => {
    const fetchImpl = vi.fn(async () => makeResponse({ success: true, result: { data: [] } }));
    await expect(embedQuery("", { fetchImpl })).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("throws EmbeddingError when credentials missing", async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_AI_API_TOKEN;
    const fetchImpl = vi.fn();
    await expect(embedQuery("hi", { fetchImpl })).rejects.toBeInstanceOf(EmbeddingError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("l2Normalize (utility)", () => {
  it("returns unit-length", () => {
    const v = [3, 4];
    const n = __TEST__.l2Normalize(v);
    expect(Math.sqrt(n[0] * n[0] + n[1] * n[1])).toBeCloseTo(1, 10);
  });
  it("handles zero vector without dividing by zero", () => {
    const n = __TEST__.l2Normalize([0, 0, 0]);
    expect(n).toEqual([0, 0, 0]);
  });
});
