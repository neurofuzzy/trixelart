import { generateTriangles } from "@/lib/svg-export";
import { cropDisplayBounds, type CropRect } from "@/lib/crop";
import type { Layer } from "@/hooks/use-history";
import {
  buildRenderPlan,
  drawHatchLayer,
  glowReceivers,
  stepColorAdjust,
  stepGlow,
  stepOutlineWeight,
  stepRoundRadius,
  stepSubdivisionNoise,
} from "@/lib/hatch-render";
import {
  drawSubFills,
  noiseRegionFills,
  onLatticeRow,
} from "@/lib/subdivision-noise";
import { stepRegionGeometry, traceRoundedRing } from "@/lib/round-corners";
import { drawGlow, silhouetteGeometry } from "@/lib/glow";

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
  layers: Layer[],
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
  // Each axis is scaled to fit its own dimension rather than sharing one factor.
  // `cropPixelSize` has snapped the row axis to a whole number of triangle rows,
  // and only an exact fit puts those rows on integer pixel boundaries — a shared
  // scale would leave the snapped axis short by up to `2n` pixels and reopen the
  // sub-pixel straddle the snap exists to remove. The two factors differ by well
  // under 0.1%, so nothing is visibly distorted.
  const sx = pxW / display.w;
  const sy = pxH / display.h;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pxW, pxH);
  ctx.clip();

  // Same forward transform GridCanvas uses, minus pan/zoom: scale the crop to
  // fill the bitmap, put the crop's display origin at (0,0), then rotate world
  // space into display space so pointy-top exports match what is on screen.
  ctx.scale(sx, sy);
  ctx.translate(-display.x, -display.y);
  ctx.rotate(gridRotation);

  // Sized off the smaller scale so the overdraw is at least one device pixel on
  // both axes.
  drawArtworkPlan(ctx, layers, 1 / Math.min(sx, sy));

  ctx.restore();
}

/**
 * Draws the layers into an already-transformed context: world coordinates in,
 * artwork out. No background, no grid, no overlays.
 *
 * Shared by the fabric crop export and the apparel export, which differ in how
 * they size and place the bitmap but agree exactly on how a trixel is painted.
 * `overdraw` is the stroke width, in world units, that closes the seams.
 *
 * `glow` is opt-out for the apparel export: a soft shadow spreads translucent
 * ink straight across the stencil cut gaps, welding the pieces back together and
 * undoing the flex the cut exists to provide.
 */
