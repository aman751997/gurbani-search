import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Middleware is a chunky integration point. We mock the rate-limit module so
 * we never touch Upstash, and drive the middleware with hand-built
 * NextRequest objects.
 *
 * Note: middleware.ts imports "@/lib/rateLimit" which resolves to
 * lib/rateLimit.ts via the vitest alias. vi.mock must use the SAME specifier
 * the importer uses (or its resolved absolute path).
 */

type LimitFn = (ip: string) => Promise<{
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}>;

const mockSearchLimit = vi.fn<LimitFn>();
const mockCaptionLimit = vi.fn<LimitFn>();

vi.mock("@/lib/rateLimit", () => {
  return {
    getDefaultLimiters: () => ({
      searchLimit: { limit: mockSearchLimit },
      captionLimit: { limit: mockCaptionLimit },
    }),
    rateLimitHeaders: (r: {
      success: boolean;
      limit: number;
      remaining: number;
      reset: number;
    }) => {
      const headers: Record<string, string> = {
        "X-RateLimit-Limit": String(r.limit),
        "X-RateLimit-Remaining": String(Math.max(0, r.remaining)),
        "X-RateLimit-Reset": String(r.reset),
      };
      if (!r.success) {
        const retry = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
        headers["Retry-After"] = String(retry);
      }
      return headers;
    },
  };
});

// Import AFTER vi.mock so the mock is applied.
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

function makeRequest(
  path: string,
  init: { method?: string; origin?: string | null; ip?: string } = {},
): NextRequest {
  const url = `https://example.app${path}`;
  const headers: Record<string, string> = {};
  if (init.origin !== null && init.origin !== undefined) {
    headers["origin"] = init.origin;
  }
  if (init.ip) headers["x-forwarded-for"] = init.ip;
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers,
  });
}

beforeEach(() => {
  mockSearchLimit.mockReset();
  mockCaptionLimit.mockReset();
  // Default: pass through with plenty of headroom.
  mockSearchLimit.mockResolvedValue({
    success: true,
    limit: 30,
    remaining: 29,
    reset: Date.now() + 60_000,
  });
  mockCaptionLimit.mockResolvedValue({
    success: true,
    limit: 60,
    remaining: 59,
    reset: Date.now() + 60_000,
  });
  // Reset env between tests.
  delete process.env.VERCEL_ENV;
  delete process.env.PROD_DOMAIN;
});

describe("middleware — rate limiting", () => {
  it("calls searchLimit for /api/search and allows when under the cap", async () => {
    const req = makeRequest("/api/search", { method: "POST", ip: "1.2.3.4" });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(mockSearchLimit).toHaveBeenCalledWith("1.2.3.4");
    expect(mockCaptionLimit).not.toHaveBeenCalled();
    expect(res.headers.get("X-RateLimit-Limit")).toBe("30");
  });

  it("calls captionLimit for /api/caption", async () => {
    const req = makeRequest("/api/caption", { ip: "1.2.3.4" });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(mockCaptionLimit).toHaveBeenCalledWith("1.2.3.4");
    expect(mockSearchLimit).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when over the cap", async () => {
    mockSearchLimit.mockResolvedValueOnce({
      success: false,
      limit: 30,
      remaining: 0,
      reset: Date.now() + 15_000,
    });
    const req = makeRequest("/api/search", { method: "POST", ip: "9.9.9.9" });
    const res = await middleware(req);
    expect(res.status).toBe(429);
    const retry = res.headers.get("Retry-After");
    expect(retry).not.toBeNull();
    expect(Number(retry)).toBeGreaterThan(0);
  });

  it("falls back to 'anon' IP key when no headers present", async () => {
    const req = makeRequest("/api/search", { method: "POST" });
    await middleware(req);
    expect(mockSearchLimit).toHaveBeenCalledWith("anon");
  });

  it("uses the first hop of x-forwarded-for", async () => {
    const req = makeRequest("/api/search", {
      method: "POST",
      ip: "10.0.0.1, 172.16.0.1, 192.168.0.1",
    });
    await middleware(req);
    expect(mockSearchLimit).toHaveBeenCalledWith("10.0.0.1");
  });
});

describe("middleware — CORS", () => {
  it("preview/dev: sets wildcard Access-Control-Allow-Origin", async () => {
    // VERCEL_ENV unset => non-production
    const req = makeRequest("/api/search", {
      method: "POST",
      origin: "https://some-attacker.test",
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("production: allows exact PROD_DOMAIN match", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PROD_DOMAIN = "https://gurbani.example.app";
    const req = makeRequest("/api/search", {
      method: "POST",
      origin: "https://gurbani.example.app",
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://gurbani.example.app",
    );
  });

  it("production: rejects a disallowed origin on /api/caption with 403", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PROD_DOMAIN = "https://gurbani.example.app";
    const req = makeRequest("/api/caption", {
      origin: "https://evil.test",
    });
    const res = await middleware(req);
    expect(res.status).toBe(403);
    // Must NOT have consumed the rate-limit bucket.
    expect(mockCaptionLimit).not.toHaveBeenCalled();
  });

  it("production: rejects disallowed origin on /api/search with 403", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PROD_DOMAIN = "https://gurbani.example.app";
    const req = makeRequest("/api/search", {
      method: "POST",
      origin: "https://evil.test",
    });
    const res = await middleware(req);
    expect(res.status).toBe(403);
    expect(mockSearchLimit).not.toHaveBeenCalled();
  });

  it("production: permits a same-origin request with no Origin header", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PROD_DOMAIN = "https://gurbani.example.app";
    const req = makeRequest("/api/search", { method: "POST", origin: null });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("responds to OPTIONS preflight with 204 in dev", async () => {
    const req = makeRequest("/api/search", {
      method: "OPTIONS",
      origin: "https://anywhere.test",
    });
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(mockSearchLimit).not.toHaveBeenCalled();
  });

  it("responds to OPTIONS preflight with 403 when origin disallowed in prod", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.PROD_DOMAIN = "https://gurbani.example.app";
    const req = makeRequest("/api/caption", {
      method: "OPTIONS",
      origin: "https://evil.test",
    });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });
});
