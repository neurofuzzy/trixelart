// hatch.ts imports only from grid-math, so this does not create a cycle.
import { mapEncodedColor } from "@/lib/hatch";

export function hslToHex(h: number, s: number, l: number): string {
  s = Math.max(0, Math.min(100, s));
  l = Math.max(0, Math.min(100, l));
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return `#${[r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export const PALETTE_LIGHTNESSES = [3, 12, 22, 32, 42, 52, 62, 74, 88];
export const COLOR_COUNT = PALETTE_LIGHTNESSES.length;

export interface PaletteDef {
  name: string;
  hue: number;
  saturation: number;
  colorHues?: number[];
  lightnesses?: number[];
  /**
   * Fixed swatches, used verbatim instead of deriving the ramp from hue/
   * saturation/lightness. Present on the yarn palettes (whose colors come from
   * `etc/yarns.json`, not from the HSL model) so they survive the round trip
   * through `hslToHex` unchanged and stay put under the global
   * `hueOffset`/`satOffset` shift. When set, `hue`/`saturation` above are
   * unused.
   */
  hexes?: string[];
}

export const PALETTE_DEFS: PaletteDef[] = [
  { name: "Grayscale", hue: 0, saturation: 0 },
  { name: "Sand", hue: 35, saturation: 25 },
  { name: "Oxide", hue: 15, saturation: 65 },
  { name: "Sienna", hue: 28, saturation: 65 },
  { name: "Mustard", hue: 48, saturation: 75 },
  { name: "Forest", hue: 120, saturation: 45 },
  { name: "Mint", hue: 170, saturation: 65 },
  { name: "Ocean", hue: 200, saturation: 60 },
  { name: "Violets", hue: 260, saturation: 50 },
  { name: "Elderberry", hue: 330, saturation: 55 },
  {
    name: "Ember",
    hue: 0,
    saturation: 70,
    colorHues: [348, 352, 356, 2, 8, 16, 22, 28, 36],
    lightnesses: [3, 12, 22, 32, 42, 50, 56, 62, 68],
  },
  {
    name: "Glacier",
    hue: 0,
    saturation: 55,
    colorHues: [225, 220, 214, 208, 202, 196, 190, 185, 180],
    lightnesses: [3, 12, 22, 32, 42, 50, 56, 62, 68],
  },
  {
    name: "Spring",
    hue: 0,
    saturation: 50,
    colorHues: [135, 128, 120, 112, 104, 96, 85, 70, 55],
    lightnesses: [3, 12, 22, 32, 42, 50, 56, 62, 68],
  },
  {
    name: "Bloom",
    hue: 0,
    saturation: 60,
    colorHues: [285, 292, 300, 308, 316, 324, 332, 340, 350],
    lightnesses: [3, 12, 22, 32, 42, 50, 56, 62, 68],
  },
  // Yarn palettes from `etc/yarns.json`. Grouped by family in the order asked
  // (dark → medium → light within each family, so `colorIdx` still moves
  // darker/lighter the same way as the derived palettes) rather than woven into
  // one lightness ramp. The hexes are literal because `etc/yarns.json`'s HSL
  // values are rounded and would not round-trip; `hexes` keeps each swatch
  // exactly the yarn's colour.
  {
    name: "Warm Yarns",
    hue: 0,
    saturation: 0,
    hexes: [
      "#63293F", // Plum / Red-Violet Dark
      "#9C4E6C", // Plum / Red-Violet Medium
      "#C98FA8", // Plum / Red-Violet Light
      "#A64E38", // Salmon / Pink Dark
      "#DE7B5C", // Salmon / Pink Medium
      "#F2A98C", // Salmon / Pink Light
      "#7A4E1C", // Gold / Yellow-Orange Dark
      "#C98A2E", // Gold / Yellow-Orange Medium
      "#E8C06B", // Gold / Yellow-Orange Light
    ],
  },
  {
    name: "Cool Yarns",
    hue: 0,
    saturation: 0,
    hexes: [
      "#332963", // Indigo / Blue-Violet Dark
      "#5F4E96", // Indigo / Blue-Violet Medium
      "#9C8FC2", // Indigo / Blue-Violet Light
      "#2A4A3F", // Teal / Blue-Green Dark
      "#4C7C6C", // Teal / Blue-Green Medium
      "#8FB9A8", // Teal / Blue-Green Light
      "#565E22", // Moss / Yellow-Green Dark
      "#93A039", // Moss / Yellow-Green Medium
      "#C7CC6E", // Moss / Yellow-Green Light
    ],
  },
  // Neon palettes from `etc/neons.json`, same shape as the yarn palettes above:
  // grouped by family in the order asked, dark → medium → light within each.
  {
    name: "Warm Neons",
    hue: 0,
    saturation: 0,
    hexes: [
      "#850D5D", // Red-Violet Dark
      "#BF1D89", // Red-Violet Medium
      "#E650B4", // Red-Violet Light
      "#732106", // Red-Orange Dark
      "#BF370A", // Red-Orange Medium
      "#E6420B", // Red-Orange Light
      "#734506", // Yellow-Orange Dark
      "#BF740A", // Yellow-Orange Medium
      "#E68B0B", // Yellow-Orange Light
    ],
  },
  {
    name: "Cool Neons",
    hue: 0,
    saturation: 0,
    hexes: [
      "#3D0F99", // Blue-Violet Dark
      "#6030BF", // Blue-Violet Medium
      "#8250E6", // Blue-Violet Light
      "#397364", // Blue-Green Dark
      "#60BFA7", // Blue-Green Medium
      "#95E6D1", // Blue-Green Light
      "#587322", // Yellow-Green Dark
      "#93BF39", // Yellow-Green Medium
      "#B0E645", // Yellow-Green Light
    ],
  },
];

let _hueOffset = 0;
let _satOffset = 0;

export function setPaletteOffsets(hue: number, sat: number) {
  _hueOffset = hue;
  _satOffset = sat;
}

export function computePaletteColors(
  defs: PaletteDef[],
  hueOffset: number,
  satOffset: number,
): { name: string; colors: string[] }[] {
  return defs.map((def) => ({
    name: def.name,
    colors: def.hexes
      ? def.hexes
      : (def.lightnesses ?? PALETTE_LIGHTNESSES).map((l, i) => {
          const h = def.colorHues
            ? def.colorHues[i]
            : def.hue;
          return hslToHex(
            ((h + hueOffset) % 360 + 360) % 360,
            Math.max(0, Math.min(100, def.saturation + satOffset)),
            l,
          );
        }),
  }));
}

/**
 * The no-print marker: a construction mark that shapes the artwork but never
 * renders.
 *
 * Painted like any other colour and stored in the same slot, so it rides
 * `ProjectSnapshot`, undo/redo and the project file with no new field. What it
 * buys is a *distinct colour that happens to be invisible*: dropping one beside
 * a region raises the boundary-vertex degree there, and `roundRing` only rounds a
 * vertex where exactly two boundary edges meet — so the corner stays sharp. That
 * is the kink. Erasing a cell cannot do the same thing: an empty cell removes
 * edges, a marker adds a differently-coloured one.
 *
 * **Deliberately not a palette value.** It has no comma, so `decodeColor`
 * rejects it, and no `|`, so `isHatchValue` does too. Nearly every renderer and
 * exporter already skips what `decodeColor` cannot read, so this direction makes
 * them skip the marker for free and leaves exactly one place — the degree count
 * in `round-corners.ts` — that has to be taught to let it in. A reserved palette
 * index would have inverted that: every one of a dozen sites would have needed a
 * guard, and forgetting one would leak the marker into a cut file rather than
 * merely losing a kink.
 */
export const NO_PRINT = "noprint";

export const isNoPrint = (value: string): boolean => value === NO_PRINT;

export function encodeColor(paletteIdx: number, colorIdx: number): string {
  return `${paletteIdx},${colorIdx}`;
}

export function decodeColor(
  encoded: string,
): { paletteIdx: number; colorIdx: number } | null {
  const parts = encoded.split(",");
  if (parts.length !== 2) return null;
  const p = Number(parts[0]);
  const i = Number(parts[1]);
  if (isNaN(p) || isNaN(i)) return null;
  return { paletteIdx: p, colorIdx: i };
}

export function resolveColor(encoded: string): string {
  const d = decodeColor(encoded);
  if (d && PALETTE_DEFS[d.paletteIdx]) {
    const def = PALETTE_DEFS[d.paletteIdx];
    const fixedHex = def.hexes?.[d.colorIdx];
    if (fixedHex !== undefined) return fixedHex;
    const lightnesses = def.lightnesses ?? PALETTE_LIGHTNESSES;
    const l = lightnesses[d.colorIdx];
    if (l === undefined) return encoded;
    const h = def.colorHues
      ? def.colorHues[d.colorIdx]
      : def.hue;
    return hslToHex(
      ((h + _hueOffset) % 360 + 360) % 360,
      Math.max(0, Math.min(100, def.saturation + _satOffset)),
      l,
    );
  }
  return encoded;
}

export function remapGrid(
  painted: Record<string, string>,
  direction: 1 | -1,
): Record<string, string> {
  const L = COLOR_COUNT;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(painted)) {
    // Routed through `mapEncodedColor` so hatch marks shift the colour inside
    // themselves. Without it the arrow keys are silently inert on a hatch
    // layer — safe, but it reads as a bug.
    result[key] = mapEncodedColor(value, (c) => {
      const d = decodeColor(c);
      if (!d) return c;
      return encodeColor(d.paletteIdx, (((d.colorIdx + direction) % L) + L) % L);
    });
  }
  return result;
}

export function dodgeColor(encoded: string): string {
  const d = decodeColor(encoded);
  if (!d) return encoded;
  if (d.colorIdx >= COLOR_COUNT - 1) return encoded;
  return encodeColor(d.paletteIdx, d.colorIdx + 1);
}

export function burnColor(encoded: string): string {
  const d = decodeColor(encoded);
  if (!d) return encoded;
  if (d.colorIdx <= 0) return encoded;
  return encodeColor(d.paletteIdx, d.colorIdx - 1);
}

export function shiftGridPalettes(
  painted: Record<string, string>,
  direction: 1 | -1,
  paletteCount: number,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(painted)) {
    result[key] = mapEncodedColor(value, (c) => {
      const d = decodeColor(c);
      if (!d) return c;
      const newPalette =
        (((d.paletteIdx + direction) % paletteCount) + paletteCount) %
        paletteCount;
      return encodeColor(newPalette, d.colorIdx);
    });
  }
  return result;
}
