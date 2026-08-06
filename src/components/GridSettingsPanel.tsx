"use client";

import { useState } from "react";
import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelShell } from "@/components/PanelShell";
import { SpreadHexDialog } from "@/components/SpreadHexDialog";
import { ColorPickerDialog } from "@/components/ColorPickerDialog";
import { resolveColor } from "@/lib/constants";
import type { GridOrientation, HexMode } from "@/components/Footer";

const HEX_CYCLE: HexMode[] = ["world", "honeycomb"];

/** The editor's default canvas backdrop: diagonal stripes, so that transparent
 *  and white-painted areas are told apart at a glance. */
export const DEFAULT_EDITOR_BG =
  "repeating-linear-gradient(30deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 6px, rgba(0,0,0,0.06) 6px, rgba(0,0,0,0.06) 12px)";

/** Grid settings as a right-hand drawer. One of the four `PanelShell` panels;
 *  see `PanelId` for the slot they share. */
export function GridSettingsPanel({
  gridDivisions,
  onGridDivisionsChange,
  hexMode,
  onHexModeChange,
  gridOrientation,
  onGridOrientationChange,
  onSpreadHexArtwork,
  showNoPrint,
  onShowNoPrintChange,
  editorBg,
  onEditorBgChange,
  palettes,
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
  /** Editor visibility of no-print markers. Purely a view switch — the markers
   *  shape corners whether or not they are drawn. */
  showNoPrint?: boolean;
  onShowNoPrintChange?: (v: boolean) => void;
  /** Encoded canvas backdrop, or `null` for the default stripes. Editor-only:
   *  it is never drawn into an export, which has its own background setting. */
  editorBg?: string | null;
  onEditorBgChange?: (v: string | null) => void;
  palettes?: { name: string; colors: string[] }[];
  onClose: () => void;
  onPointerEnter: () => void;
}) {
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const modeButtonClass = (mode: HexMode) =>
    cn(
      "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
      hexMode === mode
        ? "bg-cyan-500/25 text-cyan-300"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    );

  return (
    <PanelShell
      title="Grid Settings"
      tour="grid-settings-panel"
      onClose={onClose}
      onPointerEnter={onPointerEnter}
    >
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

        {onShowNoPrintChange && (
          <div className="flex flex-col gap-2 shrink-0">
            <span className="text-xs uppercase tracking-wide text-white/60">
              No-print markers
            </span>
            <div className="flex gap-1">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                    (showNoPrint ?? true) === v
                      ? "bg-cyan-500/25 text-cyan-300"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                  onClick={() => onShowNoPrintChange(v)}
                >
                  {v ? "Show" : "Hide"}
                </button>
              ))}
            </div>
            <span className="text-xs leading-snug text-white/40">
              Hiding them does not change the artwork — they keep their corners
              sharp either way, and never appear in an export.
            </span>
          </div>
        )}

        {onEditorBgChange && palettes && (
          <div className="flex flex-col gap-2 shrink-0">
            <span className="text-xs uppercase tracking-wide text-white/60">
              Canvas background
            </span>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setBgPickerOpen(true)}
                title={
                  editorBg
                    ? `Background: ${resolveColor(editorBg)}`
                    : "Pick a background colour"
                }
                className="w-9 h-8 rounded-md border border-white/20 hover:border-white/60 transition-colors shrink-0"
                style={{
                  background: editorBg
                    ? resolveColor(editorBg)
                    : DEFAULT_EDITOR_BG,
                }}
              />
              <button
                onClick={() => onEditorBgChange(null)}
                disabled={!editorBg}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Default
              </button>
            </div>
            <span className="text-xs leading-snug text-white/40">
              Preview only — it never prints. Handy for spotting near-black
              cells, or for seeing the artwork against the colour it will sit
              on.
            </span>
          </div>
        )}

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

      {onEditorBgChange && palettes && (
        <ColorPickerDialog
          open={bgPickerOpen}
          onClose={() => setBgPickerOpen(false)}
          value={editorBg ?? ""}
          onChange={onEditorBgChange}
          palettes={palettes}
          title="Canvas background"
        />
      )}

      <SpreadHexDialog
        key={spreadOpen ? "open" : "closed"}
        open={spreadOpen}
        currentN={gridDivisions}
        onApply={onSpreadHexArtwork}
        onClose={() => setSpreadOpen(false)}
      />
    </PanelShell>
  );
}
