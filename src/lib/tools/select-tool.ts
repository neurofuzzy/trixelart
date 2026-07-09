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
          for (const item of items) {
            const snap = captureHexSnapshot(
              ctx.paintedRef.current,
              item.sourceHex.c,
              item.sourceHex.k,
              N,
            );
            if (snap.trixels.length > 0) {
              upsertSelectionSnapshot(
                ctx.setSelections,
                ctx.setActiveSelection,
                snap,
              );
            }
          }

          ctx.drag.current = {
            kind: "selectMove",
            hasMoved: false,
            anchorHex: { c: hex.c, k: hex.k },
            lastDelta: { dc: 0, dk: 0 },
            lastShiftKey: e.shiftKey,
            originPainted: { ...ctx.paintedRef.current },
            items,
            N,
          };
          return;
        }
      }

      ctx.setSelectedHexes([hex]);
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
    const tri = worldToTri(world.x, world.y);
    const hex = triToHex(tri.q, tri.r, tri.type, N);

    const dc = hex.c - drag.anchorHex.c;
    const dk = hex.k - drag.anchorHex.k;
    if (
      dc === drag.lastDelta.dc &&
      dk === drag.lastDelta.dk &&
      e.shiftKey === drag.lastShiftKey
    )
      return;
    drag.lastDelta = { dc, dk };
    drag.lastShiftKey = e.shiftKey;
    drag.hasMoved = true;

    const next = { ...drag.originPainted };

    for (const item of drag.items) {
      const destHex = {
        c: item.sourceHex.c + dc,
        k: item.sourceHex.k + dk,
      };

      if (!e.shiftKey) {
        const { qc: srcQc, rc: srcRc } = hexCenterTriAxial(
          item.sourceHex.c,
          item.sourceHex.k,
          N,
        );
        for (const t of item.snapshot) {
          const srcKey = triToString({
            q: srcQc + t.dq,
            r: srcRc + t.dr,
            type: t.type,
          });
          delete next[srcKey];
        }
      }

      const { qc: dstQc, rc: dstRc } = hexCenterTriAxial(
        destHex.c,
        destHex.k,
        N,
      );
      for (const t of item.snapshot) {
        const dstKey = triToString({
          q: dstQc + t.dq,
          r: dstRc + t.dr,
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
      const dc = drag.lastDelta.dc;
      const dk = drag.lastDelta.dk;

      const newHexes = drag.items.map((item) => ({
        c: item.sourceHex.c + dc,
        k: item.sourceHex.k + dk,
      }));
      ctx.setSelectedHexes(newHexes);

      for (const item of drag.items) {
        const destHex = {
          c: item.sourceHex.c + dc,
          k: item.sourceHex.k + dk,
        };
        const snap = captureHexSnapshot(
          ctx.paintedRef.current,
          destHex.c,
          destHex.k,
          drag.N,
        );
        if (snap.trixels.length > 0) {
          upsertSelectionSnapshot(
            ctx.setSelections,
            ctx.setActiveSelection,
            snap,
          );
        }
      }

      ctx.onCommit();
    }

    ctx.drag.current = { kind: "idle" };
  },
};
