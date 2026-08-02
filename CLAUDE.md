# AGENTS.md

> See `CODEMAP.md` for an auto-generated source map of all modules and exports. Run `npm run map` to regenerate.

## Quick start

```bash
npm run dev      # next dev --turbopack -p 9002
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src/
```

Validate order: `typecheck` → `lint`. `npm run build` ignores TS/ESLint errors (`next.config.ts`) so is not a reliable correctness gate.

No tests configured.

** DO NOT COMMIT CHANGES TO GIT! USER WILL DO SO MANUALLY **

## Architecture

- **Next.js 15** App Router, React 19, TypeScript, Tailwind CSS v3, shadcn/ui (button, alert-dialog)
- Single-page triangular grid drawing tool. Entrypoint: `src/app/page.tsx` → `src/components/TrixelGrid.tsx`
- Path alias `@/*` → `./src/*` (tsconfig paths)
- Dark mode only (`<html className="dark">`). Theme via CSS variables in `src/app/globals.css`
- State: React `useState` (no external state lib)
- Undo/redo: manual history stack capped at 50 entries in `useHistory` hook
  - **GOLDEN RULE**: Every editing action that modifies `painted` state MUST push a `ProjectSnapshot` to history via `pushHistory()` so it is undoable. This includes paint strokes, erase strokes, move-tool translations, stamp placement, palette remapping (`onShiftUp`/`onShiftDown`), selection deletion, pattern-brush strokes, pattern-preset capture/delete, and any future editing features. Missing a `pushHistory` call means the user cannot undo that action.
  - Tools do not call `pushHistory` directly — they call `ctx.onCommit()`, which bumps a counter that an effect turns into one `pushHistory(buildSnapshot())`. Pushing from inside a `setPainted` updater would double-fire under StrictMode and desync `historyIdx`. Commit **once per stroke**, on pointer-up, not per cell.

## Canvas rendering

- `GridCanvas` uses a `<canvas>` element with DPR scaling (not SVG)
- Triangles are batch-filled by color, grid outlines batched into single stroke
- `getTriVertices(q, r, type)` returns raw vertices; `getTriPath` wraps them into an SVG path string

## Tools

Each tool is a `ToolHandler` (`onDown`/`onMove`/`onUp`) in `src/lib/tools/`, registered in `toolMap` and dispatched by `use-interaction.ts`. Adding a tool means touching `Tool` in `tools/types.ts`, `toolMap`, `editTools` **and `isEditTool`** in `Toolbar.tsx`, the `hoverTargets` guard in `use-interaction.ts`, and `use-keyboard-shortcuts.ts`. Tools that don't paint (`select`, `crop`) get their own button in the `data-tour="effects"` group instead and stay out of both `editTools` and `isEditTool`.

| Tool | Shortcut | Description |
|---|---|---|
| Paint | `P` | Paint triangles with selected color |
| Erase | `E` | Erase (clear) triangles |
| Fill | `F` | Edge-connected flood fill (`computeFillRegion`), bounded by `FILL_MAX_RADIUS` or clipped to the hex selection |
| Pattern | `N` | Procedural pattern brush; paints whole hexes. See "Pattern brush" |
| Hatch | `G` | Line-work brush; only on a hatch layer. See "Hatch layers" |
| Dodge / Burn | `D` / `B` | Step the palette index lighter/darker |
| Clone | `C` | Clone-stamp from a captured source |
| Eyedropper | `I` | Pick a painted color |
| Pan | `H` | Drag to translate painted trixels (grid offset); right-click pans view |
| Select | `S` | Click a hex to select it; captures all painted trixels inside as a snapshot |
| Stamp | `T` | Alt-click a hex to define stamp source (yellow flash); click to stamp (right-click erases); `+` button in palette to enter capture mode |
| Crop | `X` | Drag handles to set the export region. See "Crop & export" |

- **Colors are stored encoded**, not as hex: `"paletteIdx,colorIdx"` via `encodeColor`, resolved through `resolveColor` (`src/lib/constants.ts`). `PALETTE_DEFS` holds 14 HSL-derived palettes × 9 lightnesses, shifted globally by `hueOffset`/`satOffset`. Painted data therefore follows palette changes automatically — compare encoded values, not resolved hex, when testing swatch identity (separate palettes can resolve to the same color).
- Right-click on a painted triangle acts as a color picker (eyedropper)
- Clicking a triangle with the same color clears it (except during drag)
- Stroke painting: `getTrianglesOnLine` samples along pointer moves for continuous strokes
- **`setPainted` updaters must be pure** — React StrictMode replays them. Precompute the keys/colors outside the updater (see `edit-tool.ts` and `pattern-tool.ts`)

## Keyboard shortcuts

| Key | Action |
|---|---|
| `P` | Paint tool |
| `E` | Erase tool |
| `H` | Pan tool |
| `S` | Select tool |
| `T` | Stamp tool |
| `F` | Fill tool |
| `N` | Pattern brush |
| `G` | Hatch brush (hatch layers only) |
| `D` / `B` | Dodge / Burn |
| `C` | Clone |
| `I` | Eyedropper |
| `X` | Crop & export |
| `R` | Switch to Select and rotate selection 60° CW |
| `Shift+R` | Switch to Select and rotate selection 60° CCW |
| `1`–`9` | Select color + switch to Paint |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `↑` | Shift colors lighter (selection palette: per-hex; else: whole grid) |
| `↓` | Shift colors darker |
| `←` | Shift palettes of each trixel backward (does not change current palette) |
| `→` | Shift palettes of each trixel forward (does not change current palette) |
| `Escape` | Clear selection |
| `Delete` / `Backspace` | Erase selected hex contents |

