import { worldToTri, triToString, getTrianglesOnLine } from "@/lib/grid-math";
import { triToHex, enumerateHexTrixels } from "@/lib/hex-flower";
import { makePatternPainter } from "@/lib/tri-pattern";
import type { TriKey } from "@/lib/grid-math";
import type { ToolContext, ToolHandler } from "./types";

/**
 * Pattern brush: paints whole hexes of the grid with a procedural triangular
 * pattern.
 *
 * The pattern is a global function of world position (see `tri-pattern.ts`),
 * not something stamped per hex — so hexes painted in separate strokes still
 * line up, and the brush reads as uncovering one continuous field rather than
 * dropping tiles.
 */

/** The hex grid can be off (N = 0) or very coarse, so the footprint is floored
 *  to keep the brush usable at any setting. */
export const PATTERN_MIN_N = 3;

export const patternBrushN = (gridDivisions: number): number =>
  Math.max(gridDivisions, PATTERN_MIN_N);

/**
 * The key/colour pairs for one hex. Returned rather than applied so the
 * `setPainted` updater stays pure — React StrictMode replays it.
 *
 * `paint` is built once per pointer event rather than per hex: it caches the
 * resolved layer colours and memoizes the palette search, both of which stay
 * valid for every hex in the same event.
 */
function hexPaint(
  paint: (t: TriKey) => string,
  c: number,
  k: number,
  N: number,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const t of enumerateHexTrixels(c, k, N)) {
    out.push([triToString(t), paint(t)]);
  }
  return out;
}

const painterFor = (ctx: ToolContext) =>
  makePatternPainter(ctx.patternLayers, ctx.quantizeTargets);

function apply(ctx: ToolContext, pairs: Array<[string, string]>): void {
  if (pairs.length === 0) return;
  ctx.setPainted((prev) => {
    const next = { ...prev };
    for (const [key, color] of pairs) next[key] = color;
    return next;
  });
}

export const patternTool: ToolHandler = {
  onDown(ctx, e, pos) {
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);
    const N = patternBrushN(ctx.gridDivisions);
    const hex = triToHex(tri.q, tri.r, tri.type, N);

    const pairs = hexPaint(painterFor(ctx), hex.c, hex.k, N);
    apply(ctx, pairs);

    ctx.drag.current = {
      kind: "pattern",
      changed: pairs.length > 0,
      visited: new Set([`${hex.c},${hex.k}`]),
      lastWorld: world,
    };
  },

  onMove(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "pattern") return;

    const world = ctx.screenToWorld(pos.x, pos.y);
    const N = patternBrushN(ctx.gridDivisions);

    // Walk the segment rather than sampling the endpoint: a fast drag would
    // otherwise skip whole hexes and leave gaps in the stroke.
    const tris = getTrianglesOnLine(
      drag.lastWorld.x,
      drag.lastWorld.y,
      world.x,
      world.y,
    );
    drag.lastWorld = world;

    const paint = painterFor(ctx);
    const pairs: Array<[string, string]> = [];
    for (const t of tris) {
      const hex = triToHex(t.q, t.r, t.type, N);
      const id = `${hex.c},${hex.k}`;
      if (drag.visited.has(id)) continue;
      drag.visited.add(id);
      pairs.push(...hexPaint(paint, hex.c, hex.k, N));
    }

    if (pairs.length > 0) {
      drag.changed = true;
      apply(ctx, pairs);
    }
  },

  onUp(ctx) {
    const drag = ctx.drag.current;
    if (drag.kind === "pattern" && drag.changed) ctx.onCommit();
    ctx.drag.current = { kind: "idle" };
  },
};
