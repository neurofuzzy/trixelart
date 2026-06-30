'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Constants for triangular grid math
const TRI_SIDE = 50;
const TRI_HEIGHT = (TRI_SIDE * Math.sqrt(3)) / 2;

type TriangleState = Record<string, string>; // "q,r,t" -> color

export default function SymmetriaGrid() {
  const [mounted, setMounted] = useState(false);
  const [triangles, setTriangles] = useState<TriangleState>({});
  const [history, setHistory] = useState<TriangleState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const [activeColor, setActiveColor] = useState('#ffffff');
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  
  // Viewport state: x/y is the world-space center offset
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const isPaintingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPointerPos = useRef({ x: 0, y: 0 });

  // --- Initialize & Measure ---
  useEffect(() => {
    setMounted(true);
    
    // Load from Local Storage
    const saved = localStorage.getItem('symmetria-canvas-save');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setTriangles(parsed);
        setHistory([parsed]);
        setHistoryIndex(0);
      } catch (e) {
        console.error("Failed to load save", e);
        setHistory([{}]);
        setHistoryIndex(0);
      }
    } else {
      setHistory([{}]);
      setHistoryIndex(0);
    }

    // Measure container
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const saveToHistory = useCallback((newState: TriangleState) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ ...newState });
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    localStorage.setItem('symmetria-canvas-save', JSON.stringify(newState));
  }, [history, historyIndex]);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
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
      localStorage.setItem('symmetria-canvas-save', JSON.stringify(prev));
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setTriangles(next);
      setHistoryIndex(historyIndex + 1);
      localStorage.setItem('symmetria-canvas-save', JSON.stringify(next));
    }
  };

  // --- Coordinate Mapping ---
  const screenToWorld = (sx: number, sy: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    
    // Relative to container center
    return {
      x: (sx - rect.left - dimensions.width / 2 - viewport.x) / viewport.zoom,
      y: (sy - rect.top - dimensions.height / 2 - viewport.y) / viewport.zoom,
    };
  };

  const getTriangleAt = (wx: number, wy: number) => {
    // Determine row 'r' based on triangle height
    const r = Math.floor(wy / TRI_HEIGHT);
    // Offset every other row
    const rowOffset = (r % 2 !== 0) ? TRI_SIDE / 2 : 0;
    // Determine column 'q'
    const q = Math.floor((wx - rowOffset) / TRI_SIDE);
    
    // Position within the rhombus-like cell
    const cellX = wx - (q * TRI_SIDE + rowOffset);
    const cellY = wy - (r * TRI_HEIGHT);

    // Determine if we are in the 'up' or 'down' triangle of this cell
    // Standard equilateral tiling: 
    // Top-left to bottom-right diagonal check
    // The diagonal is: y = (h/s) * 2 * |x - s/2|
    const isUp = cellY < (TRI_HEIGHT - (TRI_HEIGHT / (TRI_SIDE / 2)) * Math.abs(cellX - TRI_SIDE / 2));
    const t = isUp ? 0 : 1;

    return `${q},${r},${t}`;
  };

  const paintAt = (sx: number, sy: number) => {
    const world = screenToWorld(sx, sy);
    const key = getTriangleAt(world.x, world.y);
    
    setTriangles(prev => {
      const currentVal = prev[key];
      const newVal = tool === 'pen' ? activeColor : undefined;
      
      if (currentVal === newVal) return prev;
      
      const next = { ...prev };
      if (newVal) next[key] = newVal;
      else delete next[key];
      return next;
    });
  };

  // --- Interaction ---
  const handlePointerDown = (e: React.PointerEvent) => {
    lastPointerPos.current = { x: e.clientX, y: e.clientY };
    
    // Left click or Alt+Click for painting vs panning
    // Right click (button 2) for panning
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
    const factor = Math.pow(1.1, -e.deltaY / 100);
    const newZoom = Math.max(0.1, Math.min(20, viewport.zoom * factor));
    
    // Zooming towards mouse cursor can be complex, let's keep it centered for now
    setViewport(prev => ({ ...prev, zoom: newZoom }));
  };

  // --- Render Loops ---
  const gridContent = useMemo(() => {
    if (!mounted || dimensions.width === 0) return null;

    const visibleTriangles: React.ReactNode[] = [];
    
    // Calculate visible range of q and r
    const buffer = 2;
    const viewWidth = dimensions.width / viewport.zoom;
    const viewHeight = dimensions.height / viewport.zoom;
    
    const startR = Math.floor((-viewport.y - viewHeight/2) / TRI_HEIGHT) - buffer;
    const endR = Math.ceil((-viewport.y + viewHeight/2) / TRI_HEIGHT) + buffer;
    
    const startQ = Math.floor((-viewport.x - viewWidth/2) / TRI_SIDE) - buffer;
    const endQ = Math.ceil((-viewport.x + viewWidth/2) / TRI_SIDE) + buffer;

    for (let r = startR; r <= endR; r++) {
      const rowOffset = (r % 2 !== 0) ? TRI_SIDE / 2 : 0;
      for (let q = startQ; q <= endQ; q++) {
        const x = q * TRI_SIDE + rowOffset;
        const y = r * TRI_HEIGHT;

        // Up triangle (t=0)
        const keyUp = `${q},${r},0`;
        const colorUp = triangles[keyUp] || 'transparent';
        const pointsUp = `${x + TRI_SIDE/2},${y} ${x},${y + TRI_HEIGHT} ${x + TRI_SIDE},${y + TRI_HEIGHT}`;

        visibleTriangles.push(
          <polygon
            key={keyUp}
            points={pointsUp}
            fill={colorUp}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1 / viewport.zoom}
            className="transition-colors duration-150 pointer-events-none"
          />
        );

        // Down triangle (t=1)
        // A down triangle fills the gap between the up triangles
        // Its top vertices match the bottom vertices of the up triangle above it (sort of)
        // Simplified tiling: Up and Down in every cell
        const keyDown = `${q},${r},1`;
        const colorDown = triangles[keyDown] || 'transparent';
        const pointsDown = `${x},${y} ${x + TRI_SIDE},${y} ${x + TRI_SIDE/2},${y + TRI_HEIGHT}`;

        visibleTriangles.push(
          <polygon
            key={keyDown}
            points={pointsDown}
            fill={colorDown}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1 / viewport.zoom}
            className="transition-colors duration-150 pointer-events-none"
          />
        );
      }
    }

    return visibleTriangles;
  }, [mounted, viewport, dimensions, triangles]);

  // Origin & Axis Guides
  const guides = useMemo(() => {
    const s = 10000;
    const sw = 1 / viewport.zoom;
    return (
      <g stroke="rgba(255,255,255,0.15)" strokeWidth={sw}>
        {/* Origin Dot */}
        <circle cx={0} cy={0} r={4 * sw} fill="hsl(var(--primary))" stroke="none" />
        {/* Horizontal */}
        <line x1={-s} y1={0} x2={s} y2={0} stroke="rgba(255,255,255,0.25)" />
        {/* 60 deg */}
        <line x1={-s * 0.5} y1={-s * 0.866} x2={s * 0.5} y2={s * 0.866} stroke="rgba(255,255,255,0.25)" />
        {/* 120 deg */}
        <line x1={s * 0.5} y1={-s * 0.866} x2={-s * 0.5} y2={s * 0.866} stroke="rgba(255,255,255,0.25)" />
      </g>
    );
  }, [viewport.zoom]);

  if (!mounted) return null;

  return (
    <div className="relative w-full h-full flex flex-col bg-background select-none overflow-hidden touch-none">
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
        className="w-full h-full cursor-crosshair overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="w-full h-full pointer-events-none">
          <g transform={`translate(${dimensions.width / 2 + viewport.x}, ${dimensions.height / 2 + viewport.y}) scale(${viewport.zoom})`}>
            {guides}
            {gridContent}
          </g>
        </svg>
      </div>

      {/* FOOTER */}
      <div className="absolute bottom-6 left-6 z-50 flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-white/40">
        <div>POS: {Math.round(-viewport.x)},{Math.round(-viewport.y)} | ZOOM: {viewport.zoom.toFixed(2)}X</div>
        <div>LEFT CLICK: PAINT | RIGHT CLICK: PAN | SCROLL: ZOOM</div>
      </div>
    </div>
  );
}
