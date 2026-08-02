import type { Tool, ToolHandler } from "./types";
import { paintTool } from "./paint-tool";
import { eraseTool } from "./erase-tool";
import { fillTool } from "./fill-tool";
import { patternTool } from "./pattern-tool";
import { makeDodgeBurnTool } from "./dodge-burn-tool";
import { panTool } from "./pan-tool";
import { selectTool } from "./select-tool";
import { stampTool } from "./stamp-tool";
import { cloneTool } from "./clone-tool";
import { eyedropperTool } from "./eyedropper-tool";
import { cropTool } from "./crop-tool";
import { hatchTool } from "./hatch-tool";

export type { Tool, ToolHandler, ToolContext, DragState } from "./types";
export { isToolAllowed } from "./types";
export { viewPanTool } from "./view-pan-tool";
export { patternBrushN, PATTERN_MIN_N } from "./pattern-tool";
export { CROP_HANDLE_PX } from "./crop-tool";

const dodgeTool = makeDodgeBurnTool(1);
const burnTool = makeDodgeBurnTool(-1);

export const toolMap: Record<Tool, ToolHandler> = {
  paint: paintTool,
  erase: eraseTool,
  fill: fillTool,
  pattern: patternTool,
  dodge: dodgeTool,
  burn: burnTool,
  pan: panTool,
  select: selectTool,
  stamp: stampTool,
  clone: cloneTool,
  eyedropper: eyedropperTool,
  crop: cropTool,
  hatch: hatchTool,
};
