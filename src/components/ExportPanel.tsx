"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crop as CropIcon, Download, Minus, Plus, Scan } from "lucide-react";
import { resolveColor } from "@/lib/constants";
import { normalizeProjectFilename } from "@/lib/utils";
import { ColorPickerDialog } from "@/components/ColorPickerDialog";
import {
  cropDisplayBounds,
  fitCropToPainted,
  type CropRect,
} from "@/lib/crop";
import {
  MAX_UPLOAD_BYTES,
  SPOONFLOWER_DPI,
  canvasToPngBlob,
  cropPixelSize,
  downloadBlob,
  renderCropPreview,
  renderCropToCanvas,
} from "@/lib/png-export";
import { generateCroppedSVG, type SVGExportOptions } from "@/lib/svg-export";

/**
 * Crop-and-export drawer.
 *
 * Two very different consumers share one crop:
 *  - print-on-demand (Spoonflower et al.) takes **PNG only**, sRGB, at most
 *    40 MB, resampled to 150 DPI — so `pixels / 150` is the printed size;
 *  - illustration apps take SVG, which is why the vector path clips geometry
 *    rather than hiding the overflow behind a <clipPath>.
 */

export interface ExportSettings {
  dpi: number;
  widthInches: number;
  /** Encoded palette colour, or a literal #rrggbb — `resolveColor` passes
   *  unrecognised strings straight through, so both work. */
  bgColor: string;
  svg: SVGExportOptions;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  dpi: SPOONFLOWER_DPI,
  widthInches: 8,
  bgColor: "#ffffff",
  svg: { stroke: false, merge: false },
};

/** Preview bitmaps stay small — this is a framing aid, not a proof. */
const PREVIEW_MAX_PX = 512;

/** Tiles across the preview. Odd, so one tile is unambiguously the centre. */
const PREVIEW_REPEAT = 3;

function Stepper({
  label,
  value,
  onChange,
  min = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-white/50 w-3">{label}</span>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        className="p-1 rounded hover:bg-white/10 text-white/70 disabled:opacity-30"
        disabled={value <= min}
        title={`Decrease ${label}`}
      >
        <Minus className="w-3 h-3" />
      </button>
      <span className="text-[11px] font-mono text-white/85 w-6 text-center">
        {value}
      </span>
      <button
        onClick={() => onChange(value + 1)}
        className="p-1 rounded hover:bg-white/10 text-white/70"
        title={`Increase ${label}`}
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min = 0.1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  return (
    <label className="flex-1 min-w-0 flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wide text-white/45">
        {label}
      </span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= min) onChange(n);
          }}
          className="w-full min-w-0 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-white/85 focus:outline-none focus:border-white/40"
        />
        {suffix && (
          <span className="text-[10px] text-white/40 shrink-0">{suffix}</span>
        )}
      </span>
    </label>
  );
}

