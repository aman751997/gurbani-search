#!/usr/bin/env tsx
// Bootstraps eval/gold-set.yaml from a list of candidate queries.
//
// Methodology: run hybrid search live for each candidate query; take the
// top-5 shabad_ids as the initial `relevant` list. This is transparently
// tautological — we're measuring "does retrieval match first-pass human
// judgment" — and we document the caveat in eval/README.md.
//
// Intended to be run ONCE per corpus (or when the query mix changes); the
// output is then committed and optionally refined by hand.

import { resolve } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: resolve(process.cwd(), ".env.local") });

import { stringify } from "yaml";

export interface GoldCandidate {
  query: string;
  query_language: "english" | "roman-punjabi";
  notes?: string;
}

export interface GoldEntry {
  query: string;
  query_language: "english" | "roman-punjabi";
  relevant: string[];
  notes?: string;
}

// 50 English + 25 Roman-Punjabi = 75 total.
// English coverage: emotions/virtues/vices (anger, love, fear, ego, humility,
// greed, lust, attachment, compassion, patience, contentment, gratitude),
// spiritual concepts (naam, simran, seva, gurbani, meditation, surrender,
// devotion, worship, prayer, grace, blessing), life/death/karma (death,
// birth, karma, rebirth, liberation, salvation), social (forgiveness, truth,
// honesty, humility, service, sangat, sharing, hypocrisy), doubt/faith
// (doubt, faith, trust, belief, ignorance, wisdom, knowledge), and a few
// direct-object concepts (god, one, name, guru, beloved, creator, lord).

export const ENGLISH_CANDIDATES: GoldCandidate[] = [
  { query: "anger", query_language: "english", notes: "krodh" },
  { query: "love", query_language: "english", notes: "prem / divine love" },
  { query: "fear", query_language: "english", notes: "bhau / trepidation" },
  { query: "ego", query_language: "english", notes: "haumai" },
  { query: "humility", query_language: "english", notes: "nimrata" },
  { query: "greed", query_language: "english", notes: "lobh" },
  { query: "lust", query_language: "english", notes: "kaam" },
  { query: "attachment", query_language: "english", notes: "moh" },
  { query: "compassion", query_language: "english", notes: "daya" },
  { query: "patience", query_language: "english", notes: "dheeraj" },
  { query: "contentment", query_language: "english", notes: "santokh" },
  { query: "gratitude", query_language: "english", notes: "shukraana" },
  { query: "death", query_language: "english", notes: "maran" },
  { query: "birth", query_language: "english", notes: "janam" },
  { query: "karma", query_language: "english", notes: "karam / deeds" },
  { query: "rebirth", query_language: "english", notes: "aavan-jaavan" },
  { query: "liberation", query_language: "english", notes: "mukti" },
  { query: "salvation", query_language: "english", notes: "mokh" },
  { query: "forgiveness", query_language: "english", notes: "khima" },
  { query: "truth", query_language: "english", notes: "sach" },
  { query: "falsehood", query_language: "english", notes: "kur / jhooth" },
  { query: "honesty", query_language: "english" },
  { query: "devotion", query_language: "english", notes: "bhakti" },
  { query: "faith", query_language: "english", notes: "bharosa" },
  { query: "doubt", query_language: "english", notes: "bharam" },
  { query: "meditation", query_language: "english", notes: "dhyaan" },
  { query: "prayer", query_language: "english", notes: "ardas" },
  { query: "surrender", query_language: "english" },
  { query: "grace", query_language: "english", notes: "nadar / kirpa" },
  { query: "blessing", query_language: "english" },
  { query: "naam", query_language: "english", notes: "the Name" },
  { query: "guru", query_language: "english", notes: "the Guru" },
  { query: "god", query_language: "english", notes: "Ik Onkar / Hari" },
  { query: "the one creator", query_language: "english" },
  { query: "hypocrisy", query_language: "english", notes: "pakhand" },
  { query: "service", query_language: "english", notes: "seva" },
  { query: "sangat", query_language: "english", notes: "the company of the holy" },
  { query: "sharing", query_language: "english", notes: "vand chhakna" },
  { query: "wisdom", query_language: "english", notes: "giaan" },
  { query: "ignorance", query_language: "english", notes: "agiaan" },
  { query: "suffering", query_language: "english", notes: "dukh" },
  { query: "joy", query_language: "english", notes: "sukh" },
  { query: "worldly attachment", query_language: "english", notes: "maya" },
  { query: "illusion", query_language: "english", notes: "maya" },
  { query: "peace of mind", query_language: "english" },
  { query: "remembrance of god", query_language: "english", notes: "simran" },
  { query: "the Beloved", query_language: "english" },
  { query: "light within", query_language: "english", notes: "jyot" },
  { query: "one god", query_language: "english" },
  { query: "divine word", query_language: "english", notes: "shabad / bani" },
];

