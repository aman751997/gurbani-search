// Postgres-backed cache for caption generation.
//
// Row shape (see supabase/migrations/0001_init.sql):
//
//   caption_cache (
//     query_hash text,
//     shabad_id  text,   -- TEXT, not int — coerce numbers at the boundary
//     explanation text NOT NULL DEFAULT '',
//     confidence  text NOT NULL DEFAULT 'low',
//     created_at  timestamptz,
//     PRIMARY KEY (query_hash, shabad_id)
//   )
//
// A row with explanation='' is a no-explanation marker — the pair was
// attempted and a guard rejected it. Caching markers avoids re-hitting the
// LLM on every request for the same bad (query, shabad) pair.

import "server-only";

import { sha256Hex } from "@/lib/sha256";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/db";

// Strip trailing punctuation so "anger" and "anger?" map to the same cache key.
const TRAILING_PUNCT_RE = /[\p{P}\p{S}]+$/u;

/**
 * Normalize a raw user query for cache-key derivation:
 *   1. NFC normalization
 *   2. Lowercase
 *   3. Collapse whitespace runs to a single space
 *   4. Trim
 *   5. Strip trailing punctuation/symbols (repeated until stable)
 *
 * Changing this function invalidates all existing cached entries — bump the
 * cache namespace if behavior changes.
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
 * SHA-256 hex of the normalized query. Not salted — no security property
 * attaches to this key, it's purely for deduplication.
 */
export function queryHash(normalized: string): string {
  return sha256Hex(normalized);
}

export type Confidence = "high" | "medium" | "low";

export type GuardTrigger = "schema" | "gurmukhi" | "substring" | "provider-error";
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

// explanation='' on read means a guard previously rejected this pair.
// The specific guard reason isn't persisted (no column), so we always surface
// guardTriggered='schema' — callers only need to know it's a no-explanation marker.
export type CachedCaption = Caption & { source: "cache" };

export interface CacheOptions {
  /** Injected Supabase client for tests. Defaults to supabaseServer(). */
  client?: SupabaseClient;
}

function toShabadIdString(id: string | number): string {
  return typeof id === "number" ? id.toString() : id;
}

/**
 * Look up a cached caption. Returns `null` on cache miss (not an error).
 * A row with explanation='' is decoded as a no-explanation marker.
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
 * Upsert a cached caption. Guard-triggered captions are stored as
 * explanation='' so subsequent reads short-circuit without hitting the LLM.
 * The specific guard reason is not persisted (no schema column).
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
