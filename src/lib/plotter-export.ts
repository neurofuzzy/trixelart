import { SIDE, getTriVertices, stringToTri } from "@/lib/grid-math";
import { rotatePoint } from "@/lib/crop";
import { layerKind, type Layer } from "@/hooks/use-history";
import { hexWedgeIndex, triToHex } from "@/lib/hex-flower";
import { oklabLightness } from "@/lib/tri-pattern";
import { decodeColor, resolveColor } from "@/lib/constants";
import {
  DIR_BIT,
  MAX_DENSITY,
  MIN_DENSITY,
  clipSegmentToTriangle,
  encodeHatch,
  groupHatchMarks,
  hatchLinesInBox,
  hatchU,
  trisBox,
  type HatchDir,
} from "@/lib/hatch";
import { MAX_SKIP, MIN_SKIP, WEDGE_DIR, reachableDensities } from "@/lib/hatchify";
import { fmt } from "@/lib/svg-export";

/**
 * Single-pen plotter export.
 *
 * A plotter draws strokes, carries one pen, and charges for every pen-down
 * millimetre — so unlike the fabric exports this one cares about two things the
 * others do not: the line work must be **joined** into the longest possible
 * continuous strokes, and it must contain **no overdraw**, because a retraced
 * line is a visible blot of doubled ink as well as wasted time.
 *
 * Tone is reproduced as line density, and direction comes from the hex wedges,
 * exactly as `hatchify.ts` does — this is that feature aimed at paper instead of
 * at a layer.
 *
 * **Deliberately not cropped.** The fabric exports exist to cut a seamless
 * repeat tile out of the artwork; a plot is a drawing on a sheet, so it takes
 * the whole artwork and derives its own bounds from what is actually painted.
 * That is why this shares no state with `ExportPanel` and has its own dialog.
 *
 * Pure: no DOM, no React.
 */

export type PenMode = "black-on-white" | "white-on-black";

export const PEN_INK: Record<PenMode, string> = {
  "black-on-white": "#000000",
  "white-on-black": "#ffffff",
};
export const PEN_PAPER: Record<PenMode, string> = {
  "black-on-white": "#ffffff",
  "white-on-black": "#000000",
};

/**
 * Named sheets, in inches, **portrait**: `landscape` swaps them, so each size is
 * stored once and there is no way for the two orientations to disagree.
 * `"fit"` is not a sheet at all — it sizes the page from the artwork.
 */
export type PageSizeId =
  | "fit"
  | "a5"
  | "a4"
  | "a3"
  | "a2"
  | "letter"
  | "legal"
  | "tabloid"
  | "custom";

/** Sheet limits, inches. A2 is the largest preset; the ceiling leaves room for
 *  roll-fed plotters without letting a typo produce a mile-wide document. */
export const MIN_PAGE_IN = 1;
export const MAX_PAGE_IN = 60;
export const MAX_MARGIN_IN = 4;

export const PAGE_SIZES: { id: PageSizeId; label: string; w: number; h: number }[] =
  [
    { id: "fit", label: "Fit artwork", w: 0, h: 0 },
    { id: "a5", label: "A5", w: 5.83, h: 8.27 },
    { id: "a4", label: "A4", w: 8.27, h: 11.69 },
    { id: "a3", label: "A3", w: 11.69, h: 16.54 },
    { id: "a2", label: "A2", w: 16.54, h: 23.39 },
    { id: "letter", label: "US Letter", w: 8.5, h: 11 },
    { id: "legal", label: "US Legal", w: 8.5, h: 14 },
    { id: "tabloid", label: "US Tabloid", w: 11, h: 17 },
    { id: "custom", label: "Custom", w: 0, h: 0 },
  ];

export interface PlotterSettings {
  pen: PenMode;
  minDensity: number;
  maxDensity: number;
  densitySkip: number;
  /** The physical nib, in millimetres. Drives the SVG `stroke-width` only — it
   *  never changes which lines are drawn. */
  strokeWidthMm: number;
  /** Which sheet the plot is laid out on. */
  pageSize: PageSizeId;
  /** The `custom` sheet, portrait inches. */
  customWidthIn: number;
  customHeightIn: number;
  /** Swaps the sheet's two dimensions. Meaningless under `fit`, where the page
   *  takes the artwork's own aspect. */
  landscape: boolean;
  /** Unprintable border, inches, on all four sides. The artwork is scaled to fit
   *  what is left and centred in it. */
  marginIn: number;
  /** `fit` only: how wide the *drawing* is, inches. On a real sheet the size is
   *  the sheet's, so this is ignored. */
  artWidthIn: number;
}

