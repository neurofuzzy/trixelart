import { getTriVertices, stringToTri } from "@/lib/grid-math";
import { signedArea, computeModelTransform, type Pt } from "@/lib/mesh-export";
import { cutLayers, type CutFrame } from "@/lib/cut-mesh";
import type { CutPlan } from "@/lib/cut-export";

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
// each pinch corner is replaced by a quadratic Bézier "neck" (control point at
// the touch vertex → tangent to both edges) for a smooth metaball-style join.
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

/** A boundary node: the segment INTO `p` is a line, or a quad Bézier if `q` set. */
interface LoopNode {
  p: Pt;
  q?: Pt;
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

/**
 * Chains boundary edges into closed loops. With `merge`, pinch vertices take the
 * widest (reflex) turn so corner-touching pieces weld into one loop; otherwise
 * the first available edge is taken (pieces stay separate).
 */
function walkLoops(edges: DEdge[], merge: boolean): { p: Pt; vk: string }[][] {
  const byStart = new Map<string, DEdge[]>();
  for (const e of edges) {
    const l = byStart.get(e.ak);
    if (l) l.push(e);
    else byStart.set(e.ak, [e]);
  }
  const ekey = (e: DEdge) => `${e.ak}->${e.bk}`;
  const ang = (dx: number, dy: number) => Math.atan2(dy, dx);
  const used = new Set<string>();
  const loops: { p: Pt; vk: string }[][] = [];

  for (const start of edges) {
    if (used.has(ekey(start))) continue;
    const loop: { p: Pt; vk: string }[] = [];
    let e: DEdge | null = start;
    while (e && !used.has(ekey(e))) {
      used.add(ekey(e));
      loop.push({ p: e.a, vk: e.ak });
      const outs: DEdge[] = (byStart.get(e.bk) ?? []).filter(
        (o) => !used.has(ekey(o)),
      );
      if (outs.length === 0) {
        e = null;
        break;
      }
      if (outs.length === 1) {
        e = outs[0];
        continue;
      }
      // Pinch: merge → widest clockwise (reflex) turn; else first available.
      if (!merge) {
        e = outs[0];
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
      e = best;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Converts a raw loop to render nodes: drops collinear points, and (when merging)
 * replaces pinch corners with a quad-Bézier neck of pull-back `neck` (control at
 * the touch vertex → tangent to both edges).
 */
function decorate(
  loop: { p: Pt; vk: string }[],
  deg: Map<string, number>,
  neck: number,
): LoopNode[] {
  const n = loop.length;
  const out: LoopNode[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n].p;
    const cur = loop[i];
    const next = loop[(i + 1) % n].p;
    const col = collinear(prev, cur.p, next);
    const pinch = (deg.get(cur.vk) ?? 0) > 1;
    if (pinch && !col && neck > 0) {
      const din = { x: prev.x - cur.p.x, y: prev.y - cur.p.y };
      const dl = Math.hypot(din.x, din.y) || 1;
      const li = Math.min(neck, dl * 0.45);
      const don = { x: next.x - cur.p.x, y: next.y - cur.p.y };
      const dr = Math.hypot(don.x, don.y) || 1;
      const lo = Math.min(neck, dr * 0.45);
      out.push({ p: { x: cur.p.x + (din.x / dl) * li, y: cur.p.y + (din.y / dl) * li } });
      out.push({
        p: { x: cur.p.x + (don.x / dr) * lo, y: cur.p.y + (don.y / dr) * lo },
        q: { x: cur.p.x, y: cur.p.y },
      });
    } else if (!col) {
      out.push({ p: cur.p });
    }
  }
  return out.length >= 3 ? out : loop.map((n) => ({ p: n.p }));
}

/**
 * Traces the union boundary of a triangle set as closed loops (world coords).
 * With `merge`, corner-touching pieces are welded with smooth Bézier necks.
 */
export function traceUnionLoops(
  keys: string[],
  merge = false,
  neck = 0,
): LoopNode[][] {
  const edges = boundaryEdges(keys);
  const deg = outDegree(edges);
  const raw = walkLoops(edges, merge);
  return raw.map((loop) => decorate(loop, deg, merge ? neck : 0));
}

export interface CutSVGOptions {
  /** Overall design width (longest painted extent) in mm. */
  widthMm: number;
  /** Top outline-silhouette mat on/off. */
  frame: CutFrame;
  /** Weld corner-touching islands into one piece with smooth necks. */
  mergeIslands?: boolean;
  /** Neck pull-back for merges, in world units (0 = sharp weld). */
  neck?: number;
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
): string | null {
  const transform = computeModelTransform(painted, options.widthMm);
  if (!transform) return null;
  const layers = cutLayers(plan, painted, options.frame);
  if (layers.length === 0) return null;
  const scale = transform.scale;
  const merge = options.mergeIslands ?? false;
  const neck = options.neck ?? 0;

  const traced = layers.map((l) => traceUnionLoops(l.keys, merge, neck));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const loops of traced) {
    for (const loop of loops) {
      for (const nd of loop) {
        if (nd.p.x < minX) minX = nd.p.x;
        if (nd.p.x > maxX) maxX = nd.p.x;
        if (nd.p.y < minY) minY = nd.p.y;
        if (nd.p.y > maxY) maxY = nd.p.y;
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
          .map((nd, j) => {
            const x = tx(nd.p.x, ox);
            const y = ty(nd.p.y, oy);
            if (j === 0) return `M${x} ${y}`;
            if (nd.q) return `Q${tx(nd.q.x, ox)} ${ty(nd.q.y, oy)} ${x} ${y}`;
            return `L${x} ${y}`;
          })
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
