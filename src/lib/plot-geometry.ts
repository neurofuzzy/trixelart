import { SIDE } from "@/lib/grid-math";
import { flattenRoundedRing, stepRegionGeometry } from "@/lib/round-corners";
import {
  PLOT_SAGITTA,
  type ClipperApi,
  type PlotPoly,
} from "@/lib/clipper-offset";

/**
 * The plotter's polygon layer: regions as closed polylines, their boundaries
 * welded into the longest possible strokes, and concentric fills inside them.
 *
 * The rest of the plotter export works in `RawSeg` space — a family, which line
 * of it, and an interval along that line (`region-outline.ts`). That
 * representation is what makes joining a one-dimensional interval union, and it
 * is exactly why it cannot express a rounded corner: an arc is not a run along a
 * lattice line. This module is the alternative representation the export
 * switches to when there is rounding to honour or a contour fill to draw.
 *
 * Everything here is in **world units**, before the display rotation.
 *
 * Pure: no DOM, no React.
 */

/** One resolved colour's area: its outer boundaries and its holes, flattened. */
export interface PlotRegion {
  /** Resolved hex. Only used to look the region's tone up — the pen has one
   *  colour, so this never reaches the file. */
  fill: string;
  /** Closed rings, no repeated final point. Outer boundaries and holes are not
   *  distinguished; the winding tells them apart and Clipper reads it. */
  rings: PlotPoly[];
}

/**
 * Every region of the artwork as flattened closed rings, rounded by `radius`.
 *
 * Shares `stepRegionGeometry` with the canvas and both SVG exporters, so the
 * plot's idea of where a region begins is the same one the screen shows, down to
 * the clamped radius at every corner. `radius` is the 0–1 slider fraction.
 *
 * The `painted` map handed in should **not** have had `NO_PRINT` stripped from
 * it. Markers never draw — `decodeColor` rejects them and every consumer here
 * skips them for free — but `boundaryVertexDegrees` deliberately admits them,
 * and that is the whole mechanism by which a marker forces a corner to stay
 * sharp. Filtering them out earlier would silently round the corners the artist
 * had kinked.
 */
export function regionPolys(
  painted: Record<string, string>,
  radius: number,
): PlotRegion[] {
  return stepRegionGeometry(painted, radius).map(({ fill, rings }) => ({
    fill,
    rings: rings
      .map((ring) => flattenRoundedRing(ring, PLOT_SAGITTA))
      .filter((ring) => ring.length >= 3),
  }));
}

/**
 * Two ring vertices this close are the same point.
 *
 * The same order as `JOIN_TOL`, and for the same reason: neighbouring regions
 * derive a shared boundary from identical geometry but by opposite traversals,
 * so their coordinates agree to floating-point noise rather than bitwise.
 */
const WELD_EPS = 1e-4 * SIDE;

/**
 * Snaps near-coincident points onto shared identities.
 *
 * Bucketed on a `WELD_EPS` grid and probed over the 3×3 neighbourhood, because
 * a pair straddling a bucket boundary is otherwise the one case a hash misses —
 * the same failure mode `joinRuns` avoids by sweeping sorted `u` instead of
 * hashing a rounded key.
 */
class PointWeld {
  readonly pts: [number, number][] = [];
  private readonly buckets = new Map<string, number[]>();

  id(x: number, y: number): number {
    const bx = Math.floor(x / WELD_EPS);
    const by = Math.floor(y / WELD_EPS);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.buckets.get(`${bx + dx},${by + dy}`);
        if (!list) continue;
        for (const i of list) {
          const p = this.pts[i];
          if (
            Math.abs(p[0] - x) <= WELD_EPS &&
            Math.abs(p[1] - y) <= WELD_EPS
          ) {
            return i;
          }
        }
      }
    }
    const id = this.pts.length;
    this.pts.push([x, y]);
    const key = `${bx},${by}`;
    const list = this.buckets.get(key);
    if (list) list.push(id);
    else this.buckets.set(key, [id]);
    return id;
  }
}

/**
 * Every region boundary, drawn once, chained into the longest runs available.
 *
 * This is the polygon path's answer to `joinRuns`, and it has to do two jobs the
 * interval union did for free. **Overdraw**: two regions sharing a boundary each
 * carry it in their own ring, so the same stretch arrives twice and one copy has
 * to go — a retraced line is doubled ink and wasted time. **Joining**: the
 * segments have to be welded back into strokes.
 *
 * It also does strictly better than the union it replaces. `joinRuns` can only
 * merge runs that lie on the *same lattice line*, so a stroke stops dead at
 * every change of direction; chaining on welded vertices lets a stroke turn a
 * corner and follow a whole contour in one pen-down.
 *
 * Trails are started at odd-degree vertices first. Those are the ones that
 * cannot sit in the middle of a trail, so consuming them first keeps the export
 * from stranding them as short leftovers once the loops around them are gone.
 * At a junction the walk prefers the smallest turn, so it runs *through* a
 * crossing rather than hairpinning out of it.
 */
