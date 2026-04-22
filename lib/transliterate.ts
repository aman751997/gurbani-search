// Roman-Punjabi → Gurmukhi transliteration.
//
// v1.0 ships a precomputed dict of ~240 high-frequency Roman-Punjabi tokens
// (data/romanpunjabi-dict.json) rather than a full Aksharamukha WASM port.
// The plan trades exhaustive correctness for near-zero bundle size and
// deterministic behavior — most queries devotees type ("haumai", "simran",
// "sat naam") are covered, and misses fall through to raw embedding.
//
// Contract:
//   - Input is a user query already vetted by validateQuery() and detected
//     as "roman-punjabi" by scriptDetect(). We still handle arbitrary ASCII
//     defensively — no throw on empty or weird inputs.
//   - Tokens are lowercased, dict-looked-up, and joined with single spaces.
//     If NO token hits the dict, the original string is returned unchanged
//     (caller can still embed it raw).
//   - If SOME tokens hit and others don't, the unknown tokens are preserved
//     in their original (lowercased) form — we never drop user input.
//
// Separation: the dict is data, not code. Tests import it directly. The
// module itself is a thin lookup with no parsing complexity.

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

/**
 * Tokenize on runs of non-letter characters. Returns a list of
 * lowercased tokens. Non-letter separators (spaces, punctuation) are
 * collapsed during the split and not preserved in the output — v1.0
 * treats query normalization as lossy for punctuation.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0);
}

/**
 * Transliterate a Roman-Punjabi query token-by-token.
 *
 * @param raw Raw Roman-Punjabi query. Must be the string that scriptDetect
 *            classified as "roman-punjabi" — this function is a no-op
 *            (returns the input) for strings with zero dict hits.
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
