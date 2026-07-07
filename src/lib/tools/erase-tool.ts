import { makeEditTool } from "./edit-tool";

export const eraseTool = makeEditTool((next, k) => {
  if (k in next) {
    delete next[k];
    return true;
  }
  return false;
});
