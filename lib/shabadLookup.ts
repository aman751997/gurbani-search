// Single-shabad loader for the shabad detail page.
// Uses the anon Supabase client (read-only RLS). Returns null on not-found.

import "server-only";

import { supabaseAnon } from "@/lib/db";
import type { TranslationSource } from "@/components/AttributionLine";

export interface ShabadRecord {
  shabad_id: string;
  gurmukhi_display: string;
  transliteration: string;
  translation_bms: string;
  translation_source: TranslationSource;
  ang: number;
  author: string;
  raag: string;
}

export async function loadShabadById(
  id: string | number,
): Promise<ShabadRecord | null> {
  const sb = supabaseAnon();
  const { data, error } = await sb
    .from("shabads")
    .select(
      "shabad_id, gurmukhi_display, transliteration, translation_bms, translation_source, ang, author, raag",
    )
    .eq("shabad_id", String(id))
    .maybeSingle();
  if (error) {
    throw new Error(`shabad lookup failed: ${error.message}`);
  }
  if (!data) return null;
  const src = data.translation_source === "ssk" ? "ssk" : "ms";
  return {
    shabad_id: String(data.shabad_id),
    gurmukhi_display: String(data.gurmukhi_display ?? ""),
    transliteration: String(data.transliteration ?? ""),
    translation_bms: String(data.translation_bms ?? ""),
    translation_source: src,
    ang: Number(data.ang ?? 0),
    author: String(data.author ?? ""),
    raag: String(data.raag ?? ""),
  };
}

/** Determine the Back-link href from the referring URL.
 *  If the referer is from our own /search page, preserve the query string so
 *  Back returns the user to their search. Otherwise, fall back to `/`.
 */
export function backLinkFromReferer(
  referer: string | null | undefined,
  host: string | null | undefined,
): string {
  if (!referer) return "/";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "/";
  }
  // Only trust same-host referers.
  if (host && url.host !== host) return "/";
  if (url.pathname === "/search" && url.search) {
    return `/search${url.search}`;
  }
  if (url.pathname === "/search") {
    return "/search";
  }
  return "/";
}
