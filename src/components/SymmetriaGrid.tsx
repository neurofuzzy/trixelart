
"use client";

import React, { useRef, useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SymmetriaGridProps {
  grid: (string | null)[];
  onCellClick: (index: number) => void;
  activeColor: string;
}

/**
 * SymmetriaGrid renders a 36-triangle isotropic grid.
 * It is constructed of 3 rhombi (each 2x3 units) meeting at a central vertex.
 * This ensures perfect 3-fold symmetry and a clean, paintable center.
 */
export function SymmetriaGrid({ grid, onCellClick, activeColor }: SymmetriaGridProps) {
  const isDragging = useRef(false);
  const lastInteraction = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const SIDE = 45;
  const SVG_SIZE = 500;
  const CENTER_X = SVG_SIZE / 2;
  const CENTER_Y = SVG_SIZE / 2;

  const triangles = useMemo(() => {
    const list: string[] = [];
    const H = SIDE * (Math.sqrt(3) / 2);

    // Vector basis for a rhombus with 120 degree interior angle at origin
    const u = { x: SIDE, y: 0 };
    const v = { 
      x: SIDE * Math.cos((2 * Math.PI) / 3), 
      y: SIDE * Math.sin((2 * Math.PI) / 3) 
    };

    // 3 sectors (rhombi)
    for (let s = 0; s < 3; s++) {
      const rotationAngle = (s * 120 * Math.PI) / 180;

      // Each sector is a 2x3 rhombus (6 unit rhombi = 12 triangles)
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 3; b++) {
          const p1 = { x: a * u.x + b * v.x, y: a * u.y + b * v.y };
          const p2 = { x: (a + 1) * u.x + b * v.x, y: (a + 1) * u.y + b * v.y };
          const p3 = { x: (a + 1) * u.x + (b + 1) * v.x, y: (a + 1) * u.y + (b + 1) * v.y };
          const p4 = { x: a * u.x + (b + 1) * v.x, y: a * u.y + (b + 1) * v.y };

          const rotate = (p: { x: number; y: number }) => {
            const nx = p.x * Math.cos(rotationAngle) - p.y * Math.sin(rotationAngle);
            const ny = p.x * Math.sin(rotationAngle) + p.y * Math.cos(rotationAngle);
            // Use fixed precision to prevent hydration mismatches
            return [(nx + CENTER_X).toFixed(3), (ny + CENTER_Y).toFixed(3)];
          };

          const pts1 = [rotate(p1), rotate(p2), rotate(p3)];
          const pts2 = [rotate(p1), rotate(p3), rotate(p4)];

          list.push(pts1.map(p => p.join(',')).join(' '));
          list.push(pts2.map(p => p.join(',')).join(' '));
        }
      }
    }
    return list;
  }, [SIDE, CENTER_X, CENTER_Y]);

  if (!mounted) {
    return (
      <div className="relative aspect-square w-full max-w-[500px] mx-auto bg-card/10 animate-pulse rounded-full" />
    );
  }

  return (
    <div className="relative aspect-square w-full max-w-[500px] mx-auto select-none">
      <svg
        viewBox="0 0 500 500"
        className="w-full h-full drop-shadow-2xl"
        onMouseLeave={() => (isDragging.current = false)}
        onMouseUp={() => (isDragging.current = false)}
      >
        <circle cx="250" cy="250" r="240" className="fill-card/30 stroke-border/10" strokeWidth="1" />
        
        {grid.map((color, i) => (
          <polygon
            key={i}
            points={triangles[i]}
            fill={color || "transparent"}
            stroke="currentColor"
            strokeWidth="0.5"
            className={cn(
              "cursor-pointer transition-all duration-300 hover:opacity-80",
              color ? "stroke-black/10 dark:stroke-white/10" : "text-muted-foreground/20 hover:text-muted-foreground/40"
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              isDragging.current = true;
              onCellClick(i);
              lastInteraction.current = i;
            }}
            onMouseEnter={() => {
              if (isDragging.current && lastInteraction.current !== i) {
                onCellClick(i);
                lastInteraction.current = i;
              }
            }}
          />
        ))}
        
        {/* Center vertex indicator */}
        <circle cx="250" cy="250" r="4" className="fill-accent shadow-sm animate-pulse pointer-events-none" />
      </svg>
    </div>
  );
}
