import { useMemo, type ReactElement } from "react";

import {
  gurmukhiGuard,
  substringGuard,
} from "@/lib/captionGuards";
import type { TranslationSource } from "@/components/AttributionLine";

export type Confidence = "high" | "medium" | "low";

export interface CaptionBlockProps {
  explanation: string | null;
  confidence: Confidence;
  translationSource: TranslationSource;
  /**
   * The scripture English translation, used only as an input to the runtime
   * substring guard. Never rendered.
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
  if (!gurmukhiGuard(explanation).ok) return { ok: false };
  if (
    scriptureTranslation &&
    !substringGuard(explanation, scriptureTranslation).ok
  ) {
    return { ok: false };
  }
  return { ok: true };
}

// Plain unicode star avoids an icon library dependency. aria-hidden because
// the parent <h4> text carries the semantic label.
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
  // Explanations that fail guards collapse to null — the no-explanation slot
  // renders instead so the raw text is never surfaced.
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
