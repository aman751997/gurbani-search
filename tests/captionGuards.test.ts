/**
 * Tests for lib/captionGuards.ts — the three programmatic defense layers.
 * Pure functions, no mocks needed.
 */
import { describe, it, expect } from "vitest";

vi_mock_server_only();

import {
  schemaGuard,
  gurmukhiGuard,
  substringGuard,
  tokenizeForSubstringGuard,
  SUBSTRING_THRESHOLD,
  RawLlmOutputSchema,
} from "@/lib/captionGuards";

// schemaGuard requires zod — imported transitively. vi.mock("server-only")
// is declared in captionGuards only indirectly (it doesn't import it), so
// the mock is actually a no-op helper here. Keep the pattern for uniformity
// with the other caption tests.
function vi_mock_server_only() {
  // no-op at runtime; placeholder hook
}

// -----------------------------------------------------------------------------
// schemaGuard
// -----------------------------------------------------------------------------

describe("schemaGuard", () => {
  it("accepts a valid happy-path object", () => {
    const res = schemaGuard({ explanation: "A concise caption.", confidence: "high" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.explanation).toBe("A concise caption.");
      expect(res.value.confidence).toBe("high");
    }
  });

  it("accepts the empty-explanation marker", () => {
    const res = schemaGuard({ explanation: "", confidence: "low" });
    expect(res.ok).toBe(true);
  });

  it("rejects missing confidence field", () => {
    const res = schemaGuard({ explanation: "hello" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("schema");
  });

  it("rejects explanation over 200 chars", () => {
    const long = "a".repeat(201);
    const res = schemaGuard({ explanation: long, confidence: "medium" });
    expect(res.ok).toBe(false);
  });

  it("accepts explanation at the 200-char boundary", () => {
    const max = "a".repeat(200);
    const res = schemaGuard({ explanation: max, confidence: "medium" });
    expect(res.ok).toBe(true);
  });

  it("rejects wrong confidence enum value", () => {
    const res = schemaGuard({ explanation: "ok", confidence: "super-high" });
    expect(res.ok).toBe(false);
  });

  it("rejects extra unexpected fields (strict schema)", () => {
    const res = schemaGuard({
      explanation: "ok",
      confidence: "high",
      extra: "nope",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(schemaGuard("a string").ok).toBe(false);
    expect(schemaGuard(null).ok).toBe(false);
    expect(schemaGuard(42).ok).toBe(false);
    expect(schemaGuard(undefined).ok).toBe(false);
  });

  it("exported RawLlmOutputSchema is usable directly", () => {
    const parsed = RawLlmOutputSchema.safeParse({
      explanation: "ok",
      confidence: "low",
    });
    expect(parsed.success).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// gurmukhiGuard
// -----------------------------------------------------------------------------

describe("gurmukhiGuard", () => {
  it("passes pure ASCII", () => {
    expect(gurmukhiGuard("This shabad addresses anger.").ok).toBe(true);
  });

  it("passes Latin-1 punctuation and accented chars (Gurmukhi block only)", () => {
    expect(gurmukhiGuard("Café — reflect on naam.").ok).toBe(true);
  });

  it("rejects a caption containing ਕ (U+0A15)", () => {
    const res = gurmukhiGuard("This is ਕ in the middle.");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("gurmukhi");
      expect(res.offendingCodepoint).toBe(0x0a15);
    }
  });

  it("rejects a caption containing ਕ੍ਰੋਧ (krodh)", () => {
    expect(gurmukhiGuard("In ਕ੍ਰੋਧ, anger.").ok).toBe(false);
  });

  it("rejects a caption whose only Gurmukhi codepoint is the diacritic U+0A4D (halant)", () => {
    expect(gurmukhiGuard("Contains halant: \u0A4D").ok).toBe(false);
  });

  it("passes empty string", () => {
    expect(gurmukhiGuard("").ok).toBe(true);
  });

  it("rejects codepoint at the lower boundary U+0A00", () => {
    expect(gurmukhiGuard("X\u0A00").ok).toBe(false);
  });

  it("rejects codepoint at the upper boundary U+0A7F", () => {
    expect(gurmukhiGuard("X\u0A7F").ok).toBe(false);
  });

  it("passes codepoint just above the block U+0A80 (Gujarati)", () => {
    expect(gurmukhiGuard("X\u0A80").ok).toBe(true);
  });

  it("passes codepoint just below the block U+09FF (Bengali end)", () => {
    expect(gurmukhiGuard("X\u09FF").ok).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// substringGuard
// -----------------------------------------------------------------------------

describe("tokenizeForSubstringGuard", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenizeForSubstringGuard("The Lord's NAME")).toEqual(["the", "lord's", "name"]);
  });
  it("strips edge punctuation but preserves intra-token", () => {
    expect(tokenizeForSubstringGuard("Hello, world! 'quoted'")).toEqual([
      "hello",
      "world",
      "quoted",
    ]);
  });
  it("collapses empty tokens from runs of whitespace", () => {
    expect(tokenizeForSubstringGuard("  a   b\tc\n  d  ")).toEqual(["a", "b", "c", "d"]);
  });
  it("returns empty for empty string", () => {
    expect(tokenizeForSubstringGuard("")).toEqual([]);
  });
});

describe("substringGuard", () => {
  const translation = "Ego is a chronic disease and the cure is the Lord's Name in all things";
  // Tokens: [ego, is, a, chronic, disease, and, the, cure, is, the, lord's, name, in, all, things] (15)

  it("passes when explanation has no overlap", () => {
    expect(substringGuard("A brief thematic note about inner enemies.", translation).ok).toBe(true);
  });

  it("passes a 6-token overlap (below threshold)", () => {
    // 6 contiguous tokens from translation: "is a chronic disease and the"
    const exp = "The shabad: is a chronic disease and the - plus commentary.";
    const res = substringGuard(exp, translation);
    expect(res.ok).toBe(true);
  });

  it("rejects a 7-token overlap (at threshold)", () => {
    // 7 contiguous tokens: "is a chronic disease and the cure"
    const exp = "Contains the span: is a chronic disease and the cure; nothing more.";
    const res = substringGuard(exp, translation);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("substring");
  });

  it("rejects an 8-token overlap", () => {
    const exp = "Long span: is a chronic disease and the cure is present.";
    expect(substringGuard(exp, translation).ok).toBe(false);
  });

  it("is case-insensitive", () => {
    const exp = "IS A CHRONIC DISEASE AND THE CURE is uppercase here.";
    expect(substringGuard(exp, translation).ok).toBe(false);
  });

  it("normalizes edge punctuation when comparing", () => {
    // Add punctuation around the 7-gram — should still match.
    const exp = "'Is, a chronic disease and the cure!' says the caption.";
    expect(substringGuard(exp, translation).ok).toBe(false);
  });

  it("passes for empty explanation (no overlap possible)", () => {
    expect(substringGuard("", translation).ok).toBe(true);
  });

  it("passes when target has fewer than threshold tokens", () => {
    expect(substringGuard("any long text here indeed", "short target").ok).toBe(true);
  });

  it("passes when explanation has fewer than threshold tokens", () => {
    expect(substringGuard("only six tokens in this one text", translation).ok).toBe(true);
    // The above has 8 tokens actually — use a real 6-token example:
    expect(substringGuard("only six tokens in this text", translation).ok).toBe(true);
  });

  it("SUBSTRING_THRESHOLD is 7", () => {
    expect(SUBSTRING_THRESHOLD).toBe(7);
  });

  it("custom threshold is respected", () => {
    // 3-token overlap "is a chronic" — below threshold 5, above threshold 3
    const exp = "Contains is a chronic pattern.";
    expect(substringGuard(exp, translation, 5).ok).toBe(true);
    expect(substringGuard(exp, translation, 3).ok).toBe(false);
  });

  it("throws on threshold < 1", () => {
    expect(() => substringGuard("a", "b", 0)).toThrow();
  });
});
