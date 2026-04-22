/**
 * Tests for components/AttributionLine.tsx.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { AttributionLine } from "@/components/AttributionLine";

afterEach(() => cleanup());

describe("AttributionLine", () => {
  it("renders Bhai Manmohan Singh when translationSource=ms", () => {
    render(<AttributionLine translationSource="ms" />);
    expect(
      screen.getByText(/translation: bhai manmohan singh/i),
    ).toBeInTheDocument();
  });

  it("renders Sant Singh Khalsa when translationSource=ssk", () => {
    render(<AttributionLine translationSource="ssk" />);
    expect(
      screen.getByText(/translation: sant singh khalsa/i),
    ).toBeInTheDocument();
  });

  it("exposes data-testid=attribution-line", () => {
    const { container } = render(<AttributionLine translationSource="ms" />);
    expect(
      container.querySelector("[data-testid='attribution-line']"),
    ).not.toBeNull();
  });

  it("never renders both translator names simultaneously", () => {
    const { container, rerender } = render(
      <AttributionLine translationSource="ms" />,
    );
    expect(container.textContent).toContain("Bhai Manmohan Singh");
    expect(container.textContent).not.toContain("Sant Singh Khalsa");
    rerender(<AttributionLine translationSource="ssk" />);
    expect(container.textContent).toContain("Sant Singh Khalsa");
    expect(container.textContent).not.toContain("Bhai Manmohan Singh");
  });
});
