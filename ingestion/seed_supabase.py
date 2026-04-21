#!/usr/bin/env python3
"""Seed Supabase with the corpus + embeddings produced by U2 and U3.

Usage:

    # One-shot full load (applies migration first if --migrate):
    python seed_supabase.py --migrate

    # Just reload data (schema already applied):
    python seed_supabase.py

    # Dry run — parse files, validate rows, but no DB writes:
    python seed_supabase.py --dry-run

Reads:
    ingestion/out/shabads.jsonl
    ingestion/out/embeddings.jsonl

Writes:
    public.shabads           (UPSERT on shabad_id)
    public.shabad_embeddings (UPSERT on shabad_id)

Env:
    SUPABASE_DB_URL  — Postgres connection string for the Supabase project.
                       Get it from: Supabase dashboard → Project Settings →
                       Database → Connection string (Transaction pooler, URI).
                       Prefer the pooler URL on IPv4 networks.
                       Format: postgresql://postgres.<ref>:<password>@<host>:6543/postgres

Idempotency: uses INSERT ... ON CONFLICT DO UPDATE for both tables. Running
the script twice leaves the database in the same state as running it once.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Iterable, Iterator

import psycopg

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))


logger = logging.getLogger("seed_supabase")

DEFAULT_SHABADS = _HERE / "out" / "shabads.jsonl"
DEFAULT_EMBEDDINGS = _HERE / "out" / "embeddings.jsonl"
DEFAULT_MIGRATION = _HERE.parent / "supabase" / "migrations" / "0001_init.sql"

BATCH_SIZE_SHABADS = 500
BATCH_SIZE_EMBEDDINGS = 100  # halfvec literals are long; smaller batches keep queries reasonable


class SeedError(RuntimeError):
    pass


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--shabads", type=Path, default=DEFAULT_SHABADS,
                   help=f"shabads.jsonl path (default {DEFAULT_SHABADS})")
    p.add_argument("--embeddings", type=Path, default=DEFAULT_EMBEDDINGS,
                   help=f"embeddings.jsonl path (default {DEFAULT_EMBEDDINGS})")
    p.add_argument("--migration", type=Path, default=DEFAULT_MIGRATION,
                   help=f"migration SQL path (default {DEFAULT_MIGRATION})")
    p.add_argument("--migrate", action="store_true",
                   help="apply the migration SQL before seeding")
    p.add_argument("--dry-run", action="store_true",
                   help="parse and validate inputs; do not connect to DB")
    p.add_argument("--verbose", "-v", action="count", default=0)
    return p.parse_args(argv)


def _iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise SeedError(f"bad JSONL at {path}:{i}: {exc}") from exc


def _chunks(it: Iterable[Any], n: int) -> Iterator[list[Any]]:
    buf: list[Any] = []
    for x in it:
        buf.append(x)
        if len(buf) >= n:
            yield buf
            buf = []
    if buf:
        yield buf


def _halfvec_literal(vec: list[float]) -> str:
    """Format a Python float list as the halfvec text representation.

    pgvector accepts ``'[0.1,0.2,...]'`` as the cast input for halfvec/vector.
    Using repr is correct for IEEE-754 doubles; halfvec silently truncates
    to 16-bit on the server.
    """
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


SHABAD_UPSERT = """
INSERT INTO public.shabads (
    shabad_id, gurmukhi, gurmukhi_display, transliteration,
    translation_bms, ang, author, raag, line_count
) VALUES (
    %(shabad_id)s, %(gurmukhi)s, %(gurmukhi_display)s, %(transliteration)s,
    %(translation_bms)s, %(ang)s, %(author)s, %(raag)s, %(line_count)s
)
ON CONFLICT (shabad_id) DO UPDATE SET
    gurmukhi         = EXCLUDED.gurmukhi,
    gurmukhi_display = EXCLUDED.gurmukhi_display,
    transliteration  = EXCLUDED.transliteration,
    translation_bms  = EXCLUDED.translation_bms,
    ang              = EXCLUDED.ang,
    author           = EXCLUDED.author,
    raag             = EXCLUDED.raag,
    line_count       = EXCLUDED.line_count,
    updated_at       = now();
"""

EMBEDDING_UPSERT = """
INSERT INTO public.shabad_embeddings (shabad_id, embedding_english)
VALUES (%(shabad_id)s, %(embedding_english)s::halfvec)
ON CONFLICT (shabad_id) DO UPDATE SET
    embedding_english = EXCLUDED.embedding_english,
    created_at        = now();
