import {
  boundaryVertexDegrees,
  flattenRoundedRing,
  roundedRegions,
  ROUND_RADIUS_AT_FULL,
} from "@/lib/round-corners";
import { traceUnionLoops } from "@/lib/cut-svg";
import { FAB_CHORD_MM, type Pt } from "@/lib/mesh-export";
import { rotatePoint } from "@/lib/crop";

// ---------------------------------------------------------------------------
// The multicolor ("flat") cutting export: one tile per color, every tile
// carrying every polygon.
//
// A sibling of the stack cut and the interlocking cut. The stack cut nests a
// sheet per color level and joins them; this one cuts each color as a **flat
// silhouette sheet** — the same region polygons the standard SVG export draws,
// so the cut lines land exactly where two colors meet. The difference is that
// a tile is drawn per color, and *every* tile carries *every* polygon: cutting
// the whole design out of each color of card leaves you with a copy of each
// polygon in each color, free to assemble any color arrangement — zero paper
// wasted, because no color's sheet ever throws away a shape.
//
// Every tile is also cut as a mat — the sheet's own rectangle with the design
// outline as its window — so the leftover cardstock around the pieces is
// already a colored mat, ready to frame a color-cycled piece.
//
// Rounding is honoured (the polygons are `roundedRegions`, the same shapes the
// on-screen SVG draws); paper-first sizing fits the design into a user-defined
// sheet minus margins; and an optional second file holds the mats alone — one
// paper-sized tile per color — for a clean mat without the pieces.
// ---------------------------------------------------------------------------

export interface MulticolorOptions {
  /** Physical sheet width, mm. The design auto-fits *inside* this, minus margins. */
  paperWidthMm: number;
  paperHeightMm: number;
  /** Margin on every side of the sheet, mm. */
  marginMm: number;
  /** Gap between tiled sheets in the output, mm. */
  pageSpacingMm: number;
  /** Build the separate mats file (with its own download button). */
  mat: boolean;
}

export interface MulticolorSheet {
  /** Resolved cardstock color of this sheet. */
  hex: string;
}

export interface MulticolorRegion {
  /** Resolved region color — carried for the per-color sheet fills. */
  hex: string;
  /** Every closed ring of this region, as world-space polygons. A ring is one
   *  polygon to cut; rings nested inside each other are separate pieces (the
   *  interior is cut from the same sheet as anything else). */
  rings: Pt[][];
}

export interface MulticolorPlan {
  /** The sheets, one per distinct color actually painted. */
  sheets: MulticolorSheet[];
  /** Every region ring, in artwork order — the full set of polygons each sheet
   *  is cut into. World space, unrotated. */
  polygons: Pt[][];
  /** The design's rounded silhouette loops (outer + interior windows), world
   *  space, unrotated. The mat's cut-out window. */
  outline: Pt[][];
  /** mm per world unit, chosen so the turned design fits the usable area. */
  scale: number;
  /** The turned design box, world units — measured after gridRotation, which is
   *  why `paperWidthMm` ends up meaning the paper the user sees. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /** Physical size the design comes out at, mm. */
  designWmm: number;
  designHmm: number;
  colorCount: number;
}

function fitScale(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  options: MulticolorOptions,
): number {
  const usableW = options.paperWidthMm - 2 * options.marginMm;
  const usableH = options.paperHeightMm - 2 * options.marginMm;
  const worldW = box.maxX - box.minX;
  const worldH = box.maxY - box.minY;
  if (!(usableW > 0) || !(usableH > 0) || worldW <= 0 || worldH <= 0) return 0;
  return Math.min(usableW / worldW, usableH / worldH);
}

/**
 * Plans the multicolor cut: the region polygons, the silhouette window, and the
 * fit scale. Returns null when nothing is painted.
 */
