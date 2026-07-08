"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { normalizeHexMode } from "@/components/Footer";

export interface ProjectSnapshot {
  painted: Record<string, string>;
  gridDivisions: number;
  hexMode: string;
  flowerRadius: number;
  symmetry: string;
  selections: unknown[];
  lastPaintTri: string | null;
}

const STORAGE_KEY = "trixel-save";
const MAX_HISTORY = 50;

export function useHistory() {
  const [mounted, setMounted] = useState(false);
  const [painted, setPainted] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<ProjectSnapshot[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const restoreRef = useRef<(s: ProjectSnapshot) => void>(() => {});

  const registerRestore = useCallback((fn: (s: ProjectSnapshot) => void) => {
    restoreRef.current = fn;
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (typeof data === "object" && data !== null) {
          if ("painted" in data && typeof data.painted === "object") {
            const snap: ProjectSnapshot = {
              painted: data.painted,
              gridDivisions: data.gridDivisions ?? 1,
              hexMode: normalizeHexMode(data.hexMode),
              flowerRadius: data.flowerRadius ?? 0,
              symmetry: data.symmetry ?? "off",
              selections: Array.isArray(data.selections) ? data.selections : [],
              lastPaintTri:
                typeof data.lastPaintTri === "string"
                  ? data.lastPaintTri
                  : null,
            };
            setPainted(snap.painted);
            setHistory([snap]);
            setHistoryIdx(0);
          } else {
            setPainted(data);
            setHistory([
              {
                painted: data,
                gridDivisions: 1,
                hexMode: "world",
                flowerRadius: 0,
                symmetry: "off",
                selections: [],
                lastPaintTri: null,
              },
            ]);
            setHistoryIdx(0);
          }
        }
      }
    } catch {
      /* ignore parse errors */
    }
    setMounted(true);
  }, []);

  const pushHistory = useCallback(
    (snap: ProjectSnapshot) => {
      setHistory((prev) => {
        const next = prev.slice(0, historyIdx + 1);
        next.push({ ...snap });
        if (next.length > MAX_HISTORY) next.shift();
        return next;
      });
      setHistoryIdx((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
    },
    [historyIdx],
  );

  const handleUndo = useCallback(() => {
    if (historyIdx <= 0) return;
    const target = history[historyIdx - 1];
    setPainted(target.painted);
    restoreRef.current(target);
    setHistoryIdx((i) => i - 1);
  }, [history, historyIdx]);

  const handleRedo = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const target = history[historyIdx + 1];
    setPainted(target.painted);
    restoreRef.current(target);
    setHistoryIdx((i) => i + 1);
  }, [history, historyIdx]);

  return {
    mounted,
    painted,
    setPainted,
    history,
    historyIdx,
    pushHistory,
    handleUndo,
    handleRedo,
    registerRestore,
  };
}
