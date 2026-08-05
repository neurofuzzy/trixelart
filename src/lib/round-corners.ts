import { H, SIDE, getTriVertices, stringToTri } from "@/lib/grid-math";
import { decodeColor, resolveColor } from "@/lib/constants";

/**
 * Corner rounding for contiguous same-colour regions.
 *
 * The lattice gives every shape hard 60°/120° corners. This replaces each corner
 * with a circular arc tangent to both edges — non-destructively: nothing here
 * touches `painted`, it only reshapes the geometry on its way to a renderer.
 *
 * **Why neighbouring regions stay airtight.** Six triangles meet at every
 * lattice vertex, each contributing 60°, so a region's interior angle there is
 * always a multiple of 60°. Where exactly two regions meet, their interior
 * angles are θ and 360−θ and *both boundaries run along the same two rays* out
 * of that vertex — one region traverses them one way, the other the reverse. A
 * single circle of radius r tangent to both rays therefore serves both at once:
 * convex for the θ<180 side (corner cut off) and concave for the other (bulging
 * in by exactly as much). One arc, two regions, no gap.
 *
 * That is precisely what canvas `arcTo` and SVG's `A` compute, so **there is no
 * separate concave code path** — each region rounds its own ring in ignorance of
 * its neighbours and the results abut exactly. If a concave special case ever
 * seems necessary, something upstream is wrong.
 *
 * **Junctions are left sharp.** Where three or more regions meet, three circles
 * each tangent to two of the three rays leave an uncoverable curvilinear
 * triangle in the middle which belongs to no region and shows through as
 * background. Airtightness is a property of the *vertex*, not of the polygon,
 * and it is only achievable where the vertex has exactly two boundary edges.
 *
 * Pure: no DOM, no React.
 */

/**
 * One ring vertex: its world position, and the id of the lattice point it sits
 * on.
 *
 * **Lattice vertices are addressed by integers, never by rounded coordinates.**
 * Every vertex of the grid is `(i·SIDE + j·SIDE/2, j·H)` for integers `i, j`,
 * and each triangle's three corners are a fixed integer offset from its own
 * `(q, r)` — so vertex identity is exact arithmetic rather than a string of
 * decimals. That matters twice over: `(r+1)·H` and `r·H + H` differ by an ulp,
 * so a coordinate key needs rounding to match them, and rounding reintroduces
 * both a `-0.000` vs `0.000` split and ~40k `toFixed` calls per rebuild on a
 * large piece. Integers have neither problem.
 */
export interface RingPoint {
  x: number;
  y: number;
  /** Lattice vertex id — see `vertexId`. */
  v: number;
}

/** A closed ring. Outer rings wind CW, holes CCW (screen space, y-down), which
 *  is what distinguishes a convex turn from a concave one. */
export type Ring = RingPoint[];

/** Packs a lattice vertex `(i, j)` into one number. The offset keeps negatives
 *  positive and the stride is a power of two, so this is exact well past any
 *  reachable grid size (|i|, |j| < 2^20 ≈ a million cells from the origin). */
const VERTEX_BIAS = 1 << 20;
const VERTEX_STRIDE = 1 << 21;
const vertexId = (i: number, j: number) =>
  (i + VERTEX_BIAS) * VERTEX_STRIDE + (j + VERTEX_BIAS);

/**
 * Packs an undirected lattice edge into one number.
 *
 * An edge cannot be keyed by combining two vertex ids — each is already ~2^42,
 * so their product leaves the exact-integer range. But every lattice edge runs
 * in one of exactly three directions, so `(base vertex, direction)` identifies
 * it in 2^42 · 3, which is comfortably exact. The base is the endpoint with the
 * smaller `j` (ties broken on `i`), making the key independent of which of the
 * two triangles sharing the edge produced it.
 */
function edgeId(ai: number, aj: number, bi: number, bj: number): number {
  let i0 = ai, j0 = aj, i1 = bi, j1 = bj;
  if (j1 < j0 || (j1 === j0 && i1 < i0)) {
    i0 = bi; j0 = bj; i1 = ai; j1 = aj;
  }
  const di = i1 - i0;
  const dj = j1 - j0;
  // The three lattice directions: (1,0), (0,1), (-1,1).
  const dir = dj === 0 ? 0 : di === 0 ? 1 : 2;
  return vertexId(i0, j0) * 3 + dir;
}

