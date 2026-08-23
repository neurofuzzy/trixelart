/**
 * A WebGL2 2D renderer for the trixel canvas.
 *
 * Everything the live preview draws — artwork fills, round-corner regions,
 * outlines, glows, hatch, subdivision noise, blend modes, grid guides, hex
 * honeycomb and every overlay — goes through this one class instead of a
 * Canvas2D context. It deliberately mirrors the subset of Canvas2D the draw
 * effect uses, so the transition in `GridCanvas` is mechanical: a `ctx.*` call
 * becomes a `renderer.*` call with the same numbers.
 *
 * Two structural differences, both invisible to the caller:
 *
 * - **The whole frame is rendered into a 4x MSAA renderbuffer and resolved to
 *   the canvas once at the end.** 2D context antialiases every fill and stroke;
 *   the WebGL equivalent is multisampling, and since the blend/glow pipelines
 *   need to read artwork pixels back, every draw lands in the same offscreen
 *   buffer and a single blit presents it. The canvas element itself is drawn to
 *   exactly once per frame.
 * - **A retained/dynamic split for geometry cost.** The artwork cells (plain
 *   fills and subdivision grain) are uploaded to the GPU once per plan and
 *   redrawn every frame with cheap draw calls, so pan, hover and the marching
 *   ants tick never re-upload the artwork. Line work, clips and overlays rebuild
 *   each frame, exactly as the canvas did.
 *
 * **Every region fill — rounded rings, glow casters and receivers, clips — goes
 * through one primitive: `fillRings`, a nonzero-winding stencil fill.** Each
 * ring's fan triangles are rasterised into the stencil with INCR/DECR_WRAP
 * chosen by the triangle's own orientation, so the stencil ends up holding the
 * ring set's exact winding number at every sample; a masked cover quad then
 * paints where it is nonzero. This is the GPU phrasing of what a 2D context's
 * default `fill()` computes — the same rule the SVG exporters emit — and it
 * needs no triangulation: holes cancel by winding, concavities and
 * self-intersections come out right by construction, and there is no ear clip
 * to bail out or misfile a ring. (An earlier port triangulated each ring and
 * classified outer vs hole from the first output triangle's sign; the clipper
 * normalised windings first, so every ring landed in one bucket and holes
 * filled solid.)
 *
 * Blend modes are evaluated in a fragment shader over two resolved textures
 * (the accumulated artwork and the isolated step), matching the Canvas spec's
 * "backdrop alpha is dropped" separable-mode formulas. Glow is a two-pass
 * gaussian blur of the caster silhouette. Neither is a raster copy of the 2D
 * output — but both compute the same field the 2D API computes, and the
 * exporters that need byte fidelity keep their own 2D backends untouched.
 */

import * as twgl from "twgl";
import { flattenRoundedRing, type RoundedRing } from "@/lib/round-corners";

/** A colour ready for a vertex: straight RGBA in 0..1. */
export type Color4 = [number, number, number, number];

export interface ViewTransform {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export interface FillBatch {
  positions: WebGLBuffer;
  colors: WebGLBuffer;
  count: number;
}

export interface LineOptions {
  close?: boolean;
  cap?: "round" | "butt";
  /** Dash in the same world units as the stroke width. */
  dash?: { period: number; phase: number; on: number };
}

type NumList = number[] | Float32Array;

const VS_SOLID = `#version 300 es
precision highp float;
uniform mat4 uMVP;
in vec2 aPos;
in vec4 aColor;
out vec4 vColor;
void main() {
  gl_Position = uMVP * vec4(aPos, 0.0, 1.0);
  vColor = aColor;
}`;

const VS_LINE = `#version 300 es
precision highp float;
uniform mat4 uMVP;
in vec2 aPos;
in vec4 aColor;
in float aLen;
out vec4 vColor;
out float vLen;
void main() {
  gl_Position = uMVP * vec4(aPos, 0.0, 1.0);
  vColor = aColor;
  vLen = aLen;
}`;

const FS_SOLID = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`;

const FS_LINE = `#version 300 es
precision highp float;
uniform float uDashPeriod;
uniform float uDashPhase;
uniform float uDashOn;
in vec4 vColor;
in float vLen;
out vec4 outColor;
void main() {
  if (uDashPeriod > 0.0) {
    float f = fract((vLen + uDashPhase) / max(uDashPeriod, 1e-5));
    if (f > uDashOn) discard;
  }
  outColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`;

const VS_QUAD = `#version 300 es
precision highp float;
in vec2 aPos;
in vec2 aUV;
out vec2 vUV;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUV = aUV;
}`;

const FS_QUAD = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uAlpha;
in vec2 vUV;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUV) * uAlpha;
}`;

const FS_SOLID_QUAD = `#version 300 es
precision highp float;
uniform vec4 uColor;
in vec2 vUV;
out vec4 outColor;
void main() {
  outColor = vec4(uColor.rgb * uColor.a, uColor.a);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uStep;
uniform float uK[31];
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 sum = texture(uTex, vUV) * uK[0];
  for (int i = 1; i < 31; i++) {
    vec2 o = uDir * (uStep * float(i));
    sum += (texture(uTex, vUV + o) + texture(uTex, vUV - o)) * uK[i];
  }
  outColor = sum;
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uBackdrop;
uniform sampler2D uLayer;
uniform int uMode;
uniform float uOpacity;
in vec2 vUV;
out vec4 outColor;

vec3 blendCol(vec3 Cb, vec3 Cs, int mode) {
  if (mode == 0) {
    return Cb * Cs;                                 // multiply
  } else if (mode == 1) {
    return Cb + Cs - Cb * Cs;                       // screen
  } else if (mode == 2) {                           // overlay
    vec3 r;
    for (int i = 0; i < 3; i++) {
      r[i] = Cb[i] <= 0.5 ? 2.0 * Cb[i] * Cs[i] : 1.0 - 2.0 * (1.0 - Cb[i]) * (1.0 - Cs[i]);
    }
    return r;
  } else if (mode == 3) {                           // hard-light
    vec3 r;
    for (int i = 0; i < 3; i++) {
      r[i] = Cs[i] <= 0.5 ? 2.0 * Cb[i] * Cs[i] : 1.0 - 2.0 * (1.0 - Cb[i]) * (1.0 - Cs[i]);
    }
    return r;
  } else if (mode == 4) {                           // difference
    return abs(Cb - Cs);
  }
  // soft-light (mode 5)
  vec3 r;
  for (int i = 0; i < 3; i++) {
    float c = Cs[i];
    float b = Cb[i];
    float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
    r[i] = c <= 0.5 ? b - (1.0 - 2.0 * c) * b * (1.0 - b) : b + (2.0 * c - 1.0) * (d - b);
  }
  return r;
}

void main() {
  vec4 back = texture(uBackdrop, vUV);
  vec4 src = texture(uLayer, vUV) * uOpacity;
  float as = src.a;
  float ab = back.a;
  if (as <= 0.0) {
    outColor = back; // nothing to blend; the backdrop passes straight through
    return;
  }
  vec3 cs = src.rgb / max(as, 1e-5);
  vec3 cb = ab > 0.0 ? back.rgb / max(ab, 1e-5) : vec3(0.0);
  vec3 B = blendCol(cb, cs, uMode);
  vec3 blended = ab * B + (1.0 - ab) * cs;
  vec3 Co = as * blended + (1.0 - as) * ab * cb;
  float ao = as + (1.0 - as) * ab;
  outColor = vec4(Co * ao, ao);
}`;

const BLEND_MODE_INDEX: Record<string, number> = {
  multiply: 0,
  screen: 1,
  overlay: 2,
  "hard-light": 3,
  difference: 4,
  "soft-light": 5,
};

/** #rrggbb plus an alpha → the straight RGBA the shaders expect. */
export function hexColor(hex: string, alpha = 1): Color4 {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xff00ff;
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
    alpha,
  ];
}

