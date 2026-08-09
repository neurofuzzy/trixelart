import {
  getTriVertices,
  stringToTri,
  countComponents,
} from "@/lib/grid-math";
import { encodeColor, resolveColor } from "@/lib/constants";
import { rotatePoint } from "@/lib/crop";
import {
  ROUND_RADIUS_AT_FULL,
  boundaryVertexDegrees,
  flattenRoundedRing,
  regionRings,
  roundRing,
} from "@/lib/round-corners";
import { zipSync, strToU8 } from "fflate";
// Standalone module — mapbox's earcut, vendored by three with no imports of its
// own, so this costs nothing at runtime and drags no WebGL in behind it.
import { Earcut } from "three/src/extras/Earcut.js";

// ---------------------------------------------------------------------------
// Trixel art → shallow 3D model (one body per color) → 3MF for print services.
//
// The FDM "directional top-infill" trick makes a top surface shimmer at an
// angle set by the slicer's top-layer line direction. By emitting one body per
// color and assigning each a different grain angle (auto-cycled 0/60/120°), a
// print operator can give every color its own shimmer direction. 3MF carries
// the per-body colors (as base materials → filament slots); the grain angles
// can't be baked portably, so they travel in the generated printer notes.
// ---------------------------------------------------------------------------

export type BaseMode = "plate" | "sandwich" | "none";

export interface MeshExportOptions {
  /** Overall model width (longest painted extent maps to this), in mm. */
  widthMm: number;
  /** Height of the raised color tiles above the base, in mm. */
  topThicknessMm: number;
  /** Thickness of the solid backing plate, in mm (ignored when mode "none"). */
  baseThicknessMm: number;
  baseMode: BaseMode;
  /** Per-color grain-angle overrides, keyed by color key. Colors absent here
   *  fall back to the auto-cycled angle (0/60/120° by body order). */
  grainByColor?: Record<string, number>;
  /**
   * The artwork's corner-rounding effect, as the 0–1 slider fraction (see
   * `ROUND_RADIUS_AT_FULL`). 0 prints the raw lattice silhouette.
   *
   * Not a dialog setting: it comes from the layer stack via
   * `layersRoundFraction`, so the print matches the picture rather than
   * offering a second, contradictory radius.
   */
  roundFraction?: number;
}

export const DEFAULT_MESH_OPTIONS: MeshExportOptions = {
  widthMm: 100,
  topThicknessMm: 1.2,
  baseThicknessMm: 2,
  baseMode: "plate",
  grainByColor: {},
};

export const MESH_LIMITS = {
  widthMm: { min: 10, max: 300 },
  topThicknessMm: { min: 0.2, max: 20 },
  baseThicknessMm: { min: 0.4, max: 20 },
} as const;

export function clampMeshOption(
  field: keyof typeof MESH_LIMITS,
  value: number,
): number {
  const { min, max } = MESH_LIMITS[field];
  if (!Number.isFinite(value)) return DEFAULT_MESH_OPTIONS[field];
  return Math.min(max, Math.max(min, value));
}

/** Grain angles cycled across color bodies, in degrees. */
export const GRAIN_ANGLES = [0, 60, 120];

/** Selectable grain angles offered for per-color overrides, in degrees. */
export const GRAIN_ANGLE_CHOICES = [0, 30, 45, 60, 90, 120, 135, 150];

export interface ExportBody {
  name: string;
  /** Encoded palette key this body was built from ("paletteIdx,colorIdx"). */
  colorKey: string;
  colorHex: string; // "#rrggbb"
  grainAngle: number | null; // null for the base plate
  /** Optional emissive tint ("#rrggbb") — used to make a body glow (e.g. a
   *  loose island in the cut-stack preview). Undefined = no emissive. */
  emissiveHex?: string;
  /** Flat vertex coordinates: x0,y0,z0, x1,y1,z1, … */
  positions: number[];
  /** Flat triangle vertex indices into `positions`. */
  indices: number[];
}

export interface TrixelModel {
  bodies: ExportBody[];
  widthMm: number;
  heightMm: number;
  depthMm: number;
  triangleCount: number;
  /** Edge-connected components of the painted design (>1 ⇒ detached pieces). */
  componentCount: number;
  options: MeshExportOptions;
}

export type Pt = { x: number; y: number };

