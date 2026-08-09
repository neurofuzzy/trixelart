/**
 * Layer blend modes: how a layer's rendered result combines with the artwork
 * beneath it.
 *
 * The first effect that is neither geometry nor a per-colour filter — it is
 * *compositing*, a property of the layer's relationship to what is below rather
 * than of its own content. So unlike `adjust` and `noise`, which ride the two
 * places a step's colours are produced, this one lives one level up: each
 * backend composites a whole render step at a time.
 *
 * **The names are shared between both worlds.** Canvas's
 * `globalCompositeOperation` and CSS's `mix-blend-mode` use identical strings
 * for the separable blend modes and are both defined by Compositing and
 * Blending Level 1, so a single stored value drives the preview, the raster
 * exports and the SVG exports with no translation table to drift.
 */

/**
 * The modes offered. Deliberately the six separable ones that read as artwork
 * moves — the non-separable set (hue, colour, saturation, luminosity) is
 * omitted rather than unimplemented; nothing here would need to change to add
 * them.
 */
export type BlendMode =
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "difference";

export const BLEND_MODES: { mode: BlendMode; label: string; title: string }[] = [
  { mode: "multiply", label: "Multiply", title: "Darkens: white is transparent" },
  { mode: "screen", label: "Screen", title: "Lightens: black is transparent" },
  {
    mode: "overlay",
    label: "Overlay",
    title: "Multiply on dark backdrop, screen on light",
  },
  {
    mode: "soft-light",
    label: "Soft light",
    title: "A gentle overlay — dodges and burns the backdrop",
  },
  {
    mode: "hard-light",
    label: "Hard light",
    title: "Overlay with the roles swapped — the layer decides",
  },
  {
    mode: "difference",
    label: "Difference",
    title: "Absolute difference of the two — inverts on white",
  },
];

/**
 * Draws into an offscreen copy of `ctx`'s surface, then composites the result
 * back in one operation.
 *
 * **A step has to be flattened before it blends, not blended per shape.** The
 * shapes inside one step overlap in three places — the seam-closing overdraw
 * stroke laps onto its neighbour, a rounded region's grain sits over its own
 * solid fill, and a glow is painted under the very layer that casts it. Setting
 * the composite operation on the live context blends each of those against the
 * one before, so `multiply` grows a dark line along every seam and burns the
 * layer through its own shadow. Painting the step to a transparent buffer first
 * makes those overlaps ordinary source-over draws, exactly as they are today,
 * and the *finished* layer is what meets the backdrop — which is also what
 * `mix-blend-mode` on a `<g>` does, so the file and the preview agree.
 *
 * The buffer inherits the caller's transform, so the drawing code is unchanged
 * and world coordinates still mean what they did. Compositing happens at
 * identity: the buffer is the same pixel grid as the target.
 */
/**
 * One reusable buffer per nesting level, kept rather than allocated per call.
 *
 * The preview redraws on every pan, hover and marching-ants tick, so a fresh
 * multi-megabyte canvas per blended layer per frame is churn the compositor can
 * feel. Levels nest at most twice today — the raster exports isolate the whole
 * artwork inside one buffer and then blend a step inside that — and the index
 * is what keeps those two from being the same surface.
 */
const buffers: HTMLCanvasElement[] = [];
let depth = 0;

export function drawComposited(
  ctx: CanvasRenderingContext2D,
  op: GlobalCompositeOperation,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const buffer = (buffers[depth] ??= document.createElement("canvas"));
  const bctx = buffer.getContext("2d");
  // Losing the blend is a far smaller wrong than losing the layer.
  if (!bctx) {
    draw(ctx);
    return;
  }

  const { width, height } = ctx.canvas;
  if (buffer.width !== width) buffer.width = width;
  if (buffer.height !== height) buffer.height = height;
  // Explicitly, not as a side effect of the resize above: a same-size reuse
  // resizes nothing, and a buffer still holding the previous step would blend
  // that step in a second time.
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.globalCompositeOperation = "source-over";
  bctx.globalAlpha = 1;
  bctx.filter = "none";
  bctx.clearRect(0, 0, width, height);

  bctx.setTransform(ctx.getTransform());
  depth++;
  try {
    draw(bctx);
  } finally {
    depth--;
  }

  ctx.save();
  // The current clip is in device space and still applies; only the CTM is
  // reset, because the buffer is already in target pixels.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = op;
  ctx.drawImage(buffer, 0, 0);
  ctx.restore();
}
