'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Move, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useCanvasSize } from '@/hooks/use-canvas-size';
import { SIDE, H, worldToTri, triToString, getTriPath } from '@/lib/grid-math';

export default function SymmetriaGrid() {
  const [mounted, setMounted] = useState(false);
  const { size, containerRef } = useCanvasSize();
  
  // View State (Pan and Zoom)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  
  // Tool State
  const [tool, setTool] = useState<'paint' | 'erase' | 'pan'>('paint');
  const [color, setColor] = useState('hsl(var(--primary))');
  
  // Drawing Data
  const [painted, setPainted] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // Interaction Ref to avoid re-renders during drag
  const interaction = useRef<{
    isPainting: boolean;
    isPanning: boolean;
    lastPos: { x: number; y: number } | null;
  }>({ isPainting: false, isPanning: false, lastPos: null });

  // 1. Initialization and Persistence
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('symmetria-save');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setPainted(data);
        setHistory([data]);
        setHistoryIdx(0);
      } catch (e) {
        console.error("Failed to load save", e);
      }
    }
  }, []);

  useEffect(() => {
    if (mounted) localStorage.setItem('symmetria-save', JSON.stringify(painted));
  }, [painted, mounted]);

  // 2. Actions (Undo/Redo)
  const pushHistory = useCallback((newState: Record<string, string>) => {
    setHistory(prev => {
      const next = prev.slice(0, historyIdx + 1);
      next.push({ ...newState });
      if (next.length > 50) next.shift();
      return next;
    });
    setHistoryIdx(prev => Math.min(prev + 1, 49));
  }, [historyIdx]);

  const handleUndo = useCallback(() => {
    if (historyIdx > 0) {
      const prevState = history[historyIdx - 1];
      setPainted(prevState);
      setHistoryIdx(historyIdx - 1);
    }
  }, [history, historyIdx]);

  const handleRedo = useCallback(() => {
    if (historyIdx < history.length - 1) {
      const nextState = history[historyIdx + 1];
      setPainted(nextState);
      setHistoryIdx(historyIdx + 1);
    }
  }, [history, historyIdx]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [handleUndo, handleRedo]);

  // 3. Coordinate Translation
  const screenToWorld = useCallback((sx: number, sy: number) => {
    // Correctly translate screen-relative coordinates to the infinite world space
    return {
      x: (sx - size.width / 2) / view.zoom - view.x,
      y: (sy - size.height / 2) / view.zoom - view.y
    };
  }, [size, view]);

  const getRelativePointer = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  // 4. Interaction Handlers
  const onPointerDown = (e: React.PointerEvent) => {
    const isRightClick = e.button === 2 || e.ctrlKey;
    const pos = getRelativePointer(e);
    
    if (isRightClick || tool === 'pan') {
      interaction.current = { 
        isPainting: false, 
        isPanning: true, 
        lastPos: { x: e.clientX, y: e.clientY } 
      };
    } else {
      interaction.current = { isPainting: true, isPanning: false, lastPos: null };
      const world = screenToWorld(pos.x, pos.y);
      const key = triToString(worldToTri(world.x, world.y));
      
      setPainted(prev => {
        const next = { ...prev };
        if (tool === 'paint') next[key] = color;
        else delete next[key];
        return next;
      });
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (interaction.current.isPanning && interaction.current.lastPos) {
      const dx = (e.clientX - interaction.current.lastPos.x) / view.zoom;
      const dy = (e.clientY - interaction.current.lastPos.y) / view.zoom;
      setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
      interaction.current.lastPos = { x: e.clientX, y: e.clientY };
    } else if (interaction.current.isPainting) {
      const pos = getRelativePointer(e);
      const world = screenToWorld(pos.x, pos.y);
      const key = triToString(worldToTri(world.x, world.y));
      
      setPainted(prev => {
        if (tool === 'paint') {
          if (prev[key] === color) return prev;
          return { ...prev, [key]: color };
        } else {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (interaction.current.isPainting) {
      pushHistory(painted);
    }
    interaction.current = { isPainting: false, isPanning: false, lastPos: null };
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: React.WheelEvent) => {
    const zoomFactor = Math.pow(1.1, -e.deltaY / 200);
    setView(v => ({
      ...v,
      zoom: Math.min(Math.max(v.zoom * zoomFactor, 0.1), 15)
    }));
  };

  // 5. Grid Rendering
  const gridContent = useMemo(() => {
    if (size.width === 0 || !mounted) return null;

    const triangles: JSX.Element[] = [];
    const buffer = 3;
    
    const worldTopLeft = screenToWorld(0, 0);
    const worldBottomRight = screenToWorld(size.width, size.height);
    
    const minR = Math.floor(worldTopLeft.y / H) - buffer;
    const maxR = Math.ceil(worldBottomRight.y / H) + buffer;
    const minQ = Math.floor(Math.min(worldTopLeft.x, worldBottomRight.x) / SIDE - (maxR * 0.5)) - buffer;
    const maxQ = Math.ceil(Math.max(worldTopLeft.x, worldBottomRight.x) / SIDE - (minR * 0.5)) + buffer;

    for (let r = minR; r <= maxR; r++) {
      for (let q = minQ; q <= maxQ; q++) {
        const upKey = `${q},${r},up`;
        const dnKey = `${q},${r},down`;

        triangles.push(
          <path 
            key={upKey} 
            d={getTriPath(q, r, 'up')} 
            fill={painted[upKey] || 'transparent'} 
            stroke="rgba(255,255,255,0.06)" 
            strokeWidth={0.5 / view.zoom}
          />
        );
        triangles.push(
          <path 
            key={dnKey} 
            d={getTriPath(q, r, 'down')} 
            fill={painted[dnKey] || 'transparent'} 
            stroke="rgba(255,255,255,0.06)" 
            strokeWidth={0.5 / view.zoom}
          />
        );
      }
    }
    return triangles;
  }, [size, view, painted, mounted, screenToWorld]);

  // Visual Guides (Origin and Axes)
  const guides = useMemo(() => (
    <g pointerEvents="none">
      {/* Three Primary Axes */}
      <line x1={-10000} y1={0} x2={10000} y2={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1/view.zoom} />
      <line x1={-5000} y1={-8660} x2={5000} y2={8660} stroke="rgba(255,255,255,0.15)" strokeWidth={1/view.zoom} />
      <line x1={5000} y1={-8660} x2={-5000} y2={8660} stroke="rgba(255,255,255,0.15)" strokeWidth={1/view.zoom} />
      {/* Origin Dot */}
      <circle cx={0} cy={0} r={5 / view.zoom} fill="white" />
    </g>
  ), [view.zoom]);

  if (!mounted) return <div className="h-full w-full bg-background" />;

  return (
    <div className="flex flex-col h-full w-full bg-background select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-card/90 backdrop-blur-md z-30">
        <div className="flex items-center gap-1">
          <Button variant={tool === 'paint' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('paint')} title="Paint (Left Click)">
            <MousePointer2 className="w-4 h-4" />
          </Button>
          <Button variant={tool === 'erase' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('erase')} title="Erase">
            <Eraser className="w-4 h-4" />
          </Button>
          <Button variant={tool === 'pan' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pan')} title="Pan (Right Click)">
            <Move className="w-4 h-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button variant="ghost" size="icon" onClick={handleUndo} disabled={historyIdx <= 0} title="Undo (Ctrl+Z)">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleRedo} disabled={historyIdx >= history.length - 1} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            {['hsl(var(--primary))', '#3b82f6', '#10b981', '#f59e0b', '#ffffff'].map(c => (
              <button 
                key={c} 
                onClick={() => setColor(c)} 
                className={cn(
                  "w-6 h-6 rounded-full border-2 transition-all", 
                  color === c ? "border-white scale-110" : "border-transparent opacity-70 hover:opacity-100"
                )} 
                style={{ backgroundColor: c }} 
              />
            ))}
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => { if(confirm('Clear entire canvas?')) { setPainted({}); pushHistory({}); } }}
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Grid Canvas */}
      <div 
        ref={containerRef} 
        className="flex-1 relative overflow-hidden cursor-crosshair touch-none outline-none" 
        onPointerDown={onPointerDown} 
        onPointerMove={onPointerMove} 
        onPointerUp={onPointerUp} 
        onPointerLeave={onPointerUp}
        onWheel={onWheel} 
        onContextMenu={e => e.preventDefault()}
        tabIndex={0}
      >
        <svg width="100%" height="100%" className="absolute inset-0 pointer-events-none">
          <g transform={`translate(${size.width/2}, ${size.height/2}) scale(${view.zoom}) translate(${view.x}, ${view.y})`}>
            {gridContent}
            {guides}
          </g>
        </svg>

        {/* Viewport Info Overlay */}
        <div className="absolute bottom-4 left-4 flex flex-col gap-1 pointer-events-none">
          <div className="px-2 py-1 bg-black/40 backdrop-blur-sm rounded text-[10px] text-muted-foreground font-mono uppercase border border-white/5">
            {Math.round(view.zoom * 100)}% ZOOM • {Object.keys(painted).length} TRIANGLES
          </div>
          <div className="px-2 py-1 bg-black/40 backdrop-blur-sm rounded text-[10px] text-muted-foreground font-mono uppercase border border-white/5">
            POS: {Math.round(view.x)}, {Math.round(view.y)}
          </div>
        </div>
        
        <div className="absolute bottom-4 right-4 text-[10px] text-muted-foreground/50 pointer-events-none hidden md:block">
          LEFT: PAINT • RIGHT: PAN • SCROLL: ZOOM
        </div>
      </div>
    </div>
  );
}