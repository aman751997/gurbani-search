// Roman-Punjabi → Gurmukhi transliteration via a ~240-token precomputed dict
// (data/romanpunjabi-dict.json). Most common devotional queries are covered;
// misses fall through to raw embedding.
//
// If no token hits the dict, the original string is returned unchanged.
// If some tokens hit, unknowns are preserved in lowercased form — nothing is dropped.

import dict from "@/data/romanpunjabi-dict.json";

export type TransliterateResult = {
  /** Output text — dict-hit tokens replaced with Gurmukhi, misses preserved. */
  output: string;
  /** Number of distinct dict hits (for diagnostics / telemetry). */
  hits: number;
  /** Tokens that did not hit the dict (lowercased). */
  misses: string[];
};

const DICT = dict as Record<string, string>;

// Tokenize on non-letter runs; returns lowercased tokens. Punctuation is lossy.
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0);
}

/**
 * Transliterate a Roman-Punjabi query token-by-token.
 * Returns the original string unchanged if no token hits the dict.
 */
export function transliterate(raw: string): TransliterateResult {
  const tokens = tokenize(raw);
  if (tokens.length === 0) {
    return { output: raw, hits: 0, misses: [] };
  }
  const out: string[] = [];
  const misses: string[] = [];
  let hits = 0;
  for (const tok of tokens) {
    const mapped = DICT[tok];
    if (mapped !== undefined) {
      out.push(mapped);
      hits++;
    } else {
      out.push(tok);
      misses.push(tok);
    }
  }
  // Zero hits → return the ORIGINAL raw string. Downstream embedding
  // treats it as English/romanization and BGE-M3 handles it reasonably.
  if (hits === 0) {
    return { output: raw, hits: 0, misses };
  }
  return { output: out.join(" "), hits, misses };
}

/** Exposed for tests. */
export const __TEST__ = { DICT, tokenize };
