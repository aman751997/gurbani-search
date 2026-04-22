/**
 * Tests for components/StarterQueryGrid.tsx.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { StarterQueryGrid } from "@/components/StarterQueryGrid";
import starterQueries from "@/data/starter-queries.json";

afterEach(() => cleanup());

describe("StarterQueryGrid", () => {
  it("renders exactly 10 tiles", () => {
    render(<StarterQueryGrid />);
    // Each tile is a listitem; each tile wraps an anchor.
    const tiles = screen.getAllByRole("listitem");
    expect(tiles).toHaveLength(10);
  });

  it("renders exactly 10 anchor links", () => {
    render(<StarterQueryGrid />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(10);
  });

  it("each tile links to /search?q={url-encoded query}", () => {
    render(<StarterQueryGrid />);
    for (const q of starterQueries as { query: string; slug: string }[]) {
      const link = screen.getByRole("link", {
        name: new RegExp(`^${q.query}$`, "i"),
      });
      expect(link).toHaveAttribute(
        "href",
        `/search?q=${encodeURIComponent(q.query)}`,
      );
    }
  });

  it("grid has role=list and listitem children for accessibility", () => {
    render(<StarterQueryGrid />);
    const list = screen.getByRole("list", { name: /starter queries/i });
    const items = within(list).getAllByRole("listitem");
    expect(items.length).toBe(10);
  });

  it("renders all 10 starter-query strings visibly", () => {
    render(<StarterQueryGrid />);
    for (const q of starterQueries as { query: string; slug: string }[]) {
      // Match anywhere in document — capitalize class is visual only.
      expect(
        screen.getByRole("link", { name: new RegExp(`^${q.query}$`, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("tile order matches source data order (keyboard nav predictability)", () => {
    render(<StarterQueryGrid />);
    const links = screen.getAllByRole("link");
    const texts = links.map((a) => a.textContent?.toLowerCase().trim() ?? "");
    const expected = (starterQueries as { query: string }[]).map((q) =>
      q.query.toLowerCase(),
    );
    expect(texts).toEqual(expected);
  });
});
