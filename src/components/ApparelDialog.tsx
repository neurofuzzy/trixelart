"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Shirt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, normalizeProjectFilename } from "@/lib/utils";
import type { Layer } from "@/hooks/use-history";
import { resolveColor } from "@/lib/constants";
import { canvasToPngBlob, downloadBlob } from "@/lib/png-export";
import { ColorPickerDialog } from "@/components/ColorPickerDialog";
import {
  MAX_CUT_MM,
  MAX_DPI,
  MAX_WIDTH_IN,
  MIN_CUT_MM,
  MIN_DPI,
  MIN_WIDTH_IN,
  TRI_AREA,
  apparelCutSegments,
  apparelExportView,
  apparelPixelSize,
  apparelPreviewView,
  artworkBounds,
  cutPieceReport,
  renderApparelPreview,
  renderApparelToCanvas,
  unitsPerMm,
  type ApparelSettings,
} from "@/lib/apparel-export";

/**
 * Apparel export dialog.
 *
 * Its own dialog rather than a mode on the crop drawer, for the same reason the
 * plotter has one: the fabric exports cut a seamless repeat tile out of the
 * artwork, and a shirt print is the whole artwork on a garment. Sharing the crop
 * would mean every shirt silently inheriting a tiling rectangle.
 */

/** A piece smaller than this tends to lift off the garment in the wash. */
const MIN_PIECE_MM2 = 4;

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

type Zoom = "fit" | "actual";

