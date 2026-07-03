"use client";

import { useState, useRef, useCallback } from "react";
import { worldToTri, triToString, getTrianglesOnLine, type TriKey } from "@/lib/grid-math";

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
}: {
  size: { width: number; height: number };
  view: { x: number; y: number; zoom: number };
  setView: React.Dispatch<React.SetStateAction<{ x: number; y: number; zoom: number }>>;
  tool: "paint" | "erase" | "pan";
  setTool: (tool: "paint" | "erase" | "pan") => void;
  color: string;
  setColor: (color: string) => void;
  painted: Record<string, string>;
  setPainted: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pushHistory: (state: Record<string, string>) => void;
  containerRef: { current: HTMLDivElement | null };
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
      const isRightClick = e.button === 2 || e.ctrlKey;
      const pos = getRelativePointer(e);

      if (isRightClick || tool === "pan") {
        interaction.current = {
          isPainting: false,
          isPanning: true,
          hasMoved: false,
          startPos: { x: e.clientX, y: e.clientY },
          lastPos: { x: e.clientX, y: e.clientY },
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

        const key = triToString(worldToTri(world.x, world.y));

        setPainted((prev) => {
          const next = { ...prev };
          if (tool === "paint") {
            if (prev[key] === color) {
              delete next[key];
            } else {
              next[key] = color;
            }
          } else {
            delete next[key];
          }
          return next;
        });
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [tool, color, getRelativePointer, screenToWorld, setPainted],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
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

        setPainted((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const tri of tris) {
            const key = triToString(tri);
            if (tool === "paint") {
              if (next[key] !== color) {
                next[key] = color;
                changed = true;
              }
            } else {
              if (key in next) {
                delete next[key];
                changed = true;
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
      const zoomFactor = Math.pow(1.1, -e.deltaY / 200);
      setView((v) => ({
        ...v,
        zoom: Math.min(Math.max(v.zoom * zoomFactor, 0.1), 15),
      }));
    },
    [setView],
  );

  return {
    hoveredTri,
    setHoveredTri,
    screenToWorld,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
  };
}
