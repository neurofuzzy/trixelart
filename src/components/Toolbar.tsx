"use client";

import { useState } from "react";
import {
  Pencil,
  Eraser,
  Move,
  Download,
  Upload,
  Crosshair,
  Maximize,
  Minimize,
  SquareDashed,
  Stamp,
  Sun,
  Moon,
  ChevronDown,
  Menu,
  FilePlus,
} from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { Tool } from "@/lib/tools";

const editTools = [
  { tool: "paint" as Tool, icon: Pencil, label: "Paint", shortcut: "P" },
  { tool: "erase" as Tool, icon: Eraser, label: "Erase", shortcut: "E" },
  { tool: "dodge" as Tool, icon: Sun, label: "Dodge", shortcut: "D" },
  { tool: "burn" as Tool, icon: Moon, label: "Burn", shortcut: "B" },
  { tool: "stamp" as Tool, icon: Stamp, label: "Stamp", shortcut: "T" },
  { tool: "pan" as Tool, icon: Move, label: "Move", shortcut: "H" },
] as const;

const isEditTool = (t: string): boolean =>
  t === "paint" || t === "erase" || t === "dodge" || t === "burn" || t === "stamp" || t === "pan";

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
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onExport: () => void;
  onImportClick: () => void;
  onClear: () => void;
  onCenterView: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  hasSelection: boolean;
}) {
  const activeEdit = editTools.find((e) => e.tool === tool);
  const ActiveIcon = activeEdit?.icon ?? Pencil;
  const [hamburgerOpen, setHamburgerOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <div className="flex items-center justify-between p-2 border-b bg-card/90 backdrop-blur-md z-30">
      <div className="flex items-center gap-1">
        <DropdownMenu open={hamburgerOpen} onOpenChange={setHamburgerOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="Menu">
              <Menu className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6}>
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                setNewProjectOpen(true);
              }}
            >
              <FilePlus className="w-4 h-4" />
              <span>New Project</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                onImportClick();
              }}
            >
              <Download className="w-4 h-4" />
              <span>Import JSON</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                onExport();
              }}
            >
              <Upload className="w-4 h-4" />
              <span>Export JSON</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={isEditTool(tool) ? "default" : "ghost"}
              size="sm"
              className="gap-1"
              title="Drawing tools"
            >
              <ActiveIcon className="w-4 h-4" />
              <ChevronDown className="w-2.5 h-2.5 ml-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6}>
            {editTools.map(({ tool: t, icon: Icon, label, shortcut }) => (
              <DropdownMenuItem
                key={t}
                onClick={() => onToolChange(t)}
                disabled={t === "stamp" ? !hasSelection : undefined}
                className={tool === t ? "bg-accent" : undefined}
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1">{label}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {shortcut}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant={tool === "select" ? "default" : "ghost"}
          size="icon"
          onClick={() => onToolChange("select")}
          title="Select hex (S)"
        >
          <SquareDashed className="w-4 h-4" />
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

      <AlertDialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all drawing data from the grid.
              You can undo this with Ctrl+Z.
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
