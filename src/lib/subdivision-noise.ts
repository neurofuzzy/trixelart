import { H, SIDE, getTriVertices, type TriType } from "@/lib/grid-math";
import {
  COLOR_COUNT,
  decodeColor,
  encodeColor,
  isNoPrint,
  resolveColor,
} from "@/lib/constants";

/**
 * The subdivision-noise effect: a triangular dither *inside* each painted cell.
 *
 * Every other layer effect works on the silhouette — where an edge falls, what
 * lands under it, what colour the whole region resolves to. This one is the only
 * texture: each trixel splits into a handful of pieces, and each piece is filled
 * with a blend between the cell's own colour and its neighbouring palette
 * indices. The lattice, the boundary and `painted` itself are all untouched —
 * the pieces exactly retile the cell they came from, whichever split is chosen.
 *
 * Mostly pure maths, with one canvas drawer at the bottom — the same split
 * `round-corners.ts` makes, and for the same reason: the preview and the raster
 * exporter share it rather than each writing the loop.
 */

/** A point in world space, the shape `getTriVertices` returns. */
export interface Pt {
  x: number;
  y: number;
}

/** One piece of a subdivided cell, ready for a backend to emit. A triangle
 *  under `"midpoint"`, a quad under `"centroid"` — hence the open-ended array
 *  rather than a fixed triple. */
export interface SubFill {
  points: Pt[];
  hex: string;
}

/**
 * How a cell is cut up.
 *
 * `"midpoint"` — four sub-triangles at the edge midpoints. Keeps every piece a
 * triangle pointing the same way as the lattice, so the grain reads as a finer
 * version of the grid itself.
 *
 * `"centroid"` — three quad "fins", each owned by one corner and running corner
 * → edge midpoint → centroid → the other edge midpoint. Coarser (three pieces,
 * not four) and off-lattice, so it reads as faceting rather than as a finer
 * grid. Borrowed from the terrain shader in nemoworlds, which uses the same cut
 * barycentrically to facet a rendered surface.
 */
export type SubdivisionMode = "midpoint" | "centroid";

export interface SubdivisionNoiseSpec {
  /** 0–100. How far a piece may travel toward the neighbouring palette index.
   *  0 is a no-op and `activeEffects` drops it. */
  amount: number;
  /** Re-rolls the grain. Any integer; the pattern is otherwise fixed by the
   *  cell's coordinates, so the same artwork always dithers the same way. */
  seed: number;
  /** Absent means `"midpoint"` — the split this effect shipped with, so a
   *  document saved before the mode existed keeps its grain. Read it through
   *  `subdivisionMode`, never directly, exactly as with `layerKind`. */
  mode?: SubdivisionMode;
  /** The repeat the grain is folded onto — the crop's `{ m, n }`. Absent leaves
   *  the noise unbounded, which does not survive a fabric tiling; see
   *  `canonicalCell`. Threaded in by each backend rather than stored on the
   *  effect, because it belongs to the export rectangle, not to the layer. */
  period?: NoisePeriod;
}

/** A repeat rectangle in lattice steps: `m` cells wide, `n` double-rows tall —
 *  exactly `CropRect`'s `m`/`n`, which is the only repeat the lattice has. */
export interface NoisePeriod {
  m: number;
  n: number;
}

/**
 * The representative of `(q, r)` within one repeat of the crop.
 *
 * Hashing raw coordinates makes the grain unbounded, and a fabric tile then
 * fails to repeat: a cell straddling the crop edge takes its two halves from
 * `q` and `q + m`, which hash differently, so the discontinuity lands right on
 * the seam. Folding the coordinate onto the crop first makes the grain repeat
 * with the tile, so the seam disappears.
 *
 * The fold has to follow the lattice's *actual* symmetries, which are not a
 * plain `(q mod m, r mod 2n)`. The crop's translations are `(q+m, r)` and
 * `(q−n, r+2n)` — the vertical one shifts `q`, because `(0, 2H) = 2v − u` — so
 * the row index has to pay that shift back before `q` is reduced. Verified
 * invariant under both generators.
 */
export function canonicalCell(
  q: number,
  r: number,
  period?: NoisePeriod,
): [number, number] {
  if (!period || period.m <= 0 || period.n <= 0) return [q, r];
  const rows = 2 * period.n;
  const k = Math.floor(r / rows);
  const rr = r - k * rows;
  const qq = (((q + k * period.n) % period.m) + period.m) % period.m;
  return [qq, rr];
}

