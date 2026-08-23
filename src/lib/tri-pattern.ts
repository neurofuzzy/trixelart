import { SIDE, triCenter, worldToTri, type TriKey } from "@/lib/grid-math";
import { encodeColor, resolveColor } from "@/lib/constants";

/**
 * The triangular-lattice checker, on a rotatable and scalable sub-lattice.
 *
 * Ported from the `prismatic` cap mapping in the material-forge shader
 * (`src/lib/shader/patterns.glsl.ts`). The two grids are the same lattice —
 * `worldToTri` performs exactly the skew that `mfTriCell` does, and
 * `triCenter` already returns what `mfTriPos(mfTriCentroid(...))` computes —
 * so almost nothing needed reimplementing.
 *
 * The shader offers five patterns; only the checker survives here, because it
 * is the only one whose interest is not its own predicate. Each trixel
 * point-samples the pattern at its centroid, so once `scale` pushes the pattern
 * lattice finer than the trixel lattice the two beat against each other, and
 * the checker's up/down parity turns that beat into motifs no rule in this file
 * describes. Scale 2.6 / rotation 235 gives interlocking hexagons. The other
 * four mostly render themselves, and stacking supplies the variety they used
 * to. That is why rotation is continuous and `scale` runs well above 1:
 * snapping the angle to the lattice's 6-fold symmetry, or capping the scale,
 * makes the whole emergent family unreachable.
 *
 * Every value is a pure function of world position, so the field is global: two
 * separately painted areas line up as though revealing one continuous pattern.
 */

/**
 * Which predicate a layer evaluates.
 *
 * `checker` is the original: re-quantize the sample and read up/down parity.
 * Binary by construction, and its interest comes from aliasing against the
 * trixel grid.
 *
 * `waves` sums `folds` plane waves at evenly spaced angles. It is **continuous**
 * — the value carries a magnitude, not just a side — which is what `steps` on
 * the layer has to work with. It also reaches patterns the checker cannot: with
 * an odd `folds` the wave directions are incommensurate with the lattice's
 * 6-fold symmetry, so the result never repeats at any distance, no matter what
 * the scale and rotation are set to.
 */
export type PatternField = "checker" | "waves";

export const PATTERN_FIELDS: PatternField[] = ["checker", "waves"];

export interface TriPattern {
  /** Pattern lattice size relative to a trixel. Above 1 the pattern is finer
   *  than the grid, which is where the moire lives. For `waves` it sets the
   *  wavelength instead — `WAVE_WAVELENGTH / scale` trixel edges — so "higher is
   *  finer" still holds, but the useful range sits lower than the checker's. */
  scale: number;
  /** Degrees. Deliberately continuous — see the note above. */
  rotation: number;
  /** Absent means `"checker"`, so every layer authored before this existed
   *  reads back unchanged. */
  field?: PatternField;
  /** Plane waves for the `waves` field; ignored by `checker`. Absent means
   *  `DEFAULT_FOLDS`. */
  folds?: number;
}

export const DEFAULT_TRI_PATTERN: TriPattern = {
  scale: 2.6,
  rotation: 235,
};

export const MIN_FOLDS = 3;
export const MAX_FOLDS = 12;
export const DEFAULT_FOLDS = 5;

/** Wavelength in trixel edges at `scale = 1`. Chosen so the default scale lands
 *  on a pattern that still resolves: much below two edges per wavelength and the
 *  centroid sampling turns the field into noise rather than a motif. */
const WAVE_WAVELENGTH = 6;

/** Optional fields are read through helpers, never directly, so absent keeps
 *  meaning the pre-existing default and no save needs migrating. */
export const patternField = (p: TriPattern): PatternField =>
  p.field ?? "checker";

export const patternFolds = (p: TriPattern): number =>
  Math.min(MAX_FOLDS, Math.max(MIN_FOLDS, Math.round(p.folds ?? DEFAULT_FOLDS)));

export type PatternBlendMode = "normal" | "multiply" | "screen" | "difference";

export const PATTERN_BLEND_MODES: PatternBlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "difference",
];

/** One layer of the pattern stack: a pattern, two colours, and how it composites. */
export interface PatternLayer extends TriPattern {
  id: string;
  /** Encoded palette colours (`"paletteIdx,colorIdx"`) for value 1 and 0. */
  fg: string;
  bg: string;
  mode: PatternBlendMode;
  opacity: number;
  visible: boolean;
  /** How many tones the layer may use between `bg` and `fg`, inclusive.
   *  Absent means `MIN_STEPS` — the two-colour behaviour this stack had before
   *  ramps existed, reproduced bit for bit rather than approximately. */
  steps?: number;
}

