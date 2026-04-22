/**
 * Tests for the starter-query fast path.
 *
 * The goal: when the user lands on /search?q=anger (a starter query),
 * the page uses pre-computed captions from data/starter-captions.json
 * and does NOT open an SSE connection.
 *
 * We assert this by:
 *   1. Mocking embedQuery + runHybridSearch to throw if called (they
 *      should NOT fire on the starter path).
 *   2. Replacing EventSource with a spy constructor and asserting it
 *      was never instantiated for a starter query.
 *   3. For a non-starter query, asserting captions are null initially
 *      AND the EventSource IS instantiated.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const { embedQueryMock, runHybridSearchMock, esCtorMock } = vi.hoisted(() => ({
  embedQueryMock: vi.fn(),
  runHybridSearchMock: vi.fn(),
  esCtorMock: vi.fn(),
}));

vi.mock("@/lib/embeddings", () => ({
  embedQuery: embedQueryMock,
  EmbeddingError: class EmbeddingError extends Error {
    constructor(m: string) {
      super(m);
      this.name = "EmbeddingError";
    }
  },
}));

vi.mock("@/lib/search", async () => {
  const actual = await vi.importActual<typeof import("@/lib/search")>(
    "@/lib/search",
  );
  return { ...actual, runHybridSearch: runHybridSearchMock };
});

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  embedQueryMock.mockReset();
  runHybridSearchMock.mockReset();
  esCtorMock.mockReset();
  // Install a spy EventSource constructor.
  class SpyEventSource {
    url: string;
    onmessage: unknown = null;
    onerror: unknown = null;
    constructor(url: string) {
      this.url = url;
      esCtorMock(url);
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return true;
    }
  }
  (globalThis as unknown as { EventSource: unknown }).EventSource = SpyEventSource;
});

afterEach(() => {
  cleanup();
});

import SearchPage from "@/app/search/page";

function makeParams(q: string) {
  return { searchParams: Promise.resolve({ q }) };
}

describe("starter-query fast path", () => {
  it("does NOT open an SSE connection for a starter query", async () => {
    embedQueryMock.mockImplementation(() => {
      throw new Error("must not be called");
    });
    runHybridSearchMock.mockImplementation(() => {
      throw new Error("must not be called");
    });
    const page = await SearchPage(makeParams("anger"));
    render(page);
    // Give any stray useEffects a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(esCtorMock).not.toHaveBeenCalled();
    // And ResultCards are rendered with populated captions.
    const cards = screen.getAllByTestId("result-card");
    expect(cards.length).toBe(10);
    expect(screen.queryAllByTestId("caption-text").length).toBeGreaterThan(0);
  });

  it("DOES open an SSE connection for a non-starter query", async () => {
    embedQueryMock.mockResolvedValue(new Array(1024).fill(0.1));
    runHybridSearchMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        shabad_id: String(i + 100),
        gurmukhi_display: "ਗੁਰਬਾਣੀ",
        transliteration: "gurbani",
        translation_bms: "Translation.",
        translation_source: "ms" as const,
        ang: 100,
        author: "Guru Nanak",
        raag: "Raag Sorath",
        score: 0.5,
        match_highlights: [],
      })),
    );
    const page = await SearchPage(makeParams("unusualquerytext"));
    render(page);
    await new Promise((r) => setTimeout(r, 0));
    expect(esCtorMock).toHaveBeenCalledTimes(1);
    const url = esCtorMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/api\/caption\?q=unusualquerytext&shabads=/);
  });

  it("falls through to live-SSE when q does not match a starter", async () => {
    embedQueryMock.mockResolvedValue(new Array(1024).fill(0.1));
    runHybridSearchMock.mockResolvedValue([
      {
        shabad_id: "42",
        gurmukhi_display: "g",
        transliteration: "g",
        translation_bms: "t",
        translation_source: "ms" as const,
        ang: 1,
        author: "A",
        raag: "R",
        score: 0.5,
        match_highlights: [],
      },
    ]);
    // "angerxxxxx" is not in starter list
    const page = await SearchPage(makeParams("angerxxxxx"));
    render(page);
    await new Promise((r) => setTimeout(r, 0));
    expect(runHybridSearchMock).toHaveBeenCalled();
    expect(esCtorMock).toHaveBeenCalled();
  });
});

describe("starterCaptions lookup (unit)", () => {
  it("exports getStarterResults that matches case-insensitive", async () => {
    const mod = await import("@/lib/starterCaptions");
    expect(mod.getStarterResults("ANGER")).not.toBeNull();
    expect(mod.getStarterResults("  anger  ")).not.toBeNull();
    expect(mod.getStarterResults("not a starter")).toBeNull();
  });

  it("isStarterQuery returns true for the 10 starters and false otherwise", async () => {
    const mod = await import("@/lib/starterCaptions");
    for (const q of [
      "anger",
      "seva",
      "ego",
      "death",
      "devotion",
      "forgiveness",
      "fear",
      "love",
      "doubt",
      "truth",
    ]) {
      expect(mod.isStarterQuery(q)).toBe(true);
    }
    expect(mod.isStarterQuery("not starter")).toBe(false);
  });

  it("suggestStarterQueries returns 3 starters excluding the current query", async () => {
    const mod = await import("@/lib/starterCaptions");
    const suggestions = mod.suggestStarterQueries("anger", 3);
    expect(suggestions).toHaveLength(3);
    for (const s of suggestions) {
      expect(s.query.toLowerCase()).not.toBe("anger");
    }
  });
});
