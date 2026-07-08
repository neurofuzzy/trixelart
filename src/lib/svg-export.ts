import { getTriVertices } from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";

export interface TriangleData {
  points: [number, number][];
  fill: string;
}

export interface MergedPathData {
  fill: string;
  d: string;
}

export interface SVGExportOptions {
  stroke?: boolean;
  merge?: boolean;
}

const PRECISION = 3;
const PADDING = 20;

function fmt(n: number): string {
  return n.toFixed(PRECISION);
}

function roundNum(n: number): number {
  const factor = Math.pow(10, PRECISION);
  return Math.round(n * factor) / factor;
}

function keyOf(x: number, y: number): string {
  return `${fmt(x)},${fmt(y)}`;
}

/**
 * Returns the signed area of a triangle in screen space (y-down).
 * Positive → clockwise, negative → counter-clockwise.
 */
function signedArea([ax, ay]: [number, number], [bx, by]: [number, number], [cx, cy]: [number, number]): number {
  return ax * (by - cy) + bx * (cy - ay) + cx * (ay - by);
}

/** Ensures triangle vertices wind clockwise in screen space (y-down). */
function ensureCW(points: [number, number][]): [number, number][] {
  if (signedArea(points[0], points[1], points[2]) < 0) {
    return [points[0], points[2], points[1]];
  }
  return points;
}

export function generateTriangles(painted: Record<string, string>): TriangleData[] {
  const entries = Object.entries(painted);
  const triangles: TriangleData[] = [];

  for (const [key, encoded] of entries) {
    const parts = key.split(",");
    if (parts.length !== 3) continue;
    const q = parseInt(parts[0]);
    const r = parseInt(parts[1]);
    const type = parts[2] as "up" | "down";
    const verts = getTriVertices(q, r, type);
    const fill = resolveColor(encoded);
    triangles.push({
      points: ensureCW([
        [roundNum(verts[0].x), roundNum(verts[0].y)],
        [roundNum(verts[1].x), roundNum(verts[1].y)],
        [roundNum(verts[2].x), roundNum(verts[2].y)],
      ]),
      fill,
    });
  }

  return triangles;
}

export function mergeTrianglesByColor(triangles: TriangleData[], ox = 0, oy = 0): MergedPathData[] {
  const byColor = new Map<string, [number, number][][]>();
  for (const tri of triangles) {
    if (!byColor.has(tri.fill)) byColor.set(tri.fill, []);
    byColor.get(tri.fill)!.push(tri.points);
  }

  const results: MergedPathData[] = [];

  for (const [fill, polys] of byColor) {
    type EdgeEntry = {
      count: number;
      a: [number, number];
      b: [number, number];
      ka: string;
      kb: string;
    };
    const edgeCount = new Map<string, EdgeEntry>();

    for (const points of polys) {
      const n = points.length;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % n];
        const ka = keyOf(ax, ay);
        const kb = keyOf(bx, by);
        const undirected = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;

        if (!edgeCount.has(undirected)) {
          edgeCount.set(undirected, { count: 0, a: [ax, ay], b: [bx, by], ka, kb });
        }
        edgeCount.get(undirected)!.count++;
      }
    }

    type NextEntry = {
      toKey: string;
      toPoint: [number, number];
      fromPoint: [number, number];
    };
    const next = new Map<string, NextEntry[]>();
    for (const e of edgeCount.values()) {
      if (e.count !== 1) continue;
      if (!next.has(e.ka)) next.set(e.ka, []);
      next.get(e.ka)!.push({ toKey: e.kb, toPoint: e.b, fromPoint: e.a });
    }

    const used = new Set<string>();
    const loops: [number, number][][] = [];

    for (const [startKey, edges] of next) {
      for (const startEdge of edges) {
        const edgeId = `${startKey}>${startEdge.toKey}`;
        if (used.has(edgeId)) continue;

        const loop: [number, number][] = [startEdge.fromPoint];
        let curKey = startKey;
        let curEdge = startEdge;

        while (true) {
          used.add(`${curKey}>${curEdge.toKey}`);
          loop.push(curEdge.toPoint);
          if (curEdge.toKey === startKey) break;

          const candidates = next.get(curEdge.toKey) || [];
          const found = candidates.find(
            (c) => !used.has(`${curEdge.toKey}>${c.toKey}`),
          );
          if (!found) break;
          curKey = curEdge.toKey;
          curEdge = found;
        }

        if (loop.length > 3) loops.push(loop);
      }
    }

    if (loops.length === 0) continue;

    const d = loops
      .map((loop) => {
        const [first, ...rest] = loop;
        return `M${fmt(first[0] + ox)},${fmt(first[1] + oy)} ` + rest.map((p) => `L${fmt(p[0] + ox)},${fmt(p[1] + oy)}`).join(" ") + " Z";
      })
      .join(" ");

    results.push({ fill, d });
  }

  return results;
}

function computeBounds(triangles: TriangleData[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tri of triangles) {
    for (const [x, y] of tri.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

export function generateSVG(
  painted: Record<string, string>,
  options?: SVGExportOptions,
): string {
  const triangles = generateTriangles(painted);
  if (triangles.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"/>';
  }

  const bounds = computeBounds(triangles);
  if (!bounds) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"/>';
  }

  const { minX, minY, maxX, maxY } = bounds;
  const w = maxX - minX + PADDING * 2;
  const h = maxY - minY + PADDING * 2;

  if (options?.merge) {
    const merged = mergeTrianglesByColor(triangles, -minX + PADDING, -minY + PADDING);
    const paths = merged
      .map(
        ({ fill, d }) =>
          `  <path d="${d}" fill="${fill}"${
            options?.stroke ? ` stroke="${fill}" stroke-width="0.5"` : ""
          }/>`,
      )
      .join("\n");

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
${paths}
</svg>`;
  }

  const polygons = triangles
    .map(
      ({ points, fill }) =>
        `  <polygon points="${points.map((p) => `${fmt(p[0] - minX + PADDING)},${fmt(p[1] - minY + PADDING)}`).join(" ")}" fill="${fill}"${
          options?.stroke ? ` stroke="${fill}" stroke-width="0.5"` : ""
        }/>`,
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
${polygons}
</svg>`;
}
