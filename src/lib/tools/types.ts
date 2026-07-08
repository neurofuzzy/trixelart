import type React from "react";
import type { TriKey } from "@/lib/grid-math";
import type { Symmetry, SelectionSnapshot } from "@/lib/hex-flower";

export type Tool =
  | "paint"
  | "erase"
  | "pan"
  | "select"
  | "stamp"
  | "dodge"
  | "burn"
  | "eyedropper";

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
  flowerRadius: number;
  gridDivisions: number;
  symmetry: Symmetry;
  selectedHex: { c: number; k: number } | null;
  hexEnabled: boolean;
  gridRotation: number;
  invCos: number;
  invSin: number;
  drag: React.MutableRefObject<DragState>;
  lastPaintTriRef: React.MutableRefObject<TriKey | null>;
  lastEditToolRef: React.MutableRefObject<Tool | null>;
  brushExpand: (tri: TriKey) => TriKey[];
  activeSelection: SelectionSnapshot | null;
  setActiveSelection: (s: SelectionSnapshot | null) => void;
  setSelections: React.Dispatch<React.SetStateAction<SelectionSnapshot[]>>;
  onStampCapture?: (c: number, k: number) => void;
  captureMode: boolean;
  setCaptureMode: (v: boolean) => void;
  setSelectedHex: (h: { c: number; k: number } | null) => void;
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
