"use client";

import { useEffect } from "react";
import type { Tool } from "@/lib/tools";

export function useKeyboardShortcuts(
  handleUndo: () => void,
  handleRedo: () => void,
  setTool: (tool: Tool) => void,
  setColorIdx: (idx: number) => void,
  colorCount: number,
  onClearSelection?: () => void,
  onDeleteSelection?: () => void,
  onShiftUp?: () => void,
  onShiftDown?: () => void,
  onPaletteShift?: (direction: number) => void,
  onRotate?: () => void,
  onRotateCCW?: () => void,
  hasSelection?: boolean,
  onSaveProject?: () => void,
  onLoadProject?: () => void,
) {
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSaveProject?.();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onLoadProject?.();
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

      if (e.key === "ArrowUp") {
        if (onShiftUp && !e.metaKey && !e.ctrlKey && !e.altKey && hasSelection) {
          e.preventDefault();
          onShiftUp();
          return;
        }
      } else if (e.key === "ArrowDown") {
        if (onShiftDown && !e.metaKey && !e.ctrlKey && !e.altKey && hasSelection) {
          e.preventDefault();
          onShiftDown();
          return;
        }
      } else if (e.key === "ArrowLeft") {
        if (onPaletteShift && !e.metaKey && !e.ctrlKey && !e.altKey && hasSelection) {
          e.preventDefault();
          onPaletteShift(-1);
          return;
        }
      } else if (e.key === "ArrowRight") {
        if (onPaletteShift && !e.metaKey && !e.ctrlKey && !e.altKey && hasSelection) {
          e.preventDefault();
          onPaletteShift(1);
          return;
        }
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
      } else if (e.key.toLowerCase() === "c") {
        setTool("clone");
      } else if (e.key.toLowerCase() === "d") {
        setTool("dodge");
      } else if (e.key.toLowerCase() === "b") {
        setTool("burn");
      } else if (e.key.toLowerCase() === "i") {
        setTool("eyedropper");
      } else if (e.key.toLowerCase() === "r") {
        if (e.shiftKey && onRotateCCW) {
          setTool("select");
          onRotateCCW();
        } else if (!e.shiftKey && onRotate) {
          setTool("select");
          onRotate();
        }
      }

      const colorIdx = parseInt(e.key) - 1;
      if (colorIdx >= 0 && colorIdx < colorCount) {
        setColorIdx(colorIdx);
        setTool("paint");
      }
    };

    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [handleUndo, handleRedo, setTool, setColorIdx, colorCount, onClearSelection, onDeleteSelection, onShiftUp, onShiftDown, onPaletteShift, onRotate, onRotateCCW, hasSelection, onSaveProject, onLoadProject]);
}
