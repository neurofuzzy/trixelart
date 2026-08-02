# Hatch layers

## Context

Trixelart layers are all one thing: a `Record<triKey, encodedColor>` of filled triangles. There is
no way to draw line work — the shading vocabulary is "pick a lighter swatch", which is why the
palettes carry nine lightnesses.

This adds a **second layer kind** that holds linear hatching instead of fills: parallel strokes
running along the three primary directions of the trixel lattice, brushed on like paint, with
controllable density. A hatch layer sits in the normal layer stack, so hatching composites over
fills the way an inker works over flats.

### Decisions already made
- Direction, density, weight and colour are **per-stroke, stored per trixel**. Direction is a
  **3-bit mask**, so one trixel can hold two or three angles — cross-hatching needs no extra layer.
- Hatch **renders into PNG and SVG exports** (both the whole-artwork dialog and the crop drawer).
  Not into 3D-print or cutting exports — those consume solid regions, where hatch lines have no
  meaning.
- Selecting a hatch layer **auto-switches to the hatch tool** and **disables the fill tools**.
  Erase stays enabled on both kinds.

---

## The three directions

Read straight off the grid families `GridCanvas.tsx:170-203` and reduced to closed form. Each
family is the level set of one linear function `u`:

| Family | `u` | grid lines at | direction |
|---|---|---|---|
| 0 — horizontal | `y` | `u = n·H` | `(1, 0)` — 0° |
| 1 — `/` | `x − y·SIDE/(2H)` | `u = n·SIDE` | `(SIDE/2, H)` — 60° |
| 2 — `\` | `x + y·SIDE/(2H)` | `u = n·SIDE` | `(−SIDE/2, H)` — 120° |

Derivations (all verified against the drawing code):

- **Family 1** draws, for fixed `q`, the points `(q·SIDE + r·SIDE/2, r·H)`. Substituting `r = y/H`
  gives `x = q·SIDE + y·SIDE/(2H)`, so `x − y·SIDE/(2H) = q·SIDE`.
- **Family 2** draws, for fixed `S = q+r`, `x = q·SIDE + (S−q)·SIDE/2 + SIDE`, `y = (S−q)·H`.
  With `m = S−q = y/H`: `x = S·SIDE − m·SIDE/2 + SIDE`, so `x + y·SIDE/(2H) = (S+1)·SIDE`.

**All three have perpendicular spacing exactly `H`.** For family 1, `|∇u| = √(1 + (SIDE/2H)²)`;
`SIDE/(2H) = 1/√3`, so `|∇u| = 2/√3` and the perpendicular spacing is `SIDE·√3/2 = H`. Family 2 is
the mirror image; family 0 is `H` by inspection.

So **density `k` means perpendicular spacing `H/k`** — step `u` by `H/k` for family 0 and by
`SIDE/k` for families 1 and 2. At `k = 1` the hatch lands exactly on the grid lines, which is the
right zero point for the control.

`u` is a pure function of world position, so the line field is **global**: trixels hatched in
separate strokes line up as continuous lines rather than per-triangle tufts. Same reasoning as the
pattern brush; getting this wrong is the obvious failure mode.

---

## Data model

`Layer` gains an optional discriminator; **absent means `"fill"`**, so every saved document,
exported JSON and history snapshot keeps working with no migration code:

```ts
// src/hooks/use-history.ts
export interface Layer {
  id: string;
  name: string;
  kind?: "fill" | "hatch";   // absent ⇒ "fill"
  painted: Record<string, string>;
  visible: boolean;
}
```

Hatch marks live in the **same `painted` map**, encoded as a string:

```
"dirMask|density|weight|paletteIdx,colorIdx"      e.g. "5|3|2|0,8"
 dirMask  1=horizontal  2=/  4=\   (5 = horizontal + \)
 density  1..8          spacing H/density
 weight   world units, 0.5..8
