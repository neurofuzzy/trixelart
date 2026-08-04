"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Confirmation step for spreading the artwork onto a new hex lattice.
 *
 * A small modal — the whole point is one decision, so it shows the current
 * hex size and asks for the new one. The slider and the number field share a
 * single value, so they can never disagree; the number field is what commits
 * an exact size.
 */
export function SpreadHexDialog({
  open,
  currentN,
  onApply,
  onClose,
}: {
  open: boolean;
  currentN: number;
  onApply: (newN: number) => void;
  onClose: () => void;
}) {
  const [newN, setNewN] = useState<number>(currentN);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const valid =
    Number.isInteger(newN) && newN >= 1 && newN <= 24 && newN !== currentN;

  const apply = () => {
    if (!valid) return;
    onApply(newN);
    onClose();
  };

  const clamped = Number.isFinite(newN)
    ? Math.min(24, Math.max(1, newN))
    : currentN;

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div
        className="fixed z-50 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl space-y-3 w-[22rem] max-w-[calc(100vw-2rem)]"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-sm">
            <Expand className="w-4 h-4" />
            Spread hex artwork
          </h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground leading-snug">
          Every hexagon of your artwork is re-centred on a hexagon of the new
          size, so the whole design spreads out with empty hexes of breathing
          room around each piece. Each hexagon keeps its contents and layout,
          and the change is a single undo step.
        </p>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Current hex size</span>
          <span className="font-mono tabular-nums">N={currentN}</span>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">New hex size</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={24}
              value={Number.isFinite(newN) ? newN : ""}
              autoFocus
              onChange={(e) => setNewN(Number(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
              }}
              className="h-9 w-16 rounded-md border border-input bg-background px-2 text-sm font-mono tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <input
              type="range"
              min={1}
              max={24}
              value={clamped}
              onChange={(e) => setNewN(Number(e.target.value))}
              className="flex-1 h-2 accent-cyan-500"
            />
          </div>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply} disabled={!valid}>
            Spread
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