function segNormal(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

/** Signed twice-area of one fan triangle. */
function triArea2(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** A symmetric 31-tap gaussian kernel covering ±3σ, centred at index 0.
 *  Returns the linear offset step (texels) between taps and the weights. */
function gaussianKernel(sigmaTexel: number): { step: number; kernel: Float32Array } {
  const taps = 31;
  const kernel = new Float32Array(taps);
  const s = Math.max(0.5, sigmaTexel);
  const step = (3 * s) / (taps - 1);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i * step;
    kernel[i] = Math.exp(-(x * x) / (2 * s * s));
    if (i === 0) sum += kernel[i];
    else sum += 2 * kernel[i];
  }
  for (let i = 0; i < taps; i++) kernel[i] /= sum;
  return { step, kernel };
}

export class GLRenderer {
  private gl: WebGL2RenderingContext;

  private tri: twgl.ProgramInfo;
  private line: twgl.ProgramInfo;
  private quad: twgl.ProgramInfo;
  private solidQuad: twgl.ProgramInfo;
  private blurPrg: twgl.ProgramInfo;
  private compositePrg: twgl.ProgramInfo;

  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private deviceW = 1;
  private deviceH = 1;
  private zoom = 1;
  private uMVP: number[] | Float32Array = new Float32Array(16);

  private artFbo: WebGLFramebuffer | null = null;
  private artTex: WebGLTexture | null = null;
  private artColorRbo: WebGLRenderbuffer | null = null;
  private artDS: WebGLRenderbuffer | null = null;

  private layerFbo: WebGLFramebuffer | null = null;
  private layerTex: WebGLTexture | null = null;
  private layerColorRbo: WebGLRenderbuffer | null = null;
  private layerDS: WebGLRenderbuffer | null = null;

  private casterTex: WebGLTexture | null = null;
  private glowTex: WebGLTexture | null = null;
  private blurScratch: WebGLTexture | null = null;

  /** One shared DEPTH24_STENCIL8 renderbuffer attached to every colour-texture
   *  framebuffer, so the stencil-based fills and clips (region holes, rounded
   *  grain, the glow caster) can run against a texture target too. Created
   *  single-sample like the textures themselves. */
  private texDS: WebGLRenderbuffer | null = null;

  private quadBuf: WebGLBuffer | null = null;
  private quadUV: WebGLBuffer | null = null;

  private maxSamples = 4;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 is not available");

    this.gl = gl;
    this.maxSamples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);

    this.tri = twgl.createProgramInfo(gl, [VS_SOLID, FS_SOLID]);
    this.line = twgl.createProgramInfo(gl, [VS_LINE, FS_LINE]);
    this.quad = twgl.createProgramInfo(gl, [VS_QUAD, FS_QUAD]);
    this.solidQuad = twgl.createProgramInfo(gl, [VS_QUAD, FS_SOLID_QUAD]);
    this.blurPrg = twgl.createProgramInfo(gl, [VS_QUAD, FS_BLUR]);
    this.compositePrg = twgl.createProgramInfo(gl, [VS_QUAD, FS_COMPOSITE]);
    for (const [name, info] of [
      ["solid", this.tri],
      ["line", this.line],
      ["quad", this.quad],
      ["solidQuad", this.solidQuad],
      ["blur", this.blurPrg],
      ["composite", this.compositePrg],
    ] as const) {
      if (!info) throw new Error(`WebGL shader failed to link: ${name}`);
    }

    // A single oversized triangle covers the whole viewport; UVs stretch with
    // it, so a render target is sampled with no half-texel seam.
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.quadUV = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUV);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW);

    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);

    this.deviceW = Math.max(1, Math.floor(canvas.width));
    this.deviceH = Math.max(1, Math.floor(canvas.height));
    this.allocateTargets();
  }

  /** Recreates every render target at the device-pixel size. */
  resize(widthCss: number, heightCss: number, dpr: number): void {
    const devW = Math.max(1, Math.floor(widthCss * dpr));
    const devH = Math.max(1, Math.floor(heightCss * dpr));
    this.cssWidth = widthCss;
    this.cssHeight = heightCss;
    this.dpr = dpr;
    if (devW === this.deviceW && devH === this.deviceH) return;
    this.deviceW = devW;
    this.deviceH = devH;
    if (this.gl.canvas instanceof HTMLCanvasElement) {
      this.gl.canvas.width = devW;
      this.gl.canvas.height = devH;
    }
    this.allocateTargets();
  }

  private newFs(): WebGLFramebuffer {
    return this.gl.createFramebuffer()!;
  }

  private newColorTex(wrap: "nearest" | "linear"): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = wrap === "linear" ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.deviceW, this.deviceH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  }

  private newMsaaTarget(): {
    fb: WebGLFramebuffer;
    color: WebGLRenderbuffer;
    ds: WebGLRenderbuffer;
  } {
    const gl = this.gl;
    const color = gl.createRenderbuffer()!;
    const ds = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.maxSamples, gl.RGBA8, this.deviceW, this.deviceH);
    gl.bindRenderbuffer(gl.RENDERBUFFER, ds);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.maxSamples, gl.DEPTH24_STENCIL8, this.deviceW, this.deviceH);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, ds);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    return { fb, color, ds };
  }

  private allocateTargets(): void {
    const gl = this.gl;
    const art = this.newMsaaTarget();
    this.artFbo = art.fb;
    this.artColorRbo = art.color;
    this.artDS = art.ds;
    const layer = this.newMsaaTarget();
    this.layerFbo = layer.fb;
    this.layerColorRbo = layer.color;
    this.layerDS = layer.ds;

    this.artTex = this.newColorTex("nearest");
    this.layerTex = this.newColorTex("nearest");
    this.casterTex = this.newColorTex("linear");
    this.glowTex = this.newColorTex("linear");
    this.blurScratch = this.newColorTex("linear");

    const texDS = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, texDS);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, this.deviceW, this.deviceH);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.texDS = texDS;
    // Recreate lazily-created texture framebuffers with the new stencil.
    this.texFboCache.clear();

    // An abandoned MSAA allocator can desync the read framebuffer; settling on
    // art keeps blits predictable.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.artFbo);
    gl.viewport(0, 0, this.deviceW, this.deviceH);
  }

  /** The world→device transform the current frame is drawn under — the same
   *  numbers `GridCanvas` used to load into a 2D context's CTM. */
  setView(view: ViewTransform): void {
    const { m4 } = twgl;
    this.zoom = view.zoom;
    let m = m4.translation([view.x, view.y, 0]);
    m = m4.multiply(m4.rotationZ(view.rotation), m);
    m = m4.multiply(m4.scaling([view.zoom, view.zoom, 1]), m);
    m = m4.multiply(m4.translation([this.cssWidth / 2, this.cssHeight / 2, 0]), m);
    m = m4.multiply(m4.scaling([this.dpr, this.dpr, 1]), m);
    m = m4.multiply(m4.scaling([2 / this.deviceW, -2 / this.deviceH, 1]), m);
    m = m4.multiply(m4.translation([-1, 1, 0]), m);
    this.uMVP = m;
  }

  /** Bind the artwork accumulator and clear colour + stencil for a new frame. */
  beginFrame(): void {
    this.bindFrame(this.artFbo, true);
  }

  /** Re-bind the artwork accumulator without clearing it. Used when a step was
   *  drawn in isolation and the clock is returning to the accumulation. */
  rebindArt(): void {
    this.bindFrame(this.artFbo, false);
  }

  private bindFrame(fb: WebGLFramebuffer | null, clearAll: boolean): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, this.deviceW, this.deviceH);
    if (clearAll) {
      gl.stencilMask(0xff);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.stencilMask(0);
    }
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
  }

  /** Resolve the artwork accumulator to the canvas element. */
  endFrame(): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.artFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0, 0, this.deviceW, this.deviceH,
      0, 0, this.deviceW, this.deviceH,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  /** Compositing state for the artwork's opaque draws. */
  setOpaque(): void {
    this.gl.disable(this.gl.BLEND);
  }

  /** Compositing state for translucent overlays (src-over). */
  setOverlay(): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Direct-mode primitives share a small scratch that persists across frames
   *  so uploads reuse a live buffer rather than churning the allocator. */
  private scratchPos: WebGLBuffer | null = null;
  private scratchCol: WebGLBuffer | null = null;
  private scratchLen: WebGLBuffer | null = null;

  private uploadScratch(data: Float32Array, which: number): WebGLBuffer {
    const gl = this.gl;
    if (which === 0) this.scratchPos ??= gl.createBuffer();
    else if (which === 1) this.scratchCol ??= gl.createBuffer();
    else this.scratchLen ??= gl.createBuffer();
    const buf = which === 0 ? this.scratchPos! : which === 1 ? this.scratchCol! : this.scratchLen!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    return buf;
  }

  // Attribute-array hygiene. There are no VAOs here, so enabled attribute
  // arrays are *global* context state that outlives every draw — and a draw
  // that leaves a location enabled without binding a buffer to it makes the
  // next `drawArrays` fail with INVALID_OPERATION and paint nothing (a deleted
  // fill batch resets any attrib pointing at its buffers to null). Every draw
  // therefore declares the locations it uses and `syncAttribs` disables
  // everything else before the call.
  private enabledAttribs = new Set<number>();

  private syncAttribs(used: Iterable<number>): void {
    const gl = this.gl;
    const keep = used instanceof Set ? used : new Set(used);
    for (const loc of this.enabledAttribs) {
      if (!keep.has(loc)) {
        gl.disableVertexAttribArray(loc);
        this.enabledAttribs.delete(loc);
      }
    }
    for (const loc of keep) {
      if (!this.enabledAttribs.has(loc)) {
        gl.enableVertexAttribArray(loc);
        this.enabledAttribs.add(loc);
      }
    }
  }

  private drawDynamic(
    program: twgl.ProgramInfo,
    attribs: Array<{ name: string; data: Float32Array; size: number }>,
    count: number,
    uniforms: Record<string, unknown>,
  ): void {
    const gl = this.gl;
    const used = new Set<number>();
    gl.useProgram(program.program);
    attribs.forEach((a, i) => {
      const loc = gl.getAttribLocation(program.program, a.name);
      const buf = this.uploadScratch(a.data, i);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, 0, 0);
      used.add(loc);
    });
    this.syncAttribs(used);
    twgl.setUniforms(program, uniforms as never);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }

  /** Binds one static buffer to an attribute of the current program and records
   *  the location in `used` — the retained-batch and quad-blit draws' shared
   *  half of the `drawDynamic` sequence. */
  private bindAttrib(program: twgl.ProgramInfo, name: string, size: number, buf: WebGLBuffer, used: Set<number>): void {
    const gl = this.gl;
    const loc = gl.getAttribLocation(program.program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    used.add(loc);
  }

  /** One immediate triangle draw with per-vertex colours. */
  drawTriangles(positions: Float32Array, colors: Float32Array): void {
    const count = positions.length / 2;
    if (count <= 0) return;
    this.drawDynamic(
      this.tri,
      [
        { name: "aPos", data: positions, size: 2 },
        { name: "aColor", data: colors, size: 4 },
      ],
      count,
      { uMVP: this.uMVP },
    );
  }

  /** Fills world-space triangles that share one colour. */
  fillTris(positions: Float32Array, color: Color4): void {
    const n = positions.length / 2;
    if (n <= 0) return;
    const colors = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colors[i * 4] = color[0];
      colors[i * 4 + 1] = color[1];
      colors[i * 4 + 2] = color[2];
      colors[i * 4 + 3] = color[3];
    }
    this.drawTriangles(positions, colors);
  }

  // ---------------------------------------------------------------- retained

  /** Uploads an opaque-triangle batch and returns a handle to draw every frame
   *  without re-uploading. `positions` is a flat `x,y` list, `colors` the same
   *  count of straight `r,g,b,a`. */
  makeFillBatch(positions: Float32Array, colors: Float32Array): FillBatch {
    const gl = this.gl;
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const colBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    return { positions: posBuf, colors: colBuf, count: positions.length / 2 };
  }

  disposeFillBatch(batch: FillBatch): void {
    this.gl.deleteBuffer(batch.positions);
    this.gl.deleteBuffer(batch.colors);
  }

  drawFillBatch(batch: FillBatch): void {
    const gl = this.gl;
    const program = this.tri;
    gl.useProgram(program.program);
    const used = new Set<number>();
    this.bindAttrib(program, "aPos", 2, batch.positions, used);
    this.bindAttrib(program, "aColor", 4, batch.colors, used);
    this.syncAttribs(used);
    twgl.setUniforms(program, { uMVP: this.uMVP } as never);
    gl.drawArrays(gl.TRIANGLES, 0, batch.count);
  }

  // ---------------------------------------------------------------- regions

  /**
   * Sagitta bound for arc flattening, in world units: small enough that a chord
   * deviates from its arc by well under half a device pixel at the current
   * view. The exporters flatten to a fixed 0.5 world units because their output
   * is resolution-independent; the preview is watched at a particular zoom, so
   * it buys accuracy only where the screen can show it.
   */
  private sagitta(): number {
    return Math.min(0.5, 0.35 / Math.max(this.zoom * this.dpr, 1e-6));
  }

  /** One ring flattened for the current view, as a flat `x,y` list.
   *  `flattenRoundedRing` already drops coincident points. */
  private flattenRing(ring: RoundedRing): NumList {
    const pts = flattenRoundedRing(ring, this.sagitta());
    const out: number[] = [];
    for (const p of pts) out.push(p[0], p[1]);
    return out;
  }

  /** Device-pixel bounds of a flat world-space point list under the current
   *  view, padded a couple of pixels — the scissor box that bounds a stencil
   *  pass, so a big ring costs only its own area rather than the screen's. */
  private deviceBounds(flat: NumList): { x: number; y: number; w: number; h: number } | null {
    const m = this.uMVP;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i];
      const y = flat[i + 1];
      const cx = m[0] * x + m[4] * y + m[12];
      const cy = m[1] * x + m[5] * y + m[13];
      const dx = (cx + 1) * 0.5 * this.deviceW;
      const dy = (1 - cy) * 0.5 * this.deviceH;
      if (dx < minX) minX = dx;
      if (dy < minY) minY = dy;
      if (dx > maxX) maxX = dx;
      if (dy > maxY) maxY = dy;
    }
    if (!Number.isFinite(minX)) return null;
    const pad = 2;
    const x0 = Math.max(0, Math.floor(minX - pad));
    const y0 = Math.max(0, Math.floor(minY - pad));
    const x1 = Math.min(this.deviceW, Math.ceil(maxX + pad));
    const y1 = Math.min(this.deviceH, Math.ceil(maxY + pad));
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * The visible world box, recovered by pushing the viewport's corners back
   * through the inverse of the current transform. Fan triangles entirely
   * outside it are skipped before upload — a large rounded layer off-screen
   * then costs nothing per frame.
   */
  private viewWorldBox(): { minX: number; minY: number; maxX: number; maxY: number } {
    const inv = twgl.m4.inverse(this.uMVP as Float32Array);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cx of [-1, 1]) {
      for (const cy of [-1, 1]) {
        // The transform is affine, so the inverse needs no perspective divide.
        const wx = inv[0] * cx + inv[4] * cy + inv[12];
        const wy = inv[1] * cx + inv[5] * cy + inv[13];
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
      }
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Fan triangles of one flat ring list, split by orientation into the INCR and
   * DECR batches of the winding pass. The fan `(p0, pi, pi+1)` over a closed
   * ring covers every point of the plane with signed multiplicity summing to
   * the ring's winding number there — the discrete Green's-theorem identity —
   * so incrementing where a fan triangle is positively oriented and decrementing
   * where negative leaves the stencil holding exactly what canvas's nonzero
   * rule tests. Zero-area triangles (duplicate points, collinear runs) are
   * dropped, triangles entirely outside the visible box are too.
   */
  private windingBatches(
    flats: NumList[],
  ): { positive: Float32Array; negative: Float32Array } {
    const box = this.viewWorldBox();
    const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.05 + 1;
    const pos: number[] = [];
    const neg: number[] = [];
    for (const flat of flats) {
      const n = flat.length / 2;
      if (n < 3) continue;
      const x0 = flat[0], y0 = flat[1];
      for (let i = 1; i < n - 1; i++) {
        const ax = flat[i * 2], ay = flat[i * 2 + 1];
        const bx = flat[(i + 1) * 2], by = flat[(i + 1) * 2 + 1];
        const area = triArea2(x0, y0, ax, ay, bx, by);
        if (area === 0) continue;
        // Cull: bounding box of the triangle against the padded view box.
        const tMinX = Math.min(x0, ax, bx), tMaxX = Math.max(x0, ax, bx);
        const tMinY = Math.min(y0, ay, by), tMaxY = Math.max(y0, ay, by);
        if (
          tMaxX < box.minX - pad || tMinX > box.maxX + pad ||
          tMaxY < box.minY - pad || tMinY > box.maxY + pad
        ) {
          continue;
        }
        const sink = area > 0 ? pos : neg;
        sink.push(x0, y0, ax, ay, bx, by);
      }
    }
    return { positive: new Float32Array(pos), negative: new Float32Array(neg) };
  }

  /**
   * Writes the nonzero winding of a ring set into the stencil buffer of the
   * current target, scissored to the rings' own footprint. Returns whether a
   * usable mask is in place: `true` means the caller may draw through it (for
   * a fill: paint its colour; for a clip: proceed), `false` means the ring set
   * is degenerate or wholly off-screen and a fill has nothing to do. An empty
   * *clip* still returns true — with a NEVER test, so nothing draws through
   * it, matching canvas's clip() on an empty path.
   */
  private beginWinding(
    flats: NumList[],
    emptyMeansClipAll: boolean,
  ): boolean {
    const gl = this.gl;
    const bounds = this.deviceBoundsOf(flats);
    if (!bounds) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(emptyMeansClipAll ? gl.NEVER : gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.stencilMask(0);
      return emptyMeansClipAll;
    }
    const { positive, negative } = this.windingBatches(flats);

    // The bounds are in top-down device coordinates; scissor counts from the
    // bottom edge.
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(bounds.x, this.deviceH - (bounds.y + bounds.h), bounds.w, bounds.h);
    this.clearStencil();
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.colorMask(false, false, false, false);

    const write = (data: Float32Array, op: number) => {
      if (data.length === 0) return;
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(op, op, op);
      this.drawDynamic(
        this.tri,
        [{ name: "aPos", data, size: 2 }],
        data.length / 2,
        { uMVP: this.uMVP },
      );
    };
    write(positive, gl.INCR_WRAP);
    write(negative, gl.DECR_WRAP);

    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilMask(0);
    return true;
  }

  /** Device bounds across several flattened rings, or null when none is on
   *  screen. */
  private deviceBoundsOf(flats: NumList[]): { x: number; y: number; w: number; h: number } | null {
    let merged: { x: number; y: number; w: number; h: number } | null = null;
    for (const flat of flats) {
      const b = this.deviceBounds(flat);
      if (!b) continue;
      if (!merged) {
        merged = b;
        continue;
      }
      const x0 = Math.min(merged.x, b.x);
      const y0 = Math.min(merged.y, b.y);
      const x1 = Math.max(merged.x + merged.w, b.x + b.w);
      const y1 = Math.max(merged.y + merged.h, b.y + b.h);
      merged = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return merged;
  }

  /** Tears down the state `beginWinding` left behind. */
  private endWinding(): void {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilMask(0);
  }

  /**
   * Fills a set of rings (outers and holes in any order) with one colour — the
   * same shape a Canvas2D `fill()` of the same paths would paint, by the same
   * nonzero rule. Opaque fills disable blending so a region sharing an edge
   * with its neighbour never draws over it. No triangulation anywhere: see the
   * class header for why the winding-stencil pair replaced the ear clip.
   */
  fillRings(rings: RoundedRing[], color: Color4): void {
    if (rings.length === 0) return;
    const flats = rings.map((r) => this.flattenRing(r));
    if (!this.beginWinding(flats, false)) return;
    if (color[3] >= 1) this.setOpaque();
    else this.setOverlay();
    this.blitSolid(color);
    this.endWinding();
  }

  /** Begins a stencil clip: only what the given rings cover is drawn by calls
   *  between this and `endClip()`. Rings wind, so holes clip out for free. An
   *  empty or off-screen ring set clips everything, matching canvas. */
  beginClip(rings: RoundedRing[]): void {
    if (rings.length === 0) {
      const gl = this.gl;
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.NEVER, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.stencilMask(0);
      return;
    }
    this.beginWinding(
      rings.map((r) => this.flattenRing(r)),
      true,
    );
  }

  /** Ends a clip. Safe to call even when none was begun. */
  endClip(): void {
    this.endWinding();
  }

  /** A fullscreen draw in one flat colour, the masked fill of a stencil pass. */
  private blitSolid(color: Color4): void {
    const gl = this.gl;
    const program = this.solidQuad;
    gl.useProgram(program.program);
    const used = new Set<number>();
    this.bindAttrib(program, "aPos", 2, this.quadBuf!, used);
    this.bindAttrib(program, "aUV", 2, this.quadUV!, used);
    this.syncAttribs(used);
    gl.uniform4f(gl.getUniformLocation(program.program, "uColor"), color[0], color[1], color[2], color[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---------------------------------------------------------------- strokes

  /**
   * Strokes a polyline in world space. Round joins and caps are the default; a
   * dash (with butt joins) is drawn as plain segment ribbons carrying a length
   * attribute so the fragment shader can cut the pattern. `points` is a flat
   * `x,y` list.
   */
  strokePolyline(pointsList: NumList, color: Color4, width: number, opts: LineOptions = {}): void {
    const n = pointsList.length / 2;
    const points = pointsList;
    if (n < 2 || width <= 0) return;

    const hw = width / 2;
    const dashed = !!opts.dash;
    const round = opts.cap !== "butt" && !dashed;

    const positions: number[] = [];
    const lens: number[] = [];
    const colors: number[] = [];

    const cum: number[] = [0];
    let total = 0;
    for (let i = 1; i < n; i++) {
      const dx = points[i * 2] - points[(i - 1) * 2];
      const dy = points[i * 2 + 1] - points[(i - 1) * 2 + 1];
      total += Math.hypot(dx, dy);
      cum.push(total);
    }

    const emit = (x: number, y: number, len: number) => {
      positions.push(x, y);
      lens.push(len);
      colors.push(color[0], color[1], color[2], color[3]);
    };

    // Quads per segment; joining disks cover the gaps at the vertices.
    for (let i = 0; i < n - 1; i++) {
      const x0 = points[i * 2];
      const y0 = points[i * 2 + 1];
      const x1 = points[(i + 1) * 2];
      const y1 = points[(i + 1) * 2 + 1];
      const [nx, ny] = segNormal(x0, y0, x1, y1);
      const ox = nx * hw;
      const oy = ny * hw;
      emit(x0 - ox, y0 - oy, cum[i]);
      emit(x0 + ox, y0 + oy, cum[i]);
      emit(x1 - ox, y1 - oy, cum[i + 1]);
      emit(x1 - ox, y1 - oy, cum[i + 1]);
      emit(x1 + ox, y1 + oy, cum[i + 1]);
      emit(x0 - ox, y0 - oy, cum[i]);
    }

    if (opts.close) {
      const x0 = points[(n - 1) * 2];
      const y0 = points[(n - 1) * 2 + 1];
      const x1 = points[0];
      const y1 = points[1];
      const [nx, ny] = segNormal(x0, y0, x1, y1);
      const ox = nx * hw;
      const oy = ny * hw;
      const lp = Math.hypot(x1 - x0, y1 - y0);
      const l0 = cum[n - 1];
      emit(x0 - ox, y0 - oy, l0);
      emit(x0 + ox, y0 + oy, l0);
      emit(x1 - ox, y1 - oy, l0 + lp);
      emit(x1 - ox, y1 - oy, l0 + lp);
      emit(x1 + ox, y1 + oy, l0 + lp);
      emit(x0 + ox, y0 + oy, l0);
    }

    if (round) {
      const segs = Math.max(6, Math.ceil(hw));
      // A join disk belongs only where the polyline actually turns by enough
      // for the disk to be visible: the wedge a skipped disk leaves open is
      // `hw·sin(turn)` tall, and below half a device pixel it reads as the
      // round join canvas would have drawn. Straight runs — every lattice
      // vertex along a region edge, or the flattened points of a nearly flat
      // arc — then get no disk, and the width stays constant instead of
      // lumping to twice itself at each vertex.
      const pxPerUnit = this.zoom * this.dpr;
      for (let i = 0; i < n; i++) {
        if (!opts.close && (i === 0 || i === n - 1)) {
          this.pushDisk(positions, lens, colors, color, points[i * 2], points[i * 2 + 1], hw, cum[i], segs);
          continue;
        }
        const px = points[i * 2], py = points[i * 2 + 1];
        const qx = points[((i + 1) % n) * 2], qy = points[((i + 1) % n) * 2 + 1];
        const mx = points[((i - 1 + n) % n) * 2], my = points[((i - 1 + n) % n) * 2 + 1];
        const d1x = px - mx, d1y = py - my;
        const d2x = qx - px, d2y = qy - py;
        const l1 = Math.hypot(d1x, d1y);
        const l2 = Math.hypot(d2x, d2y);
        if (l1 === 0 || l2 === 0) continue;
        const sinTurn = Math.abs(d1x * d2y - d1y * d2x) / (l1 * l2);
        if (hw * sinTurn * pxPerUnit > 0.5) {
          this.pushDisk(positions, lens, colors, color, px, py, hw, cum[i], segs);
        }
      }
    }

    this.drawDynamic(
      this.line,
      [
        { name: "aPos", data: new Float32Array(positions), size: 2 },
        { name: "aColor", data: new Float32Array(colors), size: 4 },
        { name: "aLen", data: new Float32Array(lens), size: 1 },
      ],
      positions.length / 2,
      {
        uMVP: this.uMVP,
        uDashPeriod: opts.dash?.period ?? 0,
        uDashPhase: opts.dash?.phase ?? 0,
        uDashOn: opts.dash?.on ?? 1,
      },
    );
  }

  private pushDisk(
    positions: number[],
    lens: number[],
    colors: number[],
    color: Color4,
    cx: number,
    cy: number,
    radius: number,
    len: number,
    segments: number,
  ): void {
    const step = (Math.PI * 2) / segments;
    for (let i = 0; i < segments; i++) {
      const a0 = i * step;
      const a1 = a0 + step;
      positions.push(
        cx, cy,
        cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius,
        cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius,
      );
      lens.push(len, len, len);
      colors.push(color[0], color[1], color[2], color[3]);
      colors.push(color[0], color[1], color[2], color[3]);
      colors.push(color[0], color[1], color[2], color[3]);
    }
  }

  /** Independent segments, each butt-capped — the grid line families. `segs` is
   *  a flat `x0,y0,x1,y1, ...` list. */
  strokeLines(segments: NumList, color: Color4, width: number): void {
    const n = segments.length / 4;
    if (n <= 0 || width <= 0) return;
    const hw = width / 2;
    const positions: number[] = [];
    const lens: number[] = [];
    const colors: number[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = segments[i * 4];
      const y0 = segments[i * 4 + 1];
      const x1 = segments[i * 4 + 2];
      const y1 = segments[i * 4 + 3];
      const [nx, ny] = segNormal(x0, y0, x1, y1);
      const ox = nx * hw;
      const oy = ny * hw;
      const len = Math.hypot(x1 - x0, y1 - y0);
      positions.push(x0 - ox, y0 - oy, x0 + ox, y0 + oy, x1 - ox, y1 - oy);
      positions.push(x1 - ox, y1 - oy, x1 + ox, y1 + oy, x0 + ox, y0 + oy);
      lens.push(0, 0, len, len, len, 0);
      for (let k = 0; k < 6; k++) colors.push(color[0], color[1], color[2], color[3]);
    }
    this.drawDynamic(
      this.line,
      [
        { name: "aPos", data: new Float32Array(positions), size: 2 },
        { name: "aColor", data: new Float32Array(colors), size: 4 },
        { name: "aLen", data: new Float32Array(lens), size: 1 },
      ],
      positions.length / 2,
      { uMVP: this.uMVP, uDashPeriod: 0, uDashPhase: 0, uDashOn: 1 },
    );
  }

  /** A stroked circle. */
  strokeCircle(cx: number, cy: number, radius: number, color: Color4, width: number): void {
    const pts: number[] = [];
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    }
    this.strokePolyline(pts, color, width, { close: true });
  }

  /** A filled disk — the origin dot and the honeycomb centre markers. */
  fillCircle(cx: number, cy: number, radius: number, color: Color4): void {
    if (radius <= 0) return;
    const segs = 24;
    const positions: number[] = [];
    const colors: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      positions.push(cx, cy, cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius);
      for (let k = 0; k < 3; k++) colors.push(color[0], color[1], color[2], color[3]);
    }
    this.drawDynamic(
      this.tri,
      [
        { name: "aPos", data: new Float32Array(positions), size: 2 },
        { name: "aColor", data: new Float32Array(colors), size: 4 },
      ],
      positions.length / 2,
      { uMVP: this.uMVP },
    );
  }

  /** An axis-aligned rect fill, in world coords. */
  fillRect(x: number, y: number, w: number, h: number, color: Color4): void {
    this.fillTris(
      new Float32Array([x, y, x + w, y, x, y + h, x + w, y, x + w, y + h, x, y + h]),
      color,
    );
  }

  /**
   * The outline effect: each region ring stroked at a uniform world width —
   * the same thing a 2D context's `stroke()` with round joins draws. The ribbon
   * is segment quads plus a join disk wherever the path actually turns by
   * enough for the disk to be visible; straight runs (every lattice vertex
   * along an edge) get no disk, so the width never lumps there.
   */
  strokeRingOutline(rings: RoundedRing[], width: number, color: Color4): void {
    if (width <= 0 || rings.length === 0) return;
    for (const ring of rings) {
      const flat = this.flattenRing(ring);
      if (flat.length < 6) continue;
      this.strokePolyline(flat, color, width, { close: true });
    }
  }

  /** A stroked axis-aligned rect (the crop frame). */
  strokeRect(x: number, y: number, w: number, h: number, color: Color4, width: number): void {
    this.strokePolyline([x, y, x + w, y, x + w, y + h, x, y + h], color, width, { close: true });
  }

  // ---------------------------------------------------------------- clipping

  /** Clips to a union of grid triangles (a hatch group): draws between the call
   *  and `endClip()` are confined to their interior. */
  beginClipTriangles(positions: Float32Array): void {
    if (positions.length === 0) return;
    const gl = this.gl;
    this.clearStencil();
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.INCR_WRAP, gl.INCR_WRAP, gl.INCR_WRAP);
    this.drawDynamic(
      this.tri,
      [{ name: "aPos", data: positions, size: 2 }],
      positions.length / 2,
      { uMVP: this.uMVP },
    );
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilMask(0);
    gl.colorMask(true, true, true, true);
  }

  // ------------------------------------------------------- isolated steps

  /** Clears and binds the isolated-step buffer. The next draws are the whole
   *  blended step (glow under fills), ready to resolve and composite. */
  beginBlendStep(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.layerFbo);
    gl.viewport(0, 0, this.deviceW, this.deviceH);
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.stencilMask(0);
    gl.disable(gl.BLEND);
  }

  /** Resolves the isolated step and re-binds the artwork accumulator. */
  endBlendStep(): WebGLTexture {
    this.resolveToTexture(this.layerTex!, this.layerFbo!);
    this.rebindArt();
    return this.layerTex!;
  }

  /** Composites `layer` over the accumulated artwork with a blend mode, using
   *  the Canvas spec's separable-mode formula. Writes the whole artwork buffer in
   *  one masked-out quad. */
  compositeStep(layerTex: WebGLTexture, blendMode: string, opacity = 1): void {
    const gl = this.gl;
    // Snapshot the accumulated artwork for the backdrop sample.
    this.resolveToTexture(this.artTex!, this.artFbo!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.artFbo);
    gl.viewport(0, 0, this.deviceW, this.deviceH);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilMask(0);

    const program = this.compositePrg;
    gl.useProgram(program.program);
    const used = new Set<number>();
    this.bindAttrib(program, "aPos", 2, this.quadBuf!, used);
    this.bindAttrib(program, "aUV", 2, this.quadUV!, used);
    this.syncAttribs(used);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.artTex!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, layerTex);
    gl.uniform1i(gl.getUniformLocation(program.program, "uBackdrop"), 0);
    gl.uniform1i(gl.getUniformLocation(program.program, "uLayer"), 1);
    gl.uniform1i(gl.getUniformLocation(program.program, "uMode"), BLEND_MODE_INDEX[blendMode] ?? 0);
    gl.uniform1f(gl.getUniformLocation(program.program, "uOpacity"), opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ------------------------------------------------------------- glow / blur

  /**
   * Renders the caster silhouette (opaque) into a texture, blurs it, and returns
   * the blurred texture for `drawTexture` to composite under the caller's
   * receiver clip. `sigma` is in world units.
   */
  prepareGlow(caster: RoundedRing[], color: Color4, sigma: number): WebGLTexture {
    const gl = this.gl;
    // The caller is mid-step on the artwork accumulator or the isolated buffer;
    // whatever it was, it must be back when we return, or the receiver clip and
    // caster fill below would land in a texture target.
    const savedFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const casterTex = this.casterTex!;
    const glowTex = this.glowTex!;
    const scratch = this.blurScratch!;
    this.clearColorTexture(casterTex);
    this.bindColorTarget(casterTex);
    this.setOpaque();
    this.fillRings(caster, color);
    this.bindColorTarget(glowTex);
    gl.disable(gl.BLEND);

    const sigmaTexel = sigma * this.zoom * this.dpr;
    if (sigmaTexel <= 0.6) {
      this.blitTextureInto(casterTex, glowTex, 1);
    } else {
      const { step, kernel } = gaussianKernel(sigmaTexel);
      // Horizontal into the scratch, vertical back into the glow texture.
      this.blurPass(casterTex, scratch, true, step, kernel);
      this.blurPass(scratch, glowTex, false, step, kernel);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, savedFb);
    gl.viewport(0, 0, this.deviceW, this.deviceH);
    return glowTex;
  }

  private blurPass(
    src: WebGLTexture,
    dst: WebGLTexture,
    horizontal: boolean,
    stepTexel: number,
    kernel: Float32Array,
  ): void {
    const gl = this.gl;
    this.bindColorTarget(dst);
    gl.disable(gl.BLEND);
    const uvStep = horizontal ? stepTexel / this.deviceW : stepTexel / this.deviceH;
    const program = this.blurPrg;
    gl.useProgram(program.program);
    const used = new Set<number>();
    this.bindAttrib(program, "aPos", 2, this.quadBuf!, used);
    this.bindAttrib(program, "aUV", 2, this.quadUV!, used);
    this.syncAttribs(used);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(program.program, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(program.program, "uDir"), horizontal ? 1 : 0, horizontal ? 0 : 1);
    gl.uniform1f(gl.getUniformLocation(program.program, "uStep"), uvStep);
    gl.uniform1fv(gl.getUniformLocation(program.program, "uK"), kernel);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** A scratch framebuffer per texture — established lazily and reused. */
  private texFboCache = new Map<WebGLTexture, WebGLFramebuffer>();

  private bindColorTarget(tex: WebGLTexture): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboForTexture(tex));
    gl.viewport(0, 0, this.deviceW, this.deviceH);
  }

  private fboForTexture(tex: WebGLTexture): WebGLFramebuffer {
    let fb = this.texFboCache.get(tex);
    if (!fb) {
      const gl = this.gl;
      fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      // The shared stencil makes winding fills and clips valid on this target.
      if (this.texDS) {
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.texDS);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.texFboCache.set(tex, fb);
    }
    return fb;
  }

  /** Reset the stencil buffer before a stencil-using pass; every one of those
   *  clears what it needs rather than trusting any previous state. */
  private clearStencil(): void {
    const gl = this.gl;
    gl.stencilMask(0xff);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilMask(0);
  }

  private clearColorTexture(tex: WebGLTexture): void {
    const gl = this.gl;
    this.bindColorTarget(tex);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Copies a texture into another at the current size, factoring in alpha.
   *  Leaves the target framebuffer bound to the destination texture (the glow
   *  preparer restores the caller's framebuffer when it is done). */
  blitTextureInto(src: WebGLTexture, dst: WebGLTexture, alpha: number): void {
    this.bindColorTarget(dst);
    this.setOpaque();
    this.blitFullscreen(src, alpha);
    this.gl.disable(this.gl.BLEND);
  }

  /** Draws a texture over the *current* target at `alpha` (premultiplied) — the
   *  masked fill of a prepared glow under the caller's stencil clip. */
  drawTexture(tex: WebGLTexture, alpha: number): void {
    this.blitFullscreen(tex, alpha);
  }

  private blitFullscreen(tex: WebGLTexture, alpha: number): void {
    const gl = this.gl;
    const program = this.quad;
    gl.useProgram(program.program);
    const used = new Set<number>();
    this.bindAttrib(program, "aPos", 2, this.quadBuf!, used);
    this.bindAttrib(program, "aUV", 2, this.quadUV!, used);
    this.syncAttribs(used);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(program.program, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(program.program, "uAlpha"), alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private resolveToTexture(dstTex: WebGLTexture, msaaFb: WebGLFramebuffer): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaaFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboForTexture(dstTex));
    gl.blitFramebuffer(
      0, 0, this.deviceW, this.deviceH,
      0, 0, this.deviceW, this.deviceH,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }
}

export { BLEND_MODE_INDEX };