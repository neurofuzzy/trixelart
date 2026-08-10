import {
  H,
  SIDE,
  stringToTri,
  triToString,
  worldToTri,
  type TriKey,
  type TriType,
} from "@/lib/grid-math";
import { traceUnionLoops } from "@/lib/cut-svg";
import type { Pt } from "@/lib/mesh-export";

/**
 * The interlocking ("weave") tile: the geometry behind the interlock export.
 *
 * Every artwork cell becomes **one flat piece** — the cell's own triangle, with
 * three half-size triangles protruding, one per edge, each on one half of that
 * edge, in a pinwheel. See docs/interlock-export.md.
 *
 * ## The tabs are hidden, and that is the whole idea
 *
 * A piece's core is the artwork cell at **full size**, and its three tabs reach
 * out **under** the three neighbouring pieces. Each cell therefore covers the
 * three tabs reaching into it — one per edge, landing on its three corner
 * sub-triangles — with its own core. So the assembled mosaic shows nothing but
 * the artwork: no seams in the wrong place, no pinwheels, no rotation. The tabs
 * exist only to stop the pieces sliding apart, and they are never seen.
 *
 * The cost is material, not looks: a piece is `1.75` cells of card for one cell
 * of picture, because the tabs are overlap rather than tiling.
 *
 * ## Two placements
 *
 * The same shape is laid down two different ways, and confusing them is the
 * mistake this comment exists to prevent.
 *
 * - **`"assembled"`** — the core sits exactly on its artwork cell. Pieces
 *   overlap. This is what the thing looks like when built, and what the assembly
 *   map and the mats are measured against.
 * - **`"nested"`** — the packing used on the cut sheet, where the pieces
 *   *tile*: no overlap, no gaps, every internal line shared with a neighbour, so
 *   a sheet cuts in one pass with nothing to weed. That tiling is not the
 *   artwork's lattice. A triangle with three half-tabs has the area of `7`
 *   half-cells, and `7` is a norm in the triangular lattice, so the pieces tile
 *   a `√7`-scaled, `19.1066°`-rotated copy of the half-cell lattice — which is
 *   why a nested sheet looks like a twisted pinwheel mosaic and the assembled
 *   artwork does not.
 *
 * Both placements are pure translations of the same two template outlines, so
 * `pieceOutline` traces twice in the life of the module and then only adds.
 *
 * ## Working on the fine lattice
 *
 * The tile is built on a **fine lattice** — the ordinary lattice at half scale,
 * no rotation — where the core is a side-2 triangle and each tab is one cell.
 * Being an ordinary lattice, none of the machinery needs a second version: fine
 * cells are ordinary `TriKey`s, they go through the ordinary `traceUnionLoops`,
 * and only the points that come back are halved. Reaching for a second boundary
 * tracer here is the wrong move.
 *
 * Pure: no DOM, no React.
 */

/** Edge length of a tab — the smallest feature — in world units. */
export const FINE_SIDE = SIDE / 2;

/** Edge length of a piece's core: the artwork cell itself. */
export const CORE_SIDE = SIDE;

/** Card area a piece costs, as a multiple of the cell it shows. */
export const PIECE_AREA_RATIO = 7 / 4;

/** Fine cells in one piece — 4 core + 3 tabs. */
export const CELLS_PER_PIECE = 7;

interface FineCell {
  q: number;
  r: number;
  type: TriType;
}

/**
 * The piece for an **up** cell, as fine cells relative to the piece's fine base.
 * The first four are the core — they trace as one plain triangle, with no
 * internal line — and the last three are the tabs.
 */
export const UP_TEMPLATE: readonly FineCell[] = [
  { q: 0, r: 0, type: "up" },
  { q: 0, r: 0, type: "down" },
  { q: 1, r: 0, type: "up" },
  { q: 0, r: 1, type: "up" },
  { q: 0, r: -1, type: "down" },
  { q: 1, r: 0, type: "down" },
  { q: -1, r: 1, type: "down" },
];

/** The piece for a **down** cell: `UP_TEMPLATE` rotated 180°. */
export const DOWN_TEMPLATE: readonly FineCell[] = [
  { q: 0, r: 0, type: "up" },
  { q: 0, r: 0, type: "down" },
  { q: -1, r: 0, type: "down" },
  { q: 0, r: -1, type: "down" },
  { q: -1, r: 0, type: "up" },
  { q: 0, r: 1, type: "up" },
  { q: 1, r: -1, type: "up" },
];

const CORE_CELLS = 4;

/** Extra fine step that lands a down piece's core on its own cell. */
const ASSEMBLED_DOWN_OFFSET = { a: 1, b: 1 } as const;

