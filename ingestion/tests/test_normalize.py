"""Unit tests for ingest/normalize.py."""
from __future__ import annotations

import pytest

from ingest.normalize import (
    GURMUKHI_RE_HI,
    GURMUKHI_RE_LO,
    assemble_shabad,
    clean_display_gurmukhi,
    clean_gurmukhi,
    clean_translation,
    collapse_whitespace,
    contains_gurmukhi,
    nfc,
    normalize_verse,
    validate_shabad,
)


# ---------- nfc ----------

def test_nfc_none_and_empty():
    assert nfc(None) == ""
    assert nfc("") == ""


def test_nfc_is_idempotent_and_stable_for_gurmukhi():
    # Gurmukhi precomposed glyphs are on the Unicode Composition Exclusion
    # list, so NFC(ਖ਼) stays as base+nukta rather than composing to U+0A59.
    # What we care about is (a) idempotence, and (b) consistency — the
    # same logical glyph always lands on the same byte sequence. Both
    # hold here.
    decomposed = "\u0A16\u0A3C"   # ਖ + ਼
    composed = "\u0A59"            # ਖ਼ precomposed
    # Running both through NFC lands them at the SAME byte sequence.
    assert nfc(decomposed) == nfc(composed)
    # Idempotent.
    assert nfc(nfc(decomposed)) == nfc(decomposed)


def test_nfc_coerces_non_str():
    class S:
        def __str__(self) -> str:
            return "hello"

    assert nfc(S()) == "hello"


# ---------- whitespace + cleaners ----------

def test_collapse_whitespace():
    assert collapse_whitespace("  a   b\n\tc  ") == "a b c"
    assert collapse_whitespace("") == ""


def test_clean_gurmukhi_nfc_and_whitespace():
    # Messy whitespace collapses; NFC is applied (and idempotent).
    src_txt = "  \u0A16\u0A3C   ਸਤਿ  ਨਾਮੁ\n "
    out = clean_gurmukhi(src_txt)
    assert "  " not in out
    # Starts with the base khakha + nukta sequence after NFC (composition
    # excluded per Unicode).
    assert out.startswith("\u0A16\u0A3C")
    # Idempotent.
    assert clean_gurmukhi(out) == out


def test_clean_display_gurmukhi_matches_clean_today():
    # The plan reserves divergence for when visraam markers land inline.
    # Today the functions agree; pin that behavior so a change is a
    # conscious edit of both function + test.
    src = "ਸਤਿ  ਨਾਮੁ"
    assert clean_display_gurmukhi(src) == clean_gurmukhi(src)


def test_clean_translation():
    assert clean_translation("  The   Name\tIs Truth. ") == "The Name Is Truth."
    assert clean_translation(None) == ""


# ---------- gurmukhi codepoint detection ----------

def test_contains_gurmukhi_positive():
    assert contains_gurmukhi("ਸਤਿ")
    # Boundary: exactly at the low and high codepoints.
    assert contains_gurmukhi(chr(GURMUKHI_RE_LO))
    assert contains_gurmukhi(chr(GURMUKHI_RE_HI))


def test_contains_gurmukhi_negative():
    assert not contains_gurmukhi("")
    assert not contains_gurmukhi("Hello, world!")
    assert not contains_gurmukhi(chr(GURMUKHI_RE_LO - 1))
    assert not contains_gurmukhi(chr(GURMUKHI_RE_HI + 1))


# ---------- verse normalization ----------

def _fake_verse(**overrides):
    base = {
        "shabadId": 1,
        "verse": {"unicode": "ੴ ਸਤਿ ਨਾਮੁ"},
        "transliteration": {"en": "ikOankaar sat naam", "english": "ignored"},
        "translation": {
            "en": {
                "bdb": "BDB translation",
                "ms": "Bhai Manmohan Singh translation",
                "ssk": "Sant Singh Khalsa translation",
            },
        },
        "pageNo": 1,
        "lineNo": 1,
        "writer": {"english": "Guru Nanak Dev Ji"},
        "raag": {"english": "Jap"},
    }
    base.update(overrides)
    return base


