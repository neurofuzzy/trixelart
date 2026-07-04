"use client";

import { useEffect } from "react";

export function useKeyboardShortcuts(
  handleUndo: () => void,
  handleRedo: () => void,
  setTool: (tool: "paint" | "erase" | "pan" | "select" | "stamp") => void,
  setColor: (color: string) => void,
  palette: string[],
) {
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      )
        return;

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
      if (colorIdx >= 0 && colorIdx < palette.length) {
        setColor(palette[colorIdx]);
        setTool("paint");
      }
    };

    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [handleUndo, handleRedo, setTool, setColor]);
}
