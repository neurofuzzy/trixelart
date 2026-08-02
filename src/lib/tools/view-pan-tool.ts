import { worldToTri, triToString } from "@/lib/grid-math";
import type { ToolHandler } from "./types";
import { pickValueAt } from "./pick-value";

export const viewPanTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (!isRightClick) return;
    ctx.drag.current = {
      kind: "viewPan",
      hasMoved: false,
      startPos: { x: e.clientX, y: e.clientY },
      lastPos: { x: e.clientX, y: e.clientY },
    };
  },

  onMove(ctx, e) {
    const drag = ctx.drag.current;
    if (drag.kind !== "viewPan") return;
    const sdx = (e.clientX - drag.lastPos.x) / ctx.view.zoom;
    const sdy = (e.clientY - drag.lastPos.y) / ctx.view.zoom;
    const dx = ctx.invCos * sdx - ctx.invSin * sdy;
    const dy = ctx.invSin * sdx + ctx.invCos * sdy;
    const totalDist = Math.hypot(
      e.clientX - drag.startPos.x,
      e.clientY - drag.startPos.y,
    );
    if (totalDist > 3) drag.hasMoved = true;
    ctx.setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    drag.lastPos = { x: e.clientX, y: e.clientY };
  },

  onUp(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "viewPan") return;
    if (!drag.hasMoved) {
      if (ctx.tool !== "stamp") {
        const world = ctx.screenToWorld(pos.x, pos.y);
        const key = triToString(worldToTri(world.x, world.y));
        const picked = ctx.paintedRef.current[key];
        if (picked) pickValueAt(ctx, picked);
      }
    }
  },
};
