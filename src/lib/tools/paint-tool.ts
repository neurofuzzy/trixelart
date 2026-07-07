import {
  worldToTri,
  triToString,
  getTrianglesOnLine,
} from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import type { ToolHandler } from "./types";
import { clippedLine } from "./line-draw";

export const paintTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (isRightClick) return;
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
          ctx.selectedHex,
          ctx.gridDivisions,
        );
        if (lineTris.length > 0) {
          ctx.lastPaintTriRef.current = lineTris[lineTris.length - 1];
        }
        ctx.setPainted((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const lt of lineTris) {
            const k = triToString(lt);
            if (resolveColor(next[k] ?? "") !== resolveColor(ctx.color)) {
              next[k] = ctx.color;
              changed = true;
            }
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
    const targets = ctx.expandTargets(tri);
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
    ctx.setPainted((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const tri of tris) {
        const targets = ctx.expandTargets(tri);
        for (const t of targets) {
          const k = triToString(t);
          if (resolveColor(next[k] ?? "") !== resolveColor(ctx.color)) {
            next[k] = ctx.color;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  },

  onUp(ctx) {
    const drag = ctx.drag.current;
    if (drag.kind !== "edit") return;
    if (!drag.hasMoved) {
      const ck = drag.clickKeys;
      if (ck.length > 0) {
        const clr = ctx.color;
        ctx.setPainted((prev) => {
          const next = { ...prev };
          if (ck.length === 1) {
            if (resolveColor(prev[ck[0]] ?? "") === resolveColor(clr)) {
              delete next[ck[0]];
            } else {
              next[ck[0]] = clr;
            }
          } else {
            let changed = false;
            for (const k of ck) {
              if (resolveColor(next[k] ?? "") !== resolveColor(clr)) {
                next[k] = clr;
                changed = true;
              }
            }
            if (!changed) return prev;
          }
          return next;
        });
      }
    }
    ctx.onCommit();
  },
};
