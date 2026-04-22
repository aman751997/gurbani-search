# Eval harness — Gurbani Search

This directory holds the retrieval evaluation harness for the search
pipeline: a 75-query gold set, pure-function metrics, a runner that produces
markdown reports, and committed historical results.

Run: `npm run eval:run`

## What this measures

For each query in `gold-set.yaml`:

1. Hybrid search (70% dense cosine + 30% pg_trgm lexical) returns top-20
   shabad_ids.
2. We compare against the hand-curated `relevant` set on that row.
3. Metrics computed per query:
   - **nDCG@10** — position-weighted; punishes putting relevant results
     deep in the list
   - **MRR@10** — reciprocal rank of the first relevant hit in the top-10
   - **Recall@20** — fraction of the relevant set retrieved in the top-20

Aggregates are means across queries, plus a breakdown by `query_language`
(english / roman-punjabi) so cross-lingual retrieval can be tracked
separately.

## How the gold set was bootstrapped (evaluator bias — honest disclosure)

The gold set was solo-authored by the project creator. Construction:

1. Pick ~75 candidate queries spanning emotion/virtue/vice themes
   (anger, love, ego, humility, greed, attachment), spiritual concepts
   (naam, simran, seva, bhakti, meditation, prayer), life/death/karma
   (death, birth, karma, rebirth, liberation), social concepts (truth,
   forgiveness, hypocrisy, service, sangat), and doubt/faith themes.
2. For each query, run the live hybrid search and take the top-5 shabad_ids
   as the initial `relevant` list.
3. Commit the result.

This is a **transparent bootstrap**: we're measuring "does retrieval match
first-pass human judgment of retrieval's own output" rather than "does
retrieval match a granthi's judgment." That means:

- **Recall@20 is inherently inflated** because the gold items are drawn
  from what the system could already retrieve.
- **nDCG@10 is a proxy for ranking stability**, not for theological correctness.
- A query that retrieves different-but-equally-relevant shabads after a
  tuning change will LOSE nDCG even if the new results are more theologically
  apt. This is a known false-negative mode.

The correct long-term fix is community PRs — see "Contributing" below.
The short-term v1.0 posture per the implementation plan is to **report
numbers transparently, not hard-gate on them** (§R7).

## Sanity floor

`run-eval.ts` exits non-zero if mean nDCG@10 drops below 0.3. This catches
regressions from accidental weight flips or index drops, not from legitimate
retrieval-quality shifts. The numbers are still written to the markdown
report regardless of exit code.

## Contributing refinements

We invite community PRs to expand, refine, or correct the gold set.
Acceptable PRs:

- Add new queries drawn from real community questions (r/Sikh posts,
  sangat discussions, your own reflective practice).
- Add more `relevant` shabad_ids to existing queries. Each addition should
  be defensible by theme, not just "this also showed up in search."
- Remove entries you believe are mis-categorized, with a short note.

Requested format:

```yaml
- query: "anger"
  query_language: "english"    # or "roman-punjabi"
  relevant:
    - shabad_1234
    - shabad_5678
  notes: "krodh-focused shabads; community-verified by <handle>"
```

## Interpreting metric values

- **nDCG@10 ≈ 1.0** — retrieval places every relevant item at the top,
  or puts the most-relevant items at the top positions in the ideal order.
- **MRR@10 ≈ 1.0** — for every query, at least one relevant item is at
  rank 1. This is the most forgiving metric here.
- **Recall@20 ≈ 1.0** — retrieval surfaces all relevant items within the
  first 20 results. At 5 relevant items per query with the bootstrap
  methodology, Recall@20 should be very high by construction; a drop
  indicates retrieval regression.

A sudden divergence between MRR and nDCG typically signals that the first
relevant item is still being found, but subsequent relevants are getting
pushed deeper — often a sign of ranking perturbation from a weight tweak
or a change in the lexical signal.
