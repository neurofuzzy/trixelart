"use client";

import { cn } from "@/lib/utils";
import { GRAYSCALE_PALETTE } from "@/lib/constants";

export function ColorPalette({
  color,
  onColorChange,
}: {
  color: string;
  onColorChange: (color: string) => void;
}) {
  return (
    <div
      className="absolute z-40 flex items-center gap-2 p-3 bg-card/80 backdrop-blur-lg border rounded-full shadow-2xl
        bottom-12 left-1/2 -translate-x-1/2
        lg:flex-col lg:bottom-1/2 lg:left-4 lg:translate-x-0 lg:translate-y-1/2"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {GRAYSCALE_PALETTE.map((c, i) => (
        <button
          key={c}
          onClick={() => onColorChange(c)}
          title={`Color ${i + 1} (${i + 1})`}
          className={cn(
            "w-8 h-8 rounded-full border-2 transition-all hover:scale-110",
            color === c
              ? "border-white scale-125 shadow-lg"
              : "border-white/10 opacity-70",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
