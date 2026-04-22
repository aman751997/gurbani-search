// U9: Tagline.
//
// Separate component so downstream pages (U10 result card, U12 shabad detail)
// can re-render or style around the brand promise without duplicating it.
// The tagline is the product's brand identity (R5) — it renders as an <h1>
// above the fold on the homepage, and as a smaller element elsewhere.

import type { ReactNode } from "react";

export interface TaglineProps {
  /**
   * HTML heading element to render as. Defaults to `h1` (homepage use).
   * Pages that already have their own h1 should pass "p" or "h2" to avoid
   * multiple h1s on a page (accessibility: one h1 per page).
   */
  as?: "h1" | "h2" | "p";
  className?: string;
  children?: ReactNode;
}

export const TAGLINE_TEXT = "Finds your Gurbani. Never writes it.";

export function Tagline({ as = "h1", className, children }: TaglineProps) {
  const Component = as;
  return (
    <Component
      className={
        className ??
        "max-w-2xl text-center text-4xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50"
      }
    >
      {children ?? TAGLINE_TEXT}
    </Component>
  );
}

export default Tagline;
