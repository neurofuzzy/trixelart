import {
  SIDE,
  H,
  getTriVertices,
  stringToTri,
  type TriKey,
} from "@/lib/grid-math";

/**
 * Linear hatching along the three primary directions of the trixel lattice.
 *
 * Each of the grid's three line families is the level set of one linear
 * function `u` of world position (read off the drawing code in GridCanvas):
 *
 *   family 0 (horizontal)  u = y                    grid lines at u = n*H
 *   family 1 ("/")         u = x - y*SIDE/(2H)      grid lines at u = n*SIDE
 *   family 2 ("\")         u = x + y*SIDE/(2H)      grid lines at u = n*SIDE
 *
 * Family 1 draws, for fixed q, the points (q*SIDE + r*SIDE/2, r*H); substituting
 * r = y/H gives x - y*SIDE/(2H) = q*SIDE. Family 2 draws, for fixed S = q+r,
 * x = q*SIDE + (S-q)*SIDE/2 + SIDE with y = (S-q)*H, which reduces to
 * x + y*SIDE/(2H) = (S+1)*SIDE.
 *
 * All three families have perpendicular spacing exactly H: for family 1,
 * SIDE/(2H) = 1/sqrt(3), so |grad u| = 2/sqrt(3) and the spacing is
 * SIDE*sqrt(3)/2 = H. So density k gives perpendicular spacing H/k.
 *
 * **The ladder is offset by half a step**, i.e. lines sit at `(m + 1/2)*step`,
 * not at `m*step`. Every trixel spans *exactly one* step in every family
 * (verified: the span is 1.000 for all three families and both triangle types),
 * so an unshifted ladder puts the only lines of density 1 precisely on the
 * triangle's own edges and draws nothing inside it — density 1 would render as
 * blank. With the half-step offset, **density k draws exactly k lines across
 * every trixel in every direction**, which is also the semantics worth exposing
 * on the slider.
 *
 * `u` is a pure function of world position, so the line field is **global**:
 * trixels hatched in separate strokes line up as continuous lines rather than
 * per-triangle tufts. Getting this wrong is the obvious failure mode.
 */

export type HatchDir = 0 | 1 | 2;
export const HATCH_DIRS: readonly HatchDir[] = [0, 1, 2];

/** Bit values for `HatchBrush.dirMask`. A trixel may carry any combination —
 *  two or three bits is cross-hatching within a single layer. */
export const DIR_BIT: Record<HatchDir, number> = { 0: 1, 1: 2, 2: 4 };
export const DIR_LABEL: Record<HatchDir, string> = { 0: "—", 1: "/", 2: "\\" };

export const MIN_DENSITY = 1;
export const MAX_DENSITY = 8;
export const MIN_WEIGHT = 0.5;
export const MAX_WEIGHT = 8;

export interface HatchBrush {
  /** Bitmask over DIR_BIT; 0 means nothing is drawn. */
  dirMask: number;
  /** Lines per grid cell. Perpendicular spacing is H / density. */
  density: number;
  /** Stroke width in world units. */
  weight: number;
  /** Encoded palette colour, `"paletteIdx,colorIdx"`. */
  color: string;
}

export const DEFAULT_HATCH_BRUSH: HatchBrush = {
  dirMask: DIR_BIT[0],
  density: 2,
  weight: 2,
  color: "0,1",
};

/** Skew factor shared by families 1 and 2: SIDE/(2H) = 1/sqrt(3). */
const SKEW = SIDE / (2 * H);

/**
 * Serialised form of a hatch mark: `"dirMask|density|weight|paletteIdx,colorIdx"`.
 *
 * The pipes are load-bearing. A fill value is `"p,c"` — one comma, no pipes — so
 * a hatch value is structurally distinguishable, and every existing colour
 * decode site already rejects it: `decodeColor` splits on "," and `Number()`s
 * the first field, which is `NaN` here. That is why `remapGrid`,
 * `shiftGridPalettes`, `remapHex` and `shiftHexPalettes` pass hatch data through
 * untouched instead of corrupting it.
 */
export function encodeHatch(b: HatchBrush): string {
  return `${b.dirMask}|${b.density}|${b.weight}|${b.color}`;
}

export function decodeHatch(value: string): HatchBrush | null {
  const parts = value.split("|");
  if (parts.length !== 4) return null;
  const dirMask = Number(parts[0]);
  const density = Number(parts[1]);
  const weight = Number(parts[2]);
  if (!Number.isFinite(dirMask) || !Number.isFinite(density) || !Number.isFinite(weight)) {
    return null;
  }
  return { dirMask, density, weight, color: parts[3] };
}

