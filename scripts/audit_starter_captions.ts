#!/usr/bin/env tsx
// Caption audit — scans data/starter-captions.json for anomalies that warrant
// human review. This script is intentionally heuristic-only: it never modifies
// captions. Its job is to surface candidates so the user can do a faster
// manual final review.
//
// Heuristics (each caption gets a combined verdict: pass / review / fail):
//
//  H1 — substring-overlap: any 4-token contiguous substring (case-insensitive,
//       alphanumeric tokens only) shared between caption and shabad
//       translation_bms. The runtime caption guard uses 7 tokens; we use a
//       stricter 4 here for audit because near-hits are worth a human look
//       even if the runtime guard let them through.
//
//  H2 — long-quote: a quoted phrase (double or single quotes) of ≥ 3 tokens.
//       Short attributed phrases like "the Name" are fine; longer runs warrant
//       review.
//
//  H3 — paraphrase-signal: the caption contains ≥ 5 consecutive tokens that
//       appear (in order, allowing up to 1 gap token between matches) inside
//       the translation. This catches loose paraphrase even without an exact
//       4-gram hit.
//
//  H4 — contains Gurmukhi codepoints (U+0A00–U+0A7F). The runtime guard
//       should prevent this, but audit flags defensively.
//
//  H5 — guard-marker captions (explanation === null) with trigger !== none:
//       reported separately so the user knows they aren't real text to review.
//
// Verdict rules:
//   - any hit on H1, H3, or H4             → "fail"
//   - any hit on H2                        → "review"
//   - guard marker (null explanation)      → "marker"
//   - otherwise                            → "pass"

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

interface StarterCaption {
  shabad_id: string;
  translation_bms: string;
  caption: {
    explanation: string | null;
    confidence: string;
    source: string;
    guardTriggered?: string;
  };
}

interface StarterEntry {
  query: string;
  slug: string;
  results: StarterCaption[];
}

interface AuditRow {
  query: string;
  shabad_id: string;
  verdict: "pass" | "review" | "fail" | "marker";
  explanation: string | null;
  triggers: string[];
  notes: string[];
}

// Tokenization — lowercase, split on non-alphanumerics, drop empties.

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 0);
}

// H1 — contiguous 4-gram overlap

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  if (tokens.length < n) return out;
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function h1_overlap4(caption: string, translation: string): string | null {
  const capGrams = new Set(ngrams(tokenize(caption), 4));
  if (capGrams.size === 0) return null;
  const tranGrams = ngrams(tokenize(translation), 4);
  for (const g of tranGrams) {
    if (capGrams.has(g)) return g;
  }
  return null;
}

// H2 — quoted run of >=3 tokens

function h2_longQuote(caption: string): string | null {
  // Match "..." or '...' — non-greedy. Report first hit whose token count >= 3.
  const re = /["'']([^"'']+)["'']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption)) !== null) {
    const inner = m[1];
    if (tokenize(inner).length >= 3) return inner;
  }
  return null;
}

// H3 — loose paraphrase signal (>=5 caption tokens appear in order in
// translation with at most 1 gap token between consecutive matches).

function h3_paraphrase(caption: string, translation: string): string | null {
  const cap = tokenize(caption);
  const tran = tokenize(translation);
  if (cap.length < 5 || tran.length < 5) return null;

  // Filter common stopwords from BOTH sides so "the lord of the" style matches
  // don't dominate. Keep the check focused on content words.
  const STOP = new Set([
    "the","a","an","of","to","in","and","or","is","are","was","were","be","been","being",
    "this","that","these","those","it","its","on","for","with","as","by","at","from",
    "his","her","their","its","your","my","our","we","he","she","they","you","i",
    "not","but","so","if","when","than","then","which","who","whom","whose",
    "shabad","touches","theme","mentions","explores","addresses","concept","explanation",
  ]);
  const capContent = cap.filter((t) => !STOP.has(t));
  const tranContent = tran.filter((t) => !STOP.has(t));
  if (capContent.length < 5) return null;

  // Find the longest contiguous (up to 1-gap) run of cap content words
  // appearing in order in translation content words.
  let best = 0;
  let bestRun: string[] = [];
  for (let start = 0; start < capContent.length; start++) {
    let tIdx = 0;
    const run: string[] = [];
    let prevHit = -1;
    for (let i = start; i < capContent.length; i++) {
      const tok = capContent[i];
      const found = tranContent.indexOf(tok, tIdx);
      if (found === -1) break;
      // Enforce "at most 1 gap" in caption sequence too — we relax this by
      // simply requiring the run to be contiguous in cap tokens. Gap in
      // translation is fine because paraphrasers reorder freely.
      if (prevHit !== -1 && i - prevHit > 1) break;
      run.push(tok);
      tIdx = found + 1;
      prevHit = i;
    }
    if (run.length > best) {
      best = run.length;
      bestRun = run;
    }
  }
  return best >= 5 ? bestRun.join(" ") : null;
}

// H4 — Gurmukhi codepoints

function h4_gurmukhi(caption: string): string | null {
  const m = caption.match(/[\u0A00-\u0A7F]/u);
  return m ? m[0] : null;
}

