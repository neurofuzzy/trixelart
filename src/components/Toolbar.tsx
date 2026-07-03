"use client";

import { MousePointer2, Eraser, Move, Trash2, Download, Upload, Undo2, Redo2, Crosshair, Maximize, Minimize } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Toolbar({
  tool,
  isFunctionOpen,
  onToolChange,
  onFunctionToggle,
  handleUndo,
  handleRedo,
  historyIdx,
  historyLength,
  onExport,
  onImportClick,
  onClear,
  onCenterView,
  isFullscreen,
  onToggleFullscreen,
}: {
  tool: "paint" | "erase" | "pan";
  isFunctionOpen: boolean;
  onToolChange: (tool: "paint" | "erase" | "pan") => void;
  onFunctionToggle: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  historyIdx: number;
  historyLength: number;
  onExport: () => void;
  onImportClick: () => void;
  onClear: () => void;
  onCenterView: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
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
          <MousePointer2 className="w-4 h-4" />
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
          title="Pan"
        >
          <Move className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        <Button
          variant={isFunctionOpen ? "default" : "ghost"}
          size="icon"
          onClick={onFunctionToggle}
          title="Symmetry Function (ƒ)"
          className="text-lg font-serif"
        >
          ƒ
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          onClick={handleUndo}
          disabled={historyIdx <= 0}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRedo}
          disabled={historyIdx >= historyLength - 1}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border mx-1" />

        <Button
          variant="ghost"
          size="icon"
          onClick={onExport}
          title="Export JSON"
        >
          <Download className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onImportClick}
          title="Import JSON"
        >
          <Upload className="w-4 h-4" />
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