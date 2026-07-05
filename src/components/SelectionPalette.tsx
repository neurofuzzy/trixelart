"use client";

import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, RotateCw } from "lucide-react";

export function SelectionPalette({
  onShiftUp,
  onShiftDown,
  onRotate,
  hasSelection,
  onPointerEnter,
}: {
  onShiftUp: () => void;
  onShiftDown: () => void;
  onRotate: () => void;
  hasSelection: boolean;
  onPointerEnter: () => void;
}) {
  return (
    <div
      className="absolute z-40 flex items-center gap-2 p-3 bg-card/80 backdrop-blur-lg border rounded-full shadow-2xl cursor-default
        bottom-12 left-1/2 -translate-x-1/2
        lg:flex-col lg:bottom-1/2 lg:left-4 lg:translate-x-0 lg:translate-y-1/2"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
    >
      <div className="flex flex-row gap-px lg:flex-col lg:gap-px">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            onShiftUp();
          }}
          title="Shift colors lighter"
        >
          <ChevronUp className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            onShiftDown();
          }}
          title="Shift colors darker"
        >
          <ChevronDown className="w-4 h-4" />
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={(e) => {
          e.stopPropagation();
          onRotate();
        }}
        disabled={!hasSelection}
        title="Rotate selection 60° CW"
      >
        <RotateCw className="w-4 h-4" />
      </Button>
    </div>
  );
}