/** The six lattice directions, in the order `dirIndex` numbers them. */
const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

/** Index of a step between adjacent lattice vertices, or -1 if not adjacent. */
function dirIndex(di: number, dj: number): number {
  for (let d = 0; d < 6; d++) {
    if (DIRS[d][0] === di && DIRS[d][1] === dj) return d;
  }
  return -1;
}

/** Packs a *directed* lattice edge. `edgeId` deliberately collapses the two
 *  senses of an edge; the ring walk needs to tell them apart, because a colour
 *  with both an outer ring and a hole traverses the same geometry twice. */
const directedEdgeId = (
  ai: number,
  aj: number,
  bi: number,
  bj: number,
): number => vertexId(ai, aj) * 6 + dirIndex(bi - ai, bj - aj);

/**
 * The three lattice vertices of a triangle, as `(i, j)` pairs.
 *
 * Derived from `getTriVertices`: an up triangle at `(q, r)` spans the lattice
 * points `(q,r)`, `(q+1,r)`, `(q,r+1)`; a down triangle spans `(q,r+1)`,
 * `(q+1,r+1)`, `(q+1,r)`. Kept in the same order `getTriVertices` returns them,
 * so the two agree vertex for vertex.
 */
function triLatticeVerts(
  q: number,
  r: number,
  type: "up" | "down",
): [number, number][] {
  return type === "up"
    ? [
        [q, r],
        [q + 1, r],
        [q, r + 1],
      ]
    : [
        [q, r + 1],
        [q + 1, r + 1],
        [q + 1, r],
      ];
}

export interface RegionRings {
  /** Resolved hex — regions are grouped by what the eye sees, see below. */
  fill: string;
  /** Encoded colour index of the region's first trixel. Several encodings can
   *  resolve to one fill, so this is the first seen; the renderers use it to
   *  draw overlapping outlines in a deterministic colour order. */
  paletteIdx: number;
  colorIdx: number;
  rings: Ring[];
}

/** One ring vertex after rounding. `radius` 0 means draw a sharp corner. */
export interface RoundedCorner {
  x: number;
  y: number;
  radius: number;
}

export type RoundedRing = RoundedCorner[];

/** Below this a corner is treated as straight (collinear) and left alone. */
const COLLINEAR_EPS = 1e-6;

/** Points closer than this are the same point. */
const POINT_EPS = 1e-6;

function signedArea(
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
  [cx, cy]: [number, number],
): number {
  return ax * (by - cy) + bx * (cy - ay) + cx * (ay - by);
}

/**
 * Boundary-edge incidences per lattice vertex.
 *
 * A boundary edge is one whose two sides resolve to different colours, counting
 * *unpainted* as its own colour so the artwork's silhouette counts too. The
 * count at a vertex is always even: 2 is a simple boundary between two regions,
 * 4 or 6 a junction — or a region pinching against itself corner-to-corner,
 * which is the same problem wearing a different hat.
 *
 * Only vertices with exactly 2 may be rounded. Because this is computed from the
 * *shared* boundary rather than from any one region, both sides of an edge
 * always agree, which is what makes the rounding airtight.
 */
export function boundaryVertexDegrees(
  painted: Record<string, string>,
): Map<number, number> {
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
    va: number;
    vb: number;
    /** First colour seen, and whether any later one differed — enough to decide
     *  "boundary or not" without keeping the whole list. */
    first: string;
    mixed: boolean;
    count: number;
  }
  const edges = new Map<number, Edge>();

  for (const key in painted) {
    const encoded = painted[key];
    if (!decodeColor(encoded)) continue;
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;
    const hex = hexOf(encoded);
    const lv = triLatticeVerts(tri.q, tri.r, tri.type);

    for (let i = 0; i < 3; i++) {
      const a = lv[i];
      const b = lv[(i + 1) % 3];
      const va = vertexId(a[0], a[1]);
      const vb = vertexId(b[0], b[1]);
      const lo = va < vb ? va : vb;
      const hi = va < vb ? vb : va;
      const k = edgeId(a[0], a[1], b[0], b[1]);
      const e = edges.get(k);
      if (e) {
        e.count++;
        if (e.first !== hex) e.mixed = true;
      } else {
        edges.set(k, { va: lo, vb: hi, first: hex, mixed: false, count: 1 });
      }
    }
  }

  const degrees = new Map<number, number>();
  for (const e of edges.values()) {
    // Same colour on both sides: interior to one region, not a boundary.
    if (e.count >= 2 && !e.mixed) continue;
    degrees.set(e.va, (degrees.get(e.va) ?? 0) + 1);
    degrees.set(e.vb, (degrees.get(e.vb) ?? 0) + 1);
  }
  return degrees;
}

