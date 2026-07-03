"use client";

import { useState, useMemo } from "react";
import { Grid3x3, Hexagon, Flower, Aperture } from "lucide-react";
import { getTriABC, type TriKey } from "@/lib/grid-math";
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
  hoveredTri,
  gridDivisions,
  onGridDivisionsChange,
  hexMode,
  onHexModeChange,
  flowerRadius,
  onFlowerRadiusChange,
  symmetry,
  onSymmetryChange,
}: {
  hoveredTri: TriKey | null;
  gridDivisions: number;
  onGridDivisionsChange: (n: number) => void;
  hexMode: HexMode;
  onHexModeChange: (v: HexMode) => void;
  flowerRadius: number;
  onFlowerRadiusChange: (n: number) => void;
  symmetry: Symmetry;
  onSymmetryChange: (v: Symmetry) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const coords = useMemo(() => {
    if (!hoveredTri) return null;
    return getTriABC(hoveredTri.q, hoveredTri.r, hoveredTri.type);
  }, [hoveredTri]);

  const sliderClass =
    "h-28 w-5 cursor-pointer appearance-none bg-transparent " +
    "[&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted [&::-webkit-slider-runnable-track]:w-1.5 " +
    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-translate-x-[3px] " +
    "[&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted [&::-moz-range-track]:h-1.5 " +
    "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0";

  return (
    <div className="flex items-center justify-between p-2 border-t bg-card/90 backdrop-blur-md z-30">
      {coords ? (
        <div className="flex items-center gap-3 pl-4">
          <div className="flex gap-3 text-[11px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-foreground">a</span> {coords.a}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-foreground">b</span> {coords.b}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-foreground">c</span> {coords.c}
            </span>
          </div>
        </div>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-1.5">
        {gridDivisions > 0 && (
          <span className="text-[11px] font-mono text-muted-foreground">
            N={gridDivisions}
          </span>
        )}
        {hexMode !== "off" && gridDivisions > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/25 text-cyan-300">
            hex:{hexMode === "centers" ? "●" : "○"}
          </span>
        )}
        {symmetry !== "off" && gridDivisions > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/25 text-purple-300">
            {symmetry === "sym60" ? "6-fold" : "3-fold"}
          </span>
        )}
        {flowerRadius > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/25 text-amber-300">
            R{flowerRadius}
          </span>
        )}
      </div>
      <div className="relative flex items-center gap-0.5">
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            hexMode === "outlines" && gridDivisions > 0 && "bg-cyan-500/25 text-cyan-300",
            hexMode === "centers" && gridDivisions > 0 && "bg-cyan-500/40 text-cyan-200",
          )}
          onClick={() => {
            const i = HEX_CYCLE.indexOf(hexMode);
            onHexModeChange(HEX_CYCLE[(i + 1) % HEX_CYCLE.length]);
          }}
          disabled={gridDivisions === 0}
          title={HEX_TITLE[hexMode]}
        >
          <Hexagon className="w-4 h-4" />
        </button>
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            symmetry === "sym60" && gridDivisions > 0 && "bg-purple-500/25 text-purple-300",
            symmetry === "sym120" && gridDivisions > 0 && "bg-purple-500/45 text-purple-200",
          )}
          onClick={() => {
            const i = SYM_CYCLE.indexOf(symmetry);
            onSymmetryChange(SYM_CYCLE[(i + 1) % SYM_CYCLE.length]);
          }}
          disabled={gridDivisions === 0}
          title={SYM_TITLE[symmetry]}
        >
          <Aperture className="w-4 h-4" />
        </button>
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            popoverOpen && "bg-accent text-accent-foreground",
          )}
          onClick={() => setPopoverOpen((v) => !v)}
          title="Grid divisions"
        >
          <Grid3x3 className="w-4 h-4" />
        </button>
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            flowerRadius > 0 && "bg-amber-500/25 text-amber-300",
          )}
          onClick={() => setPopoverOpen((v) => !v)}
          disabled={gridDivisions === 0}
          title="Flower radius"
        >
          <Flower className="w-4 h-4" />
        </button>
        {popoverOpen && (
          <div className="absolute bottom-full right-0 mb-2 px-3 pt-3 pb-2 bg-card border rounded-lg shadow-xl z-50 flex items-end gap-4">
            <div className="flex flex-col items-center gap-2">
              <input
                type="range"
                min={0}
                max={12}
                value={gridDivisions}
                onChange={(e) => onGridDivisionsChange(Number(e.target.value))}
                className={sliderClass}
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
              />
              <span className="text-xs font-mono text-muted-foreground">N={gridDivisions}</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <input
                type="range"
                min={0}
                max={5}
                value={flowerRadius}
                onChange={(e) => onFlowerRadiusChange(Number(e.target.value))}
                className={sliderClass}
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
              />
              <span className="text-xs font-mono text-muted-foreground">R={flowerRadius}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
