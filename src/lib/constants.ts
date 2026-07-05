export const GRAYSCALE_PALETTE = [
  "#000000",
  "#202020",
  "#404040",
  "#606060",
  "#808080",
  "#a0a0a0",
  "#c0c0c0",
  "#dfdfdf",
  "#ffffff",
];

export const PALETTES = [
  {
    name: "Grayscale",
    colors: GRAYSCALE_PALETTE,
  },
  {
    name: "Earth",
    colors: [
      "#2c1810",
      "#4c2d1b",
      "#6b4226",
      "#7b561d",
      "#8b6914",
      "#a88737",
      "#c4a45a",
      "#ddc187",
      "#f5deb3",
    ],
  },
  {
    name: "Ocean",
    colors: [
      "#0a192f",
      "#112a47",
      "#173a5e",
      "#236085",
      "#2e86ab",
      "#46a3c2",
      "#5ebfd9",
      "#94d8e9",
      "#caf0f8",
    ],
  },
  {
    name: "Sunset",
    colors: [
      "#2d1b2e",
      "#5c1f40",
      "#8b2252",
      "#b63a56",
      "#e0525a",
      "#e86f52",
      "#f08c4a",
      "#f6ae6b",
      "#fcd08b",
    ],
  },
  {
    name: "Forest",
    colors: [
      "#0b1f0f",
      "#15351e",
      "#1e4a2c",
      "#2e6235",
      "#3d7a3e",
      "#548c44",
      "#6a9e4a",
      "#98bb71",
      "#c5d898",
    ],
  },
  {
    name: "Berry",
    colors: [
      "#1a0a2e",
      "#321238",
      "#4a1942",
      "#6a2555",
      "#893168",
      "#ac4f7a",
      "#ce6d8b",
      "#e39fac",
      "#f7d1cd",
    ],
  },
];

export function encodeColor(paletteIdx: number, colorIdx: number): string {
  return `${paletteIdx},${colorIdx}`;
}

export function decodeColor(encoded: string): { paletteIdx: number; colorIdx: number } | null {
  const parts = encoded.split(",");
  if (parts.length !== 2) return null;
  const p = Number(parts[0]);
  const i = Number(parts[1]);
  if (isNaN(p) || isNaN(i)) return null;
  return { paletteIdx: p, colorIdx: i };
}

export function resolveColor(encoded: string): string {
  const d = decodeColor(encoded);
  if (d && PALETTES[d.paletteIdx] && PALETTES[d.paletteIdx].colors[d.colorIdx]) {
    return PALETTES[d.paletteIdx].colors[d.colorIdx];
  }
  return encoded;
}

export function remapGrid(
  painted: Record<string, string>,
  direction: 1 | -1,
): Record<string, string> {
  const L = PALETTES[0].colors.length;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(painted)) {
    const d = decodeColor(value);
    if (d) {
      const newIdx = ((d.colorIdx + direction) % L + L) % L;
      result[key] = encodeColor(d.paletteIdx, newIdx);
    } else {
      result[key] = value;
    }
  }
  return result;
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
      const newPalette = ((d.paletteIdx + direction) % paletteCount + paletteCount) % paletteCount;
      result[key] = encodeColor(newPalette, d.colorIdx);
    } else {
      result[key] = value;
    }
  }
  return result;
}
