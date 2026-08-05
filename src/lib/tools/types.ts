import type React from "react";
import type { TriKey } from "@/lib/grid-math";
import type { Symmetry, SelectionSnapshot } from "@/lib/hex-flower";
import type { Layer } from "@/hooks/use-history";
import type { PatternLayer, QuantizeTarget } from "@/lib/tri-pattern";
import type { CropHandle, CropRect } from "@/lib/crop";
import type { HatchBrush } from "@/lib/hatch";

export type Tool =
  | "paint"
  | "erase"
  | "fill"
  | "pattern"
  | "hatch"
  | "pan"
  | "select"
  | "stamp"
  | "clone"
  | "dodge"
  | "burn"
  | "eyedropper"
  | "crop";

/**
 * Tools that would write colour values, which is meaningless on a hatch layer —
 * they'd corrupt the map. Stamp is the one that matters most: its snapshots are
 * persisted and can later be pasted onto a fill layer, so it is the only real
 * cross-layer leak path.
 *
 * Erase (value-agnostic), pan and select (pure key translation), eyedropper
 * (reads the hatch brush instead) and crop (view-only) stay available on both
 * kinds.
 */
const HATCH_BLOCKED_TOOLS: readonly Tool[] = [
  "paint",
  "fill",
  "pattern",
  "stamp",
  "clone",
  "dodge",
  "burn",
];

/** The single source of truth for which tools a layer kind permits. Enforced by
 *  wrapping `setTool` in TrixelGrid, so every path — toolbar, keyboard, and the
 *  tools that switch tools themselves — is covered by one check. */
export function isToolAllowed(t: Tool, kind: "fill" | "hatch"): boolean {
  return kind === "fill" ? t !== "hatch" : !HATCH_BLOCKED_TOOLS.includes(t);
}

/** One selected hex's contents, captured at pointer-down so a drag can cut and
 *  paste it without re-reading the map it is mutating. */
export interface SelectItem {
  sourceHex: { c: number; k: number };
  snapshot: Array<{ dq: number; dr: number; type: TriKey["type"]; color: string }>;
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface Pt {
  x: number;
  y: number;
}

export type DragState =
  | { kind: "idle" }
  | { kind: "fill"; changed: boolean }
  | {
      kind: "pattern";
      changed: boolean;
      /** Hex ids ("c,k") already painted this stroke. */
      visited: Set<string>;
      lastWorld: Pt;
    }
  | {
      kind: "edit";
      hasMoved: boolean;
      lastPaintedWorld: Pt | null;
      clickKeys: string[];
      visited: Set<string>;
    }
  | {
      kind: "pan";
      hasMoved: boolean;
      startWorld: Pt;
      startView: View;
      moveDq: number;
      moveDr: number;
      originPainted: Record<string, string>;
      /** Every layer's painted map as it was at pointer-down, indexed like
       *  `layers`. ALT-drag translates all of these; releasing ALT mid-drag puts
       *  the inactive ones back from here. */
      originLayers: Record<string, string>[];
      /** Whether the last write moved the whole stack, so releasing ALT knows
       *  there is something to undo. */
      movedAll: boolean;
    }
  | {
      kind: "viewPan";
      hasMoved: boolean;
      startPos: Pt;
      lastPos: Pt;
    }
  | {
      kind: "crop";
      handle: CropHandle;
      startCrop: CropRect;
      startWorld: Pt;
    }
  | {
      kind: "selectMove";
      hasMoved: boolean;
      startWorld: Pt;
      lastDq: number;
      lastDr: number;
      lastShiftKey: boolean;
      originPainted: Record<string, string>;
      /** Every layer's painted map at pointer-down, indexed like `layers`. */
      originLayers: Record<string, string>[];
      /** The active layer's items — the common path writes only these. */
      items: SelectItem[];
      /** Per layer, the same items. ALT-drag moves all of them. */
      layerItems: SelectItem[][];
      /** The selection as it was at pointer-down. Kept whole rather than
       *  derived from `items`, which drops hexes that happened to be empty. */
      hexes: Array<{ c: number; k: number }>;
      /** The hex ALT was pressed on, if any. A press that never moves is a
       *  deselect; one that moves is an all-layer drag. */
      altHex: { c: number; k: number } | null;
      /** Whether the last write moved every layer, so releasing ALT knows there
       *  is something to put back. */
      movedAll: boolean;
      N: number;
    };

export interface ToolContext {
  view: View;
  setView: React.Dispatch<React.SetStateAction<View>>;
  screenToWorld: (sx: number, sy: number) => Pt;
  painted: Record<string, string>;
  setPainted: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Replaces every layer's painted map at once, by index. Only the move tool's
   *  ALT-drag needs this; everything else writes the active layer. */
  setAllPainted: (maps: Record<string, string>[]) => void;
  paintedRef: React.MutableRefObject<Record<string, string>>;
  onCommit: () => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  /** Pattern brush stack, bottom-first. Each layer carries its own two colours,
   *  so the brush is independent of the active paint colour. */
  patternLayers: PatternLayer[];
  /** Hatch brush settings. Like the pattern stack, this carries its own colour
   *  rather than borrowing the paint swatch. */
  hatchBrush: HatchBrush;
  setHatchBrush: (patch: Partial<HatchBrush>) => void;
  /** Palette swatches the composited colour is snapped to. */
  quantizeTargets: QuantizeTarget[];
  flowerRadius: number;
  gridDivisions: number;
  symmetry: Symmetry;
  selectedHexes: { c: number; k: number }[];
  hexEnabled: boolean;
  layers: Layer[];
  activeLayerIdx: number;
  gridRotation: number;
  invCos: number;
  invSin: number;
  drag: React.MutableRefObject<DragState>;
  lastPaintTriRef: React.MutableRefObject<TriKey | null>;
  lastEditToolRef: React.MutableRefObject<Tool | null>;
  brushExpand: (tri: TriKey) => TriKey[];
  activeSelection: SelectionSnapshot | null;
  setActiveSelection: (s: SelectionSnapshot | null) => void;
  selections: SelectionSnapshot[];
  setSelections: React.Dispatch<React.SetStateAction<SelectionSnapshot[]>>;
  onStampCapture?: (c: number, k: number) => void;
  cloneSource: { x: number; y: number; q: number; r: number; type: string } | null;
  onCloneCapture?: (x: number, y: number, c: number, k: number, q: number, r: number, type: string) => void;
  cloneOffset: { x: number; y: number } | null;
  onCloneOffset?: (o: { x: number; y: number } | null) => void;
  captureMode: boolean;
  setCaptureMode: (v: boolean) => void;
  setSelectedHexes: React.Dispatch<React.SetStateAction<{ c: number; k: number }[]>>;
  /** Export crop region. View state, not authored content — it never enters the
   *  undo stack, so the crop tool deliberately does not call `onCommit`. */
  crop: CropRect;
  setCrop: React.Dispatch<React.SetStateAction<CropRect>>;
}

export interface ToolHandler {
  onDown?(
    ctx: ToolContext,
    e: React.PointerEvent,
    pos: Pt,
    isRightClick: boolean,
  ): void;
  onMove?(ctx: ToolContext, e: React.PointerEvent, pos: Pt): void;
  onUp?(ctx: ToolContext, e: React.PointerEvent, pos: Pt): void;
}