export const DEFAULT_PLOTTER: PlotterSettings = {
  pen: "black-on-white",
  minDensity: 1,
  maxDensity: 7,
  // {1,3,5,7} — all odd, so every density contains the density-1 ladder and a
  // stroke survives a tone change instead of breaking at every boundary. See
  // `reachableDensities`.
  densitySkip: 2,
  strokeWidthMm: 0.3,
  pageSize: "letter",
  customWidthIn: 8,
  customHeightIn: 10,
  landscape: false,
  marginIn: 0.5,
  artWidthIn: 8,
};

/** A pen-down run. Always two points today — a merged run is collinear by
 *  construction — but kept as a point list so the emitter needs no change if
 *  chaining across directions is ever added. */
export interface PlotterStroke {
  pts: [number, number][];
}

export interface PlotterPlot {
  /** Kept apart all the way to the file so each lands in its own Inkscape
   *  layer and can be re-pen'd, reordered or plotted separately. */
  hatch: PlotterStroke[];
  outlines: PlotterStroke[];
  /** World units, pen down. */
  penDownLength: number;
  /** World units travelled between strokes, in emit order. */
  penUpLength: number;
  /** Segments before joining, for reporting how much the join won. */
  rawSegments: number;
  /** Page extent in world units — the artwork's own bounds, in display space.
   *  Strokes are already offset so the page starts at (0, 0). */
  width: number;
  height: number;
  ink: string;
  paper: string;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Two lines of the same family are the same physical line when their `u` values
 * agree to this. Distinct lines are never closer than `H / MAX_DENSITY` (~5.4
 * world units), so there is a five-order-of-magnitude margin.
 */
const U_TOL = 1e-4;

/** Collinear runs closer than this along their line are treated as touching. */
const JOIN_TOL = 1e-6 * SIDE;

/** The parameter a segment is measured by along its line — the same
 *  parameterisation `hatchLinesInBox` generates with: x for the horizontal
 *  family, y for the two diagonals. */
const along = (dir: HatchDir, x: number, y: number) => (dir === 0 ? x : y);

/** Merges the visible layers of one kind into a single map, bottom to top. */
function mergeKind(layers: Layer[], kind: "fill" | "hatch") {
  const out: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer.visible || layerKind(layer) !== kind) continue;
    Object.assign(out, layer.painted);
  }
  return out;
}

/**
 * Turns the whole artwork into hatch marks, all in the pen's colour.
 *
 * Driven by the painted keys rather than by a scan over a region: a plot has no
 * crop, so there is no box to enumerate, and walking what exists is both exact
 * and cheaper than sweeping an area that is mostly empty.
 *
 * **Hatch layers are ignored**, unlike every other export. A plot puts its lines
 * on the lattice's division lines (see `rawSegments`), while an authored hatch
 * layer is centred between them; mixing the two schemes on one sheet reads as a
 * mistake, not as emphasis. Line work drawn by hand is a screen and vector
 * feature, and this export derives all of its line work from the fills.
 */
export function plotterMarks(
  layers: Layer[],
  gridDivisions: number,
  s: PlotterSettings,
): Record<string, string> {
  const marks: Record<string, string> = {};
  if (gridDivisions <= 0) return marks;

  const fills = mergeKind(layers, "fill");
  const ink = PEN_INK[s.pen];
  const { densities } = reachableDensities(s);
  if (densities.length === 0) return marks;

  for (const key of Object.keys(fills)) {
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;

    const fill = fills[key];
    if (!fill) continue;
    // Rejects a hatch value structurally — it has pipes and no valid "p,c".
    if (!decodeColor(fill)) continue;

    const lightness = oklabLightness(resolveColor(fill));
    // Black pen on white paper: dark artwork needs more ink. White on black is
    // the exact reverse — the paper is already the darkest thing on the page.
    const a = s.pen === "black-on-white" ? 1 - lightness : lightness;

    const j = clamp(Math.round(a * (densities.length - 1)), 0, densities.length - 1);
    const density = clamp(densities[j], MIN_DENSITY, MAX_DENSITY);

    const { c, k } = triToHex(tri.q, tri.r, tri.type, gridDivisions);
    const dir = WEDGE_DIR[hexWedgeIndex(tri, c, k, gridDivisions)];

    marks[key] = encodeHatch({
      dirMask: DIR_BIT[dir],
      density,
      weight: 1,
      color: ink,
    });
  }

  return marks;
}

