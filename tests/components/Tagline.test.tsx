/**
 * Tests for components/Tagline.tsx.
 */
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { Tagline, TAGLINE_TEXT } from "@/components/Tagline";

afterEach(() => cleanup());

describe("Tagline", () => {
  it("renders the canonical tagline text by default", () => {
    render(<Tagline />);
    expect(screen.getByText(TAGLINE_TEXT)).toBeInTheDocument();
  });

  it("renders as h1 by default", () => {
    render(<Tagline />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toBeInTheDocument();
    expect(h1.textContent).toBe(TAGLINE_TEXT);
  });

  it("renders as h2 when as=h2", () => {
    render(<Tagline as="h2" />);
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("renders as p when as=p (no heading role)", () => {
    const { container } = render(<Tagline as="p" />);
    expect(container.querySelector("p")).not.toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("accepts custom children override", () => {
    render(<Tagline>Custom</Tagline>);
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.queryByText(TAGLINE_TEXT)).toBeNull();
  });

  it("exposes a stable canonical string constant", () => {
    // The tagline is the brand promise. Guard against accidental edits.
    expect(TAGLINE_TEXT).toBe("Finds your Gurbani. Never writes it.");
  });
});
