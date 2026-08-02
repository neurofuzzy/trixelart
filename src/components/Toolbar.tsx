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
  Crop,
  Stamp,
  Sun,
  Moon,
  ChevronDown,
  Menu,
  FilePlus,
  ImageDown,
  Box,
  Shirt,
  PenLine,
  Scissors,
  Aperture,
  Paintbrush,
  PaintBucket,
  Puzzle,
  Snowflake,
  Pipette,
  GitCompareArrows,
  HelpCircle,
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
import { cn } from "@/lib/utils";
import { isToolAllowed, type Tool } from "@/lib/tools";
import type { LayerKind } from "@/hooks/use-history";
import type { Symmetry, BrushSize, HexMode } from "@/components/Footer";
import { ProjectName } from "@/components/ProjectName";

const editTools = [
  { tool: "paint" as Tool, icon: Pencil, label: "Paint", shortcut: "P" },
  { tool: "erase" as Tool, icon: Eraser, label: "Erase", shortcut: "E" },
  { tool: "fill" as Tool, icon: PaintBucket, label: "Fill", shortcut: "F" },
  { tool: "pattern" as Tool, icon: Puzzle, label: "Pattern", shortcut: "N" },
  { tool: "dodge" as Tool, icon: Sun, label: "Dodge", shortcut: "D" },
  { tool: "burn" as Tool, icon: Moon, label: "Burn", shortcut: "B" },
  { tool: "stamp" as Tool, icon: Stamp, label: "Stamp", shortcut: "T" },
  { tool: "clone" as Tool, icon: GitCompareArrows, label: "Clone", shortcut: "C" },
  { tool: "eyedropper" as Tool, icon: Pipette, label: "Eyedropper", shortcut: "I" },
  { tool: "pan" as Tool, icon: Move, label: "Move", shortcut: "H" },
] as const;

/**
 * Hatch takes over the Paint slot rather than getting a button of its own.
 * It is the same action — lay down marks with the current brush — and which of
 * the two you get is decided by the active layer's kind, so there is never a
 * moment when both are meaningful. Two pencils side by side, one of them always
 * dead, is worse than one that changes what it means.
 */
const brushTool = (kind: LayerKind) =>
  kind === "hatch"
    ? ({ tool: "hatch" as Tool, icon: Pencil, label: "Hatch", shortcut: "G" } as const)
    : editTools[0];

const isEditTool = (t: string): boolean =>
  t === "hatch" ||
  t === "paint" ||
  t === "erase" ||
  t === "fill" ||
  t === "pattern" ||
  t === "dodge" ||
  t === "burn" ||
  t === "stamp" ||
  t === "clone" ||
  t === "eyedropper" ||
  t === "pan";

const SYM_CYCLE: Symmetry[] = ["off", "sym60", "sym120"];
const SYM_LABEL: Record<Symmetry, string> = {
  off: "Symmetry: off",
  sym60: "Symmetry: 6-fold",
  sym120: "Symmetry: 3-fold",
};

const sliderClass =
  "h-28 w-5 cursor-pointer appearance-none bg-transparent " +
  "[&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted [&::-webkit-slider-runnable-track]:w-1.5 " +
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-translate-x-[3px] " +
  "[&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted [&::-moz-range-track]:h-1.5 " +
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0";

