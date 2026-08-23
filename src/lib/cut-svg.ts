import { getTriVertices, stringToTri, worldKey } from "@/lib/grid-math";
import {
  FAB_CHORD_MM,
  signedArea,
  computeModelTransform,
  type Pt,
} from "@/lib/mesh-export";
import { cutLayers, type CutFrame } from "@/lib/cut-mesh";
import type { CutPlan } from "@/lib/cut-export";
import type { CutJoints } from "@/lib/cut-joints";
import {
  boundaryVertexDegrees,
  flattenRoundedRing,
  latticeVertexIdAt,
  roundPolygon,
} from "@/lib/round-corners";
import { rotatePoint } from "@/lib/crop";

// ---------------------------------------------------------------------------
// Cut plan → one layered SVG for cutting machines (see docs/fabrication-export
// .md §5). Each layer is emitted as ONE compound path — the union boundary of
// its triangles (outer edge + hole edges as sub-paths) — so the cutter cuts
// only the silhouette and holes, never internal triangle edges. Layers are
// auto-tiled into a grid and grouped as labeled SVG layers.
//
// Merge-islands (optional): same-layer triangles that touch at a single vertex
// are connected by a zero-width point and fall apart when cut. When enabled, the
// boundary walk uses the reflex-crossing rule to merge them into one loop, and
// each pinch corner is replaced by a "tiny hexagon" neck: the boundary is routed
// through hexagon vertices at radius `neck` along the grid's 60° rays, spanning
// every empty sector across the notch. This is exactly the union boundary of a
// small regular hexagon dropped at the touch vertex — straight edges, no
// smoothing — giving each join a clean, robust bridge.
// ---------------------------------------------------------------------------

interface DEdge {
  a: Pt;
  b: Pt;
  ak: string;
  bk: string;
}

/** Three collinear points? (cross product ~ 0 within tolerance). */
function collinear(p: Pt, q: Pt, r: Pt): boolean {
  return Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) < 1e-4;
}

/** Directed boundary edges of a triangle set (solid region on the left). */
function boundaryEdges(keys: string[]): DEdge[] {
  const present = new Set<string>();
  const edges: DEdge[] = [];
  for (const key of keys) {
    const t = stringToTri(key);
    let v = getTriVertices(t.q, t.r, t.type) as Pt[];
    if (signedArea(v) < 0) v = [v[0], v[2], v[1]]; // force CCW
    for (let i = 0; i < 3; i++) {
      const a = v[i];
      const b = v[(i + 1) % 3];
      edges.push({ a, b, ak: worldKey(a), bk: worldKey(b) });
      present.add(`${worldKey(a)}->${worldKey(b)}`);
    }
  }
  return edges.filter((e) => !present.has(`${e.bk}->${e.ak}`));
}

/** Outgoing-boundary-edge count per vertex; >1 marks a pinch (corner touch). */
function outDegree(edges: DEdge[]): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of edges) deg.set(e.ak, (deg.get(e.ak) ?? 0) + 1);
  return deg;
}

/**
 * Outgoing-boundary-edge count per vertex of a triangle set, keyed by
 * `worldKey`. Exported for the joint planner, which has to keep its tabs off
 * the edges that meet at a pinch: a neck hexagon replaces the pinch vertex and
 * can reach further along the edge than a tab root sits, so the two cross.
 */
export function boundaryOutDegrees(keys: string[]): Map<string, number> {
  return outDegree(boundaryEdges(keys));
}

const ekey = (e: DEdge) => `${e.ak}->${e.bk}`;
const ang = (dx: number, dy: number) => Math.atan2(dy, dx);

/**
 * Precomputes each edge's merge successor: at a pinch (a vertex with several
 * outgoing boundary edges) the boundary takes the widest clockwise (reflex) turn
 * so corner-touching pieces weld into one loop. Crucially this is chosen over
 * ALL out-edges, not just unused ones — so the pairing is a permutation of the
 * boundary edges independent of traversal order. A greedy used-set walk would
 * otherwise, at one of several symmetric pinches, be forced onto a straight
 * pass-through and drop that pinch's neck (the "star tip that won't merge" bug).
 */
