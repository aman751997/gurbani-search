/**
 * Render-path separation contract — the single most important test in v1.0.
 *
 * Enforces, at both the compile-time and runtime layers, the invariant that
 * scripture content (Gurmukhi, transliteration, translation_bms) and
 * AI-caption content (explanation) flow through DISJOINT typed paths.
 *
 * Compile-time (// @ts-expect-error): ScriptureBlockProps has no `caption`
 * field and CaptionBlockProps has no `shabadId`, no `gurmukhi`, no
 * `translation` field. Any attempt to mix is a TypeScript error.
 *
 * Runtime: a malicious caption that contains a 7+ token substring from the
 * shabad's English translation must NOT appear anywhere in the
 * CaptionBlock's rendered DOM. The component drops the explanation and
 * falls back to the no-explanation slot. Similarly, any Gurmukhi
 * codepoint (U+0A00..U+0A7F) in an explanation is refused at render time.
 *
 * These checks are defense-in-depth: the caption library (U6) already
 * enforces both guards before the explanation is committed to the cache,
 * but U10's render layer enforces them again so a direct prop-level
 * mistake still can't leak.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { ScriptureBlock } from "@/components/ScriptureBlock";
import { CaptionBlock } from "@/components/CaptionBlock";
import { ResultCard } from "@/components/ResultCard";
import type { ShabadForCard } from "@/components/ResultCard";

afterEach(() => cleanup());

const FIXTURE_SHABAD: ShabadForCard = {
  shabad_id: "2519",
  gurmukhi_display:
    "ਦੁਲਭ ਜਨਮੁ ਪੁੰਨ ਫਲ ਪਾਇਓ ਬਿਰਥਾ ਜਾਤ ਅਬਿਬੇਕੈ ॥",
  transliteration: "dhulabh janam pu(n)n fal paio birathaa jaat abibekai ||",
  translation_bms:
    "This precious human life, I have obtained as a reward of good actions, but without discriminating wisdom it is going in vain.",
  translation_source: "ms",
  ang: 658,
  author: "Bhagat Ravi Daas Ji",
  raag: "Raag Sorath",
};

describe("render-path separation — compile-time contract", () => {
  it("ScriptureBlockProps rejects a `caption` field at compile time", () => {
    // @ts-expect-error — ScriptureBlock does not accept caption data.
    const _invalid = <ScriptureBlock shabad={FIXTURE_SHABAD} caption={{ explanation: "x", confidence: "high", translationSource: "ms" }} />;
    void _invalid;
    expect(true).toBe(true);
  });

  it("CaptionBlockProps rejects a `shabadId` field at compile time", () => {
    // @ts-expect-error — CaptionBlock does not accept a shabadId.
    const _invalid = <CaptionBlock explanation="x" confidence="high" translationSource="ms" shabadId="2519" />;
    void _invalid;
    expect(true).toBe(true);
  });

  it("CaptionBlockProps rejects scripture-text fields at compile time", () => {
    // @ts-expect-error — CaptionBlock does not accept scripture-text fields.
    const _invalid = <CaptionBlock explanation="x" confidence="high" translationSource="ms" gurmukhi_display="..." />;
    void _invalid;
    // @ts-expect-error — CaptionBlock does not accept a translation body.
    const _invalid2 = <CaptionBlock explanation="x" confidence="high" translationSource="ms" translation_bms="..." />;
    void _invalid2;
    expect(true).toBe(true);
  });
});

describe("render-path separation — runtime contract (7-token substring guard)", () => {
  it("CaptionBlock refuses an explanation that contains a 7+ token run from the shabad translation", () => {
    // Take a verbatim 7-token contiguous window from the translation.
    const maliciousExplanation =
      "I have obtained as a reward of good actions";
    const { container, getByText } = render(
      <CaptionBlock
        explanation={maliciousExplanation}
        confidence="medium"
        translationSource="ms"
        scriptureTranslation={FIXTURE_SHABAD.translation_bms}
      />,
    );
    // The no-explanation fallback must be rendered instead.
    expect(getByText(/no ai explanation for this shabad/i)).toBeInTheDocument();
    // The malicious explanation must NOT appear anywhere in the rendered DOM.
    expect(container.textContent?.includes(maliciousExplanation)).toBe(false);
  });

  it("ResultCard: caption block's DOM does not contain any 7-token substring from the scripture translation", () => {
    const scriptureWindow = "I have obtained as a reward of good actions";
    const poisonedCaption = {
      explanation: `This shabad reminds me: ${scriptureWindow}.`,
      confidence: "medium" as const,
      translationSource: "ms" as const,
    };
    const { container } = render(
      <ResultCard shabad={FIXTURE_SHABAD} caption={poisonedCaption} />,
    );
    // The caption block (identified by data-testid) must not contain the
    // offending window anywhere in its subtree.
    const captionSlot = container.querySelector("[data-testid='caption-block']");
    expect(captionSlot).not.toBeNull();
    expect(captionSlot!.textContent?.includes(scriptureWindow)).toBe(false);
  });
});

describe("render-path separation — Gurmukhi-codepoint guard in CaptionBlock", () => {
  it("falls back to the no-explanation slot when the explanation contains any Gurmukhi codepoint", () => {
    const maliciousWithGurmukhi = "This shabad ਦੁਲਭ is about rare birth.";
    const { container, getByText } = render(
      <CaptionBlock
        explanation={maliciousWithGurmukhi}
        confidence="medium"
        translationSource="ms"
      />,
    );
    expect(getByText(/no ai explanation for this shabad/i)).toBeInTheDocument();
    // Critical: the Gurmukhi character must NOT be rendered anywhere in the
    // caption slot's subtree.
    expect(container.textContent?.includes("ਦੁਲਭ")).toBe(false);
  });

  it("accepts a clean English explanation (control case)", () => {
    const clean = "This shabad speaks to the preciousness of human life.";
    const { getByText } = render(
      <CaptionBlock
        explanation={clean}
        confidence="high"
        translationSource="ms"
      />,
    );
    expect(getByText(clean)).toBeInTheDocument();
  });
});
