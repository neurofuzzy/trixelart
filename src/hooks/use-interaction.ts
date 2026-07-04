"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { worldToTri, triToString, getTrianglesOnLine, type TriKey } from "@/lib/grid-math";
import { flowerOffsets, paintTargets, triToHex, enumerateHexTrixels, hexTranslation, hexCenterTriAxial, captureHexSnapshot, type Symmetry, type SelectionSnapshot } from "@/lib/hex-flower";
import { ZOOM_MIN, ZOOM_MAX, WHEEL_DIVISOR, PINCH_SENSITIVITY } from "@/lib/config";
import { encodeColor, resolveColor } from "@/lib/constants";

interface InteractionState {
  isPainting: boolean;
  isPanning: boolean;
  hasMoved: boolean;
  startPos: { x: number; y: number } | null;
  lastPos: { x: number; y: number } | null;
  lastPaintedWorld: { x: number; y: number } | null;
}

export function useInteraction({
  size,
  view,
  setView,
  tool,
  setTool,
  color,
  setColor,
  painted,
  setPainted,
  pushHistory,
  containerRef,
  flowerRadius,
  gridDivisions,
  symmetry,
  selectedHex,
  setSelectedHex,
  activeSelection,
  setActiveSelection,
  setSelections,
}: {
  size: { width: number; height: number };
  view: { x: number; y: number; zoom: number };
  setView: React.Dispatch<React.SetStateAction<{ x: number; y: number; zoom: number }>>;
  tool: "paint" | "erase" | "pan" | "select" | "stamp";
  setTool: (tool: "paint" | "erase" | "pan" | "select" | "stamp") => void;
  color: string;
  setColor: (color: string) => void;
  painted: Record<string, string>;
  setPainted: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pushHistory: (state: Record<string, string>) => void;
  containerRef: { current: HTMLDivElement | null };
  flowerRadius: number;
  gridDivisions: number;
  symmetry: Symmetry;
  selectedHex: { c: number; k: number } | null;
  setSelectedHex: (h: { c: number; k: number } | null) => void;
  activeSelection: SelectionSnapshot | null;
  setActiveSelection: (s: SelectionSnapshot | null) => void;
  setSelections: React.Dispatch<React.SetStateAction<SelectionSnapshot[]>>;
}) {
  const [hoveredTri, setHoveredTri] = useState<TriKey | null>(null);
  const interaction = useRef<InteractionState>({
    isPainting: false,
    isPanning: false,
    hasMoved: false,
    startPos: null,
    lastPos: null,
    lastPaintedWorld: null,
  });

  // Mirrored refs so callbacks don't need dependency on view/size objects
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;

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

  // Hex rotation symmetry — mirrored into a ref so paint callbacks stay stable.
  const symmetryRef = useRef(symmetry);
  symmetryRef.current = symmetry;
  const gridDivisionsRef = useRef(gridDivisions);
  gridDivisionsRef.current = gridDivisions;

  // Selected hex (for stamp tool) — mirrored so click callbacks stay stable.
  const selectedHexRef = useRef(selectedHex);
  selectedHexRef.current = selectedHex;

  // Active stamp selection snapshot — mirrored for stable callbacks.
  const activeSelectionRef = useRef(activeSelection);
  activeSelectionRef.current = activeSelection;
  const paintedRef = useRef(painted);
  paintedRef.current = painted;

  // Ghost-preview targets: the hovered trixel + all its flower + symmetry
  // mirrors. Recomputed whenever the hover or any setting changes; rendered
  // on the canvas so users can see what a paint would land on before clicking.
  const hoverTargets = useMemo<TriKey[]>(() => {
    if (!hoveredTri) return [];
    if (tool === "select" || tool === "stamp") return [hoveredTri];
    if (gridDivisions <= 0) return [hoveredTri];
    const offsets = flowerOffsets(flowerRadius, gridDivisions);
    return paintTargets(hoveredTri, gridDivisions, symmetry, offsets);
  }, [hoveredTri, tool, gridDivisions, flowerRadius, symmetry]);

  // Prevent browser zoom from trackpad pinch globally (document-level).
  // Chrome/Edge/Firefox send wheel + ctrlKey; Safari sends gesture* events.
  // Container-level wheel prevention for scroll is handled separately below.
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

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();

    isTwoFinger.current = true;
    interaction.current.isPainting = false;
    interaction.current.isPanning = false;

    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const midX = (t1.clientX + t2.clientX) / 2;
    const midY = (t1.clientY + t2.clientY) / 2;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = midX - rect.left;
    const sy = midY - rect.top;
    const { x: vx, y: vy, zoom } = viewRef.current;
    const { width, height } = sizeRef.current;

    pinch.current = {
      dist,
      startView: { x: vx, y: vy, zoom },
      worldAtMid: {
        x: (sx - width / 2) / zoom - vx,
        y: (sy - height / 2) / zoom - vy,
      },
    };
  }, [containerRef]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pinch.current) return;
    if (e.touches.length < 2) return;
    e.preventDefault();

    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const { dist: initDist, startView, worldAtMid } = pinch.current;
    const scale = 1 + (dist / initDist - 1) * PINCH_SENSITIVITY;
    const newZoom = Math.min(Math.max(startView.zoom * scale, ZOOM_MIN), ZOOM_MAX);

    const midX = (t1.clientX + t2.clientX) / 2;
    const midY = (t1.clientY + t2.clientY) / 2;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = midX - rect.left;
    const sy = midY - rect.top;
    const { width, height } = sizeRef.current;

    setView({
      x: (sx - width / 2) / newZoom - worldAtMid.x,
      y: (sy - height / 2) / newZoom - worldAtMid.y,
      zoom: newZoom,
    });
  }, [containerRef, setView]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      isTwoFinger.current = false;
      pinch.current = null;
    }
  }, []);

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - size.width / 2) / view.zoom - view.x,
      y: (sy - size.height / 2) / view.zoom - view.y,
    }),
    [size, view],
  );

  const getRelativePointer = useCallback(
    (e: React.PointerEvent | React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    [containerRef],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      const isRightClick = e.button === 2 || e.ctrlKey;
      const pos = getRelativePointer(e);

      if ((isRightClick && tool !== "stamp") || tool === "pan") {
        interaction.current = {
          isPainting: false,
          isPanning: true,
          hasMoved: false,
          startPos: { x: e.clientX, y: e.clientY },
          lastPos: { x: e.clientX, y: e.clientY },
          lastPaintedWorld: null,
        };
      } else if (tool === "select") {
        // Tap a trixel to select its enclosing hex AND capture a snapshot of
        // the hex's painted trixels for re-use via the stamp palette.
        const N = gridDivisionsRef.current;
        const world = screenToWorld(pos.x, pos.y);
        const tri = worldToTri(world.x, world.y);
        if (N > 0) {
          const hex = triToHex(tri.q, tri.r, tri.type, N);
          setSelectedHex(hex);
          // Snapshot the hex's currently-painted trixels. If the hex is
          // empty, skip capturing (no point storing an empty stamp).
          const snap = captureHexSnapshot(paintedRef.current, hex.c, hex.k, N);
          if (snap.trixels.length > 0) {
            setSelections((prev) => {
              const next = [snap, ...prev.filter((s) => s.id !== snap.id)];
              return next.slice(0, 5);
            });
            setActiveSelection(snap);
          }
        } else {
          setSelectedHex(null);
        }
        interaction.current = {
          isPainting: false,
          isPanning: false,
          hasMoved: false,
          startPos: null,
          lastPos: null,
          lastPaintedWorld: null,
        };
      } else if (tool === "stamp") {
        // Stamp the active selection's trixels into the hex under the cursor,
        // aligned center-to-center. Right-click / Ctrl-click erases the
        // target hex's footprint using the snapshot's local trixel offsets.
        const N = gridDivisionsRef.current;
        const world = screenToWorld(pos.x, pos.y);
        const tri = worldToTri(world.x, world.y);
        const snap = activeSelectionRef.current;

        if (snap && N === snap.N) {
          const destHex = triToHex(tri.q, tri.r, tri.type, N);
          const { qc, rc } = hexCenterTriAxial(destHex.c, destHex.k, N);
          const erase = e.button === 2 || e.ctrlKey;

          setPainted((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const t of snap.trixels) {
              const key = triToString({
                q: qc + t.dq,
                r: rc + t.dr,
                type: t.type,
              });
              if (erase) {
                if (key in next) { delete next[key]; changed = true; }
              } else if (next[key] !== t.color) {
                next[key] = t.color;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
          pushHistory(painted);
        }

        interaction.current = {
          isPainting: false,
          isPanning: false,
          hasMoved: false,
          startPos: null,
          lastPos: null,
          lastPaintedWorld: null,
        };
      } else {
        const world = screenToWorld(pos.x, pos.y);

        interaction.current = {
          isPainting: true,
          isPanning: false,
          hasMoved: false,
          startPos: { x: e.clientX, y: e.clientY },
          lastPos: null,
          lastPaintedWorld: { x: world.x, y: world.y },
        };

        const tri = worldToTri(world.x, world.y);
        const offsets = flowerOffsetsRef.current;
        const sym = symmetryRef.current;
        const N = gridDivisionsRef.current;
        const targets = paintTargets(tri, N, sym, offsets);
        const keys = targets.map(triToString);

        setPainted((prev) => {
          const next = { ...prev };
          if (tool === "paint" && targets.length === 1) {
            if (resolveColor(prev[keys[0]] ?? "") === resolveColor(color)) {
              delete next[keys[0]];
            } else {
              next[keys[0]] = color;
            }
          } else {
            let changed = false;
            for (const k of keys) {
              if (tool === "paint") {
                if (resolveColor(next[k] ?? "") !== resolveColor(color)) {
                  next[k] = color;
                  changed = true;
                }
              } else {
                if (k in next) {
                  delete next[k];
                  changed = true;
                }
              }
            }
            if (!changed) return prev;
          }
          return next;
        });
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [tool, color, getRelativePointer, screenToWorld, setPainted, setSelectedHex, painted, pushHistory],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      const pos = getRelativePointer(e);
      const world = screenToWorld(pos.x, pos.y);
      const tri = worldToTri(world.x, world.y);
      setHoveredTri(tri);

      if (interaction.current.isPanning && interaction.current.lastPos) {
        const dx = (e.clientX - interaction.current.lastPos.x) / view.zoom;
        const dy = (e.clientY - interaction.current.lastPos.y) / view.zoom;

        const totalDist = Math.hypot(
          e.clientX - (interaction.current.startPos?.x || 0),
          e.clientY - (interaction.current.startPos?.y || 0),
        );
        if (totalDist > 3) interaction.current.hasMoved = true;

        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        interaction.current.lastPos = { x: e.clientX, y: e.clientY };
      } else if (interaction.current.isPainting) {
        const lastWorld = interaction.current.lastPaintedWorld;
        if (!lastWorld) return;

        const tris = getTrianglesOnLine(lastWorld.x, lastWorld.y, world.x, world.y);
        interaction.current.lastPaintedWorld = { x: world.x, y: world.y };

        const offsets = flowerOffsetsRef.current;
        const sym = symmetryRef.current;
        const N = gridDivisionsRef.current;

        setPainted((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const tri of tris) {
            const keys = paintTargets(tri, N, sym, offsets).map(triToString);
            for (const k of keys) {
              if (tool === "paint") {
                if (resolveColor(next[k] ?? "") !== resolveColor(color)) {
                  next[k] = color;
                  changed = true;
                }
              } else {
                if (k in next) {
                  delete next[k];
                  changed = true;
                }
              }
            }
          }
          return changed ? next : prev;
        });
      }
    },
    [view, setView, tool, color, getRelativePointer, screenToWorld, setPainted],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      if (interaction.current.isPanning && !interaction.current.hasMoved) {
        const pos = getRelativePointer(e);
        const world = screenToWorld(pos.x, pos.y);
        const key = triToString(worldToTri(world.x, world.y));
        const pickedColor = painted[key];
        if (pickedColor) {
          setColor(pickedColor);
          setTool("paint");
        }
      }

      if (interaction.current.isPainting) {
        pushHistory(painted);
      }

      interaction.current = {
        isPainting: false,
        isPanning: false,
        hasMoved: false,
        startPos: null,
        lastPos: null,
        lastPaintedWorld: null,
      };
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [painted, getRelativePointer, screenToWorld, setColor, setTool, pushHistory],
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
  };
}
