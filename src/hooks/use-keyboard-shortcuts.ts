"use client";

import { useEffect } from "react";

export function useKeyboardShortcuts(
  handleUndo: () => void,
  handleRedo: () => void,
  setTool: (tool: "paint" | "erase" | "pan" | "select" | "stamp") => void,
  setColorIdx: (idx: number) => void,
  colorCount: number,
  onClearSelection?: () => void,
  onDeleteSelection?: () => void,
) {
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      if (e.key === "Escape") {
        onClearSelection?.();
        return;
      }

      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      )
        return;

      if (e.key === "Delete" || e.key === "Backspace") {
        onDeleteSelection?.();
        return;
      }

      if (e.key.toLowerCase() === "p") {
        setTool("paint");
      } else if (e.key.toLowerCase() === "e") {
        setTool("erase");
      } else if (e.key.toLowerCase() === "h") {
        setTool("pan");
      } else if (e.key.toLowerCase() === "s") {
        setTool("select");
      } else if (e.key.toLowerCase() === "t") {
        setTool("stamp");
      }

      const colorIdx = parseInt(e.key) - 1;
      if (colorIdx >= 0 && colorIdx < colorCount) {
        setColorIdx(colorIdx);
        setTool("paint");
      }
    };

    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [handleUndo, handleRedo, setTool, setColorIdx, colorCount, onClearSelection, onDeleteSelection]);
}
