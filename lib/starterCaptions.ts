// Starter-query fast path helpers.
//
// The 10 pre-computed starter queries (data/starter-queries.json) +
// their cached caption data (data/starter-captions.json) let the
// homepage clickthrough render fully server-side with no SSE traffic.
// This library exposes a lookup by normalized query string.
//
// Normalization: lowercase + trim. Kept deliberately narrow — we don't
// want to expand to normalizeQuery() because the starter JSON was
// authored against the exact starter-queries.json strings and a more
// aggressive normalization could create surprising matches (e.g.
// "truth?" matching).

import starterCaptions from "@/data/starter-captions.json";
import starterQueries from "@/data/starter-queries.json";
import type { ShabadForCard } from "@/components/ResultCard";
import type { Confidence } from "@/components/CaptionBlock";
import type { TranslationSource } from "@/components/AttributionLine";

export interface StarterCaptionResult {
  shabad: ShabadForCard;
  caption: {
    explanation: string | null;
    confidence: Confidence;
    translationSource: TranslationSource;
  };
}

interface RawStarterEntry {
  query: string;
  slug: string;
  results: Array<{
    shabad_id: string;
    score: number;
    gurmukhi_display: string;
    transliteration: string;
    translation_bms: string;
    translation_source: string;
    ang: number;
    author: string;
    raag: string;
    caption: {
      explanation: string | null;
      confidence: string;
      source?: string;
    };
  }>;
}

const ENTRIES = starterCaptions as unknown as RawStarterEntry[];
const STARTER_QUERIES = starterQueries as { query: string; slug: string }[];
const ENTRIES_BY_QUERY: Map<string, RawStarterEntry> = new Map(
  ENTRIES.map((e) => [e.query.trim().toLowerCase(), e]),
);

function normalizeForStarterLookup(q: string): string {
  return q.trim().toLowerCase();
}

export function isStarterQuery(q: string): boolean {
  return ENTRIES_BY_QUERY.has(normalizeForStarterLookup(q));
}

export function getStarterResults(q: string): StarterCaptionResult[] | null {
  const entry = ENTRIES_BY_QUERY.get(normalizeForStarterLookup(q));
  if (!entry) return null;
  return entry.results.map((r) => ({
    shabad: {
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
    },
    caption: {
      explanation: r.caption.explanation,
      confidence:
        r.caption.confidence === "high" ||
        r.caption.confidence === "medium" ||
        r.caption.confidence === "low"
          ? (r.caption.confidence as Confidence)
          : "low",
      translationSource: (r.translation_source === "ssk" ? "ssk" : "ms") as
        | "ms"
        | "ssk",
    },
  }));
}

/**
 * The 3 starter-query suggestions shown on the empty-results state.
 * Returns up to `n` starters, excluding the one the user just typed (if any).
 */
export function suggestStarterQueries(
  excludeQuery: string,
  n = 3,
): { query: string; slug: string }[] {
  const norm = normalizeForStarterLookup(excludeQuery);
  return STARTER_QUERIES.filter(
    (s) => s.query.trim().toLowerCase() !== norm,
  ).slice(0, n);
}