/** True for any value that parses as a hatch mark. Cheap enough to use as a
 *  guard wherever a map might hold either kind. */
export function isHatchValue(value: string): boolean {
  return value.includes("|");
}

/**
 * Applies `f` to the colour inside an encoded value, whichever kind it is.
 *
 * Lets the palette transforms (`remapGrid`, `shiftGridPalettes`, `remapHex`,
 * `shiftHexPalettes`) treat both layer kinds uniformly. Without it those all
 * pass hatch values through untouched — safe, but the arrow keys then do
 * nothing on a hatch layer, which reads as a bug.
 */
export function mapEncodedColor(
  value: string,
  f: (color: string) => string,
): string {
  const h = decodeHatch(value);
  if (!h) return f(value);
  return encodeHatch({ ...h, color: f(h.color) });
}

/**
 * Rotates a direction mask by `steps` sixths of a turn.
 *
 * A 60° rotation permutes the three line families cyclically (0→1→2→0), so the
 * mask rotation is a 3-cycle on the bits with period 3 — a 180° turn is the
 * identity, which is right because hatch lines are undirected.
 */
export function rotateHatchMask(mask: number, steps: number): number {
  const s = ((steps % 3) + 3) % 3;
  if (s === 0) return mask;
  let out = 0;
  for (const dir of HATCH_DIRS) {
    if (mask & DIR_BIT[dir]) out |= DIR_BIT[(((dir + s) % 3) as HatchDir)];
  }
  return out;
}

/** Mirrors a direction mask: the horizontal family is fixed and the two
 *  diagonals swap. Both flip axes act the same way, because they differ by a
 *  180° rotation, which is the identity on undirected families. */
export function flipHatchMask(mask: number): number {
  let out = mask & DIR_BIT[0];
  if (mask & DIR_BIT[1]) out |= DIR_BIT[2];
  if (mask & DIR_BIT[2]) out |= DIR_BIT[1];
  return out;
}

/** Rotates the direction of a hatch value; passes non-hatch values through. */
export function rotateHatchValue(value: string, steps: number): string {
  const h = decodeHatch(value);
  if (!h) return value;
  return encodeHatch({ ...h, dirMask: rotateHatchMask(h.dirMask, steps) });
}

/** Mirrors the direction of a hatch value; passes non-hatch values through. */
export function flipHatchValue(value: string): string {
  const h = decodeHatch(value);
  if (!h) return value;
  return encodeHatch({ ...h, dirMask: flipHatchMask(h.dirMask) });
}

/** The linear functional whose level sets are family `dir`. */
export function hatchU(dir: HatchDir, x: number, y: number): number {
  if (dir === 0) return y;
  if (dir === 1) return x - y * SKEW;
  return x + y * SKEW;
}

/** Spacing in `u` between adjacent hatch lines. Chosen so the *perpendicular*
 *  spacing is H / density for all three families. */
