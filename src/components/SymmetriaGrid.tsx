"use client";

import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";

interface SymmetriaGridProps {
  grid: Record<string, string>;
  onCellClick: (id: string, color: string | null) => void;
  activeColor: string;
}

const SIDE = 50;
const HEIGHT = (Math.sqrt(3) / 2) * SIDE;

export function SymmetriaGrid({ grid, onCellClick, activeColor }: SymmetriaGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  
  // Navigation State
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const lastPointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setMounted(true);
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Center the grid on mount
  useEffect(() => {
    if (dimensions.width && dimensions.height && view.x === 0 && view.y === 0) {
      setView({ x: dimensions.width / 2, y: dimensions.height / 2, zoom: 1 });
    }
  }, [dimensions]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      lastPointer.current = { x: e.clientX, y: e.clientY };
      containerRef.current?.setPointerCapture(e.pointerId);
    } else if (e.button === 0) {
      setIsPainting(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
      lastPointer.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsPanning(false);
    setIsPainting(false);
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomSpeed = 0.0015;
      const factor = 1 - e.deltaY * zoomSpeed;
      const newZoom = Math.max(0.1, Math.min(5, view.zoom * factor));
      
      const rect = containerRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      const dx = (mx - view.x) * (1 - factor);
      const dy = (my - view.y) * (1 - factor);

      setView(v => ({
        x: v.x + dx,
        y: v.y + dy,
        zoom: newZoom,
      }));
    } else {
      setView(v => ({
        ...v,
        x: v.x - e.deltaX,
        y: v.y - e.deltaY,
      }));
    }
  };

  const visibleTriangles = useMemo(() => {
    if (!dimensions.width || !dimensions.height) return [];

    const triangles = [];
    const zoom = view.zoom;
    const offsetX = view.x;
    const offsetY = view.y;

    const s = SIDE * zoom;
    const h = HEIGHT * zoom;

    // Bounds in grid space
    const minRow = Math.floor((-offsetY) / h) - 1;
    const maxRow = Math.ceil((dimensions.height - offsetY) / h) + 1;
    const minCol = Math.floor((-offsetX) / (s / 2)) - 2;
    const maxCol = Math.ceil((dimensions.width - offsetX) / (s / 2)) + 2;

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const id = `${r},${c}`;
        const isUpward = (Math.abs(r + c) % 2) === 1;

        let points = "";
        const x = c * (s / 2) + offsetX;
        const yBase = r * h + offsetY;

        if (isUpward) {
          // Pointing UP: (x, y+h), (x+s, y+h), (x+s/2, y)
          points = `${x.toFixed(2)},${(yBase + h).toFixed(2)} ${(x + s).toFixed(2)},${(yBase + h).toFixed(2)} ${(x + s / 2).toFixed(2)},${yBase.toFixed(2)}`;
        } else {
          // Pointing DOWN: (x, y), (x+s, y), (x+s/2, y+h)
          points = `${x.toFixed(2)},${yBase.toFixed(2)} ${(x + s).toFixed(2)},${yBase.toFixed(2)} ${(x + s / 2).toFixed(2)},${(yBase + h).toFixed(2)}`;
        }

        triangles.push({ id, points, color: grid[id] });
      }
    }
    return triangles;
  }, [dimensions, view, grid]);

  const handleCellAction = useCallback((id: string, currentColor: string | null) => {
    if (isPainting || !isPanning) {
      onCellClick(id, currentColor === activeColor ? null : activeColor);
    }
  }, [isPainting, isPanning, activeColor, onCellClick]);

  if (!mounted) return <div className="w-full h-full bg-muted/20 animate-pulse rounded-3xl" />;

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative overflow-hidden bg-[#0a0a0a] rounded-[2rem] border border-white/10 cursor-crosshair select-none touch-none shadow-2xl"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute top-6 left-6 flex flex-col gap-1 pointer-events-none z-10">
        <div className="text-[10px] font-bold text-primary/60 uppercase tracking-[0.2em]">TriCanvas v1.0</div>
        <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5 text-[9px] font-mono text-muted-foreground">
          <span>{Math.round(view.x)}, {Math.round(view.y)}</span>
          <span className="opacity-20">|</span>
          <span>{view.zoom.toFixed(2)}x</span>
        </div>
      </div>

      <svg className="w-full h-full">
        {visibleTriangles.map((tri) => (
          <polygon
            key={tri.id}
            points={tri.points}
            fill={tri.color || "transparent"}
            stroke="rgba(255, 255, 255, 0.05)"
            strokeWidth={0.5}
            className={cn(
              "transition-all duration-200 cursor-pointer",
              tri.color 
                ? "hover:opacity-80" 
                : "hover:fill-white/10"
            )}
            onPointerDown={(e) => {
              if (e.button === 0 && !e.altKey) {
                e.stopPropagation();
                handleCellAction(tri.id, tri.color || null);
              }
            }}
            onPointerEnter={() => {
              if (isPainting) {
                handleCellAction(tri.id, tri.color || null);
              }
            }}
          />
        ))}
      </svg>
      
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-5 py-2 rounded-full border border-white/5 text-[9px] text-muted-foreground/60 uppercase tracking-[0.2em] pointer-events-none whitespace-nowrap">
        Alt+Drag to Pan • Wheel to Zoom • Left Click to Paint
      </div>
    </div>
  );
}