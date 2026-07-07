/**
 * Safari on some devices reports pointer/touch coordinates in physical
 * pixels while getBoundingClientRect returns CSS pixels. Detect the
 * mismatch and normalize back to CSS pixels.
 */
export function normPoint(cx: number, cy: number): { x: number; y: number } {
  if (cx > window.innerWidth * 1.5 || cy > window.innerHeight * 1.5) {
    const dpr = window.devicePixelRatio || 1;
    return { x: cx / dpr, y: cy / dpr };
  }
  return { x: cx, y: cy };
}

export function normTouchPair(
  cx1: number, cy1: number,
  cx2: number, cy2: number,
): [number, number, number, number] {
  const a = normPoint(cx1, cy1);
  const b = normPoint(cx2, cy2);
  return [a.x, a.y, b.x, b.y];
}
