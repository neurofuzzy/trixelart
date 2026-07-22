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
  MeshBuilder,
  addSlab,
  signedArea,
  computeModelTransform,
  type Pt,
  type ExportBody,
  type TrixelModel,
} from "@/lib/mesh-export";
import type { CutPlan } from "@/lib/cut-export";

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

/** Builds one slab body from a set of triangle keys at [zLow, zHigh]. */
function sheetBody(
  keys: string[],
  toModel: (v: Pt) => Pt,
  zLow: number,
  zHigh: number,
  name: string,
  colorKey: string,
  colorHex: string,
): ExportBody {
  const mesh = new MeshBuilder();
  const polys: Pt[][] = [];
  for (const key of keys) {
    const t = stringToTri(key);
    const poly = getTriVertices(t.q, t.r, t.type).map(toModel);
    if (signedArea(poly) < 0) poly.reverse();
    polys.push(poly);
  }
  addSlab(mesh, polys, zLow, zHigh);
  return {
    name,
    colorKey,
    colorHex,
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
): CutStackModel | null {
  const transform = computeModelTransform(painted, options.widthMm);
  if (!transform || plan.sheets.length === 0) return null;
  const { widthMm, heightMm, toModel } = transform;

  const T = options.sheetThicknessMm;
  const gap = options.explode * MAX_EXPLODE_GAP_MM;
  const step = T + gap;
  const K = plan.sheets.length;

  // The frame region (exterior outline silhouette) — carried by EVERY layer.
  const frame = options.frame === "mat" ? matTriangles(painted) : [];
  const hasFrame = frame.length > 0;

  const bodies: ExportBody[] = [];
  const sheets: CutSheetGeometry[] = [];

  // Color sheets: each is its positive region Sᵢ PLUS the frame, so every sheet
  // has solid paper all the way around. Interior unpainted areas stay holes.
  for (const sheet of plan.sheets) {
    const zLow = (sheet.level - 1) * step;
    const keys = hasFrame ? sheet.triangles.concat(frame) : sheet.triangles;
    bodies.push(
      sheetBody(
        keys,
        toModel,
        zLow,
        zLow + T,
        `Sheet ${sheet.level}`,
        sheet.colorKey,
        sheet.colorHex,
      ),
    );
    sheets.push({
      level: sheet.level,
      colorHex: sheet.colorHex,
      triCount: keys.length,
      isFrame: false,
    });
  }

  // Mat on top: the frame region alone, in black, above the top color layer.
  if (hasFrame) {
    const frameHex = plan.sheets.reduce((best, s) =>
      hexLuminance(s.colorHex) < hexLuminance(best.colorHex) ? s : best,
    ).colorHex;
    const zLow = K * step;
    bodies.push(
      sheetBody(frame, toModel, zLow, zLow + T, "Mat", "mat", frameHex),
    );
    sheets.push({
      level: K + 1,
      colorHex: frameHex,
      triCount: frame.length,
      isFrame: true,
    });
  }

  const triangleCount = bodies.reduce((s, b) => s + b.indices.length / 3, 0);
  const topLevel = options.frame === "mat" ? K + 1 : K;
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
