
"use client";

import { useState, useCallback, useMemo } from "react";

const GRID_SIZE = 36;
const SIDE_LENGTH = 6;

/**
 * useGridState manages the state of a 36-triangle side-6 equilateral grid.
 * It uses a calculated symmetry map to ensure 3-fold rotational symmetry 
 * around the centroid of the large triangle.
 */
export function useGridState() {
  const [grid, setGrid] = useState<(string | null)[]>(new Array(GRID_SIZE).fill(null));
  const [history, setHistory] = useState<(string | null)[][]>([]);
  const [redoStack, setRedoStack] = useState<(string | null)[][]>([]);

  // Pre-calculate the symmetry map for a side-6 equilateral triangle.
  // We use the geometric centers of each triangle and rotate them 120/240 degrees.
  const symmetryMap = useMemo(() => {
    const centroids: { x: number; y: number }[] = [];
    const H = Math.sqrt(3) / 2;
    const gridCentroid = { x: SIDE_LENGTH / 2, y: H * SIDE_LENGTH / 3 };

    // Generate centroids for all 36 triangles in row-major order
    for (let r = 0; r < SIDE_LENGTH; r++) {
      for (let k = 0; k < 2 * r + 1; k++) {
        const isUp = k % 2 === 0;
        const x = (SIDE_LENGTH - r - 1) * 0.5 + k * 0.5 + 0.5;
        const y = (SIDE_LENGTH - r - (isUp ? 2/3 : 1/3)) * H;
        centroids.push({ x, y });
      }
    }

    const map: number[][] = [];
    const rotate = (p: { x: number; y: number }, angle: number) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dx = p.x - gridCentroid.x;
      const dy = p.y - gridCentroid.y;
      return {
        x: gridCentroid.x + (dx * cos - dy * sin),
        y: gridCentroid.y + (dx * sin + dy * cos)
      };
    };

    centroids.forEach((c, idx) => {
      const p120 = rotate(c, (2 * Math.PI) / 3);
      const p240 = rotate(c, (4 * Math.PI) / 3);

      const findNearest = (p: { x: number; y: number }) => {
        let minDist = Infinity;
        let nearestIdx = idx;
        centroids.forEach((c2, idx2) => {
          const dist = Math.pow(p.x - c2.x, 2) + Math.pow(p.y - c2.y, 2);
          if (dist < minDist) {
            minDist = dist;
            nearestIdx = idx2;
          }
        });
        return nearestIdx;
      };

      map[idx] = Array.from(new Set([idx, findNearest(p120), findNearest(p240)]));
    });

    return map;
  }, []);

  const addToHistory = useCallback((newGrid: (string | null)[]) => {
    setHistory((prev) => [...prev, grid]);
    setRedoStack([]);
    setGrid(newGrid);
  }, [grid]);

  const updateCell = useCallback((index: number, color: string | null) => {
    const newGrid = [...grid];
    const indices = symmetryMap[index] || [index];

    indices.forEach((i) => {
      newGrid[i] = color;
    });

    addToHistory(newGrid);
  }, [grid, addToHistory, symmetryMap]);

  const setFullPattern = useCallback((indices: number[], color: string) => {
    const newGrid = new Array(GRID_SIZE).fill(null);
    indices.forEach(idx => {
      if (idx >= 0 && idx < GRID_SIZE) {
        newGrid[idx] = color;
      }
    });
    // Ensure the imported/generated pattern is forced to symmetry
    const symmetricalGrid = [...newGrid];
    newGrid.forEach((val, i) => {
      if (val) {
        symmetryMap[i].forEach(symIdx => {
          symmetricalGrid[symIdx] = val;
        });
      }
    });
    addToHistory(symmetricalGrid);
  }, [addToHistory, symmetryMap]);

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
