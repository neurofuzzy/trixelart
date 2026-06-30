"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Trash2, Download, Upload, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const PALETTE = [
  "#F8FAFC", // Near White
  "#CBD5E1", // Light
  "#64748B", // Medium
  "#334155", // Dark
  "#613ED2", // Accent Purple
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
  onImport,
  onGenerate,
  isGenerating
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-6 w-full max-w-[300px] p-6 bg-card rounded-2xl border shadow-sm h-fit">
      <div>
        <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Colors</h3>
        <div className="flex gap-2">
          {PALETTE.map((color) => (
            <button
              key={color}
              onClick={() => setActiveColor(color)}
              className={cn(
                "w-10 h-10 rounded-full border-2 transition-all duration-200 transform hover:scale-110",
                activeColor === color ? "border-primary scale-110 shadow-lg" : "border-transparent"
              )}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      </div>

      <div className="h-px bg-border w-full" />

      <div>
        <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Canvas</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={onUndo} disabled={!canUndo}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={onRedo} disabled={!canRedo}>
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={onClear} className="text-destructive hover:bg-destructive/10 ml-auto">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="h-px bg-border w-full" />

      <div>
        <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">AI Assist</h3>
        <Button variant="outline" size="sm" onClick={onGenerate} disabled={isGenerating} className="w-full gap-2">
          <Sparkles className={cn("h-4 w-4", isGenerating && "animate-pulse")} />
          Generate Concept
        </Button>
      </div>

      <div className="h-px bg-border w-full" />

      <div>
        <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Data</h3>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onExport} className="flex-1 gap-2">
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="secondary" size="sm" onClick={onImport} className="flex-1 gap-2">
            <Upload className="h-4 w-4" /> Import
          </Button>
        </div>
      </div>
    </div>
  );
}
