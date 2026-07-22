import { countComponents } from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Trixel art → layered-papercraft cut plan (see docs/fabrication-export.md §2–3).
//
// A cut is a stack of single-color cardstock sheets. Each color gets a stacking
// level 1..K (1 = bottom). The physical sheet at level i is the union of every
// color at level ≥ i (rule B: a lower layer backs everything above it):
//
//     Sᵢ = ⋃ { V_c : level(c) ≥ i }        S₁ ⊇ S₂ ⊇ … ⊇ S_K
//
// Every ordering reproduces the picture identically; the permutation only
// affects manufacturability (islands). We pick the order with the fewest
// islands, tie-broken by least layered paper. Pure set arithmetic — no
// geometry, no CSG. Holes are simply absent triangles in a sheet's set.
// ---------------------------------------------------------------------------

/** Above this color count, K! is too large to brute-force; fall back to the
 *  paper-cost heuristic (largest-area colors on the bottom). The default
 *  grayscale palette is K=5, so this is only a safety valve. */
export const MAX_EXHAUSTIVE_COLORS = 8;

/** One physical cardstock sheet in the stack. */
export interface CutSheet {
  /** Stacking level, 1 = bottom (full silhouette) … K = top. */
  level: number;
  /** Encoded palette key of the color introduced at this level (its cardstock). */
  colorKey: string;
  /** Resolved cardstock color (= the art color, MVP). "#rrggbb". */
  colorHex: string;
  /** Sᵢ: every triangle at this level and above. Absent triangles = holes. */
  triangles: string[];
  /** Edge-connected components of `triangles`; >1 ⇒ loose/glued islands. */
  componentCount: number;
}

export interface CutPlan {
  /** Sheets bottom → top (level 1 … K). */
  sheets: CutSheet[];
  /** Color keys bottom → top (order[i] is the color at level i+1). */
  order: string[];
  /** Total islands Σᵢ (componentCount − 1); 0 = every sheet is one piece. */
  islands: number;
  /** Number of colors / sheets (K). */
  colorCount: number;
  /** True if the optimal K! search ran; false if the heuristic fallback was used. */
  exhaustive: boolean;
}

/**
 * Flattens editing layers into a single painted grid, honoring visibility and
 * top-over-bottom occlusion (later layers win, matching render order).
 */
export function flattenPainted(
  layers: { painted: Record<string, string>; visible: boolean }[],
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const key in layer.painted) flat[key] = layer.painted[key];
  }
  return flat;
}

/** Groups painted triangles by color key. Each V_c is a set of `triToString` keys. */
function groupByColor(painted: Record<string, string>): Map<string, string[]> {
  const byColor = new Map<string, string[]>();
  for (const key in painted) {
    const colorKey = painted[key];
    const list = byColor.get(colorKey);
    if (list) list.push(key);
    else byColor.set(colorKey, [key]);
  }
  return byColor;
}

/**
 * Scores one bottom→top ordering: total islands and layered paper cost.
 * Sheets are nested, so we accumulate the cumulative union top-down
 * (Sⱼ = Sⱼ₊₁ ∪ V_c). Paper cost = Σ_c area(c)·level(c); since every triangle
 * has equal area, area(c) = |V_c|.
 */
function scoreOrder(
  order: string[],
  byColor: Map<string, string[]>,
): { islands: number; paperCost: number } {
  let acc: string[] = [];
  let islands = 0;
  let paperCost = 0;
  for (let j = order.length - 1; j >= 0; j--) {
    const tris = byColor.get(order[j]) as string[];
    acc = acc.concat(tris); // V_c are disjoint → no duplicates
    islands += countComponents(acc) - 1;
    paperCost += tris.length * (j + 1);
  }
  return { islands, paperCost };
}

/** Builds the full sheet stack for a chosen bottom→top ordering. */
function buildSheets(
  order: string[],
  byColor: Map<string, string[]>,
): { sheets: CutSheet[]; islands: number } {
  const K = order.length;
  const sheets: CutSheet[] = new Array(K);
  let acc: string[] = [];
  let islands = 0;
  for (let j = K - 1; j >= 0; j--) {
    const colorKey = order[j];
    acc = acc.concat(byColor.get(colorKey) as string[]);
    const componentCount = countComponents(acc);
    islands += componentCount - 1;
    sheets[j] = {
      level: j + 1,
      colorKey,
      colorHex: resolveColor(colorKey),
      triangles: acc.slice(),
      componentCount,
    };
  }
  return { sheets, islands };
}

/** Invokes `cb` with every permutation of `items` (Heap's algorithm). */
function forEachPermutation(items: string[], cb: (perm: string[]) => void): void {
  const n = items.length;
  const a = items.slice();
  const c = new Array(n).fill(0);
  cb(a.slice());
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      if (i % 2 === 0) [a[0], a[i]] = [a[i], a[0]];
      else [a[c[i]], a[i]] = [a[i], a[c[i]]];
      cb(a.slice());
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

/**
 * Computes the fewest-islands cut plan for a painted grid.
 *
 * Exhaustively searches all K! level assignments (colors are few), scoring by
 * islands then paper cost. For K > `MAX_EXHAUSTIVE_COLORS`, falls back to the
 * paper-cost-optimal heuristic (largest-area colors on the bottom).
 *
 * Returns null if nothing is painted.
 */
export function planCut(painted: Record<string, string>): CutPlan | null {
  const byColor = groupByColor(painted);
  const colors = [...byColor.keys()];
  const K = colors.length;
  if (K === 0) return null;

  let bestOrder: string[];
  let exhaustive: boolean;

  if (K <= MAX_EXHAUSTIVE_COLORS) {
    exhaustive = true;
    bestOrder = colors;
    let bestIslands = Infinity;
    let bestPaper = Infinity;
    forEachPermutation(colors, (perm) => {
      const { islands, paperCost } = scoreOrder(perm, byColor);
      if (
        islands < bestIslands ||
        (islands === bestIslands && paperCost < bestPaper)
      ) {
        bestIslands = islands;
        bestPaper = paperCost;
        bestOrder = perm;
      }
    });
  } else {
    // Heuristic: largest-area colors on the bottom minimizes paper exactly and
    // tends to bury the connective background (usually few islands).
    exhaustive = false;
    bestOrder = [...colors].sort(
      (a, b) =>
        (byColor.get(b) as string[]).length -
        (byColor.get(a) as string[]).length,
    );
  }

  const { sheets, islands } = buildSheets(bestOrder, byColor);
  return { sheets, order: bestOrder, islands, colorCount: K, exhaustive };
}