export function boundaryStrokes(regions: PlotRegion[]): PlotPoly[] {
  const weld = new PointWeld();
  const seen = new Set<string>();
  const edges: [number, number][] = [];

  for (const region of regions) {
    for (const ring of region.rings) {
      const ids = ring.map(([x, y]) => weld.id(x, y));
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i];
        const b = ids[(i + 1) % ids.length];
        if (a === b) continue; // welded away to nothing
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  if (edges.length === 0) return [];

  const n = weld.pts.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const deg = new Array<number>(n).fill(0);
  for (let e = 0; e < edges.length; e++) {
    const [a, b] = edges[e];
    adj[a].push(e);
    adj[b].push(e);
    deg[a]++;
    deg[b]++;
  }
  const used = new Array<boolean>(edges.length).fill(false);
  const other = (e: number, from: number) =>
    edges[e][0] === from ? edges[e][1] : edges[e][0];

  /** The unused edge at `cur` that continues most nearly straight on. */
  const pickNext = (cur: number, prev: number): number => {
    let best = -1;
    let bestTurn = Infinity;
    const p = weld.pts[cur];
    const ix = prev < 0 ? 0 : p[0] - weld.pts[prev][0];
    const iy = prev < 0 ? 0 : p[1] - weld.pts[prev][1];
    for (const e of adj[cur]) {
      if (used[e]) continue;
      if (prev < 0) return e;
      const q = weld.pts[other(e, cur)];
      const ox = q[0] - p[0];
      const oy = q[1] - p[1];
      const turn = Math.abs(
        Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy),
      );
      if (turn < bestTurn) {
        bestTurn = turn;
        best = e;
      }
    }
    return best;
  };

  const out: PlotPoly[] = [];
  const walk = (start: number) => {
    while (deg[start] > 0) {
      const trail = [start];
      let cur = start;
      let prev = -1;
      for (;;) {
        const e = pickNext(cur, prev);
        if (e < 0) break;
        used[e] = true;
        deg[cur]--;
        const next = other(e, cur);
        deg[next]--;
        trail.push(next);
        prev = cur;
        cur = next;
      }
      if (trail.length >= 2) out.push(trail.map((i) => weld.pts[i]));
    }
  };

  for (let i = 0; i < n; i++) if (deg[i] % 2 === 1) walk(i);
  for (let i = 0; i < n; i++) if (deg[i] > 0) walk(i);

  return out;
}

/**
 * Hard ceiling on the contours drawn inside one region, whatever its size.
 * The loop's real stop condition is the offset coming back empty; this only
 * exists so a pathological spacing cannot stall the export.
 */
const MAX_CONTOURS = 4000;

/**
 * A region filled with concentric insets of its own boundary.
 *
 * Tone comes out the same way it does for the hatch: `spacing` is the
 * perpendicular distance between adjacent lines, so a given density lays down
 * the same length of ink per unit area whichever fill style is chosen, and the
 * whole lightness-to-density ladder carries over untouched.
 *
 * **Starts at one spacing in, not at zero.** The region's own boundary is
 * already being drawn as an outline, so beginning the stack at the boundary
 * itself would retrace it — this is where the no-overdraw guarantee comes from
 * on this path, and it costs nothing to get right.
 *
 * Every inset is taken from the *original* rings rather than from the previous
 * inset. Chaining them would compound both the integer rounding and Clipper's
 * arc approximation once per ring, and a hundred rings in that is a visible
 * drift; offsetting from the source is also what lets a region that has pinched
 * into three pieces keep insetting all three correctly.
 */
export function contourFill(
  rings: PlotPoly[],
  spacing: number,
  api: ClipperApi,
): PlotPoly[] {
  if (!(spacing > 0) || rings.length === 0) return [];

  // The furthest any point can be from the boundary is half the shorter side of
  // the bounding box, so this many insets always exhausts the region. It is a
  // guard, not the stop condition.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return [];
  const reach = Math.min(maxX - minX, maxY - minY) / 2;
  const limit = Math.min(MAX_CONTOURS, Math.ceil(reach / spacing) + 2);

  const out: PlotPoly[] = [];
  for (let k = 1; k <= limit; k++) {
    const inset = api.offset(rings, -k * spacing);
    if (inset.length === 0) break;
    out.push(...inset);
  }
  return out;
}

/** A closed ring as a stroke: the first point repeated so the pen returns to
 *  where it started. The SVG emitter writes `M`/`L` only, and a repeated point
 *  closes the loop without teaching it about `Z`. */
export function closeRing(ring: PlotPoly): PlotPoly {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [first[0], first[1]]];
}