def test_normalize_verse_happy_path():
    v = _fake_verse()
    rec = normalize_verse(v)
    assert rec["shabad_id"] == "1"
    assert rec["gurmukhi"].startswith("ੴ")
    assert rec["gurmukhi_display"] == rec["gurmukhi"]
    assert rec["transliteration"] == "ikOankaar sat naam"
    assert rec["translation_bms"] == "Bhai Manmohan Singh translation"
    assert rec["ang"] == 1
    assert rec["author"] == "Guru Nanak Dev Ji"
    assert rec["raag"] == "Jap"


def test_normalize_verse_prefers_ms_translation():
    v = _fake_verse(translation={"en": {"bdb": "BDB", "ms": "MS", "ssk": "SSK"}})
    assert normalize_verse(v)["translation_bms"] == "MS"


def test_normalize_verse_handles_missing_translation_gracefully():
    v = _fake_verse(translation={"en": {}})
    # Missing MS must yield "" rather than raising or substituting BDB.
    assert normalize_verse(v)["translation_bms"] == ""


def test_normalize_verse_handles_missing_metadata():
    v = _fake_verse(writer=None, raag=None, pageNo=None)
    rec = normalize_verse(v)
    assert rec["author"] == ""
    assert rec["raag"] == ""
    assert rec["ang"] == 0


def test_normalize_verse_string_pageno():
    assert normalize_verse(_fake_verse(pageNo="7"))["ang"] == 7
    assert normalize_verse(_fake_verse(pageNo="not-a-number"))["ang"] == 0


# ---------- shabad assembly ----------

def _verse_record(**overrides):
    """Build a normalized verse record directly (skips normalize_verse)."""
    base = {
        "shabad_id": "42",
        "gurmukhi": "",
        "gurmukhi_display": "",
        "transliteration": "",
        "translation_bms": "",
        "ang": 100,
        "author": "Guru Nanak Dev Ji",
        "raag": "Jap",
    }
    base.update(overrides)
    return base


def test_assemble_shabad_joins_in_line_order():
    v1 = _verse_record(gurmukhi="ਸਤਿ", gurmukhi_display="ਸਤਿ",
                       transliteration="sat", translation_bms="Truth",
                       ang=5)
    v2 = _verse_record(gurmukhi="ਨਾਮੁ", gurmukhi_display="ਨਾਮੁ",
                       transliteration="naam", translation_bms="Name",
                       ang=6)
    # Intentionally reversed — assembler should order by lineNo/insertion.
    shabad = assemble_shabad("42", [
        {**v2, "lineNo_not_used": True},  # No lineNo → falls back to 0
        {**v1, "lineNo_not_used": True},
    ])
    # With both missing lineNo they sort stably by 0 → input order; so we
    # pass them both without lineNo and expect input order (v2, v1).
    assert shabad["gurmukhi"] == "ਨਾਮੁ ਸਤਿ"


def test_assemble_shabad_uses_lineno_when_present():
    v1 = _verse_record(gurmukhi="ਸਤਿ", translation_bms="Truth", ang=5)
    v2 = _verse_record(gurmukhi="ਨਾਮੁ", translation_bms="Name", ang=6)
    # Attach lineNos: v2 has lineNo=1, v1 has lineNo=2 → output order v2,v1.
    shabad = assemble_shabad("42", [
        {**v1, "lineNo": 2},
        {**v2, "lineNo": 1},
    ])
    assert shabad["gurmukhi"] == "ਨਾਮੁ ਸਤਿ"
    assert shabad["translation_bms"] == "Name Truth"


