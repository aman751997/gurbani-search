// U12: /shabad/[id] — full shabad detail page.
//
// Renders the verbatim scripture (via ScriptureBlock) with no AI
// caption — captions are search-context-specific and don't belong on a
// standalone detail page. Generates per-shabad OpenGraph metadata so
// shared links surface meaningful previews.
//
// Back-link behavior: if the request's Referer header points to our own
// /search page we route back preserving the query; otherwise fall back
// to the homepage.
//
// Cut-discipline note (plan §U12): v1.0 ships without adjacent shabads.
// That is U14 in v1.1 and intentionally deferred.

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { loadShabadById, backLinkFromReferer } from "@/lib/shabadLookup";
import { ScriptureBlock } from "@/components/ScriptureBlock";
import { Tagline } from "@/components/Tagline";
import { GurmukhiSizeControl } from "@/components/GurmukhiSizeControl";

export const dynamic = "force-dynamic";

interface ShabadPageProps {
  params: Promise<{ id: string }>;
}

function isPositiveIntStr(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function firstNChars(s: string, n: number): string {
  if (s.length <= n) return s.trim();
  const cut = s.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > n * 0.5 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

export async function generateMetadata({
  params,
}: ShabadPageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isPositiveIntStr(id)) {
    return { title: "Shabad not found — Gurbani Search" };
  }
  let shabad;
  try {
    shabad = await loadShabadById(id);
  } catch {
    return { title: "Shabad — Gurbani Search" };
  }
  if (!shabad) {
    return { title: "Shabad not found — Gurbani Search" };
  }
  const title = firstNChars(shabad.translation_bms, 80);
  const description = `${shabad.author} · ${shabad.raag} · Ang ${shabad.ang}`;
  const url = `/shabad/${shabad.shabad_id}`;
  return {
    title: `${title} — Gurbani Search`,
    description,
    openGraph: {
      title,
      description,
      url,
      type: "article",
      siteName: "Gurbani Search",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function ShabadDetailPage({ params }: ShabadPageProps) {
  const { id } = await params;
  if (!isPositiveIntStr(id)) {
    notFound();
  }
  const shabad = await loadShabadById(id);
  if (!shabad) {
    notFound();
  }

  const hdrs = await headers();
  const referer = hdrs.get("referer");
  const host = hdrs.get("host");
  const backHref = backLinkFromReferer(referer, host);
  const backLabel = backHref.startsWith("/search")
    ? "Back to search"
    : "Home";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-6 sm:py-10">
      <header className="flex items-start justify-between gap-4 pb-6">
        <Link
          href={backHref}
          data-testid="back-link"
          className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <span aria-hidden="true">←</span>
          <span>{backLabel}</span>
        </Link>
        <GurmukhiSizeControl />
      </header>
      <Tagline
        as="p"
        className="mb-6 text-center text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
      />
      <article className="flex flex-col gap-4">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <span data-testid="detail-author" className="font-medium">
            {shabad.author}
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="detail-raag">{shabad.raag}</span>
          <span aria-hidden="true">·</span>
          <span data-testid="detail-ang">Ang {shabad.ang}</span>
        </header>
        <ScriptureBlock shabad={shabad} />
      </article>
      <footer className="mt-auto pt-12 text-center text-xs text-zinc-500 dark:text-zinc-500">
        <p>
          Shabad text from the Sri Guru Granth Sahib. Retrieval only. No AI
          generation of scripture.
        </p>
      </footer>
    </main>
  );
}
