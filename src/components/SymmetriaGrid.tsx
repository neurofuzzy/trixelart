'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Move, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Constants for triangular grid math
const TRI_SIDE = 50;
const TRI_HEIGHT = (TRI_SIDE * Math.sqrt(3)) / 2;

type TriangleState = Record<string, string>; // "q,r,t" -> color

export default function SymmetriaGrid() {
  // --- States ---
  const [mounted, setMounted] = useState(false);
  const [triangles, setTriangles] = useState<TriangleState>({});
  const [history, setHistory] = useState<TriangleState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const [activeColor, setActiveColor] = useState('#ffffff');
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const isPaintingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPointerPos = useRef({ x: 0, y: 0 });

  // --- Initialization & Persistence ---
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('symmetria-save-v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setTriangles(parsed);
        setHistory([parsed]);
        setHistoryIndex(0);
      } catch (e) {
        console.error("Failed to load save", e);
      }
    } else {
      setHistory([{}]);
      setHistoryIndex(0);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const saveToHistory = useCallback((newState: TriangleState) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ ...newState });
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    localStorage.setItem('symmetria-save-v2', JSON.stringify(newState));
  }, [history, historyIndex]);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, historyIndex]);

  const undo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setTriangles(prev);
      setHistoryIndex(historyIndex - 1);
      localStorage.setItem('symmetria-save-v2', JSON.stringify(prev));
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setTriangles(next);
      setHistoryIndex(historyIndex + 1);
      localStorage.setItem('symmetria-save-v2', JSON.stringify(next));
    }
  };

  // --- Grid Math ---
  const screenToWorld = (sx: number, sy: number) => {
    return {
      x: (sx - containerSize.width / 2 - viewport.x) / viewport.zoom,
      y: (sy - containerSize.height / 2 - viewport.y) / viewport.zoom,
    };
  };

  const getTriangleAt = (worldX: number, worldY: number) => {
    // Transform to rhombus coordinates
    const r = Math.floor(worldY / TRI_HEIGHT);
    const q = Math.floor((worldX - (r % 2 !== 0 ? TRI_SIDE / 2 : 0)) / TRI_SIDE);
    
    // Relative position within rhombus cell
    const rx = (worldX - (q * TRI_SIDE + (r % 2 !== 0 ? TRI_SIDE / 2 : 0))) / TRI_SIDE;
    const ry = (worldY - r * TRI_HEIGHT) / TRI_HEIGHT;

    // Determine which half of the rectangle (rhombus-ish) we are in
    // A simplified way to check the diagonal of the unit square
    const t = rx + ry > 1 ? 1 : 0; // 0 for top-left-ish, 1 for bottom-right-ish
    // Note: This is an approximation of the dual-triangle tiling
    // For equilateral triangles specifically, we check the diagonal:
    const tActual = (ry < 1 - 2 * Math.abs(rx - 0.5)) ? 0 : 1; 

    return `${q},${r},${tActual}`;
  };

  const paintAt = (sx: number, sy: number) => {
    const world = screenToWorld(sx, sy);
    const key = getTriangleAt(world.x, world.y);
    
    setTriangles(prev => {
      const next = { ...prev };
      if (tool === 'pen') next[key] = activeColor;
      else delete next[key];
      return next;
    });
  };

  // --- Interaction Handlers ---
  const handlePointerDown = (e: React.PointerEvent) => {
    lastPointerPos.current = { x: e.clientX, y: e.clientY };
    if (e.button === 0 && !e.altKey) {
      isPaintingRef.current = true;
      paintAt(e.clientX, e.clientY);
    } else {
      isPanningRef.current = true;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPaintingRef.current) {
      paintAt(e.clientX, e.clientY);
    } else if (isPanningRef.current) {
      const dx = e.clientX - lastPointerPos.current.x;
      const dy = e.clientY - lastPointerPos.current.y;
      setViewport(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastPointerPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isPaintingRef.current) {
      saveToHistory(triangles);
    }
    isPaintingRef.current = false;
    isPanningRef.current = false;
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const zoomSpeed = 0.001;
    const delta = -e.deltaY;
    const factor = Math.pow(1.1, delta / 100);
    const newZoom = Math.max(0.1, Math.min(20, viewport.zoom * factor));
    
    setViewport(prev => ({ ...prev, zoom: newZoom }));
  };

  // --- Rendering Calculations ---
  const visibleGrid = useMemo(() => {
    if (!mounted || containerSize.width === 0) return null;

    const trianglesToRender: React.ReactNode[] = [];
    const buffer = 3;
    const cols = Math.ceil(containerSize.width / (TRI_SIDE * viewport.zoom)) + buffer;
    const rows = Math.ceil(containerSize.height / (TRI_HEIGHT * viewport.zoom)) + buffer;

    const centerCol = Math.round(-viewport.x / (TRI_SIDE * viewport.zoom));
    const centerRow = Math.round(-viewport.y / (TRI_HEIGHT * viewport.zoom));

    for (let r = centerRow - Math.ceil(rows / 2); r <= centerRow + Math.ceil(rows / 2); r++) {
      for (let q = centerCol - Math.ceil(cols / 2); q <= centerCol + Math.ceil(cols / 2); q++) {
        // Offset rows
        const offsetX = r % 2 !== 0 ? TRI_SIDE / 2 : 0;
        const x = q * TRI_SIDE + offsetX;
        const y = r * TRI_HEIGHT;

        // Triangles at this cell
        // 0: Pointing Up
        // 1: Pointing Down
        [0, 1].forEach(t => {
          const key = `${q},${r},${t}`;
          const color = triangles[key] || 'transparent';
          
          let points = "";
          if (t === 0) { // Up
            points = `${x + TRI_SIDE/2},${y} ${x},${y + TRI_HEIGHT} ${x + TRI_SIDE},${y + TRI_HEIGHT}`;
          } else { // Down (offset logic for tiling)
            // The down triangle shares space differently in our grid
            // Let's use a simpler tiling: 
            // In row r, we have alternating up/down
            // But we already have Q/R/T. 
            // Let's refine the points for a perfect grid:
          }

          // Stable equilateral points based on (q,r,t)
          const pUp = `${x + TRI_SIDE/2},${y} ${x},${y + TRI_HEIGHT} ${x + TRI_SIDE},${y + TRI_HEIGHT}`;
          const pDown = `${x},${y} ${x + TRI_SIDE},${y} ${x + TRI_SIDE/2},${y + TRI_HEIGHT}`;
          
          // Re-map to ensure they interlock perfectly
          // Every q,r rhombus has an UP and a DOWN triangle that offset
          const finalPoints = t === 0 ? pUp : `${x - TRI_SIDE/2},${y} ${x + TRI_SIDE/2},${y} ${x},${y + TRI_HEIGHT}`;

          trianglesToRender.push(
            <polygon
              key={key}
              points={finalPoints}
              fill={color}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={1 / viewport.zoom}
              className="transition-colors duration-150"
            />
          );
        });
      }
    }

    return trianglesToRender;
  }, [mounted, viewport, containerSize, triangles]);

  // --- Origin & Axis Guides ---
  const guides = useMemo(() => {
    if (!mounted) return null;
    const size = 10000;
    const s = 1 / viewport.zoom;
    return (
      <g stroke="rgba(255,255,255,0.15)" strokeWidth={s}>
        {/* Horizontal */}
        <line x1={-size} y1={0} x2={size} y2={0} />
        {/* 60 deg */}
        <line x1={-size * 0.5} y1={-size * 0.866} x2={size * 0.5} y2={size * 0.866} />
        {/* 120 deg */}
        <line x1={size * 0.5} y1={-size * 0.866} x2={-size * 0.5} y2={size * 0.866} />
        {/* Origin */}
        <circle cx={0} cy={0} r={4 * s} fill="hsl(var(--primary))" />
      </g>
    );
  }, [mounted, viewport.zoom]);

  if (!mounted) return null;

  return (
    <div className="relative w-full h-full flex flex-col bg-background select-none overflow-hidden">
      {/* HUD - TOP */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 p-1 bg-black/50 backdrop-blur-md border border-white/10 rounded-full shadow-2xl">
        <Button
          variant={tool === 'pen' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => setTool('pen')}
          className="rounded-full"
        >
          <MousePointer2 className="w-4 h-4" />
        </Button>
        <Button
          variant={tool === 'eraser' ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => setTool('eraser')}
          className="rounded-full"
        >
          <Eraser className="w-4 h-4" />
        </Button>
        <div className="w-[1px] h-4 bg-white/10 mx-1" />
        {['#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map(c => (
          <button
            key={c}
            onClick={() => { setActiveColor(c); setTool('pen'); }}
            className={cn(
              "w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 active:scale-95",
              activeColor === c && tool === 'pen' ? "border-white scale-110" : "border-transparent"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <div className="w-[1px] h-4 bg-white/10 mx-1" />
        <Button variant="ghost" size="icon" onClick={undo} disabled={historyIndex <= 0} className="rounded-full">
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={redo} disabled={historyIndex >= history.length - 1} className="rounded-full">
          <Redo2 className="w-4 h-4" />
        </Button>
        <div className="w-[1px] h-4 bg-white/10 mx-1" />
        <Button variant="ghost" size="icon" onClick={() => { if(confirm("Clear canvas?")) { setTriangles({}); saveToHistory({}); }}} className="rounded-full text-destructive hover:text-destructive">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* CANVAS */}
      <div 
        ref={containerRef}
        className="w-full h-full cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="w-full h-full">
          <g transform={`translate(${containerSize.width / 2 + viewport.x}, ${containerSize.height / 2 + viewport.y}) scale(${viewport.zoom})`}>
            {guides}
            {visibleGrid}
          </g>
        </svg>
      </div>

      {/* FOOTER - INFO */}
      <div className="absolute bottom-6 left-6 z-50 flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-white/40">
        <div>POS: {Math.round(viewport.x)},{Math.round(viewport.y)} | ZOOM: {viewport.zoom.toFixed(2)}X</div>
        <div>LEFT CLICK: PAINT | RIGHT CLICK: PAN | SCROLL: ZOOM</div>
      </div>
    </div>
  );
}
