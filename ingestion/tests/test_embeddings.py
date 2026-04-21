"""Tests for ingest/embeddings.py. Zero real network calls."""
from __future__ import annotations

import math
from typing import Any

import pytest
import requests

from ingest import embeddings


class _FakeResp:
    def __init__(self, status: int, payload: Any = None, text: str = ""):
        self.status_code = status
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


def _record_sleep():
    waits: list[float] = []
    return (lambda w: waits.append(w)), waits


def test_l2_normalize_unit_norm():
    v = [3.0, 4.0, 0.0]
    out = embeddings.l2_normalize(v)
    assert math.isclose(math.sqrt(sum(x * x for x in out)), 1.0)
    assert math.isclose(out[0], 0.6)
    assert math.isclose(out[1], 0.8)


def test_l2_normalize_zero_vector_returns_copy():
    v = [0.0, 0.0, 0.0]
    out = embeddings.l2_normalize(v)
    assert out == v
    # Returns a copy, not the same object.
    out.append(1.0)
    assert len(v) == 3


def test_l2_normalize_idempotent_for_unit_vec():
    v = [1.0, 0.0, 0.0]
    assert embeddings.l2_normalize(v) == [1.0, 0.0, 0.0]


def test_chunked_basic():
    assert embeddings.chunked([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
    assert embeddings.chunked([], 3) == []
    assert embeddings.chunked([1], 10) == [[1]]


def test_chunked_rejects_nonpositive_size():
    with pytest.raises(ValueError):
        embeddings.chunked([1, 2], 0)


def _ok_payload(n: int, dim: int = embeddings.EMBED_DIM) -> dict[str, Any]:
    # Vectors of length 1 along the first axis, zero elsewhere — after
    # normalization each stays a unit vector, so tests can assert that
    # easily.
    vecs = []
    for _ in range(n):
        v = [0.0] * dim
        v[0] = 1.0
        vecs.append(v)
    return {
        "success": True, "errors": [], "messages": [],
        "result": {"data": vecs, "shape": [n, dim], "pooling": "cls"},
    }


def test_embed_batch_happy_path():
    sleep, waits = _record_sleep()
    calls: list[dict[str, Any]] = []

    def fake_post(url, *, headers, json, timeout):
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return _FakeResp(200, _ok_payload(len(json["text"])))

    out = embeddings.embed_batch(
        ["hello", "world"],
        account_id="acct",
        api_token="tok",
        http_post=fake_post,
        sleep=sleep,
    )
    assert len(out) == 2
    assert len(out[0]) == embeddings.EMBED_DIM
    # Normalized.
    assert math.isclose(math.sqrt(sum(x * x for x in out[0])), 1.0)
    # URL is the expected Workers-AI endpoint for the account.
    assert calls[0]["url"] == (
        "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/baai/bge-m3"
    )
    assert calls[0]["headers"]["Authorization"] == "Bearer tok"
    assert waits == []


def test_embed_batch_empty_input_skips_http():
    calls = []

    def fake_post(*a, **kw):
        calls.append(1)
        raise AssertionError("must not call HTTP for empty input")

    assert embeddings.embed_batch(
        [], account_id="a", api_token="t", http_post=fake_post
    ) == []


def test_embed_batch_retries_on_429_then_succeeds():
    sleep, waits = _record_sleep()
    responses = [
        _FakeResp(429, text="slow down"),
        _FakeResp(200, _ok_payload(1)),
    ]

    def fake_post(*a, **kw):
        return responses.pop(0)

    out = embeddings.embed_batch(
        ["x"], account_id="a", api_token="t",
        backoff_base=0.01, max_attempts=3,
        http_post=fake_post, sleep=sleep,
    )
    assert len(out) == 1
    assert waits == [0.01]


def test_embed_batch_retries_5xx_then_gives_up():
    sleep, _ = _record_sleep()
    responses = [_FakeResp(503, text="unavailable")] * 4

    def fake_post(*a, **kw):
        return responses.pop(0) if responses else _FakeResp(503, text="unavailable")

    with pytest.raises(embeddings.EmbeddingError):
        embeddings.embed_batch(
            ["x"], account_id="a", api_token="t",
            backoff_base=0.001, max_attempts=3,
            http_post=fake_post, sleep=sleep,
        )


def test_embed_batch_raises_on_non_retryable_4xx():
    def fake_post(*a, **kw):
        return _FakeResp(401, text="unauthorized")

    with pytest.raises(embeddings.EmbeddingError) as ei:
        embeddings.embed_batch(
            ["x"], account_id="a", api_token="t",
            http_post=fake_post, sleep=lambda w: None,
        )
    assert "401" in str(ei.value)


def test_embed_batch_raises_on_success_false_payload():
    def fake_post(*a, **kw):
        return _FakeResp(200, {"success": False, "errors": [{"message": "nope"}]})

    with pytest.raises(embeddings.EmbeddingError):
        embeddings.embed_batch(
            ["x"], account_id="a", api_token="t",
            http_post=fake_post, sleep=lambda w: None,
        )


def test_embed_batch_raises_on_vector_count_mismatch():
    # Input length 2, returns 1 vector → mismatch.
    def fake_post(*a, **kw):
        return _FakeResp(200, _ok_payload(1))

    with pytest.raises(embeddings.EmbeddingError):
        embeddings.embed_batch(
            ["x", "y"], account_id="a", api_token="t",
            http_post=fake_post, sleep=lambda w: None,
        )


def test_embed_batch_raises_on_wrong_vector_dim():
    # 2-dim vectors returned when 1024 are expected.
    def fake_post(*a, **kw):
        return _FakeResp(200, {
            "success": True, "errors": [], "messages": [],
            "result": {"data": [[1.0, 2.0]], "shape": [1, 2], "pooling": "cls"},
        })

    with pytest.raises(embeddings.EmbeddingError):
        embeddings.embed_batch(
            ["x"], account_id="a", api_token="t",
            http_post=fake_post, sleep=lambda w: None,
        )


def test_embed_batch_retries_on_network_exception():
    sleep, waits = _record_sleep()
    calls = [0]

    def fake_post(*a, **kw):
        calls[0] += 1
        if calls[0] == 1:
            raise requests.ConnectionError("down")
        return _FakeResp(200, _ok_payload(1))

    out = embeddings.embed_batch(
        ["x"], account_id="a", api_token="t",
        backoff_base=0.001, max_attempts=3,
        http_post=fake_post, sleep=sleep,
    )
    assert len(out) == 1
    assert len(waits) == 1
