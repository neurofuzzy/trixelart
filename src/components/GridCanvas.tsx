"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import { SIDE, H, getTriVertices, worldToTri, type TriKey, type TriType } from "@/lib/grid-math";
import { hexCenterWorld, enumerateHexTrixels, triToHex, placementAnchor, regionContaining, regionCorners, regionKey, regionTrixels, hexWedgeIndex, type HexRegion, type SelectionSnapshot } from "@/lib/hex-flower";
import { isNoPrint, resolveColor } from "@/lib/constants";
import type { HexMode } from "@/components/Footer";
import { type Layer } from "@/hooks/use-history";
import type { Tool } from "@/lib/tools";
import { cropWorldBounds, handlePositions, type CropRect } from "@/lib/crop";
import {
  buildRenderPlan,
  stepBlendMode,
  stepColorAdjust,
  stepGlow,
  stepRoundRadius,
  stepOutlineWeight,
  stepSubdivisionNoise,
  glowReceivers,
  type RenderStep,
} from "@/lib/hatch-render";
import {
  groupHatchMarks,
  hatchLinesInBox,
  arcSegmentsInTri,
  intersectBox,
  trisBox,
  type Box,
} from "@/lib/hatch";
import {
  noiseSubFills,
  noiseRegionFills,
  type SubFill,
} from "@/lib/subdivision-noise";
import {
  stepRegionGeometry,
  type RoundedRing,
} from "@/lib/round-corners";
import { silhouetteGeometry } from "@/lib/glow";
import { GLRenderer, hexColor, type FillBatch, type Color4 } from "@/lib/webgl/renderer";

/**
 * The hexagon the stamp and select hover cues outline: the region their next
 * click would act on, or null when there is nothing hex-shaped to show.
 *
 * It exists because "the hex under the cursor" stopped being one thing. Each
 * case picks its own anchor, and each has to match the tool it previews:
 *  - **stamp, placing** — `placementAnchor`, sized by the snapshot it would
 *    lay down. Free of the honeycomb in world mode, exactly as the commit is;
 *  - **stamp, capturing** — a honeycomb hex, because capture still reads one;
 *  - **select, over the current selection** — that region, which is what a
 *    drag would pick up, placed on the selection's own (possibly shifted)
 *    lattice;
 *  - **select, anywhere else** — where a fresh selection would land.
 */
function stampSelectHoverRegion(a: {
  tool: Tool;
  tri: TriKey;
  gridDivisions: number;
  hexLatticeOn: boolean;
  captureMode: boolean;
  activeSelection: SelectionSnapshot | null;
  selectedHexes: HexRegion[];
  selAnchor: HexRegion | null;
}): HexRegion | null {
  const N = a.gridDivisions;
  if (N <= 0) return null;

  if (a.tool === "stamp") {
    if (a.captureMode) return regionContaining(a.tri, N, null);
    // World mode places a snapshot of any size, and the outline has to be the
    // size of the thing being placed, not of the current lattice.
    const size = a.hexLatticeOn ? N : (a.activeSelection?.N ?? N);
    return { ...placementAnchor(a.tri, N, a.hexLatticeOn), N: size };
  }

  if (a.tool === "select") {
    const onLattice =
      a.selAnchor && a.selAnchor.N === N
        ? regionContaining(a.tri, N, a.selAnchor)
        : null;
    if (
      onLattice &&
      a.selectedHexes.some((h) => regionKey(h) === regionKey(onLattice))
    ) {
      return onLattice;
    }
    return { ...placementAnchor(a.tri, N, a.hexLatticeOn), N };
  }

  return null;
}

/** What the draw is culled to: the visible world box and the lattice index
 *  range covering it. */
interface DrawView extends Box {
  zoom: number;
  minR: number;
  maxR: number;
  minQ: number;
  maxQ: number;
}

/** The geometry a fill *step* batches into the GPU once per plan: whatever the
 *  cells of a plain (unrounded) step would paint, with colour adjust and
 *  subdivision noise already baked into the vertex colours. */
interface FillGeometry {
  positions: Float32Array;
  colors: Float32Array;
}

/** The rounded/outline geometry of one step, from `effectPlan`. */
interface EffectStep {
  radius: number;
  outline: number;
  adjust: ((hex: string) => string) | undefined;
  regionFills: Map<string, SubFill[]> | null;
  regions: { fill: string; base: string; rings: RoundedRing[] }[];
}

/** The glow geometry of one step, from `glowPlan`. */
interface GlowStep {
  spec: { sigma: number; opacity: number; color: string };
  caster: RoundedRing[];
  receiver: RoundedRing[];
}

/** Sub-fill pieces flattened into triangles, with the colour-adjust filter
 *  applied. A quad piece fans into two triangles; a triangle passes through. */