export const MIN_STEPS = 2;
/** Nine, because that is a palette's lightness ramp. A layer set this high and
 *  coloured from one palette's ends walks that palette and nothing else. */
export const MAX_STEPS = 9;

export const patternSteps = (l: PatternLayer): number =>
  Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.round(l.steps ?? MIN_STEPS)));

let layerSeq = 0;

/**
 * Fields are taken one at a time rather than by spreading `over` last. A spread
 * lets an explicit `undefined` — which loading older settings can produce —
 * overwrite the default with nothing, and an undefined colour throws when it
 * reaches `resolveColor`. Picking fields also drops keys from retired versions
 * (the old per-layer `type`) instead of carrying them back into storage.
 */
export function makePatternLayer(over?: Partial<PatternLayer>): PatternLayer {
  layerSeq += 1;
  return {
    id: over?.id ?? `pl-${Date.now().toString(36)}-${layerSeq}`,
    scale: over?.scale ?? DEFAULT_TRI_PATTERN.scale,
    rotation: over?.rotation ?? DEFAULT_TRI_PATTERN.rotation,
    field: over?.field ?? "checker",
    folds: over?.folds ?? DEFAULT_FOLDS,
    fg: over?.fg ?? encodeColor(0, 8),
    bg: over?.bg ?? encodeColor(0, 1),
    mode: over?.mode ?? "normal",
    opacity: over?.opacity ?? 1,
    visible: over?.visible ?? true,
    steps: over?.steps ?? MIN_STEPS,
  };
}

/**
 * The pattern's value at one trixel, as a continuous 0–1.
 *
 * `checker` only ever returns the endpoints — up/down parity has no magnitude —
 * so for it this is the historical predicate widened, not changed. `waves`
 * genuinely fills the interval, which is the whole reason `steps` on a layer has
 * anything to bite on.
 */
