import { SIDE, getTriVertices, stringToTri } from "@/lib/grid-math";
import { decodeColor, resolveColor } from "@/lib/constants";
import { hatchU, type HatchDir } from "@/lib/hatch";

/**
 * Boundaries of the solid regions, and the interval algebra that joins them.
 *
 * Two exporters need the same thing from a painted grid: *where does one colour
 * stop and another begin*. The plotter draws those boundaries as outline strokes;
 * the apparel export punches them out of the alpha channel as stencil cuts. Both
 * then want the little segments welded into the longest possible runs with no
 * overdraw, which is what `joinRuns` is for.
 *
 * The machinery originated in `plotter-export.ts` and lives here so neither
 * consumer has to import the other. Pure: no DOM, no React.
 */

/** A run along one lattice line: the family, which line of it, and the interval
 *  covered. Every lattice edge and every hatch line is expressible this way,
 *  which is what lets the join be one-dimensional. */
export interface RawSeg {
  dir: HatchDir;
  u: number;
  /** Interval along the line. */
  t0: number;
  t1: number;
}

/**
 * Two lines of the same family are the same physical line when their `u` values
 * agree to this. Distinct lines are never closer than `H / MAX_DENSITY` (~5.4
 * world units), so there is a five-order-of-magnitude margin.
 */
export const U_TOL = 1e-4;

/** Collinear runs closer than this along their line are treated as touching. */
export const JOIN_TOL = 1e-6 * SIDE;

/** The parameter a segment is measured by along its line — the same
 *  parameterisation `hatchLinesInBox` generates with: x for the horizontal
 *  family, y for the two diagonals. */
export const along = (dir: HatchDir, x: number, y: number) =>
  dir === 0 ? x : y;

/**
 * Which line family an edge lies on — the one whose `u` is constant along it.
 *
 * Every lattice edge belongs to exactly one family, so this is a lookup rather
 * than a search. Worth noting: grid lines sit at `n*step` while hatch lines sit
 * at `(n + 1/2)*step`, and `2n+1 = 2md` has no integer solution — so an outline
 * can **never** land on a hatch line at any density, and the two can be joined
 * through the same pass without interfering.
 */
export function edgeDir(
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

export interface OutlineOptions {
  /**
   * Include the outside of the artwork — edges with solid on one side only.
   *
   * The plotter wants them: on paper the silhouette is what bounds the outermost
   * tone, and without it the ladder reads as an open field of parallel lines. The
   * apparel export does not: its silhouette is already the edge of the alpha, so
   * cutting there buys no flex and only erodes the design by half a gap width.
   */
  silhouette?: boolean;
}

/**
 * Boundaries of the solid regions.
 *
 * An edge is drawn when the two triangles across it read as different colours,
 * or — with `silhouette` — when there is only one, the outside of the artwork.
 * **An edge between two cells of the same colour is not a boundary and is never
 * drawn**, which is what makes this an outline of the shapes rather than a
 * wireframe of every trixel.
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
export function outlineSegments(
  fills: Record<string, string>,
  options: OutlineOptions = {},
): RawSeg[] {
  const silhouette = options.silhouette ?? true;
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
    if (e.colors.length < 2 && !silhouette) continue;
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

type Span = [number, number];

/** Merges a line's intervals into a disjoint, sorted set. */
export function unionSpans(spans: Span[]): Span[] {
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
export function subtractSpans(a: Span[], b: Span[]): Span[] {
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
export function joinRuns(segs: RawSeg[], mask: RawSeg[] = []): RawSeg[] {
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
export function segToPoints(s: RawSeg): [[number, number], [number, number]] {
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
