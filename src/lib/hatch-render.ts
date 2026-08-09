import { getTriVertices, stringToTri, type TriKey } from "@/lib/grid-math";
import { regionMembership, type HexRegion } from "@/lib/hex-flower";
import { resolveColor } from "@/lib/constants";
import { colorAdjuster } from "@/lib/color-adjust";
import type {
  NoisePeriod,
  SubdivisionNoiseSpec,
} from "@/lib/subdivision-noise";
import { activeEffects, layerKind, type Layer, type LayerEffect } from "@/hooks/use-history";
import { OUTLINE_WEIGHT_AT_FULL, type RoundedRing } from "@/lib/round-corners";
import {
  GLOW_RADIUS_AT_FULL,
  silhouetteGeometry,
  type GlowSpec,
} from "@/lib/glow";
import {
  arcSegmentsInTri,
  clipSegmentToRect,
  clipSegmentToTriangle,
  groupHatchMarks,
  hatchLinesInBox,
  intersectBox,
  trisBox,
  type Box,
  type Seg,
} from "@/lib/hatch";

/** One drawing pass for an exporter: either a batch of fill layers flattened
 *  together, or a single hatch layer. */
export type RenderStep =
  | { kind: "fill"; painted: Record<string, string>; effects: LayerEffect[] }
  | { kind: "hatch"; painted: Record<string, string> };

/** The rounding radius a fill step should be drawn with, or 0 for none. Effects
 *  are a list so a second one can be added later; today exactly one changes
 *  geometry, and a step with none must render identically to before effects
 *  existed. */
export function stepRoundRadius(step: RenderStep): number {
  if (step.kind !== "fill") return 0;
  for (const e of step.effects) {
    if (e.type === "roundCorners" && e.enabled) return e.radius;
  }
  return 0;
}

/**
 * The rounding radius for an export that has already **merged** its fill
 * layers: the largest enabled one, as a 0–1 fraction.
 *
 * The fabrication exports (3D, cutting, apparel, plotter) all flatten the fill
 * stack into one painted map before they look at geometry, and that merge throws
 * away layer identity — so a per-layer radius cannot survive it and something
 * has to win. The largest is both predictable and the right reading of the
 * intent: if the artwork reads as rounded, the fabricated version should too.
 *
 * This is deliberately *not* `stepRoundRadius`. That one answers the question
 * for a single render step, where a step exists precisely because its effects
 * are uniform; this one answers it for a pile of layers that no longer have
 * steps at all.
 */
export function layersRoundFraction(layers: Layer[]): number {
  let max = 0;
  for (const layer of layers) {
    if (!layer.visible || layerKind(layer) === "hatch") continue;
    for (const e of activeEffects(layer)) {
      if (e.type === "roundCorners") max = Math.max(max, e.radius);
    }
  }
  return max;
}

/** The outline stroke width a fill step should be drawn with, in world units,
 *  or 0 for none. Like `stepRoundRadius`, an effect whose weight is zero is a
 *  no-op and must render identically to no effect at all. */
export function stepOutlineWeight(step: RenderStep): number {
  if (step.kind !== "fill") return 0;
  for (const e of step.effects) {
    if (e.type === "outline" && e.enabled) {
      return e.weight * OUTLINE_WEIGHT_AT_FULL;
    }
  }
  return 0;
}

/** The glow a fill step casts, or `null` for none. Like the other two step
 *  readers, an effect that reduces to a no-op must render identically to no
 *  effect at all — `activeEffects` has already dropped those. */
export function stepGlow(step: RenderStep): GlowSpec | null {
  if (step.kind !== "fill") return null;
  for (const e of step.effects) {
    if (e.type === "glow" && e.enabled) {
      return {
        sigma: e.radius * GLOW_RADIUS_AT_FULL,
        opacity: e.opacity,
        color: resolveColor(e.color),
      };
    }
  }
  return null;
}

/**
 * The colour filter a fill step's colours pass through, or `undefined` for none.
 *
 * The odd one out among the four step readers: the other three describe
 * geometry, and every backend already had somewhere to put a radius, a weight or
 * a shadow. This one is threaded into the *two* places a step's colours are
 * produced — `generateTriangles` and `stepRegionGeometry` — rather than applied
 * at each of the dozen places a fill is emitted, so no backend can forget it and
 * none of the emit code had to change.
 *
 * Returning `undefined` rather than an identity function is what keeps an
 * unadjusted step on exactly the code path it walked before this effect existed.
 */
export function stepColorAdjust(
  step: RenderStep,
): ((hex: string) => string) | undefined {
  if (step.kind !== "fill") return undefined;
  for (const e of step.effects) {
    if (e.type === "adjustColor" && e.enabled) return colorAdjuster(e);
  }
  return undefined;
}

/**
 * The dither a fill step's cells are subdivided with, or `null` for none.
 *
 * Reads like `stepGlow`, but what it describes is neither geometry nor colour on
 * its own: it turns one painted cell into four fills. It rides the same two
 * chokepoints `stepColorAdjust` uses — `generateTriangles` for the flat path,
 * and a clip against `stepRegionGeometry`'s rings for the rounded one — so a
 * backend gets it by passing the spec along rather than by growing a fifth
 * branch of its own.
 */
