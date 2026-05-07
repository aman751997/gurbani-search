// Gurmukhi line-height is generous (1.8) to accommodate the shirorekha top
// line. Font-size scales with --gurmukhi-scale set by GurmukhiSizeControl.

import Link from "next/link";
import { AttributionLine, type TranslationSource } from "@/components/AttributionLine";

export interface ScriptureBlockShabad {
  shabad_id: string | number;
  gurmukhi_display: string;
  transliteration: string;
  translation_bms: string;
  translation_source: TranslationSource;
  ang: number;
  author: string;
  raag: string;
}

export interface ScriptureBlockProps {
  shabad: ScriptureBlockShabad;
  /**
   * Optional: when embedded in a result card, `true` suppresses the
   * outer card chrome styling so the caption block can compose below.
   * When rendered standalone on the shabad detail page, the caller can
   * style freely.
   */
  compact?: boolean;
}

export function ScriptureBlock({ shabad, compact = false }: ScriptureBlockProps) {
  const {
    shabad_id,
    gurmukhi_display,
    transliteration,
    translation_bms,
    translation_source,
    ang,
    author,
    raag,
  } = shabad;
  return (
    <article
      data-testid="scripture-block"
      data-shabad-id={String(shabad_id)}
      className={
        compact
          ? "space-y-3"
          : "space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      }
    >
      <div
        lang="pa"
        data-testid="scripture-gurmukhi"
        className="font-gurmukhi text-[calc(1.25rem*var(--gurmukhi-scale,1))] leading-[1.8] text-zinc-900 dark:text-zinc-100"
        style={{ fontFamily: "var(--font-gurmukhi), serif" }}
      >
        {gurmukhi_display}
      </div>
      <div
        lang="pa-Latn"
        data-testid="scripture-transliteration"
        className="text-sm italic leading-relaxed text-zinc-600 dark:text-zinc-400"
      >
        {transliteration}
      </div>
      <div
        lang="en"
        data-testid="scripture-translation"
        className="text-base leading-relaxed text-zinc-800 dark:text-zinc-200"
      >
        {translation_bms}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-zinc-600 dark:text-zinc-400">
        {author ? <span data-testid="scripture-author">{author}</span> : null}
        {raag ? (
          <>
            <span aria-hidden="true">·</span>
            <span data-testid="scripture-raag">{raag}</span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <Link
          href={`/shabad/${shabad_id}`}
          data-testid="scripture-ang-link"
          className="font-medium text-zinc-900 underline-offset-2 hover:underline focus-visible:underline dark:text-zinc-100"
        >
          Ang {ang}
        </Link>
      </div>
      <AttributionLine translationSource={translation_source} />
    </article>
  );
}

export default ScriptureBlock;
