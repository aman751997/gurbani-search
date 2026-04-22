// Postgres-backed cache for caption generation.
//
// Row shape (see supabase/migrations/0001_init.sql):
//
//   caption_cache (
//     query_hash text,
//     shabad_id  text,   -- matches shabads.shabad_id (text, not int)
//     explanation text NOT NULL DEFAULT '',
//     confidence  text NOT NULL DEFAULT 'low',
//     created_at  timestamptz,
//     PRIMARY KEY (query_hash, shabad_id)
//   )
//
// A row with explanation='' is a no-explanation MARKER — meaning the pair
// was attempted and any of the four defense layers (schema / Gurmukhi /
// substring / provider error) rejected it. We cache markers so the same
// bad (query, shabad) pair is not re-hit on every request.
//
// The U6 spec documents shabad_id as INT; the actual schema is TEXT. We
// follow the schema to preserve FK integrity. If callers pass a number we
// coerce to string at the boundary.
//
// This module is server-only.

import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/db";

// -----------------------------------------------------------------------------
// Query normalization
// -----------------------------------------------------------------------------

// Trailing punctuation class — remove common "?", "!", ".", etc. at the very
// end of the query so "anger" and "anger?" cache to the same key. This is
// conservative: only trailing, Unicode P (punctuation) + S (symbol).
const TRAILING_PUNCT_RE = /[\p{P}\p{S}]+$/u;

/**
 * Normalize a raw user query for cache-key derivation.
 *
 *   1. Unicode NFC normalization
 *      — e.g. "café" in NFD form -> "café" in NFC form.
 *   2. Lowercase (Unicode-aware via String.prototype.toLowerCase; for the
 *      query corpus, which is English / Roman-Punjabi, toLowerCase is
 *      deterministic).
 *   3. Collapse any run of whitespace (including NBSP, tabs) to a single
 *      ASCII space.
 *   4. Trim leading + trailing whitespace.
 *   5. Strip trailing punctuation/symbol characters.
 *
 * Spec'd in U6. Changes here invalidate all cached entries, so bump a cache
 * namespace if this function's behavior ever changes.
 */
export function normalizeQuery(raw: string): string {
  if (typeof raw !== "string") return "";
  let s = raw.normalize("NFC").toLowerCase();
  // Unicode whitespace -> single space.
  s = s.replace(/\s+/gu, " ");
  s = s.trim();
  // Repeat trailing-punct strip in case punctuation itself had trailing WS
  // that trim() removed and exposed more punct.
  let prev: string;
  do {
    prev = s;
    s = s.replace(TRAILING_PUNCT_RE, "").trimEnd();
  } while (s !== prev);
  return s;
}

/**
 * SHA-256 hex of the normalized query. Not salted — the value goes into a
 * user-opaque cache key, no security property attaches to it. (We choose
 * SHA-256 over MD5 for availability in the Node stdlib with no extra deps
 * and to stay forward-compatible.)
 */
export function queryHash(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

// -----------------------------------------------------------------------------
// Cache row types
// -----------------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";

/** Stable identifier for the reason a no-explanation marker was written. */
export type GuardTrigger = "schema" | "gurmukhi" | "substring" | "provider-error";

/**
 * In-memory caption shape the library returns. NEVER includes scripture
 * text — just the AI explanation and metadata.
 */
export type Caption =
  | {
      explanation: string;
      confidence: Confidence;
      source: "llm" | "cache";
    }
  | {
      explanation: null;
      confidence: "low";
      guardTriggered: GuardTrigger;
      source: "guard" | "cache";
    };

/**
 * Shape of the cache row after decoding. explanation='' is normalized to
 * `null` + guardTriggered='schema' by default (we don't know the original
 * trigger on read — the marker was written previously with '' as the body,
 * and the guardTriggered reason is not currently persisted in the schema.
 * For the strong "no AI explanation" UX behavior, the trigger identity
 * after a cache hit is not needed — the caller only cares that it's a
 * marker). See writeCached for how markers are persisted.
 */
export type CachedCaption = Caption & { source: "cache" };

// -----------------------------------------------------------------------------
// Read / write helpers
// -----------------------------------------------------------------------------

export interface CacheOptions {
  /** Injected Supabase client for tests. Defaults to supabaseServer(). */
  client?: SupabaseClient;
}

function toShabadIdString(id: string | number): string {
  return typeof id === "number" ? id.toString() : id;
}

/**
 * Look up a cached caption. Returns `null` on cache miss (not an error).
 *
 * A row with explanation='' is returned as a Caption of shape
 * `{ explanation: null, confidence: 'low', guardTriggered: 'schema',
 *    source: 'cache' }`. The caller should treat this identically to a
 * fresh guard-trigger: show the "No AI explanation" slot.
 */
export async function getCached(
  hash: string,
  shabadId: string | number,
  opts: CacheOptions = {},
): Promise<CachedCaption | null> {
  const sb = opts.client ?? supabaseServer();
  const sid = toShabadIdString(shabadId);
  const { data, error } = await sb
    .from("caption_cache")
    .select("explanation, confidence")
    .eq("query_hash", hash)
    .eq("shabad_id", sid)
    .maybeSingle();

  if (error) {
    // Don't fail the whole caption request on a cache-read error — the
    // caller can fall through to a live provider call. Surface via thrown
    // error so the caller can decide; the default generateCaption()
    // catches and proceeds.
    throw new CacheReadError(error.message ?? "caption_cache read failed");
  }
  if (!data) return null;

  const confidence = normalizeConfidence(data.confidence);
  const explanation = typeof data.explanation === "string" ? data.explanation : "";
  if (explanation === "") {
    return {
      explanation: null,
      confidence: "low",
      guardTriggered: "schema",
      source: "cache",
    };
  }
  return {
    explanation,
    confidence,
    source: "cache",
  };
}

/**
 * Upsert a cached caption. On guard-triggered captions we persist
 * explanation='' so subsequent reads short-circuit; we do NOT currently
 * persist the `guardTriggered` reason (the table schema has no column).
 * If future analytics want it, add a column in a follow-up migration.
 */
export async function writeCached(
  hash: string,
  shabadId: string | number,
  caption: Caption,
  opts: CacheOptions = {},
): Promise<void> {
  const sb = opts.client ?? supabaseServer();
  const sid = toShabadIdString(shabadId);

  const row = captionToRow(hash, sid, caption);

  const { error } = await sb
    .from("caption_cache")
    .upsert(row, { onConflict: "query_hash,shabad_id" });

  if (error) {
    throw new CacheWriteError(error.message ?? "caption_cache write failed");
  }
}

// -----------------------------------------------------------------------------
// Internals — exported for tests via __TEST__
// -----------------------------------------------------------------------------

function normalizeConfidence(v: unknown): Confidence {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

function captionToRow(
  hash: string,
  shabadId: string,
  caption: Caption,
): {
  query_hash: string;
  shabad_id: string;
  explanation: string;
  confidence: Confidence;
} {
  if (caption.explanation === null) {
    return {
      query_hash: hash,
      shabad_id: shabadId,
      explanation: "",
      confidence: "low",
    };
  }
  return {
    query_hash: hash,
    shabad_id: shabadId,
    explanation: caption.explanation,
    confidence: caption.confidence,
  };
}

export class CacheReadError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "CacheReadError";
  }
}
export class CacheWriteError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "CacheWriteError";
  }
}

export const __TEST__ = { captionToRow, normalizeConfidence };
