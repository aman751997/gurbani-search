/**
 * Tests for components/ResultCard.tsx.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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

import { ResultCard } from "@/components/ResultCard";
import type { ShabadForCard } from "@/components/ResultCard";

const SHABAD: ShabadForCard = {
  shabad_id: "2519",
  gurmukhi_display: "ਦੁਲਭ ਜਨਮੁ ਪੁੰਨ ਫਲ ਪਾਇਓ",
  transliteration: "dhulabh janam pu(n)n fal paio",
  translation_bms: "This precious human life.",
  translation_source: "ms",
  ang: 658,
  author: "Bhagat Ravi Daas Ji",
  raag: "Raag Sorath",
};

afterEach(() => cleanup());

describe("ResultCard", () => {
  it("renders both scripture and caption when caption is provided", () => {
    render(
      <ResultCard
        shabad={SHABAD}
        caption={{
          explanation: "This shabad reflects on the preciousness of life.",
          confidence: "high",
          translationSource: "ms",
        }}
      />,
    );
    // Scripture content present.
    expect(screen.getByTestId("scripture-gurmukhi")).toBeInTheDocument();
    expect(screen.getByTestId("scripture-translation")).toBeInTheDocument();
    // Caption content present.
    const captionText = screen.getByTestId("caption-text");
    expect(captionText.textContent).toMatch(/preciousness of life/i);
  });

  it("renders the no-explanation slot when caption is null (initial / streaming state)", () => {
    render(<ResultCard shabad={SHABAD} caption={null} />);
    expect(screen.getByTestId("scripture-gurmukhi")).toBeInTheDocument();
    expect(
      screen.getByText(/no ai explanation for this shabad/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("caption-text")).toBeNull();
  });

  it("low-confidence caption gets the dotted underline", () => {
    render(
      <ResultCard
        shabad={SHABAD}
        caption={{
          explanation: "Approximate connection.",
          confidence: "low",
          translationSource: "ms",
        }}
      />,
    );
    const text = screen.getByTestId("caption-text");
    expect(text.className).toMatch(/decoration-dotted/);
  });

  it("exposes data-shabad-id on the outer article for analytics / e2e hooks", () => {
    const { container } = render(
      <ResultCard shabad={SHABAD} caption={null} />,
    );
    const card = container.querySelector("[data-testid='result-card']");
    expect(card?.getAttribute("data-shabad-id")).toBe("2519");
  });

  it("Ang link on a result card still points to /shabad/{id}", () => {
    render(<ResultCard shabad={SHABAD} caption={null} />);
    expect(screen.getByRole("link", { name: /ang 658/i })).toHaveAttribute(
      "href",
      "/shabad/2519",
    );
  });

  it("caption translationSource on prop overrides the shabad's translation_source", () => {
    // The caption can carry its own translationSource (e.g. if rendering
    // a cached caption with a different translation provenance). Attribution
    // at the caption-block level follows the caption prop.
    render(
      <ResultCard
        shabad={SHABAD}
        caption={{
          explanation: "Example",
          confidence: "high",
          translationSource: "ssk",
        }}
      />,
    );
    // Scripture attribution still reads from the shabad's own translation_source.
    expect(
      screen.getByText(/translation: bhai manmohan singh/i),
    ).toBeInTheDocument();
    // Caption attribution line names SSK because caption.translationSource=ssk.
    expect(
      screen.getByTestId("caption-attribution").textContent,
    ).toMatch(/sant singh khalsa/i);
  });
});
