/**
 * lib/db.ts tests — the Supabase clients are mocked, no real network calls.
 *
 * server-only is also mocked so Vitest's "node" environment can import the
 * module without hitting Next.js's client-boundary check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the `server-only` package. In production it throws when imported
// from a client bundle; in Node-environment tests it's a no-op.
vi.mock("server-only", () => ({}));

// Capture createClient call args for assertions without hitting the network.
const createClientCalls: Array<{ url: string; key: string; opts: unknown }> = [];
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: (url: string, key: string, opts: unknown) => {
      createClientCalls.push({ url, key, opts });
      // Return a sentinel object the caller can identify.
      return { __tag: "fake-client", url, keyPreview: key.slice(0, 3) };
    },
  };
});

// Import AFTER mocks are in place.
import {
  __resetSupabaseClientsForTests,
  supabaseAnon,
  supabaseServer,
} from "@/lib/db";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  createClientCalls.length = 0;
  __resetSupabaseClientsForTests();
  // Clean known keys before each test so stale values don't leak.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("supabaseServer", () => {
  it("throws when SUPABASE_URL is missing", () => {
    process.env.SUPABASE_SERVICE_KEY = "sb_secret_xxx";
    expect(() => supabaseServer()).toThrow(/SUPABASE_URL/);
  });

  it("throws when SUPABASE_SERVICE_KEY is missing", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    expect(() => supabaseServer()).toThrow(/SUPABASE_SERVICE_KEY/);
  });

  it("creates a client from SERVICE_KEY and disables session persistence", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sb_secret_abc";
    const client = supabaseServer();
    expect(client).toMatchObject({ __tag: "fake-client", url: "https://proj.supabase.co" });
    expect(createClientCalls).toHaveLength(1);
    const opts = createClientCalls[0].opts as {
      auth?: { persistSession?: boolean; autoRefreshToken?: boolean };
      global?: { headers?: Record<string, string> };
    };
    expect(opts.auth?.persistSession).toBe(false);
    expect(opts.auth?.autoRefreshToken).toBe(false);
    expect(opts.global?.headers?.["X-Client-Info"]).toBe("gurbani-search/server");
  });

  it("memoizes the singleton — second call returns the same instance", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sb_secret_abc";
    const a = supabaseServer();
    const b = supabaseServer();
    expect(a).toBe(b);
    expect(createClientCalls).toHaveLength(1);
  });
});

describe("supabaseAnon", () => {
  it("throws when SUPABASE_ANON_KEY is missing", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co";
    expect(() => supabaseAnon()).toThrow(/SUPABASE_ANON_KEY/);
  });

  it("creates a client from ANON_KEY with the anon X-Client-Info header", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co";
    process.env.SUPABASE_ANON_KEY = "sb_publishable_abc";
    const client = supabaseAnon();
    expect(client).toMatchObject({ __tag: "fake-client" });
    const opts = createClientCalls[0].opts as {
      global?: { headers?: Record<string, string> };
    };
    expect(opts.global?.headers?.["X-Client-Info"]).toBe("gurbani-search/anon");
  });

  it("memoizes independently of supabaseServer", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co";
    process.env.SUPABASE_ANON_KEY = "sb_publishable_abc";
    process.env.SUPABASE_SERVICE_KEY = "sb_secret_abc";
    const s = supabaseServer();
    const a = supabaseAnon();
    expect(s).not.toBe(a);
    // One call per client.
    expect(createClientCalls).toHaveLength(2);
    // Second round still memoized on each path.
    expect(supabaseServer()).toBe(s);
    expect(supabaseAnon()).toBe(a);
    expect(createClientCalls).toHaveLength(2);
  });
});
