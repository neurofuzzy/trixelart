
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

  const handlePointerDown = (e: React.PointerEvent) => {
    // Middle click or Space/Alt could be used, but here we use simple drag if not clicking a cell
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
      const zoomSpeed = 0.001;
      const factor = 1 - e.deltaY * zoomSpeed;
      const newZoom = Math.max(0.1, Math.min(10, view.zoom * factor));
      
      // Zoom toward mouse position
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
      // Normal pan with wheel
      setView(v => ({
        ...v,
        x: v.x - e.deltaX,
        y: v.y - e.deltaY,
      }));
    }
  };

  // Determine which triangles are visible
  const visibleTriangles = useMemo(() => {
    if (!dimensions.width || !dimensions.height) return [];

    const triangles = [];
    const zoom = view.zoom;
    const offsetX = view.x;
    const offsetY = view.y;

    // Calculate grid range based on viewport
    const minRow = Math.floor((-offsetY) / (H * zoom)) - 1;
    const maxRow = Math.ceil((dimensions.height - offsetY) / (H * zoom)) + 1;
    
    const minCol = Math.floor((-offsetX) / (SIDE_UNIT / 2 * zoom)) - 2;
    const maxCol = Math.ceil((dimensions.width - offsetX) / (SIDE_UNIT / 2 * zoom)) + 2;

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const id = `${r},${c}`;
        const isUpward = (r + c) % 2 === 0;
        
        // Base coordinates in grid space
        const x = c * (SIDE_UNIT / 2);
        const y = r * H;

        let points;
        if (isUpward) {
          points = [
            `${(x * zoom) + offsetX},${(y * zoom) + offsetY}`,
            `${((x + SIDE_UNIT) * zoom) + offsetX},${(y * zoom) + offsetY}`,
            `${((x + SIDE_UNIT / 2) * zoom) + offsetX},${((y - H) * zoom) + offsetY}`
          ].join(" ");
        } else {
          points = [
            `${(x * zoom) + offsetX},${(y * zoom) + offsetY}`,
            `${((x + SIDE_UNIT / 2) * zoom) + offsetX},${((y + H) * zoom) + offsetY}`,
            `${((x + SIDE_UNIT) * zoom) + offsetX},${(y * zoom) + offsetY}`
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
      className="w-full h-full relative overflow-hidden bg-card/20 rounded-[32px] border cursor-crosshair select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-mono border text-muted-foreground z-10 pointer-events-none">
        POS: {Math.round(view.x)},{Math.round(view.y)} | ZOOM: {view.zoom.toFixed(2)}x
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
              "pointer-events-auto transition-colors duration-200 cursor-pointer",
              tri.color ? "stroke-white/10" : "text-muted-foreground/5 hover:text-muted-foreground/20"
            )}
            onMouseDown={(e) => {
              if (e.button === 0 && !e.altKey) {
                e.stopPropagation();
                onCellClick(tri.id, tri.color || null);
              }
            }}
          />
        ))}
      </svg>
    </div>
  );
}
