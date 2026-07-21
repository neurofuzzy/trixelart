"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Sparkles } from "lucide-react";
import { useState } from "react";

/** The Trixel logo — inlined as JSX (kept in sync with `src/assets/logo.svg`)
 * so it renders without a bundler URL import or next/image config, which keeps
 * it safe under the GitHub Pages static export + basePath. */
function TrixelMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 290 256.507"
      className="h-20 w-auto drop-shadow-lg"
      aria-hidden="true"
    >
      <path
        d="M70,63.302 L120,63.302 L95,106.603 L70,63.302 Z M120,63.302 L170,63.302 L145,106.603 L120,63.302 Z M170,63.302 L220,63.302 L195,106.603 L170,63.302 Z M120,149.904 L170,149.904 L145,193.206 L120,149.904 Z"
        fill="#e7b974"
        stroke="#e7b974"
        strokeWidth="0.5"
      />
      <path
        d="M95,106.603 L120,63.302 L145,106.603 L95,106.603 Z M145,106.603 L170,63.302 L195,106.603 L145,106.603 Z M145,106.603 L170,149.904 L120,149.904 L145,106.603 Z"
        fill="#e29a5a"
        stroke="#e29a5a"
        strokeWidth="0.5"
      />
      <path
        d="M95,106.603 L145,106.603 L120,149.904 L95,106.603 Z M145,106.603 L195,106.603 L170,149.904 L145,106.603 Z"
        fill="#b63420"
        stroke="#b63420"
        strokeWidth="0.5"
      />
      <path
        d="M95,106.603 L120,149.904 L145,193.206 L170,149.904 L195,106.603 L220,63.302 L170,63.302 L120,63.302 L70,63.302 L95,106.603 Z M95,193.206 L70,149.904 L45,106.603 L20,63.302 L45,20 L95,20 L145,20 L195,20 L245,20 L270,63.302 L245,106.603 L220,149.904 L195,193.206 L170,236.507 L120,236.507 L95,193.206 Z"
        fill="#5f1116"
        stroke="#5f1116"
        strokeWidth="0.5"
      />
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
