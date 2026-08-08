"use client";

import { cn } from "@/lib/utils";
import {
  ARC_BIT,
  DIR_BIT,
  DIR_LABEL,
  HATCH_DIRS,
  MAX_DENSITY,
  MAX_WEIGHT,
  MIN_DENSITY,
  MIN_WEIGHT,
  type HatchBrush,
  type HatchDir,
} from "@/lib/hatch";
import type { Tool } from "@/lib/tools/types";

/**
 * Hatch brush controls: three direction toggles and two sliders.
 *
 * A strip the size of the footer, overlaid on the bottom of the canvas rather
 * than docked above it — same reasoning as the pattern drawer. Docking would
 * resize the canvas every time the active layer's kind changed.
 *
 * The colour is deliberately *not* here: on a hatch layer the ordinary swatch
 * row drives the hatch brush, so there is only one colour control in the app.
 */

/** Lines at the family's true angle. Used both for the toggles and, at 12-16px,
 *  as the app's hatch icon — a generic "lines" glyph reads as a menu. */
export function HatchGlyph({
  dir = 2,
  className,
}: {
  dir?: HatchDir;
  className?: string;
}) {
  // 0, 60 and 120 degrees, matching the three lattice directions.
  const angle = dir === 0 ? 0 : dir === 1 ? 60 : 120;
  return (
    <svg viewBox="-12 -12 24 24" className={className ?? "w-5 h-5"}>
      <g
        transform={`rotate(${angle})`}
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      >
        <line x1={-9} y1={-4} x2={9} y2={-4} />
        <line x1={-9} y1={0} x2={9} y2={0} />
        <line x1={-9} y1={4} x2={9} y2={4} />
      </g>
    </svg>
  );
}

/**
 * Which corner of the glyph's triangle each family's arc sits in, as the arc
 * through the midpoints of that corner's two edges — the density-1 tile, at true
 * proportions.
 *
 * The triangle is `L(-9,7) R(9,7) T(0,-8.6)`, so `LR` is the horizontal edge
 * (family 0) and the arc opposite it goes at the apex `T`. The other two are
 * read off `hatchU`, **not** off `DIR_LABEL`: world y points down, so family 1
 * (`x − y·SKEW`) descends to the right and looks like `\` on screen, putting its
 * arc at `L`, and family 2 (`x + y·SKEW`) looks like `/` and puts its arc at `R`.
 * Taking the labels at face value swaps these two, which is exactly what it
 * looks like — a `\` button drawing the horizontal one.
 *
 * Nothing is rotated. An earlier version turned the whole glyph by 120° per
 * family, but the triangle's centroid is at `(0, 1.8)` rather than the origin,
 * so rotating about the origin slid the triangle around instead of mapping it
 * onto itself.
 */
const ARC_GLYPH_PATH: Record<HatchDir, string> = {
  0: "M -4.5 -0.8 A 9 9 0 0 0 4.5 -0.8",
  1: "M -4.5 -0.8 A 9 9 0 0 1 0 7",
  2: "M 4.5 -0.8 A 9 9 0 0 0 0 7",
};

/**
 * A Truchet arc in the corner the family faces.
 *
 * Drawn as the arc plus faint triangle edges, because an arc alone gives no
 * clue *which* corner it sits in — and that is the only thing distinguishing
 * the three buttons.
 */
export function ArcGlyph({
  dir = 0,
  className,
}: {
  dir?: HatchDir;
  className?: string;
}) {
  return (
    <svg viewBox="-12 -12 24 24" className={className ?? "w-5 h-5"}>
      <g fill="none" strokeLinecap="round">
        <path
          d="M -9 7 L 9 7 L 0 -8.6 Z"
          stroke="currentColor"
          strokeOpacity={0.28}
          strokeWidth={1.2}
        />
        <path d={ARC_GLYPH_PATH[dir]} stroke="currentColor" strokeWidth={1.8} />
      </g>
    </svg>
  );
}

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
    // Narrower on small displays so both fields plus the direction toggles fit
    // without the bar having to scroll.
    <label className="flex items-center gap-2 w-[140px] sm:w-[200px] shrink-0">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">
        {label}
      </span>
      {/* `min-w-0` is load-bearing. A range input has an intrinsic width of
          ~129px, and a flex item defaults to `min-width: auto`, so without this
          the input refuses to shrink, overflows the field's declared width and
          runs its value straight into the next field's label — the bar rendered
          "2WEIGHT" with no gap at all. */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 h-2 accent-cyan-500"
      />
      <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-8 text-right shrink-0">
        {display}
      </span>
    </label>
  );
}

