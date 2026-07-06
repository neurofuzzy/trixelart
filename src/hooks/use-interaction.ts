"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { SIDE, H, worldToTri, triToString, stringToTri, getTrianglesOnLine, triCenter, type TriKey } from "@/lib/grid-math";
import { flowerOffsets, paintTargets, triToHex, enumerateHexTrixels, hexTranslation, hexCenterTriAxial, captureHexSnapshot, type Symmetry, type SelectionSnapshot } from "@/lib/hex-flower";
import { ZOOM_MIN, ZOOM_MAX, WHEEL_DIVISOR, PINCH_SENSITIVITY } from "@/lib/config";
import { encodeColor, resolveColor } from "@/lib/constants";

interface InteractionState {
  isPainting: boolean;
  isPanning: boolean;
  isViewPanning: boolean;
  hasMoved: boolean;
  startPos: { x: number; y: number } | null;
  lastPos: { x: number; y: number } | null;
  lastPaintedWorld: { x: number; y: number } | null;
  moveStartWorld: { x: number; y: number } | null;
  moveStartView: { x: number; y: number } | null;
  moveDq: number;
  moveDr: number;
  moveOriginPainted: Record<string, string> | null;
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
  onCommit,
  containerRef,
  flowerRadius,
  gridDivisions,
  symmetry,
  selectedHex,
  setSelectedHex,
  activeSelection,
  setActiveSelection,
  setSelections,
  onStampCapture,
  captureMode,
  setCaptureMode,
  gridRotation = 0,
  hexEnabled = true,
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
  onCommit: () => void;
  containerRef: { current: HTMLDivElement | null };
  flowerRadius: number;
  gridDivisions: number;
  symmetry: Symmetry;
  selectedHex: { c: number; k: number } | null;
  setSelectedHex: (h: { c: number; k: number } | null) => void;
  activeSelection: SelectionSnapshot | null;
  setActiveSelection: (s: SelectionSnapshot | null) => void;
  setSelections: React.Dispatch<React.SetStateAction<SelectionSnapshot[]>>;
  onStampCapture?: (c: number, k: number) => void;
  captureMode?: boolean;
  setCaptureMode?: (v: boolean) => void;
  gridRotation?: number;
  hexEnabled?: boolean;
}) {
  const [hoveredTri, setHoveredTri] = useState<TriKey | null>(null);
  const interaction = useRef<InteractionState>({
    isPainting: false,
    isPanning: false,
    isViewPanning: false,
    hasMoved: false,
    startPos: null,
    lastPos: null,
    lastPaintedWorld: null,
    moveStartWorld: null,
    moveStartView: null,
    moveDq: 0,
    moveDr: 0,
    moveOriginPainted: null,
  });

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const onStampCaptureRef = useRef(onStampCapture);
  onStampCaptureRef.current = onStampCapture;

  const captureModeRef = useRef(captureMode);
  captureModeRef.current = captureMode;

  const setCaptureModeRef = useRef(setCaptureMode);
  setCaptureModeRef.current = setCaptureMode;

  // Mirrored refs so callbacks don't need dependency on view/size objects
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;

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

  // Hex rotation symmetry — mirrored into a ref so paint callbacks stay stable.
  const symmetryRef = useRef(symmetry);
  symmetryRef.current = symmetry;
  const gridDivisionsRef = useRef(gridDivisions);
  gridDivisionsRef.current = gridDivisions;
  // Whether the hex lattice is actually displayed. Symmetry rotation pivots
  // around the hex center when this is true, otherwise around the world
  // origin (paintTargets handles N<=0 as origin rotation).
  const hexEnabledRef = useRef(hexEnabled);
  hexEnabledRef.current = hexEnabled;

  // Selected hex (for stamp tool) — mirrored so click callbacks stay stable.
  const selectedHexRef = useRef(selectedHex);
  selectedHexRef.current = selectedHex;

  // Active stamp selection snapshot — mirrored for stable callbacks.
  const activeSelectionRef = useRef(activeSelection);
  activeSelectionRef.current = activeSelection;
  const paintedRef = useRef(painted);
  paintedRef.current = painted;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const lastPaintTriRef = useRef<TriKey | null>(null);
  const lastEditToolRef = useRef<"paint" | "erase" | null>(null);

  // Ghost-preview targets: the hovered trixel + all its flower + symmetry
  // mirrors. Recomputed whenever the hover or any setting changes; rendered
  // on the canvas so users can see what a paint would land on before clicking.
  // When the hex lattice is hidden, symmetry rotates around the world origin
  // instead of a hex center (paintTargets treats N<=0 as origin rotation).
  const hoverTargets = useMemo<TriKey[]>(() => {
    if (!hoveredTri) return [];
    if (tool === "select" || tool === "stamp") return [hoveredTri];
    // Flower copies require the hex lattice; symmetry works at any N.
    const offsets = gridDivisions > 0 ? flowerOffsets(flowerRadius, gridDivisions) : [];
    return paintTargets(
    hoveredTri,
    hexEnabledRef.current ? gridDivisions : 0,
    symmetry,
    offsets,
  );
  }, [hoveredTri, tool, gridDivisions, flowerRadius, symmetry, hexEnabledRef]);

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
    interaction.current.isViewPanning = false;

    const t1 = e.touches[0];
    const t2 = e.touches[1];
    let cx1 = t1.clientX;
    let cy1 = t1.clientY;
    let cx2 = t2.clientX;
    let cy2 = t2.clientY;
    if (cx1 > window.innerWidth * 1.5 || cy1 > window.innerHeight * 1.5) {
      const dpr = window.devicePixelRatio || 1;
      cx1 /= dpr;
      cy1 /= dpr;
      cx2 /= dpr;
      cy2 /= dpr;
    }
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
  }, [containerRef, invCos, invSin]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pinch.current) return;
    if (e.touches.length < 2) return;
    e.preventDefault();

    const t1 = e.touches[0];
    const t2 = e.touches[1];
    let cx1 = t1.clientX;
    let cy1 = t1.clientY;
    let cx2 = t2.clientX;
    let cy2 = t2.clientY;
    if (cx1 > window.innerWidth * 1.5 || cy1 > window.innerHeight * 1.5) {
      const dpr = window.devicePixelRatio || 1;
      cx1 /= dpr;
      cy1 /= dpr;
      cx2 /= dpr;
      cy2 /= dpr;
    }
    const dist = Math.hypot(cx1 - cx2, cy1 - cy2);

    const { dist: initDist, startView, worldAtMid } = pinch.current;
    const scale = 1 + (dist / initDist - 1) * PINCH_SENSITIVITY;
    const newZoom = Math.min(Math.max(startView.zoom * scale, ZOOM_MIN), ZOOM_MAX);

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
  }, [containerRef, setView, invCos, invSin]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      isTwoFinger.current = false;
      pinch.current = null;
    }
  }, []);

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
      let cx = e.clientX;
      let cy = e.clientY;
      // Safari on some devices reports pointer coordinates in physical
      // pixels while getBoundingClientRect returns CSS pixels, causing
      // a multiplicative drift. Detect and normalize.
      if (cx > window.innerWidth * 1.5 || cy > window.innerHeight * 1.5) {
        const dpr = window.devicePixelRatio || 1;
        cx /= dpr;
        cy /= dpr;
      }
      return {
        x: cx - rect.left,
        y: cy - rect.top,
      };
    },
    [containerRef],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      const isRightClick = e.button === 2 || e.ctrlKey;
      const pos = getRelativePointer(e);

      if (isRightClick) {
        interaction.current = {
          isPainting: false,
          isPanning: false,
          isViewPanning: true,
          hasMoved: false,
          startPos: { x: e.clientX, y: e.clientY },
          lastPos: { x: e.clientX, y: e.clientY },
          lastPaintedWorld: null,
          moveStartWorld: null,
          moveOriginPainted: null,
          moveStartView: null,
          moveDq: 0,
          moveDr: 0,
        };
      } else if (tool === "pan") {
        const world = screenToWorld(pos.x, pos.y);
        interaction.current = {
          isPainting: false,
          isPanning: true,
          isViewPanning: false,
          hasMoved: false,
          startPos: { x: e.clientX, y: e.clientY },
          lastPos: { x: e.clientX, y: e.clientY },
          lastPaintedWorld: null,
          moveStartWorld: { x: world.x, y: world.y },
          moveStartView: { x: viewRef.current.x, y: viewRef.current.y },
          moveDq: 0,
          moveDr: 0,
          moveOriginPainted: { ...paintedRef.current },
        };
      } else if (tool === "select") {
        const N = gridDivisionsRef.current;
        const world = screenToWorld(pos.x, pos.y);
        const tri = worldToTri(world.x, world.y);
        if (N > 0) {
          const hex = triToHex(tri.q, tri.r, tri.type, N);
          setSelectedHex(hex);
          const snap = captureHexSnapshot(paintedRef.current, hex.c, hex.k, N);
          if (snap.trixels.length > 0) {
            const key = JSON.stringify(
              snap.trixels.map((t) => [t.dq, t.dr, t.type, t.color]).sort(),
            );
            let activeSnap: SelectionSnapshot | null = null;
            setSelections((prev) => {
              const duplicate = prev.find(
                (s) =>
                  s.N === snap.N &&
                  key ===
                    JSON.stringify(
                      s.trixels
                        .map((t) => [t.dq, t.dr, t.type, t.color])
                        .sort(),
                    ),
              );
              if (duplicate) {
                activeSnap = duplicate;
                return prev;
              }
              activeSnap = snap;
              const next = [snap, ...prev.filter((s) => s.id !== snap.id)];
              return next.slice(0, 5);
            });
            if (activeSnap) setActiveSelection(activeSnap);
          }
        } else {
          setSelectedHex(null);
        }
        interaction.current = {
          isPainting: false,
          isPanning: false,
          isViewPanning: false,
          hasMoved: false,
          startPos: null,
          lastPos: null,
          lastPaintedWorld: null,
          moveStartWorld: null,
          moveOriginPainted: null,
          moveStartView: null,
          moveDq: 0,
          moveDr: 0,
        };
      } else if (tool === "stamp") {
        const N = gridDivisionsRef.current;
        const world = screenToWorld(pos.x, pos.y);
        const tri = worldToTri(world.x, world.y);
        const snap = activeSelectionRef.current;

        if ((e.altKey || captureModeRef.current) && N > 0) {
          const hex = triToHex(tri.q, tri.r, tri.type, N);
          const captured = captureHexSnapshot(paintedRef.current, hex.c, hex.k, N);
          if (captured.trixels.length > 0) {
            const key = JSON.stringify(
              captured.trixels.map((t) => [t.dq, t.dr, t.type, t.color]).sort(),
            );
            let activeSnap: SelectionSnapshot | null = null;
            setSelections((prev) => {
              const duplicate = prev.find(
                (s) =>
                  s.N === captured.N &&
                  key ===
                    JSON.stringify(
                      s.trixels
                        .map((t) => [t.dq, t.dr, t.type, t.color])
                        .sort(),
                    ),
              );
              if (duplicate) {
                activeSnap = duplicate;
                return prev;
              }
              activeSnap = captured;
              const next = [captured, ...prev.filter((s) => s.id !== captured.id)];
              return next.slice(0, 5);
            });
            if (activeSnap) setActiveSelection(activeSnap);
            onStampCaptureRef.current?.(hex.c, hex.k);
            setCaptureModeRef.current?.(false);
          }
        } else if (snap && N === snap.N) {
          const destHex = triToHex(tri.q, tri.r, tri.type, N);
          const { qc, rc } = hexCenterTriAxial(destHex.c, destHex.k, N);
          const erase = e.button === 2 || e.ctrlKey;

          setPainted((prev) => {
            const next = { ...prev };
            let changed = false;
            if (!erase) {
              for (const t of enumerateHexTrixels(destHex.c, destHex.k, N)) {
                const key = triToString(t);
                if (key in next) { delete next[key]; changed = true; }
              }
            }
            for (const t of snap.trixels) {
              const key = triToString({
                q: qc + t.dq,
                r: rc + t.dr,
                type: t.type,
              });
              if (erase) {
                if (key in next) { delete next[key]; changed = true; }
              } else {
                next[key] = t.color;
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }

        interaction.current = {
          isPainting: true,
          isPanning: false,
          isViewPanning: false,
          hasMoved: false,
          startPos: null,
          lastPos: null,
          lastPaintedWorld: null,
          moveStartWorld: null,
          moveOriginPainted: null,
          moveStartView: null,
          moveDq: 0,
          moveDr: 0,
        };
      } else if ((tool === "paint" || tool === "erase") && e.shiftKey) {
        const world = screenToWorld(pos.x, pos.y);
        const clickedTri = worldToTri(world.x, world.y);

        if (lastEditToolRef.current !== null && lastEditToolRef.current !== tool) {
          lastPaintTriRef.current = null;
        }
        lastEditToolRef.current = tool;

        const prevTri = lastPaintTriRef.current;

        if (prevTri) {
          const origin = triCenter(prevTri.q, prevTri.r, prevTri.type);
          const target = triCenter(clickedTri.q, clickedTri.r, clickedTri.type);

          const axes = [
            { dx: SIDE, dy: 0 },
            { dx: SIDE / 2, dy: H },
            { dx: -SIDE / 2, dy: H },
          ];

          let bestClosest: { x: number; y: number } | null = null;
          let bestDist = Infinity;

          for (const axis of axes) {
            const dx = target.x - origin.x;
            const dy = target.y - origin.y;
            const dd = axis.dx * axis.dx + axis.dy * axis.dy;
            const t = (dx * axis.dx + dy * axis.dy) / dd;
            const px = origin.x + t * axis.dx;
            const py = origin.y + t * axis.dy;
            const dist = Math.hypot(px - target.x, py - target.y);
            if (dist < bestDist) {
              bestDist = dist;
              bestClosest = { x: px, y: py };
            }
          }

          if (bestClosest) {
            let lineTris = getTrianglesOnLine(origin.x, origin.y, bestClosest.x, bestClosest.y);
            const Nsel = gridDivisionsRef.current;
            if (selectedHexRef.current && Nsel > 0) {
              const sel = selectedHexRef.current;
              lineTris = lineTris.filter((t) => {
                const h = triToHex(t.q, t.r, t.type, Nsel);
                return h.c === sel.c && h.k === sel.k;
              });
            }

            if (lineTris.length > 0) {
              lastPaintTriRef.current = lineTris[lineTris.length - 1];
            }

            setPainted((prev) => {
              const next = { ...prev };
              let changed = false;
              const isErase = tool === "erase";
              for (const lt of lineTris) {
                const k = triToString(lt);
                if (isErase) {
                  if (k in next) { delete next[k]; changed = true; }
                } else if (resolveColor(next[k] ?? "") !== resolveColor(color)) {
                  next[k] = color;
                  changed = true;
                }
              }
              return changed ? next : prev;
            });
          }

        }

        interaction.current = {
          isPainting: true,
          isPanning: false,
          isViewPanning: false,
          hasMoved: false,
          startPos: null,
          lastPos: null,
          lastPaintedWorld: null,
          moveStartWorld: null,
          moveOriginPainted: null,
          moveStartView: null,
          moveDq: 0,
          moveDr: 0,
        };
      } else {
        const world = screenToWorld(pos.x, pos.y);

        interaction.current = {
          isPainting: true,
          isPanning: false,
          isViewPanning: false,
          hasMoved: false,
          startPos: { x: e.clientX, y: e.clientY },
          lastPos: null,
          lastPaintedWorld: { x: world.x, y: world.y },
          moveStartWorld: null,
          moveOriginPainted: null,
          moveStartView: null,
          moveDq: 0,
          moveDr: 0,
        };

        const tri = worldToTri(world.x, world.y);
        lastPaintTriRef.current = tri;
        lastEditToolRef.current = tool;
        const offsets = flowerOffsetsRef.current;
        const sym = symmetryRef.current;
        const N = gridDivisionsRef.current;
        // Symmetry pivots around a hex center when the hex lattice is shown,
        // otherwise around the world origin (paintTargets: N<=0 => origin).
        const symN = hexEnabledRef.current ? N : 0;
        let targets = paintTargets(tri, symN, sym, offsets);
        if (selectedHexRef.current && N > 0) {
          const sel = selectedHexRef.current;
          targets = targets.filter((t) => {
            const h = triToHex(t.q, t.r, t.type, N);
            return h.c === sel.c && h.k === sel.k;
          });
        }
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
    [tool, color, getRelativePointer, screenToWorld, setPainted, setSelectedHex],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      const pos = getRelativePointer(e);
      const world = screenToWorld(pos.x, pos.y);
      const tri = worldToTri(world.x, world.y);
      setHoveredTri(tri);

      if (interaction.current.isViewPanning && interaction.current.lastPos) {
        // Screen drag delta; rotate it into world space before applying
        // so content follows the cursor regardless of grid rotation.
        const sdx = (e.clientX - interaction.current.lastPos.x) / view.zoom;
        const sdy = (e.clientY - interaction.current.lastPos.y) / view.zoom;
        const dx = invCos * sdx - invSin * sdy;
        const dy = invSin * sdx + invCos * sdy;

        const totalDist = Math.hypot(
          e.clientX - (interaction.current.startPos?.x || 0),
          e.clientY - (interaction.current.startPos?.y || 0),
        );
        if (totalDist > 3) interaction.current.hasMoved = true;

        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
        interaction.current.lastPos = { x: e.clientX, y: e.clientY };
      } else if (interaction.current.isPanning && interaction.current.moveStartWorld) {
        const ms = interaction.current.moveStartWorld;
        const dr = Math.round((world.y - ms.y) / H);
        const dq = Math.round((world.x - ms.x) / SIDE - dr * 0.5);

        interaction.current.moveDq = dq;
        interaction.current.moveDr = dr;

        if (dq !== 0 || dr !== 0) interaction.current.hasMoved = true;

        if (interaction.current.hasMoved && interaction.current.moveOriginPainted) {
          const next: Record<string, string> = {};
          for (const [key, value] of Object.entries(interaction.current.moveOriginPainted)) {
            const t = stringToTri(key);
            next[triToString({ q: t.q + dq, r: t.r + dr, type: t.type })] = value;
          }
          setPainted(next);
        }
      } else if (interaction.current.isPainting) {
        const lastWorld = interaction.current.lastPaintedWorld;
        if (!lastWorld) return;

        const tris = getTrianglesOnLine(lastWorld.x, lastWorld.y, world.x, world.y);
        interaction.current.lastPaintedWorld = { x: world.x, y: world.y };

        const offsets = flowerOffsetsRef.current;
        const sym = symmetryRef.current;
        const N = gridDivisionsRef.current;
        const symN = hexEnabledRef.current ? N : 0;

        setPainted((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const tri of tris) {
            let targets = paintTargets(tri, symN, sym, offsets);
            if (selectedHexRef.current && N > 0) {
              const sel = selectedHexRef.current;
              targets = targets.filter((t) => {
                const h = triToHex(t.q, t.r, t.type, N);
                return h.c === sel.c && h.k === sel.k;
              });
            }
            const keys = targets.map(triToString);
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
    [view, setView, tool, color, getRelativePointer, screenToWorld, setPainted, invCos, invSin],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isTwoFinger.current) return;
      if (interaction.current.isViewPanning && !interaction.current.hasMoved) {
        if (toolRef.current !== "stamp") {
          const pos = getRelativePointer(e);
          const world = screenToWorld(pos.x, pos.y);
          const key = triToString(worldToTri(world.x, world.y));
          const pickedColor = painted[key];
          if (pickedColor) {
            setColor(pickedColor);
            setTool("paint");
          }
        }
      }

      if (interaction.current.isPanning) {
        if (interaction.current.hasMoved) {
          onCommitRef.current();
          const sv = interaction.current.moveStartView;
          if (sv) {
            const dq = interaction.current.moveDq;
            const dr = interaction.current.moveDr;
            const dwx = (dq + dr * 0.5) * SIDE;
            const dwy = dr * H;
            setView({ x: sv.x - dwx, y: sv.y - dwy, zoom: viewRef.current.zoom });
          }
          lastPaintTriRef.current = null;
          lastEditToolRef.current = null;
        } else {
          const pos = getRelativePointer(e);
          const world = screenToWorld(pos.x, pos.y);
          const tri = worldToTri(world.x, world.y);
          const dq = -tri.q;
          const dr = -tri.r;
          if (dq !== 0 || dr !== 0) {
            const next: Record<string, string> = {};
            for (const [key, value] of Object.entries(painted)) {
              const t = stringToTri(key);
              next[triToString({ q: t.q + dq, r: t.r + dr, type: t.type })] = value;
            }
            const dwx = (dq + dr * 0.5) * SIDE;
            const dwy = dr * H;
            setView((v) => ({ ...v, x: v.x - dwx, y: v.y - dwy }));
            paintedRef.current = next;
            setPainted(next);
            onCommitRef.current();
          }
        }
      }

      if (interaction.current.isPainting) {
        onCommitRef.current();
      }

      interaction.current = {
        isPainting: false,
        isPanning: false,
        isViewPanning: false,
        hasMoved: false,
        startPos: null,
        lastPos: null,
        lastPaintedWorld: null,
        moveStartWorld: null,
        moveStartView: null,
        moveDq: 0,
        moveDr: 0,
        moveOriginPainted: null,
      };
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [painted, getRelativePointer, screenToWorld, setColor, setTool, setView],
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
