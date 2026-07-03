"use client";

import { MousePointer2, Eraser, Move, Trash2, Download, Upload, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
              This will permanently delete all your drawing data from the
              infinite grid. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onClear}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Clear Everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
