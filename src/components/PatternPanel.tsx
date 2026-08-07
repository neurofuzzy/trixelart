"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelShell } from "@/components/PanelShell";
import { encodeColor, resolveColor } from "@/lib/constants";
import {
  PATTERN_BLEND_MODES,
  makePatternLayer,
  makePatternPainter,
  triPatternValue,
  type PatternLayer,
  type PatternBlendMode,
  type QuantizeTarget,
} from "@/lib/tri-pattern";
import { nearestCoincidence, snapRotation } from "@/lib/eisenstein";
import {
  PREVIEW_SPAN,
  PREVIEW_TRIS,
  THUMB_SPAN,
  THUMB_TRIS,
  paintPatternCanvas,
} from "@/lib/pattern-render";

/**
 * Designer for the pattern brush stack.
 *
 * The preview deliberately covers a wide patch. What is being designed here is
 * interference — between the pattern lattice and the trixel lattice, and then
 * between stacked layers — and a small swatch shows neither.
 */


const MODE_LABEL: Record<PatternBlendMode, string> = {
  normal: "Normal",
  multiply: "Multiply",
  screen: "Screen",
  difference: "Diff",
};

/** Label above a slider, value right-aligned in mono so it stops jittering as
 *  the thumb moves. */
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

/** Treat a fit this tight as exact. Landing on a landmark leaves an error of
 *  order 1e-6 from the double arithmetic alone, so the test cannot be `=== 0`;
 *  a couple of orders of margin above that is still far finer than the sliders
 *  can express. */
const LOCKED_EPS = 2e-5;

/**
 * Names the exactly-repeating setting nearest to the current one, and offers to
 * jump to it.
 *
 * Deliberately a readout with one button rather than a ladder of presets. The
 * repeating settings are dense — between any two there are more — so a
 * catalogue would be arbitrary, and the panel is height-constrained enough that
 * the preview is the first thing to give way (see docs/pattern-brush.md). This
 * costs two lines and answers the only question the sliders cannot: *is what I
 * am looking at going to tile, or is it drifting?*
 *
 * Snapping stays opt-in. Quantizing rotation to the lattice was tried and
 * reverted because it puts the whole emergent family out of reach — so this
 * offers the landmark and never moves the sliders on its own.
 */
function RepeatRow({
  scale,
  rotation,
  onLock,
}: {
  scale: number;
  rotation: number;
  onLock: (scale: number, rotation: number) => void;
}) {
  const fit = useMemo(
    () => nearestCoincidence(scale, rotation),
    [scale, rotation],
  );
  if (!fit) return null;

  const locked = fit.epsilon < LOCKED_EPS;
  const cell = fit.near.period.toFixed(2);
  // How many times the motif repeats before the drift adds up to a whole cell.
  const holds = 1 / fit.epsilon;

  return (
    <div className="flex flex-col gap-1 shrink-0">
      <span className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-white/60">
          Repeat
        </span>
        <span className="text-xs font-mono text-white/50 tabular-nums">
          {locked
            ? `${cell} cells · exact`
            : `${cell} cells · holds ${holds >= 1000 ? `${Math.round(holds / 1000)}k` : Math.round(holds)}×`}
        </span>
      </span>
      <button
        onClick={() =>
          onLock(fit.near.scale, snapRotation(fit.near.rotation, rotation))
        }
        disabled={locked}
        title={
          locked
            ? "This pattern tiles exactly"
            : `Snap to ×${fit.near.scale.toFixed(3)} / ${snapRotation(fit.near.rotation, rotation).toFixed(2)}°`
        }
        className={cn(
          "text-xs py-1.5 rounded-md border transition-colors",
          locked
            ? "border-white/10 text-white/30 cursor-default"
            : "border-white/10 text-white/60 hover:bg-white/5",
        )}
      >
        {locked ? "Tiles exactly" : "Lock to nearest"}
      </button>
    </div>
  );
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
    paintPatternCanvas(c, THUMB_SPAN, THUMB_TRIS, (t) =>
      triPatternValue(t, layer) ? fg : bg,
    );
  }, [layer, fg, bg]);

  return <canvas ref={ref} className="w-9 h-9 rounded shrink-0 block" />;
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
  return (
    <div className="flex gap-0.5">
      {palette.map((c, i) => {
        const encoded = encodeColor(paletteIdx, i);
        return (
          <button
            key={c}
            onClick={() => onChange(encoded)}
            title={c}
            className={cn(
              "flex-1 h-7 rounded border transition-all",
              // Compared by encoding, not by resolved hex: separate palettes can
              // land on the same colour and would both light up.
              value === encoded
                ? "border-white scale-110"
                : "border-white/10 opacity-70",
            )}
            style={{ backgroundColor: c }}
          />
        );
      })}
    </div>
  );
}

