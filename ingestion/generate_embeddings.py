#!/usr/bin/env python3
"""Embed ``shabads.jsonl`` into ``embeddings.jsonl`` via Cloudflare BGE-M3.

Usage:

    # Full run (6k shabads, fits free tier):
    python generate_embeddings.py

    # Dev run (first 50 shabads):
    python generate_embeddings.py --limit 50

    # Restart after interruption (skips shabad_ids already embedded):
    python generate_embeddings.py
    # (resume is automatic — output is append-only and the script checks
    # which shabad_ids are already written before each batch.)

Output: one JSON object per line in ``ingestion/out/embeddings.jsonl``:

    {"shabad_id": "42", "embedding_english": [0.123, ...1024 floats...]}

The vector is the BGE-M3 embedding of the shabad's ``translation_bms``
field (the Bhai Manmohan Singh English translation). Per plan U3, this is
the SINGLE VIEW baseline; a second Gurmukhi view is added only if eval
demands it.

Checkpointing: the output file is flushed every batch. If the script is
killed between batches, re-running resumes from where it stopped.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterator

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from ingest.embeddings import (  # noqa: E402
    DEFAULT_BATCH_SIZE,
    EMBED_DIM,
    MAX_BATCH_TOKENS,
    EmbeddingError,
    embed_batch,
    pack_by_budget,
    truncate_for_embed,
)


logger = logging.getLogger("generate_embeddings")

DEFAULT_IN = _HERE / "out" / "shabads.jsonl"
DEFAULT_OUT = _HERE / "out" / "embeddings.jsonl"
CHECKPOINT_EVERY_BATCHES = 1  # flush after every batch — file stays consistent


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--in", dest="in_path", type=Path, default=DEFAULT_IN,
                   help=f"shabads.jsonl input (default {DEFAULT_IN})")
    p.add_argument("--out", dest="out_path", type=Path, default=DEFAULT_OUT,
                   help=f"embeddings.jsonl output (default {DEFAULT_OUT})")
    p.add_argument("--limit", type=int, default=0,
                   help="stop after N new shabads (0 = no limit)")
    p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                   help=f"inputs per Cloudflare call (default {DEFAULT_BATCH_SIZE})")
    p.add_argument("--verbose", "-v", action="count", default=0,
                   help="-v = INFO, -vv = DEBUG")
    return p.parse_args(argv)


def _load_shabads(in_path: Path) -> list[dict[str, Any]]:
    """Read shabads.jsonl into memory. The corpus is ~6k rows so this is fine."""
    rows: list[dict[str, Any]] = []
    with in_path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                logger.error("bad JSONL at line %d of %s: %s", i, in_path, exc)
                continue
    return rows


def _already_embedded(out_path: Path) -> set[str]:
    """Return the set of shabad_ids that already have a row in out_path."""
    if not out_path.exists():
        return set()
    seen: set[str] = set()
    with out_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            sid = obj.get("shabad_id")
            if sid:
                seen.add(str(sid))
    return seen


def _pending_rows(
    rows: list[dict[str, Any]], already: set[str], limit: int
) -> list[dict[str, Any]]:
    """Filter out rows that already have embeddings, optionally capped at ``limit``."""
    pending = [
        r for r in rows
        if r.get("shabad_id") and str(r["shabad_id"]) not in already
    ]
    if limit and limit > 0:
        pending = pending[:limit]
    return pending


def _text_for(row: dict[str, Any]) -> str:
    """Return the text to embed for one shabad.

    Plan U3: single-view baseline, embed ``translation_bms`` only.
    """
    return (row.get("translation_bms") or "").strip()


def _env_creds() -> tuple[str, str]:
    acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    tok = os.environ.get("CLOUDFLARE_AI_API_TOKEN", "").strip()
    if not acct or not tok:
        raise SystemExit(
            "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_API_TOKEN must be set. "
            "Populate .env.local and `set -a; source .env.local; set +a`."
        )
    return acct, tok


def generate_embeddings(
    *,
    in_path: Path,
    out_path: Path,
    batch_size: int = DEFAULT_BATCH_SIZE,
    limit: int = 0,
    # Injectable seams for testing:
    embedder: Callable[..., list[list[float]]] | None = None,
    creds_loader: Callable[[], tuple[str, str]] = _env_creds,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, int]:
    """Run the embedding pass. Returns a summary counts dict.

    ``embedder`` defaults to the real Cloudflare client; tests can pass a
    stub that returns deterministic vectors.
    """
    rows = _load_shabads(in_path)
    already = _already_embedded(out_path)
    pending = _pending_rows(rows, already, limit)

    if not pending:
        logger.info("nothing to embed; already-embedded=%d total=%d",
                    len(already), len(rows))
        return {"written": 0, "already": len(already), "total": len(rows),
                "skipped_empty": 0, "batches": 0}

    acct, tok = creds_loader()
    do_embed = embedder or (
        lambda texts: embed_batch(
            texts, account_id=acct, api_token=tok, sleep=sleep,
        )
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    skipped_empty = 0
    truncated = 0
    batches = 0
    flushed_since_checkpoint = 0

    # Pre-filter empty rows and truncate over-long texts so the packer's
    # token-budget math reflects what will actually be sent to Cloudflare.
    prepared: list[tuple[dict[str, Any], str]] = []
    for row in pending:
        text = _text_for(row)
        if not text:
            logger.warning(
                "skipping shabad %s: empty translation_bms",
                row.get("shabad_id"),
            )
            skipped_empty += 1
            continue
        truncated_text = truncate_for_embed(text)
        if truncated_text != text:
            truncated += 1
            logger.warning(
                "truncated shabad %s: %d -> %d chars (BGE-M3 8k-token cap)",
                row.get("shabad_id"), len(text), len(truncated_text),
            )
        prepared.append((row, truncated_text))

    with out_path.open("a", encoding="utf-8") as f_out:
        batches_list = pack_by_budget(
            prepared,
            text_of=lambda pair: pair[1],
            max_items=batch_size,
            max_tokens=MAX_BATCH_TOKENS,
        )
        for batch_idx, batch in enumerate(batches_list):
            good_rows = [row for row, _ in batch]
            texts = [text for _, text in batch]
            if not texts:
                continue
            try:
                vectors = do_embed(texts)
            except EmbeddingError as exc:
                logger.error(
                    "batch %d/%d failed after retries: %s — aborting so a later "
                    "re-run can pick up where we stopped",
                    batch_idx + 1, len(batches_list), exc,
                )
                break
            if len(vectors) != len(good_rows):
                raise EmbeddingError(
                    f"embedder returned {len(vectors)} vectors for "
                    f"{len(good_rows)} inputs"
                )
            for row, vec in zip(good_rows, vectors):
                rec = {
                    "shabad_id": str(row["shabad_id"]),
                    "embedding_english": vec,
                }
                f_out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                written += 1
            batches += 1
            flushed_since_checkpoint += len(good_rows)
            # Checkpoint every 500 shabads (plan U3).
            if flushed_since_checkpoint >= 500:
                f_out.flush()
                os.fsync(f_out.fileno())
                flushed_since_checkpoint = 0
                logger.info("checkpoint: wrote %d embeddings so far", written)
            else:
                # Cheap per-batch flush so a kill mid-run still leaves
                # a consistent, resumable file.
                f_out.flush()

    return {
        "written": written,
        "already": len(already),
        "total": len(rows),
        "skipped_empty": skipped_empty,
        "truncated": truncated,
        "batches": batches,
    }


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    level = logging.WARNING
    if args.verbose >= 2:
        level = logging.DEBUG
    elif args.verbose >= 1:
        level = logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    summary = generate_embeddings(
        in_path=args.in_path,
        out_path=args.out_path,
        batch_size=args.batch_size,
        limit=args.limit,
    )
    logger.warning(
        "embedding summary: written=%d already=%d total=%d skipped_empty=%d truncated=%d batches=%d out=%s",
        summary["written"], summary["already"], summary["total"],
        summary["skipped_empty"], summary["truncated"], summary["batches"],
        args.out_path,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
