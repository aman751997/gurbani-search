// Whitespace-only queries short-circuit before navigation — /api/search
// returns 400 for empty queries and the round-trip is a bad UX.

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";

export interface SearchInputProps {
  /** Optional initial value (e.g. when embedded in the results page). */
  initialQuery?: string;
  /** Optional id for the <input> so multiple instances can coexist. */
  inputId?: string;
  /** Optional aria-describedby target (the explainer paragraph's id). */
  describedById?: string;
  /** If true, the input is autoFocused. Defaults true on homepage. */
  autoFocus?: boolean;
}

export function SearchInput({
  initialQuery = "",
  inputId = "q",
  describedById,
  autoFocus = true,
}: SearchInputProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    },
    [router, value],
  );

  return (
    <form
      onSubmit={onSubmit}
      role="search"
      aria-label="Gurbani search"
      className="flex w-full max-w-xl items-stretch gap-2"
    >
      <label htmlFor={inputId} className="sr-only">
        Search the Guru Granth Sahib
      </label>
      <input
        id={inputId}
        name="q"
        type="search"
        inputMode="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask anything — in English or Roman Punjabi"
        aria-describedby={describedById}
        className="flex-1 rounded-md border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900 shadow-sm outline-none transition focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:border-zinc-100 dark:focus-visible:ring-zinc-100/30"
      />
      <button
        type="submit"
        aria-label="Search"
        className="rounded-md border border-zinc-900 bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 active:scale-95 active:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 disabled:opacity-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:active:bg-zinc-300"
      >
        Search
      </button>
    </form>
  );
}

export default SearchInput;
