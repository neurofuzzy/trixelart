function hslToHex(h: number, s: number, l: number): string {
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
    colors: PALETTE_LIGHTNESSES.map((l) =>
      hslToHex(
        ((def.hue + hueOffset) % 360 + 360) % 360,
        Math.max(0, Math.min(100, def.saturation + satOffset)),
        l,
      ),
    ),
  }));
}

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
    const l = PALETTE_LIGHTNESSES[d.colorIdx];
    if (l === undefined) return encoded;
    return hslToHex(
      ((def.hue + _hueOffset) % 360 + 360) % 360,
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
    const d = decodeColor(value);
    if (d) {
      const newIdx = (((d.colorIdx + direction) % L) + L) % L;
      result[key] = encodeColor(d.paletteIdx, newIdx);
    } else {
      result[key] = value;
    }
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
    const d = decodeColor(value);
    if (d) {
      const newPalette =
        (((d.paletteIdx + direction) % paletteCount) + paletteCount) %
        paletteCount;
      result[key] = encodeColor(newPalette, d.colorIdx);
    } else {
      result[key] = value;
    }
  }
  return result;
}
