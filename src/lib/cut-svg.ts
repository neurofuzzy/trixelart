import { getTriVertices, stringToTri } from "@/lib/grid-math";
import { signedArea, computeModelTransform, type Pt } from "@/lib/mesh-export";
import { cutLayers, type CutFrame } from "@/lib/cut-mesh";
import type { CutPlan } from "@/lib/cut-export";

// ---------------------------------------------------------------------------
// Cut plan → one layered SVG for cutting machines (see docs/fabrication-export
// .md §5). Each layer is emitted as ONE compound path — the union boundary of
// its triangles (outer edge + hole edges as sub-paths) — so the cutter cuts
// only the silhouette and holes, never the internal triangle edges (which would
// shred the sheet). Layers are auto-tiled apart into a grid and grouped as
// labeled SVG layers, ready to assign to cardstock.
//
// The union is traced with no CSG: an edge of a triangle is on the boundary iff
// the neighbor across it is absent (its reverse directed edge is missing). We
// chain boundary edges into closed loops and merge collinear runs.
// ---------------------------------------------------------------------------

/** Quantize a world point to a stable integer key (1e-3 world units). */
function vkey(p: Pt): string {
  return `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
}

interface DEdge {
  key: string; // `${ak}->${bk}`
  a: Pt;
  ak: string;
  bk: string;
}

/** Three collinear points? (cross product ~ 0 within tolerance). */
function collinear(p: Pt, q: Pt, r: Pt): boolean {
  const cross = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return Math.abs(cross) < 1e-4;
}

/** Drop vertices that lie on a straight run so a long edge is one segment. */
function mergeCollinear(loop: Pt[]): Pt[] {
  const n = loop.length;
  if (n < 3) return loop;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const cur = loop[i];
    const next = loop[(i + 1) % n];
    if (!collinear(prev, cur, next)) out.push(cur);
  }
  return out.length >= 3 ? out : loop;
}

/**
 * Traces the union boundary of a triangle set as closed loops (world coords):
 * outer boundaries and holes, each a ring of points. Winding is consistent
 * (render with fill-rule evenodd for holes).
 */
export function traceUnionLoops(keys: string[]): Pt[][] {
  const present = new Set<string>();
  const edges: DEdge[] = [];
  for (const key of keys) {
    const t = stringToTri(key);
    let v = getTriVertices(t.q, t.r, t.type) as Pt[];
    if (signedArea(v) < 0) v = [v[0], v[2], v[1]]; // force CCW
    for (let i = 0; i < 3; i++) {
      const a = v[i];
      const b = v[(i + 1) % 3];
      const ak = vkey(a);
      const bk = vkey(b);
      const ekey = `${ak}->${bk}`;
      present.add(ekey);
      edges.push({ key: ekey, a, ak, bk });
    }
  }

  // Boundary edges: no triangle on the far side ⇒ reverse edge absent.
  const byKey = new Map<string, DEdge>();
  const adj = new Map<string, string[]>(); // ak → outgoing boundary edge keys
  for (const e of edges) {
    if (!present.has(`${e.bk}->${e.ak}`)) {
      byKey.set(e.key, e);
      const list = adj.get(e.ak);
      if (list) list.push(e.key);
      else adj.set(e.ak, [e.key]);
    }
  }

  // Chain boundary edges head-to-tail into closed loops.
  const used = new Set<string>();
  const loops: Pt[][] = [];
  for (const start of byKey.keys()) {
    if (used.has(start)) continue;
    const loop: Pt[] = [];
    let cur: string | undefined = start;
    while (cur && !used.has(cur)) {
      used.add(cur);
      const e = byKey.get(cur) as DEdge;
      loop.push(e.a);
      const outs = adj.get(e.bk);
      cur = outs?.find((k) => !used.has(k));
    }
    if (loop.length >= 3) loops.push(mergeCollinear(loop));
  }
  return loops;
}

export interface CutSVGOptions {
  /** Overall design width (longest painted extent) in mm. */
  widthMm: number;
  /** Top outline-silhouette mat on/off. */
  frame: CutFrame;
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

  // Trace every layer; collect loops (world) and a shared bbox (all layers
  // carry the frame, so the frame rectangle bounds them all → equal tiles).
  const traced = layers.map((l) => traceUnionLoops(l.keys));
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

  const parts: string[] = [];
  layers.forEach((layer, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = col * (tileW + TILE_GAP_MM);
    const oy = row * (tileH + TILE_GAP_MM);
    // World → mm, normalized to this tile's top-left.
    const d = traced[i]
      .map((loop) => {
        const seg = loop
          .map((p, j) => {
            const x = round((p.x - minX) * scale + ox);
            const y = round((p.y - minY) * scale + oy);
            return `${j === 0 ? "M" : "L"}${x} ${y}`;
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
