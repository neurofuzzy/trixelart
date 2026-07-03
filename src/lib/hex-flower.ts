import { SIDE, H, worldToTri, type TriKey, type TriType } from "./grid-math";

/**
 * Hex coordinates of the home hex containing trixel (q, r, type).
 *
 * The hex lattice is the flat-top honeycomb whose centers sit at
 *   world (1.5*c*N*S, N*H*(c + 2k))  with hex side s = N*S.
 * Hex basis translations in tri-axial (q, r) space are
 *   c-axis e1 = (N, N),   k-axis e2 = (-N, 2N).
 *
 * Using the trixel centroid (interior to exactly one hex; the base vertex
 * sits on a hex boundary and is ambiguous) gives fractional cube coords
 *   c = (2q + r + t) / (3N)
 *   k = (r - q)       / (3N)
 *   s = -(q + 2r + t) / (3N)        (t = 1 for up, 2 for down)
 * which are then cube-rounded to the nearest integer hex.
 */
export function triToHex(q: number, r: number, type: TriType, N: number) {
  const t = type === "up" ? 1 : 2;
  const cf = (2 * q + r + t) / (3 * N);
  const kf = (r - q) / (3 * N);
  const sf = -(q + 2 * r + t) / (3 * N);

  let rc = Math.round(cf);
  let rk = Math.round(kf);
  let rs = Math.round(sf);

  const dc = Math.abs(rc - cf);
  const dk = Math.abs(rk - kf);
  const ds = Math.abs(rs - sf);

  if (dc > dk && dc > ds) rc = -rk - rs;
  else if (dk > ds) rk = -rc - rs;
  else rs = -rc - rk;

  return { c: rc, k: rk };
}

/**
 * Tri-axial offsets (dq, dr) to mirror a trixel from its home hex into every
 * hex within hex distance 1..R (the hexagonal "flower" radius, not circular).
 * Returned in no particular order; the home hex (offset 0,0) is excluded.
 */
export function flowerOffsets(
  R: number,
  N: number,
): Array<{ dq: number; dr: number }> {
  const out: Array<{ dq: number; dr: number }> = [];
  for (let dc = -R; dc <= R; dc++) {
    for (let dk = -R; dk <= R; dk++) {
      if (dc === 0 && dk === 0) continue;
      const d = (Math.abs(dc) + Math.abs(dk) + Math.abs(dc + dk)) / 2;
      if (d > R) continue;
      out.push({ dq: N * (dc - dk), dr: N * (dc + 2 * dk) });
    }
  }
  return out;
}

/**
 * 60°-CCW rotation of a trixel around a hex center (qc, rc) in tri-axial
 * coordinates. Rotates the trixel centroid; the resulting world point maps
 * back to a trixel of the opposite type (the two triangle orientations
 * alternate around each hex-center vertex).
 */
export function rotateTrixelCCW(
  tri: TriKey,
  qc: number,
  rc: number,
): TriKey {
  const cx = qc * SIDE + (rc * SIDE) / 2;
  const cy = rc * H;
  const bx = tri.q * SIDE + (tri.r * SIDE) / 2;
  const by = tri.r * H;
  const centX = tri.type === "up" ? bx + SIDE / 2 : bx + SIDE;
  const centY = tri.type === "up" ? by + H / 3 : by + (2 * H) / 3;
  const dx = centX - cx;
  const dy = centY - cy;
  const ndx = 0.5 * dx - (Math.sqrt(3) / 2) * dy;
  const ndy = (Math.sqrt(3) / 2) * dx + 0.5 * dy;
  return worldToTri(cx + ndx, cy + ndy);
}

export type Symmetry = "off" | "sym60" | "sym120";

/**
 * Expands a single painted trixel into the full set of trixel keys to write,
 * combining hex rotation symmetry (6-fold at 60°, or 3-fold at 120°) with
 * the hex flower copy offsets.
 *   - base[0] is always the original trixel.
 *   - sym60: 5 additional rotations (60°, 120°, … 300°) around the home hex.
 *   - sym120: 2 additional rotations (120°, 240°) around the home hex.
 *   - Each rotated trixel is then translated by every flower offset.
 */
export function paintTargets(
  tri: TriKey,
  N: number,
  symmetry: Symmetry,
  offsets: Array<{ dq: number; dr: number }>,
): TriKey[] {
  const base: TriKey[] = [tri];

  if (symmetry !== "off" && N > 0) {
    const { c, k } = triToHex(tri.q, tri.r, tri.type, N);
    const qc = N * (c - k);
    const rc = N * (c + 2 * k);
    let cur = tri;
    for (let i = 1; i <= 5; i++) {
      cur = rotateTrixelCCW(cur, qc, rc); // now at i * 60°
      const deg = i * 60;
      // sym60: include all 5 rotations. sym120: only 120° and 240°.
      if (symmetry === "sym60" || deg % 120 === 0) {
        base.push(cur);
      }
    }
  }

  const out: TriKey[] = [];
  for (const b of base) {
    out.push(b);
    for (const o of offsets) {
      out.push({ q: b.q + o.dq, r: b.r + o.dr, type: b.type });
    }
  }
  return out;
}