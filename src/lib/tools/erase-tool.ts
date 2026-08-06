import { worldToTri, triToString, stringToTri } from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import { makeEditTool } from "./edit-tool";
import { selectionConstraint } from "./selection-utils";
import type { ToolHandler } from "./types";

const strokeErase = makeEditTool((next, k) => {
  if (k in next) {
    delete next[k];
    return true;
  }
  return false;
});

/**
 * Erase. ALT-click erases every cell of the clicked colour on the active layer
 * at once — the non-contiguous counterpart to ALT-fill, which stops at the
 * region boundary. A hex selection scopes the sweep to itself, exactly as it
 * bounds fill.
 *
 * Matching is on the *resolved* colour, like the fill region: the question this
 * gesture answers is "everything that looks like this", so two palettes that
 * land on the same hex count as one colour. `NO_PRINT` resolves to itself, so
 * markers match only markers. On a hatch layer the values are marks rather than
 * colours and resolve to themselves too, which makes this "erase every
 * identical mark".
 */
export const eraseTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (!e.altKey) {
      strokeErase.onDown?.(ctx, e, pos, isRightClick);
      return;
    }

    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);
    const constrain = selectionConstraint(ctx);
    const painted = ctx.paintedRef.current;
    const seedRaw = painted[triToString(tri)];

    // Precomputed outside setPainted so the updater stays pure (StrictMode
    // replays it).
    const doomed: string[] = [];
    if (seedRaw !== undefined && (!constrain || constrain(tri))) {
      const target = resolveColor(seedRaw);
      for (const [k, v] of Object.entries(painted)) {
        if (resolveColor(v) !== target) continue;
        if (constrain && !constrain(stringToTri(k))) continue;
        doomed.push(k);
      }
    }
    if (doomed.length > 0) {
      ctx.setPainted((prev) => {
        const next = { ...prev };
        for (const k of doomed) delete next[k];
        return next;
      });
    }

    // A one-shot gesture wearing the edit drag's clothes: `hasMoved` skips the
    // click branch in `onUp` and a null `lastPaintedWorld` makes `onMove` a
    // no-op, so the shared handler is left with nothing to do but commit.
    ctx.drag.current = {
      kind: "edit",
      hasMoved: true,
      lastPaintedWorld: null,
      clickKeys: [],
      visited: new Set(),
    };
  },

  onMove(ctx, e, pos) {
    strokeErase.onMove?.(ctx, e, pos);
  },

  onUp(ctx, e, pos) {
    strokeErase.onUp?.(ctx, e, pos);
  },
};
