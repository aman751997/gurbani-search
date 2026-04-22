#!/usr/bin/env tsx
// One-shot: delete all guard-marker rows (explanation = '') from caption_cache
// so that a subsequent precompute:starter run retries those (query, shabad)
// pairs against the live provider. Real captions (non-empty explanation) are
// preserved.

import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { supabaseServer } = await import("@/lib/db");
  const sb = supabaseServer();
  const { count: before } = await sb
    .from("caption_cache")
    .select("*", { count: "exact", head: true })
    .eq("explanation", "");
  // eslint-disable-next-line no-console
  console.log(`Guard-marker rows before delete: ${before}`);

  const { error } = await sb
    .from("caption_cache")
    .delete()
    .eq("explanation", "");
  if (error) {
    // eslint-disable-next-line no-console
    console.error("delete failed:", error);
    process.exit(1);
  }

  const { count: after } = await sb
    .from("caption_cache")
    .select("*", { count: "exact", head: true })
    .eq("explanation", "");
  // eslint-disable-next-line no-console
  console.log(`Guard-marker rows after delete:  ${after ?? 0}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
