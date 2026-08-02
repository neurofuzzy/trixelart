import { getTriVertices, type TriKey } from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import { trisBox } from "@/lib/hatch";
import { drawHatchLayer } from "@/lib/hatch-render";
import { layerKind, type Layer } from "@/hooks/use-history";

/**
 * Canvas preview for the hatchify dialog.
 *
 * Unlike `paintPatternCanvas`, which windows onto a global field centred on the
 * lattice origin, this fits a *specific* set of trixels — the hex selection —
 * into the canvas, because the whole question the preview answers is what
 * *these* hexes will look like.
 *
 * The draw loop is deliberately the same shape as `GridCanvas`: fill layers
 * batch by colour, hatch layers go through `drawHatchLayer`. Feeding it a
 * synthetic two-layer array keeps the preview honest without adding a third
 * rendering path that could drift from the canvas and the exporters.
 */
export function renderHatchifyPreview(
  canvas: HTMLCanvasElement,
  layers: Layer[],
  tris: TriKey[],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 240;
  const cssH = canvas.clientHeight || 240;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const box = trisBox(tris);
  if (!box) return;

  const pad = 6;
  const bw = Math.max(1e-6, box.maxX - box.minX);
  const bh = Math.max(1e-6, box.maxY - box.minY);
  const scale = Math.min((cssW - 2 * pad) / bw, (cssH - 2 * pad) / bh);

  ctx.save();
  ctx.translate(cssW / 2, cssH / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(box.minX + bw / 2), -(box.minY + bh / 2));

  for (const layer of layers) {
    if (!layer.visible) continue;

    if (layerKind(layer) === "hatch") {
      // No zoom argument: the preview wants the true world weight, the same as
      // the exporters take, rather than the canvas's zoomed-out minimum.
      drawHatchLayer(ctx, layer.painted, box);
      continue;
    }

    const byColor = new Map<string, TriKey[]>();
    for (const t of tris) {
      const value = layer.painted[`${t.q},${t.r},${t.type}`];
      if (!value) continue;
      const hex = resolveColor(value);
      const list = byColor.get(hex);
      if (list) list.push(t);
      else byColor.set(hex, [t]);
    }
    for (const [color, list] of byColor) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const t of list) {
        const [a, b, c] = getTriVertices(t.q, t.r, t.type);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
      }
      ctx.fill();
    }
  }

  ctx.restore();
}