export function HatchBar({
  brush,
  onBrushChange,
  onPointerEnter,
  tool,
  hasSelection,
  onConvert,
}: {
  brush: HatchBrush;
  onBrushChange: (patch: Partial<HatchBrush>) => void;
  onPointerEnter: () => void;
  tool: Tool;
  hasSelection: boolean;
  onConvert: () => void;
}) {
  const toggleBit = (bit: number) => {
    const next = brush.dirMask ^ bit;
    // At least one mark must stay on, or the brush paints nothing.
    if (next === 0) return;
    onBrushChange({ dirMask: next });
  };

  // Density means concentric arcs, and density 1 — the single arc through the
  // edge midpoints — is the classic Truchet tile, so the line families' floor
  // would put the most useful setting out of reach.
  const arcsOn =
    (brush.dirMask & (ARC_BIT[0] | ARC_BIT[1] | ARC_BIT[2])) !== 0;

  return (
    <div
      className="absolute z-40 bottom-0 left-0 right-0 p-2 border-t bg-card/90 backdrop-blur-md cursor-default overflow-x-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour="hatch"
    >
      {/* `w-max mx-auto` rather than `justify-center` on the scroller: a
          centred flex row that overflows spills off *both* edges, and the left
          half can then never be scrolled back into view. */}
      <div className="flex items-center gap-4 sm:gap-6 w-max mx-auto">
      <div className="flex items-center gap-0.5 shrink-0">
        {HATCH_DIRS.map((dir) => {
          const on = (brush.dirMask & DIR_BIT[dir]) !== 0;
          return (
            <button
              key={dir}
              onClick={() => toggleBit(DIR_BIT[dir])}
              title={`${DIR_LABEL[dir]} — click to toggle; enable two or three to cross-hatch`}
              className={cn(
                "inline-flex items-center justify-center h-9 w-9 rounded-md transition-colors",
                on
                  ? "bg-cyan-500/25 text-cyan-300"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <HatchGlyph dir={dir} className="w-4 h-4" />
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {HATCH_DIRS.map((dir) => {
          const on = (brush.dirMask & ARC_BIT[dir]) !== 0;
          return (
            <button
              key={`arc-${dir}`}
              onClick={() => toggleBit(ARC_BIT[dir])}
              title={`Truchet arc in the corner opposite the ${DIR_LABEL[dir]} edge — arcs chain across trixels into continuous paths`}
              className={cn(
                "inline-flex items-center justify-center h-9 w-9 rounded-md transition-colors",
                on
                  ? "bg-amber-500/25 text-amber-300"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <ArcGlyph dir={dir} className="w-4 h-4" />
            </button>
          );
        })}
      </div>

      <SliderField
        label="Density"
        value={brush.density}
        min={arcsOn ? 1 : MIN_DENSITY}
        max={MAX_DENSITY}
        step={1}
        display={String(brush.density)}
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

      {/* Only under Select, and only with hexes picked: the operation is defined
          on a hex selection, so a button that is always visible would be dead
          most of the time. The bar itself is already hatch-layer-only. */}
      {tool === "select" && hasSelection && (
        <button
          onClick={onConvert}
          title="Convert the selected hexes' colours below into hatch marks"
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md shrink-0 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 transition-colors text-xs whitespace-nowrap"
        >
          <HatchGlyph className="w-4 h-4" />
          Convert to hatches
        </button>
      )}
      </div>
    </div>
  );
}
