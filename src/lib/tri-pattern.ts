import { SIDE, triCenter, worldToTri, type TriKey } from "@/lib/grid-math";
import { encodeColor, resolveColor } from "@/lib/constants";

/**
 * Procedural patterns on the triangular lattice.
 *
 * Ported from the `prismatic` cap mapping in the material-forge shader
 * (`src/lib/shader/patterns.glsl.ts`). The two grids are the same lattice —
 * `worldToTri` performs exactly the skew that `mfTriCell` does, and
 * `triCenter` already returns what `mfTriPos(mfTriCentroid(...))` computes —
 * so only the five predicates are new here.
 *
 * The interesting behaviour is emergent rather than designed. Each trixel
 * point-samples the pattern at its centroid, so once `scale` pushes the pattern
 * lattice finer than the trixel lattice, the two beat against each other and
 * produce motifs that none of the five predicates describes on its own. That is
 * why rotation is continuous and why `scale` is allowed well above 1: snapping
 * the angle to the lattice's 6-fold symmetry, or capping the scale, makes that
 * whole family unreachable. `checker` at scale 2.6 / rotation 235 gives
 * interlocking hexagons.
 *
 * Every value is a pure function of world position, so the field is global: two
 * separately painted areas line up as though revealing one continuous pattern.
 */

export type TriPatternType = "checker" | "grid" | "brick" | "lines" | "rings";

export const TRI_PATTERN_TYPES: TriPatternType[] = [
  "checker",
  "grid",
  "brick",
  "lines",
  "rings",
];

export interface TriPattern {
  type: TriPatternType;
  /** Pattern lattice size relative to a trixel. Above 1 the pattern is finer
   *  than the grid, which is where the moire lives. */
  scale: number;
  /** Degrees. Deliberately continuous — see the note above. */
  rotation: number;
}

export const DEFAULT_TRI_PATTERN: TriPattern = {
  type: "checker",
  scale: 2.6,
  rotation: 235,
};

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
}

let layerSeq = 0;

export function makePatternLayer(over?: Partial<PatternLayer>): PatternLayer {
  layerSeq += 1;
  return {
    id: `pl-${Date.now().toString(36)}-${layerSeq}`,
    ...DEFAULT_TRI_PATTERN,
    fg: encodeColor(0, 8),
    bg: encodeColor(0, 1),
    mode: "normal",
    opacity: 1,
    visible: true,
    ...over,
  };
}

/**
 * GLSL `mod()` is non-negative for a positive modulus; JS `%` keeps the sign of
 * the dividend. The lattice runs negative in every direction, so the shader
 * predicates only port faithfully through this.
 */
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * The pattern's value at one trixel: 1 for the primary colour, 0 for the
 * secondary.
 */
export function triPatternValue(t: TriKey, p: TriPattern): 0 | 1 {
  // Centroid in edge-length-1 units. SIDE cancels against the multiply below,
  // but keeping both makes the reuse of the existing helpers exact rather than
  // a re-derivation.
  const c = triCenter(t.q, t.r, t.type);
  const px = c.x / SIDE;
  const py = c.y / SIDE;

  const a = (p.rotation * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);

  // Rotate, scale, then re-derive which cell of the pattern lattice we landed
  // in. This is the sample that aliases.
  const rx = (px * cs - py * sn) * p.scale;
  const ry = (px * sn + py * cs) * p.scale;
  const cell = worldToTri(rx * SIDE, ry * SIDE);

  const q = cell.q;
  const r = cell.r;

  switch (p.type) {
    case "checker":
      // The two-colouring of a triangular tiling is up/down parity. Note the
      // inversion: trixelart's 'up' is the shader's `up = 0`.
      return cell.type === "down" ? 0 : 1;

    case "grid":
      // Lines along the three lattice directions: q, r and q + r.
      return mod(q, 4) === 0 || mod(r, 4) === 0 || mod(q + r, 4) === 0 ? 1 : 0;

    case "brick":
      // Courses of rhombi, offset half a course every other row. Running bond
      // has no exact triangular analogue; this is a reading of it.
      if (mod(r, 4) === 0) return 1;
      return mod(q + mod(Math.floor(r / 4), 2) * 4, 8) === 0 ? 1 : 0;

    case "lines":
      return mod(r, 3) === 0 ? 1 : 0;

    case "rings": {
      // Hexagonal rings about the world origin. The rhombic basis is exactly
      // the axial hex system, so the ring index is the standard axial distance.
      //
      // Deliberately drops the shader's `8 * scale` centre offset. That existed
      // because material-forge evaluates over a finite 0..gridSize tile, where
      // 8 sits inside it. Here the canvas is infinite and centred on the origin,
      // so the same offset pins the centre ~8 edge-units away at every scale and
      // leaves only far-field sectors in view.
      const ring = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) * 0.5;
      return mod(Math.floor(ring), 2) === 0 ? 1 : 0;
    }
  }
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

/* ------------------------------------------------------------------ *
 * Palette quantization
 * ------------------------------------------------------------------ */

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * OKLab, for measuring "which palette colour is nearest".
 *
 * Plain RGB distance is not good enough here: the palettes span 14 hues at 9
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
      const src = triPatternValue(t, r.layer) ? r.fg : r.bg;
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