/**
 * Contiguous same-colour regions as closed rings.
 *
 * The same boundary-following walk `mergeTrianglesByColor` uses: count each
 * lattice edge, keep the ones seen once (the others are interior), then chain
 * them into loops. Non-contiguous blobs of one colour fall out as separate
 * rings, and holes as their own rings, for free.
 *
 * Colours are compared **resolved, not encoded**, deliberately breaking the
 * usual rule. Elsewhere encoded comparison is right because painted data must
 * follow palette shifts; here the only question is whether the eye sees a
 * boundary, and two swatches from different palettes resolving to the same hex
 * are one shape with nothing to round between them. Same exception, and same
 * reasoning, as `region-outline.ts`.
 */
export function regionRings(painted: Record<string, string>): RegionRings[] {
  /** A triangle as its three lattice vertices, already wound CW. */
  const byColor = new Map<string, [number, number][][]>();
  /** The encoded colour index of each region, taken from the first trixel that
   *  created it. */
  const byIdx = new Map<string, { paletteIdx: number; colorIdx: number }>();

  for (const key in painted) {
    const encoded = painted[key];
    if (!decodeColor(encoded)) continue;
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;
    const v = getTriVertices(tri.q, tri.r, tri.type);
    const lv = triLatticeVerts(tri.q, tri.r, tri.type);
    // Winding is decided on the world coordinates, then applied to the lattice
    // pairs — `getTriVertices` returns opposite windings for the two triangle
    // types, and the ring walk needs one consistent orientation.
    const cw =
      signedArea(
        [v[0].x, v[0].y],
        [v[1].x, v[1].y],
        [v[2].x, v[2].y],
      ) >= 0;
    const points = cw ? lv : [lv[0], lv[2], lv[1]];
    const fill = resolveColor(encoded);
    const list = byColor.get(fill);
    if (list) list.push(points);
    else {
      byColor.set(fill, [points]);
      const d = decodeColor(encoded);
      if (d) byIdx.set(fill, { paletteIdx: d.paletteIdx, colorIdx: d.colorIdx });
    }
  }

  const out: RegionRings[] = [];

  for (const [fill, polys] of byColor) {
    // Count each undirected edge; those seen once bound the region.
    const edgeCount = new Map<number, number>();
    for (const points of polys) {
      for (let i = 0; i < 3; i++) {
        const a = points[i];
        const b = points[(i + 1) % 3];
        const k = edgeId(a[0], a[1], b[0], b[1]);
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      }
    }

    // Directed boundary edges, keyed by the vertex they leave.
    const next = new Map<number, { to: number; toIJ: [number, number]; fromIJ: [number, number] }[]>();
    for (const points of polys) {
      for (let i = 0; i < 3; i++) {
        const a = points[i];
        const b = points[(i + 1) % 3];
        if (edgeCount.get(edgeId(a[0], a[1], b[0], b[1])) !== 1) continue;
        const va = vertexId(a[0], a[1]);
        const entry = { to: vertexId(b[0], b[1]), toIJ: b, fromIJ: a };
        const list = next.get(va);
        if (list) list.push(entry);
        else next.set(va, [entry]);
      }
    }

    const used = new Set<number>();
    const rings: Ring[] = [];
    const pt = (ij: [number, number], v: number): RingPoint => ({
      x: ij[0] * SIDE + ij[1] * (SIDE / 2),
      y: ij[1] * H,
      v,
    });

    for (const [startKey, entries] of next) {
      for (const startEdge of entries) {
        const startId = directedEdgeId(
          startEdge.fromIJ[0], startEdge.fromIJ[1],
          startEdge.toIJ[0], startEdge.toIJ[1],
        );
        if (used.has(startId)) continue;

        const ring: Ring = [pt(startEdge.fromIJ, startKey)];
        let curEdge = startEdge;

        for (;;) {
          used.add(
            directedEdgeId(
              curEdge.fromIJ[0], curEdge.fromIJ[1],
              curEdge.toIJ[0], curEdge.toIJ[1],
            ),
          );
          if (curEdge.to === startKey) break;
          ring.push(pt(curEdge.toIJ, curEdge.to));

          const candidates = next.get(curEdge.to) ?? [];
          const found = candidates.find(
            (c) =>
              !used.has(
                directedEdgeId(c.fromIJ[0], c.fromIJ[1], c.toIJ[0], c.toIJ[1]),
              ),
          );
          if (!found) break;
          curEdge = found;
        }

        if (ring.length >= 3) rings.push(ring);
      }
    }

    if (rings.length) {
      const idx =
        byIdx.get(fill) ?? {
          paletteIdx: Number.MAX_SAFE_INTEGER,
          colorIdx: Number.MAX_SAFE_INTEGER,
        };
      out.push({ fill, paletteIdx: idx.paletteIdx, colorIdx: idx.colorIdx, rings });
    }
  }

  // Fill order is irrelevant (opaque, abutting regions), but outlines overlap
  // where two regions share a boundary — each stroke is centred on it — so the
  // drawing order decides which colour wins. Colour index first, then palette,
  // makes that deterministic and light-on-top.
  out.sort((a, b) => a.colorIdx - b.colorIdx || a.paletteIdx - b.paletteIdx);

  return out;
}