/** World→model mapping shared by every builder: centers the design at the
 *  origin and scales its longest extent to `widthMm`, Y flipped to Y-up. */
export interface ModelTransform {
  scale: number;
  widthMm: number;
  heightMm: number;
  /** Maps a world-space triangle vertex into centered, Y-up model space. */
  toModel: (v: Pt) => Pt;
}

/**
 * Computes the shared model transform from a painted grid. Null if empty.
 *
 * `gridRotation` is the lattice's quarter turn. It is applied here, at the one
 * world → model seam every fabrication path goes through, rather than at each
 * of them: the tri-axial lattice has no 90° symmetry, so a pointy-top grid
 * cannot be expressed by rotating `painted` — only the geometry it produces can
 * turn. Measuring the bounds *after* the turn is what also makes `widthMm` mean
 * the width of the piece the user sees, not of its flat-top twin.
 */
export function computeModelTransform(
  painted: Record<string, string>,
  widthMm: number,
  gridRotation = 0,
): ModelTransform | null {
  const keys = Object.keys(painted);
  if (keys.length === 0) return null;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const key of keys) {
    const t = stringToTri(key);
    for (const raw of getTriVertices(t.q, t.r, t.type)) {
      const [x, y] = rotatePoint(raw.x, raw.y, gridRotation);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const worldW = maxX - minX || 1;
  const scale = widthMm / worldW;
  const w = worldW * scale;
  const h = (maxY - minY) * scale;
  return {
    scale,
    widthMm: w,
    heightMm: h,
    toModel: (v) => {
      const [x, y] = rotatePoint(v.x, v.y, gridRotation);
      return {
        x: (x - minX) * scale - w / 2,
        y: (maxY - y) * scale - h / 2,
      };
    },
  };
}

// Relative luminance (sRGB) for picking the darkest color as the base.
function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Collects geometry for one body as a set of independent, internally-welded
 *  prisms — vertices are shared within a prism (each is a clean closed manifold:
 *  6 verts, 8 tris, χ=2) but never across prisms. This stays watertight even
 *  when same-color tiles only touch at a corner (a cross-tile weld would be
 *  non-manifold there). Slicers union the overlapping closed solids into one
 *  printed piece. */
export class MeshBuilder {
  positions: number[] = [];
  indices: number[] = [];

  /** Extrude one CCW polygon into a closed prism between zLow and zHigh. */
  prism(poly: Pt[], zLow: number, zHigh: number): void {
    const base = this.positions.length / 3;
    for (const p of poly) this.positions.push(p.x, p.y, zHigh); // top: base+0..2
    for (const p of poly) this.positions.push(p.x, p.y, zLow); // bottom: base+3..5
    const top = [base, base + 1, base + 2];
    const bot = [base + 3, base + 4, base + 5];
    // Top face (normal +Z) and bottom face (reversed → normal −Z).
    this.indices.push(top[0], top[1], top[2]);
    this.indices.push(bot[0], bot[2], bot[1]);
    // Three side walls. Edge a→b is CCW around the top face, so these wind with
    // the normal facing outward.
    for (let i = 0; i < 3; i++) {
      const a = i;
      const b = (i + 1) % 3;
      this.indices.push(bot[a], bot[b], top[b]);
      this.indices.push(bot[a], top[b], top[a]);
    }
  }
}

/** Extrudes each CCW polygon into a closed triangular prism. */
export function addSlab(
  mesh: MeshBuilder,
  polys: Pt[][],
  zLow: number,
  zHigh: number,
): void {
  for (const poly of polys) mesh.prism(poly, zLow, zHigh);
}

export function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return a / 2;
}

