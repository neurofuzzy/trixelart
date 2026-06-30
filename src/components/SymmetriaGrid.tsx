"use client";

import React, { useRef, useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SymmetriaGridProps {
  grid: (string | null)[];
  onCellClick: (index: number) => void;
  activeColor: string;
}

/**
 * SymmetriaGrid renders a unified 36-triangle side-6 equilateral grid.
 * Centered on its centroid for a balanced drawing experience.
 */
export function SymmetriaGrid({ grid, onCellClick, activeColor }: SymmetriaGridProps) {
  const isDragging = useRef(false);
  const lastInteraction = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const SIDE_UNIT = 60;
  const SVG_SIZE = 500;
  const CENTER_X = SVG_SIZE / 2;
  const CENTER_Y = SVG_SIZE / 2;

  const triangles = useMemo(() => {
    const list: string[] = [];
    const H = (Math.sqrt(3) / 2) * SIDE_UNIT;
    
    const totalHeight = 6 * H;
    const totalWidth = 6 * SIDE_UNIT;
    
    const centroidOffset = {
      x: totalWidth / 2,
      y: totalHeight / 3 
    };

    for (let r = 0; r < 6; r++) {
      const rowY = (6 - r) * H;
      const startX = (6 - r - 1) * (SIDE_UNIT / 2);

      for (let k = 0; k < 2 * r + 1; k++) {
        const isUpward = k % 2 === 0;
        let p1, p2, p3;

        if (isUpward) {
          p1 = { x: startX + (k / 2) * SIDE_UNIT, y: rowY };
          p2 = { x: startX + (k / 2 + 1) * SIDE_UNIT, y: rowY };
          p3 = { x: startX + (k / 2 + 0.5) * SIDE_UNIT, y: rowY - H };
        } else {
          p1 = { x: startX + Math.floor(k / 2) * SIDE_UNIT + SIDE_UNIT / 2, y: rowY - H };
          p2 = { x: startX + Math.floor(k / 2) * SIDE_UNIT + 1.5 * SIDE_UNIT, y: rowY - H };
          p3 = { x: startX + Math.floor(k / 2) * SIDE_UNIT + SIDE_UNIT, y: rowY };
        }

        const format = (p: { x: number; y: number }) => {
          const finalX = (p.x - centroidOffset.x + CENTER_X).toFixed(6);
          const finalY = (p.y - (totalHeight - centroidOffset.y) + CENTER_Y).toFixed(6);
          return `${finalX},${finalY}`;
        };

        list.push([format(p1), format(p2), format(p3)].join(' '));
      }
    }
    return list;
  }, [SIDE_UNIT, CENTER_X, CENTER_Y]);

  if (!mounted) {
    return <div className="aspect-square w-full max-w-[500px] mx-auto bg-card/10 animate-pulse rounded-full" />;
  }

  const handleInteraction = (i: number) => {
    if (lastInteraction.current !== i) {
      onCellClick(i);
      lastInteraction.current = i;
    }
  };

  return (
    <div className="relative aspect-square w-full max-w-[500px] mx-auto select-none">
      <svg
        viewBox="0 0 500 500"
        className="w-full h-full drop-shadow-2xl"
        onMouseLeave={() => (isDragging.current = false)}
        onMouseUp={() => (isDragging.current = false)}
      >
        {grid.map((color, i) => (
          <polygon
            key={i}
            points={triangles[i]}
            fill={color || "transparent"}
            stroke="currentColor"
            strokeWidth="0.5"
            className={cn(
              "cursor-pointer transition-colors duration-200",
              color 
                ? "stroke-white/10" 
                : "text-muted-foreground/10 hover:text-muted-foreground/30"
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              isDragging.current = true;
              onCellClick(i);
              lastInteraction.current = i;
            }}
            onMouseEnter={() => {
              if (isDragging.current) {
                handleInteraction(i);
              }
            }}
          />
        ))}
      </svg>
    </div>
  );
}
