import {
  worldToTri,
  triToString,
  getTrianglesOnLine,
} from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import type { ToolContext, ToolHandler } from "./types";
import { clippedLine } from "./line-draw";

type KeyOp = (
  next: Record<string, string>,
  k: string,
  ctx: ToolContext,
) => boolean;

interface EditToolOpts {
  dedup?: boolean;
  toggle?: boolean;
  /** Decides whether a no-move click landed on what the brush would paint, in
   *  which case `toggle` clears the cell instead. Defaults to comparing
   *  resolved colours, which is what paint wants; the hatch brush overrides it
   *  because its values are hatch marks, not colours. */
  sameAsBrush?: (existing: string | undefined, ctx: ToolContext) => boolean;
}

/** Shared shell for paint / erase / dodge / burn. All four follow the same
 *  down→move→up rhythm: shift-click draws a line via {@link clippedLine},
 *  normal drag paints a stroke via {@link getTrianglesOnLine} + expandTargets,
 *  and a no-move click applies to the down-position targets. */
export function makeEditTool(
  keyOp: KeyOp,
  opts?: EditToolOpts,
): ToolHandler {
  const dedup = !!opts?.dedup;
  const toggle = !!opts?.toggle;
  const sameAsBrush =
    opts?.sameAsBrush ??
    ((existing: string | undefined, ctx: ToolContext) =>
      resolveColor(existing ?? "") === resolveColor(ctx.color));

  return {
    onDown(ctx, e, pos) {
      const world = ctx.screenToWorld(pos.x, pos.y);
      const tri = worldToTri(world.x, world.y);

      if (e.shiftKey) {
        const prevTri = ctx.lastPaintTriRef.current;
        if (
          ctx.lastEditToolRef.current &&
          ctx.lastEditToolRef.current !== ctx.tool
        ) {
          ctx.lastPaintTriRef.current = null;
        }
        ctx.lastEditToolRef.current = ctx.tool;

        if (prevTri) {
          const lineTris = clippedLine(
            prevTri,
            tri,
            ctx.selectedHexes,
            ctx.gridDivisions,
          );
          if (lineTris.length > 0) {
            ctx.lastPaintTriRef.current = lineTris[lineTris.length - 1];
          }
          ctx.setPainted((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const lt of lineTris) {
              changed = keyOp(next, triToString(lt), ctx) || changed;
            }
            return changed ? next : prev;
          });
        }
        ctx.drag.current = {
          kind: "edit",
          hasMoved: false,
          lastPaintedWorld: null,
          clickKeys: [],
          visited: new Set(),
        };
        return;
      }

      ctx.lastPaintTriRef.current = tri;
      ctx.lastEditToolRef.current = ctx.tool;
      const targets = ctx.brushExpand(tri);
      const clickKeys = targets.map(triToString);
      ctx.drag.current = {
        kind: "edit",
        hasMoved: false,
        lastPaintedWorld: world,
        clickKeys,
        visited: new Set(),
      };
    },

    onMove(ctx, e, pos) {
      const drag = ctx.drag.current;
      if (drag.kind !== "edit") return;
      if (!drag.lastPaintedWorld) return;
      const world = ctx.screenToWorld(pos.x, pos.y);
      drag.hasMoved = true;
      const tris = getTrianglesOnLine(
        drag.lastPaintedWorld.x,
        drag.lastPaintedWorld.y,
        world.x,
        world.y,
      );
      drag.lastPaintedWorld = world;

      if (dedup) {
        // Non-idempotent ops (dodge/burn): pre-compute candidates outside
        // setPainted so the updater is pure (React StrictMode replays it).
        const candidates = new Set<string>();
        for (const tri of tris) {
          for (const t of ctx.brushExpand(tri)) {
            const k = triToString(t);
            if (!drag.visited.has(k)) candidates.add(k);
          }
        }
        if (candidates.size === 0) return;
        for (const k of candidates) drag.visited.add(k);

        ctx.setPainted((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const k of candidates) {
            changed = keyOp(next, k, ctx) || changed;
          }
          return changed ? next : prev;
        });
      } else {
        // Idempotent ops (paint, erase): simple loop.
        ctx.setPainted((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const tri of tris) {
            for (const t of ctx.brushExpand(tri)) {
              changed = keyOp(next, triToString(t), ctx) || changed;
            }
          }
          return changed ? next : prev;
        });
      }
    },

    onUp(ctx) {
      const drag = ctx.drag.current;
      if (drag.kind !== "edit") return;
      if (!drag.hasMoved) {
        const ck = drag.clickKeys;
        if (ck.length > 0) {
          ctx.setPainted((prev) => {
            const next = { ...prev };
            if (toggle && ck.length === 1) {
              if (sameAsBrush(prev[ck[0]], ctx)) {
                delete next[ck[0]];
              } else {
                keyOp(next, ck[0], ctx);
              }
              return next;
            }
            let changed = false;
            for (const k of ck) {
              changed = keyOp(next, k, ctx) || changed;
            }
            return changed ? next : prev;
          });
        }
      }
      ctx.onCommit();
    },
  };
}
