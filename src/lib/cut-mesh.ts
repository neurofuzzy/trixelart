import {
  SIDE,
  H,
  getTriVertices,
  triCenter,
  stringToTri,
  triToString,
  triEdgeNeighbors,
} from "@/lib/grid-math";
import {
  FAB_CHORD_MM,
  MeshBuilder,
  addSlab,
  signedArea,
  triangulateLoops,
  computeModelTransform,
  type Pt,
  type ExportBody,
  type TrixelModel,
} from "@/lib/mesh-export";
import type { CutPlan } from "@/lib/cut-export";
import { neckFillTriangles, traceUnionLoops } from "@/lib/cut-svg";

// ---------------------------------------------------------------------------
// Cut plan → exploded 3D stack of cardstock sheets (see docs/fabrication-export
// .md §4). Top → bottom:
//
//   1. Mat (top, black paper): the frame region alone — a rectangle with the
//      design's outline cut out as a window. A photo mat you look through.
//   2. Color sheets (middle & bottom): each is its positive region Sᵢ PLUS the
//      frame region. EVERY layer carries the frame, so every sheet has solid
//      paper all the way around (one connected, registered piece).
//
// Rule: unpainted *interior* areas are holes cut through the entire stack
// (see-through negative space). The exception is the outline silhouette — the
// exterior *frame* region, which is solid paper on EVERY layer. So:
//   color sheet i = Sᵢ ∪ frame ;   mat = frame (black).
// ---------------------------------------------------------------------------

export type CutFrame = "mat" | "none";

/** Mat border width around the design, in triangle side lengths. */
const FRAME_MARGIN_SIDES = 1.6;
/** Gap between adjacent sheets at explode = 1, in model mm. */
const MAX_EXPLODE_GAP_MM = 16;

export interface CutStackOptions {
  /** Overall model width (longest painted extent maps to this), in mm. */
  widthMm: number;
  /** Thickness of each cardstock slab, in mm. */
  sheetThicknessMm: number;
  /** 0 = assembled (sheets touch, top reproduces the design) … 1 = fully fanned. */
  explode: number;
  /** Top outline-silhouette mat: "mat" = on, "none" = off. */
  frame: CutFrame;
  /** Weld corner-touching pieces with tiny-hexagon necks (matches SVG export). */
  mergeIslands?: boolean;
  /** Hexagon-neck radius for merges, in world units (0 = sharp weld). */
  neck?: number;
  /** Corner-rounding radius in world units (0 = sharp), from the layer effect.
   *  The same value `CutSVGOptions.round` takes, so the previewed sheet and the
   *  cut sheet are the same outline. */
  round?: number;
}

export const DEFAULT_CUT_STACK_OPTIONS: CutStackOptions = {
  widthMm: 100,
  sheetThicknessMm: 2,
  explode: 0.4,
  frame: "mat",
};

export const CUT_STACK_LIMITS = {
  widthMm: { min: 10, max: 300 },
} as const;

/** Relative luminance (sRGB) of a "#rrggbb" hex. */
function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * The mat: triangles in the design's screen-space bounding rectangle (+margin)
 * that lie *outside* the painted silhouette. Flood-filled inward from the
 * rectangle border over unpainted triangles, so enclosed interior negative
 * space stays a window (see-through), not filled. One connected frame.
 */
