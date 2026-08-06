"use client";

import {
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  Copy,
  Square,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { encodeColor, resolveColor } from "@/lib/constants";
import { ColorPickerDialog } from "@/components/ColorPickerDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { HatchGlyph } from "@/components/HatchBar";
import { PanelShell } from "@/components/PanelShell";
import {
  layerEffects,
  layerKind,
  type Layer,
  type LayerEffect,
  type LayerKind,
} from "@/hooks/use-history";

/** A rounded-off square: the corner-rounding effect's glyph. */
function RoundCornersGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className ?? "w-3.5 h-3.5"}>
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** An outlined square: the outline effect's glyph. */
function OutlineGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className ?? "w-3.5 h-3.5"}>
      <rect
        x="3"
        y="3"
        width="10"
        height="10"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** A square with a soft halo: the glow effect's glyph. */
function GlowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className ?? "w-3.5 h-3.5"}>
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <rect x="4.5" y="4.5" width="7" height="7" fill="currentColor" />
    </svg>
  );
}

/** A half-filled circle: the colour-adjust effect's glyph. */
function AdjustColorGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className ?? "w-3.5 h-3.5"}>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </svg>
  );
}

/** A triangle split into four, two of them shaded: the subdivision-noise glyph. */
function SubdivisionNoiseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className ?? "w-3.5 h-3.5"}>
      <path d="M8 2.5 11 8H5z" fill="currentColor" opacity="0.9" />
      <path d="M5 8 8 13.5H2z" fill="currentColor" opacity="0.35" />
      <path
        d="M8 2.5 13.5 13.5H2.5z M5 8h6 M5 8 8 13.5 11 8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const DEFAULT_ROUND_RADIUS = 0.5;
const DEFAULT_OUTLINE_WEIGHT = 0.15;
const DEFAULT_GLOW_RADIUS = 0.3;
const DEFAULT_GLOW_OPACITY = 0.55;
/** The darkest grayscale swatch — a shadow by default, not a coloured glow. */
const DEFAULT_GLOW_COLOR = encodeColor(0, 0);
/** Enough grain to be unmistakable when the effect is added, without burying
 *  the colour it was painted in. */
const DEFAULT_NOISE_AMOUNT = 50;
const DEFAULT_NOISE_SEED = 0;

const EFFECT_LABEL: Record<LayerEffect["type"], string> = {
  roundCorners: "Round corners",
  outline: "Outline",
  glow: "Glow",
  adjustColor: "Adjust colour",
  subdivisionNoise: "Subdivision noise",
};

/**
 * Which numeric fields each effect exposes, in the order they are shown. Keeps
 * the row markup one loop rather than a branch per effect type.
 *
 * The geometry effects are all 0–1 fractions shown as a percentage, so their
 * range is the default; colour adjust is signed −100…100 in its own units and
 * carries its own, which is why the shape has a range at all.
 */
interface EffectSlider {
  key: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Multiplier from stored value to displayed number. */
  scale?: number;
  unit?: string;
}

const EFFECT_SLIDERS: Record<LayerEffect["type"], EffectSlider[]> = {
  roundCorners: [{ key: "radius", label: "Radius" }],
  outline: [{ key: "weight", label: "Weight" }],
  glow: [
    { key: "radius", label: "Radius" },
    { key: "opacity", label: "Opacity" },
  ],
  adjustColor: [
    { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1, scale: 1, unit: "" },
    { key: "hue", label: "Hue", min: -100, max: 100, step: 1, scale: 1, unit: "" },
    { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, scale: 1, unit: "" },
  ],
  subdivisionNoise: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1, scale: 1, unit: "" },
    { key: "seed", label: "Seed", min: 0, max: 99, step: 1, scale: 1, unit: "" },
  ],
};

function EffectGlyph({
  type,
  className,
}: {
  type: LayerEffect["type"];
  className?: string;
}) {
  if (type === "roundCorners") return <RoundCornersGlyph className={className} />;
  if (type === "outline") return <OutlineGlyph className={className} />;
  if (type === "adjustColor") return <AdjustColorGlyph className={className} />;
  if (type === "subdivisionNoise")
    return <SubdivisionNoiseGlyph className={className} />;
  return <GlowGlyph className={className} />;
}

