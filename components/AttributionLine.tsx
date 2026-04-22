// U10: AttributionLine — translation-source attribution for the scripture
// block. Rendered inside ScriptureBlock so every shabad card is
// transparently attributed. Kept as a separate component so the label text
// and styling live in one place.

import type { ReactElement } from "react";

export type TranslationSource = "ms" | "ssk";

export interface AttributionLineProps {
  translationSource: TranslationSource;
  className?: string;
}

const TRANSLATOR_LABEL: Record<TranslationSource, string> = {
  ms: "Bhai Manmohan Singh",
  ssk: "Sant Singh Khalsa",
};

export function AttributionLine({
  translationSource,
  className,
}: AttributionLineProps): ReactElement {
  return (
    <p
      className={
        className ??
        "mt-2 text-xs text-zinc-500 dark:text-zinc-400"
      }
      data-testid="attribution-line"
    >
      Translation: {TRANSLATOR_LABEL[translationSource]}
    </p>
  );
}

export default AttributionLine;
