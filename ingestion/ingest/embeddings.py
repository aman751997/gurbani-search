"""Cloudflare Workers AI BGE-M3 client + pure embedding utilities.

All network I/O goes through ``embed_batch`` which accepts an injectable
``http_post`` so tests can mock the API completely.
"""
from __future__ import annotations

import logging
import math
import time
from typing import Any, Callable

import requests


logger = logging.getLogger(__name__)

# The BGE-M3 model on Cloudflare Workers AI. Dense vectors are 1024-dim.
MODEL = "@cf/baai/bge-m3"
EMBED_DIM = 1024
# Cloudflare's BGE-M3 endpoint accepts a ``text`` array. The sweet spot
# between batch efficiency and request timeout is 32 inputs per request —
# but Cloudflare enforces a HARD 60,000-token *total* context budget across
# every item in the batch. A naive batch of 32 long shabad translations
# trips that limit, so the runner uses ``pack_by_budget`` to size batches
# dynamically by estimated token count and still caps at ``DEFAULT_BATCH_SIZE``.
DEFAULT_BATCH_SIZE = 32

# Cloudflare's observed combined-context cap is 60,000 tokens across the
# whole batch; keep a 5k-token safety margin for tokenizer drift and
# request overhead. Calibration — a 36,215-char batch of Bhai Manmohan
# Singh translations tokenized to ~88,416 tokens (≈2.44 tok/char), which
# is ~6x higher than the usual English ratio. The BMS text includes
# archaic English spellings, hyphenated compound forms, and occasional
# transliteration marks that sentencepiece BPE fragments aggressively.
# ``CHARS_PER_TOKEN=0.35`` (≈2.86 tokens/char) bakes in a ~17% safety
# margin over the observed ratio, so MAX_BATCH_TOKENS=55,000 caps a
# batch at ≈19,250 characters — comfortably under the 60k-token limit.
MAX_BATCH_TOKENS = 55_000
CHARS_PER_TOKEN = 0.35
# Per-text truncation cap. BGE-M3's own context window is 8192 tokens;
# at the observed 2.44 tok/char ratio that's ≈3350 chars. We truncate at
# 3200 chars to leave headroom for special/CLS tokens and ensure no
# single item is ever rejected by the model. Only a handful of SGGS
# shabads (out of ~5535) exceed this threshold; they are long prose
# passages where the tail contributes little retrievable signal.
MAX_TEXT_CHARS = 3200
# Kept for backward-compat with the test suite; derived from the char cap.
MAX_INPUT_TOKENS = int(MAX_TEXT_CHARS / CHARS_PER_TOKEN)


class EmbeddingError(RuntimeError):
    """Raised when the Cloudflare API returns an unrecoverable error."""


def cf_url(account_id: str) -> str:
    """Construct the Workers AI run endpoint URL for BGE-M3."""
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
        f"/ai/run/{MODEL}"
    )


def _default_http_post(
    url: str,
    *,
    headers: dict[str, str],
    json: dict[str, Any],
    timeout: float,
) -> requests.Response:
    return requests.post(url, headers=headers, json=json, timeout=timeout)


def l2_normalize(vec: list[float]) -> list[float]:
    """Return a cosine-normalized (unit-length) copy of vec.

    BGE-M3 already returns L2-normalized vectors in practice, but the plan
    requires we guarantee ``|v| ≈ 1``. Renormalizing a nearly-unit vector
    is numerically stable and cheap.
    """
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0:
        # Degenerate input — return as-is rather than nan-propagating.
        return list(vec)
    inv = 1.0 / norm
    return [x * inv for x in vec]


def _parse_response(payload: dict[str, Any], expected_n: int) -> list[list[float]]:
    """Extract N 1024-dim vectors from a Workers AI response payload."""
    if not isinstance(payload, dict) or not payload.get("success"):
        errs = payload.get("errors") if isinstance(payload, dict) else None
        raise EmbeddingError(f"Cloudflare responded with success=false: {errs!r}")
    res = payload.get("result") or {}
    data = res.get("data")
    if not isinstance(data, list):
        raise EmbeddingError(f"unexpected response shape: result.data is not a list")
    if len(data) != expected_n:
        raise EmbeddingError(
            f"expected {expected_n} vectors, got {len(data)}"
        )
    for i, v in enumerate(data):
        if not isinstance(v, list) or len(v) != EMBED_DIM:
            raise EmbeddingError(
                f"vector {i} has wrong shape: "
                f"type={type(v).__name__} len={len(v) if hasattr(v,'__len__') else 'n/a'}"
            )
    return data