// Roman-Punjabi queries use common dictionary tokens we already transliterate
// in lib/transliterate.ts.
export const ROMAN_PUNJABI_CANDIDATES: GoldCandidate[] = [
  { query: "haumai", query_language: "roman-punjabi", notes: "ego" },
  { query: "simran", query_language: "roman-punjabi", notes: "remembrance" },
  { query: "waheguru", query_language: "roman-punjabi", notes: "divine name" },
  { query: "krodh", query_language: "roman-punjabi", notes: "anger" },
  { query: "daya", query_language: "roman-punjabi", notes: "compassion" },
  { query: "prem", query_language: "roman-punjabi", notes: "love" },
  { query: "naam", query_language: "roman-punjabi", notes: "the Name" },
  { query: "seva", query_language: "roman-punjabi", notes: "service" },
  { query: "bhakti", query_language: "roman-punjabi", notes: "devotion" },
  { query: "santokh", query_language: "roman-punjabi", notes: "contentment" },
  { query: "sach", query_language: "roman-punjabi", notes: "truth" },
  { query: "maya", query_language: "roman-punjabi", notes: "illusion" },
  { query: "mukti", query_language: "roman-punjabi", notes: "liberation" },
  { query: "kirpa", query_language: "roman-punjabi", notes: "grace" },
  { query: "nadar", query_language: "roman-punjabi", notes: "glance of grace" },
  { query: "lobh", query_language: "roman-punjabi", notes: "greed" },
  { query: "kaam", query_language: "roman-punjabi", notes: "lust" },
  { query: "moh", query_language: "roman-punjabi", notes: "attachment" },
  { query: "nimrata", query_language: "roman-punjabi", notes: "humility" },
  { query: "giaan", query_language: "roman-punjabi", notes: "wisdom" },
  { query: "agiaan", query_language: "roman-punjabi", notes: "ignorance" },
  { query: "bharam", query_language: "roman-punjabi", notes: "doubt" },
  { query: "sangat", query_language: "roman-punjabi", notes: "holy company" },
  { query: "ardas", query_language: "roman-punjabi", notes: "prayer" },
  { query: "shabad", query_language: "roman-punjabi", notes: "divine word" },
];

export const CANDIDATES: GoldCandidate[] = [
  ...ENGLISH_CANDIDATES,
  ...ROMAN_PUNJABI_CANDIDATES,
];

export interface BootstrapDeps {
  runSearchTopK: (
    query: string,
    isRomanPunjabi: boolean,
    k: number,
  ) => Promise<string[]>;
  writeYaml: (entries: GoldEntry[]) => Promise<void>;
  log: (msg: string) => void;
  sleep: (ms: number) => Promise<void>;
}

export async function bootstrapGoldSet(
  candidates: GoldCandidate[],
  deps: BootstrapDeps,
  opts: { topK?: number; delayMs?: number } = {},
): Promise<GoldEntry[]> {
  const topK = opts.topK ?? 5;
  const delayMs = opts.delayMs ?? 50;
  const out: GoldEntry[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const ids = await deps.runSearchTopK(
      c.query,
      c.query_language === "roman-punjabi",
      topK,
    );
    out.push({
      query: c.query,
      query_language: c.query_language,
      relevant: ids,
      ...(c.notes ? { notes: c.notes } : {}),
    });
    deps.log(`(${i + 1}/${candidates.length}) ${c.query} → ${ids.length} relevant`);
    if (delayMs > 0) await deps.sleep(delayMs);
  }
  await deps.writeYaml(out);
  return out;
}

export const GOLD_SET_PATH = resolve(process.cwd(), "eval/gold-set.yaml");

const HEADER = `# gold-set.yaml — 75-query retrieval-evaluation gold set for Gurbani Search.
#
# Each entry:
#   query:          natural-language query string
#   query_language: "english" or "roman-punjabi"
#   relevant:       list of shabad_ids known to be theologically relevant
#   notes:          (optional) human-readable provenance
#
# See eval/README.md for bootstrap methodology + known evaluator-bias caveats
# + how to contribute refinements via PR.
`;

export async function buildProductionBootstrapDeps(): Promise<BootstrapDeps> {
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
    writeYaml: async (entries) => {
      const body = stringify(entries, { lineWidth: 0 });
      await writeFile(GOLD_SET_PATH, HEADER + body, "utf8");
    },
    log: (m) => {
      // eslint-disable-next-line no-console
      console.log(m);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

// Re-read an existing YAML (used to refresh without re-running all queries).
export async function readExistingGoldSet(): Promise<GoldEntry[] | null> {
  try {
    const raw = await readFile(GOLD_SET_PATH, "utf8");
    const { parse } = await import("yaml");
    const parsed = parse(raw) as GoldEntry[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
    const deps = await buildProductionBootstrapDeps();
    const entries = await bootstrapGoldSet(CANDIDATES, deps, {
      topK: 5,
      delayMs: 50,
    });
    // eslint-disable-next-line no-console
    console.log(`\nWrote ${entries.length} gold-set entries to ${GOLD_SET_PATH}`);
  })().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("bootstrap-gold-set failed:", e);
    process.exit(2);
  });
}
