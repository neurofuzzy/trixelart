"use client";

import { useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIDE, getTriVertices } from "@/lib/grid-math";
import { encodeColor, resolveColor } from "@/lib/constants";
import {
  TRI_PATTERN_TYPES,
  PATTERN_BLEND_MODES,
  makePatternLayer,
  makePatternPainter,
  triPatternValue,
  trixelsInBox,
  type PatternLayer,
  type PatternBlendMode,
  type QuantizeTarget,
  type TriPatternType,
} from "@/lib/tri-pattern";

/**
 * Designer for the pattern brush stack.
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
// distinguished centre — `rings` anchors at the origin — otherwise put it in
// the corner, so the preview showed only far-field structure.
const PREVIEW_TRIS = trixelsInBox(
  -PREVIEW_HALF,
  -PREVIEW_HALF,
  PREVIEW_HALF,
  PREVIEW_HALF,
);

// A single layer's thumbnail needs far fewer cells than the stack preview.
const THUMB_SPAN = 5 * SIDE;
const THUMB_HALF = THUMB_SPAN / 2;
const THUMB_TRIS = trixelsInBox(-THUMB_HALF, -THUMB_HALF, THUMB_HALF, THUMB_HALF);

const TYPE_LABEL: Record<TriPatternType, string> = {
  checker: "Check",
  grid: "Grid",
  brick: "Brick",
  lines: "Lines",
  rings: "Rings",
};

const MODE_LABEL: Record<PatternBlendMode, string> = {
  normal: "Norm",
  multiply: "Mult",
  screen: "Scrn",
  difference: "Diff",
};

/** Fills `tris` on a square canvas, world origin at centre. */
function paintCanvas(
  canvas: HTMLCanvasElement,
  span: number,
  tris: typeof PREVIEW_TRIS,
  colorOf: (t: (typeof PREVIEW_TRIS)[number]) => string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const css = canvas.clientWidth || 200;
  canvas.width = css * dpr;
  canvas.height = css * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);

  ctx.save();
  ctx.scale(css / span, css / span);
  ctx.translate(span / 2, span / 2);

  // Batch by colour so each distinct colour costs one fill, not one per trixel.
  const byColor = new Map<string, typeof tris>();
  for (const t of tris) {
    const c = colorOf(t);
    const list = byColor.get(c);
    if (list) list.push(t);
    else byColor.set(c, [t]);
  }
  for (const [color, list] of byColor) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const t of list) {
      const [a, b, c] = getTriVertices(t.q, t.r, t.type);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
}

function LayerThumb({ layer }: { layer: PatternLayer }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const fg = resolveColor(layer.fg);
  const bg = resolveColor(layer.bg);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // The thumbnail shows the layer alone, unblended and unquantized — it is
    // there to identify the layer, not to predict the composite.
    paintCanvas(c, THUMB_SPAN, THUMB_TRIS, (t) =>
      triPatternValue(t, layer) ? fg : bg,
    );
  }, [layer, fg, bg]);

  return <canvas ref={ref} className="w-7 h-7 rounded shrink-0 block" />;
}

