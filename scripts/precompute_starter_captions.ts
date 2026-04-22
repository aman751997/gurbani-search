#!/usr/bin/env tsx
// U7 — Pre-compute starter-query captions.
//
// Loads data/starter-queries.json, runs hybrid search for each query against
// the live Supabase + Cloudflare stack, then calls generateCaption() for each
// (query, shabad) pair — hitting real Groq unless a cached row is already
// present. Writes data/starter-captions.json (committed static data for the
// homepage).
//
// Idempotent: a second run re-uses captions written to caption_cache, so no
// new LLM calls are made.
//
// Exits non-zero if ANY caption triggered a guard — we want that noise
// surfaced at commit time, not silently swallowed.
//
// Designed to be test-friendly: main() accepts injected dependencies so
// tests can run the full flow with mocked search / caption / fs.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

// Load .env.local BEFORE importing anything that reads env (embeddings, db, caption).
loadDotenv({ path: resolve(process.cwd(), ".env.local") });

// Imports below are lazy so loadDotenv above lands first.
/* eslint-disable @typescript-eslint/no-explicit-any */
type SearchRow = import("@/lib/search").SearchResultRow;
type Caption = import("@/lib/caption").Caption;
type ShabadRow = import("@/lib/caption").ShabadRow;

// -----------------------------------------------------------------------------
// Types — matches the schema committed to data/starter-captions.json
// -----------------------------------------------------------------------------

export interface StarterQuery {
  query: string;
  slug: string;
}

export interface StarterCaptionResult {
  shabad_id: string;
  score: number;
  gurmukhi_display: string;
  transliteration: string;
  translation_bms: string;
  translation_source: "ms" | "ssk";
  ang: number;
  author: string;
  raag: string;
  caption: {
    explanation: string | null;
    confidence: "high" | "medium" | "low";
    source: Caption["source"];
    guardTriggered?: string;
  };
}

export interface StarterCaptionEntry {
  query: string;
  slug: string;
  results: StarterCaptionResult[];
}

// -----------------------------------------------------------------------------
// Dependency surface — for testability
// -----------------------------------------------------------------------------

export interface Deps {
  /** Load the starter-queries JSON. Returns an array of {query, slug}. */
  loadQueries: () => Promise<StarterQuery[]>;
  /** Run hybrid search for `query`; returns top-k rows. */
  runSearch: (query: string) => Promise<SearchRow[]>;
  /** Generate (or cache-hit) a caption for a (query, shabad) pair. */
  generateCaption: (query: string, shabad: ShabadRow) => Promise<Caption>;
  /** Write the final JSON to disk. */
  writeOutput: (entries: StarterCaptionEntry[]) => Promise<void>;
  /** Sleep for `ms`. Used between Groq calls to respect rate limits. */
  sleep: (ms: number) => Promise<void>;
  /** Log line. Swappable for silent tests. */
  log: (msg: string) => void;
}

export interface MainOptions {
  /** Delay between LLM calls (ms). Defaults to 250. */
  delayMs?: number;
}

