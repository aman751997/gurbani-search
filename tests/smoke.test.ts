import { describe, it, expect } from "vitest";

describe("vitest wiring smoke test", () => {
  it("runs at all", () => {
    expect(1 + 1).toBe(2);
  });
});