async function main() {
  const capPath = resolve(process.cwd(), "data/starter-captions.json");
  const outPath = resolve(process.cwd(), "docs/launch/caption-audit.md");
  const raw = await readFile(capPath, "utf8");
  const data = JSON.parse(raw) as StarterEntry[];

  const rows: AuditRow[] = [];
  const counts = { pass: 0, review: 0, fail: 0, marker: 0 };

  for (const entry of data) {
    for (const r of entry.results) {
      const cap = r.caption.explanation;
      if (cap === null || r.caption.source === "guard") {
        rows.push({
          query: entry.query,
          shabad_id: r.shabad_id,
          verdict: "marker",
          explanation: cap,
          triggers: [r.caption.guardTriggered ?? "unknown"],
          notes: [
            `guard marker (source=${r.caption.source}, trigger=${r.caption.guardTriggered ?? "unknown"})`,
          ],
        });
        counts.marker++;
        continue;
      }
      const notes: string[] = [];
      const triggers: string[] = [];
      let verdict: AuditRow["verdict"] = "pass";

      const h1 = h1_overlap4(cap, r.translation_bms);
      if (h1) {
        triggers.push("H1");
        notes.push(`contiguous 4-gram shared with translation: "${h1}"`);
        verdict = "fail";
      }
      const h3 = h3_paraphrase(cap, r.translation_bms);
      if (h3) {
        triggers.push("H3");
        notes.push(`loose paraphrase signal (5+ ordered tokens from translation): "${h3}"`);
        verdict = "fail";
      }
      const h4 = h4_gurmukhi(cap);
      if (h4) {
        triggers.push("H4");
        notes.push(`caption contains Gurmukhi codepoint (U+${h4.charCodeAt(0).toString(16).toUpperCase().padStart(4,"0")}): "${h4}"`);
        verdict = "fail";
      }
      const h2 = h2_longQuote(cap);
      if (h2) {
        triggers.push("H2");
        notes.push(`contains quoted run of >=3 tokens: "${h2}"`);
        if (verdict === "pass") verdict = "review";
      }

      rows.push({
        query: entry.query,
        shabad_id: r.shabad_id,
        verdict,
        explanation: cap,
        triggers,
        notes,
      });
      counts[verdict]++;
    }
  }

  const today = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# Starter Captions Audit — ${today}`);
  lines.push("");
  lines.push(
    "Heuristic scan of `data/starter-captions.json`. This report is advisory — it **flags candidates for human review**, never modifies data. The only hard gate on launch is your manual sign-off (see `docs/launch/v1.0-checklist.md`).",
  );
  lines.push("");
  lines.push("## Heuristics");
  lines.push("");
  lines.push("| ID | What it catches | Verdict if hit |");
  lines.push("|---|---|---|");
  lines.push("| H1 | Any contiguous 4-token overlap between caption and shabad translation (stricter than the runtime 7-token guard). | fail |");
  lines.push("| H2 | Caption contains a quoted run of >=3 tokens (double or single quotes). | review |");
  lines.push("| H3 | >=5 content tokens from caption appear in order inside the translation (paraphrase signal). | fail |");
  lines.push("| H4 | Caption contains a Gurmukhi codepoint (U+0A00–U+0A7F). Runtime guard should prevent this; defensive flag. | fail |");
  lines.push("| (marker) | Caption is a guard-marker (`explanation: null`) — no prose to review, only worth noting. | marker |");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total captions: **${rows.length}**`);
  lines.push(`- Pass: **${counts.pass}**`);
  lines.push(`- Review: **${counts.review}**`);
  lines.push(`- Fail: **${counts.fail}**`);
  lines.push(`- Guard markers (no prose to review): **${counts.marker}**`);
  lines.push("");

  // Sections: fails first, then reviews, then markers, then passes (collapsed).
  const byVerdict: Record<string, AuditRow[]> = { fail: [], review: [], marker: [], pass: [] };
  for (const r of rows) byVerdict[r.verdict].push(r);

  function sectionRows(title: string, list: AuditRow[], collapseThreshold = 0) {
    lines.push(`## ${title} (${list.length})`);
    lines.push("");
    if (list.length === 0) {
      lines.push("_None._");
      lines.push("");
      return;
    }
    const open = collapseThreshold > 0 && list.length > collapseThreshold;
    if (open) {
      lines.push("<details><summary>Expand list</summary>");
      lines.push("");
    }
    lines.push("| Query | Shabad | Triggers | Explanation | Notes |");
    lines.push("|---|---|---|---|---|");
    for (const r of list) {
      const exp = (r.explanation ?? "(null — guard marker)")
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ");
      const notes = r.notes.join("; ").replace(/\|/g, "\\|");
      const trig = r.triggers.join(", ") || "-";
      lines.push(`| ${r.query} | ${r.shabad_id} | ${trig} | ${exp} | ${notes} |`);
    }
    if (open) {
      lines.push("");
      lines.push("</details>");
    }
    lines.push("");
  }

  sectionRows("Failures — review urgently", byVerdict.fail);
  sectionRows("Review candidates", byVerdict.review);
  sectionRows("Guard markers (no prose to review)", byVerdict.marker);
  sectionRows("Passes (heuristic clean)", byVerdict.pass, 10);

  lines.push("---");
  lines.push("");
  lines.push(
    "Heuristics are conservative by design. A \"fail\" here is **not proof** that a caption paraphrases scripture — it means the caption shares enough surface with the translation to warrant a human read. You must personally sign off on every caption before launch.",
  );
  lines.push("");

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join("\n"), "utf8");

  // eslint-disable-next-line no-console
  console.log(
    `Audit complete: ${rows.length} captions — pass=${counts.pass} review=${counts.review} fail=${counts.fail} markers=${counts.marker}`,
  );
  // eslint-disable-next-line no-console
  console.log(`Report written: ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