def test_assemble_shabad_picks_minimum_ang_across_multi_ang():
    v_late = _verse_record(shabad_id="7", gurmukhi="A", translation_bms="A", ang=10, lineNo=1)
    v_early = _verse_record(shabad_id="7", gurmukhi="B", translation_bms="B", ang=9, lineNo=2)
    v_very_early = _verse_record(shabad_id="7", gurmukhi="C", translation_bms="C", ang=8, lineNo=3)
    shabad = assemble_shabad("7", [v_late, v_early, v_very_early])
    assert shabad["ang"] == 8


def test_assemble_shabad_line_count():
    vs = [_verse_record(shabad_id="x", gurmukhi=f"v{i}", translation_bms=f"v{i}", ang=1,
                        lineNo=i) for i in range(1, 5)]
    assert assemble_shabad("x", vs)["line_count"] == 4


def test_assemble_shabad_drops_foreign_shabad_ids():
    vs = [
        _verse_record(shabad_id="x", gurmukhi="A", translation_bms="A",
                      ang=1, lineNo=1),
        _verse_record(shabad_id="y", gurmukhi="B", translation_bms="B",
                      ang=1, lineNo=2),
    ]
    shabad = assemble_shabad("x", vs)
    assert shabad["gurmukhi"] == "A"
    assert shabad["line_count"] == 1


def test_assemble_shabad_raises_when_no_matching_verses():
    with pytest.raises(ValueError):
        assemble_shabad("nope", [_verse_record(shabad_id="x")])


def test_assemble_shabad_first_non_empty_metadata():
    vs = [
        _verse_record(gurmukhi="A", translation_bms="A", ang=1, author="",
                      raag="", lineNo=1),
        _verse_record(gurmukhi="B", translation_bms="B", ang=1,
                      author="Guru Arjan Dev Ji", raag="Bilaaval", lineNo=2),
    ]
    shabad = assemble_shabad("42", vs)
    assert shabad["author"] == "Guru Arjan Dev Ji"
    assert shabad["raag"] == "Bilaaval"


# ---------- validation ----------

def _valid_shabad(**overrides):
    base = {
        "shabad_id": "1",
        "gurmukhi": "ਸਤਿ ਨਾਮੁ",
        "gurmukhi_display": "ਸਤਿ ਨਾਮੁ",
        "transliteration": "sat naam",
        "translation_bms": "Truth is His Name.",
        "ang": 1,
        "author": "Guru Nanak Dev Ji",
        "raag": "Jap",
        "line_count": 1,
    }
    base.update(overrides)
    return base


def test_validate_shabad_happy_path_empty_list():
    assert validate_shabad(_valid_shabad()) == []


def test_validate_shabad_rejects_missing_fields():
    problems = validate_shabad(_valid_shabad(shabad_id=None, gurmukhi="",
                                             translation_bms=""))
    joined = " | ".join(problems)
    assert "shabad_id" in joined
    assert "gurmukhi" in joined
    assert "translation_bms" in joined


@pytest.mark.parametrize("ang", [-1, 0, 1431, "one", None])
def test_validate_shabad_rejects_bad_ang(ang):
    # SGGS angs are 1..1430 inclusive. 0 is treated as the missing-sentinel
    # (_ang_of returns 0 when the upstream pageNo is missing) and must be
    # rejected rather than silently accepted.
    problems = validate_shabad(_valid_shabad(ang=ang))
    assert any("ang" in p for p in problems), (
        f"expected an ang-related problem for ang={ang!r}, got {problems}"
    )


def test_validate_shabad_rejects_gurmukhi_in_translation():
    # Simulates an upstream schema swap bug.
    bad = _valid_shabad(translation_bms="ਸਤਿ ਨਾਮੁ Truth")
    problems = validate_shabad(bad)
    assert any("translation_bms contains Gurmukhi" in p for p in problems)


def test_validate_shabad_rejects_zero_line_count():
    problems = validate_shabad(_valid_shabad(line_count=0))
    assert any("line_count" in p for p in problems)
