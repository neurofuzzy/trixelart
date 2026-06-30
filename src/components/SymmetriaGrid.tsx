'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Trash2, Maximize, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Constants for triangular grid math (Equilateral)
const SIDE = 50;
const HEIGHT = (SIDE * Math.sqrt(3)) / 2;

type TriangleState = Record<string, string>; // "q,r,t" -> color hex

export default function SymmetriaGrid() {
  const [mounted, setMounted] = useState(false);
  const [triangles, setTriangles] = useState<TriangleState>({});
  const [history, setHistory] = useState<TriangleState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const [activeColor, setActiveColor] = useState('#ffffff');
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  
  // Viewport state
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1.0 });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const isPaintingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPointerPos = useRef({ x: 0, y: 0 });

  // --- Initialization & Lifecycle ---
  useEffect(() => {
    setMounted(true);
    
    // Load from Local Storage
    const saved = localStorage.getItem('symmetria-canvas-save-v5');
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

    const measure = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const saveToHistory = useCallback((newState: TriangleState) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ ...newState });
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    localStorage.setItem('symmetria-canvas-save-v5', JSON.stringify(newState));
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
  }, [historyIndex, history]);

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
    
    // Relative to container center
    const relX = sx - rect.left - dimensions.width / 2;
    const relY = sy - rect.top - dimensions.height / 2;

    return {
      x: (relX - viewport.x) / viewport.zoom,
      y: (relY - viewport.y) / viewport.zoom,
    };
  };

  const getTriangleAt = (wx: number, wy: number) => {
    const r = Math.floor(wy / HEIGHT);
    const rowOffset = (r % 2 !== 0) ? SIDE / 2 : 0;
    const q = Math.floor((wx - rowOffset) / SIDE);
    
    const lx = wx - (q * SIDE + rowOffset);
    const ly = wy - (r * HEIGHT);

    // Diagonal check for up/down triangle
    // Formula for the diagonal divider in the rhombus cell
    const isUp = ly < (HEIGHT - (HEIGHT / (SIDE / 2)) * Math.abs(lx - SIDE / 2));
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

  // --- Pointer Handlers ---
  const handlePointerDown = (e: React.PointerEvent) => {
    lastPointerPos.current = { x: e.clientX, y: e.clientY };
    
    // Left Click: Paint (unless Alt is pressed)
    if (e.button === 0 && !e.altKey) {
      isPaintingRef.current = true;
      paintAt(e.clientX, e.clientY);
    } else {
      // Right Click or Alt+Left: Pan
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

  // --- Rendering ---
  const gridContent = useMemo(() => {
    if (!mounted || dimensions.width === 0) return null;

    const visibleElements: React.ReactNode[] = [];
    const buffer = 3; // Extra tiles around edge
    
    const viewWidth = dimensions.width / viewport.zoom;
    const viewHeight = dimensions.height / viewport.zoom;
    
    const startR = Math.floor((-viewport.y - viewHeight/2) / HEIGHT) - buffer;
    const endR = Math.ceil((-viewport.y + viewHeight/2) / HEIGHT) + buffer;
    
    const startQ = Math.floor((-viewport.x - viewWidth/2) / SIDE) - buffer;
    const endQ = Math.ceil((-viewport.x + viewWidth/2) / SIDE) + buffer;

    for (let r = startR; r <= endR; r++) {
      const rowOffset = (r % 2 !== 0) ? SIDE / 2 : 0;
      for (let q = startQ; q <= endQ; q++) {
        const x = q * SIDE + rowOffset;
        const y = r * HEIGHT;

        // Up triangle
        const keyUp = `${q},${r},0`;
        const colorUp = triangles[keyUp] || 'transparent';
        const pointsUp = `${x + SIDE/2},${y} ${x},${y + HEIGHT} ${x + SIDE},${y + HEIGHT}`;

        visibleElements.push(
          <polygon
            key={keyUp}
            points={pointsUp}
            fill={colorUp}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={0.5 / viewport.zoom}
            className="pointer-events-none"
          />
        );

        // Down triangle
        const keyDown = `${q},${r},1`;
        const colorDown = triangles[keyDown] || 'transparent';
        const pointsDown = `${x},${y} ${x + SIDE},${y} ${x + SIDE/2},${y + HEIGHT}`;

        visibleElements.push(
          <polygon
            key={keyDown}
            points={pointsDown}
            fill={colorDown}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={0.5 / viewport.zoom}
            className="pointer-events-none"
          />
        );
      }
    }

    return visibleElements;
  }, [mounted, viewport, dimensions, triangles]);

  const guides = useMemo(() => {
    const size = 100000; // Large enough for "infinite" feel
    const sw = 1.0 / viewport.zoom;
    
    return (
      <g>
        {/* Origin Axes - Slightly Lighter */}
        <g stroke="rgba(255,255,255,0.25)" strokeWidth={sw}>
          <line x1={-size} y1={0} x2={size} y2={0} /> {/* Horizontal */}
          <line x1={-size * 0.5} y1={-size * 0.866} x2={size * 0.5} y2={size * 0.866} /> {/* 60 deg */}
          <line x1={size * 0.5} y1={-size * 0.866} x2={-size * 0.5} y2={size * 0.866} /> {/* 120 deg */}
        </g>
        
        {/* Origin Dot */}
        <circle cx={0} cy={0} r={5 * sw} fill="#ffffff" />
      </g>
    );
  }, [viewport.zoom]);

  if (!mounted) return null;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#080808] select-none overflow-hidden touch-none font-sans">
      {/* HUD - Toolbar */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-4 py-2 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
        <div className="flex items-center gap-1">
          <Button
            variant={tool === 'pen' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setTool('pen')}
            className="rounded-xl h-10 w-10 transition-all hover:scale-105"
          >
            <MousePointer2 className="w-5 h-5" />
          </Button>
          <Button
            variant={tool === 'eraser' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setTool('eraser')}
            className="rounded-xl h-10 w-10 transition-all hover:scale-105"
          >
            <Eraser className="w-5 h-5" />
          </Button>
        </div>
        
        <div className="w-[1px] h-6 bg-white/10" />
        
        <div className="flex items-center gap-2">
          {['#ffffff', '#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa'].map(c => (
            <button
              key={c}
              onClick={() => { setActiveColor(c); setTool('pen'); }}
              className={cn(
                "w-7 h-7 rounded-full border-2 transition-all hover:scale-125 active:scale-95 shadow-lg",
                activeColor === c && tool === 'pen' ? "border-white scale-125 ring-2 ring-white/20" : "border-transparent"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        
        <div className="w-[1px] h-6 bg-white/10" />
        
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={undo} disabled={historyIndex <= 0} className="rounded-xl h-10 w-10">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={historyIndex >= history.length - 1} className="rounded-xl h-10 w-10">
            <Redo2 className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => { if(confirm("Clear the entire canvas?")) { setTriangles({}); saveToHistory({}); }}} 
            className="rounded-xl h-10 w-10 text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* CANVAS Area */}
      <div 
        ref={containerRef}
        className="w-full h-full cursor-crosshair overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="w-full h-full">
          <g transform={`translate(${dimensions.width / 2 + viewport.x}, ${dimensions.height / 2 + viewport.y}) scale(${viewport.zoom})`}>
            {guides}
            {gridContent}
          </g>
        </svg>
      </div>

      {/* FOOTER Info */}
      <div className="absolute bottom-6 left-8 z-50 flex flex-col gap-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 pointer-events-none">
        <div className="flex items-center gap-6">
          <span>COORDS: {Math.round(-viewport.x)},{Math.round(-viewport.y)}</span>
          <span>SCALE: {viewport.zoom.toFixed(2)}X</span>
        </div>
        <div className="flex items-center gap-6 mt-1">
          <button 
            onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })} 
            className="pointer-events-auto hover:text-white flex items-center gap-1.5 transition-colors group"
          >
            <RotateCcw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" /> RESET PERSPECTIVE
          </button>
          <span>RIGHT-CLICK TO PAN</span>
        </div>
      </div>
    </div>
  );
}