/**
 * Which line family an edge lies on — the one whose `u` is constant along it.
 *
 * Every lattice edge belongs to exactly one family, so this is a lookup rather
 * than a search. Worth noting: grid lines sit at `n*step` while hatch lines sit
 * at `(n + 1/2)*step`, and `2n+1 = 2md` has no integer solution — so an outline
 * can **never** land on a hatch line at any density, and the two can be joined
 * through the same pass without interfering.
 */
function edgeDir(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): HatchDir | null {
  for (const d of [0, 1, 2] as const) {
    if (Math.abs(hatchU(d, x0, y0) - hatchU(d, x1, y1)) < 1e-6) return d;
  }
  return null;
}

/**
 * Boundaries of the solid regions.
 *
 * An edge is drawn when the two triangles across it read as different colours,
 * or when there is only one — the outside of the artwork. **An edge between two
 * cells of the same colour is not a boundary and is never drawn**, which is what
 * makes this an outline of the shapes rather than a wireframe of every trixel.
 *
 * Each undirected edge is accumulated once, so an interior edge cannot be
 * emitted twice even though two triangles both claim it — that is the overdraw
 * guarantee, before the interval union ever runs.
 *
 * Colours are compared **resolved**, not encoded, deliberately breaking the
 * usual rule. Elsewhere encoded comparison is right because painted data must
 * follow palette shifts; here the question is only "does the eye see a
 * boundary", and two swatches from different palettes that resolve to the same
 * hex are one region, not two with a line between them.
 */
function outlineSegments(fills: Record<string, string>): RawSeg[] {
  const resolved = new Map<string, string>();
  const hexOf = (encoded: string) => {
    let hex = resolved.get(encoded);
    if (hex === undefined) {
      hex = resolveColor(encoded);
      resolved.set(encoded, hex);
    }
    return hex;
  };

  interface Edge {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    colors: string[];
  }
  const edges = new Map<string, Edge>();

  for (const [key, encoded] of Object.entries(fills)) {
    if (!decodeColor(encoded)) continue;
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;
    const hex = hexOf(encoded);
    const v = getTriVertices(tri.q, tri.r, tri.type);

    for (let i = 0; i < 3; i++) {
      const a = v[i];
      const b = v[(i + 1) % 3];
      const ka = `${a.x.toFixed(3)},${a.y.toFixed(3)}`;
      const kb = `${b.x.toFixed(3)},${b.y.toFixed(3)}`;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(k);
      if (e) e.colors.push(hex);
      else edges.set(k, { x0: a.x, y0: a.y, x1: b.x, y1: b.y, colors: [hex] });
    }
  }

  const out: RawSeg[] = [];
  for (const e of edges.values()) {
    if (e.colors.length >= 2 && e.colors.every((c) => c === e.colors[0])) {
      continue; // interior to one solid region
    }
    const dir = edgeDir(e.x0, e.y0, e.x1, e.y1);
    if (dir === null) continue;
    const t0 = along(dir, e.x0, e.y0);
    const t1 = along(dir, e.x1, e.y1);
    out.push({
      dir,
      u: hatchU(dir, e.x0, e.y0),
      t0: Math.min(t0, t1),
      t1: Math.max(t0, t1),
    });
  }
  return out;
}

interface RawSeg {
  dir: HatchDir;
  u: number;
  /** Interval along the line. */
  t0: number;
  t1: number;
}

/**
 * Every hatch segment the marks produce. Clipped to their triangles only —
 * there is no crop rectangle to trim against.
 *
 * **Grid-aligned, not centred** — the one place the plotter's line work differs
 * in *geometry* from the screen's. On paper the shape boundaries are already
 * drawn, as outlines, so a centred hatch sits half a division from them and the
 * tone crowds at every boundary. On the division lines the ladder is uniform
 * straight across an edge.
 *
 * The lattice's own lines are **kept**, not skipped. Dropping them looks right
 * only where an outline happens to stand in for the missing line, and an edge
 * between two cells of the same colour has no outline on it — so skipping opens
 * a double gap every `density` lines through the middle of every flat region.
 * Keeping them means a hatch span can coincide with an outline; `joinRuns`
 * subtracts the outlines from the hatch, which is where the no-overdraw
 * guarantee now comes from.
 */
function rawSegments(marks: Record<string, string>): RawSeg[] {
  const out: RawSeg[] = [];
  for (const g of groupHatchMarks(marks).groups) {
    const gen = trisBox(g.tris);
    if (!gen) continue;

    const lines = hatchLinesInBox(g.dir, g.density, gen, "grid");
    if (lines.length === 0) continue;

    for (const t of g.tris) {
      for (const line of lines) {
        const seg = clipSegmentToTriangle(line, t.q, t.r, t.type);
        if (!seg) continue;
        const [x0, y0, x1, y1] = seg;
        const a = along(g.dir, x0, y0);
        const b = along(g.dir, x1, y1);
        out.push({
          dir: g.dir,
          u: hatchU(g.dir, x0, y0),
          t0: Math.min(a, b),
          t1: Math.max(a, b),
        });
      }
    }
  }
  return out;
}