/** Corner geometry at ring vertex `i`: the unit vectors out along each adjacent
 *  edge, and cot(α/2) where α is the angle between them. */
function cornerAt(ring: { x: number; y: number }[], i: number) {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n];
  const cur = ring[i];
  const nextP = ring[(i + 1) % n];

  let ix = prev.x - cur.x;
  let iy = prev.y - cur.y;
  let ox = nextP.x - cur.x;
  let oy = nextP.y - cur.y;

  const li = Math.hypot(ix, iy);
  const lo = Math.hypot(ox, oy);
  if (li < POINT_EPS || lo < POINT_EPS) return null;
  ix /= li;
  iy /= li;
  ox /= lo;
  oy /= lo;

  // Angle between the two rays, in [0, π].
  const dot = Math.max(-1, Math.min(1, ix * ox + iy * oy));
  const alpha = Math.acos(dot);
  if (alpha > Math.PI - COLLINEAR_EPS) return null; // straight: nothing to round
  if (alpha < COLLINEAR_EPS) return null; // degenerate spike

  // Tangent distance for radius r is r * cot(alpha/2).
  return { cot: 1 / Math.tan(alpha / 2) };
}

/** Whether the ring passes straight through `b` — the edges a→b and b→c are
 *  collinear. Exact on lattice coordinates, but compared with an epsilon so a
 *  degenerate float case still reads as a turn. */
function collinear(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean {
  const d1x = b.x - a.x, d1y = b.y - a.y;
  const d2x = c.x - b.x, d2y = c.y - b.y;
  const cross = Math.abs(d1x * d2y - d1y * d2x);
  const len = Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y);
  return len > 0 && cross <= COLLINEAR_EPS * len;
}

/** Distance along the ring from vertex `i`, in direction `dir` (±1), to the
 *  first vertex where the boundary changes direction. An arc's tangent point
 *  must land within this straight stretch: past a turn the tangent line is no
 *  longer part of the boundary, so the arc would leave the region. */
function straightRun(
  ring: { x: number; y: number }[],
  i: number,
  dir: 1 | -1,
): number {
  const n = ring.length;
  let len = 0;
  let j = i;
  for (let step = 0; step < n; step++) {
    const a = ring[j];
    const b = ring[(j + dir + n) % n];
    const c = ring[(j + 2 * dir + n) % n];
    len += Math.hypot(b.x - a.x, b.y - a.y);
    if (!collinear(a, b, c)) break;
    j = (j + dir + n) % n;
  }
  return len;
}