/** Reads a spec's mode, defaulting an absent field to the original split. */
export const subdivisionMode = (s: {
  mode?: SubdivisionMode;
}): SubdivisionMode => s.mode ?? "midpoint";

/**
 * Blend steps per direction.
 *
 * Not a rendering nicety — a continuous blend would give almost every
 * sub-triangle its own hex, which costs the canvas a `fillStyle` change per
 * triangle and costs `mergeTrianglesByColor` the ability to merge anything. At
 * eight steps a source colour produces at most 17 outputs, so both stay as
 * cheap as they were, and the banding reads as dither rather than as a gradient
 * — which is the look this is for.
 */
export const NOISE_LEVELS = 8;

const mid = (p: Pt, q: Pt): Pt => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

/**
 * The four sub-triangles of a cell, in a fixed order: the three corner
 * triangles in the winding `getTriVertices` returned, then the middle one.
 *
 * Order matters because it indexes the noise — reordering these re-rolls every
 * saved document's grain.
 */
export function subdivideTri(a: Pt, b: Pt, c: Pt): Pt[][] {
  const ab = mid(a, b);
  const bc = mid(b, c);
  const ca = mid(c, a);
  return [
    [a, ab, ca],
    [ab, b, bc],
    [ca, bc, c],
    [ab, bc, ca],
  ];
}

/**
 * The three centroid "fins" of a cell: one quad per corner, running corner →
 * edge midpoint → centroid → the other edge midpoint.
 *
 * Each is exactly a third of the cell, and the three meet at the centroid with
 * no interior vertex left over — which is what makes this a retiling rather than
 * an overlay. The winding follows the corner order, so it inherits whatever
 * `getTriVertices` produced and needs no separate orientation fix.
 */
export function subdivideTriCentroid(a: Pt, b: Pt, c: Pt): Pt[][] {
  const ab = mid(a, b);
  const bc = mid(b, c);
  const ca = mid(c, a);
  const g = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
  return [
    [a, ab, g, ca],
    [b, bc, g, ab],
    [c, ca, g, bc],
  ];
}

/** The one definition of how a cell splits, per mode. Every backend reaches the
 *  geometry through this rather than picking a function itself. */
export function subdivideCell(
  a: Pt,
  b: Pt,
  c: Pt,
  mode: SubdivisionMode,
): Pt[][] {
  return mode === "centroid"
    ? subdivideTriCentroid(a, b, c)
    : subdivideTri(a, b, c);
}

/**
 * Deterministic noise in `[-1, 1)` for one sub-triangle.
 *
 * A 32-bit integer avalanche, not a gradient noise: neighbouring sub-triangles
 * are meant to be uncorrelated, because the grain should read at the
 * sub-triangle scale rather than as smooth blobs across cells. Seeded purely by
 * position, so undo, redo, a reload and an export all produce the same pattern.
 */
