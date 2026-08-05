"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { normalizeHexMode } from "@/components/Footer";
import { isIdentityAdjustment } from "@/lib/color-adjust";

/** What a layer's `painted` values mean. Absent is `"fill"`, so every document
 *  saved before hatch layers existed keeps working with no migration. */
export type LayerKind = "fill" | "hatch";

/** Reads a layer's kind, defaulting an absent field to `"fill"`. Use this
 *  everywhere rather than touching `.kind` directly, or old saves misbehave. */
export const layerKind = (l: { kind?: LayerKind }): LayerKind => l.kind ?? "fill";

/**
 * Rounds the corners of every contiguous same-colour region on the layer.
 *
 * `radius` is a 0–1 fraction of one cell stride (`ROUND_RADIUS_AT_FULL`, i.e.
 * `SIDE`), stored as a fraction so the saved value does not depend on `SIDE` —
 * but it denotes an absolute world distance, the *same* one at every corner.
 * That is what lets neighbouring polygons meet airtight under one setting; it is
 * cut back only where the local geometry cannot hold it. See
 * `lib/round-corners.ts`.
 */
export interface RoundCornersEffect {
  type: "roundCorners";
  /** 0–1 fraction of one cell stride. */
  radius: number;
  enabled: boolean;
}

/** A non-destructive per-layer geometry filter. `painted` is never touched —
 *  effects are applied when geometry is built for rendering, so switching one
 *  off restores the artwork exactly. */
export interface OutlineEffect {
  type: "outline";
  /** 0–1 fraction of one cell stride; the stroke width of the region boundary.
   *  See `OUTLINE_WEIGHT_AT_FULL`. */
  weight: number;
  enabled: boolean;
}

/**
 * A non-directional drop shadow cast by the layer onto whatever is beneath it.
 *
 * Two things separate this from a stock drop shadow, and both are load-bearing:
 * it draws *under* the layer that owns it (the layer casts, it does not
 * receive), and it is clipped to the solid cells of the fill layers below — a
 * shadow falls on a surface, it does not hang in mid-air over bare canvas. A
 * glow on the bottommost fill layer therefore renders nothing at all, which is
 * correct and is why `LayerPanel` says so.
 *
 * `radius` is a 0–1 fraction of `GLOW_RADIUS_AT_FULL` denoting the blur σ in
 * world units, stored as a fraction for the same reason as the other two.
 * `color` is *encoded* (`"p,c"`) so the shadow follows palette shifts like all
 * painted data. See `lib/glow.ts`.
 */
export interface GlowEffect {
  type: "glow";
  /** 0–1 fraction of one cell stride; the Gaussian σ. */
  radius: number;
  /** 0–1 peak alpha of the shadow. */
  opacity: number;
  /** Encoded colour, `"paletteIdx,colorIdx"`. */
  color: string;
  enabled: boolean;
}

/**
 * A hue / saturation / brightness filter over the layer's colours.
 *
 * The one effect that is not geometry: it changes what colour a cell renders as,
 * never where it is. Applied to the *resolved* hex on its way to a renderer, so
 * `painted` keeps its encoded values and the layer still follows the global
 * palette shift underneath the filter. All three are −100…100 and 0 is
 * "leave alone"; see `lib/color-adjust.ts`.
 */
export interface AdjustColorEffect {
  type: "adjustColor";
  /** −100 → black, +100 → white. */
  brightness: number;
  /** −100…100 → a half turn of the wheel each way. */
  hue: number;
  /** −100 → grey, +100 → fully saturated. */
  saturation: number;
  enabled: boolean;
}

/** A non-destructive per-layer geometry filter. `painted` is never touched —
 *  effects are applied when geometry is built for rendering, so switching one
 *  off restores the artwork exactly. */
export type LayerEffect =
  | RoundCornersEffect
  | OutlineEffect
  | GlowEffect
  | AdjustColorEffect;

/** Reads a layer's effects, defaulting an absent field to none. Use this rather
 *  than touching `.effects` directly, exactly as with `layerKind`. */
export const layerEffects = (l: { effects?: LayerEffect[] }): LayerEffect[] =>
  l.effects ?? [];

/** The effects that actually change geometry — enabled, and not a no-op. An
 *  effect list that reduces to nothing here must render byte-identically to no
 *  effect at all, which is what keeps existing exports unchanged. */
export const activeEffects = (l: { effects?: LayerEffect[] }): LayerEffect[] =>
  layerEffects(l).filter((e) => {
    if (!e.enabled) return false;
    switch (e.type) {
      case "roundCorners":
        return e.radius > 0;
      case "outline":
        return e.weight > 0;
      case "glow":
        return e.radius > 0 && e.opacity > 0;
      case "adjustColor":
        return !isIdentityAdjustment(e);
    }
  });

