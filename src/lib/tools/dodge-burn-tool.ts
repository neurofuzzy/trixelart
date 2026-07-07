import { makeEditTool } from "./edit-tool";
import { dodgeColor, burnColor } from "@/lib/constants";
import type { ToolHandler } from "./types";

export function makeDodgeBurnTool(direction: 1 | -1): ToolHandler {
  const apply = (encoded: string) =>
    direction === 1 ? dodgeColor(encoded) : burnColor(encoded);

  return makeEditTool(
    (next, k) => {
      if (next[k]) {
        next[k] = apply(next[k]);
        return true;
      }
      return false;
    },
    { dedup: true },
  );
}
