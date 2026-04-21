// Upstash Ratelimit wrappers.
//
// Two limiters:
//   - searchLimit:  30 req / min / IP for /api/search   (U5)
//   - captionLimit: 60 req / min / IP for /api/caption  (U11)
//
// Both use sliding-window to smooth bursts. Upstash Redis is required at
// runtime; tests must inject a fake client. We export a factory
// (`createLimiters`) to make that clean.
//
// Environment:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// Documented in .env.example. These are SERVER-ONLY and must only be read
// from middleware.ts / route handlers.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimiters {
  searchLimit: Ratelimit;
  captionLimit: Ratelimit;
}

/**
 * Minimal Redis interface used by @upstash/ratelimit. Upstash's own Redis
 * class satisfies this; tests can pass a hand-rolled stub that matches.
 */
export type RatelimitRedis = ConstructorParameters<typeof Ratelimit>[0]["redis"];

/**
 * Build both limiters against an injected Redis client. Use in production by
 * passing the default Upstash client (see `getDefaultLimiters`).
 */
export function createLimiters(redis: RatelimitRedis): RateLimiters {
  const searchLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "60 s"),
    prefix: "rl:search",
    analytics: false,
  });
  const captionLimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "60 s"),
    prefix: "rl:caption",
    analytics: false,
  });
  return { searchLimit, captionLimit };
}

/**
 * Lazy singleton. Only constructs an Upstash Redis client once env vars are
 * confirmed present. Throws at call-time (not import-time) so local builds
 * and tests that never hit the limiter can run without Upstash configured.
 */
let cached: RateLimiters | null = null;

export function getDefaultLimiters(): RateLimiters {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "rateLimit: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set",
    );
  }
  const redis = new Redis({ url, token });
  cached = createLimiters(redis);
  return cached;
}

/**
 * Translate a Ratelimit.limit() result to headers suitable for returning to
 * the client. Always call this so 200 responses include the same diagnostic
 * headers as 429s — easier debugging.
 */
export function rateLimitHeaders(r: {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(Math.max(0, r.remaining)),
    "X-RateLimit-Reset": String(r.reset),
  };
  if (!r.success) {
    // `reset` is a unix ms timestamp; Retry-After is seconds-from-now.
    const retryAfterSec = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
    headers["Retry-After"] = String(retryAfterSec);
  }
  return headers;
}

/** For tests only — clear the singleton so re-injecting envs takes effect. */
export function __resetLimitersForTest(): void {
  cached = null;
}
