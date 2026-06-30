"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Trash2, Download, Upload, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

const PALETTE = [
  "#F8FAFC", // White
  "#CBD5E1", // Light
  "#64748B", // Medium
  "#334155", // Dark
  "#613ED2", // Purple
  "#E11D48", // Rose
  "#22C55E", // Green
  "#F59E0B", // Amber
];

interface ToolbarProps {
  activeColor: string;
  setActiveColor: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onExport: () => void;
  onImport: () => void;
}

export function Toolbar({
  activeColor,
  setActiveColor,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
  onExport,
  onImport
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-8 w-full p-8 bg-card rounded-[2rem] border border-white/10 shadow-2xl">
      <section>
        <div className="flex items-center gap-2 mb-5">
          <Palette className="h-3 w-3 text-primary" />
          <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Color Swatch</h3>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {PALETTE.map((color) => (
            <button
              key={color}
              onClick={() => setActiveColor(color)}
              className={cn(
                "aspect-square rounded-full border-2 transition-all duration-300 transform hover:scale-110",
                activeColor === color ? "border-primary scale-110 shadow-[0_0_15px_rgba(97,62,210,0.5)]" : "border-transparent"
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </section>

      <div className="h-px bg-white/5 w-full" />

      <section>
        <h3 className="text-[10px] font-bold mb-5 text-muted-foreground uppercase tracking-[0.2em]">Edit State</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={onUndo} disabled={!canUndo} className="flex-1 h-12 rounded-2xl border-white/5 hover:bg-white/5">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={onRedo} disabled={!canRedo} className="flex-1 h-12 rounded-2xl border-white/5 hover:bg-white/5">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClear} className="h-12 w-12 rounded-2xl text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <div className="h-px bg-white/5 w-full" />

      <section>
        <h3 className="text-[10px] font-bold mb-5 text-muted-foreground uppercase tracking-[0.2em]">Persistence</h3>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={onExport} className="w-full h-11 gap-2 rounded-2xl text-[11px] font-medium bg-white/5 hover:bg-white/10 border-white/5">
            <Download className="h-3 w-3" /> Export Coordinates
          </Button>
          <Button variant="secondary" onClick={onImport} className="w-full h-11 gap-2 rounded-2xl text-[11px] font-medium bg-white/5 hover:bg-white/10 border-white/5">
            <Upload className="h-3 w-3" /> Restore Session
          </Button>
        </div>
      </section>
    </div>
  );
}