import { H, SIDE, connectedComponents, getTriVertices, stringToTri } from "@/lib/grid-math";
import { rotatePoint } from "@/lib/crop";
import { decodeColor, resolveColor } from "@/lib/constants";
import { drawArtworkPlan } from "@/lib/png-export";
import { joinRuns, outlineSegments, segToPoints } from "@/lib/region-outline";
import type { Layer } from "@/hooks/use-history";

/**
 * Apparel export: the whole artwork as a PNG **with alpha**, optionally cut into
 * separate pieces along its colour boundaries.
 *
 * Every other raster path in the app is opaque by design — Spoonflower and the
 * other fabric sites document no alpha support, so `renderCropToCanvas` fills a
 * background before it draws anything. A garment is the opposite case: the shirt
 * *is* the background, so everything unpainted has to leave the file transparent.
 *
 * **The stencil cut.** A large unbroken area of transfer ink is stiff and cracks
 * along fold lines after a few washes; breaking it into smaller pieces with thin
 * bare-fabric gaps lets the garment flex instead. The lines to cut along are
 * exactly the region boundaries `region-outline.ts` already computes for the
 * plotter — joined into continuous runs, then punched out of the alpha channel.
 *
 * Two differences from the plotter's use of the same boundaries:
 *
 * - **The silhouette is not cut** (`silhouette: false`). The outside of the
 *   artwork is already the edge of the alpha; cutting there buys no flex and
 *   only erodes the design by half a gap width.
 * - **Only colour boundaries, never the lattice.** A flat field of one colour
 *   comes out as one piece. Gridding it would turn a drawing into a mosaic, and
 *   the trixel lattice is far finer than anything a garment needs.
 *
 * **Deliberately not cropped**, for the same reason as the plotter: the fabric
 * exports exist to cut a seamless repeat tile, and a shirt print is the whole
 * artwork on a garment. Sharing `ExportPanel`'s crop rect would mean every shirt
 * silently inheriting a tiling rectangle that has nothing to do with it.
 *
 * Pure except the three `render*` functions, which need a canvas.
 */

export interface ApparelSettings {
  /** Printed width of the design, inches. */
  widthInches: number;
  /** Output resolution. 300 is the DTF/DTG norm, not Spoonflower's 150. */
  dpi: number;
  /** Punch the colour boundaries out of the alpha channel. */
  cut: boolean;
  /** Width of the punched gap, millimetres. */
  cutWidthMm: number;
  /**
   * The garment the design is previewed against. **Preview only — never
   * exported.** It stands in for the shirt, which is the whole point of the
   * alpha, and a transparent-on-checkerboard preview says nothing about whether
   * the piece works on the colour it will actually be worn on.
   */
  garmentColor: string;
}

export const MIN_WIDTH_IN = 1;
export const MAX_WIDTH_IN = 30;
export const MIN_DPI = 72;
export const MAX_DPI = 600;
export const MIN_CUT_MM = 0.2;
export const MAX_CUT_MM = 3;

