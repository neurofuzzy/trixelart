"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { normalizeHexMode } from "@/components/Footer";

export interface Layer {
  id: string;
  name: string;
  painted: Record<string, string>;
  visible: boolean;
}

export interface ProjectSnapshot {
  layers: Layer[];
  activeLayerIdx: number;
  gridDivisions: number;
  hexMode: string;
  flowerRadius: number;
  symmetry: string;
  selections: unknown[];
  lastPaintTri: string | null;
}

const STORAGE_KEY = "trixel-save";
const MAX_HISTORY = 50;
const MAX_LAYERS = 5;

function makeLayer(name: string): Layer {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    painted: {},
    visible: true,
  };
}

function defaultLayers(): Layer[] {
  return [makeLayer("Layer 1")];
}

function migrateLegacy(data: { painted?: unknown } & Record<string, unknown>): ProjectSnapshot {
  const painted =
    typeof data.painted === "object" && data.painted !== null
      ? (data.painted as Record<string, string>)
      : {};
  return {
    layers: [{ ...makeLayer("Layer 1"), painted, visible: true }],
    activeLayerIdx: 0,
    gridDivisions: typeof data.gridDivisions === "number" ? data.gridDivisions : 1,
    hexMode: normalizeHexMode(data.hexMode),
    flowerRadius: typeof data.flowerRadius === "number" ? data.flowerRadius : 0,
    symmetry: typeof data.symmetry === "string" ? data.symmetry : "off",
    selections: Array.isArray(data.selections) ? data.selections : [],
    lastPaintTri: typeof data.lastPaintTri === "string" ? data.lastPaintTri : null,
  };
}

export function useHistory() {
  const [mounted, setMounted] = useState(false);
  const [layers, setLayers] = useState<Layer[]>(defaultLayers);
  const [activeLayerIdx, setActiveLayerIdx] = useState(0);
  const [history, setHistory] = useState<ProjectSnapshot[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const activeLayerIdxRef = useRef(activeLayerIdx);
  activeLayerIdxRef.current = activeLayerIdx;
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const restoreRef = useRef<(s: ProjectSnapshot) => void>(() => {});

  const registerRestore = useCallback((fn: (s: ProjectSnapshot) => void) => {
    restoreRef.current = fn;
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        let snap: ProjectSnapshot;
        if (typeof data === "object" && data !== null) {
          if (Array.isArray(data.layers)) {
            snap = {
              layers: data.layers as Layer[],
              activeLayerIdx: typeof data.activeLayerIdx === "number" ? data.activeLayerIdx : 0,
              gridDivisions: data.gridDivisions ?? 1,
              hexMode: normalizeHexMode(data.hexMode),
              flowerRadius: data.flowerRadius ?? 0,
              symmetry: data.symmetry ?? "off",
              selections: Array.isArray(data.selections) ? data.selections : [],
              lastPaintTri: typeof data.lastPaintTri === "string" ? data.lastPaintTri : null,
            };
          } else {
            snap = migrateLegacy(data);
          }
          setLayers(snap.layers);
          setActiveLayerIdx(Math.min(snap.activeLayerIdx, snap.layers.length - 1));
          setHistory([snap]);
          setHistoryIdx(0);
        }
      }
    } catch {
      /* ignore parse errors */
    }
    setMounted(true);
  }, []);

  const painted = layers[activeLayerIdx]?.painted ?? {};

  const setPainted: React.Dispatch<React.SetStateAction<Record<string, string>>> = useCallback(
    (action) => {
      setLayers((prev) => {
        const idx = activeLayerIdxRef.current;
        const next = [...prev];
        const current = next[idx];
        if (!current) return prev;
        next[idx] = {
          ...current,
          painted:
            typeof action === "function"
              ? (action as (prev: Record<string, string>) => Record<string, string>)(current.painted)
              : action,
        };
        return next;
      });
    },
    [],
  );

  const paintedRef = useRef(painted);
  paintedRef.current = painted;

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
    setLayers(target.layers);
    setActiveLayerIdx(target.activeLayerIdx);
    restoreRef.current(target);
    setHistoryIdx((i) => i - 1);
  }, [history, historyIdx]);

  const handleRedo = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const target = history[historyIdx + 1];
    setLayers(target.layers);
    setActiveLayerIdx(target.activeLayerIdx);
    restoreRef.current(target);
    setHistoryIdx((i) => i + 1);
  }, [history, historyIdx]);

  const addLayer = useCallback(() => {
    setLayers((prev) => {
      if (prev.length >= MAX_LAYERS) return prev;
      const nameNums = prev.map((l) => parseInt(l.name.replace("Layer ", ""), 10) || 0);
      const nextNum = Math.max(0, ...nameNums) + 1;
      const next = [...prev, makeLayer(`Layer ${nextNum}`)];
      setActiveLayerIdx(next.length - 1);
      return next;
    });
  }, []);

  const deleteLayer = useCallback(
    (idx: number) => {
      if (idx === 0) return;
      setLayers((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((_, i) => i !== idx);
        setActiveLayerIdx((prevIdx) => Math.min(prevIdx, next.length - 1));
        return next;
      });
    },
    [],
  );

  const duplicateLayer = useCallback(
    (idx: number) => {
      setLayers((prev) => {
        if (prev.length >= MAX_LAYERS) return prev;
        const src = prev[idx];
        if (!src) return prev;
        const nameNums = prev.map((l) => parseInt(l.name.replace("Layer ", ""), 10) || 0);
        const nextNum = Math.max(0, ...nameNums) + 1;
        const dup: Layer = {
          ...makeLayer(`Layer ${nextNum}`),
          painted: { ...src.painted },
          visible: src.visible,
        };
        const next = [...prev, dup];
        setActiveLayerIdx(next.length - 1);
        return next;
      });
    },
    [],
  );

  const toggleLayerVisibility = useCallback((idx: number) => {
    setLayers((prev) => {
      const next = [...prev];
      const l = next[idx];
      if (!l) return prev;
      next[idx] = { ...l, visible: !l.visible };
      return next;
    });
  }, []);

  const moveLayer = useCallback((idx: number, dir: -1 | 1) => {
    setLayers((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      if (target === activeLayerIdxRef.current) setActiveLayerIdx(idx);
      else if (idx === activeLayerIdxRef.current) setActiveLayerIdx(target);
      return next;
    });
  }, []);

  const resetToSingleLayer = useCallback((): Layer[] => {
    const single = defaultLayers();
    setLayers(single);
    setActiveLayerIdx(0);
    return single;
  }, []);

  return {
    mounted,
    layers,
    activeLayerIdx,
    painted,
    setPainted,
    paintedRef,
    history,
    historyIdx,
    pushHistory,
    handleUndo,
    handleRedo,
    registerRestore,
    addLayer,
    deleteLayer,
    duplicateLayer,
    toggleLayerVisibility,
    moveLayer,
    setActiveLayerIdx,
    resetToSingleLayer,
    layersRef,
    activeLayerIdxRef,
  };
}
