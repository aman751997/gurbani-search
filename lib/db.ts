/**
 * Supabase client singletons — SERVER-ONLY.
 *
 * Two clients:
 *   - `supabaseServer()`  — uses `SUPABASE_SERVICE_KEY`. Bypasses RLS.
 *                           Use for caption_cache writes and any server-side
 *                           admin query. MUST NOT be imported from a
 *                           `"use client"` module.
 *   - `supabaseAnon()`    — uses `SUPABASE_ANON_KEY`. Subject to RLS.
 *                           Use on server-rendered pages that need to read
 *                           the corpus.
 *
 * Both clients are memoized so repeated calls inside a single serverless
 * invocation share state (cookies, auth context, websocket pool, etc).
 *
 * This module is server-only. The guard below throws if a client bundle
 * somehow imports it — belt-and-suspenders on top of the
 * `server-only` convention.
 */
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _server: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(
      `[lib/db] Missing required environment variable ${name}. ` +
        `Server-side code must not run without it.`,
    );
  }
  return v;
}

/**
 * Return a Supabase client authenticated with the SERVICE KEY.
 *
 * Service keys bypass Row Level Security, so this client is the only
 * path for caption_cache writes (the table has no RLS policy for
 * anon/authenticated). NEVER expose this to a client bundle.
 */
export function supabaseServer(): SupabaseClient {
  if (_server) return _server;
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_KEY");
  _server = createClient(url, key, {
    auth: {
      // Server-side — no session persistence, no auto-refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        // Make server-originated calls traceable in the Supabase logs.
        "X-Client-Info": "gurbani-search/server",
      },
    },
  });
  return _server;
}

/**
 * Return a Supabase client authenticated with the ANON KEY.
 *
 * Reads are subject to Row Level Security. The corpus tables
 * (shabads, shabad_embeddings) expose read-only SELECT policies so this
 * client can serve SSR/ISR pages that surface shabad data to the browser.
 */
export function supabaseAnon(): SupabaseClient {
  if (_anon) return _anon;
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_ANON_KEY");
  _anon = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        "X-Client-Info": "gurbani-search/anon",
      },
    },
  });
  return _anon;
}

/**
 * Test-only utility. Resets the memoized singletons so a test can stub
 * `process.env` and re-instantiate. Does NOT touch network state.
 */
export function __resetSupabaseClientsForTests(): void {
  _server = null;
  _anon = null;
}
