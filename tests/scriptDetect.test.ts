import { describe, it, expect } from "vitest";
import {
  containsGurmukhi,
  detectScript,
  __TEST__,
} from "@/lib/scriptDetect";

describe("containsGurmukhi", () => {
  it("detects any Gurmukhi codepoint", () => {
    expect(containsGurmukhi("ਹਉਮੈ")).toBe(true);
    expect(containsGurmukhi("mix ਸਤਿ")).toBe(true);
    expect(containsGurmukhi("ੴ")).toBe(true);
  });

  it("returns false for pure ASCII / English", () => {
    expect(containsGurmukhi("anger")).toBe(false);
    expect(containsGurmukhi("")).toBe(false);
    expect(containsGurmukhi("haumai")).toBe(false);
  });

  it("returns false for non-Gurmukhi unicode", () => {
    expect(containsGurmukhi("café")).toBe(false);
    expect(containsGurmukhi("日本語")).toBe(false);
  });
});

describe("detectScript", () => {
  it("returns gurmukhi on Gurmukhi codepoints", () => {
    expect(detectScript("ਹਉਮੈ")).toBe("gurmukhi");
    expect(detectScript("query with ਸਤਿ mixed in")).toBe("gurmukhi");
  });

  it("returns roman-punjabi on common transliterated tokens", () => {
    // These are all single-token Roman-Punjabi concepts with Punjabi bigrams.
    expect(detectScript("haumai")).toBe("roman-punjabi");
    expect(detectScript("simran")).toBe("roman-punjabi");
    expect(detectScript("gurbani")).toBe("roman-punjabi");
    expect(detectScript("waheguru")).toBe("roman-punjabi");
    expect(detectScript("naam simran")).toBe("roman-punjabi");
  });

  it("returns english for ordinary English queries", () => {
    expect(detectScript("anger")).toBe("english");
    expect(detectScript("what is grace")).toBe("english");
    expect(detectScript("how to overcome ego")).toBe("english");
    expect(detectScript("the lord")).toBe("english");
  });

  it("returns english when a stopword is present even if bigrams lean Punjabi", () => {
    expect(detectScript("what is haumai")).toBe("english");
    expect(detectScript("about simran")).toBe("english");
  });

  it("returns english for non-ASCII non-Gurmukhi (defers to English path)", () => {
    expect(detectScript("café")).toBe("english");
    expect(detectScript("日本")).toBe("english");
  });
});

describe("punjabiBigramRatio", () => {
  const { punjabiBigramRatio } = __TEST__;
  it("is 0 on an empty token list", () => {
    expect(punjabiBigramRatio([])).toBe(0);
  });
  it("is 0 on tokens shorter than 2 chars", () => {
    expect(punjabiBigramRatio(["a", "b"])).toBe(0);
  });
  it("is ~1 for a string of matched bigrams", () => {
    // "aakh" → aa,ak,kh — 2 of 3 are in the bigram list
    expect(punjabiBigramRatio(["aakh"])).toBeGreaterThan(0.5);
  });
});
