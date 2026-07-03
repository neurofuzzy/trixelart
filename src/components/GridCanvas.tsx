"use client";

import { useRef, useEffect } from "react";
import { SIDE, H, getTriVertices, type TriKey } from "@/lib/grid-math";

export function GridCanvas({
  size,
  view,
  mounted,
  painted,
  hoveredTri,
  screenToWorld,
  gridDivisions,
  hexMode,
}: {
  size: { width: number; height: number };
  view: { x: number; y: number; zoom: number };
  mounted: boolean;
  painted: Record<string, string>;
  hoveredTri: TriKey | null;
  screenToWorld: (sx: number, sy: number) => { x: number; y: number };
  gridDivisions: number;
  hexMode: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || !mounted) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.save();

    ctx.translate(size.width / 2, size.height / 2);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(view.x, view.y);

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

    // Filled triangles — group by color for fewer fillStyle changes
    const colorGroups = new Map<string, TriKey[]>();
    for (let r = minR; r <= maxR; r++) {
      for (let q = minQ; q <= maxQ; q++) {
        for (const type of ["up", "down"] as const) {
          const key = `${q},${r},${type}`;
          const fill = painted[key];
          if (fill) {
            const list = colorGroups.get(fill);
            if (list) list.push({ q, r, type });
            else colorGroups.set(fill, [{ q, r, type }]);
          }
        }
      }
    }

    for (const [fillColor, tris] of colorGroups) {
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      for (const tri of tris) {
        const [a, b, c] = getTriVertices(tri.q, tri.r, tri.type);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
      }
      ctx.fill();
    }

    // Grid outlines — 3 families of parallel lines
    const gridWidth = Math.max(1.0 / view.zoom, 0.2);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = gridWidth;

    ctx.beginPath();

    // Family 1: horizontal lines at y = r*H
    for (let r = minR; r <= maxR + 1; r++) {
      const y = r * H;
      const x0 = minQ * SIDE + r * SIDE / 2;
      const x1 = (maxQ + 1) * SIDE + r * SIDE / 2;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }

    // Family 2: / diagonals (slope sqrt(3)) — lines through A(q, r) for fixed q
    for (let q = minQ; q <= maxQ + 1; q++) {
      const x0 = q * SIDE + minR * SIDE / 2;
      const y0 = minR * H;
      const x1 = q * SIDE + (maxR + 1) * SIDE / 2;
      const y1 = (maxR + 1) * H;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }

    // Family 3: \ diagonals (slope -sqrt(3)) — lines through B(q, r) for fixed q+r
    const sumMin = minQ + minR;
    const sumMax = maxQ + maxR + 1;
    for (let S = sumMin; S <= sumMax; S++) {
      const qStart = Math.max(minQ, S - (maxR + 1));
      const qEnd = Math.min(maxQ, S - minR);
      if (qStart > qEnd) continue;

      const x0 = qStart * SIDE + (S - qStart) * SIDE / 2 + SIDE;
      const y0 = (S - qStart) * H;
      const x1 = qEnd * SIDE + (S - qEnd) * SIDE / 2 + SIDE;
      const y1 = (S - qEnd) * H;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }

    ctx.stroke();

    // Division / guide lines
    const divWidth = Math.max(1 / view.zoom, 1);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = divWidth;

    if (gridDivisions > 0) {
      const N = gridDivisions;
      ctx.beginPath();

      // Family 1: horizontal lines at r % N === 0
      for (let r = minR; r <= maxR + 1; r++) {
        if (r % N !== 0) continue;
        const y = r * H;
        const x0 = minQ * SIDE + r * SIDE / 2;
        const x1 = (maxQ + 1) * SIDE + r * SIDE / 2;
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }

      // Family 2: / diagonals at q % N === 0
      for (let q = minQ; q <= maxQ + 1; q++) {
        if (q % N !== 0) continue;
        const x0 = q * SIDE + minR * SIDE / 2;
        const y0 = minR * H;
        const x1 = q * SIDE + (maxR + 1) * SIDE / 2;
        const y1 = (maxR + 1) * H;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }

      // Family 3: \ diagonals at S % N === 0
      for (let S = sumMin; S <= sumMax; S++) {
        if ((S + 1) % N !== 0) continue;
        const qStart = Math.max(minQ, S - (maxR + 1));
        const qEnd = Math.min(maxQ, S - minR);
        if (qStart > qEnd) continue;

        const x0 = qStart * SIDE + (S - qStart) * SIDE / 2 + SIDE;
        const y0 = (S - qStart) * H;
        const x1 = qEnd * SIDE + (S - qEnd) * SIDE / 2 + SIDE;
        const y1 = (S - qEnd) * H;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }

      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-10000, 0);
      ctx.lineTo(10000, 0);
      ctx.moveTo(-5000, -8660);
      ctx.lineTo(5000, 8660);
      ctx.moveTo(5000, -8660);
      ctx.lineTo(-5000, 8660);
      ctx.stroke();
    }

    // Hex mode: flat-top honeycomb. Hex side s = N*SIDE so each hex edge
    // lies along a grid division guide line. Centers form the lattice
    //   (Q,R) = (cN - kN, cN + 2kN)  (axial)
    // whose world x = 1.5*c*N*SIDE (columns are vertical) and y advances by
    // 2N*H (= s*sqrt(3)) within a column, adjacent columns offset by N*H.
    if (hexMode && gridDivisions > 0) {
      const N = gridDivisions;
      const s = N * SIDE;        // hex side = circumradius
      const vHalf = N * H;       // s*sqrt(3)/2 — vertical vertex offset
      const colWidth = 1.5 * s;  // horizontal column pitch
      const rowHeight = 2 * vHalf; // vertical pitch within a column

      const xMinW = Math.min(worldTopLeft.x, worldBottomRight.x);
      const xMaxW = Math.max(worldTopLeft.x, worldBottomRight.x);
      const yMinW = Math.min(worldTopLeft.y, worldBottomRight.y);
      const yMaxW = Math.max(worldTopLeft.y, worldBottomRight.y);

      const cMin = Math.floor(xMinW / colWidth) - 1;
      const cMax = Math.ceil(xMaxW / colWidth) + 1;

      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = Math.max(1.5 / view.zoom, 1);

      for (let c = cMin; c <= cMax; c++) {
        const cx = 1.5 * c * N * SIDE;
        const cyBase = c * N * H;
        const kMin = Math.floor((yMinW - cyBase) / rowHeight) - 1;
        const kMax = Math.ceil((yMaxW - cyBase) / rowHeight) + 1;

        for (let k = kMin; k <= kMax; k++) {
          const cy = cyBase + k * rowHeight;

          ctx.beginPath();
          ctx.moveTo(cx + s, cy);
          ctx.lineTo(cx + s / 2, cy + vHalf);
          ctx.lineTo(cx - s / 2, cy + vHalf);
          ctx.lineTo(cx - s, cy);
          ctx.lineTo(cx - s / 2, cy - vHalf);
          ctx.lineTo(cx + s / 2, cy - vHalf);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(5 / view.zoom, 2), 0, Math.PI * 2);
    ctx.fill();

    // Hover outline
    if (hoveredTri) {
      ctx.strokeStyle = "white";
      ctx.lineWidth = Math.max(2 / view.zoom, 1);
      ctx.globalAlpha = 0.5;

      const [a, b, c] = getTriVertices(hoveredTri.q, hoveredTri.r, hoveredTri.type);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.stroke();

      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [size, view, painted, hoveredTri, mounted, screenToWorld, gridDivisions, hexMode]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
    />
  );
}
