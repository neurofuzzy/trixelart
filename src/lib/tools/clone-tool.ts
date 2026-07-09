import {
  worldToTri,
  triToString,
  stringToTri,
  triCenter,
  getTrianglesOnLine,
  type TriKey,
} from "@/lib/grid-math";
import { triToHex } from "@/lib/hex-flower";
import { clippedLine } from "./line-draw";
import type { ToolHandler, Pt } from "./types";

let gCloneOffset: Pt | null = null;

function cloneOp(
  t: TriKey,
  offset: Pt,
  painted: Record<string, string>,
): string | null {
  const center = triCenter(t.q, t.r, t.type);
  const srcX = center.x + offset.x;
  const srcY = center.y + offset.y;
  const srcTri = worldToTri(srcX, srcY);
  return painted[triToString(srcTri)] || null;
}

export const cloneTool: ToolHandler = {
  onDown(ctx, e, pos) {
    const world = ctx.screenToWorld(pos.x, pos.y);
    const tri = worldToTri(world.x, world.y);

    if (e.altKey) {
      gCloneOffset = null;
      ctx.onCloneOffset?.(null);
      const center = triCenter(tri.q, tri.r, tri.type);
      if (ctx.gridDivisions > 0) {
        const hex = triToHex(tri.q, tri.r, tri.type, ctx.gridDivisions);
        ctx.onCloneCapture?.(center.x, center.y, hex.c, hex.k, tri.q, tri.r, tri.type);
      } else {
        ctx.onCloneCapture?.(center.x, center.y, 0, 0, tri.q, tri.r, tri.type);
      }
      ctx.drag.current = { kind: "idle" };
      return;
    }

    // Clone source was cleared externally (e.g. tool switch) — reset offset too.
    if (!ctx.cloneSource && gCloneOffset) {
      gCloneOffset = null;
      return;
    }

    // Establish the persistent offset on first click after alt-click
    if (!gCloneOffset) {
      if (!ctx.cloneSource) return;
      if (tri.type !== ctx.cloneSource.type) return;
      const clickCenter = triCenter(tri.q, tri.r, tri.type);
      gCloneOffset = {
        x: ctx.cloneSource.x - clickCenter.x,
        y: ctx.cloneSource.y - clickCenter.y,
      };
      ctx.onCloneOffset?.({ ...gCloneOffset });
    }

    const offset = gCloneOffset;

    if (e.shiftKey) {
      const prevTri = ctx.lastPaintTriRef.current;
      if (
        ctx.lastEditToolRef.current &&
        ctx.lastEditToolRef.current !== ctx.tool
      ) {
        ctx.lastPaintTriRef.current = null;
      }
      ctx.lastEditToolRef.current = ctx.tool;

      if (prevTri) {
        const lineTris = clippedLine(
          prevTri,
          tri,
          ctx.selectedHex,
          ctx.gridDivisions,
        );
        if (lineTris.length > 0) {
          ctx.lastPaintTriRef.current = lineTris[lineTris.length - 1];
        }
        ctx.setPainted((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const lt of lineTris) {
            const color = cloneOp(lt, offset, prev);
            if (color) {
              next[triToString(lt)] = color;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      ctx.drag.current = {
        kind: "edit",
        hasMoved: false,
        lastPaintedWorld: null,
        clickKeys: [],
        visited: new Set(),
      };
      return;
    }

    ctx.lastPaintTriRef.current = tri;
    ctx.lastEditToolRef.current = ctx.tool;
    const targets = ctx.brushExpand(tri);
    const clickKeys = targets.map(triToString);
    ctx.drag.current = {
      kind: "edit",
      hasMoved: false,
      lastPaintedWorld: world,
      clickKeys,
      visited: new Set(),
    };
  },

  onMove(ctx, e, pos) {
    const drag = ctx.drag.current;
    if (drag.kind !== "edit") return;
    if (!drag.lastPaintedWorld) return;
    if (!gCloneOffset) return;

    const world = ctx.screenToWorld(pos.x, pos.y);
    drag.hasMoved = true;
    const tris = getTrianglesOnLine(
      drag.lastPaintedWorld.x,
      drag.lastPaintedWorld.y,
      world.x,
      world.y,
    );
    drag.lastPaintedWorld = world;

    const offset = gCloneOffset;

    ctx.setPainted((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const tri of tris) {
        for (const t of ctx.brushExpand(tri)) {
          const color = cloneOp(t, offset, prev);
          if (color) {
            next[triToString(t)] = color;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  },

  onUp(ctx) {
    const drag = ctx.drag.current;
    if (drag.kind !== "edit") return;
    if (!drag.hasMoved && gCloneOffset) {
      const ck = drag.clickKeys;
      if (ck.length > 0) {
        const offset = gCloneOffset;
        ctx.setPainted((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const k of ck) {
            const t = stringToTri(k);
            const color = cloneOp(t, offset, prev);
            if (color) {
              next[k] = color;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    }
    ctx.onCommit();
  },
};
