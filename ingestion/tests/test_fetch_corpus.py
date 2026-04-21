"""End-to-end tests for fetch_corpus.py with BaniDB fully mocked.

These are the happy-path + edge-case unit tests for U2's CLI. The real
BaniDB API is never contacted.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

import pytest

import fetch_corpus


def _fake_ang_iter(pairs: list[tuple[int, str]]):
    """Build a callable matching the ang_iterator signature."""
    def _iter(*, session=None, start_ang=1, end_ang=9999, sleep=None):
        yield from pairs
    return _iter


def _fake_shabad(shabad_id: str, ang: int = 1, lines: int = 2):
    """Build a BaniDB-shaped shabad response for N verses on the given Ang."""
    verses = []
    for i in range(1, lines + 1):
        verses.append({
            "shabadId": shabad_id,
            "verse": {"unicode": f"ਸਤਿ {i}"},
            "transliteration": {"en": f"sat {i}"},
            "translation": {"en": {"ms": f"Truth is His Name line {i}."}},
            "pageNo": ang,
            "lineNo": i,
            "writer": {"english": "Guru Nanak Dev Ji"},
            "raag": {"english": "Jap"},
        })
    return {"verses": verses}


def _make_fetcher(registry: dict[str, dict[str, Any]]):
    def _fetch(sid: str, *, session=None, sleep=None):
        if sid not in registry:
            raise KeyError(sid)
        return registry[sid]
    return _fetch


def test_fetch_corpus_happy_path_writes_jsonl(tmp_path: Path):
    out = tmp_path / "shabads.jsonl"
    ang_iter = _fake_ang_iter([(1, "1"), (1, "2"), (2, "3")])
    fetcher = _make_fetcher({
        "1": _fake_shabad("1", ang=1, lines=2),
        "2": _fake_shabad("2", ang=1, lines=3),
        "3": _fake_shabad("3", ang=2, lines=1),
    })
    summary = fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=ang_iter,
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    assert summary == {"written": 3, "skipped_resume": 0, "invalid": 0}
    lines = out.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 3
    first = json.loads(lines[0])
    # Field-level contract.
    for k in ("shabad_id", "gurmukhi", "gurmukhi_display", "transliteration",
              "translation_bms", "ang", "author", "raag", "line_count"):
        assert k in first, f"missing key {k}"
    assert first["shabad_id"] == "1"
    assert first["line_count"] == 2
    assert first["author"] == "Guru Nanak Dev Ji"


def test_fetch_corpus_collapses_multi_ang_to_min(tmp_path: Path):
    # shabad "9" has verses across two angs — expect min ang = 10.
    multi = {
        "shabadId": "9",
        "verse": {"unicode": "ਕ"},
        "transliteration": {"en": "k"},
        "translation": {"en": {"ms": "piece"}},
        "writer": {"english": "Guru Nanak Dev Ji"},
        "raag": {"english": "Jap"},
    }
    verses = [
        {**multi, "pageNo": 11, "lineNo": 2},
        {**multi, "pageNo": 10, "lineNo": 1},
    ]
    fetcher = _make_fetcher({"9": {"verses": verses}})
    out = tmp_path / "shabads.jsonl"
    fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=_fake_ang_iter([(10, "9")]),
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    rec = json.loads(out.read_text(encoding="utf-8").splitlines()[0])
    assert rec["ang"] == 10
    assert rec["line_count"] == 2


def test_fetch_corpus_resume_skips_existing(tmp_path: Path):
    out = tmp_path / "shabads.jsonl"
    # Seed the file with one existing record.
    out.write_text(json.dumps({"shabad_id": "1"}) + "\n", encoding="utf-8")
    ang_iter = _fake_ang_iter([(1, "1"), (1, "2")])
    fetcher = _make_fetcher({
        "1": _fake_shabad("1"),
        "2": _fake_shabad("2"),
    })
    summary = fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        resume=True,
        ang_iterator=ang_iter,
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    assert summary["skipped_resume"] == 1
    assert summary["written"] == 1
    # File now has two records.
    assert len(out.read_text(encoding="utf-8").splitlines()) == 2


def test_fetch_corpus_limit_stops_early(tmp_path: Path):
    out = tmp_path / "shabads.jsonl"
    ang_iter = _fake_ang_iter([(1, str(i)) for i in range(1, 11)])
    fetcher = _make_fetcher({str(i): _fake_shabad(str(i)) for i in range(1, 11)})
    summary = fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        limit=3,
        ang_iterator=ang_iter,
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    assert summary["written"] == 3


def test_fetch_corpus_invalid_source_exits(tmp_path: Path):
    with pytest.raises(SystemExit):
        fetch_corpus.fetch_corpus(
            source="garbage",
            out_path=tmp_path / "x.jsonl",
            ang_iterator=_fake_ang_iter([]),
            shabad_fetcher=_make_fetcher({}),
            session_factory=lambda: object(),
            sleep=lambda w: None,
        )


def test_fetch_corpus_skips_shabads_missing_verses(tmp_path: Path):
    out = tmp_path / "shabads.jsonl"
    fetcher = _make_fetcher({
        "1": {"verses": []},
        "2": _fake_shabad("2"),
    })
    summary = fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=_fake_ang_iter([(1, "1"), (1, "2")]),
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    assert summary["invalid"] == 1
    assert summary["written"] == 1


def test_fetch_corpus_skips_shabad_with_neither_ms_nor_ssk(tmp_path: Path):
    # A shabad that has only ``bdb`` (Bhai Dharam Singh Bhalla, a minor
    # translator we don't accept) and neither ``ms`` nor ``ssk`` must be
    # dropped. This mirrors the real-world edge case on shabad 2032 that
    # motivated the fallback cascade in the first place — if both accepted
    # translators are missing we'd rather skip than silently show bdb.
    bad_verse = {
        "shabadId": "x",
        "verse": {"unicode": "ਸਤਿ"},
        "transliteration": {"en": "sat"},
        "translation": {"en": {"bdb": "BDB only"}},
        "pageNo": 1,
        "lineNo": 1,
        "writer": {"english": "Guru Nanak Dev Ji"},
        "raag": {"english": "Jap"},
    }
    fetcher = _make_fetcher({"x": {"verses": [bad_verse]}})
    out = tmp_path / "shabads.jsonl"
    summary = fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=_fake_ang_iter([(1, "x")]),
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    assert summary["invalid"] == 1
    assert summary["written"] == 0


def test_fetch_corpus_writes_shabad_when_only_ssk_available(tmp_path: Path):
    # The real reason we rewrote the parser: ~4% of shabads on BaniDB have
    # no ``ms`` entry but do have ``ssk``. Those shabads must now land in
    # the output JSONL (they were silently skipped by the old validator).
    verse = {
        "shabadId": "42",
        "verse": {"unicode": "ਸਤਿ ਨਾਮੁ"},
        "transliteration": {"en": "sat naam"},
        "translation": {"en": {"ssk": "Truth is His Name. (SSK)"}},
        "pageNo": 1,
        "lineNo": 1,
        "writer": {"english": "Guru Nanak Dev Ji"},
        "raag": {"english": "Jap"},
    }
    fetcher = _make_fetcher({"42": {"verses": [verse]}})
    out = tmp_path / "shabads.jsonl"
    summary = fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=_fake_ang_iter([(1, "42")]),
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    assert summary["written"] == 1
    assert summary["invalid"] == 0
    rec = json.loads(out.read_text(encoding="utf-8").splitlines()[0])
    assert rec["translation_bms"] == "Truth is His Name. (SSK)"
    assert rec["translation_source"] == "ssk"


def test_fetch_corpus_prefers_ms_when_both_present(tmp_path: Path):
    # Regression guard: when both ms and ssk are available, ms wins and the
    # attribution is "ms". Protects against someone accidentally flipping
    # the cascade order.
    verse = {
        "shabadId": "7",
        "verse": {"unicode": "ਸਤਿ"},
        "transliteration": {"en": "sat"},
        "translation": {"en": {"ms": "BMS text", "ssk": "SSK text"}},
        "pageNo": 1,
        "lineNo": 1,
        "writer": {"english": "Guru Nanak Dev Ji"},
        "raag": {"english": "Jap"},
    }
    fetcher = _make_fetcher({"7": {"verses": [verse]}})
    out = tmp_path / "shabads.jsonl"
    fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=_fake_ang_iter([(1, "7")]),
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    rec = json.loads(out.read_text(encoding="utf-8").splitlines()[0])
    assert rec["translation_bms"] == "BMS text"
    assert rec["translation_source"] == "ms"


def test_fetch_corpus_fetch_error_counts_invalid(tmp_path: Path):
    out = tmp_path / "shabads.jsonl"

    def _boom(sid, *, session=None, sleep=None):
        from ingest.sources import FetchError
        raise FetchError("simulated outage")

    summary = fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=_fake_ang_iter([(1, "1")]),
        shabad_fetcher=_boom,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    assert summary["invalid"] == 1
    assert summary["written"] == 0


def test_cli_rejects_bogus_source_via_argparse(capsys):
    with pytest.raises(SystemExit):
        fetch_corpus._parse_args(["--source", "bogus"])
    err = capsys.readouterr().err
    assert "invalid choice" in err or "choose from" in err


def test_fetch_corpus_pulls_metadata_from_shabadinfo(tmp_path: Path):
    """The /v2/shabads/:id endpoint (used by the live fetcher) carries
    writer + raag on `shabadInfo` while leaving them off each verse.
    fetch_corpus must fall back to shabadInfo so the output record still
    has non-empty author/raag."""
    # Build a verse that has NO writer/raag on it (simulating the shabad
    # endpoint shape).
    bare_verse = {
        "shabadId": "42",
        "verse": {"unicode": "ਸਤਿ"},
        "transliteration": {"en": "sat"},
        "translation": {"en": {"ms": "Truth."}},
        "pageNo": 1,
        "lineNo": 1,
    }
    shabad_info = {
        "shabadId": 42,
        "writer": {"english": "Guru Amar Das Ji"},
        "raag": {"english": "Aasaa"},
    }
    fetcher = _make_fetcher({
        "42": {"shabadInfo": shabad_info, "verses": [bare_verse]},
    })
    out = tmp_path / "shabads.jsonl"
    summary = fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=_fake_ang_iter([(1, "42")]),
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    assert summary["written"] == 1
    rec = json.loads(out.read_text(encoding="utf-8").splitlines()[0])
    assert rec["author"] == "Guru Amar Das Ji"
    assert rec["raag"] == "Aasaa"


def test_fetch_corpus_verse_writer_wins_over_shabadinfo(tmp_path: Path):
    """If a verse already carries writer/raag (the /angs endpoint shape),
    we MUST NOT overwrite it with shabadInfo. Verse-level metadata is
    the more specific record."""
    verse_with_meta = {
        "shabadId": "42",
        "verse": {"unicode": "ਸਤਿ"},
        "transliteration": {"en": "sat"},
        "translation": {"en": {"ms": "Truth."}},
        "pageNo": 1,
        "lineNo": 1,
        "writer": {"english": "Verse-level Author"},
        "raag": {"english": "Verse-level Raag"},
    }
    shabad_info = {
        "writer": {"english": "Shabad-level Author"},
        "raag": {"english": "Shabad-level Raag"},
    }
    fetcher = _make_fetcher({
        "42": {"shabadInfo": shabad_info, "verses": [verse_with_meta]},
    })
    out = tmp_path / "shabads.jsonl"
    fetch_corpus.fetch_corpus(
        source="sttm-desktop",
        out_path=out,
        ang_iterator=_fake_ang_iter([(1, "42")]),
        shabad_fetcher=fetcher,
        session_factory=lambda: object(),
        sleep=lambda w: None,
    )
    rec = json.loads(out.read_text(encoding="utf-8").splitlines()[0])
    assert rec["author"] == "Verse-level Author"
    assert rec["raag"] == "Verse-level Raag"
