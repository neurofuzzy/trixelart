
"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils";

interface SymmetriaGridProps {
  grid: (string | null)[];
  onCellClick: (index: number) => void;
  activeColor: string;
}

/**
 * SymmetriaGrid renders a 36-triangle isotropic triangular grid.
 * It forms a large equilateral triangle of side-6.
 * The layout is divided into 3 sectors of 12 triangles each for perfect symmetry.
 */
export function SymmetriaGrid({ grid, onCellClick, activeColor }: SymmetriaGridProps) {
  const isDragging = useRef(false);
  const lastInteraction = useRef<number | null>(null);

  // Constants for triangle geometry
  const SIDE = 60; // Side length of a small equilateral triangle
  const HEIGHT = SIDE * (Math.sqrt(3) / 2);
  const OFFSET_X = 250;
  const OFFSET_Y = 250;

  /**
   * Generates the SVG polygon points for a triangle at a specific position in the side-6 grid.
   * We use a row-based coordinate system within each sector to ensure 3-fold symmetry.
   */
  const getTrianglePoints = (index: number) => {
    const sector = Math.floor(index / 12);
    const subIndex = index % 12;

    // Define coordinates within a single 12-triangle "kite" sector.
    // The kite is made of 4 rows: Row 0 (1), Row 1 (2), Row 2 (3), Row 3 (4)? No, 1+3+5...
    // For a 12-triangle sector of a side-6 triangle:
    // We can define it by its coordinates (u, v) in a triangular lattice.
    const coords = [
      { u: 0, v: 0, up: true }, // Row 0
      { u: 1, v: 0, up: true }, { u: 0, v: 0, up: false }, { u: 0, v: 1, up: true }, // Row 1
      { u: 2, v: 0, up: true }, { u: 1, v: 0, up: false }, { u: 1, v: 1, up: true }, { u: 0, v: 1, up: false }, { u: 0, v: 2, up: true }, // Row 2
      { u: 2, v: 0, up: false }, { u: 1, v: 1, up: false }, { u: 3, v: 0, up: true } // Filling out the rest to 12
    ];

    // Better way: explicitly map the 12 triangles of one sector.
    const sectorLayout = [
      // row 0 (nearest center)
      { r: 0, c: 0, type: 'up' }, 
      // row 1
      { r: 1, c: 0, type: 'up' }, { r: 1, c: 1, type: 'up' }, { r: 1, c: 0, type: 'down' },
      // row 2
      { r: 2, c: 0, type: 'up' }, { r: 2, c: 1, type: 'up' }, { r: 2, c: 2, type: 'up' }, { r: 2, c: 0, type: 'down' }, { r: 2, c: 1, type: 'down' },
      // extra 3 to make 12 (completing a side-6 triangle segment)
      { r: 3, c: 0, type: 'down' }, { r: 3, c: 1, type: 'down' }, { r: 3, c: 2, type: 'down' }
    ];

    const item = sectorLayout[subIndex];
    if (!item) return "";

    // Calculate base position in an equilateral coordinate system
    let x = (item.c - item.r / 2) * SIDE;
    let y = item.r * HEIGHT;

    // Rotation angle for the sector
    const rotation = sector * 120;
    const rad = (rotation * Math.PI) / 180;

    const rotate = (px: number, py: number) => {
      const nx = px * Math.cos(rad) - py * Math.sin(rad);
      const ny = px * Math.sin(rad) + py * Math.cos(rad);
      return [nx + OFFSET_X, ny + OFFSET_Y];
    };

    let p1, p2, p3;
    if (item.type === 'up') {
      p1 = rotate(x, y);
      p2 = rotate(x + SIDE / 2, y + HEIGHT);
      p3 = rotate(x - SIDE / 2, y + HEIGHT);
    } else {
      p1 = rotate(x, y + HEIGHT);
      p2 = rotate(x + SIDE / 2, y);
      p3 = rotate(x - SIDE / 2, y);
    }

    return `${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`;
  };

  return (
    <div className="relative aspect-square w-full max-w-[500px] mx-auto select-none">
      <svg
        viewBox="0 0 500 500"
        className="w-full h-full drop-shadow-2xl"
        onMouseLeave={() => (isDragging.current = false)}
      >
        {/* Subtle background circle */}
        <circle cx="250" cy="250" r="240" className="fill-card/50 stroke-border/20" strokeWidth="1" />
        
        {grid.map((color, i) => (
          <polygon
            key={i}
            points={getTrianglePoints(i)}
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
        
        {/* Center indicator */}
        <circle cx="250" cy="250" r="3" className="fill-accent shadow-sm" />
      </svg>
    </div>
  );
}
