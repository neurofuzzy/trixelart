"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { TOUR_STEPS, type TourPlacement } from "./tour-steps";

const HIGHLIGHT_PAD = 8;
const CALLOUT_GAP = 14;
const CARD_WIDTH = 320;
const CARD_EST_HEIGHT = 200;

type Rect = { top: number; left: number; width: number; height: number };

/** Where to float the callout card, given the highlighted rect and preferred
 * placement. Clamps to the viewport so the card is always fully visible even
 * for edge/corner targets. */
function calloutStyle(
  rect: Rect,
  placement: TourPlacement,
): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(8, Math.min(x, vw - CARD_WIDTH - 8));
  const clampY = (y: number) =>
    Math.max(8, Math.min(y, vh - CARD_EST_HEIGHT - 8));
  const centerX = clampX(rect.left + rect.width / 2 - CARD_WIDTH / 2);
  const centerY = clampY(rect.top + rect.height / 2 - CARD_EST_HEIGHT / 2);

  switch (placement) {
    case "bottom":
      return {
        top: rect.top + rect.height + HIGHLIGHT_PAD + CALLOUT_GAP,
        left: centerX,
      };
    case "top":
      return {
        top: Math.max(
          8,
          rect.top - HIGHLIGHT_PAD - CALLOUT_GAP - CARD_EST_HEIGHT,
        ),
        left: centerX,
      };
    case "right":
      return {
        top: centerY,
        left: clampX(rect.left + rect.width + HIGHLIGHT_PAD + CALLOUT_GAP),
      };
    case "left":
      return {
        top: centerY,
        left: clampX(rect.left - HIGHLIGHT_PAD - CALLOUT_GAP - CARD_WIDTH),
      };
  }
}

/**
 * The spotlight interface tour: dims the whole app and rings one real UI region
 * at a time (anchored via `data-tour` attributes — see tour-steps.ts), with a
 * floating Next/Back/Skip callout. Renders nothing unless `active`. Reads the
 * live bounding rect of each step's target on step change and on resize/scroll,
 * so it tracks the actual layout rather than hard-coded coordinates. If a target
 * is missing or not visible (e.g. hidden on small screens), it advances past it.
 * Escape ends the tour.
 */
export function InterfaceTour({
  active,
  step,
  next,
  prev,
  end,
}: {
  active: boolean;
  step: number;
  next: () => void;
  prev: () => void;
  end: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);

  const current = TOUR_STEPS[step];
  const isLast = step >= TOUR_STEPS.length - 1;

  // Measure the current target; skip past a missing or zero-size (hidden) one
  // so the tour never gets stuck on a step whose element isn't visible.
  useLayoutEffect(() => {
    if (!active) return;
    if (!current) {
      end();
      return;
    }
    function measure() {
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      const r = el?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) {
        if (isLast) end();
        else next();
        return;
      }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, current, isLast, next, end]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        end();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, end]);

  if (!active || !current || !rect) return null;

  return (
    <>
      {/* Transparent click-catcher: blocks interaction with the app behind it
          while the tour runs (the callout card sits above at a higher z-index). */}
      <div className="fixed inset-0 z-[60]" />

      {/* Spotlight: the box-shadow dims everything outside this rect and draws
          the accent ring. */}
      <div
        className="pointer-events-none fixed rounded-xl transition-all duration-200 z-[60]"
        style={{
          top: rect.top - HIGHLIGHT_PAD,
          left: rect.left - HIGHLIGHT_PAD,
          width: rect.width + HIGHLIGHT_PAD * 2,
          height: rect.height + HIGHLIGHT_PAD * 2,
          boxShadow:
            "0 0 0 2px rgb(6 182 212 / 0.9), 0 0 0 9999px rgb(0 0 0 / 0.65)",
        }}
      />

      {/* Callout card. */}
      <div
        className="fixed w-80 rounded-xl border bg-card p-4 text-card-foreground shadow-2xl z-[61]"
        style={calloutStyle(rect, current.placement)}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">{current.title}</h3>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {step + 1} / {TOUR_STEPS.length}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {current.body}
        </p>
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={end}
            className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="rounded-md px-3 py-1.5 text-xs text-foreground hover:bg-accent"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? end() : next())}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
