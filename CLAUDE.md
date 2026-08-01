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

Each tool is a `ToolHandler` (`onDown`/`onMove`/`onUp`) in `src/lib/tools/`, registered in `toolMap` and dispatched by `use-interaction.ts`. Adding a tool means touching `Tool` in `tools/types.ts`, `toolMap`, `editTools` **and `isEditTool`** in `Toolbar.tsx`, the `hoverTargets` guard in `use-interaction.ts`, and `use-keyboard-shortcuts.ts`.

| Tool | Shortcut | Description |
|---|---|---|
| Paint | `P` | Paint triangles with selected color |
| Erase | `E` | Erase (clear) triangles |
| Fill | `F` | Edge-connected flood fill (`computeFillRegion`), bounded by `FILL_MAX_RADIUS` or clipped to the hex selection |
| Pattern | `N` | Procedural pattern brush; paints whole hexes. See "Pattern brush" |
| Dodge / Burn | `D` / `B` | Step the palette index lighter/darker |
| Clone | `C` | Clone-stamp from a captured source |
| Eyedropper | `I` | Pick a painted color |
| Pan | `H` | Drag to translate painted trixels (grid offset); right-click pans view |
| Select | `S` | Click a hex to select it; captures all painted trixels inside as a snapshot |
| Stamp | `T` | Alt-click a hex to define stamp source (yellow flash); click to stamp (right-click erases); `+` button in palette to enter capture mode |

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
| `D` / `B` | Dodge / Burn |
| `C` | Clone |
| `I` | Eyedropper |
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

## Symmetry function panel

- Uses `new Function()` to eval user formulas against `a,b,c` coordinates
- Separately controlled via `ƒ` button in toolbar

## Fullscreen

- Toggle via toolbar button; uses `document.documentElement.requestFullscreen()` / `exitFullscreen()`

## Persistence (localStorage)

| Key | Stores | Hook/Component |
|---|---|---|
| `trixel-save` | The `ProjectSnapshot` (see below) | `useHistory` |
| `trixel-settings` | View/tool settings: `gridDivisions`, `hexMode`, `flowerRadius`, `symmetry`, `gridOrientation`, `brushSize`, `projectName`, `hueOffset`, `saturationOffset`, `svgExport`, `patternLayers`, `patternPaletteIdx` | `TrixelGrid` |
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
| `src/lib/tri-pattern.ts` | Pattern brush maths: `triPatternValue`, stack compositing, OKLab palette quantization. Pure, no DOM |
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
- `Tool` — `src/lib/tools/types.ts` (`paint | erase | fill | pattern | pan | select | stamp | clone | dodge | burn | eyedropper`)
- `PatternLayer`, `PatternPreset`, `PatternBlendMode`, `QuantizeTarget` — `src/lib/tri-pattern.ts`

## Notable

- Deployed to GitHub Pages via `.github/workflows/pages.yml` (static export; `GITHUB_PAGES=true` sets `output: export` + `basePath` in `next.config.ts`)
- Remote image patterns configured for `placehold.co`, `images.unsplash.com`, `picsum.photos`
