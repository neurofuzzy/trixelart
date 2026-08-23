/**
 * Ear-clipping triangulation of a single simple polygon.
 *
 * The renderer reaches every filled *region* through this: rounded and outlined
 * layers trace their boundary into rings, and the flat-triangle path a 2D
 * context gets for free has to be built by hand for WebGL. Holes are NOT spliced
 * here — the caller fills each ring into the stencil buffer with the winding
 * driving increment vs decrement (see `GLRenderer.fillRings`), so this module
 * only ever sees one closed loop, never a bridgeable one.
 *
 * All rings are simple polygons (no self-intersection): the ring walk in
 * `round-corners.ts` chains lattice edges into closed loops, and arcs are
 * flattened to chords before this is called. An ear clip of a simple polygon
 * retiles it exactly, so a region tinted through a neighbouring colour cannot get
 * a seam — the very thing the 2D path fill never produced.
 */

export type Pt = [number, number];

interface Node {
  i: number;
  x: number;
  y: number;
  prev: Node;
  next: Node;
}

const EPS = 1e-9;

function area2(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointInTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function linkPolygon(points: Pt[]): Node | null {
  const n = points.length;
  if (n < 3) return null;
  const nodes: Node[] = new Array(n);
  for (let i = 0; i < n; i++) {
    nodes[i] = { i, x: points[i][0], y: points[i][1], prev: null!, next: null! };
  }
  for (let i = 0; i < n; i++) {
    nodes[i].next = nodes[(i + 1) % n];
    nodes[i].prev = nodes[(i - 1 + n) % n];
  }
  return nodes[0];
}

/** Remove a node from its ring, returning the ring length after removal. */
function removeNode(node: Node): void {
  node.prev.next = node.next;
  node.next.prev = node.prev;
}

function isEar(node: Node): boolean {
  const a = node.prev;
  const b = node;
  const c = node.next;

  // A reflex ear (the polygon turns the wrong way at b) or a collinear one
  // cannot be clipped — collinear corners produced by arc flattening are common
  // and clip as if they were straight.
  if (area2([a.x, a.y], [b.x, b.y], [c.x, c.y]) >= -EPS) return false;

  for (let p = c.next; p !== a; p = p.next) {
    if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y)) return false;
  }
  return true;
}

/**
 * Clips `points` by ears. Polygons are small (region boundaries), so the naive
 * linear test per ear is fine. Returns a flat `[x,y, x,y, x,y, ...]` list of
 * triangles, or `null` when there is nothing worth drawing (degenerate input).
 */
export function triangulatePolygon(points: Pt[]): number[] | null {
  // Establish the winding up front and flip the ring to the one the ear test
  // expects (a clockwise walk in these coordinates; `isEar`'s reflex check
  // reads the turn sign). Region rings arrive wound either way — screen-space
  // ring walks and offset curves don't share a convention — so forcing one here
  // is what keeps an inverted corner from being treated as reflex.
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  if (Math.abs(area) < EPS) return null;
  const pts = area > 0 ? points.slice().reverse() : points;

  const ring = linkPolygon(pts);
  if (!ring) return null;

  const out: number[] = [];
  let count = 0;
  for (let p = ring; ; p = p.next) {
    count++;
    if (p.next === ring) break;
  }
  if (count < 3) return null;

  let cur = ring;
  let guard = 0;

  while (count > 3) {
    // Pathological guard: a valid simple ring never needs anywhere near this
    // many passes; if it burns through, hand back what we have rather than spin.
    if (guard++ > count * 20) {
      return out.length ? out : null;
    }

    if (isEar(cur)) {
      out.push(cur.prev.x, cur.prev.y, cur.x, cur.y, cur.next.x, cur.next.y);
      removeNode(cur);
      count--;
      cur = cur.prev;
      continue;
    }
    cur = cur.next;
  }

  if (count === 3) {
    out.push(cur.prev.x, cur.prev.y, cur.x, cur.y, cur.next.x, cur.next.y);
  }

  // A triangle-list output of even length carries a complete retile.
  return out.length >= 6 ? out : null;
}

/** De-duplicates consecutive coincident points and pops a trailing duplicate of
 *  the first point. Arc flattening occasionally emits a zero-length edge where
 *  two tangent points coincide; a degenerate edge is harmless to an ear clip but
 *  cheap to shed here. */
export function dedupeRing(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-6) continue;
    out.push(p);
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6
  ) {
    out.pop();
  }
  return out;
}