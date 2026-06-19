"use client";

import { useState, useCallback } from "react";

const GRID_SIZE = 36;
const SYMMETRY_FACTOR = 3;

export function useGridState() {
  const [grid, setGrid] = useState<(string | null)[]>(new Array(GRID_SIZE).fill(null));
  const [history, setHistory] = useState<(string | null)[][]>([]);
  const [redoStack, setRedoStack] = useState<(string | null)[][]>([]);

  const addToHistory = useCallback((newGrid: (string | null)[]) => {
    setHistory((prev) => [...prev, grid]);
    setRedoStack([]);
    setGrid(newGrid);
  }, [grid]);

  const updateCell = useCallback((index: number, color: string | null) => {
    const newGrid = [...grid];
    // 3-fold rotational symmetry: index, (index + 12) % 36, (index + 24) % 36
    const indices = [
      index,
      (index + 12) % GRID_SIZE,
      (index + 24) % GRID_SIZE,
    ];

    indices.forEach((i) => {
      newGrid[i] = color;
    });

    addToHistory(newGrid);
  }, [grid, addToHistory]);

  const setFullPattern = useCallback((indices: number[], color: string) => {
    const newGrid = new Array(GRID_SIZE).fill(null);
    indices.forEach(idx => {
      if (idx >= 0 && idx < GRID_SIZE) {
        newGrid[idx] = color;
      }
    });
    addToHistory(newGrid);
  }, [addToHistory]);

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
    addToHistory(new Array(GRID_SIZE).fill(null));
  }, [addToHistory]);

  const importGrid = useCallback((newGrid: (string | null)[]) => {
    if (newGrid.length === GRID_SIZE) {
      addToHistory(newGrid);
    }
  }, [addToHistory]);

  return {
    grid,
    updateCell,
    undo,
    redo,
    clear,
    importGrid,
    setFullPattern,
    canUndo: history.length > 0,
    canRedo: redoStack.length > 0,
  };
}
