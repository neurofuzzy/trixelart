"use client";

import { cn } from "@/lib/utils";
import { SIDE, H } from "@/lib/grid-math";
import type { SelectionSnapshot } from "@/lib/hex-flower";

function SelectionSwatch({
  snap,
  active,
  onClick,
}: {
  snap: SelectionSnapshot;
  active: boolean;
  onClick: () => void;
}) {
  const s = snap.N * SIDE;
  const pad = 4;
  const viewBox = `${-s - pad} ${-s - pad} ${2 * s + 2 * pad} ${2 * s + 2 * pad}`;
  const tris = snap.trixels;

  return (
    <button
      onClick={onClick}
      title="Stamp from this selection"
      className={cn(
        "w-8 h-8 rounded-full border-2 transition-all hover:scale-110 overflow-hidden p-0 bg-background",
        active
          ? "border-white scale-125 shadow-lg"
          : "border-white/10 opacity-70",
      )}
    >
      <svg viewBox={viewBox} className="w-full h-full block" preserveAspectRatio="xMidYMid meet">
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
              <polygon key={i} points={`${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]}`} fill={t.color} />
            );
          }
          const [a, b, c] = [
            [bx + SIDE / 2, by + H],
            [bx + SIDE * 1.5, by + H],
            [bx + SIDE, by],
          ];
          return (
            <polygon key={i} points={`${a[0]},${a[1]} ${b[0]},${b[1]} ${c[0]},${c[1]}`} fill={t.color} />
          );
        })}
      </svg>
    </button>
  );
}

export function SelectionPalette({
  selections,
  activeSelectionId,
  onSelect,
  onPointerEnter,
}: {
  selections: SelectionSnapshot[];
  activeSelectionId: string | null;
  onSelect: (s: SelectionSnapshot) => void;
  onPointerEnter: () => void;
}) {
  if (selections.length === 0) return null;

  return (
    <div
      className="absolute z-40 flex items-center gap-2 p-3 bg-card/80 backdrop-blur-lg border rounded-full shadow-2xl cursor-default
        bottom-12 left-1/2 -translate-x-1/2
        lg:flex-col lg:bottom-1/2 lg:left-4 lg:translate-x-0 lg:translate-y-1/2"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
    >
      {selections.map((s) => (
        <SelectionSwatch
          key={s.id}
          snap={s}
          active={s.id === activeSelectionId}
          onClick={() => onSelect(s)}
        />
      ))}
    </div>
  );
}