function reflexSuccessors(
  edges: DEdge[],
  byStart: Map<string, DEdge[]>,
): Map<string, DEdge> {
  const succ = new Map<string, DEdge>();
  for (const e of edges) {
    const outs = byStart.get(e.bk) ?? [];
    if (outs.length <= 1) {
      if (outs.length === 1) succ.set(ekey(e), outs[0]);
      continue;
    }
    const back = ang(e.a.x - e.b.x, e.a.y - e.b.y);
    let best = outs[0];
    let bestCW = -Infinity;
    for (const o of outs) {
      const a2 = ang(o.b.x - o.a.x, o.b.y - o.a.y);
      let cw = back - a2;
      while (cw <= 1e-9) cw += 2 * Math.PI;
      while (cw > 2 * Math.PI) cw -= 2 * Math.PI;
      if (cw > bestCW) {
        bestCW = cw;
        best = o;
      }
    }
    succ.set(ekey(e), best);
  }
  return succ;
}

/**
 * Chains boundary edges into closed loops. With `merge`, pinch vertices take the
 * widest (reflex) turn (via a precomputed order-independent pairing) so
 * corner-touching pieces weld into one loop; otherwise the first available edge
 * is taken (pieces stay separate).
 */
function walkLoops(edges: DEdge[], merge: boolean): { p: Pt; vk: string }[][] {
  const byStart = new Map<string, DEdge[]>();
  for (const e of edges) {
    const l = byStart.get(e.ak);
    if (l) l.push(e);
    else byStart.set(e.ak, [e]);
  }
  const succ = merge ? reflexSuccessors(edges, byStart) : null;
  const used = new Set<string>();
  const loops: { p: Pt; vk: string }[][] = [];

  for (const start of edges) {
    if (used.has(ekey(start))) continue;
    const loop: { p: Pt; vk: string }[] = [];
    let e: DEdge | null = start;
    while (e && !used.has(ekey(e))) {
      used.add(ekey(e));
      loop.push({ p: e.a, vk: e.ak });
      if (succ) {
        e = succ.get(ekey(e)) ?? null;
        continue;
      }
      // Non-merge: first still-unused outgoing edge (pieces stay separate).
      const outs: DEdge[] = (byStart.get(e.bk) ?? []).filter(
        (o) => !used.has(ekey(o)),
      );
      e = outs[0] ?? null;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Grid rays radiate at 60° steps; snap an angle to the nearest lattice ray. */
const RAY_STEP = Math.PI / 3;
function snapRay(a: number): number {
  return Math.round(a / RAY_STEP) * RAY_STEP;
}

/**
 * The tiny-hexagon neck ring at a pinch corner: the boundary is pulled back to
 * radius `neck` on the incoming (`prev`) and outgoing (`next`) grid rays, then
 * routed through a hexagon vertex on every empty ray across the notch. Returns
 * the ordered ring points (≥2), or null when this corner takes no neck (a
 * straight run, or `neck <= 0`).
 */
function pinchRing(prev: Pt, cur: Pt, next: Pt, neck: number): Pt[] | null {
  if (neck <= 0 || collinear(prev, cur, next)) return null;
  // Clamp so the neck never overshoots a short adjacent boundary edge.
  const lp = Math.hypot(prev.x - cur.x, prev.y - cur.y);
  const ln = Math.hypot(next.x - cur.x, next.y - cur.y);
  const d = Math.min(neck, lp * 0.45, ln * 0.45);
  const aIn = snapRay(Math.atan2(prev.y - cur.y, prev.x - cur.x));
  const aOut = snapRay(Math.atan2(next.y - cur.y, next.x - cur.x));
  // Sweep the short way from incoming to outgoing ray: the empty notch this
  // pass turns through. Emit a hexagon vertex on each grid ray along it.
  let diff = aOut - aIn;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  const steps = Math.round(Math.abs(diff) / RAY_STEP);
  const dir = diff >= 0 ? 1 : -1;
  const ring: Pt[] = [];
  for (let s = 0; s <= steps; s++) {
    const a = aIn + dir * s * RAY_STEP;
    ring.push({ x: cur.x + Math.cos(a) * d, y: cur.y + Math.sin(a) * d });
  }
  return ring;
}

/** One pinch corner's neck: the ring to route through, and how far back along
 *  the boundary it reaches. */
interface Neck {
  d: number;
  ring: Pt[];
}

/**
 * A raw loop → the plain boundary polyline, plus the necks its pinches want.
 *
 * Collinear points are dropped, tabs are spliced, and **the necks are only
 * measured, not applied** — they are computed here, off the lattice loop, so
 * they keep the tiny-hexagon shape they were designed to have (radius `neck` on
 * the grid's own 60° rays), and are handed to `applyNecks` to splice in after
 * the curves are finished. See `traceUnionLoops` for why that order matters.
 *
 * The tab splice does have to happen here, before rounding, and for two
 * reasons. A tab's root points lie on the original edge line, so the collinear
 * filter above would drop them if they were merely appended. And they *should*
 * shorten the run: without the tab in the ring, `roundPolygon`'s clamp does not
 * know it is there and an arc at a high radius will swallow the tab root whole.
 */
function plainRing(
  loop: { p: Pt; vk: string }[],
  deg: Map<string, number>,
  neck: number,
  tabs: Map<string, Pt[]> | null,
): { pts: Pt[]; necks: Map<string, Neck[]>; pinches: Set<string> } {
  const n = loop.length;
  const out: Pt[] = [];
  const necks = new Map<string, Neck[]>();
  const pinches = new Set<string>();
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n].p;
    const cur = loop[i];
    const nextNode = loop[(i + 1) % n];
    const next = nextNode.p;
    const col = collinear(prev, cur.p, next);
    if (!col) {
      out.push(cur.p);
      if ((deg.get(cur.vk) ?? 0) > 1) {
        const k = worldKey(cur.p);
        pinches.add(k);
        const ring = pinchRing(prev, cur.p, next, neck);
        if (ring) {
          const d = Math.hypot(ring[0].x - cur.p.x, ring[0].y - cur.p.y);
          // **Per visit, not per vertex.** A merged loop passes through a `><`
          // pinch twice, once per notch, and the two passes turn through
          // opposite sectors — so they are two different hexagon rings that
          // happen to share a coordinate. Keying them by point kept only the
          // last: one notch got a ring belonging to the other (doubled back on
          // itself) and the other got none. They are stored, and consumed, in
          // traversal order.
          const list = necks.get(k);
          if (list) list.push({ d, ring });
          else necks.set(k, [{ d, ring }]);
        }
      }
    }
    const tab = tabs?.get(`${cur.vk}->${nextNode.vk}`);
    if (tab) for (const p of tab) out.push(p);
  }
  return {
    pts: out.length >= 3 ? out : loop.map((nd) => nd.p),
    necks,
    pinches,
  };
}

/**
 * Splices each neck into a finished boundary polyline, replacing the pinch
 * vertex and everything within that neck's own radius of it.
 *
 * Applied last, on the flattened ring, so the necks cannot influence the
 * curves. The pinch vertex is guaranteed to still be there to find: it is held
 * ineligible for rounding precisely so this pass can locate it by coordinate.
 * The cut is walked outward by index rather than tested radially, so a distant
 * part of the boundary that happens to pass near the pinch is never eaten; a
 * neighbouring pinch is never eaten either.
 *
 * A pinch coordinate can appear **more than once** in the ring — that is what a
 * `><` join is — so the necks recorded for it are consumed in the same order
 * the ring visits them. Rounding never reorders points and never removes a
 * pinch, so the n-th visit here is the n-th visit on the plain loop.
 */
function applyNecks(ring: Pt[], necks: Map<string, Neck[]>): Pt[] {
  if (necks.size === 0) return ring;
  const n = ring.length;
  const keys = ring.map(worldKey);
  const drop = new Array<boolean>(n).fill(false);
  const insert = new Map<number, Pt[]>();
  const visits = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const list = necks.get(keys[i]);
    if (!list) continue;
    const visit = visits.get(keys[i]) ?? 0;
    visits.set(keys[i], visit + 1);
    const neck = list[Math.min(visit, list.length - 1)];
    insert.set(i, neck.ring);
    const reach = (step: -1 | 1) => {
      for (let s = 1; s < n; s++) {
        const j = (i + step * s + n) % n;
        if (necks.has(keys[j])) break; // never consume another join
        const far = Math.hypot(ring[j].x - ring[i].x, ring[j].y - ring[i].y);
        if (far >= neck.d) break;
        drop[j] = true;
      }
    };
    reach(-1);
    reach(1);
  }

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const pts = insert.get(i);
    if (pts) {
      for (const p of pts) out.push(p);
      continue;
    }
    if (!drop[i]) out.push(ring[i]);
  }
  return out.length >= 3 ? out : ring;
}