export function hatchStep(dir: HatchDir, density: number): number {
  const k = Math.max(1, density);
  return (dir === 0 ? H : SIDE) / k;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Seg = [number, number, number, number];

/**
 * Every line of family `dir` at `density` that crosses `box`, as segments
 * spanning the box. Callers clip them — to a canvas clip region, or per
 * triangle for SVG.
 */
export function hatchLinesInBox(
  dir: HatchDir,
  density: number,
  box: Box,
): Seg[] {
  const step = hatchStep(dir, density);
  if (!(step > 0)) return [];

  const us = [
    hatchU(dir, box.minX, box.minY),
    hatchU(dir, box.maxX, box.minY),
    hatchU(dir, box.minX, box.maxY),
    hatchU(dir, box.maxX, box.maxY),
  ];
  // Half-step offset — see the file header. Without it density 1 lands on the
  // triangle edges and draws nothing inside.
  const nMin = Math.ceil(Math.min(...us) / step - 0.5);
  const nMax = Math.floor(Math.max(...us) / step - 0.5);
  // A pathological box/density combination shouldn't be able to hang the render.
  if (nMax - nMin > 20000) return [];

  const out: Seg[] = [];
  for (let n = nMin; n <= nMax; n++) {
    const u = (n + 0.5) * step;
    if (dir === 0) {
      // y = u, parameterised by x.
      out.push([box.minX, u, box.maxX, u]);
    } else {
      // x = u +/- y*SKEW, parameterised by y.
      const s = dir === 1 ? SKEW : -SKEW;
      out.push([u + box.minY * s, box.minY, u + box.maxY * s, box.maxY]);
    }
  }
  return out;
}

/**
 * Clips a segment to a triangle, returning the surviving span or null.
 *
 * Narrows a parametric [t0, t1] range against the triangle's three half-planes.
 * The inside sign is taken from the third vertex rather than assumed from the
 * winding: `getTriVertices` returns *opposite* windings for the two triangle
 * types (the screen-space signed area is +H*SIDE for 'up' and -H*SIDE for
 * 'down' — the reason `svg-export.ts` carries `ensureCW`), so a clipper that
 * assumed one winding would keep the wrong half of every 'down' triangle.
 */
export function clipSegmentToTriangle(
  seg: Seg,
  q: number,
  r: number,
  type: TriKey["type"],
): Seg | null {
  const [x0, y0, x1, y1] = seg;
  const v = getTriVertices(q, r, type);
  const dx = x1 - x0;
  const dy = y1 - y0;

  let t0 = 0;
  let t1 = 1;

  for (let i = 0; i < 3; i++) {
    const a = v[i];
    const b = v[(i + 1) % 3];
    const c = v[(i + 2) % 3];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    // Positive on whichever side the opposite vertex lies.
    const sign = Math.sign(ex * (c.y - a.y) - ey * (c.x - a.x)) || 1;
    const f = (px: number, py: number) =>
      sign * (ex * (py - a.y) - ey * (px - a.x));

    const fStart = f(x0, y0);
    const dF = f(x0 + dx, y0 + dy) - fStart;

    if (Math.abs(dF) < 1e-12) {
      // Parallel to this edge: in or out wholesale.
      if (fStart < 0) return null;
      continue;
    }
    const t = -fStart / dF;
    if (dF > 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) {
      t1 = t;
    }
    if (t0 > t1) return null;
  }

  if (t1 - t0 < 1e-9) return null;
  return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
}

/**
 * Liang–Barsky clip of a segment to an axis-aligned rect.
 *
 * The crop exporter needs this on top of the per-triangle clip: a triangle
 * straddling the crop edge yields a chord that still pokes outside it.
 */
export function clipSegmentToRect(seg: Seg, box: Box): Seg | null {
  const [x0, y0, x1, y1] = seg;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;

  const edges: Array<[number, number]> = [
    [-dx, x0 - box.minX],
    [dx, box.maxX - x0],
    [-dy, y0 - box.minY],
    [dy, box.maxY - y0],
  ];

  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null; // parallel and outside
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }

  if (t1 - t0 < 1e-9) return null;
  return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
}

export interface HatchGroup {
  dir: HatchDir;
  density: number;
  weight: number;
  /** Encoded palette colour. */
  color: string;
  tris: TriKey[];
}

/**
 * Buckets a hatch layer's marks into one group per distinct
 * (direction, density, weight, colour). A cross-hatched trixel — two or three
 * bits in its mask — lands in that many groups, which is what lets the renderer
 * treat every group as a single-direction stroke.
 *
 * `bounds` accumulates the world extent of every mark, so callers that need to
 * size a document don't have to walk the marks twice.
 */
export function groupHatchMarks(marks: Record<string, string>): {
  groups: HatchGroup[];
  bounds: Box | null;
} {
  const byKey = new Map<string, HatchGroup>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;

  for (const [key, value] of Object.entries(marks)) {
    const h = decodeHatch(value);
    if (!h || !h.dirMask) continue;
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;

    for (const v of getTriVertices(tri.q, tri.r, tri.type)) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    any = true;

    for (const dir of HATCH_DIRS) {
      if (!(h.dirMask & DIR_BIT[dir])) continue;
      const gk = `${dir}|${h.density}|${h.weight}|${h.color}`;
      const g = byKey.get(gk);
      if (g) g.tris.push(tri);
      else {
        byKey.set(gk, {
          dir,
          density: h.density,
          weight: h.weight,
          color: h.color,
          tris: [tri],
        });
      }
    }
  }

  return {
    groups: [...byKey.values()],
    bounds: any ? { minX, minY, maxX, maxY } : null,
  };
}

/** World-space bounding box of a set of triangles. */
export function trisBox(tris: TriKey[]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tris) {
    for (const v of getTriVertices(t.q, t.r, t.type)) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
  }
  return tris.length ? { minX, minY, maxX, maxY } : null;
}

/** Intersection of two boxes, or null when they don't overlap. */
export function intersectBox(a: Box, b: Box): Box | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (minX > maxX || minY > maxY) return null;
  return { minX, minY, maxX, maxY };
}
