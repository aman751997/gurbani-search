// Programmatic defense layers 2, 3, and 4 for caption generation.
// (Layer 1 — HTTP-edge validator — lives in lib/validateQuery.ts.)
//
// All three guards are pure, deterministic, and synchronous so tests can pin
// exact input/output behavior. None of them log; the caller decides what to
// do with a rejection (logging, caching a no-explanation marker, etc).

import { z } from "zod";

// -----------------------------------------------------------------------------
// Schema guard (layer 2)
// -----------------------------------------------------------------------------

/**
 * Raw LLM output schema. An empty explanation is allowed — that is the
 * "no-explanation" marker emitted by the model when it cannot produce a
 * safe caption (e.g. instruction-shaped query). A populated explanation
 * is capped at 200 characters per the system prompt.
 */
export const RawLlmOutputSchema = z
  .object({
    explanation: z.string().max(200),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export type RawLlmOutput = z.infer<typeof RawLlmOutputSchema>;

export type GuardReason = "schema" | "gurmukhi" | "substring";

export type SchemaGuardResult =
  | { ok: true; value: RawLlmOutput }
  | { ok: false; reason: "schema"; detail?: string };

export function schemaGuard(raw: unknown): SchemaGuardResult {
  const parsed = RawLlmOutputSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  // `issues` has more useful detail than `message` in Zod v4.
  const detail = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, reason: "schema", detail };
}

// -----------------------------------------------------------------------------
// Gurmukhi-character guard (layer 3)
// -----------------------------------------------------------------------------

/**
 * Reject any explanation containing a codepoint in the Gurmukhi block
 * U+0A00..U+0A7F. No legitimate English caption should ever contain one;
 * if it does, something went wrong upstream.
 *
 * Implementation walks codepoints (not UTF-16 code units) so we correctly
 * handle any future supplementary-plane additions without surprise, even
 * though the Gurmukhi block is entirely BMP.
 */
export type GurmukhiGuardResult =
  | { ok: true }
  | { ok: false; reason: "gurmukhi"; offendingCodepoint: number };

export function gurmukhiGuard(explanation: string): GurmukhiGuardResult {
  for (const ch of explanation) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp >= 0x0a00 && cp <= 0x0a7f) {
      return { ok: false, reason: "gurmukhi", offendingCodepoint: cp };
    }
  }
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Substring guard (layer 4)
// -----------------------------------------------------------------------------

/**
 * Reject if the explanation contains ANY 7+ token contiguous substring of
 * the target shabad's translation. Token boundaries are the canonical
 * tokenizer below:
 *
 *   - lowercase
 *   - split on Unicode whitespace (\s+)
 *   - per-token: strip leading/trailing punctuation (Unicode P class).
 *     Intra-token punctuation (e.g. "don't") is preserved so "don't" and
 *     "dont" are NOT treated as the same token — we err on the side of
 *     LESS matching to keep the guard from false-positive-ing on punctuation
 *     normalization.
 *   - empty tokens dropped
 *
 * Documented decision: tokens are compared case-insensitively (via lowercase
 * before tokenization). Both sides go through the same tokenizer so the
 * comparison is symmetric. See the U6 spec — "should tokens be ASCII-
 * normalized first?" resolved YES (lowercase + strip edge punct).
 *
 * Algorithm: O(n * m) rolling-window. For each starting index i in the
 * target token stream (where i + 7 <= m), check if the explanation tokens
 * contain that 7-gram. A 7-gram match anywhere is a rejection.
 *
 * Short-circuit cases:
 *   - empty explanation passes (common: the "" marker from the model)
 *   - target translation with < 7 tokens can never trigger — passes
 */

export const SUBSTRING_THRESHOLD = 7;

export type SubstringGuardResult =
  | { ok: true }
  | { ok: false; reason: "substring"; overlapStart: number };

// Unicode-aware punctuation strip. \p{P} + \p{S} (symbols) are stripped at
// the edges. Intra-token punctuation is preserved.
const EDGE_PUNCT_RE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

export function tokenizeForSubstringGuard(s: string): string[] {
  if (!s) return [];
  const lower = s.toLowerCase();
  const out: string[] = [];
  for (const raw of lower.split(/\s+/u)) {
    if (!raw) continue;
    const stripped = raw.replace(EDGE_PUNCT_RE, "");
    if (stripped) out.push(stripped);
  }
  return out;
}

export function substringGuard(
  explanation: string,
  targetTranslation: string,
  threshold: number = SUBSTRING_THRESHOLD,
): SubstringGuardResult {
  if (threshold < 1) {
    throw new Error(`substringGuard: threshold must be >= 1, got ${threshold}`);
  }
  const expTokens = tokenizeForSubstringGuard(explanation);
  if (expTokens.length < threshold) return { ok: true };
  const tgtTokens = tokenizeForSubstringGuard(targetTranslation);
  if (tgtTokens.length < threshold) return { ok: true };

  // Slide a window of `threshold` over the target; check containment in exp.
  for (let i = 0; i + threshold <= tgtTokens.length; i++) {
    const needle = tgtTokens.slice(i, i + threshold);
    // Search `needle` inside `expTokens`.
    outer: for (let j = 0; j + threshold <= expTokens.length; j++) {
      for (let k = 0; k < threshold; k++) {
        if (expTokens[j + k] !== needle[k]) continue outer;
      }
      return { ok: false, reason: "substring", overlapStart: i };
    }
  }
  return { ok: true };
}
