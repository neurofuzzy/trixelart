"use client";

import { Settings, Undo2, Redo2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Tool } from "@/lib/tools";
import type { PanelId } from "@/components/PanelShell";

export type HexMode = "world" | "honeycomb";
export type Symmetry = "off" | "sym60" | "sym120";
export type GridOrientation = "flat-top" | "pointy-top";
export type BrushSize = "single" | "hex";

/** Maps any external/stored hex-mode value onto the current enum.
 *  Legacy modes: boolean true (outlines/centers) -> honeycomb; false/off -> world.
 *  Legacy strings "off"/"outlines"/"centers" are normalized to current names. */
export function normalizeHexMode(value: unknown): HexMode {
  if (typeof value === "boolean") return value ? "honeycomb" : "world";
  if (value === "honeycomb" || value === "world") return value;
  if (value === "off") return "world";
  if (value === "outlines" || value === "centers") return "honeycomb";
  return "world";
}

export function Footer({
  gridDivisions,
  hexMode,
  handleUndo,
  handleRedo,
  historyIdx,
  historyLength,
  tool,
  captureMode,
  cloneSourceSet,
  hasSelection,
  tooltip,
  panel,
  onTogglePanel,
}: {
  gridDivisions: number;
  hexMode: HexMode;
  handleUndo: () => void;
  handleRedo: () => void;
  historyIdx: number;
  historyLength: number;
  tool?: Tool;
  captureMode?: boolean;
  cloneSourceSet?: boolean;
  hasSelection?: boolean;
  tooltip?: string | null;
  /** Which drawer currently holds the panel slot, or `null`. */
  panel: PanelId | null;
  onTogglePanel: (id: PanelId) => void;
}) {
  return (
    <div className="flex items-center justify-between p-2 border-t bg-card/90 backdrop-blur-md z-30">
      <div className="flex items-center gap-1" data-tour="history">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleUndo}
          disabled={historyIdx <= 0}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRedo}
          disabled={historyIdx >= historyLength - 1}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        {tooltip !== null ? (
          tooltip ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
              {tooltip}
            </span>
          ) : null
        ) : tool === "paint" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            click to paint
          </span>
        ) : tool === "erase" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            click to erase
          </span>
        ) : tool === "pan" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            drag to move — ALT-drag to move all layers
          </span>
        ) : tool === "select" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            {hasSelection
              ? "drag to move — ALT-drag for all layers, SHIFT-drag to copy, ALT-click to deselect"
              : "click on a hex to select"}
          </span>
        ) : tool === "stamp" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            {captureMode
              ? "click on an area to create a stamp"
              : "ALT click on a hex region to sample a pattern"}
          </span>
        ) : tool === "hatch" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            drag to hatch
          </span>
        ) : tool === "crop" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            drag the handles to set the export region
          </span>
        ) : tool === "eyedropper" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            click to pick a color and switch to paint
          </span>
        ) : tool === "clone" ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground truncate">
            {cloneSourceSet
              ? "click to start cloning"
              : "ALT-click to select a sample source"}
          </span>
        ) : (
          <>
            {hexMode === "honeycomb" && gridDivisions > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/25 text-cyan-300">
                hex
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            panel === "layers" && "bg-accent text-accent-foreground",
          )}
          onClick={() => onTogglePanel("layers")}
          title="Layers"
          data-tour="layers"
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          className={cn(
            "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            panel === "grid" && "bg-accent text-accent-foreground",
          )}
          onClick={() => onTogglePanel("grid")}
          title="Grid settings"
          data-tour="grid-settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
