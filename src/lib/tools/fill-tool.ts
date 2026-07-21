import { worldToTri, triToString, triEdgeNeighbors, type TriKey } from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import { FILL_MAX_RADIUS } from "@/lib/config";
import type { ToolHandler } from "./types";

/**
 * Flood-fill the region edge-connected to `seed`, bounded by `maxRadius`
 * edge-steps.
 *
 * - If `seed` is unpainted, the region is every connected *empty* trixel,
 *   walled off by any painted trixel — i.e. filling an enclosed hole.
 * - If `seed` is painted, the region is every connected trixel of the same
 *   resolved color — i.e. recoloring a contiguous shape.
 *
 * Adjacency is edge-only (see {@link triEdgeNeighbors}); corner contact does
 * not connect. Returns the trixel keys to paint, an empty array for a no-op,
 * or `null` when the region spreads past `maxRadius` (unbounded / not
 * enclosed) and must not be filled.
 */
export function computeFillRegion(
  painted: Record<string, string>,
  seed: TriKey,
  newColor: string,
  maxRadius: number,
): string[] | null {
  const seedKey = triToString(seed);
  const seedRaw = painted[seedKey];
  const targetColor = seedRaw === undefined ? null : resolveColor(seedRaw);
  const newResolved = resolveColor(newColor);

  // Recoloring a same-colored region with the same color changes nothing.
  if (targetColor !== null && targetColor === newResolved) return [];

  const matches = (k: string): boolean => {
    const c = painted[k];
    if (targetColor === null) return c === undefined; // empty region
    return c !== undefined && resolveColor(c) === targetColor;
  };

  const visited = new Set<string>([seedKey]);
  const region: string[] = [seedKey];
  let frontier: TriKey[] = [seed];
  let radius = 0;

  while (frontier.length > 0) {
    const nextFrontier: TriKey[] = [];
    for (const t of frontier) {
      for (const n of triEdgeNeighbors(t)) {
        const nk = triToString(n);
        if (visited.has(nk) || !matches(nk)) continue;
        visited.add(nk);
        region.push(nk);
        nextFrontier.push(n);
      }
    }
    if (nextFrontier.length === 0) break;
    radius++;
    // Reached the search limit while still expanding → the region isn't
    // enclosed within the allowed radius. Abort rather than fill.
    if (radius > maxRadius) return null;
    frontier = nextFrontier;
  }

  return region;
}

export const fillTool: ToolHandler = {
  onDown(ctx, e, pos) {
    const world = ctx.screenToWorld(pos.x, pos.y);
    const seed = worldToTri(world.x, world.y);
    const region = computeFillRegion(
      ctx.paintedRef.current,
      seed,
      ctx.color,
      FILL_MAX_RADIUS,
    );

    if (!region || region.length === 0) {
      // Not enclosed, or nothing to change — leave the grid untouched.
      ctx.drag.current = { kind: "fill", changed: false };
      return;
    }

    ctx.setPainted((prev) => {
      const next = { ...prev };
      for (const k of region) next[k] = ctx.color;
      return next;
    });
    ctx.drag.current = { kind: "fill", changed: true };
  },

  onUp(ctx) {
    const drag = ctx.drag.current;
    if (drag.kind === "fill" && drag.changed) ctx.onCommit();
  },
};