/**
 * Applies rounding to one ring.
 *
 * `radius` is an absolute **world distance**, the same at every corner of the
 * layer — see `ROUND_RADIUS_AT_FULL`. It is cut back only where the geometry
 * cannot hold it: the arc consumes `r·cot(α/2)` along both adjacent edges, so
 * the two corners sharing a straight run must not between them consume more than
 * its length, and a corner's tangent point must not reach past a turn in the
 * boundary (where the tangent line would stop being part of it). Each vertex
 * takes the min over its two adjacent runs and both turn clearances.
 *
 * **The clamp reads only the shared boundary** — run lengths and angles, never
 * anything region-local like area or cell count. Both sides of an edge therefore
 * compute an identical radius, which is what keeps the seam airtight. Clamping
 * on a region-local quantity is the easy mistake here and tears it open.
 */
export function roundRing(
  ring: Ring,
  degrees: Map<number, number>,
  radius: number,
): RoundedRing {
  // Only a vertex with exactly two boundary edges can be rounded airtight.
  return roundPolygon(ring, radius, (i) => (degrees.get(ring[i].v) ?? 0) === 2);
}

/**
 * The geometry half of rounding, with no opinion about *which* vertices are
 * eligible — the caller supplies that.
 *
 * The split matters because the two consumers answer that question completely
 * differently. Flat artwork must round only where exactly two colour regions
 * meet, or neighbouring polygons stop meeting airtight. The cutting export has
 * no such constraint: its sheets are nested, so a rounded piece simply sits on a
 * larger one and every non-collinear corner is fair game. Only the clamp is
 * shared, and it is the part that is easy to get wrong.
 */
export function roundPolygon(
  ring: { x: number; y: number }[],
  radius: number,
  eligible: (i: number) => boolean,
): RoundedRing {
  const n = ring.length;
  const corners: RoundedRing = ring.map((p) => ({ x: p.x, y: p.y, radius: 0 }));
  if (radius <= 0 || n < 3) return corners;

  // Per-vertex geometry, and whether the vertex may round at all.
  const geom = ring.map((_p, i) => (eligible(i) ? cornerAt(ring, i) : null));

  // Largest radius each corner could take on its own, given both adjacent runs.
  // A run ends at the next *rounding* corner; collinear and sharp vertices pass
  // straight through, so their edge lengths accumulate.
  const runAfter: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!geom[i]) continue;
    let len = 0;
    let j = i;
    for (let step = 0; step < n; step++) {
      const cur = ring[j];
      const nxt = ring[(j + 1) % n];
      len += Math.hypot(nxt.x - cur.x, nxt.y - cur.y);
      j = (j + 1) % n;
      if (geom[j]) break;
    }
    runAfter[i] = len;
  }

  const maxR: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const g = geom[i];
    if (!g) continue;
    // The corner at the far end of the run after i.
    let j = i;
    for (let step = 0; step < n; step++) {
      j = (j + 1) % n;
      if (geom[j]) break;
    }
    const gj = geom[j];
    const run = runAfter[i];
    if (!gj || run <= 0) continue;
    // r*(cot_i + cot_j) <= run. A vertex alone on its ring rounds against
    // itself, which the same inequality already handles.
    const share = run / (g.cot + gj.cot);
    maxR[i] = maxR[i] === 0 ? share : Math.min(maxR[i], share);
    maxR[j] = maxR[j] === 0 ? share : Math.min(maxR[j], share);
  }

  // The pair clamp bounds each arc against its *rounding* neighbour, but not
  // against the sharp vertices that share the straight run: a tangent distance
  // may still exceed the stretch up to the next turn, and past a turn the
  // tangent line is no longer part of the boundary — the arc would leave the
  // region. Cap the radius at the distance to the nearer turn on each side.
  for (let i = 0; i < n; i++) {
    const g = geom[i];
    if (!g) continue;
    const clear = Math.min(straightRun(ring, i, -1), straightRun(ring, i, 1));
    const byClear = clear / g.cot;
    maxR[i] = maxR[i] === 0 ? byClear : Math.min(maxR[i], byClear);
  }

  for (let i = 0; i < n; i++) {
    if (!geom[i]) continue;
    // **One radius for the whole layer**, cut back only where the local geometry
    // cannot hold it. Scaling each corner by its own maximum instead would make
    // the radius vary from vertex to vertex — a lone triangle rounding to 14.4
    // while a corner on a long run rounds to 86.6 — which is visibly not "the
    // same radius everywhere" and was the original bug here.
    corners[i].radius = Math.min(radius, maxR[i]);
  }
  return corners;
}

