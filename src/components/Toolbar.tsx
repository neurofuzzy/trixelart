"use client";

import { Pencil, Eraser, Move, Trash2, Download, Upload, Crosshair, Maximize, Minimize, SquareDashed, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Toolbar({
  tool,
  onToolChange,
  onExport,
  onImportClick,
  onClear,
  onCenterView,
  isFullscreen,
  onToggleFullscreen,
  hasSelection,
}: {
  tool: "paint" | "erase" | "pan" | "select" | "stamp";
  onToolChange: (tool: "paint" | "erase" | "pan" | "select" | "stamp") => void;
  onExport: () => void;
  onImportClick: () => void;
  onClear: () => void;
  onCenterView: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  hasSelection: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-2 border-b bg-card/90 backdrop-blur-md z-30">
      <div className="flex items-center gap-1">
        <Button
          variant={tool === "paint" ? "default" : "ghost"}
          size="icon"
          onClick={() => onToolChange("paint")}
          title="Paint (P)"
        >
          <Pencil className="w-4 h-4" />
        </Button>
        <Button
          variant={tool === "erase" ? "default" : "ghost"}
          size="icon"
          onClick={() => onToolChange("erase")}
          title="Erase (E)"
        >
          <Eraser className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          className="hover:bg-destructive/10 hover:text-destructive"
          title="Clear (undo with Ctrl+Z)"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
        <Button
          variant={tool === "pan" ? "default" : "ghost"}
          size="icon"
          onClick={() => onToolChange("pan")}
          title="Pan (H)"
        >
          <Move className="w-4 h-4" />
        </Button>
        <Button
          variant={tool === "select" ? "default" : "ghost"}
          size="icon"
          onClick={() => onToolChange("select")}
          title="Select hex (S)"
        >
          <SquareDashed className="w-4 h-4" />
        </Button>
        <Button
          variant={tool === "stamp" ? "default" : "ghost"}
          size="icon"
          onClick={() => onToolChange("stamp")}
          disabled={!hasSelection}
          title="Stamp selection (T)"
        >
          <Stamp className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          onClick={onExport}
          title="Export JSON"
        >
          <Upload className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onImportClick}
          title="Import JSON"
        >
          <Download className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onCenterView}
          title="Center view"
        >
          <Crosshair className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}