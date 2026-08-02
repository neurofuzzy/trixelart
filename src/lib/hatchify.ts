import { triToString } from "@/lib/grid-math";
import {
  enumerateHexTrixels,
  hexWedgeIndex,
  type HexCoord,
} from "@/lib/hex-flower";
import { COLOR_COUNT, decodeColor, encodeColor } from "@/lib/constants";
import {
  DIR_BIT,
  MAX_DENSITY,
  MAX_WEIGHT,
  MIN_DENSITY,
  MIN_WEIGHT,
  encodeHatch,
  type HatchDir,
} from "@/lib/hatch";

/**
 * Converts flat colour into line work: reads the merged fills under a hatch
 * layer and rewrites a selection of hexes as hatch marks.
 *
 * Tone becomes **density** and hex geometry becomes **direction**, so the result
 * reads as concentric line work following each hex rather than one uniform
 * screen laid over everything.
 *
 * Pure — no DOM, no React. The caller owns writing the result into layers.
 */

/**
 * Which line family runs parallel to the outer hex edge of each 1/6 wedge.
 *
 * Hexes are flat-top, so their vertices sit at 0°, 60°, … and `hexWedgeIndex`
 * numbers the wedges the same way: wedge `w` is bounded by the vertices at `60w`
 * and `60w + 60`, and the hex edge joining them runs at `60w + 120` (mod 180).
 * The three families run at 0°, 60° and 120° (dir 0, 1, 2 — read off `hatchU`,
 * *not* off `DIR_LABEL`, whose slash/backslash naming is inverted relative to
 * screen space because world y points down). Hence `dir = (w + 2) % 3`.
 *
 * Verified numerically: for each wedge, `hatchU(WEDGE_DIR[w], …)` is identical
 * at both endpoints of that wedge's hex edge, and differs by 130-150 world units
 * for the other two families. An off-by-one here rotates every mark 60° and the
 * concentric look is silently lost, so it is worth the table.
 */
export const WEDGE_DIR: readonly HatchDir[] = [2, 0, 1, 2, 0, 1];

export type HatchifyMode = "single" | "reduce";

export interface HatchifySettings {
  mode: HatchifyMode;
  /** Density used for the lightest tone that still gets a mark. */
  minDensity: number;
  /** Density used for the darkest tone. */
  maxDensity: number;
  weight: number;
  /** Step between the densities the result is allowed to use. See
   *  `reachableDensities`. */
  densitySkip: number;
  /** Encoded `"paletteIdx,colorIdx"`. Single mode only — reduce takes its ink
   *  from each trixel's own palette. */
  color: string;
  /** How many lightness steps the palette collapses to. Reduce mode only. */
  levels: number;
}

export const MIN_LEVELS = 2;
export const MAX_LEVELS = COLOR_COUNT;

export const MIN_SKIP = 1;
export const MAX_SKIP = 3;

export const DEFAULT_HATCHIFY: HatchifySettings = {
  mode: "single",
  minDensity: 1,
  maxDensity: 7,
  weight: 1.5,
  densitySkip: 1,
  color: "0,1",
  levels: 3,
};

