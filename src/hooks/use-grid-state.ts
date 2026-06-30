"use client";

import { useState, useCallback, useMemo } from "react";

/**
 * useGridState manages an infinite sparse grid of triangular cells.
 * Coordinates are stored as "row,col" strings.
 */
export function useGridState() {
  const [grid, setGrid] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [redoStack, setRedoStack] = useState<Record<string, string>[]>([]);

  const addToHistory = useCallback((newGrid: Record<string, string>) => {
    setHistory((prev) => [...prev.slice(-49), grid]); // Limit history to 50 steps
    setRedoStack([]);
    setGrid(newGrid);
  }, [grid]);

  const updateCell = useCallback((id: string, color: string | null) => {
    if (grid[id] === color) return;
    
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
    if (Object.keys(grid).length === 0) return;
    addToHistory({});
  }, [grid, addToHistory]);

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