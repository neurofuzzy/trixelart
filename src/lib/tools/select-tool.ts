import { worldToTri, triToString, SIDE, H } from "@/lib/grid-math";
import {
  triToHex,
  captureHexSnapshot,
  hexCenterTriAxial,
  hexCenterWorld,
} from "@/lib/hex-flower";
import type { ToolHandler } from "./types";

export const selectTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (isRightClick) return;
    const N = ctx.gridDivisions;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);

    if (N > 0) {
      const hex = triToHex(tri.q, tri.r, tri.type, N);

      if (e.altKey) {
        ctx.setSelectedHexes(
          ctx.selectedHexes.filter(
            (h) => !(h.c === hex.c && h.k === hex.k),
          ),
        );
        ctx.drag.current = { kind: "idle" };
        return;
      }

      const isInSelection = ctx.selectedHexes.some(
        (h) => h.c === hex.c && h.k === hex.k,
      );

      if (e.shiftKey && !isInSelection) {
        ctx.setSelectedHexes([...ctx.selectedHexes, hex]);
        ctx.drag.current = { kind: "idle" };
        return;
      }

      if (isInSelection) {
        const items = ctx.selectedHexes
          .map((sourceHex) => {
            const snap = captureHexSnapshot(
              ctx.paintedRef.current,
              sourceHex.c,
              sourceHex.k,
              N,
            );
            return { sourceHex, snapshot: snap.trixels };
          })
          .filter((item) => item.snapshot.length > 0);

        if (items.length > 0) {
          ctx.drag.current = {
            kind: "selectMove",
            hasMoved: false,
            startWorld: world,
            lastDq: 0,
            lastDr: 0,
            lastShiftKey: e.shiftKey,
            originPainted: { ...ctx.paintedRef.current },
            items,
            N,
          };
          return;
        }
      }

      ctx.setSelectedHexes([hex]);
    } else {
      ctx.setSelectedHexes([]);
    }
    ctx.drag.current = { kind: "idle" };
  },

  onMove(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "selectMove") return;

    const N = drag.N;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const dwx = world.x - drag.startWorld.x;
    const dwy = world.y - drag.startWorld.y;
    const dr = Math.round(dwy / H);
    const dq = Math.round(dwx / SIDE - dr * 0.5);

    if (
      dq === drag.lastDq &&
      dr === drag.lastDr &&
      e.shiftKey === drag.lastShiftKey
    )
      return;
    drag.lastDq = dq;
    drag.lastDr = dr;
    drag.lastShiftKey = e.shiftKey;
    drag.hasMoved = true;

    const next = { ...drag.originPainted };

    for (const item of drag.items) {
      const { qc: srcQc, rc: srcRc } = hexCenterTriAxial(
        item.sourceHex.c,
        item.sourceHex.k,
        N,
      );

      if (!e.shiftKey) {
        for (const t of item.snapshot) {
          const srcKey = triToString({
            q: srcQc + t.dq,
            r: srcRc + t.dr,
            type: t.type,
          });
          delete next[srcKey];
        }
      }

      for (const t of item.snapshot) {
        const dstKey = triToString({
          q: srcQc + t.dq + dq,
          r: srcRc + t.dr + dr,
          type: t.type,
        });
        next[dstKey] = t.color;
      }
    }

    ctx.setPainted(next);
  },

  onUp(ctx, _e, _pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "selectMove") return;

    if (drag.hasMoved) {
      const N = drag.N;
      const dq = drag.lastDq;
      const dr = drag.lastDr;

      const newHexes = drag.items.map((item) => {
        const { x, y } = hexCenterWorld(item.sourceHex.c, item.sourceHex.k, N);
        const dwx = (dq + dr * 0.5) * SIDE;
        const dwy = dr * H;
        const tri = worldToTri(x + dwx, y + dwy);
        return triToHex(tri.q, tri.r, tri.type, N);
      });
      ctx.setSelectedHexes(newHexes);

      ctx.onCommit();
    }

    ctx.drag.current = { kind: "idle" };
  },
};
