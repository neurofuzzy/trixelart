"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function PalettePicker({
  palettes,
  isOpen,
  onClose,
  onSelect,
  hueOffset,
  onHueOffsetChange,
  saturationOffset,
  onSaturationOffsetChange,
}: {
  palettes: { name: string; colors: string[] }[];
  isOpen: boolean;
  onClose: () => void;
  onSelect: (colors: string[]) => void;
  hueOffset?: number;
  onHueOffsetChange?: (v: number) => void;
  saturationOffset?: number;
  onSaturationOffsetChange?: (v: number) => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 bg-black/20" onClick={onClose} />
      <div
        className="fixed z-50 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl space-y-3 w-[32rem] max-w-[calc(100vw-2rem)]"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Palettes</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {palettes.map((pal) => (
          <button
            key={pal.name}
            onClick={() => {
              onSelect(pal.colors);
              onClose();
            }}
            className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent transition-colors text-left"
          >
            <div className="flex gap-0.5 flex-1">
              {pal.colors.map((c) => (
                <div
                  key={c}
                  className="flex-1 h-5 rounded first:rounded-l last:rounded-r border border-white/10"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground w-14 text-right">
              {pal.name}
            </span>
          </button>
        ))}
        </div>

        <div className="border-t border-border pt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Hue offset
            </span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={-180}
                max={180}
                value={hueOffset ?? 0}
                onChange={(e) =>
                  onHueOffsetChange?.(Number(e.target.value))
                }
                className="flex-1 h-2 accent-cyan-500"
              />
              <span className="text-xs font-mono text-muted-foreground w-10 text-right">
                {hueOffset ?? 0}°
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Saturation offset
            </span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={-100}
                max={100}
                value={saturationOffset ?? 0}
                onChange={(e) =>
                  onSaturationOffsetChange?.(Number(e.target.value))
                }
                className="flex-1 h-2 accent-cyan-500"
              />
              <span className="text-xs font-mono text-muted-foreground w-10 text-right">
                {saturationOffset ?? 0}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => {
              onHueOffsetChange?.(0);
              onSaturationOffsetChange?.(0);
            }}
          >
            Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </div>
    </>,
    document.body
  );
}
