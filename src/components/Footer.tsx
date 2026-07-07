"use client";

import { useState, useCallback, useRef } from "react";
import { Hexagon, Expand, Aperture, Undo2, Redo2 } from "lucide-react";
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

const SYM_CYCLE: Symmetry[] = ["off", "sym60", "sym120"];
const SYM_LABEL: Record<Symmetry, string> = {
  off: "Symmetry: off",
  sym60: "Symmetry: 6-fold (60\u00B0)",
  sym120: "Symmetry: 3-fold (120\u00B0)",
};

export function Footer({
  gridDivisions,
  onGridDivisionsChange,
  hexMode,
  onHexModeChange,
  flowerRadius,
  onFlowerRadiusChange,
  symmetry,
  onSymmetryChange,
  handleUndo,
  handleRedo,
  historyIdx,
  historyLength,
  tool,
  captureMode,
  gridOrientation,
  onGridOrientationChange,
}: {
  gridDivisions: number;
  onGridDivisionsChange: (n: number) => void;
  hexMode: HexMode;
  onHexModeChange: (v: HexMode) => void;
  flowerRadius: number;
  onFlowerRadiusChange: (n: number) => void;
  symmetry: Symmetry;
  onSymmetryChange: (v: Symmetry) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  historyIdx: number;
  historyLength: number;
  tool?: "paint" | "erase" | "pan" | "select" | "stamp" | "dodge" | "burn";
  captureMode?: boolean;
  gridOrientation?: GridOrientation;
  onGridOrientationChange?: (v: GridOrientation) => void;
}) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [hexDialogOpen, setHexDialogOpen] = useState(false);
  const [flowerPopoverOpen, setFlowerPopoverOpen] = useState(false);
  const hexDialogRef = useRef(false);
  const flowerPopoverRef = useRef(false);

  const clearTooltip = useCallback(() => {
    if (!hexDialogRef.current && !flowerPopoverRef.current) {
      setTooltip(null);
    }
  }, []);

  const sliderClass =
    "h-28 w-5 cursor-pointer appearance-none bg-transparent " +
    "[&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted [&::-webkit-slider-runnable-track]:w-1.5 " +
    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-translate-x-[3px] " +
    "[&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted [&::-moz-range-track]:h-1.5 " +
    "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0";

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
          onMouseEnter={() => setTooltip("Undo (Ctrl+Z)")}
          onMouseLeave={clearTooltip}
        >
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRedo}
          disabled={historyIdx >= historyLength - 1}
          onMouseEnter={() => setTooltip("Redo (Ctrl+Shift+Z)")}
          onMouseLeave={clearTooltip}
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
            {captureMode ? "click on an area to create a stamp" : "click on an area to place a stamp"}
          </span>
        ) : (
          <>
            {hexMode === "honeycomb" && gridDivisions > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/25 text-cyan-300">
                hex
              </span>
            )}
            {symmetry !== "off" && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/25 text-purple-300">
                {symmetry === "sym60" ? "6-fold" : "3-fold"}
              </span>
            )}
          </>
        )}
      </div>
      <div className="relative flex items-center gap-0.5">
        <AlertDialog
          open={hexDialogOpen}
          onOpenChange={(open) => {
            hexDialogRef.current = open;
            setHexDialogOpen(open);
            setTooltip(open ? "Grid settings" : null);
          }}
        >
          <AlertDialogTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                hexDialogOpen && "bg-accent text-accent-foreground",
                hexMode === "honeycomb" &&
                  gridDivisions > 0 &&
                  "bg-cyan-500/40 text-cyan-200",
              )}
              onMouseEnter={() => setTooltip("Grid settings")}
              onMouseLeave={clearTooltip}
            >
              <Hexagon className="w-4 h-4" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="w-72">
            <AlertDialogHeader>
              <AlertDialogTitle>Grid Settings</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">Origin</span>
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
                <span className="text-xs font-medium text-muted-foreground">Orientation</span>
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
                <span className="text-xs font-medium text-muted-foreground">Hex size</span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={gridDivisions}
                    onChange={(e) => onGridDivisionsChange(Number(e.target.value))}
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
            setTooltip(SYM_LABEL[next]);
          }}
          onMouseEnter={() => setTooltip(SYM_LABEL[symmetry])}
          onMouseLeave={clearTooltip}
        >
          <Aperture className="w-4 h-4" />
        </button>
        <div className="relative">
          <button
            className={cn(
              "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              flowerRadius > 0 &&
                hexMode === "honeycomb" &&
                gridDivisions > 0 &&
                "bg-amber-500/25 text-amber-300",
            )}
            onClick={() => {
              setFlowerPopoverOpen((v) => {
                const next = !v;
                flowerPopoverRef.current = next;
                setTooltip(next ? "Edit nearby hexagons" : null);
                return next;
              });
            }}
            disabled={gridDivisions === 0 || hexMode === "world"}
            onMouseEnter={() => setTooltip("Edit nearby hexagons")}
            onMouseLeave={clearTooltip}
          >
            <Expand className="w-4 h-4" />
          </button>
          {flowerPopoverOpen && (
            <div className="absolute bottom-full right-0 mb-2 px-3 pt-3 pb-2 bg-card border rounded-lg shadow-xl z-50 flex flex-col items-center gap-2">
              <input
                type="range"
                min={0}
                max={5}
                value={flowerRadius}
                onChange={(e) => onFlowerRadiusChange(Number(e.target.value))}
                className={sliderClass}
                disabled={hexMode === "world"}
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
  );
}