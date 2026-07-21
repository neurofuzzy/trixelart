"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { worldToTri, triToString, type TriKey } from "@/lib/grid-math";
import {
  flowerOffsets,
  paintTargets,
  triToHex,
  getHexWedgeTrixels,
  type Symmetry,
  type SelectionSnapshot,
} from "@/lib/hex-flower";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  WHEEL_DIVISOR,
  PINCH_SENSITIVITY,
} from "@/lib/config";
import { toolMap, viewPanTool, type Tool, type ToolContext, type DragState } from "@/lib/tools";
import type { Layer } from "@/hooks/use-history";
import { normPoint, normTouchPair } from "@/lib/touch-utils";

interface UseInteractionArgs {
  size: { width: number; height: number };
  view: { x: number; y: number; zoom: number };
  setView: React.Dispatch<
    React.SetStateAction<{ x: number; y: number; zoom: number }>
  >;
  tool: Tool;
  setTool: (tool: Tool) => void;
  color: string;
  setColor: (color: string) => void;
  painted: Record<string, string>;
  setPainted: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onCommit: () => void;
  containerRef: { current: HTMLDivElement | null };
  flowerRadius: number;
  gridDivisions: number;
  symmetry: Symmetry;
  selectedHexes: { c: number; k: number }[];
  setSelectedHexes: React.Dispatch<React.SetStateAction<{ c: number; k: number }[]>>;
  activeSelection: SelectionSnapshot | null;
  setActiveSelection: (s: SelectionSnapshot | null) => void;
  setSelections: React.Dispatch<React.SetStateAction<SelectionSnapshot[]>>;
  onStampCapture?: (c: number, k: number) => void;
  cloneSource: { x: number; y: number; q: number; r: number; type: string } | null;
  onCloneCapture?: (x: number, y: number, c: number, k: number, q: number, r: number, type: string) => void;
  cloneOffset: { x: number; y: number } | null;
  onCloneOffset?: (o: { x: number; y: number } | null) => void;
  captureMode?: boolean;
  setCaptureMode?: (v: boolean) => void;
  gridRotation?: number;
  hexEnabled?: boolean;
  brushSize?: "single" | "hex";
  layers: Layer[];
  activeLayerIdx: number;
}

