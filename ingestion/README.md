# Ingestion

Laptop-only Python scripts that build the corpus and load it into Supabase. Nothing here is deployed.

## Setup

```bash
cd ingestion
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

## Pipeline

```
BaniDB API → fetch_corpus.py → out/shabads.jsonl
           → generate_embeddings.py → out/embeddings.jsonl
           → seed_supabase.py → Supabase tables
```

Each step is idempotent and restart-safe.

## Scripts

**fetch_corpus.py** — fetches SGGS from BaniDB, writes shabad-level JSONL.

```bash
./.venv/bin/python fetch_corpus.py --source sttm-desktop -v        # full run
./.venv/bin/python fetch_corpus.py --source sttm-desktop --limit 50 # dev run
./.venv/bin/python fetch_corpus.py --source sttm-desktop --resume   # resume after interrupt
```

**generate_embeddings.py** — embeds translations via Cloudflare Workers AI (BGE-M3, 1024-d).

```bash
set -a; source ../.env.local; set +a
./.venv/bin/python generate_embeddings.py -v
```

**seed_supabase.py** — loads shabads + embeddings into Supabase.

```bash
set -a; source ../.env.local; set +a
./.venv/bin/python seed_supabase.py --migrate -v
```

## Tests

```bash
./.venv/bin/pytest
```

All tests are network-free (HTTP mocked via injectable seams).
