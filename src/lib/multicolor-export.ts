import {
  boundaryVertexDegrees,
  flattenRoundedRing,
  roundedRegions,
  ROUND_RADIUS_AT_FULL,
} from "@/lib/round-corners";
import { traceUnionLoops } from "@/lib/cut-svg";
import { FAB_CHORD_MM, signedArea, type Pt } from "@/lib/mesh-export";
import { loadClipper, type PlotPoly } from "@/lib/clipper-offset";
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
//
// The mats can also carry **shape outlines**: a band of a chosen thickness
// along every color boundary, kept by the mat. Geometrically this is the
// outline layer effect applied to the merged artwork — a centred stroke of the
// given weight along every region ring, composed with round corners — lifted
// from ink to cut area. The one visible difference: the outermost outline (the
// silhouette's own band) is replaced by the page rectangle, so a piece still
// sits flush against the window edge. Internally that band is still built — it
// is the weld that ties every seam band's endpoint to the frame body across
// the silhouette line; the union then absorbs it into the page. See
// `computeMatOutline`.
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
  /** Outline weight on the mats, mm. 0 (the default) means no outlines.
   *  Clamped up to `MIN_MAT_OUTLINE_MM` wherever it is used. */
  matOutlineMm?: number;
  /** With outlines on: keep the design's own outer edge instead of replacing
   *  it with the page rectangle. The mat becomes pure line-art in the shape
   *  of the artwork — no rectangular frame is cut at all. */
  matOutlineOuter?: boolean;
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
  /** The rings again, grouped per region (a region may carry several: its
   *  outer boundary plus enclosed holes). Index-aligned with `sheets`, and the
   *  input the mat outline offsets region by region — a union-level offset
   *  cannot see interior color seams. */
  regionRings: Pt[][][];
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
    regionRings: regions.map((r) => r.rings),
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
// The outlined mat
// ---------------------------------------------------------------------------

/** Smallest outline weight the mat will cut, mm. Thinner bands do not survive
 *  weeding, so the dialog clamps its field to this. */
export const MIN_MAT_OUTLINE_MM = 3;

/** Feature width the cleanup opening removes, mm — anything narrower than
 *  this is pruned from the band set. Deliberately below `MIN_MAT_OUTLINE_MM`:
 *  the opening takes half of it out of *each side* of a band, so a threshold
 *  equal to the minimum thickness would leave a band cut at exactly 3 mm with
 *  no core at all and erase itself. The 0.25 mm margin keeps the smallest
 *  allowed band intact while still catching pinch-off slivers. */
const PRUNE_WIDTH_MM = 2.75;

/** Shoelace area of a doc-space ring; sign gives the winding. */
function loopArea(loop: PlotPoly): number {
  return signedArea(loop.map(([x, y]) => ({ x, y })));
}

/** Even-odd point test. Holes lie strictly inside their outer after Clipper's
 *  clean, so a ring vertex is a safe probe. */
