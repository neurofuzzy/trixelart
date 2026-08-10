import {
  H,
  SIDE,
  getTriVertices,
  stringToTri,
  triToString,
  worldKey,
  type TriKey,
} from "@/lib/grid-math";
import { decodeColor, resolveColor } from "@/lib/constants";
import { traceUnionLoops } from "@/lib/cut-svg";
import { rotatePoint } from "@/lib/crop";
import { loadClipper, type PlotPoly } from "@/lib/clipper-offset";
import type { Pt } from "@/lib/mesh-export";
import {
  CORE_SIDE,
  FINE_SIDE,
  PIECE_AREA_RATIO,
  assertTiles,
  exposedTabs,
  nestedNeighbors,
  pieceOutline,
} from "@/lib/interlock-geometry";

/**
 * The interlocking ("weave") cutting export: plan, nest, mats, SVG.
 *
 * A second, unrelated fabrication path beside `cut-export.ts`. That one stacks
 * one sheet per colour level and fastens them with folded tab-and-slot joints;
 * this one lays every artwork cell out flat as its own piece
 * (`interlock-geometry.ts`) whose three tabs slide under its neighbours, so the
 * built mosaic is simply the artwork and there is no joinery at all. It is
 * deliberately separate so it can be kept, dropped, or promoted without
 * disturbing the stack export.
 *
 * Two properties shape everything here:
 *
 * **Cut lines are shared.** Neighbouring pieces have the segment between them in
 * common, so it is emitted once (`cutPolylines`). That is what makes a nested
 * sheet single-pass and waste-free — and it is also where the fit comes from: a
 * blade or laser takes its kerf once from between two pieces and both come out
 * slightly undersized, which is the clearance. `clearanceMm` exists only for
 * zero-kerf drag knives and costs the shared line, so it defaults to 0.
 *
 * **Only two shapes exist.** Every up cell's piece is congruent to every other,
 * and every down cell's is that one rotated 180°. So a colour's sheet does not
 * need to be a picture of anything — it only needs the right *count* of each
 * orientation, which is why nesting is free to pack them into a plain tiling
 * block and let the map layers say where they go.
 *
 * Like the other fabrication paths this does **not** run `buildRenderPlan`, and
 * unlike them it does not honour corner rounding — see docs/interlock-export.md
 * for why the shared cut line makes rounding ill-defined here.
 *
 * Pure apart from `loadClipper`: no DOM beyond the canvas the preview is handed.
 */

/** Gap between tiled layers in the output, mm. */
const TILE_GAP_MM = 6;
/** Margin between a nested block and its sheet edge, mm. */
const SHEET_MARGIN_MM = 4;
/** Width of the frame around the top mat's window, world units. Matches the
 *  cut export's `FRAME_MARGIN_SIDES`, so the two mats are the same object. */
const MAT_BORDER = 1.6 * SIDE;
/** How far a backing slot stands outboard of its tab root, world units. */
const SLOT_OUTWARD = 0.06 * SIDE;
/** How far a backing slot runs past its tab root at each end, world units. */
const SLOT_END = 0.04 * SIDE;

export interface InterlockColour {
  /** Encoded `"paletteIdx,colorIdx"`, as stored in `painted`. */
  encoded: string;
  hex: string;
  /** Artwork cell keys of this colour. */
  cells: string[];
  upCount: number;
  downCount: number;
  /** Nested blocks, one per physical sheet. Each is a list of cell keys whose
   *  pieces are laid out contiguously; surplus cells come out as spares. */
  sheets: string[][];
}

export interface InterlockPlan {
  colours: InterlockColour[];
  /** Every painted cell that becomes a piece. */
  cells: string[];
  /** World-space extent of the assembled mosaic, border tabs included. */
  box: Box;
  /** World-space extent of the artwork's own cells — no tabs. The mat is built
   *  round this, and "artwork width" means this, not the tabbed extent. */
  cellBox: Box;
  /** Outer size of both mats, mm. */
  matWidthMm: number;
  matHeightMm: number;
  /** Colour-sheet size actually used, mm — the mat's, unless overridden. */
  sheetWidthMm: number;
  sheetHeightMm: number;
  pieceCount: number;
  /** Pieces cut beyond the count the artwork needs, because a nested block
   *  fills a lattice and the two orientations rarely come out even. */
  spareCount: number;
}

