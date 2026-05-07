// Pure query validator — no runtime dependencies, safe to call per-request.
// Returns a tagged union so callers must explicitly branch on `ok`.

export const MAX_QUERY_LEN = 500;

/** Reasons the validator may reject. Stable identifiers — safe to log. */
export type ValidationReason =
  | "empty"
  | "too_long"
  | "control_character"
  | "injection_sigil"
  | "no_printable_char";

export type ValidationResult =
  | { ok: true; query: string }
  | { ok: false; reason: ValidationReason };

// Coarse first-pass injection filter. The prompt's <user_query> delimiter
// is the real protection; this just blocks the most obvious inputs before
// they reach the LLM. Fixed-string matches keep the rule surface auditable.
const INJECTION_SIGILS: readonly string[] = [
  "ignore previous",
  "ignore all",
  "new system prompt",
  "<|im_start|>",
  "[INST]",
];

/** C0 controls: 0x00-0x1F. C1 controls: 0x7F-0x9F. */
function containsControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}

/** Printable = any char that is not whitespace and not a control character. */
function hasPrintableChar(s: string): boolean {
  // \S matches non-whitespace; control chars are caught upstream.
  return /\S/.test(s);
}

/**
 * Validate a raw user query. Does NOT mutate the input — returns it unchanged
 * on success so the caller can decide whether/how to normalize for embedding
 * vs. hashing.
 */
export function validateQuery(raw: unknown): ValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "empty" };
  }
  if (raw.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (raw.length > MAX_QUERY_LEN) {
    return { ok: false, reason: "too_long" };
  }
  if (containsControlChar(raw)) {
    return { ok: false, reason: "control_character" };
  }
  if (!hasPrintableChar(raw)) {
    return { ok: false, reason: "no_printable_char" };
  }
  const lower = raw.toLowerCase();
  for (const sigil of INJECTION_SIGILS) {
    if (lower.includes(sigil.toLowerCase())) {
      return { ok: false, reason: "injection_sigil" };
    }
  }
  return { ok: true, query: raw };
}

/** Exposed for unit-test visibility. */
export const __TEST__ = { INJECTION_SIGILS };
