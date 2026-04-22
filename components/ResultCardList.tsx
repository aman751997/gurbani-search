// U11: ResultCardList — client component that owns the in-flight caption
// map and renders a list of ResultCards.
//
// Two modes:
//   useSSE=false — starter-query fast path. All captions are already
//     populated in the `initialResults` prop; no streaming, no state
//     changes. Still a client component only because ResultCard depends
//     on lib/captionGuards which is safe either way; could also be a
//     server component. Kept client-side so the rendering path is the
//     same shape in both modes (fewer surprises).
//
//   useSSE=true — opens an EventSource to /api/caption?q=...&shabads=...
//     as soon as it mounts, updates per-shabad caption state as SSE
//     messages arrive. On {done:true} the connection closes; any
//     shabads without a caption flip to `null` (no-explanation slot).
//     On SSE error, surfaces a subtle inline toast with a retry button.

"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { ResultCard, type ResultCardCaption, type ShabadForCard } from "@/components/ResultCard";

export interface ResultCardListEntry {
  shabad: ShabadForCard;
  caption: ResultCardCaption | null;
}

export interface ResultCardListProps {
  query: string;
  initialResults: ResultCardListEntry[];
  useSSE: boolean;
}

interface StreamState {
  /** shabadId -> caption (null means not yet received). */
  captions: Record<string, ResultCardCaption | null>;
  /** True after {done:true} arrives or the stream closes. */
  done: boolean;
  /** Non-null when the stream threw an error. */
  error: string | null;
}

function sseUrl(query: string, shabadIds: string[]): string {
  const q = encodeURIComponent(query);
  const s = encodeURIComponent(shabadIds.join(","));
  return `/api/caption?q=${q}&shabads=${s}`;
}

export function ResultCardList({
  query,
  initialResults,
  useSSE,
}: ResultCardListProps) {
  const shabadIds = useMemo(
    () => initialResults.map((r) => String(r.shabad.shabad_id)),
    [initialResults],
  );

  const [stream, setStream] = useState<StreamState>(() => ({
    captions: Object.fromEntries(
      initialResults.map((r) => [String(r.shabad.shabad_id), r.caption]),
    ),
    done: !useSSE,
    error: null,
  }));

  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    if (!useSSE) return;
    if (shabadIds.length === 0) return;

    setStream((prev) => ({ ...prev, done: false, error: null }));

    const url = sseUrl(query, shabadIds);
    const es = new EventSource(url);
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      try {
        es.close();
      } catch {
        /* ignore */
      }
    };

    es.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        if (parsed && parsed.done === true) {
          close();
          setStream((prev) => {
            const captions = { ...prev.captions };
            // Any shabad still `null` should stay null (no-explanation slot).
            return { ...prev, captions, done: true };
          });
          return;
        }
        if (parsed && typeof parsed.shabadId === "string" && parsed.caption) {
          const incoming = parsed.caption;
          setStream((prev) => {
            // Use the shabad's scripture translation-source as the
            // authoritative source for the caption attribution.
            const entry = initialResults.find(
              (r) => String(r.shabad.shabad_id) === parsed.shabadId,
            );
            const translationSource =
              entry?.shabad.translation_source ?? "ms";
            return {
              ...prev,
              captions: {
                ...prev.captions,
                [parsed.shabadId]: {
                  explanation:
                    typeof incoming.explanation === "string"
                      ? incoming.explanation
                      : null,
                  confidence:
                    incoming.confidence === "high" ||
                    incoming.confidence === "medium" ||
                    incoming.confidence === "low"
                      ? incoming.confidence
                      : "low",
                  translationSource,
                },
              },
            };
          });
        }
      } catch {
        /* malformed SSE message — ignore */
      }
    };

    es.onerror = () => {
      setStream((prev) => ({
        ...prev,
        error:
          prev.error ??
          "Some AI explanations couldn't load — retry?",
        done: true,
      }));
      close();
    };

    return () => {
      close();
    };
    // We intentionally depend on retryNonce so invoking retry() re-opens.
  }, [query, shabadIds, useSSE, retryNonce, initialResults]);

  return (
    <>
      <ul
        role="list"
        aria-label="Search results"
        data-testid="result-card-list"
        className="flex flex-col gap-4"
      >
        {initialResults.map((r, idx) => {
          const id = String(r.shabad.shabad_id);
          const caption = stream.captions[id] ?? null;
          return (
            <li key={`${id}-${idx}`} role="listitem">
              <ResultCard shabad={r.shabad} caption={caption} />
            </li>
          );
        })}
      </ul>
      {stream.error ? (
        <div
          role="status"
          data-testid="caption-stream-error"
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {stream.error}{" "}
          <button
            type="button"
            onClick={retry}
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            Retry
          </button>
        </div>
      ) : null}
    </>
  );
}

export default ResultCardList;