export function ExportPanel({
  painted,
  crop,
  onCropChange,
  gridRotation,
  projectName,
  palettes,
  settings,
  onSettingsChange,
  onPointerEnter,
}: {
  painted: Record<string, string>;
  crop: CropRect;
  onCropChange: (c: CropRect) => void;
  gridRotation: number;
  projectName: string;
  palettes: { name: string; colors: string[] }[];
  settings: ExportSettings;
  onSettingsChange: (patch: Partial<ExportSettings>) => void;
  onPointerEnter: () => void;
}) {
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const bgHex = resolveColor(settings.bgColor);

  const display = useMemo(
    () => cropDisplayBounds(crop, gridRotation),
    [crop, gridRotation],
  );
  const { pxW, pxH } = useMemo(
    () => cropPixelSize(crop, gridRotation, settings.widthInches, settings.dpi),
    [crop, gridRotation, settings.widthInches, settings.dpi],
  );
  const heightInches = (settings.widthInches * display.h) / display.w;

  useEffect(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;

    const draw = () => {
      const c = previewRef.current;
      if (!c) return;
      // Fit the crop's aspect into the leftover box. CSS cannot bound an
      // arbitrary aspect by both axes at once, so the size is measured here —
      // the same reason PatternPanel measures its square preview.
      const boxW = wrap.clientWidth;
      const boxH = wrap.clientHeight;
      const scale = Math.min(boxW / display.w, boxH / display.h);
      const cssW = Math.floor(display.w * scale);
      const cssH = Math.floor(display.h * scale);
      c.style.display = cssW < 24 || cssH < 24 ? "none" : "block";
      if (cssW < 24 || cssH < 24) return;
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;

      const bmpScale = Math.min(1, PREVIEW_MAX_PX / Math.max(cssW, cssH)) * 2;
      // A 3x3 grid has the same aspect as one tile, so the fit above still
      // holds — only the pixel density per tile drops.
      renderCropPreview(
        c,
        painted,
        crop,
        Math.max(1, Math.round(cssW * bmpScale)),
        Math.max(1, Math.round(cssH * bmpScale)),
        bgHex,
        gridRotation,
        PREVIEW_REPEAT,
      );
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [painted, crop, bgHex, gridRotation, display.w, display.h]);

  const baseName = normalizeProjectFilename(projectName) || "trixel";

  const handlePng = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      renderCropToCanvas(canvas, painted, crop, pxW, pxH, bgHex, gridRotation);
      const blob = await canvasToPngBlob(canvas);
      if (!blob) {
        setError("Could not encode the PNG.");
        return;
      }
      // Checked on the real blob rather than estimated: flat-colour art
      // compresses far too unpredictably to guess at beforehand.
      if (blob.size > MAX_UPLOAD_BYTES) {
        setError(
          `${(blob.size / 1024 / 1024).toFixed(1)} MB exceeds the 40 MB upload limit — reduce the width.`,
        );
        return;
      }
      downloadBlob(blob, `${baseName}_${pxW}x${pxH}.png`);
    } finally {
      setBusy(false);
    }
  }, [painted, crop, pxW, pxH, bgHex, gridRotation, baseName]);

  const handleSvg = useCallback(() => {
    setError(null);
    const svg = generateCroppedSVG(painted, crop, gridRotation, {
      ...settings.svg,
      widthInches: settings.widthInches,
    });
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml" }),
      `${baseName}_crop.svg`,
    );
  }, [painted, crop, gridRotation, settings.svg, settings.widthInches, baseName]);

  const handleFit = useCallback(() => {
    const fitted = fitCropToPainted(painted);
    if (fitted) onCropChange(fitted);
  }, [painted, onCropChange]);

  const setBg = (c: string) => onSettingsChange({ bgColor: c });

  return (
    // Same shell as PatternPanel: a full-height drawer that overlays the canvas
    // rather than docking, so switching tools never reflows the artwork.
    <aside
      className="absolute z-40 top-0 right-0 bottom-0 w-96 flex flex-col bg-card/95 backdrop-blur-lg border-l border-white/10 shadow-2xl cursor-default"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour="export"
    >
      <header className="flex items-center justify-between px-3 h-9 border-b border-white/10 shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-white/70">
          Crop &amp; Export
        </span>
        <span className="text-[10px] font-mono text-white/35">
          {pxW} &times; {pxH} px
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 p-3">
        {/* The only flex child, so it absorbs leftover height and is the first
            thing to give way on a short display. */}
        <div
          ref={previewWrapRef}
          className="flex-1 min-h-[80px] flex items-center justify-center"
        >
          <canvas
            ref={previewRef}
            className="rounded-lg border border-white/10 block"
          />
        </div>

        {/* --- Crop ------------------------------------------------------ */}
        <div className="flex items-center justify-between shrink-0">
          <span className="text-[10px] uppercase tracking-wide text-white/60">
            Crop
          </span>
          <button
            onClick={handleFit}
            title="Fit crop to painted artwork"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70 text-[10px]"
          >
            <Scan className="w-3 h-3" />
            Fit to artwork
          </button>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Stepper
            label="W"
            value={crop.m}
            onChange={(m) => onCropChange({ ...crop, m })}
          />
          <Stepper
            label="H"
            value={crop.n}
            onChange={(n) => onCropChange({ ...crop, n })}
          />
          <span className="ml-auto text-[10px] font-mono text-white/35">
            {display.w.toFixed(0)} &times; {display.h.toFixed(0)}
          </span>
        </div>

        {/* --- Output ---------------------------------------------------- */}
        <div className="flex items-center justify-between shrink-0 pt-1">
          <span className="text-[10px] uppercase tracking-wide text-white/60">
            Output
          </span>
          <button
            onClick={() =>
              onSettingsChange({ dpi: SPOONFLOWER_DPI, widthInches: 24 })
            }
            title="Spoonflower wallpaper: 24 in at 150 DPI = 3600 px"
            className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70 text-[10px]"
          >
            24 in @ 150
          </button>
        </div>

        <div className="flex items-end gap-2 shrink-0">
          <NumberField
            label="Width"
            value={settings.widthInches}
            step={0.5}
            suffix="in"
            onChange={(widthInches) => onSettingsChange({ widthInches })}
          />
          <NumberField
            label="Resolution"
            value={settings.dpi}
            step={10}
            min={1}
            suffix="dpi"
            onChange={(dpi) => onSettingsChange({ dpi })}
          />
          {/* Background opens the shared colour modal rather than inlining a
              palette: the drawer's height is better spent on the preview. */}
          <div className="flex flex-col gap-0.5 shrink-0">
            <span className="text-[9px] uppercase tracking-wide text-white/45">
              Bg
            </span>
            <button
              onClick={() => setPickerOpen(true)}
              title={`Background: ${bgHex}`}
              className="w-8 h-[26px] rounded border border-white/20 hover:border-white/60 transition-colors"
              style={{ backgroundColor: bgHex }}
            />
          </div>
        </div>

        <div className="text-[10px] font-mono text-white/40 shrink-0">
          {settings.widthInches.toFixed(2)} &times; {heightInches.toFixed(2)} in
          &middot; {pxW} &times; {pxH} px
        </div>

        {/* --- Vector options -------------------------------------------- */}
        <span className="text-[10px] uppercase tracking-wide text-white/60 shrink-0 pt-1">
          SVG options
        </span>
        <label className="flex items-center gap-2 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={settings.svg.merge ?? false}
            onChange={(e) =>
              onSettingsChange({ svg: { ...settings.svg, merge: e.target.checked } })
            }
            className="rounded"
          />
          <span className="text-[10px] text-white/60">
            Merge same-colour triangles
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={settings.svg.stroke ?? false}
            onChange={(e) =>
              onSettingsChange({ svg: { ...settings.svg, stroke: e.target.checked } })
            }
            className="rounded"
          />
          <span className="text-[10px] text-white/60">
            Add 0.5pt stroke for overdraw
          </span>
        </label>

        {error && (
          <p className="text-[10px] leading-snug text-red-400 shrink-0">{error}</p>
        )}
      </div>

      <div className="flex gap-2 p-3 border-t border-white/10 shrink-0">
        <button
          onClick={handlePng}
          disabled={busy}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-40 text-[11px] text-white/90"
        >
          <Download className="w-3.5 h-3.5" />
          PNG
        </button>
        <button
          onClick={handleSvg}
          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md bg-white/10 hover:bg-white/20 text-[11px] text-white/90"
        >
          <CropIcon className="w-3.5 h-3.5" />
          SVG
        </button>
      </div>

      <ColorPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={settings.bgColor}
        onChange={setBg}
        palettes={palettes}
        title="Background colour"
      />
    </aside>
  );
}
