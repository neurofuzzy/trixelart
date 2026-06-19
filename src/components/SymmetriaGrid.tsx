
"use client";

import React, { useRef, useMemo } from "react";
import { cn } from "@/lib/utils";

interface SymmetriaGridProps {
  grid: (string | null)[];
  onCellClick: (index: number) => void;
  activeColor: string;
}

/**
 * SymmetriaGrid renders a single side-6 isotropic triangular grid.
 * Total cells: 1+3+5+7+9+11 = 36 triangles.
 * Centered at the centroid of the large equilateral triangle.
 */
export function SymmetriaGrid({ grid, onCellClick, activeColor }: SymmetriaGridProps) {
  const isDragging = useRef(false);
  const lastInteraction = useRef<number | null>(null);

  const SIDE = 60;
  const HEIGHT = SIDE * (Math.sqrt(3) / 2);
  const SVG_SIZE = 500;
  const CENTER_X = SVG_SIZE / 2;
  const CENTER_Y = SVG_SIZE / 2;

  // The centroid of a side-6 triangle is located 4 heights down from the tip (vertex)
  // because the total height is 6H, and the centroid of an equilateral triangle
  // is 2/3 down from the top. 2/3 * 6H = 4H.
  const OFFSET_Y = CENTER_Y - 4 * HEIGHT;

  const triangles = useMemo(() => {
    const list = [];
    // We render the side-6 triangle row by row
    // For 3-fold symmetry consistency with the hook, we map them into 3 logical sectors.
    for (let sector = 0; sector < 3; sector++) {
      const rotation = sector * 120;
      const rad = (rotation * Math.PI) / 180;

      // Each sector is a "kite" or "rhombus-like" section of 12 triangles
      // to ensure perfect 3-fold rotational mapping.
      const sectorTriangles = [
        { r: 0, c: 0, up: true }, // Tip
        { r: 1, c: 0, up: true }, { r: 1, c: 1, up: true }, { r: 1, c: 0, up: false },
        { r: 2, c: 0, up: true }, { r: 2, c: 1, up: true }, { r: 2, c: 2, up: true }, { r: 2, c: 0, up: false }, { r: 2, c: 1, up: false },
        { r: 3, c: 0, up: false }, { r: 3, c: 1, up: false }, { r: 3, c: 2, up: false }
      ];

      sectorTriangles.forEach((t) => {
        let x = (t.c - t.r / 2) * SIDE;
        let y = t.r * HEIGHT;

        const rotate = (px: number, py: number) => {
          const rx = px * Math.cos(rad) - py * Math.sin(rad);
          const ry = px * Math.sin(rad) + py * Math.cos(rad);
          return [rx + CENTER_X, ry + OFFSET_Y + (4 * HEIGHT)]; 
          // Note: we offset back to the centroid which we defined as the rotation pivot.
        };

        // Pivot rotation around (CENTER_X, CENTER_Y)
        const pivotX = CENTER_X;
        const pivotY = CENTER_Y;

        const rotateAroundPivot = (px: number, py: number) => {
          // Point relative to Tip
          let relX = (t.c - t.r / 2) * SIDE;
          let relY = t.r * HEIGHT;

          // Tip position relative to Pivot is (0, -4H)
          let finalRelX = relX;
          let finalRelY = relY - 4 * HEIGHT;

          // Rotate relative point
          const rx = finalRelX * Math.cos(rad) - finalRelY * Math.sin(rad);
          const ry = finalRelX * Math.sin(rad) + finalRelY * Math.cos(rad);

          return [rx + pivotX, ry + pivotY];
        };

        let p1, p2, p3;
        if (t.up) {
          p1 = rotateAroundPivot(0, 0);
          p2 = rotateAroundPivot(SIDE / 2, HEIGHT);
          p3 = rotateAroundPivot(-SIDE / 2, HEIGHT);
        } else {
          p1 = rotateAroundPivot(0, HEIGHT);
          p2 = rotateAroundPivot(SIDE / 2, 0);
          p3 = rotateAroundPivot(-SIDE / 2, 0);
        }

        list.push(`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`);
      });
    }
    return list;
  }, []);

  return (
    <div className="relative aspect-square w-full max-w-[500px] mx-auto select-none">
      <svg
        viewBox="0 0 500 500"
        className="w-full h-full drop-shadow-2xl"
        onMouseLeave={() => (isDragging.current = false)}
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
            onMouseDown={() => {
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
            onMouseUp={() => {
              isDragging.current = false;
            }}
          />
        ))}
        
        {/* Center of rotation indicator */}
        <circle cx="250" cy="250" r="4" className="fill-accent shadow-sm animate-pulse" />
      </svg>
    </div>
  );
}
