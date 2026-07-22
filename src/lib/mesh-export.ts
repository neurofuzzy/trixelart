import {
  getTriVertices,
  stringToTri,
  triToString,
  triEdgeNeighbors,
} from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import { zipSync, strToU8 } from "fflate";

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

type Pt = { x: number; y: number };

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
class MeshBuilder {
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
function addSlab(
  mesh: MeshBuilder,
  polys: Pt[][],
  zLow: number,
  zHigh: number,
): void {
  for (const poly of polys) mesh.prism(poly, zLow, zHigh);
}

function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return a / 2;
}

function countComponents(keys: string[]): number {
  const set = new Set(keys);
  const seen = new Set<string>();
  let components = 0;
  for (const start of keys) {
    if (seen.has(start)) continue;
    components++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const n of triEdgeNeighbors(stringToTri(cur))) {
        const nk = triToString(n);
        if (set.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
  }
  return components;
}

/** Build a 3D model from the painted grid. Returns null if nothing is painted. */
export function buildTrixelModel(
  painted: Record<string, string>,
  options: MeshExportOptions,
): TrixelModel | null {
  const entries = Object.entries(painted);
  if (entries.length === 0) return null;

  // World-space bounds across every painted triangle vertex.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [key] of entries) {
    const t = stringToTri(key);
    for (const v of getTriVertices(t.q, t.r, t.type)) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  const worldW = maxX - minX || 1;
  const scale = options.widthMm / worldW;
  const widthMm = worldW * scale;
  const heightMm = (maxY - minY) * scale;

  // World → centered, Y-up model space (matches the on-screen orientation).
  const toModel = (v: Pt): Pt => ({
    x: (v.x - minX) * scale - widthMm / 2,
    y: (maxY - v.y) * scale - heightMm / 2,
  });

  // Group tiles by color; store each as a CCW model-space polygon.
  const byColor = new Map<string, Pt[][]>();
  for (const [key, colorKey] of entries) {
    const t = stringToTri(key);
    const poly = getTriVertices(t.q, t.r, t.type).map(toModel);
    if (signedArea(poly) < 0) poly.reverse();
    const list = byColor.get(colorKey);
    if (list) list.push(poly);
    else byColor.set(colorKey, [poly]);
  }
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
