"use client";

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function SymmetryPanel({
  isOpen,
  formula,
  onFormulaChange,
  extent,
  onExtentChange,
  onApply,
  onClose,
}: {
  isOpen: boolean;
  formula: string;
  onFormulaChange: (formula: string) => void;
  extent: number;
  onExtentChange: (extent: number) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      className="absolute top-4 left-4 w-80 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl z-50 space-y-4"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <span className="text-xl font-serif">ƒ</span> Symmetry Function
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Condition (a, b, c axes)
        </label>
        <textarea
          className="w-full h-20 p-2 text-sm bg-background border rounded-md font-mono resize-none focus:ring-2 focus:ring-primary outline-none"
          placeholder="e.g. a % 5 === 0"
          value={formula}
          onChange={(e) => onFormulaChange(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Extent (Range: {extent})
        </label>
        <input
          type="range"
          min="10"
          max="200"
          value={extent}
          onChange={(e) => onExtentChange(parseInt(e.target.value))}
          className="w-full accent-primary"
        />
      </div>

      <Button className="w-full" onClick={onApply}>
        Apply Rule to Grid
      </Button>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Variables <b>a, b, c</b> represent triangle-width strips. Sum{" "}
        <b>a+b+c</b> is 0 for &apos;up&apos; triangles and -1 for &apos;down&apos; triangles.
      </p>
    </div>
  );
}
