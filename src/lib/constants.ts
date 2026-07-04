export const GRAYSCALE_PALETTE = [
  "#000000",
  "#404040",
  "#808080",
  "#c0c0c0",
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
      "#6b4226",
      "#8b6914",
      "#c4a45a",
      "#f5deb3",
    ],
  },
  {
    name: "Ocean",
    colors: [
      "#0a192f",
      "#173a5e",
      "#2e86ab",
      "#5ebfd9",
      "#caf0f8",
    ],
  },
  {
    name: "Sunset",
    colors: [
      "#2d1b2e",
      "#8b2252",
      "#e0525a",
      "#f08c4a",
      "#fcd08b",
    ],
  },
  {
    name: "Forest",
    colors: [
      "#0b1f0f",
      "#1e4a2c",
      "#3d7a3e",
      "#6a9e4a",
      "#c5d898",
    ],
  },
  {
    name: "Berry",
    colors: [
      "#1a0a2e",
      "#4a1942",
      "#893168",
      "#ce6d8b",
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
  paletteIdx: number,
  direction: 1 | -1,
): Record<string, string> {
  const L = PALETTES[paletteIdx]?.colors.length ?? 5;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(painted)) {
    const d = decodeColor(value);
    if (d && d.paletteIdx === paletteIdx) {
      const newIdx = ((d.colorIdx + direction) % L + L) % L;
      result[key] = encodeColor(paletteIdx, newIdx);
    } else {
      result[key] = value;
    }
  }
  return result;
}
