'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Trash2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Constants for equilateral triangular grid math
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
  
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1.0 });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const isPaintingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPointerPos = useRef({ x: 0, y: 0 });

  // 1. Initial Measurement & Persistence Restoration
  useEffect(() => {
    setMounted(true);
    
    const saved = localStorage.getItem('symmetria-save-v12');
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

  // 2. History Persistence
  const saveToHistory = useCallback((newState: TriangleState) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ ...newState });
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    localStorage.setItem('symmetria-save-v12', JSON.stringify(newState));
  }, [history, historyIndex]);

  // 3. Keyboard Shortcuts (Undo/Redo)
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

  // 4. World Coordinate Conversion
  const screenToWorld = (sx: number, sy: number) => {
    if (!containerRef.current || dimensions.width === 0) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const relX = (sx - rect.left) - dimensions.width / 2;
    const relY = (sy - rect.top) - dimensions.height / 2;
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
    const isUp = ly < (HEIGHT - (HEIGHT / (SIDE / 2)) * Math.abs(lx - SIDE / 2));
    return `${q},${r},${isUp ? 0 : 1}`;
  };

  // 5. Interaction Handlers
  const paintAt = (sx: number, sy: number) => {
    const world = screenToWorld(sx, sy);
    const key = getTriangleAt(world.x, world.y);
    setTriangles(prev => {
      const newVal = tool === 'pen' ? activeColor : undefined;
      if (prev[key] === newVal) return prev;
      const next = { ...prev };
      if (newVal) next[key] = newVal;
      else delete next[key];
      return next;
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    lastPointerPos.current = { x: e.clientX, y: e.clientY };
    if (e.button === 0) {
      isPaintingRef.current = true;
      paintAt(e.clientX, e.clientY);
    } else if (e.button === 2) {
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
    if (isPaintingRef.current) saveToHistory(triangles);
    isPaintingRef.current = false;
    isPanningRef.current = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const factor = Math.pow(1.1, -e.deltaY / 200);
    const newZoom = Math.max(0.1, Math.min(20, viewport.zoom * factor));
    setViewport(prev => ({ ...prev, zoom: newZoom }));
  };

  // 6. SVG Render Content
  const gridContent = useMemo(() => {
    if (!mounted || dimensions.width === 0) return null;
    const elements: React.ReactNode[] = [];
    const buffer = 5;
    const viewW = dimensions.width / viewport.zoom;
    const viewH = dimensions.height / viewport.zoom;
    const startR = Math.floor((-viewport.y - viewH/2) / HEIGHT) - buffer;
    const endR = Math.ceil((-viewport.y + viewH/2) / HEIGHT) + buffer;
    const startQ = Math.floor((-viewport.x - viewW/2) / SIDE) - buffer;
    const endQ = Math.ceil((-viewport.x + viewW/2) / SIDE) + buffer;

    for (let r = startR; r <= endR; r++) {
      const rowOffset = (r % 2 !== 0) ? SIDE / 2 : 0;
      for (let q = startQ; q <= endQ; q++) {
        const x = q * SIDE + rowOffset;
        const y = r * HEIGHT;
        const keyUp = `${q},${r},0`;
        const keyDown = `${q},${r},1`;
        
        elements.push(
          <polygon
            key={keyUp}
            points={`${x + SIDE/2},${y} ${x},${y + HEIGHT} ${x + SIDE},${y + HEIGHT}`}
            fill={triangles[keyUp] || 'transparent'}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.5 / viewport.zoom}
            className="pointer-events-none"
          />,
          <polygon
            key={keyDown}
            points={`${x},${y} ${x + SIDE},${y} ${x + SIDE/2},${y + HEIGHT}`}
            fill={triangles[keyDown] || 'transparent'}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.5 / viewport.zoom}
            className="pointer-events-none"
          />
        );
      }
    }
    return elements;
  }, [mounted, viewport, dimensions, triangles]);

  const guides = useMemo(() => {
    const size = 100000;
    const sw = 1.0 / viewport.zoom;
    return (
      <g>
        <g stroke="rgba(255,255,255,0.2)" strokeWidth={sw}>
          <line x1={-size} y1={0} x2={size} y2={0} />
          <line x1={-size * 0.5} y1={-size * 0.866} x2={size * 0.5} y2={size * 0.866} />
          <line x1={size * 0.5} y1={-size * 0.866} x2={-size * 0.5} y2={size * 0.866} />
        </g>
        <circle cx={0} cy={0} r={6 * sw} fill="#ffffff" />
      </g>
    );
  }, [viewport.zoom]);

  if (!mounted) return null;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#050505] select-none overflow-hidden touch-none">
      {/* HUD Toolbar */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
        <Button variant={tool === 'pen' ? 'secondary' : 'ghost'} size="icon" onClick={() => setTool('pen')} className="rounded-xl h-10 w-10">
          <MousePointer2 className="w-5 h-5" />
        </Button>
        <Button variant={tool === 'eraser' ? 'secondary' : 'ghost'} size="icon" onClick={() => setTool('eraser')} className="rounded-xl h-10 w-10">
          <Eraser className="w-5 h-5" />
        </Button>
        <div className="w-[1px] h-6 bg-white/10 mx-1" />
        <div className="flex items-center gap-2">
          {['#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map(c => (
            <button
              key={c}
              onClick={() => { setActiveColor(c); setTool('pen'); }}
              className={cn("w-7 h-7 rounded-full border-2 transition-all hover:scale-125", activeColor === c && tool === 'pen' ? "border-white scale-110" : "border-transparent")}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="w-[1px] h-6 bg-white/10 mx-1" />
        <Button variant="ghost" size="icon" onClick={undo} disabled={historyIndex <= 0} className="rounded-xl h-9 w-9">
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={redo} disabled={historyIndex >= history.length - 1} className="rounded-xl h-9 w-9">
          <Redo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => { if(confirm("Clear canvas?")) { setTriangles({}); saveToHistory({}); }}} className="rounded-xl h-9 w-9 text-red-400">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Main Canvas Area */}
      <div 
        ref={containerRef} 
        className="w-full h-full cursor-crosshair" 
        onPointerDown={handlePointerDown} 
        onPointerMove={handlePointerMove} 
        onPointerUp={handlePointerUp} 
        onWheel={handleWheel} 
        onContextMenu={e => e.preventDefault()}
      >
        <svg className="w-full h-full block">
          <g transform={`translate(${dimensions.width/2 + viewport.x}, ${dimensions.height/2 + viewport.y}) scale(${viewport.zoom})`}>
            {guides}
            {gridContent}
          </g>
        </svg>
      </div>

      {/* Telemetry Footer */}
      <div className="absolute bottom-6 left-8 z-50 flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-white/30 pointer-events-none">
        <div className="flex gap-4">
          <span>X: {Math.round(-viewport.x)} Y: {Math.round(-viewport.y)}</span>
          <span>ZOOM: {viewport.zoom.toFixed(2)}X</span>
        </div>
        <div className="flex gap-4 mt-1 pointer-events-auto">
          <button onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })} className="hover:text-white flex items-center gap-1.5 transition-colors">
            <RotateCcw className="w-3 h-3" /> RESET VIEW
          </button>
          <span>RIGHT-CLICK TO PAN</span>
        </div>
      </div>
    </div>
  );
}