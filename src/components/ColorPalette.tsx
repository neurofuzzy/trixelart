"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PalettePicker } from "@/components/PalettePicker";
import { Palette } from "lucide-react";
import { PALETTES } from "@/lib/constants";

export function ColorPalette({
  color,
  palette,
  onColorChange,
  onPaletteChange,
  onPointerEnter,
}: {
  color: string;
  palette: string[];
  onColorChange: (color: string) => void;
  onPaletteChange: (colors: string[], idx: number) => void;
  onPointerEnter: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      className="absolute z-40 flex items-center gap-2 p-3 bg-card/80 backdrop-blur-lg border rounded-full shadow-2xl cursor-default
        bottom-12 left-1/2 -translate-x-1/2
        lg:flex-col lg:bottom-1/2 lg:left-4 lg:translate-x-0 lg:translate-y-1/2
        lg:rounded-full"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
    >
      {palette.map((c, i) => (
        <button
          key={c}
          onClick={() => onColorChange(c)}
          title={`Color ${i + 1} (${i + 1})`}
          className={cn(
            "w-8 h-8 rounded-full border-2 transition-all hover:scale-110 shrink-0",
            color === c
              ? "border-white scale-125 shadow-lg"
              : "border-white/10 opacity-70",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      <div className="relative ml-1 lg:ml-0 lg:mt-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen((v) => !v);
          }}
          title="Change palette"
        >
          <Palette className="w-4 h-4" />
        </Button>
        <PalettePicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(colors) => {
            const idx = PALETTES.findIndex((p) => p.colors === colors);
            onPaletteChange(colors, idx >= 0 ? idx : 0);
            setPickerOpen(false);
          }}
        />
      </div>
    </div>
  );
}