export function triPatternField(t: TriKey, p: TriPattern): number {
  // Centroid in edge-length-1 units. SIDE cancels against the multiply below,
  // but keeping both makes the reuse of the existing helpers exact rather than
  // a re-derivation.
  const c = triCenter(t.q, t.r, t.type);
  const px = c.x / SIDE;
  const py = c.y / SIDE;

  const a = (p.rotation * Math.PI) / 180;

  if (patternField(p) === "waves") {
    const folds = patternFolds(p);
    const freq = (2 * Math.PI * p.scale) / WAVE_WAVELENGTH;
    let s = 0;
    for (let k = 0; k < folds; k++) {
      const th = a + (Math.PI * k) / folds;
      s += Math.cos(freq * (px * Math.cos(th) + py * Math.sin(th)));
    }
    // The sum only reaches ±folds where every wave crests together — one point
    // in the plane — so normalising by that would leave the whole field sitting
    // grey near the middle of the ramp. Away from those rare alignments the
    // waves add like independent phases, giving `s/folds` a spread of
    // `1/√(2·folds)`; the gain below stretches that to roughly ±2σ across the
    // full range, which spends the tones on the structure rather than on the
    // few extreme points. The clamp catches the alignments.
    //
    // Measured over 33k trixels this spends all nine tones for folds 5, 7 and
    // 12, with no tone under 1.7% of the area. `folds = 3` is the exception and
    // is not worth correcting: three directions 60° apart are commensurate with
    // the lattice, so the sum is genuinely lopsided — it ranges over [−N/2, N]
    // rather than symmetrically — and the darkest tone or two stay unreachable.
    // That is the crystallographic case behaving like a crystal, not a bug.
    const gain = Math.sqrt(folds) * 0.7;
    const v = 0.5 + 0.5 * gain * (s / folds);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  const cs = Math.cos(a);
  const sn = Math.sin(a);

  // Rotate, scale, then re-derive which cell of the pattern lattice we landed
  // in. This is the sample that aliases.
  const rx = (px * cs - py * sn) * p.scale;
  const ry = (px * sn + py * cs) * p.scale;
  const cell = worldToTri(rx * SIDE, ry * SIDE);

  // The two-colouring of a triangular tiling is up/down parity — adjacent
  // triangles always differ. Note the inversion: trixelart's 'up' is the
  // shader's `up = 0`.
  return cell.type === "down" ? 0 : 1;
}

/**
 * The pattern's value at one trixel: 1 for the primary colour, 0 for the
 * secondary.
 *
 * Kept as the two-valued predicate for callers that genuinely want a side
 * rather than a tone.
 */
export function triPatternValue(t: TriKey, p: TriPattern): 0 | 1 {
  return triPatternField(t, p) >= 0.5 ? 1 : 0;
}

/**
 * Where one layer sits between its two colours at a trixel, quantized to its
 * `steps`.
 *
 * At the default `steps = 2` this rounds to exactly 0 or 1, so the layer picks
 * `bg` or `fg` and nothing downstream can tell ramps were ever added — which is
 * what lets every saved stack keep rendering identically. Quantizing *before*
 * compositing rather than after is also what keeps the painter's memo small: a
 * stack of N layers can still only produce `steps^N` distinct colours, so the
 * OKLab search runs a few hundred times at worst instead of once per trixel.
 */
export function patternTone(t: TriKey, l: PatternLayer): number {
  const n = patternSteps(l) - 1;
  return Math.round(triPatternField(t, l) * n) / n;
}

/**
 * Every trixel whose centroid falls inside the axis-aligned world box. Used by
 * the designer preview, which needs a patch wide enough for the beat to show.
 */
export function trixelsInBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): TriKey[] {
  const H = (SIDE * Math.sqrt(3)) / 2;
  const rMin = Math.floor(y0 / H) - 1;
  const rMax = Math.ceil(y1 / H) + 1;
  const qMin = Math.floor(x0 / SIDE - rMax / 2) - 1;
  const qMax = Math.ceil(x1 / SIDE - rMin / 2) + 1;

  const out: TriKey[] = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      for (const type of ["up", "down"] as const) {
        const c = triCenter(q, r, type);
        if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) {
          out.push({ q, r, type });
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Stack compositing
 * ------------------------------------------------------------------ */

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Blend one layer over the accumulator.
 *
 * Ported from `mfBlend` in material-forge's `blend.glsl.ts`, and like it this
 * runs in authoring space — the sRGB-encoded 0-1 values, not linear light.
 * Multiply, screen and difference all read differently in linear, and these are
 * meant to match what the eye expects from an image editor.
 */
function blend(dst: Rgb, src: Rgb, alpha: number, mode: PatternBlendMode): Rgb {
  let r: Rgb;
  switch (mode) {
    case "multiply":
      r = [dst[0] * src[0], dst[1] * src[1], dst[2] * src[2]];
      break;
    case "screen":
      r = [
        1 - (1 - dst[0]) * (1 - src[0]),
        1 - (1 - dst[1]) * (1 - src[1]),
        1 - (1 - dst[2]) * (1 - src[2]),
      ];
      break;
    case "difference":
      r = [
        Math.abs(dst[0] - src[0]),
        Math.abs(dst[1] - src[1]),
        Math.abs(dst[2] - src[2]),
      ];
      break;
    default:
      r = src;
  }
  return [
    dst[0] + (r[0] - dst[0]) * alpha,
    dst[1] + (r[1] - dst[1]) * alpha,
    dst[2] + (r[2] - dst[2]) * alpha,
  ];
}

/**
 * Straight sRGB mix of two resolved `#rrggbb`.
 *
 * For previews that show one layer's own ramp. The brush's own output goes
 * through the OKLab quantizer instead — this is deliberately *not* that, because
 * a thumbnail is showing what the layer contributes, not what the stack lands
 * on after snapping to a palette.
 */
export function mixHex(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const ch = (i: number) =>
    Math.round((x[i] + (y[i] - x[i]) * t) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/* ------------------------------------------------------------------ *
 * Palette quantization
 * ------------------------------------------------------------------ */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * OKLab, for measuring "which palette colour is nearest".
 *
 * Plain RGB distance is not good enough here: the palettes span 18 hues at 9
 * lightnesses, and Euclidean RGB routinely prefers a wrong-hue swatch over the
 * obvious match. OKLab is near-uniform perceptually, so nearest-in-OKLab is
 * nearest to the eye.
 */
function oklab(rgb: Rgb): Rgb {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * OKLab lightness of a resolved `#rrggbb`, 0 (black) to 1 (white).
 *
 * Exposed for the plotter export, which reproduces colour as line density in a
 * single ink and therefore needs a brightness that is comparable *across* the
 * 18 palettes. `colorIdx` is not: index 8 of Glacier is 68% lightness and index
 * 8 of Ocean is 88%, and they would plot identically.
 */
export function oklabLightness(hex: string): number {
  return Math.max(0, Math.min(1, oklab(hexToRgb(hex))[0]));
}

export interface QuantizeTarget {
  encoded: string;
  lab: Rgb;
}

/**
 * Every swatch of every palette, as quantization candidates.
 *
 * Compositing produces colours that are not in any palette — a multiply of two
 * swatches generally is not a swatch — so the result has to be snapped back to
 * something paintable. Searching across all palettes rather than the active one
 * means a blend can legitimately land in a different palette than either input,
 * which is usually the closest match available.
 */
export function buildQuantizeTargets(
  palettes: { name: string; colors: string[] }[],
): QuantizeTarget[] {
  const out: QuantizeTarget[] = [];
  palettes.forEach((p, pi) => {
    p.colors.forEach((hex, ci) => {
      out.push({ encoded: encodeColor(pi, ci), lab: oklab(hexToRgb(hex)) });
    });
  });
  return out;
}

function nearest(rgb: Rgb, targets: QuantizeTarget[]): string {
  const lab = oklab(rgb);
  let best = targets[0];
  let bestD = Infinity;
  for (const t of targets) {
    const dl = lab[0] - t.lab[0];
    const da = lab[1] - t.lab[1];
    const db = lab[2] - t.lab[2];
    const d = dl * dl + da * da + db * db;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best.encoded;
}

/**
 * Builds the per-trixel colour function for a stack.
 *
 * Layer colours and the candidate list are resolved once, and results are
 * memoized on the composited RGB: a stack of N two-colour layers can only
 * produce a handful of distinct colours, so the OKLab search runs a few times
 * rather than once per trixel.
 */
export function makePatternPainter(
  layers: PatternLayer[],
  targets: QuantizeTarget[],
): (t: TriKey) => string {
  const active = layers.filter((l) => l.visible);
  const resolved = active.map((l) => ({
    layer: l,
    fg: hexToRgb(resolveColor(l.fg)),
    bg: hexToRgb(resolveColor(l.bg)),
  }));

  // The stack sits on the bottom layer's background, so a single layer in
  // `normal` at full opacity behaves exactly as it did before stacking existed.
  const base: Rgb = resolved.length ? resolved[0].bg : [0, 0, 0];
  const memo = new Map<number, string>();

  return (t: TriKey): string => {
    let c = base;
    for (const r of resolved) {
      // Compositing was always float RGB — only the *selection* between the two
      // colours was binary. Widening that one step to a lerp is the whole of
      // multi-tone support: blend modes, opacity and the quantizer below all
      // carry over untouched.
      const v = patternTone(t, r.layer);
      const src: Rgb =
        v === 1 ? r.fg : v === 0 ? r.bg : [
          r.bg[0] + (r.fg[0] - r.bg[0]) * v,
          r.bg[1] + (r.fg[1] - r.bg[1]) * v,
          r.bg[2] + (r.fg[2] - r.bg[2]) * v,
        ];
      c = blend(c, src, r.layer.opacity, r.layer.mode);
    }
    const key =
      (Math.round(c[0] * 255) << 16) |
      (Math.round(c[1] * 255) << 8) |
      Math.round(c[2] * 255);
    let hit = memo.get(key);
    if (hit === undefined) {
      hit = nearest(c, targets);
      memo.set(key, hit);
    }
    return hit;
  };
}

/* ------------------------------------------------------------------ *
 * Saved presets
 * ------------------------------------------------------------------ */

/**
 * A whole stack, stored as a palette slot.
 *
 * Presets travel in the project snapshot rather than in view settings: a stack
 * is authored content — it took work to find — and losing it when a project is
 * shared or reopened elsewhere would be the wrong trade. This mirrors how stamp
 * selections are handled.
 */
export interface PatternPreset {
  id: string;
  layers: PatternLayer[];
}

let presetSeq = 0;

export function makePatternPreset(layers: PatternLayer[]): PatternPreset {
  presetSeq += 1;
  return {
    id: `pp-${Date.now().toString(36)}-${presetSeq}`,
    // Deep-copied so later edits to the live stack cannot mutate the slot.
    layers: layers.map((l) => makePatternLayer(l)),
  };
}

/** Validates a preset loaded from a project file or storage. */
export function normalizePatternPreset(raw: unknown): PatternPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PatternPreset>;
  if (!Array.isArray(r.layers) || r.layers.length === 0) return null;
  return {
    id: typeof r.id === "string" ? r.id : makePatternPreset([]).id,
    layers: r.layers.map((l) => makePatternLayer(l)),
  };
}
