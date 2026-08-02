"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { encodeColor } from "@/lib/constants";

/**
 * Modal for picking a single colour out of the whole palette set.
 *
 * Deliberately generic — it knows nothing about who is asking. The value is an
 * **encoded** `"paletteIdx,colorIdx"` string so the choice keeps tracking
 * `hueOffset`/`satOffset`, with a row of literal hexes for colours the palettes
 * cannot reach (they top out at 88% lightness, so pure white and black are not
 * expressible as swatches).
 *
 * Distinct from `PalettePicker`, which selects a whole nine-swatch palette for
 * the paint tool rather than one colour.
 */

/** Literal hexes offered alongside the palettes. `resolveColor` passes any
 *  string it cannot decode straight through, so these need no special case. */
export const NEUTRAL_COLORS = [
  "#ffffff",
  "#e5e5e5",
  "#a3a3a3",
  "#525252",
  "#000000",
];

export function ColorPickerDialog({
  open,
  onClose,
  value,
  onChange,
  palettes,
  title = "Colour",
}: {
  open: boolean;
  onClose: () => void;
  /** Encoded `"paletteIdx,colorIdx"` or a literal `#rrggbb`. */
  value: string;
  onChange: (encoded: string) => void;
  palettes: { name: string; colors: string[] }[];
  title?: string;
}) {
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

  const pick = (encoded: string) => {
    onChange(encoded);
    onClose();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div
        className="fixed z-50 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl space-y-3 w-[30rem] max-w-[calc(100vw-2rem)]"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto pr-1">
          {palettes.map((pal, pi) => (
            <div key={pal.name} className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-14 shrink-0 truncate">
                {pal.name}
              </span>
              <div className="flex gap-0.5 flex-1">
                {pal.colors.map((c, ci) => {
                  const encoded = encodeColor(pi, ci);
                  return (
                    <button
                      key={ci}
                      onClick={() => pick(encoded)}
                      title={`${pal.name} ${c}`}
                      className={cn(
                        "flex-1 h-6 rounded-sm border transition-all",
                        // Compared by encoding, not resolved hex: separate
                        // palettes can land on the same colour and would both
                        // read as selected.
                        value === encoded
                          ? "border-white scale-110"
                          : "border-white/10 hover:border-white/40",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <span className="text-[10px] text-muted-foreground w-14 shrink-0">
            Neutral
          </span>
          <div className="flex gap-0.5 flex-1">
            {NEUTRAL_COLORS.map((hex) => (
              <button
                key={hex}
                onClick={() => pick(hex)}
                title={hex}
                className={cn(
                  "flex-1 h-6 rounded-sm border transition-all",
                  value === hex
                    ? "border-white scale-110"
                    : "border-white/10 hover:border-white/40",
                )}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
