/**
 * Tests for generateMetadata in app/shabad/[id]/page.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { loadShabadByIdMock } = vi.hoisted(() => ({
  loadShabadByIdMock: vi.fn(),
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
  headers: () => ({ get: () => null }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { generateMetadata } from "@/app/shabad/[id]/page";

const SHABAD = {
  shabad_id: "2519",
  gurmukhi_display: "ਗੁਰਬਾਣੀ",
  transliteration: "gurbani",
  translation_bms:
    "This precious human life, I have obtained as a reward of good actions, but without discriminating wisdom it is going in vain.",
  translation_source: "ms" as const,
  ang: 658,
  author: "Bhagat Ravi Daas Ji",
  raag: "Raag Sorath",
};

beforeEach(() => {
  loadShabadByIdMock.mockReset();
});

describe("generateMetadata", () => {
  it("returns a title, description and OpenGraph block for a valid shabad", async () => {
    loadShabadByIdMock.mockResolvedValue(SHABAD);
    const meta = await generateMetadata({
      params: Promise.resolve({ id: "2519" }),
    });
    expect(typeof meta.title).toBe("string");
    expect(meta.description).toContain("Bhagat Ravi Daas Ji");
    expect(meta.description).toContain("Raag Sorath");
    expect(meta.description).toContain("Ang 658");
    expect(meta.openGraph).toBeTruthy();
    expect(meta.openGraph!.url).toBe("/shabad/2519");
    expect((meta.openGraph as unknown as { type?: string }).type).toBe("article");
  });

  it("truncates a long translation to <=80-ish chars for og:title", async () => {
    const longTrans =
      "A very long translation ".repeat(20) + "end.";
    loadShabadByIdMock.mockResolvedValue({ ...SHABAD, translation_bms: longTrans });
    const meta = await generateMetadata({
      params: Promise.resolve({ id: "2519" }),
    });
    const ogTitle = (meta.openGraph?.title ?? "") as string;
    expect(ogTitle.length).toBeLessThanOrEqual(85);
    expect(ogTitle).toMatch(/…$/);
  });

  it("returns a not-found title when id is non-numeric", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ id: "abc" }),
    });
    expect(meta.title).toMatch(/not found/i);
  });

  it("returns a not-found title when the shabad is absent", async () => {
    loadShabadByIdMock.mockResolvedValue(null);
    const meta = await generateMetadata({
      params: Promise.resolve({ id: "9999999" }),
    });
    expect(meta.title).toMatch(/not found/i);
  });

  it("gracefully falls back on loadShabadById throwing", async () => {
    loadShabadByIdMock.mockRejectedValue(new Error("db fail"));
    const meta = await generateMetadata({
      params: Promise.resolve({ id: "2519" }),
    });
    expect(typeof meta.title).toBe("string");
  });
});

describe("backLinkFromReferer (unit)", () => {
  it("returns /search?q=… when same-host /search referer with query", async () => {
    const { backLinkFromReferer } = await import("@/lib/shabadLookup");
    expect(
      backLinkFromReferer("https://gurbani.app/search?q=anger", "gurbani.app"),
    ).toBe("/search?q=anger");
  });
  it("returns /search when same-host /search referer without query", async () => {
    const { backLinkFromReferer } = await import("@/lib/shabadLookup");
    expect(
      backLinkFromReferer("https://gurbani.app/search", "gurbani.app"),
    ).toBe("/search");
  });
  it("returns / for cross-host referer", async () => {
    const { backLinkFromReferer } = await import("@/lib/shabadLookup");
    expect(
      backLinkFromReferer("https://evil.example/x", "gurbani.app"),
    ).toBe("/");
  });
  it("returns / for missing referer", async () => {
    const { backLinkFromReferer } = await import("@/lib/shabadLookup");
    expect(backLinkFromReferer(null, "gurbani.app")).toBe("/");
    expect(backLinkFromReferer(undefined, "gurbani.app")).toBe("/");
  });
  it("returns / for malformed referer", async () => {
    const { backLinkFromReferer } = await import("@/lib/shabadLookup");
    expect(backLinkFromReferer("not a url", "gurbani.app")).toBe("/");
  });
  it("returns / when referer is same-host but a different path", async () => {
    const { backLinkFromReferer } = await import("@/lib/shabadLookup");
    expect(
      backLinkFromReferer("https://gurbani.app/about", "gurbani.app"),
    ).toBe("/");
  });
});
