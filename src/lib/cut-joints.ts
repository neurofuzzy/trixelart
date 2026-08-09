import {
  H,
  SIDE,
  connectedComponents,
  dirEdgeKey,
  getTriVertices,
  stringToTri,
  triCenter,
  triEdgeNeighbors,
  triToString,
  worldKey,
  type TriKey,
} from "@/lib/grid-math";
import { computeModelTransform, signedArea, type Pt } from "@/lib/mesh-export";
import { cutLayers, type CutFrame } from "@/lib/cut-mesh";
import { boundaryOutDegrees } from "@/lib/cut-svg";
import type { CutPlan } from "@/lib/cut-export";

// ---------------------------------------------------------------------------
// Tab-and-slot joints for the cut stack (see docs/fabrication-export.md §10).
//
// The sheets are nested (S₁ ⊇ … ⊇ S_K), so a fragment of an upper sheet always
// has solid paper beneath it — which is why the default answer is glue. This
// module replaces the glue with a through-fastening: a loose facet grows a tab
// on EVERY boundary edge; each folds down at the lattice edge, passes through a
// line slot cut in the first sheet below that has paper there, and folds flat
// underneath it. The fold under the sheet is what resists lift; the ring of
// tabs around the facet is what resists slide and pivot.
//
// Three facts about the nesting shape the whole design:
//
//  - A tab always reaches into a hole of its OWN sheet. Components are edge
//    connected, so every edge-neighbour of a facet is outside the whole sheet.
//    Nothing can hide the tab, which is why it is a fraction of a cell wide.
//  - It descends through the sheets between, for free. Those sheets have no
//    paper at that cell either — that is exactly why they are not the host —
//    so the tab passes through an opening that already exists. Only the host
//    needs cutting.
//  - Where the sheet below is also missing paper there, it has a tab on that
//    same lattice edge, aimed at the same host. **They share one slot.** A line
//    slot admits any number of tabs, so sharing costs nothing.
//  - Two facet cells can face the SAME hole, and their tabs would then be cut
//    out of the same paper. `MAX_TAB_REACH` keeps every tab inside the one cell
//    it reaches into, which makes "one tab per cell reached into" exactly the
//    right rule — not a margin, a proof. The second edge onto a hole is
//    redundant anyway: both tabs would pin the facet through the same opening.
//
// Every boundary edge of every loose facet on every example measured has paper
// on some sheet below it — so with the drop free to find its host, "a tab on
// every edge" is literally achievable, and the only thing that turns an edge
// down is the tab no longer fitting the cell it reaches into.
// ---------------------------------------------------------------------------

/** Tab width at the fold line, world units. */
const TAB_ROOT = 0.4 * SIDE;
/**
 * Tab width at its outer tip — **narrower** than the root, so the tab tapers
 * into the slot and guides itself in. A dovetail (wider at the tip) is what a
 * part slid in sideways wants; a tab dropped straight down a slot only has to
 * find the opening.
 */
const TAB_TIP = 0.3 * SIDE;
/** The length that folds flat underneath the host sheet, world units. */
const TAB_TONGUE = 0.22 * H;
/** Paper left either side of a tab inside the cell it reaches into. */
const TAB_SIDE_MARGIN = 0.04 * SIDE;

/**
 * Physical material thickness. Not `sheetThicknessMm`, which is the preview's
 * deliberately fat slab — this is what the tab actually has to climb down, and
 * using the preview value would draw risers an order of magnitude too long.
 */
const CUT_MATERIAL_MM = 0.3;

/** How far a slot runs past the tab at each end, so insertion is not a fight. */
const SLOT_END = 0.06 * SIDE;
/**
 * How far outside the lattice edge the slot sits, in material thicknesses.
 * Folded paper does not turn on a zero radius: the descending riser stands a
 * little outboard of its fold line, and the slot has to meet it there.
 */
const SLOT_OUTWARD = 0.5;
/** Slot width used **only by the 3D preview** — see `slotRect`. */
const SLOT_PREVIEW_WIDTH = 0.6;

/**
 * The furthest a tab may reach from its fold line — riser plus tongue — and
 * still sit inside the one cell it reaches into, with `TAB_SIDE_MARGIN` either
 * side. Read off the triangle's half-width curve, `SIDE·(1 − d/H)/2`, so
 * retuning the tab cannot quietly push it out through the side of the cell.
 */
