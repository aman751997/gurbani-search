/**
 * Tests for components/ScriptureBlock.tsx.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// next/link is a pass-through anchor in jsdom tests.
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

import { ScriptureBlock } from "@/components/ScriptureBlock";
import type { ScriptureBlockShabad } from "@/components/ScriptureBlock";

const SHABAD: ScriptureBlockShabad = {
  shabad_id: "2519",
  gurmukhi_display: "ਦੁਲਭ ਜਨਮੁ ਪੁੰਨ ਫਲ ਪਾਇਓ",
  transliteration: "dhulabh janam pu(n)n fal paio",
  translation_bms:
    "This precious human life, I have obtained as a reward of good actions.",
  translation_source: "ms",
  ang: 658,
  author: "Bhagat Ravi Daas Ji",
  raag: "Raag Sorath",
};

afterEach(() => cleanup());

describe("ScriptureBlock", () => {
  it("renders Gurmukhi with lang=pa", () => {
    const { container } = render(<ScriptureBlock shabad={SHABAD} />);
    const gurmukhi = container.querySelector(
      "[data-testid='scripture-gurmukhi']",
    );
    expect(gurmukhi).not.toBeNull();
    expect(gurmukhi!.getAttribute("lang")).toBe("pa");
    expect(gurmukhi!.textContent).toBe(SHABAD.gurmukhi_display);
  });

  it("renders transliteration with lang=pa-Latn", () => {
    const { container } = render(<ScriptureBlock shabad={SHABAD} />);
    const t = container.querySelector(
      "[data-testid='scripture-transliteration']",
    );
    expect(t).not.toBeNull();
    expect(t!.getAttribute("lang")).toBe("pa-Latn");
    expect(t!.textContent).toBe(SHABAD.transliteration);
  });

  it("renders translation with lang=en", () => {
    const { container } = render(<ScriptureBlock shabad={SHABAD} />);
    const tx = container.querySelector(
      "[data-testid='scripture-translation']",
    );
    expect(tx).not.toBeNull();
    expect(tx!.getAttribute("lang")).toBe("en");
    expect(tx!.textContent).toBe(SHABAD.translation_bms);
  });

  it("renders author and raag", () => {
    render(<ScriptureBlock shabad={SHABAD} />);
    expect(screen.getByText("Bhagat Ravi Daas Ji")).toBeInTheDocument();
    expect(screen.getByText("Raag Sorath")).toBeInTheDocument();
  });

  it("Ang is a link to /shabad/{id}", () => {
    render(<ScriptureBlock shabad={SHABAD} />);
    const link = screen.getByRole("link", { name: /ang 658/i });
    expect(link).toHaveAttribute("href", "/shabad/2519");
  });

  it("renders the translator attribution line", () => {
    render(<ScriptureBlock shabad={SHABAD} />);
    expect(
      screen.getByText(/translation: bhai manmohan singh/i),
    ).toBeInTheDocument();
  });

  it("renders SSK attribution when translation_source=ssk", () => {
    render(
      <ScriptureBlock shabad={{ ...SHABAD, translation_source: "ssk" }} />,
    );
    expect(
      screen.getByText(/translation: sant singh khalsa/i),
    ).toBeInTheDocument();
  });
});
