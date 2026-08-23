// Minimal local declarations for twgl 7.x, which ships no type definitions.
// Only the surface this renderer uses is described; the rest is `any`.

declare module "twgl" {
  export interface ProgramInfo {
    program: WebGLProgram;
    attribSetters: Record<string, (v: unknown) => void>;
    uniformSetters: Record<string, (v: unknown) => void>;
    uniforms: Record<string, WebGLUniformLocation | null>;
  }

  export interface BufferInfo {
    numElements: number;
    indices?: WebGLBuffer;
    attribs: Record<string, { buffer: WebGLBuffer; location: number }>;
  }

  export type TypedArrays = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array;

  export interface ArrayData {
    numComponents?: number;
    data: TypedArrays;
    type?: number;
    size?: number;
    normalize?: boolean;
    index?: boolean;
  }

  export function createProgramInfo(
    gl: WebGL2RenderingContext,
    sources: string[] | { vs: string; fs: string },
  ): ProgramInfo;

  export function createBufferInfoFromArrays(
    gl: WebGL2RenderingContext,
    arrays: Record<string, ArrayData | TypedArrays>,
  ): BufferInfo;

  export function createBufferFromArray(
    gl: WebGL2RenderingContext,
    data: ArrayData | TypedArrays,
  ): WebGLBuffer;

  export function setBuffersAndAttributes(
    gl: WebGL2RenderingContext,
    programInfo: ProgramInfo,
    bufferInfo: BufferInfo,
  ): void;

  export function drawBufferInfo(
    gl: WebGL2RenderingContext,
    bufferInfo: BufferInfo,
    primitiveType?: number,
    count?: number,
    offset?: number,
  ): void;

  export function setUniforms(
    programInfo: ProgramInfo,
    uniforms: Record<string, unknown>,
  ): void;

  export const m4: {
    multiply(a: number[], b: number[], out?: number[]): number[];
    identity(out?: number[]): number[];
    inverse(m: number[] | Float32Array, out?: number[]): number[];
    translation(v: number[], out?: number[]): number[];
    translate(m: number[], v: number[]): number[];
    scaling(v: number | number[]): number[];
    scale(m: number[], v: number[]): number[];
    rotationZ(angle: number): number[];
    rotateZ(m: number[], angle: number): number[];
    ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): number[];
  };
}