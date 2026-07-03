"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "symmetria-save";
const MAX_HISTORY = 50;

export function useHistory() {
  const [mounted, setMounted] = useState(false);
  const [painted, setPainted] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setPainted(data);
        setHistory([data]);
        setHistoryIdx(0);
      } catch (e) {
        console.error("Failed to load save", e);
      }
    }
  }, []);

  useEffect(() => {
    if (mounted)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(painted));
  }, [painted, mounted]);

  const pushHistory = useCallback(
    (newState: Record<string, string>) => {
      setHistory((prev) => {
        const next = prev.slice(0, historyIdx + 1);
        next.push({ ...newState });
        if (next.length > MAX_HISTORY) next.shift();
        return next;
      });
      setHistoryIdx((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
    },
    [historyIdx],
  );

  const handleUndo = useCallback(() => {
    if (historyIdx > 0) {
      setPainted(history[historyIdx - 1]);
      setHistoryIdx(historyIdx - 1);
    }
  }, [history, historyIdx]);

  const handleRedo = useCallback(() => {
    if (historyIdx < history.length - 1) {
      setPainted(history[historyIdx + 1]);
      setHistoryIdx(historyIdx + 1);
    }
  }, [history, historyIdx]);

  const clearCanvas = useCallback(() => {
    const empty = {};
    setPainted(empty);
    pushHistory(empty);
  }, [pushHistory]);

  return {
    mounted,
    painted,
    setPainted,
    history,
    historyIdx,
    pushHistory,
    handleUndo,
    handleRedo,
    clearCanvas,
  };
}
