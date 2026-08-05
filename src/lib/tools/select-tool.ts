import { worldToTri, triToString, SIDE, H } from "@/lib/grid-math";
import {
  triToHex,
  captureHexSnapshot,
  hexCenterTriAxial,
  hexCenterWorld,
} from "@/lib/hex-flower";
import type { SelectItem, ToolHandler } from "./types";

/** What each selected hex holds in one layer, at pointer-down. Hexes with
 *  nothing in them drop out — there is nothing to cut or paste. */
function hexItems(
  painted: Record<string, string>,
  hexes: Array<{ c: number; k: number }>,
  N: number,
): SelectItem[] {
  return hexes
    .map((sourceHex) => ({
      sourceHex,
      snapshot: captureHexSnapshot(painted, sourceHex.c, sourceHex.k, N).trixels,
    }))
    .filter((item) => item.snapshot.length > 0);
}

/** One layer's map with every selected hex's contents moved by `(dq, dr)`.
 *  `copy` leaves the source behind (SHIFT-drag) instead of cutting it. */
function moveItems(
  origin: Record<string, string>,
  items: SelectItem[],
  dq: number,
  dr: number,
  N: number,
  copy: boolean,
): Record<string, string> {
  const next = { ...origin };

  for (const item of items) {
    const { qc: srcQc, rc: srcRc } = hexCenterTriAxial(
      item.sourceHex.c,
      item.sourceHex.k,
      N,
    );

    if (!copy) {
      for (const t of item.snapshot) {
        delete next[triToString({ q: srcQc + t.dq, r: srcRc + t.dr, type: t.type })];
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

  return next;
}

/**
 * Hex selection, and dragging what is inside it.
 *
 * **ALT is overloaded on the same target and split by gesture.** A press on a
 * hex already in the selection starts an all-layer drag; if the pointer never
 * travels a whole lattice step, pointer-up treats it as the older ALT-click and
 * removes that hex from the selection instead. The two never collide because a
 * deselect is a click and a move is a drag — and outside the selection ALT keeps
 * its old meaning, where it has nothing to move anyway.
 *
 * Like the move tool, ALT is read **live on every move**, so it can be pressed
 * or released mid-drag; releasing it puts the other layers back.
 */
export const selectTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (isRightClick) return;
    const N = ctx.gridDivisions;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);

    if (N > 0) {
      const hex = triToHex(tri.q, tri.r, tri.type, N);
      const isInSelection = ctx.selectedHexes.some(
        (h) => h.c === hex.c && h.k === hex.k,
      );

      if (e.altKey && !isInSelection) {
        // Nothing of this hex is selected, so there is neither anything to
        // remove nor anything to drag.
        ctx.drag.current = { kind: "idle" };
        return;
      }

      if (e.shiftKey && !isInSelection) {
        ctx.setSelectedHexes([...ctx.selectedHexes, hex]);
        ctx.drag.current = { kind: "idle" };
        return;
      }

      if (isInSelection) {
        const hexes = ctx.selectedHexes;
        // Captured for every layer, not just the active one, because ALT may be
        // pressed after the drag has already started.
        const layerItems = ctx.layers.map((l) => hexItems(l.painted, hexes, N));
        const items = layerItems[ctx.activeLayerIdx] ?? [];

        if (items.length > 0 || e.altKey) {
          ctx.drag.current = {
            kind: "selectMove",
            hasMoved: false,
            startWorld: world,
            lastDq: 0,
            lastDr: 0,
            lastShiftKey: e.shiftKey,
            originPainted: { ...ctx.paintedRef.current },
            originLayers: ctx.layers.map((l) => ({ ...l.painted })),
            items,
            layerItems,
            hexes,
            altHex: e.altKey ? hex : null,
            movedAll: e.altKey,
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
    const copy = e.shiftKey;
    const all = e.altKey;

    if (
      dq === drag.lastDq &&
      dr === drag.lastDr &&
      copy === drag.lastShiftKey &&
      all === drag.movedAll
    )
      return;
    drag.lastDq = dq;
    drag.lastDr = dr;
    drag.lastShiftKey = copy;
    // Displacement, not "an event arrived": an ALT press with a pixel of jitter
    // must still count as a click, or it would deselect nothing and commit a
    // zero-length move instead.
    if (dq !== 0 || dr !== 0) drag.hasMoved = true;
    if (!drag.hasMoved) {
      drag.movedAll = all;
      return;
    }

    if (all) {
      ctx.setAllPainted(
        drag.layerItems.map((items, i) =>
          moveItems(drag.originLayers[i], items, dq, dr, N, copy),
        ),
      );
    } else if (drag.movedAll) {
      // ALT released mid-drag: put the other layers back and carry on with the
      // active one alone.
      ctx.setAllPainted(
        drag.layerItems.map((items, i) =>
          i === ctx.activeLayerIdx
            ? moveItems(drag.originLayers[i], items, dq, dr, N, copy)
            : drag.originLayers[i],
        ),
      );
    } else {
      // The common path writes one layer, for the same reason the move tool
      // does: rewriting the whole stack per pointer move rebuilds every layer's
      // effect geometry.
      ctx.setPainted(moveItems(drag.originPainted, drag.items, dq, dr, N, copy));
    }
    drag.movedAll = all;
  },

  onUp(ctx, _e, _pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "selectMove") return;

    if (drag.hasMoved) {
      const N = drag.N;
      const dq = drag.lastDq;
      const dr = drag.lastDr;

      // Taken from the whole selection rather than from `items`: a hex that was
      // empty at pointer-down still travelled, and deriving this from the items
      // would quietly drop it from the selection.
      const newHexes = drag.hexes.map((sourceHex) => {
        const { x, y } = hexCenterWorld(sourceHex.c, sourceHex.k, N);
        const dwx = (dq + dr * 0.5) * SIDE;
        const dwy = dr * H;
        const tri = worldToTri(x + dwx, y + dwy);
        return triToHex(tri.q, tri.r, tri.type, N);
      });
      ctx.setSelectedHexes(newHexes);

      ctx.onCommit();
    } else if (drag.altHex) {
      // ALT pressed and released without travelling: the older gesture.
      const { c, k } = drag.altHex;
      ctx.setSelectedHexes(
        ctx.selectedHexes.filter((h) => !(h.c === c && h.k === k)),
      );
    }

    ctx.drag.current = { kind: "idle" };
  },
};
