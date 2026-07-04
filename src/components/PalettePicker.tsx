"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { PALETTES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function PalettePicker({
  isOpen,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (colors: string[]) => void;
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
        className="fixed z-50 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl space-y-3 w-72 max-w-[calc(100vw-2rem)]"
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

      <div className="space-y-2">
        {PALETTES.map((pal) => (
          <button
            key={pal.name}
            onClick={() => {
              onSelect(pal.colors);
              onClose();
            }}
            className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-accent transition-colors text-left"
          >
            <div className="flex gap-0.5 flex-1">
              {pal.colors.map((c) => (
                <div
                  key={c}
                  className="flex-1 h-6 rounded first:rounded-l last:rounded-r border border-white/10"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground w-16 text-right">
              {pal.name}
            </span>
          </button>
        ))}
        </div>
      </div>
    </>,
    document.body
  );
}
