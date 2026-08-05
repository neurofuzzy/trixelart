import { SIDE } from "@/lib/grid-math";
import { decodeColor, encodeColor } from "@/lib/constants";
import {
  roundedRingToPath,
  stepRegionGeometry,
  traceRoundedRing,
  type RoundedRing,
} from "@/lib/round-corners";

/** What a fill step's glow should be drawn with. `sigma` is in world units and
 *  `color` is already resolved, the same convention as `RegionRings.fill`. */
export interface GlowSpec {
  sigma: number;
  opacity: number;
  color: string;
}

/**
 * Blur σ in world units at slider 100%: one cell stride, the same convention as
 * `ROUND_RADIUS_AT_FULL` and `OUTLINE_WEIGHT_AT_FULL`. The slider is stored as a
 * 0–1 fraction so the saved value does not depend on `SIDE`, but it denotes an
 * absolute distance — the same softness everywhere on the layer.
 */
export const GLOW_RADIUS_AT_FULL = SIDE;

/**
 * Past this many σ a Gaussian contributes nothing an 8-bit channel can hold, so
 * it bounds the SVG filter region and the canvas blur's reach.
 */
export const GLOW_EXTENT_SIGMAS = 3;

/** The value every cell is rewritten to before the silhouette walk. Any valid
 *  encoded colour works — only its identity matters, never its hue. */
const SILHOUETTE_KEY = encodeColor(0, 0);

/**
 * The union outline of a layer's painted cells, ignoring colour.
 *
 * `regionRings` groups by `resolveColor` and skips any value `decodeColor`
 * rejects, so rewriting every cell to one constant collapses all of a layer's
 * colours into a single region and the existing ring walk returns its
 * silhouette — no second boundary tracer, and hatch values stay excluded
 * structurally, exactly as they are for the other two effects.
 *
 * `radius` is the layer's own round-corners fraction, so a glow cast by a
 * rounded layer follows the *rounded* silhouette and the two effects compose
 * with no extra work.
 *
 * Note this is not quite the union of the per-colour rounded regions: a vertex
 * where an interior colour boundary meets the silhouette has degree 4 in the
 * colour-split walk and is left sharp, but degree 2 here and rounds. The
 * difference is a fraction of the blur and is not worth a special case.
 */
export function silhouetteGeometry(
  painted: Record<string, string>,
  radius: number,
): RoundedRing[] {
  const uniform: Record<string, string> = {};
  for (const key in painted) {
    if (decodeColor(painted[key])) uniform[key] = SILHOUETTE_KEY;
  }
  const regions = stepRegionGeometry(uniform, radius);
  return regions.length ? regions[0].rings : [];
}

/** Bounding box of a ring set, or `null` when empty. Corner arcs stay inside the
 *  triangle cut off by their corner, so the vertex box contains them. */
