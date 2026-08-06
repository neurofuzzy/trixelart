import { stringToTri } from "@/lib/grid-math";
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
  hatchStep,
  hatchU,
  trisBox,
  type HatchDir,
  type Seg,
} from "@/lib/hatch";
import { WEDGE_DIR } from "@/lib/hatchify";
import { fmt } from "@/lib/svg-export";
import { H, triEdgeNeighbors, triToString, type TriKey } from "@/lib/grid-math";
import { ROUND_RADIUS_AT_FULL } from "@/lib/round-corners";
import { layersRoundFraction } from "@/lib/hatch-render";
import { loadClipper, type ClipperApi, type PlotPoly } from "@/lib/clipper-offset";
import {
  boundaryStrokes,
  closeRing,
  contourFill,
  regionPolys,
  type PlotRegion,
} from "@/lib/plot-geometry";
import {
  along,
  joinRuns,
  outlineSegments,
  segToPoints,
  type RawSeg,
} from "@/lib/region-outline";

/**
 * Single-pen plotter export.
 *
 * A plotter draws strokes, carries one pen, and charges for every pen-down
 * millimetre — so unlike the fabric exports this one cares about two things the
 * others do not: the line work must be **joined** into the longest possible
 * continuous strokes, and it must contain **no overdraw**, because a retraced
 * line is a visible blot of doubled ink as well as wasted time.
 *
 * Tone is reproduced as line density under either fill style. **Hatch** takes
 * its direction from the hex wedges, exactly as `hatchify.ts` does — this is
 * that feature aimed at paper instead of at a layer. **Contour** fills each
 * region with concentric insets of its own boundary instead, at the spacing that
 * density denotes, so the two styles lay down the same ink per unit area and
 * share the whole tone ladder.
 *
 * **Corner rounding is honoured**, and it is what forced the second geometry
 * path. Everything here used to work in `RawSeg` space — a line family, which
 * line of it, and an interval along that line — which is what makes `joinRuns`
 * a one-dimensional interval union rather than a segment-chaining problem, and
 * is exactly why it cannot express an arc. When there is a radius to honour, or
 * a contour fill to draw, the export switches to the polygon representation in
 * `plot-geometry.ts` and joins by welding vertices instead. The plain
 * square-cornered hatch keeps the original path untouched, so the common case
 * neither changes nor pays for Clipper.
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

/**
 * How a tone is laid down.
 *
 * `hatch` is the original: parallel lines on the lattice's division lines, their
 * direction taken from the hex wedge each trixel falls in. `contour` fills each
 * region with concentric insets of its own boundary, which is the fill that
 * follows a rounded silhouette rather than fighting it — and the only one that
 * can be drawn without a hex lattice to take a direction from.
 */
export type FillStyle = "hatch" | "contour";

