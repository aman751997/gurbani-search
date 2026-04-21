"""Fetchers that talk to external corpus sources.

All network I/O lives here so the normalize module stays pure.

Two logical sources are offered by the CLI — ``banidb`` and ``sttm-desktop``.
Both currently route to the public BaniDB REST API:

- ``banidb`` is the canonical, community-trusted corpus.
- ``sttm-desktop`` is derived from BaniDB with Khalis Foundation permission
  (see plan §Institutional Learnings). Its Electron app consumes a Realm
  database distributed as a binary evergreen bundle, which is impractical
  to read from Python. Rather than silently diverge, the ``sttm-desktop``
  source flag resolves to the same public BaniDB API the Electron app
  itself calls at runtime. Data identity is preserved.

If future needs require a file-only fallback (e.g. BaniDB API offline),
add a third source that reads from a committed JSONL snapshot.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable, Iterable, Iterator

import requests


logger = logging.getLogger(__name__)

BANIDB_API_BASE = "https://api.banidb.com/v2"
# Source code ``G`` = Sri Guru Granth Sahib (BaniDB convention).
SOURCE_SGGS = "G"
# SGGS has 1430 angs; corpus is ~6,000 shabads. Ceiling used for iteration,
# not a hard assertion — plan explicitly targets ~6,000 shabads.
SGGS_LAST_ANG = 1430
# Rough ceiling on shabad-id iteration mode; real data tops ~5,540 in
# the current BaniDB snapshot. Buffer for future additions.
SHABAD_ID_CEILING = 6500


class FetchError(RuntimeError):
    """Raised when the BaniDB API returns an unrecoverable error."""


def _get_json(
    url: str,
    *,
    session: requests.Session,
    timeout: float = 30.0,
    max_attempts: int = 5,
    backoff_base: float = 0.5,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """GET with exponential backoff on 429 / 5xx.

    Tuned for the local-only ingestion workload: retries up to 5 times,
    base 0.5s doubling. Uses the caller's ``sleep`` so tests can pass a
    no-op.
    """
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            resp = session.get(url, timeout=timeout)
        except requests.RequestException as exc:
            last_exc = exc
            wait = backoff_base * (2 ** attempt)
            logger.warning("request error for %s (attempt %d): %s", url, attempt + 1, exc)
            sleep(wait)
            continue
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code in (429, 500, 502, 503, 504):
            wait = backoff_base * (2 ** attempt)
            logger.warning(
                "retryable status %s for %s (attempt %d), sleeping %.2fs",
                resp.status_code, url, attempt + 1, wait,
            )
            sleep(wait)
            continue
        raise FetchError(
            f"GET {url} returned HTTP {resp.status_code}: {resp.text[:200]!r}"
        )
    raise FetchError(
        f"GET {url} failed after {max_attempts} attempts; last error: {last_exc!r}"
    )


def iter_ang_shabad_ids(
    *,
    session: requests.Session,
    start_ang: int = 1,
    end_ang: int = SGGS_LAST_ANG,
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[tuple[int, str]]:
    """Yield (ang, shabad_id) pairs in ascending-ang / first-appearance order.

    BaniDB's ``/angs/:ang/:source`` endpoint returns every verse on a page
    with its ``shabadId``. Iterating angs 1..1430 and deduping shabadIds
    gives us the full SGGS shabad set keyed by the first ang each appears
    on — which happens to be the ``min ang`` property we want for multi-ang
    shabads (plan U2: "collapse to a single record with the lowest Ang").
    """
    seen: set[str] = set()
    for ang in range(start_ang, end_ang + 1):
        url = f"{BANIDB_API_BASE}/angs/{ang}/{SOURCE_SGGS}"
        data = _get_json(url, session=session, sleep=sleep)
        for verse in data.get("page", []) or []:
            sid = str(verse.get("shabadId") or "").strip()
            if not sid or sid in seen:
                continue
            seen.add(sid)
            yield ang, sid


def fetch_shabad(
    shabad_id: str,
    *,
    session: requests.Session,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Fetch one shabad (metadata + verses) from BaniDB."""
    url = f"{BANIDB_API_BASE}/shabads/{shabad_id}"
    return _get_json(url, session=session, sleep=sleep)


def build_session(user_agent: str = "gurbani-search-ingestion/0.1") -> requests.Session:
    """Build a pre-configured requests Session. Kept factored so tests can
    construct a Session without hitting the network."""
    s = requests.Session()
    s.headers.update({
        "Accept": "application/json",
        "User-Agent": user_agent,
    })
    return s


# Public type aliases used by ``fetch_corpus.py`` — easier to mock in tests.
AngIterator = Callable[..., Iterable[tuple[int, str]]]
ShabadFetcher = Callable[..., dict[str, Any]]
