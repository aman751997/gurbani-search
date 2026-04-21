import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Default for server/lib modules (rateLimit, validateQuery, caption, etc.).
    environment: "node",
    // React component tests (.test.tsx) run in jsdom. Keep node as default so
    // server-only modules aren't accidentally polluted with browser globals.
    environmentMatchGlobs: [["tests/**/*.test.tsx", "jsdom"]],
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