type Span = [number, number];

/** Merges a line's intervals into a disjoint, sorted set. */
function unionSpans(spans: Span[]): Span[] {
  spans.sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + JOIN_TOL) {
      if (s[1] > last[1]) last[1] = s[1];
    } else {
      out.push([s[0], s[1]]);
    }
  }
  return out;
}

/** `a \ b`, both disjoint and sorted. Linear: `b` is scanned once overall,
 *  since `a` never revisits ground an earlier interval already passed. */
function subtractSpans(a: Span[], b: Span[]): Span[] {
  if (b.length === 0) return a;
  const out: Span[] = [];
  let k = 0;
  for (const [s0, s1] of a) {
    let cur = s0;
    while (k < b.length && b[k][1] <= cur + JOIN_TOL) k++;
    for (let i = k; i < b.length && b[i][0] < s1 - JOIN_TOL; i++) {
      const [b0, b1] = b[i];
      if (b0 > cur + JOIN_TOL) out.push([cur, Math.min(b0, s1)]);
      if (b1 > cur) cur = b1;
      if (cur >= s1 - JOIN_TOL) break;
    }
    if (s1 > cur + JOIN_TOL) out.push([cur, s1]);
  }
  return out;
}

/**
 * Joins collinear runs and removes all overdraw, in one pass — and, where a
 * `mask` is given, cuts the masked spans out of the result.
 *
 * The obvious approach — chase matching endpoints and chain segments — is the
 * wrong tool here. Every segment already lies on a *known* line of a *known*
 * family, so the join is a one-dimensional interval union per line, which needs
 * no tolerance on endpoint coordinates and cannot mis-chain at a crossing.
 * Because a union is disjoint by construction, it **is** the overdraw removal:
 * duplicate and overlapping runs collapse rather than being hunted down.
 *
 * The mask is the same idea run once more. A grid-aligned hatch line lands on
 * the lattice, where an outline may already be drawing it, so the hatch is
 * joined and then has the outlines subtracted from it — the two layers carry the
 * same pen, and a retraced span is a blot. Subtraction, not exclusion at
 * generation time: the hatch line must survive wherever there is *no* outline,
 * which is most of a flat region, and only the joined outline set knows where
 * that is.
 *
 * Lines are grouped by sweeping sorted `u` rather than by hashing a rounded key.
 * Coincident lines arriving from different densities are not bitwise equal — at
 * densities 1, 3 and 7 the shared line computes to the identical double, but at
 * density 5 it differs by one ulp — so an exact key silently fails to join
 * exactly those, and a rounded key can still split a pair that straddles a
 * bucket boundary. A sweep has neither failure mode — and the same sweep is what
 * pairs a hatch line with the outline lying on it, for the same reason.
 */
function joinRuns(segs: RawSeg[], mask: RawSeg[] = []): RawSeg[] {
  const out: RawSeg[] = [];

  for (const dir of [0, 1, 2] as const) {
    const family = segs.filter((s) => s.dir === dir);
    if (family.length === 0) continue;
    const masks = mask.filter((s) => s.dir === dir).sort((a, b) => a.u - b.u);
    family.sort((a, b) => a.u - b.u);

    let i = 0;
    let m = 0;
    while (i < family.length) {
      const u0 = family[i].u;
      let j = i;
      while (j < family.length && family[j].u - u0 <= U_TOL) j++;

      // The mask lines that lie on this one, found by advancing the same sweep.
      while (m < masks.length && masks[m].u < u0 - U_TOL) m++;
      let m1 = m;
      while (m1 < masks.length && Math.abs(masks[m1].u - u0) <= U_TOL) m1++;

      const spans = subtractSpans(
        unionSpans(family.slice(i, j).map((s): Span => [s.t0, s.t1])),
        unionSpans(masks.slice(m, m1).map((s): Span => [s.t0, s.t1])),
      );
      for (const [t0, t1] of spans) {
        // A line through a single vertex clips to a point. With a round cap that
        // is a visible dot of ink, and every one of them is a pen-down cycle.
        if (t1 - t0 <= JOIN_TOL) continue;
        out.push({ dir, u: u0, t0, t1 });
      }
      i = j;
    }
  }

  return out;
}

