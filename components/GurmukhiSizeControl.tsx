// Cycles --gurmukhi-scale on <html> through S/M/L presets. Persists to
// localStorage so the choice survives page navigation.

"use client";

import { useCallback, useEffect, useState } from "react";

export type GurmukhiSize = "S" | "M" | "L";
const STORAGE_KEY = "gurmukhi-size";
const SCALE: Record<GurmukhiSize, string> = {
  S: "0.875",
  M: "1",
  L: "1.25",
};
const ORDER: readonly GurmukhiSize[] = ["S", "M", "L"];

function isSize(v: unknown): v is GurmukhiSize {
  return v === "S" || v === "M" || v === "L";
}

function applyScale(size: GurmukhiSize): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--gurmukhi-scale",
    SCALE[size],
  );
}

export function GurmukhiSizeControl() {
  // Default to M pre-hydration so SSR and first client render agree.
  const [size, setSize] = useState<GurmukhiSize>("M");

  // Rehydrate from localStorage once mounted.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isSize(stored)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe localStorage hydration; must run in effect to avoid hydration mismatch
        setSize(stored);
        applyScale(stored);
        return;
      }
    } catch {
      /* storage blocked (private mode) — stay at default */
    }
    applyScale("M");
  }, []);

  const cycle = useCallback(() => {
    setSize((current) => {
      const idx = ORDER.indexOf(current);
      const next = ORDER[(idx + 1) % ORDER.length];
      applyScale(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Gurmukhi font size: ${size}. Click to change.`}
      title="Change Gurmukhi font size"
      className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-xs font-semibold tracking-wide text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      <span aria-hidden="true">A</span>
      <span className="ml-1" aria-hidden="true">
        {size}
      </span>
    </button>
  );
}

export default GurmukhiSizeControl;