export function ApparelDialog({
  open,
  onOpenChange,
  layers,
  fills,
  gridRotation,
  projectName,
  palettes,
  settings,
  onSettingsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible layers in z-order — what gets drawn. */
  layers: Layer[];
  /** Visible **fill** layers, flattened — what the cut takes its regions from. */
  fills: Record<string, string>;
  gridRotation: number;
  projectName: string;
  palettes: { name: string; colors: string[] }[];
  settings: ApparelSettings;
  onSettingsChange: (patch: Partial<ApparelSettings>) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pickerOpen) {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, pickerOpen, onOpenChange]);

  const bounds = useMemo(
    () => (open ? artworkBounds(layers, gridRotation) : null),
    [open, layers, gridRotation],
  );

  const size = useMemo(
    () =>
      bounds
        ? apparelPixelSize(bounds, gridRotation, settings.widthInches, settings.dpi)
        : null,
    [bounds, gridRotation, settings.widthInches, settings.dpi],
  );

  // Only recomputed when the fills change, not on every slider drag: the joined
  // runs are a property of the artwork, and the gap width only scales the pen.
  const cutSegments = useMemo(
    () => (open && settings.cut ? apparelCutSegments(fills) : []),
    [open, settings.cut, fills],
  );
  const report = useMemo(
    () => (open && settings.cut ? cutPieceReport(fills) : null),
    [open, settings.cut, fills],
  );

  const perMm = bounds ? unitsPerMm(bounds, settings.widthInches) : 0;
  const cutWorld = settings.cut ? settings.cutWidthMm * perMm : 0;
  const smallestMm2 =
    report && perMm > 0
      ? (report.smallestTriangles * TRI_AREA) / (perMm * perMm)
      : 0;
  const tooSmall = !!report && smallestMm2 > 0 && smallestMm2 < MIN_PIECE_MM2;

  const garmentHex = resolveColor(settings.garmentColor);

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const draw = () => {
      const c = canvasRef.current;
      if (!c || !bounds || !size) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const h = Math.max(1, Math.round(wrap.clientHeight * dpr));
      // "Actual" reproduces the export's own scale, centred. At 0.8 mm on a 10"
      // print a fitted preview renders the gap well under a pixel — i.e. it
      // shows nothing about the one setting the user opened this to judge.
      const scale =
        zoom === "fit" ? ("fit" as const) : bounds.w > 0 ? size.pxW / bounds.w : 1;
      const view = apparelPreviewView(bounds, w, h, scale);
      renderApparelPreview(
        c,
        layers,
        bounds,
        gridRotation,
        view,
        cutSegments,
        cutWorld,
        garmentHex,
      );
      c.style.width = `${wrap.clientWidth}px`;
      c.style.height = `${wrap.clientHeight}px`;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [
    open,
    layers,
    bounds,
    size,
    gridRotation,
    zoom,
    cutSegments,
    cutWorld,
    garmentHex,
  ]);

  const handleExport = useCallback(async () => {
    if (!bounds || !size) return;
    setBusy(true);
    setNote(null);
    try {
      const canvas = document.createElement("canvas");
      renderApparelToCanvas(
        canvas,
        layers,
        bounds,
        gridRotation,
        apparelExportView(bounds, size),
        cutSegments,
        cutWorld,
      );
      const blob = await canvasToPngBlob(canvas);
      if (!blob) {
        setNote("The browser could not encode that PNG — try a smaller size.");
        return;
      }
      const base = normalizeProjectFilename(projectName) || "trixel";
      downloadBlob(blob, `${base}_apparel_${size.canvasW}x${size.canvasH}.png`);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }, [
    bounds,
    size,
    layers,
    gridRotation,
    cutSegments,
    cutWorld,
    projectName,
    onOpenChange,
  ]);

  if (!open) return null;

  const canExport = !!bounds && !!size && !busy;

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
          <h3 className="font-semibold text-sm">Export for apparel</h3>
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
            <Section title="Print">
              <Slider
                label="Width"
                value={settings.widthInches}
                min={MIN_WIDTH_IN}
                max={MAX_WIDTH_IN}
                step={0.25}
                display={`${settings.widthInches}″`}
                onChange={(widthInches) => onSettingsChange({ widthInches })}
              />
              <Slider
                label="Resolution"
                value={settings.dpi}
                min={MIN_DPI}
                max={MAX_DPI}
                step={1}
                display={String(settings.dpi)}
                onChange={(dpi) => onSettingsChange({ dpi: Math.round(dpi) })}
              />
              <p className="text-[11px] leading-snug text-muted-foreground/70">
                The file is transparent everywhere you did not paint, so the
                garment shows through. 300 DPI is the usual ask for a DTF or DTG
                transfer.
              </p>
            </Section>

            <Section title="Stencil cut">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.cut}
                  onChange={(e) => onSettingsChange({ cut: e.target.checked })}
                  className="size-4 rounded accent-amber-400"
                />
                <span className="text-xs text-muted-foreground">
                  Cut along colour boundaries
                </span>
              </label>

              {settings.cut && (
                <Slider
                  label="Gap"
                  value={settings.cutWidthMm}
                  min={MIN_CUT_MM}
                  max={MAX_CUT_MM}
                  step={0.1}
                  display={settings.cutWidthMm.toFixed(1)}
                  onChange={(cutWidthMm) => onSettingsChange({ cutWidthMm })}
                />
              )}

              <p className="text-[11px] leading-snug text-muted-foreground/70">
                A large unbroken area of ink is stiff and cracks along fold lines
                after a few washes. Punching a thin gap along every colour
                boundary breaks the print into separate pieces that flex with the
                fabric. A flat field of one colour stays whole — there is no
                boundary inside it.
              </p>
            </Section>

            <Section title="Preview">
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {(
                  [
                    ["fit", "Fit"],
                    ["actual", "Actual size"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setZoom(mode)}
                    className={cn(
                      "flex-1 py-2 text-xs transition-colors",
                      zoom === mode
                        ? "bg-amber-400/20 text-amber-200"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground w-24 shrink-0">
                  Garment
                </span>
                <button
                  onClick={() => setPickerOpen(true)}
                  className="flex-1 min-w-0 h-8 rounded-md border border-input"
                  style={{ backgroundColor: garmentHex }}
                  title={garmentHex}
                />
              </div>

              <p className="text-[11px] leading-snug text-muted-foreground/70">
                The garment colour is only ever drawn here. It is not written to
                the file — that area is transparent.
              </p>
            </Section>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 border-t border-white/10 pt-3">
          <span className="text-xs text-muted-foreground tabular-nums flex-1 leading-snug">
            {note ? (
              <span className="text-red-400">{note}</span>
            ) : !bounds || !size ? (
              "Nothing painted to export."
            ) : (
              <>
                {size.canvasW} &times; {size.canvasH} px &middot;{" "}
                {(size.canvasW / settings.dpi).toFixed(2)} &times;{" "}
                {(size.canvasH / settings.dpi).toFixed(2)} in
                {report ? (
                  <>
                    {" "}
                    &middot; {report.pieces} piece
                    {report.pieces === 1 ? "" : "s"} &middot;{" "}
                    <span className={cn(tooSmall && "text-red-400")}>
                      smallest {smallestMm2.toFixed(1)} mm&sup2;
                      {tooSmall ? " — may lift in the wash" : ""}
                    </span>
                  </>
                ) : null}
              </>
            )}
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
            <Shirt className="w-4 h-4" />
            {busy ? "Encoding…" : "Export PNG"}
          </button>
        </div>
      </div>

      <ColorPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={settings.garmentColor}
        onChange={(garmentColor) => onSettingsChange({ garmentColor })}
        palettes={palettes}
        title="Garment colour"
      />
    </>,
    document.body,
  );
}
