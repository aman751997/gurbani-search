import { redirect } from "next/navigation";

import { validateQuery } from "@/lib/validateQuery";
import { detectScript } from "@/lib/scriptDetect";
import { transliterate } from "@/lib/transliterate";
import { embedQuery, EmbeddingError } from "@/lib/embeddings";
import { runHybridSearch, SearchError, type SearchResultRow } from "@/lib/search";
import {
  getStarterResults,
  suggestStarterQueries,
} from "@/lib/starterCaptions";
import { SearchInput } from "@/components/SearchInput";
import { Tagline } from "@/components/Tagline";
import { GurmukhiSizeControl } from "@/components/GurmukhiSizeControl";
import { ResultCardList, type ResultCardListEntry } from "@/components/ResultCardList";
import type { ShabadForCard } from "@/components/ResultCard";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

type PageState =
  | { kind: "gurmukhi-unsupported" }
  | { kind: "invalid-query"; reason: string }
  | { kind: "service-unavailable"; stage: "embedding" | "search" }
  | { kind: "empty" }
  | {
      kind: "results";
      entries: ResultCardListEntry[];
      useSSE: boolean;
    };

function rowToShabad(r: SearchResultRow): ShabadForCard {
  return {
    shabad_id: r.shabad_id,
    gurmukhi_display: r.gurmukhi_display,
    transliteration: r.transliteration,
    translation_bms: r.translation_bms,
    translation_source: r.translation_source,
    ang: r.ang,
    author: r.author,
    raag: r.raag,
  };
}

async function resolveQueryState(query: string): Promise<PageState> {
  // Starter-query fast path: sync and cache-backed, no server work.
  const starter = getStarterResults(query);
  if (starter) {
    return {
      kind: "results",
      useSSE: false,
      entries: starter.map((s) => ({
        shabad: s.shabad,
        caption: s.caption,
      })),
    };
  }

  const script = detectScript(query);
  if (script === "gurmukhi") {
    return { kind: "gurmukhi-unsupported" };
  }
  const processedText =
    script === "roman-punjabi" ? transliterate(query).output : query;

  let vector: number[];
  try {
    vector = await embedQuery(processedText);
  } catch (e) {
    const msg = e instanceof EmbeddingError ? e.message : String(e);
    console.error("[search page] embed failure:", msg);
    return { kind: "service-unavailable", stage: "embedding" };
  }

  let rows: SearchResultRow[];
  try {
    rows = await runHybridSearch({
      queryText: processedText,
      queryEmbedding: vector,
      topK: 10,
    });
  } catch (e) {
    const msg = e instanceof SearchError ? e.message : String(e);
    console.error("[search page] rpc failure:", msg);
    return { kind: "service-unavailable", stage: "search" };
  }

  if (rows.length === 0) {
    return { kind: "empty" };
  }

  return {
    kind: "results",
    useSSE: true,
    entries: rows.map((r) => ({
      shabad: rowToShabad(r),
      caption: null,
    })),
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const validation = validateQuery(raw);
  if (!validation.ok) {
    // Invalid/empty query → bounce home. The input on the search bar can
    // re-submit.
    if (!raw || raw.trim() === "") {
      redirect("/");
    }
    const state: PageState = {
      kind: "invalid-query",
      reason: validation.reason,
    };
    return <SearchShell query={raw ?? ""} state={state} />;
  }
  const query = validation.query;
  const state = await resolveQueryState(query);
  return <SearchShell query={query} state={state} />;
}

function SearchShell({
  query,
  state,
}: {
  query: string;
  state: PageState;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:py-10">
      <header className="flex items-start justify-between gap-4 pb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <span aria-hidden="true">←</span>
          <span>Home</span>
        </Link>
        <GurmukhiSizeControl />
      </header>
      <Tagline
        as="p"
        className="mb-6 text-center text-sm font-medium tracking-wide text-zinc-500 dark:text-zinc-400"
      />
      <div className="mx-auto w-full">
        <SearchInput initialQuery={query} autoFocus={false} />
      </div>
      <p
        aria-live="polite"
        className="mt-4 text-sm text-zinc-600 dark:text-zinc-400"
        data-testid="results-heading"
      >
        Results for <span className="font-medium">&ldquo;{query}&rdquo;</span>
      </p>
      <section className="mt-6">
        {renderState(query, state)}
      </section>
    </main>
  );
}

function renderState(query: string, state: PageState) {
  if (state.kind === "gurmukhi-unsupported") {
    return (
      <div
        role="alert"
        data-testid="state-gurmukhi-unsupported"
        className="rounded-md border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        v1.0 supports English and Roman-Punjabi queries. Native Gurmukhi
        input support is planned for a future release.
      </div>
    );
  }
  if (state.kind === "invalid-query") {
    return (
      <div
        role="alert"
        data-testid="state-invalid-query"
        className="rounded-md border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        That query wasn&apos;t accepted. Try a shorter natural-language
        phrase like &ldquo;anger&rdquo; or &ldquo;forgiveness&rdquo;.
      </div>
    );
  }
  if (state.kind === "service-unavailable") {
    return (
      <div
        role="alert"
        data-testid="state-service-unavailable"
        className="flex items-center justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        <span>
          Search is temporarily unavailable — please try again in a moment.
        </span>
        <a
          href={`/search?q=${encodeURIComponent(query)}`}
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Retry
        </a>
      </div>
    );
  }
  if (state.kind === "empty") {
    const suggestions = suggestStarterQueries(query, 3);
    return (
      <div data-testid="state-empty">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          No shabads matched your query. Try one of these starter themes:
        </p>
        <ul role="list" className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <li key={s.slug} role="listitem">
              <a
                href={`/search?q=${encodeURIComponent(s.query)}`}
                className="inline-block rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm capitalize text-zinc-900 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500"
              >
                {s.query}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  // state.kind === "results"
  return (
    <ResultCardList
      query={query}
      initialResults={state.entries}
      useSSE={state.useSSE}
    />
  );
}
