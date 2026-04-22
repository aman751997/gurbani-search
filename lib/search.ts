// Hybrid retrieval: dense cosine (70%) + pg_trgm word_similarity BM25-ish (30%)
// against the English translation. Runs entirely through Supabase PostgREST
// via the .rpc() call defined in supabase/migrations/0002_search_rpc.sql.
//
// This module is the thin glue between:
//   - the route handler (app/api/search/route.ts)
//   - the embedding client (lib/embeddings.ts)
//   - the Supabase client (lib/db.ts)
//
// It exposes one function — runHybridSearch — that takes a processed query
// string (post-transliteration) and a pre-computed embedding vector, and
// returns the shaped result rows. Separating embedding from search makes
// both easier to mock in tests.
//
// Result shape matches the API contract in app/api/search/route.ts.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnon } from "@/lib/db";

export const DEFAULT_TOP_K = 10;

export interface SearchResultRow {
  shabad_id: string;
  gurmukhi_display: string;
  transliteration: string;
  translation_bms: string;
  translation_source: "ms" | "ssk";
  ang: number;
  author: string;
  raag: string;
  score: number;
  match_highlights: string[];
}

export class SearchError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SearchError";
    this.cause = cause;
  }
}

interface SearchRpcRow {
  shabad_id: string;
  gurmukhi_display: string;
  transliteration: string;
  translation_bms: string;
  translation_source: string;
  ang: number;
  author: string;
  raag: string;
  score: number;
  dense_score: number;
  lexical_score: number;
}

/**
 * Extract up to 3 short highlight spans from translation_bms where any of
 * the query's alphanumeric tokens appears (case-insensitive). This is a
 * first-pass client-side highlighter for the results UI; it does not use
 * Postgres ts_headline because pg_trgm-based ranking doesn't produce one.
 *
 * Returned spans are short snippets (≤80 chars) around the first occurrence
 * of each distinct query token. Duplicates and empty strings are skipped.
 */
export function computeMatchHighlights(
  query: string,
  translation: string,
  opts: { maxHighlights?: number; window?: number } = {},
): string[] {
  const maxHighlights = opts.maxHighlights ?? 3;
  const window = opts.window ?? 40; // chars on either side
  if (!query || !translation) return [];
  const tokens = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 3),
    ),
  );
  if (tokens.length === 0) return [];
  const lower = translation.toLowerCase();
  const spans: string[] = [];
  for (const tok of tokens) {
    if (spans.length >= maxHighlights) break;
    const idx = lower.indexOf(tok);
    if (idx < 0) continue;
    const start = Math.max(0, idx - window);
    const end = Math.min(translation.length, idx + tok.length + window);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < translation.length ? "…" : "";
    spans.push(`${prefix}${translation.slice(start, end).trim()}${suffix}`);
  }
  return spans;
}

/**
 * Format a number[] as a pgvector / halfvec literal string — e.g.
 * "[0.1,0.2,...]". PostgREST accepts this form for halfvec-typed parameters.
 * Avoids locale-formatting pitfalls by using toString() on each number.
 */
export function formatVectorLiteral(v: number[]): string {
  const parts: string[] = new Array(v.length);
  for (let i = 0; i < v.length; i++) parts[i] = v[i].toString();
  return `[${parts.join(",")}]`;
}

export interface RunHybridSearchArgs {
  /** The query string AFTER transliteration — used for lexical BM25-ish ranking. */
  queryText: string;
  /** Pre-computed 1024-dim unit vector — used for dense cosine ranking. */
  queryEmbedding: number[];
  /** Top-k results. Defaults to 10. Clamped server-side to 1..50. */
  topK?: number;
  /** Injected Supabase client for tests. Defaults to supabaseAnon(). */
  client?: SupabaseClient;
}

/**
 * Execute the hybrid search RPC and shape rows for the API response.
 *
 * Throws SearchError on Supabase RPC errors so the route layer can map to
 * a 503.
 */
export async function runHybridSearch(
  args: RunHybridSearchArgs,
): Promise<SearchResultRow[]> {
  const {
    queryText,
    queryEmbedding,
    topK = DEFAULT_TOP_K,
    client,
  } = args;
  if (queryEmbedding.length !== 1024) {
    throw new SearchError(
      `runHybridSearch: embedding must be 1024-dim, got ${queryEmbedding.length}`,
    );
  }
  const sb = client ?? supabaseAnon();
  const vectorLit = formatVectorLiteral(queryEmbedding);
  const { data, error } = await sb.rpc("search_hybrid", {
    q_embedding: vectorLit,
    q_text: queryText,
    k: topK,
  });
  if (error) {
    throw new SearchError(`search RPC failed: ${error.message}`, error);
  }
  if (!Array.isArray(data)) {
    throw new SearchError("search RPC returned non-array data");
  }
  const rows = data as SearchRpcRow[];
  return rows.map((r) => ({
    shabad_id: r.shabad_id,
    gurmukhi_display: r.gurmukhi_display,
    transliteration: r.transliteration,
    translation_bms: r.translation_bms,
    translation_source: (r.translation_source === "ssk" ? "ssk" : "ms") as
      | "ms"
      | "ssk",
    ang: r.ang,
    author: r.author,
    raag: r.raag,
    score: r.score,
    match_highlights: computeMatchHighlights(queryText, r.translation_bms),
  }));
}

export const __TEST__ = { formatVectorLiteral, computeMatchHighlights };