/** Back to endpoints. `hatchU` inverted: for the diagonals x = u ± y*SKEW. */
function segToPoints(s: RawSeg): [[number, number], [number, number]] {
  const SKEW = SIDE / (2 * ((SIDE * Math.sqrt(3)) / 2));
  if (s.dir === 0) {
    return [
      [s.t0, s.u],
      [s.t1, s.u],
    ];
  }
  const sign = s.dir === 1 ? SKEW : -SKEW;
  return [
    [s.u + s.t0 * sign, s.t0],
    [s.u + s.t1 * sign, s.t1],
  ];
}

const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

/**
 * Greedy nearest-neighbour ordering, reversing a stroke when its far end is the
 * nearer one. Ordering only — it cannot change what is drawn, only how long the
 * pen spends in the air getting there.
 *
 * O(n^2), and skipped above `MAX_TRAVEL_N` where that would stall the export.
 * A hatched crop runs in the low thousands of strokes, well inside the cap.
 */
const MAX_TRAVEL_N = 8000;

function orderForTravel(strokes: PlotterStroke[]): PlotterStroke[] {
  if (strokes.length > MAX_TRAVEL_N) return strokes;
  const used = new Array(strokes.length).fill(false);
  const out: PlotterStroke[] = [];
  let cx = 0;
  let cy = 0;

  for (let n = 0; n < strokes.length; n++) {
    let best = -1;
    let bestD = Infinity;
    let bestFlip = false;
    for (let i = 0; i < strokes.length; i++) {
      if (used[i]) continue;
      const p = strokes[i].pts;
      const a = p[0];
      const b = p[p.length - 1];
      const da = dist(cx, cy, a[0], a[1]);
      if (da < bestD) {
        bestD = da;
        best = i;
        bestFlip = false;
      }
      const db = dist(cx, cy, b[0], b[1]);
      if (db < bestD) {
        bestD = db;
        best = i;
        bestFlip = true;
      }
    }
    if (best < 0) break;
    used[best] = true;
    const pts = bestFlip ? [...strokes[best].pts].reverse() : strokes[best].pts;
    out.push({ pts });
    const end = pts[pts.length - 1];
    cx = end[0];
    cy = end[1];
  }

  return out;
}

export function buildPlotterPlot(
  layers: Layer[],
  gridRotation: number,
  gridDivisions: number,
  s: PlotterSettings,
): PlotterPlot {
  const ink = PEN_INK[s.pen];
  const paper = PEN_PAPER[s.pen];

  const marks = plotterMarks(layers, gridDivisions, s);
  // Joined separately so the two stay separable all the way to the file. It
  // costs nothing: an outline sits on a grid line and a hatch line never does
  // (see `edgeDir`), so a shared pass could not have merged them anyway.
  const rawHatch = rawSegments(marks);
  // Always drawn: with the hatch on the division lines, the outlines are what
  // bound each tone — without them the coarse ladder reads as an open field of
  // parallel lines rather than as shapes.
  const rawOutline = outlineSegments(mergeKind(layers, "fill"));
  const joinedOutline = joinRuns(rawOutline);
  // Masked by the joined outlines: a grid-aligned hatch line lies on the lattice
  // and an outline may already be drawing part of it.
  const joinedHatch = joinRuns(rawHatch, joinedOutline);

  // Rotate into display space *first*, then take the bounds there. With no crop
  // to inherit an origin from, the page is exactly the artwork's own extent —
  // and measuring before the rotation would size the page wrongly under a
  // quarter turn, where width and height swap.
  const rotate = (segs: RawSeg[]) =>
    segs.map((seg) => {
      const [a, b] = segToPoints(seg);
      const [ax, ay] = rotatePoint(a[0], a[1], gridRotation);
      const [bx, by] = rotatePoint(b[0], b[1], gridRotation);
      return [ax, ay, bx, by] as [number, number, number, number];
    });
  const rotHatch = rotate(joinedHatch);
  const rotOutline = rotate(joinedOutline);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [ax, ay, bx, by] of [...rotHatch, ...rotOutline]) {
    minX = Math.min(minX, ax, bx);
    minY = Math.min(minY, ay, by);
    maxX = Math.max(maxX, ax, bx);
    maxY = Math.max(maxY, ay, by);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  const place = (rot: [number, number, number, number][]): PlotterStroke[] => {
    const out: PlotterStroke[] = rot.map(([ax, ay, bx, by]) => ({
      pts: [
        [ax - minX, ay - minY],
        [bx - minX, by - minY],
      ],
    }));
    // Ordered within its own layer: the plotter draws one layer at a time, so
    // interleaving them would only add travel. Unconditional — it cannot change
    // what is drawn, only how long the pen spends in the air, so there is
    // nothing to opt out of.
    return orderForTravel(out);
  };

  const hatch = place(rotHatch);
  const outlines = place(rotOutline);

  let penDownLength = 0;
  let penUpLength = 0;
  let cx = 0;
  let cy = 0;
  for (const st of [...hatch, ...outlines]) {
    penUpLength += dist(cx, cy, st.pts[0][0], st.pts[0][1]);
    for (let i = 1; i < st.pts.length; i++) {
      penDownLength += dist(
        st.pts[i - 1][0],
        st.pts[i - 1][1],
        st.pts[i][0],
        st.pts[i][1],
      );
    }
    const end = st.pts[st.pts.length - 1];
    cx = end[0];
    cy = end[1];
  }

  return {
    hatch,
    outlines,
    penDownLength,
    penUpLength,
    rawSegments: rawHatch.length + rawOutline.length,
    width: maxX - minX,
    height: maxY - minY,
    ink,
    paper,
  };
}

