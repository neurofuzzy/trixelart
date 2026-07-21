"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PalettePicker } from "@/components/PalettePicker";
import { Palette } from "lucide-react";

export function ColorPalette({
  color,
  palette,
  palettes,
  onColorChange,
  onPaletteChange,
  onPointerEnter,
  hueOffset,
  onHueOffsetChange,
  saturationOffset,
  onSaturationOffsetChange,
}: {
  color: string;
  palette: string[];
  palettes: { name: string; colors: string[] }[];
  onColorChange: (color: string) => void;
  onPaletteChange: (colors: string[], idx: number) => void;
  onPointerEnter: () => void;
  hueOffset?: number;
  onHueOffsetChange?: (v: number) => void;
  saturationOffset?: number;
  onSaturationOffsetChange?: (v: number) => void;
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
      data-tour="palette"
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
      <div className="relative ml-4 lg:ml-0 lg:mt-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full [&_svg]:size-6"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen((v) => !v);
          }}
          title="Change palette"
        >
          <Palette />
        </Button>
        <PalettePicker
          palettes={palettes}
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(colors) => {
            const idx = palettes.findIndex((p) => p.colors === colors);
            onPaletteChange(colors, idx >= 0 ? idx : 0);
            setPickerOpen(false);
          }}
          hueOffset={hueOffset}
          onHueOffsetChange={onHueOffsetChange}
          saturationOffset={saturationOffset}
          onSaturationOffsetChange={onSaturationOffsetChange}
        />
      </div>
    </div>
  );
}
