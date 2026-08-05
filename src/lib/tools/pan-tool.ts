import {
  SIDE,
  H,
  worldToTri,
  triToString,
  stringToTri,
} from "@/lib/grid-math";
import type { ToolHandler } from "./types";

/** A painted map with every trixel shifted by `(dq, dr)`. Values are opaque, so
 *  this moves hatch marks as happily as fills. */
function translate(
  painted: Record<string, string>,
  dq: number,
  dr: number,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(painted)) {
    const t = stringToTri(key);
    next[triToString({ q: t.q + dq, r: t.r + dr, type: t.type })] = value;
  }
  return next;
}

/**
 * The move tool: drags the artwork across the lattice.
 *
 * **ALT moves the whole stack**, not just the active layer. It is read live on
 * every move rather than latched at pointer-down, so it can be pressed or
 * released mid-drag — which matters because whether the other layers should come
 * along is usually only obvious once you see the active one move.
 *
 * The view is deliberately **not** compensated afterwards. It used to be: the
 * artwork's world position changed and the view shifted by the same amount the
 * other way, so on release the piece snapped back to exactly where it started on
 * screen and the drag appeared to do nothing. The single-click branch below
 * still compensates, and there it is right — that gesture re-indexes the lattice
 * origin and is *meant* to leave the picture where it is.
 */
export const panTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (isRightClick) return;
    const world = ctx.screenToWorld(pos.x, pos.y);
    ctx.drag.current = {
      kind: "pan",
      hasMoved: false,
      startWorld: world,
      startView: { ...ctx.view },
      moveDq: 0,
      moveDr: 0,
      originPainted: { ...ctx.paintedRef.current },
      originLayers: ctx.layers.map((l) => ({ ...l.painted })),
      movedAll: false,
    };
  },

  onMove(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "pan") return;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const dr = Math.round((world.y - drag.startWorld.y) / H);
    const dq = Math.round((world.x - drag.startWorld.x) / SIDE - dr * 0.5);
    drag.moveDq = dq;
    drag.moveDr = dr;
    if (dq !== 0 || dr !== 0) drag.hasMoved = true;
    if (!drag.hasMoved) return;

    const all = e.altKey;
    if (all) {
      ctx.setAllPainted(drag.originLayers.map((m) => translate(m, dq, dr)));
    } else if (drag.movedAll) {
      // ALT released mid-drag: put the inactive layers back where they were and
      // carry on moving the active one alone.
      ctx.setAllPainted(
        drag.originLayers.map((m, i) =>
          i === ctx.activeLayerIdx ? translate(m, dq, dr) : m,
        ),
      );
    } else {
      // The common case stays on `setPainted`, which touches one layer: writing
      // the whole stack every move would give every layer a new identity and
      // make the effect geometry for all of them rebuild on each pointer move.
      ctx.setPainted(translate(drag.originPainted, dq, dr));
    }
    drag.movedAll = all;
  },

  onUp(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "pan") return;
    if (drag.hasMoved) {
      ctx.onCommit();
      ctx.lastPaintTriRef.current = null;
      ctx.lastEditToolRef.current = null;
    } else {
      // A click with no drag re-origins the lattice on the clicked trixel. The
      // view moves with it so the artwork does not visibly jump — this gesture
      // changes coordinates, not position.
      const world = ctx.screenToWorld(pos.x, pos.y);
      const tri = worldToTri(world.x, world.y);
      const dq = -tri.q;
      const dr = -tri.r;
      if (dq !== 0 || dr !== 0) {
        const dwx = (dq + dr * 0.5) * SIDE;
        const dwy = dr * H;
        ctx.setView((v) => ({ ...v, x: v.x - dwx, y: v.y - dwy }));
        if (e.altKey) {
          // ALT means the whole stack here too. Re-origining one layer alone
          // would slide it out of register with the others.
          ctx.setAllPainted(
            ctx.layers.map((l) => translate(l.painted, dq, dr)),
          );
          ctx.paintedRef.current = translate(drag.originPainted, dq, dr);
        } else {
          const next = translate(ctx.paintedRef.current, dq, dr);
          ctx.paintedRef.current = next;
          ctx.setPainted(next);
        }
        ctx.onCommit();
      }
    }
  },
};
