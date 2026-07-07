import { worldToTri, triToString } from "@/lib/grid-math";
import {
  triToHex,
  captureHexSnapshot,
  enumerateHexTrixels,
  hexCenterTriAxial,
  type SelectionSnapshot,
} from "@/lib/hex-flower";
import type { ToolHandler } from "./types";

export const stampTool: ToolHandler = {
  onDown(ctx, e, pos) {
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
        const key = JSON.stringify(
          captured.trixels.map((t) => [t.dq, t.dr, t.type, t.color]).sort(),
        );
        let activeSnap: SelectionSnapshot | null = null;
        ctx.setSelections((prev) => {
          const duplicate = prev.find(
            (s) =>
              s.N === captured.N &&
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
          activeSnap = captured;
          const next = [
            captured,
            ...prev.filter((s) => s.id !== captured.id),
          ];
          return next.slice(0, 5);
        });
        if (activeSnap) ctx.setActiveSelection(activeSnap);
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
          if (key in next) {
            delete next[key];
            changed = true;
          }
          next[key] = t.color;
          changed = true;
        }
        return changed ? next : prev;
      });
    }

    ctx.drag.current = { kind: "idle" };
  },

  onUp(ctx) {
    ctx.onCommit();
  },
};
