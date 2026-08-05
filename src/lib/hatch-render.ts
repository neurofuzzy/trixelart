import { getTriVertices } from "@/lib/grid-math";
import { resolveColor } from "@/lib/constants";
import { activeEffects, layerKind, type Layer, type LayerEffect } from "@/hooks/use-history";
import { OUTLINE_WEIGHT_AT_FULL } from "@/lib/round-corners";
import {
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

    const lines = hatchLinesInBox(g.dir, g.density, clipped);
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

    const lines = hatchLinesInBox(g.dir, g.density, gen);
    if (lines.length === 0) continue;
    const color = resolveColor(g.color);

    for (const t of g.tris) {
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