/**
 * World radius at slider 100%: one cell stride.
 *
 * The slider is stored as a 0–1 fraction so the saved value is independent of
 * `SIDE`, but what it denotes is an absolute distance — the *same* distance at
 * every corner of the layer, which is what makes neighbouring polygons meet
 * airtight under a single setting.
 *
 * Nothing clamps below `SIDE / (2√3)` ≈ 14.43 (29% of the slider): that is where
 * two 60° corners consume exactly one lattice edge between them, and it is also
 * a single triangle's incircle — a lone trixel is fully round there and cannot
 * get rounder. Above it, corners saturate progressively as their runs run out,
 * tightest first, so the upper range still does real work on larger shapes.
 */
export const ROUND_RADIUS_AT_FULL = SIDE;

/** Every region's rings, rounded. The one entry point a renderer needs.
 *  `radius` is the 0–1 slider fraction; see `ROUND_RADIUS_AT_FULL`. */
export function roundedRegions(
  painted: Record<string, string>,
  radius: number,
): { fill: string; rings: RoundedRing[] }[] {
  const degrees = boundaryVertexDegrees(painted);
  const world = radius * ROUND_RADIUS_AT_FULL;
  return regionRings(painted).map(({ fill, rings }) => ({
    fill,
    rings: rings.map((r) => roundRing(r, degrees, world)),
  }));
}

/**
 * World weight at slider 100%: one cell stride, the same convention as
 * `ROUND_RADIUS_AT_FULL`. The outline slider is stored as a 0–1 fraction so the
 * saved value is independent of `SIDE`, but the stroke it denotes is an
 * absolute width — the same width at every edge of the layer.
 */
export const OUTLINE_WEIGHT_AT_FULL = SIDE;

/**
 * A fill step's region rings, rounded when `radius > 0` and plain otherwise.
 *
 * Unrounded rings come back with `radius: 0` corners so a single trace/stroke
 * path handles both: the outline effect strokes them, corner rounding fills
 * them. Returning one shape for both keeps the preview and the two raster/vector
 * exporters from drifting apart over what a region boundary is.
 */
export function stepRegionGeometry(
  painted: Record<string, string>,
  radius: number,
): { fill: string; rings: RoundedRing[] }[] {
  if (radius > 0) return roundedRegions(painted, radius);
  return regionRings(painted).map(({ fill, rings }) => ({
    fill,
    rings: rings.map((r) => r.map((p) => ({ x: p.x, y: p.y, radius: 0 }))),
  }));
}

/** Where a corner's arc leaves the incoming edge and rejoins the outgoing one,
 *  plus which way it turns. `null` for a corner that stays sharp. */
interface Tangents {
  enter: [number, number];
  exit: [number, number];
  /** 1 when the ring turns clockwise here in screen space (y-down). */
  sweep: 0 | 1;
}

/** Point `d` along the ray from `c` towards `p`. */
function towards(
  cx: number,
  cy: number,
  px: number,
  py: number,
  d: number,
): [number, number] {
  const dx = px - cx;
  const dy = py - cy;
  const len = Math.hypot(dx, dy) || 1;
  return [cx + (dx / len) * d, cy + (dy / len) * d];
}

/**
 * Tangent points for every corner, in one pass.
 *
 * Shared by all the backends so they cannot disagree about where an arc begins —
 * and computed once per ring rather than per vertex, which the obvious recursive
 * phrasing makes quadratic. The tangent sits at the *full* distance `r·cot(α/2)`
 * from the corner; `roundPolygon` has already cut the radius back so that fits
 * the boundary, so no clamp is needed here. Clamping to the adjacent edge was
 * the bug: where the run is straight the tangent legitimately passes the
 * immediate vertex, and clamping it pulled the point off the circle the
 * renderer still infers, opening a kink (and, on canvas, a doubled-back hairpin).
 */