export interface InterlockOptions {
  /** Overall artwork width in mm; sets the scale for everything else. */
  widthMm: number;
  /** Usable cutting area for the colour sheets, mm. Omit to match the mat —
   *  the default, and what you want unless the cardstock is smaller than the
   *  finished piece, which is exactly when you would set it. */
  sheetWidthMm?: number;
  sheetHeightMm?: number;
  /** Extra gap per piece for zero-kerf machines, mm. 0 keeps shared cut lines. */
  clearanceMm?: number;
  backingMat?: boolean;
  topMat?: boolean;
  assemblyMap?: boolean;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Groups the painted cells into per-colour piece counts.
 *
 * Cells whose value does not decode are skipped, which is how `NO_PRINT` and
 * anything else non-colour stays out for free — the documented safe default.
 * They become holes in the mosaic, and `exposedTabs` treats a hole's rim like
 * any other border, so the tabs around it get slots in the backing.
 */
export function planInterlock(
  painted: Record<string, string>,
  options?: Pick<
    InterlockOptions,
    "widthMm" | "sheetWidthMm" | "sheetHeightMm"
  >,
): InterlockPlan | null {
  const byColour = new Map<string, string[]>();
  const cells: string[] = [];
  for (const key in painted) {
    const encoded = painted[key];
    if (!decodeColor(encoded)) continue;
    cells.push(key);
    const list = byColour.get(encoded);
    if (list) list.push(key);
    else byColour.set(encoded, [key]);
  }
  if (cells.length === 0) return null;

  // The one invariant the whole export rests on, and the one that fails
  // silently: a broken tiling still draws, the pieces just do not fit.
  assertTiles(cells);

  const box = artworkBox(cells);
  const cellBox = artworkCellBox(cells);
  const scale = options ? scaleFor(cellBox, options.widthMm) : 0;
  const matWidthMm = (cellBox.maxX - cellBox.minX + 2 * MAT_BORDER) * scale;
  const matHeightMm = (cellBox.maxY - cellBox.minY + 2 * MAT_BORDER) * scale;
  const sheetWidthMm = options?.sheetWidthMm ?? matWidthMm;
  const sheetHeightMm = options?.sheetHeightMm ?? matHeightMm;
  let spareCount = 0;
  const colours: InterlockColour[] = [];
  for (const [encoded, list] of byColour) {
    let upCount = 0;
    let downCount = 0;
    for (const key of list) {
      if (stringToTri(key).type === "up") upCount++;
      else downCount++;
    }
    const sheets =
      options && scale > 0
        ? nestSheets(
            upCount,
            downCount,
            { sheetWidthMm, sheetHeightMm },
            scale,
          )
        : [];
    for (const sheet of sheets) spareCount += sheet.length;
    spareCount -= list.length;
    colours.push({
      encoded,
      hex: resolveColor(encoded),
      cells: list,
      upCount,
      downCount,
      sheets,
    });
  }
  colours.sort((a, b) => b.cells.length - a.cells.length);
  return {
    colours,
    cells,
    box,
    cellBox,
    matWidthMm,
    matHeightMm,
    sheetWidthMm,
    sheetHeightMm,
    pieceCount: cells.length,
    spareCount: Math.max(0, spareCount),
  };
}

/**
 * Extent of the assembled mosaic.
 *
 * From the piece outlines directly, not from `unionOutline` — the union's
 * *boundary* is a walk over every fine cell of every piece, and nothing here
 * wants the boundary, only the box it fits in. Tracing it to measure it cost
 * ~300 ms on a 3,450-piece artwork, three times over, on every settings change.
 */
function artworkBox(cellKeys: string[]): Box {
  const pts: Pt[] = [];
  for (const key of cellKeys) pts.push(...pieceOutline(stringToTri(key)));
  return bbox(pts);
}

/** Extent of the artwork's own cells, with no tabs — what "artwork width"
 *  means, and what the mat is sized around. */
function artworkCellBox(cellKeys: string[]): Box {
  const pts: Pt[] = [];
  for (const key of cellKeys) {
    const t = stringToTri(key);
    pts.push(...(getTriVertices(t.q, t.r, t.type) as Pt[]));
  }
  return bbox(pts);
}

/** mm per world unit, from the artwork's own extent. */
function scaleFor(box: Box, widthMm: number): number {
  return widthMm / (box.maxX - box.minX || 1);
}

// ---------------------------------------------------------------------------
// Nesting
// ---------------------------------------------------------------------------

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bbox(pts: Pt[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

interface NestCandidate {
  key: string;
  box: Box;
}

/**
 * Lattice positions inside one sheet, in reading order.
 *
 * This works in **nest space, not artwork space**, and that distinction is the
 * whole of it. The tiling steps along `Q·(3,−1) + R·(1,2)` in fine coordinates,
 * so its rows are not the artwork's rows and its shear is not the artwork's
 * shear — a window written for the artwork lattice lands somewhere else
 * entirely here and admits nothing. So the sheet rectangle is chosen first, in
 * world units, and the `(Q, R)` range is derived from it by inverting the
 * tiling basis.
 *
 * Ordering is by banded y, then x. Not by raw y: an up piece and the down piece
 * beside it sit at slightly different heights, so exact-y ordering runs every up
 * in a band ahead of every down, and a block then has to overshoot badly on one
 * orientation to collect enough of the other. Banding puts the two back on the
 * same row, which is what keeps the spare count near zero.
 */
function nestCandidates(usableW: number, usableH: number): NestCandidate[] {
  // Tiling basis in world units, read off the placement rather than restated.
  const origin = pieceOutline({ q: 0, r: 0, type: "up" }, "nested")[0];
  const stepQ = pieceOutline({ q: 1, r: 0, type: "up" }, "nested")[0];
  const stepR = pieceOutline({ q: 0, r: 1, type: "up" }, "nested")[0];
  const e1 = { x: stepQ.x - origin.x, y: stepQ.y - origin.y };
  const e2 = { x: stepR.x - origin.x, y: stepR.y - origin.y };
  const det = e1.x * e2.y - e2.x * e1.y;
  if (!det) return [];

  // (Q, R) range covering the sheet rectangle, from its four corners.
  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const [cx, cy] of [
    [0, 0],
    [usableW, 0],
    [0, usableH],
    [usableW, usableH],
  ]) {
    const q = (cx * e2.y - cy * e2.x) / det;
    const r = (cy * e1.x - cx * e1.y) / det;
    minQ = Math.min(minQ, q);
    maxQ = Math.max(maxQ, q);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  }
  const pad = 2;
  const rows: { key: string; box: Box; band: number; x: number }[] = [];
  for (let r = Math.floor(minR) - pad; r <= Math.ceil(maxR) + pad; r++) {
    for (let q = Math.floor(minQ) - pad; q <= Math.ceil(maxQ) + pad; q++) {
      for (const type of ["up", "down"] as const) {
        const tri: TriKey = { q, r, type };
        const box = bbox(pieceOutline(tri, "nested"));
        // Containment, not just "small enough". The block is grown by walking
        // neighbours and stops at the edge of this set, so this filter is the
        // only thing holding a sheet to its size — testing merely that a piece
        // is smaller than the sheet let blocks run clean off the card.
        if (
          box.minX < -1e-6 ||
          box.maxX > usableW + 1e-6 ||
          box.minY < -1e-6 ||
          box.maxY > usableH + 1e-6
        ) {
          continue;
        }
        rows.push({
          key: triToString(tri),
          box,
          band: Math.round((box.minY + box.maxY) / 2 / (H / 2)),
          x: (box.minX + box.maxX) / 2,
        });
      }
    }
  }
  rows.sort((a, b) => a.band - b.band || a.x - b.x);
  return rows.map(({ key, box }) => ({ key, box }));
}

/**
 * Packs `upNeeded` + `downNeeded` pieces into as few sheets as they take.
 *
 * A block is **grown outward from a seed over real tiling adjacency**, not
 * scanned in reading order. Reading order looked right and was not: the tiling's
 * rows are not horizontal bands, so an x-sorted sweep hops between parts of the
 * sheet that do not touch, and blocks came out in fragments with pieces stranded
 * on their own — visible in the file as one loose piece beside the group.
 * Growing from a seed makes contiguity structural: a piece is only ever added
 * because it touches one already placed, so every internal line really is shared
 * and the sheet really does cut in one pass.
 *
 * At each step the frontier is searched for a piece of the orientation still
 * wanted, falling back to any. That is what keeps the overshoot near zero when
 * a colour wants unequal numbers of the two.
 */
export function nestSheets(
  upNeeded: number,
  downNeeded: number,
  options: { sheetWidthMm: number; sheetHeightMm: number },
  scale: number,
): string[][] {
  const usableW = (options.sheetWidthMm - 2 * SHEET_MARGIN_MM) / scale;
  const usableH = (options.sheetHeightMm - 2 * SHEET_MARGIN_MM) / scale;
  if (!(usableW > 0) || !(usableH > 0)) return [];

  const candidates = nestCandidates(usableW, usableH);
  if (candidates.length === 0) return [];
  const order = new Map<string, number>();
  candidates.forEach((c, i) => order.set(c.key, i));

  const sheets: string[][] = [];
  let up = upNeeded;
  let down = downNeeded;
  while (up > 0 || down > 0) {
    // Every sheet restarts from the same seed, because every sheet is a fresh
    // piece of card.
    const block: string[] = [];
    const placed = new Set<string>();
    const frontier = new Set<string>([candidates[0].key]);
    let placedUp = 0;
    let placedDown = 0;

    while (frontier.size > 0 && (placedUp < up || placedDown < down)) {
      const wantUp = placedUp < up;
      const wantDown = placedDown < down;
      let pick: string | null = null;
      let pickRank = Infinity;
      let fallback: string | null = null;
      let fallbackRank = Infinity;
      for (const key of frontier) {
        const rank = order.get(key) ?? Infinity;
        const isUp = stringToTri(key).type === "up";
        if ((isUp && wantUp) || (!isUp && wantDown)) {
          if (rank < pickRank) {
            pick = key;
            pickRank = rank;
          }
        } else if (rank < fallbackRank) {
          fallback = key;
          fallbackRank = rank;
        }
      }
      const key = pick ?? fallback;
      if (!key) break;
      frontier.delete(key);
      placed.add(key);
      block.push(key);
      if (stringToTri(key).type === "up") placedUp++;
      else placedDown++;
      for (const n of nestedNeighbors(stringToTri(key))) {
        const nk = triToString(n);
        if (!placed.has(nk) && order.has(nk)) frontier.add(nk);
      }
    }

    if (block.length === 0) break; // nothing fits at all; give up rather than spin
    sheets.push(block);
    up -= placedUp;
    down -= placedDown;
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// Cut lines
// ---------------------------------------------------------------------------

/**
 * The cut path for a set of pieces: every distinct segment once, chained into
 * as few polylines as the junctions allow.
 *
 * Deduplication is the point. Emitting each piece as its own closed loop would
 * send the machine down every internal seam twice, which on card is the
 * difference between a clean cut and a torn one.
 */
export function cutPolylines(cellKeys: string[]): Pt[][] {
  const segs = new Map<string, [Pt, Pt]>();
  for (const key of cellKeys) {
    const loop = pieceOutline(stringToTri(key), "nested");
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const ka = worldKey(a);
      const kb = worldKey(b);
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!segs.has(id)) segs.set(id, [a, b]);
    }
  }
  return chain([...segs.values()]);
}

/** Greedily walks segments into polylines, extending both ends while a
 *  continuation exists. Three pieces meeting at a vertex leave the choice
 *  ambiguous; any of them is as good as another for a cutter. */
function chain(segs: [Pt, Pt][]): Pt[][] {
  const at = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const k of [worldKey(a), worldKey(b)]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Array<boolean>(segs.length).fill(false);
  const next = (k: string): number => {
    for (const i of at.get(k) ?? []) if (!used[i]) return i;
    return -1;
  };
  const out: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line = [segs[i][0], segs[i][1]];
    for (const end of [1, 0]) {
      for (;;) {
        const tip = end ? line[line.length - 1] : line[0];
        const j = next(worldKey(tip));
        if (j < 0) break;
        used[j] = true;
        const [a, b] = segs[j];
        const far = worldKey(a) === worldKey(tip) ? b : a;
        if (end) line.push(far);
        else line.unshift(far);
      }
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mats
// ---------------------------------------------------------------------------

const toPoly = (loop: Pt[]): PlotPoly => loop.map((p) => [p.x, p.y]);
const toLoop = (poly: PlotPoly): Pt[] => poly.map(([x, y]) => ({ x, y }));

/** The artwork's own plain silhouette — no pieces, no fringe. */
export function cleanOutline(cellKeys: string[]): Pt[][] {
  return traceUnionLoops(cellKeys);
}

export interface InterlockMats {
  /** Outer rectangle, shared by both mats so they register when stacked. */
  frame: Pt[];
  /** Slots cut in the backing, one per exposed tab. Straight cuts, two points. */
  slots: [Pt, Pt][];
  /** The top mat's window: the artwork's plain silhouette. */
  window: Pt[][];
}

/**
 * Builds the two mats. They share an outer rectangle and differ only in what is
 * cut out of it.
 *
 * **The backing is a plain rectangle with nothing in it but slots.** No window,
 * and no silhouette either — the mosaic *rests* on the backing, so any shape cut
 * out of it removes the very paper the pieces sit on. Every tab except the ones
 * on the border is already buried under a neighbouring piece; what the border
 * tabs need is somewhere to go, and that is a slot along the tab's root
 * half-edge, standing a little outboard of it, the same arrangement
 * `cut-joints.ts` uses for a folded tab.
 *
 * **The top mat is the cut export's mat**, unchanged: the same rectangle with
 * the plain silhouette as its window. It needs no inset, because nothing pokes
 * out past that silhouette once the slots have taken the border tabs.
 */
export async function buildMats(
  cellKeys: string[],
  clearance = 0,
): Promise<InterlockMats> {
  const clean = cleanOutline(cellKeys);
  const window =
    clearance > 0
      ? (await loadClipper()).offset(clean.map(toPoly), clearance).map(toLoop)
      : clean;

  const box = bbox(window.flat());
  const frame: Pt[] = [
    { x: box.minX - MAT_BORDER, y: box.minY - MAT_BORDER },
    { x: box.maxX + MAT_BORDER, y: box.minY - MAT_BORDER },
    { x: box.maxX + MAT_BORDER, y: box.maxY + MAT_BORDER },
    { x: box.minX - MAT_BORDER, y: box.maxY + MAT_BORDER },
  ];

  const slots: [Pt, Pt][] = [];
  for (const tab of exposedTabs(cellKeys)) {
    const [a, b] = tab.root;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const ox = tab.normal.x * SLOT_OUTWARD;
    const oy = tab.normal.y * SLOT_OUTWARD;
    slots.push([
      { x: a.x - dx * SLOT_END + ox, y: a.y - dy * SLOT_END + oy },
      { x: b.x + dx * SLOT_END + ox, y: b.y + dy * SLOT_END + oy },
    ]);
  }
  return { frame, slots, window };
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

const fmt = (n: number) => Math.round(n * 1000) / 1000;

interface Tile {
  label: string;
  /** Closed loops drawn as one compound path. `evenOdd` punches the later
   *  loops out of the first — what a mat window needs, and exactly wrong for
   *  overlapping pieces, where it would cancel them against each other. */
  fills?: { loops: Pt[][]; hex: string; evenOdd?: boolean }[];
  /** Open polylines, stroked — the cut path of a nested sheet. */
  lines?: Pt[][];
  /**
   * True for the tiles that describe the artwork itself — the mats and the
   * assembly map. They are measured against one shared box so they stay in
   * register with each other, which is the whole point of having them: a mat
   * window is only checkable by laying it over the map. A nested sheet is not a
   * picture of anything and is measured on its own.
   */
  registered?: boolean;
}

/**
 * Builds the layered SVG: one layer per nested colour sheet, plus the mats and
 * an assembly map. Async because the mat window needs Clipper, which is loaded
 * on demand for the same reason `buildPlotterPlot` is async.
 */
export async function buildInterlockSVG(
  plan: InterlockPlan,
  options: InterlockOptions,
  gridRotation = 0,
): Promise<string | null> {
  const scale = scaleFor(plan.cellBox, options.widthMm);
  if (!(scale > 0)) return null;
  const turn = (p: Pt): Pt => {
    const [x, y] = rotatePoint(p.x, p.y, gridRotation);
    return { x, y };
  };
  const turnAll = (loops: Pt[][]) => loops.map((l) => l.map(turn));

  const tiles: Tile[] = [];
  for (const colour of plan.colours) {
    colour.sheets.forEach((block, i) => {
      const suffix = colour.sheets.length > 1 ? ` ${i + 1}` : "";
      tiles.push({
        label: `Sheet${suffix} — ${colour.hex} (${block.length} pieces)`,
        // Filled per piece *and* stroked as the deduplicated cut path. The
        // fill is how a sheet is identifiable at a glance — which card goes in
        // the machine — and it has to be per piece, because the shared cut path
        // is a set of open polylines and an open polyline has no inside.
        fills: [
          {
            hex: colour.hex,
            loops: turnAll(
              block.map((key) => pieceOutline(stringToTri(key), "nested")),
            ),
          },
        ],
        lines: turnAll(cutPolylines(block)),
      });
    });
  }

  if (options.backingMat || options.topMat) {
    const mats = await buildMats(
      plan.cells,
      (options.clearanceMm ?? 0) / scale,
    );
    if (options.backingMat) {
      tiles.push({
        label: "Backing mat",
        fills: [{ loops: turnAll([mats.frame]), hex: "#888888" }],
        lines: mats.slots.map(([a, b]) => [turn(a), turn(b)]),
        registered: true,
      });
    }
    if (options.topMat) {
      tiles.push({
        label: "Top mat",
        fills: [
          {
            loops: turnAll([mats.frame, ...mats.window]),
            hex: "#888888",
            evenOdd: true,
          },
        ],
        registered: true,
      });
    }
  }

  if (options.assemblyMap !== false) {
    // Whole pieces first, then every cell's plain triangle over the top. That
    // second pass is what hides the tabs — each tab lies inside a neighbouring
    // cell, so the neighbour's core covers it — and it leaves exactly the border
    // tabs showing, which are the ones the backing's slots take.
    const under = plan.colours.map((colour) => ({
      hex: colour.hex,
      loops: turnAll(
        colour.cells.map((key) => pieceOutline(stringToTri(key), "assembled")),
      ),
    }));
    const over = plan.colours.map((colour) => ({
      hex: colour.hex,
      loops: turnAll(
        colour.cells.map((key) => {
          const t = stringToTri(key);
          return getTriVertices(t.q, t.r, t.type) as Pt[];
        }),
      ),
    }));
    tiles.push({
      label: "Assembly map",
      fills: [...under, ...over],
      registered: true,
    });
    // The same pieces spread out on the tiling, so every piece is visible whole
    // and in the right relative place — the view that answers "how many of each
    // do I need, and which goes where", which the assembled one cannot.
    tiles.push({
      label: "Puzzle map",
      fills: plan.colours.map((colour) => ({
        hex: colour.hex,
        loops: turnAll(
          colour.cells.map((key) => pieceOutline(stringToTri(key), "nested")),
        ),
      })),
    });
  }
  if (tiles.length === 0) return null;

  const tilePoints = (tile: Tile): Pt[] => {
    const pts: Pt[] = [];
    for (const f of tile.fills ?? []) for (const l of f.loops) pts.push(...l);
    for (const l of tile.lines ?? []) pts.push(...l);
    return pts;
  };
  const registered = tiles.filter((t) => t.registered).flatMap(tilePoints);
  const sharedBox = registered.length ? bbox(registered) : null;
  const boxes = tiles.map((t) =>
    t.registered && sharedBox ? sharedBox : bbox(tilePoints(t)),
  );

  const tileW = Math.max(...boxes.map((b) => (b.maxX - b.minX) * scale));
  const tileH = Math.max(...boxes.map((b) => (b.maxY - b.minY) * scale));
  const cols = Math.ceil(Math.sqrt(tiles.length));
  const rows = Math.ceil(tiles.length / cols);
  const totalW = cols * tileW + (cols - 1) * TILE_GAP_MM;
  const totalH = rows * tileH + (rows - 1) * TILE_GAP_MM;

  const parts: string[] = [];
  tiles.forEach((tile, i) => {
    const box = boxes[i];
    // Centred in its cell, so a registered pair still lines up: they share a
    // box, so they take the same offset.
    const ox =
      (i % cols) * (tileW + TILE_GAP_MM) +
      (tileW - (box.maxX - box.minX) * scale) / 2;
    const oy =
      Math.floor(i / cols) * (tileH + TILE_GAP_MM) +
      (tileH - (box.maxY - box.minY) * scale) / 2;
    const px = (x: number) => fmt((x - box.minX) * scale + ox);
    const py = (y: number) => fmt((y - box.minY) * scale + oy);
    const path = (loop: Pt[], close: boolean) =>
      loop.map((p, j) => `${j === 0 ? "M" : "L"}${px(p.x)} ${py(p.y)}`).join(" ") +
      (close ? " Z" : "");
    const body: string[] = [];
    for (const f of tile.fills ?? []) {
      const d = f.loops.map((l) => path(l, true)).join(" ");
      body.push(
        `    <path d="${d}" fill="${f.hex}" fill-rule="${
          f.evenOdd ? "evenodd" : "nonzero"
        }" stroke="#000000" stroke-width="0.1"/>`,
      );
    }
    if (tile.lines?.length) {
      const d = tile.lines.map((l) => path(l, false)).join(" ");
      body.push(
        `    <path d="${d}" fill="none" stroke="#000000" stroke-width="0.1"/>`,
      );
    }
    parts.push(
      `  <g inkscape:groupmode="layer" inkscape:label="${xmlEscape(tile.label)}" id="interlock-${i + 1}">\n` +
        body.join("\n") +
        `\n  </g>`,
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${fmt(totalW)}mm" height="${fmt(totalH)}mm" ` +
    `viewBox="0 0 ${fmt(totalW)} ${fmt(totalH)}">\n` +
    parts.join("\n") +
    `\n</svg>\n`
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export type InterlockPreviewMode = "assembled" | "puzzle" | "sheets";

/**
 * Draws the preview.
 *
 * - `assembled` — what it looks like built. Every tab is under a neighbour, so
 *   this is simply the artwork, with the border tabs showing round the outside
 *   because those are the ones with nothing over them. It is the default: the
 *   question the dialog is really being asked is whether the picture survives,
 *   and the answer is that it is untouched.
 * - `puzzle` — the same pieces spread onto the tiling, each one whole and in its
 *   right relative place. This is the one to count from.
 * - `sheets` — the nested cut blocks, as the machine will see them.
 */
export function renderInterlockPreview(
  canvas: HTMLCanvasElement,
  plan: InterlockPlan,
  mode: InterlockPreviewMode,
  w: number,
  h: number,
  gridRotation = 0,
): void {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const turn = (p: Pt): Pt => {
    const [x, y] = rotatePoint(p.x, p.y, gridRotation);
    return { x, y };
  };
  const shapes: { loops: Pt[][]; hex: string | null }[] = [];
  if (mode === "assembled") {
    // Pieces first, cores over the top — the same two passes the assembly map
    // uses, and the same reason: the second pass is what buries the tabs.
    for (const colour of plan.colours)
      for (const key of colour.cells)
        shapes.push({
          loops: [pieceOutline(stringToTri(key), "assembled").map(turn)],
          hex: colour.hex,
        });
    for (const colour of plan.colours)
      for (const key of colour.cells) {
        const t = stringToTri(key);
        shapes.push({
          loops: [(getTriVertices(t.q, t.r, t.type) as Pt[]).map(turn)],
          hex: colour.hex,
        });
      }
  } else if (mode === "puzzle") {
    for (const colour of plan.colours)
      for (const key of colour.cells)
        shapes.push({
          loops: [pieceOutline(stringToTri(key), "nested").map(turn)],
          hex: colour.hex,
        });
  } else {
    let ox = 0;
    for (const colour of plan.colours)
      for (const block of colour.sheets) {
        const fills = block.map((key) =>
          pieceOutline(stringToTri(key), "nested").map(turn),
        );
        const box = bbox(fills.flat());
        const shift = (l: Pt[]) =>
          l.map((p) => ({ x: p.x - box.minX + ox, y: p.y - box.minY }));
        shapes.push({ loops: fills.map(shift), hex: colour.hex });
        ox += box.maxX - box.minX + SIDE;
      }
  }
  if (shapes.length === 0) return;

  const box = bbox(shapes.flatMap((s) => s.loops.flat()));
  const pad = 8;
  const scale = Math.min(
    (w - 2 * pad) / (box.maxX - box.minX || 1),
    (h - 2 * pad) / (box.maxY - box.minY || 1),
  );
  const dx = (w - (box.maxX - box.minX) * scale) / 2 - box.minX * scale;
  const dy = (h - (box.maxY - box.minY) * scale) / 2 - box.minY * scale;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  for (const shape of shapes) {
    ctx.beginPath();
    for (const loop of shape.loops) {
      loop.forEach((p, i) => {
        const x = p.x * scale + dx;
        const y = p.y * scale + dy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    if (shape.hex) {
      ctx.fillStyle = shape.hex;
      ctx.fill();
    }
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

export interface InterlockMetrics {
  /** mm per world unit. */
  scale: number;
  heightMm: number;
  /** Edge of a piece's core triangle, mm. */
  coreMm: number;
  /** Edge of a tab — the smallest feature the machine has to hold, mm. */
  tabMm: number;
  /** Outer size of both mats, mm. */
  matWidthMm: number;
  matHeightMm: number;
  /** Colour-sheet size actually used, mm. */
  sheetWidthMm: number;
  sheetHeightMm: number;
  sheetCount: number;
  /** Card used per cell of picture. The tabs are overlap, not tiling, so a
   *  piece costs 1.75 cells of material for one cell of artwork. */
  areaRatio: number;
}

export function interlockMetrics(
  plan: InterlockPlan,
  options: InterlockOptions,
): InterlockMetrics {
  const scale = scaleFor(plan.cellBox, options.widthMm);
  return {
    scale,
    heightMm: (plan.cellBox.maxY - plan.cellBox.minY) * scale,
    matWidthMm: plan.matWidthMm,
    matHeightMm: plan.matHeightMm,
    sheetWidthMm: plan.sheetWidthMm,
    sheetHeightMm: plan.sheetHeightMm,
    coreMm: CORE_SIDE * scale,
    tabMm: FINE_SIDE * scale,
    sheetCount: plan.colours.reduce((n, c) => n + c.sheets.length, 0),
    areaRatio: PIECE_AREA_RATIO,
  };
}
