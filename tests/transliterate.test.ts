import { describe, it, expect } from "vitest";
import { transliterate, __TEST__ } from "@/lib/transliterate";

describe("transliterate — dict hits", () => {
  it("maps a single known token to Gurmukhi", () => {
    const r = transliterate("haumai");
    expect(r.hits).toBe(1);
    expect(r.misses).toEqual([]);
    expect(r.output).toBe("ਹਉਮੈ");
  });

  it("maps multiple known tokens", () => {
    const r = transliterate("naam simran");
    expect(r.hits).toBe(2);
    expect(r.output.includes("ਨਾਮ")).toBe(true);
    expect(r.output.includes("ਸਿਮਰਨ")).toBe(true);
  });

  it("is case-insensitive", () => {
    const r = transliterate("WAHEGURU");
    expect(r.hits).toBe(1);
    expect(r.output).toBe("ਵਾਹਿਗੁਰੂ");
  });

  it("preserves unknown tokens while mapping known ones", () => {
    const r = transliterate("naam unknownword");
    expect(r.hits).toBe(1);
    expect(r.misses).toEqual(["unknownword"]);
    expect(r.output.startsWith("ਨਾਮ")).toBe(true);
    expect(r.output.endsWith("unknownword")).toBe(true);
  });
});

describe("transliterate — no hits", () => {
  it("returns the original string when no tokens match", () => {
    const r = transliterate("totally unknown english phrase");
    expect(r.hits).toBe(0);
    expect(r.output).toBe("totally unknown english phrase");
    expect(r.misses.length).toBeGreaterThan(0);
  });

  it("handles empty / whitespace input", () => {
    const r1 = transliterate("");
    expect(r1.hits).toBe(0);
    expect(r1.output).toBe("");
    const r2 = transliterate("   ");
    expect(r2.hits).toBe(0);
    expect(r2.output).toBe("   ");
  });
});

describe("dict shape", () => {
  it("has at least 200 entries (plan target)", () => {
    expect(Object.keys(__TEST__.DICT).length).toBeGreaterThanOrEqual(200);
  });
  it("keys are lowercase ASCII", () => {
    for (const k of Object.keys(__TEST__.DICT)) {
      expect(k).toBe(k.toLowerCase());
      for (let i = 0; i < k.length; i++) {
        expect(k.charCodeAt(i)).toBeLessThanOrEqual(0x7f);
      }
    }
  });
  it("values contain Gurmukhi codepoints", () => {
    for (const v of Object.values(__TEST__.DICT)) {
      let hasGurmukhi = false;
      for (let i = 0; i < v.length; i++) {
        const c = v.charCodeAt(i);
        if (c >= 0x0a00 && c <= 0x0a7f) {
          hasGurmukhi = true;
          break;
        }
      }
      expect(hasGurmukhi).toBe(true);
    }
  });
});

describe("tokenize", () => {
  it("splits on non-letter runs and lowercases", () => {
    expect(__TEST__.tokenize("Naam, Simran!")).toEqual(["naam", "simran"]);
  });
});
