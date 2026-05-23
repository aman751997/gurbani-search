# CLAUDE.md

Semantic search across the Sri Guru Granth Sahib (SGGS). RAG-based retrieval app that finds real shabads by meaning -- never generates scripture.

## Tech stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript 5
- **Database**: Supabase (Postgres) with pgvector (halfvec), pg_trgm
- **Embeddings**: Cloudflare Workers AI -- BGE-M3, 1024-dim
- **LLM captions**: Groq (llama-3.3-70b-versatile), Anthropic stub exists
- **Rate limiting**: Upstash Redis (sliding window)
- **Deployment**: Vercel (region: bom1)
- **Ingestion pipeline**: Python 3.12 (laptop-only, never deployed)
- **Testing**: Vitest + React Testing Library (TS), pytest (Python)

## Project structure

```
app/                    Next.js App Router pages
  api/search/route.ts     POST /api/search -- hybrid retrieval endpoint
  api/caption/route.ts    GET /api/caption -- SSE stream of AI captions
  page.tsx                Home (search bar + starter query grid)
  search/page.tsx         Server-rendered search results page
  shabad/[id]/page.tsx    Shabad detail page (verbatim scripture, OG metadata)
components/             React components (ResultCard, SearchInput, CaptionBlock, etc.)
lib/                    Server-side modules
  search.ts               Hybrid search: 70% dense cosine + 30% pg_trgm word_similarity
  embeddings.ts           Cloudflare Workers AI BGE-M3 client
  caption.ts              Caption pipeline: provider -> schema guard -> gurmukhi guard -> substring guard -> cache
  captionCache.ts         Postgres-backed caption cache (SHA-256 query hash + shabad_id)
  captionGuards.ts        Zod schema guard, Gurmukhi codepoint guard, 7-token substring guard
  captionPrompt.ts        System prompt for caption LLM (pinned by tests)
  db.ts                   Supabase client singletons (anon for reads, service for writes)
  rateLimit.ts            Upstash rate limiters (30/min search, 60/min caption)
  scriptDetect.ts         Classify input: gurmukhi | roman-punjabi | english
  transliterate.ts        Roman-Punjabi -> Gurmukhi via precomputed dict
  validateQuery.ts        Input validation (length, control chars, injection sigils)
  sha256.ts               Pure-JS sync SHA-256 (Edge-compatible, no node:crypto)
  shabadLookup.ts         Single-shabad loader for detail page
  starterCaptions.ts      Precomputed starter query fast path (no network)
proxy.ts                Next.js middleware -- rate limiting + CORS for /api/*
data/                   Static JSON assets
  romanpunjabi-dict.json  ~240-token transliteration dictionary
  starter-captions.json   Precomputed results + captions for starter queries
  starter-queries.json    Starter theme list for homepage grid
supabase/migrations/    SQL migrations
  0001_init.sql           Tables: shabads, shabad_embeddings, caption_cache + RLS + indexes
  0002_search_rpc.sql     search_hybrid() RPC function
  0003_raise_anon_timeout.sql  Raise anon statement_timeout to 10s
ingestion/              Python pipeline (laptop-only)
  fetch_corpus.py         BaniDB API -> out/shabads.jsonl
  generate_embeddings.py  Cloudflare Workers AI -> out/embeddings.jsonl
  seed_supabase.py        Load into Supabase tables
  ingest/                 Shared modules (normalize, sources, embeddings)
  tests/                  pytest tests (network-free via mocks)
eval/                   Retrieval evaluation harness
  gold-set.yaml           75 queries (50 English + 25 Roman-Punjabi) with relevant shabad IDs
  run-eval.ts             Compute nDCG@10, MRR@10, Recall@20
  metrics.ts              Metric implementations
tests/                  Vitest test suite
  setup.ts                Global setup (jest-dom matchers, localStorage/EventSource shims)
  components/             Component tests (jsdom environment)
  eval/                   Gold-set schema + metrics tests
  scripts/                Script tests
scripts/                Build-time utilities
  precompute_starter_captions.ts  Generate data/starter-captions.json
.github/workflows/      CI
  secret-scan.yml         TruffleHog on PRs + push to main (verified-only findings)
.husky/pre-commit       Pre-commit secret scan (regex-based)
```

## Commands

