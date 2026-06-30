'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Move, Trash2, Download, Upload, X } from 'lucide-react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<'paint' | 'erase' | 'pan'>('paint');
  const [color, setColor] = useState(GRAYSCALE_PALETTE[4]);
  
  const [painted, setPainted] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const [isFunctionOpen, setIsFunctionOpen] = useState(false);
  const [formula, setFormula] = useState('a % 5 === 0 || b % 5 === 0 || c % 5 === 0');
  const [extent, setExtent] = useState(10);

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

    const timer = setTimeout(() => {
      updateSize();
    }, 500);
    return () => clearTimeout(timer);
  }, [updateSize]);

  useEffect(() => {
    if (mounted) localStorage.setItem('symmetria-save', JSON.stringify(painted));
  }, [painted, mounted]);

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

  const handleExport = () => {
    const dataStr = JSON.stringify(painted, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `symmetria-grid-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const importedData = JSON.parse(content);
        if (typeof importedData === 'object' && importedData !== null) {
          setPainted(importedData);
          pushHistory(importedData);
        }
      } catch (err) {
        console.error("Failed to import", err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const runSymmetryFunction = () => {
    const newPainted = { ...painted };
    try {
      const check = new Function('a', 'b', 'c', `try { return ${formula}; } catch(e) { return false; }`);
      
      const range = Math.ceil(extent * 1.5);
      
      for (let q = -range; q <= range; q++) {
        for (let r = -range; r <= range; r++) {
          // Up triangle: a=q, b=r, c=-q-r
          const aUp = q;
          const bUp = r;
          const cUp = -q - r;
          if (Math.abs(aUp) <= extent && Math.abs(bUp) <= extent && Math.abs(cUp) <= extent) {
            if (check(aUp, bUp, cUp)) {
              newPainted[`${q},${r},up`] = color;
            }
          }

          // Down triangle: a=q, b=r, c=-q-r+1
          const aDn = q;
          const bDn = r;
          const cDn = -q - r + 1;
          if (Math.abs(aDn) <= extent && Math.abs(bDn) <= extent && Math.abs(cDn) <= extent) {
            if (check(aDn, bDn, cDn)) {
              newPainted[`${q},${r},down`] = color;
            }
          }
        }
      }
      setPainted(newPainted);
      pushHistory(newPainted);
      setIsFunctionOpen(false);
    } catch (e) {
      alert("Invalid mathematical expression. Use JavaScript syntax, e.g. a % 5 === 0");
    }
  };

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
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept=".json" 
        className="hidden" 
      />

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
          
          <Button 
            variant={isFunctionOpen ? 'default' : 'ghost'} 
            size="icon" 
            onClick={() => setIsFunctionOpen(!isFunctionOpen)} 
            title="Symmetry Function (ƒ)"
            className="text-lg font-serif"
          >
            ƒ
          </Button>

          <div className="w-px h-6 bg-border mx-1" />
          
          <Button variant="ghost" size="icon" onClick={handleUndo} disabled={historyIdx <= 0} title="Undo (Ctrl+Z)">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleRedo} disabled={historyIdx >= history.length - 1} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="w-4 h-4" />
          </Button>
          
          <div className="w-px h-6 bg-border mx-1" />
          
          <Button variant="ghost" size="icon" onClick={handleExport} title="Export JSON">
            <Download className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleImportClick} title="Import JSON">
            <Upload className="w-4 h-4" />
          </Button>
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

        {isFunctionOpen && (
          <div 
            className="absolute top-4 left-4 w-80 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl z-50 space-y-4"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="text-xl font-serif">ƒ</span> Symmetry Function
              </h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsFunctionOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Condition (a, b, c axes)</label>
              <textarea 
                className="w-full h-20 p-2 text-sm bg-background border rounded-md font-mono resize-none focus:ring-2 focus:ring-primary outline-none"
                placeholder="e.g. a % 5 === 0"
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Extent (Range: {extent})</label>
              <input 
                type="range" 
                min="10" 
                max="200" 
                value={extent} 
                onChange={(e) => setExtent(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <Button className="w-full" onClick={runSymmetryFunction}>
              Apply Rule to Grid
            </Button>
            
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Variables <b>a, b, c</b> represent triangle-width strips. 
              Sum <b>a+b+c</b> is 0 for 'up' triangles and 1 for 'down' triangles.
            </p>
          </div>
        )}

        <div 
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-3 bg-card/80 backdrop-blur-lg border rounded-full shadow-2xl z-40"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {GRAYSCALE_PALETTE.map((c, i) => (
            <button 
              key={c} 
              onClick={() => {
                setColor(c);
                setTool('paint');
              }} 
              title={`Color ${i + 1} (${i + 1})`}
              className={cn(
                "w-8 h-8 rounded-full border-2 transition-all hover:scale-110", 
                color === c ? "border-white scale-125 shadow-lg" : "border-white/10 opacity-70"
              )} 
              style={{ backgroundColor: c }} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}
