"use client";

import { useMemo } from "react";
import { SIDE, H, getTriPath, type TriKey } from "@/lib/grid-math";

export function GridCanvas({
  size,
  view,
  mounted,
  painted,
  hoveredTri,
  screenToWorld,
}: {
  size: { width: number; height: number };
  view: { x: number; y: number; zoom: number };
  mounted: boolean;
  painted: Record<string, string>;
  hoveredTri: TriKey | null;
  screenToWorld: (sx: number, sy: number) => { x: number; y: number };
}) {
  const gridContent = useMemo(() => {
    if (size.width === 0 || !mounted) return null;

    const triangles: React.ReactElement[] = [];
    const buffer = 3;
    const worldTopLeft = screenToWorld(0, 0);
    const worldBottomRight = screenToWorld(size.width, size.height);

    const minR = Math.floor(worldTopLeft.y / H) - buffer;
    const maxR = Math.ceil(worldBottomRight.y / H) + buffer;
    const minQ =
      Math.floor(
        Math.min(worldTopLeft.x, worldBottomRight.x) / SIDE - maxR * 0.5,
      ) - buffer;
    const maxQ =
      Math.ceil(
        Math.max(worldTopLeft.x, worldBottomRight.x) / SIDE - minR * 0.5,
      ) + buffer;

    for (let r = minR; r <= maxR; r++) {
      for (let q = minQ; q <= maxQ; q++) {
        const upKey = `${q},${r},up`;
        const dnKey = `${q},${r},down`;

        triangles.push(
          <path
            key={upKey}
            d={getTriPath(q, r, "up")}
            fill={painted[upKey] || "transparent"}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.5 / view.zoom}
          />,
        );
        triangles.push(
          <path
            key={dnKey}
            d={getTriPath(q, r, "down")}
            fill={painted[dnKey] || "transparent"}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.5 / view.zoom}
          />,
        );
      }
    }
    return triangles;
  }, [size, view, painted, mounted, screenToWorld]);

  const guides = useMemo(
    () => (
      <g pointerEvents="none">
        <line
          x1={-10000}
          y1={0}
          x2={10000}
          y2={0}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={1 / view.zoom}
        />
        <line
          x1={-5000}
          y1={-8660}
          x2={5000}
          y2={8660}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={1 / view.zoom}
        />
        <line
          x1={5000}
          y1={-8660}
          x2={-5000}
          y2={8660}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={1 / view.zoom}
        />
        <circle cx={0} cy={0} r={5 / view.zoom} fill="white" />
      </g>
    ),
    [view.zoom],
  );

  const hoverOutline = useMemo(() => {
    if (!hoveredTri) return null;
    return (
      <path
        d={getTriPath(hoveredTri.q, hoveredTri.r, hoveredTri.type)}
        fill="none"
        stroke="white"
        strokeWidth={2 / view.zoom}
        pointerEvents="none"
        className="opacity-50"
      />
    );
  }, [hoveredTri, view.zoom]);

  return (
    <svg
      width="100%"
      height="100%"
      className="absolute inset-0 pointer-events-none"
    >
      <g
        transform={`translate(${size.width / 2}, ${size.height / 2}) scale(${view.zoom}) translate(${view.x}, ${view.y})`}
      >
        {gridContent}
        {hoverOutline}
        {guides}
      </g>
    </svg>
  );
}