/** Every pen-down run, in plot order. */
export function allStrokes(plot: PlotterPlot): PlotterStroke[] {
  return [...plot.hatch, ...plot.outlines];
}

/** The page, and where the artwork sits on it. All lengths in inches, except
 *  `scale`, which converts world units to inches. */
export interface PlotterLayout {
  pageW: number;
  pageH: number;
  /** The printable box, i.e. the page inset by the margin. */
  innerW: number;
  innerH: number;
  margin: number;
  /** Inches per world unit. */
  scale: number;
  /** Drawn size of the artwork. */
  artW: number;
  artH: number;
  /** Where the plot's (0, 0) lands on the page. */
  offsetX: number;
  offsetY: number;
  /** The margin left no room to draw in — nothing can be exported. */
  invalid: boolean;
}

/** The sheet, portrait inches, before the orientation swap. */
export function pageSizeInches(s: PlotterSettings): { w: number; h: number } {
  if (s.pageSize === "custom") {
    return { w: s.customWidthIn, h: s.customHeightIn };
  }
  const def = PAGE_SIZES.find((p) => p.id === s.pageSize);
  return def && def.w > 0 ? { w: def.w, h: def.h } : { w: 0, h: 0 };
}

/**
 * Lays the plot out on its page: auto-scaled to fit inside the margins, and
 * centred there.
 *
 * Two modes, and the difference is which one is the free variable. On a named
 * sheet the **page** is given and the drawing is scaled down to fit inside it —
 * so a plot always fits the paper actually loaded in the machine. Under `fit`
 * the **drawing** is given (`artWidthIn`) and the page grows to hold it plus its
 * margins, which is the original behaviour: a page that is exactly the artwork.
 *
 * The margin is floored at half a nib. The stroke is centred on its path, so a
 * cap on an edge stroke would otherwise be sliced in half by the page edge —
 * this is the same half-nib the SVG used to carry as an implicit bleed, now
 * expressed as the smallest legal margin.
 *
 * Never scales past what fits: with a big sheet and a small artwork the drawing
 * is enlarged to fill the margins, since world units have no physical size of
 * their own to preserve.
 */
export function plotterLayout(
  plot: PlotterPlot,
  s: PlotterSettings,
): PlotterLayout {
  const nib = s.strokeWidthMm / 25.4;
  const margin = Math.max(s.marginIn, nib / 2);
  const aw = plot.width;
  const ah = plot.height;

  if (s.pageSize === "fit") {
    const scale = aw > 0 ? s.artWidthIn / aw : 0;
    const artW = aw * scale;
    const artH = ah * scale;
    return {
      pageW: artW + 2 * margin,
      pageH: artH + 2 * margin,
      innerW: artW,
      innerH: artH,
      margin,
      scale,
      artW,
      artH,
      offsetX: margin,
      offsetY: margin,
      invalid: scale <= 0,
    };
  }

  const sheet = pageSizeInches(s);
  const pageW = s.landscape ? sheet.h : sheet.w;
  const pageH = s.landscape ? sheet.w : sheet.h;
  const innerW = pageW - 2 * margin;
  const innerH = pageH - 2 * margin;

  if (innerW <= 0 || innerH <= 0 || aw <= 0 || ah <= 0) {
    return {
      pageW,
      pageH,
      innerW: Math.max(0, innerW),
      innerH: Math.max(0, innerH),
      margin,
      scale: 0,
      artW: 0,
      artH: 0,
      offsetX: margin,
      offsetY: margin,
      invalid: true,
    };
  }

  const scale = Math.min(innerW / aw, innerH / ah);
  const artW = aw * scale;
  const artH = ah * scale;
  return {
    pageW,
    pageH,
    innerW,
    innerH,
    margin,
    scale,
    artW,
    artH,
    offsetX: (pageW - artW) / 2,
    offsetY: (pageH - artH) / 2,
    invalid: false,
  };
}

