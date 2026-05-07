# Eval

Retrieval evaluation harness. 75-query gold set, nDCG@10 / MRR@10 / Recall@20.

```bash
npm run eval:run
```

Writes a timestamped report to `eval/results/`.

## Gold set

`gold-set.yaml` — 50 English + 25 Roman-Punjabi queries with hand-picked relevant shabad IDs.

**Caveat:** the gold set was bootstrapped from the pipeline's own output, so current scores (all 1.0) are self-consistent, not independently validated. Useful as a regression guard, not a quality claim.

## Metrics

- **nDCG@10** — ranking quality (position-weighted)
- **MRR@10** — rank of first relevant hit
- **Recall@20** — coverage of relevant set in top 20

Exits non-zero if nDCG@10 drops below 0.3 (catches regressions from broken indexes or weight flips).
