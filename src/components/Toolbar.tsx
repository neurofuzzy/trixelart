
"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Trash2, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

const PALETTE = [
  "#F8FAFC", // White
  "#CBD5E1", // Light
  "#64748B", // Medium
  "#334155", // Dark
  "#613ED2", // Purple
  "#E11D48", // Rose
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
  onGenerate: () => void;
  isGenerating?: boolean;
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
    <div className="flex flex-col gap-6 w-full p-6 bg-card rounded-3xl border shadow-xl h-fit">
      <div>
        <h3 className="text-[10px] font-bold mb-4 text-muted-foreground uppercase tracking-widest">Palette</h3>
        <div className="flex flex-wrap gap-3">
          {PALETTE.map((color) => (
            <button
              key={color}
              onClick={() => setActiveColor(color)}
              className={cn(
                "w-8 h-8 rounded-xl border-2 transition-all duration-300 transform hover:scale-110",
                activeColor === color ? "border-primary scale-110 shadow-[0_0_15px_rgba(97,62,210,0.4)]" : "border-transparent"
              )}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      </div>

      <div className="h-px bg-border/50 w-full" />

      <div>
        <h3 className="text-[10px] font-bold mb-4 text-muted-foreground uppercase tracking-widest">History</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={onUndo} disabled={!canUndo} className="rounded-xl">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={onRedo} disabled={!canRedo} className="rounded-xl">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClear} className="text-destructive hover:bg-destructive/10 ml-auto rounded-xl">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="h-px bg-border/50 w-full" />

      <div>
        <h3 className="text-[10px] font-bold mb-4 text-muted-foreground uppercase tracking-widest">File</h3>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onExport} className="flex-1 gap-2 rounded-xl text-xs">
            <Download className="h-3 w-3" /> Export
          </Button>
          <Button variant="secondary" size="sm" onClick={onImport} className="flex-1 gap-2 rounded-xl text-xs">
            <Upload className="h-3 w-3" /> Import
          </Button>
        </div>
      </div>
    </div>
  );
}
