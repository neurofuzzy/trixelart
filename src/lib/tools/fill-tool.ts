import { worldToTri, triToString, triEdgeNeighbors, type TriKey } from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import { FILL_MAX_RADIUS } from "@/lib/config";
import type { ToolHandler } from "./types";
import { selectionConstraint } from "./selection-utils";

/**
 * Flood-fill the region edge-connected to `seed`, bounded by `maxRadius`
 * edge-steps.
 *
 * - If `seed` is unpainted, the region is every connected *empty* trixel,
 *   walled off by any painted trixel — i.e. filling an enclosed hole.
 * - If `seed` is painted, the region is every connected trixel of the same
 *   resolved color — i.e. recoloring a contiguous shape.
 *
 * When `constrain` is given, any trixel it rejects acts as a wall (used to
 * clip the fill to a hex selection). A selection is a finite boundary, so the
 * caller passes `maxRadius = Infinity` in that case.
 *
 * Adjacency is edge-only (see {@link triEdgeNeighbors}); corner contact does
 * not connect. Returns the trixel keys to paint, an empty array for a no-op,
 * or `null` when the region spreads past `maxRadius` (unbounded / not
 * enclosed) and must not be filled.
 *
 * `newColor` is only consulted to spot the no-op of repainting a region the
 * colour it already is. Pass `null` for ALT-fill, which erases the region
 * instead — there the destination is emptiness and no colour can be a no-op.
 */
export function computeFillRegion(
  painted: Record<string, string>,
  seed: TriKey,
  newColor: string | null,
  maxRadius: number,
  constrain?: (t: TriKey) => boolean,
): string[] | null {
  // A click outside the constraint (e.g. outside the selection) fills nothing.
  if (constrain && !constrain(seed)) return [];

  const seedKey = triToString(seed);
  const seedRaw = painted[seedKey];
  const targetColor = seedRaw === undefined ? null : resolveColor(seedRaw);

  // Recoloring a same-colored region with the same color changes nothing.
  if (
    newColor !== null &&
    targetColor !== null &&
    targetColor === resolveColor(newColor)
  )
    return [];

  const matches = (t: TriKey, k: string): boolean => {
    if (constrain && !constrain(t)) return false; // outside constraint = wall
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
        if (visited.has(nk) || !matches(n, nk)) continue;
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

/**
 * Fill. ALT-click erases the region instead of recolouring it — same region,
 * same walls, same selection clipping, only the write differs. Seeding on an
 * empty cell does nothing: that region is already empty, and flooding it would
 * only be an expensive way to find that out.
 */
export const fillTool: ToolHandler = {
  onDown(ctx, e, pos) {
    const world = ctx.screenToWorld(pos.x, pos.y);
    const seed = worldToTri(world.x, world.y);
    const erasing = e.altKey;

    if (erasing && ctx.paintedRef.current[triToString(seed)] === undefined) {
      ctx.drag.current = { kind: "fill", changed: false };
      return;
    }

    // A hex selection is a finite boundary that clips the fill, so there's no
    // need to abort on radius when one is active.
    const constrain = selectionConstraint(ctx);
    const region = computeFillRegion(
      ctx.paintedRef.current,
      seed,
      erasing ? null : ctx.color,
      constrain ? Infinity : FILL_MAX_RADIUS,
      constrain,
    );

    if (!region || region.length === 0) {
      // Not enclosed, or nothing to change — leave the grid untouched.
      ctx.drag.current = { kind: "fill", changed: false };
      return;
    }

    ctx.setPainted((prev) => {
      const next = { ...prev };
      for (const k of region) {
        if (erasing) delete next[k];
        else next[k] = ctx.color;
      }
      return next;
    });
    ctx.drag.current = { kind: "fill", changed: true };
  },

  onUp(ctx) {
    const drag = ctx.drag.current;
    if (drag.kind === "fill" && drag.changed) ctx.onCommit();
  },
};
