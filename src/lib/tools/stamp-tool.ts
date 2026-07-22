import { worldToTri, triToString } from "@/lib/grid-math";
import {
  triToHex,
  captureHexSnapshot,
  enumerateHexTrixels,
  hexCenterTriAxial,
} from "@/lib/hex-flower";
import type { ToolHandler } from "./types";
import { upsertSelectionSnapshot } from "./selection-utils";

export const stampTool: ToolHandler = {
  // Stamp commits on pointer-up, not pointer-down. On touch devices the first
  // finger of a two-finger pinch fires pointerdown before the second finger
  // registers as a gesture, so acting on down would drop a stamp every time
  // the user pinch-zooms. onPointerUp is guarded by the two-finger check in
  // use-interaction, so deferring here suppresses the stray stamp — matching
  // how the paint/erase tools already behave.
  onUp(ctx, e, pos) {
    const N = ctx.gridDivisions;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);
    const snap = ctx.activeSelection;

    if ((e.altKey || ctx.captureMode) && N > 0) {
      const hex = triToHex(tri.q, tri.r, tri.type, N);
      const captured = captureHexSnapshot(
        ctx.paintedRef.current,
        hex.c,
        hex.k,
        N,
      );
      if (captured.trixels.length > 0) {
        upsertSelectionSnapshot(
          ctx.selections,
          ctx.setSelections,
          ctx.setActiveSelection,
          captured,
        );
        ctx.onStampCapture?.(hex.c, hex.k);
        ctx.setCaptureMode(false);
      }
    } else if (snap && N === snap.N) {
      const destHex = triToHex(tri.q, tri.r, tri.type, N);
      const { qc, rc } = hexCenterTriAxial(destHex.c, destHex.k, N);

      ctx.setPainted((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const t of enumerateHexTrixels(destHex.c, destHex.k, N)) {
          const key = triToString(t);
          if (key in next) {
            delete next[key];
            changed = true;
          }
        }
        for (const t of snap.trixels) {
          const key = triToString({
            q: qc + t.dq,
            r: rc + t.dr,
            type: t.type,
          });
          next[key] = t.color;
          changed = true;
        }
        return changed ? next : prev;
      });
    }

    ctx.drag.current = { kind: "idle" };
    ctx.onCommit();
  },
};