export interface UnionLoopOptions {
  /** Weld corner-touching pieces with tiny-hexagon necks. */
  merge?: boolean;
  /** Hexagon-neck radius for those welds, in world units (0 = sharp weld). */
  neck?: number;
  /** Corner-rounding radius in world units, 0 for none. */
  round?: number;
  /** Chord tolerance when flattening those corners, in world units. */
  sagitta?: number;
  /**
   * Boundary-vertex degrees of the **original artwork**, from
   * `boundaryVertexDegrees(painted)`. Required for `round` to mean anything
   * faithful — see below.
   */
  degrees?: Map<number, number>;
  /**
   * Tab outlines to splice into the boundary, keyed by directed edge
   * (`dirEdgeKey`). From `planCutJoints`. The flat pattern passes these; the
   * 3D preview does not, because a folded tab is not in the sheet's plane.
   */
  tabs?: Map<string, Pt[]>;
  /**
   * Extra hole loops to add to the result — the 3D preview's slot openings.
   * Appended after rounding: a slot is machined, not part of the artwork's
   * silhouette, and has no lattice vertices to round against.
   */
  holes?: Pt[][];
}

/**
 * Traces the union boundary of a triangle set as closed loops (world coords).
 * With `merge`, corner-touching pieces are welded with tiny-hexagon necks.
 *
 * **A sheet is a union of colours, and it must still round as if it were not.**
 * This is the one place in the app that holds geometry which has forgotten what
 * colour it came from: `Sᵢ` merges every colour at level i and above, so its
 * boundary runs along colour seams that are invisible in the artwork and its
 * corners have no region to be a corner *of*. Rounding it on its own terms — as
 * if the whole sheet were one colour — rounds every corner where three colours
 * meet, which the artwork keeps sharp, and an upper sheet of scattered cells
 * comes out as a handful of unrecognisable discs.
 *
 * So each vertex is looked back up in the original artwork's degree map, via
 * `latticeVertexIdAt`, and rounds only under the same degree-2 rule the flat
 * renderer applies. Neck points are not lattice vertices, so they come back null
 * and stay sharp — which is also what the necks want, being deliberate straight
 * bridges. Without `degrees` nothing rounds at all: silently rounding everything
 * is the failure this parameter exists to prevent, so it is not the fallback.
 *
 * The remaining difference from the artwork is the *clamp*, not the shape: run
 * lengths are measured along the sheet's boundary, which can pass straight
 * through a junction where the colour's own ring turned, so a corner just before
 * such a junction may take a slightly larger radius than it does on screen.
 * Both corners at the junction itself stay sharp either way.
 *
 * The result is flattened back to a polyline rather than carrying arcs, so
 * everything downstream (bounds, the SVG path emit, and the 3D preview's
 * extrusion) keeps working on plain points. A cutter follows a dense polyline
 * as happily as an arc.
 *
 * **Rounding runs before the necks**, which are spliced into the finished
 * polyline afterwards. Inserting them first put two more vertices on the ring,
 * and `roundPolygon` clamps every radius against the straight run it sits on —
 * so the corners flanking a join rounded less than the same corner elsewhere on
 * the sheet, the join reshaping the curve beside it. Pinch vertices are held
 * ineligible for rounding, which keeps them findable by coordinate afterwards.
 *
 * Tabs are the exception and stay spliced *before* rounding, deliberately: the
 * clamp they cause is load-bearing. Without the tab in the ring, an arc at a
 * high radius simply swallows the tab root.
 */
