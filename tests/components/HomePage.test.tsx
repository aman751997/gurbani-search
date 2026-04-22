/**
 * Integration test for app/page.tsx. Mocks next/navigation (for SearchInput's
 * useRouter) and renders the page inside jsdom. Font loaders (next/font/google)
 * are not invoked here because we render the page component directly, not the
 * RootLayout.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}));

import HomePage from "@/app/page";
import starterQueries from "@/data/starter-queries.json";
import { TAGLINE_TEXT } from "@/components/Tagline";

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

describe("HomePage", () => {
  it("renders the tagline as the h1", () => {
    render(<HomePage />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe(TAGLINE_TEXT);
  });

  it("renders the search input with visible label + placeholder", () => {
    render(<HomePage />);
    const input = screen.getByRole("searchbox", {
      name: /search the guru granth sahib/i,
    });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute(
      "placeholder",
      "Ask anything — in English or Roman Punjabi",
    );
  });

  it("renders the one-line explainer below the search input", () => {
    render(<HomePage />);
    expect(
      screen.getByText(
        /this app finds real shabads by meaning, not keywords\. it never generates scripture\./i,
      ),
    ).toBeInTheDocument();
  });

  it("wires search input aria-describedby to the explainer id", () => {
    render(<HomePage />);
    const describedBy = screen
      .getByRole("searchbox")
      .getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).not.toBeNull();
  });

  it("renders all 10 starter-query tiles with /search?q=... links", () => {
    render(<HomePage />);
    const list = screen.getByRole("list", { name: /starter queries/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(10);
    for (const q of starterQueries as { query: string; slug: string }[]) {
      const link = within(list).getByRole("link", {
        name: new RegExp(`^${q.query}$`, "i"),
      });
      expect(link).toHaveAttribute(
        "href",
        `/search?q=${encodeURIComponent(q.query)}`,
      );
    }
  });

  it("renders the Gurmukhi size-control button", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("button", { name: /gurmukhi font size/i }),
    ).toBeInTheDocument();
  });

  it("footer mentions the translation attribution + AI-caption disclaimer", () => {
    render(<HomePage />);
    expect(screen.getByText(/bhai manmohan singh/i)).toBeInTheDocument();
    expect(
      screen.getByText(/ai captions are labeled explanations, not scripture/i),
    ).toBeInTheDocument();
  });
});
