import { applyCropDrag, hitTestHandle } from "@/lib/crop";
import type { ToolHandler } from "./types";

/** Grab radius for a crop handle, in screen pixels. */
export const CROP_HANDLE_PX = 10;

/**
 * Drags the export crop rectangle.
 *
 * The crop is view state, not authored content: it never touches `painted`, so
 * unlike every editing tool this one must **not** call `ctx.onCommit()`. Putting
 * crop drags into the undo stack would mean Ctrl+Z stops undoing paint strokes.
 * The golden rule in CLAUDE.md is about `painted` — it does not apply here.
 */
export const cropTool: ToolHandler = {
  onDown(ctx, e, pos, isRightClick) {
    if (isRightClick) return;
    const world = ctx.screenToWorld(pos.x, pos.y);
    const handle = hitTestHandle(
      ctx.crop,
      world.x,
      world.y,
      CROP_HANDLE_PX / ctx.view.zoom,
    );
    if (!handle) {
      ctx.drag.current = { kind: "idle" };
      return;
    }
    ctx.drag.current = {
      kind: "crop",
      handle,
      startCrop: ctx.crop,
      startWorld: world,
    };
  },

  onMove(ctx, e, pos) {
    const d = ctx.drag.current;
    if (d.kind !== "crop") return;
    const world = ctx.screenToWorld(pos.x, pos.y);
    ctx.setCrop(
      applyCropDrag(
        d.startCrop,
        d.handle,
        world.x - d.startWorld.x,
        world.y - d.startWorld.y,
      ),
    );
  },

  onUp(ctx) {
    ctx.drag.current = { kind: "idle" };
  },
};