function noiseAt(
  q: number,
  r: number,
  type: TriType,
  sub: number,
  seed: number,
): number {
  let h = (q | 0) * 0x27d4eb2d;
  h = (h ^ ((r | 0) * 0x165667b1)) >>> 0;
  h = (h ^ ((type === "up" ? 1 : 2) * 0x9e3779b9)) >>> 0;
  h = (h ^ ((sub + 1) * 0x85ebca6b)) >>> 0;
  h = (h ^ ((seed | 0) * 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h / 0x80000000) - 1;
}

/** `#rrggbb` → its three channels, or `null` for anything that is not one.
 *  `resolveColor` hands back the raw string for values it cannot decode, so
 *  this has to fail rather than throw. */
function hexChannels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const chan = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

/**
 * Linear RGB-space mix, `t` from 0 (all `a`) to 1 (all `b`).
 *
 * Deliberately not an HSL mix even though the palettes are HSL-derived: the four
 * custom palettes carry a per-index hue as well as a per-index lightness, so
 * adjacent indices can differ in hue, and interpolating that in HSL would swing
 * through colours that are in neither swatch.
 */
function mixHex(a: string, b: string, t: number): string {
  const ca = hexChannels(a);
  const cb = hexChannels(b);
  if (!ca || !cb) return a;
  return `#${chan(ca[0] + (cb[0] - ca[0]) * t)}${chan(ca[1] + (cb[1] - ca[1]) * t)}${chan(ca[2] + (cb[2] - ca[2]) * t)}`;
}

/**
 * The 2·`NOISE_LEVELS`+1 hexes one encoded colour can dither into, darkest
 * first, with the cell's own colour in the middle.
 *
 * Cached across the whole render: a document uses a handful of swatches and
 * every cell of one swatch shares this ramp. The cache is keyed by the encoded
 * value *and* the resolved hex, so a global hue/saturation shift — which
 * re-resolves the same encoded value to a different colour — invalidates it
 * rather than serving stale colours.
 */
const rampCache = new Map<string, string[]>();

export function colorRamp(encoded: string): string[] {
  const base = resolveColor(encoded);
  const cacheKey = `${encoded}|${base}`;
  const hit = rampCache.get(cacheKey);
  if (hit) return hit;

  const d = decodeColor(encoded);
  // Clamped at both ends of the ramp exactly as `dodgeColor` / `burnColor`
  // clamp: a cell painted in the darkest swatch has nothing darker to blend
  // toward, so its grain only travels the one way. That is the same asymmetry
  // dodge and burn already have, so it needs no special case here.
  const prev =
    d && d.colorIdx > 0
      ? resolveColor(encodeColor(d.paletteIdx, d.colorIdx - 1))
      : base;
  const next =
    d && d.colorIdx < COLOR_COUNT - 1
      ? resolveColor(encodeColor(d.paletteIdx, d.colorIdx + 1))
      : base;

  const ramp: string[] = [];
  for (let i = -NOISE_LEVELS; i <= NOISE_LEVELS; i++) {
    const t = i / NOISE_LEVELS;
    ramp.push(t < 0 ? mixHex(base, prev, -t) : mixHex(base, next, t));
  }
  rampCache.set(cacheKey, ramp);
  return ramp;
}

/**
 * One painted cell as its dithered pieces — four sub-triangles or three fins,
 * depending on the spec's mode.
 *
 * Falls back to the single undivided triangle for a value that does not decode
 * to a palette colour — a hatch value, or a raw string from an old document —
 * so this can be applied blindly to a step's whole map.
 */
export function noiseSubFills(
  q: number,
  r: number,
  type: TriType,
  encoded: string,
  spec: SubdivisionNoiseSpec,
): SubFill[] {
  // A no-print marker renders as nothing at all, so it grows no grain either.
  // Without this its undecodable fallback below would emit one undivided
  // triangle filled with the literal marker string.
  if (isNoPrint(encoded)) return [];
  const [a, b, c] = getTriVertices(q, r, type);
  if (!decodeColor(encoded)) {
    return [{ points: [a, b, c], hex: resolveColor(encoded) }];
  }
  const ramp = colorRamp(encoded);
  const scale = Math.max(0, Math.min(100, spec.amount)) / 100;
  // Geometry stays at the real coordinates; only the *hash key* folds onto the
  // repeat, so the grain tiles with the crop while the cell stays where it is.
  const [hq, hr] = canonicalCell(q, r, spec.period);
  return subdivideCell(a, b, c, subdivisionMode(spec)).map((points, sub) => {
    const n = noiseAt(hq, hr, type, sub, spec.seed) * scale;
    const level = Math.max(
      -NOISE_LEVELS,
      Math.min(NOISE_LEVELS, Math.round(n * NOISE_LEVELS)),
    );
    return { points, hex: ramp[level + NOISE_LEVELS] };
  });
}

/**
 * Whether a world-space `y` lies on a lattice row rather than between two.
 *
 * The raster exporter skips its seam-closing overdraw on flat edges, because the
 * caller lands every lattice row on an integer pixel boundary and a stroke
 * centred there straddles it and discolours the whole row. Subdivision breaks
 * that assumption: a piece's flat edges can sit between rows — at `(r + ½)H`
 * under `"midpoint"`, at a third of the way up under `"centroid"` — and those
 * are *not* pixel-aligned and do need the stroke. So "is it flat" is no longer
 * the right question — "is it flat *and* on a row" is.
 *
 * The tolerance is generous next to the 3-decimal rounding the coordinates have
 * been through (~1e-5 of a row) and tiny next to the half-row it has to reject.
 */
export const onLatticeRow = (y: number): boolean =>
  Math.abs(y / H - Math.round(y / H)) < 1e-3;

/** One repeat of the grain for a single painted colour, in **world**
 *  coordinates spanning `[0, w] x [0, h]`. Pieces overhang the left and right
 *  edges; the consumer is expected to clip. */
export interface NoiseTile {
  w: number;
  h: number;
  fills: SubFill[];
}

/**
 * The grain for one encoded colour over exactly one repeat of the crop.
 *
 * This is what lets a vector export state the texture **once** and reference it,
 * instead of emitting four polygons per painted cell: since the grain is already
 * periodic (see `canonicalCell`), one repeat is the whole of it. `null` without a
 * period, because there is then no repeat to state.
 *
 * Rows tile the height exactly — a cell spans `[r·H, (r+1)·H]`, so `2n` rows
 * cover `[0, h]` with nothing hanging over. Columns do not, because each row is
 * sheared half a cell to the right of the one above, so the `q` range runs wide
 * and the tile clips. That is seamless rather than lossy: a piece cut off the
 * right edge has a period-translate hanging over the left edge with identical
 * grain, so the neighbouring copy supplies exactly the part that was cut.
 */
export function noiseTile(
  encoded: string,
  spec: SubdivisionNoiseSpec,
): NoiseTile | null {
  const period = spec.period;
  if (!period || period.m <= 0 || period.n <= 0) return null;
  const rows = 2 * period.n;
  const w = period.m * SIDE;
  const h = rows * H;

  const fills: SubFill[] = [];
  for (let r = 0; r < rows; r++) {
    // A cell at (q, r) starts at x = q·SIDE + r·SIDE/2 and is 1.5·SIDE wide, so
    // these bounds cover the strip with a cell of slack at each end.
    const qMin = Math.floor(-r / 2) - 2;
    const qMax = Math.ceil(period.m - r / 2) + 2;
    for (let q = qMin; q <= qMax; q++) {
      for (const type of ["up", "down"] as const) {
        fills.push(...noiseSubFills(q, r, type, encoded, spec));
      }
    }
  }
  return { w, h, fills };
}

/** Paints sub-fills onto a 2D context, shared by the canvas preview and the
 *  raster exporter so the two cannot disagree about the grain. */
export function drawSubFills(
  ctx: CanvasRenderingContext2D,
  fills: SubFill[],
  adjust?: (hex: string) => string,
  overdraw = 0,
): void {
  // Batched by colour for the same reason the plain triangle path batches: one
  // `fillStyle` write per distinct hex, which the quantised ramp keeps to a
  // handful even across a whole layer.
  const byColor = new Map<string, SubFill[]>();
  for (const f of fills) {
    const hex = adjust ? adjust(f.hex) : f.hex;
    const list = byColor.get(hex);
    if (list) list.push(f);
    else byColor.set(hex, [f]);
  }
  for (const [hex, list] of byColor) {
    ctx.beginPath();
    for (const { points } of list) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let k = 1; k < points.length; k++) {
        ctx.lineTo(points[k].x, points[k].y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = hex;
    ctx.fill();
    // Neighbouring sub-triangles are deliberately *different* colours here, so
    // every internal edge is a composite seam — the case the raster exporter's
    // overdraw exists for. Left at 0 for the preview, which composites once.
    if (overdraw > 0) {
      ctx.strokeStyle = hex;
      ctx.lineWidth = overdraw;
      ctx.lineCap = "butt";
      ctx.beginPath();
      for (const { points } of list) {
        for (let k = 0; k < points.length; k++) {
          const p = points[k];
          const n = points[(k + 1) % points.length];
          if (p.y === n.y && onLatticeRow(p.y)) continue;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(n.x, n.y);
        }
      }
      ctx.stroke();
    }
  }
}

/**
 * A whole step's sub-fills, bucketed by the cell's **unadjusted** resolved
 * colour.
 *
 * That bucketing is the region membership the rounded/outlined path needs.
 * `regionRings` groups by resolved colour and emits one entry per distinct
 * colour — separate blobs and holes fall out as extra rings *inside* that entry
 * — so "the cells of this region" is exactly "the cells whose resolved colour is
 * this region's". No second connectivity walk, and no chance of the two
 * disagreeing about what a region is.
 *
 * Unadjusted on purpose: a colour-adjust effect on the same layer may collapse
 * two colours onto one, and matching on the filtered value would then pour one
 * region's grain into the other's.
 */
export function noiseRegionFills(
  painted: Record<string, string>,
  spec: SubdivisionNoiseSpec,
): Map<string, SubFill[]> {
  const out = new Map<string, SubFill[]>();
  for (const key in painted) {
    const encoded = painted[key];
    const parts = key.split(",");
    if (parts.length !== 3) continue;
    const q = parseInt(parts[0]);
    const r = parseInt(parts[1]);
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
    const base = resolveColor(encoded);
    const fills = noiseSubFills(q, r, parts[2] as TriType, encoded, spec);
    const list = out.get(base);
    if (list) list.push(...fills);
    else out.set(base, fills);
  }
  return out;
}
