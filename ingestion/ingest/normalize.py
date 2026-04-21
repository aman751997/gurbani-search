"""Pure normalization functions for SGGS corpus ingestion.

Every function here is deterministic, side-effect-free, and covered by
pytest. Side-effects (HTTP, filesystem) live in ``sources.py``.

Field contract for one shabad record (used by ``fetch_corpus.py``):

    {
      "shabad_id":        str,        # canonical BaniDB shabadId as string
      "gurmukhi":         str,        # NFC unicode, clean — for embedding + BM25
      "gurmukhi_display": str,        # NFC unicode, for UI (may carry vishraam)
      "transliteration":  str,        # Roman transliteration (BaniDB `en` field)
      "translation_bms":  str,        # Bhai Manmohan Singh English translation
      "ang":              int,        # lowest Ang (page) number for the shabad
      "author":           str,        # English writer name, e.g. "Guru Nanak Dev Ji"
      "raag":             str,        # English raag name, e.g. "Jap"
      "line_count":       int,        # number of verses in the shabad
    }

The ``translation_bms`` field is required. The U6 substring guard checks
captions against this text only; see plan §Key Technical Decisions.
"""
from __future__ import annotations

import unicodedata
from typing import Any, Iterable


# Unicode Gurmukhi block: U+0A00–U+0A7F. Used both by the Gurmukhi-character
# guard in U6 and by defensive sanity checks here.
GURMUKHI_RE_LO = 0x0A00
GURMUKHI_RE_HI = 0x0A7F


def nfc(text: str | None) -> str:
    """Return NFC-normalized string. ``None`` and non-str collapse to ``""``.

    NFC matters because the corpus contains composed + decomposed forms of
    the same glyph in different verses; cosine-similarity drift at embed
    time is silent and painful to debug later.
    """
    if not text:
        return ""
    if not isinstance(text, str):
        text = str(text)
    return unicodedata.normalize("NFC", text)


def collapse_whitespace(text: str) -> str:
    """Collapse runs of whitespace to single spaces, strip ends.

    Applied to Gurmukhi + translation joined forms before embedding so the
    same verse text with different whitespace hashes to the same vector.
    """
    return " ".join((text or "").split())


def contains_gurmukhi(text: str) -> bool:
    """Return True if any codepoint is in the Gurmukhi Unicode block."""
    if not text:
        return False
    return any(GURMUKHI_RE_LO <= ord(c) <= GURMUKHI_RE_HI for c in text)


def clean_gurmukhi(text: str | None) -> str:
    """Prepare a Gurmukhi verse string for EMBEDDING / BM25.

    Steps: NFC, collapse whitespace. Visraam markers are structural (carried
    as positions in a sibling field on BaniDB, not as inline characters in
    the unicode string), so there is nothing to strip today. If a future
    source interleaves inline markers, add the stripping here and bump the
    tests in ``test_normalize.py``.
    """
    return collapse_whitespace(nfc(text))


def clean_display_gurmukhi(text: str | None) -> str:
    """Prepare a Gurmukhi verse string for UI DISPLAY.

    Identical to ``clean_gurmukhi`` for the current BaniDB source — the
    unicode strings don't carry inline vishraam. The distinct function
    exists so a later sibling of this module can re-inject visraam markers
    (from the BaniDB ``visraam`` positions) without touching the clean
    path used by the embedder.
    """
    return collapse_whitespace(nfc(text))


def clean_translation(text: str | None) -> str:
    """Prepare a translation string for storage + embedding.

    The translation goes into the English embedding vector AND is the
    target of the U6 substring guard, so we want stable whitespace + NFC
    without touching the words themselves.
    """
    return collapse_whitespace(nfc(text))


def _ang_of(raw_verse: dict[str, Any]) -> int:
    """Extract Ang as int from a BaniDB verse dict. Missing → 0 so
    ``min()`` still sorts correctly."""
    pn = raw_verse.get("pageNo")
    if pn is None:
        return 0
    try:
        return int(pn)
    except (TypeError, ValueError):
        return 0


def _writer_english(raw_verse: dict[str, Any]) -> str:
    w = raw_verse.get("writer") or {}
    return (w.get("english") or "").strip()


def _raag_english(raw_verse: dict[str, Any]) -> str:
    r = raw_verse.get("raag") or {}
    return (r.get("english") or "").strip()


def _translation_bms(raw_verse: dict[str, Any]) -> str:
    tr = raw_verse.get("translation") or {}
    en = tr.get("en") or {}
    # Bhai Manmohan Singh is keyed as ``ms`` in the BaniDB response schema.
    # Fall back to other English keys only if ms is absent — but we record
    # this with an empty string rather than silently substituting, so the
    # caller can filter/alert.
    return (en.get("ms") or "").strip()


