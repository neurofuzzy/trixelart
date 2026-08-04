import { getTriVertices } from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import {
  cropDisplayBounds,
  cropWorldBounds,
  rotatePoint,
  type CropRect,
  type Rect,
} from "@/lib/crop";
import type { Layer } from "@/hooks/use-history";
import {
  buildRenderPlan,
  hatchStrokes,
  hatchStrokesBounds,
  stepRoundRadius,
  type HatchStroke,
} from "@/lib/hatch-render";
import {
  flattenRoundedRing,
  roundedRegions,
  roundedRingToPath,
} from "@/lib/round-corners";

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
  /** Opaque page colour, drawn as the first element. Omitted → transparent, as
   *  the artwork export has always been. Used by the project file, whose SVG
   *  doubles as a desktop thumbnail: a transparent one is invisible against a
   *  dark file browser. */
  background?: string;
  /** Markup inserted directly after the opening tag — a `<metadata>` block for
   *  the project file. Omitted → nothing, so the artwork export is unchanged. */
  metadata?: string;
}

export const PRECISION = 3;
const PADDING = 20;

/** Shared with the plotter export so every vector file rounds identically. */
export function fmt(n: number): string {
  return n.toFixed(PRECISION);
}

export function roundNum(n: number): number {
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

/** Emits one hatch layer as a group of `<line>`s, offset into document space. */
function hatchMarkup(
  strokes: HatchStroke[],
  ox: number,
  oy: number,
): string {
  if (strokes.length === 0) return "";
  // Grouped by (colour, weight) so the stroke attributes are stated once
  // instead of on every line.
  const byStyle = new Map<string, HatchStroke[]>();
  for (const s of strokes) {
    const k = `${s.color}|${s.weight}`;
    const list = byStyle.get(k);
    if (list) list.push(s);
    else byStyle.set(k, [s]);
  }

  const out: string[] = [];
  for (const list of byStyle.values()) {
    const { color, weight } = list[0];
    const lines = list
      .map(
        ({ seg }) =>
          `    <line x1="${fmt(seg[0] + ox)}" y1="${fmt(seg[1] + oy)}" x2="${fmt(seg[2] + ox)}" y2="${fmt(seg[3] + oy)}"/>`,
      )
      .join("\n");
    out.push(
      `  <g stroke="${color}" stroke-width="${fmt(weight)}" stroke-linecap="butt">\n${lines}\n  </g>`,
    );
  }
  return out.join("\n");
}

/** The empty document's size. Arbitrary — there is no artwork to measure — but
 *  it still has to be *some* box for the background to fill. */
const EMPTY_SIZE = 100;

/**
 * The one place the document is assembled, so `background` and `metadata` reach
 * the empty document as well as a drawn one.
 *
 * That is the whole reason this exists: a project with nothing painted but with
 * selections or pattern presets saved is entirely reachable, and if the empty
 * path skipped the options it would write a project file containing no project.
 * The self-closing form is kept for the plain empty artwork export, byte for
 * byte as before.
 */
function wrap(
  w: number,
  h: number,
  body: string,
  options?: SVGExportOptions,
): string {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"`;
  const parts = [
    options?.metadata ?? "",
    // Percentages resolve against the viewport the viewBox establishes, so this
    // covers the page exactly without restating its dimensions.
    options?.background
      ? `  <rect x="0" y="0" width="100%" height="100%" fill="${options.background}"/>`
      : "",
    body,
  ].filter(Boolean);
  if (parts.length === 0) return `${open}/>`;
  return `${open}>\n${parts.join("\n")}\n</svg>`;
}

export function generateSVG(
  layers: Layer[],
  options?: SVGExportOptions,
): string {
  const plan = buildRenderPlan(layers);

  // Resolve every step's geometry up front: the document has to be sized over
  // hatch strokes as well as fill triangles, or a hatch-only document exports
  // as the empty placeholder.
  // Triangles are resolved even for a rounded step: rounding only ever cuts a
  // convex corner inward or bulges a concave one into the neighbouring region,
  // so the artwork's bounding box is unchanged and can still be measured off the
  // raw lattice.
  const resolved = plan.map((step) =>
    step.kind === "fill"
      ? {
          kind: "fill" as const,
          tris: generateTriangles(step.painted),
          painted: step.painted,
          radius: stepRoundRadius(step),
        }
      : { kind: "hatch" as const, strokes: hatchStrokes(step.painted) },
  );

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (b: { minX: number; minY: number; maxX: number; maxY: number } | null) => {
    if (!b) return;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  };
  for (const step of resolved) {
    if (step.kind === "fill") grow(computeBounds(step.tris));
    else grow(hatchStrokesBounds(step.strokes));
  }
  if (!Number.isFinite(minX)) {
    return wrap(EMPTY_SIZE, EMPTY_SIZE, "", options);
  }

  const w = maxX - minX + PADDING * 2;
  const h = maxY - minY + PADDING * 2;
  const ox = -minX + PADDING;
  const oy = -minY + PADDING;

  const body = resolved
    .map((step) => {
      if (step.kind === "hatch") return hatchMarkup(step.strokes, ox, oy);
      if (step.tris.length === 0) return "";
      // A rounded step is inherently merged — the effect is defined on whole
      // regions — so it ignores the `merge` option rather than offering a
      // per-triangle variant that could not express an arc.
      if (step.radius > 0) {
        return roundedRegions(step.painted, step.radius)
          .map(({ fill, rings }) => {
            const d = rings
              .map((r) => roundedRingToPath(r, fmt, ox, oy))
              .filter(Boolean)
              .join(" ");
            if (!d) return "";
            return `  <path d="${d}" fill="${fill}"${
              options?.stroke ? ` stroke="${fill}" stroke-width="0.5"` : ""
            }/>`;
          })
          .filter(Boolean)
          .join("\n");
      }
      if (options?.merge) {
        return mergeTrianglesByColor(step.tris, ox, oy)
          .map(
            ({ fill, d }) =>
              `  <path d="${d}" fill="${fill}"${
                options?.stroke ? ` stroke="${fill}" stroke-width="0.5"` : ""
              }/>`,
          )
          .join("\n");
      }
      return step.tris
        .map(
          ({ points, fill }) =>
            `  <polygon points="${points.map((p) => `${fmt(p[0] + ox)},${fmt(p[1] + oy)}`).join(" ")}" fill="${fill}"${
              options?.stroke ? ` stroke="${fill}" stroke-width="0.5"` : ""
            }/>`,
        )
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");

  if (!body) return wrap(EMPTY_SIZE, EMPTY_SIZE, "", options);

  return wrap(w, h, body, options);
}

/* ------------------------------------------------------------------ */
/* Cropped export                                                      */
/* ------------------------------------------------------------------ */

export interface CroppedSVGOptions extends SVGExportOptions {
  /** Physical width of the exported document, in inches. Emitted so Inkscape
   *  and friends open the file at true print size. Omit for unitless output. */
  widthInches?: number;
}

/**
 * Sutherland–Hodgman clip of a convex polygon against an axis-aligned rect.
 * Both inputs are convex, so the result is a single convex polygon — no
 * multi-ring bookkeeping needed. Returns [] when the polygon is fully outside.
 *
 * The clip is exact: a vertex generated on the crop boundary is computed from
 * the same edge equation for both triangles that share it, so neighbours still
 * agree to the last bit and `mergeTrianglesByColor` can weld them afterwards.
 */
export function clipPolygonToRect(
  points: [number, number][],
  rect: Rect,
): [number, number][] {
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;

  // side < 0 is outside for each of the four half-planes.
  const edges: Array<(p: [number, number]) => number> = [
    (p) => p[0] - x0,
    (p) => x1 - p[0],
    (p) => p[1] - y0,
    (p) => y1 - p[1],
  ];

  let out = points;
  for (const inside of edges) {
    if (out.length === 0) return [];
    const next: [number, number][] = [];
    for (let k = 0; k < out.length; k++) {
      const cur = out[k];
      const prev = out[(k + out.length - 1) % out.length];
      const dCur = inside(cur);
      const dPrev = inside(prev);
      if (dCur >= 0) {
        if (dPrev < 0) {
          const t = dPrev / (dPrev - dCur);
          next.push([
            prev[0] + t * (cur[0] - prev[0]),
            prev[1] + t * (cur[1] - prev[1]),
          ]);
        }
        next.push(cur);
      } else if (dPrev >= 0) {
        const t = dPrev / (dPrev - dCur);
        next.push([
          prev[0] + t * (cur[0] - prev[0]),
          prev[1] + t * (cur[1] - prev[1]),
        ]);
      }
    }
    out = next;
  }

  // A triangle corner sitting exactly on a clip edge makes the algorithm emit
  // the intersection *and* the original vertex — the same point twice.
  return dedupeRing(out, 1e-9);
}

/**
 * Drops consecutive (and wrap-around) duplicate vertices, returning [] if what
 * is left cannot be a polygon.
 *
 * A repeated vertex is a zero-length edge, which `mergeTrianglesByColor` keys as
 * a self-loop (`ka === kb`) and then follows into a dead end. Duplicates arise
 * twice over: exactly, from clipping a corner that lies on the crop boundary,
 * and again after coordinates are rounded to PRECISION for output, which can
 * collapse two genuinely distinct points onto one.
 */
function dedupeRing(
  points: [number, number][],
  tol: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) <= tol && Math.abs(last[1] - p[1]) <= tol) {
      continue;
    }
    out.push(p);
  }
  while (
    out.length > 1 &&
    Math.abs(out[0][0] - out[out.length - 1][0]) <= tol &&
    Math.abs(out[0][1] - out[out.length - 1][1]) <= tol
  ) {
    out.pop();
  }
  return out.length >= 3 ? out : [];
}