export const DEFAULT_APPAREL: ApparelSettings = {
  widthInches: 10,
  dpi: 300,
  cut: false,
  cutWidthMm: 0.8,
  garmentColor: "#1f2124",
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function normalizeApparelSettings(raw: unknown): ApparelSettings {
  const r = (raw ?? {}) as Partial<Record<keyof ApparelSettings, unknown>>;
  const num = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : dflt;

  return {
    widthInches: num(
      r.widthInches,
      MIN_WIDTH_IN,
      MAX_WIDTH_IN,
      DEFAULT_APPAREL.widthInches,
    ),
    dpi: Math.round(num(r.dpi, MIN_DPI, MAX_DPI, DEFAULT_APPAREL.dpi)),
    cut: typeof r.cut === "boolean" ? r.cut : DEFAULT_APPAREL.cut,
    cutWidthMm: num(
      r.cutWidthMm,
      MIN_CUT_MM,
      MAX_CUT_MM,
      DEFAULT_APPAREL.cutWidthMm,
    ),
    garmentColor:
      typeof r.garmentColor === "string"
        ? r.garmentColor
        : DEFAULT_APPAREL.garmentColor,
  };
}

// ---------------------------------------------------------------------------
// Bounds and sizing
// ---------------------------------------------------------------------------

export interface ArtworkBounds {
  /** The artwork's extent in **display** space, i.e. after `gridRotation`. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * How many triangle rows the artwork spans. Always an exact integer:
   * `getTriVertices` only ever produces `y = r*H` or `(r+1)*H`, so the world
   * bounding box is a whole multiple of `H` tall.
   */
  rows: number;
}

/**
 * The artwork's own extent, taken from what is actually painted.
 *
 * Walks **every** visible layer, hatch included — hatch marks are keyed by
 * trixel like fills are, and a hatch layer extending past the fills is still
 * part of the picture.
 */
export function artworkBounds(
  layers: Layer[],
  gridRotation: number,
): ArtworkBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const key in layer.painted) {
      const tri = stringToTri(key);
      if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;
      for (const v of getTriVertices(tri.q, tri.r, tri.type)) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;

  const rows = Math.max(1, Math.round((maxY - minY) / H));

  // A quarter turn maps an axis-aligned rect to an axis-aligned rect, so taking
  // the rotated corners is exact rather than a bounding approximation.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [minX, minY],
    [maxX, minY],
    [minX, maxY],
    [maxX, maxY],
  ]) {
    const [rx, ry] = rotatePoint(px, py, gridRotation);
    xs.push(rx);
    ys.push(ry);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, rows };
}

/**
 * Transparent border, in device pixels, on all four sides.
 *
 * The seam-closing overdraw stroke is centred on the triangle edges, so at the
 * artwork's outer boundary half of it falls outside the extent and would be
 * sliced off. **It has to stay an integer**: the row snap below puts every
 * lattice row on an integer pixel boundary, and an integer translation preserves
 * that while a fractional one throws it away.
 */
export const EDGE_PAD = 2;

const snapUp = (v: number, k: number) => Math.max(k, Math.ceil(v / k) * k);

export interface ApparelSize {
  /** The design itself. */
  pxW: number;
  pxH: number;
  /** The bitmap, i.e. the design plus `EDGE_PAD` on every side. */
  canvasW: number;
  canvasH: number;
}

/**
 * Output pixel dimensions for the artwork at a given physical width.
 *
 * **The row-axis dimension is snapped to a whole multiple of `rows`**, exactly as
 * `cropPixelSize` does for a crop. The lattice's only axis-aligned edges are the
 * horizontal ones at every multiple of `H`; left unsnapped, `H` scales to an
 * irrational number of device pixels, so *every* horizontal edge straddles a
 * pixel row and antialiases against its neighbour — and with no background to
 * blend into, that is a semi-transparent line letting the garment through, the
 * full width of the print, at every row.
 *
 * Under a quarter turn the row axis is horizontal, so the snap moves to the width.
 */
export function apparelPixelSize(
  bounds: ArtworkBounds,
  gridRotation: number,
  widthInches: number,
  dpi: number,
): ApparelSize {
  const rotated = Boolean(gridRotation);

  let pxW = Math.max(1, Math.round(widthInches * dpi));
  if (rotated) pxW = snapUp(pxW, bounds.rows);
  let pxH =
    bounds.w > 0 ? Math.max(1, Math.round((pxW * bounds.h) / bounds.w)) : 1;
  if (!rotated) pxH = snapUp(pxH, bounds.rows);

  return {
    pxW,
    pxH,
    canvasW: pxW + 2 * EDGE_PAD,
    canvasH: pxH + 2 * EDGE_PAD,
  };
}

// ---------------------------------------------------------------------------
// The cut
// ---------------------------------------------------------------------------

/** World units per millimetre at the chosen print size. */
export function unitsPerMm(bounds: ArtworkBounds, widthInches: number): number {
  if (widthInches <= 0) return 0;
  return bounds.w / (widthInches * 25.4);
}

/**
 * The joined boundary runs to punch out, as world-space segments.
 *
 * `fills` is the flattened *fill* layers — hatch is decoration drawn over the
 * colour, and has no regions of its own to bound.
 */