export function traceUnionLoops(
  keys: string[],
  options: UnionLoopOptions = {},
): Pt[][] {
  const {
    merge = false,
    neck = 0,
    round = 0,
    sagitta,
    degrees,
    tabs,
    holes,
  } = options;
  const edges = boundaryEdges(keys);
  const deg = outDegree(edges);
  const raw = walkLoops(edges, merge);
  const rings = raw.map((loop) =>
    plainRing(loop, deg, merge ? neck : 0, tabs ?? null),
  );

  // Curves first, joins after. A neck used to be spliced in before rounding, so
  // it became two more vertices on the ring — and `roundPolygon` clamps every
  // radius against the straight run it sits on, so the corners flanking a join
  // rounded *less* than the same corner elsewhere on the same sheet. The join
  // was silently reshaping the curve it sat next to. Rounding the plain boundary
  // and splicing the necks into the finished polyline gives one radius rule for
  // the whole sheet, and costs the necks nothing: they are measured off the
  // lattice loop either way, so they keep the tiny-hexagon shape exactly.
  const flat = rings.map(({ pts, pinches }) => {
    if (round <= 0 || !degrees) return pts;
    const eligible = (i: number) => {
      // A pinch is a junction and stays sharp, as junctions do everywhere else
      // here — and that is also what guarantees `applyNecks` can still find it
      // by coordinate once the arcs have been flattened away.
      if (pinches.has(worldKey(pts[i]))) return false;
      const v = latticeVertexIdAt(pts[i].x, pts[i].y);
      return v !== null && degrees.get(v) === 2;
    };
    const corners = roundPolygon(pts, round, eligible);
    return flattenRoundedRing(corners, sagitta).map(([x, y]) => ({ x, y }));
  });

  const loops = flat.map((ring, i) => applyNecks(ring, rings[i].necks));
  const extra = holes ?? [];
  return extra.length ? loops.concat(extra) : loops;
}