/** Even-odd ray cast. Used only to decide which outer loop a hole belongs to. */
function pointInLoop(p: Pt, loop: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Where two segments properly cross, with the parameter along each. Touching
 *  endpoints do not count: a ring is full of those and none of them is a fold. */
function properCross(
  a: Pt,
  b: Pt,
  c: Pt,
  d: Pt,
): { p: Pt; t1: number; t2: number } | null {
  const rx = b.x - a.x,
    ry = b.y - a.y,
    sx = d.x - c.x,
    sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { p: { x: a.x + t * rx, y: a.y + t * ry }, t1: t, t2: u };
}

/**
 * A self-overlapping loop → the simple loops that make up the region it winds
 * around, folded-back lobes dropped.
 *
 * The loop is cut at every proper self-crossing and walked with a stack: each
 * time the walk revisits a vertex it has on the stack, everything since that
 * visit is a closed sub-loop and comes off. The sub-loops that wind *against*
 * the parent are exactly the folds — the material the boundary crossed back
 * over — so keeping only the ones with the parent's orientation leaves the
 * nonzero-filled region, which is what canvas and SVG already show.
 *
 * Quadratic in the loop's length, and deliberately only reached for a loop that
 * has been *shown* to need it.
 */
function splitSimpleLoops(loop: Pt[]): Pt[][] {
  const n = loop.length;
  const cuts: { t: number; p: Pt }[][] = Array.from({ length: n }, () => []);
  const at = (i: number) => loop[i % n];
  let found = false;

  for (let i = 0; i < n; i++) {
    const a = at(i),
      b = at(i + 1);
    const loX = Math.min(a.x, b.x),
      hiX = Math.max(a.x, b.x);
    const loY = Math.min(a.y, b.y),
      hiY = Math.max(a.y, b.y);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // shares the closing vertex
      const c = at(j),
        d = at(j + 1);
      if (Math.min(c.x, d.x) > hiX || Math.max(c.x, d.x) < loX) continue;
      if (Math.min(c.y, d.y) > hiY || Math.max(c.y, d.y) < loY) continue;
      const hit = properCross(a, b, c, d);
      if (!hit) continue;
      cuts[i].push({ t: hit.t1, p: hit.p });
      cuts[j].push({ t: hit.t2, p: hit.p });
      found = true;
    }
  }
  if (!found) return [loop];

  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    pts.push(loop[i]);
    cuts[i].sort((p, q) => p.t - q.t);
    for (const cut of cuts[i]) pts.push(cut.p);
  }

  const key = (p: Pt) => `${Math.round(p.x * 1e3)},${Math.round(p.y * 1e3)}`;
  const stack: Pt[] = [];
  const seen = new Map<string, number>();
  const parts: Pt[][] = [];
  for (const p of pts) {
    const k = key(p);
    const start = seen.get(k);
    if (start !== undefined) {
      const sub = stack.splice(start + 1);
      for (const s of sub) seen.delete(key(s));
      if (sub.length >= 2) parts.push([stack[start], ...sub]);
    } else {
      seen.set(k, stack.length);
      stack.push(p);
    }
  }
  if (stack.length >= 3) parts.push(stack);

  const want = Math.sign(signedArea(loop));
  const kept = parts.filter(
    (part) => part.length >= 3 && Math.sign(signedArea(part)) === want,
  );
  return kept.length ? kept : [loop];
}

/** Below this a triangle is degenerate. World units, where `SIDE` is 50. */
const DEGENERATE_AREA = 1e-9;

/**
 * Chord tolerance for flattening a rounded corner, in **millimetres of the
 * finished part** — not world units.
 *
 * Every fabrication backend turns arcs into polylines, and the only tolerance
 * that means anything is the one measured on the object that comes out of the
 * machine. Expressed in world units it would be a different physical error at
 * every export width; divided by the model transform's `scale` it is the same
 * 20 µm whether the piece is printed at 20 mm or 300 mm, and the vertex count
 * follows the size of the part instead of the size of the drawing.
 *
 * 20 µm is an order of magnitude under both a 0.4 mm nozzle and a cutting
 * blade's kerf — the same margin `PLOT_SAGITTA` keeps against a plotter nib.
 */
export const FAB_CHORD_MM = 0.02;

/**
 * Closed loops → a flat list of triangles covering the region they bound.
 *
 * The extrusion primitives here take triangles, so anything that is *not* a
 * lattice cell — a rounded silhouette, a welded cut sheet — has to be
 * triangulated before it can become a solid. Loops arrive as plain polylines,
 * arcs already flattened, and holes come out as negative space for free.
 *
 * **Outer loops wind positive under `signedArea`, holes negative.** Both
 * producers guarantee that by construction rather than by a containment test:
 * `regionRings` walks a region's boundary with the region on one consistent
 * side, and `traceUnionLoops` forces every source triangle positive before it
 * chains the boundary. A hole is then assigned to the *smallest* outer loop
 * containing it, which is what puts an island sitting inside a hole in its own
 * group instead of the enclosing one.
 *
 * The result is a set of independent triangles, in the loops' own coordinate
 * space and with no promise about winding — callers map them into model space
 * (which flips Y, and with it the winding) and fix that afterwards, exactly as
 * they already do for lattice cells.
 */
