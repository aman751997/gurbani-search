// Cloudflare Workers AI client for BGE-M3 embeddings.
//
// embedQuery() returns a 1024-dim L2-normalized vector. The ingestion pipeline
// uses the same model so there's no cosine-distance drift between index and query.
// On failure it throws EmbeddingError — the route handler maps that to a 503.
// Injectable fetch is exported so tests never hit the real API.

import "server-only";

export const MODEL = "@cf/baai/bge-m3";
export const EMBED_DIM = 1024;
const DEFAULT_TIMEOUT_MS = 8000;

export class EmbeddingError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
    this.cause = cause;
  }
}

/** Fetch signature that matches the global fetch. Tests inject a fake. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface EmbedOptions {
  /** Override the global fetch — tests pass a stub. */
  fetchImpl?: FetchLike;
  /** Per-request timeout in ms. Default 8s. */
  timeoutMs?: number;
  /** Cloudflare account id. Defaults to env. */
  accountId?: string;
  /** Cloudflare API token. Defaults to env. */
  apiToken?: string;
}

function resolveCredentials(opts: EmbedOptions): {
  accountId: string;
  apiToken: string;
} {
  const accountId = opts.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const apiToken = opts.apiToken ?? process.env.CLOUDFLARE_AI_API_TOKEN ?? "";
  if (!accountId || !apiToken) {
    throw new EmbeddingError(
      "Cloudflare credentials missing (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_API_TOKEN)",
    );
  }
  return { accountId, apiToken };
}

function endpointUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;
}

function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  if (sum === 0) return v.slice();
  const inv = 1 / Math.sqrt(sum);
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

function parseResponsePayload(payload: unknown): number[] {
  if (typeof payload !== "object" || payload === null) {
    throw new EmbeddingError("embedding API returned non-object response");
  }
  const p = payload as Record<string, unknown>;
  if (p.success !== true) {
    throw new EmbeddingError(
      `Cloudflare returned success=false: ${JSON.stringify(p.errors ?? null)}`,
    );
  }
  const result = p.result as Record<string, unknown> | undefined;
  if (!result || typeof result !== "object") {
    throw new EmbeddingError("embedding API response missing result");
  }
  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== 1) {
    throw new EmbeddingError(
      `embedding API returned ${Array.isArray(data) ? data.length : "no"} vectors, expected 1`,
    );
  }
  const first = data[0];
  if (!Array.isArray(first) || first.length !== EMBED_DIM) {
    throw new EmbeddingError(
      `embedding vector has wrong shape: length=${Array.isArray(first) ? first.length : "n/a"}`,
    );
  }
  for (let i = 0; i < first.length; i++) {
    if (typeof first[i] !== "number" || !Number.isFinite(first[i])) {
      throw new EmbeddingError(`embedding vector contains non-finite value at index ${i}`);
    }
  }
  return first as number[];
}

/**
 * Embed a single query string via Cloudflare Workers AI BGE-M3.
 * Returns a 1024-dim unit vector.
 */
export async function embedQuery(
  text: string,
  opts: EmbedOptions = {},
): Promise<number[]> {
  if (typeof text !== "string" || text.length === 0) {
    throw new EmbeddingError("embedQuery: text must be a non-empty string");
  }
  const { accountId, apiToken } = resolveCredentials(opts);
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // AbortSignal.timeout is supported on Edge runtime + Node 18+.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetchImpl(endpointUrl(accountId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: [text] }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new EmbeddingError("embedding request failed (network)", e);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    // Try to pull the body for diagnostics without throwing in the catch.
    let body = "";
    try {
      body = await resp.text();
    } catch {
      /* ignore */
    }
    throw new EmbeddingError(
      `embedding request returned HTTP ${resp.status}: ${body.slice(0, 500)}`,
    );
  }
  let payload: unknown;
  try {
    payload = await resp.json();
  } catch (e) {
    throw new EmbeddingError("embedding response was not valid JSON", e);
  }
  const raw = parseResponsePayload(payload);
  return l2Normalize(raw);
}

export const __TEST__ = { endpointUrl, parseResponsePayload, l2Normalize };
