"use client";

import { useState, type ReactNode } from "react";
import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelShell } from "@/components/PanelShell";
import { SpreadHexDialog } from "@/components/SpreadHexDialog";
import { ColorPickerDialog } from "@/components/ColorPickerDialog";
import { resolveColor } from "@/lib/constants";
import type { GridOrientation, HexMode } from "@/components/Footer";

/** The editor's default canvas backdrop: diagonal stripes, so that transparent
 *  and white-painted areas are told apart at a glance. */
export const DEFAULT_EDITOR_BG =
  "repeating-linear-gradient(30deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 6px, rgba(0,0,0,0.06) 6px, rgba(0,0,0,0.06) 12px)";

/** A titled group of rows. The panel has exactly two — what the lattice *is*,
 *  and what the editor merely *shows* — because the second group's settings
 *  reach no export and that distinction is the one users get wrong. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 shrink-0">
      <div className="flex items-baseline gap-2">
        <span className="text-xs uppercase tracking-wide text-white/60 shrink-0">
          {title}
        </span>
        <span className="flex-1 h-px bg-white/10" />
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

/** Label on the left, control on the right. The fixed label column is what
 *  makes the three segmented controls line up as one edge rather than three
 *  ragged ones. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-h-8">
      <span className="w-[8.5rem] shrink-0 text-sm text-white/70">{label}</span>
      <div className="flex-1 flex items-center justify-end gap-1.5 min-w-0">
        {children}
      </div>
    </div>
  );
}

/** Two-or-more mutually exclusive options in one pill. Drawn as a single
 *  recessed track so the selected segment reads as a position, not as one
 *  highlighted button floating next to another. */
function Segmented<T extends string | boolean>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-0.5 p-0.5 rounded-md bg-black/30 border border-white/5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 rounded text-xs font-medium transition-colors",
            value === o.value
              ? "bg-cyan-500/25 text-cyan-300"
              : "text-muted-foreground hover:bg-white/10 hover:text-white",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ORIGINS = [
  { value: "world" as HexMode, label: "World" },
  { value: "honeycomb" as HexMode, label: "Honeycomb" },
] as const;

const ORIENTATIONS = [
  { value: "flat-top" as GridOrientation, label: "Flat-top" },
  { value: "pointy-top" as GridOrientation, label: "Pointy-top" },
] as const;

const MARKER_MODES = [
  { value: true, label: "Show" },
  { value: false, label: "Hide" },
] as const;

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
  const bgHex = editorBg ? resolveColor(editorBg) : null;

  return (
    <PanelShell
      title="Grid Settings"
      tour="grid-settings-panel"
      onClose={onClose}
      onPointerEnter={onPointerEnter}
    >
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 p-4">
        <Group title="Lattice">
          <Row label="Origin">
            <Segmented
              options={ORIGINS}
              value={hexMode}
              onChange={onHexModeChange}
            />
          </Row>
          {onGridOrientationChange && gridOrientation && (
            <Row label="Orientation">
              <Segmented
                options={ORIENTATIONS}
                value={gridOrientation}
                onChange={onGridOrientationChange}
              />
            </Row>
          )}
          <Row label="Hex size">
            <input
              type="range"
              min={0}
              max={12}
              value={gridDivisions}
              onChange={(e) => onGridDivisionsChange(Number(e.target.value))}
              className="flex-1 min-w-0 h-2 accent-cyan-500"
            />
            <span className="w-8 shrink-0 text-right text-xs font-mono text-white/50 tabular-nums">
              N={gridDivisions}
            </span>
          </Row>
          <button
            onClick={() => setSpreadOpen(true)}
            disabled={gridDivisions <= 0}
            title={
              gridDivisions <= 0
                ? "Set a hex size first — spreading needs the hex lattice enabled"
                : "Re-centre every hexagon of the artwork on a larger hexagon"
            }
            className="mt-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-white/10 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40 shrink-0"
          >
            <Expand className="w-4 h-4" />
            Spread hex artwork
          </button>
        </Group>

        {(onShowNoPrintChange || (onEditorBgChange && palettes)) && (
          <Group title="Preview">
            {onShowNoPrintChange && (
              <Row label="No-print markers">
                {/* Editor visibility only — hidden markers still keep their
                    corners sharp, and never appear in an export. */}
                <Segmented
                  options={MARKER_MODES}
                  value={showNoPrint ?? true}
                  onChange={onShowNoPrintChange}
                />
              </Row>
            )}
            {onEditorBgChange && palettes && (
              <Row label="Background">
                {/* The value is named next to its swatch, so "Default" reads as
                    the current state rather than as the button beside it. */}
                <span className="flex-1 min-w-0 text-right text-xs font-mono text-white/45 truncate">
                  {bgHex ?? "Default"}
                </span>
                <button
                  onClick={() => setBgPickerOpen(true)}
                  title="Pick a canvas background colour"
                  className="w-9 h-7 rounded-md border border-white/20 hover:border-white/60 transition-colors shrink-0"
                  style={{ background: bgHex ?? DEFAULT_EDITOR_BG }}
                />
                {editorBg && (
                  <button
                    onClick={() => onEditorBgChange(null)}
                    title="Back to the default stripes"
                    className="px-2 py-1 rounded text-xs text-white/50 hover:bg-white/10 hover:text-white transition-colors shrink-0"
                  >
                    Reset
                  </button>
                )}
              </Row>
            )}
          </Group>
        )}
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