```bash
# Dev
npm run dev                  # Next.js dev server
npm run build                # Production build
npm run start                # Start production server

# Test
npm test                     # Vitest (all tests, single run)
npm run test:watch           # Vitest watch mode

# Lint / format
npm run lint                 # ESLint
npm run format               # Prettier (write)
npm run format:check         # Prettier (check only)

# Eval
npm run eval:run             # Run retrieval eval (nDCG@10, MRR@10, Recall@20)
npm run eval:bootstrap       # Bootstrap gold-set from pipeline output

# Scripts
npm run precompute:starter   # Regenerate starter-captions.json

# Ingestion (laptop-only, from ingestion/ dir)
cd ingestion
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
set -a; source ../.env.local; set +a
./.venv/bin/python fetch_corpus.py --source sttm-desktop -v
./.venv/bin/python generate_embeddings.py -v
./.venv/bin/python seed_supabase.py --migrate -v
./.venv/bin/pytest                           # Ingestion tests
```

## Environment variables

Copy `.env.example` to `.env.local`. Required vars:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key (RLS-gated reads) |
| `SUPABASE_SERVICE_KEY` | Supabase service key (caption_cache writes, bypasses RLS) |
| `SUPABASE_DB_URL` | Postgres connection string (ingestion only) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account for Workers AI |
| `CLOUDFLARE_AI_API_TOKEN` | Cloudflare AI API token |
| `GROQ_API_KEY` | Groq API key (caption LLM) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL (rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `PROD_DOMAIN` | Production origin for CORS enforcement |
| `LLM_PROVIDER` | Caption LLM provider: `groq` (default) or `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic key (only if LLM_PROVIDER=anthropic) |

## Key conventions

- **Path aliases**: `@/*` maps to project root (tsconfig paths).
- **`server-only` import**: All `lib/` modules that touch env vars or DB import `"server-only"` to prevent client bundle leakage.
- **Test exports**: Modules expose `__TEST__` objects with internal helpers for unit test visibility. Never import `__TEST__` in production code.
- **Test reset helpers**: Singletons (db.ts, caption.ts, rateLimit.ts) export `__reset*ForTests()` functions for test isolation.
- **Vitest environments**: Default is `node`; `.test.tsx` files in `tests/` run in `jsdom` (configured via `environmentMatchGlobs`).
- **Prettier**: Double quotes, semicolons, trailing commas, 100 char width, 2-space indent, LF line endings.
- **ESLint**: next/core-web-vitals + next/typescript + prettier. Scripts dir is ignored.
- **Husky pre-commit**: Scans staged files for secret patterns (Anthropic keys, non-empty secret assignments). Blocks commit on match.
- **No query logging**: User queries are intentionally never persisted -- privacy by design for personal religious searches.
- **Error types**: Domain errors are custom Error subclasses (EmbeddingError, SearchError, ProviderError, CacheReadError, CacheWriteError).
- **Tagged unions**: Validation and guard results use `{ok: true, ...} | {ok: false, reason}` pattern throughout.
- **Fonts**: Geist Sans, Geist Mono, Noto Sans Gurmukhi (via `next/font/google`). Gurmukhi font exposed as `--font-gurmukhi` CSS variable.

## Architecture decisions

- **Hybrid search** (70% dense cosine / 30% pg_trgm word_similarity) via a single Postgres RPC. No external search engine.
- **halfvec(1024)** instead of vector(1024) -- halves storage for the Supabase free tier with <0.5% recall loss at this corpus size.
- **HNSW index** with m=16, ef_construction=64 for vector search.
- **Caption pipeline** is guard-heavy: schema validation (Zod), Gurmukhi codepoint rejection, 7-token substring overlap rejection. Guards prevent the LLM from paraphrasing or quoting scripture.
- **Caption cache** in Postgres keyed by SHA-256(normalized query) + shabad_id. Guard rejections cached as empty-string markers to avoid re-hitting the LLM.
- **SSE streaming** for captions: parallel fan-out on Edge runtime (30s headroom vs 10s Node cap). Results stream as each caption resolves.
- **Starter query fast path**: Precomputed results + captions served from static JSON. No network calls for homepage themes.
- **Script detection heuristic**: Dict lookup + bigram ratio for Roman-Punjabi vs English classification. Gurmukhi input hard-rejected in v1.0.
- **Edge vs Node split**: `proxy.ts` (middleware) and `/api/caption` run on Edge. `/api/search` runs on Node (halfvec parameters more robust outside Edge).
- **Pure-JS SHA-256**: Avoids `node:crypto` dependency for Edge runtime compatibility.
- **RLS enforced**: Anon key has read-only access to corpus tables. Caption cache is service-key-only (no RLS policy for anon).
- **Translation sources**: BaniDB provides Bhai Manmohan Singh ("ms") for ~96% of SGGS, Sant Singh Khalsa ("ssk") for ~4%. `translation_source` column tracks which.
