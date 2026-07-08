import type { Tool, ToolHandler } from "./types";
import { paintTool } from "./paint-tool";
import { eraseTool } from "./erase-tool";
import { makeDodgeBurnTool } from "./dodge-burn-tool";
import { panTool } from "./pan-tool";
import { selectTool } from "./select-tool";
import { stampTool } from "./stamp-tool";
import { eyedropperTool } from "./eyedropper-tool";

export type { Tool, ToolHandler, ToolContext, DragState } from "./types";
export { viewPanTool } from "./view-pan-tool";

const dodgeTool = makeDodgeBurnTool(1);
const burnTool = makeDodgeBurnTool(-1);

export const toolMap: Record<Tool, ToolHandler> = {
  paint: paintTool,
  erase: eraseTool,
  dodge: dodgeTool,
  burn: burnTool,
  pan: panTool,
  select: selectTool,
  stamp: stampTool,
  eyedropper: eyedropperTool,
};
