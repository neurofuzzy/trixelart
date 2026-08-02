import { decodeHatch } from "@/lib/hatch";
import type { ToolContext } from "./types";

/**
 * Adopts whatever is under the cursor as the current brush.
 *
 * Shared by the eyedropper and by the right-click pick that `view-pan-tool`
 * performs under every other tool. Branching on the value's kind matters: on a
 * hatch layer the old colour-only path fed a hatch string to `setColor`, whose
 * `decodeColor` returned null and swallowed the whole call — including the
 * switch to paint. Picking silently did nothing.
 */
export function pickValueAt(ctx: ToolContext, encoded: string): void {
  const hatch = decodeHatch(encoded);
  if (hatch) {
    // Matching an existing mark is the useful action on a hatch layer, and it
    // avoids switching to a tool the layer doesn't allow.
    ctx.setHatchBrush(hatch);
    ctx.setTool("hatch");
    return;
  }
  ctx.setColor(encoded);
  ctx.setTool("paint");
}
