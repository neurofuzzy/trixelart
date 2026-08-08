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
 * The pen plotter is the one caller that wants the unshifted ladder anyway, for
 * reasons that only apply once the shape boundaries are being drawn as strokes
 * — see `HatchAlign`.
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

/**
 * The second triad of `dirMask`: Truchet arcs, centred on a triangle's corner.
 *
 * An arc bit reuses the family index rather than introducing a vertex numbering,
 * because **a triangle's corner is named by the edge it is opposite**, and those
 * edges are already the three line families. Everything that permutes the line
 * triad therefore permutes this one identically — a 60° turn is the same 3-cycle
 * on both, and a mirror is the same 1↔2 swap — so `rotateHatchMask` and
 * `flipHatchMask` need one extra loop and no extra reasoning.
 *
 * Deriving the corner from the families instead of from `getTriVertices`' index
 * order also sidesteps that function's two windings, and keeps the choice
 * invariant under lattice translation, which a vertex 3-colouring would not be:
 * a 3-colouring shifts class under a general translation, so moving a hatched
 * selection would silently slide its arcs onto different corners.
 */
export const ARC_BIT: Record<HatchDir, number> = { 0: 8, 1: 16, 2: 32 };

/** Every bit `dirMask` can legitimately carry. Anything loading or clamping a
 *  mask must use this — a range of 1–7 silently strips every arc. */
export const DIR_MASK_MAX = 63;

/** Line segments per arc when flattening.
 *
 * Arcs are emitted as polylines rather than as a new shape so that every
 * backend — canvas, SVG, the crop exporter, bounds — keeps consuming `Seg` and
 * needs no new case. Eight steps across the 60° sweep leaves a sagitta under
 * 0.05 world units at the classic radius, well below a stroke width, so the
 * preview and the exported file agree exactly instead of approximately. */
export const ARC_STEPS = 8;

export const MIN_DENSITY = 4;
export const MAX_DENSITY = 16;
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
  // The same 3-cycle on both triads: an arc is named by the family of the edge
  // it faces, so it turns with that edge.
  for (const bits of [DIR_BIT, ARC_BIT]) {
    for (const dir of HATCH_DIRS) {
      if (mask & bits[dir]) out |= bits[(((dir + s) % 3) as HatchDir)];
    }
  }
  return out;
}

/** Mirrors a direction mask: the horizontal family is fixed and the two
 *  diagonals swap. Both flip axes act the same way, because they differ by a
 *  180° rotation, which is the identity on undirected families. Arcs follow the
 *  edges they face, so they take the same swap. */
