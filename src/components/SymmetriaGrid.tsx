"use client";

import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface SymmetriaGridProps {
  grid: (string | null)[];
  onCellClick: (index: number) => void;
  activeColor: string;
}

export function SymmetriaGrid({ grid, onCellClick, activeColor }: SymmetriaGridProps) {
  const isDragging = useRef(false);
  const lastInteraction = useRef<number | null>(null);

  const renderTriangle = (index: number) => {
    const sector = Math.floor(index / 12);
    const subIndex = index % 12;
    
    // We create a radial layout. 
    // 3 sectors of 120 degrees.
    // Each sector has 12 triangles.
    // Inner ring (4 triangles), Outer ring (8 triangles).
    
    const rotation = sector * 120;
    const angleStep = 120 / 4; // 4 chunks in each sector
    const chunk = Math.floor(subIndex / 3); // 0, 1, 2, 3
    const triangleInChunk = subIndex % 3; // 0, 1, 2

    const startAngle = rotation + chunk * angleStep;
    const endAngle = startAngle + angleStep;
    const midAngle = (startAngle + endAngle) / 2;

    const r0 = 0;
    const r1 = 120;
    const r2 = 240;

    let points = "";
    if (subIndex < 4) {
      // Inner ring: 4 large triangles
      const sa = rotation + subIndex * 30;
      const ea = sa + 30;
      const x1 = 250 + r1 * Math.cos((sa * Math.PI) / 180);
      const y1 = 250 + r1 * Math.sin((sa * Math.PI) / 180);
      const x2 = 250 + r1 * Math.cos((ea * Math.PI) / 180);
      const y2 = 250 + r1 * Math.sin((ea * Math.PI) / 180);
      points = `250,250 ${x1},${y1} ${x2},${y2}`;
    } else {
      // Outer ring: 8 triangles
      const outerSub = subIndex - 4; // 0..7
      const sa = rotation + outerSub * 15;
      const ea = sa + 15;
      const x1 = 250 + r1 * Math.cos((sa * Math.PI) / 180);
      const y1 = 250 + r1 * Math.sin((sa * Math.PI) / 180);
      const x2 = 250 + r1 * Math.cos((ea * Math.PI) / 180);
      const y2 = 250 + r1 * Math.sin((ea * Math.PI) / 180);
      const x3 = 250 + r2 * Math.cos(((sa + ea) / 2 * Math.PI) / 180);
      const y3 = 250 + r2 * Math.sin(((sa + ea) / 2 * Math.PI) / 180);
      
      // We alternate triangle directions for a better pattern
      if (outerSub % 2 === 0) {
        const x4 = 250 + r2 * Math.cos((sa * Math.PI) / 180);
        const y4 = 250 + r2 * Math.sin((sa * Math.PI) / 180);
        const x5 = 250 + r2 * Math.cos((ea * Math.PI) / 180);
        const y5 = 250 + r2 * Math.sin((ea * Math.PI) / 180);
        points = `${x1},${y1} ${x2},${y2} ${x5},${y5} ${x4},${y4}`; // Making it a quad or two triangles?
        // Let's stick to simple triangles for the logic
        points = `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
      } else {
        points = `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
      }

      // Re-defining outer triangles to be strictly 36 total and covering the area
      const anglePerOuter = 120 / 8;
      const sAngle = rotation + outerSub * anglePerOuter;
      const eAngle = sAngle + anglePerOuter;
      const ox1 = 250 + r1 * Math.cos((sAngle * Math.PI) / 180);
      const oy1 = 250 + r1 * Math.sin((sAngle * Math.PI) / 180);
      const ox2 = 250 + r1 * Math.cos((eAngle * Math.PI) / 180);
      const oy2 = 250 + r1 * Math.sin((eAngle * Math.PI) / 180);
      const ox3 = 250 + r2 * Math.cos((sAngle * Math.PI) / 180);
      const oy3 = 250 + r2 * Math.sin((sAngle * Math.PI) / 180);
      const ox4 = 250 + r2 * Math.cos((eAngle * Math.PI) / 180);
      const oy4 = 250 + r2 * Math.sin((eAngle * Math.PI) / 180);
      
      if (outerSub % 2 === 0) {
        points = `${ox1},${oy1} ${ox2},${oy2} ${ox3},${oy3}`;
      } else {
        points = `${ox2},${oy2} ${ox3},${oy3} ${ox4},${oy4}`;
      }
    }

    const color = grid[index] || "transparent";

    return (
      <polygon
        key={index}
        points={points}
        fill={color}
        stroke="currentColor"
        strokeWidth="1"
        className={cn(
          "cursor-pointer transition-colors duration-200 hover:opacity-80",
          grid[index] ? "stroke-black/10 dark:stroke-white/10" : "text-muted-foreground/30"
        )}
        onMouseDown={() => {
          isDragging.current = true;
          onCellClick(index);
          lastInteraction.current = index;
        }}
        onMouseEnter={() => {
          if (isDragging.current && lastInteraction.current !== index) {
            onCellClick(index);
            lastInteraction.current = index;
          }
        }}
        onMouseUp={() => {
          isDragging.current = false;
        }}
      />
    );
  };

  return (
    <div className="relative aspect-square w-full max-w-[500px] mx-auto select-none">
      <svg
        viewBox="0 0 500 500"
        className="w-full h-full drop-shadow-xl"
        onMouseLeave={() => (isDragging.current = false)}
      >
        <circle cx="250" cy="250" r="240" className="fill-card stroke-border" strokeWidth="2" />
        {grid.map((_, i) => renderTriangle(i))}
        <circle cx="250" cy="250" r="4" className="fill-accent" />
      </svg>
    </div>
  );
}
