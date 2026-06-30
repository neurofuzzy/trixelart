'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Undo2, Redo2, MousePointer2, Eraser, Move, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Math Constants
const SIDE = 50;
const H = SIDE * Math.sqrt(3) / 2;

type TriType = 'up' | 'down';
interface TriKey { q: number; r: number; type: TriType; }

const toStr = (k: TriKey) => `${k.q},${k.r},${k.type}`;

export default function SymmetriaGrid() {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  
  // View State
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  
  // Drawing State
  const [tool, setTool] = useState<'paint' | 'erase' | 'pan'>('paint');
  const [color, setColor] = useState('hsl(var(--primary))');
  const [painted, setPainted] = useState<Record<string, string>>({});
  
  // History
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const interaction = useRef<{ type: 'painting' | 'panning' | null, lastPos: { x: number, y: number } | null }>({ type: null, lastPos: null });

  // Init & Resize
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('symmetria-save');
    if (stored) {
      try {
        const p = JSON.parse(stored);
        setPainted(p);
        setHistory([p]);
        setHistoryIdx(0);
      } catch (e) {}
    }

    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setDims({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });

    if (containerRef.current) {
      obs.observe(containerRef.current);
      const r = containerRef.current.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    }
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (mounted) localStorage.setItem('symmetria-save', JSON.stringify(painted));
  }, [painted, mounted]);

  // Actions
  const pushHistory = useCallback((state: Record<string, string>) => {
    const next = history.slice(0, historyIdx + 1);
    next.push(state);
    if (next.length > 50) next.shift();
    setHistory(next);
    setHistoryIdx(next.length - 1);
  }, [history, historyIdx]);

  const undo = () => { if (historyIdx > 0) { setPainted(history[historyIdx - 1]); setHistoryIdx(historyIdx - 1); } };
  const redo = () => { if (historyIdx < history.length - 1) { setPainted(history[historyIdx + 1]); setHistoryIdx(historyIdx + 1); } };

  // Coord Math
  const s2w = useCallback((sx: number, sy: number) => {
    return {
      x: (sx - dims.w / 2) / view.zoom - view.x,
      y: (sy - dims.h / 2) / view.zoom - view.y
    };
  }, [dims, view]);

  const w2t = useCallback((wx: number, wy: number): TriKey => {
    const r = wy / H;
    const q = (wx / SIDE) - (r * 0.5);
    const fq = Math.floor(q);
    const fr = Math.floor(r);
    const lq = q - fq;
    const lr = r - fr;
    return { q: fq, r: fr, type: (lq + lr < 1) ? 'up' : 'down' };
  }, []);

  // Handlers
  const onDown = (e: React.PointerEvent) => {
    const isRight = e.button === 2 || e.altKey;
    if (isRight || tool === 'pan') {
      interaction.current = { type: 'panning', lastPos: { x: e.clientX, y: e.clientY } };
    } else {
      interaction.current = { type: 'painting', lastPos: null };
      const w = s2w(e.clientX, e.clientY);
      const k = toStr(w2t(w.x, w.y));
      const next = { ...painted };
      if (tool === 'paint') next[k] = color; else delete next[k];
      setPainted(next);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!interaction.current.type) return;
    if (interaction.current.type === 'panning' && interaction.current.lastPos) {
      const dx = (e.clientX - interaction.current.lastPos.x) / view.zoom;
      const dy = (e.clientY - interaction.current.lastPos.y) / view.zoom;
      setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
      interaction.current.lastPos = { x: e.clientX, y: e.clientY };
    } else if (interaction.current.type === 'painting') {
      const w = s2w(e.clientX, e.clientY);
      const k = toStr(w2t(w.x, w.y));
      if (tool === 'paint') setPainted(p => ({ ...p, [k]: color }));
      else setPainted(p => { const n = { ...p }; delete n[k]; return n; });
    }
  };

  const onUp = () => {
    if (interaction.current.type === 'painting') pushHistory(painted);
    interaction.current = { type: null, lastPos: null };
  };

  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.pow(1.1, -e.deltaY / 150);
    setView(v => ({ ...v, zoom: Math.min(Math.max(v.zoom * factor, 0.05), 20) }));
  };

  // Rendering
  const gridContent = useMemo(() => {
    if (dims.w === 0) return null;
    const tris: JSX.Element[] = [];
    const buf = 2;
    const left = s2w(0, 0);
    const right = s2w(dims.w, dims.h);
    const minR = Math.floor(left.y / H) - buf;
    const maxR = Math.ceil(right.y / H) + buf;
    const minQ = Math.floor(Math.min(left.x, right.x) / SIDE - (maxR * 0.5)) - buf;
    const maxQ = Math.ceil(Math.max(left.x, right.x) / SIDE - (minR * 0.5)) + buf;

    for (let r = minR; r <= maxR; r++) {
      for (let q = minQ; q <= maxQ; q++) {
        const bx = q * SIDE + r * (SIDE / 2);
        const by = r * H;
        const kUp = toStr({ q, r, type: 'up' });
        tris.push(<path key={kUp} d={`M ${bx} ${by} L ${bx + SIDE} ${by} L ${bx + SIDE/2} ${by + H} Z`} fill={painted[kUp] || 'transparent'} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />);
        const kDn = toStr({ q, r, type: 'down' });
        tris.push(<path key={kDn} d={`M ${bx + SIDE/2} ${by + H} L ${bx + SIDE*1.5} ${by + H} L ${bx + SIDE} ${by} Z`} fill={painted[kDn] || 'transparent'} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />);
      }
    }
    return tris;
  }, [dims, view, painted, s2w]);

  const guides = useMemo(() => (
    <g stroke="rgba(255,255,255,0.15)" strokeWidth={1} pointerEvents="none">
      <line x1={-10000} y1={0} x2={10000} y2={0} />
      <line x1={-5000} y1={-8660} x2={5000} y2={8660} />
      <line x1={5000} y1={-8660} x2={-5000} y2={8660} />
      <circle cx={0} cy={0} r={5 / view.zoom} fill="white" />
    </g>
  ), [view.zoom]);

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-full w-full bg-background select-none">
      <div className="flex items-center justify-between p-2 border-b bg-card/80 backdrop-blur z-20">
        <div className="flex items-center gap-1">
          <Button variant={tool === 'paint' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('paint')}><MousePointer2 className="w-4 h-4" /></Button>
          <Button variant={tool === 'erase' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('erase')}><Eraser className="w-4 h-4" /></Button>
          <Button variant={tool === 'pan' ? 'default' : 'ghost'} size="icon" onClick={() => setTool('pan')}><Move className="w-4 h-4" /></Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button variant="ghost" size="icon" onClick={undo} disabled={historyIdx <= 0}><Undo2 className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={historyIdx >= history.length - 1}><Redo2 className="w-4 h-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => { if(confirm('Clear?')) { setPainted({}); pushHistory({}); } }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
          <div className="flex gap-1">
            {['hsl(var(--primary))', '#3b82f6', '#10b981', '#f59e0b', '#ffffff'].map(c => (
              <button key={c} onClick={() => setColor(c)} className={cn("w-6 h-6 rounded-full border-2", color === c ? "border-white" : "border-transparent")} style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 relative overflow-hidden cursor-crosshair touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} onContextMenu={e => e.preventDefault()}>
        <svg width="100%" height="100%" className="absolute inset-0">
          <g transform={`translate(${dims.w/2}, ${dims.h/2}) scale(${view.zoom}) translate(${view.x}, ${view.y})`}>
            {gridContent}
            {guides}
          </g>
        </svg>
        <div className="absolute bottom-4 left-4 p-2 bg-black/50 rounded text-[10px] text-muted-foreground border border-white/10 uppercase">
          {Math.round(view.zoom * 100)}% • {Object.keys(painted).length} items
        </div>
      </div>
    </div>
  );
}
