"use client";

import { useState } from "react";
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

export type HexMode = "off" | "outlines" | "centers";
export type Symmetry = "off" | "sym60" | "sym120";

const HEX_CYCLE: HexMode[] = ["off", "outlines", "centers"];
const HEX_TITLE: Record<HexMode, string> = {
  off: "Hex: off",
  outlines: "Hex: outlines",
  centers: "Hex: outlines + centers",
};

const SYM_CYCLE: Symmetry[] = ["off", "sym60", "sym120"];
const SYM_TITLE: Record<Symmetry, string> = {
  off: "Symmetry: off",
  sym60: "Symmetry: 6-fold (60°)",
  sym120: "Symmetry: 3-fold (120°)",
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
}) {
  const [hexDialogOpen, setHexDialogOpen] = useState(false);
  const [flowerPopoverOpen, setFlowerPopoverOpen] = useState(false);

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
      <div className="flex items-center gap-1.5">
        {hexMode !== "off" && gridDivisions > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/25 text-cyan-300">
            hex: {hexMode === "centers" ? "●" : "○"}
          </span>
        )}
        {symmetry !== "off" && gridDivisions > 0 && hexMode !== "off" && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/25 text-purple-300">
            {symmetry === "sym60" ? "6-fold" : "3-fold"}
          </span>
        )}
      </div>
      <div className="relative flex items-center gap-0.5">
        <AlertDialog open={hexDialogOpen} onOpenChange={setHexDialogOpen}>
          <AlertDialogTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                hexDialogOpen && "bg-accent text-accent-foreground",
                hexMode === "outlines" &&
                  gridDivisions > 0 &&
                  "bg-cyan-500/25 text-cyan-300",
                hexMode === "centers" &&
                  gridDivisions > 0 &&
                  "bg-cyan-500/40 text-cyan-200",
              )}
              title={HEX_TITLE[hexMode]}
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
                <span className="text-xs font-medium text-muted-foreground">Display</span>
                <div className="flex gap-1">
                  {HEX_CYCLE.map((mode) => (
                    <button
                      key={mode}
                      className={modeButtonClass(mode)}
                      onClick={() => onHexModeChange(mode)}
                    >
                      {mode === "off" ? "Off" : mode === "outlines" ? "Outlines" : "Centers"}
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
            symmetry === "sym60" &&
              gridDivisions > 0 &&
              "bg-purple-500/25 text-purple-300",
            symmetry === "sym120" &&
              gridDivisions > 0 &&
              "bg-purple-500/45 text-purple-200",
          )}
          onClick={() => {
            const i = SYM_CYCLE.indexOf(symmetry);
            onSymmetryChange(SYM_CYCLE[(i + 1) % SYM_CYCLE.length]);
          }}
          disabled={gridDivisions === 0 || hexMode === "off"}
          title={SYM_TITLE[symmetry]}
        >
          <Aperture className="w-4 h-4" />
        </button>
        <div className="relative">
          <button
            className={cn(
              "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              flowerRadius > 0 &&
                hexMode !== "off" &&
                gridDivisions > 0 &&
                "bg-amber-500/25 text-amber-300",
            )}
            onClick={() => {
              setFlowerPopoverOpen((v) => !v);
            }}
            disabled={gridDivisions === 0 || hexMode === "off"}
            title="edit nearby hexagons"
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
                disabled={hexMode === "off"}
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