function ringTangents(ring: RoundedRing): (Tangents | null)[] {
  const n = ring.length;
  return ring.map((cur, i) => {
    if (cur.radius <= 0) return null;
    const g = cornerAt(ring, i);
    if (!g) return null;
    const prev = ring[(i - 1 + n) % n];
    const nxt = ring[(i + 1) % n];
    const d = cur.radius * g.cot;
    const cross =
      (cur.x - prev.x) * (nxt.y - cur.y) - (cur.y - prev.y) * (nxt.x - cur.x);
    return {
      enter: towards(cur.x, cur.y, prev.x, prev.y, d),
      exit: towards(cur.x, cur.y, nxt.x, nxt.y, d),
      sweep: cross > 0 ? 1 : 0,
    };
  });
}

/** Where a traced ring begins: the first corner's entry tangent if it rounds,
 *  else the corner itself. Deliberately *not* an edge midpoint — the two tangent
 *  distances along a run are unequal whenever the corner angles differ, so a
 *  midpoint can land inside an arc and make the first segment double back. */
function ringStart(ring: RoundedRing, tans: (Tangents | null)[]): [number, number] {
  const t = tans[0];
  return t ? t.enter : [ring[0].x, ring[0].y];
}

/** A corner's arc as explicit circle parameters, recovered from its two tangent
 *  points and the radius. The centre sits on the angle bisector at the distance
 *  where the radius to each tangent point is perpendicular to its edge — the
 *  corner, tangent and centre form a right triangle — so the arc passes through
 *  exactly the points `ringTangents` computed.
 *
 *  Deriving the centre rather than trusting a rasteriser to re-infer it from the
 *  corner is the point: the three backends share one source of truth for where
 *  the arc begins and ends. The sweep is the short way round: the arc never
 *  exceeds half a turn, since the corner angle is strictly between 0 and π. */
function cornerArc(
  cur: RoundedCorner,
  enter: [number, number],
  exit: [number, number],
): { cx: number; cy: number; a0: number; sweep: number; ccw: boolean } {
  const ex = enter[0] - cur.x, ey = enter[1] - cur.y;
  const xx = exit[0] - cur.x, xy = exit[1] - cur.y;
  const el = Math.hypot(ex, ey) || 1;
  const xl = Math.hypot(xx, xy) || 1;
  let bx = ex / el + xx / xl;
  let by = ey / el + xy / xl;
  const bl = Math.hypot(bx, by) || 1;
  bx /= bl;
  by /= bl;
  // |corner→centre|² = tangentDistance² + r² (the tangent is perpendicular to
  // the radius, so the three points form a right triangle).
  const dist = Math.hypot(el, cur.radius);
  const cx = cur.x + bx * dist;
  const cy = cur.y + by * dist;

  const a0 = Math.atan2(enter[1] - cy, enter[0] - cx);
  const a1 = Math.atan2(exit[1] - cy, exit[0] - cx);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  return { cx, cy, a0, sweep, ccw: sweep < 0 };
}

/**
 * Traces a rounded ring onto a canvas path.
 *
 * The path is moved onto each corner's entry tangent point, then the arc is
 * drawn with `arc` through the two tangent points `ringTangents` computed — the
 * same geometry the SVG backend emits as `A` commands, so the two cannot drift
 * apart. This is deliberately *not* `arcTo`: `arcTo` re-derives the tangent
 * distance from the corner, and where the run clamp has pulled the entry tangent
 * inward it draws a connecting line that doubles back along the edge — a hairpin
 * sliver of the very curve the corner was meant to be. Because `arc` starts at
 * the entry tangent (which is exactly the current point), it adds no connector
 * and the curve turns precisely where the ring says it does.
 */
export function traceRoundedRing(ctx: CanvasPath, ring: RoundedRing): void {
  const n = ring.length;
  if (n < 3) return;
  const tans = ringTangents(ring);
  const [sx, sy] = ringStart(ring, tans);
  ctx.moveTo(sx, sy);

  for (let i = 0; i < n; i++) {
    const cur = ring[i];
    const t = tans[i];
    if (!t) {
      // `ringStart` has already moved onto ring[0] (the only vertex a null
      // first tangent leaves there), so the leading edge must not be repeated.
      if (i !== 0) ctx.lineTo(cur.x, cur.y);
      continue;
    }
    if (i !== 0) ctx.lineTo(t.enter[0], t.enter[1]);
    const { cx, cy, a0, sweep, ccw } = cornerArc(cur, t.enter, t.exit);
    if (Math.abs(sweep) < 1e-12) {
      // Degenerate sub-pixel arc: a chord is indistinguishable and safer than
      // asking the rasteriser to draw a zero-length `arc`.
      ctx.lineTo(t.exit[0], t.exit[1]);
      continue;
    }
    ctx.arc(cx, cy, cur.radius, a0, a0 + sweep, ccw);
  }
  ctx.closePath();
}