```

Reusing `painted` is what makes this cheap: `setPainted`, the undo stack, `trixel-save`, the
project JSON, layer duplicate/delete/reorder and visibility all work unchanged.

**The pipes are load-bearing.** A fill value is `"p,c"` — exactly one comma, no pipes — so a hatch
value is structurally distinguishable, and every existing decode site already rejects it:
`decodeColor` (`constants.ts`) splits on `,`, gets `["5|3|2|0", "8"]`, and `Number("5|3|2|0")` is
`NaN` → returns `null`. Verified that `remapGrid`, `shiftGridPalettes`, `remapHex` and
`shiftHexPalettes` all guard on exactly that and pass unknown values through untouched. So the
arrow-key palette shifts are **already** safe no-ops on hatch data rather than corrupting it.

---

## Files

### New

| File | Purpose |
|---|---|
| `src/lib/hatch.ts` | `HatchBrush`, `encodeHatch`/`decodeHatch`, the three families, `hatchLinesInBox`, `clipSegmentToTriangle`, `groupHatchMarks`. Pure, no DOM |
| `src/lib/hatch-render.ts` | `drawHatchLayer(ctx, marks, bounds)` for canvas (GridCanvas + PNG export) and `hatchSegments(marks, clipRect?)` for SVG |
| `src/lib/tools/hatch-tool.ts` | `makeEditTool`-based brush |
| `src/components/HatchPanel.tsx` | Right-hand drawer: direction toggles, density, weight, colour, preview |

### Modified

| File | Change |
|---|---|
| `src/hooks/use-history.ts` | `Layer.kind`; `addLayer(kind?)`; `duplicateLayer` copies `kind` |
| `src/components/TrixelGrid.tsx` | `mergedPainted` filters to fill layers; hatch-brush state + persistence; active-layer-kind effect; pass `layers` to the two exporters |
| `src/components/GridCanvas.tsx` | Branch the per-layer render loop on `kind` |
| `src/components/LayerPanel.tsx` | Add-fill / add-hatch split; per-row kind icon |
| `src/components/Toolbar.tsx` | Hatch tool button; disable the fill tools on a hatch layer and the hatch tool on a fill layer |
| `src/lib/tools/types.ts` | `"hatch"` in `Tool`; `hatchBrush` in `ToolContext` |
| `src/lib/tools/index.ts` | Register `hatch: hatchTool` |
| `src/lib/tools/edit-tool.ts` | Generalize the `toggle` option (see below) |
| `src/lib/svg-export.ts` | `generateSVG` / `generateCroppedSVG` take `layers` |
| `src/lib/png-export.ts` | `renderCropToCanvas` / `renderCropPreview` take `layers` |
| `src/components/ExportDialog.tsx`, `ExportPanel.tsx` | Pass `layers` instead of `painted` |
| `src/hooks/use-interaction.ts` | Thread `hatchBrush` into `ctx` |
| `src/hooks/use-keyboard-shortcuts.ts` | `G` → hatch; guard the `1`–`9` auto-switch |
| `src/lib/constants.ts` | Make `remapGrid`/`shiftGridPalettes` hatch-aware (see below) |

---

## Implementation

### 1. `src/lib/hatch.ts`

```ts
export interface HatchBrush { dirMask: number; density: number; weight: number; color: string }
export const HATCH_DIRS = [0, 1, 2] as const;