/**
 * Palette chooser for the panel's swatch rows.
 *
 * Independent of the left-hand paint palette on purpose: a pattern layer's two
 * colours have nothing to do with the colour the paint tool is holding, and
 * tying them meant switching palette to paint changed what the pattern offered.
 */
function PaletteChips({
  palettes,
  value,
  onChange,
}: {
  palettes: { name: string; colors: string[] }[];
  value: number;
  onChange: (i: number) => void;
}) {
  return (
    // The chips flex rather than take a fixed width: fourteen of them have to
    // share the drawer's inner width on one line, so they are as tall as they
    // can be but only as wide as the division allows.
    <div className="flex gap-0.5 flex-nowrap">
      {palettes.map((p, i) => (
        <button
          key={p.name}
          onClick={() => onChange(i)}
          title={p.name}
          className={cn(
            "flex-1 min-w-0 h-6 rounded border overflow-hidden flex flex-col transition-all",
            value === i ? "border-white scale-110" : "border-white/10 opacity-70",
          )}
        >
          {[2, 5, 8].map((ci) => (
            <span
              key={ci}
              className="flex-1 block"
              style={{ backgroundColor: p.colors[ci] }}
            />
          ))}
        </button>
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
  palettes,
  paletteIdx,
  onPaletteIdxChange,
  onClose,
  onPointerEnter,
}: {
  layers: PatternLayer[];
  onLayersChange: (l: PatternLayer[]) => void;
  activeIdx: number;
  onActiveIdxChange: (i: number) => void;
  quantizeTargets: QuantizeTarget[];
  palettes: { name: string; colors: string[] }[];
  paletteIdx: number;
  onPaletteIdxChange: (i: number) => void;
  onClose: () => void;
  onPointerEnter: () => void;
}) {
  const palette = palettes[paletteIdx]?.colors ?? palettes[0].colors;
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<"pattern" | "color">("pattern");

  // The composited, palette-quantized result — exactly what the brush paints.
  const painter = useMemo(
    () => makePatternPainter(layers, quantizeTargets),
    [layers, quantizeTargets],
  );

  useEffect(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;

    const draw = () => {
      const c = previewRef.current;
      if (!c) return;
      // Fit a square into the leftover box. CSS cannot express "square, bounded
      // by both axes" — aspect-ratio plus a max on one axis just breaks the
      // ratio — so the side is measured and applied directly.
      const side = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight));
      // Below this it conveys nothing, so give the space to the controls.
      c.style.display = side < 40 ? "none" : "block";
      if (side < 40) return;
      c.style.width = `${side}px`;
      c.style.height = `${side}px`;
      paintPatternCanvas(c, PREVIEW_SPAN, PREVIEW_TRIS, (t) => resolveColor(painter(t)));
    };

    draw();
    // Covers window resizes and layout shifts alike — adding a layer changes
    // how much room is left, and that fires no resize event.
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
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
    <PanelShell
      title="Pattern"
      tour="pattern"
      trailing={
        <span className="text-xs text-white/40 mr-1">
          {layers.length} layer{layers.length === 1 ? "" : "s"}
        </span>
      }
      onClose={onClose}
      onPointerEnter={onPointerEnter}
    >
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-4">
      {/* The preview is the only child allowed to flex, so it absorbs whatever
          height the controls leave over and is the first thing to give way on a
          short display. Everything below it is shrink-0 and stays on screen.
          A vh cap cannot do this: the controls below are a fixed pixel height,
          so the space left for the preview is not a fraction of the viewport. */}
      <div
        ref={previewWrapRef}
        className="flex-1 min-h-0 flex items-center justify-center"
      >
        <canvas
          ref={previewRef}
          className="rounded-lg border border-white/10 block"
        />
      </div>

      {/* Stack, top layer first — the reverse of storage order, matching how
          every other layer list in the app reads. */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-xs uppercase tracking-wide text-white/60">
          Layers
        </span>
        <button
          onClick={addLayer}
          title="Add pattern layer"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/10 text-white/70 text-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      <div className="flex flex-col gap-1.5 max-h-[26vh] overflow-y-auto shrink-0">
        {layers
          .map((l, i) => ({ l, i }))
          .reverse()
          .map(({ l, i }) => (
            <div
              key={l.id}
              onClick={() => onActiveIdxChange(i)}
              className={cn(
                "flex items-center gap-2 p-1.5 rounded-md border cursor-pointer",
                i === activeIdx
                  ? "border-white/60 bg-white/10"
                  : "border-white/10 hover:bg-white/5",
              )}
            >
              <LayerThumb layer={l} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white/85 truncate">
                  {MODE_LABEL[l.mode]} · {Math.round(l.opacity * 100)}%
                </div>
                <div className="text-[11px] font-mono text-white/40 truncate tabular-nums">
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
                className="p-1.5 rounded hover:bg-white/10 text-white/60"
              >
                {l.visible ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </button>
              <div className="flex flex-col">
                <button
                  onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                  title="Move up"
                  className="px-1 rounded hover:bg-white/10 text-white/50"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                  title="Move down"
                  className="px-1 rounded hover:bg-white/10 text-white/50"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeLayer(i); }}
                title="Delete layer"
                disabled={layers.length <= 1}
                className="p-1.5 rounded hover:bg-white/10 text-white/50 disabled:opacity-20"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
      </div>

      <div className="h-px bg-white/10 shrink-0" />

      {/* Tabbed so each half stays short: the preview takes whatever the
          controls leave over, so fewer controls on screen means a bigger
          preview and a drawer that fits on shorter displays. */}
      <div className="grid grid-cols-2 gap-1.5 shrink-0">
        {(["pattern", "color"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "text-xs uppercase tracking-widest py-1.5 rounded-md border transition-colors",
              tab === t
                ? "border-white bg-white/15 text-white"
                : "border-white/10 text-white/50 hover:bg-white/5",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "pattern" ? (
        <>
          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-xs uppercase tracking-wide text-white/60">
              Blend
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {PATTERN_BLEND_MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => update({ mode: m })}
                  title={m}
                  className={cn(
                    "text-xs py-1.5 rounded-md border transition-colors",
                    active.mode === m
                      ? "border-white bg-white/15 text-white"
                      : "border-white/10 text-white/60 hover:bg-white/5",
                  )}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Above 1 the pattern lattice is finer than the grid, which is where
              the emergent motifs live — so the range runs well past it. */}
          <SliderField
            label="Scale"
            value={active.scale}
            min={0.1}
            max={6}
            step={0.01}
            display={active.scale.toFixed(2)}
            onChange={(scale) => update({ scale })}
          />

          {/* Continuous on purpose: snapping to the lattice's 6-fold symmetry
              would remove every pattern that depends on being off-axis. The
              landmarks live in `RepeatRow` below, as an offer rather than a
              constraint. Two decimals because a locked angle is rarely a round
              number — 44.82° displayed as 45° would contradict the readout. */}
          <SliderField
            label="Rotation"
            value={active.rotation}
            min={0}
            max={360}
            step={0.01}
            display={`${active.rotation.toFixed(2)}°`}
            onChange={(rotation) => update({ rotation })}
          />

          <RepeatRow
            scale={active.scale}
            rotation={active.rotation}
            onLock={(scale, rotation) => update({ scale, rotation })}
          />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-xs uppercase tracking-wide text-white/60">
              Palette
            </span>
            {/* Keeps its own row: inlining the label would squeeze the chips
                back onto a second line. */}
            <PaletteChips
              palettes={palettes}
              value={paletteIdx}
              onChange={onPaletteIdxChange}
            />
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-xs uppercase tracking-wide text-white/60">
              Primary
            </span>
            <Swatches
              value={active.fg}
              palette={palette}
              paletteIdx={paletteIdx}
              onChange={(c) => update({ fg: c })}
            />
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-xs uppercase tracking-wide text-white/60">
              Secondary
            </span>
            <Swatches
              value={active.bg}
              palette={palette}
              paletteIdx={paletteIdx}
              onChange={(c) => update({ bg: c })}
            />
          </div>

          <SliderField
            label="Opacity"
            value={active.opacity}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(active.opacity * 100)}%`}
            onChange={(opacity) => update({ opacity })}
          />
        </>
      )}

      </div>
    </PanelShell>
  );
}