export function ringsBounds(
  rings: RoundedRing[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * The CSS `filter` string for a blur of `sigma` world units drawn through a
 * transform of `scale` device pixels per world unit.
 *
 * `blur(N)` takes the standard deviation **directly**, the same quantity SVG's
 * `stdDeviation` names — so the two backends agree with no conversion. (It is
 * `box-shadow`, not `filter: blur`, whose length is 2σ; assuming that here made
 * the preview twice as soft as the exported file, which is exactly what the
 * canvas-versus-SVG density check catches.)
 *
 * The scale factor is not optional: `ctx.filter` lengths are device pixels and
 * are **not** scaled by the current transform, so a blur drawn through the
 * world transform has to be converted by hand. Verified in Chrome — the same
 * `blur(10px)` measures 10px of σ at CTM scale 1 and at scale 2.
 */
export function glowCanvasFilter(sigma: number, scale: number): string {
  return `blur(${(sigma * scale).toFixed(3)}px)`;
}

/** A ring set turned through `theta`. Corner radii are rotation-invariant, so
 *  only the corner positions move. Only 0 and π/2 are ever used, where sin and
 *  cos are exactly 0 and 1 and the result stays exact. */
export function rotateRoundedRings(
  rings: RoundedRing[],
  theta: number,
): RoundedRing[] {
  if (!theta) return rings;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return rings.map((ring) =>
    ring.map((p) => ({
      x: p.x * c - p.y * s,
      y: p.x * s + p.y * c,
      radius: p.radius,
    })),
  );
}

/**
 * The `<defs>` and body markup for one layer's glow, in whatever coordinate
 * space the caller has already put the rings into.
 *
 * Two attributes here are deliberate:
 *
 * - **`filterUnits="userSpaceOnUse"` with an explicit region.** This one *is*
 *   load-bearing: the default region is `-10%`/`120%` of the source bbox, which
 *   visibly crops a wide blur. The region used here is the caster's box grown by
 *   the distance past which a Gaussian has nothing left an 8-bit channel can
 *   hold.
 * - **`color-interpolation-filters="sRGB"`.** SVG 1.1 defaults filter operations
 *   to *linearRGB* while canvas blurs in sRGB. Measured, it makes no difference
 *   *here* — the caster is one flat colour, so the blur ramps only alpha, which
 *   carries no gamma — so this is insurance, not a fix: it pins the result
 *   against the renderer's default and stays correct if the chain ever grows an
 *   `feFlood`/`feComposite` that actually mixes colours. Do not cite it as the
 *   reason a density matches.
 *
 * The receiver rides a `<clipPath>`, which is the one place this codebase cannot
 * clip for real: the visible shadow is (blurred raster) ∩ (surface below), and
 * blur spreads, so there is no polygon to emit. Both rings' holes wind opposite
 * their outers, so the default nonzero fill/clip rule empties them correctly —
 * the same reason the ordinary fills need no `fill-rule`.
 */
export function glowSVG(
  spec: GlowSpec,
  caster: RoundedRing[],
  receiver: RoundedRing[],
  id: string,
  fmtNum: (n: number) => string,
  ox = 0,
  oy = 0,
): { defs: string; body: string } | null {
  if (!caster.length || !receiver.length) return null;

  const toPath = (r: RoundedRing) => roundedRingToPath(r, fmtNum, ox, oy);
  const casterD = caster.map(toPath).filter(Boolean).join(" ");
  const recvD = receiver.map(toPath).filter(Boolean).join(" ");
  if (!casterD || !recvD) return null;

  const box = ringsBounds(caster);
  if (!box) return null;
  const pad = GLOW_EXTENT_SIGMAS * spec.sigma;

  const defs =
    `    <filter id="glow-${id}" filterUnits="userSpaceOnUse" ` +
    `x="${fmtNum(box.minX + ox - pad)}" y="${fmtNum(box.minY + oy - pad)}" ` +
    `width="${fmtNum(box.maxX - box.minX + pad * 2)}" ` +
    `height="${fmtNum(box.maxY - box.minY + pad * 2)}" ` +
    `color-interpolation-filters="sRGB">\n` +
    `      <feGaussianBlur stdDeviation="${fmtNum(spec.sigma)}"/>\n` +
    `    </filter>\n` +
    `    <clipPath id="glow-recv-${id}"><path d="${recvD}"/></clipPath>`;

  const body =
    `  <g clip-path="url(#glow-recv-${id})" opacity="${fmtNum(spec.opacity)}">\n` +
    `    <path d="${casterD}" fill="${spec.color}" filter="url(#glow-${id})"/>\n` +
    `  </g>`;

  return { defs, body };
}

/** Device pixels per world unit under the context's current transform. Read off
 *  the live matrix rather than threaded in, so it cannot drift from whatever
 *  transform the caller actually set. */
export function ctxWorldScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

/**
 * Paints one layer's glow: the caster silhouette blurred and clipped to the
 * surface below it. The caller draws the layer's own fills afterwards, on top.
 *
 * Both backends call this rather than each writing the sequence out, so the
 * canvas preview and the PNG exports cannot disagree about the shadow the way
 * they could about a region boundary before `stepRegionGeometry` existed.
 */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  spec: GlowSpec,
  caster: RoundedRing[],
  receiver: RoundedRing[],
): void {
  // No surface to fall on, or nothing to cast it: a glow on the bottom fill
  // layer draws nothing, which is the point.
  if (!caster.length || !receiver.length) return;
  // Safari only gained `ctx.filter` in 17. Drawing the silhouette unblurred
  // would be a hard-edged slab of colour, which is worse than no shadow.
  if (typeof ctx.filter !== "string") return;

  ctx.save();
  ctx.beginPath();
  for (const ring of receiver) traceRoundedRing(ctx, ring);
  ctx.clip();
  ctx.globalAlpha = spec.opacity;
  ctx.filter = glowCanvasFilter(spec.sigma, ctxWorldScale(ctx));
  ctx.fillStyle = spec.color;
  ctx.beginPath();
  for (const ring of caster) traceRoundedRing(ctx, ring);
  ctx.fill();
  ctx.restore();
}
