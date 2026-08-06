"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveColor } from "@/lib/constants";
import { triToString, type TriKey } from "@/lib/grid-math";
import { regionTrixels, type HexRegion } from "@/lib/hex-flower";
import { MAX_DENSITY, MAX_WEIGHT, MIN_DENSITY, MIN_WEIGHT } from "@/lib/hatch";
import {
  MAX_LEVELS,
  MAX_SKIP,
  MIN_LEVELS,
  MIN_SKIP,
  hatchify,
  reachableDensities,
  type HatchifySettings,
} from "@/lib/hatchify";
import { renderHatchifyPreview } from "@/lib/hatchify-render";
import { ColorPickerDialog } from "@/components/ColorPickerDialog";
import type { Layer } from "@/hooks/use-history";

/**
 * Settings modal for "convert to hatches".
 *
 * Shares `ColorPickerDialog`'s shell — same overlay, panel, header — so the
 * app's modals read as one family, and delegates the colour choice to that
 * dialog rather than inlining a fourteen-palette grid, exactly as `ExportPanel`
 * does for its background.
 *
 * The preview carries a **Before / After** toggle because the question it has to
 * answer is whether the hatch reads as the tone it replaced, and a single "after"
 * image cannot answer that.
 */

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      {/* `whitespace-nowrap` and a column wide enough for the longest label:
          "Max dens" wraps to two lines otherwise and jogs the slider out of
          alignment with its neighbours. */}
      <span className="text-xs uppercase tracking-wide text-muted-foreground w-20 shrink-0 whitespace-nowrap">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-2 accent-cyan-500 min-w-0"
      />
      <span className="text-sm font-mono text-muted-foreground tabular-nums w-8 text-right shrink-0">
        {display}
      </span>
    </label>
  );
}