def embed_batch(
    inputs: list[str],
    *,
    account_id: str,
    api_token: str,
    max_attempts: int = 5,
    backoff_base: float = 0.5,
    timeout: float = 30.0,
    http_post: Callable[..., Any] = _default_http_post,
    sleep: Callable[[float], None] = time.sleep,
) -> list[list[float]]:
    """Embed one batch of strings. Returns cosine-normalized vectors.

    Exponential backoff on 429 and 5xx up to ``max_attempts`` tries.
    Raises ``EmbeddingError`` on permanent failure.
    """
    if not inputs:
        return []
    url = cf_url(account_id)
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }
    body = {"text": inputs}

    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            resp = http_post(url, headers=headers, json=body, timeout=timeout)
        except requests.RequestException as exc:
            last_exc = exc
            wait = backoff_base * (2 ** attempt)
            logger.warning("embed request error (attempt %d): %s", attempt + 1, exc)
            sleep(wait)
            continue
        status = getattr(resp, "status_code", None)
        if status == 200:
            payload = resp.json()
            vectors = _parse_response(payload, expected_n=len(inputs))
            return [l2_normalize(v) for v in vectors]
        if status in (429, 500, 502, 503, 504):
            wait = backoff_base * (2 ** attempt)
            body_preview = getattr(resp, "text", "")[:200]
            logger.warning(
                "embed retryable status %s (attempt %d), sleeping %.2fs — body=%r",
                status, attempt + 1, wait, body_preview,
            )
            sleep(wait)
            continue
        # Non-retryable: abort immediately with context.
        body_preview = getattr(resp, "text", "")[:500]
        raise EmbeddingError(
            f"Cloudflare returned HTTP {status}: {body_preview!r}"
        )
    raise EmbeddingError(
        f"embed failed after {max_attempts} attempts; last error: {last_exc!r}"
    )


def chunked(seq: list[Any], size: int) -> list[list[Any]]:
    """Split ``seq`` into sequential chunks of at most ``size`` items."""
    if size < 1:
        raise ValueError("chunk size must be >= 1")
    return [seq[i : i + size] for i in range(0, len(seq), size)]


def estimate_tokens(text: str) -> int:
    """Cheap char-count-based token estimate for batch-packing.

    Real BGE-M3 tokenization would require shipping the tokenizer; the
    Cloudflare endpoint enforces the real limit, so this only needs to be
    conservatively correct. Rounding up on short strings avoids zero-token
    items packing infinitely.
    """
    if not text:
        return 0
    return max(1, int(len(text) / CHARS_PER_TOKEN) + 1)


def truncate_for_embed(text: str, *, max_chars: int = MAX_TEXT_CHARS) -> str:
    """Hard-cap a single input text to ``max_chars`` characters.

    BGE-M3 truncates silently past its 8192-token context window. Doing
    it explicitly here keeps the batch packer's budget math consistent
    and makes truncation visible in ingest logs. A ``max_chars`` value
    of 0 disables truncation.
    """
    if not text or max_chars <= 0:
        return text
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def pack_by_budget(
    items: list[Any],
    text_of: Callable[[Any], str],
    *,
    max_tokens: int = MAX_BATCH_TOKENS,
    max_items: int = DEFAULT_BATCH_SIZE,
) -> list[list[Any]]:
    """Group ``items`` into batches that stay under both a token and item cap.

    Each item's token count is estimated via ``estimate_tokens(text_of(item))``.
    A single item that alone exceeds ``max_tokens`` is emitted as its own
    one-element batch — the caller is responsible for truncating upstream.
    """
    if max_tokens < 1:
        raise ValueError("max_tokens must be >= 1")
    if max_items < 1:
        raise ValueError("max_items must be >= 1")
    batches: list[list[Any]] = []
    cur: list[Any] = []
    cur_tokens = 0
    for it in items:
        t = estimate_tokens(text_of(it))
        if cur and (cur_tokens + t > max_tokens or len(cur) >= max_items):
            batches.append(cur)
            cur, cur_tokens = [], 0
        cur.append(it)
        cur_tokens += t
    if cur:
        batches.append(cur)
    return batches
