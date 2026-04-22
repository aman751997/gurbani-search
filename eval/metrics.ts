// Pure-function ranking metrics used by eval/run-eval.ts.
//
// All three metrics use binary relevance — a retrieved id is either in the
// relevant set or not. nDCG is computed with the "standard" definition:
//
//   DCG@k  = sum_{i=1..k} rel_i / log2(i + 1)
//   IDCG@k = DCG of the ideal ranking (all relevant items first, up to k)
//   nDCG@k = DCG@k / IDCG@k
//
// Edge cases (documented, tested, and deliberately not throwing):
//   - empty retrieved list → 0
//   - empty relevant set → 0 (not NaN — avoid poisoning aggregates)
//   - relevant items beyond top-k / top-20 → Recall contribution = 0
//   - k <= 0 → 0 (guard against caller mistakes)

// The retrieved list and relevant set both use string ids. Using strings
// (vs numbers) is a deliberate choice: shabad_id is text in the DB schema.
// The task-spec docstring mentions number[] in the helper signatures; we
// type them permissively so both work.

export type Id = string | number;

function toStr(x: Id): string {
  return typeof x === "number" ? x.toString() : x;
}

function relevantSetOf(relevant: Set<Id> | Iterable<Id>): Set<string> {
  if (relevant instanceof Set) {
    const out = new Set<string>();
    for (const v of relevant) out.add(toStr(v));
    return out;
  }
  const out = new Set<string>();
  for (const v of relevant) out.add(toStr(v));
  return out;
}

/**
 * Normalized Discounted Cumulative Gain @ k. Binary relevance.
 */
export function ndcgAtK(
  retrieved: Id[],
  relevant: Set<Id> | Iterable<Id>,
  k: number,
): number {
  if (k <= 0) return 0;
  const rel = relevantSetOf(relevant);
  if (rel.size === 0) return 0;
  if (retrieved.length === 0) return 0;

  const limit = Math.min(k, retrieved.length);
  let dcg = 0;
  for (let i = 0; i < limit; i++) {
    if (rel.has(toStr(retrieved[i]))) {
      // rel_i = 1; position i is 0-indexed so the log2 argument is (i+2).
      dcg += 1 / Math.log2(i + 2);
    }
  }

  // Ideal: as many 1s up front as possible, capped at min(k, |relevant|).
  const idealHits = Math.min(k, rel.size);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * Mean Reciprocal Rank @ k. Since each query has a single reciprocal rank
 * (not a mean over queries — that's an aggregation step), this returns the
 * reciprocal rank of the first relevant item within the top-k, or 0 if no
 * relevant item is in the top-k.
 */
export function mrrAtK(
  retrieved: Id[],
  relevant: Set<Id> | Iterable<Id>,
  k: number,
): number {
  if (k <= 0) return 0;
  const rel = relevantSetOf(relevant);
  if (rel.size === 0) return 0;
  const limit = Math.min(k, retrieved.length);
  for (let i = 0; i < limit; i++) {
    if (rel.has(toStr(retrieved[i]))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Recall @ k = |retrieved ∩ relevant ∩ top-k| / |relevant|.
 */
export function recallAtK(
  retrieved: Id[],
  relevant: Set<Id> | Iterable<Id>,
  k: number,
): number {
  if (k <= 0) return 0;
  const rel = relevantSetOf(relevant);
  if (rel.size === 0) return 0;
  const limit = Math.min(k, retrieved.length);
  let hits = 0;
  for (let i = 0; i < limit; i++) {
    if (rel.has(toStr(retrieved[i]))) hits++;
  }
  return hits / rel.size;
}

// Aliased names matching the spec's snake_case preference in documentation.
export const ndcg_at_k = ndcgAtK;
export const mrr_at_k = mrrAtK;
export const recall_at_k = recallAtK;
