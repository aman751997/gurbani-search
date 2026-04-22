/**
 * Tests for components/GurmukhiSizeControl.tsx.
 *
 * Exercises the localStorage persistence + CSS-variable mirroring.
 *
 * Note: vitest's jsdom environment does not implement Storage.prototype.clear
 * reliably, so we use removeItem in cleanup instead.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GurmukhiSizeControl } from "@/components/GurmukhiSizeControl";

const KEY = "gurmukhi-size";

function resetEnv() {
  window.localStorage.removeItem(KEY);
  document.documentElement.style.removeProperty("--gurmukhi-scale");
}

afterEach(() => {
  cleanup();
  resetEnv();
});

beforeEach(() => {
  resetEnv();
});

describe("GurmukhiSizeControl", () => {
  it("renders a button with an accessible label mentioning the current size", () => {
    render(<GurmukhiSizeControl />);
    expect(
      screen.getByRole("button", { name: /gurmukhi font size/i }),
    ).toBeInTheDocument();
  });

  it("defaults to size M and applies --gurmukhi-scale=1 on mount", async () => {
    render(<GurmukhiSizeControl />);
    // useEffect fires synchronously in jsdom after render; give it a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(
      document.documentElement.style.getPropertyValue("--gurmukhi-scale"),
    ).toBe("1");
  });

  it("cycles M → L → S → M on repeated clicks", async () => {
    const user = userEvent.setup();
    render(<GurmukhiSizeControl />);
    const btn = screen.getByRole("button");

    await user.click(btn); // M -> L
    expect(window.localStorage.getItem(KEY)).toBe("L");
    expect(
      document.documentElement.style.getPropertyValue("--gurmukhi-scale"),
    ).toBe("1.25");

    await user.click(btn); // L -> S
    expect(window.localStorage.getItem(KEY)).toBe("S");
    expect(
      document.documentElement.style.getPropertyValue("--gurmukhi-scale"),
    ).toBe("0.875");

    await user.click(btn); // S -> M
    expect(window.localStorage.getItem(KEY)).toBe("M");
    expect(
      document.documentElement.style.getPropertyValue("--gurmukhi-scale"),
    ).toBe("1");
  });

  it("rehydrates from localStorage on mount", async () => {
    window.localStorage.setItem(KEY, "L");
    render(<GurmukhiSizeControl />);
    await new Promise((r) => setTimeout(r, 0));
    expect(
      document.documentElement.style.getPropertyValue("--gurmukhi-scale"),
    ).toBe("1.25");
  });

  it("ignores invalid stored value (falls back to default M)", async () => {
    window.localStorage.setItem(KEY, "XL");
    render(<GurmukhiSizeControl />);
    await new Promise((r) => setTimeout(r, 0));
    expect(
      document.documentElement.style.getPropertyValue("--gurmukhi-scale"),
    ).toBe("1");
  });
});