/** For the numbers that are *scales* rather than coordinates — a page dimension
 *  in inches, or the world-to-inch factor. `fmt`'s three decimals are calibrated
 *  for world units, where they are a rounding error; on a factor of ~0.019 they
 *  are a 7% error in the size of the plot. */
function fmtHi(n: number): string {
  return String(Number(n.toPrecision(12)));
}

const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
const SODIPODI_NS = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd";

/**
 * Stroke-only SVG at true physical size, in Inkscape layers.
 *
 * The document **is** the page: its `viewBox` is the sheet, measured in inches,
 * and the artwork rides on the layout's transform inside it. So the file opens
 * at the size of the paper the plot was designed for, not at the size of the
 * marks that happen to be on it.
 *
 * Paper, hatch and outlines are three `inkscape:groupmode="layer"` groups rather
 * than one flat pile of paths, so each can be hidden, re-penned, reordered or
 * sent to the plotter on its own — which is how a two-pen or two-pass plot is
 * actually produced. The namespace declaration is what makes Inkscape read them
 * as layers instead of as anonymous groups.
 *
 * The paper is a filled `<rect>` with no stroke: plotter software follows
 * strokes, so it is ignored on the machine, but it is what makes a
 * white-on-black plot legible on screen before anyone commits a pen to paper —
 * and being its own layer it can simply be switched off.
 */
export function plotterSVG(
  plot: PlotterPlot,
  layout: PlotterLayout,
  strokeWidthMm: number,
): string {
  // One user unit is one inch: the page is a physical thing here, not a lattice,
  // so measuring the document in the same unit the user set it in keeps every
  // number in the file readable and the nib conversion trivial.
  const pageW = fmtHi(layout.pageW);
  const pageH = fmtHi(layout.pageH);
  const nib = strokeWidthMm / 25.4;

  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="${INKSCAPE_NS}" ` +
    `xmlns:sodipodi="${SODIPODI_NS}" ` +
    `viewBox="0 0 ${pageW} ${pageH}" ` +
    `width="${pageW}in" height="${pageH}in">`;

  const layer = (
    id: string,
    label: string,
    body: string,
    attrs = "",
  ): string =>
    body
      ? `  <g inkscape:groupmode="layer" id="${id}" inkscape:label="${label}"${attrs}>\n${body}\n  </g>`
      : "";

  const pathsOf = (strokes: PlotterStroke[]) =>
    strokes
      .map((st) => {
        const d = st.pts
          .map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p[0])},${fmt(p[1])}`)
          .join(" ");
        return `      <path d="${d}"/>`;
      })
      .join("\n");

  // Strokes stay in world coordinates and the placement rides on one transform,
  // so re-sizing the page changes exactly one number per layer rather than every
  // path. `stroke-width` is divided by the scale because it is applied in the
  // group's own space — the nib comes out at its true physical width.
  //
  // The transform is emitted at full precision, **not** through `fmt`: the shared
  // 3-decimal rounding is meant for world coordinates, and a scale of ~0.019
  // inches per world unit would lose 7% of the drawing's size to it. Path
  // coordinates keep using `fmt`, where a thousandth of a world unit is 20 nm on
  // the page.
  const place = layout.scale > 0
    ? ` transform="translate(${fmtHi(layout.offsetX)},${fmtHi(layout.offsetY)}) scale(${fmtHi(layout.scale)})"`
    : "";
  const penAttrs =
    ` fill="none" stroke="${plot.ink}"` +
    ` stroke-width="${fmtHi(layout.scale > 0 ? nib / layout.scale : nib)}"` +
    ` stroke-linecap="round"`;

  const inked = (id: string, label: string, strokes: PlotterStroke[]) => {
    const body = pathsOf(strokes);
    if (!body) return "";
    return layer(
      id,
      label,
      `    <g${place}${penAttrs}>\n${body}\n    </g>`,
    );
  };

  const parts = [
    layer(
      "paper",
      "Paper",
      `    <rect x="0" y="0" width="${pageW}" height="${pageH}" fill="${plot.paper}" stroke="none"/>`,
    ),
    inked("hatch", "Hatch", plot.hatch),
    inked("outlines", "Outlines", plot.outlines),
  ].filter(Boolean);

  return `${open}\n${parts.join("\n")}\n</svg>`;
}