export function HatchifyDialog({
  open,
  onClose,
  onApply,
  settings,
  onSettingsChange,
  source,
  hexes,
  gridDivisions,
  palettes,
}: {
  open: boolean;
  onClose: () => void;
  onApply: () => void;
  settings: HatchifySettings;
  onSettingsChange: (patch: Partial<HatchifySettings>) => void;
  /** Merged fills from the visible layers below the hatch layer. */
  source: Record<string, string>;
  hexes: HexRegion[];
  gridDivisions: number;
  palettes: { name: string; colors: string[] }[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // The colour modal is on top; let it take the first Escape.
        if (!pickerOpen) onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, pickerOpen]);

  const tris: TriKey[] = useMemo(() => {
    if (!open || gridDivisions <= 0) return [];
    const out: TriKey[] = [];
    for (const hex of hexes) {
      out.push(...regionTrixels(hex));
    }
    return out;
  }, [open, hexes, gridDivisions]);

  const result = useMemo(
    () => (open ? hatchify(source, hexes, gridDivisions, settings) : null),
    [open, source, hexes, gridDivisions, settings],
  );

  // Only the fills the selection actually covers, so "before" shows the same
  // window as "after" rather than the whole document behind it.
  const previewLayers: Layer[] = useMemo(() => {
    if (!result) return [];
    const base: Record<string, string> = {};
    for (const t of tris) {
      const key = triToString(t);
      const v = source[key];
      if (v) base[key] = v;
    }
    if (showBefore) {
      return [{ id: "p", name: "before", kind: "fill", painted: base, visible: true }];
    }
    return [
      {
        id: "p",
        name: "fills",
        kind: "fill",
        painted: { ...base, ...result.fills },
        visible: true,
      },
      { id: "h", name: "hatch", kind: "hatch", painted: result.hatch, visible: true },
    ];
  }, [result, tris, source, showBefore]);

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const draw = () => {
      const c = canvasRef.current;
      if (c) renderHatchifyPreview(c, previewLayers, tris);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [open, previewLayers, tris]);

  if (!open) return null;

  const markCount = result ? Object.keys(result.hatch).length : 0;
  const reduce = settings.mode === "reduce";
  const { densities, allOdd } = reachableDensities(settings);

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 bg-black/20" onClick={onClose} />
      {/* Fixed height rather than content height, so the preview — the only
          flex child of its column — absorbs the slack and gets as large as the
          viewport allows. Same reasoning as the pattern drawer's preview. */}
      <div
        className="fixed z-50 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl flex flex-col gap-3 w-[46rem] max-w-[calc(100vw-2rem)] h-[42rem] max-h-[calc(100vh-2rem)]"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-sm">Convert to hatches</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
            <div
              ref={wrapRef}
              className="flex-1 min-h-0 relative rounded-lg border border-white/10 bg-black/30 overflow-hidden"
            >
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            </div>
            <div className="flex rounded-md overflow-hidden border border-white/10 shrink-0">
              {([false, true] as const).map((before) => (
                <button
                  key={String(before)}
                  onClick={() => setShowBefore(before)}
                  className={cn(
                    "flex-1 py-1.5 text-xs transition-colors",
                    showBefore === before
                      ? "bg-cyan-500/25 text-cyan-200"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {before ? "Before" : "After"}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:w-72 shrink-0 min-h-0 overflow-y-auto space-y-3">
            <div className="flex rounded-md overflow-hidden border border-white/10">
              {(["single", "reduce"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onSettingsChange({ mode })}
                  className={cn(
                    "flex-1 py-2 text-sm transition-colors",
                    settings.mode === mode
                      ? "bg-cyan-500/25 text-cyan-200"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {mode === "single" ? "Single colour" : "Reduce"}
                </button>
              ))}
            </div>

            <p className="text-xs leading-snug text-muted-foreground">
              {reduce
                ? "Collapses each trixel's nine tones to the chosen number, keeping its palette, and dithers between adjacent levels with the hatch. Rewrites the fill layers below."
                : "Hatches in one colour; tone becomes density alone. The layers below are left untouched."}
            </p>

            {reduce && (
              <Slider
                label="Levels"
                value={settings.levels}
                min={MIN_LEVELS}
                max={MAX_LEVELS}
                step={1}
                display={String(settings.levels)}
                onChange={(levels) => onSettingsChange({ levels })}
              />
            )}

            {/* Dragging either end past the other would invert the range and
                make every mark take the same density. */}
            <Slider
              label="Min dens"
              value={settings.minDensity}
              min={MIN_DENSITY}
              max={MAX_DENSITY}
              step={1}
              display={String(settings.minDensity)}
              onChange={(minDensity) =>
                onSettingsChange({
                  minDensity,
                  maxDensity: Math.max(minDensity, settings.maxDensity),
                })
              }
            />
            <Slider
              label="Max dens"
              value={settings.maxDensity}
              min={MIN_DENSITY}
              max={MAX_DENSITY}
              step={1}
              display={String(settings.maxDensity)}
              onChange={(maxDensity) =>
                onSettingsChange({
                  maxDensity,
                  minDensity: Math.min(maxDensity, settings.minDensity),
                })
              }
            />
            {/* Restricting which densities may be used is what makes the result
                plottable: see `reachableDensities` for why an all-odd ladder
                draws as continuous lines. */}
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground w-20 shrink-0">
                Skip
              </span>
              <div className="flex flex-1 rounded-md overflow-hidden border border-white/10">
                {Array.from(
                  { length: MAX_SKIP - MIN_SKIP + 1 },
                  (_, i) => i + MIN_SKIP,
                ).map((skip) => (
                  <button
                    key={skip}
                    onClick={() => onSettingsChange({ densitySkip: skip })}
                    title={
                      skip === 1
                        ? "Every density in range"
                        : `Every ${skip === 2 ? "2nd" : "3rd"} density in range`
                    }
                    className={cn(
                      "flex-1 py-1.5 text-xs font-mono transition-colors",
                      settings.densitySkip === skip
                        ? "bg-cyan-500/25 text-cyan-200"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {skip}
                  </button>
                ))}
              </div>
            </div>

            <p
              className={cn(
                "text-[11px] leading-snug",
                allOdd ? "text-cyan-300/80" : "text-muted-foreground",
              )}
            >
              Densities {densities.join(", ") || "—"}.{" "}
              {allOdd
                ? "All odd, so every one contains the same coarse lines — they run unbroken across the selection and plot without lifting the pen."
                : "Mixed parities, so tone changes break the lines. Set an odd Min with Skip 2 for continuous strokes."}
            </p>

            <Slider
              label="Weight"
              value={settings.weight}
              min={MIN_WEIGHT}
              max={MAX_WEIGHT}
              step={0.25}
              display={settings.weight.toFixed(2)}
              onChange={(weight) => onSettingsChange({ weight })}
            />

            {!reduce && (
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground w-20 shrink-0">
                  Colour
                </span>
                <button
                  onClick={() => setPickerOpen(true)}
                  title={`Ink: ${resolveColor(settings.color)}`}
                  className="w-11 h-[30px] rounded-md border border-white/20 hover:border-white/60 transition-colors"
                  style={{ backgroundColor: resolveColor(settings.color) }}
                />
              </div>
            )}

          </div>
        </div>

        {/* Actions span the panel rather than sitting in the controls column,
            which now scrolls — they must stay reachable without scrolling. */}
        <div className="flex items-center gap-2 shrink-0 border-t border-white/10 pt-3">
          <span className="text-xs text-muted-foreground tabular-nums flex-1">
            {hexes.length} hex{hexes.length === 1 ? "" : "es"} &middot; {markCount}{" "}
            mark{markCount === 1 ? "" : "s"}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onApply();
              onClose();
            }}
            disabled={markCount === 0 && !reduce}
            className="px-4 py-2 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-40 text-sm"
          >
            Apply
          </button>
        </div>
      </div>

      <ColorPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={settings.color}
        onChange={(color) => onSettingsChange({ color })}
        palettes={palettes}
        title="Hatch ink"
      />
    </>,
    document.body,
  );
}
