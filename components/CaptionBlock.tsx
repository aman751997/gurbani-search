// U10: CaptionBlock — renders the AI caption for a given (query, shabad)
// pair. Deliberately labeled and visually separated from the scripture
// block (R3).
//
// RENDER-PATH SEPARATION CONTRACT (R3):
//   CaptionBlockProps has NO shabadId, NO gurmukhi_display, NO
//   transliteration, NO translation_bms. The component cannot receive
//   scripture text even by accident — it's a TypeScript compile error
//   (enforced by tests/components/renderPathSeparation.test.tsx) and any
//   explanation that contains Gurmukhi codepoints or a 7-token substring
//   of the target translation is refused at runtime in favor of the
//   no-explanation fallback slot.
//
// Visual contract:
//   - <hr> separator before the block (reader-facing distinction, not just
//     a tint)
//   - <h4>AI explanation</h4> with a small sparkle glyph + aria-label
//   - Explanation text in a sans-serif stack (distinct from the scripture
//     translation)
//   - Attribution line: "Written by Claude via Groq. Not Gurbani."
//   - confidence=low: dotted-underline + tooltip
//   - explanation=null OR runtime-guard-fail: no-explanation slot with
//     preserved layout weight

import { useMemo, type ReactElement } from "react";

import {
  gurmukhiGuard,
  substringGuard,
} from "@/lib/captionGuards";
import type { TranslationSource } from "@/components/AttributionLine";

export type Confidence = "high" | "medium" | "low";

/**
 * The scripture text fields are STRUCTURALLY FORBIDDEN from appearing in
 * CaptionBlockProps. See renderPathSeparation tests.
 *
 * `scriptureTranslation` IS accepted as an OPTIONAL input — but ONLY as a
 * defense-in-depth guard input: the component uses it to run the
 * substring-guard at render time. It is never rendered. This keeps the
 * runtime guard available at the component boundary without re-opening
 * the caption/scripture-text mixing door.
 */
export interface CaptionBlockProps {
  explanation: string | null;
  confidence: Confidence;
  translationSource: TranslationSource;
  /**
   * Optional defense-in-depth: the scripture English translation, used
   * ONLY as an input to the runtime substring guard. Never rendered.
   */
  scriptureTranslation?: string;
}

const NO_EXPLANATION_TEXT = "No AI explanation for this shabad";
const AI_ATTRIBUTION = "Written by Claude via Groq. Not Gurbani.";
const LOW_CONFIDENCE_TOOLTIP =
  "AI confidence is low — treat this connection as approximate.";

function runGuards(
  explanation: string,
  scriptureTranslation?: string,
): { ok: true } | { ok: false } {
  // Layer 3: Gurmukhi-character guard
  if (!gurmukhiGuard(explanation).ok) return { ok: false };
  // Layer 4: substring guard (only if we have a target to compare)
  if (
    scriptureTranslation &&
    !substringGuard(explanation, scriptureTranslation).ok
  ) {
    return { ok: false };
  }
  return { ok: true };
}

/**
 * The "sparkle" glyph is a plain unicode star so we avoid bundling an
 * icon library and keep the AI-slop design-lens warning satisfied (no
 * feature-grid sparkle icons on home or results). The glyph is
 * aria-hidden; the parent <h4> text carries the semantic label.
 */
function SparkleGlyph() {
  return (
    <span
      aria-hidden="true"
      className="inline-block text-[0.85em] leading-none text-zinc-400 dark:text-zinc-500"
    >
      ✦
    </span>
  );
}

export function CaptionBlock({
  explanation,
  confidence,
  translationSource,
  scriptureTranslation,
}: CaptionBlockProps): ReactElement {
  // Runtime defense-in-depth. An explanation that would leak scripture-shaped
  // content collapses into the no-explanation slot. The raw explanation is
  // never rendered in that case, not even inside an aria-hidden element.
  const effectiveExplanation = useMemo(() => {
    if (typeof explanation !== "string") return null;
    if (explanation.length === 0) return null;
    const guarded = runGuards(explanation, scriptureTranslation);
    return guarded.ok ? explanation : null;
  }, [explanation, scriptureTranslation]);

  const isLowConfidence = confidence === "low";
  const translator =
    translationSource === "ssk" ? "Sant Singh Khalsa" : "Bhai Manmohan Singh";

  return (
    <section
      data-testid="caption-block"
      aria-label="AI explanation"
      className="mt-4"
    >
      <hr
        aria-hidden="true"
        className="my-4 border-t border-zinc-200 dark:border-zinc-800"
      />
      <div className="flex items-center gap-2">
        <SparkleGlyph />
        <h4
          className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400"
          data-testid="caption-header"
        >
          AI explanation
        </h4>
      </div>
      {effectiveExplanation === null ? (
        <p
          data-testid="caption-empty"
          className="mt-2 font-sans text-sm italic text-zinc-500 dark:text-zinc-500"
        >
          {NO_EXPLANATION_TEXT}
        </p>
      ) : (
        <p
          data-testid="caption-text"
          data-confidence={confidence}
          title={isLowConfidence ? LOW_CONFIDENCE_TOOLTIP : undefined}
          className={
            isLowConfidence
              ? "mt-2 font-sans text-sm leading-relaxed text-zinc-800 underline decoration-dotted decoration-zinc-400 underline-offset-4 dark:text-zinc-200 dark:decoration-zinc-600"
              : "mt-2 font-sans text-sm leading-relaxed text-zinc-800 dark:text-zinc-200"
          }
        >
          {effectiveExplanation}
        </p>
      )}
      <p
        data-testid="caption-attribution"
        className="mt-2 text-[0.7rem] uppercase tracking-wide text-zinc-500 dark:text-zinc-500"
      >
        {AI_ATTRIBUTION} Translation of the shabad is {translator}&apos;s.
      </p>
    </section>
  );
}

export default CaptionBlock;
