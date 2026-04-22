// U10: ResultCard — composes ScriptureBlock + CaptionBlock.
//
// RENDER-PATH SEPARATION CONTRACT (R3):
//   The composer's prop shape accepts scripture data (via `shabad`) and
//   caption data (via `caption`) as disjoint siblings. Each is routed to
//   the correct child component. Neither child can receive data from the
//   other path (enforced by their own prop types and by
//   tests/components/renderPathSeparation.test.tsx).
//
// The caption prop is ALLOWED to be null for the initial / streaming /
// guard-failed state. In that case the caption block renders its
// "No AI explanation for this shabad" slot with preserved layout weight
// so the card footprint doesn't shift when captions stream in on the
// search page (U11).

import {
  ScriptureBlock,
  type ScriptureBlockShabad,
} from "@/components/ScriptureBlock";
import { CaptionBlock, type Confidence } from "@/components/CaptionBlock";
import type { TranslationSource } from "@/components/AttributionLine";

/**
 * Shape of a shabad as accepted by the card. Identical to ScriptureBlockShabad
 * by re-export so upstream callers (U11 search page, U12 detail page) have
 * one type to import.
 */
export type ShabadForCard = ScriptureBlockShabad;

/**
 * Caption data shape accepted by the card. NOTE: NOT the same as the
 * library's `Caption` shape — we separate the UI shape from the backend
 * shape so evolving one doesn't force migrating the other.
 */
export interface ResultCardCaption {
  explanation: string | null;
  confidence: Confidence;
  translationSource: TranslationSource;
}

export interface ResultCardProps {
  shabad: ShabadForCard;
  /**
   * The AI-generated caption for (query, this shabad). Null means "not
   * yet streamed" or "guard-triggered" — the caption block renders the
   * no-explanation slot in either case so layout stays stable.
   */
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