export function triangulateLoops(loops: Pt[][]): Pt[][] {
  const tris = earcutLoops(loops);
  // Earcut fills whatever the loops enclose, with no notion of winding, so a
  // boundary that doubles back over itself — which corner rounding does at the
  // top of its range, where an arc can overrun the shape it belongs to — comes
  // back with the folded-back lobe filled in. On screen that lobe is invisible:
  // canvas and SVG both resolve it away (winding number 0 under nonzero, parity
  // 0 under even-odd), and a fabrication path that kept it would print or cut
  // solid material outside the silhouette the user drew.
  //
  // The triangulated area agreeing with the loops' *signed* area is exactly the
  // statement that no such fold exists, so the repair costs one comparison in
  // the overwhelmingly common case and only runs the quadratic split for the
  // rare loop that has been shown to need it.
  const net = loops.reduce((s, loop) => s + signedArea(loop), 0);
  const covered = tris.reduce((s, tri) => s + Math.abs(signedArea(tri)), 0);
  if (Math.abs(covered - net) <= 1e-6 * Math.abs(net)) return tris;
  return earcutLoops(loops.flatMap(splitSimpleLoops));
}

/** `triangulateLoops` without the fold repair: classify, then ear-clip. */
function earcutLoops(loops: Pt[][]): Pt[][] {
  const outers: Pt[][] = [];
  const holes: Pt[][] = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    (signedArea(loop) >= 0 ? outers : holes).push(loop);
  }
  if (outers.length === 0) return [];

  const outerArea = outers.map((o) => Math.abs(signedArea(o)));
  const holesOf: Pt[][][] = outers.map(() => []);
  for (const hole of holes) {
    let best = -1;
    for (let i = 0; i < outers.length; i++) {
      if (best >= 0 && outerArea[i] >= outerArea[best]) continue;
      if (pointInLoop(hole[0], outers[i])) best = i;
    }
    if (best >= 0) holesOf[best].push(hole);
  }

  const out: Pt[][] = [];
  outers.forEach((outer, i) => {
    const verts: Pt[] = [...outer];
    const data: number[] = [];
    for (const p of outer) data.push(p.x, p.y);
    const holeIndices: number[] = [];
    for (const hole of holesOf[i]) {
      holeIndices.push(data.length / 2);
      for (const p of hole) {
        data.push(p.x, p.y);
        verts.push(p);
      }
    }
    const idx = Earcut.triangulate(data, holeIndices, 2);
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const tri = [verts[idx[k]], verts[idx[k + 1]], verts[idx[k + 2]]];
      // A sliver from the flattened arcs would extrude into a zero-volume prism
      // — harmless on screen, but a degenerate face in the exported mesh.
      if (Math.abs(signedArea(tri)) < DEGENERATE_AREA) continue;
      out.push(tri);
    }
  });
  return out;
}

/**
 * Each colour's footprint as CCW model-space polygons, keyed by encoded colour.
 *
 * Without rounding this is one polygon per painted cell, which is what keeps a
 * plain export byte-identical to what it always was. With rounding it is the
 * *region* boundary instead — the same `regionRings` + `roundRing` the canvas
 * and both SVG exporters walk, so the printed silhouette is the one on screen —
 * triangulated back into polygons the extruder can take.
 *
 * **Rounding uses the shared boundary-degree rule, and that is what keeps the
 * colours airtight.** Each region rounds its own rings in ignorance of its
 * neighbours; because the radius at a vertex is derived from the boundary both
 * sides agree on, the convex corner one body loses is exactly the concave bulge
 * the next one gains. Two abutting filament bodies therefore still meet with no
 * gap and no overlap — see the note at the top of `round-corners.ts`.
 *
 * Regions group by *resolved* hex where cells group by encoded colour, so two
 * palettes resolving to one hex become one body rather than two. That is the
 * right answer for a print (they would be the same filament) and it is only
 * reachable with rounding on, where the boundary between them is not a boundary
 * at all.
 */
