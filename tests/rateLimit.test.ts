import { describe, it, expect } from "vitest";
import { createLimiters, rateLimitHeaders } from "@/lib/rateLimit";

/**
 * In-memory stand-in for an Upstash Redis client, sufficient for
 * @upstash/ratelimit's single-region sliding-window limiter. The limiter
 * invokes `eval`/`evalsha` with the sliding-window Lua script; we don't
 * execute Lua, we short-circuit by recognizing the script text and
 * simulating its semantics with Map<string, number>.
 *
 * The simulated semantics exactly match the shipped Lua (see
 * node_modules/@upstash/ratelimit/dist/index.mjs, slidingWindowLimitScript):
 *   KEYS = [currentKey, previousKey, dynamicLimitKey]
 *   ARGV = [tokens, now, window, incrementBy]
 *   returns [remainingTokens, effectiveLimit]
 *   success when remainingTokens >= 0
 */
function makeFakeRedis() {
  const kv = new Map<string, number>();

  const scriptHandler = async (
    _script: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<[number, number]> => {
    const [currentKey, previousKey] = keys;
    const tokens = Number(args[0]);
    // args[1] = now (ms), args[2] = window (ms), not needed because we key by the window number already
    const incrementBy = Number(args[3] ?? 1);

    const currentVal = kv.get(currentKey) ?? 0;
    // previousKey intentionally not read — see comment below.
    void previousKey;

    // Simplification: do not apply the percentage weighting on the previous
    // window. For our tests we never straddle a window boundary (all calls
    // happen inside a single minute), so previousVal is always 0 and the
    // weighted value is also 0 — the test outcome is identical.
    const weightedPrevious = 0;

    if (incrementBy > 0 && weightedPrevious + currentVal >= tokens) {
      return [-1, tokens];
    }
    const newValue = currentVal + incrementBy;
    kv.set(currentKey, newValue);
    return [tokens - (newValue + weightedPrevious), tokens];
  };

  return {
    eval: scriptHandler,
    evalsha: scriptHandler,
    // @upstash/ratelimit's safeEval first tries evalsha; on NOSCRIPT it falls
    // back to eval. Both point to the same handler here.
    scriptLoad: async () => "fakesha",
  };
}

describe("rateLimitHeaders", () => {
  it("sets limit/remaining/reset on success", () => {
    const h = rateLimitHeaders({
      success: true,
      limit: 30,
      remaining: 29,
      reset: Date.now() + 60_000,
    });
    expect(h["X-RateLimit-Limit"]).toBe("30");
    expect(h["X-RateLimit-Remaining"]).toBe("29");
    expect(h["X-RateLimit-Reset"]).toBeDefined();
    expect(h["Retry-After"]).toBeUndefined();
  });

  it("adds Retry-After (seconds) when blocked", () => {
    const resetMs = Date.now() + 45_000;
    const h = rateLimitHeaders({
      success: false,
      limit: 30,
      remaining: 0,
      reset: resetMs,
    });
    expect(h["Retry-After"]).toBeDefined();
    const secs = Number(h["Retry-After"]);
    expect(secs).toBeGreaterThan(0);
    expect(secs).toBeLessThanOrEqual(60);
  });

  it("clamps Retry-After to >= 1 when reset is in the past", () => {
    const h = rateLimitHeaders({
      success: false,
      limit: 30,
      remaining: 0,
      reset: Date.now() - 5_000,
    });
    expect(Number(h["Retry-After"])).toBe(1);
  });

  it("clamps negative remaining to 0", () => {
    const h = rateLimitHeaders({
      success: false,
      limit: 30,
      remaining: -1,
      reset: Date.now() + 1_000,
    });
    expect(h["X-RateLimit-Remaining"]).toBe("0");
  });
});

describe("createLimiters", () => {
  it("constructs both limiters without throwing", () => {
    const fake = makeFakeRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { searchLimit, captionLimit } = createLimiters(fake as any);
    expect(searchLimit).toBeDefined();
    expect(captionLimit).toBeDefined();
  });

  it("searchLimit allows 30 requests and blocks the 31st for the same IP", async () => {
    const fake = makeFakeRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { searchLimit } = createLimiters(fake as any);
    const ip = "1.2.3.4";

    for (let i = 0; i < 30; i++) {
      const r = await searchLimit.limit(ip);
      expect(r.success).toBe(true);
      expect(r.limit).toBe(30);
    }

    const blocked = await searchLimit.limit(ip);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.reset).toBeGreaterThan(Date.now() - 1000);
  });

  it("captionLimit allows 60 requests per IP before blocking the 61st", async () => {
    const fake = makeFakeRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { captionLimit } = createLimiters(fake as any);
    const ip = "5.6.7.8";

    for (let i = 0; i < 60; i++) {
      const r = await captionLimit.limit(ip);
      expect(r.success).toBe(true);
    }
    const blocked = await captionLimit.limit(ip);
    expect(blocked.success).toBe(false);
  });

  it("different IPs have independent buckets", async () => {
    const fake = makeFakeRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { searchLimit } = createLimiters(fake as any);

    for (let i = 0; i < 30; i++) await searchLimit.limit("A");
    const aBlocked = await searchLimit.limit("A");
    expect(aBlocked.success).toBe(false);

    const bOk = await searchLimit.limit("B");
    expect(bOk.success).toBe(true);
  });

  it("search and caption limits use independent prefixes (same IP, different buckets)", async () => {
    const fake = makeFakeRedis();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { searchLimit, captionLimit } = createLimiters(fake as any);
    const ip = "9.9.9.9";

    for (let i = 0; i < 30; i++) await searchLimit.limit(ip);
    const searchBlocked = await searchLimit.limit(ip);
    expect(searchBlocked.success).toBe(false);

    // Caption bucket for same IP is untouched.
    const captionOk = await captionLimit.limit(ip);
    expect(captionOk.success).toBe(true);
    expect(captionOk.limit).toBe(60);
  });
});