export interface HatchifyResult {
  /** Trixel key -> encoded hatch mark, for the active hatch layer. */
  hatch: Record<string, string>;
  /** Trixel key -> new encoded fill. Always empty in single mode. */
  fills: Record<string, string>;
  /** Every trixel key inside the selected hexes. The caller clears these from
   *  the hatch layer before merging `hatch` in, so re-running is idempotent. */
  covered: string[];
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * The `levels` representative colour indices, spread across the palette's full
 * 0..COLOR_COUNT-1 range. `L[0]` is always the darkest swatch and
 * `L[levels-1]` always the lightest, so the reduced set keeps the original's
 * contrast rather than compressing it toward the middle.
 */
export function reduceLevels(levels: number): number[] {
  const k = clamp(Math.round(levels), MIN_LEVELS, MAX_LEVELS);
  const last = COLOR_COUNT - 1;
  return Array.from({ length: k }, (_, j) => Math.round((j * last) / (k - 1)));
}

/**
 * The densities a run may actually produce: `minDensity`, then every
 * `densitySkip` step up to `maxDensity`.
 *
 * **Why skipping matters for plotting.** Hatch lines sit at `(n + ½)·step` with
 * `step = base/density`, so two densities share lines exactly when their *ratio
 * is odd* — 1 and 3 share, 1 and 2 share nothing, 2 and 6 share, 4 and anything
 * else shares nothing. (Verified over the first three base cells for every pair
 * up to 8.) Consequently, when every reachable density is **odd** they all
 * contain the density-1 ladder, and those coarse lines run unbroken across every
 * trixel in the selection — a plotter draws them in one pass instead of lifting
 * the pen at each tone change. `minDensity` odd with `densitySkip` even is the
 * combination that guarantees it; `allOdd` reports whether the current settings
 * land there, so the UI can say so rather than leaving it to be discovered.
 */
export function reachableDensities(s: HatchifySettings): {
  densities: number[];
  allOdd: boolean;
} {
  const lo = clamp(Math.round(s.minDensity), MIN_DENSITY, MAX_DENSITY);
  const hi = clamp(Math.round(s.maxDensity), lo, MAX_DENSITY);
  const skip = clamp(Math.round(s.densitySkip), MIN_SKIP, MAX_SKIP);
  const densities: number[] = [];
  for (let d = lo; d <= hi; d += skip) densities.push(d);
  return { densities, allOdd: densities.every((d) => d % 2 === 1) };
}

/**
 * Maps an ink amount (1 = darkest, most ink) to one of the reachable densities.
 *
 * Rounding happens in *step units* rather than on the raw density, so the result
 * can only ever land on the reachable ladder — snapping afterwards would let a
 * value fall between two allowed densities and quietly break the alignment
 * property above.
 */
function densityFor(a: number, s: HatchifySettings): number {
  const { densities } = reachableDensities(s);
  if (densities.length === 0) return 0;
  const j = clamp(Math.round(a * (densities.length - 1)), 0, densities.length - 1);
  const d = densities[j];
  return d < MIN_DENSITY ? 0 : clamp(d, MIN_DENSITY, MAX_DENSITY);
}

/**
 * @param source merged fills from the visible layers *below* the hatch layer
 * @param hexes  the current hex selection
 * @param N      grid divisions; must be > 0 for a hex lattice to exist
 */
export function hatchify(
  source: Record<string, string>,
  hexes: HexCoord[],
  N: number,
  s: HatchifySettings,
): HatchifyResult {
  const hatch: Record<string, string> = {};
  const fills: Record<string, string> = {};
  const covered: string[] = [];
  if (N <= 0) return { hatch, fills, covered };

  const weight = clamp(s.weight, MIN_WEIGHT, MAX_WEIGHT);
  const levels = s.mode === "reduce" ? reduceLevels(s.levels) : [];
  const last = COLOR_COUNT - 1;

  for (const hex of hexes) {
    for (const tri of enumerateHexTrixels(hex.c, hex.k, N)) {
      const key = triToString(tri);
      covered.push(key);

      const value = source[key];
      if (!value) continue;
      // A hatch value has pipes and no valid "p,c" split, so this rejects one
      // structurally if it ever reaches the source map.
      const src = decodeColor(value);
      if (!src) continue;
      const colorIdx = clamp(Math.round(src.colorIdx), 0, last);

      const dir = WEDGE_DIR[hexWedgeIndex(tri, hex.c, hex.k, N)];

      let a: number;
      let color: string;

      if (s.mode === "reduce") {
        const k = levels.length;
        const exact = (colorIdx * (k - 1)) / last;
        const lo = Math.min(Math.floor(exact), k - 1);
        const frac = exact - lo;
        if (frac <= 1e-9) {
          // Lands exactly on a reduced level: the fill alone says it.
          fills[key] = encodeColor(src.paletteIdx, levels[lo]);
          continue;
        }
        // The fill takes the *lighter* neighbour and the ink the darker one, so
        // the two average back to the original tone. Snapping the fill down and
        // then hatching darker over it would drive the selection toward black.
        fills[key] = encodeColor(src.paletteIdx, levels[Math.min(lo + 1, k - 1)]);
        color = encodeColor(src.paletteIdx, levels[lo]);
        a = 1 - frac;
      } else {
        // colorIdx 0 is the darkest swatch, so more ink as the index falls.
        a = 1 - colorIdx / last;
        color = s.color;
      }

      const density = densityFor(a, s);
      if (density === 0) continue;

      hatch[key] = encodeHatch({
        dirMask: DIR_BIT[dir],
        density,
        weight,
        color,
      });
    }
  }

  return { hatch, fills, covered };
}
