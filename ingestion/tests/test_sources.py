"""Tests for ingest/sources.py. The HTTP layer is mocked via a fake
requests.Session — no network access."""
from __future__ import annotations

from typing import Any

import pytest

from ingest import sources


class _FakeResp:
    def __init__(self, status: int, payload: Any = None, text: str = ""):
        self.status_code = status
        self._payload = payload
        self.text = text or (str(payload) if payload else "")

    def json(self):
        return self._payload


class _FakeSession:
    """Minimal requests.Session stand-in that returns queued responses."""

    def __init__(self, queue: list[_FakeResp]):
        self._queue = list(queue)
        self.calls: list[str] = []

    def get(self, url: str, timeout: float = 0):
        self.calls.append(url)
        if not self._queue:
            raise AssertionError(f"unexpected GET {url} (queue empty)")
        return self._queue.pop(0)

    def close(self):
        pass


def _record_sleep():
    """Returns (sleep_fn, waits_list) — fn records each wait-duration."""
    waits: list[float] = []

    def _sleep(w: float) -> None:
        waits.append(w)

    return _sleep, waits


def test_get_json_200_returns_payload():
    sess = _FakeSession([_FakeResp(200, {"ok": True})])
    sleep, waits = _record_sleep()
    out = sources._get_json("https://example.test/x", session=sess, sleep=sleep)
    assert out == {"ok": True}
    assert waits == []  # no retries on a clean 200


def test_get_json_retries_on_429_then_succeeds():
    sess = _FakeSession([
        _FakeResp(429, text="slow down"),
        _FakeResp(429, text="slow down"),
        _FakeResp(200, {"ok": True}),
    ])
    sleep, waits = _record_sleep()
    out = sources._get_json("https://example.test/x", session=sess, sleep=sleep,
                            max_attempts=5, backoff_base=0.1)
    assert out == {"ok": True}
    # Two retries → two sleeps with exponential backoff.
    assert waits == [0.1, 0.2]


def test_get_json_retries_on_5xx_then_fails():
    sess = _FakeSession([
        _FakeResp(500, text="server ded"),
        _FakeResp(502, text="bad gateway"),
        _FakeResp(503, text="unavailable"),
    ])
    sleep, _ = _record_sleep()
    with pytest.raises(sources.FetchError):
        sources._get_json("https://example.test/x", session=sess, sleep=sleep,
                          max_attempts=3, backoff_base=0.01)


def test_get_json_4xx_other_than_429_raises_immediately():
    sess = _FakeSession([_FakeResp(404, text="not found")])
    sleep, _ = _record_sleep()
    with pytest.raises(sources.FetchError):
        sources._get_json("https://example.test/x", session=sess, sleep=sleep)
    # A single attempt — no retries for non-retryable 4xx.
    assert len(sess.calls) == 1


def test_iter_ang_shabad_ids_dedupes_and_preserves_first_ang():
    # Ang 1 emits shabads 1,2,3. Ang 2 emits 3 (duplicate) and 4. We should
    # see 1,2,3,4 in order and only once each.
    ang_payloads = {
        1: {"page": [
            {"shabadId": 1}, {"shabadId": 1}, {"shabadId": 2}, {"shabadId": 3}
        ]},
        2: {"page": [
            {"shabadId": 3}, {"shabadId": 4}
        ]},
    }
    responses = [_FakeResp(200, ang_payloads[1]), _FakeResp(200, ang_payloads[2])]
    sess = _FakeSession(responses)
    sleep, _ = _record_sleep()
    pairs = list(sources.iter_ang_shabad_ids(
        session=sess, start_ang=1, end_ang=2, sleep=sleep,
    ))
    assert pairs == [(1, "1"), (1, "2"), (1, "3"), (2, "4")]


def test_iter_ang_shabad_ids_skips_missing_shabadid():
    ang_payload = {"page": [
        {"shabadId": None}, {"shabadId": ""}, {"shabadId": 7}
    ]}
    sess = _FakeSession([_FakeResp(200, ang_payload)])
    sleep, _ = _record_sleep()
    pairs = list(sources.iter_ang_shabad_ids(
        session=sess, start_ang=1, end_ang=1, sleep=sleep,
    ))
    assert pairs == [(1, "7")]


def test_fetch_shabad_hits_expected_url():
    sess = _FakeSession([_FakeResp(200, {"verses": []})])
    sleep, _ = _record_sleep()
    sources.fetch_shabad("123", session=sess, sleep=sleep)
    assert sess.calls == ["https://api.banidb.com/v2/shabads/123"]


def test_build_session_sets_headers():
    s = sources.build_session(user_agent="test-agent/0.0")
    assert s.headers["User-Agent"] == "test-agent/0.0"
    assert s.headers["Accept"] == "application/json"
