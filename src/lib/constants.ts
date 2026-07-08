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
    name: "Sand",
    colors: [
      "#14100a",
      "#282018",
      "#3c3024",
      "#504430",
      "#645840",
      "#7c7054",
      "#988c6c",
      "#b4a888",
      "#d4c8a8",
    ],
  },
  {
    name: "Oxide",
    colors: [
      "#1c0802",
      "#3b1006",
      "#5c1a0c",
      "#7e2814",
      "#a13820",
      "#c44c30",
      "#da6848",
      "#e8906e",
      "#f4bca0",
    ],
  },
  {
    name: "Sienna",
    colors: [
      "#1a0e02",
      "#381c06",
      "#582c0c",
      "#784014",
      "#98561e",
      "#b8702c",
      "#d08c40",
      "#e4ac60",
      "#f0cc90",
    ],
  },
  {
    name: "Mustard",
    colors: [
      "#1a1400",
      "#332a02",
      "#4d4006",
      "#66580c",
      "#807014",
      "#9a8c20",
      "#b4a830",
      "#cec648",
      "#e8e468",
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
    name: "Mint",
    colors: [
      "#0a1a18",
      "#0f332e",
      "#164d44",
      "#1e685c",
      "#288474",
      "#36a08c",
      "#4cbca4",
      "#6cd4bc",
      "#90ecd4",
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
    name: "Violets",
    colors: [
      "#10051e",
      "#1e0d38",
      "#2e1852",
      "#40256e",
      "#54348a",
      "#6c48a6",
      "#8864be",
      "#a888d4",
      "#ccb0e8",
    ],
  },
  {
    name: "Elderberry",
    colors: [
      "#1e0410",
      "#380a1e",
      "#521230",
      "#6c1e44",
      "#862e5a",
      "#a04474",
      "#b8608e",
      "#ce84aa",
      "#e4b0c8",
    ],
  },
];

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
  if (
    d &&
    PALETTES[d.paletteIdx] &&
    PALETTES[d.paletteIdx].colors[d.colorIdx]
  ) {
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
  const colors = PALETTES[d.paletteIdx]?.colors ?? PALETTES[0].colors;
  if (d.colorIdx >= colors.length - 1) return encoded;
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