export function apparelCutSegments(
  fills: Record<string, string>,
): [[number, number], [number, number]][] {
  return joinRuns(outlineSegments(fills, { silhouette: false })).map(
    segToPoints,
  );
}

/** One punched circle in world space. */
export interface CutCircle {
  x: number;
  y: number;
  radius: number;
}

/**
 * The cut for a stroked (outline) layer.
 *
 * Cutting a stroked layer along its region boundaries would erase the ink — the
 * outline *is* the boundary. Instead, a small circle is punched at **every**
 * lattice vertex of the painted area, sized to a third of the stroke weight.
 * Where the outline stroke passes a vertex the circle cuts a controlled break
 * point through it — the print can flex at each vertex without the outline
 * itself being erased — and where the stroke does not pass (the transparent
 * interior) the circle cuts nothing.
 */
export function outlineCutCircles(
  painted: Record<string, string>,
  radius: number,
): CutCircle[] {
  const seen = new Set<string>();
  const out: CutCircle[] = [];
  const add = (i: number, j: number) => {
    const k = `${i},${j}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x: i * SIDE + j * (SIDE / 2), y: j * H, radius });
  };
  for (const key in painted) {
    if (!decodeColor(painted[key])) continue;
    const tri = stringToTri(key);
    if (!Number.isFinite(tri.q) || !Number.isFinite(tri.r)) continue;
    if (tri.type === "up") {
      add(tri.q, tri.r);
      add(tri.q + 1, tri.r);
      add(tri.q, tri.r + 1);
    } else {
      add(tri.q, tri.r + 1);
      add(tri.q + 1, tri.r + 1);
      add(tri.q + 1, tri.r);
    }
  }
  return out;
}

export interface CutPieceReport {
  /** Separate pieces the cut leaves behind. */
  pieces: number;
  /** Triangle count of the smallest of them; 0 when nothing is painted. */
  smallestTriangles: number;
}

/** Area of one trixel, world units squared. */
export const TRI_AREA = (SIDE * H) / 2;

/**
 * What the cut actually produces: how many separate pieces, and how small the
 * smallest is. A piece of only a few square millimetres lifts off in the wash,
 * which is worth knowing before paying for a transfer.
 *
 * Grouped by **resolved** colour, matching `outlineSegments` — two swatches from
 * different palettes that resolve to the same hex have no boundary drawn between
 * them, so they are one piece here too.
 */
export function cutPieceReport(fills: Record<string, string>): CutPieceReport {
  const byColor = new Map<string, string[]>();
  for (const key in fills) {
    const encoded = fills[key];
    if (!decodeColor(encoded)) continue;
    const hex = resolveColor(encoded);
    const list = byColor.get(hex);
    if (list) list.push(key);
    else byColor.set(hex, [key]);
  }

  let pieces = 0;
  let smallest = Infinity;
  for (const keys of byColor.values()) {
    for (const comp of connectedComponents(keys)) {
      pieces++;
      if (comp.length < smallest) smallest = comp.length;
    }
  }
  return {
    pieces,
    smallestTriangles: Number.isFinite(smallest) ? smallest : 0,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Where the artwork lands on a bitmap: the display-space rect scaled by
 * `sx`/`sy` and offset by `ox`/`oy` device pixels. The export and the preview
 * differ only in this, so they drive the same renderer.
 */
export interface ApparelView {
  canvasW: number;
  canvasH: number;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/**
 * The export's own view: the design fitted exactly to `size`, inside the pad.
 *
 * Each axis takes its own scale rather than sharing one. Only an exact fit puts
 * the snapped axis's rows on integer pixel boundaries, which is the entire point
 * of the snap; the two factors differ by well under 0.1%, so nothing is visibly
 * distorted.
 */
export function apparelExportView(
  bounds: ArtworkBounds,
  size: ApparelSize,
): ApparelView {
  return {
    canvasW: size.canvasW,
    canvasH: size.canvasH,
    sx: bounds.w > 0 ? size.pxW / bounds.w : 1,
    sy: bounds.h > 0 ? size.pxH / bounds.h : 1,
    ox: EDGE_PAD,
    oy: EDGE_PAD,
  };
}

/**
 * A preview view: the artwork centred in a `boxW` x `boxH` bitmap, either fitted
 * to it or at an explicit scale (device pixels per display unit) so a detail can
 * be inspected at its true export size.
 */
export function apparelPreviewView(
  bounds: ArtworkBounds,
  boxW: number,
  boxH: number,
  scale: number | "fit",
): ApparelView {
  const fit =
    bounds.w > 0 && bounds.h > 0
      ? Math.min(boxW / bounds.w, boxH / bounds.h)
      : 1;
  const s = scale === "fit" ? fit : scale;
  return {
    canvasW: boxW,
    canvasH: boxH,
    sx: s,
    sy: s,
    ox: (boxW - bounds.w * s) / 2,
    oy: (boxH - bounds.h * s) / 2,
  };
}

/**
 * Draws the artwork into `canvas` under `view`, with a transparent background
 * and — when `cutWorld > 0` — the boundary runs punched out of the alpha.
 */
export function renderApparelToCanvas(
  canvas: HTMLCanvasElement,
  layers: Layer[],
  bounds: ArtworkBounds,
  gridRotation: number,
  view: ApparelView,
  cutSegments: [[number, number], [number, number]][],
  cutWorld: number,
  cutCircles: CutCircle[] = [],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = view.canvasW;
  canvas.height = view.canvasH;

  // No background fill. A 2D canvas starts fully transparent, which is exactly
  // the deliverable — every unpainted trixel has to come out as bare garment.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.canvasW, view.canvasH);

  ctx.save();
  // The same forward transform `renderCropToCanvas` uses, minus pan/zoom: place
  // the artwork's display origin, scale it to fill the bitmap, then rotate world
  // space into display space so a quarter-turned grid exports as it looks.
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.sx, view.sy);
  ctx.translate(-bounds.x, -bounds.y);
  ctx.rotate(gridRotation);

  // Glow is deliberately dropped here, unlike every other raster path. A soft
  // shadow spreads translucent ink straight across the stencil cut gaps below,
  // welding the pieces back together and undoing the flex the cut exists to
  // provide — the same reason the cut ignores hatch.
  drawArtworkPlan(ctx, layers, 1 / Math.min(view.sx, view.sy), { glow: false });

  if (cutWorld > 0 && cutSegments.length > 0) {
    // The runs are in **world** coordinates and ride the transform already on
    // the context — no second mapping, and correct under a quarter turn for free.
    //
    // Round caps and joins, not butt. A run ends where runs of the other two
    // families cross it, and a butt cap stops half a gap short of the crossing —
    // leaving a hairline of ink bridging every junction, which silently welds the
    // pieces back together and undoes the whole point of cutting.
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = cutWorld;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const [a, b] of cutSegments) {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  if (cutCircles.length > 0) {
    // Stroked-layer break points: one circle per lattice vertex, punched out of
    // the alpha wherever it overlaps ink. `moveTo` before each arc keeps the
    // circles from being joined by a stray connector line.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.beginPath();
    for (const c of cutCircles) {
      ctx.moveTo(c.x + c.radius, c.y);
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

/**
 * The same drawing over a garment colour, which is what makes an alpha export
 * judgeable at all. The colour is never written to the exported file.
 */
export function renderApparelPreview(
  canvas: HTMLCanvasElement,
  layers: Layer[],
  bounds: ArtworkBounds,
  gridRotation: number,
  view: ApparelView,
  cutSegments: [[number, number], [number, number]][],
  cutWorld: number,
  cutCircles: CutCircle[],
  garmentHex: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // The artwork is composited onto its own bitmap first. Drawing it straight
  // onto the garment would let `destination-out` punch through the garment as
  // well, and the preview would show holes in the shirt rather than gaps in the
  // print.
  const art = document.createElement("canvas");
  renderApparelToCanvas(
    art,
    layers,
    bounds,
    gridRotation,
    view,
    cutSegments,
    cutWorld,
    cutCircles,
  );

  canvas.width = view.canvasW;
  canvas.height = view.canvasH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = garmentHex;
  ctx.fillRect(0, 0, view.canvasW, view.canvasH);
  ctx.drawImage(art, 0, 0);
}