function subFillsTriangles(fills: SubFill[], adjust?: (hex: string) => string): FillGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const pushTri = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
    hex: string,
  ) => {
    const rgb = hexColor(hex);
    pos.push(a.x, a.y, b.x, b.y, c.x, c.y);
    for (let k = 0; k < 3; k++) col.push(rgb[0], rgb[1], rgb[2], rgb[3]);
  };
  for (const f of fills) {
    const hex = adjust ? adjust(f.hex) : f.hex;
    if (f.points.length === 3) {
      pushTri(f.points[0], f.points[1], f.points[2], hex);
    } else if (f.points.length >= 4) {
      pushTri(f.points[0], f.points[1], f.points[2], hex);
      pushTri(f.points[0], f.points[2], f.points[3], hex);
    }
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}

/**
 * Builds the retained geometry of one plain fill step, or null for a step the
 * effect path draws per frame (rounded/outlined) or that has nothing to paint.
 * No viewport culling: the whole layer is uploaded once so pan and the marching
 * ants tick redraw without rebuilding geometry.
 */
function fillStepGeometry(
  step: RenderStep,
  noisePeriod: { m: number; n: number } | undefined,
): FillGeometry | null {
  if (step.kind !== "fill") return null;
  const radius = stepRoundRadius(step);
  const outline = stepOutlineWeight(step);
  if (radius > 0 || outline > 0) return null;
  const adjust = stepColorAdjust(step);
  const noise = stepSubdivisionNoise(step, noisePeriod);

  const pos: number[] = [];
  const col: number[] = [];
  const pushTri = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
    rgb: Color4,
  ) => {
    pos.push(a.x, a.y, b.x, b.y, c.x, c.y);
    for (let k = 0; k < 3; k++) col.push(rgb[0], rgb[1], rgb[2], rgb[3]);
  };

  for (const [key, encoded] of Object.entries(step.painted)) {
    const parts = key.split(",");
    if (parts.length !== 3) continue;
    const q = parseInt(parts[0]);
    const r = parseInt(parts[1]);
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
    const type = parts[2] as TriType;
    if (isNoPrint(encoded)) continue;

    if (noise) {
      const sub = subFillsTriangles(noiseSubFills(q, r, type, encoded, noise), adjust);
      for (let i = 0; i < sub.positions.length; i++) {
        pos.push(sub.positions[i]);
        col.push(sub.colors[i]);
      }
      continue;
    }

    const resolved = adjust ? adjust(resolveColor(encoded)) : resolveColor(encoded);
    const rgb = hexColor(resolved);
    const [a, b, c] = getTriVertices(q, r, type);
    pushTri(a, b, c, rgb);
  }

  return pos.length ? { positions: new Float32Array(pos), colors: new Float32Array(col) } : null;
}

/** Whether a triangle's bounding box overlaps `box` — the cheap off-screen test
 *  the hatch arc path wants so a large document does not rebuild its whole arc
 *  set on every pointer move. */
function triInBox(t: TriKey, box: Box): boolean {
  const v = getTriVertices(t.q, t.r, t.type);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of v) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX >= box.minX && minX <= box.maxX && maxY >= box.minY && minY <= box.maxY;
}

