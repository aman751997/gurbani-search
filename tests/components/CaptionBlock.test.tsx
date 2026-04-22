/**
 * Tests for components/CaptionBlock.tsx.
 *
 * Exercises the three confidence variants, the null-explanation slot, the
 * runtime Gurmukhi guard, and the attribution line.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { CaptionBlock } from "@/components/CaptionBlock";

afterEach(() => cleanup());

describe("CaptionBlock — happy paths", () => {
  it("renders a high-confidence explanation without the dotted-underline treatment", () => {
    render(
      <CaptionBlock
        explanation="This shabad speaks to the preciousness of human life."
        confidence="high"
        translationSource="ms"
      />,
    );
    const text = screen.getByTestId("caption-text");
    expect(text.textContent).toMatch(/preciousness of human life/i);
    expect(text).toHaveAttribute("data-confidence", "high");
    expect(text.className).not.toMatch(/decoration-dotted/);
  });

  it("renders a medium-confidence explanation without the dotted treatment", () => {
    render(
      <CaptionBlock
        explanation="Medium-confidence example."
        confidence="medium"
        translationSource="ms"
      />,
    );
    const text = screen.getByTestId("caption-text");
    expect(text).toHaveAttribute("data-confidence", "medium");
    expect(text.className).not.toMatch(/decoration-dotted/);
    expect(text).not.toHaveAttribute("title");
  });

  it("renders a low-confidence explanation with dotted underline + tooltip", () => {
    render(
      <CaptionBlock
        explanation="Approximate connection."
        confidence="low"
        translationSource="ms"
      />,
    );
    const text = screen.getByTestId("caption-text");
    expect(text).toHaveAttribute("data-confidence", "low");
    expect(text.className).toMatch(/decoration-dotted/);
    expect(text.getAttribute("title")).toMatch(/ai confidence is low/i);
  });
});

describe("CaptionBlock — null / empty / guarded explanation", () => {
  it("renders the no-explanation slot when explanation is null", () => {
    render(
      <CaptionBlock
        explanation={null}
        confidence="low"
        translationSource="ms"
      />,
    );
    expect(
      screen.getByText(/no ai explanation for this shabad/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("caption-text")).toBeNull();
  });

  it("renders the no-explanation slot when explanation is empty string", () => {
    render(
      <CaptionBlock
        explanation=""
        confidence="low"
        translationSource="ms"
      />,
    );
    expect(
      screen.getByText(/no ai explanation for this shabad/i),
    ).toBeInTheDocument();
  });

  it("runtime Gurmukhi-character guard: rejects an explanation containing any U+0A00..U+0A7F codepoint", () => {
    const { container } = render(
      <CaptionBlock
        explanation="This contains Gurmukhi ਦੁਲਭ which should not pass."
        confidence="medium"
        translationSource="ms"
      />,
    );
    // The fallback slot is shown; the raw explanation is never rendered.
    expect(
      screen.getByText(/no ai explanation for this shabad/i),
    ).toBeInTheDocument();
    expect(container.textContent?.includes("ਦੁਲਭ")).toBe(false);
  });
});

describe("CaptionBlock — attribution", () => {
  it("attribution line names Claude + Groq and notes translator (MS)", () => {
    render(
      <CaptionBlock
        explanation="Example."
        confidence="high"
        translationSource="ms"
      />,
    );
    const attr = screen.getByTestId("caption-attribution");
    expect(attr.textContent).toMatch(/written by claude via groq/i);
    expect(attr.textContent).toMatch(/not gurbani/i);
    expect(attr.textContent).toMatch(/bhai manmohan singh/i);
  });

  it("attribution names Sant Singh Khalsa when translationSource=ssk", () => {
    render(
      <CaptionBlock
        explanation="Example."
        confidence="high"
        translationSource="ssk"
      />,
    );
    expect(
      screen.getByTestId("caption-attribution").textContent,
    ).toMatch(/sant singh khalsa/i);
  });
});

describe("CaptionBlock — visible reader-facing separation", () => {
  it("renders a visible <hr> separator before the block", () => {
    const { container } = render(
      <CaptionBlock
        explanation="example"
        confidence="high"
        translationSource="ms"
      />,
    );
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders the 'AI explanation' header", () => {
    render(
      <CaptionBlock
        explanation="example"
        confidence="high"
        translationSource="ms"
      />,
    );
    expect(screen.getByTestId("caption-header").textContent).toMatch(
      /ai explanation/i,
    );
  });

  it("the caption section has aria-label=AI explanation", () => {
    render(
      <CaptionBlock
        explanation="example"
        confidence="high"
        translationSource="ms"
      />,
    );
    expect(
      screen.getByRole("region", { name: /ai explanation/i }),
    ).toBeInTheDocument();
  });
});