/**
 * Extra fine step for a down piece in the nested tiling.
 *
 * Only defined modulo the tiling lattice — every choice tiles — so it is picked
 * to keep a nested block compact.
 */
const NESTED_DOWN_OFFSET = { a: 3, b: 1 } as const;

export type Placement = "assembled" | "nested";

/** Maps a point from the fine lattice's own space into world space. */
export function fineToWorld(p: Pt): Pt {
  return { x: p.x / 2, y: p.y / 2 };
}

/** World-space translation of the fine base `(a, b)`. */
function fineOffset(a: number, b: number): Pt {
  return { x: (a * SIDE + b * (SIDE / 2)) / 2, y: (b * H) / 2 };
}

/**
 * The fine base a cell's piece is built from.
 *
 * Assembled, `(2q, 2r)` is just the cell's own corner at half-lattice scale, so
 * the core lands on the cell exactly. Nested, `(3q + r, −q + 2r)` steps along the
 * `√7` sublattice the pieces tile.
 */
function pieceBase(tri: TriKey, placement: Placement): { a: number; b: number } {
  if (placement === "assembled") {
    const a = 2 * tri.q;
    const b = 2 * tri.r;
    return tri.type === "up"
      ? { a, b }
      : { a: a + ASSEMBLED_DOWN_OFFSET.a, b: b + ASSEMBLED_DOWN_OFFSET.b };
  }
  const a = 3 * tri.q + tri.r;
  const b = -tri.q + 2 * tri.r;
  return tri.type === "up"
    ? { a, b }
    : { a: a + NESTED_DOWN_OFFSET.a, b: b + NESTED_DOWN_OFFSET.b };
}

/** The seven fine cells making up one artwork cell's piece. */
export function pieceFineCells(
  tri: TriKey,
  placement: Placement = "assembled",
): TriKey[] {
  const { a, b } = pieceBase(tri, placement);
  const template = tri.type === "up" ? UP_TEMPLATE : DOWN_TEMPLATE;
  return template.map((c) => ({ q: c.q + a, r: c.r + b, type: c.type }));
}

/** `pieceFineCells` as storage keys. */
export function pieceFineKeys(
  tri: TriKey,
  placement: Placement = "assembled",
): string[] {
  return pieceFineCells(tri, placement).map(triToString);
}

/** Traces fine cells into closed loops in world space. */
function traceFine(fineKeys: string[]): Pt[][] {
  return traceUnionLoops(fineKeys).map((loop) => loop.map(fineToWorld));
}

/** One tab, in world coordinates relative to its piece's fine base. */
export interface TabTemplate {
  /** The half-edge of the core the tab stands on. */
  root: [Pt, Pt];
  /** Outward unit normal of `root`. */
  normal: Pt;
  /** Step from the owning cell to the cell this tab reaches under. */
  into: { dq: number; dr: number; type: TriType };
}

interface PieceTemplate {
  outline: Pt[];
  tabs: TabTemplate[];
}

let templates: Record<TriType, PieceTemplate> | null = null;