export function flipHatchMask(mask: number): number {
  let out = 0;
  for (const bits of [DIR_BIT, ARC_BIT]) {
    out |= mask & bits[0];
    if (mask & bits[1]) out |= bits[2];
    if (mask & bits[2]) out |= bits[1];
  }
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
 * Where a family's lines sit within a base cell.
 *
 * - `"center"` — at `(n + ½)·step`. The screen default: at density 1 the single
 *   line runs down the middle of the triangle, so `density` reads as *lines per
 *   triangle*, and no line lands on a lattice edge where the neighbouring
 *   triangle would draw it a second time.
 * - `"grid"` — at `n·step`, i.e. on the division lines **including** the
 *   lattice's own. For the pen plotter, where the shape boundaries are already
 *   drawn as outlines: a centred line sits half a division from the outline, so
 *   the tone crowds at every boundary. On the division lines the ladder is
 *   uniform straight across an edge — but only if the lattice lines are kept,
 *   since a same-coloured edge has no outline on it to stand in for the missing
 *   line, and dropping it opens a double gap every `density` lines.
 *
 * A `"grid"` line therefore *can* coincide with an outline, and the caller is
 * responsible for not drawing both — see `plotter-export.ts`, which subtracts
 * the outline spans from the hatch.
 */
export type HatchAlign = "center" | "grid";

/**
 * Every line of family `dir` at `density` that crosses `box`, as segments
 * spanning the box. Callers clip them — to a canvas clip region, or per
 * triangle for SVG.
 */
export function hatchLinesInBox(
  dir: HatchDir,
  density: number,
  box: Box,
  align: HatchAlign = "center",
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
  const shift = align === "grid" ? 0 : 0.5;
  const nMin = Math.ceil(Math.min(...us) / step - shift);
  const nMax = Math.floor(Math.max(...us) / step - shift);
  // A pathological box/density combination shouldn't be able to hang the render.
  if (nMax - nMin > 20000) return [];

  const out: Seg[] = [];
  for (let n = nMin; n <= nMax; n++) {
    const u = (n + shift) * step;
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

/**
 * Which `getTriVertices` index an arc of family `dir` centres on, per triangle
 * type: the corner opposite that family's edge.
 *
 * Read off the geometry rather than guessed. For an `up` triangle the vertices
 * are `[A, B, C] = [(q,r), (q+1,r), (q,r+1)]`; edge `AB` is horizontal
 * (family 0) so family 0 centres on `C`, `CA` is family 1 so family 1 centres on
 * `B`, and `BC` is family 2 so family 2 centres on `A`. A `down` triangle's
 * vertices come back in the order `[C, D, B]`, which is why its row is not the
 * reverse of the other.
 */
const ARC_VERTEX_IDX: Record<TriKey["type"], readonly [number, number, number]> =
  {
    up: [2, 1, 0],
    down: [2, 0, 1],
  };

/**
 * Radii of the concentric arc ladder at `density`.
 *
 * The same `(n + ½)·step` ladder the line families use, and **the half step is
 * load-bearing for the same reason twice over**. It keeps radius 0 and radius
 * `SIDE` — the degenerate point and the full edge — out of the set, and it makes
 * the ladder symmetric about `SIDE/2`, so the complement of `r[n]` is exactly
 * `r[k−1−n]`.
 *
 * That symmetry is what makes arcs *chain*. Across a shared edge the two
 * triangles centre their arcs on opposite ends of it, so an arc of radius `r`
 * from one end meets an arc of radius `SIDE − r` from the other at the same
 * point — and only a self-complementary ladder guarantees that partner exists.
 * Both cross the edge perpendicularly, so they join smoothly and curve opposite
 * ways: the S-bend that turns separate arcs into long wandering paths.
 *
 * Density 1 is the classic single arc through the edge midpoints.
 */
export function arcRadii(density: number): number[] {
  const k = Math.max(1, Math.round(density));
  const out: number[] = [];
  for (let n = 0; n < k; n++) out.push(((n + 0.5) * SIDE) / k);
  return out;
}

/**
 * One triangle's arcs for family `dir`, flattened to segments.
 *
 * The sweep is the triangle's 60° interior angle at the centre vertex, taken the
 * short way round. Arcs beyond radius `H` bulge past the opposite edge; they are
 * left alone here and clipped by the caller, exactly as an over-long hatch line
 * is.
 */
export function arcSegmentsInTri(
  dir: HatchDir,
  density: number,
  q: number,
  r: number,
  type: TriKey["type"],
): Seg[] {
  const v = getTriVertices(q, r, type);
  const ci = ARC_VERTEX_IDX[type][dir];
  const c = v[ci];
  const p1 = v[(ci + 1) % 3];
  const p2 = v[(ci + 2) % 3];

  const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const out: Seg[] = [];
  for (const rad of arcRadii(density)) {
    let px = c.x + rad * Math.cos(a1);
    let py = c.y + rad * Math.sin(a1);
    for (let i = 1; i <= ARC_STEPS; i++) {
      const t = a1 + (sweep * i) / ARC_STEPS;
      const nx = c.x + rad * Math.cos(t);
      const ny = c.y + rad * Math.sin(t);
      out.push([px, py, nx, ny]);
      px = nx;
      py = ny;
    }
  }
  return out;
}

export interface HatchGroup {
  /** `"line"` — a family of straight lines, generated once for the whole group.
   *  `"arc"` — Truchet arcs, generated per triangle because the centre moves
   *  with the triangle. */
  kind: "line" | "arc";
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

    for (const [kind, bits] of [
      ["line", DIR_BIT],
      ["arc", ARC_BIT],
    ] as const) {
      for (const dir of HATCH_DIRS) {
        if (!(h.dirMask & bits[dir])) continue;
        const gk = `${kind}|${dir}|${h.density}|${h.weight}|${h.color}`;
        const g = byKey.get(gk);
        if (g) g.tris.push(tri);
        else {
          byKey.set(gk, {
            kind,
            dir,
            density: h.density,
            weight: h.weight,
            color: h.color,
            tris: [tri],
          });
        }
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
