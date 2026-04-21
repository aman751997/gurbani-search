# `ingestion/` — laptop-only corpus pipeline

These Python scripts build the SGGS corpus and embedding artifacts that are
then bulk-loaded into Supabase. **Nothing here is deployed to Vercel.**

Python only runs on your laptop during the one-time ingestion + periodic
corpus refreshes. Production (Next.js on Vercel) has no Python dependency.

## Pipeline

```
  BaniDB public API
        │
        ▼
  fetch_corpus.py          →   out/shabads.jsonl        (U2)
        │
        ▼
  generate_embeddings.py   →   out/embeddings.jsonl     (U3)
        │
        ▼
  seed_supabase.py         →   Supabase shabads + shabad_embeddings tables (U4)
```

Each step is idempotent and restart-safe:

- `fetch_corpus.py --resume` skips shabad_ids already in the output file.
- `generate_embeddings.py` checkpoints every 500 shabads (U3).
- `seed_supabase.py` uses `ON CONFLICT DO UPDATE` (U4).

## Setup

```bash
cd ingestion
python3.12 -m venv .venv          # 3.11 or 3.12; 3.14 has broken pyexpat on macOS
./.venv/bin/pip install -r requirements.txt
```

Run tests:

```bash
./.venv/bin/pytest
```

All tests are network-free — HTTP is mocked via injectable `ang_iterator`
and `shabad_fetcher` seams in `fetch_corpus.fetch_corpus`.

## U2 — `fetch_corpus.py`

```bash
# Full SGGS fetch (~6,000 shabads, ~10 minutes on a clean API).
./.venv/bin/python fetch_corpus.py --source sttm-desktop -v

# Dev run against the first 50 shabads.
./.venv/bin/python fetch_corpus.py --source sttm-desktop --limit 50 -v

# Resume after interruption.
./.venv/bin/python fetch_corpus.py --source sttm-desktop --resume -v
```

Output: `ingestion/out/shabads.jsonl` (one JSON object per line).

### Source selection (`--source`)

Both `banidb` and `sttm-desktop` resolve to the **public BaniDB REST API**
(`https://api.banidb.com/v2`):

- `banidb` — the canonical corpus directly.
- `sttm-desktop` — the SikhiToTheMax Desktop app is derived from BaniDB
  with Khalis Foundation permission. Its data ships as a binary Realm
  bundle that is impractical to read from Python, but the upstream data
  identity is preserved by calling BaniDB directly. See
  `ingest/sources.py` for the reasoning.

If a future need requires a file-only offline fallback, add a third
source flag that reads from a committed JSONL snapshot.

### Translation choice

Only **Bhai Manmohan Singh** (public domain) is extracted, from the
`translation.en.ms` field on each BaniDB verse. Other translations
(BDB, Sant Singh Khalsa) are intentionally ignored to keep the committed
corpus license-clean — see the project memory doc for rationale.

### Output schema

Each line of `out/shabads.jsonl` is a JSON object:

```json
{
  "shabad_id": "1",
  "gurmukhi": "ੴ ਸਤਿ ਨਾਮੁ ... ॥",
  "gurmukhi_display": "ੴ ਸਤਿ ਨਾਮੁ ... ॥",
  "transliteration": "ikOankaar sat naam ...",
  "translation_bms": "There is but one God. True is His Name, ...",
  "ang": 1,
  "author": "Guru Nanak Dev Ji",
  "raag": "Jap",
  "line_count": 10
}
```

Fields:

- `gurmukhi` — NFC-normalized, whitespace-collapsed. Used for embedding
  and BM25 trigram indexes.
- `gurmukhi_display` — same as `gurmukhi` today; reserved for a future UI
  path that re-injects visraam markers from BaniDB's `visraam` positions.
- `ang` — lowest Ang number across the shabad's verses. Multi-Ang
  shabads collapse to a single record per plan U2.
- `translation_bms` — Bhai Manmohan Singh translation (BaniDB `en.ms`).
  Required: records with an empty MS translation are dropped and counted
  in the `invalid` summary.

See `ingest/normalize.py` top-of-file docstring for the authoritative
field contract.

## U3 — `generate_embeddings.py`

```bash
# Full embedding pass (~6k shabads via Cloudflare Workers AI BGE-M3).
# Loads CF credentials from the process environment. Either export them
# manually, or: `set -a; source ../.env.local; set +a` before running.
set -a; source ../.env.local; set +a
./.venv/bin/python generate_embeddings.py -v

# Dev run: only embed the first 50 shabads.
./.venv/bin/python generate_embeddings.py --limit 50 -v

# Bigger batches to the Cloudflare endpoint (32 is the default):
./.venv/bin/python generate_embeddings.py --batch-size 64 -v
```

Output: `ingestion/out/embeddings.jsonl` with one record per shabad:

```json
{"shabad_id": "1", "embedding_english": [0.123, ...1024 floats...]}
```

Per plan U3 decisions:

- The embedder hits Cloudflare's `@cf/baai/bge-m3` endpoint (same model
  used at query time — no cosine-distance drift).
- Only the `translation_bms` text is embedded (single-view baseline; a
  Gurmukhi view is added in a later unit only if eval demands it).
- Batches of 32 inputs per request; exponential backoff on 429/5xx up
  to 5 attempts.
- Vectors are cosine-normalized (`|v| ≈ 1`) before they're written.
- Output file is append-only and flushed every batch — a kill or crash
  resumes automatically on the next run (already-embedded shabad_ids
  are skipped before the next Cloudflare call).

## U4 — `seed_supabase.py`

Loads `shabads.jsonl` + `embeddings.jsonl` into Supabase. Uses
`INSERT ... ON CONFLICT DO UPDATE` so re-running is idempotent.

First, you need the Supabase Postgres connection string. From the
Supabase dashboard:

1. Open **Project Settings → Database**.
2. Scroll to **Connection string** and pick **URI**.
3. Choose **Transaction pooler** (port 6543, IPv4-compatible).
4. Copy the URL; it looks like
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`.

Put it in `.env.local` as `SUPABASE_DB_URL=...`. This is never used in
production — only the laptop seed script reads it.

```bash
# Apply the migration and seed in one go:
set -a; source ../.env.local; set +a
./.venv/bin/python seed_supabase.py --migrate -v

# Re-run to pick up corpus refreshes (idempotent):
./.venv/bin/python seed_supabase.py -v

# Validate inputs without touching the DB:
./.venv/bin/python seed_supabase.py --dry-run -v
```

The script validates:

- every embedding row references a `shabad_id` that exists in the corpus,
- every embedding vector is 1024-dim,
- shabads lacking an embedding get a warning (rare; only happens if an
  embed run was aborted and not re-run).

The migration file lives at
`../supabase/migrations/0001_init.sql` and is passed with
`--migrate`. Running the seed twice with `--migrate` is safe —
all CREATE statements use `IF NOT EXISTS`.
