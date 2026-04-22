// U9: StarterQueryGrid — server component.
//
// Reads data/starter-queries.json at build time (it's statically imported
// by Next's bundler) and renders a 2-col mobile / 5-col desktop text-only
// grid of anchor tiles. Each tile links directly to /search?q={query} so
// the clickthrough is indistinguishable from typing the query manually —
// shareable URLs, back-button works, analytics unified.
//
// Design-lens guidance (plan §U9): NO icons. Feature-grid iconography is
// the AI-slop pattern we are explicitly avoiding. Text-only tiles with
// hover + focus-visible affordances.

import starterQueries from "@/data/starter-queries.json";

export interface StarterQuery {
  query: string;
  slug: string;
}

const QUERIES: readonly StarterQuery[] = starterQueries as StarterQuery[];

export function StarterQueryGrid() {
  return (
    <ul
      role="list"
      aria-label="Starter queries"
      className="grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-5"
    >
      {QUERIES.map((q) => (
        <li role="listitem" key={q.slug}>
          <a
            href={`/search?q=${encodeURIComponent(q.query)}`}
            className="block w-full rounded-md border border-zinc-200 bg-white px-4 py-3 text-center text-sm font-medium capitalize text-zinc-900 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-100/40"
          >
            {q.query}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default StarterQueryGrid;
