// Validates the gold-set YAML parses cleanly against the schema.
//
// Two layers:
//   1. Pure schema-contract tests — always run, use inline fixtures.
//   2. Committed-file tests — run only if eval/gold-set.yaml exists. They
//      assert the actual committed file is well-formed. Before the file is
//      bootstrapped (via `npm run eval:bootstrap`) the checks are skipped
//      with a console warning, not a failure.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { loadGoldSet, GoldSetSchema, GOLD_SET_PATH } from "@/eval/run-eval";

const fileExists = existsSync(GOLD_SET_PATH);

describe.skipIf(!fileExists)("eval/gold-set.yaml (committed file)", () => {
  it("file exists at the canonical path", async () => {
    await expect(
      access(GOLD_SET_PATH, constants.R_OK),
    ).resolves.not.toThrow();
  });

  it("parses and validates against the schema", async () => {
    const loaded = await loadGoldSet();
    const parsed = GoldSetSchema.safeParse(loaded);
    expect(parsed.success).toBe(true);
  });

  it("has 75 entries (50 english + 25 roman-punjabi)", async () => {
    const loaded = await loadGoldSet();
    expect(loaded).toHaveLength(75);
    const en = loaded.filter((e) => e.query_language === "english");
    const rp = loaded.filter((e) => e.query_language === "roman-punjabi");
    expect(en.length).toBe(50);
    expect(rp.length).toBe(25);
  });

  it("every entry has a non-empty query and non-empty relevant array", async () => {
    const loaded = await loadGoldSet();
    for (const e of loaded) {
      expect(e.query.trim()).not.toBe("");
      expect(Array.isArray(e.relevant)).toBe(true);
      expect(e.relevant.length).toBeGreaterThan(0);
      for (const id of e.relevant) {
        expect(typeof id).toBe("string");
        expect((id as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("query_language is always english or roman-punjabi", async () => {
    const loaded = await loadGoldSet();
    for (const e of loaded) {
      expect(["english", "roman-punjabi"]).toContain(e.query_language);
    }
  });
});

describe("GoldSetSchema (unit)", () => {
  it("accepts a minimal valid entry", () => {
    const r = GoldSetSchema.safeParse([
      { query: "anger", query_language: "english", relevant: ["a"] },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects empty query", () => {
    const r = GoldSetSchema.safeParse([
      { query: "", query_language: "english", relevant: ["a"] },
    ]);
    expect(r.success).toBe(false);
  });

  it("rejects invalid language", () => {
    const r = GoldSetSchema.safeParse([
      { query: "x", query_language: "hindi", relevant: ["a"] },
    ]);
    expect(r.success).toBe(false);
  });

  it("rejects empty relevant array", () => {
    const r = GoldSetSchema.safeParse([
      { query: "x", query_language: "english", relevant: [] },
    ]);
    expect(r.success).toBe(false);
  });

  it("accepts optional notes field", () => {
    const r = GoldSetSchema.safeParse([
      { query: "x", query_language: "english", relevant: ["a"], notes: "n" },
    ]);
    expect(r.success).toBe(true);
  });

  it("accepts numeric relevant ids and lets the caller stringify", () => {
    const r = GoldSetSchema.safeParse([
      { query: "x", query_language: "english", relevant: [1234] },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects non-array top level", () => {
    const r = GoldSetSchema.safeParse({ query: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects empty top-level array", () => {
    const r = GoldSetSchema.safeParse([]);
    expect(r.success).toBe(false);
  });
});