export function stepSubdivisionNoise(
  step: RenderStep,
  period?: NoisePeriod,
): SubdivisionNoiseSpec | null {
  if (step.kind !== "fill") return null;
  for (const e of step.effects) {
    if (e.type === "subdivisionNoise" && e.enabled && e.amount > 0) {
      // `period` is the crop's repeat, supplied by the backend rather than
      // stored on the effect — every backend must pass the *same* one or the
      // preview and the file grow different grain.
      return { amount: e.amount, seed: e.seed, mode: e.mode, period };
    }
  }
  return null;
}

/**
 * Per step index, the surface its glow lands on: the accumulated silhouettes of
 * every *fill* step below it, each honouring its own round radius. `null` where
 * the step casts no glow, or where nothing lies beneath it to catch one.
 *
 * A shadow falls on a surface rather than hanging over bare canvas, so this is
 * what the four backends clip the blur to. Computing it here rather than in each
 * of them is the same reasoning as `stepRegionGeometry`: they cannot disagree
 * about what "below" means if there is only one definition.
 *
 * Hatch steps contribute nothing — line work bounds no solid area, the same
 * reason the apparel cut reads fill layers only. A lower layer carrying an
 * outline effect contributes its whole region rather than just its stroke
 * ribbon; a shadow landing inside a hollow outline is a far smaller wrong than
 * the bookkeeping to avoid it.
 */
export function glowReceivers(plan: RenderStep[]): (RoundedRing[] | null)[] {
  const out: (RoundedRing[] | null)[] = plan.map(() => null);

  // Nothing above the topmost glow needs accumulating, and most documents have
  // no glow at all — in which case this returns immediately without walking a
  // single region.
  let lastGlow = -1;
  for (let i = 0; i < plan.length; i++) if (stepGlow(plan[i])) lastGlow = i;
  if (lastGlow < 0) return out;

  const below: RoundedRing[] = [];
  for (let i = 0; i <= lastGlow; i++) {
    const step = plan[i];
    if (stepGlow(step) && below.length) out[i] = below.slice();
    if (step.kind === "fill") {
      below.push(...silhouetteGeometry(step.painted, stepRoundRadius(step)));
    }
  }
  return out;
}

/**
 * Visible layers, bottom to top, with *consecutive* effect-free fill layers
 * coalesced.
 *
 * The coalescing is what keeps hatch-free documents exporting exactly as before:
 * `generateSVG` used to receive one pre-flattened map, so `mergeTrianglesByColor`
 * welded shapes across layer boundaries. Emitting a group per layer instead
 * would silently regress that merge. A run is only broken where a hatch layer
 * genuinely sits between fills — which is correct, because z-order demands it.
 *
 * **A run is also broken wherever either side carries an active effect.** An
 * effect reads the step's coalesced map to find region boundaries, so flattening
 * two layers together lets one layer's cells influence the other's geometry:
 * two same-colour rounded layers would weld into a single region and round as
 * one shape, an unrounded layer's cells would be pulled into a neighbour's
 * rounded region, and two different radii would silently pick one. Layers with
 * an effect must round against their *own* painted content, so each one is its
 * own step. Only layers with none coalesce, which is the common case (all of
 * them carrying none).
 */
/**
 * The same layer stack with everything outside the hex selection erased, or the
 * stack untouched when there is no selection.
 *
 * A *pre*-plan transform, deliberately: every backend already walks
 * `buildRenderPlan`, so clipping the painted maps on the way in makes
 * "selection only" mean the same thing in the SVG file, the plot and anything
 * added later, with no per-exporter code. It runs before the plan rather than
 * after it because the plan coalesces layers — filtering a step's map would
 * still be correct, but the layer array is the thing the callers already hold.
 *
 * Geometry effects then read the *clipped* map, so a region cut by the
 * selection edge rounds and outlines against its new boundary rather than
 * against the shape it had in the full artwork. That is the intent: the export
 * is of the selection, not a window onto the whole piece.
 */
export function clipLayersToSelection(
  layers: Layer[],
  regions: HexRegion[],
): Layer[] {
  const inside = regionMembership(regions);
  if (!inside) return layers;
  return layers.map((layer) => {
    const painted: Record<string, string> = {};
    for (const [key, value] of Object.entries(layer.painted)) {
      if (inside(stringToTri(key))) painted[key] = value;
    }
    return { ...layer, painted };
  });
}

export function buildRenderPlan(layers: Layer[]): RenderStep[] {
  const steps: RenderStep[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    if (layerKind(layer) === "hatch") {
      steps.push({ kind: "hatch", painted: layer.painted });
      continue;
    }
    const effects = activeEffects(layer);
    const last = steps[steps.length - 1];
    if (
      last &&
      last.kind === "fill" &&
      last.effects.length === 0 &&
      effects.length === 0
    ) {
      Object.assign(last.painted, layer.painted);
    } else {
      steps.push({ kind: "fill", painted: { ...layer.painted }, effects });
    }
  }
  return steps;
}