function colorPolys(
  painted: Record<string, string>,
  roundFraction: number,
  transform: ModelTransform,
): Map<string, Pt[][]> {
  const toModel = transform.toModel;
  const byColor = new Map<string, Pt[][]>();
  const push = (colorKey: string, poly: Pt[]) => {
    if (signedArea(poly) < 0) poly.reverse();
    const list = byColor.get(colorKey);
    if (list) list.push(poly);
    else byColor.set(colorKey, [poly]);
  };

  if (roundFraction <= 0) {
    for (const [key, colorKey] of Object.entries(painted)) {
      const t = stringToTri(key);
      push(colorKey, getTriVertices(t.q, t.r, t.type).map(toModel));
    }
    return byColor;
  }

  const degrees = boundaryVertexDegrees(painted);
  const radius = roundFraction * ROUND_RADIUS_AT_FULL;
  const sagitta = FAB_CHORD_MM / transform.scale;
  for (const region of regionRings(painted)) {
    const loops = region.rings.map((ring) =>
      flattenRoundedRing(roundRing(ring, degrees, radius), sagitta).map(
        ([x, y]) => ({ x, y }),
      ),
    );
    const colorKey = encodeColor(region.paletteIdx, region.colorIdx);
    for (const tri of triangulateLoops(loops)) push(colorKey, tri.map(toModel));
  }
  return byColor;
}

/** Build a 3D model from the painted grid. Returns null if nothing is painted. */
export function buildTrixelModel(
  painted: Record<string, string>,
  options: MeshExportOptions,
  gridRotation = 0,
): TrixelModel | null {
  const entries = Object.entries(painted);
  if (entries.length === 0) return null;

  // Shared world → centered, Y-up model transform (matches on-screen orientation).
  const transform = computeModelTransform(painted, options.widthMm, gridRotation);
  if (!transform) return null;
  const { widthMm, heightMm } = transform;

  // Group tiles by color; store each as a CCW model-space polygon.
  const byColor = colorPolys(painted, options.roundFraction ?? 0, transform);
  const allPolys: Pt[][] = [];
  for (const polys of byColor.values()) allPolys.push(...polys);

  // Z layout per base mode.
  const T = options.topThicknessMm;
  const B = options.baseThicknessMm;
  const mode = options.baseMode;
  let topLow: number, topHigh: number;
  let baseLow = 0,
    baseHigh = 0;
  let botLow = 0,
    botHigh = 0;
  let depthMm: number;
  if (mode === "sandwich") {
    baseLow = -B / 2;
    baseHigh = B / 2;
    topLow = B / 2;
    topHigh = B / 2 + T;
    botLow = -(B / 2 + T);
    botHigh = -B / 2;
    depthMm = B + 2 * T;
  } else if (mode === "plate") {
    baseLow = 0;
    baseHigh = B;
    topLow = B;
    topHigh = B + T;
    depthMm = B + T;
  } else {
    topLow = 0;
    topHigh = T;
    depthMm = T;
  }

  // One body per color, deterministically ordered → grain angle cycling.
  const colorKeys = [...byColor.keys()].sort();
  const bodies: ExportBody[] = [];
  colorKeys.forEach((colorKey, i) => {
    const polys = byColor.get(colorKey) as Pt[][];
    const mesh = new MeshBuilder();
    addSlab(mesh, polys, topLow, topHigh);
    if (mode === "sandwich") addSlab(mesh, polys, botLow, botHigh);
    const override = options.grainByColor?.[colorKey];
    const grainAngle =
      typeof override === "number"
        ? override
        : GRAIN_ANGLES[i % GRAIN_ANGLES.length];
    bodies.push({
      name: `Color ${i + 1}`,
      colorKey,
      colorHex: resolveColor(colorKey),
      grainAngle,
      positions: mesh.positions,
      indices: mesh.indices,
    });
  });

  // Base plate: footprint union of every tile, in the darkest used color.
  if (mode !== "none") {
    const darkest = colorKeys.reduce((best, k) =>
      hexLuminance(resolveColor(k)) < hexLuminance(resolveColor(best))
        ? k
        : best,
    );
    const baseMesh = new MeshBuilder();
    addSlab(baseMesh, allPolys, baseLow, baseHigh);
    bodies.unshift({
      name: "Base",
      colorKey: darkest,
      colorHex: resolveColor(darkest),
      grainAngle: null,
      positions: baseMesh.positions,
      indices: baseMesh.indices,
    });
  }

  const triangleCount = bodies.reduce((s, b) => s + b.indices.length / 3, 0);
  const componentCount = countComponents(entries.map(([k]) => k));

  return {
    bodies,
    widthMm,
    heightMm,
    depthMm,
    triangleCount,
    componentCount,
    options,
  };
}