export function hatchU(dir: 0 | 1 | 2, x: number, y: number): number;   // table above
export function hatchStep(dir: 0 | 1 | 2, density: number): number;     // H/k or SIDE/k
export function hatchLinesInBox(dir, density, box): Array<[Pt, Pt]>;
export function clipSegmentToTriangle(p0, p1, tri: TriKey): [Pt, Pt] | null;
export function groupHatchMarks(marks): Map<string, { dir; density; weight; color; tris: TriKey[] }>;
```

- `hatchLinesInBox`: evaluate `u` at the four box corners, take min/max, walk `n` from
  `ceil(uMin/step)` to `floor(uMax/step)`, and for each `u` parameterise the line across the box —
  by `x` for family 0, by `y` for families 1 and 2 (`x = u ± y·SIDE/(2H)`).
- `clipSegmentToTriangle`: parametric clip against the triangle's three half-planes, narrowing a
  `[t0, t1]` range. **Derive each half-plane's inside sign from the third vertex** — do not assume a
  winding. `getTriVertices` returns *opposite* windings for the two triangle types: computing the
  signed area in screen space (y-down) gives `+H·SIDE` for `up` and `−H·SIDE` for `down`. That is
  why `svg-export.ts` carries `ensureCW`, and a clipper that assumed one winding would silently
  keep the outside half of every `down` triangle.
- `groupHatchMarks` expands the `dirMask` into individual directions, so a cross-hatched trixel
  appears in two or three groups.

### 2. Rendering — one shape, two backends

For each group `(dir, density, weight, colour)`:

- **Canvas** (`GridCanvas`, PNG export): build one path from the group's triangles, `ctx.clip()`,
  then stroke the whole line family across the clip bounds. One clip + one stroke per group, not
  per triangle — and the shared clip is what makes the lines continuous across trixel boundaries.
- **SVG**: clip each family line to each triangle with `clipSegmentToTriangle` and emit `<line>`
  elements. Consistent with the project's existing refusal to use `<clipPath>` (see the crop
  exporter); collinear segments from adjacent triangles abut exactly, so they read as one line.

`GridCanvas`'s loop becomes:

```ts
for (const layer of layers) {
  if (!layer.visible) continue;
  if ((layer.kind ?? "fill") === "hatch") drawHatchLayer(ctx, layer.painted, worldBounds);
  else { /* existing colour-grouped fill */ }
}
```

### 3. The tool

`makeEditTool` (`edit-tool.ts`) already supplies everything: shift-click lines, stroke sampling via
`getTrianglesOnLine`, `ctx.brushExpand` for brush size / flower / symmetry, the visited set, the
StrictMode-pure updater discipline, and `ctx.onCommit()` on pointer-up. The hatch tool is a keyOp:

```ts
export const hatchTool = makeEditTool(
  (next, k, ctx) => {
    const v = encodeHatch(ctx.hatchBrush);   // precomputed, pure
    if (next[k] === v) return false;
    next[k] = v;
    return true;
  },
  { toggle: true },
);
```

One change is needed in `edit-tool.ts`: the `toggle` branch (`edit-tool.ts:147-157`) decides
"clicking the same thing clears it" by comparing `resolveColor(prev[k])` to `resolveColor(ctx.color)`
— fill-specific. Replace the hard-coded comparison with an optional predicate:

```ts
interface EditToolOpts {
  dedup?: boolean;
  toggle?: boolean;
  /** Defaults to the resolved-colour comparison, so paint is unchanged. */
  sameAsBrush?: (existing: string | undefined, ctx: ToolContext) => boolean;
}
```

Hatch passes `sameAsBrush: (e, ctx) => e === encodeHatch(ctx.hatchBrush)`.

`eraseTool` needs **no change** — it deletes keys without inspecting values, so it already works on
hatch layers.

### 4. Layer-kind lock-out

A derived value plus one effect in `TrixelGrid`, keyed on the *kind* rather than on `layers` so it
does not re-fire on every stroke:

```ts
const activeLayerKind = layers[activeLayerIdx]?.kind ?? "fill";

