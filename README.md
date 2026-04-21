# Gurbani Search

> **Finds your Gurbani. Never writes it.**

Semantic search across the Sri Guru Granth Sahib. Retrieval only — no generation, paraphrasing, or summarization of scripture. See [`docs/plans/2026-04-21-001-feat-gurbani-semantic-search-v1-plan.md`](docs/plans/2026-04-21-001-feat-gurbani-semantic-search-v1-plan.md) for the full v1 plan.

## Status

Greenfield. U1 (scaffold) and U1b (security primitives) are the first landed units.

## Stack

- Next.js 16 + App Router + TypeScript + Tailwind v4
- Supabase Postgres + pgvector (HNSW, cosine)
- Cloudflare Workers AI (`@cf/baai/bge-m3`) for embeddings
- Anthropic Claude 4.5 Haiku for non-paraphrasing "why this matches" captions
- Upstash Redis for IP rate limiting

## Local development

```bash
npm install
cp .env.example .env.local     # fill in your own secrets
npm run dev                    # http://localhost:3000
```

## Scripts

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | Next.js dev server                                 |
| `npm run build`      | Production build                                   |
| `npm run start`      | Run production build                               |
| `npm run lint`       | ESLint (Next.js + Prettier-compat rules)           |
| `npm run format`     | Prettier write                                     |
| `npm test`           | Vitest (unit + lib tests)                          |

## Security posture

- `.env.local` is gitignored before any commit has ever been created.
- A pre-commit hook (installed by `husky` on `npm install`) rejects commits that contain strings matching `sk-ant-*`, `cf_*`, or any line from a local `.env.local`.
- CI runs a `trufflehog` secret-scan on every PR (`.github/workflows/secret-scan.yml`).
- Public API routes (to land in U5/U11) are rate-limited per IP via Upstash Ratelimit and pass through `middleware.ts` which enforces CORS.
- The Anthropic console has a $5/mo hard spend cap with a $3 billing alert (manual, operator-configured — not code).

## Layout

See the plan's "Output Structure" section. At U1 time only the scaffold exists; later units add `lib/`, `components/`, `app/api/`, `supabase/`, `ingestion/`, `eval/`, etc.

## Attribution (to be populated)

- **Corpus:** BaniDB (Alliance) or SikhiToTheMax-Desktop fallback (MIT).
- **Translation:** Bhai Manmohan Singh (SGPC, 1962–1969, public-domain-equivalent).
- **Fonts:** Noto Sans Gurmukhi.