function Swatches({
  value,
  palette,
  paletteIdx,
  onChange,
}: {
  value: string;
  palette: string[];
  paletteIdx: number;
  onChange: (encoded: string) => void;
}) {
  const resolved = resolveColor(value);
  return (
    <div className="flex gap-0.5">
      {palette.map((c, i) => (
        <button
          key={c}
          onClick={() => onChange(encodeColor(paletteIdx, i))}
          className={cn(
            "flex-1 h-4 rounded-sm border transition-all",
            resolved === c ? "border-white scale-110" : "border-white/10 opacity-70",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

export function PatternPanel({
  layers,
  onLayersChange,
  activeIdx,
  onActiveIdxChange,
  quantizeTargets,
  palette,
  activePaletteIdx,
  onPointerEnter,
}: {
  layers: PatternLayer[];
  onLayersChange: (l: PatternLayer[]) => void;
  activeIdx: number;
  onActiveIdxChange: (i: number) => void;
  quantizeTargets: QuantizeTarget[];
  palette: string[];
  activePaletteIdx: number;
  onPointerEnter: () => void;
}) {
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  // The composited, palette-quantized result — exactly what the brush paints.
  const painter = useMemo(
    () => makePatternPainter(layers, quantizeTargets),
    [layers, quantizeTargets],
  );

  useEffect(() => {
    const c = previewRef.current;
    if (!c) return;
    paintCanvas(c, PREVIEW_SPAN, PREVIEW_TRIS, (t) => resolveColor(painter(t)));
  }, [painter]);

  const active = layers[activeIdx] ?? layers[0];

  const update = (patch: Partial<PatternLayer>) => {
    onLayersChange(
      layers.map((l, i) => (i === activeIdx ? { ...l, ...patch } : l)),
    );
  };

  const addLayer = () => {
    // New layers go on top and default to multiply — stacking normal over
    // normal just hides the layer below, which looks broken.
    const next = [...layers, makePatternLayer({ mode: "multiply" })];
    onLayersChange(next);
    onActiveIdxChange(next.length - 1);
  };

  const removeLayer = (i: number) => {
    if (layers.length <= 1) return;
    onLayersChange(layers.filter((_, n) => n !== i));
    onActiveIdxChange(Math.max(0, Math.min(activeIdx, layers.length - 2)));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= layers.length) return;
    const next = [...layers];
    [next[i], next[j]] = [next[j], next[i]];
    onLayersChange(next);
    onActiveIdxChange(j);
  };

  return (
    <div
      className="absolute z-40 flex flex-col gap-2 p-3 w-64 max-h-[80vh] overflow-y-auto bg-card/80 backdrop-blur-lg border rounded-2xl shadow-2xl cursor-default
        top-20 right-4"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour="pattern"
    >
      <canvas
        ref={previewRef}
        className="w-full aspect-square rounded-lg border border-white/10 block"
      />

      {/* Stack, top layer first — the reverse of storage order, matching how
          every other layer list in the app reads. */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Layers
        </span>
        <button
          onClick={addLayer}
          title="Add pattern layer"
          className="p-1 rounded hover:bg-white/10 text-white/70"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {layers
          .map((l, i) => ({ l, i }))
          .reverse()
          .map(({ l, i }) => (
            <div
              key={l.id}
              onClick={() => onActiveIdxChange(i)}
              className={cn(
                "flex items-center gap-1.5 p-1 rounded border cursor-pointer",
                i === activeIdx
                  ? "border-white/60 bg-white/10"
                  : "border-white/10 hover:bg-white/5",
              )}
            >
              <LayerThumb layer={l} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-white/80 truncate">
                  {TYPE_LABEL[l.type]} · {MODE_LABEL[l.mode]}
                </div>
                <div className="text-[9px] text-white/40 truncate">
                  {l.scale.toFixed(2)} · {Math.round(l.rotation)}&deg;
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onLayersChange(
                    layers.map((x, n) =>
                      n === i ? { ...x, visible: !x.visible } : x,
                    ),
                  );
                }}
                title={l.visible ? "Hide" : "Show"}
                className="p-0.5 rounded hover:bg-white/10 text-white/60"
              >
                {l.visible ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3" />
                )}
              </button>
              <div className="flex flex-col">
                <button
                  onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                  title="Move up"
                  className="p-0 rounded hover:bg-white/10 text-white/50"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                  title="Move down"
                  className="p-0 rounded hover:bg-white/10 text-white/50"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeLayer(i); }}
                title="Delete layer"
                disabled={layers.length <= 1}
                className="p-0.5 rounded hover:bg-white/10 text-white/50 disabled:opacity-20"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
      </div>

      <div className="h-px bg-white/10" />

      {/* Editor for the selected layer */}
      <div className="grid grid-cols-3 gap-1">
        {TRI_PATTERN_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => update({ type: t })}
            className={cn(
              "text-[10px] uppercase tracking-wide py-1 rounded border transition-colors",
              active.type === t
                ? "border-white bg-white/15 text-white"
                : "border-white/10 text-white/60 hover:bg-white/5",
            )}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-1">
        {PATTERN_BLEND_MODES.map((m) => (
          <button
            key={m}
            onClick={() => update({ mode: m })}
            title={m}
            className={cn(
              "text-[10px] uppercase tracking-wide py-1 rounded border transition-colors",
              active.mode === m
                ? "border-white bg-white/15 text-white"
                : "border-white/10 text-white/60 hover:bg-white/5",
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Scale {active.scale.toFixed(2)}
        </span>
        {/* Above 1 the pattern lattice is finer than the grid, which is where
            the emergent motifs live — so the range runs well past it. */}
        <input
          type="range"
          min={0.1}
          max={6}
          step={0.01}
          value={active.scale}
          onChange={(e) => update({ scale: Number(e.target.value) })}
          className="w-full accent-white"
        />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Rotation {Math.round(active.rotation)}&deg;
        </span>
        {/* Continuous on purpose: snapping to the lattice's 6-fold symmetry
            would remove every pattern that depends on being off-axis. */}
        <input
          type="range"
          min={0}
          max={360}
          step={0.1}
          value={active.rotation}
          onChange={(e) => update({ rotation: Number(e.target.value) })}
          className="w-full accent-white"
        />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Opacity {Math.round(active.opacity * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={active.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
          className="w-full accent-white"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Primary
        </span>
        <Swatches
          value={active.fg}
          palette={palette}
          paletteIdx={activePaletteIdx}
          onChange={(c) => update({ fg: c })}
        />
        <span className="text-[10px] uppercase tracking-wide text-white/60">
          Secondary
        </span>
        <Swatches
          value={active.bg}
          palette={palette}
          paletteIdx={activePaletteIdx}
          onChange={(c) => update({ bg: c })}
        />
      </div>
    </div>
  );
}
