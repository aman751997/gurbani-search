// Text-only tiles — no icons. Each tile links to /search?q={query} so
// clickthrough URLs are identical to typed searches (shareable, back-button
// works, analytics unified).

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
