"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, normalizeProjectFilename } from "@/lib/utils";
import type { Layer } from "@/hooks/use-history";
import { downloadBlob } from "@/lib/png-export";
import { MAX_DENSITY, MIN_DENSITY } from "@/lib/hatch";
import { layersRoundFraction } from "@/lib/hatch-render";
import {
  MAX_HATCH_INSET_MM,
  MAX_MARGIN_IN,
  MAX_PAGE_IN,
  MIN_PAGE_IN,
  PAGE_SIZES,
  allStrokes,
  buildPlotterPlot,
  plotterDensities,
  plotterLayout,
  plotterSVG,
  renderPlotterPreview,
  type FillStyle,
  type PageSizeId,
  type PenMode,
  type PlotterPlot,
  type PlotterSettings,
} from "@/lib/plotter-export";

/**
 * Plotter export dialog.
 *
 * Deliberately *not* part of the crop drawer. The fabric exports exist to cut a
 * seamless repeat tile out of the artwork; a plot is a drawing on a sheet of
 * paper, so it takes the **whole** artwork and derives its page from what is
 * actually painted. Sharing the crop would have meant every plot silently
 * inherited a tiling rectangle that has nothing to do with it.
 */

/** One group of controls. The settings fall into four unrelated decisions — the
 *  pen, the sheet, the tone mapping, the line work — and stacking eighteen rows
 *  at one rhythm made them read as a single undifferentiated list. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5 py-4 first:pt-0 last:pb-0">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {title}
      </h4>
      {children}
    </section>
  );
}

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
      <span className="text-xs uppercase tracking-wide text-muted-foreground w-24 shrink-0 whitespace-nowrap">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 h-2 accent-amber-400"
      />
      <span className="text-sm font-mono text-muted-foreground tabular-nums w-10 text-right shrink-0">
        {display}
      </span>
    </label>
  );
}

/** A page dimension in inches. Clamped on commit rather than on every keystroke,
 *  so a half-typed "1" on the way to "12" is not snapped away underneath. */
function NumberIn({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw);
    setDraft(null);
    if (Number.isFinite(n)) {
      onChange(Math.min(MAX_PAGE_IN, Math.max(MIN_PAGE_IN, n)));
    }
  };
  return (
    <input
      type="number"
      min={MIN_PAGE_IN}
      max={MAX_PAGE_IN}
      step={0.25}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
      }}
      className="w-full min-w-0 h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground tabular-nums outline-none focus:border-ring focus:ring-1 focus:ring-ring"
    />
  );
}

