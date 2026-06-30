'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Move, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { useCanvasSize } from '@/hooks/use-canvas-size';
import { SIDE, H, worldToTri, triToString, getTriPath } from '@/lib/grid-math';

const GRAYSCALE_PALETTE = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'];

export default function SymmetriaGrid() {
  const [mounted, setMounted] = useState(false);
  const { size, containerRef, updateSize } = useCanvasSize();
  
  // View State (Pan and Zoom)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  
  // Tool State
  const [tool, setTool] = useState<'paint' | 'erase' | 'pan'>('paint');
  const [color, setColor] = useState(GRAYSCALE_PALETTE[4]); // Start with white
  
  // Drawing Data
  const [painted, setPainted] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // Interaction Ref
  const interaction = useRef<{
    isPainting: boolean;
    isPanning: boolean;
    hasMoved: boolean;
    startPos: { x: number; y: number } | null;
    lastPos: { x: number; y: number } | null;
  }>({ 
    isPainting: false, 
    isPanning: false, 
    hasMoved: false,
    startPos: null,
    lastPos: null 
  });

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

    // Call resize handler 0.5s after init to ensure layout has settled
    const timer = setTimeout(() => {
      updateSize();
    }, 500);
    return () => clearTimeout(timer);
  }, [updateSize]);

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

  const clearCanvas = () => {
    const empty = {};
    setPainted(empty);
    pushHistory(empty);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
        return;
      }

      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (e.key.toLowerCase() === 'p') {
        setTool('paint');
      } else if (e.key.toLowerCase() === 'e') {
        setTool('erase');
      }

      const colorIdx = parseInt(e.key) - 1;
      if (colorIdx >= 0 && colorIdx < GRAYSCALE_PALETTE.length) {
        setColor(GRAYSCALE_PALETTE[colorIdx]);
        setTool('paint');
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [handleUndo, handleRedo]);

  // 3. Coordinate Translation
  const screenToWorld = useCallback((sx: number, sy: number) => {
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
        hasMoved: false,
        startPos: { x: e.clientX, y: e.clientY },
        lastPos: { x: e.clientX, y: e.clientY } 
      };
    } else {
      interaction.current = { 
        isPainting: true, 
        isPanning: false, 
        hasMoved: false,
        startPos: { x: e.clientX, y: e.clientY },
        lastPos: null 
      };
      
      const world = screenToWorld(pos.x, pos.y);
      const key = triToString(worldToTri(world.x, world.y));
      
      setPainted(prev => {
        const next = { ...prev };
        if (tool === 'paint') {
          // Toggle off if same color, otherwise paint
          if (prev[key] === color) {
            delete next[key];
          } else {
            next[key] = color;
          }
        } else {
          delete next[key];
        }
        return next;
      });
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (interaction.current.isPanning && interaction.current.lastPos) {
      const dx = (e.clientX - interaction.current.lastPos.x) / view.zoom;
      const dy = (e.clientY - interaction.current.lastPos.y) / view.zoom;
      
      // Update hasMoved for color picker logic
      const totalDist = Math.hypot(
        e.clientX - (interaction.current.startPos?.x || 0), 
        e.clientY - (interaction.current.startPos?.y || 0)
      );
      if (totalDist > 3) interaction.current.hasMoved = true;

      setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
      interaction.current.lastPos = { x: e.clientX, y: e.clientY };
    } else if (interaction.current.isPainting) {
      const pos = getRelativePointer(e);
      const world = screenToWorld(pos.x, pos.y);
      const key = triToString(worldToTri(world.x, world.y));
      
      setPainted(prev => {
        if (tool === 'paint') {
          // During drag, we ONLY paint. We don't toggle.
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
    // Right-click color picker logic
    if (interaction.current.isPanning && !interaction.current.hasMoved) {
      const pos = getRelativePointer(e);
      const world = screenToWorld(pos.x, pos.y);
      const key = triToString(worldToTri(world.x, world.y));
      const pickedColor = painted[key];
      if (pickedColor) {
        setColor(pickedColor);
        setTool('paint');
      }
    }

    if (interaction.current.isPainting) {
      pushHistory(painted);
    }
    
    interaction.current = { 
      isPainting: false, 
      isPanning: false, 
      hasMoved: false, 
      startPos: null, 
      lastPos: null 
    };
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

  const guides = useMemo(() => (
    <g pointerEvents="none">
      <line x1={-10000} y1={0} x2={10000} y2={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1/view.zoom} />
      <line x1={-5000} y1={-8660} x2={5000} y2={8660} stroke="rgba(255,255,255,0.15)" strokeWidth={1/view.zoom} />
      <line x1={5000} y1={-8660} x2={-5000} y2={8660} stroke="rgba(255,255,255,0.15)" strokeWidth={1/view.zoom} />
      <circle cx={0} cy={0} r={5 / view.zoom} fill="white" />
    </g>
  ), [view.zoom]);

  if (!mounted) return <div className="h-full w-full bg-background" />;

  return (
    <div className="flex flex-col h-full w-full bg-background select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-card/90 backdrop-blur-md z-30">
        <div className="flex items-center gap-1">
          <Button variant={tool === 'paint' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('paint')} title="Paint (P)">
            <MousePointer2 className="w-4 h-4" />
          </Button>
          <Button variant={tool === 'erase' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('erase')} title="Erase (E)">
            <Eraser className="w-4 h-4" />
          </Button>
          <Button variant={tool === 'pan' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pan')} title="Pan">
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
            {GRAYSCALE_PALETTE.map((c, i) => (
              <button 
                key={c} 
                onClick={() => {
                  setColor(c);
                  setTool('paint');
                }} 
                title={`Color ${i + 1} (${i + 1})`}
                className={cn(
                  "w-6 h-6 rounded-full border-2 transition-all", 
                  color === c ? "border-white scale-110" : "border-transparent opacity-70 hover:opacity-100"
                )} 
                style={{ backgroundColor: c }} 
              />
            ))}
          </div>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="hover:bg-destructive/10 hover:text-destructive"
                title="Clear Everything"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear Canvas</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all your drawing data from the infinite grid. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={clearCanvas} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                  Clear Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
      </div>
    </div>
  );
}