/**
 * Two backends for one shape: bucket a hatch layer's marks into groups, then
 * draw the whole line family of each group.
 *
 * The family is generated across the *group's* bounding box and clipped — never
 * generated per triangle. That is what makes hatching continuous across trixel
 * boundaries: neighbouring triangles are covered by the same lines rather than
 * by two independently-phased sets.
 */

/**
 * Draws a hatch layer onto a canvas already in world space.
 *
 * One clip + one stroke per group, not per triangle — the group's whole line
 * family is stroked through a single clip region, so the cost is proportional to
 * the number of *lines on screen* rather than to marks × density. `viewBox`
 * restricts line generation to what's visible; without it a large document
 * regenerates its full extent on every pointer move.
 *
 * `zoom` is only used to keep strokes visible when zoomed out, the same
 * `Math.max(w, k / zoom)` trick the grid outlines use. Exports pass no zoom and
 * get the true world weight.
 */
/** Whether a triangle's bounding box overlaps `box`. Deliberately cheap and
 *  conservative — it only has to reject marks that are plainly off-screen. */
function triInBox(t: TriKey, box: Box): boolean {
  const v = getTriVertices(t.q, t.r, t.type);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of v) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return (
    maxX >= box.minX && minX <= box.maxX && maxY >= box.minY && minY <= box.maxY
  );
}

export function drawHatchLayer(
  ctx: CanvasRenderingContext2D,
  marks: Record<string, string>,
  viewBox?: Box,
  zoom?: number,
): void {
  const { groups } = groupHatchMarks(marks);

  for (const g of groups) {
    const box = trisBox(g.tris);
    if (!box) continue;
    const clipped = viewBox ? intersectBox(box, viewBox) : box;
    if (!clipped) continue;

    // Arc centres move with each triangle, so unlike a line family they cannot
    // be generated once for the whole group. The clip still earns its keep: it
    // trims the outer radii where they bulge past the opposite edge.
    const lines = g.kind === "arc"
      ? g.tris.flatMap((t) =>
          // Off-screen marks are skipped individually. A line family is bounded
          // by `clipped` when it is *generated*; arcs are generated per mark, so
          // without this a large document rebuilds its whole extent on every
          // pointer move — the same trap `viewBox` exists to avoid.
          triInBox(t, clipped)
            ? arcSegmentsInTri(g.dir, g.density, t.q, t.r, t.type)
            : [],
        )
      : hatchLinesInBox(g.dir, g.density, clipped);
    if (lines.length === 0) continue;

    ctx.save();

    // Clip to the union of the group's triangles, then stroke the family once.
    ctx.beginPath();
    for (const t of g.tris) {
      const [a, b, c] = getTriVertices(t.q, t.r, t.type);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
    }
    ctx.clip();

    ctx.strokeStyle = resolveColor(g.color);
    ctx.lineWidth = zoom ? Math.max(g.weight, 0.75 / zoom) : g.weight;
    ctx.lineCap = "butt";
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of lines) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();

    ctx.restore();
  }
}

export interface HatchStroke {
  seg: Seg;
  /** Resolved `#rrggbb`. */
  color: string;
  weight: number;
}

/**
 * Hatch as explicit clipped segments, for SVG.
 *
 * Each family line is clipped geometrically to each triangle rather than hidden
 * behind a `<clipPath>` — the same decision the crop exporter makes, so the file
 * opens clean in Inkscape with nothing spilling outside the artwork. Segments
 * from adjacent triangles abut exactly, so they read as one line.
 */
export function hatchStrokes(
  marks: Record<string, string>,
  clipBox?: Box,
): HatchStroke[] {
  const { groups } = groupHatchMarks(marks);
  const out: HatchStroke[] = [];

  for (const g of groups) {
    const box = trisBox(g.tris);
    if (!box) continue;
    const gen = clipBox ? intersectBox(box, clipBox) : box;
    if (!gen) continue;

    const shared = g.kind === "arc" ? null : hatchLinesInBox(g.dir, g.density, gen);
    if (shared && shared.length === 0) continue;
    const color = resolveColor(g.color);

    for (const t of g.tris) {
      // Per triangle for arcs, one shared family for lines.
      const lines =
        shared ?? arcSegmentsInTri(g.dir, g.density, t.q, t.r, t.type);
      for (const line of lines) {
        const tri = clipSegmentToTriangle(line, t.q, t.r, t.type);
        if (!tri) continue;
        // A triangle straddling the crop edge yields a chord that still pokes
        // outside it, so the rect clip has to run after the triangle clip.
        const seg = clipBox ? clipSegmentToRect(tri, clipBox) : tri;
        if (seg) out.push({ seg, color, weight: g.weight });
      }
    }
  }

  return out;
}

/** World-space bounds of a hatch layer's strokes, for document sizing. */
export function hatchStrokesBounds(strokes: HatchStroke[]): Box | null {
  if (strokes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { seg } of strokes) {
    for (const [x, y] of [[seg[0], seg[1]], [seg[2], seg[3]]] as const) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}
