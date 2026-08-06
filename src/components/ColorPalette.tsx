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
  onNoPrintSelect,
  noPrintActive = false,
  hueOffset,
  onHueOffsetChange,
  saturationOffset,
  onSaturationOffsetChange,
  raised = false,
}: {
  color: string;
  palette: string[];
  palettes: { name: string; colors: string[] }[];
  onColorChange: (color: string) => void;
  onPaletteChange: (colors: string[], idx: number) => void;
  onPointerEnter: () => void;
  /** Selects the no-print marker as the paint colour. */
  onNoPrintSelect?: () => void;
  noPrintActive?: boolean;
  hueOffset?: number;
  onHueOffsetChange?: (v: number) => void;
  saturationOffset?: number;
  onSaturationOffsetChange?: (v: number) => void;
  /** Lifts the small-screen position clear of the hatch bar, which occupies the
   *  bottom of the canvas. The `lg:` layout is on the left edge and unaffected. */
  raised?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      className={cn(
        `absolute z-40 flex items-center gap-2 p-3 bg-card/80 backdrop-blur-lg border rounded-full shadow-2xl cursor-default
        left-1/2 -translate-x-1/2
        lg:flex-col lg:bottom-1/2 lg:left-4 lg:translate-x-0 lg:translate-y-1/2
        lg:rounded-full`,
        raised ? "bottom-24" : "bottom-12",
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
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
            // `colorIdx` is deliberately kept while the no-print pen is active,
            // so that leaving the marker restores the last colour. The strip
            // must therefore drop its highlight explicitly, or two swatches
            // read as selected at once.
            !noPrintActive && color === c
              ? "border-white scale-125 shadow-lg"
              : "border-white/10 opacity-70",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      {/* The no-print marker. Deliberately not part of the strip above: that
          strip is keyed and selected by resolved hex, and the marker has no hex
          — it is a construction mark that shapes corners and never renders. */}
      {onNoPrintSelect && (
        <button
          onClick={onNoPrintSelect}
          title="No-print marker — shapes corners, never renders (0)"
          className={cn(
            "w-8 h-8 rounded-full border-2 transition-all hover:scale-110 shrink-0 flex items-center justify-center",
            noPrintActive
              ? "border-white scale-125 shadow-lg"
              : "border-white/10 opacity-70",
          )}
          style={{
            // Reads as tape rather than paint, and matches the magenta the
            // canvas draws markers in.
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(236,72,153,0.55) 0 3px, transparent 3px 6px)",
          }}
        >
          <span className="w-3 h-3 rounded-full border border-white/40" />
        </button>
      )}
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
