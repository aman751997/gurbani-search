"""Pure-function tests for seed_supabase.py. DB connection is NOT exercised
here — that's integration-tested against a real Supabase project in U4's
post-seed verification step."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import seed_supabase as seed


def _write_jsonl(path: Path, rows):
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def test_halfvec_literal_roundtrip():
    lit = seed._halfvec_literal([0.1, 0.2, -0.3])
    assert lit.startswith("[")
    assert lit.endswith("]")
    # JSON-parse it back (pgvector uses a JSON-compatible syntax for the
    # text input form) and the round-trip preserves values.
    parsed = json.loads(lit)
    assert parsed == pytest.approx([0.1, 0.2, -0.3])


def test_chunks():
    out = list(seed._chunks([1, 2, 3, 4, 5], 2))
    assert out == [[1, 2], [3, 4], [5]]
    assert list(seed._chunks([], 10)) == []


def test_iter_jsonl_raises_on_bad_line(tmp_path):
    p = tmp_path / "bad.jsonl"
    p.write_text(
        '{"ok": 1}\nnot json at all\n',
        encoding="utf-8",
    )
    with pytest.raises(seed.SeedError):
        list(seed._iter_jsonl(p))


def test_validate_inputs_happy_path(tmp_path):
    s = tmp_path / "s.jsonl"
    e = tmp_path / "e.jsonl"
    _write_jsonl(s, [
        {"shabad_id": "1"}, {"shabad_id": "2"},
    ])
    _write_jsonl(e, [
        {"shabad_id": "1", "embedding_english": [0.0] * 1024},
        {"shabad_id": "2", "embedding_english": [0.0] * 1024},
    ])
    summary = seed._validate_inputs(s, e)
    assert summary["shabads"] == 2
    assert summary["embeddings"] == 2
    assert summary["missing_embeddings"] == 0


def test_validate_inputs_rejects_orphan_embedding(tmp_path):
    s = tmp_path / "s.jsonl"
    e = tmp_path / "e.jsonl"
    _write_jsonl(s, [{"shabad_id": "1"}])
    _write_jsonl(e, [
        {"shabad_id": "1", "embedding_english": [0.0] * 1024},
        {"shabad_id": "99", "embedding_english": [0.0] * 1024},
    ])
    with pytest.raises(seed.SeedError) as ei:
        seed._validate_inputs(s, e)
    assert "embedding rows reference shabad_ids not in" in str(ei.value)


def test_validate_inputs_rejects_wrong_embedding_dim(tmp_path):
    s = tmp_path / "s.jsonl"
    e = tmp_path / "e.jsonl"
    _write_jsonl(s, [{"shabad_id": "1"}])
    _write_jsonl(e, [{"shabad_id": "1", "embedding_english": [0.0] * 100}])
    with pytest.raises(seed.SeedError):
        seed._validate_inputs(s, e)


def test_validate_inputs_warns_on_missing_embeddings(tmp_path, caplog):
    import logging
    s = tmp_path / "s.jsonl"
    e = tmp_path / "e.jsonl"
    _write_jsonl(s, [{"shabad_id": "1"}, {"shabad_id": "2"}])
    _write_jsonl(e, [{"shabad_id": "1", "embedding_english": [0.0] * 1024}])
    with caplog.at_level(logging.WARNING):
        summary = seed._validate_inputs(s, e)
    assert summary["missing_embeddings"] == 1
    assert any("have no embeddings" in r.getMessage() for r in caplog.records)


def test_db_url_missing_raises_system_exit(monkeypatch):
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    with pytest.raises(SystemExit):
        seed._db_url()


def test_db_url_present_returns_trimmed(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", "  postgresql://x  ")
    assert seed._db_url() == "postgresql://x"