export interface Layer {
  id: string;
  name: string;
  /** `"fill"` (or absent): values are encoded colours `"p,c"`.
   *  `"hatch"`: values are encoded hatch marks — see `lib/hatch.ts`. */
  kind?: LayerKind;
  painted: Record<string, string>;
  visible: boolean;
  /** Absent means none, so every document saved before effects existed keeps
   *  working with no migration — the same contract as `kind`. */
  effects?: LayerEffect[];
}

export interface ProjectSnapshot {
  layers: Layer[];
  activeLayerIdx: number;
  gridDivisions: number;
  hexMode: string;
  flowerRadius: number;
  symmetry: string;
  selections: unknown[];
  /** Saved pattern-brush stacks; see `tri-pattern.ts`. */
  patternPresets: unknown[];
  lastPaintTri: string | null;
  /** Set only on snapshots whose hex spacing changed as part of the edit
   *  (the spread-hex-artwork operation). Undo/redo must restore the spacing
   *  from these — unlike ordinary view settings, which are deliberately left
   *  alone so changing one between strokes is not rolled back by Ctrl+Z. */
  spreadHex?: boolean;
}

const STORAGE_KEY = "trixel-save";
const MAX_HISTORY = 50;
const MAX_LAYERS = 5;

function makeLayer(name: string, kind: LayerKind = "fill"): Layer {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    kind,
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
    patternPresets: Array.isArray(data.patternPresets) ? data.patternPresets : [],
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

  const restoreRef = useRef<(s: ProjectSnapshot, from: ProjectSnapshot) => void>(
    () => {},
  );

  const registerRestore = useCallback(
    (fn: (s: ProjectSnapshot, from: ProjectSnapshot) => void) => {
      restoreRef.current = fn;
    },
    [],
  );

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
              patternPresets: Array.isArray(data.patternPresets) ? data.patternPresets : [],
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

  /**
   * Which layer is selected is *where you are*, not what you made, so undo and
   * redo leave it alone — exactly as they leave the grid settings alone, and for
   * the same reason: selecting a layer between two strokes should not be rolled
   * back by undoing one of them. `activeLayerIdx` stays in `ProjectSnapshot`
   * because a saved project should reopen on the layer it was left on; it is
   * only *applying* it that is wrong here.
   *
   * The clamp is the whole reason this is a function rather than a deletion:
   * undoing an "add layer" shortens the stack, and an index left pointing past
   * the end selects nothing.
   */
  const keepActiveLayer = (target: ProjectSnapshot) => {
    setActiveLayerIdx((i) => Math.max(0, Math.min(i, target.layers.length - 1)));
  };

  const handleUndo = useCallback(() => {
    if (historyIdx <= 0) return;
    const from = history[historyIdx];
    const target = history[historyIdx - 1];
    setLayers(target.layers);
    keepActiveLayer(target);
    restoreRef.current(target, from);
    setHistoryIdx((i) => i - 1);
  }, [history, historyIdx]);

  const handleRedo = useCallback(() => {
    if (historyIdx >= history.length - 1) return;
    const from = history[historyIdx];
    const target = history[historyIdx + 1];
    setLayers(target.layers);
    keepActiveLayer(target);
    restoreRef.current(target, from);
    setHistoryIdx((i) => i + 1);
  }, [history, historyIdx]);

  // Both kinds share the "Layer N" numbering: the next number is derived by
  // parsing that prefix, so naming hatch layers anything else makes the parse
  // yield 0 and the next fill layer collides on a name already in use.
  const addLayer = useCallback((kind: LayerKind = "fill") => {
    setLayers((prev) => {
      if (prev.length >= MAX_LAYERS) return prev;
      const nameNums = prev.map((l) => parseInt(l.name.replace("Layer ", ""), 10) || 0);
      const nextNum = Math.max(0, ...nameNums) + 1;
      const next = [...prev, makeLayer(`Layer ${nextNum}`, kind)];
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
          ...makeLayer(`Layer ${nextNum}`, layerKind(src)),
          painted: { ...src.painted },
          visible: src.visible,
          // Deep-copied, or editing one copy's radius would move the other's.
          effects: layerEffects(src).map((e) => ({ ...e })),
        };
        const next = [...prev, dup];
        setActiveLayerIdx(next.length - 1);
        return next;
      });
    },
    [],
  );

  /** Replaces one layer's effect stack. Like every other structural layer edit
   *  the caller follows this with `onCommit()`, so it lands in the undo stack —
   *  effects live on the `Layer`, which is already part of `ProjectSnapshot`. */
  const setLayerEffects = useCallback((idx: number, effects: LayerEffect[]) => {
    setLayers((prev) => {
      const l = prev[idx];
      if (!l) return prev;
      const next = [...prev];
      next[idx] = { ...l, effects };
      return next;
    });
  }, []);

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
    // Exposed so project import can restore a whole layer array. Without it
    // `handleFileChange` could only write the active layer's pixels into
    // whatever layer happened to be selected, and the imported stack only
    // materialised after an undo/redo round trip.
    setLayers,
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
    setLayerEffects,
    moveLayer,
    setActiveLayerIdx,
    resetToSingleLayer,
    layersRef,
    activeLayerIdxRef,
  };
}