"""


def _db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        raise SystemExit(
            "SUPABASE_DB_URL is required. Get it from Supabase dashboard → "
            "Project Settings → Database → Connection string (URI, Transaction pooler)."
        )
    return url


def apply_migration(conn: psycopg.Connection, migration_path: Path) -> None:
    """Execute the migration SQL. Idempotent — the file uses IF NOT EXISTS."""
    logger.info("applying migration: %s", migration_path)
    sql = migration_path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    logger.info("migration applied")


def seed_shabads(conn: psycopg.Connection, shabads_path: Path) -> int:
    n = 0
    for batch in _chunks(_iter_jsonl(shabads_path), BATCH_SIZE_SHABADS):
        rows = []
        for rec in batch:
            rows.append({
                "shabad_id": str(rec["shabad_id"]),
                "gurmukhi": rec.get("gurmukhi") or "",
                "gurmukhi_display": rec.get("gurmukhi_display") or rec.get("gurmukhi") or "",
                "transliteration": rec.get("transliteration") or "",
                "translation_bms": rec.get("translation_bms") or "",
                "ang": int(rec.get("ang") or 0),
                "author": rec.get("author") or "",
                "raag": rec.get("raag") or "",
                "line_count": int(rec.get("line_count") or 1),
            })
        with conn.cursor() as cur:
            cur.executemany(SHABAD_UPSERT, rows)
        conn.commit()
        n += len(rows)
        logger.info("shabads upserted: %d so far", n)
    return n


def seed_embeddings(conn: psycopg.Connection, embeddings_path: Path) -> int:
    n = 0
    for batch in _chunks(_iter_jsonl(embeddings_path), BATCH_SIZE_EMBEDDINGS):
        rows = []
        for rec in batch:
            sid = str(rec["shabad_id"])
            vec = rec.get("embedding_english") or []
            if len(vec) != 1024:
                raise SeedError(
                    f"embedding for shabad_id={sid} has {len(vec)} dims, expected 1024"
                )
            rows.append({
                "shabad_id": sid,
                "embedding_english": _halfvec_literal(vec),
            })
        with conn.cursor() as cur:
            cur.executemany(EMBEDDING_UPSERT, rows)
        conn.commit()
        n += len(rows)
        logger.info("embeddings upserted: %d so far", n)
    return n


def _validate_inputs(shabads_path: Path, embeddings_path: Path) -> dict[str, int]:
    """Run a dry-pass so errors surface before we touch the DB."""
    shabad_ids: set[str] = set()
    for rec in _iter_jsonl(shabads_path):
        sid = str(rec.get("shabad_id") or "")
        if not sid:
            raise SeedError(f"empty shabad_id in {shabads_path}")
        shabad_ids.add(sid)
    embed_ids: set[str] = set()
    for rec in _iter_jsonl(embeddings_path):
        sid = str(rec.get("shabad_id") or "")
        if not sid:
            raise SeedError(f"empty shabad_id in {embeddings_path}")
        vec = rec.get("embedding_english") or []
        if len(vec) != 1024:
            raise SeedError(
                f"embedding row for {sid} has dim {len(vec)}; expected 1024"
            )
        embed_ids.add(sid)
    orphans = embed_ids - shabad_ids
    if orphans:
        raise SeedError(
            f"{len(orphans)} embedding rows reference shabad_ids not in the "
            f"corpus file (first 5: {sorted(orphans)[:5]})"
        )
    missing_embeddings = shabad_ids - embed_ids
    if missing_embeddings:
        logger.warning(
            "%d shabads have no embeddings (first 5: %s) — they will be "
            "inserted without a row in shabad_embeddings",
            len(missing_embeddings),
            sorted(missing_embeddings)[:5],
        )
    return {
        "shabads": len(shabad_ids),
        "embeddings": len(embed_ids),
        "missing_embeddings": len(missing_embeddings),
    }


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose >= 2
        else logging.INFO if args.verbose >= 1
        else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if not args.shabads.exists():
        raise SystemExit(f"missing {args.shabads}. Run fetch_corpus.py first.")
    if not args.embeddings.exists() and not args.dry_run:
        logger.warning(
            "embeddings file %s not found — seeding shabads table only",
            args.embeddings,
        )

    summary = _validate_inputs(args.shabads, args.embeddings if args.embeddings.exists() else args.shabads)
    logger.warning("input summary: %s", summary)

    if args.dry_run:
        logger.warning("dry-run complete; no DB writes performed")
        return 0

    url = _db_url()
    logger.info("connecting to Supabase DB")
    with psycopg.connect(url) as conn:
        if args.migrate:
            apply_migration(conn, args.migration)
        n_shabads = seed_shabads(conn, args.shabads)
        n_embeddings = 0
        if args.embeddings.exists():
            n_embeddings = seed_embeddings(conn, args.embeddings)
    logger.warning(
        "seed done: shabads=%d embeddings=%d", n_shabads, n_embeddings,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