export function useInteraction(args: UseInteractionArgs) {
  const {
    size,
    view,
    setView,
    tool,
    setTool,
    color,
    setColor,
    painted,
    setPainted,
    onCommit,
    containerRef,
    flowerRadius,
    gridDivisions,
    symmetry,
    selectedHexes,
    setSelectedHexes,
    activeSelection,
    setActiveSelection,
    setSelections,
    onStampCapture,
    cloneSource,
    onCloneCapture,
    cloneOffset,
    onCloneOffset,
    captureMode,
    setCaptureMode,
    gridRotation = 0,
    hexEnabled = true,
    brushSize = "single",
    layers,
    activeLayerIdx,
  } = args;

  const [hoveredTri, setHoveredTri] = useState<TriKey | null>(null);

  const drag = useRef<DragState>({ kind: "idle" });

  // Mirrored refs so callbacks don't need dependency on view/size objects
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const paintedRef = useRef(painted);
  paintedRef.current = painted;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const symmetryRef = useRef(symmetry);
  symmetryRef.current = symmetry;
  const gridDivisionsRef = useRef(gridDivisions);
  gridDivisionsRef.current = gridDivisions;
  const hexEnabledRef = useRef(hexEnabled);
  hexEnabledRef.current = hexEnabled;
  const selectedHexesRef = useRef(selectedHexes);
  selectedHexesRef.current = selectedHexes;
  const activeSelectionRef = useRef(activeSelection);
  activeSelectionRef.current = activeSelection;
  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

  const lastPaintTriRef = useRef<TriKey | null>(null);
  const lastEditToolRef = useRef<Tool | null>(null);
  const lastHoveredTriRef = useRef<TriKey | null>(null);

  // Inverse-rotation coefficients for screen->world. Forward canvas
  // transform is screen = center + zoom * R(θ) * (world + view), so the
  // inverse is world = R(-θ) * (screen - center) / zoom - view. Computed
  // once per render so all pointer handlers share the same orientation.
  const invCos = Math.cos(-gridRotation);
  const invSin = Math.sin(-gridRotation);

  // Two-finger gesture state
  const isTwoFinger = useRef(false);
  const pinch = useRef<{
    dist: number;
    worldAtMid: { x: number; y: number };
    startView: { x: number; y: number; zoom: number };
  } | null>(null);

  // Flower copy offsets — recomputed when radius or N changes.
  const flowerOffsetsRef = useRef<Array<{ dq: number; dr: number }>>([]);
  useEffect(() => {
    if (flowerRadius > 0 && gridDivisions > 0) {
      flowerOffsetsRef.current = flowerOffsets(flowerRadius, gridDivisions);
    } else {
      flowerOffsetsRef.current = [];
    }
  }, [flowerRadius, gridDivisions]);

  // Ghost-preview targets: the hovered trixel expanded through brush size,
  // flower, and symmetry. Recomputed whenever the hover or any setting
  // changes; rendered on the canvas so users can see what a paint would
  // land on before clicking.
  const hoverTargets = useMemo<TriKey[]>(() => {
    if (!hoveredTri) return [];
    if (tool === "select" || tool === "stamp" || tool === "eyedropper" || tool === "fill")
      return [hoveredTri];
    const N = gridDivisions;
    const offsets =
      N > 0 ? flowerOffsets(flowerRadius, N) : [];
    const symN = hexEnabledRef.current ? N : 0;
    const seeds =
      brushSize === "hex" && N > 0
        ? getHexWedgeTrixels(hoveredTri, N)
        : [hoveredTri];
    const out = new Map<string, TriKey>();
    for (const seed of seeds) {
      for (const t of paintTargets(seed, symN, symmetry, offsets)) {
        out.set(triToString(t), t);
      }
    }
    return [...out.values()];
  }, [hoveredTri, tool, gridDivisions, flowerRadius, symmetry, hexEnabledRef, brushSize]);

  // Prevent browser zoom from trackpad pinch globally (document-level).
  useEffect(() => {
    const preventCtrlWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const preventGesture = (e: Event) => e.preventDefault();
    document.addEventListener("wheel", preventCtrlWheel, { passive: false });
    document.addEventListener("gesturestart", preventGesture);
    document.addEventListener("gesturechange", preventGesture);
    document.addEventListener("gestureend", preventGesture);
    return () => {
      document.removeEventListener("wheel", preventCtrlWheel);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
    };
  }, []);

  // Prevent browser scroll within the canvas container so wheel events
  // are fully captured by our React onWheel handler.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, [containerRef]);

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const ux = (sx - size.width / 2) / view.zoom;
      const uy = (sy - size.height / 2) / view.zoom;
      return {
        x: invCos * ux - invSin * uy - view.x,
        y: invSin * ux + invCos * uy - view.y,
      };
    },
    [size, view, invCos, invSin],
  );

  const getRelativePointer = useCallback(
    (e: React.PointerEvent | React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const n = normPoint(e.clientX, e.clientY);
      return { x: n.x - rect.left, y: n.y - rect.top };
    },
    [containerRef],
  );

  // brushExpand: brush-size expansion (hex-wedge) → flower + symmetry +
  // selectedHex clipping. Bound once per render, passed to tools via
  // ToolContext. Only edit tools (paint/erase/dodge/burn) use this;
  // select/stamp operate on single trixels directly.
  const brushExpand = useCallback(
    (tri: TriKey): TriKey[] => {
      const N = gridDivisionsRef.current;
      const seeds =
        brushSizeRef.current === "hex" && N > 0 && hexEnabledRef.current
          ? getHexWedgeTrixels(tri, N)
          : [tri];
      const offsets = flowerOffsetsRef.current;
      const sym = symmetryRef.current;
      const symN = hexEnabledRef.current ? N : 0;
      const out = new Map<string, TriKey>();
      for (const seed of seeds) {
        for (const t of paintTargets(seed, symN, sym, offsets)) {
          out.set(triToString(t), t);
        }
      }
      let targets = [...out.values()];
      // selectedHex clipping: selection is a stronger constraint than brush
      // size — painting outside selected hexes yields nothing.
      if (selectedHexesRef.current.length > 0 && N > 0) {
        const hexSet = new Set(
          selectedHexesRef.current.map((h) => `${h.c},${h.k}`),
        );
        targets = targets.filter((t) => {
          const h = triToHex(t.q, t.r, t.type, N);
          return hexSet.has(`${h.c},${h.k}`);
        });
      }
      return targets;
    },
    [],
  );

  // ToolContext — rebuilt per render so the ref always holds fresh values.
  // Pointer handlers read ctxRef.current to avoid stale-closure bugs
  // (onCommit, tool, color, etc. change across renders).
  const ctx: ToolContext = {
    view,
    setView,
    screenToWorld,
    painted,
    setPainted,
    paintedRef,
    onCommit,
    tool,
    setTool,
    color,
    setColor,
    flowerRadius,
    gridDivisions,
    symmetry,
    selectedHexes,
    hexEnabled,
    layers,
    activeLayerIdx,
    gridRotation,
    invCos,
    invSin,
    drag,
    lastPaintTriRef,
    lastEditToolRef,
    brushExpand,
    activeSelection,
    setActiveSelection,
    setSelections,
    onStampCapture,
    cloneSource,
    onCloneCapture,
    cloneOffset,
    onCloneOffset,
    captureMode: captureMode ?? false,
    setCaptureMode: setCaptureMode ?? (() => {}),
    setSelectedHexes,
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      isTwoFinger.current = true;
      drag.current = { kind: "idle" };

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const [cx1, cy1, cx2, cy2] = normTouchPair(
        t1.clientX, t1.clientY,
        t2.clientX, t2.clientY,
      );
      const dist = Math.hypot(cx1 - cx2, cy1 - cy2);
      const midX = (cx1 + cx2) / 2;
      const midY = (cy1 + cy2) / 2;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = midX - rect.left;
      const sy = midY - rect.top;
      const { x: vx, y: vy, zoom } = viewRef.current;
      const { width, height } = sizeRef.current;

      const ux = (sx - width / 2) / zoom;
      const uy = (sy - height / 2) / zoom;
      pinch.current = {
        dist,
        startView: { x: vx, y: vy, zoom },
        worldAtMid: {
          x: invCos * ux - invSin * uy - vx,
          y: invSin * ux + invCos * uy - vy,
        },
      };
    },
    [containerRef, invCos, invSin],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!pinch.current) return;
      if (e.touches.length < 2) return;
      e.preventDefault();

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const [cx1, cy1, cx2, cy2] = normTouchPair(
        t1.clientX, t1.clientY,
        t2.clientX, t2.clientY,
      );
      const dist = Math.hypot(cx1 - cx2, cy1 - cy2);

      const { dist: initDist, startView, worldAtMid } = pinch.current;
      const scale = 1 + (dist / initDist - 1) * PINCH_SENSITIVITY;
      const newZoom = Math.min(
        Math.max(startView.zoom * scale, ZOOM_MIN),
        ZOOM_MAX,
      );

      const midX = (cx1 + cx2) / 2;
      const midY = (cy1 + cy2) / 2;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = midX - rect.left;
      const sy = midY - rect.top;
      const { width, height } = sizeRef.current;

      const ux = (sx - width / 2) / newZoom;
      const uy = (sy - height / 2) / newZoom;
      setView({
        x: invCos * ux - invSin * uy - worldAtMid.x,
        y: invSin * ux + invCos * uy - worldAtMid.y,
        zoom: newZoom,
      });
    },
    [containerRef, setView, invCos, invSin],
  );

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      isTwoFinger.current = false;
      pinch.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      const isRightClick = e.button === 2 || e.ctrlKey;
      const pos = getRelativePointer(e);

      const handler = isRightClick ? viewPanTool : toolMap[toolRef.current];
      handler.onDown?.(ctxRef.current, e, pos, isRightClick);

      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [getRelativePointer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      const pos = getRelativePointer(e);
      const world = screenToWorld(pos.x, pos.y);
      const tri = worldToTri(world.x, world.y);
      const last = lastHoveredTriRef.current;
      if (!last || last.q !== tri.q || last.r !== tri.r || last.type !== tri.type) {
        setHoveredTri(tri);
        lastHoveredTriRef.current = tri;
      }

      const d = drag.current;
      const handler =
        d.kind === "viewPan" ? viewPanTool : toolMap[toolRef.current];
      handler.onMove?.(ctxRef.current, e, pos);
    },
    [getRelativePointer, screenToWorld],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      const pos = getRelativePointer(e);
      const d = drag.current;
      const handler =
        d.kind === "viewPan" ? viewPanTool : toolMap[toolRef.current];
      handler.onUp?.(ctxRef.current, e, pos);

      drag.current = { kind: "idle" };
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [getRelativePointer],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const zoomFactor = Math.pow(1.1, -e.deltaY / WHEEL_DIVISOR);
      setView((v) => ({
        ...v,
        zoom: Math.min(Math.max(v.zoom * zoomFactor, ZOOM_MIN), ZOOM_MAX),
      }));
    },
    [setView],
  );

  return {
    hoveredTri,
    setHoveredTri,
    hoverTargets,
    screenToWorld,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    lastPaintTriRef,
  };
}
