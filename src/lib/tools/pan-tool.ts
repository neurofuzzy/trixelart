import {
  SIDE,
  H,
  worldToTri,
  triToString,
  stringToTri,
} from "@/lib/grid-math";
import type { ToolHandler } from "./types";

export const panTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (isRightClick) return;
    const world = ctx.screenToWorld(pos.x, pos.y);
    ctx.drag.current = {
      kind: "pan",
      hasMoved: false,
      startWorld: world,
      startView: { ...ctx.view },
      moveDq: 0,
      moveDr: 0,
      originPainted: { ...ctx.paintedRef.current },
    };
  },

  onMove(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "pan") return;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const dr = Math.round((world.y - drag.startWorld.y) / H);
    const dq = Math.round((world.x - drag.startWorld.x) / SIDE - dr * 0.5);
    drag.moveDq = dq;
    drag.moveDr = dr;
    if (dq !== 0 || dr !== 0) drag.hasMoved = true;

    if (drag.hasMoved) {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(drag.originPainted)) {
        const t = stringToTri(key);
        next[triToString({ q: t.q + dq, r: t.r + dr, type: t.type })] = value;
      }
      ctx.setPainted(next);
    }
  },

  onUp(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "pan") return;
    if (drag.hasMoved) {
      ctx.onCommit();
      const dq = drag.moveDq;
      const dr = drag.moveDr;
      const dwx = (dq + dr * 0.5) * SIDE;
      const dwy = dr * H;
      ctx.setView({
        x: drag.startView.x - dwx,
        y: drag.startView.y - dwy,
        zoom: drag.startView.zoom,
      });
      ctx.lastPaintTriRef.current = null;
      ctx.lastEditToolRef.current = null;
    } else {
      const world = ctx.screenToWorld(pos.x, pos.y);
      const tri = worldToTri(world.x, world.y);
      const dq = -tri.q;
      const dr = -tri.r;
      if (dq !== 0 || dr !== 0) {
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(ctx.paintedRef.current)) {
          const t = stringToTri(key);
          next[triToString({ q: t.q + dq, r: t.r + dr, type: t.type })] = value;
        }
        const dwx = (dq + dr * 0.5) * SIDE;
        const dwy = dr * H;
        ctx.setView((v) => ({ ...v, x: v.x - dwx, y: v.y - dwy }));
        ctx.paintedRef.current = next;
        ctx.setPainted(next);
        ctx.onCommit();
      }
    }
  },
};
