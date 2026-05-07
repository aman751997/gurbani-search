// Rate limiting + CORS for /api/* routes.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDefaultLimiters, rateLimitHeaders } from "@/lib/rateLimit";

export const config = {
  // Run on every /api/* path. Anything outside /api is untouched.
  matcher: ["/api/:path*"],
};

function isProd(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Return the allowed origin for this request, or null if no origin header was
 * sent. In non-production, wildcard. In production, exact-match PROD_DOMAIN.
 */
function resolveAllowedOrigin(requestOrigin: string | null): {
  allowed: boolean;
  allowOriginHeader: string;
} {
  if (!isProd()) {
    return { allowed: true, allowOriginHeader: "*" };
  }
  const prodDomain = process.env.PROD_DOMAIN ?? "";
  if (prodDomain && requestOrigin === prodDomain) {
    return { allowed: true, allowOriginHeader: prodDomain };
  }
  // In prod, same-origin requests from the browser OFTEN omit the Origin
  // header on same-origin GETs — that's fine; we don't set ACAO and the
  // browser accepts same-origin freely.
  if (!requestOrigin) {
    return { allowed: true, allowOriginHeader: prodDomain };
  }
  return { allowed: false, allowOriginHeader: "" };
}

function buildCorsHeaders(allowOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
}

/**
 * Extract a best-effort client IP. Vercel sets x-forwarded-for as a
 * comma-separated list; the first entry is the original client IP (Vercel
 * strips spoofed prefixes at its edge). Fall back to x-real-ip and finally a
 * fixed sentinel so the limiter never gets an empty key.
 */
function extractClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "anon";
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get("origin");
  const { allowed, allowOriginHeader } = resolveAllowedOrigin(origin);

  // CORS preflight — answer before touching the rate limiter so OPTIONS
  // storms don't consume the bucket.
  if (req.method === "OPTIONS") {
    if (!allowed) {
      return new NextResponse(null, { status: 403 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: buildCorsHeaders(allowOriginHeader),
    });
  }

  // CORS: in production, block cross-origin requests to /api/caption
  // explicitly. /api/search is also gated — no reason to allow third-party
  // origin for either endpoint.
  if (!allowed) {
    return new NextResponse("Forbidden origin", { status: 403 });
  }

  // Rate-limit. Pick the correct bucket for the route prefix.
  const isCaption = pathname.startsWith("/api/caption");
  const isSearch = pathname.startsWith("/api/search");
  if (isCaption || isSearch) {
    const ip = extractClientIp(req);
    const limiter = isCaption
      ? getDefaultLimiters().captionLimit
      : getDefaultLimiters().searchLimit;
    const result = await limiter.limit(ip);
    const headers = rateLimitHeaders(result);
    if (!result.success) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: {
          ...headers,
          ...buildCorsHeaders(allowOriginHeader),
          "Content-Type": "text/plain",
        },
      });
    }
    // Forward with rate-limit headers attached on the response.
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    for (const [k, v] of Object.entries(buildCorsHeaders(allowOriginHeader))) {
      res.headers.set(k, v);
    }
    return res;
  }

  // Non-rate-limited API route (none exist yet in v1, but leave the CORS
  // application in place so future additions inherit it).
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(buildCorsHeaders(allowOriginHeader))) {
    res.headers.set(k, v);
  }
  return res;
}
