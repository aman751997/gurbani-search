#!/usr/bin/env tsx
// Eval harness — runs the gold set through the live search pipeline and
// writes a markdown report with per-metric aggregates + per-query scores.

import { resolve, join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: resolve(process.cwd(), ".env.local") });

import { parse } from "yaml";
import { z } from "zod";
import { ndcgAtK, mrrAtK, recallAtK } from "@/eval/metrics";

export const GOLD_SET_PATH = resolve(process.cwd(), "eval/gold-set.yaml");
export const RESULTS_DIR = resolve(process.cwd(), "eval/results");

// The aggregate sanity floor used by the CLI to decide whether to exit
// non-zero. Per spec: nDCG@10 < 0.3 triggers a fail.
export const NDCG_SANITY_FLOOR = 0.3;

// ---------------------------------------------------------------------------
// Gold-set schema
// ---------------------------------------------------------------------------

export const GoldEntrySchema = z.object({
  query: z.string().min(1),
  query_language: z.enum(["english", "roman-punjabi"]),
  relevant: z.array(z.union([z.string(), z.number()])).min(1),
  notes: z.string().optional(),
});
export const GoldSetSchema = z.array(GoldEntrySchema).min(1);
export type GoldEntry = z.infer<typeof GoldEntrySchema>;

export async function loadGoldSet(path = GOLD_SET_PATH): Promise<GoldEntry[]> {
  const raw = await readFile(path, "utf8");
  const parsed = parse(raw);
  const res = GoldSetSchema.safeParse(parsed);
  if (!res.success) {
    throw new Error(
      `Invalid gold set: ${res.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  // Normalize ids → string.
  return res.data.map((e) => ({
    ...e,
    relevant: e.relevant.map((r) => (typeof r === "number" ? r.toString() : r)),
  }));
}

// ---------------------------------------------------------------------------
// Dependencies (injectable for tests)
// ---------------------------------------------------------------------------

export interface EvalDeps {
  runSearchTopK: (
    query: string,
    isRomanPunjabi: boolean,
    k: number,
  ) => Promise<string[]>;
  writeReport: (filename: string, contents: string) => Promise<void>;
  log: (msg: string) => void;
}

export interface PerQueryResult {
  query: string;
  query_language: "english" | "roman-punjabi";
  relevant: string[];
  retrieved: string[];
  ndcg10: number;
  mrr10: number;
  recall20: number;
  notes?: string;
}

export interface AggregateResult {
  meanNdcg10: number;
  meanMrr10: number;
  meanRecall20: number;
  queriesTotal: number;
  byLanguage: Record<
    "english" | "roman-punjabi",
    { count: number; meanNdcg10: number; meanMrr10: number; meanRecall20: number }
  >;
  zeroRecallQueries: PerQueryResult[];
  per: PerQueryResult[];
  timestamp: string;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export async function runEval(
  goldSet: GoldEntry[],
  deps: EvalDeps,
  opts: { topK?: number } = {},
): Promise<AggregateResult> {
  const topK = opts.topK ?? 20;
  const per: PerQueryResult[] = [];
  for (let i = 0; i < goldSet.length; i++) {
    const entry = goldSet[i];
    const isRP = entry.query_language === "roman-punjabi";
    const retrieved = await deps.runSearchTopK(entry.query, isRP, topK);
    const relSet = new Set(entry.relevant.map((x) => String(x)));
    const ndcg10 = ndcgAtK(retrieved, relSet, 10);
    const mrr10 = mrrAtK(retrieved, relSet, 10);
    const recall20 = recallAtK(retrieved, relSet, 20);
    per.push({
      query: entry.query,
      query_language: entry.query_language,
      relevant: entry.relevant.map((x) => String(x)),
      retrieved,
      ndcg10,
      mrr10,
      recall20,
      notes: entry.notes,
    });
    deps.log(
      `(${i + 1}/${goldSet.length}) ${entry.query} — nDCG10=${ndcg10.toFixed(3)} MRR10=${mrr10.toFixed(3)} R20=${recall20.toFixed(3)}`,
    );
  }

  const english = per.filter((p) => p.query_language === "english");
  const rp = per.filter((p) => p.query_language === "roman-punjabi");
  const agg: AggregateResult = {
    meanNdcg10: mean(per.map((p) => p.ndcg10)),
    meanMrr10: mean(per.map((p) => p.mrr10)),
    meanRecall20: mean(per.map((p) => p.recall20)),
    queriesTotal: per.length,
    byLanguage: {
      english: {
        count: english.length,
        meanNdcg10: mean(english.map((p) => p.ndcg10)),
        meanMrr10: mean(english.map((p) => p.mrr10)),
        meanRecall20: mean(english.map((p) => p.recall20)),
      },
      "roman-punjabi": {
        count: rp.length,
        meanNdcg10: mean(rp.map((p) => p.ndcg10)),
        meanMrr10: mean(rp.map((p) => p.mrr10)),
        meanRecall20: mean(rp.map((p) => p.recall20)),
      },
    },
    zeroRecallQueries: per.filter((p) => p.recall20 === 0),
    per,
    timestamp: new Date().toISOString(),
  };
  return agg;
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  return (s + " ".repeat(n)).slice(0, n);
}

export function renderMarkdownReport(agg: AggregateResult): string {
  const lines: string[] = [];
  lines.push(`# Eval report — ${agg.timestamp}`);
  lines.push("");
  lines.push(
    "Bootstrapped retrieval eval (solo-authored gold set; see `eval/README.md` for methodology and evaluator-bias caveats).",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Queries total | ${agg.queriesTotal} |`);
  lines.push(`| Mean nDCG@10 | ${agg.meanNdcg10.toFixed(4)} |`);
  lines.push(`| Mean MRR@10 | ${agg.meanMrr10.toFixed(4)} |`);
  lines.push(`| Mean Recall@20 | ${agg.meanRecall20.toFixed(4)} |`);
  lines.push(`| Queries with Recall@20 = 0 | ${agg.zeroRecallQueries.length} |`);
  lines.push("");
  lines.push("## Per-language breakdown");
  lines.push("");
  lines.push("| Language | Count | nDCG@10 | MRR@10 | Recall@20 |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const lang of ["english", "roman-punjabi"] as const) {
    const s = agg.byLanguage[lang];
    lines.push(
      `| ${lang} | ${s.count} | ${s.meanNdcg10.toFixed(4)} | ${s.meanMrr10.toFixed(4)} | ${s.meanRecall20.toFixed(4)} |`,
    );
  }
  lines.push("");

  // Top + bottom 10 by nDCG@10.
  const sorted = [...agg.per].sort((a, b) => b.ndcg10 - a.ndcg10);
  const top10 = sorted.slice(0, 10);
  const bot10 = sorted.slice(-10).reverse();

  lines.push("## Top 10 queries by nDCG@10");
  lines.push("");
  lines.push("| Query | Lang | nDCG@10 | MRR@10 | Recall@20 |");
  lines.push("|---|---|---:|---:|---:|");
  for (const p of top10) {
    lines.push(
      `| ${p.query} | ${p.query_language} | ${p.ndcg10.toFixed(4)} | ${p.mrr10.toFixed(4)} | ${p.recall20.toFixed(4)} |`,
    );
  }
  lines.push("");

  lines.push("## Bottom 10 queries by nDCG@10");
  lines.push("");
  lines.push("| Query | Lang | nDCG@10 | MRR@10 | Recall@20 |");
  lines.push("|---|---|---:|---:|---:|");
  for (const p of bot10) {
    lines.push(
      `| ${p.query} | ${p.query_language} | ${p.ndcg10.toFixed(4)} | ${p.mrr10.toFixed(4)} | ${p.recall20.toFixed(4)} |`,
    );
  }
  lines.push("");

  if (agg.zeroRecallQueries.length > 0) {
    lines.push("## Queries with Recall@20 = 0 (retrieval missed all relevant)");
    lines.push("");
    lines.push("| Query | Lang | Relevant count | Retrieved (first 5) |");
    lines.push("|---|---|---:|---|");
    for (const p of agg.zeroRecallQueries) {
      lines.push(
        `| ${p.query} | ${p.query_language} | ${p.relevant.length} | ${p.retrieved.slice(0, 5).join(", ")} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Full per-query scores");
  lines.push("");
  lines.push(
    `\`\`\`\n${pad("query", 32)} ${pad("lang", 14)} ${pad("nDCG@10", 9)} ${pad("MRR@10", 9)} ${pad("R@20", 9)}`,
  );
  for (const p of agg.per) {
    lines.push(
      `${pad(p.query, 32)} ${pad(p.query_language, 14)} ${pad(p.ndcg10.toFixed(4), 9)} ${pad(p.mrr10.toFixed(4), 9)} ${pad(p.recall20.toFixed(4), 9)}`,
    );
  }
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

export function reportFilename(now: Date = new Date()): string {
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const y = now.getUTCFullYear();
  const mo = pad2(now.getUTCMonth() + 1);
  const d = pad2(now.getUTCDate());
  const h = pad2(now.getUTCHours());
  const mi = pad2(now.getUTCMinutes());
  return `${y}-${mo}-${d}-${h}${mi}.md`;
}

// ---------------------------------------------------------------------------
// Production deps
// ---------------------------------------------------------------------------

export async function buildProductionDeps(): Promise<EvalDeps> {
  const { embedQuery } = await import("@/lib/embeddings");
  const { runHybridSearch } = await import("@/lib/search");
  const { transliterate } = await import("@/lib/transliterate");
  return {
    runSearchTopK: async (query, isRomanPunjabi, k) => {
      const processed = isRomanPunjabi ? transliterate(query).output : query;
      const vec = await embedQuery(processed);
      const rows = await runHybridSearch({
        queryText: processed,
        queryEmbedding: vec,
        topK: k,
      });
      return rows.map((r) => r.shabad_id);
    },
    writeReport: async (filename, contents) => {
      await mkdir(RESULTS_DIR, { recursive: true });
      await writeFile(join(RESULTS_DIR, filename), contents, "utf8");
    },
    log: (m) => {
       
      console.log(m);
    },
  };
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] === new URL(import.meta.url).pathname;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  (async () => {
    const gold = await loadGoldSet();
    const deps = await buildProductionDeps();
    const agg = await runEval(gold, deps, { topK: 20 });
    const md = renderMarkdownReport(agg);
    const filename = reportFilename();
    await deps.writeReport(filename, md);
     
    console.log(
      `\nWrote eval/results/${filename}\nAggregate: nDCG@10=${agg.meanNdcg10.toFixed(4)} MRR@10=${agg.meanMrr10.toFixed(4)} Recall@20=${agg.meanRecall20.toFixed(4)}`,
    );
    if (agg.meanNdcg10 < NDCG_SANITY_FLOOR) {
       
      console.error(
        `\nSANITY FLOOR BREACHED: mean nDCG@10 ${agg.meanNdcg10.toFixed(4)} < ${NDCG_SANITY_FLOOR}. Reporting numbers as-is; not silently tuning.`,
      );
      process.exit(1);
    }
  })().catch((e) => {
     
    console.error("eval run failed:", e);
    process.exit(2);
  });
}
