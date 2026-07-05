"use client";

import { useRef, useEffect, useState } from "react";
import { SIDE, H, getTriVertices, type TriKey } from "@/lib/grid-math";
import { hexCenterWorld, enumerateHexTrixels, triToHex, hexCenterTriAxial, type SelectionSnapshot } from "@/lib/hex-flower";
import { resolveColor } from "@/lib/constants";
import type { HexMode } from "@/components/Footer";

export function GridCanvas({
  size,
  view,
  mounted,
  painted,
  hoverTargets,
  screenToWorld,
  gridDivisions,
  hexMode,
  selectedHex,
  tool,
  activeSelection,
  stampFlash,
  captureMode,
}: {
  size: { width: number; height: number };
  view: { x: number; y: number; zoom: number };
  mounted: boolean;
  painted: Record<string, string>;
  hoverTargets: TriKey[];
  screenToWorld: (sx: number, sy: number) => { x: number; y: number };
  gridDivisions: number;
  hexMode: HexMode;
  selectedHex: { c: number; k: number } | null;
  tool: "paint" | "erase" | "pan" | "select" | "stamp";
  activeSelection: SelectionSnapshot | null;
  stampFlash: { c: number; k: number; opacity: number; seq: number } | null;
  captureMode?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [antPhase, setAntPhase] = useState(0);

  // Marching-ants animation tick (8 px/s equivalent in screen px). Stops
  // when there's no selection so we don't repaint forever.
  useEffect(() => {
    if (!selectedHex) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setAntPhase(((now - start) / 1000) * 24);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedHex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || !mounted) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
            const hex = resolveColor(fill);
            const list = colorGroups.get(hex);
            if (list) list.push({ q, r, type });
            else colorGroups.set(hex, [{ q, r, type }]);
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
    if (hexMode !== "off" && gridDivisions > 0) {
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

      const centers: { cx: number; cy: number }[] = [];

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

          centers.push({ cx, cy });
        }
      }

      if (hexMode === "centers") {
        // Center markers — same radius as the origin dot, dimmer.
        const r = Math.max(5 / view.zoom, 2);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        for (const { cx, cy } of centers) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(5 / view.zoom, 2), 0, Math.PI * 2);
    ctx.fill();

    // Selection overlay — cyan/blue tint on the selected hex's trixels, with a
    // marching-ants hex outline. Only shown when hex lattice is active.
    if (selectedHex && gridDivisions > 0) {
      const s = gridDivisions * SIDE;
      const vHalf = gridDivisions * H;
      const { x: cx, y: cy } = hexCenterWorld(
        selectedHex.c,
        selectedHex.k,
        gridDivisions,
      );

      // Cyan tint on the selected trixels.
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "rgb(34, 211, 238)"; // cyan-400
      const tris = enumerateHexTrixels(
        selectedHex.c,
        selectedHex.k,
        gridDivisions,
      );
      ctx.beginPath();
      for (const t of tris) {
        const [a, b, c] = getTriVertices(t.q, t.r, t.type);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();

      // Hex outline with marching-ants dash.
      ctx.save();
      ctx.strokeStyle = "rgb(34, 211, 238)";
      ctx.lineWidth = Math.max(2 / view.zoom, 1.5);
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -antPhase / view.zoom;
      ctx.beginPath();
      ctx.moveTo(cx + s, cy);
      ctx.lineTo(cx + s / 2, cy + vHalf);
      ctx.lineTo(cx - s / 2, cy + vHalf);
      ctx.lineTo(cx - s, cy);
      ctx.lineTo(cx - s / 2, cy - vHalf);
      ctx.lineTo(cx + s / 2, cy - vHalf);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // Stamp flash — yellow highlight on the source hex that fades out.
    if (stampFlash && gridDivisions > 0) {
      ctx.save();
      ctx.globalAlpha = stampFlash.opacity * 0.4;
      ctx.fillStyle = "rgb(250, 204, 21)"; // yellow-400
      const flashTris = enumerateHexTrixels(stampFlash.c, stampFlash.k, gridDivisions);
      ctx.beginPath();
      for (const t of flashTris) {
        const [a, b, c] = getTriVertices(t.q, t.r, t.type);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
    }

    // Stamp preview: render the active selection's trixels translated to
    // the hovered hex, using their real colors so the user sees exactly
    // what a stamp would land there. Skip when in capture mode.
    if (tool === "stamp" && !captureMode && hoverTargets.length > 0 && activeSelection && gridDivisions > 0 && gridDivisions === activeSelection.N) {
      const N = gridDivisions;
      const hov = hoverTargets[0];
      const tgt = triToHex(hov.q, hov.r, hov.type, N);
      const { qc, rc } = hexCenterTriAxial(tgt.c, tgt.k, N);

      // Group snapshot trixels by resolved color so we batch fills.
      const previewGroups = new Map<string, typeof activeSelection.trixels>();
      for (const t of activeSelection.trixels) {
        const hex = resolveColor(t.color);
        const list = previewGroups.get(hex);
        if (list) list.push(t);
        else previewGroups.set(hex, [t]);
      }

      ctx.save();
      ctx.globalAlpha = 0.6;
      for (const [fillColor, list] of previewGroups) {
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        for (const t of list) {
          const [a, b, c] = getTriVertices(
            qc + t.dq,
            rc + t.dr,
            t.type,
          );
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.closePath();
        }
        ctx.fill();
      }
      ctx.restore();
    }

    // Hover outlines — primary + affected (flower/symmetry) ghosts.
    // Stamp tool renders a hexagon hover instead of per-trixel triangles.
    if (hoverTargets.length > 0) {
      ctx.lineWidth = Math.max(2 / view.zoom, 1);

      if ((tool === "stamp" || tool === "select") && gridDivisions > 0) {
        const hov = hoverTargets[0];
        const { c, k } = triToHex(hov.q, hov.r, hov.type, gridDivisions);
        const { x: hx, y: hy } = hexCenterWorld(c, k, gridDivisions);
        const hs = gridDivisions * SIDE;
        const hv = gridDivisions * H;
        ctx.beginPath();
        ctx.moveTo(hx + hs, hy);
        ctx.lineTo(hx + hs / 2, hy + hv);
        ctx.lineTo(hx - hs / 2, hy + hv);
        ctx.lineTo(hx - hs, hy);
        ctx.lineTo(hx - hs / 2, hy - hv);
        ctx.lineTo(hx + hs / 2, hy - hv);
        ctx.closePath();
        if (tool === "stamp") {
          if (captureMode) {
            ctx.strokeStyle = "#fbbf24";
            ctx.globalAlpha = 0.9;
            ctx.setLineDash([8, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          } else {
            ctx.strokeStyle = "white";
            ctx.globalAlpha = 0.7;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        } else {
          // Select: fill only, no stroke.
          ctx.fillStyle = "white";
          ctx.globalAlpha = 0.08;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.strokeStyle = "white";
        const [pa, pb, pc] = getTriVertices(
          hoverTargets[0].q,
          hoverTargets[0].r,
          hoverTargets[0].type,
        );
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.lineTo(pc.x, pc.y);
        ctx.closePath();
        ctx.stroke();

        if (hoverTargets.length > 1) {
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          for (let i = 1; i < hoverTargets.length; i++) {
            const [a, b, c] = getTriVertices(
              hoverTargets[i].q,
              hoverTargets[i].r,
              hoverTargets[i].type,
            );
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(c.x, c.y);
            ctx.closePath();
          }
          ctx.stroke();
        }

        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
  }, [size, view, painted, hoverTargets, mounted, screenToWorld, gridDivisions, hexMode, selectedHex, tool, antPhase, activeSelection, stampFlash, captureMode]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
    />
  );
}
