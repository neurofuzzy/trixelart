import { worldToTri, triToString } from "@/lib/grid-math";
import type { ToolHandler } from "./types";
import { pickValueAt } from "./pick-value";

export const eyedropperTool: ToolHandler = {
  onDown(ctx, _e, pos) {
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);
    const key = triToString(tri);
    const encoded = ctx.paintedRef.current[key];
    if (encoded) pickValueAt(ctx, encoded);
    ctx.drag.current = { kind: "idle" };
  },
};
