import { encodeHatch } from "@/lib/hatch";
import { makeEditTool } from "./edit-tool";

/**
 * Hatch brush.
 *
 * Rides on {@link makeEditTool}, so it inherits the whole editing rhythm for
 * free: shift-click straight lines, stroke sampling along pointer moves, brush
 * size / flower / symmetry expansion via `ctx.brushExpand`, the visited set, and
 * one `onCommit` per stroke. The only thing that differs from paint is the value
 * written into the cell.
 *
 * Only valid on a layer whose kind is `"hatch"` — TrixelGrid switches away from
 * this tool when the active layer is a fill layer, and the Toolbar disables it.
 */
export const hatchTool = makeEditTool(
  (next, k, ctx) => {
    const v = encodeHatch(ctx.hatchBrush);
    if (next[k] === v) return false;
    next[k] = v;
    return true;
  },
  {
    toggle: true,
    // Clicking a trixel that already carries exactly this hatch clears it —
    // the colour comparison the default uses is meaningless for hatch values.
    sameAsBrush: (existing, ctx) => existing === encodeHatch(ctx.hatchBrush),
  },
);