const MAX_TAB_REACH = H * (1 - (TAB_TIP + 2 * TAB_SIDE_MARGIN) / SIDE);

/** The joints on one sheet, keyed to that sheet's index in `cutLayers`. */
export interface SheetJoints {
  /** Directed boundary-edge key → the tab outline to splice into that edge.
   *  Keyed by `dirEdgeKey`, which is exactly how the boundary walk names its
   *  edges, so the splice needs no geometric search. */
  tabs: Map<string, Pt[]>;
  /** Fold lines to score, not cut: each tab contributes its root and the top
   *  of its riser. */
  folds: [Pt, Pt][];
  /** Slots cut in **this** sheet, as the two endpoints of a cut line. */
  slots: [Pt, Pt][];
  /** The same slots as thin closed rectangles, for the 3D preview alone. */
  slotRects: Pt[][];
}

export interface CutJoints {
  /** Parallel to `cutLayers`' output — index i is that layer's joints. */
  perLayer: SheetJoints[];
  /** Tabs placed. */
  count: number;
  /** Slots cut. Fewer than `count` wherever two sheets share one. */
  slotCount: number;
  /** Facets no tab could be placed on; these still need glue. */
  unanchored: { level: number; cells: number }[];
  /** Narrowest strip of paper the slots leave, in mm at this export width. */
  minFeatureMm: number;
}

/** The triangle's vertices in the same winding `boundaryEdges` forces, so the
 *  directed edges named here are the ones the boundary walk will emit. */
function orientedVerts(t: TriKey): Pt[] {
  const v = getTriVertices(t.q, t.r, t.type) as Pt[];
  return signedArea(v) < 0 ? [v[0], v[2], v[1]] : v;
}

/** The edge-neighbour of `t` across the edge a→b, or null. */
function neighbourAcross(t: TriKey, a: Pt, b: Pt): TriKey | null {
  const ak = worldKey(a);
  const bk = worldKey(b);
  // Sharing two of three vertices is the definition of "across this edge".
  for (const n of triEdgeNeighbors(t)) {
    const vs = getTriVertices(n.q, n.r, n.type).map(worldKey);
    if (vs.includes(ak) && vs.includes(bk)) return n;
  }
  return null;
}

