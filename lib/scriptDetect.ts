// Script detection for user queries.
//
// v1.0 supports English + Roman-Punjabi. Gurmukhi-script input is detected and
// rejected at the route layer (HTTP 422) because retrieval on Gurmukhi queries
// is deferred — the single embedding view is over BMS English translations.
//
// Detection is cheap and deterministic:
//   1. If ANY codepoint in U+0A00..U+0A7F appears                → "gurmukhi"
//   2. Else if ASCII-only AND no English stopword appears AND
//      either (a) any token is a known Roman-Punjabi dict entry
//      or (b) the Punjabi-bigram score clears the threshold       → "roman-punjabi"
//   3. Else                                                        → "english"
//
// Bigram scoring: we look for bigrams that are common in romanized Punjabi
// transliterations and rare in ordinary English. A small curated list keeps
// the rule surface auditable and avoids shipping a full n-gram model. The
// dict-lookup leg of the rule exists because short transliterated tokens
// (e.g. "simran" — si,im,mr,ra,an) have no distinctive bigram signal; the
// curated 240-token dict is our ground truth for "known Roman-Punjabi".
//
// The detector has ZERO network I/O and no heavy dependencies — safe to run
// per request on the Edge runtime.
//
// Callers should branch on the returned tag. English queries proceed to the
// embedding step raw; Roman-Punjabi queries go through the 200-token
// transliteration dict before embedding.

import romanPunjabiDict from "@/data/romanpunjabi-dict.json";

export type ScriptTag = "gurmukhi" | "roman-punjabi" | "english";

const DICT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(romanPunjabiDict as Record<string, string>),
);

/**
 * Bigrams that are strongly Punjabi-romanization signals. Each one is rare
 * or impossible in standard English text, and common in the transliterated
 * Gurbani vocabulary (see lib/transliterate.ts for the 200-token dict).
 *
 * The list is intentionally SHORT. A longer list increases false positives
 * (e.g. "oo" appears in "too"/"book" and is a terrible signal).
 */
// Bigrams that are STRONG Roman-Punjabi signals and rare in standard English.
// We deliberately omit bigrams that appear frequently in English (th, sh, ch,
// ee, oo, ng, er, ai — the last two show up in "anger", "rain", etc.). The
// dict-lookup leg handles tokens whose romanization lacks a distinctive
// bigram (e.g. "simran", "gurbani"). Bigrams only carry the weight for
// novel/rare Roman-Punjabi words that aren't in the dict.
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
 * Heuristic: Roman-Punjabi if the query is ASCII-only, has no pure-English
 * stopwords (after case-fold), and EITHER a token is in the known
 * Roman-Punjabi dictionary OR the bigram ratio clears the threshold.
 *
 * A single word like "haumai" returns true (dict hit). "simran" also returns
 * true via the dict even though its bigrams aren't distinctive. A sentence
 * like "what is grace" returns false because of the stopword "what" (and
 * "is"). "anger" returns false: not in the dict, and the tightened bigram
 * list no longer scores it.
 */
function looksRomanPunjabi(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  // ASCII-only gate: any non-ASCII rules this out (could be Hindi, emoji,
  // accented romanization, etc — all deferred for v1.0).
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
  // Dict lookup is our highest-confidence Roman-Punjabi signal — any token
  // in the curated 240-entry transliteration dict makes the query
  // Roman-Punjabi by construction (see data/romanpunjabi-dict.json).
  for (const t of tokens) {
    if (DICT_KEYS.has(t)) return true;
  }
  // Fall back to bigram ratio for novel Roman-Punjabi tokens not in the
  // dict. The tightened bigram list deliberately excludes common English
  // bigrams so short English words like "anger" don't false-positive.
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
