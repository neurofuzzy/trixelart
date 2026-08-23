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
 * Blend modes are evaluated in a fragment shader over two resolved textures
 * (the accumulated artwork and the isolated step), matching the Canvas spec's
 * "backdrop alpha is dropped" separable-mode formulas. Glow is a two-pass
 * gaussian blur of the caster silhouette. Neither is a raster copy of the 2D
 * output — but both compute the same field the 2D API computes, and the
 * exporters that need byte fidelity keep their own 2D backends untouched.
 */

import * as twgl from "twgl";
import { flattenRoundedRing, type RoundedRing } from "@/lib/round-corners";
import { triangulatePolygon, dedupeRing } from "@/lib/webgl/triangulate";

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

/** Signed area sign of the first triangle in a flat ear-clip output: the
 *  winding the stencil pass winds by. */
function trisAreaSign(tris: number[]): number {
  if (tris.length < 6) return 0;
  const a = tris[0], b = tris[1];
  const c = tris[2], d = tris[3];
  const e = tris[4], f = tris[5];
  const shoe = a * d + c * f + e * b - (b * c + d * e + f * a);
  return shoe > 0 ? 1 : shoe < 0 ? -1 : 0;
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

  private drawDynamic(
    program: twgl.ProgramInfo,
    attribs: Array<{ name: string; data: Float32Array; size: number }>,
    count: number,
    uniforms: Record<string, unknown>,
  ): void {
    const gl = this.gl;
    gl.useProgram(program.program);
    attribs.forEach((a, i) => {
      const loc = gl.getAttribLocation(program.program, a.name);
      gl.enableVertexAttribArray(loc);
      const buf = this.uploadScratch(a.data, i);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, 0, 0);
    });
    twgl.setUniforms(program, uniforms as never);
    gl.drawArrays(gl.TRIANGLES, 0, count);
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
    const pos = gl.getAttribLocation(program.program, "aPos");
    const col = gl.getAttribLocation(program.program, "aColor");
    gl.enableVertexAttribArray(pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.positions);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(col);
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.colors);
    gl.vertexAttribPointer(col, 4, gl.FLOAT, false, 0, 0);
    twgl.setUniforms(program, { uMVP: this.uMVP } as never);
    gl.drawArrays(gl.TRIANGLES, 0, batch.count);
  }

  // ---------------------------------------------------------------- regions

  private ringTriangles(ring: RoundedRing): number[] | null {
    const flat = flattenRoundedRing(ring);
    const pts = dedupeRing(flat);
    return triangulatePolygon(pts);
  }

  /**
   * Fills a set of rings (outer first, holes after) with one colour — the same
   * shape a Canvas2D `fill()` of the same paths would paint. Opaque fills
   * disable blending so a region sharing an edge with its neighbour never draws
   * over it; a single ring skips the stencil entirely and draws its ear-clipped
   * triangles directly.
   */
  fillRings(rings: RoundedRing[], color: Color4): void {
    if (rings.length === 0) return;
    const gl = this.gl;

    if (rings.length === 1) {
      const tris = this.ringTriangles(rings[0]);
      if (!tris) return;
      if (color[3] >= 1) this.setOpaque();
      else this.setOverlay();
      this.fillTris(new Float32Array(tris), color);
      return;
    }

    // Stencil winding fill: outer rings wind the stencil +1 per covered sample,
    // holes -1; a fullscreen quad then fills where the count is non-zero.
    const positive: number[] = [];
    const negative: number[] = [];
    for (const ring of rings) {
      const tris = this.ringTriangles(ring);
      if (!tris) continue;
      if (trisAreaSign(tris) >= 0) positive.push(...tris);
      else negative.push(...tris);
    }
    if (positive.length === 0 && negative.length === 0) return;

    this.clearStencil();
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.colorMask(false, false, false, false);

    const write = (data: number[], op: number) => {
      if (!data.length) return;
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(op, op, op);
      this.drawDynamic(
        this.tri,
        [{ name: "aPos", data: new Float32Array(data), size: 2 }],
        data.length / 2,
        { uMVP: this.uMVP },
      );
    };

    write(positive, gl.INCR_WRAP);
    write(negative, gl.DECR_WRAP);

    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    if (color[3] >= 1) this.setOpaque();
    else this.setOverlay();
    this.blitSolid(color);
    gl.stencilMask(0);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.disable(gl.STENCIL_TEST);
  }

  /** A fullscreen draw in one flat colour, the masked fill of a stencil pass. */
  private blitSolid(color: Color4): void {
    const gl = this.gl;
    const program = this.solidQuad;
    gl.useProgram(program.program);
    const pos = gl.getAttribLocation(program.program, "aPos");
    const uv = gl.getAttribLocation(program.program, "aUV");
    gl.enableVertexAttribArray(pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(uv);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUV);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
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
      for (let i = 0; i < n; i++) {
        this.pushDisk(positions, lens, colors, color, points[i * 2], points[i * 2 + 1], hw, cum[i], segs);
      }
      if (!opts.close) {
        this.pushDisk(positions, lens, colors, color, points[0], points[1], hw, cum[0], segs);
        this.pushDisk(positions, lens, colors, color, points[(n - 1) * 2], points[(n - 1) * 2 + 1], hw, cum[n - 1], segs);
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

  /** A stroked axis-aligned rect (the crop frame). */
  strokeRect(x: number, y: number, w: number, h: number, color: Color4, width: number): void {
    this.strokePolyline([x, y, x + w, y, x + w, y + h, x, y + h], color, width, { close: true });
  }

  // ---------------------------------------------------------------- clipping

  /**
   * Begins a stencil clip: only what the given rings cover is drawn by calls
   * between this and `endClip()`. Rings are filled by winding, so a ring list
   * with holes clips the holes out for free.
   */
  beginClip(rings: RoundedRing[]): void {
    if (rings.length === 0) return;
    const gl = this.gl;
    const positive: number[] = [];
    const negative: number[] = [];
    for (const ring of rings) {
      const tris = this.ringTriangles(ring);
      if (!tris) continue;
      if (trisAreaSign(tris) >= 0) positive.push(...tris);
      else negative.push(...tris);
    }
    if (positive.length === 0 && negative.length === 0) return;

    this.clearStencil();
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.colorMask(false, false, false, false);

    const write = (data: number[], op: number) => {
      if (!data.length) return;
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(op, op, op);
      this.drawDynamic(
        this.tri,
        [{ name: "aPos", data: new Float32Array(data), size: 2 }],
        data.length / 2,
        { uMVP: this.uMVP },
      );
    };

    write(positive, gl.INCR_WRAP);
    write(negative, gl.DECR_WRAP);

    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilMask(0);
    gl.colorMask(true, true, true, true);
  }

  /** Ends a clip. Safe to call even when none was begun. */
  endClip(): void {
    const gl = this.gl;
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  }

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
    const pos = gl.getAttribLocation(program.program, "aPos");
    const uv = gl.getAttribLocation(program.program, "aUV");
    gl.enableVertexAttribArray(pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(uv);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUV);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
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
    const pos = gl.getAttribLocation(program.program, "aPos");
    const uv = gl.getAttribLocation(program.program, "aUV");
    gl.enableVertexAttribArray(pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(uv);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUV);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
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
    const pos = gl.getAttribLocation(program.program, "aPos");
    const uv = gl.getAttribLocation(program.program, "aUV");
    gl.enableVertexAttribArray(pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(uv);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUV);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
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