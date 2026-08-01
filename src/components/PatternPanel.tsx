"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { SIDE, getTriVertices } from "@/lib/grid-math";
import { encodeColor, resolveColor } from "@/lib/constants";
import {
  TRI_PATTERN_TYPES,
  triPatternValue,
  trixelsInBox,
  type TriPattern,
  type TriPatternType,
} from "@/lib/tri-pattern";

/**
 * Designer for the pattern brush.
 *
 * The preview deliberately covers a wide patch. The patterns worth finding are
 * emergent — they come from the pattern lattice beating against the trixel
 * lattice — and a small swatch shows the predicate but not the interference,
 * which is the part actually being designed.
 */

// ~28 trixels across. Enough for the moire to resolve.
const PREVIEW_SPAN = 14 * SIDE;
const PREVIEW_HALF = PREVIEW_SPAN / 2;

// Centred on the lattice origin rather than starting there. Patterns with a
// distinguished centre — `rings` anchors near the origin — otherwise put it in
// the corner, so the preview showed only far-field structure.
const PREVIEW_TRIS = trixelsInBox(
  -PREVIEW_HALF,
  -PREVIEW_HALF,
  PREVIEW_HALF,
  PREVIEW_HALF,
);

const TYPE_LABEL: Record<TriPatternType, string> = {
  checker: "Checker",
  grid: "Grid",
  brick: "Brick",
  lines: "Lines",
  rings: "Rings",
};

export function PatternPanel({
  pattern,
  onPatternChange,
  primary,
  secondary,
  onSecondaryChange,
  palette,
  activePaletteIdx,
  onPointerEnter,
}: {
  pattern: TriPattern;
  onPatternChange: (p: TriPattern) => void;
  primary: string;
  secondary: string;
  onSecondaryChange: (c: string) => void;
  palette: string[];
  activePaletteIdx: number;
  onPointerEnter: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const fg = useMemo(() => resolveColor(primary), [primary]);
  const bg = useMemo(() => resolveColor(secondary), [secondary]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const css = canvas.clientWidth || 200;
    canvas.width = css * dpr;
    canvas.height = css * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);

    const s = css / PREVIEW_SPAN;
    ctx.save();
    ctx.scale(s, s);
    // World (0,0) lands at the centre of the canvas.
    ctx.translate(PREVIEW_HALF, PREVIEW_HALF);

    // Batch by colour: two fills instead of one path per trixel.
    for (const value of [0, 1] as const) {
      ctx.fillStyle = value ? fg : bg;
      ctx.beginPath();
      for (const t of PREVIEW_TRIS) {
        if (triPatternValue(t, pattern) !== value) continue;
        const [a, b, c] = getTriVertices(t.q, t.r, t.type);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.restore();
  }, [pattern, fg, bg]);

  const set = (patch: Partial<TriPattern>) =>
    onPatternChange({ ...pattern, ...patch });

  return (
    <div
      className="absolute z-40 flex flex-col gap-3 p-3 w-56 bg-card/80 backdrop-blur-lg border rounded-2xl shadow-2xl cursor-default
        top-20 right-4"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour="pattern"
    >
      <canvas
        ref={canvasRef}
        className="w-full aspect-square rounded-lg border border-white/10 block"
      />

      <div className="grid grid-cols-3 gap-1">
        {TRI_PATTERN_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => set({ type: t })}
            className={cn(
              "text-[10px] uppercase tracking-wide py-1 rounded border transition-colors",
              pattern.type === t
                ? "border-white bg-white/15 text-white"
                : "border-white/10 text-white/60 hover:bg-white/5",
            )}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Scale {pattern.scale.toFixed(2)}
        </span>
        {/* Above 1 the pattern lattice is finer than the grid, which is where
            the emergent motifs live — so the range runs well past it. */}
        <input
          type="range"
          min={0.1}
          max={6}
          step={0.01}
          value={pattern.scale}
          onChange={(e) => set({ scale: Number(e.target.value) })}
          className="w-full accent-white"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Rotation {Math.round(pattern.rotation)}&deg;
        </span>
        {/* Continuous on purpose: snapping to the lattice's 6-fold symmetry
            would remove every pattern that depends on being off-axis. */}
        <input
          type="range"
          min={0}
          max={360}
          step={0.1}
          value={pattern.rotation}
          onChange={(e) => set({ rotation: Number(e.target.value) })}
          className="w-full accent-white"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Secondary
        </span>
        <div className="flex gap-1">
          {palette.map((c, i) => {
            const encoded = encodeColor(activePaletteIdx, i);
            return (
              <button
                key={c}
                onClick={() => onSecondaryChange(encoded)}
                title={`Secondary color ${i + 1}`}
                className={cn(
                  "flex-1 h-5 rounded border transition-all",
                  bg === c ? "border-white scale-110" : "border-white/10 opacity-70",
                )}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
