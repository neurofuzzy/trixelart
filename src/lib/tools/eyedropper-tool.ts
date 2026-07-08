import { worldToTri, triToString } from "@/lib/grid-math";
import type { ToolHandler } from "./types";

export const eyedropperTool: ToolHandler = {
  onDown(ctx, _e, pos) {
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);
    const key = triToString(tri);
    const encoded = ctx.paintedRef.current[key];
    if (encoded) {
      ctx.setColor(encoded);
      ctx.setTool("paint");
    }
    ctx.drag.current = { kind: "idle" };
  },
};
