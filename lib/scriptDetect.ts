// Script detection for user queries.
//
// Returns one of three tags:
//   "gurmukhi"     — any codepoint in U+0A00..U+0A7F (rejected at route layer)
//   "roman-punjabi"— ASCII-only, no English stopword, and either a dict hit
//                    or a strong bigram ratio
//   "english"      — everything else
//
// No network I/O — safe to call per-request on the Edge runtime.
// Dict-lookup handles short tokens like "simran" whose bigrams aren't distinctive.

import romanPunjabiDict from "@/data/romanpunjabi-dict.json";

export type ScriptTag = "gurmukhi" | "roman-punjabi" | "english";

const DICT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(romanPunjabiDict as Record<string, string>),
);

// Strong Roman-Punjabi bigram signals, rare in standard English.
// Intentionally short — "oo", "th", "sh", "ch", "er", "ai" are omitted
// because they appear in common English words like "anger" or "rain".
const PUNJABI_BIGRAMS: readonly string[] = [
  "aa",
  "kh",
  "jh",
  "dh",
  "bh",
  "rh",
  "ji",
  "ik",
  "ek",
];

/** Common English words that would otherwise score high on the bigram list. */
const ENGLISH_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "it",
  "this",
  "that",
  "be",
  "are",
  "was",
  "were",
  "been",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "what",
  "who",
  "when",
  "where",
  "why",
  "how",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "our",
  "they",
  "their",
  "he",
  "she",
  "him",
  "her",
  "his",
  "hers",
  "not",
  "no",
  "yes",
  "can",
  "will",
  "would",
  "should",
  "could",
  "about",
  "after",
  "all",
  "also",
  "as",
  "at",
  "by",
  "from",
  "if",
  "into",
  "just",
  "like",
  "more",
  "most",
  "some",
  "than",
  "then",
  "there",
  "these",
  "those",
  "up",
  "down",
  "out",
  "over",
  "under",
  "through",
]);

const GURMUKHI_BLOCK_START = 0x0a00;
const GURMUKHI_BLOCK_END = 0x0a7f;

/** Returns true if the string contains at least one Gurmukhi codepoint. */
export function containsGurmukhi(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= GURMUKHI_BLOCK_START && c <= GURMUKHI_BLOCK_END) return true;
  }
  return false;
}

/** Ratio of Punjabi-leaning bigrams over all adjacent letter pairs. */
function punjabiBigramRatio(tokens: readonly string[]): number {
  let bigramCount = 0;
  let hits = 0;
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    for (let i = 0; i < tok.length - 1; i++) {
      const bg = tok.slice(i, i + 2);
      bigramCount++;
      if (PUNJABI_BIGRAMS.includes(bg)) hits++;
    }
  }
  if (bigramCount === 0) return 0;
  return hits / bigramCount;
}

/**
 * Heuristic: Roman-Punjabi if ASCII-only, no English stopwords, and either a
 * token is in the dict or the bigram ratio clears the threshold.
 */
function looksRomanPunjabi(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  // Any non-ASCII (Hindi, emoji, accented chars, etc.) rules this out.
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) > 0x7f) return false;
  }
  const lower = trimmed.toLowerCase();
  // Tokenize on whitespace and any non-letter so punctuation doesn't pollute
  // bigram counts.
  const tokens = lower.split(/[^a-z]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  for (const t of tokens) {
    if (ENGLISH_STOPWORDS.has(t)) return false;
  }
  // Dict lookup is the highest-confidence signal — any hit means Roman-Punjabi.
  for (const t of tokens) {
    if (DICT_KEYS.has(t)) return true;
  }
  // Fall back to bigram ratio for tokens not in the dict.
  const ratio = punjabiBigramRatio(tokens);
  return ratio >= 0.2;
}

/**
 * Classify a user query by script / romanization style.
 *
 * @param raw The query string AFTER validateQuery has accepted it (so this
 *            function never sees control chars, over-long inputs, etc.).
 */
export function detectScript(raw: string): ScriptTag {
  if (containsGurmukhi(raw)) return "gurmukhi";
  if (looksRomanPunjabi(raw)) return "roman-punjabi";
  return "english";
}

/** Exported for unit-test visibility. */
export const __TEST__ = { PUNJABI_BIGRAMS, ENGLISH_STOPWORDS, punjabiBigramRatio };