Shortcuts suppressed when focus is in `<input>` or `<textarea>` (except `Escape` and undo/redo).

## Zoom & touch

- Mouse wheel zoom with configurable `WHEEL_DIVISOR`; clamped by `ZOOM_MIN`/`ZOOM_MAX`
- Touch pinch-to-zoom with `PINCH_SENSITIVITY`; two-finger gestures suppress pointer handlers
- Constants in `src/lib/config.ts`: `ZOOM_MIN=0.25`, `ZOOM_MAX=2`, `WHEEL_DIVISOR=100`, `PINCH_SENSITIVITY=2.5`, `FILL_MAX_RADIUS=24`
- Viewport meta tag disables browser zoom on mobile (`RootLayout`)

## Hex grid system

- **HexMode**: `"off"` | `"outlines"` | `"centers"` — set via Grid Settings modal (Hex button in Footer)
  - `off`: no hex rendering
  - `outlines`: flat-top honeycomb grid outlines
  - `centers`: outlines + center marker dots
- **Grid divisions** (N): controls hex lattice spacing; slider in Grid Settings modal. When `N>0`, draws division guides (horizontal, `/`, `\` diagonals)
- **Flower radius** (R): hexagonal flower of trixels around a painted tri, cycled in Footer (disabled when `gridDivisions=0`)
- **Symmetry**: `"off"` | `"sym60"` | `"sym120"` — rotational symmetry for painting, cycled in Footer
  - `sym60`: 6-fold (60°) rotation
  - `sym120`: 3-fold (120°) rotation
  - `paintTargets()` in `hex-flower.ts` expands painted trixels into symmetry+flower copies
- **Selection snapshots**: capture all painted trixels within a selected hex; stored in `SelectionPalette` for stamping
  - `SelectionSnapshot { id, N, c, k, trixels: [{ dq, dr, type, color }] }`
  - `captureHexSnapshot(painted, c, k, N)` captures a stencil
  - `hexTranslation(sc, sk, dc, dk, N)` maps trixel offsets from source hex to destination hex
  - `enumerateHexTrixels(c, k, N)` returns all trixels in a hex (6N² triangles)

## Pattern brush

Ported from the `prismatic` cap mapping in the sibling **material-forge** repo. The two grids are *the same lattice*: `worldToTri` performs exactly the skew that shader's `mfTriCell` does, and `triCenter` already returns what `mfTriPos(mfTriCentroid(...))` computes — so the port was mostly reuse.

**How it works.** Each trixel's centroid is rotated, scaled, and re-quantized through `worldToTri`; the resulting cell's up/down parity is the pattern value. That is the whole predicate. The interest is emergent: above `scale = 1` the pattern lattice is finer than the trixel lattice, so each trixel point-samples a denser field and the two beat against each other. `scale 2.6 / rotation 235` gives interlocking hexagons.

Load-bearing consequences — all three were tried the other way and reverted:

- **Rotation is continuous and `scale` runs past 1.** Snapping the angle to the lattice's 6-fold symmetry, or capping the scale, makes the entire emergent family unreachable. The aliasing is the feature.
- **Sampling is at the centroid.** The patterns are aliasing artifacts, so the sample position is load-bearing, not incidental.
- **Values are a pure function of world position**, so the field is global. Hexes brushed in separate strokes line up as one continuous pattern rather than independent stamps.

`up`/`down` naming is **inverted** relative to the shader: trixelart's `'up'` (`lq + lr < 1`) is the shader's `up = 0`. Getting it backwards silently inverts the checker.

**Stack.** `PatternLayer[]`, bottom-first. Each layer has its own two encoded colors, a blend mode (`normal | multiply | screen | difference`, ported from `mfBlend`), opacity and visibility. Compositing starts from the bottom layer's `bg` — so a single `normal` layer at full opacity behaves exactly as it did before stacking existed — and runs in **authoring sRGB space, not linear**; the modes read differently in linear.

**Quantization.** Compositing two swatches rarely lands on a third, so the result snaps to the nearest palette color in **OKLab**, searched across *all* palettes. Plain RGB distance routinely prefers a wrong-hue swatch across 14 hues. Results are memoized on the composited RGB (an N-layer stack yields only a handful of distinct colors), and the painter is built once per pointer event so the memo stays warm across hexes.

**UI.** `PatternPanel` is a full-height drawer docked right — it *overlays* the canvas rather than shrinking it, since the drawer only exists for one tool and docking would reflow the artwork on every tool switch. Its preview is the only flex child, so it absorbs leftover height and is the first thing to give way on short displays; the square is sized in JS via `ResizeObserver` because CSS cannot fit a square to both axes of a box. The editor is tabbed (Pattern: blend mode, scale, rotation / Color: palettes, primary, secondary, opacity), which keeps both halves short enough to fit down to ~500px tall. The 14 palette chips need the drawer's full `w-96` width to stay on one line.

`PatternPalette` replaces `ColorPalette` while the tool is active — the brush takes every color from its own stack, so the paint swatches control nothing, and clicking one would silently switch tools. Slots save/load whole stacks, deep-copied in both directions.

## Hatch layers

A **second layer kind** holding line work instead of fills, so hatching composites over flats the way an inker works. `Layer.kind` is optional and **absent means `"fill"`** — read it through `layerKind(l)` (`use-history.ts`), never `l.kind` directly, and every pre-existing save, project JSON and history snapshot keeps working with no migration.

**Three directions**, one per grid-line family, each the level set of a linear functional `u` (`hatchU`): `y` (horizontal), `x − y·SKEW` (`/`), `x + y·SKEW` (`\`). All three have perpendicular spacing exactly `H`, so density `k` steps `u` by `H/k` for family 0 and `SIDE/k` for the other two. Lines sit at `(n + ½)·step`: **the half-step offset is load-bearing** — without it density 1 lands exactly on the triangle edges and draws nothing inside. With it, `density` reads as *lines per triangle*.

`u` is a pure function of world position, so the line field is **global** — trixels hatched in separate strokes line up as continuous lines rather than per-triangle tufts. Same reasoning as the pattern brush, and the same obvious failure mode.

**Storage.** Hatch marks live in the *same* `painted` map as fills, encoded `"dirMask|density|weight|paletteIdx,colorIdx"` (e.g. `"5|3|2|0,8"`; dirMask 1/2/4, so 5 = horizontal + `\`). Reusing `painted` is what makes it cheap — `setPainted`, undo, `trixel-save`, project JSON, and layer duplicate/delete/reorder/visibility all work unchanged. **The pipes are load-bearing**: a fill value is `"p,c"` with exactly one comma and no pipes, so `decodeColor` returns `null` on a hatch value and every existing decode site rejects it structurally. Palette shifts route through `mapEncodedColor` so the arrow keys shift the colour *inside* a mark and leave direction, density and weight intact.

**Rendering** — one shape, two backends, both driven by `buildRenderPlan(layers)` so hatch interleaves with fills in z-order. Canvas (`GridCanvas`, PNG export): one `ctx.clip()` over the group's triangles plus one stroke of the whole line family — the shared clip is what makes lines continuous across trixel boundaries, and the cost is per *line on screen*, not per mark × density. SVG: `clipSegmentToTriangle` clips each line to each triangle into real `<line>` elements, consistent with the crop exporter's refusal to use `<clipPath>`. That clipper derives each half-plane's inside sign **from the third vertex** — `getTriVertices` returns opposite windings for the two triangle types, which is also why `svg-export.ts` carries `ensureCW`.

**Lock-out.** `isToolAllowed(tool, kind)` (`tools/types.ts`) is the single source of truth, enforced once by wrapping `setTool` as `changeTool` in `TrixelGrid`, so the toolbar, keyboard, `1`–`9`, the eyedropper and the right-click pick are all covered without per-call-site wiring. Colour-writing tools (paint, fill, pattern, stamp, clone, dodge, burn) are blocked on a hatch layer; erase, pan, select, eyedropper and crop stay available on both. An effect keyed on the *kind* — not on `layers`, so it doesn't re-fire per stroke — moves to a usable tool on layer select, add, delete, reorder, undo/redo and project load alike.

Select **is** allowed: `rotateHatchValue`/`flipHatchValue` permute the direction mask alongside the geometry (a 60° rotation is a 3-cycle on the bits), so rotating a hatched selection carries its angles round with it.

**UI.** Deliberately *not* a drawer — hatch has four scalars and a colour, not a stack to edit, and it reuses the controls the app already has:

- The `+` in `LayerPanel` is a dropdown ("Normal layer" / "Hatch layer"); each row carries a kind icon.
- **Hatch is not in `editTools`.** It takes over the Paint slot via `brushTool(kind)` in `Toolbar.tsx`, so the toolbar shows *one* pencil that means Paint on a fill layer and Hatch on a hatch layer. Two pencils side by side, one of them permanently disabled, is worse than one button that changes meaning — so hatch is the documented exception to the "add the tool to `editTools`" rule at the top of this file. It is still in `isEditTool`.
- The ordinary `ColorPalette` swatch row drives the hatch brush, pointed at the brush's **own** palette (`hatchPaletteIdx`, derived from `decodeColor(hatchBrush.color)`) rather than the paint palette — otherwise an eyedropper pick landing on a mark authored elsewhere highlights the wrong swatch, or none. `1`–`9` must encode against the same index for the same reason.
- `HatchBar` is a footer-sized strip overlaid at the bottom of the canvas holding the three direction toggles and the density and weight sliders. Keyed on `activeLayerKind`, not `tool`, so it doesn't flicker away when the user reaches for erase; `ColorPalette` takes `raised` to clear it on small screens.

Brush settings are view state → `trixel-settings`, not `ProjectSnapshot` (same split as the crop rect).

3D-print and cutting exports take `mergedFillPainted`, which filters hatch layers out — hatch lines have no meaning as an extruded body or a cut path.

### Convert to hatches

Re-renders existing flat colour as line work: reads the merged fills **below** the active hatch layer, inside the hex selection, and writes a whole selection's worth of marks in one undoable step. `src/lib/hatchify.ts` is the maths (pure); `HatchifyDialog` is the UI; the button lives in `HatchBar` and shows only under Select with a live selection.

**Direction is concentric.** `hexWedgeIndex` already gives the 0–5 sector; `WEDGE_DIR = [2, 0, 1, 2, 0, 1]` (i.e. `(w + 2) % 3`) picks the family running parallel to that wedge's outer hex edge, so the marks nest as rings rather than one uniform screen. Hexes are flat-top, so vertices sit at 0°, 60°, … and wedge `w`'s edge runs at `60w + 120`; the families run at 0°, 60°, 120°. **Derive from `hatchU`, never from `DIR_LABEL`** — the slash/backslash naming is inverted relative to screen space because world y points down. An off-by-one here silently destroys the concentric look; a correct run over one hex splits its marks evenly across all three families (18/18/18 at N=3).

**Density** comes from `colorIdx` alone (`a = 1 − colorIdx/8`, index 0 being the darkest swatch), mapped onto the dialog's min/max. Deliberately *not* perceptual lightness — simple and predictable, at the cost that the four custom-lightness palettes top out at 68% yet still map to the minimum.

**`densitySkip` exists for pen plotting.** Lines sit at `(n + ½)·base/density`, so two densities share lines exactly when their **ratio is odd** — 1 and 3 share, 1 and 2 share nothing, 4 shares with nothing but itself. So when every reachable density is *odd* they all contain the density-1 ladder, and those coarse lines run unbroken across the whole selection: a plotter draws them in one pass instead of lifting the pen at every tone change. `reachableDensities` returns the ladder plus an `allOdd` flag, and the dialog reports which case you are in rather than leaving it to be discovered. Odd `minDensity` + even skip is the combination that guarantees it (min 1, skip 2 → `{1,3,5,7}`). Rounding happens in **step units**, not on the raw density then snapped — snapping afterwards lets a value land off the ladder and quietly breaks the property.

**Reduce mode** collapses the 9 tones to `K` representatives `L[j] = round(j·8/(K−1))` and dithers between adjacent levels. **The fill takes the *lighter* neighbour and the ink the *darker* one** — this is load-bearing. Only that pairing averages back to the original tone; snapping the fill down *and* hatching darker over it drives the whole selection toward black. Verified: reconstructed lightness tracks the original within ~1–3% at every `K`. Chunking is per palette, so hue is preserved.

Reduce writes to layers *other* than the active one, so `applyHatchify` rebuilds the whole `layers` array and calls `pushHistory` directly — `setPainted`/`snapshotWithPainted` only address `layers[activeLayerIdx]` and cannot express it. Each requantised fill goes back into the topmost visible fill layer below that already held that trixel, i.e. the one that won the merge. Still one action, one history entry.

The selection is cleared wholesale before the new marks are merged, so re-running with different settings replaces rather than accumulates. Settings are view state → `trixel-settings`, like the brush.

## Crop & export

Rectangular export region for print-on-demand (Spoonflower et al.) and for handing vector work to Inkscape. Separate from the whole-artwork `ExportDialog` in the hamburger menu, which is untouched.

**The crop is always a whole number of repeat tiles.** The lattice's translation symmetries are generated by `u = (SIDE, 0)` (`q → q+1`) and `v = (SIDE/2, H)` (`r → r+1`). An *axis-aligned* rectangle only repeats by pure horizontal/vertical translation if its periods are the axis-aligned members of that group:

- horizontal: `a·u + b·v` with `b·H = 0` ⟹ `b = 0` ⟹ **width = m·SIDE**
- vertical: `a·SIDE + b·SIDE/2 = 0` ⟹ `b = 2n` ⟹ **height = n·2H**, since `(0, 2H) = 2v − u`

Hence `CropRect { i, j, m, n }` — anchor `i·u + j·v`, size `m·SIDE × n·2H`. Every reachable rectangle is an exact repeat unit, so grid lines continue across a tile seam. That is a claim about the *lattice*; arbitrary artwork only repeats seamlessly if it was painted periodically. Note `applyCropDrag`'s north/top handling: moving the top edge by one `2H` step is `j += 2, i -= 1`, because `2v` alone would also shift x.

**Not undoable, by design.** The crop is view state, lives in `trixel-settings`, and `crop-tool.ts` deliberately never calls `ctx.onCommit()` — it does not touch `painted`, so the golden rule above does not apply. Committing it would mean `Ctrl+Z` stops undoing paint strokes.

**Rotation.** `gridRotation` is only ever `0` or `π/2`, and a quarter turn maps an axis-aligned rect to an axis-aligned rect. So the crop is stored and hit-tested in **world** space (the overlay is drawn inside GridCanvas's world transform and needs no separate pass), but *exported* in **display** space `R(θ)·world`, which swaps width and height for pointy-top. Because sin/cos are exactly 0/1 there, SVG merge-by-color still welds correctly after rotating.

**PNG** (`png-export.ts`) is the print target: Spoonflower takes JPG/PNG only — no SVG — at ≤40 MB, sRGB, resampled to 150 DPI, so `pixels / 150` is the printed size. Canvas 2D is already sRGB. The background is filled opaque because no alpha support is documented. Triangles are batch-filled per color (killing intra-color seams) *and* stroked with the same color at ~1 device pixel, because two abutting fills are composited separately and leave a boundary pixel part background however their coverages divide. The 40 MB check runs on the real blob — flat-color PNG compresses far too unpredictably to estimate.

**Row alignment — two halves of one fix, and both are load-bearing.** The lattice's only axis-aligned edges are the horizontal ones, at every multiple of `H`. `n*sqrt(3)/m` is irrational, so at a naive scale *every* one of them straddles a pixel row, antialiases against its neighbour, and the export grows a discoloured 1–2px line across its full width at every row — at any resolution, and independent of the SVG stroke/merge options (which do not apply to PNG at all). So:

1. `cropPixelSize` snaps the **row-axis** dimension up to a whole multiple of `2n` (the crop is exactly `2n` triangle rows tall) and `renderCropToCanvas` scales each axis independently to fit it exactly. A shared scale would leave the snapped axis short and reopen the straddle. Costs ≤`2n` pixels, under 0.1%, and is taken on the axis the user did not pin — under a quarter turn the row axis is horizontal, so the snap moves to the width.
2. The overdraw stroke then **skips the flat edges** (`y0 === y1` in world space). Once aligned, those fills meet exactly and have no gap to close, and a stroke centred there straddles by half a pixel each way — reintroducing the identical artifact. Only the two diagonal edges of each triangle are overdrawn.

Measured on dense random art: full-width anomalous rows 6 → 0, and the **tile join** 75.3% → 1.3% (i.e. indistinguishable from an interior row), so this is also what makes the exported tile actually repeat seamlessly. Residual background leak on the diagonals is ≤4/255 per channel, imperceptible. `renderCropPreview` applies the same snap and blits at integer positions, or it would show blurred seams the export does not have.

**SVG** (`generateCroppedSVG`) clips geometry for real via Sutherland–Hodgman rather than hiding overflow behind a `<clipPath>`, so edge triangles become genuine 4- and 5-gons and nothing off-crop survives into the file. Clip **before** merge — the clip is exact, so neighbours still agree on shared boundary vertices. `dedupeRing` runs twice, once at full precision and again after rounding to `PRECISION`, because a repeated vertex is a zero-length edge that `mergeTrianglesByColor` keys as a self-loop (`ka === kb`) and follows into a dead end. Padding is 0 (unlike `generateSVG`), and physical `width="…in"` is emitted so Inkscape opens the document at true print size.

**UI.** `ExportPanel` reuses the `PatternPanel` drawer shell. Its preview tiles the crop 3×3 with neighbours at 0.4 alpha and the exported tile outlined — a single tile shows nothing about the seams, which is where the interesting failure would be. Background opens `ColorPickerDialog`, a portal modal over all 14 palettes plus literal neutrals (the palettes top out at 88% lightness, so pure white/black are not expressible as swatches); it is deliberately generic and reusable. It mirrors `PalettePicker`'s layout on purpose — same overlay, panel, header and two-column grid of named swatch strips — so the app's two colour modals read as one thing; the difference is that each of the nine swatches is its own button rather than the row picking a whole palette.

Both drawers share a control scale: `text-xs` labels, `text-sm` values, ~`py-2` inputs, 16px icons, `p-4`/`gap-3` shell. `PatternPanel`'s 14 palette chips must stay `flex-1` rather than fixed-width — fourteen of them share the drawer's inner width on one line and cannot grow past ~23px.

## Plotter export

Its own dialog, off the hamburger menu ("Export for plotter..."), in `src/lib/plotter-export.ts` (pure) + `PlotterDialog.tsx`. A pen plotter draws **strokes**, carries **one pen**, and charges for every pen-down millimetre — and a retraced line is a visible blot of doubled ink, not just wasted time. So this is convert-to-hatches aimed at paper: brightness becomes density, hex wedges give direction, output is a stroke-only SVG at true physical size.

**Deliberately not cropped, and deliberately not in `ExportPanel`.** The fabric exports exist to cut a seamless *repeat tile* out of the artwork. A plot is a drawing on a sheet: it takes the **whole** artwork and lays it out on a page. Sharing the crop drawer would have meant every plot silently inheriting a tiling rectangle that has nothing to do with it — so the settings live under their own `plotter` key in `trixel-settings`, not inside `ExportSettings`.

**Page, margin and fit** are `plotterLayout` (pure), which is the only place the artwork's world units meet inches. Named sheets are stored **portrait** and `landscape` swaps them, so the two orientations cannot disagree. Two modes, differing in which variable is free: on a sheet the **page** is given and the drawing is auto-scaled to fit inside the margins and centred there (so a plot always fits the paper in the machine); under `fit` the **drawing** is given (`artWidthIn`) and the page grows to hold it plus margins, which is the older artwork-shaped page. `scale` is inches per world unit and is `0` when the margin has eaten the page — `invalid`, and the export button goes with it.

The margin is floored at **half a nib**: the stroke is centred on its path, so a cap on an edge stroke would otherwise be sliced in half by the page edge. That is the same half-nib bleed the SVG used to carry implicitly, now expressed as the smallest legal margin.

**The SVG's user unit is the inch and its `viewBox` is the sheet.** Strokes stay in world coordinates and ride on one `translate/scale` per layer, so re-sizing the page changes one number per layer rather than every path, and `stroke-width` is divided by that scale to come out at the true nib. The transform and the page dimensions are emitted through `fmtHi` (12 significant digits), **not** the shared `fmt`: three decimals are a rounding error on a world coordinate and a **7% size error** on a scale factor of ~0.019. Path coordinates still use `fmt`, where a thousandth of a world unit is nanometres on the page.

Marks are built by walking the **painted keys**, not by scanning a region — with no crop there is no box to enumerate, and walking what exists is both exact and cheaper than sweeping mostly-empty area. `PlotterPlot.width/height` is the artwork's own extent in world units, taken **after** the display rotation, because under a quarter turn width and height swap and measuring first would size it wrongly; the page comes from `plotterLayout` on top of that.

**Brightness is OKLab lightness** (`oklabLightness`, exported from `tri-pattern.ts`), *not* `colorIdx` as hatchify uses. Reproducing colour in a single ink needs a brightness comparable **across** palettes; index 8 of Glacier is 68% lightness and index 8 of Ocean is 88%, and they would otherwise plot identically.

**The tone range is normalised to the artwork**, not absolute: `plotterMarks` takes the min and max lightness actually painted and maps that span onto the ladder, so the darkest colour present always plots at the top density and the lightest at the bottom. Absolute lightness wastes most of the ramp — the palettes span ~12%–88% and four of them top out at 68%, so a piece drawn from one of those would never reach either end. Measured: four adjacent swatches (L 0.44–0.70) spread across the full ladder rather than over two rungs. A single-tone piece has no range to normalise against and falls back to absolute lightness rather than dividing by zero.

Black pen on white paper: ink follows darkness. White on black is the exact reverse, and the two modes are exact mirrors. `blankLightest` adds a `0` rung at the no-ink end — outlines only — which is the **lightest** tone under a black pen and the **darkest** under a white one; the checkbox's label follows the pen for that reason. Lightness is memoised per encoded colour, since an artwork uses a handful of swatches over thousands of cells.

**Hatch layers are ignored**, unlike every other export, which is why `plotterMarks` reads only the fills. A plot puts its lines on the lattice's division lines while an authored hatch layer is centred between them; the two schemes on one sheet read as a mistake rather than as emphasis. Hand-drawn line work stays a screen and vector feature.

**Solids are outlined too.** Every lattice edge whose two sides read as different colours is drawn, plus the outside of the artwork. **An edge between two cells of the same colour is never drawn** — that is what makes it an outline of the shapes rather than a wireframe of every trixel (measured: a 162-trixel flat field outlines to its perimeter, ~1800 units, not the ~24000 every-edge would give). Each undirected edge is accumulated once in a map, so an interior edge cannot be emitted twice even though two triangles claim it — overdraw is impossible before the interval union even runs. Colours are compared **resolved, not encoded**, deliberately breaking the usual rule: elsewhere encoded comparison is right because painted data must follow palette shifts, but here the only question is whether the eye sees a boundary, and two swatches from different palettes resolving to the same hex are one region.

**The plotter's hatch is grid-aligned, not centred** — the one place its line work differs in *geometry* from the screen's (`hatchLinesInBox`'s `align` parameter; `"center"` everywhere else). On paper the shape boundaries are already drawn as outlines, so a centred hatch sits half a division from them and the tone crowds at every boundary. On the division lines the ladder is uniform straight across an edge.

**The lattice's own lines are kept, not skipped**, even though the outlines sit there too. Skipping them looks right only where an outline stands in for the missing line, and an edge between two cells of the *same* colour has no outline — so skipping opens a double gap every `density` lines through the middle of every flat region (measured: gaps alternating `0.25H, 0.25H, 0.5H` instead of a constant `0.25H`).

So a hatch span **can** coincide with an outline, and `joinRuns` takes an optional `mask`: the outlines are joined first, then the hatch is joined and has them subtracted. Subtraction, not exclusion at generation time — the hatch line must survive wherever there is no outline, which is most of a flat region, and only the joined outline set knows where that is. Verified on a flat field (one gap value in the histogram, 0 overlapping stroke pairs across both layers) and on a two-colour boundary (the shared row comes out outline-only, full width, no gap).

**Joining and overdraw removal are the same operation, and it is not segment chaining.** The obvious reading of the data — a pile of little segments — suggests chasing matching endpoints. Don't. Every segment already lies on a *known line of a known family*, so the join is a **one-dimensional interval union per line**: bucket by `(dir, u)`, project onto the line's parameter (x for family 0, y for 1 and 2 — the parameterisation `hatchLinesInBox` generates with), and union. A union is disjoint by construction, so overdraw does not need detecting and removing; it cannot survive. It also cannot mis-chain at a crossing, which endpoint chasing can.

**Lines are grouped by sweeping sorted `u`, not by hashing a rounded key.** Coincident lines arriving from different densities are *not* bitwise equal — at densities 1, 3 and 7 the shared line computes to the identical double, but at density 5 it differs by one ulp. An exact key silently fails to join exactly those, and a rounded key can still split a pair straddling a bucket boundary. A sweep has neither failure mode.

**There is no `densitySkip` here** — the ladder is every integer from `minDensity` to `maxDensity` (`plotterDensities`, the plotter's own replacement for `reachableDensities`). Skipping existed so the reachable densities would share lines under the centred scheme; with lines at `n·base/d`, *every* density already contains the lattice lines themselves, so those run unbroken across the whole artwork whatever the settings, and one density's lines are a subset of another's exactly when `d1 | d2`. A skip could only have thrown away tone levels. (The all-odd reasoning in `reachableDensities` is still correct for hatchify, which stays centred at `(n + ½)·step`.)

Outlining and travel ordering are **unconditional** — the two checkboxes were removed. Travel ordering cannot change what is drawn, only how long the pen spends in the air (greedy nearest-neighbour with stroke reversal, `O(n²)`, skipped above 8000 strokes; measured 272568 → 7988 world units of pen-up on a full-artwork plot), so there was nothing to opt out of. And with the hatch on the division lines, the outlines are what bound each tone: without them the ladder reads as an open field of parallel lines rather than as shapes.

**Output is three Inkscape layers** — Paper, Hatch, Outlines — as `inkscape:groupmode="layer"` groups with the `xmlns:inkscape` declaration, which is what makes Inkscape read them as layers rather than anonymous groups. Each can be hidden, re-penned, reordered or plotted on its own, which is how a two-pen or two-pass plot is actually produced; the paper layer switches off before plotting. Hatch precedes Outlines so outlines draw on top. Travel is optimised **within** each layer, since the plotter draws one layer at a time and interleaving would only add travel.

The paper is a filled `<rect>` covering the page, with no stroke: plotters follow strokes and ignore it, but it makes a white-on-black plot legible on screen. `renderPlotterPreview` draws the paper at the *page's* aspect, not the canvas box's, or the sheet is misrepresented, and dashes in the margin box — on a fixed sheet the margin is what decides how big the drawing comes out and is otherwise invisible.

**Dialog.** The controls are grouped into four `Section`s — Pen, Page, Tone, Line work — because they are four unrelated decisions and eighteen rows at one rhythm read as an undifferentiated list. `densitySkip`'s trade-off caption was removed as noise; the ladder it described is still what `reachableDensities` computes.

## Symmetry function panel

- Uses `new Function()` to eval user formulas against `a,b,c` coordinates
- Separately controlled via `ƒ` button in toolbar

## Fullscreen

- Toggle via toolbar button; uses `document.documentElement.requestFullscreen()` / `exitFullscreen()`

## Persistence (localStorage)

| Key | Stores | Hook/Component |
|---|---|---|
| `trixel-save` | The `ProjectSnapshot` (see below) | `useHistory` |
| `trixel-settings` | View/tool settings: `gridDivisions`, `hexMode`, `flowerRadius`, `symmetry`, `gridOrientation`, `brushSize`, `projectName`, `hueOffset`, `saturationOffset`, `svgExport`, `patternLayers`, `patternPaletteIdx`, `crop`, `exportSettings`, `hatchBrush`, `hatchify`, `plotter` | `TrixelGrid` |
| `trixel-selections` | Array of `SelectionSnapshot` | `TrixelGrid` |

`ProjectSnapshot` — the unit of undo, of `trixel-save`, and of the exported project JSON — is `{ layers, activeLayerIdx, gridDivisions, hexMode, flowerRadius, symmetry, selections, patternPresets, lastPaintTri }`. Adding a field means updating **every** literal that builds one (TypeScript finds them) *and* the dependency array of the effect that writes `trixel-save`, or the value will live in memory and never persist.

The **split matters**: `trixel-settings` is view state, `ProjectSnapshot` is authored content. Pattern *layers* (the live stack you are editing) are a setting; pattern *presets* (saved slots) travel with the project, like stamp selections.

- Legacy migration: boolean `hexMode` → string `HexMode`, boolean `symmetry60` → string `Symmetry`
- **The first edit on a fresh document cannot be undone.** `useHistory` starts at `historyIdx = -1` with an empty stack, so one commit lands at `0` and `handleUndo` bails on `historyIdx <= 0` — there is no snapshot of the empty state to return to. Pre-existing for every tool; do not mistake it for a missing `pushHistory`.

## Key modules

| Module | Purpose |
|---|---|
| `src/lib/grid-math.ts` | Triangular grid coordinate system (`SIDE=50`, `H`, `worldToTri`, `getTriVertices`, `getTriPath`, `getTriABC`, `getTrianglesOnLine`) |
| `src/lib/hex-flower.ts` | Hex geometry, flower offsets, symmetry paint targets, selection snapshots (`triToHex`, `flowerOffsets`, `rotateTrixelCCW`, `hexCenterWorld`, `enumerateHexTrixels`, `hexTranslation`, `paintTargets`, `captureHexSnapshot`, `hexCenterTriAxial`) |
| `src/lib/config.ts` | Zoom/pinch constants (`ZOOM_MIN`, `ZOOM_MAX`, `WHEEL_DIVISOR`, `PINCH_SENSITIVITY`) |
| `src/lib/constants.ts` | `PALETTE_DEFS` (14 palettes × 9 lightnesses), `encodeColor`/`decodeColor`/`resolveColor`, palette shifting |
| `src/lib/tools/` | One module per tool + `types.ts` (`Tool`, `DragState`, `ToolContext`, `ToolHandler`) and `index.ts` (`toolMap`) |
| `src/lib/crop.ts` | Lattice-snapped export crop (`CropRect`, `cropWorldBounds`, `cropDisplayBounds`, `fitCropToPainted`, `hitTestHandle`, `applyCropDrag`). Pure, no DOM |
| `src/lib/png-export.ts` | Raster export: `renderCropToCanvas`, `renderCropPreview` (3×3 tiling), `cropPixelSize`, 40 MB limit |
| `src/lib/tri-pattern.ts` | Pattern brush maths: `triPatternValue`, stack compositing, OKLab palette quantization. Pure, no DOM |
| `src/lib/hatch.ts` | Hatch maths: `encodeHatch`/`decodeHatch`, `hatchU`/`hatchStep`, `hatchLinesInBox` (+ `HatchAlign`), `clipSegmentToTriangle`, `clipSegmentToRect`, `groupHatchMarks`, `rotateHatchValue`/`flipHatchValue`, `mapEncodedColor`. Pure, no DOM |
| `src/lib/hatch-render.ts` | `buildRenderPlan` (the shared bottom-to-top layer walk), `drawHatchLayer` for canvas, `hatchStrokes`/`hatchStrokesBounds` for SVG |
| `src/lib/hatchify.ts` | Convert-to-hatches maths: `hatchify`, `WEDGE_DIR`, `reduceLevels`, `HatchifySettings`. Pure, no DOM |
| `src/lib/hatchify-render.ts` | `renderHatchifyPreview` — fits a trixel set to a canvas and runs the GridCanvas draw loop |
| `src/lib/plotter-export.ts` | Single-pen plotter export: `buildPlotterPlot`, `plotterDensities`, `plotterLayout` (page/margin/fit), `plotterSVG`, the interval union + outline subtraction, travel ordering. Pure except `renderPlotterPreview` |
| `src/lib/pattern-render.ts` | Canvas rendering for pattern previews, thumbnails and palette slots |
| `src/lib/utils.ts` | `cn()` — clsx + tailwind-merge |
| `src/hooks/use-canvas-size.ts` | Container measurement via `ResizeObserver` |
| `src/hooks/use-history.ts` | Paint state, undo/redo stack (capped at 50), localStorage persistence, clear |
| `src/hooks/use-interaction.ts` | Pointer/touch/wheel handling: painting, erasing, panning, selecting, stamping; screen↔world conversion; hover tracking with targets |
| `src/hooks/use-keyboard-shortcuts.ts` | Global keyboard bindings for tools, colors, undo/redo |

## Grid coordinate system

- Axial `(q, r)` with triangle type (`up`/`down`) identifies each triangle
- Analytical `(a, b, c)` for symmetry formulas: up triangles satisfy `a+b+c=0`, down satisfy `a+b+c=-1`
- Canvas rendered via `getTriVertices(q, r, type)` for direct vertex coordinates
- Hex coordinates: `{ c, k }` — cube-based hex addressing

## Types (scattered across files)

- `TriKey { q, r, type }` — `src/lib/grid-math.ts`
- `TriType = "up" | "down"` — `src/lib/grid-math.ts`
- `Symmetry = "off" | "sym60" | "sym120"` — `src/lib/hex-flower.ts` (duplicated in `src/components/Footer.tsx`)
- `HexMode = "off" | "outlines" | "centers"` — `src/components/Footer.tsx`
- `HexCoord { c, k }` — `src/lib/hex-flower.ts`
- `SelectionSnapshot { id, N, c, k, trixels }` — `src/lib/hex-flower.ts`
- `Tool` — `src/lib/tools/types.ts` (`paint | erase | fill | pattern | hatch | pan | select | stamp | clone | dodge | burn | eyedropper | crop`)
- `LayerKind = "fill" | "hatch"`, `Layer` — `src/hooks/use-history.ts`
- `HatchBrush`, `HatchDir`, `HatchAlign` — `src/lib/hatch.ts`
- `HatchifySettings`, `HatchifyMode`, `HatchifyResult` — `src/lib/hatchify.ts`
- `PlotterSettings`, `PenMode`, `PageSizeId`, `PlotterLayout`, `PlotterPlot`, `PlotterStroke` — `src/lib/plotter-export.ts`
- `CropRect`, `CropHandle` — `src/lib/crop.ts`
- `ExportSettings` — `src/components/ExportPanel.tsx`
- `PatternLayer`, `PatternPreset`, `PatternBlendMode`, `QuantizeTarget` — `src/lib/tri-pattern.ts`

## Notable

- Deployed to GitHub Pages via `.github/workflows/pages.yml` (static export; `GITHUB_PAGES=true` sets `output: export` + `basePath` in `next.config.ts`)
- Remote image patterns configured for `placehold.co`, `images.unsplash.com`, `picsum.photos`
