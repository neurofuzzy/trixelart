/**
 * Triangular Grid Mathematics
 * 
 * Uses a coordinate system where:
 * - SIDE is the length of a triangle edge.
 * - H is the height of an equilateral triangle (SIDE * sqrt(3) / 2).
 * - Each "cell" is a rhombus containing one 'up' and one 'down' triangle.
 * 
 * Analytical Coordinates (a, b, c):
 * - a = horizontal row index (0 deg)
 * - b = diagonal strip index (60 deg)
 * - c = diagonal strip index (120 deg)
 * - Up triangles: a + b + c = 0
 * - Down triangles: a + b + c = -1
 */

export const SIDE = 50;
export const H = SIDE * Math.sqrt(3) / 2;

export type TriType = 'up' | 'down';

export interface TriKey {
  q: number;
  r: number;
  type: TriType;
}

/** Converts a TriKey object to a unique string for storage */
export const triToString = (k: TriKey) => `${k.q},${k.r},${k.type}`;

/** Parses a TriKey string back into an object */
export const stringToTri = (s: string): TriKey => {
  const [q, r, type] = s.split(',');
  return { q: parseInt(q), r: parseInt(r), type: type as TriType };
};

/** Converts world coordinates (relative to origin) to a TriKey */
export const worldToTri = (wx: number, wy: number): TriKey => {
  const r = wy / H;
  const q = (wx / SIDE) - (r * 0.5);
  
  const fq = Math.floor(q);
  const fr = Math.floor(r);
  
  const lq = q - fq;
  const lr = r - fr;
  
  // In a rhombus, the diagonal determines if we are in the 'up' or 'down' triangle
  const type: TriType = (lq + lr < 1) ? 'up' : 'down';
  
  return { q: fq, r: fr, type };
};

/** 
 * Returns the analytical coordinates for a triangle.
 * Useful for math-based symmetry rules.
 * Redefined so Up(0,0) = (0,0,0)
 */
export function getTriABC(q: number, r: number, type: TriType) {
  const a = r;
  const b = q;
  const c = type === 'up' ? -a - b : -1 - a - b;
  return { a, b, c };
}

/** Returns all triangles intersected by a line segment between two world points */
export function getTrianglesOnLine(
  wx1: number, wy1: number,
  wx2: number, wy2: number
): TriKey[] {
  const visited = new Set<string>();
  const result: TriKey[] = [];

  const r1 = wy1 / H;
  const q1 = wx1 / SIDE - r1 * 0.5;
  const r2 = wy2 / H;
  const q2 = wx2 / SIDE - r2 * 0.5;

  const dq = q2 - q1;
  const dr = r2 - r1;
  const dist = Math.sqrt(dq * dq + dr * dr);

  const maxStep = 0.1;
  const steps = Math.max(Math.ceil(dist / maxStep), 1);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const q = q1 + dq * t;
    const r = r1 + dr * t;
    const wx = (q + r * 0.5) * SIDE;
    const wy = r * H;
    const tri = worldToTri(wx, wy);
    const key = triToString(tri);
    if (!visited.has(key)) {
      visited.add(key);
      result.push(tri);
    }
  }

  return result;
}

/** Generates the SVG path string for a specific triangle */
export const getTriPath = (q: number, r: number, type: TriType) => {
  const bx = q * SIDE + r * (SIDE / 2);
  const by = r * H;
  
  if (type === 'up') {
    return `M ${bx} ${by} L ${bx + SIDE} ${by} L ${bx + SIDE / 2} ${by + H} Z`;
  } else {
    return `M ${bx + SIDE / 2} ${by + H} L ${bx + SIDE * 1.5} ${by + H} L ${bx + SIDE} ${by} Z`;
  }
};