function loopContains(outer: PlotPoly, pt: [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const [xi, yi] = outer[i];
    const [xj, yj] = outer[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

interface BandComponent {
  outer: PlotPoly;
  holes: PlotPoly[];
}

/**
 * Groups a flat Clipper solution into per-component ring sets — each outer
 * loop with the holes nested in it. Clipper winds outers and holes oppositely,
 * so the split is by sign: positive loops are outers, and each negative loop
 * joins the *smallest* positive ring holding it (an outer inside another
 * outer's hole — an island in a window — must not be swallowed as its
 * sibling's hole, which is why sign leads and containment only pairs holes
 * with containers).
 */
function bandComponents(loops: PlotPoly[]): BandComponent[] {
  const outers: BandComponent[] = [];
  const holes: PlotPoly[] = [];
  for (const loop of loops) {
    if (loopArea(loop) >= 0) outers.push({ outer: loop, holes: [] });
    else holes.push(loop);
  }
  for (const hole of holes) {
    let host: BandComponent | null = null;
    for (const c of outers) {
      if (
        loopContains(c.outer, hole[0]) &&
        (host === null || Math.abs(loopArea(host.outer)) > Math.abs(loopArea(c.outer)))
      ) {
        host = c;
      }
    }
    // Uncontained negative rings do not occur in Clipper output; if one ever
    // does, keeping it standalone errs toward paper rather than a window.
    if (host) host.holes.push(hole);
    else outers.push({ outer: hole, holes: [] });
  }
  return outers;
}

/**
 * The outlined mat's kept paper, as tile-local doc-mm loops under non-zero
 * winding — the geometry `buildMulticolorMatsSVG` and the mats preview draw
 * when outlines are on. Null when the feature is off (`matOutlineMm` below
 * `MIN_MAT_OUTLINE_MM`), which callers read as "fall back to the plain mat".
 *
 * **This is the outline layer effect's geometry, lifted to a cut.** The merged
 * artwork is one multi-region layer; its outline effect strokes every region
 * ring at the given weight, composed with round corners (the rings are the
 * rounded ones already). The stroke becomes area here:
 *
 *     bands = (∪ᵢ grow(Rᵢ, +h)) \ (∪ᵢ grow(Rᵢ, −h))     h = weight / 2
 *
 * Per-region offsets, not one union-level offset — a boolean on the merged
 * silhouette cannot see interior color seams, and the seams are the point.
 * The visible difference from the on-screen effect: the silhouette's own band
 * is replaced by the page rectangle, so a piece still sits flush against the
 * window edge. The band is still built — where each seam meets the silhouette
 * it is what welds that seam's band to the frame body across the silhouette
 * line (a bare seam band stops half a width short of solid contact) — and the
 * final union then absorbs it into the frame. With `matOutlineOuter` the band
 * is *not* absorbed: the page rectangle is left out of the final union and
 * the mat is pure line-art in the design's own shape.
 *
 * Two guards, both the user's rules:
 *
 * - **Nothing thinner than 3 mm is offered, and band fragments narrower than
 *   `PRUNE_WIDTH_MM` are removed.** The thickness itself is clamped by the
 *   caller; here an opening (erode by half the prune width, dilate back)
 *   removes fragments narrower than that — slivers pinched off where two
 *   seams run close together, or where a thin shape is swallowed whole. The
 *   prune threshold sits deliberately *below* the clamp: a band at exactly
 *   the minimum thickness has no core left once the opening's half-width
 *   comes out of each side, and would erase itself.
 * - **No floating edges.** A component is kept only where it overlaps the
 *   frame body — the paper outside the silhouette, always one connected piece
 *   (the complement of a bounded blob in a rectangle). Everything else rests
 *   on nothing once the window is cut. Rounding is what severs these: two
 *   regions whose bands welded through a sharp pinch corner lose the weld when
 *   the corners round away, and the chain behind the pinch drops.
 *
 * Clipper loads on demand, so this is async like every other consumer
 * (`clipper-offset.ts`). Pure apart from that: no DOM, no React.
 */
export async function computeMatOutline(
  plan: MulticolorPlan,
  options: MulticolorOptions,
  gridRotation = 0,
): Promise<Pt[][] | null> {
  const thicknessMm = options.matOutlineMm ?? 0;
  if (!(thicknessMm >= MIN_MAT_OUTLINE_MM)) return null;

  const clipper = await loadClipper();
  const tileW = options.paperWidthMm;
  const tileH = options.paperHeightMm;
  // Tile-local doc mm at the FIRST tile's placement — design centred in its
  // paper tile. Every other tile is this geometry translated by its layout
  // origin, which is how the builders consume it.
  const cx0 = (tileW - plan.designWmm) / 2;
  const cy0 = (tileH - plan.designHmm) / 2;
  const toDoc = (p: Pt): [number, number] => {
    const [x, y] = rotatePoint(p.x, p.y, gridRotation);
    return [(x - plan.box.minX) * plan.scale + cx0, (y - plan.box.minY) * plan.scale + cy0];
  };
  const regionDocs = plan.regionRings.map((rings) => rings.map((ring) => ring.map(toDoc)));
  const asPts = (loops: PlotPoly[]): Pt[][] => loops.map((loop) => loop.map(toPt));

  const page: PlotPoly = [
    [0, 0],
    [tileW, 0],
    [tileW, tileH],
    [0, tileH],
  ];
  const silhouette = clipper.union(regionDocs.flat());
  if (silhouette.length === 0) return null;
  const frameBody = clipper.difference([page], silhouette);

  // The stroke band, half a width to each side of every region boundary.
  const half = thicknessMm / 2;
  let bands = clipper.difference(
    clipper.union(regionDocs.flatMap((rd) => clipper.offset(rd, half))),
    clipper.union(regionDocs.flatMap((rd) => clipper.offset(rd, -half))),
  );
  // A wide outline can reach past the paper edge when the margin is small.
  bands = clipper.intersect(bands, [page]);

  // Opening prunes anything narrower than the prune width: erode by half of
  // it, dilate back. What survives is the thick part of the band, unchanged
  // in place; what vanished was too thin to cut reliably. The threshold is
  // under the thickness clamp so a minimum-thickness band survives its own
  // cleanup (see `PRUNE_WIDTH_MM`).
  const minHalf = PRUNE_WIDTH_MM / 2;
  const eroded = clipper.offset(bands, -minHalf);
  const opened = eroded.length > 0 ? clipper.offset(eroded, minHalf) : [];
  bands = opened.length > 0 ? clipper.intersect(bands, opened) : [];

  // Keep only components attached to the frame body. Zero-width contacts do
  // not count — Clipper returns no area for them, and a cut along a tangent
  // falls apart anyway — which is exactly the rounding-severed case. The
  // predicate doubles as the anchor test in outer-edge mode: the silhouette's
  // own band is the one component that overlaps the frame body, and every
  // seam chain rides to it across the silhouette line.
  const attached = bandComponents(bands)
    .filter((c) => clipper.intersect([c.outer], frameBody).length > 0)
    .flatMap((c) => [c.outer, ...c.holes]);

  // Backed mode: the page rect replaces the silhouette's own band; the union
  // absorbs the band's outward half and keeps the window edge exactly at the
  // silhouette. Outer-edge mode: leave the page rect out entirely — the
  // outline network *is* the mat, in the design's own shape.
  const kept =
    options.matOutlineOuter && attached.length > 0
      ? attached
      : [...frameBody, ...attached];
  if (kept.length === 0) return null;
  return asPts(clipper.union(kept));
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

/** Tile-local doc-mm loops laid out at a tile origin, as one compound path.
 *  Non-zero winding: the loops come from a boolean union with consistent
 *  orientations, so nesting resolves without even-odd. */
function loopsPathAt(loops: Pt[][], ox: number, oy: number): string {
  return loops
    .map((loop) => {
      let d = "";
      loop.forEach((p, j) => {
        d += `${j === 0 ? "M" : "L"}${rnd(p.x + ox)} ${rnd(p.y + oy)}`;
      });
      return `${d} Z`;
    })
    .join(" ");
}

/**
 * The mats file: one paper-sized tile per color — the design's outline cut out
 * of the sheet's own rectangle, exactly the mat every color sheet also carries
 * (without the pieces). One pass per color leaves you a full colored mat.
 *
 * With `matLoops` (from `computeMatOutline`) the mat keeps an outline band of
 * the chosen thickness along every color boundary; the page rect replaces the
 * silhouette's own band so a piece still sits flush. Full-size pieces overlap
 * the seam bands — the mat is a backing and alignment guide, not a flush fit.
 */
export function buildMulticolorMatsSVG(
  plan: MulticolorPlan,
  options: MulticolorOptions,
  gridRotation = 0,
  matLoops: Pt[][] | null = null,
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
    const d =
      matLoops && matLoops.length > 0
        ? loopsPathAt(matLoops, ox, oy)
        : (() => {
            const cx = ox + (tileW - plan.designWmm) / 2;
            const cy = oy + (tileH - plan.designHmm) / 2;
            return frameWindowPath(plan, map, ox, oy, tileW, tileH, cx, cy);
          })();
    const fillRule = matLoops && matLoops.length > 0 ? "nonzero" : "evenodd";
    parts.push(
      `  <g inkscape:groupmode="layer" inkscape:label="Mat ${i + 1} — ${xmlEscape(sheet.hex)}" id="multicolor-mat-${i + 1}">\n` +
        `    <path d="${d}" fill="${sheet.hex}" fill-rule="${fillRule}" stroke="#000000" stroke-width="0.1"/>\n` +
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
 * canvas. `matLoops` (from `computeMatOutline`) replaces the mats mode's plain
 * frame+window with the outlined mat.
 */
export function renderMulticolorPreview(
  canvas: HTMLCanvasElement,
  plan: MulticolorPlan,
  mode: MulticolorPreviewMode,
  options: MulticolorOptions,
  w: number,
  h: number,
  gridRotation = 0,
  matLoops: Pt[][] | null = null,
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
    // then the sheets mode adds the pieces on top, inside the window. With
    // computed mat loops the mats tile is that geometry instead: doc-mm local,
    // so only the fit scale applies inside the translated tile.
    ctx.beginPath();
    if (mode === "mats" && matLoops && matLoops.length > 0) {
      for (const loop of matLoops) {
        loop.forEach((p, j) => {
          if (j === 0) ctx.moveTo(p.x * fit, p.y * fit);
          else ctx.lineTo(p.x * fit, p.y * fit);
        });
        ctx.closePath();
      }
      ctx.fillStyle = sheet.hex;
      ctx.fill("nonzero");
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.stroke();
    } else {
      ctx.rect(0, 0, tileW * fit, tileH * fit);
      for (const loop of plan.outline) ringPath(loop);
      ctx.fillStyle = sheet.hex;
      ctx.fill("evenodd");
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.stroke();
    }

    if (mode === "sheets") {
      for (const ring of plan.polygons) {
        ctx.fillStyle = sheet.hex;
        ringPath(ring);
        ctx.fill();
        ctx.stroke();
      }
    }

    // The tile's own bounds, so each sheet reads as a separate piece of paper.
    // Outer-edge mats cut no rectangle, so the bound would be a lie — there
    // the design's own outline is the boundary.
    if (!(mode === "mats" && matLoops && options.matOutlineOuter)) {
      ctx.strokeStyle = "rgba(70,70,70,0.9)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0, 0, tileW * fit, tileH * fit);
      ctx.lineWidth = 1;
    }
    ctx.restore();
  });
}