export function LayerPanel({
  layers,
  activeLayerIdx,
  onSelectLayer,
  onAddLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onToggleVisibility,
  onSetLayerEffects,
  onMoveLayer,
  onCommit,
  onClose,
  onPointerEnter,
  palettes,
}: {
  layers: Layer[];
  activeLayerIdx: number;
  onSelectLayer: (idx: number) => void;
  onAddLayer: (kind?: LayerKind) => void;
  onDeleteLayer: (idx: number) => void;
  onDuplicateLayer: (idx: number) => void;
  onToggleVisibility: (idx: number) => void;
  onSetLayerEffects: (idx: number, effects: LayerEffect[]) => void;
  onMoveLayer: (idx: number, dir: -1 | 1) => void;
  onCommit: () => void;
  onClose: () => void;
  onPointerEnter: () => void;
  palettes: { name: string; colors: string[] }[];
}) {
  const canAdd = layers.length < 5;
  /** Index of the effect whose colour is being picked, or `null`. */
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);

  /**
   * Every layer edit goes through here.
   *
   * `Layer` is part of `ProjectSnapshot`, so an uncommitted change to one is
   * worse than merely not being undoable: the *next* commit captures it, and
   * undoing that later edit then rolls this one back too, as an invisible side
   * effect. Visibility and reorder used to do exactly that — hide a layer, paint
   * a stroke, undo the stroke, and the layer came back.
   */
  const commit = (fn: () => void) => {
    fn();
    onCommit();
  };

  const activeLayer = layers[activeLayerIdx];
  // Hatch is line work with no filled region to bound, so it has no geometry for
  // this to reshape — the section is simply absent there.
  const showEffects = activeLayer && layerKind(activeLayer) === "fill";
  const effects = activeLayer ? layerEffects(activeLayer) : [];
  const hasRound = effects.some((e) => e.type === "roundCorners");
  const hasOutline = effects.some((e) => e.type === "outline");
  const hasGlow = effects.some((e) => e.type === "glow");
  const hasAdjust = effects.some((e) => e.type === "adjustColor");
  const hasNoise = effects.some((e) => e.type === "subdivisionNoise");
  const allAdded =
    hasRound && hasOutline && hasGlow && hasAdjust && hasNoise;

  // A glow is clipped to the solid cells beneath it, so on the bottom layer it
  // renders nothing at all. That is correct, but it looks like a broken slider
  // unless the panel says so — `layers[0]` is the bottom of the stack.
  const hasSurfaceBelow = layers
    .slice(0, activeLayerIdx)
    .some(
      (l) =>
        l.visible &&
        layerKind(l) === "fill" &&
        Object.keys(l.painted).length > 0,
    );

  const patchEffect = (i: number, patch: Record<string, unknown>) => {
    const next = effects.map((e, j) =>
      // Call sites only spread fields belonging to that effect's own type — the
      // slider keys come from `EFFECT_SLIDERS[effect.type]` and the colour from
      // the glow branch — so the cast is safe.
      j === i ? ({ ...e, ...patch } as LayerEffect) : e,
    );
    onSetLayerEffects(activeLayerIdx, next);
  };

  return (
    <PanelShell
      title="Layers"
      tour="layers-panel"
      trailing={
        /* Adding a layer is a structural edit, so it goes through `commit`
           and lands in the undo stack like duplicate and delete do. */
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex items-center justify-center h-6 w-6 rounded text-white/50 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30"
              disabled={!canAdd}
              title={canAdd ? "Add layer" : "Layer limit reached"}
            >
              <Plus className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6}>
            <DropdownMenuItem onClick={() => commit(() => onAddLayer("fill"))}>
              <Square className="w-3.5 h-3.5 opacity-50" />
              Normal layer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => commit(() => onAddLayer("hatch"))}>
              <HatchGlyph className="w-3.5 h-3.5 text-amber-400/80" />
              Hatch layer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      onClose={onClose}
      onPointerEnter={onPointerEnter}
    >
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1 shrink-0">
        {[...layers].reverse().map((layer) => {
          const i = layers.indexOf(layer);
          const isFirst = i === 0;
          const isLast = i === layers.length - 1;

          return (
            <div
              key={layer.id}
              className={cn(
                "flex items-center gap-1.5 p-2 rounded-lg border transition-colors",
                i === activeLayerIdx
                  ? "bg-cyan-500/20 border-cyan-500/40"
                  : "bg-transparent border-transparent hover:bg-accent/50",
              )}
            >
              <button
                className={cn(
                  "inline-flex items-center justify-center h-7 w-7 shrink-0 rounded text-muted-foreground hover:text-accent-foreground transition-colors",
                  !layer.visible && "opacity-40",
                )}
                onClick={() => commit(() => onToggleVisibility(i))}
                title={layer.visible ? "Hide layer" : "Show layer"}
              >
                {layer.visible ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </button>

              <button
                className="flex-1 min-w-0 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground text-left"
                onClick={() => onSelectLayer(i)}
                title={`${layer.name} — ${layerKind(layer)} layer`}
              >
                {layerKind(layer) === "hatch" ? (
                  <HatchGlyph className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />
                ) : (
                  <Square className="w-3.5 h-3.5 shrink-0 opacity-50" />
                )}
                <span className="truncate">{layer.name}</span>
              </button>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30"
                  onClick={() => commit(() => onDuplicateLayer(i))}
                  disabled={!canAdd}
                  title="Duplicate layer"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button
                  className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30"
                  onClick={() => commit(() => onDeleteLayer(i))}
                  disabled={isFirst}
                  title={isFirst ? "Cannot delete background layer" : "Delete layer"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <div className="flex flex-col -space-y-0.5">
                  <button
                    className="inline-flex items-center justify-center h-3.5 w-5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-20"
                    onClick={() => commit(() => onMoveLayer(i, 1))}
                    disabled={isLast}
                    title="Move layer up"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    className="inline-flex items-center justify-center h-3.5 w-5 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-20"
                    onClick={() => commit(() => onMoveLayer(i, -1))}
                    disabled={isFirst}
                    title="Move layer down"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showEffects && (
        <div className="pt-3 border-t border-border/50 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-white/60">
              Effects
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center justify-center h-6 w-6 rounded text-white/50 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-30"
                  disabled={allAdded}
                  title={allAdded ? "No more effects available" : "Add effect"}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6}>
                <DropdownMenuItem
                  disabled={hasRound}
                  onClick={() =>
                    commit(() =>
                      onSetLayerEffects(activeLayerIdx, [
                        ...effects,
                        {
                          type: "roundCorners",
                          radius: DEFAULT_ROUND_RADIUS,
                          enabled: true,
                        },
                      ]),
                    )
                  }
                >
                  <RoundCornersGlyph className="w-3.5 h-3.5 opacity-60" />
                  Round corners
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={hasOutline}
                  onClick={() =>
                    commit(() =>
                      onSetLayerEffects(activeLayerIdx, [
                        ...effects,
                        {
                          type: "outline",
                          weight: DEFAULT_OUTLINE_WEIGHT,
                          enabled: true,
                        },
                      ]),
                    )
                  }
                >
                  <OutlineGlyph className="w-3.5 h-3.5 opacity-60" />
                  Outline
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={hasGlow}
                  onClick={() =>
                    commit(() =>
                      onSetLayerEffects(activeLayerIdx, [
                        ...effects,
                        {
                          type: "glow",
                          radius: DEFAULT_GLOW_RADIUS,
                          opacity: DEFAULT_GLOW_OPACITY,
                          color: DEFAULT_GLOW_COLOR,
                          enabled: true,
                        },
                      ]),
                    )
                  }
                >
                  <GlowGlyph className="w-3.5 h-3.5 opacity-60" />
                  Glow
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={hasAdjust}
                  onClick={() =>
                    commit(() =>
                      onSetLayerEffects(activeLayerIdx, [
                        ...effects,
                        {
                          type: "adjustColor",
                          brightness: 0,
                          hue: 0,
                          saturation: 0,
                          enabled: true,
                        },
                      ]),
                    )
                  }
                >
                  <AdjustColorGlyph className="w-3.5 h-3.5 opacity-60" />
                  Adjust colour
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={hasNoise}
                  onClick={() =>
                    commit(() =>
                      onSetLayerEffects(activeLayerIdx, [
                        ...effects,
                        {
                          type: "subdivisionNoise",
                          amount: DEFAULT_NOISE_AMOUNT,
                          seed: DEFAULT_NOISE_SEED,
                          enabled: true,
                        },
                      ]),
                    )
                  }
                >
                  <SubdivisionNoiseGlyph className="w-3.5 h-3.5 opacity-60" />
                  Subdivision noise
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {effects.length === 0 && (
            <span className="text-xs text-muted-foreground/60 italic">None</span>
          )}

          {effects.map((effect, i) => (
            <div
              key={effect.type}
              className="flex flex-col gap-1.5 p-2 rounded-lg bg-accent/30"
            >
              <div className="flex items-center gap-1.5">
                <button
                  className={cn(
                    "inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-accent-foreground transition-colors",
                    !effect.enabled && "opacity-40",
                  )}
                  onClick={() => commit(() => patchEffect(i, { enabled: !effect.enabled }))}
                  title={effect.enabled ? "Disable effect" : "Enable effect"}
                >
                  {effect.enabled ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <EyeOff className="w-4 h-4" />
                  )}
                </button>
                <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <EffectGlyph
                    type={effect.type}
                    className="w-3.5 h-3.5 shrink-0 opacity-60"
                  />
                  {EFFECT_LABEL[effect.type]}
                </span>
                <button
                  className="ml-auto inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() =>
                    commit(() =>
                      onSetLayerEffects(
                        activeLayerIdx,
                        effects.filter((_, j) => j !== i),
                      ),
                    )
                  }
                  title="Remove effect"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* The drag writes state on every `input` so the canvas follows the
                  slider, but only commits on release. Committing per event would
                  push a hundred entries for one drag and blow the 50-deep undo
                  stack away in a single gesture. */}
              {EFFECT_SLIDERS[effect.type].map(
                ({ key, label, min = 0, max = 1, step = 0.01, scale = 100, unit = "%" }) => (
                  <label key={key} className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-white/60 shrink-0 w-20">
                      {label}
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={(effect as unknown as Record<string, number>)[key]}
                      disabled={!effect.enabled}
                      onChange={(e) =>
                        patchEffect(i, { [key]: Number(e.target.value) })
                      }
                      onPointerUp={onCommit}
                      onKeyUp={onCommit}
                      className="flex-1 min-w-0 h-2 accent-cyan-500 disabled:opacity-40"
                    />
                    <span className="text-xs font-mono text-white/50 tabular-nums w-10 text-right shrink-0">
                      {Math.round(
                        (effect as unknown as Record<string, number>)[key] *
                          scale,
                      )}
                      {unit}
                    </span>
                  </label>
                ),
              )}

              {effect.type === "glow" && (
                <>
                  <label className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-white/60 shrink-0 w-20">
                      Colour
                    </span>
                    <button
                      className="flex-1 min-w-0 h-6 rounded border border-border/60 disabled:opacity-40"
                      style={{ background: resolveColor(effect.color) }}
                      disabled={!effect.enabled}
                      onClick={() => setColorPickerFor(i)}
                      title="Glow colour"
                    />
                  </label>
                  {!hasSurfaceBelow && (
                    <span className="text-xs leading-snug text-amber-400/80">
                      Nothing below to catch it — a glow only falls on the solid
                      cells of layers underneath.
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* The same generic picker the crop export's background uses. Its value is
          encoded, so the glow keeps tracking the global hue and saturation shift
          exactly as painted data does. */}
      <ColorPickerDialog
        open={colorPickerFor !== null}
        onClose={() => setColorPickerFor(null)}
        value={
          colorPickerFor !== null
            ? ((effects[colorPickerFor] as { color?: string })?.color ??
              DEFAULT_GLOW_COLOR)
            : DEFAULT_GLOW_COLOR
        }
        onChange={(encoded) => {
          if (colorPickerFor === null) return;
          commit(() => patchEffect(colorPickerFor, { color: encoded }));
        }}
        palettes={palettes}
        title="Glow colour"
      />
      </div>
    </PanelShell>
  );
}