/** A local frame on the boundary edge a→b of cell `t`: along, and outward. */
function edgeFrame(t: TriKey, a: Pt, b: Pt) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ex = (b.x - a.x) / len;
  const ey = (b.y - a.y) / len;
  // Outward = away from the cell the tab belongs to. Taken from the centroid
  // rather than from the winding, so it cannot be wrong-footed by whichever
  // orientation `orientedVerts` settled on.
  const c = triCenter(t.q, t.r, t.type);
  let nx = -ey;
  let ny = ex;
  if ((mid.x - c.x) * nx + (mid.y - c.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const at = (along: number, out: number): Pt => ({
    x: mid.x + ex * along + nx * out,
    y: mid.y + ey * along + ny * out,
  });
  return { at, len };
}

/**
 * The tab as it is cut, flat: root on the lattice edge, a **riser** as long as
 * the drop, then the tongue that folds flat under the host. The riser is what
 * crosses the sheets; leaving it out makes every tab short by exactly the
 * material it has to pass through, which is the whole reason the fold is a
 * fold. Ordered along a→b, so splicing between a and b keeps the loop
 * consistent.
 */
function tabOutline(at: (along: number, out: number) => Pt, drop: number): Pt[] {
  const root = TAB_ROOT / 2;
  const tip = TAB_TIP / 2;
  return [
    at(-root, 0),
    at(-root, drop),
    at(-tip, drop + TAB_TONGUE),
    at(tip, drop + TAB_TONGUE),
    at(root, drop),
    at(root, 0),
  ];
}

/**
 * The slot is a **line**, not a pocket. The tab passes through it edge-on and
 * folds flat underneath, so what the slot needs is length — a little more than
 * the tab is wide — and no width at all: cardstock flexes to admit the paper.
 * Cutting a rectangle instead would remove a chip of the host sheet and leave
 * the tab rattling in a window, which is what the first version did.
 */
function slotLine(
  at: (along: number, out: number) => Pt,
  matWorld: number,
): [Pt, Pt] {
  const half = TAB_ROOT / 2 + SLOT_END;
  const out = SLOT_OUTWARD * matWorld;
  return [at(-half, out), at(half, out)];
}

/**
 * The same slot given a width, for the 3D preview only. A zero-width cut is
 * invisible in a solid, and the preview's job here is to show *where* the tab
 * goes through — so it is drawn as a thin opening. The file keeps the line.
 */
function slotRect(
  at: (along: number, out: number) => Pt,
  matWorld: number,
): Pt[] {
  const half = TAB_ROOT / 2 + SLOT_END;
  const out = SLOT_OUTWARD * matWorld;
  const w = (SLOT_PREVIEW_WIDTH * matWorld) / 2;
  const rect = [
    at(-half, out - w),
    at(-half, out + w),
    at(half, out + w),
    at(half, out - w),
  ];
  // Holes wind negative; `triangulateLoops` reads that, not containment.
  return signedArea(rect) > 0 ? rect.reverse() : rect;
}

/** Undirected name for a lattice edge, so the two sheets that both tab across
 *  it agree on which slot they are asking for. */
function slotKey(host: number, a: Pt, b: Pt): string {
  const ak = worldKey(a);
  const bk = worldKey(b);
  return `${host}|${ak < bk ? `${ak}~${bk}` : `${bk}~${ak}`}`;
}

export interface CutJointOptions {
  frame: CutFrame;
  /** Overall design width in mm. Sets the world-units-per-mm scale, which is
   *  what decides how far a tab has to reach to cross a sheet — and therefore
   *  whether the reach still fits the cell it reaches into. */
  widthMm: number;
  /** Whether the tiny-hexagon necks are on; their pinch vertices are avoided. */
  mergeIslands?: boolean;
  /** The neck radius in world units, so that avoidance can be measured rather
   *  than assumed: a small neck and a tab coexist on the same edge quite
   *  happily, and rejecting every pinched edge outright loses most of them. */
  neck?: number;
  gridRotation?: number;
}

/** One tab, before its slot has been pooled with anyone else's. */
interface PendingSlot {
  host: number;
  at: (along: number, out: number) => Pt;
}

/**
 * Plans every tab and slot for a cut.
 *
 * Which facets get tabs follows the physical question "is this piece already
 * held?": with a mat, every colour sheet carries the frame, so the component
 * containing the frame is anchored and every other component is loose. Without
 * one, the largest component of a sheet is the piece and the rest are loose.
 *
 * **Every boundary edge of a loose facet gets a tab.** Choosing a few good
 * positions was the wrong problem: one tab is a pivot, two are a hinge, and a
 * facet of a single cell on one tab simply lifts. A tab on every edge needs no
 * scoring, no sampling and no count heuristic — the rule is the whole algorithm.
 *
 * Computed once and handed to *both* builders, the way `planCut` already is —
 * the preview and the file must place identical joints or the preview is a lie.
 */
export function planCutJoints(
  plan: CutPlan,
  painted: Record<string, string>,
  options: CutJointOptions,
): CutJoints {
  const { layers } = cutLayers(plan, painted, options.frame);
  const perLayer: SheetJoints[] = layers.map(() => ({
    tabs: new Map<string, Pt[]>(),
    folds: [],
    slots: [],
    slotRects: [],
  }));
  const unanchored: { level: number; cells: number }[] = [];
  let count = 0;

  const transform = computeModelTransform(
    painted,
    options.widthMm,
    options.gridRotation ?? 0,
  );
  const scale = transform?.scale ?? 0;
  if (!transform || scale <= 0) {
    return { perLayer, count, slotCount: 0, unanchored, minFeatureMm: 0 };
  }

  const cellSets = layers.map((l) => new Set(l.keys));
  const frameSet = new Set(
    options.frame === "mat" ? layers.find((l) => l.isFrame)?.keys ?? [] : [],
  );
  const pinched = options.mergeIslands
    ? layers.map((l) => boundaryOutDegrees(l.keys))
    : null;
  // Material thickness in world units: the tab is drawn on the lattice, but how
  // far it has to reach down is a fact about the cardstock, not the drawing.
  const matWorld = CUT_MATERIAL_MM / scale;
  const maxDrop = MAX_TAB_REACH - TAB_TONGUE;
  // Two sheets tabbing across the same lattice edge want the same slot, and
  // they are not visited together — so slots are pooled by edge and cut after.
  const pending = new Map<string, PendingSlot>();
  // One tab per hole per sheet. Two tabs reaching into the same cell overlap in
  // the flat pattern and would be cut from the same paper.
  const taken = layers.map(() => new Set<string>());

  layers.forEach((layer, i) => {
    if (layer.isFrame) return;
    const components = connectedComponents(layer.keys);
    if (components.length <= 1) return;

    let anchored = -1;
    if (frameSet.size > 0) {
      anchored = components.findIndex((c) => c.some((k) => frameSet.has(k)));
    }
    if (anchored < 0) {
      // No mat (or, defensively, no frame cell landed in any component): the
      // largest piece is the one everything else has to hold onto.
      anchored = components.reduce(
        (best, c, idx) => (c.length > components[best].length ? idx : best),
        0,
      );
    }

    components.forEach((comp, idx) => {
      if (idx === anchored) return;
      const facet = new Set(comp);
      let placed = 0;

      for (const key of facet) {
        const t = stringToTri(key);
        const verts = orientedVerts(t);
        for (let e = 0; e < 3; e++) {
          const a = verts[e];
          const b = verts[(e + 1) % 3];
          const n = neighbourAcross(t, a, b);
          if (!n) continue;
          const nk = triToString(n);
          if (facet.has(nk)) continue; // interior edge
          if (taken[i].has(nk)) continue; // that hole already has a tab in it

          // The first sheet below with paper under that cell. The ones in
          // between have none either, so the tab passes through openings that
          // already exist and only this one needs a slot.
          let host = -1;
          for (let j = i - 1; j >= 0; j--) {
            if (cellSets[j].has(nk)) {
              host = j;
              break;
            }
          }
          if (host < 0) continue;

          const drop = (i - host) * matWorld;
          if (drop > maxDrop) continue;

          const { at, len } = edgeFrame(t, a, b);
          // A neck hexagon replaces the pinch vertex and reaches `neck` along
          // the edge (clamped to 45% of it); the tab root sits half a root
          // width in from the midpoint. Where those overlap, the boundary
          // would cross itself.
          if (pinched) {
            const reach = Math.min(options.neck ?? 0, len * 0.45);
            if (
              reach >= len / 2 - TAB_ROOT / 2 &&
              ((pinched[i].get(worldKey(a)) ?? 0) > 1 ||
                (pinched[i].get(worldKey(b)) ?? 0) > 1)
            )
              continue;
          }

          taken[i].add(nk);
          perLayer[i].tabs.set(dirEdgeKey(a, b), tabOutline(at, drop));
          perLayer[i].folds.push([at(-TAB_ROOT / 2, 0), at(TAB_ROOT / 2, 0)]);
          perLayer[i].folds.push([
            at(-TAB_ROOT / 2, drop),
            at(TAB_ROOT / 2, drop),
          ]);
          // Keyed undirected, so the sheet below tabbing across the same edge
          // finds this entry instead of asking for a second slot.
          const sk = slotKey(host, a, b);
          if (!pending.has(sk)) pending.set(sk, { host, at });
          count++;
          placed++;
        }
      }

      if (placed === 0) {
        unanchored.push({ level: layer.level, cells: comp.length });
      }
    });
  });

  for (const { host, at } of pending.values()) {
    perLayer[host].slots.push(slotLine(at, matWorld));
    perLayer[host].slotRects.push(slotRect(at, matWorld));
  }

  return {
    perLayer,
    count,
    slotCount: pending.size,
    unanchored,
    // The paper left at each end of a slot, between it and the cell corner —
    // the narrowest thing the slots ask the machine to hold. The slot itself is
    // a line, so it has no width to be too small.
    minFeatureMm:
      pending.size > 0 ? (SIDE / 2 - (TAB_ROOT / 2 + SLOT_END)) * scale : 0,
  };
}
