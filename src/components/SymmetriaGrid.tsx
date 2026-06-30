
"use client";

import React, { useRef, useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

interface SymmetriaGridProps {
  grid: Record<string, string>;
  onCellClick: (id: string, currentColor: string | null) => void;
  activeColor: string;
}

const SIDE_UNIT = 60;
const H = (Math.sqrt(3) / 2) * SIDE_UNIT;

export function SymmetriaGrid({ grid, onCellClick, activeColor }: SymmetriaGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  
  // Viewport state
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [isPanning, setIsPanning] = useState(false);
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

  // Center initial view once dimensions are known
  useEffect(() => {
    if (dimensions.width && dimensions.height && view.x === 0 && view.y === 0) {
      setView({ x: dimensions.width / 2, y: dimensions.height / 2, zoom: 1 });
    }
  }, [dimensions]);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Middle click or Alt + Left Click to pan
    if (e.button === 1 || e.altKey) {
      setIsPanning(true);
      lastPointer.current = { x: e.clientX, y: e.clientY };
      containerRef.current?.setPointerCapture(e.pointerId);
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
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomSpeed = 0.0015;
      const factor = 1 - e.deltaY * zoomSpeed;
      const newZoom = Math.max(0.05, Math.min(10, view.zoom * factor));
      
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

    // Calculate grid range based on viewport bounds
    const minRow = Math.floor((-offsetY) / (H * zoom)) - 2;
    const maxRow = Math.ceil((dimensions.height - offsetY) / (H * zoom)) + 2;
    
    const minCol = Math.floor((-offsetX) / (SIDE_UNIT / 2 * zoom)) - 4;
    const maxCol = Math.ceil((dimensions.width - offsetX) / (SIDE_UNIT / 2 * zoom)) + 4;

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        // Robust modulo for negative grid coordinates
        const isUpward = ((r + c) % 2 + 2) % 2 === 0;
        const id = `${r},${c}`;
        
        const x = c * (SIDE_UNIT / 2);
        const y = r * H;

        let points;
        if (isUpward) {
          points = [
            `${((x * zoom) + offsetX).toFixed(2)},${((y * zoom) + offsetY).toFixed(2)}`,
            `${(((x + SIDE_UNIT) * zoom) + offsetX).toFixed(2)},${((y * zoom) + offsetY).toFixed(2)}`,
            `${(((x + SIDE_UNIT / 2) * zoom) + offsetX).toFixed(2)},${(((y - H) * zoom) + offsetY).toFixed(2)}`
          ].join(" ");
        } else {
          points = [
            `${((x * zoom) + offsetX).toFixed(2)},${((y * zoom) + offsetY).toFixed(2)}`,
            `${(((x + SIDE_UNIT / 2) * zoom) + offsetX).toFixed(2)},${(((y + H) * zoom) + offsetY).toFixed(2)}`,
            `${(((x + SIDE_UNIT) * zoom) + offsetX).toFixed(2)},${((y * zoom) + offsetY).toFixed(2)}`
          ].join(" ");
        }

        triangles.push({ id, points, color: grid[id] });
      }
    }
    return triangles;
  }, [dimensions, view, grid]);

  if (!mounted) return <div className="w-full h-full bg-card/5 animate-pulse rounded-3xl" />;

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative overflow-hidden bg-[#080808] rounded-[32px] border border-white/5 cursor-crosshair select-none touch-none shadow-2xl"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Viewport Debug/Status Overlay */}
      <div className="absolute top-6 left-6 flex flex-col gap-1 pointer-events-none z-10">
        <div className="text-[10px] font-bold text-primary/40 uppercase tracking-[0.2em] mb-1">Canvas Environment</div>
        <div className="flex items-center gap-3 bg-black/60 backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/5 text-[9px] font-mono text-muted-foreground/80">
          <div className="flex items-center gap-1.5">
            <span className="text-primary opacity-50">POS</span>
            <span>{Math.round(view.x)}, {Math.round(view.y)}</span>
          </div>
          <div className="w-px h-3 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <span className="text-primary opacity-50">ZOOM</span>
            <span>{view.zoom.toFixed(2)}x</span>
          </div>
        </div>
      </div>

      <svg className="w-full h-full pointer-events-none">
        {visibleTriangles.map((tri) => (
          <polygon
            key={tri.id}
            points={tri.points}
            fill={tri.color || "transparent"}
            stroke="currentColor"
            strokeWidth={0.5 / view.zoom}
            className={cn(
              "pointer-events-auto transition-all duration-300 cursor-pointer",
              tri.color 
                ? "text-white/70" 
                : "text-white/5 hover:text-white/20"
            )}
            onPointerDown={(e) => {
              // Only trigger drawing on direct left click
              if (e.button === 0 && !e.altKey) {
                e.stopPropagation();
                onCellClick(tri.id, tri.color || null);
              }
            }}
          />
        ))}
      </svg>
      
      {/* Bottom hint overlay */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/5 text-[8px] text-muted-foreground/40 uppercase tracking-[0.3em] pointer-events-none whitespace-nowrap">
        Alt+Drag / Middle-Click to Pan • Ctrl+Scroll to Zoom
      </div>
    </div>
  );
}
