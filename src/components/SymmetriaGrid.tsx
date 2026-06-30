'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Trash2, Maximize } from 'lucide-react';
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
    const saved = localStorage.getItem('symmetria-canvas-save-v4');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setTriangles(parsed);
        setHistory([parsed]);
        setHistoryIndex(0);
      } catch (e) {
        setHistory([{}]);
        setHistoryIndex(0);
      }
    } else {
      setHistory([{}]);
      setHistoryIndex(0);
    }

    // Measurement logic
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setDimensions({ width: rect.width, height: rect.height });
        }
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
    if (newHistory.length > 100) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    localStorage.setItem('symmetria-canvas-save-v4', JSON.stringify(newState));
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
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setTriangles(next);
      setHistoryIndex(historyIndex + 1);
    }
  };

  // --- Coordinate Mapping ---
  const screenToWorld = (sx: number, sy: number) => {
    if (!containerRef.current || dimensions.width === 0) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    
    // Calculate position relative to container center
    const relX = sx - rect.left - dimensions.width / 2;
    const relY = sy - rect.top - dimensions.height / 2;

    return {
      x: (relX - viewport.x) / viewport.zoom,
      y: (relY - viewport.y) / viewport.zoom,
    };
  };

  const getTriangleAt = (wx: number, wy: number) => {
    const r = Math.floor(wy / TRI_HEIGHT);
    const rowOffset = (r % 2 !== 0) ? TRI_SIDE / 2 : 0;
    const q = Math.floor((wx - rowOffset) / TRI_SIDE);
    
    const lx = wx - (q * TRI_SIDE + rowOffset);
    const ly = wy - (r * TRI_HEIGHT);

    // Diagonal check for up/down triangle in the equilateral rhombus cell
    const isUp = ly < (TRI_HEIGHT - (TRI_HEIGHT / (TRI_SIDE / 2)) * Math.abs(lx - TRI_SIDE / 2));
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
    
    if (e.button === 0 && !e.altKey) {
      isPaintingRef.current = true;
      paintAt(e.clientX, e.clientY);
    } else {
      isPanningRef.current = true;
    }
    
    containerRef.current?.setPointerCapture(e.pointerId);
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
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const factor = Math.pow(1.1, -e.deltaY / 150);
    const newZoom = Math.max(0.1, Math.min(20, viewport.zoom * factor));
    setViewport(prev => ({ ...prev, zoom: newZoom }));
  };

  // --- Render Loops ---
  const gridContent = useMemo(() => {
    if (!mounted || dimensions.width === 0) return null;

    const visibleTriangles: React.ReactNode[] = [];
    
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

        // Up triangle
        const keyUp = `${q},${r},0`;
        const colorUp = triangles[keyUp] || 'transparent';
        const pointsUp = `${x + TRI_SIDE/2},${y} ${x},${y + TRI_HEIGHT} ${x + TRI_SIDE},${y + TRI_HEIGHT}`;

        visibleTriangles.push(
          <polygon
            key={keyUp}
            points={pointsUp}
            fill={colorUp}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={1 / viewport.zoom}
            className="transition-colors duration-150 pointer-events-none"
          />
        );

        // Down triangle
        const keyDown = `${q},${r},1`;
        const colorDown = triangles[keyDown] || 'transparent';
        const pointsDown = `${x},${y} ${x + TRI_SIDE},${y} ${x + TRI_SIDE/2},${y + TRI_HEIGHT}`;

        visibleTriangles.push(
          <polygon
            key={keyDown}
            points={pointsDown}
            fill={colorDown}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={1 / viewport.zoom}
            className="transition-colors duration-150 pointer-events-none"
          />
        );
      }
    }

    return visibleTriangles;
  }, [mounted, viewport, dimensions, triangles]);

  const guides = useMemo(() => {
    const s = 10000;
    const sw = 1.5 / viewport.zoom;
    return (
      <g stroke="rgba(255,255,255,0.2)" strokeWidth={sw}>
        <circle cx={0} cy={0} r={5 * sw} fill="#ffffff" stroke="none" />
        <line x1={-s} y1={0} x2={s} y2={0} />
        <line x1={-s * 0.5} y1={-s * 0.866} x2={s * 0.5} y2={s * 0.866} />
        <line x1={s * 0.5} y1={-s * 0.866} x2={-s * 0.5} y2={s * 0.866} />
      </g>
    );
  }, [viewport.zoom]);

  if (!mounted) return null;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#050505] select-none overflow-hidden touch-none">
      {/* HUD - TOP */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 p-2 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
        <div className="flex items-center gap-1">
          <Button
            variant={tool === 'pen' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setTool('pen')}
            className="rounded-full h-9 w-9"
          >
            <MousePointer2 className="w-4 h-4" />
          </Button>
          <Button
            variant={tool === 'eraser' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setTool('eraser')}
            className="rounded-full h-9 w-9"
          >
            <Eraser className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="w-[1px] h-5 bg-white/10" />
        
        <div className="flex items-center gap-2">
          {['#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map(c => (
            <button
              key={c}
              onClick={() => { setActiveColor(c); setTool('pen'); }}
              className={cn(
                "w-7 h-7 rounded-full border-2 transition-all hover:scale-110 active:scale-95",
                activeColor === c && tool === 'pen' ? "border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.3)]" : "border-transparent"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        
        <div className="w-[1px] h-5 bg-white/10" />
        
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={undo} disabled={historyIndex <= 0} className="rounded-full h-9 w-9">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={historyIndex >= history.length - 1} className="rounded-full h-9 w-9">
            <Redo2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { if(confirm("Clear canvas?")) { setTriangles({}); saveToHistory({}); }}} className="rounded-full h-9 w-9 text-red-400 hover:text-red-300">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
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
      <div className="absolute bottom-6 left-8 z-50 flex flex-col gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/30">
        <div className="flex items-center gap-4">
          <span>POS: {Math.round(-viewport.x)},{Math.round(-viewport.y)}</span>
          <span>ZOOM: {viewport.zoom.toFixed(2)}X</span>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })} className="hover:text-white flex items-center gap-1.5 transition-colors">
            <Maximize className="w-3 h-3" /> RESET VIEW
          </button>
        </div>
      </div>
    </div>
  );
}
