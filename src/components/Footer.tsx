"use client";

import { useState } from "react";
import { Settings, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type HexMode = "world" | "honeycomb";
export type Symmetry = "off" | "sym60" | "sym120";
export type GridOrientation = "flat-top" | "pointy-top";
export type BrushSize = "single" | "hex";

/** Maps any external/stored hex-mode value onto the current enum.
 *  Legacy modes: boolean true (outlines/centers) -> honeycomb; false/off -> world.
 *  Legacy strings "off"/"outlines"/"centers" are normalized to current names. */
export function normalizeHexMode(value: unknown): HexMode {
  if (typeof value === "boolean") return value ? "honeycomb" : "world";
  if (value === "honeycomb" || value === "world") return value;
  if (value === "off") return "world";
  if (value === "outlines" || value === "centers") return "honeycomb";
  return "world";
}

const HEX_CYCLE: HexMode[] = ["world", "honeycomb"];

export function Footer({
  gridDivisions,
  onGridDivisionsChange,
  hexMode,
  onHexModeChange,
  handleUndo,
  handleRedo,
  historyIdx,
  historyLength,
  tool,
  captureMode,
  gridOrientation,
  onGridOrientationChange,
  tooltip,
}: {
  gridDivisions: number;
  onGridDivisionsChange: (n: number) => void;
  hexMode: HexMode;
  onHexModeChange: (v: HexMode) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  historyIdx: number;
  historyLength: number;
  tool?: "paint" | "erase" | "pan" | "select" | "stamp" | "dodge" | "burn";
  captureMode?: boolean;
  gridOrientation?: GridOrientation;
  onGridOrientationChange?: (v: GridOrientation) => void;
  tooltip?: string | null;
}) {
  const [hexDialogOpen, setHexDialogOpen] = useState(false);

  const modeButtonClass = (mode: HexMode) =>
    cn(
      "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
      hexMode === mode
        ? "bg-cyan-500/25 text-cyan-300"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    );

  return (
    <div className="flex items-center justify-between p-2 border-t bg-card/90 backdrop-blur-md z-30">
      <div className="flex items-center gap-1">
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
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        {tooltip ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            {tooltip}
          </span>
        ) : tool === "paint" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            click to paint
          </span>
        ) : tool === "erase" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            click to erase
          </span>
        ) : tool === "pan" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            drag to move
          </span>
        ) : tool === "select" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            click on a hex to select
          </span>
        ) : tool === "stamp" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            {captureMode
              ? "click on an area to create a stamp"
              : "click on an area to place a stamp"}
          </span>
        ) : (
          <>
            {hexMode === "honeycomb" && gridDivisions > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/25 text-cyan-300">
                hex
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <AlertDialog
          open={hexDialogOpen}
          onOpenChange={setHexDialogOpen}
        >
          <AlertDialogTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                hexDialogOpen && "bg-accent text-accent-foreground",
              )}
              title="Grid settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="w-72">
            <AlertDialogHeader>
              <AlertDialogTitle>Grid Settings</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Origin
                </span>
                <div className="flex gap-1">
                  {HEX_CYCLE.map((mode) => (
                    <button
                      key={mode}
                      className={modeButtonClass(mode)}
                      onClick={() => onHexModeChange(mode)}
                    >
                      {mode === "world" ? "World" : "Honeycomb"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Orientation
                </span>
                <div className="flex gap-1">
                  {(["flat-top", "pointy-top"] as const).map((o) => (
                    <button
                      key={o}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        gridOrientation === o
                          ? "bg-cyan-500/25 text-cyan-300"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                      onClick={() => onGridOrientationChange?.(o)}
                    >
                      {o === "flat-top" ? "Flat-top" : "Pointy-top"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Hex size
                </span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={gridDivisions}
                    onChange={(e) =>
                      onGridDivisionsChange(Number(e.target.value))
                    }
                    className="flex-1 h-2 accent-cyan-500"
                  />
                  <span className="text-xs font-mono text-muted-foreground w-8 text-right">
                    N={gridDivisions}
                  </span>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHexDialogOpen(false)}
              >
                Done
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