export interface PlotterSettings {
  pen: PenMode;
  /** Parallel lines, or concentric insets. See `FillStyle`. */
  fillStyle: FillStyle;
  /** The tone ramp's two ends, in divisions per triangle. Every integer between
   *  them is a tone level — the plotter's hatch sits on the lattice's division
   *  lines, where every density already contains the lattice ladder, so there is
   *  nothing for a skip to buy (it existed to keep coincident lines joinable
   *  under the centred scheme). */
  minDensity: number;
  maxDensity: number;
  /** Leave the no-ink end of the ramp unhatched — outlines only. That is the
   *  lightest tone with a black pen and the darkest with a white one. */
  blankLightest: boolean;
  /** The physical nib, in millimetres. Drives the SVG `stroke-width` only — it
   *  never changes which lines are drawn. */
  strokeWidthMm: number;
  /** Clearance held between the hatch and every outline, **millimetres on the
   *  page**. A plotter blots where it dwells, and every hatch line ends on a
   *  boundary an outline is already drawing, so the two bleed together; this
   *  buys a gap. Physical, hence millimetres like the nib rather than world
   *  units that would change size with the sheet. `0` disables it and means the
   *  original geometry exactly. Contour fills ignore it — their rings are closed
   *  loops one spacing in, with no ends to blot. */
  hatchInsetMm: number;
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

/**
 * Ceiling on the hatch inset, millimetres.
 *
 * Well past the bleed of any pen this export is aimed at — the point of the cap
 * is that an inset larger than the hatch spacing erodes a region's fill away
 * entirely, and 2 mm is already generous enough to show that in the preview
 * before it can be reached by accident.
 */
export const MAX_HATCH_INSET_MM = 2;

export const DEFAULT_PLOTTER: PlotterSettings = {
  pen: "black-on-white",
  fillStyle: "hatch",
  minDensity: MIN_DENSITY,
  maxDensity: 10,
  blankLightest: false,
  strokeWidthMm: 0.3,
  hatchInsetMm: 0,
  pageSize: "letter",
  customWidthIn: 8,
  customHeightIn: 10,
  landscape: false,
  marginIn: 0.5,
  artWidthIn: 8,
};

/** A pen-down run. Two points on the `RawSeg` path, where a merged run is
 *  collinear by construction; an arbitrary polyline on the polygon path, where
 *  `boundaryStrokes` chains through corners and a contour is a closed loop. */
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
 * The tone ladder, lightest first: every density from `min` to `max`, optionally
 * led by `0` — the "leave it blank" rung, which is outlines only.
 *
 * Unlike hatchify's `reachableDensities` there is no skip. That existed so the
 * reachable densities would share lines under the centred scheme; on the
 * division lines every density already contains the lattice ladder, so a skip
 * would only throw away tone levels.
 */
export function plotterDensities(s: PlotterSettings): number[] {
  const lo = clamp(Math.round(s.minDensity), MIN_DENSITY, MAX_DENSITY);
  const hi = clamp(Math.round(s.maxDensity), lo, MAX_DENSITY);
  const out: number[] = s.blankLightest ? [0] : [];
  for (let d = lo; d <= hi; d++) out.push(d);
  return out;
}

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
 * The tone ladder rung each **resolved** colour in the artwork plots at.
 *
 * Keyed on the resolved hex rather than the encoded value, deliberately breaking
 * the usual rule for the same reason `region-outline.ts` does: two swatches from
 * different palettes that resolve to the same colour are one tone on paper and
 * one region on the sheet, so they must not be able to land on different rungs.
 * That is also what lets the contour fill look a region's density up by the very
 * key `regionRings` grouped it under.
 *
 * The range is normalised to what is actually painted, so the darkest colour
 * present always plots at the top of the ladder and the lightest at the bottom.
 * Absolute lightness wastes most of the ramp: the palettes span roughly 12%–88%,
 * and four of them top out at 68%, so a piece drawn from one of those would
 * never reach either end of the density range.
 */
export function plotterTones(
  fills: Record<string, string>,
  s: PlotterSettings,
): Map<string, number> {
  const out = new Map<string, number>();
  const ladder = plotterDensities(s);
  if (ladder.length === 0) return out;

  // Lightness per *encoded* colour, not per trixel: an artwork uses a handful of
  // swatches over thousands of cells, and this is two colour-space conversions.
  const seen = new Map<string, { hex: string; l: number }>();
  for (const key in fills) {
    const encoded = fills[key];
    if (seen.has(encoded)) continue;
    // Rejects a hatch value structurally — it has pipes and no valid "p,c" —
    // and a NO_PRINT marker along with it.
    if (!decodeColor(encoded)) continue;
    // A cell that cannot be placed cannot be drawn, so it must not widen the
    // range either; the ramp is normalised to what actually reaches the paper.
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;
    const hex = resolveColor(encoded);
    seen.set(encoded, { hex, l: oklabLightness(hex) });
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const { l } of seen.values()) {
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  if (!Number.isFinite(lo)) return out;
  const span = hi - lo;

  for (const { hex, l } of seen.values()) {
    // 1 = the darkest thing in the artwork, 0 = the lightest. A single-tone
    // piece has no range to normalise against, so it falls back to absolute
    // lightness rather than dividing by zero and plotting one arbitrary density.
    const dark = span > 1e-6 ? (hi - l) / span : 1 - l;
    // Black pen on white paper: dark artwork needs more ink. White on black is
    // the exact reverse — the paper is already the darkest thing on the page.
    const a = s.pen === "black-on-white" ? dark : 1 - dark;
    const j = clamp(Math.round(a * (ladder.length - 1)), 0, ladder.length - 1);
    out.set(hex, ladder[j]);
  }

  return out;
}

/**
 * The hatch direction a trixel takes, from the hex wedge it falls in.
 *
 * Purely geometric — it never consults `painted` — which is what lets the
 * overhang fringe (`fringeCells`) ask the same question of an *empty* cell and
 * get the answer the artwork would have given if that cell had been painted.
 */
function wedgeDir(tri: TriKey, gridDivisions: number): HatchDir {
  const { c, k } = triToHex(tri.q, tri.r, tri.type, gridDivisions);
  return WEDGE_DIR[hexWedgeIndex(tri, c, k, gridDivisions)];
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
  const tones = plotterTones(fills, s);
  if (tones.size === 0) return marks;

  for (const key in fills) {
    const encoded = fills[key];
    if (!decodeColor(encoded)) continue;
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;

    const density = tones.get(resolveColor(encoded)) ?? 0;
    // Density 0 is the `blankLightest` rung: outlines only, no hatching.
    if (density <= 0) continue;

    marks[key] = encodeHatch({
      dirMask: DIR_BIT[wedgeDir(tri, gridDivisions)],
      density,
      weight: 1,
      color: ink,
    });
  }

  return marks;
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

const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

const isClosed = (pts: [number, number][]) =>
  pts.length > 2 &&
  pts[0][0] === pts[pts.length - 1][0] &&
  pts[0][1] === pts[pts.length - 1][1];

/**
 * A closed stroke re-cut to start at whichever of its points is nearest the pen.
 *
 * A loop has no natural beginning, so leaving it where the geometry happened to
 * produce one makes the pen fly to an arbitrary point on a contour it may
 * already be standing next to. Only worth doing once the stroke has been chosen
 * — this is linear in the stroke, where scoring every point of every candidate
 * would be quadratic in the whole plot.
 */
function rotateClosed(
  pts: [number, number][],
  cx: number,
  cy: number,
): [number, number][] {
  const ring = pts.slice(0, -1); // drop the repeated closing point
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = dist(cx, cy, ring[i][0], ring[i][1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best === 0) return pts;
  const rotated = [...ring.slice(best), ...ring.slice(0, best)];
  rotated.push(rotated[0]);
  return rotated;
}

/**
 * Greedy nearest-neighbour ordering, reversing a stroke when its far end is the
 * nearer one and re-cutting a closed one to start where the pen already is.
 * Ordering only — it cannot change what is drawn, only how long the pen spends
 * in the air getting there.
 *
 * O(n^2), and skipped above `MAX_TRAVEL_N` where that would stall the export.
 * A hatched crop runs in the low thousands of strokes, well inside the cap; a
 * contour fill produces far fewer, since a whole ring is one stroke.
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
    const chosen = strokes[best].pts;
    const pts = isClosed(chosen)
      ? rotateClosed(chosen, cx, cy)
      : bestFlip
        ? [...chosen].reverse()
        : chosen;
    out.push({ pts });
    const end = pts[pts.length - 1];
    cx = end[0];
    cy = end[1];
  }

  return out;
}

/** One trixel emitting hatch for one region: either a painted cell, or a fringe
 *  cell the region's rounded ring bulges into. */
interface HatchCell {
  tri: TriKey;
  dir: HatchDir;
  density: number;
  region: number;
}

/**
 * The trixels a region's rounded ring can reach that the region does not own.
 *
 * A rounded corner leaves the lattice in **two** directions. Where it is convex
 * it cuts into the region's own trixels, and clipping the hatch to the ring is
 * the whole fix. Where it is **reflex** it does the opposite: the ring bulges
 * *past* the trixels into a neighbouring cell, which no painted cell hatches —
 * so the outline drew an arc around blank paper. The excursion is not small: at
 * a 60° reflex wedge the arc stands a full `r` clear of the vertex, and `r`
 * runs to one cell stride (`ROUND_RADIUS_AT_FULL`).
 *
 * So give the overhang a source cell. Every neighbour within reach emits hatch
 * at **the region's** density and **its own** wedge direction — the same
 * `wedgeDir` painted cells use, which needs no paint to answer — and the region
 * clip in `rawSegmentsInRegions` then trims it to exactly the crescent.
 *
 * Whole cells, not a dilated triangle. Inflating a painted triangle's clip
 * half-planes is a smaller change but spills into same-region neighbours whose
 * wedge direction differs, cross-hatching along every wedge seam inside a
 * region; and the two cells flanking a reflex wedge both reach into it, with
 * different directions, so they overlap. A lattice cell has exactly one wedge,
 * so cell-sized extensions are disjoint by construction.
 *
 * The extension costs no strokes. `hatchLinesInBox(…, "grid")` places lines at
 * absolute `n·step`, so a fringe cell's lines are collinear continuations of
 * the ones they abut and `joinRuns` merges the two into a single run.
 *
 * Cells of *another* colour are candidates too: where A is reflex, B is convex
 * and cut back by the same arc (`cornerAt` takes `acos(dot)`, which is
 * orientation-independent), so the two abut rather than overlap. A `NO_PRINT`
 * marker is a candidate for the same reason, and forces its corner sharp
 * upstream anyway, so it produces no bulge to fill.
 */
function fringeCells(
  fills: Record<string, string>,
  indexFor: (encoded: string | undefined) => number | undefined,
  densities: number[],
  radius: number,
  gridDivisions: number,
): HatchCell[] {
  const world = radius * ROUND_RADIUS_AT_FULL;
  if (!(world > 0) || gridDivisions <= 0) return [];
  // How far the bulge can reach, in edge steps: the arc stands at most `world`
  // clear of the vertex and one step advances at least `H`, so this covers it
  // whatever the corner. Over-reaching costs Clipper time and nothing else —
  // a cell the ring does not actually cover clips away to nothing.
  const depth = 1 + Math.ceil(world / H);

  const own = new Map<number, TriKey[]>();
  for (const key in fills) {
    const region = indexFor(fills[key]);
    if (region === undefined) continue;
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;
    const list = own.get(region);
    if (list) list.push(tri);
    else own.set(region, [tri]);
  }

  const out: HatchCell[] = [];
  for (const [region, cells] of own) {
    const density = densities[region] ?? 0;
    // Density 0 is the `blankLightest` rung: outlines only, so nothing to
    // extend. Same test `plotterMarks` applies to a painted cell.
    if (density <= 0) continue;

    // Seeding `seen` with the region's own cells is what makes every trixel the
    // walk reaches a cell the region does not own — unpainted, NO_PRINT, or
    // another colour.
    const seen = new Set(cells.map(triToString));
    let frontier = cells;
    for (let step = 0; step < depth; step++) {
      const next: TriKey[] = [];
      for (const t of frontier) {
        for (const n of triEdgeNeighbors(t)) {
          const k = triToString(n);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(n);
          out.push({
            tri: n,
            dir: wedgeDir(n, gridDivisions),
            density,
            region,
          });
        }
      }
      frontier = next;
    }
  }
  return out;
}

/**
 * The hatch, clipped to the **rounded** regions rather than to bare triangles.
 *
 * The lines are generated exactly as `rawSegments` generates them, and still
 * clipped to their own triangle first — that is what keeps each trixel drawing
 * the direction its hex wedge asks for. The extra pass is what rounding needs:
 * at a rounded corner the region's edge has left the lattice, so a
 * triangle-clipped line pokes straight through the arc the outline is drawing.
 *
 * The emitting cells are the painted trixels **plus** `fringeCells` — the ones
 * a reflex corner bulges into, which no painted trixel would otherwise hatch.
 * Both kinds go through the same clip, so the region ring decides the extent of
 * every line in both directions.
 *
 * Clipping is batched **per region and line family**, not per segment: Clipper
 * costs far more to set up than to run, and a region's whole hatch goes through
 * in one call. Lines are generated per **(family, density)** rather than per
 * mark group, because a fringe cell carries its region's density and its own
 * direction and so need not match any group the marks produced.
 *
 * Clipper drops a line lying exactly *on* the clip boundary, which is why this
 * path passes no mask to `joinRuns`. The grid-aligned hatch sits on the lattice
 * and an outline is already drawing every boundary stretch of it; the clip
 * removes precisely those spans, and it does so against the true rounded
 * boundary rather than against the straight lattice edge the outline has left.
 */
function rawSegmentsInRegions(
  marks: Record<string, string>,
  fills: Record<string, string>,
  regions: PlotRegion[],
  densities: number[],
  radius: number,
  gridDivisions: number,
  api: ClipperApi,
): RawSeg[] {
  const regionOf = new Map<string, number>();
  regions.forEach((r, i) => regionOf.set(r.fill, i));
  const resolved = new Map<string, number | undefined>();
  const indexFor = (encoded: string | undefined) => {
    if (encoded === undefined) return undefined;
    if (!resolved.has(encoded)) {
      resolved.set(
        encoded,
        decodeColor(encoded) ? regionOf.get(resolveColor(encoded)) : undefined,
      );
    }
    return resolved.get(encoded);
  };

  const cells: HatchCell[] = [];
  for (const g of groupHatchMarks(marks).groups) {
    for (const t of g.tris) {
      const region = indexFor(fills[triToString(t)]);
      if (region === undefined) continue;
      cells.push({ tri: t, dir: g.dir, density: g.density, region });
    }
  }
  cells.push(
    ...fringeCells(fills, indexFor, densities, radius, gridDivisions),
  );

  /** Emitting cells bucketed by the line geometry they share. */
  const families = new Map<
    string,
    { dir: HatchDir; density: number; cells: HatchCell[] }
  >();
  for (const cell of cells) {
    const fk = `${cell.dir}|${cell.density}`;
    const family = families.get(fk);
    if (family) family.cells.push(cell);
    else families.set(fk, { dir: cell.dir, density: cell.density, cells: [cell] });
  }

  /** Triangle-clipped lines, bucketed by the region and family they belong to.
   *  A region is one resolved colour, so `density` is the same for every cell
   *  in a bucket — which is what lets the emit loop below snap `u`. */
  const buckets = new Map<
    string,
    { dir: RawSeg["dir"]; density: number; region: number; segs: Seg[] }
  >();

  for (const f of families.values()) {
    const gen = trisBox(f.cells.map((c) => c.tri));
    if (!gen) continue;

    const lines = hatchLinesInBox(f.dir, f.density, gen, "grid");
    if (lines.length === 0) continue;

    for (const { tri, region } of f.cells) {
      const bk = `${region}|${f.dir}`;
      let bucket = buckets.get(bk);
      if (!bucket) {
        bucket = { dir: f.dir, density: f.density, region, segs: [] };
        buckets.set(bk, bucket);
      }
      for (const line of lines) {
        const seg = clipSegmentToTriangle(line, tri.q, tri.r, tri.type);
        if (seg) bucket.segs.push(seg);
      }
    }
  }

  const out: RawSeg[] = [];
  for (const { dir, density, region, segs } of buckets.values()) {
    // `u` is snapped back onto the ladder it was generated on. Clipper is an
    // integer library and rounds every coordinate to `1/CLIPPER_SCALE`; for the
    // horizontal family `u` is `y` and that rounding is shared by every point
    // on the line, but for the two diagonals `u` is `x ∓ y·SKEW` — a
    // *combination* of two independently rounded coordinates, read at a
    // different point on each piece. Measured spread: 1.5e-3, against
    // `joinRuns`' `U_TOL` of 1e-4. So a diagonal line arrived as fifteen
    // different lines and `joinRuns` could not merge any of it — not the
    // fringe's continuations, and not the pieces every arc had already split.
    //
    // Exact, not a widened tolerance: every line here was generated at `n·step`
    // by `hatchLinesInBox(…, "grid")`, and `step` is at least `H/MAX_DENSITY`
    // ≈ 2.7 world units, so the snap is unambiguous by three orders of
    // magnitude.
    const step = hatchStep(dir, density);
    for (const [x0, y0, x1, y1] of api.clipLines(segs, regions[region].rings)) {
      const a = along(dir, x0, y0);
      const b = along(dir, x1, y1);
      const u = hatchU(dir, x0, y0);
      out.push({
        dir,
        u: step > 0 ? Math.round(u / step) * step : u,
        t0: Math.min(a, b),
        t1: Math.max(a, b),
      });
    }
  }
  return out;
}

/** A joined run as a two-point polyline, so both geometry paths hand the
 *  placement stage the same shape. */
const segPoly = (seg: RawSeg): PlotPoly => {
  const [a, b] = segToPoints(seg);
  return [a, b];
};

/**
 * Into display space. Bounds are always taken *after* this, never before: with
 * no crop to inherit an origin from the page is exactly the artwork's own
 * extent, and measuring first would size it wrongly under a quarter turn, where
 * width and height swap.
 */
const rotate = (polys: PlotPoly[], gridRotation: number): PlotPoly[] =>
  polys.map((poly) =>
    poly.map(([x, y]) => rotatePoint(x, y, gridRotation) as [number, number]),
  );

/** World extent of a set of polylines; the zero box when there are none. */
function boundsOf(polys: PlotPoly[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/**
 * The hatch inset in world units, from the setting's millimetres on the page.
 *
 * The conversion needs `PlotterLayout.scale`, which is inches per world unit
 * and is normally read off a finished plot — but the inset has to be known
 * *while* the hatch is being built. It can be: `plotterLayout` reads nothing
 * but the extent, and on this path the hatch is clipped inside the region rings
 * while the outlines **are** those rings, so the outlines alone bound the plot
 * and give the identical figure. An invalid layout (the margin has eaten the
 * page) yields no scale and no inset; nothing can be exported there anyway.
 */
function hatchInsetWorld(
  outlinePolys: PlotPoly[],
  gridRotation: number,
  s: PlotterSettings,
): number {
  if (!(s.hatchInsetMm > 0)) return 0;
  const b = boundsOf(rotate(outlinePolys, gridRotation));
  const { scale } = plotterLayout(
    { width: b.maxX - b.minX, height: b.maxY - b.minY },
    s,
  );
  return scale > 0 ? s.hatchInsetMm / 25.4 / scale : 0;
}

/**
 * The plot: what the pen draws, in world units, with the page's origin at
 * (0, 0).
 *
 * **Async** because the polygon path loads Clipper on demand — see
 * `clipper-offset.ts`. A square-cornered hatch takes the original `RawSeg` path
 * and resolves without ever touching it.
 */
export async function buildPlotterPlot(
  layers: Layer[],
  gridRotation: number,
  gridDivisions: number,
  s: PlotterSettings,
): Promise<PlotterPlot> {
  const ink = PEN_INK[s.pen];
  const paper = PEN_PAPER[s.pen];

  // The merged map is fed to the region walk **with its NO_PRINT markers
  // intact**: they never draw (every consumer here rejects them through
  // `decodeColor`), but `boundaryVertexDegrees` deliberately admits them, and
  // that is the entire mechanism by which a marker forces a corner to stay
  // sharp. Stripping them would silently round the corners the artist kinked.
  const fills = mergeKind(layers, "fill");
  // One radius for the whole plot. This export merges the fill stack before it
  // looks at any geometry, so a per-layer radius cannot survive — same rule, and
  // same reasoning, as every other export that takes a merged map.
  const radius = layersRoundFraction(layers);

  let hatchPolys: PlotPoly[];
  let outlinePolys: PlotPoly[];
  let rawCount: number;

  if (radius <= 0 && s.fillStyle === "hatch" && s.hatchInsetMm <= 0) {
    // The original path, untouched: square corners and parallel lines need no
    // polygons, no welding and no Clipper. An inset does need them — it is a
    // polygon erosion — so a square-cornered plot that asks for one goes the
    // other way, where `regionPolys(fills, 0)` hands back the plain lattice
    // rings. With the inset off this is the condition it has always been.
    const marks = plotterMarks(layers, gridDivisions, s);
    // Joined separately so the two stay separable all the way to the file. It
    // costs nothing: an outline sits on a grid line and a hatch line never does
    // (see `edgeDir`), so a shared pass could not have merged them anyway.
    const rawHatch = rawSegments(marks);
    // Always drawn: with the hatch on the division lines, the outlines are what
    // bound each tone — without them the coarse ladder reads as an open field of
    // parallel lines rather than as shapes.
    const rawOutline = outlineSegments(fills);
    const joinedOutline = joinRuns(rawOutline);
    // Masked by the joined outlines: a grid-aligned hatch line lies on the
    // lattice and an outline may already be drawing part of it.
    const joinedHatch = joinRuns(rawHatch, joinedOutline);

    hatchPolys = joinedHatch.map(segPoly);
    outlinePolys = joinedOutline.map(segPoly);
    rawCount = rawHatch.length + rawOutline.length;
  } else {
    const api = await loadClipper();
    const regions = regionPolys(fills, radius);
    // A region's rings *are* its boundaries — an edge interior to one colour
    // never appears in one — so this is the same edge set `outlineSegments`
    // produces, with the shared boundaries drawn once instead of twice.
    outlinePolys = boundaryStrokes(regions);
    rawCount = regions.reduce(
      (n, r) => n + r.rings.reduce((m, ring) => m + ring.length, 0),
      0,
    );

    // The ladder, indexed the way both fills want it. A region *is* a resolved
    // colour, so its density is uniform — which is what lets the hatch fringe
    // give an unpainted cell the density of the region overhanging it.
    const tones = plotterTones(fills, s);
    const densities = regions.map((r) => tones.get(r.fill) ?? 0);

    if (s.fillStyle === "contour") {
      hatchPolys = [];
      regions.forEach((region, i) => {
        const density = densities[i];
        // Density 0 is the `blankLightest` rung: outlines only, no fill.
        if (density <= 0) return;
        // `H / density` is the perpendicular spacing the hatch would have used
        // at this rung — the same for all three families — so a contour lays
        // down the same ink per unit area and the tone ladder carries over.
        for (const ring of contourFill(region.rings, H / density, api)) {
          hatchPolys.push(closeRing(ring));
        }
      });
      rawCount += hatchPolys.length;
    } else {
      // Holding the hatch clear of the outline is an **erosion of the region**,
      // not a trim off each line's ends. That is what makes the clearance
      // perpendicular: every line stops the same distance from the boundary
      // whatever angle it meets it at, which is the distance ink actually
      // bleeds across. Trimming a fixed length along each line would leave a
      // shallow crossing far closer to the outline than a square one — exactly
      // the case that blots.
      //
      // `api.offset` is the primitive `contourFill` insets with, and it returns
      // empty when a shape is consumed: a region thinner than the gap simply
      // plots as its own outline, which is the honest answer.
      const inset = hatchInsetWorld(outlinePolys, gridRotation, s);
      const hatchRegions =
        inset > 0
          ? regions.map((r) => ({ ...r, rings: api.offset(r.rings, -inset) }))
          : regions;

      const marks = plotterMarks(layers, gridDivisions, s);
      const rawHatch = rawSegmentsInRegions(
        marks,
        fills,
        hatchRegions,
        densities,
        radius,
        gridDivisions,
        api,
      );
      hatchPolys = joinRuns(rawHatch).map(segPoly);
      rawCount += rawHatch.length;
    }
  }

  const rotHatch = rotate(hatchPolys, gridRotation);
  const rotOutline = rotate(outlinePolys, gridRotation);
  const { minX, minY, maxX, maxY } = boundsOf([...rotHatch, ...rotOutline]);

  const place = (polys: PlotPoly[]): PlotterStroke[] => {
    const out: PlotterStroke[] = polys.map((poly) => ({
      pts: poly.map(([x, y]) => [x - minX, y - minY] as [number, number]),
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
    rawSegments: rawCount,
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
  // Only the extent is read, and `buildPlotterPlot` needs the scale *before* it
  // has a finished plot to hand — the hatch inset is set in millimetres on the
  // page, so it cannot be resolved to world units until the scale is known.
  plot: { width: number; height: number },
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
    fillStyle: r.fillStyle === "contour" ? "contour" : "hatch",
    minDensity,
    maxDensity: Math.round(
      num(
        r.maxDensity,
        minDensity,
        MAX_DENSITY,
        Math.max(minDensity, DEFAULT_PLOTTER.maxDensity),
      ),
    ),
    blankLightest:
      typeof r.blankLightest === "boolean"
        ? r.blankLightest
        : DEFAULT_PLOTTER.blankLightest,
    strokeWidthMm: num(r.strokeWidthMm, 0.05, 5, DEFAULT_PLOTTER.strokeWidthMm),
    hatchInsetMm: num(
      r.hatchInsetMm,
      0,
      MAX_HATCH_INSET_MM,
      DEFAULT_PLOTTER.hatchInsetMm,
    ),
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