/** Clamps a persisted settings blob back into range. */
export function normalizePlotterSettings(raw: unknown): PlotterSettings {
  const r = (raw ?? {}) as Partial<Record<keyof PlotterSettings, unknown>>;
  const num = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : dflt;

  const minDensity = Math.round(
    num(r.minDensity, MIN_DENSITY, MAX_DENSITY, DEFAULT_PLOTTER.minDensity),
  );
  return {
    pen: r.pen === "white-on-black" ? "white-on-black" : "black-on-white",
    minDensity,
    maxDensity: Math.round(
      num(
        r.maxDensity,
        minDensity,
        MAX_DENSITY,
        Math.max(minDensity, DEFAULT_PLOTTER.maxDensity),
      ),
    ),
    densitySkip: Math.round(
      num(r.densitySkip, MIN_SKIP, MAX_SKIP, DEFAULT_PLOTTER.densitySkip),
    ),
    strokeWidthMm: num(r.strokeWidthMm, 0.05, 5, DEFAULT_PLOTTER.strokeWidthMm),
    pageSize: PAGE_SIZES.some((p) => p.id === r.pageSize)
      ? (r.pageSize as PageSizeId)
      : DEFAULT_PLOTTER.pageSize,
    customWidthIn: num(
      r.customWidthIn,
      MIN_PAGE_IN,
      MAX_PAGE_IN,
      DEFAULT_PLOTTER.customWidthIn,
    ),
    customHeightIn: num(
      r.customHeightIn,
      MIN_PAGE_IN,
      MAX_PAGE_IN,
      DEFAULT_PLOTTER.customHeightIn,
    ),
    landscape:
      typeof r.landscape === "boolean"
        ? r.landscape
        : DEFAULT_PLOTTER.landscape,
    marginIn: num(r.marginIn, 0, MAX_MARGIN_IN, DEFAULT_PLOTTER.marginIn),
    artWidthIn: num(
      r.artWidthIn,
      MIN_PAGE_IN,
      MAX_PAGE_IN,
      DEFAULT_PLOTTER.artWidthIn,
    ),
  };
}

/**
 * Canvas preview: the plot as it will be drawn, on its sheet.
 *
 * The paper is drawn at the *page's* aspect, not the box's. Flooding the whole
 * canvas would misrepresent the sheet — and on a white-on-black plot it would
 * read as a black background rather than as black paper. The margin is drawn as
 * a dashed guide, since on a fixed sheet it is the thing that decides how big
 * the drawing comes out and is otherwise invisible.
 */
export function renderPlotterPreview(
  canvas: HTMLCanvasElement,
  plot: PlotterPlot,
  layout: PlotterLayout,
  pxW: number,
  pxH: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = pxW;
  canvas.height = pxH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pxW, pxH);
  if (layout.pageW <= 0 || layout.pageH <= 0) return;

  // Pixels per inch of page.
  const pad = 8;
  const ppi = Math.min(
    (pxW - 2 * pad) / layout.pageW,
    (pxH - 2 * pad) / layout.pageH,
  );
  if (!(ppi > 0)) return;
  const ox = (pxW - layout.pageW * ppi) / 2;
  const oy = (pxH - layout.pageH * ppi) / 2;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = plot.paper;
  ctx.fillRect(0, 0, layout.pageW * ppi, layout.pageH * ppi);

  if (layout.margin > 0 && layout.innerW > 0 && layout.innerH > 0) {
    ctx.save();
    ctx.strokeStyle = plot.ink;
    ctx.globalAlpha = 0.25;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(
      layout.margin * ppi,
      layout.margin * ppi,
      layout.innerW * ppi,
      layout.innerH * ppi,
    );
    ctx.restore();
  }

  if (layout.scale > 0 && plot.width > 0) {
    // World units → page inches → preview pixels.
    const s = layout.scale * ppi;
    ctx.translate(layout.offsetX * ppi, layout.offsetY * ppi);
    ctx.scale(s, s);
    ctx.strokeStyle = plot.ink;
    // A hairline at preview scale: the nib is a fraction of a millimetre and
    // would otherwise vanish, hiding exactly the density differences being
    // judged.
    ctx.lineWidth = Math.max(0.4, 0.9 / s);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const st of allStrokes(plot)) {
      ctx.moveTo(st.pts[0][0], st.pts[0][1]);
      for (let i = 1; i < st.pts.length; i++) {
        ctx.lineTo(st.pts[i][0], st.pts[i][1]);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}
