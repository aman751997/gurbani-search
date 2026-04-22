/**
 * Test vectors for lib/sha256.ts. Drawn from NIST FIPS 180-4 §B.
 */
import { describe, it, expect } from "vitest";
import { sha256Hex } from "@/lib/sha256";

describe("sha256Hex — known answer tests", () => {
  it("empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("long string (448 bits — boundary case for padding)", () => {
    expect(
      sha256Hex(
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      ),
    ).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("1000 repetitions of 'a' (multi-block)", () => {
    expect(sha256Hex("a".repeat(1000))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });

  it("UTF-8 encoded unicode string", () => {
    // Reference value computed via node:crypto in dev — locked here.
    expect(sha256Hex("café")).toBe(
      "850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e",
    );
  });

  it("is stable for the same input", () => {
    expect(sha256Hex("gurbani")).toBe(sha256Hex("gurbani"));
  });

  it("differs for different inputs", () => {
    expect(sha256Hex("gurbani")).not.toBe(sha256Hex("gurbanī"));
  });

  it("produces a 64-char lowercase hex digest", () => {
    const h = sha256Hex("x");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
