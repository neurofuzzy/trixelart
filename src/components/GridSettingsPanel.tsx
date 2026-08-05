"use client";

import { useState } from "react";
import { X, Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpreadHexDialog } from "@/components/SpreadHexDialog";
import type { GridOrientation, HexMode } from "@/components/Footer";

const HEX_CYCLE: HexMode[] = ["world", "honeycomb"];

/**
 * Grid settings as a right-hand drawer — same shell as the pattern and
 * crop/export drawers. It overlays the canvas rather than docking, so toggling
 * it never reflows the artwork.
 */
export function GridSettingsPanel({
  gridDivisions,
  onGridDivisionsChange,
  hexMode,
  onHexModeChange,
  gridOrientation,
  onGridOrientationChange,
  onSpreadHexArtwork,
  onClose,
  onPointerEnter,
}: {
  gridDivisions: number;
  onGridDivisionsChange: (n: number) => void;
  hexMode: HexMode;
  onHexModeChange: (v: HexMode) => void;
  gridOrientation?: GridOrientation;
  onGridOrientationChange?: (v: GridOrientation) => void;
  onSpreadHexArtwork: (newN: number) => void;
  onClose: () => void;
  onPointerEnter: () => void;
}) {
  const [spreadOpen, setSpreadOpen] = useState(false);
  const modeButtonClass = (mode: HexMode) =>
    cn(
      "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
      hexMode === mode
        ? "bg-cyan-500/25 text-cyan-300"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    );

  return (
    <aside
      className="absolute z-40 top-0 right-0 bottom-0 w-96 flex flex-col bg-card/95 backdrop-blur-lg border-l border-white/10 shadow-2xl cursor-default"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour="grid-settings-panel"
    >
      <header className="flex items-center justify-between px-4 h-11 border-b border-white/10 shrink-0">
        <span className="text-xs uppercase tracking-widest text-white/70">
          Grid Settings
        </span>
        <button
          onClick={onClose}
          title="Close grid settings"
          className="inline-flex items-center justify-center h-6 w-6 rounded text-white/50 hover:bg-white/10 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2 shrink-0">
          <span className="text-xs uppercase tracking-wide text-white/60">
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

        <div className="flex flex-col gap-2 shrink-0">
          <span className="text-xs uppercase tracking-wide text-white/60">
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

        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-white/60">
              Hex size
            </span>
            <span className="text-xs font-mono text-white/50 tabular-nums">
              N={gridDivisions}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={12}
            value={gridDivisions}
            onChange={(e) => onGridDivisionsChange(Number(e.target.value))}
            className="w-full h-2 accent-cyan-500"
          />
        </div>

        <button
          onClick={() => setSpreadOpen(true)}
          disabled={gridDivisions <= 0}
          title={
            gridDivisions <= 0
              ? "Set a hex size first — spreading needs the hex lattice enabled"
              : "Re-centre every hexagon of the artwork on a larger hexagon"
          }
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-white/10 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40 shrink-0"
        >
          <Expand className="w-3.5 h-3.5" />
          Spread hex artwork
        </button>
      </div>

      <SpreadHexDialog
        key={spreadOpen ? "open" : "closed"}
        open={spreadOpen}
        currentN={gridDivisions}
        onApply={onSpreadHexArtwork}
        onClose={() => setSpreadOpen(false)}
      />
    </aside>
  );
}
