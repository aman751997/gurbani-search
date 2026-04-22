// POST /api/search — main search endpoint.
//
// Request:  { "query": "anger" }
// Response: { "results": [ { shabad_id, gurmukhi_display, transliteration,
//                            translation_bms, translation_source, ang,
//                            author, raag, score, match_highlights } x<=10 ] }
//
// Error contract:
//   400 — validateQuery rejected the input (empty, too long, control char,
//         injection sigil, etc.). Body: { error: "invalid_query", reason }.
//   422 — Gurmukhi-script input detected. Body: { error: "gurmukhi_unsupported",
//         message: "v1.0 does not support Gurmukhi input" }.
//   503 — Cloudflare embedding failed OR Supabase RPC failed. Body:
//         { error: "service_unavailable" }. Root cause is logged to stderr
//         (Vercel runtime logs) — NEVER to the database.
//
// Rate-limiting (30 req/min/IP) runs in middleware.ts; this handler does not
// re-implement it. CORS headers are also applied by middleware.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { validateQuery } from "@/lib/validateQuery";
import { detectScript } from "@/lib/scriptDetect";
import { transliterate } from "@/lib/transliterate";
import { embedQuery, EmbeddingError } from "@/lib/embeddings";
import { runHybridSearch, SearchError } from "@/lib/search";

// Run on Node runtime — halfvec-typed parameters through the Supabase JS
// client are more robust outside Edge, and the rate-limiter already lives
// in middleware.ts which is Edge.
export const runtime = "nodejs";
// Never cache search responses. Every request goes through embedding+RPC.
export const dynamic = "force-dynamic";

interface SearchRequestBody {
  query?: unknown;
}

async function readBody(req: NextRequest): Promise<SearchRequestBody | null> {
  try {
    return (await req.json()) as SearchRequestBody;
  } catch {
    return null;
  }
}

function jsonError(
  status: number,
  error: string,
  extras: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error, ...extras }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readBody(req);
  if (body === null) {
    return jsonError(400, "invalid_query", { reason: "malformed_body" });
  }
  const validation = validateQuery(body.query);
  if (!validation.ok) {
    return jsonError(400, "invalid_query", { reason: validation.reason });
  }
  const { query } = validation;

  // Script detection. Gurmukhi input is a hard reject for v1.0.
  const script = detectScript(query);
  if (script === "gurmukhi") {
    return jsonError(422, "gurmukhi_unsupported", {
      message: "v1.0 does not support Gurmukhi input",
    });
  }

  // Roman-Punjabi → transliterate through the dict; English → pass raw.
  const processedText =
    script === "roman-punjabi" ? transliterate(query).output : query;

  // Embed. Cloudflare failures → 503 + stderr log.
  let vector: number[];
  try {
    vector = await embedQuery(processedText);
  } catch (e) {
    const detail =
      e instanceof EmbeddingError ? e.message : (e as Error)?.message ?? "unknown";
    console.error("[/api/search] embedding failure:", detail);
    return jsonError(503, "service_unavailable", { stage: "embedding" });
  }

  // Run the hybrid RPC.
  try {
    const results = await runHybridSearch({
      queryText: processedText,
      queryEmbedding: vector,
      topK: 10,
    });
    return NextResponse.json({ results });
  } catch (e) {
    const detail =
      e instanceof SearchError ? e.message : (e as Error)?.message ?? "unknown";
    console.error("[/api/search] search failure:", detail);
    return jsonError(503, "service_unavailable", { stage: "search" });
  }
}

// Reject non-POST methods with a 405 so the middleware's CORS preflight still
// resolves cleanly but GET probes don't leak the internals.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}
