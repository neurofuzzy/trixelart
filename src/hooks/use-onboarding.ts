"use client";

import { useState, useCallback } from "react";
import { TOUR_STEPS } from "@/components/onboarding/tour-steps";

const SEEN_KEY = "trixel-onboarding-seen";

/** Whether the first-run splash should show. Read lazily (client-only) from the
 * persisted "seen" flag. Safe against hydration mismatch because TrixelGrid
 * renders a placeholder until mounted, so nothing here is in the SSR tree. */
function initialSplashOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !localStorage.getItem(SEEN_KEY);
  } catch {
    return false;
  }
}

/**
 * Onboarding state: the first-run splash, the keyboard-shortcuts help dialog,
 * and the spotlight interface tour. Mirrors voxpaint's zustand-based flow but
 * uses local React state since this app has no external store.
 *
 * The splash opens once on a fresh visit (gated by a localStorage flag) and
 * never again once dismissed. Help and the tour can be reopened any time.
 */
export function useOnboarding() {
  const [splashOpen, setSplashOpen] = useState(initialSplashOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const closeSplash = useCallback(
    (dontShowAgain: boolean) => {
      setSplashOpen(false);
      if (dontShowAgain) markSeen();
    },
    [markSeen],
  );

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const startTour = useCallback(() => {
    setSplashOpen(false);
    setHelpOpen(false);
    setTourStep(0);
    setTourActive(true);
    markSeen();
  }, [markSeen]);

  const endTour = useCallback(() => setTourActive(false), []);
  const tourNext = useCallback(
    () => setTourStep((s) => Math.min(s + 1, TOUR_STEPS.length - 1)),
    [],
  );
  const tourPrev = useCallback(() => setTourStep((s) => Math.max(s - 1, 0)), []);

  return {
    splashOpen,
    closeSplash,
    helpOpen,
    openHelp,
    closeHelp,
    tourActive,
    tourStep,
    startTour,
    endTour,
    tourNext,
    tourPrev,
  };
}
