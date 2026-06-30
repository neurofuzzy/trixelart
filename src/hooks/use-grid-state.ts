
"use client";

import { useState, useCallback } from "react";

/**
 * useGridState manages a sparse infinite grid of triangular cells.
 * Uses a coordinate string key "row,col" to store colors.
 */
export function useGridState() {
  const [grid, setGrid] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [redoStack, setRedoStack] = useState<Record<string, string>[]>([]);

  const addToHistory = useCallback((newGrid: Record<string, string>) => {
    setHistory((prev) => [...prev, grid]);
    setRedoStack([]);
    setGrid(newGrid);
  }, [grid]);

  const updateCell = useCallback((id: string, color: string | null) => {
    const newGrid = { ...grid };
    if (color) {
      newGrid[id] = color;
    } else {
      delete newGrid[id];
    }
    addToHistory(newGrid);
  }, [grid, addToHistory]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRedoStack((prev) => [...prev, grid]);
    setHistory((prev) => prev.slice(0, -1));
    setGrid(previous);
  }, [grid, history]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory((prev) => [...prev, grid]);
    setRedoStack((prev) => prev.slice(0, -1));
    setGrid(next);
  }, [grid, redoStack]);

  const clear = useCallback(() => {
    addToHistory({});
  }, [addToHistory]);

  const importGrid = useCallback((newGrid: Record<string, string>) => {
    addToHistory(newGrid);
  }, [addToHistory]);

  return {
    grid,
    updateCell,
    undo,
    redo,
    clear,
    importGrid,
    canUndo: history.length > 0,
    canRedo: redoStack.length > 0,
  };
}
