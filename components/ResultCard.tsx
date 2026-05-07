import {
  ScriptureBlock,
  type ScriptureBlockShabad,
} from "@/components/ScriptureBlock";
import { CaptionBlock, type Confidence } from "@/components/CaptionBlock";
import type { TranslationSource } from "@/components/AttributionLine";

export type ShabadForCard = ScriptureBlockShabad;

export interface ResultCardCaption {
  explanation: string | null;
  confidence: Confidence;
  translationSource: TranslationSource;
}

export interface ResultCardProps {
  shabad: ShabadForCard;
  /** Null when not yet streamed or guard-triggered; caption block shows a stable fallback slot. */
  caption: ResultCardCaption | null;
}

export function ResultCard({ shabad, caption }: ResultCardProps) {
  return (
    <article
      data-testid="result-card"
      data-shabad-id={String(shabad.shabad_id)}
      className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <ScriptureBlock shabad={shabad} compact />
      <CaptionBlock
        explanation={caption?.explanation ?? null}
        confidence={caption?.confidence ?? "low"}
        translationSource={caption?.translationSource ?? shabad.translation_source}
        scriptureTranslation={shabad.translation_bms}
      />
    </article>
  );
}

export default ResultCard;
