import { getTriVertices, stringToTri } from "@/lib/grid-math";
import { signedArea, computeModelTransform, type Pt } from "@/lib/mesh-export";
import { cutLayers, type CutFrame } from "@/lib/cut-mesh";
import type { CutPlan } from "@/lib/cut-export";
import { flattenRoundedRing, roundPolygon } from "@/lib/round-corners";
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

/** Quantize a world point to a stable integer key (1e-3 world units). */
function vkey(p: Pt): string {
  return `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
}

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
      edges.push({ a, b, ak: vkey(a), bk: vkey(b) });
      present.add(`${vkey(a)}->${vkey(b)}`);
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

/**
 * Converts a raw loop to render points: drops collinear points, and (when
 * merging with `neck > 0`) replaces each pinch corner with a tiny-hexagon neck —
 * i.e. the union boundary of a small regular hexagon at the touch vertex.
 */
function hexNeck(
  loop: { p: Pt; vk: string }[],
  deg: Map<string, number>,
  neck: number,
): Pt[] {
  const n = loop.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n].p;
    const cur = loop[i];
    const next = loop[(i + 1) % n].p;
    const col = collinear(prev, cur.p, next);
    const pinch = (deg.get(cur.vk) ?? 0) > 1;
    const ring = pinch && !col ? pinchRing(prev, cur.p, next, neck) : null;
    if (ring) for (const p of ring) out.push(p);
    else if (!col) out.push(cur.p);
  }
  return out.length >= 3 ? out : loop.map((nd) => nd.p);
}

/**
 * Traces the union boundary of a triangle set as closed loops (world coords).
 * With `merge`, corner-touching pieces are welded with tiny-hexagon necks.
 *
 * `round` is the corner-rounding radius in world units, 0 for none. Unlike the
 * flat artwork, a cut sheet has no airtightness constraint to respect — the
 * sheets are *nested*, so a rounded piece sits on a strictly larger one and
 * cannot open a gap — hence every non-collinear corner is eligible and no
 * boundary-degree test is needed.
 *
 * The result is flattened back to a polyline rather than carrying arcs, so
 * everything downstream (bounds, the SVG path emit, and the 3D preview's
 * extrusion) keeps working on plain points. A cutter follows a dense polyline
 * as happily as an arc.
 *
 * Rounding runs *after* the necks are inserted, and the run clamp is what makes
 * that safe: a neck's edges are `neck`-sized, so the clamp drives the radius at
 * those vertices to nearly nothing on its own and the tiny-hexagon bridge keeps
 * the shape it was designed to have.
 */
export function traceUnionLoops(
  keys: string[],
  merge = false,
  neck = 0,
  round = 0,
): Pt[][] {
  const edges = boundaryEdges(keys);
  const deg = outDegree(edges);
  const raw = walkLoops(edges, merge);
  const loops = raw.map((loop) => hexNeck(loop, deg, merge ? neck : 0));
  if (round <= 0) return loops;
  return loops.map((loop) => {
    const rounded = roundPolygon(loop, round, () => true);
    return flattenRoundedRing(rounded).map(([x, y]) => ({ x, y }));
  });
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
  const layers = cutLayers(plan, painted, options.frame);
  if (layers.length === 0) return null;
  const scale = transform.scale;
  const merge = options.mergeIslands ?? false;
  const neck = options.neck ?? 0;

  // Turned before the tile is measured, not after: the sheet layout sizes its
  // tiles from these bounds, so a pointy-top design has to be the right way
  // round *here* or the tiles are laid out to the flat-top box. The loops are
  // traced in world space, so this is the one place the turn can happen —
  // unlike the mesh paths, nothing here goes through `toModel`.
  const traced = layers.map((l) =>
    traceUnionLoops(l.keys, merge, neck, options.round ?? 0).map((loop) =>
      loop.map((p) => {
        const [x, y] = rotatePoint(p.x, p.y, gridRotation);
        return { x, y };
      }),
    ),
  );
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
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${round(totalW)}mm" height="${round(totalH)}mm" ` +
    `viewBox="0 0 ${round(totalW)} ${round(totalH)}">\n` +
    parts.join("\n") +
    `\n</svg>\n`
  );
}
