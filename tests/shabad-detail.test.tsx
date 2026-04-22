/**
 * Tests for app/shabad/[id]/page.tsx.
 *
 * loadShabadById + next/headers + next/navigation are all mocked. The
 * real page renders ScriptureBlock with verbatim fields, a Back link
 * whose href depends on the referer, and NO caption (captions are
 * search-context-specific — detail page has none by design).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const { loadShabadByIdMock, headersMock, notFoundMock } = vi.hoisted(() => ({
  loadShabadByIdMock: vi.fn(),
  headersMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/shabadLookup", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shabadLookup")>(
    "@/lib/shabadLookup",
  );
  return {
    ...actual,
    loadShabadById: loadShabadByIdMock,
  };
});

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

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

import ShabadDetailPage from "@/app/shabad/[id]/page";

const SHABAD = {
  shabad_id: "2519",
  gurmukhi_display: "ਦੁਲਭ ਜਨਮੁ ਪੁੰਨ ਫਲ ਪਾਇਓ",
  transliteration: "dhulabh janam pu(n)n fal paio",
  translation_bms:
    "This precious human life, I have obtained as a reward of good actions.",
  translation_source: "ms" as const,
  ang: 658,
  author: "Bhagat Ravi Daas Ji",
  raag: "Raag Sorath",
};

function mockHeaders(overrides: Record<string, string> = {}) {
  const map = new Map(Object.entries(overrides));
  headersMock.mockReturnValue({
    get: (name: string) => map.get(name.toLowerCase()) ?? null,
  });
}

beforeEach(() => {
  loadShabadByIdMock.mockReset();
  headersMock.mockReset();
  notFoundMock.mockClear();
  notFoundMock.mockImplementation(() => {
    throw new Error("NOT_FOUND");
  });
});

afterEach(() => cleanup());

describe("ShabadDetailPage — happy path", () => {
  it("renders Gurmukhi, transliteration, English translation, author, raag, Ang", async () => {
    loadShabadByIdMock.mockResolvedValue(SHABAD);
    mockHeaders({ referer: "https://gurbani.app/", host: "gurbani.app" });
    const page = await ShabadDetailPage({
      params: Promise.resolve({ id: "2519" }),
    });
    render(page);
    expect(screen.getByTestId("scripture-gurmukhi").textContent).toBe(
      SHABAD.gurmukhi_display,
    );
    expect(screen.getByTestId("scripture-transliteration").textContent).toBe(
      SHABAD.transliteration,
    );
    expect(screen.getByTestId("scripture-translation").textContent).toBe(
      SHABAD.translation_bms,
    );
    expect(screen.getByTestId("detail-author").textContent).toBe(
      SHABAD.author,
    );
    expect(screen.getByTestId("detail-raag").textContent).toBe(SHABAD.raag);
    expect(screen.getByTestId("detail-ang").textContent).toBe("Ang 658");
  });

  it("does NOT render a CaptionBlock — detail page has no caption by design", async () => {
    loadShabadByIdMock.mockResolvedValue(SHABAD);
    mockHeaders({});
    const page = await ShabadDetailPage({
      params: Promise.resolve({ id: "2519" }),
    });
    render(page);
    expect(screen.queryByTestId("caption-block")).toBeNull();
  });

  it("renders translator attribution line", async () => {
    loadShabadByIdMock.mockResolvedValue(SHABAD);
    mockHeaders({});
    const page = await ShabadDetailPage({
      params: Promise.resolve({ id: "2519" }),
    });
    render(page);
    expect(
      screen.getByText(/translation: bhai manmohan singh/i),
    ).toBeInTheDocument();
  });
});

describe("ShabadDetailPage — back-link behavior", () => {
  it("Back link points to /search?q=... when referer is /search on the same host", async () => {
    loadShabadByIdMock.mockResolvedValue(SHABAD);
    mockHeaders({
      referer: "https://gurbani.app/search?q=anger",
      host: "gurbani.app",
    });
    const page = await ShabadDetailPage({
      params: Promise.resolve({ id: "2519" }),
    });
    render(page);
    const back = screen.getByTestId("back-link");
    expect(back.getAttribute("href")).toBe("/search?q=anger");
    expect(back.textContent).toMatch(/back to search/i);
  });

  it("Back link falls back to / when referer is absent", async () => {
    loadShabadByIdMock.mockResolvedValue(SHABAD);
    mockHeaders({ host: "gurbani.app" });
    const page = await ShabadDetailPage({
      params: Promise.resolve({ id: "2519" }),
    });
    render(page);
    const back = screen.getByTestId("back-link");
    expect(back.getAttribute("href")).toBe("/");
    expect(back.textContent).toMatch(/home/i);
  });

  it("Back link falls back to / when referer is from a different host", async () => {
    loadShabadByIdMock.mockResolvedValue(SHABAD);
    mockHeaders({
      referer: "https://evil.example/page",
      host: "gurbani.app",
    });
    const page = await ShabadDetailPage({
      params: Promise.resolve({ id: "2519" }),
    });
    render(page);
    expect(screen.getByTestId("back-link").getAttribute("href")).toBe("/");
  });
});

describe("ShabadDetailPage — invalid id / not found", () => {
  it("calls notFound() when id is not a positive integer", async () => {
    await expect(
      ShabadDetailPage({ params: Promise.resolve({ id: "not-a-real-id" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("calls notFound() when the shabad doesn't exist", async () => {
    loadShabadByIdMock.mockResolvedValue(null);
    mockHeaders({});
    await expect(
      ShabadDetailPage({ params: Promise.resolve({ id: "9999999" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
