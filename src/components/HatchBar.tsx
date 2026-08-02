"use client";

import { cn } from "@/lib/utils";
import {
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
    <label className="flex items-center gap-2 min-w-0 w-[200px] shrink">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">
        {label}
      </span>
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
}: {
  brush: HatchBrush;
  onBrushChange: (patch: Partial<HatchBrush>) => void;
  onPointerEnter: () => void;
}) {
  const toggleDir = (dir: HatchDir) => {
    const next = brush.dirMask ^ DIR_BIT[dir];
    // At least one direction must stay on, or the brush paints nothing.
    if (next === 0) return;
    onBrushChange({ dirMask: next });
  };

  return (
    <div
      className="absolute z-40 bottom-0 left-0 right-0 flex items-center justify-center gap-6 p-2 border-t bg-card/90 backdrop-blur-md cursor-default"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour="hatch"
    >
      <div className="flex items-center gap-0.5 shrink-0">
        {HATCH_DIRS.map((dir) => {
          const on = (brush.dirMask & DIR_BIT[dir]) !== 0;
          return (
            <button
              key={dir}
              onClick={() => toggleDir(dir)}
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

      <SliderField
        label="Density"
        value={brush.density}
        min={MIN_DENSITY}
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
    </div>
  );
}