function buildTemplate(type: TriType): PieceTemplate {
  const template = type === "up" ? UP_TEMPLATE : DOWN_TEMPLATE;
  const keys = template.map((c) => triToString(c as TriKey));
  const outline = traceFine(keys)[0] ?? [];

  // A tab's root is the one edge it shares with the core. Found by matching
  // endpoints rather than by index: the templates are written as cell lists, and
  // a hand-maintained edge table beside them would be one more thing to keep in
  // step.
  const coreEdges = new Set<string>();
  const edgeKey = (a: Pt, b: Pt) => {
    const ka = `${Math.round(a.x * 1000)},${Math.round(a.y * 1000)}`;
    const kb = `${Math.round(b.x * 1000)},${Math.round(b.y * 1000)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const cellPts = (c: FineCell): Pt[] => {
    const bx = c.q * SIDE + c.r * (SIDE / 2);
    const by = c.r * H;
    const raw: Pt[] =
      c.type === "up"
        ? [
            { x: bx, y: by },
            { x: bx + SIDE, y: by },
            { x: bx + SIDE / 2, y: by + H },
          ]
        : [
            { x: bx + SIDE / 2, y: by + H },
            { x: bx + SIDE * 1.5, y: by + H },
            { x: bx + SIDE, y: by },
          ];
    return raw.map(fineToWorld);
  };
  for (let i = 0; i < CORE_CELLS; i++) {
    const v = cellPts(template[i]);
    for (let k = 0; k < 3; k++) coreEdges.add(edgeKey(v[k], v[(k + 1) % 3]));
  }

  // Template geometry is held at fine base (0, 0), but a tab's reach has to be
  // named against the *cell* the piece stands on — and for a down piece those
  // differ by `ASSEMBLED_DOWN_OFFSET`. Probing without this shift named two of
  // the down piece's three tabs after cells that are not even adjacent.
  const own: TriKey = { q: 0, r: 0, type };
  const seat = pieceBase(own, "assembled");
  const delta = fineOffset(seat.a, seat.b);

  const tabs: TabTemplate[] = [];
  for (let i = CORE_CELLS; i < template.length; i++) {
    const v = cellPts(template[i]);
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      if (!coreEdges.has(edgeKey(a, b))) continue;
      // Outward from the core: the tab's third vertex is on the far side.
      const apex = v[(k + 2) % 3];
      let nx = -(b.y - a.y);
      let ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if ((apex.x - mx) * nx + (apex.y - my) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      // One tab-height out from the root centre is inside the cell the tab
      // reaches under, which names that cell as a step from this one.
      const probe = worldToTri(
        mx + nx * (H / 4) + delta.x,
        my + ny * (H / 4) + delta.y,
      );
      tabs.push({
        root: [a, b],
        normal: { x: nx, y: ny },
        into: {
          dq: probe.q - own.q,
          dr: probe.r - own.r,
          type: probe.type,
        },
      });
      break;
    }
  }
  return { outline, tabs };
}

function pieceTemplate(type: TriType): PieceTemplate {
  if (!templates) {
    templates = { up: buildTemplate("up"), down: buildTemplate("down") };
  }
  return templates[type];
}

/**
 * The outline of a single piece — nine segments, no internal lines.
 *
 * Both placements are translations of the template, because both fine bases are
 * integer combinations of the artwork lattice's own basis vectors. Nesting asks
 * for thousands of these, and tracing each one was the slow part of the export.
 */
export function pieceOutline(
  tri: TriKey,
  placement: Placement = "assembled",
): Pt[] {
  const { a, b } = pieceBase(tri, placement);
  const d = fineOffset(a, b);
  return pieceTemplate(tri.type).outline.map((p) => ({
    x: p.x + d.x,
    y: p.y + d.y,
  }));
}

/** One placed tab: its root half-edge, its outward normal, and the cell it
 *  reaches under (which may not be painted — those are the exposed ones). */
export interface PlacedTab {
  root: [Pt, Pt];
  normal: Pt;
  into: TriKey;
}

/** The three tabs of an assembled piece. */
export function pieceTabs(tri: TriKey): PlacedTab[] {
  const { a, b } = pieceBase(tri, "assembled");
  const d = fineOffset(a, b);
  return pieceTemplate(tri.type).tabs.map((t) => ({
    root: [
      { x: t.root[0].x + d.x, y: t.root[0].y + d.y },
      { x: t.root[1].x + d.x, y: t.root[1].y + d.y },
    ],
    normal: t.normal,
    into: { q: tri.q + t.into.dq, r: tri.r + t.into.dr, type: t.into.type },
  }));
}

/**
 * Tabs with no piece over them: the ones on the artwork's border, reaching into
 * a cell nobody painted. These are the ones the backing has to swallow, and the
 * only ones that would otherwise be visible.
 */
export function exposedTabs(cellKeys: string[]): PlacedTab[] {
  const painted = new Set(cellKeys);
  const out: PlacedTab[] = [];
  for (const key of cellKeys) {
    for (const tab of pieceTabs(stringToTri(key))) {
      if (!painted.has(triToString(tab.into))) out.push(tab);
    }
  }
  return out;
}

/** Closed loops bounding a set of pieces, in world space. */
export function unionOutline(
  cellKeys: string[],
  placement: Placement = "assembled",
): Pt[][] {
  const fine: string[] = [];
  for (const key of cellKeys) {
    fine.push(...pieceFineKeys(stringToTri(key), placement));
  }
  return traceFine(fine);
}

/**
 * Throws if the **nested** pieces overlap or come up short.
 *
 * The nesting rests on the pieces tiling exactly, and a broken tiling is silent:
 * the SVG still draws, the pieces just do not fit together, which is only
 * discoverable after cutting. Assembled pieces overlap on purpose, so this says
 * nothing about them.
 */
export function assertTiles(cellKeys: string[]): void {
  const seen = new Set<string>();
  for (const key of cellKeys) {
    for (const fine of pieceFineKeys(stringToTri(key), "nested")) {
      if (seen.has(fine)) {
        throw new Error(`interlock: nested pieces overlap at ${fine}`);
      }
      seen.add(fine);
    }
  }
  if (seen.size !== cellKeys.length * CELLS_PER_PIECE) {
    throw new Error(
      `interlock: expected ${cellKeys.length * CELLS_PER_PIECE} fine cells, got ${seen.size}`,
    );
  }
}