/**
 * The extra "neck fill" triangles (world coords) that bridge corner-touching
 * pieces of a triangle set — a fan from each touch vertex out across its
 * tiny-hexagon ring. Extruded alongside the tiles, these weld the 3D stack the
 * same way the necks weld the flat SVG cut. Empty when `neck <= 0`.
 */
export function neckFillTriangles(keys: string[], neck: number): Pt[][] {
  if (neck <= 0) return [];
  const edges = boundaryEdges(keys);
  const deg = outDegree(edges);
  const raw = walkLoops(edges, true);
  const tris: Pt[][] = [];
  for (const loop of raw) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const cur = loop[i];
      if ((deg.get(cur.vk) ?? 0) <= 1) continue;
      const prev = loop[(i - 1 + n) % n].p;
      const next = loop[(i + 1) % n].p;
      const ring = pinchRing(prev, cur.p, next, neck);
      if (!ring || ring.length < 2) continue;
      for (let s = 0; s + 1 < ring.length; s++) {
        tris.push([cur.p, ring[s], ring[s + 1]]);
      }
    }
  }
  return tris;
}

export interface CutSVGOptions {
  /** Overall design width (longest painted extent) in mm. */
  widthMm: number;
  /** Top outline-silhouette mat on/off. */
  frame: CutFrame;
  /** Weld corner-touching islands into one piece with tiny-hexagon necks. */
  mergeIslands?: boolean;
  /** Hexagon-neck radius for merges, in world units (0 = sharp weld). */
  neck?: number;
  /** Corner-rounding radius in world units (0 = sharp), from the layer effect. */
  round?: number;
  /** Tab-and-slot joints from `planCutJoints`. Planned once by the caller and
   *  given to both builders, so the preview and the file place the same ones. */
  joints?: CutJoints;
}

/** Gap between tiled layers, in mm. */
const TILE_GAP_MM = 6;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Builds one layered, auto-tiled SVG for the cut plan. Returns null if empty.
 */
