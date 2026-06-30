"use client";

import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Maximize, MousePointer2, Move } from "lucide-react";

interface SymmetriaGridProps {
  grid: Record<string, string>;
  onCellClick: (id: string, color: string | null) => void;
  activeColor: string;
}

const SIDE = 60;
const HEIGHT = (Math.sqrt(3) / 2) * SIDE;

export function SymmetriaGrid({ grid, onCellClick, activeColor }: SymmetriaGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const lastPointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setMounted(true);
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mounted && dimensions.width > 0 && dimensions.height > 0 && view.x === 0 && view.y === 0) {
      setView({ x: dimensions.width / 2, y: dimensions.height / 2, zoom: 1 });
    }
  }, [mounted, dimensions, view.x, view.y]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
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
    if (containerRef.current) {
      containerRef.current.releasePointerCapture(e.pointerId);
    }
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

    const minRow = Math.floor((-offsetY) / h) - 2;
    const maxRow = Math.ceil((dimensions.height - offsetY) / h) + 2;
    const minCol = Math.floor((-offsetX) / (s / 2)) - 2;
    const maxCol = Math.ceil((dimensions.width - offsetX) / (s / 2)) + 2;

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const id = `${r},${c}`;
        const isUpward = (Math.abs(r + c) % 2) === 1;

        const x = c * (s / 2) + offsetX;
        const yBase = r * h + offsetY;

        const xF = x.toFixed(2);
        const yF = yBase.toFixed(2);
        const sF = (x + s).toFixed(2);
        const shF = (x + s / 2).toFixed(2);
        const hF = (yBase + h).toFixed(2);

        const points = isUpward 
          ? `${xF},${hF} ${sF},${hF} ${shF},${yF}`
          : `${xF},${yF} ${sF},${yF} ${shF},${hF}`;

        triangles.push({ id, points, color: grid[id] });
      }
    }
    return triangles;
  }, [dimensions, view, grid]);

  const handleCellAction = useCallback((id: string, currentColor: string | null) => {
    const nextColor = currentColor === activeColor ? null : activeColor;
    onCellClick(id, nextColor);
  }, [activeColor, onCellClick]);

  const resetView = () => {
    setView({ x: dimensions.width / 2, y: dimensions.height / 2, zoom: 1 });
  };

  if (!mounted) return <div className="w-full h-full bg-[#050505] rounded-[2.5rem] animate-pulse" />;

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative overflow-hidden bg-[#0a0a0a] rounded-[2.5rem] border border-white/5 cursor-crosshair select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute top-8 left-8 flex flex-col gap-2 pointer-events-none z-10">
        <div className="flex items-center gap-3 bg-white/5 backdrop-blur-xl px-5 py-3 rounded-2xl border border-white/10 shadow-2xl">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-bold text-white/80 uppercase tracking-widest">TriCanvas Live</span>
          <span className="text-[10px] font-mono text-white/30 ml-2">
            {Math.round(view.x)}, {Math.round(view.y)} @ {view.zoom.toFixed(2)}x
          </span>
        </div>
      </div>

      <div className="absolute top-8 right-8 flex flex-col gap-2 z-20">
        <button 
          onClick={resetView}
          className="p-3 bg-white/5 hover:bg-white/10 backdrop-blur-xl border border-white/10 rounded-xl transition-all hover:scale-105 active:scale-95"
          title="Reset View"
        >
          <Maximize className="h-4 w-4 text-white/60" />
        </button>
      </div>

      <svg width="100%" height="100%" className="block">
        <circle cx={view.x} cy={view.y} r={4 / view.zoom} fill="var(--primary)" opacity={0.2} />
        
        {visibleTriangles.map((tri) => (
          <polygon
            key={tri.id}
            points={tri.points}
            fill={tri.color || "transparent"}
            stroke="rgba(255, 255, 255, 0.05)"
            strokeWidth={0.5}
            className={cn(
              "transition-colors duration-150",
              !tri.color && "hover:fill-white/[0.03]"
            )}
            onPointerDown={(e) => {
              if (e.button === 0 && !e.altKey) {
                setIsPainting(true);
                handleCellAction(tri.id, tri.color || null);
              }
            }}
            onPointerEnter={() => {
              if (isPainting && !isPanning) {
                handleCellAction(tri.id, tri.color || null);
              }
            }}
          />
        ))}
      </svg>
      
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 px-8 py-3 bg-black/80 backdrop-blur-2xl rounded-full border border-white/5 shadow-2xl pointer-events-none whitespace-nowrap">
        <div className="flex items-center gap-2 text-[10px] text-white/40 font-medium uppercase">
          <MousePointer2 className="h-3 w-3" />
          <span>Click/Drag to Paint</span>
        </div>
        <div className="w-px h-3 bg-white/10" />
        <div className="flex items-center gap-2 text-[10px] text-white/40 font-medium uppercase">
          <Move className="h-3 w-3" />
          <span>Right-Click to Pan</span>
        </div>
        <div className="w-px h-3 bg-white/10" />
        <div className="text-[10px] text-white/40 font-medium uppercase tracking-tighter">
          Ctrl + Scroll to Zoom
        </div>
      </div>
    </div>
  );
}
