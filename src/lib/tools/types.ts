import type React from "react";
import type { TriKey } from "@/lib/grid-math";
import type { Symmetry, SelectionSnapshot } from "@/lib/hex-flower";
import type { Layer } from "@/hooks/use-history";
import type { PatternLayer, QuantizeTarget } from "@/lib/tri-pattern";
import type { CropHandle, CropRect } from "@/lib/crop";

export type Tool =
  | "paint"
  | "erase"
  | "fill"
  | "pattern"
  | "pan"
  | "select"
  | "stamp"
  | "clone"
  | "dodge"
  | "burn"
  | "eyedropper"
  | "crop";

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
      items: Array<{
        sourceHex: { c: number; k: number };
        snapshot: Array<{ dq: number; dr: number; type: TriKey["type"]; color: string }>;
      }>;
      N: number;
    };

export interface ToolContext {
  view: View;
  setView: React.Dispatch<React.SetStateAction<View>>;
  screenToWorld: (sx: number, sy: number) => Pt;
  painted: Record<string, string>;
  setPainted: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  paintedRef: React.MutableRefObject<Record<string, string>>;
  onCommit: () => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  /** Pattern brush stack, bottom-first. Each layer carries its own two colours,
   *  so the brush is independent of the active paint colour. */
  patternLayers: PatternLayer[];
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
