import { worldToTri } from "@/lib/grid-math";
import {
  triToHex,
  captureHexSnapshot,
  type SelectionSnapshot,
} from "@/lib/hex-flower";
import type { ToolHandler } from "./types";

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
        const key = JSON.stringify(
          snap.trixels.map((t) => [t.dq, t.dr, t.type, t.color]).sort(),
        );
        let activeSnap: SelectionSnapshot | null = null;
        ctx.setSelections((prev) => {
          const duplicate = prev.find(
            (s) =>
              s.N === snap.N &&
              key ===
                JSON.stringify(
                  s.trixels
                    .map((t) => [t.dq, t.dr, t.type, t.color])
                    .sort(),
                ),
          );
          if (duplicate) {
            activeSnap = duplicate;
            return prev;
          }
          activeSnap = snap;
          const next = [snap, ...prev.filter((s) => s.id !== snap.id)];
          return next.slice(0, 5);
        });
        if (activeSnap) ctx.setActiveSelection(activeSnap);
      }
    } else {
      ctx.setSelectedHex(null);
    }
    ctx.drag.current = { kind: "idle" };
  },
};