export function PlotterDialog({
  open,
  onOpenChange,
  layers,
  gridRotation,
  gridDivisions,
  projectName,
  settings,
  onSettingsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible layers in z-order. */
  layers: Layer[];
  gridRotation: number;
  gridDivisions: number;
  projectName: string;
  settings: PlotterSettings;
  onSettingsChange: (patch: Partial<PlotterSettings>) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  // The hatch takes its direction from the hex wedges, so without a hex lattice
  // there is nothing to take a direction from. A contour fill follows each
  // region's own boundary and needs no lattice at all.
  const canPlot = gridDivisions > 0 || settings.fillStyle === "contour";
  const roundFraction = useMemo(() => layersRoundFraction(layers), [layers]);

  /**
   * The plot is built asynchronously — the polygon path loads Clipper on
   * demand — so it lands in state rather than in a memo.
   *
   * Debounced, and guarded by a request id. Every settings change rebuilds the
   * whole plot, and a slider drag fires one per frame; without the delay the
   * heavier contour path would queue a build behind every intermediate value,
   * and without the id a slow early build could resolve *after* a fast later one
   * and put a stale preview on screen.
   */
  const [plot, setPlot] = useState<PlotterPlot | null>(null);
  const [building, setBuilding] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open || !canPlot) {
      setPlot(null);
      setBuilding(false);
      return;
    }
    const id = ++requestRef.current;
    setBuilding(true);
    const timer = setTimeout(() => {
      buildPlotterPlot(layers, gridRotation, gridDivisions, settings)
        .then((next) => {
          if (requestRef.current !== id) return;
          setPlot(next);
          setBuilding(false);
        })
        .catch(() => {
          if (requestRef.current !== id) return;
          setPlot(null);
          setBuilding(false);
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [open, canPlot, layers, gridRotation, gridDivisions, settings]);

  const layout = useMemo(
    () => (plot ? plotterLayout(plot, settings) : null),
    [plot, settings],
  );
  const ladder = useMemo(() => plotterDensities(settings), [settings]);
  const darkPaper = settings.pen === "white-on-black";

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const draw = () => {
      const c = canvasRef.current;
      if (!c || !plot || !layout) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const h = Math.max(1, Math.round(wrap.clientHeight * dpr));
      renderPlotterPreview(c, plot, layout, w, h, settings.strokeWidthMm);
      c.style.width = `${wrap.clientWidth}px`;
      c.style.height = `${wrap.clientHeight}px`;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
    // `layout` already changes identity with the settings, but the nib is read
    // straight out of `settings` here, so it has to be named for itself.
  }, [open, plot, layout, settings.strokeWidthMm]);

  const handleExport = useCallback(() => {
    if (!plot || !layout || layout.invalid || allStrokes(plot).length === 0) {
      return;
    }
    const svg = plotterSVG(plot, layout, settings.strokeWidthMm);
    const base = normalizeProjectFilename(projectName) || "trixel";
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml" }),
      `${base}_plot.svg`,
    );
    onOpenChange(false);
  }, [plot, layout, settings.strokeWidthMm, projectName, onOpenChange]);

  if (!open) return null;

  // World units → inches on the page, so the pen-length readout is in the same
  // unit as the sheet it is drawn on.
  const toInches = (world: number) => (layout ? world * layout.scale : 0);
  const hasStrokes = !!plot && allStrokes(plot).length > 0;
  const canExport = hasStrokes && !!layout && !layout.invalid;
  const fitPage = settings.pageSize === "fit";

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 bg-black/20"
        onClick={() => onOpenChange(false)}
      />
      <div
        className="fixed z-50 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl flex flex-col gap-3 w-[46rem] max-w-[calc(100vw-2rem)] h-[40rem] max-h-[calc(100vh-2rem)]"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-sm">Export for plotter</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onOpenChange(false)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-4">
          <div
            ref={wrapRef}
            className="flex-1 min-w-0 min-h-0 relative rounded-lg border border-white/10 bg-black/30 overflow-hidden"
          >
            <canvas ref={canvasRef} className="absolute inset-0" />
          </div>

          <div className="sm:w-72 shrink-0 min-h-0 overflow-y-auto pr-1 divide-y divide-white/10">
            <Section title="Pen">
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {(
                  [
                    ["black-on-white", "Black on white"],
                    ["white-on-black", "White on black"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => onSettingsChange({ pen: mode as PenMode })}
                    className={cn(
                      "flex-1 py-2 text-xs transition-colors",
                      settings.pen === mode
                        ? "bg-amber-400/20 text-amber-200"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <Slider
                label="Nib"
                value={settings.strokeWidthMm}
                min={0.05}
                max={2}
                step={0.05}
                display={settings.strokeWidthMm.toFixed(2)}
                onChange={(strokeWidthMm) => onSettingsChange({ strokeWidthMm })}
              />
            </Section>

            <Section title="Page">
              <label className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground w-24 shrink-0">
                  Size
                </span>
                <select
                  value={settings.pageSize}
                  onChange={(e) =>
                    onSettingsChange({ pageSize: e.target.value as PageSizeId })
                  }
                  className="flex-1 min-w-0 h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                >
                  {PAGE_SIZES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.w > 0 ? ` — ${p.w} × ${p.h} in` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {/* A sheet has an orientation; a page cut to the artwork does
                  not — it already has the artwork's own aspect. */}
              {!fitPage && (
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0" />
                  <div className="flex flex-1 rounded-md overflow-hidden border border-white/10">
                    {(
                      [
                        [false, "Portrait"],
                        [true, "Landscape"],
                      ] as const
                    ).map(([landscape, label]) => (
                      <button
                        key={label}
                        onClick={() => onSettingsChange({ landscape })}
                        className={cn(
                          "flex-1 py-1.5 text-xs transition-colors",
                          settings.landscape === landscape
                            ? "bg-amber-400/20 text-amber-200"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {settings.pageSize === "custom" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground w-24 shrink-0">
                    Sheet
                  </span>
                  <NumberIn
                    value={settings.customWidthIn}
                    onChange={(customWidthIn) =>
                      onSettingsChange({ customWidthIn })
                    }
                  />
                  <span className="text-xs text-muted-foreground">&times;</span>
                  <NumberIn
                    value={settings.customHeightIn}
                    onChange={(customHeightIn) =>
                      onSettingsChange({ customHeightIn })
                    }
                  />
                  <span className="text-xs text-muted-foreground">in</span>
                </div>
              )}

              {fitPage && (
                <Slider
                  label="Art width"
                  value={settings.artWidthIn}
                  min={1}
                  max={40}
                  step={0.5}
                  display={settings.artWidthIn.toFixed(1)}
                  onChange={(artWidthIn) => onSettingsChange({ artWidthIn })}
                />
              )}

              <Slider
                label="Margin"
                value={settings.marginIn}
                min={0}
                max={MAX_MARGIN_IN}
                step={0.05}
                display={settings.marginIn.toFixed(2)}
                onChange={(marginIn) => onSettingsChange({ marginIn })}
              />

            </Section>

            <Section title="Tone">
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {(
                  [
                    ["hatch", "Hatch"],
                    ["contour", "Contour"],
                  ] as const
                ).map(([style, label]) => (
                  <button
                    key={style}
                    onClick={() =>
                      onSettingsChange({ fillStyle: style as FillStyle })
                    }
                    className={cn(
                      "flex-1 py-2 text-xs transition-colors",
                      settings.fillStyle === style
                        ? "bg-amber-400/20 text-amber-200"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <Slider
                label="Min density"
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
                label="Max density"
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

              {/* Hatch only: a contour's rings are closed loops a full spacing
                  in from the edge, so they have no ends to blot. */}
              {settings.fillStyle === "hatch" && (
                <>
                  <Slider
                    label="Edge gap"
                    value={settings.hatchInsetMm}
                    min={0}
                    max={MAX_HATCH_INSET_MM}
                    step={0.05}
                    display={settings.hatchInsetMm.toFixed(2)}
                    onChange={(hatchInsetMm) =>
                      onSettingsChange({ hatchInsetMm })
                    }
                  />
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.linkHatchEnds}
                      onChange={(e) =>
                        onSettingsChange({ linkHatchEnds: e.target.checked })
                      }
                      className="size-4 rounded accent-amber-400"
                    />
                    <span className="text-xs text-muted-foreground">
                      Link hatch ends into one stroke
                    </span>
                  </label>

                  {/* Kept because it is a state nothing else reveals: with no
                      gap the line ends sit on the boundary, the connectors have
                      nowhere to go, and most links are silently refused. */}
                  {settings.linkHatchEnds && settings.hatchInsetMm <= 0 && (
                    <p className="text-[11px] leading-snug text-amber-200/70">
                      Needs an edge gap — connectors have no room otherwise.
                    </p>
                  )}
                </>
              )}

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.blankLightest}
                  onChange={(e) =>
                    onSettingsChange({ blankLightest: e.target.checked })
                  }
                  className="size-4 rounded accent-amber-400"
                />
                <span className="text-xs text-muted-foreground">
                  {/* Which end of the ramp goes blank follows the pen: white on
                      black spends ink on the *light* areas. */}
                  Leave the {darkPaper ? "darkest" : "lightest"} tone unhatched
                </span>
              </label>

              <p className="text-xs text-muted-foreground tabular-nums">
                {ladder.length} tone level{ladder.length === 1 ? "" : "s"}
                {settings.blankLightest ? ", the first blank" : ""}
              </p>

              {/* The radius is the largest one enabled anywhere in the fill
                  stack — the plot merges the layers, so only one can win. */}
              {roundFraction > 0 && (
                <p className="text-[11px] leading-snug text-amber-200/70">
                  Following the {Math.round(roundFraction * 100)}% corner
                  rounding on the artwork.
                </p>
              )}
            </Section>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 border-t border-white/10 pt-3">
          <span className="text-xs text-muted-foreground tabular-nums flex-1 leading-snug">
            {!canPlot ? (
              <span className="text-red-400">
                The hatch needs a hex lattice — set grid divisions above 0, or
                switch to a contour fill.
              </span>
            ) : !hasStrokes ? (
              building ? (
                "Working out the line work…"
              ) : (
                "Nothing painted to plot."
              )
            ) : layout?.invalid ? (
              <span className="text-red-400">
                The margin leaves no room to draw — reduce it or use a larger
                page.
              </span>
            ) : plot && layout ? (
              <>
                {layout.pageW.toFixed(2)} &times; {layout.pageH.toFixed(2)} in
                page &middot; {layout.artW.toFixed(2)} &times;{" "}
                {layout.artH.toFixed(2)} in drawing &middot;{" "}
                {plot.hatch.length} hatch + {plot.outlines.length} outline
                &middot; {toInches(plot.penDownLength).toFixed(0)} in down
                &middot; {toInches(plot.penUpLength).toFixed(0)} in up
                <span className="text-muted-foreground/50">
                  {" "}
                  &middot; joined from {plot.rawSegments}
                </span>
              </>
            ) : null}
          </span>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-amber-400/15 hover:bg-amber-400/25 disabled:opacity-40 text-sm text-amber-100"
          >
            <PenLine className="w-4 h-4" />
            Export SVG
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
