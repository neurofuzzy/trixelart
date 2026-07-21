"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles } from "lucide-react";
import { useState } from "react";

/** A small triangular-grid motif standing in for a logo — echoes the app's
 * trixel canvas. */
function TrixelMark() {
  return (
    <svg
      viewBox="0 0 120 104"
      className="h-16 w-auto drop-shadow-lg"
      aria-hidden="true"
    >
      {/* Row of up/down triangles in the app's accent tints. */}
      {[
        { pts: "30,52 60,0 90,52", fill: "rgb(6 182 212 / 0.85)" },
        { pts: "0,104 30,52 60,104", fill: "rgb(6 182 212 / 0.45)" },
        { pts: "60,104 90,52 120,104", fill: "rgb(6 182 212 / 0.6)" },
        { pts: "30,52 60,104 90,52", fill: "rgb(6 182 212 / 0.25)" },
        { pts: "60,0 90,52 60,104", fill: "rgb(168 85 247 / 0.55)" },
        { pts: "30,52 60,0 60,104", fill: "rgb(168 85 247 / 0.35)" },
      ].map((t, i) => (
        <polygon key={i} points={t.pts} fill={t.fill} />
      ))}
    </svg>
  );
}

/**
 * First-run welcome screen: the Trixel mark, a short blurb, a "Don't show again"
 * checkbox, and a primary button that launches the interface tour. Visibility is
 * driven by `open` (seeded from a localStorage flag by useOnboarding), so it
 * appears on a fresh visit and never again once dismissed.
 */
export function SplashDialog({
  open,
  onClose,
  onStartTour,
}: {
  open: boolean;
  /** Called with whether the user checked "Don't show again". */
  onClose: (dontShowAgain: boolean) => void;
  onStartTour: () => void;
}) {
  const [dontShow, setDontShow] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose(dontShow)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl
            border bg-card p-8 text-card-foreground shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="sr-only">Welcome to Trixel</Dialog.Title>
          <Dialog.Description className="sr-only">
            Welcome screen with an option to take a guided tour of the interface.
          </Dialog.Description>

          <div className="flex flex-col items-center text-center">
            <TrixelMark />
            <h2 className="mt-5 text-lg font-semibold">Welcome to Trixel</h2>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              A drawing tool for triangular-grid pixel art. New here? Take a
              quick tour of the interface.
            </p>

            <div className="mt-7 flex items-center gap-3">
              <button
                onClick={() => onClose(dontShow)}
                className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                Skip
              </button>
              <button
                onClick={onStartTour}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Sparkles size={15} /> Take the tour
              </button>
            </div>

            <label className="mt-6 flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={dontShow}
                onChange={(e) => setDontShow(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-cyan-500"
              />
              Don&apos;t show this again
            </label>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