function matTriangles(painted: Record<string, string>): string[] {
  const paintedSet = new Set(Object.keys(painted));
  if (paintedSet.size === 0) return [];

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  let minQ = Infinity,
    maxQ = -Infinity,
    minR = Infinity,
    maxR = -Infinity;
  for (const key of paintedSet) {
    const t = stringToTri(key);
    if (t.q < minQ) minQ = t.q;
    if (t.q > maxQ) maxQ = t.q;
    if (t.r < minR) minR = t.r;
    if (t.r > maxR) maxR = t.r;
    for (const v of getTriVertices(t.q, t.r, t.type)) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }

  const margin = SIDE * FRAME_MARGIN_SIDES;
  const rx0 = minX - margin,
    rx1 = maxX + margin,
    ry0 = minY - margin,
    ry1 = maxY + margin;

  const padR = Math.ceil(margin / H) + 2;
  const padQ =
    Math.ceil(margin / SIDE) + Math.ceil((maxR - minR + 2 * padR) / 2) + 2;

  const inRect = (c: Pt) =>
    c.x >= rx0 && c.x <= rx1 && c.y >= ry0 && c.y <= ry1;

  const candidates = new Set<string>();
  for (let r = minR - padR; r <= maxR + padR; r++) {
    for (let q = minQ - padQ; q <= maxQ + padQ; q++) {
      for (const type of ["up", "down"] as const) {
        if (inRect(triCenter(q, r, type)))
          candidates.add(triToString({ q, r, type }));
      }
    }
  }

  const nearBorder = (key: string) => {
    const t = stringToTri(key);
    const c = triCenter(t.q, t.r, t.type);
    return (
      c.x <= rx0 + SIDE ||
      c.x >= rx1 - SIDE ||
      c.y <= ry0 + SIDE ||
      c.y >= ry1 - SIDE
    );
  };
  const mat = new Set<string>();
  const stack: string[] = [];
  for (const key of candidates) {
    if (!paintedSet.has(key) && nearBorder(key)) {
      mat.add(key);
      stack.push(key);
    }
  }
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const n of triEdgeNeighbors(stringToTri(cur))) {
      const nk = triToString(n);
      if (candidates.has(nk) && !paintedSet.has(nk) && !mat.has(nk)) {
        mat.add(nk);
        stack.push(nk);
      }
    }
  }
  return [...mat];
}

/** How a sheet's paper is shaped, before it is given a thickness. Exactly the
 *  three knobs `buildCutSVG` cuts by, so the preview and the file agree. */
interface SheetShape {
  merge: boolean;
  /** Hexagon-neck radius for merges, in world units (0 = sharp weld). */
  neck: number;
  /** Corner-rounding radius in world units (0 = sharp). */
  round: number;
  /** Chord tolerance for flattening those corners, world units. */
  sagitta: number;
}

/**
 * Builds one slab body from a set of triangle keys at [zLow, zHigh].
 *
 * Two ways to the same solid, and which one runs is decided by rounding:
 *
 * - **Sharp** — extrude the lattice cells themselves, plus (when `neck > 0`) the
 *   tiny-hexagon neck fills that weld corner-touching pieces. The prisms
 *   overlap and the slicer/viewer unions them, so no boundary tracing is needed.
 * - **Rounded** — the cell edges are no longer the sheet's edges, so extrude the
 *   *union boundary* instead: `traceUnionLoops` (the very loops the SVG export
 *   cuts, necks and all) triangulated back into polygons. Holes come out as
 *   negative space for free, which is the whole point of a cut sheet.
 *
 * The rounded path deliberately does **not** also add `neckFillTriangles` — the
 * traced loops already run through each neck, and extruding the fans on top
 * would put solid paper across the notch the necks are there to leave open.
 */
function sheetBody(
  layer: CutLayer,
  toModel: (v: Pt) => Pt,
  zLow: number,
  zHigh: number,
  shape: SheetShape,
): ExportBody {
  const mesh = new MeshBuilder();
  const polys: Pt[][] = [];
  const push = (poly: Pt[]) => {
    if (signedArea(poly) < 0) poly.reverse();
    polys.push(poly);
  };

  if (shape.round > 0) {
    const loops = traceUnionLoops(
      layer.keys,
      shape.merge,
      shape.neck,
      shape.round,
      shape.sagitta,
    );
    for (const tri of triangulateLoops(loops)) push(tri.map(toModel));
  } else {
    for (const key of layer.keys) {
      const t = stringToTri(key);
      push(getTriVertices(t.q, t.r, t.type).map(toModel));
    }
    for (const tri of neckFillTriangles(layer.keys, shape.neck)) {
      push(tri.map(toModel));
    }
  }

  addSlab(mesh, polys, zLow, zHigh);
  return {
    name: layer.label,
    colorKey: layer.colorKey,
    colorHex: layer.colorHex,
    grainAngle: null, // cardstock has no grain (MVP)
    positions: mesh.positions,
    indices: mesh.indices,
  };
}

