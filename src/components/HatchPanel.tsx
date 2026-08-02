"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveColor } from "@/lib/constants";
import { ColorPickerDialog } from "@/components/ColorPickerDialog";
import { getTriVertices } from "@/lib/grid-math";
import { drawHatchLayer } from "@/lib/hatch-render";
import {
  DIR_BIT,
  DIR_LABEL,
  HATCH_DIRS,
  MAX_DENSITY,
  MAX_WEIGHT,
  MIN_DENSITY,
  MIN_WEIGHT,
  encodeHatch,
  type HatchBrush,
  type HatchDir,
} from "@/lib/hatch";

/**
 * Designer for the hatch brush.
 *
 * Density reads as *lines per triangle*, which is what the half-step ladder in
 * `hatch.ts` buys — every trixel is crossed by exactly `density` lines in every
 * enabled direction, so the number on the slider is the number you see.
 */

/** Trixels drawn in the preview, in a rough rectangle around the origin. */
const PREVIEW_TRIS = (() => {
  const out: { q: number; r: number; type: "up" | "down" }[] = [];
  for (let r = -2; r <= 1; r++) {
    for (let q = -2; q <= 2; q++) {
      out.push({ q, r, type: "up" }, { q, r, type: "down" });
    }
  }
  return out;
})();

function SliderField({
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
    <label className="flex flex-col gap-1 shrink-0">
      <span className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-white/60">
          {label}
        </span>
        <span className="text-xs font-mono text-white/50 tabular-nums">
          {display}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 accent-white"
      />
    </label>
  );
}

/** Glyph showing the actual angle of a family, rather than a text label. */
function DirGlyph({ dir }: { dir: HatchDir }) {
  // 0 deg, 60 deg and 120 deg, matching the three lattice directions.
  const angle = dir === 0 ? 0 : dir === 1 ? 60 : 120;
  return (
    <svg viewBox="-12 -12 24 24" className="w-5 h-5">
      <g transform={`rotate(${angle})`} stroke="currentColor" strokeWidth={1.6}>
        <line x1={-10} y1={-4} x2={10} y2={-4} />
        <line x1={-10} y1={0} x2={10} y2={0} />
        <line x1={-10} y1={4} x2={10} y2={4} />
      </g>
    </svg>
  );
}

export function HatchPanel({
  brush,
  onBrushChange,
  palettes,
  onPointerEnter,
}: {
  brush: HatchBrush;
  onBrushChange: (patch: Partial<HatchBrush>) => void;
  palettes: { name: string; colors: string[] }[];
  onPointerEnter: () => void;
}) {
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const colorHex = resolveColor(brush.color);

  useEffect(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;

    const draw = () => {
      const c = previewRef.current;
      if (!c) return;
      const side = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight));
      c.style.display = side < 40 ? "none" : "block";
      if (side < 40) return;

      const dpr = window.devicePixelRatio || 1;
      c.style.width = `${side}px`;
      c.style.height = `${side}px`;
      c.width = side * dpr;
      c.height = side * dpr;

      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, side, side);

      // World box covering the preview trixels, mapped to fill the square.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const t of PREVIEW_TRIS) {
        for (const v of getTriVertices(t.q, t.r, t.type)) {
          if (v.x < minX) minX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.x > maxX) maxX = v.x;
          if (v.y > maxY) maxY = v.y;
        }
      }
      const scale = side / Math.max(maxX - minX, maxY - minY);

      ctx.save();
      ctx.scale(scale, scale);
      ctx.translate(-minX, -minY);

      // Faint lattice so the "lines per triangle" reading is visible.
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (const t of PREVIEW_TRIS) {
        const [a, b, cc] = getTriVertices(t.q, t.r, t.type);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(cc.x, cc.y);
        ctx.closePath();
      }
      ctx.stroke();

      // Exactly the renderer the canvas and the exporters use, so the preview
      // cannot drift from what the brush actually lays down.
      const v = encodeHatch(brush);
      const marks: Record<string, string> = {};
      for (const t of PREVIEW_TRIS) marks[`${t.q},${t.r},${t.type}`] = v;
      drawHatchLayer(ctx, marks, undefined, scale);

      ctx.restore();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [brush]);

  const toggleDir = (dir: HatchDir) => {
    const next = brush.dirMask ^ DIR_BIT[dir];
    // At least one direction must stay on, or the brush paints nothing.
    if (next === 0) return;
    onBrushChange({ dirMask: next });
  };

  return (
    // Same shell as the pattern and export drawers.
    <aside
      className="absolute z-40 top-0 right-0 bottom-0 w-96 flex flex-col bg-card/95 backdrop-blur-lg border-l border-white/10 shadow-2xl cursor-default"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour="hatch"
    >
      <header className="flex items-center justify-between px-4 h-11 border-b border-white/10 shrink-0">
        <span className="text-xs uppercase tracking-widest text-white/70">
          Hatch
        </span>
        <span className="text-xs font-mono text-white/40 tabular-nums">
          {brush.density} / triangle
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-4">
        <div
          ref={previewWrapRef}
          className="flex-1 min-h-[80px] flex items-center justify-center"
        >
          <canvas
            ref={previewRef}
            className="rounded-lg border border-white/10 block"
          />
        </div>

        <span className="text-xs uppercase tracking-wide text-white/60 shrink-0">
          Direction
        </span>
        <div className="grid grid-cols-3 gap-1.5 shrink-0">
          {HATCH_DIRS.map((dir) => {
            const on = (brush.dirMask & DIR_BIT[dir]) !== 0;
            return (
              <button
                key={dir}
                onClick={() => toggleDir(dir)}
                title={`${DIR_LABEL[dir]} — click to toggle; enable two or three to cross-hatch`}
                className={cn(
                  "flex items-center justify-center py-2 rounded-md border transition-colors",
                  on
                    ? "border-white bg-white/15 text-white"
                    : "border-white/10 text-white/45 hover:bg-white/5",
                )}
              >
                <DirGlyph dir={dir} />
              </button>
            );
          })}
        </div>

        <SliderField
          label="Density"
          value={brush.density}
          min={MIN_DENSITY}
          max={MAX_DENSITY}
          step={1}
          display={`${brush.density} line${brush.density === 1 ? "" : "s"}`}
          onChange={(density) => onBrushChange({ density })}
        />

        <SliderField
          label="Weight"
          value={brush.weight}
          min={MIN_WEIGHT}
          max={MAX_WEIGHT}
          step={0.25}
          display={brush.weight.toFixed(2)}
          onChange={(weight) => onBrushChange({ weight })}
        />

        <div className="flex items-center justify-between shrink-0">
          <span className="text-xs uppercase tracking-wide text-white/60">
            Colour
          </span>
          <button
            onClick={() => setPickerOpen(true)}
            title={`Hatch colour: ${colorHex}`}
            className="w-11 h-[38px] rounded-md border border-white/20 hover:border-white/60 transition-colors"
            style={{ backgroundColor: colorHex }}
          />
        </div>
      </div>

      <ColorPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={brush.color}
        onChange={(color) => onBrushChange({ color })}
        palettes={palettes}
        title="Hatch colour"
      />
    </aside>
  );
}