def _transliteration(raw_verse: dict[str, Any]) -> str:
    tl = raw_verse.get("transliteration") or {}
    return (tl.get("en") or tl.get("english") or "").strip()


def _gurmukhi_unicode(raw_verse: dict[str, Any]) -> str:
    v = raw_verse.get("verse") or {}
    return (v.get("unicode") or "").strip()


def normalize_verse(raw_verse: dict[str, Any]) -> dict[str, Any]:
    """Normalize one BaniDB verse dict into a flat record.

    Kept separate from shabad assembly so we can unit-test the field
    extraction in isolation.
    """
    return {
        "shabad_id": str(raw_verse.get("shabadId")),
        "gurmukhi": clean_gurmukhi(_gurmukhi_unicode(raw_verse)),
        "gurmukhi_display": clean_display_gurmukhi(_gurmukhi_unicode(raw_verse)),
        "transliteration": clean_translation(_transliteration(raw_verse)),
        "translation_bms": clean_translation(_translation_bms(raw_verse)),
        "ang": _ang_of(raw_verse),
        "author": _writer_english(raw_verse),
        "raag": _raag_english(raw_verse),
    }


def assemble_shabad(shabad_id: str, verses: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Collapse an iterable of verse-records into a single shabad record.

    Multi-Ang shabads: ``ang`` is the MINIMUM Ang number across the verse
    set (per plan U2 spec).

    The shabad's joined Gurmukhi / translation / transliteration is a
    whitespace-delimited concatenation in verse order. No LLM or rewriting.
    """
    vs = [v for v in verses if v and v.get("shabad_id") == shabad_id]
    if not vs:
        raise ValueError(f"no verses for shabad_id={shabad_id!r}")

    # BaniDB returns verses in canonical lineNo order inside a shabad; keep
    # that order explicitly to avoid relying on the source's iteration.
    # We sort by a stable integer-y key without mutating the caller's list.
    def _line_key(v: dict[str, Any]) -> tuple[int, int]:
        # Fall back to insertion order via a second component if lineNo is missing.
        try:
            return (int(v.get("lineNo") or 0), 0)
        except (TypeError, ValueError):
            return (0, 0)

    vs_sorted = sorted(vs, key=_line_key)

    # First non-empty author/raag wins. They should be identical across
    # verses of the same shabad on BaniDB, but sources sometimes emit None
    # on a stray verse.
    def _first(field: str) -> str:
        for v in vs_sorted:
            val = v.get(field)
            if val:
                return val
        return ""

    gurmukhi = collapse_whitespace(" ".join(v["gurmukhi"] for v in vs_sorted))
    gurmukhi_display = collapse_whitespace(
        " ".join(v["gurmukhi_display"] for v in vs_sorted)
    )
    transliteration = collapse_whitespace(
        " ".join(v["transliteration"] for v in vs_sorted)
    )
    translation_bms = collapse_whitespace(
        " ".join(v["translation_bms"] for v in vs_sorted)
    )
    ang = min((v["ang"] for v in vs_sorted if v["ang"]), default=0)

    return {
        "shabad_id": shabad_id,
        "gurmukhi": gurmukhi,
        "gurmukhi_display": gurmukhi_display,
        "transliteration": transliteration,
        "translation_bms": translation_bms,
        "ang": ang,
        "author": _first("author"),
        "raag": _first("raag"),
        "line_count": len(vs_sorted),
    }


def validate_shabad(record: dict[str, Any]) -> list[str]:
    """Return a list of human-readable issues with a shabad record.

    Empty list = record is valid. Called by the CLI before writing JSONL.
    """
    problems: list[str] = []
    sid = record.get("shabad_id")
    if not sid:
        problems.append("missing shabad_id")
    if not record.get("gurmukhi"):
        problems.append("empty gurmukhi")
    if not record.get("translation_bms"):
        problems.append("empty translation_bms (Bhai Manmohan Singh)")
    ang = record.get("ang")
    if isinstance(ang, bool) or not isinstance(ang, int) or ang < 1 or ang > 1430:
        problems.append(f"ang out of SGGS range: {ang!r}")
    if not isinstance(record.get("line_count"), int) or record["line_count"] < 1:
        problems.append("line_count must be >= 1")
    # Sanity: translation_bms must not contain Gurmukhi codepoints. If it
    # does, something upstream swapped the language fields.
    if contains_gurmukhi(record.get("translation_bms", "")):
        problems.append("translation_bms contains Gurmukhi codepoints")
    return problems