export interface CutSheetGeometry {
  level: number;
  colorHex: string;
  /** Triangle count of this sheet's paper. */
  triCount: number;
  /** True for the top outline-silhouette mat. */
  isFrame: boolean;
}

/** One physical cut sheet: the exact triangle set to cut, plus its identity. */
export interface CutLayer {
  level: number;
  label: string;
  colorKey: string;
  colorHex: string;
  /** Triangle keys forming this sheet's paper (Sᵢ ∪ frame, or the frame alone). */
  keys: string[];
  isFrame: boolean;
}

/**
 * The per-layer cut geometry, bottom → top: each color sheet is its positive
 * region Sᵢ plus the shared frame (every layer is framed), then the black
 * outline mat (frame alone) on top. Shared by the 3D preview and the SVG export
 * so both cut identical shapes.
 */
export function cutLayers(
  plan: CutPlan,
  painted: Record<string, string>,
  frame: CutFrame,
): CutLayer[] {
  const frameKeys = frame === "mat" ? matTriangles(painted) : [];
  const hasFrame = frameKeys.length > 0;
  const layers: CutLayer[] = [];

  for (const sheet of plan.sheets) {
    layers.push({
      level: sheet.level,
      label: `Level ${sheet.level}`,
      colorKey: sheet.colorKey,
      colorHex: sheet.colorHex,
      keys: hasFrame ? sheet.triangles.concat(frameKeys) : sheet.triangles,
      isFrame: false,
    });
  }

  if (hasFrame) {
    const frameHex = plan.sheets.reduce((best, s) =>
      hexLuminance(s.colorHex) < hexLuminance(best.colorHex) ? s : best,
    ).colorHex;
    layers.push({
      level: plan.sheets.length + 1,
      label: "Mat",
      colorKey: "mat",
      colorHex: frameHex,
      keys: frameKeys,
      isFrame: true,
    });
  }
  return layers;
}

export interface CutStackModel {
  model: TrixelModel;
  /** Per-sheet stats, bottom (level 1) → top (mat last, if present). */
  sheets: CutSheetGeometry[];
}

/**
 * Builds the cut stack from a plan: nested color sheets Sᵢ, plus a black
 * outline-silhouette mat on top. Returns null if empty.
 */
export function buildCutStackModel(
  plan: CutPlan,
  painted: Record<string, string>,
  options: CutStackOptions,
  gridRotation = 0,
): CutStackModel | null {
  const transform = computeModelTransform(painted, options.widthMm, gridRotation);
  if (!transform || plan.sheets.length === 0) return null;
  const { widthMm, heightMm, toModel } = transform;

  const T = options.sheetThicknessMm;
  const gap = options.explode * MAX_EXPLODE_GAP_MM;
  const step = T + gap;

  const merge = options.mergeIslands ?? false;
  const shape: SheetShape = {
    merge,
    neck: merge ? (options.neck ?? 0) : 0,
    round: options.round ?? 0,
    sagitta: FAB_CHORD_MM / transform.scale,
  };
  const layers = cutLayers(plan, painted, options.frame);
  const bodies: ExportBody[] = [];
  const sheets: CutSheetGeometry[] = [];

  for (const layer of layers) {
    const zLow = (layer.level - 1) * step;
    bodies.push(sheetBody(layer, toModel, zLow, zLow + T, shape));
    sheets.push({
      level: layer.level,
      colorHex: layer.colorHex,
      triCount: layer.keys.length,
      isFrame: layer.isFrame,
    });
  }

  const triangleCount = bodies.reduce((s, b) => s + b.indices.length / 3, 0);
  const topLevel = layers.length ? layers[layers.length - 1].level : 1;
  const depthMm = (topLevel - 1) * step + T;

  return {
    model: {
      bodies,
      widthMm,
      heightMm,
      depthMm,
      triangleCount,
      componentCount: 1,
      options: {
        widthMm,
        topThicknessMm: T,
        baseThicknessMm: 0,
        baseMode: "none",
      },
    },
    sheets,
  };
}