export function planMulticolor(
  painted: Record<string, string>,
  options: MulticolorOptions,
  roundFraction: number,
  gridRotation = 0,
): MulticolorPlan | null {
  const keys = Object.keys(painted);
  if (keys.length === 0) return null;

  // The colors and their polygons are exactly what the standard SVG export
  // draws — resolved-by-eye regions, rounded under the layer effect — so the cut
  // lands where the artwork changes color. `roundedRegions` takes the slider
  // fraction itself (it multiplies by `ROUND_RADIUS_AT_FULL` internally); the
  // silhouette tracer below wants the world radius.
  const radius = roundFraction * ROUND_RADIUS_AT_FULL;
  const regions: MulticolorRegion[] = roundedRegions(painted, roundFraction).map((r) => ({
    hex: r.fill,
    rings: r.rings.map((ring) => flattenRoundedRing(ring).map(toPt)),
  }));
  const sheets: MulticolorSheet[] = regions.map((r) => ({ hex: r.hex }));

  const turn = (p: Pt): Pt => {
    const [x, y] = rotatePoint(p.x, p.y, gridRotation);
    return { x, y };
  };

  // Measured from the polygons, not from `painted`'s raw triangles: a sheet's
  // tiles carry these exact shapes, so the fit has to describe them.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const region of regions) {
    for (const ring of region.rings) {
      for (const p of ring) {
        const t = turn(p);
        if (t.x < minX) minX = t.x;
        if (t.x > maxX) maxX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.y > maxY) maxY = t.y;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  const box = { minX, minY, maxX, maxY };

  const scale = fitScale(box, options);
  if (!(scale > 0)) return null;

  // The silhouette window: the union boundary of everything painted, rounded
  // under the same degree rule the cut mat uses, so the window matches the art.
  const outline = traceUnionLoops(keys, {
    round: radius,
    sagitta: FAB_CHORD_MM / scale,
    degrees: boundaryVertexDegrees(painted),
  });

  return {
    sheets,
    polygons: regions.flatMap((r) => r.rings),
    outline,
    scale,
    box,
    designWmm: (maxX - minX) * scale,
    designHmm: (maxY - minY) * scale,
    colorCount: sheets.length,
  };
}

export interface MulticolorMetrics {
  designWmm: number;
  designHmm: number;
  /** mm per world unit. */
  scale: number;
  colorCount: number;
  /** Usable cutting area of one sheet, mm. */
  usableWmm: number;
  usableHmm: number;
}

export function multicolorMetrics(
  plan: MulticolorPlan,
  options: MulticolorOptions,
): MulticolorMetrics {
  return {
    designWmm: plan.designWmm,
    designHmm: plan.designHmm,
    scale: plan.scale,
    colorCount: plan.colorCount,
    usableWmm: options.paperWidthMm - 2 * options.marginMm,
    usableHmm: options.paperHeightMm - 2 * options.marginMm,
  };
}

function toPt([x, y]: [number, number]): Pt {
  return { x, y };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rnd(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function layerCount(count: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

function totalSize(
  cols: number,
  rows: number,
  tileW: number,
  tileH: number,
  gap: number,
): { w: number; h: number } {
  return {
    w: cols * tileW + (cols - 1) * gap,
    h: rows * tileH + (rows - 1) * gap,
  };
}

/**
 * A grid origin and the design-to-tile placement that puts the design centered
 * inside a `tileW x tileH` tile. Ths same math serves the sheets (paper-sized
 * tiles) and the mats (border-sized tiles).
 */
function layoutCell(
  index: number,
  cols: number,
  tileW: number,
  tileH: number,
  gap: number,
): { col: number; row: number; ox: number; oy: number } {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    col,
    row,
    ox: col * (tileW + gap),
    oy: row * (tileH + gap),
  };
}

interface DocMapper {
  scale: number;
  minX: number;
  minY: number;
  turn: (p: Pt) => Pt;
}

function docMap(plan: MulticolorPlan, gridRotation: number): DocMapper {
  const turn = (p: Pt): Pt => {
    const [x, y] = rotatePoint(p.x, p.y, gridRotation);
    return { x, y };
  };
  return { scale: plan.scale, minX: plan.box.minX, minY: plan.box.minY, turn };
}

/** Every polygon of the design as one compound path, placed at `ox, oy` with
 *  the design centered in a `tileW x tileH` space. Each polygon is its own
 *  `M … Z` sub-path, so the color seams stay drawn — a seam is a cut line. */
function designPathFor(
  plan: MulticolorPlan,
  map: DocMapper,
  ox: number,
  oy: number,
  tileW: number,
  tileH: number,
): string {
  const cx = ox + (tileW - plan.designWmm) / 2;
  const cy = oy + (tileH - plan.designHmm) / 2;
  const px = (x: number) => rnd((x - map.minX) * map.scale + cx);
  const py = (y: number) => rnd((y - map.minY) * map.scale + cy);
  return plan.polygons
    .map((ring) => {
      let d = "";
      ring.forEach((p, j) => {
        const t = map.turn(p);
        d += `${j === 0 ? "M" : "L"}${px(t.x)} ${py(t.y)}`;
      });
      return `${d} Z`;
    })
    .join(" ");
}

/** The frame rectangle at the tile's own bounds with the silhouette window cut
 *  out of it (evenodd). The window's top-left lands at `winOx, winOy` — the mat
 *  border for the mats file, or the centered design origin on a paper-sized
 *  color sheet — while the frame always runs at the given tile bounds. */
function frameWindowPath(
  plan: MulticolorPlan,
  map: DocMapper,
  ox: number,
  oy: number,
  tileW: number,
  tileH: number,
  winOx: number,
  winOy: number,
): string {
  const px = (x: number) => rnd((x - map.minX) * map.scale + winOx);
  const py = (y: number) => rnd((y - map.minY) * map.scale + winOy);
  const frame = `M${rnd(ox)} ${rnd(oy)} H${rnd(ox + tileW)} V${rnd(oy + tileH)} H${rnd(ox)} Z`;
  const window = plan.outline
    .map((loop) => {
      let d = "";
      loop.forEach((p, j) => {
        const t = map.turn(p);
        d += `${j === 0 ? "M" : "L"}${px(t.x)} ${py(t.y)}`;
      });
      return `${d} Z`;
    })
    .join(" ");
  return `${frame} ${window}`;
}

/**
 * The color-sheets file: one tiled paper-sized sheet per color, carrying every
 * polygon of the design **and the mat structure** — the sheet's own rectangle
 * with the design outline cut out of it. The leftover cardstock of a cut sheet
 * is therefore already a colored mat (the design window, the pieces from the
 * middle), usable as a border mat on a color-cycled piece.
 */
export function buildMulticolorSVG(
  plan: MulticolorPlan,
  options: MulticolorOptions,
  gridRotation = 0,
): string | null {
  if (plan.sheets.length === 0) return null;
  const tileW = options.paperWidthMm;
  const tileH = options.paperHeightMm;
  const gap = options.pageSpacingMm;
  const { cols, rows } = layerCount(plan.sheets.length);
  const { w, h } = totalSize(cols, rows, tileW, tileH, gap);
  const map = docMap(plan, gridRotation);

  const parts: string[] = [];
  plan.sheets.forEach((sheet, i) => {
    const { ox, oy } = layoutCell(i, cols, tileW, tileH, gap);
    const cx = ox + (tileW - plan.designWmm) / 2;
    const cy = oy + (tileH - plan.designHmm) / 2;
    // The mat frame + window first (this is the leftover, a colored mat), then
    // the pieces drawn on top, inside the window.
    const matD = frameWindowPath(plan, map, ox, oy, tileW, tileH, cx, cy);
    const piecesD = designPathFor(plan, map, ox, oy, tileW, tileH);
    parts.push(
      `  <g inkscape:groupmode="layer" inkscape:label="Sheet ${i + 1} — ${xmlEscape(sheet.hex)}" id="multicolor-${i + 1}">\n` +
        `    <path d="${matD}" fill="${sheet.hex}" fill-opacity="0.85" fill-rule="evenodd" stroke="#000000" stroke-width="0.1"/>\n` +
        `    <path d="${piecesD}" fill="${sheet.hex}" fill-opacity="0.85" stroke="#000000" stroke-width="0.1"/>\n` +
        `  </g>`,
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${rnd(w)}mm" height="${rnd(h)}mm" ` +
    `viewBox="0 0 ${rnd(w)} ${rnd(h)}">\n` +
    parts.join("\n") +
    `\n</svg>\n`
  );
}

/**
 * The mats file: one paper-sized tile per color — the design's outline cut out
 * of the sheet's own rectangle, exactly the mat every color sheet also carries
 * (without the pieces). One pass per color leaves you a full colored mat.
 */
export function buildMulticolorMatsSVG(
  plan: MulticolorPlan,
  options: MulticolorOptions,
  gridRotation = 0,
): string | null {
  if (plan.sheets.length === 0) return null;
  const tileW = options.paperWidthMm;
  const tileH = options.paperHeightMm;
  const gap = options.pageSpacingMm;
  const { cols, rows } = layerCount(plan.sheets.length);
  const { w, h } = totalSize(cols, rows, tileW, tileH, gap);
  const map = docMap(plan, gridRotation);

  const parts: string[] = [];
  plan.sheets.forEach((sheet, i) => {
    const { ox, oy } = layoutCell(i, cols, tileW, tileH, gap);
    const cx = ox + (tileW - plan.designWmm) / 2;
    const cy = oy + (tileH - plan.designHmm) / 2;
    const d = frameWindowPath(plan, map, ox, oy, tileW, tileH, cx, cy);
    parts.push(
      `  <g inkscape:groupmode="layer" inkscape:label="Mat ${i + 1} — ${xmlEscape(sheet.hex)}" id="multicolor-mat-${i + 1}">\n` +
        `    <path d="${d}" fill="${sheet.hex}" fill-rule="evenodd" stroke="#000000" stroke-width="0.1"/>\n` +
        `  </g>`,
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${rnd(w)}mm" height="${rnd(h)}mm" ` +
    `viewBox="0 0 ${rnd(w)} ${rnd(h)}">\n` +
    parts.join("\n") +
    `\n</svg>\n`
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export type MulticolorPreviewMode = "sheets" | "mats";

/**
 * Draws the preview: the tiled sheets (paper-sized, every polygon per sheet) or
 * the mats (border-sized, outline window per sheet), at whatever scale fits the
 * canvas.
 */
export function renderMulticolorPreview(
  canvas: HTMLCanvasElement,
  plan: MulticolorPlan,
  mode: MulticolorPreviewMode,
  options: MulticolorOptions,
  w: number,
  h: number,
  gridRotation = 0,
): void {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const tileW = options.paperWidthMm;
  const tileH = options.paperHeightMm;
  const gap = options.pageSpacingMm;
  const { cols, rows } = layerCount(plan.sheets.length);
  const { w: totalW, h: totalH } = totalSize(cols, rows, tileW, tileH, gap);

  const pad = 8;
  const fit = Math.min((w - 2 * pad) / (totalW || 1), (h - 2 * pad) / (totalH || 1));
  if (!(fit > 0)) return;
  // Centered in the panel, not pinned to its top-left corner.
  const ox0 = (w - totalW * fit) / 2;
  const oy0 = (h - totalH * fit) / 2;
  // Document-space placement for a tile's grid origin (centering + layout).
  const sx = (v: number) => ox0 + v * fit;
  const sy = (v: number) => oy0 + v * fit;

  const turn = (p: Pt): Pt => {
    const [x, y] = rotatePoint(p.x, p.y, gridRotation);
    return { x, y };
  };
  const cx = (tileW - plan.designWmm) / 2;
  const cy = (tileH - plan.designHmm) / 2;
  // Tile-relative geometry; the translate below supplies the grid origin.
  const px = (x: number) => ((x - plan.box.minX) * plan.scale + cx) * fit;
  const py = (y: number) => ((y - plan.box.minY) * plan.scale + cy) * fit;

  const ringPath = (ring: Pt[]) => {
    ctx.beginPath();
    ring.forEach((p, j) => {
      const t = turn(p);
      if (j === 0) ctx.moveTo(px(t.x), py(t.y));
      else ctx.lineTo(px(t.x), py(t.y));
    });
    ctx.closePath();
  };

  plan.sheets.forEach((sheet, i) => {
    const { ox, oy } = layoutCell(i, cols, tileW, tileH, gap);
    ctx.save();
    ctx.translate(sx(ox), sy(oy));

    // Both modes draw the mat frame + window first — on the color sheets the
    // leftover cardstock between the border and the window is the colored mat —
    // then the sheets mode adds the pieces on top, inside the window.
    ctx.beginPath();
    ctx.rect(0, 0, tileW * fit, tileH * fit);
    for (const loop of plan.outline) ringPath(loop);
    ctx.fillStyle = sheet.hex;
    ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.stroke();

    if (mode === "sheets") {
      for (const ring of plan.polygons) {
        ctx.fillStyle = sheet.hex;
        ringPath(ring);
        ctx.fill();
        ctx.stroke();
      }
    }

    // The tile's own bounds, so each sheet reads as a separate piece of paper.
    ctx.strokeStyle = "rgba(70,70,70,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, tileW * fit, tileH * fit);
    ctx.lineWidth = 1;
    ctx.restore();
  });
}