"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { SIDE, H } from "@/lib/grid-math";
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
import type { SelectionSnapshot } from "@/lib/hex-flower";

function SelectionSwatch({
  snap,
  active,
  onClick,
  onDelete,
  gridRotation = 0,
}: {
  snap: SelectionSnapshot;
  active: boolean;
  onClick: () => void;
  onDelete: (snap: SelectionSnapshot) => void;
  gridRotation?: number;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPress = useCallback(() => {
    timerRef.current = setTimeout(() => setConfirmOpen(true), 500);
  }, []);

  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const s = snap.N * SIDE;
  const pad = 4;
  const viewBox = `${-s - pad} ${-s - pad} ${2 * s + 2 * pad} ${2 * s + 2 * pad}`;
  const tris = snap.trixels;
  // SVG rotate takes degrees; gridRotation arrives in radians.
  const rotateDeg = (gridRotation * 180) / Math.PI;

  return (
    <>
      <button
        onClick={onClick}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        title="Stamp from this selection"
        className={cn(
          "w-8 h-8 rounded-full border-2 transition-all hover:scale-110 overflow-hidden p-0 bg-background",
          active
            ? "border-white scale-125 shadow-lg"
            : "border-white/10 opacity-70",
        )}
      >
        <svg viewBox={viewBox} className="w-full h-full block" preserveAspectRatio="xMidYMid meet">
          <g transform={`rotate(${rotateDeg})`}>
            {tris.map((t, i) => {
              const q = t.dq;
              const r = t.dr;
              const bx = q * SIDE + (r * SIDE) / 2;
              const by = r * H;
              if (t.type === "up") {
                const [a, b, c] = [
                  [bx, by],
                  [bx + SIDE, by],
                  [bx + SIDE / 2, by + H],
                ];
                return (
                  <polygon key={i} points={`${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]}`} fill={resolveColor(t.color)} />
                );
              }
              const [a, b, c] = [
                [bx + SIDE / 2, by + H],
                [bx + SIDE * 1.5, by + H],
                [bx + SIDE, by],
              ];
              return (
                <polygon key={i} points={`${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]}`} fill={resolveColor(t.color)} />
              );
            })}
          </g>
        </svg>
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
            <AlertDialogAction onClick={() => onDelete(snap)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function StampPalette({
  selections,
  activeSelectionId,
  onSelect,
  onPointerEnter,
  onDelete,
  onCapture,
  gridRotation = 0,
}: {
  selections: SelectionSnapshot[];
  activeSelectionId: string | null;
  onSelect: (s: SelectionSnapshot) => void;
  onPointerEnter: () => void;
  onDelete: (snap: SelectionSnapshot) => void;
  onCapture: () => void;
  gridRotation?: number;
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
    >
      {selections.map((s) => (
        <SelectionSwatch
          key={s.id}
          snap={s}
          active={s.id === activeSelectionId}
          onClick={() => onSelect(s)}
          onDelete={onDelete}
          gridRotation={gridRotation}
        />
      ))}
      <button
        onClick={onCapture}
        title="Capture a new stamp pattern"
        className="w-8 h-8 rounded-full border-2 border-dashed border-white/30 hover:border-white/60 hover:scale-110 transition-all flex items-center justify-center text-white/50 hover:text-white/80 text-lg font-bold shrink-0"
      >
        +
      </button>
    </div>
  );
}
