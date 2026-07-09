import { worldToTri, triToString } from "@/lib/grid-math";
import {
  triToHex,
  captureHexSnapshot,
  hexCenterTriAxial,
} from "@/lib/hex-flower";
import type { ToolHandler } from "./types";
import { upsertSelectionSnapshot } from "./selection-utils";

export const selectTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (isRightClick) return;
    const N = ctx.gridDivisions;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);

    if (N > 0) {
      const hex = triToHex(tri.q, tri.r, tri.type, N);

      if (
        ctx.selectedHex &&
        ctx.selectedHex.c === hex.c &&
        ctx.selectedHex.k === hex.k
      ) {
        const snap = captureHexSnapshot(
          ctx.paintedRef.current,
          hex.c,
          hex.k,
          N,
        );
        if (snap.trixels.length > 0) {
          upsertSelectionSnapshot(
            ctx.setSelections,
            ctx.setActiveSelection,
            snap,
          );
          ctx.drag.current = {
            kind: "selectMove",
            hasMoved: false,
            sourceHex: { c: hex.c, k: hex.k },
            lastHex: { c: hex.c, k: hex.k },
            originPainted: { ...ctx.paintedRef.current },
            snapshotTrixels: snap.trixels,
            N,
          };
          return;
        }
      }

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

  onMove(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "selectMove") return;

    const N = drag.N;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);
    const hex = triToHex(tri.q, tri.r, tri.type, N);

    if (hex.c === drag.lastHex.c && hex.k === drag.lastHex.k) return;
    drag.lastHex = { c: hex.c, k: hex.k };
    drag.hasMoved = true;

    const { qc: srcQc, rc: srcRc } = hexCenterTriAxial(
      drag.sourceHex.c,
      drag.sourceHex.k,
      N,
    );
    const { qc: dstQc, rc: dstRc } = hexCenterTriAxial(hex.c, hex.k, N);

    const next = { ...drag.originPainted };

    for (const t of drag.snapshotTrixels) {
      const srcKey = triToString({
        q: srcQc + t.dq,
        r: srcRc + t.dr,
        type: t.type,
      });
      delete next[srcKey];
    }

    for (const t of drag.snapshotTrixels) {
      const dstKey = triToString({
        q: dstQc + t.dq,
        r: dstRc + t.dr,
        type: t.type,
      });
      next[dstKey] = t.color;
    }

    ctx.setPainted(next);
  },

  onUp(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "selectMove") return;

    if (drag.hasMoved) {
      const N = drag.N;
      const world = ctx.screenToWorld(pos.x, pos.y);
      const tri = worldToTri(world.x, world.y);
      const hex = triToHex(tri.q, tri.r, tri.type, N);
      ctx.setSelectedHex(hex);

      const snap = captureHexSnapshot(
        ctx.paintedRef.current,
        hex.c,
        hex.k,
        N,
      );
      if (snap.trixels.length > 0) {
        upsertSelectionSnapshot(
          ctx.setSelections,
          ctx.setActiveSelection,
          snap,
        );
      }

      ctx.onCommit();
    }

    ctx.drag.current = { kind: "idle" };
  },
};
