import { StarterQueryGrid } from "@/components/StarterQueryGrid";
import { SearchInput } from "@/components/SearchInput";
import { Tagline } from "@/components/Tagline";
import { GurmukhiSizeControl } from "@/components/GurmukhiSizeControl";

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-start px-4 py-10 sm:py-16">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <GurmukhiSizeControl />
      </div>

      <section className="flex w-full max-w-3xl flex-col items-center gap-6 pt-6 sm:gap-8 sm:pt-12">
        <Tagline />
        <SearchInput
          describedById="search-explainer"
          autoFocus
        />
        <p
          id="search-explainer"
          className="max-w-xl text-center text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
        >
          This app finds real shabads by meaning, not keywords. It never
          generates scripture.
        </p>
      </section>

      <section className="mt-12 flex w-full flex-col items-center gap-4 sm:mt-16">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Start with a theme
        </h2>
        <StarterQueryGrid />
      </section>

      <footer className="mt-auto w-full max-w-3xl pt-16 text-center text-xs text-zinc-500 dark:text-zinc-500">
        <p>
          Translations: Bhai Manmohan Singh (public domain) and Sant Singh
          Khalsa where attributed. AI captions are labeled explanations, not
          scripture.
        </p>
      </footer>
    </main>
  );
}