export function Toolbar({
  tool,
  onToolChange,
  activeLayerKind,
  onExport,
  onExportSVG,
  onExport3D,
  onExportCut,
  onExportPlotter,
  onImportClick,
  onClear,
  onCenterView,
  isFullscreen,
  onToggleFullscreen,
  symmetry,
  onSymmetryChange,
  brushSize,
  onBrushSizeChange,
  flowerRadius,
  onFlowerRadiusChange,
  hexMode,
  gridDivisions,
  tooltip,
  onSetTooltip,
  onOpenHelp,
  projectName,
  onProjectNameChange,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  /** Kind of the active layer — decides which tools are usable. */
  activeLayerKind: LayerKind;
  onExport: () => void;
  onExportSVG: () => void;
  onExport3D: () => void;
  onExportCut: () => void;
  onExportPlotter: () => void;
  onImportClick: () => void;
  onClear: () => void;
  onCenterView: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  symmetry: Symmetry;
  onSymmetryChange: (v: Symmetry) => void;
  brushSize: BrushSize;
  onBrushSizeChange: (v: BrushSize) => void;
  flowerRadius: number;
  onFlowerRadiusChange: (n: number) => void;
  hexMode: HexMode;
  gridDivisions: number;
  tooltip: string | null;
  onSetTooltip: (t: string | null) => void;
  onOpenHelp: () => void;
  projectName: string;
  onProjectNameChange: (name: string) => void;
}) {
  // The Paint entry stands in for whichever brush this layer kind allows.
  const shownTools = editTools.map((e) =>
    e.tool === "paint" ? brushTool(activeLayerKind) : e,
  );
  const activeEdit = shownTools.find((e) => e.tool === tool);
  const ActiveIcon = activeEdit?.icon ?? Pencil;
  const [hamburgerOpen, setHamburgerOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [flowerOpen, setFlowerOpen] = useState(false);

  const hexDisabled = gridDivisions === 0 || hexMode === "world";

  return (
    <div
      className="flex items-center justify-between p-2 border-b bg-card/90 backdrop-blur-md z-30"
      onMouseLeave={() => onSetTooltip(null)}
    >
      <div className="flex items-center gap-1">
        <DropdownMenu open={hamburgerOpen} onOpenChange={setHamburgerOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="Menu" data-tour="menu">
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
              <span>Load Project</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                onExport();
              }}
            >
              <Upload className="w-4 h-4" />
              <span>Save Project</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                onExportSVG();
              }}
            >
              <ImageDown className="w-4 h-4" />
              <span>Export Project...</span>
            </DropdownMenuItem>
            {/* Not a dialog — fabric export is a whole editing mode (crop
                handles on the canvas), so the menu just selects the tool. */}
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                onToolChange("crop");
              }}
            >
              <Shirt className="w-4 h-4" />
              <span>Export for Fabric...</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                onExport3D();
              }}
            >
              <Box className="w-4 h-4" />
              <span>Export for 3D Print...</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                onExportCut();
              }}
            >
              <Scissors className="w-4 h-4" />
              <span>Export for Cutting...</span>
            </DropdownMenuItem>
            {/* A dialog, not a canvas mode: a plot takes the whole artwork, so
                unlike fabric there is no region to drag out on the canvas. */}
            <DropdownMenuItem
              onClick={() => {
                setHamburgerOpen(false);
                onExportPlotter();
              }}
            >
              <PenLine className="w-4 h-4" />
              <span>Export for Plotter...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="lg:hidden">
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
              {shownTools
                .filter(({ tool: t }) => isToolAllowed(t, activeLayerKind))
                .map(({ tool: t, icon: Icon, label, shortcut }) => (
                  <DropdownMenuItem
                    key={t}
                    onClick={() => onToolChange(t)}
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
        </div>

        <div
          className="hidden lg:flex lg:items-center lg:gap-0.5"
          data-tour="tools"
        >
          {/* Disabled rather than hidden: a tool vanishing when you switch
              layers is more confusing than one that is visibly unavailable. */}
          {shownTools.map(({ tool: t, icon: Icon, label, shortcut }) => {
            const allowed = isToolAllowed(t, activeLayerKind);
            return (
              <Button
                key={t}
                variant={tool === t ? "default" : "ghost"}
                size="icon"
                onClick={() => onToolChange(t)}
                disabled={!allowed}
                title={
                  allowed
                    ? `${label} (${shortcut})`
                    : `${label} — not available on a ${activeLayerKind} layer`
                }
                onMouseEnter={() => onSetTooltip(label)}
                onMouseLeave={() => onSetTooltip("")}
              >
                <Icon className="w-4 h-4" />
              </Button>
            );
          })}
        </div>

        <div className="hidden lg:block w-px h-6 bg-border mx-0.5 self-center" />

        <div className="flex items-center gap-0.5" data-tour="effects">
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            brushSize === "hex" &&
              !hexDisabled &&
              "bg-lime-500/25 text-lime-300",
          )}
          onClick={() => {
            const next = brushSize === "hex" ? "single" : "hex";
            onBrushSizeChange(next);
            onSetTooltip(next === "hex" ? "Brush: hex wedge" : "Brush: single");
          }}
          disabled={hexDisabled}
          onMouseEnter={() =>
            onSetTooltip(
              brushSize === "hex" ? "Brush: hex wedge" : "Brush: single",
            )
          }
          onMouseLeave={() => onSetTooltip("")}
        >
          <Paintbrush className="w-4 h-4" />
        </button>
        <Button
          variant={tool === "select" ? "default" : "ghost"}
          size="icon"
          onClick={() => onToolChange("select")}
          onMouseEnter={() => onSetTooltip("Selection: single hexagon")}
          onMouseLeave={() => onSetTooltip("")}
        >
          <SquareDashed className="w-4 h-4" />
        </Button>

        <Button
          variant={tool === "crop" ? "default" : "ghost"}
          size="icon"
          onClick={() => onToolChange("crop")}
          title="Crop & export (X)"
          onMouseEnter={() => onSetTooltip("Crop & export")}
          onMouseLeave={() => onSetTooltip("")}
        >
          <Crop className="w-4 h-4" />
        </Button>

        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            symmetry === "sym60" && "bg-purple-500/25 text-purple-300",
            symmetry === "sym120" && "bg-purple-500/45 text-purple-200",
          )}
          onClick={() => {
            const i = SYM_CYCLE.indexOf(symmetry);
            const next = SYM_CYCLE[(i + 1) % SYM_CYCLE.length];
            onSymmetryChange(next);
            onSetTooltip(SYM_LABEL[next]);
          }}
          onMouseEnter={() => onSetTooltip(SYM_LABEL[symmetry])}
          onMouseLeave={() => onSetTooltip("")}
        >
          <Aperture className="w-4 h-4" />
        </button>
        <div className="relative">
          <button
            className={cn(
              "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-5",
              flowerRadius > 0 &&
                !hexDisabled &&
                "bg-amber-500/25 text-amber-300",
            )}
            onClick={() => setFlowerOpen((v) => !v)}
            disabled={hexDisabled}
            onMouseEnter={() => onSetTooltip("Fan-out")}
            onMouseLeave={() => onSetTooltip("")}
          >
            <Snowflake className="w-4 h-4" />
          </button>
          {flowerOpen && (
            <div className="absolute top-full left-0 mt-2 px-3 pt-3 pb-2 bg-card border rounded-lg shadow-xl z-50 flex flex-col items-center gap-2">
              <input
                type="range"
                min={0}
                max={5}
                value={flowerRadius}
                onChange={(e) => onFlowerRadiusChange(Number(e.target.value))}
                className={sliderClass}
                disabled={hexDisabled}
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
              />
              <span className="text-xs font-mono text-muted-foreground">
                {flowerRadius}
              </span>
            </div>
          )}
        </div>
        </div>
      </div>

      <ProjectName name={projectName} onChange={onProjectNameChange} />

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenHelp}
          title="Help & keyboard shortcuts"
          data-tour="help"
        >
          <HelpCircle className="w-4 h-4" />
        </Button>
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
          {isFullscreen ? (
            <Minimize className="w-4 h-4" />
          ) : (
            <Maximize className="w-4 h-4" />
          )}
        </Button>
      </div>

      <AlertDialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all drawing data from the grid. You can undo this
              with Ctrl+Z.
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
