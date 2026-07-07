import { worldToTri } from "@/lib/grid-math";
import { triToHex, captureHexSnapshot } from "@/lib/hex-flower";
import type { ToolHandler } from "./types";
import { upsertSelectionSnapshot } from "./selection-utils";

export const selectTool: ToolHandler = {
  onDown(ctx, e, pos) {
    const N = ctx.gridDivisions;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);
    if (N > 0) {
      const hex = triToHex(tri.q, tri.r, tri.type, N);
      ctx.setSelectedHex(hex);
      const snap = captureHexSnapshot(ctx.paintedRef.current, hex.c, hex.k, N);
      if (snap.trixels.length > 0) {
        upsertSelectionSnapshot(ctx.setSelections, ctx.setActiveSelection, snap);
      }
    } else {
      ctx.setSelectedHex(null);
    }
    ctx.drag.current = { kind: "idle" };
  },
};
