"use client";

import { useMemo } from "react";
import { getTriABC, type TriKey } from "@/lib/grid-math";

export function AbcDisplay({ hoveredTri }: { hoveredTri: TriKey | null }) {
  const content = useMemo(() => {
    if (!hoveredTri) return null;
    const { a, b, c } = getTriABC(hoveredTri.q, hoveredTri.r, hoveredTri.type);
    return (
      <div className="absolute bottom-4 right-4 px-3 py-1 bg-card/90 backdrop-blur-md border rounded-full text-[10px] font-mono shadow-xl z-50 flex gap-3">
        <span className="flex items-center gap-1.5">
          <span className="text-primary font-bold">a</span> {a}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-primary font-bold">b</span> {b}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-primary font-bold">c</span> {c}
        </span>
        <span className="text-muted-foreground uppercase">
          {hoveredTri.type}
        </span>
      </div>
    );
  }, [hoveredTri]);

  return content;
}
