
"use client";

import { useState, useCallback } from "react";

const GRID_SIZE = 36;

/**
 * useGridState manages the state of a 36-triangle side-6 equilateral grid.
 * The grid is a simple triangular layout where total triangles = 6^2 = 36.
 * It exhibits 3-fold rotational symmetry around its centroid (which is a vertex where 6 triangles meet).
 * 
 * The 36 triangles are indexed 0-35, corresponding to rows 0-5.
 * Row 0: 1 triangle, Row 1: 3, Row 2: 5, Row 3: 7, Row 4: 9, Row 5: 11.
 */
export function useGridState() {
  const [grid, setGrid] = useState<(string | null)[]>(new Array(GRID_SIZE).fill(null));
  const [history, setHistory] = useState<(string | null)[][]>([]);
  const [redoStack, setRedoStack] = useState<(string | null)[][]>([]);

  const addToHistory = useCallback((newGrid: (string | null)[]) => {
    setHistory((prev) => [...prev, grid]);
    setRedoStack([]);
    setGrid(newGrid);
  }, [grid]);

  /**
   * For a side-6 equilateral triangle, the 3-fold symmetry around the centroid
   * partitions the 36 triangles into 12 triplets.
   * Mapping index -> [s1, s2, s3]
   */
  const getSymmetricIndices = useCallback((index: number) => {
    // Each sector of the side-6 triangle contains 12 triangles.
    // Index i in sector 0 maps to i+12 and i+24.
    const sectorSize = 12;
    const base = index % sectorSize;
    return [base, base + sectorSize, base + (sectorSize * 2)];
  }, []);

  const updateCell = useCallback((index: number, color: string | null) => {
    const newGrid = [...grid];
    const indices = getSymmetricIndices(index);

    indices.forEach((i) => {
      newGrid[i] = color;
    });

    addToHistory(newGrid);
  }, [grid, addToHistory, getSymmetricIndices]);

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
