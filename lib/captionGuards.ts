// Guards for caption generation output.
// All three are pure, synchronous, and throw-free — the caller handles rejection.

import { z } from "zod";

/**
 * Raw LLM output schema. An empty explanation is the model's "no-explanation"
 * marker (e.g. instruction-shaped query). Populated explanations are capped
 * at 200 characters per the system prompt.
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

/**
 * Reject any explanation containing a codepoint in the Gurmukhi block
 * (U+0A00..U+0A7F). No legitimate English caption should ever contain one.
 *
 * Walks codepoints rather than UTF-16 code units for correctness, even
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

/**
 * Reject if the explanation contains a 7+ token contiguous substring of the
 * shabad's translation. Tokens are lowercased, split on whitespace, and have
 * leading/trailing punctuation stripped. Intra-token punctuation is preserved
 * so "don't" and "dont" are distinct tokens (erring toward fewer false positives).
 *
 * Short-circuits when explanation or translation has fewer than 7 tokens.
 *
 * O(n * m) rolling window — acceptable for the short strings involved.
 */

export const SUBSTRING_THRESHOLD = 7;

export type SubstringGuardResult =
  | { ok: true }
  | { ok: false; reason: "substring"; overlapStart: number };

// \p{P} + \p{S} stripped at token edges only; intra-token punctuation preserved.
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