export function buildCutSVG(
  plan: CutPlan,
  painted: Record<string, string>,
  options: CutSVGOptions,
  gridRotation = 0,
): string | null {
  const transform = computeModelTransform(painted, options.widthMm, gridRotation);
  if (!transform) return null;
  const { layers } = cutLayers(plan, painted, options.frame);
  if (layers.length === 0) return null;
  const scale = transform.scale;
  const merge = options.mergeIslands ?? false;
  const neck = options.neck ?? 0;
  const joints = options.joints;
  const turn = (p: Pt): Pt => {
    const [x, y] = rotatePoint(p.x, p.y, gridRotation);
    return { x, y };
  };

  // Turned before the tile is measured, not after: the sheet layout sizes its
  // tiles from these bounds, so a pointy-top design has to be the right way
  // round *here* or the tiles are laid out to the flat-top box. The loops are
  // traced in world space, so this is the one place the turn can happen —
  // unlike the mesh paths, nothing here goes through `toModel`.
  // From the artwork, not from any sheet: a sheet has already merged colours
  // together, and this is what remembers where their boundaries were.
  const degrees = boundaryVertexDegrees(painted);
  const traced = layers.map((l, i) =>
    traceUnionLoops(l.keys, {
      merge,
      neck,
      round: options.round ?? 0,
      sagitta: FAB_CHORD_MM / scale,
      degrees,
      tabs: joints?.perLayer[i].tabs,
    }).map((loop) => loop.map(turn)),
  );
  // Turned the same way, on the same pass. Neither needs a part in the bounds:
  // a fold sits on its tab's root and a slot inside its sheet, and the tabs are
  // already in the traced loops.
  const turnSegs = (segs: [Pt, Pt][]) =>
    segs.map(([a, b]) => [turn(a), turn(b)] as [Pt, Pt]);
  const folds = layers.map((_l, i) => turnSegs(joints?.perLayer[i].folds ?? []));
  const slots = layers.map((_l, i) => turnSegs(joints?.perLayer[i].slots ?? []));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const loops of traced) {
    for (const loop of loops) {
      for (const p of loop) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  if (!isFinite(minX)) return null;

  const tileW = (maxX - minX) * scale;
  const tileH = (maxY - minY) * scale;
  const cols = Math.ceil(Math.sqrt(layers.length));
  const rows = Math.ceil(layers.length / cols);
  const totalW = cols * tileW + (cols - 1) * TILE_GAP_MM;
  const totalH = rows * tileH + (rows - 1) * TILE_GAP_MM;

  const tx = (x: number, ox: number) => round((x - minX) * scale + ox);
  const ty = (y: number, oy: number) => round((y - minY) * scale + oy);

  const parts: string[] = [];
  layers.forEach((layer, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = col * (tileW + TILE_GAP_MM);
    const oy = row * (tileH + TILE_GAP_MM);
    const d = traced[i]
      .map((loop) => {
        const seg = loop
          .map((p, j) => `${j === 0 ? "M" : "L"}${tx(p.x, ox)} ${ty(p.y, oy)}`)
          .join(" ");
        return `${seg} Z`;
      })
      .join(" ");
    const label = xmlEscape(
      layer.isFrame ? "Mat (outline)" : `${layer.label} — ${layer.colorHex}`,
    );
    parts.push(
      `  <g inkscape:groupmode="layer" inkscape:label="${label}" id="cut-layer-${i + 1}">\n` +
        `    <path d="${d}" fill="${layer.colorHex}" fill-opacity="0.85" fill-rule="evenodd" stroke="#000000" stroke-width="0.1"/>\n` +
        `  </g>`,
    );
    const line = (seg: [Pt, Pt]) =>
      `M${tx(seg[0].x, ox)} ${ty(seg[0].y, oy)} L${tx(seg[1].x, ox)} ${ty(seg[1].y, oy)}`;
    // Slots get their own layer rather than joining the sheet's compound path.
    // Same geometry for the machine either way, but a slot drawn as one more
    // sub-path is indistinguishable from the artwork's own negative space —
    // there was no way to tell which holes were joinery. It is also the only
    // honest shape for it: a slot is a *line*, and a line cannot be a hole.
    if (slots[i].length > 0) {
      parts.push(
        `  <g inkscape:groupmode="layer" inkscape:label="${label} — slots" id="cut-slots-${i + 1}">\n` +
          `    <path d="${slots[i].map(line).join(" ")}" fill="none" stroke="#000000" stroke-width="0.1"/>\n` +
          `  </g>`,
      );
    }
    // Folds are scored, not cut: a tab cut free at its root is just a hole.
    if (folds[i].length > 0) {
      parts.push(
        `  <g inkscape:groupmode="layer" inkscape:label="${label} — folds" id="cut-folds-${i + 1}">\n` +
          `    <path d="${folds[i].map(line).join(" ")}" fill="none" stroke="#0066ff" stroke-width="0.2" stroke-dasharray="1 1"/>\n` +
          `  </g>`,
      );
    }
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${round(totalW)}mm" height="${round(totalH)}mm" ` +
    `viewBox="0 0 ${round(totalW)} ${round(totalH)}">\n` +
    parts.join("\n") +
    `\n</svg>\n`
  );
}
