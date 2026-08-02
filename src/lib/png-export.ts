import { generateTriangles } from "@/lib/svg-export";
import { cropDisplayBounds, type CropRect } from "@/lib/crop";

/**
 * Raster export of a crop region.
 *
 * Print-on-demand sites take pixels, not vectors: Spoonflower accepts JPG/PNG
 * only, at most 40 MB, in sRGB, and resamples everything to 150 DPI — so
 * `pixels / 150` is the printed size in inches. A canvas 2D surface is already
 * sRGB with no embedded profile, which is exactly what they ask for.
 */

/** Spoonflower's hard upload limit. */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

/** Spoonflower resamples every upload to this. */
export const SPOONFLOWER_DPI = 150;

/**
 * Draws the crop region into `canvas` at `pxW` x `pxH`.
 *
 * Artwork only — no grid lines, no hex outlines, no origin dot, no selection
 * overlay. The background is filled opaque because the target sites document no
 * alpha support.
 */
export function renderCropToCanvas(
  canvas: HTMLCanvasElement,
  painted: Record<string, string>,
  crop: CropRect,
  pxW: number,
  pxH: number,
  bgHex: string,
  gridRotation: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = pxW;
  canvas.height = pxH;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, pxW, pxH);

  const display = cropDisplayBounds(crop, gridRotation);
  if (display.w <= 0 || display.h <= 0) return;
  const pxPerWorld = pxW / display.w;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pxW, pxH);
  ctx.clip();

  // Same forward transform GridCanvas uses, minus pan/zoom: scale the crop to
  // fill the bitmap, put the crop's display origin at (0,0), then rotate world
  // space into display space so pointy-top exports match what is on screen.
  ctx.scale(pxPerWorld, pxPerWorld);
  ctx.translate(-display.x, -display.y);
  ctx.rotate(gridRotation);

  const byColor = new Map<string, [number, number][][]>();
  for (const tri of generateTriangles(painted)) {
    const list = byColor.get(tri.fill);
    if (list) list.push(tri.points);
    else byColor.set(tri.fill, [tri.points]);
  }

  // One path per colour: adjacent same-coloured triangles then share a filled
  // region with no seam between them. Across a colour boundary the two fills
  // still each cover only half of the shared antialiased pixel, so every group
  // is also stroked with its own colour at ~1 device pixel to close the gap.
  // The SVG exporter offers the same overdraw as an option; for raster it is
  // unconditional because there is no downside.
  const overdraw = 1 / pxPerWorld;
  for (const [fill, polys] of byColor) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = fill;
    ctx.lineWidth = overdraw;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const points of polys) {
      ctx.moveTo(points[0][0], points[0][1]);
      for (let k = 1; k < points.length; k++) {
        ctx.lineTo(points[k][0], points[k][1]);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws the crop tiled `repeat` x `repeat` with the centre tile at full
 * strength and its neighbours dimmed.
 *
 * The whole point of snapping the crop to whole lattice periods is that it is a
 * repeat unit, and a single tile shows none of that — the seams are exactly
 * where the interesting failure would be. Only the centre tile is what actually
 * gets exported, so it is the one kept bright and outlined.
 */
export function renderCropPreview(
  canvas: HTMLCanvasElement,
  painted: Record<string, string>,
  crop: CropRect,
  pxW: number,
  pxH: number,
  bgHex: string,
  gridRotation: number,
  repeat = 3,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = pxW;
  canvas.height = pxH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, pxW, pxH);

  const tw = pxW / repeat;
  const th = pxH / repeat;

  // One tile, rendered once and blitted — the field is a pure function of world
  // position, so every tile is the same bitmap by construction.
  const tile = document.createElement("canvas");
  renderCropToCanvas(
    tile,
    painted,
    crop,
    Math.max(1, Math.round(tw)),
    Math.max(1, Math.round(th)),
    bgHex,
    gridRotation,
  );

  const mid = Math.floor(repeat / 2);
  for (let gy = 0; gy < repeat; gy++) {
    for (let gx = 0; gx < repeat; gx++) {
      ctx.globalAlpha = gx === mid && gy === mid ? 1 : 0.4;
      ctx.drawImage(tile, gx * tw, gy * th, tw, th);
    }
  }
  ctx.globalAlpha = 1;

  // Mark the tile that is actually exported.
  ctx.strokeStyle = "rgba(251, 191, 36, 0.9)"; // amber-400
  ctx.lineWidth = Math.max(1, pxW / 400);
  ctx.strokeRect(mid * tw, mid * th, tw, th);
}

/** Output pixel dimensions for a crop at a given physical width. */
export function cropPixelSize(
  crop: CropRect,
  gridRotation: number,
  widthInches: number,
  dpi: number,
): { pxW: number; pxH: number } {
  const display = cropDisplayBounds(crop, gridRotation);
  const pxW = Math.max(1, Math.round(widthInches * dpi));
  const pxH = Math.max(1, Math.round((pxW * display.h) / display.w));
  return { pxW, pxH };
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Triggers a browser download for an already-built blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
