import { SIDE, getTriVertices, type TriKey } from "@/lib/grid-math";
import { trixelsInBox } from "@/lib/tri-pattern";

/**
 * Canvas rendering for pattern previews.
 *
 * Split out of `PatternPanel` so the drawer's big preview, its per-layer
 * thumbnails and the palette's slot swatches all draw the same way. Kept apart
 * from `tri-pattern.ts`, which stays free of DOM.
 *
 * Each patch is centred on the lattice origin: patterns are a global function
 * of world position, so a preview is a window onto the field rather than a tile
 * of it, and the origin is the honest place to look through.
 */

/** Big preview: ~28 trixels across, wide enough for the moire to resolve. */
export const PREVIEW_SPAN = 14 * SIDE;

/** Per-layer thumbnail in the drawer's layer list. */
export const THUMB_SPAN = 5 * SIDE;

/** Palette slot swatch. */
export const SLOT_SPAN = 7 * SIDE;

function patch(span: number): TriKey[] {
  const h = span / 2;
  return trixelsInBox(-h, -h, h, h);
}

export const PREVIEW_TRIS = patch(PREVIEW_SPAN);
export const THUMB_TRIS = patch(THUMB_SPAN);
export const SLOT_TRIS = patch(SLOT_SPAN);

/**
 * Fills `tris` on a square canvas, world origin at centre.
 *
 * The caller is responsible for the element's CSS size; this reads it back and
 * matches the backing store to it at device pixel ratio.
 */
export function paintPatternCanvas(
  canvas: HTMLCanvasElement,
  span: number,
  tris: TriKey[],
  colorOf: (t: TriKey) => string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const css = canvas.clientWidth || 200;
  canvas.width = css * dpr;
  canvas.height = css * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);

  ctx.save();
  ctx.scale(css / span, css / span);
  ctx.translate(span / 2, span / 2);

  // Batch by colour so each distinct colour costs one fill, not one per trixel.
  const byColor = new Map<string, TriKey[]>();
  for (const t of tris) {
    const c = colorOf(t);
    const list = byColor.get(c);
    if (list) list.push(t);
    else byColor.set(c, [t]);
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
  ctx.restore();
}
