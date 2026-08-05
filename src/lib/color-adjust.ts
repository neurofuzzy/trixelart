import { hslToHex } from "@/lib/constants";

/**
 * The colour-adjust layer effect's maths: a hue/saturation/brightness filter
 * applied to a layer's *resolved* colours on their way to a renderer.
 *
 * Unlike the other three effects this one is not geometry, but it obeys the same
 * contract: `painted` is never touched, so switching it off restores the artwork
 * exactly. It is deliberately applied to the resolved hex rather than to the
 * encoded value — the adjusted colour is continuous and almost never lands on a
 * palette swatch, and quantizing it back (as the pattern brush does) would make
 * the sliders step rather than glide, and would throw away the very shades the
 * effect exists to reach.
 *
 * Work happens in **HSL**, the space the palettes are defined in
 * (`PALETTE_DEFS` is hue + saturation + a lightness ramp), so a hue rotation
 * moves a swatch exactly as changing its palette's hue would, and the round trip
 * through `hexToHsl` is an identity on every palette colour up to 8-bit
 * rounding.
 *
 * Pure: no DOM, no React.
 */

/** Hue rotation in degrees at ±100. A half turn each way reaches every hue. */
export const ADJUST_HUE_AT_FULL = 180;

/** All three are −100…100, and 0 means "leave alone". */
export interface ColorAdjustment {
  brightness: number;
  hue: number;
  saturation: number;
}

/** An adjustment that changes nothing. `activeEffects` drops these, so a layer
 *  carrying one renders byte-identically to a layer carrying no effect. */
export const isIdentityAdjustment = (a: ColorAdjustment): boolean =>
  a.brightness === 0 && a.hue === 0 && a.saturation === 0;

/**
 * Moves `v` a fraction `t` of the way to 100 (`t > 0`) or to 0 (`t < 0`).
 *
 * Both halves of a slider are the same lerp, which is what makes ±100 land on
 * pure white/black and full/zero saturation exactly, and what keeps the two
 * directions symmetric. Adding the offset instead (`l + t`) clamps hard well
 * before the end of the travel, so the last third of the slider does nothing.
 */
const towards = (v: number, t: number): number =>
  t >= 0 ? v + (100 - v) * t : v * (1 + t);

function hexToHsl(
  hex: string,
): { h: number; s: number; l: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const d = m[1];
  const full =
    d.length === 3 ? d[0] + d[0] + d[1] + d[1] + d[2] + d[2] : d;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const c = max - min;

  if (c === 0) return { h: 0, s: 0, l: l * 100 };

  const s = c / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / c) % 6;
  else if (max === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  if (h < 0) h += 360;

  return { h, s: s * 100, l: l * 100 };
}

/**
 * One resolved colour through the filter.
 *
 * Anything that is not a hex literal comes back untouched: `resolveColor`
 * returns its input verbatim for a value it cannot decode, and a hatch mark or a
 * stray key must not be mangled into a colour here.
 */
export function adjustHex(hex: string, a: ColorAdjustment): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const h =
    (((hsl.h + (a.hue / 100) * ADJUST_HUE_AT_FULL) % 360) + 360) % 360;
  return hslToHex(
    h,
    towards(hsl.s, a.saturation / 100),
    towards(hsl.l, a.brightness / 100),
  );
}

/**
 * The filter as a memoised function, or `undefined` when it would change
 * nothing.
 *
 * `undefined` rather than an identity function on purpose: every call site takes
 * it as an optional argument, so an unadjusted layer walks byte for byte the
 * code path it walked before this effect existed. The memo matters because the
 * canvas resolves a colour per *triangle* while an artwork uses a handful of
 * distinct swatches — the same reasoning as the pattern brush's quantize cache.
 */
export function colorAdjuster(
  a: ColorAdjustment,
): ((hex: string) => string) | undefined {
  if (isIdentityAdjustment(a)) return undefined;
  const cache = new Map<string, string>();
  return (hex: string) => {
    let out = cache.get(hex);
    if (out === undefined) {
      out = adjustHex(hex, a);
      cache.set(hex, out);
    }
    return out;
  };
}
