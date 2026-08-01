import { SIDE, triCenter, worldToTri, type TriKey } from "@/lib/grid-math";

/**
 * Procedural patterns on the triangular lattice.
 *
 * Ported from the `prismatic` cap mapping in the material-forge shader
 * (`src/lib/shader/patterns.glsl.ts`). The two grids are the same lattice —
 * `worldToTri` performs exactly the skew that `mfTriCell` does, and
 * `triCenter` already returns what `mfTriPos(mfTriCentroid(...))` computes —
 * so only the five predicates are new here.
 *
 * The interesting behaviour is emergent rather than designed. Each trixel
 * point-samples the pattern at its centroid, so once `scale` pushes the pattern
 * lattice finer than the trixel lattice, the two beat against each other and
 * produce motifs that none of the five predicates describes on its own. That is
 * why rotation is continuous and why `scale` is allowed well above 1: snapping
 * the angle to the lattice's 6-fold symmetry, or capping the scale, makes that
 * whole family unreachable. `checker` at scale 2.6 / rotation 235 gives
 * interlocking hexagons.
 *
 * Every value is a pure function of world position, so the field is global: two
 * separately painted areas line up as though revealing one continuous pattern.
 */

export type TriPatternType = "checker" | "grid" | "brick" | "lines" | "rings";

export const TRI_PATTERN_TYPES: TriPatternType[] = [
  "checker",
  "grid",
  "brick",
  "lines",
  "rings",
];

export interface TriPattern {
  type: TriPatternType;
  /** Pattern lattice size relative to a trixel. Above 1 the pattern is finer
   *  than the grid, which is where the moire lives. */
  scale: number;
  /** Degrees. Deliberately continuous — see the note above. */
  rotation: number;
}

export const DEFAULT_TRI_PATTERN: TriPattern = {
  type: "checker",
  scale: 2.6,
  rotation: 235,
};

/**
 * GLSL `mod()` is non-negative for a positive modulus; JS `%` keeps the sign of
 * the dividend. The lattice runs negative in every direction, so the shader
 * predicates only port faithfully through this.
 */
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * The pattern's value at one trixel: 1 for the primary colour, 0 for the
 * secondary.
 */
export function triPatternValue(t: TriKey, p: TriPattern): 0 | 1 {
  // Centroid in edge-length-1 units. SIDE cancels against the multiply below,
  // but keeping both makes the reuse of the existing helpers exact rather than
  // a re-derivation.
  const c = triCenter(t.q, t.r, t.type);
  const px = c.x / SIDE;
  const py = c.y / SIDE;

  const a = (p.rotation * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);

  // Rotate, scale, then re-derive which cell of the pattern lattice we landed
  // in. This is the sample that aliases.
  const rx = (px * cs - py * sn) * p.scale;
  const ry = (px * sn + py * cs) * p.scale;
  const cell = worldToTri(rx * SIDE, ry * SIDE);

  const q = cell.q;
  const r = cell.r;

  switch (p.type) {
    case "checker":
      // The two-colouring of a triangular tiling is up/down parity. Note the
      // inversion: trixelart's 'up' is the shader's `up = 0`.
      return cell.type === "down" ? 0 : 1;

    case "grid":
      // Lines along the three lattice directions: q, r and q + r.
      return mod(q, 4) === 0 || mod(r, 4) === 0 || mod(q + r, 4) === 0 ? 1 : 0;

    case "brick":
      // Courses of rhombi, offset half a course every other row. Running bond
      // has no exact triangular analogue; this is a reading of it.
      if (mod(r, 4) === 0) return 1;
      return mod(q + mod(Math.floor(r / 4), 2) * 4, 8) === 0 ? 1 : 0;

    case "lines":
      return mod(r, 3) === 0 ? 1 : 0;

    case "rings": {
      // Hexagonal rings. The rhombic basis is exactly the axial hex system, so
      // the ring index is the standard axial distance.
      const dq = q - 8 * p.scale;
      const dr = r - 8 * p.scale;
      const ring = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) * 0.5;
      return mod(Math.floor(ring), 2) === 0 ? 1 : 0;
    }
  }
}

/**
 * Every trixel whose centroid falls inside the axis-aligned world box. Used by
 * the designer preview, which needs a patch wide enough for the beat to show.
 */
export function trixelsInBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): TriKey[] {
  const H = (SIDE * Math.sqrt(3)) / 2;
  const rMin = Math.floor(y0 / H) - 1;
  const rMax = Math.ceil(y1 / H) + 1;
  const qMin = Math.floor(x0 / SIDE - rMax / 2) - 1;
  const qMax = Math.ceil(x1 / SIDE - rMin / 2) + 1;

  const out: TriKey[] = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let q = qMin; q <= qMax; q++) {
      for (const type of ["up", "down"] as const) {
        const c = triCenter(q, r, type);
        if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) {
          out.push({ q, r, type });
        }
      }
    }
  }
  return out;
}