export function GridCanvas({
  size,
  view,
  mounted,
  layers,
  hoverTargets,
  screenToWorld,
  gridDivisions,
  hexMode,
  selectedHexes,
  tool,
  activeSelection,
  stampFlash,
  cloneFlash,
  cloneSource,
  cloneOffset,
  captureMode,
  gridRotation = 0,
  brushSize,
  symmetry,
  hueOffset,
  saturationOffset,
  crop,
  showCrop = false,
  showNoPrint = true,
}: {
  size: { width: number; height: number };
  view: { x: number; y: number; zoom: number };
  mounted: boolean;
  layers: Layer[];
  hoverTargets: TriKey[];
  screenToWorld: (sx: number, sy: number) => { x: number; y: number };
  gridDivisions: number;
  hexMode: HexMode;
  selectedHexes: HexRegion[];
  tool: Tool;
  activeSelection: SelectionSnapshot | null;
  stampFlash: { c: number; k: number; opacity: number; seq: number } | null;
  cloneFlash?: { c: number; k: number; q: number; r: number; type: string; opacity: number; seq: number } | null;
  cloneSource?: { x: number; y: number; q: number; r: number; type: string } | null;
  cloneOffset?: { x: number; y: number } | null;
  captureMode?: boolean;
  gridRotation?: number;
  brushSize?: "single" | "hex";
  symmetry?: "off" | "sym60" | "sym120";
  hueOffset?: number;
  saturationOffset?: number;
  crop?: CropRect;
  showCrop?: boolean;
  /** Editor-only visibility for no-print markers. They shape the artwork
   *  either way; this only decides whether the scaffolding is drawn. */
  showNoPrint?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [antPhase, setAntPhase] = useState(0);
  const [renderer, setRenderer] = useState<GLRenderer | null>(null);

  // Marching-ants animation tick (8 px/s equivalent in screen px). Stops
  // when there's no selection so we don't repaint forever.
  useEffect(() => {
    if (selectedHexes.length === 0) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setAntPhase(((now - start) / 1000) * 24);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedHexes]);

  // Create the WebGL renderer once the canvas is in the DOM.
  useEffect(() => {
    if (renderer || !canvasRef.current) return;
    try {
      setRenderer(new GLRenderer(canvasRef.current));
    } catch (e) {
      console.error("WebGL init failed:", e);
    }
  }, [renderer]);

  // The same plan the exporters walk, so preview and file agree on coalescing.
  const plan = useMemo(() => buildRenderPlan(layers), [layers]);

  // The grain folds onto the crop's repeat, so the preview shows the pattern the
  // fabric tile will actually carry.
  //
  // Keyed on the two numbers, never on `crop` itself: the crop object is
  // replaced on every handle drag, and a new identity here would invalidate
  // `effectPlan` and rebuild every region's geometry mid-gesture. Only `m` and
  // `n` change the grain — where the crop sits does not, because the grain is
  // periodic under the crop's own translations and any window of that size
  // tiles. Read out first so the dependency really is the two numbers.
  const cropM = crop?.m;
  const cropN = crop?.n;
  const noisePeriod = useMemo(
    () =>
      cropM !== undefined && cropN !== undefined
        ? { m: cropM, n: cropN }
        : undefined,
    [cropM, cropN],
  );

  // Effect geometry (rounding + outline), memoised on the plan. Rebuilt only
  // when a stroke lands or a slider moves — never on pan, zoom, hover or the
  // marching-ants tick, which is exactly why it lands here rather than inside
  // the draw effect.
  //
  // The offsets are dependencies even though they are not arguments: regions are
  // grouped by *resolved* colour, and `resolveColor` reads the global hue and
  // saturation shift. Without them a palette shift would leave the previous
  // colours — and the region boundaries they implied — baked into the memo.
  const effectPlan = useMemo(
    () =>
      plan.map((step) => {
        if (step.kind !== "fill") return null;
        const radius = stepRoundRadius(step);
        const outline = stepOutlineWeight(step);
        if (radius <= 0 && outline <= 0) return null;
        const adjust = stepColorAdjust(step);
        const noise = stepSubdivisionNoise(step, noisePeriod);
        return {
          radius,
          outline,
          adjust,
          // Memoised here rather than rebuilt per frame: this path cannot be
          // viewport-culled, so it must not land on a pan or a hover.
          regionFills:
            noise && outline <= 0
              ? noiseRegionFills(step.painted, noise)
              : null,
          regions: stepRegionGeometry(step.painted, radius, adjust),
        } as EffectStep;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, hueOffset, saturationOffset, noisePeriod],
  );

  // Glow geometry, memoised on the same key and for the same reason. Kept apart
  // from `effectPlan` because a glow needs two shapes rather than one: the
  // caster (this step's own silhouette) and the receiver (everything below it).
  const glowPlan = useMemo(() => {
    const receivers = glowReceivers(plan);
    return plan.map((step, si) => {
      const spec = stepGlow(step);
      const receiver = receivers[si];
      if (!spec || !receiver) return null;
      return {
        spec,
        receiver,
        caster: silhouetteGeometry(step.painted, stepRoundRadius(step)),
      } as GlowStep;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, hueOffset, saturationOffset]);

  // The retained artwork geometry: one FillBatch per unrounded fill step, built
  // once per plan/offset change and redrawn identically on every pan and hover.
  const fillGeo = useMemo(
    () => plan.map((step) => fillStepGeometry(step, noisePeriod)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, hueOffset, saturationOffset, noisePeriod],
  );

  const fillBatchesRef = useRef<(FillBatch | null)[] | null>(null);

  useEffect(() => {
    if (!renderer) return;
    const old = fillBatchesRef.current;
    if (old) for (const b of old) if (b) renderer.disposeFillBatch(b);
    const batches = fillGeo.map((g) => (g ? renderer.makeFillBatch(g.positions, g.colors) : null));
    fillBatchesRef.current = batches;
    return () => {
      const cur = fillBatchesRef.current;
      if (cur) for (const b of cur) if (b) renderer.disposeFillBatch(b);
      fillBatchesRef.current = null;
    };
  }, [renderer, fillGeo]);

  // ---- per-frame drawing ---------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderer || size.width === 0 || !mounted) return;

    const r = renderer;
    const dpr = window.devicePixelRatio || 1;
    r.resize(size.width, size.height, dpr);
    r.setView({ x: view.x, y: view.y, zoom: view.zoom, rotation: gridRotation });
    r.beginFrame();

    // Visible world bounds: when rotated, the screen's 4 corners map to a
    // rotated rectangle in world space, so we sample all four corners and take
    // their envelope to ensure no visible triangle is skipped.
    const buffer = 3;
    const corners = [
      screenToWorld(0, 0),
      screenToWorld(size.width, 0),
      screenToWorld(0, size.height),
      screenToWorld(size.width, size.height),
    ];
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));
    const minR = Math.floor(minY / H) - buffer;
    const maxR = Math.ceil(maxY / H) + buffer;
    const minQ = Math.floor(Math.min(minX, maxX) / SIDE - maxR * 0.5) - buffer;
    const maxQ = Math.ceil(Math.max(minX, maxX) / SIDE - minR * 0.5) + buffer;
    const drawView: DrawView = { minX, minY, maxX, maxY, minR, maxR, minQ, maxQ, zoom: view.zoom };

    // Artwork — bottom-to-top through the same plan the exporters walk. A
    // blended layer lands in an isolated buffer first and composites whole.
    const batches = fillBatchesRef.current ?? [];
    for (let si = 0; si < plan.length; si++) {
      const step = plan[si];
      if (step.kind === "hatch") {
        drawHatchStep(r, step, drawView);
        continue;
      }
      const blend = stepBlendMode(step);
      if (blend) {
        r.beginBlendStep();
        drawFillStep(r, si, effectPlan, glowPlan, batches);
        const layerTex = r.endBlendStep();
        r.compositeStep(layerTex, blend);
        r.setOpaque();
      } else {
        drawFillStep(r, si, effectPlan, glowPlan, batches);
      }
    }

    // No-print markers, drawn over the artwork as scaffolding rather than paint.
    // They are editor-only by definition — every exporter drops them.
    if (showNoPrint) {
      drawNoPrint(r, layers, drawView);
    }

    // Grid outlines, division guides and the hex honeycomb overlay.
    drawGrid(r, drawView, gridDivisions);
    drawHexOverlay(r, drawView, hexMode, gridDivisions, view.zoom);

    // Selection overlay — cyan tint + marching-ants hex outline, drawn from each
    // region's own anchor and size rather than from the lattice.
    if (selectedHexes.length > 0 && gridDivisions > 0) {
      drawSelectionOverlay(r, selectedHexes, antPhase, view.zoom);
    }

    // Export crop overlay. Drawn in the world transform, so the rotation that
    // makes a pointy-top grid is already applied.
    if (showCrop && crop) {
      drawCropOverlay(r, crop, view.zoom);
    }

    // Stamp / clone flashes.
    if (stampFlash && gridDivisions > 0) {
      drawStampFlash(r, stampFlash, gridDivisions);
    }
    if (cloneFlash && gridDivisions > 0) {
      drawCloneFlash(r, cloneFlash);
    }

    // Stamp preview: render the active selection's trixels translated to where
    // a stamp would land, using their real colours. Skip in capture mode.
    const hexLatticeOn = hexMode !== "world" && gridDivisions > 0;
    const selAnchor = selectedHexes[0] ?? null;
    if (
      tool === "stamp" &&
      !captureMode &&
      hoverTargets.length > 0 &&
      activeSelection &&
      (!hexLatticeOn || gridDivisions === activeSelection.N)
    ) {
      drawStampPreview(r, hoverTargets[0], activeSelection, gridDivisions, hexLatticeOn);
    }

    // Clone source cursor — green triangle outline at the persistent offset.
    if (tool === "clone" && cloneSource && hoverTargets.length > 0) {
      drawCloneCursor(r, hoverTargets[0], cloneSource, cloneOffset ?? null, view.zoom);
    }

    // Hover outlines — primary + affected (flower/symmetry) ghosts.
    if (hoverTargets.length > 0) {
      drawHover(r, {
        tool,
        hoverTargets,
        brushSize,
        gridDivisions,
        hexLatticeOn,
        captureMode: !!captureMode,
        activeSelection,
        selectedHexes,
        selAnchor,
        cloneSource: cloneSource ?? null,
        viewZoom: view.zoom,
      });
    }

    r.endFrame();
  }, [
    size, view, plan, effectPlan, glowPlan, hoverTargets, mounted, screenToWorld,
    gridDivisions, hexMode, selectedHexes, tool, antPhase, activeSelection,
    stampFlash, cloneFlash, cloneSource, cloneOffset, captureMode, gridRotation,
    brushSize, symmetry, hueOffset, saturationOffset, crop, showCrop, noisePeriod,
    showNoPrint, layers, renderer, fillGeo,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

// ---------------------------- artwork steps --------------------------------

/**
 * Draws one fill step into the current render target (the artwork accumulator
 * or, for a blended step, the isolated buffer). Glow lands first, then regions
 * (rounded/outlined) or the retained flat batch.
 */
function drawFillStep(
  r: GLRenderer,
  si: number,
  effectPlan: (EffectStep | null)[],
  glowPlan: (GlowStep | null)[],
  batches: (FillBatch | null)[],
): void {
  const geom = effectPlan[si];
  const glow = glowPlan[si];

  // The glow falls on the artwork below, clipped to it, and sits under this
  // step's own fills.
  if (glow) {
    const tex = r.prepareGlow(glow.caster, hexColor(glow.spec.color), glow.spec.sigma);
    r.beginClip(glow.receiver);
    r.setOverlay();
    r.drawTexture(tex, glow.spec.opacity);
    r.endClip();
    r.setOpaque();
  }

  if (!geom) {
    const batch = batches[si];
    if (batch) {
      r.setOpaque();
      r.drawFillBatch(batch);
    }
    return;
  }

  for (const region of geom.regions) {
    const grain = geom.regionFills?.get(region.base);
    const rings = region.rings;
    if (grain?.length) {
      // Solid first, grain clipped over it — the same order the canvas path
      // draws in. The grain covers only the cells the artwork was painted in,
      // while a rounded ring bulges past them at every reflex corner, so the
      // solid fill under the clip is what paints that bulge.
      r.setOpaque();
      r.fillRings(rings, hexColor(region.fill));
      const grainGeo = subFillsTriangles(grain, geom.adjust);
      r.beginClip(rings);
      r.drawTriangles(grainGeo.positions, grainGeo.colors);
      r.endClip();
    } else if (geom.outline > 0) {
      // The outline effect swaps the solid for a stroke of the region boundary
      // at the layer's selected weight; the interior stays empty. Drawn as a
      // uniform-width ring fill, so the joins scale with the weight and never
      // lump on straight runs.
      r.setOpaque();
      r.strokeRingOutline(rings, geom.outline, hexColor(region.fill));
    } else {
      r.fillRings(rings, hexColor(region.fill));
    }
  }
}

function drawHatchStep(r: GLRenderer, step: RenderStep, drawView: DrawView): void {
  if (step.kind !== "hatch") return;
  const { groups } = groupHatchMarks(step.painted);

  for (const g of groups) {
    const box = trisBox(g.tris);
    if (!box) continue;
    const clipped = intersectBox(box, drawView);
    if (!clipped) continue;

    // Arc centres move with each triangle, so unlike a line family they cannot
    // be generated once for the whole group. The clip still earns its keep.
    const lines: number[] = [];
    if (g.kind === "arc") {
      for (const t of g.tris) {
        if (!triInBox(t, clipped)) continue;
        for (const seg of arcSegmentsInTri(g.dir, g.density, t.q, t.r, t.type)) {
          lines.push(seg[0], seg[1], seg[2], seg[3]);
        }
      }
    } else {
      for (const seg of hatchLinesInBox(g.dir, g.density, clipped)) {
        lines.push(seg[0], seg[1], seg[2], seg[3]);
      }
    }
    if (lines.length === 0) continue;

    // Clip to the union of the group's triangles, then stroke the family once.
    const triPositions: number[] = [];
    for (const t of g.tris) {
      for (const v of getTriVertices(t.q, t.r, t.type)) {
        triPositions.push(v.x, v.y);
      }
    }
    const weight = Math.max(g.weight, 0.75 / drawView.zoom);
    r.beginClipTriangles(new Float32Array(triPositions));
    r.setOpaque();
    r.strokeLines(new Float32Array(lines), hexColor(resolveColor(g.color)), weight);
    r.endClip();
  }
}

// ---------------------------- overlays --------------------------------------

function drawNoPrint(r: GLRenderer, layers: Layer[], view: DrawView): void {
  const positions: number[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (let rr = view.minR; rr <= view.maxR; rr++) {
      for (let q = view.minQ; q <= view.maxQ; q++) {
        for (const type of ["up", "down"] as const) {
          if (!isNoPrint(layer.painted[`${q},${rr},${type}`] ?? "")) continue;
          const [a, b, c] = getTriVertices(q, rr, type);
          positions.push(a.x, a.y, b.x, b.y, c.x, c.y);
        }
      }
    }
  }
  if (positions.length) {
    r.setOverlay();
    r.fillTris(new Float32Array(positions), hexColor("#ec4899", 0.35));
  }
}

function drawGrid(r: GLRenderer, view: DrawView, gridDivisions: number): void {
  const gridWidth = Math.max(1.0 / view.zoom, 0.2);
  const segs: number[] = [];

  // Family 1: horizontal lines at y = r*H
  for (let rr = view.minR; rr <= view.maxR + 1; rr++) {
    const y = rr * H;
    segs.push(view.minQ * SIDE + (rr * SIDE) / 2, y, (view.maxQ + 1) * SIDE + (rr * SIDE) / 2, y);
  }
  // Family 2: / diagonals through A(q, r) for fixed q
  for (let q = view.minQ; q <= view.maxQ + 1; q++) {
    segs.push(
      q * SIDE + (view.minR * SIDE) / 2, view.minR * H,
      q * SIDE + ((view.maxR + 1) * SIDE) / 2, (view.maxR + 1) * H,
    );
  }
  // Family 3: \ diagonals through B(q, r) for fixed q+r
  const sumMin = view.minQ + view.minR;
  const sumMax = view.maxQ + view.maxR + 1;
  for (let S = sumMin; S <= sumMax; S++) {
    const qStart = Math.max(view.minQ, S - (view.maxR + 1));
    const qEnd = Math.min(view.maxQ, S - view.minR);
    if (qStart > qEnd) continue;
    segs.push(
      qStart * SIDE + ((S - qStart) * SIDE) / 2 + SIDE, (S - qStart) * H,
      qEnd * SIDE + ((S - qEnd) * SIDE) / 2 + SIDE, (S - qEnd) * H,
    );
  }
  if (segs.length) {
    r.setOverlay();
    r.strokeLines(new Float32Array(segs), hexColor("#ffffff", 0.06), gridWidth);
  }

  // Division / guide lines.
  const divWidth = Math.max(1 / view.zoom, 1);
  const divSegs: number[] = [];
  if (gridDivisions > 0) {
    const N = gridDivisions;
    for (let rr = view.minR; rr <= view.maxR + 1; rr++) {
      if (rr % N !== 0) continue;
      const y = rr * H;
      divSegs.push(view.minQ * SIDE + (rr * SIDE) / 2, y, (view.maxQ + 1) * SIDE + (rr * SIDE) / 2, y);
    }
    for (let q = view.minQ; q <= view.maxQ + 1; q++) {
      if (q % N !== 0) continue;
      divSegs.push(
        q * SIDE + (view.minR * SIDE) / 2, view.minR * H,
        q * SIDE + ((view.maxR + 1) * SIDE) / 2, (view.maxR + 1) * H,
      );
    }
    for (let S = sumMin; S <= sumMax; S++) {
      if ((S + 1) % N !== 0) continue;
      const qStart = Math.max(view.minQ, S - (view.maxR + 1));
      const qEnd = Math.min(view.maxQ, S - view.minR);
      if (qStart > qEnd) continue;
      divSegs.push(
        qStart * SIDE + ((S - qStart) * SIDE) / 2 + SIDE, (S - qStart) * H,
        qEnd * SIDE + ((S - qEnd) * SIDE) / 2 + SIDE, (S - qEnd) * H,
      );
    }
  } else {
    divSegs.push(-10000, 0, 10000, 0);
    divSegs.push(-5000, -8660, 5000, 8660);
    divSegs.push(5000, -8660, -5000, 8660);
  }
  if (divSegs.length) {
    r.setOverlay();
    r.strokeLines(new Float32Array(divSegs), hexColor("#ffffff", 0.15), divWidth);
  }
}

function drawHexOverlay(r: GLRenderer, view: DrawView, hexMode: HexMode, gridDivisions: number, zoom: number): void {
  if (hexMode !== "world" && gridDivisions > 0) {
    const N = gridDivisions;
    const s = N * SIDE;
    const vHalf = N * H;
    const colWidth = 1.5 * s;
    const rowHeight = 2 * vHalf;

    const cMin = Math.floor(view.minX / colWidth) - 1;
    const cMax = Math.ceil(view.maxX / colWidth) + 1;
    const width = Math.max(1.5 / zoom, 1);
    const dotR = Math.max(5 / zoom, 2);

    r.setOverlay();

    for (let c = cMin; c <= cMax; c++) {
      const cx = 1.5 * c * N * SIDE;
      const cyBase = c * N * H;
      const kMin = Math.floor((view.minY - cyBase) / rowHeight) - 1;
      const kMax = Math.ceil((view.maxY - cyBase) / rowHeight) + 1;
      for (let k = kMin; k <= kMax; k++) {
        const cy = cyBase + k * rowHeight;
        r.strokePolyline(
          [cx + s, cy, cx + s / 2, cy + vHalf, cx - s / 2, cy + vHalf, cx - s, cy, cx - s / 2, cy - vHalf, cx + s / 2, cy - vHalf],
          hexColor("#ffffff", 0.16),
          width,
          { close: true },
        );
        if (hexMode === "honeycomb") {
          // Center markers — the origin dot's radius, but dimmer, as the 2D
          // original drew them.
          r.fillCircle(cx, cy, dotR, hexColor("#ffffff", 0.4));
        }
      }
    }
  }

  // Origin marker — the 2D original draws it in every hex mode.
  r.setOverlay();
  r.fillCircle(0, 0, Math.max(5 / zoom, 2), hexColor("#ffffff"));
}

function drawSelectionOverlay(r: GLRenderer, selectedHexes: HexRegion[], antPhase: number, zoom: number): void {
  for (const sel of selectedHexes) {
    const tintPos: number[] = [];
    for (const t of regionTrixels(sel)) {
      const [a, b, c] = getTriVertices(t.q, t.r, t.type);
      tintPos.push(a.x, a.y, b.x, b.y, c.x, c.y);
    }
    if (tintPos.length) {
      r.setOverlay();
      r.fillTris(new Float32Array(tintPos), hexColor("#22d3ee", 0.25));
    }

    const corners = regionCorners(sel);
    const pts: number[] = [];
    for (const p of corners) pts.push(p.x, p.y);
    r.setOverlay();
    r.strokePolyline(pts, hexColor("#22d3ee"), Math.max(2 / zoom, 1.5), {
      close: true,
      cap: "butt",
      // The ants sit in world units, marching at 24 units/s from the tick.
      dash: { period: 14, phase: -antPhase / zoom, on: 8 / 14 },
    });
  }
}

function drawCropOverlay(r: GLRenderer, crop: CropRect, zoom: number): void {
  const c = cropWorldBounds(crop);
  // Dim everything outside the crop: the four bands around the crop rect, which
  // is the same silhouette as the even-odd fill the 2D code drew.
  const dim = hexColor("#000000", 0.55);
  r.setOverlay();
  r.fillRect(-1e6, -1e6, 2e6, c.y + 1e6, dim);
  r.fillRect(-1e6, c.y + c.h, 2e6, 1e6, dim);
  r.fillRect(-1e6, c.y, c.x + 1e6, c.h, dim);
  r.fillRect(c.x + c.w, c.y, 1e6, c.h, dim);

  const amber = hexColor("#fbbf24");
  r.setOverlay();
  r.strokeRect(c.x, c.y, c.w, c.h, amber, Math.max(1.5 / zoom, 1));

  // Handles keep a constant on-screen size, so they stay grabbable at any zoom.
  const hs = 8 / zoom;
  for (const p of handlePositions(crop)) {
    r.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs, amber);
  }
}

function drawStampFlash(r: GLRenderer, flash: { c: number; k: number; opacity: number }, gridDivisions: number): void {
  const positions: number[] = [];
  for (const t of enumerateHexTrixels(flash.c, flash.k, gridDivisions)) {
    const [a, b, c] = getTriVertices(t.q, t.r, t.type);
    positions.push(a.x, a.y, b.x, b.y, c.x, c.y);
  }
  if (positions.length) {
    r.setOverlay();
    r.fillTris(new Float32Array(positions), hexColor("#facc15", flash.opacity * 0.4));
  }
}

function drawCloneFlash(r: GLRenderer, flash: { q: number; r: number; type: string; opacity: number }): void {
  const [a, b, c] = getTriVertices(flash.q, flash.r, flash.type as TriType);
  r.setOverlay();
  r.fillTris(new Float32Array([a.x, a.y, b.x, b.y, c.x, c.y]), hexColor("#4ade80", flash.opacity * 0.5));
}

function drawStampPreview(
  r: GLRenderer,
  hoverTri: TriKey,
  activeSelection: SelectionSnapshot,
  gridDivisions: number,
  hexLatticeOn: boolean,
): void {
  const { qc, rc } = placementAnchor(hoverTri, gridDivisions, hexLatticeOn);
  const positions: number[] = [];
  const colors: number[] = [];
  for (const t of activeSelection.trixels) {
    const rgb = hexColor(resolveColor(t.color), 0.6);
    const [a, b, c] = getTriVertices(qc + t.dq, rc + t.dr, t.type);
    positions.push(a.x, a.y, b.x, b.y, c.x, c.y);
    colors.push(rgb[0], rgb[1], rgb[2], rgb[3]);
  }
  if (positions.length) {
    r.setOverlay();
    r.drawTriangles(new Float32Array(positions), new Float32Array(colors));
  }
}

function drawCloneCursor(
  r: GLRenderer,
  h: TriKey,
  cloneSource: { x: number; y: number; q: number; r: number; type: string },
  cloneOffset: { x: number; y: number } | null,
  zoom: number,
): void {
  const hbx = h.q * SIDE + h.r * (SIDE / 2);
  const hby = h.r * H;
  const hcX = h.type === "up" ? hbx + SIDE / 2 : hbx + SIDE;
  const hcY = h.type === "up" ? hby + H / 3 : hby + (2 * H) / 3;

  let srcX: number;
  let srcY: number;
  if (cloneOffset) {
    srcX = hcX + cloneOffset.x;
    srcY = hcY + cloneOffset.y;
  } else {
    if (h.type !== cloneSource.type) return;
    srcX = cloneSource.x;
    srcY = cloneSource.y;
  }
  const srcTri = worldToTri(srcX, srcY);
  const [a, b, c] = getTriVertices(srcTri.q, srcTri.r, srcTri.type);
  r.setOverlay();
  r.strokePolyline(
    [a.x, a.y, b.x, b.y, c.x, c.y],
    hexColor("#4ade80", 0.8),
    Math.max(2 / zoom, 1),
    { close: true, cap: "butt" },
  );
}

function drawHover(
  r: GLRenderer,
  a: {
    tool: Tool;
    hoverTargets: TriKey[];
    brushSize?: "single" | "hex";
    gridDivisions: number;
    hexLatticeOn: boolean;
    captureMode: boolean;
    activeSelection: SelectionSnapshot | null;
    selectedHexes: HexRegion[];
    selAnchor: HexRegion | null;
    cloneSource: { x: number; y: number; q: number; r: number; type: string } | null;
    viewZoom: number;
  },
): void {
  const target = a.hoverTargets[0];
  const isHexBrush =
    a.brushSize === "hex" &&
    a.gridDivisions > 0 &&
    a.tool !== "stamp" &&
    a.tool !== "select" &&
    a.tool !== "fill";
  const width = Math.max(2 / a.viewZoom, 1);
  const hoverColor = a.tool === "clone" && !a.cloneSource ? "#ef4444" : "#ffffff";

  // The hexagon frames what is about to happen, so it is drawn on the region
  // the gesture would actually act on — `hoverRegion` below — not on the hex of
  // the global honeycomb the cursor happens to be over.
  const hoverRegion = stampSelectHoverRegion({
    tool: a.tool,
    tri: target,
    gridDivisions: a.gridDivisions,
    hexLatticeOn: a.hexLatticeOn,
    captureMode: a.captureMode,
    activeSelection: a.activeSelection,
    selectedHexes: a.selectedHexes,
    selAnchor: a.selAnchor,
  });

  r.setOverlay();

  if (hoverRegion) {
    const corners = regionCorners(hoverRegion);
    const pts: number[] = [];
    for (const p of corners) pts.push(p.x, p.y);
    if (a.tool === "stamp") {
      if (a.captureMode) {
        r.strokePolyline(pts, hexColor("#fbbf24", 0.9), width, {
          close: true,
          cap: "butt",
          dash: { period: 12, phase: 0, on: 0.66 },
        });
      } else {
        r.strokePolyline(pts, hexColor(hoverColor, 0.7), width, { close: true, cap: "butt" });
      }
    } else {
      // Select: fill only, no stroke.
      r.fillTris(new Float32Array(polygonFanTris(corners)), hexColor("#ffffff", 0.08));
    }
    return;
  }

  if (isHexBrush) {
    drawHexBrushHover(r, a.hoverTargets, a.gridDivisions, hoverColor);
    return;
  }

  // Per-trixel hover outlines — primary + affected ghosts.
  const [pa, pb, pc] = getTriVertices(target.q, target.r, target.type);
  r.strokePolyline([pa.x, pa.y, pb.x, pb.y, pc.x, pc.y], hexColor(hoverColor, 0.7), width, { close: true, cap: "butt" });

  for (let i = 1; i < a.hoverTargets.length; i++) {
    const [a2, b2, c2] = getTriVertices(a.hoverTargets[i].q, a.hoverTargets[i].r, a.hoverTargets[i].type);
    r.strokePolyline([a2.x, a2.y, b2.x, b2.y, c2.x, c2.y], hexColor(hoverColor, 0.3), width, { close: true, cap: "butt" });
  }
}

function drawHexBrushHover(
  r: GLRenderer,
  hoverTargets: TriKey[],
  gridDivisions: number,
  hoverColor: string,
): void {
  // Group hover targets by hex. If a hex has only one wedge, draw that wedge
  // polygon; if symmetry spreads the brush across multiple wedges of the same
  // hex, draw a full hex fill.
  const hexWedges = new Map<string, Set<number>>();
  for (const t of hoverTargets) {
    const { c, k } = triToHex(t.q, t.r, t.type, gridDivisions);
    const key = `${c},${k}`;
    let set = hexWedges.get(key);
    if (!set) {
      set = new Set();
      hexWedges.set(key, set);
    }
    set.add(hexWedgeIndex(t, c, k, gridDivisions));
  }
  const entries = [...hexWedges.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [key, wedges] = entries[i];
    const [cStr, kStr] = key.split(",");
    const c = Number(cStr);
    const k = Number(kStr);
    const { x: hx, y: hy } = hexCenterWorld(c, k, gridDivisions);
    const hs = gridDivisions * SIDE;
    const hv = gridDivisions * H;
    const V = [
      { x: hx + hs, y: hy },
      { x: hx + hs / 2, y: hy + hv },
      { x: hx - hs / 2, y: hy + hv },
      { x: hx - hs, y: hy },
      { x: hx - hs / 2, y: hy - hv },
      { x: hx + hs / 2, y: hy - hv },
    ];
    const alpha = i === 0 ? 0.25 : 0.1;

    if (wedges.size === 1) {
      const wedge = [...wedges][0];
      r.fillTris(
        new Float32Array([hx, hy, V[wedge % 6].x, V[wedge % 6].y, V[(wedge + 1) % 6].x, V[(wedge + 1) % 6].y]),
        hexColor(hoverColor, alpha),
      );
    } else {
      const positions: number[] = [];
      for (const wedge of wedges) {
        positions.push(hx, hy, V[wedge % 6].x, V[wedge % 6].y, V[(wedge + 1) % 6].x, V[(wedge + 1) % 6].y);
      }
      r.fillTris(new Float32Array(positions), hexColor(hoverColor, alpha));
    }

    const hexPts: number[] = [];
    for (const v of V) hexPts.push(v.x, v.y);
    r.strokePolyline(hexPts, hexColor(hoverColor, alpha * 2), Math.max(2 / 1, 1), { close: true, cap: "butt" });
  }
}

/** Vertex fan of a convex polygon, for single-colour fills. */
function polygonFanTris(corners: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  const head = corners[0];
  for (let i = 1; i < corners.length - 1; i++) {
    out.push(head.x, head.y, corners[i].x, corners[i].y, corners[i + 1].x, corners[i + 1].y);
  }
  return out;
}

// Kept imports referenced even when a build tree-shakes an unused branch:
void noiseSubFills;
export type { SubdivisionNoiseSpec } from "@/lib/subdivision-noise";