/**
 * A rounded ring as a plain polygon, arcs approximated by chords.
 *
 * For the cropped SVG export, which clips geometry for real rather than hiding
 * overflow behind a `<clipPath>` — an arc cannot survive Sutherland–Hodgman, but
 * a polyline can, so the crop keeps its guarantee that nothing off-crop reaches
 * the file. `maxSagitta` bounds the deviation in world units, so the segment
 * count follows the arc's size rather than being a fixed guess.
 */
export function flattenRoundedRing(
  ring: RoundedRing,
  maxSagitta = 0.5,
): [number, number][] {
  const n = ring.length;
  if (n < 3) return ring.map((c) => [c.x, c.y] as [number, number]);
  const tans = ringTangents(ring);
  const out: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const cur = ring[i];
    const t = tans[i];
    if (!t) {
      out.push([cur.x, cur.y]);
      continue;
    }
    const { cx, cy, a0, sweep } = cornerArc(cur, t.enter, t.exit);

    const steps = Math.max(
      1,
      Math.ceil(
        Math.abs(sweep) /
          (2 * Math.acos(Math.max(-1, Math.min(1, 1 - maxSagitta / Math.max(cur.radius, 1e-9))))),
      ),
    );
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (sweep * s) / steps;
      out.push([cx + Math.cos(a) * cur.radius, cy + Math.sin(a) * cur.radius]);
    }
  }

  // Drop consecutive coincident points. Where the clamp is tight, one corner's
  // exit tangent lands exactly on the next corner's entry tangent, so the two
  // arcs each emit that point and the ring gains a zero-length edge. Harmless in
  // a filled path, but it is a degenerate edge to anything that reasons about
  // the polygon — a clipper, a triangulator, a plotter — so it should not leave
  // this function.
  const dedup: [number, number][] = [];
  for (const p of out) {
    const last = dedup[dedup.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < POINT_EPS) continue;
    dedup.push(p);
  }
  while (
    dedup.length > 1 &&
    Math.hypot(
      dedup[0][0] - dedup[dedup.length - 1][0],
      dedup[0][1] - dedup[dedup.length - 1][1],
    ) < POINT_EPS
  ) {
    dedup.pop();
  }
  return dedup;
}

/**
 * The same ring as an SVG path `d`.
 *
 * The sweep flag is the turn direction — the cross product of the incoming and
 * outgoing edges, positive for a clockwise turn in screen space (y-down).
 * Getting it backwards draws the long way round the circle, which is a loud
 * failure rather than a subtle one.
 */
export function roundedRingToPath(
  ring: RoundedRing,
  fmtNum: (n: number) => string,
  ox = 0,
  oy = 0,
): string {
  const n = ring.length;
  if (n < 3) return "";

  const tans = ringTangents(ring);
  const parts: string[] = [];
  const pt = (p: [number, number]) => `${fmtNum(p[0] + ox)},${fmtNum(p[1] + oy)}`;

  parts.push(`M${pt(ringStart(ring, tans))}`);

  for (let i = 0; i < n; i++) {
    const cur = ring[i];
    const t = tans[i];
    if (!t) {
      // `ringStart` has already moved onto ring[0], so the leading edge must
      // not be repeated as a zero-length `L`.
      if (i !== 0) parts.push(`L${pt([cur.x, cur.y])}`);
      continue;
    }
    if (i !== 0) parts.push(`L${pt(t.enter)}`);
    parts.push(
      `A${fmtNum(cur.radius)},${fmtNum(cur.radius)} 0 0 ${t.sweep} ${pt(t.exit)}`,
    );
  }

  parts.push("Z");
  return parts.join(" ");
}
