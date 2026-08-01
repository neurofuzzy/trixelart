"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { resolveColor } from "@/lib/constants";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  makePatternPainter,
  type PatternPreset,
  type QuantizeTarget,
} from "@/lib/tri-pattern";
import { SLOT_SPAN, SLOT_TRIS, paintPatternCanvas } from "@/lib/pattern-render";

/**
 * Saved pattern stacks, in the same left-hand dock the colour and stamp
 * palettes use.
 *
 * Replaces the colour palette while the pattern tool is active: the brush takes
 * every colour from its own stack, so the paint swatches control nothing and
 * clicking one would silently switch tools.
 */

function PresetSwatch({
  preset,
  active,
  quantizeTargets,
  onClick,
  onDelete,
}: {
  preset: PatternPreset;
  active: boolean;
  quantizeTargets: QuantizeTarget[];
  onClick: () => void;
  onDelete: (p: PatternPreset) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Long-press to delete, matching the stamp palette.
  const startPress = useCallback(() => {
    timerRef.current = setTimeout(() => setConfirmOpen(true), 500);
  }, []);
  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const paint = makePatternPainter(preset.layers, quantizeTargets);
    paintPatternCanvas(c, SLOT_SPAN, SLOT_TRIS, (t) => resolveColor(paint(t)));
  }, [preset, quantizeTargets]);

  return (
    <>
      <button
        onClick={onClick}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        title="Load this pattern (long-press to delete)"
        className={cn(
          "w-8 h-8 rounded-full border-2 transition-all hover:scale-110 overflow-hidden p-0 bg-background shrink-0",
          active
            ? "border-white scale-125 shadow-lg"
            : "border-white/10 opacity-70",
        )}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pattern?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the pattern from the palette.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(preset)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function PatternPalette({
  presets,
  activePresetId,
  quantizeTargets,
  onSelect,
  onCapture,
  onDelete,
  onPointerEnter,
}: {
  presets: PatternPreset[];
  activePresetId: string | null;
  quantizeTargets: QuantizeTarget[];
  onSelect: (p: PatternPreset) => void;
  onCapture: () => void;
  onDelete: (p: PatternPreset) => void;
  onPointerEnter: () => void;
}) {
  return (
    <div
      className="absolute z-40 flex items-center gap-2 p-3 bg-card/80 backdrop-blur-lg border rounded-full shadow-2xl cursor-default
        bottom-12 left-1/2 -translate-x-1/2
        lg:flex-col lg:bottom-1/2 lg:left-4 lg:translate-x-0 lg:translate-y-1/2"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour="pattern-palette"
    >
      {presets.map((p) => (
        <PresetSwatch
          key={p.id}
          preset={p}
          active={p.id === activePresetId}
          quantizeTargets={quantizeTargets}
          onClick={() => onSelect(p)}
          onDelete={onDelete}
        />
      ))}
      <button
        onClick={onCapture}
        title="Save the current pattern to the palette"
        className="w-8 h-8 rounded-full border-2 border-dashed border-white/30 hover:border-white/60 hover:scale-110 transition-all flex items-center justify-center text-white/50 hover:text-white/80 text-lg font-bold shrink-0"
      >
        +
      </button>
    </div>
  );
}
