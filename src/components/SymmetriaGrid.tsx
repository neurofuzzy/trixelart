
"use client";

import React, { useRef, useMemo, useState, useEffect } from "react";
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const SIDE = 60;
  const HEIGHT = SIDE * (Math.sqrt(3) / 2);
  const SVG_SIZE = 500;
  const CENTER_X = SVG_SIZE / 2;
  const CENTER_Y = SVG_SIZE / 2;

  const triangles = useMemo(() => {
    const list = [];
    // We render the side-6 triangle row by row
    // For 3-fold symmetry consistency, we map them into 3 logical sectors.
    for (let sector = 0; sector < 3; sector++) {
      const rotation = sector * 120;
      const rad = (rotation * Math.PI) / 180;

      const sectorTriangles = [
        { r: 0, c: 0, up: true }, // Tip
        { r: 1, c: 0, up: true }, { r: 1, c: 1, up: true }, { r: 1, c: 0, up: false },
        { r: 2, c: 0, up: true }, { r: 2, c: 1, up: true }, { r: 2, c: 2, up: true }, { r: 2, c: 0, up: false }, { r: 2, c: 1, up: false },
        { r: 3, c: 0, up: false }, { r: 3, c: 1, up: false }, { r: 3, c: 2, up: false }
      ];

      sectorTriangles.forEach((t) => {
        const pivotX = CENTER_X;
        const pivotY = CENTER_Y;

        const rotateAroundPivot = (relX: number, relY: number) => {
          // Tip position relative to Pivot is (0, -4H)
          let finalRelX = relX;
          let finalRelY = relY - 4 * HEIGHT;

          // Rotate relative point
          const rx = finalRelX * Math.cos(rad) - finalRelY * Math.sin(rad);
          const ry = finalRelX * Math.sin(rad) + finalRelY * Math.cos(rad);

          // Use toFixed to prevent hydration mismatches from floating point drift
          return [(rx + pivotX).toFixed(3), (ry + pivotY).toFixed(3)];
        };

        let p1, p2, p3;
        const rX = (t.c - t.r / 2) * SIDE;
        const rY = t.r * HEIGHT;

        if (t.up) {
          p1 = rotateAroundPivot(rX, rY);
          p2 = rotateAroundPivot(rX + SIDE / 2, rY + HEIGHT);
          p3 = rotateAroundPivot(rX - SIDE / 2, rY + HEIGHT);
        } else {
          p1 = rotateAroundPivot(rX, rY + HEIGHT);
          p2 = rotateAroundPivot(rX + SIDE / 2, rY);
          p3 = rotateAroundPivot(rX - SIDE / 2, rY);
        }

        list.push(`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`);
      });
    }
    return list;
  }, [CENTER_X, CENTER_Y, HEIGHT]);

  // Prevent hydration mismatch by only rendering after component mounts
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