useEffect(() => {
  setTool((t) => {
    if (activeLayerKind === "hatch") return HATCH_LAYER_TOOLS.has(t) ? t : "hatch";
    return t === "hatch" ? "paint" : t;
  });
}, [activeLayerKind]);
```

`HATCH_LAYER_TOOLS = { hatch, erase, pan, crop }`. Because it keys off the active layer's kind, it
fires correctly for layer selection, undo/redo restore, project load and new-project alike — no
per-call-site wiring.

`Toolbar` takes `activeLayerKind` and disables the fill tools when it is `"hatch"`, and the hatch
tool when it is `"fill"`.

**Locked set** — the user named paint, fill, pattern, stamp, clone, dodge and burn. I am adding
**eyedropper** and **select**, which they did not name, because both are colour-semantic:
eyedropper would load a hatch string in as a paint colour, and select's rotate/flip move marks
between keys *without* rotating their direction masks, which silently produces wrong hatching.
Rotating a hatch selection properly (permuting the mask alongside the geometry) is a real feature
but is **out of scope here**; locking select is the honest interim.

`use-keyboard-shortcuts.ts`: `1`–`9` currently sets a colour index and forces `setTool("paint")`.
On a hatch layer it should set the **hatch** colour and not switch tools.

### 5. Palette shifts

`remapGrid` / `shiftGridPalettes` already pass hatch values through untouched, so nothing breaks —
but the arrow keys doing nothing on a hatch layer reads as a bug. Teach both (and the `remapHex` /
`shiftHexPalettes` pair) to decode a hatch value, shift the colour inside it, and re-encode. About
six lines each, and it makes the layer feel like a first-class citizen.

### 6. Export integration

`mergedPainted` filters to fill layers:

```ts
for (const layer of layers) {
  if (!layer.visible || (layer.kind ?? "fill") === "hatch") continue;
  Object.assign(out, layer.painted);
}
```

That single line protects `Export3DDialog` and `CutExportDialog` for free — both take
`mergedPainted` and nothing else. (`cut-export.ts:55 flattenPainted` is exported but never called;
leave it alone or delete it, but do not wire hatch through it.)

For PNG and SVG the exporters need z-order, so they take `layers` and walk it bottom-to-top,
drawing fills and hatches in sequence:

- `generateSVG(layers, options)` and `generateCroppedSVG(layers, crop, gridRotation, options)`
- `renderCropToCanvas(canvas, layers, crop, pxW, pxH, bgHex, gridRotation)` and `renderCropPreview(...)`

Internally each keeps using `generateTriangles(painted)` per fill layer, so the existing
merge-by-colour and Sutherland–Hodgman clipping paths are untouched. **Merge-by-colour must stay
per-layer** rather than across the whole stack, or a hatch layer sandwiched between two fill layers
would be composited out of order.

One trap in the whole-artwork exporter: `generateSVG` sizes the document from
`computeBounds(triangles)` and short-circuits on `triangles.length === 0` (`svg-export.ts:193-197`).
Hatch trixels must contribute to those bounds, or a document whose artwork is entirely hatch
exports as the empty 100×100 placeholder.

### 7. Layer creation

`addLayer` takes an optional kind; `LayerPanel`'s `+` becomes two entries (a small dropdown or a
pair of buttons) — "Fill layer" and "Hatch layer" — and each row shows a kind icon so the two are
distinguishable at a glance. `duplicateLayer` must carry `kind` across; it currently spreads
`makeLayer(...)` over the source, so the new field needs adding explicitly.

**Keep the shared `Layer N` numbering for both kinds.** `addLayer` derives the next number by
`parseInt(l.name.replace("Layer ", ""))` (`use-history.ts:172`); naming hatch layers `Hatch 1` makes
that parse yield `0`, and the next fill layer then collides on a name already in use.

### 8. `HatchPanel`

Model on `ExportPanel` — the `w-96` right-hand drawer shell, `p-4`/`gap-3`, `text-xs` labels,
`text-sm` values, 16px icons — so it matches the scale the pattern and export drawers now share.

Three direction toggles (multi-select, showing `—`, `/`, `\`), a density slider (1–8, labelled so
1 reads as "grid spacing"), a weight slider, and a colour swatch opening the existing
`ColorPickerDialog`. A live preview canvas showing a patch of hatched trixels — the reason to
preview is that density interacts with weight, and neither is legible from the numbers alone.

Rendered from `TrixelGrid` alongside the other drawers: `{tool === "hatch" && <HatchPanel … />}`.
Brush settings are view state → `trixel-settings`, **not** `ProjectSnapshot` (same split as the crop
rect); remember the settings object **and** the dependency array of the effect that writes it.

---

## Verification

1. `npm run typecheck` then `npm run lint` (in that order — `npm run build` gates neither).
2. `npm run dev` (port 9002). Add a hatch layer from the layer panel; confirm the tool auto-switches
   to hatch and the fill tools grey out. Select the fill layer again; confirm it switches back.
3. **Continuity** — brush two separate strokes into adjacent trixels at the same density. The lines
   must run straight through the shared edge with no jog or doubling. This is the one that catches a
   per-triangle line field.
4. **Density** — at `k = 1` the hatch must sit exactly on top of the grid lines in all three
   directions. At `k = 2` one line falls halfway between each pair.
5. **Cross-hatch** — enable two directions, brush, confirm both render on the same trixel; enable a
   third and confirm all three.
6. **Undo** — one stroke, one `Ctrl+Z`. Then undo across a layer add.
7. **Erase** — the erase tool clears hatch marks on a hatch layer.
8. **Round trip** — reload the page (`trixel-save`), then Save Project → New Project → Load Project.
   Layer kinds, marks and brush settings all survive. Load an *older* project JSON with no `kind`
   field and confirm every layer comes back as a fill layer.
9. **Exports** — hatch appears in the crop PNG, the crop SVG and the whole-artwork SVG, in the right
   z-order relative to fills. Open the SVG in Inkscape: hatch is real `<line>` elements clipped to
   their triangles, nothing spilling outside. Confirm 3D-print and cutting exports ignore hatch
   layers entirely rather than choking on the encoded strings.
10. **Pointy-top** — switch orientation in Grid Settings and repeat 3 and 9; the hatch must rotate
    with the lattice and the SVG must stay oriented as seen on screen.
11. **Palette shift** — `←`/`→`/`↑`/`↓` on a hatch layer shifts the hatch colours and leaves
    direction, density and weight intact.