export function drawArtworkPlan(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  overdraw: number,
  options: { glow?: boolean } = {},
): void {
  const plan = buildRenderPlan(layers);
  const receivers =
    options.glow === false ? plan.map(() => null) : glowReceivers(plan);

  // Bottom-to-top through the plan, so hatch interleaves with fills correctly.
  for (let si = 0; si < plan.length; si++) {
    const step = plan[si];
    if (step.kind === "hatch") {
      // No zoom clamp: exports use the true world weight.
      drawHatchLayer(ctx, step.painted);
      continue;
    }

    // Corner rounding draws whole regions rather than triangles, and the outline
    // effect strokes them. Rounding removes the seams this function's overdraw
    // stroke exists to close — the leak comes from abutting *same-colour*
    // triangles being composited separately, and a merged region has no interior
    // edges left — so only the region boundary is overdrawn (or outlined), where
    // a genuinely different colour still meets it.
    const radius = stepRoundRadius(step);
    const outline = stepOutlineWeight(step);
    const adjust = stepColorAdjust(step);
    const noise = stepSubdivisionNoise(step);

    // Before the layer's own fills: the layer casts the shadow, it does not
    // receive it.
    const glow = stepGlow(step);
    const receiver = receivers[si];
    if (glow && receiver) {
      drawGlow(ctx, glow, silhouetteGeometry(step.painted, radius), receiver);
    }

    if (radius > 0 || outline > 0) {
      // Clipped to the region so a rounded corner cuts the grain back exactly
      // where it cuts the fill. Not under an outline: that effect leaves the
      // interior empty on purpose, so there is nothing there to texture.
      const regionFills =
        noise && outline === 0 ? noiseRegionFills(step.painted, noise) : null;
      for (const { fill, base, rings } of stepRegionGeometry(
        step.painted,
        radius,
        adjust,
      )) {
        if (outline > 0) {
          // Outline effect: a stroke of the boundary at the selected weight
          // instead of a solid fill; the interior stays empty. Round joins land
          // exactly on the stroke edge.
          ctx.strokeStyle = fill;
          ctx.lineWidth = outline;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.beginPath();
          for (const ring of rings) traceRoundedRing(ctx, ring);
          ctx.stroke();
          continue;
        }
        const grain = regionFills?.get(base);
        if (grain?.length) {
          // The solid fill goes down first and the grain over it: the clip is
          // antialiased, so painting only the sub-triangles would leave a
          // feathered edge where the region meets its neighbour.
          ctx.save();
          ctx.beginPath();
          for (const ring of rings) traceRoundedRing(ctx, ring);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = fill;
          ctx.lineWidth = overdraw;
          ctx.lineJoin = "round";
          ctx.stroke();
          ctx.clip();
          drawSubFills(ctx, grain, adjust, overdraw);
          ctx.restore();
          continue;
        }

        ctx.fillStyle = fill;
        ctx.beginPath();
        for (const ring of rings) traceRoundedRing(ctx, ring);
        ctx.fill();

        ctx.strokeStyle = fill;
        ctx.lineWidth = overdraw;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
      continue;
    }

    const byColor = new Map<string, [number, number][][]>();
    for (const tri of generateTriangles(step.painted, adjust, noise)) {
      const list = byColor.get(tri.fill);
      if (list) list.push(tri.points);
      else byColor.set(tri.fill, [tri.points]);
    }

    // One path per colour: adjacent same-coloured triangles then share a filled
    // region with no seam between them. Across a colour boundary two abutting
    // fills are each composited separately, so a boundary pixel ends up part
    // background however their coverages divide — hence the overdraw stroke in
    // the group's own colour, at ~1 device pixel, to close the gap. Under alpha
    // that matters more, not less: the leak is the garment, not a backdrop.
    //
    // **The flat edges are excluded from that stroke.** The caller has put every
    // horizontal lattice line on an integer pixel boundary, so those fills
    // already meet exactly and have no gap to close; a stroke centred there
    // instead straddles the boundary by half a pixel each way and reintroduces
    // the very blend it was meant to prevent — as a discoloured line running the
    // full width of the export at every row. Only the two diagonal edges of each
    // triangle, which cannot be pixel-aligned, still get overdrawn.
    for (const [fill, polys] of byColor) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const points of polys) {
        ctx.moveTo(points[0][0], points[0][1]);
        for (let k = 1; k < points.length; k++) {
          ctx.lineTo(points[k][0], points[k][1]);
        }
        ctx.closePath();
      }
      ctx.fill();

      ctx.strokeStyle = fill;
      ctx.lineWidth = overdraw;
      ctx.lineCap = "butt";
      ctx.beginPath();
      for (const points of polys) {
        for (let k = 0; k < points.length; k++) {
          const [x0, y0] = points[k];
          const [x1, y1] = points[(k + 1) % points.length];
          // World-space y equality identifies the lattice's flat edges. Under a
          // quarter turn they become display-vertical, and the width is the
          // snapped axis there, so they are pixel-aligned either way.
          //
          // The row test only matters under subdivision noise, which puts flat
          // edges at `(r + ½)H` as well — those are not pixel-aligned and do
          // need the stroke. Without it every flat edge is on a row, so this
          // reduces to the condition it has always been.
          if (y0 === y1 && onLatticeRow(y0)) continue;
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
      }
      ctx.stroke();
    }
  }
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
  layers: Layer[],
  crop: CropRect,
  pxW: number,
  pxH: number,
  bgHex: string,
  gridRotation: number,
  repeat = 3,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Integer tile dimensions, with the same row-axis snap the real export uses,
  // and the bitmap sized to an exact multiple of them. Blitting at fractional
  // positions or sizes resamples every tile and paints blurred seams the export
  // does not have — which would be a preview that lies about the one thing it
  // exists to show. The caller sets the element's CSS size separately, so
  // adjusting the backing store here is free.
  const display = cropDisplayBounds(crop, gridRotation);
  const rows = Math.max(1, 2 * crop.n);
  const rotated = Boolean(gridRotation);

  // Fit within both requested dimensions — snapping only ever grows a tile, so
  // sizing off the width alone could overflow the caller's height budget.
  const byH =
    display.h > 0 ? (pxH / repeat) * (display.w / display.h) : pxW / repeat;
  let tw = Math.max(1, Math.round(Math.min(pxW / repeat, byH)));
  if (rotated) tw = snapUp(tw, rows);
  let th =
    display.w > 0 ? Math.max(1, Math.round((tw * display.h) / display.w)) : 1;
  if (!rotated) th = snapUp(th, rows);

  canvas.width = tw * repeat;
  canvas.height = th * repeat;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // One tile, rendered once and blitted — the field is a pure function of world
  // position, so every tile is the same bitmap by construction.
  const tile = document.createElement("canvas");
  renderCropToCanvas(tile, layers, crop, tw, th, bgHex, gridRotation);

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
  ctx.lineWidth = Math.max(1, canvas.width / 400);
  ctx.strokeRect(mid * tw, mid * th, tw, th);
}

const snapUp = (v: number, k: number) => Math.max(k, Math.ceil(v / k) * k);

/**
 * Output pixel dimensions for a crop at a given physical width.
 *
 * **The row-axis dimension is snapped to a whole multiple of `2n`.** The crop is
 * exactly `n` vertical periods tall, i.e. `2n` triangle rows, and the lattice's
 * only axis-aligned edges are the horizontal ones at every multiple of `H`. Left
 * unsnapped, `H` scales to an irrational number of device pixels (`n*sqrt(3)/m`
 * is irrational), so *every* horizontal edge straddles a pixel row, antialiases
 * against its neighbour, and the export grows a discoloured 1-2px line across its
 * full width at every row — the whole way down the image, at any resolution.
 * Snapping puts every row on an integer boundary, where there is nothing to
 * blend. Diagonal edges are unaffected and still antialias, which is what you
 * want there.
 *
 * The cost is at most `2n` pixels of height, under 0.1% at print sizes, and it is
 * paid on the axis the user did *not* pin. Under a quarter turn the row axis is
 * horizontal, so the snap moves to the width instead.
 */
export function cropPixelSize(
  crop: CropRect,
  gridRotation: number,
  widthInches: number,
  dpi: number,
): { pxW: number; pxH: number } {
  const display = cropDisplayBounds(crop, gridRotation);
  const rows = Math.max(1, 2 * crop.n);
  const rotated = Boolean(gridRotation);

  let pxW = Math.max(1, Math.round(widthInches * dpi));
  if (rotated) pxW = snapUp(pxW, rows);
  let pxH = Math.max(1, Math.round((pxW * display.h) / display.w));
  if (!rotated) pxH = snapUp(pxH, rows);

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