/** Drops degenerate polygons the clip can produce when a triangle only grazes
 *  the crop edge — they would otherwise emit zero-area paths. */
function polygonArea(points: [number, number][]): number {
  let a = 0;
  for (let k = 0; k < points.length; k++) {
    const [px, py] = points[k];
    const [qx, qy] = points[(k + 1) % points.length];
    a += px * qy - qx * py;
  }
  return Math.abs(a) / 2;
}

/**
 * SVG of just the crop region, with edge triangles genuinely clipped into
 * 4- and 5-gons rather than hidden behind a <clipPath>. Nothing outside the
 * crop survives into the file, so the result opens clean in Inkscape.
 */
export function generateCroppedSVG(
  layers: Layer[],
  crop: CropRect,
  gridRotation: number,
  options?: CroppedSVGOptions,
): string {
  const world = cropWorldBounds(crop);
  const display = cropDisplayBounds(crop, gridRotation);
  const w = roundNum(display.w);
  const h = roundNum(display.h);

  // Physical size so the document opens at true print scale; unitless
  // otherwise. viewBox stays in world units either way.
  const inches = options?.widthInches;
  const dims =
    inches && inches > 0
      ? ` width="${fmt(inches)}in" height="${fmt((inches * display.h) / display.w)}in"`
      : ` width="${w}" height="${h}"`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${dims}>`;

  const worldBox = {
    minX: world.x,
    minY: world.y,
    maxX: world.x + world.w,
    maxY: world.y + world.h,
  };

  const body = buildRenderPlan(layers)
    .map((step) => {
      if (step.kind === "hatch") {
        // Clipped to the crop in world space, then rotated into display space —
        // the same order the fill path uses below.
        const strokes = hatchStrokes(step.painted, worldBox).map((s) => {
          const [ax, ay] = rotatePoint(s.seg[0], s.seg[1], gridRotation);
          const [bx, by] = rotatePoint(s.seg[2], s.seg[3], gridRotation);
          return {
            ...s,
            seg: [
              roundNum(ax - display.x),
              roundNum(ay - display.y),
              roundNum(bx - display.x),
              roundNum(by - display.y),
            ] as [number, number, number, number],
          };
        });
        return hatchMarkup(strokes, 0, 0);
      }

      // A rounded step is clipped as flattened rings rather than as triangles.
      // Arcs cannot survive Sutherland–Hodgman, but chords can, so the crop
      // keeps its guarantee that nothing off-crop reaches the file — the same
      // reason this exporter clips for real instead of using a `<clipPath>`.
      const radius = stepRoundRadius(step);
      if (radius > 0) {
        const out: string[] = [];
        for (const { fill, rings } of roundedRegions(step.painted, radius)) {
          const ds: string[] = [];
          for (const ring of rings) {
            const poly = clipPolygonToRect(flattenRoundedRing(ring), world);
            if (poly.length < 3 || polygonArea(poly) < 1e-6) continue;
            const pts = dedupeRing(
              poly.map((p) => {
                const [rx, ry] = rotatePoint(p[0], p[1], gridRotation);
                return [roundNum(rx - display.x), roundNum(ry - display.y)] as [number, number];
              }),
              0,
            );
            if (pts.length < 3) continue;
            ds.push(
              `M${pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" L")} Z`,
            );
          }
          if (!ds.length) continue;
          out.push(
            `  <path d="${ds.join(" ")}" fill="${fill}"${
              options?.stroke ? ` stroke="${fill}" stroke-width="0.5"` : ""
            }/>`,
          );
        }
        return out.join("\n");
      }

      // Clip in world space (where the crop rect is axis-aligned), then rotate
      // the survivors into display space and shift the crop origin to (0,0).
      // The only rotations used are 0 and 90 degrees, so this stays exact.
      const clipped: TriangleData[] = [];
      for (const tri of generateTriangles(step.painted)) {
        const poly = clipPolygonToRect(tri.points, world);
        if (poly.length < 3 || polygonArea(poly) < 1e-6) continue;
        // Rounding can merge two distinct vertices, so dedupe again afterwards
        // — once at full precision inside the clipper is not sufficient.
        const points = dedupeRing(
          poly.map((p) => {
            const [rx, ry] = rotatePoint(p[0], p[1], gridRotation);
            return [roundNum(rx - display.x), roundNum(ry - display.y)] as [number, number];
          }),
          0,
        );
        if (points.length < 3) continue;
        clipped.push({ fill: tri.fill, points });
      }

      if (clipped.length === 0) return "";

      if (options?.merge) {
        return mergeTrianglesByColor(clipped)
          .map(
            ({ fill, d }) =>
              `  <path d="${d}" fill="${fill}"${
                options?.stroke ? ` stroke="${fill}" stroke-width="0.5"` : ""
              }/>`,
          )
          .join("\n");
      }

      return clipped
        .map(
          ({ points, fill }) =>
            `  <polygon points="${points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" ")}" fill="${fill}"${
              options?.stroke ? ` stroke="${fill}" stroke-width="0.5"` : ""
            }/>`,
        )
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");

  if (!body) return `${open}\n</svg>`;
  return `${open}\n${body}\n</svg>`;
}
