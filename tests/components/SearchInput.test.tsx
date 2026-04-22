/**
 * Tests for components/SearchInput.tsx.
 *
 * Mocks `next/navigation` so useRouter().push is observable.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}));

import { SearchInput } from "@/components/SearchInput";

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

describe("SearchInput", () => {
  it("renders a search input with a visible label (accessibility)", () => {
    render(<SearchInput autoFocus={false} />);
    expect(
      screen.getByRole("searchbox", {
        name: /search the guru granth sahib/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders a submit button labeled Search", () => {
    render(<SearchInput autoFocus={false} />);
    expect(
      screen.getByRole("button", { name: /search/i }),
    ).toBeInTheDocument();
  });

  it("navigates to /search?q=... when the user hits Enter", async () => {
    const user = userEvent.setup();
    render(<SearchInput autoFocus={false} />);
    await user.type(screen.getByRole("searchbox"), "anger");
    await user.keyboard("{Enter}");
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/search?q=anger");
  });

  it("navigates when the submit button is clicked", async () => {
    const user = userEvent.setup();
    render(<SearchInput autoFocus={false} />);
    await user.type(screen.getByRole("searchbox"), "seva");
    await user.click(screen.getByRole("button", { name: /search/i }));
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/search?q=seva");
  });

  it("url-encodes the query", async () => {
    const user = userEvent.setup();
    render(<SearchInput autoFocus={false} />);
    await user.type(screen.getByRole("searchbox"), "why do I feel anger?");
    await user.keyboard("{Enter}");
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      "/search?q=why%20do%20I%20feel%20anger%3F",
    );
  });

  it("trims whitespace before navigating", async () => {
    const user = userEvent.setup();
    render(<SearchInput autoFocus={false} />);
    await user.type(screen.getByRole("searchbox"), "   truth   ");
    await user.keyboard("{Enter}");
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/search?q=truth");
  });

  it("does NOT navigate on empty submission", async () => {
    const user = userEvent.setup();
    render(<SearchInput autoFocus={false} />);
    await user.click(screen.getByRole("button", { name: /search/i }));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does NOT navigate on whitespace-only submission", async () => {
    const user = userEvent.setup();
    render(<SearchInput autoFocus={false} />);
    await user.type(screen.getByRole("searchbox"), "     ");
    await user.keyboard("{Enter}");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("prefills from initialQuery", () => {
    render(<SearchInput initialQuery="ego" autoFocus={false} />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    expect(input.value).toBe("ego");
  });

  it("wires aria-describedby to the given id", () => {
    render(<SearchInput autoFocus={false} describedById="explainer" />);
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "aria-describedby",
      "explainer",
    );
  });
});
