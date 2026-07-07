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
    name: "Usonian",
    colors: [
      "#4a1818",
      "#5c4018",
      "#304020",
      "#984830",
      "#b08830",
      "#688040",
      "#d07858",
      "#d8c060",
      "#a0b070",
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
    name: "Spice Rack",
    colors: [
      "#4a2410",
      "#644810",
      "#602010",
      "#884828",
      "#a07820",
      "#a04020",
      "#c47848",
      "#d0b048",
      "#d06840",
    ],
  },
  {
    name: "Cosmo",
    colors: [
      "#381020",
      "#504420",
      "#142440",
      "#883040",
      "#b89848",
      "#2c4c78",
      "#c88890",
      "#e8d898",
      "#5080b0",
    ],
  },
  {
    name: "Country",
    colors: [
      "#4c1c1c",
      "#102838",
      "#584830",
      "#884438",
      "#1c6870",
      "#a89050",
      "#c07060",
      "#4898a0",
      "#e0d098",
    ],
  },
  {
    name: "Harvest",
    colors: [
      "#2a1608",
      "#5c2010",
      "#8c3018",
      "#b84c14",
      "#d47018",
      "#c49a28",
      "#d4b440",
      "#c8b870",
      "#d8cca0",
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
  {
    name: "Seaside",
    colors: [
      "#102040",
      "#883040",
      "#786840",
      "#205080",
      "#b86058",
      "#b09860",
      "#4088b0",
      "#d89088",
      "#e0d0a0",
    ],
  },
  {
    name: "Matchbox",
    colors: [
      "#4a2018",
      "#584810",
      "#1a3838",
      "#a04030",
      "#b09020",
      "#306868",
      "#c87858",
      "#d8c058",
      "#68a098",
    ],
  },
  {
    name: "Winter",
    colors: [
      "#103048",
      "#102818",
      "#607888",
      "#2088b0",
      "#286840",
      "#a0b8c0",
      "#60c8e0",
      "#58a070",
      "#e0ece8",
    ],
  },
  {
    name: "Thai",
    colors: [
      "#183838",
      "#581018",
      "#584010",
      "#508038",
      "#b83820",
      "#b08820",
      "#a8c860",
      "#e07058",
      "#e0c048",
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
