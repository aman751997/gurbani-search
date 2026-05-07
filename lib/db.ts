// Supabase client singletons — server-only.
//
// supabaseServer() — SERVICE KEY, bypasses RLS. Use for caption_cache writes.
// supabaseAnon()   — ANON KEY, subject to RLS. Use for corpus reads.
//
// Both are memoized so repeated calls within a serverless invocation share state.
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
 * Supabase client authenticated with the SERVICE KEY.
 * Bypasses RLS — the only path for caption_cache writes. Never expose to a client bundle.
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
 * Supabase client authenticated with the ANON KEY.
 * Subject to RLS — corpus tables have read-only SELECT policies.
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
