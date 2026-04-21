#!/usr/bin/env python3
"""Fetch the SGGS corpus and write shabad-level JSONL.

Usage:

    python fetch_corpus.py --source sttm-desktop
    python fetch_corpus.py --source banidb --limit 50
    python fetch_corpus.py --source sttm-desktop --resume

Output:
    ingestion/out/shabads.jsonl  (one JSON object per shabad, NFC normalized)

Both ``--source`` values currently resolve to the public BaniDB REST API.
See ``ingest/sources.py`` for the reasoning.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

# Allow ``python fetch_corpus.py`` from anywhere via absolute imports.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from ingest.normalize import (  # noqa: E402
    assemble_shabad,
    normalize_verse,
    validate_shabad,
)
from ingest.sources import (  # noqa: E402
    FetchError,
    SGGS_LAST_ANG,
    build_session,
    fetch_shabad,
    iter_ang_shabad_ids,
)


logger = logging.getLogger("fetch_corpus")

DEFAULT_OUT = _HERE / "out" / "shabads.jsonl"
VALID_SOURCES = ("banidb", "sttm-desktop")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--source",
        choices=VALID_SOURCES,
        default="sttm-desktop",
        help="corpus source (default: sttm-desktop). Both resolve to the "
             "public BaniDB REST API; see ingest/sources.py.",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"output JSONL path (default: {DEFAULT_OUT})",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=0,
        help="stop after N shabads; 0 = no limit (dev-run knob)",
    )
    p.add_argument(
        "--start-ang",
        type=int,
        default=1,
        help="first Ang to scan (1..1430)",
    )
    p.add_argument(
        "--end-ang",
        type=int,
        default=SGGS_LAST_ANG,
        help="last Ang to scan (inclusive)",
    )
    p.add_argument(
        "--resume",
        action="store_true",
        help="skip shabad_ids already present in --out; append new records",
    )
    p.add_argument(
        "--verbose", "-v",
        action="count",
        default=0,
        help="-v = INFO, -vv = DEBUG",
    )
    return p.parse_args(argv)


def _already_written(out_path: Path) -> set[str]:
    """Return the set of shabad_ids already present in out_path (or empty)."""
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
                logger.warning("skipping malformed JSONL line in %s", out_path)
                continue
            sid = obj.get("shabad_id")
            if sid:
                seen.add(str(sid))
    return seen


def _open_append(out_path: Path) -> "Any":
    out_path.parent.mkdir(parents=True, exist_ok=True)
    return out_path.open("a", encoding="utf-8")


def fetch_corpus(
    *,
    source: str,
    out_path: Path,
    limit: int = 0,
    start_ang: int = 1,
    end_ang: int = SGGS_LAST_ANG,
    resume: bool = False,
    # Injectable seams for testing:
    ang_iterator: Callable[..., Iterable[tuple[int, str]]] | None = None,
    shabad_fetcher: Callable[..., dict[str, Any]] | None = None,
    session_factory: Callable[[], Any] = build_session,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, int]:
    """Fetch and write the corpus. Returns summary counts dict.

    ``source`` is accepted and validated but both values route through the
    same BaniDB public API today. Kept as a surface for future sources.
    """
    if source not in VALID_SOURCES:
        raise SystemExit(f"invalid --source {source!r}; must be one of {VALID_SOURCES}")

    ang_iter = ang_iterator or iter_ang_shabad_ids
    fetch_one = shabad_fetcher or fetch_shabad
    session = session_factory()

    already = _already_written(out_path) if resume else set()
    if already:
        logger.info("resume mode: %d shabad_ids already in %s", len(already), out_path)

    written = skipped_existing = invalid = 0
    try:
        with _open_append(out_path) as f_out:
            for ang, sid in ang_iter(
                session=session,
                start_ang=start_ang,
                end_ang=end_ang,
                sleep=sleep,
            ):
                if sid in already:
                    skipped_existing += 1
                    continue
                try:
                    raw = fetch_one(sid, session=session, sleep=sleep)
                except FetchError as exc:
                    logger.error("failed to fetch shabad %s: %s", sid, exc)
                    invalid += 1
                    continue
                verses = raw.get("verses") or []
                if not verses:
                    logger.warning("shabad %s has no verses; skipping", sid)
                    invalid += 1
                    continue
                # /v2/shabads/:id returns writer + raag on `shabadInfo`, NOT
                # on each verse. /v2/angs/:ang/:source returns them per-verse.
                # Merge shabadInfo fallback in before normalization so both
                # endpoint shapes yield identical records.
                shabad_info = raw.get("shabadInfo") or {}
                si_writer = shabad_info.get("writer")
                si_raag = shabad_info.get("raag")
                for v in verses:
                    if not v.get("writer") and si_writer:
                        v["writer"] = si_writer
                    if not v.get("raag") and si_raag:
                        v["raag"] = si_raag
                norm_verses = [normalize_verse(v) for v in verses]
                # Overwrite shabad_id on each verse to the requested sid — BaniDB
                # occasionally returns verses with slightly different id typing
                # (str vs int); force consistency before assembly.
                for nv in norm_verses:
                    nv["shabad_id"] = str(sid)
                shabad = assemble_shabad(str(sid), norm_verses)
                problems = validate_shabad(shabad)
                if problems:
                    logger.warning(
                        "shabad %s failed validation: %s", sid, "; ".join(problems)
                    )
                    invalid += 1
                    continue
                f_out.write(json.dumps(shabad, ensure_ascii=False) + "\n")
                f_out.flush()
                written += 1
                if written % 100 == 0:
                    logger.info(
                        "wrote %d shabads (ang=%d, sid=%s)", written, ang, sid
                    )
                if limit and written >= limit:
                    logger.info("reached --limit=%d; stopping", limit)
                    break
    finally:
        close = getattr(session, "close", None)
        if callable(close):
            try:
                close()
            except Exception:  # pragma: no cover — defensive
                pass

    return {
        "written": written,
        "skipped_resume": skipped_existing,
        "invalid": invalid,
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
    summary = fetch_corpus(
        source=args.source,
        out_path=args.out,
        limit=args.limit,
        start_ang=args.start_ang,
        end_ang=args.end_ang,
        resume=args.resume,
    )
    logger.warning(
        "ingestion summary: written=%d skipped_resume=%d invalid=%d out=%s",
        summary["written"], summary["skipped_resume"], summary["invalid"], args.out,
    )
    # Exit non-zero only if we explicitly asked for new work and got none.
    # A resume-pass with nothing to do is still a success.
    if args.limit > 0 and summary["written"] == 0 and summary["skipped_resume"] == 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
