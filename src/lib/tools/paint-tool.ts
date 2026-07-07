import { makeEditTool } from "./edit-tool";
import { resolveColor } from "@/lib/constants";

export const paintTool = makeEditTool(
  (next, k, ctx) => {
    const existing = resolveColor(next[k] ?? "");
    const target = resolveColor(ctx.color);
    if (existing !== target) {
      next[k] = ctx.color;
      return true;
    }
    return false;
  },
  { toggle: true },
);
