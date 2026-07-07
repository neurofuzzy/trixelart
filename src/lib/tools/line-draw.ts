import { SIDE, H, triCenter, getTrianglesOnLine, type TriKey } from "@/lib/grid-math";
import { triToHex } from "@/lib/hex-flower";

export function bestAxisClosest(
  origin: { x: number; y: number },
  target: { x: number; y: number },
): { x: number; y: number } | null {
  const axes = [
    { dx: SIDE, dy: 0 },
    { dx: SIDE / 2, dy: H },
    { dx: -SIDE / 2, dy: H },
  ];
  let bestClosest: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const axis of axes) {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const dd = axis.dx * axis.dx + axis.dy * axis.dy;
    const t = (dx * axis.dx + dy * axis.dy) / dd;
    const px = origin.x + t * axis.dx;
    const py = origin.y + t * axis.dy;
    const dist = Math.hypot(px - target.x, py - target.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestClosest = { x: px, y: py };
    }
  }
  return bestClosest;
}

export function clippedLine(
  fromTri: TriKey,
  toTri: TriKey,
  selectedHex: { c: number; k: number } | null,
  N: number,
): TriKey[] {
  const origin = triCenter(fromTri.q, fromTri.r, fromTri.type);
  const target = triCenter(toTri.q, toTri.r, toTri.type);
  const closest = bestAxisClosest(origin, target);
  if (!closest) return [];
  let lineTris = getTrianglesOnLine(origin.x, origin.y, closest.x, closest.y);
  if (selectedHex && N > 0) {
    lineTris = lineTris.filter((t) => {
      const h = triToHex(t.q, t.r, t.type, N);
      return h.c === selectedHex.c && h.k === selectedHex.k;
    });
  }
  return lineTris;
}