export interface MainResult {
  totalQueries: number;
  totalCaptionsGenerated: number;
  totalGuardTriggers: number;
  totalCacheHits: number;
  totalProviderCalls: number;
  guardTriggers: Array<{ query: string; shabad_id: string; trigger: string }>;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

export async function main(
  deps: Deps,
  opts: MainOptions = {},
): Promise<MainResult> {
  const delayMs = opts.delayMs ?? 250;
  const queries = await deps.loadQueries();

  const entries: StarterCaptionEntry[] = [];
  let totalCaptions = 0;
  let totalCacheHits = 0;
  let totalProviderCalls = 0;
  let totalGuardTriggers = 0;
  const guardTriggers: MainResult["guardTriggers"] = [];

  for (let qi = 0; qi < queries.length; qi++) {
    const { query, slug } = queries[qi];
    const rows = await deps.runSearch(query);
    const results: StarterCaptionResult[] = [];
    let perQueryCacheHits = 0;
    let perQueryProviderCalls = 0;
    let perQueryGuards = 0;

    for (const row of rows) {
      const caption = await deps.generateCaption(query, {
        shabad_id: row.shabad_id,
        translation_bms: row.translation_bms,
        ang: row.ang,
        author: row.author,
        raag: row.raag,
        transliteration: row.transliteration,
      });

      if (caption.source === "cache") {
        perQueryCacheHits++;
      } else {
        perQueryProviderCalls++;
      }

      // A "guard" trigger is either a cached guard marker or a fresh one.
      if (caption.explanation === null) {
        perQueryGuards++;
        const trigger =
          "guardTriggered" in caption && caption.guardTriggered
            ? caption.guardTriggered
            : "unknown";
        guardTriggers.push({ query, shabad_id: row.shabad_id, trigger });
      }

      results.push({
        shabad_id: row.shabad_id,
        score: row.score,
        gurmukhi_display: row.gurmukhi_display,
        transliteration: row.transliteration,
        translation_bms: row.translation_bms,
        translation_source: row.translation_source,
        ang: row.ang,
        author: row.author,
        raag: row.raag,
        caption: {
          explanation: caption.explanation,
          confidence: caption.confidence,
          source: caption.source,
          ...(caption.explanation === null && "guardTriggered" in caption
            ? { guardTriggered: caption.guardTriggered }
            : {}),
        },
      });
      totalCaptions++;

      // Only sleep between PROVIDER calls — cache hits are free and instant.
      if (caption.source !== "cache" && delayMs > 0) {
        await deps.sleep(delayMs);
      }
    }

    totalCacheHits += perQueryCacheHits;
    totalProviderCalls += perQueryProviderCalls;
    totalGuardTriggers += perQueryGuards;

    entries.push({ query, slug, results });
    deps.log(
      `query ${qi + 1}/${queries.length} [${query}]: generated ${perQueryProviderCalls}, cache hits ${perQueryCacheHits}, guard triggers ${perQueryGuards}`,
    );
  }

  await deps.writeOutput(entries);

  return {
    totalQueries: queries.length,
    totalCaptionsGenerated: totalCaptions,
    totalGuardTriggers,
    totalCacheHits,
    totalProviderCalls,
    guardTriggers,
  };
}

// -----------------------------------------------------------------------------
// Default production deps + CLI entry
// -----------------------------------------------------------------------------

export const STARTER_QUERIES_PATH = resolve(
  process.cwd(),
  "data/starter-queries.json",
);
export const STARTER_CAPTIONS_PATH = resolve(
  process.cwd(),
  "data/starter-captions.json",
);

export async function buildProductionDeps(): Promise<Deps> {
  // Dynamic imports so tests can run main() without touching these modules.
  const { embedQuery } = await import("@/lib/embeddings");
  const { runHybridSearch } = await import("@/lib/search");
  const { generateCaption } = await import("@/lib/caption");

  return {
    loadQueries: async () => {
      const raw = await readFile(STARTER_QUERIES_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("starter-queries.json must be an array");
      }
      return parsed as StarterQuery[];
    },
    runSearch: async (query: string) => {
      const vec = await embedQuery(query);
      return runHybridSearch({
        queryText: query,
        queryEmbedding: vec,
        topK: 10,
      });
    },
    generateCaption: async (query, shabad) => generateCaption(query, shabad),
    writeOutput: async (entries) => {
      const json = JSON.stringify(entries, null, 2);
      await writeFile(STARTER_CAPTIONS_PATH, json + "\n", "utf8");
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (msg) => {
      // Use stdout — we want this visible in the commit log output.
      // eslint-disable-next-line no-console
      console.log(msg);
    },
  };
}

// CLI bootstrap — only runs when invoked directly, not when imported.
// tsx sets process.argv[1] to the absolute file path.
const invokedDirectly = (() => {
  try {
    const thisFile = new URL(import.meta.url).pathname;
    return process.argv[1] === thisFile;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  (async () => {
    const deps = await buildProductionDeps();
    const result = await main(deps, { delayMs: 1500 });
    // eslint-disable-next-line no-console
    console.log(
      `\nDone. Queries: ${result.totalQueries}, captions: ${result.totalCaptionsGenerated}, provider calls: ${result.totalProviderCalls}, cache hits: ${result.totalCacheHits}, guard triggers: ${result.totalGuardTriggers}`,
    );
    if (result.totalGuardTriggers > 0) {
      // eslint-disable-next-line no-console
      console.error("\nGuard triggers detected — surfacing and exiting non-zero:");
      for (const g of result.guardTriggers) {
        // eslint-disable-next-line no-console
        console.error(`  query=${g.query} shabad_id=${g.shabad_id} trigger=${g.trigger}`);
      }
      process.exit(1);
    }
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("precompute_starter_captions failed:", err);
    process.exit(2);
  });
}