// ---------------------------------------------------------------------------
// 3MF serialization
// ---------------------------------------------------------------------------

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexToDisplayColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return `#${(m ? m[1] : "808080").toUpperCase()}FF`;
}

function buildModelXml(model: TrixelModel): string {
  const materials = model.bodies
    .map(
      (b) =>
        `      <base name="${xmlEscape(b.name)}" displaycolor="${hexToDisplayColor(
          b.colorHex,
        )}" />`,
    )
    .join("\n");

  let nextId = 2; // 1 = basematerials
  const objects: string[] = [];
  const items: string[] = [];
  model.bodies.forEach((b, matIndex) => {
    const id = nextId++;
    const verts: string[] = [];
    for (let i = 0; i < b.positions.length; i += 3) {
      verts.push(
        `        <vertex x="${round(b.positions[i])}" y="${round(
          b.positions[i + 1],
        )}" z="${round(b.positions[i + 2])}" />`,
      );
    }
    const tris: string[] = [];
    for (let i = 0; i < b.indices.length; i += 3) {
      tris.push(
        `        <triangle v1="${b.indices[i]}" v2="${b.indices[i + 1]}" v3="${b.indices[i + 2]}" />`,
      );
    }
    objects.push(
      `    <object id="${id}" type="model" pid="1" pindex="${matIndex}">\n` +
        `      <mesh>\n` +
        `        <vertices>\n${verts.join("\n")}\n        </vertices>\n` +
        `        <triangles>\n${tris.join("\n")}\n        </triangles>\n` +
        `      </mesh>\n` +
        `    </object>`,
    );
    items.push(`    <item objectid="${id}" />`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US"\n` +
    `  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02/3dmodel"\n` +
    `  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n` +
    `  <resources>\n` +
    `    <basematerials id="1">\n${materials}\n    </basematerials>\n` +
    `${objects.join("\n")}\n` +
    `  </resources>\n` +
    `  <build>\n${items.join("\n")}\n  </build>\n` +
    `</model>\n`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
  `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />\n` +
  `  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />\n` +
  `</Types>\n`;

const RELS =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
  `  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />\n` +
  `</Relationships>\n`;

/** Serialize a model to 3MF bytes (a zipped OPC package). */
export function to3MF(model: TrixelModel): Uint8Array {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(RELS),
      "3D/3dmodel.model": strToU8(buildModelXml(model)),
    },
    { level: 6 },
  );
}

/** Copy-paste order notes for the print service / slicer operator. */
export function buildPrinterNotes(
  model: TrixelModel,
  projectName: string,
): string {
  const lines: string[] = [];
  lines.push(`Trixel print — "${projectName}"`);
  lines.push(
    `Model: ${model.widthMm.toFixed(1)} × ${model.heightMm.toFixed(
      1,
    )} × ${model.depthMm.toFixed(1)} mm, ${model.bodies.length} bodies.`,
  );
  lines.push("");
  lines.push(
    "This model relies on DIRECTIONAL TOP INFILL for a shimmer effect. Please",
  );
  lines.push(
    "assign each body its own Top Surface line angle, and print in FDM with a",
  );
  lines.push("silk/satin filament (e.g. Silk PLA) at a fine layer height:");
  lines.push("");
  for (const b of model.bodies) {
    if (b.grainAngle === null) {
      lines.push(`  • ${b.name} (${b.colorHex}) — backing plate, any angle`);
    } else {
      lines.push(
        `  • ${b.name} (${b.colorHex}) — Top Surface line angle = ${b.grainAngle}°`,
      );
    }
  }
  lines.push("");
  lines.push(
    "Tech: FDM (not resin/SLS). Nozzle 0.4mm, layer height 0.12–0.16mm.",
  );
  if (model.componentCount > 1) {
    lines.push("");
    lines.push(
      `NOTE: the design has ${model.componentCount} separate pieces that only touch`,
    );
    lines.push(
      "at corners — they may print as detached parts. Add a base plate or",
    );
    lines.push("connect them with shared edges if a single piece is required.");
  }
  return lines.join("\n");
}
