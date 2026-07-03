"use client";

import { useState, useMemo } from "react";
import { Grid3x3, Hexagon } from "lucide-react";
import { getTriABC, type TriKey } from "@/lib/grid-math";
import { cn } from "@/lib/utils";

export type HexMode = "off" | "outlines" | "centers";

const HEX_CYCLE: HexMode[] = ["off", "outlines", "centers"];
const HEX_TITLE: Record<HexMode, string> = {
  off: "Hex: off",
  outlines: "Hex: outlines",
  centers: "Hex: outlines + centers",
};

export function Footer({
  hoveredTri,
  gridDivisions,
  onGridDivisionsChange,
  hexMode,
  onHexModeChange,
}: {
  hoveredTri: TriKey | null;
  gridDivisions: number;
  onGridDivisionsChange: (n: number) => void;
  hexMode: HexMode;
  onHexModeChange: (v: HexMode) => void;
}) {
  const [sliderOpen, setSliderOpen] = useState(false);

  const coords = useMemo(() => {
    if (!hoveredTri) return null;
    return getTriABC(hoveredTri.q, hoveredTri.r, hoveredTri.type);
  }, [hoveredTri]);

  return (
    <div className="flex items-center justify-between p-2 border-t bg-card/90 backdrop-blur-md z-30">
      {coords ? (
        <div className="flex gap-3 text-[11px] font-mono text-muted-foreground pl-4">
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
      ) : (
        <div />
      )}
      <div className="relative flex items-center gap-0.5">
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            hexMode && gridDivisions > 0 && "bg-accent text-accent-foreground",
          )}
          onClick={() => onHexModeChange(!hexMode)}
          disabled={gridDivisions === 0}
          title="Hex mode"
        >
          <Hexagon className="w-4 h-4" />
        </button>
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            sliderOpen && "bg-accent text-accent-foreground",
          )}
          onClick={() => setSliderOpen((v) => !v)}
          title="Grid divisions"
        >
          <Grid3x3 className="w-4 h-4" />
        </button>
        {sliderOpen && (
          <div className="absolute bottom-full right-0 mb-2 px-2 pt-3 pb-2 bg-card border rounded-lg shadow-xl z-50 flex flex-col items-center gap-2">
            <input
              type="range"
              min={0}
              max={12}
              value={gridDivisions}
              onChange={(e) => onGridDivisionsChange(Number(e.target.value))}
              className="h-28 w-5 cursor-pointer appearance-none bg-transparent
                [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted [&::-webkit-slider-runnable-track]:w-1.5
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-translate-x-[3px]
                [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted [&::-moz-range-track]:h-1.5
                [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
              style={{ writingMode: "vertical-lr", direction: "rtl" }}
            />
            <span className="text-xs font-mono text-muted-foreground">
              N={gridDivisions}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
