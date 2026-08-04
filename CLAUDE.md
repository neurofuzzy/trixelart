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

## Layer effects

Non-destructive per-layer geometry filters. `Layer.effects` is optional and
**absent means none** — read it through `layerEffects(l)` / `activeEffects(l)`
(`use-history.ts`), never `l.effects` directly, exactly as with `layerKind`, and
every pre-existing save, project JSON and history snapshot keeps working with no
migration. Effects never touch `painted`: the lattice data is untouched and
switching one off restores the artwork byte for byte (verified — a disabled or
zero-radius effect produces identical SVG output).

`Layer` is already inside `ProjectSnapshot`, so effects ride undo/redo,
`trixel-save` and the `.trixel.svg` payload **with no new snapshot field**. That
is the reason they live on the layer rather than in `trixel-settings`: they are
authored content, and putting them there costs nothing to persist. They are a
list so a second effect can be added without re-plumbing; today exactly one
changes geometry. Hatch layers are excluded — line work has no filled region to
reshape.

### Round corners

Replaces each corner of a contiguous same-colour region with a circular arc.
`src/lib/round-corners.ts` is the maths (pure); the UI is an Effects section in
`LayerPanel` under the selected fill layer.

**Regions** are extracted by the same boundary-following ring walk
`mergeTrianglesByColor` uses — count lattice edges, keep the ones seen once,
chain them into loops. Colours are compared **resolved, not encoded**,
deliberately breaking the usual rule for the same reason `region-outline.ts`
does: the only question is whether the eye sees a boundary.

**Airtightness is a property of the vertex, not of the polygon.** Six triangles
meet at every lattice vertex, so a region's interior angle there is a multiple of
60°. Where exactly two regions meet, their angles are θ and 360−θ and both
boundaries run along **the same two rays** — one region traverses them one way,
the other the reverse. A single circle of radius r tangent to both rays serves
both at once: convex for the θ<180 side, concave for the other. So **there is no
separate concave code path**; each region rounds its own ring in ignorance of its
neighbours and the results abut exactly. If a concave special case ever seems
necessary, something upstream is wrong.

**Junctions are left sharp.** Where three or more regions meet, three circles
tangent to two of the three rays leave an uncoverable curvilinear triangle
belonging to no region. Hence the rule: *round a vertex iff exactly two boundary
edges are incident to it* — counting unpainted as a colour, so the silhouette
rounds too. The count is always even; 4 or 6 means a junction, or a region
pinching against itself. Collinear pairs need no special case, the tangent
distance being zero at 180°.

**One radius, in world units, for the whole layer.** The slider is a 0–1 fraction
of `ROUND_RADIUS_AT_FULL` = `SIDE` (one cell stride) — stored as a fraction so the
saved value does not depend on `SIDE`, but denoting an absolute distance that is
the *same at every corner*. Scaling each corner by its own maximum instead makes
the radius vary from vertex to vertex — a lone triangle at 14.4 beside a corner
at 86.6 — which is visibly not one radius and was the original bug here.

**The clamp reads only the shared boundary.** Tangent distance is `r·cot(α/2)`,
so an unclamped radius overruns its edge; each straight run of length `L` between
two rounded corners requires `r·(cot(α₁/2) + cot(α₂/2)) ≤ L`, and each vertex
takes `min(r, …)` over its two runs. Runs and angles belong to the *shared*
boundary, so both regions compute an identical clamp and airtightness survives at
every setting (verified exactly equal at 15%, 50% and 100%). Clamping on anything
region-local — area, cell count, ring length — gives the two sides different radii
and tears the seam open. That is the easy mistake here.

Nothing clamps below `SIDE/(2√3)` ≈ 14.43, i.e. **28.9% of the slider**: that is
where two 60° corners consume exactly one lattice edge between them, and it is
also a single triangle's incircle, so a lone trixel is fully round there and
cannot get rounder. Above it corners saturate progressively as their runs run
out, tightest first, so the upper range still does real work on larger shapes.

**Lattice vertices are keyed by integers, never by rounded coordinates.** Every
vertex is `(i·SIDE + j·SIDE/2, j·H)`, and a triangle's corners are fixed integer
offsets from its `(q, r)`. This is not just tidiness: `(r+1)·H` and `r·H + H`
differ by an ulp so a coordinate key needs rounding, rounding reintroduces a
`-0.000` vs `0.000` split that silently miscounts a vertex's degree, and the
`toFixed` calls cost 4× the total runtime (81 ms → 19.7 ms on `mandala`, the
largest bundled example). Edges pack as `(base vertex, direction)` — combining
two vertex ids overflows the exact-integer range.

**Rendering** — one shape, two backends, both driven off `ringTangents` so they
cannot disagree about where an arc begins. Canvas moves onto each corner's entry
tangent point before `arcTo`, so the circle `arcTo` infers is the one already
computed. SVG emits explicit `A` commands with the sweep flag taken from the turn
direction. The cropped SVG flattens arcs to chords first, because an arc cannot
survive Sutherland–Hodgman and that exporter clips for real rather than hiding
overflow behind a `<clipPath>`.

**`buildRenderPlan` carries the effects and stops coalescing across differing
ones.** Coalescing flattens consecutive fill layers into one map, and rounding
reads that map to find region boundaries — merging a rounded layer with an
unrounded one would round the neighbour's cells, and merging two radii would
silently pick one. `GridCanvas` was moved onto `buildRenderPlan` for this: it
used to walk `layers` itself, which would have made the preview round a different
set of regions than the export.

Geometry is memoised on the plan in `GridCanvas`, since the draw effect re-runs
on pan, zoom, hover and the ant-march tick, none of which change geometry. The
hue and saturation offsets are dependencies of that memo even though they are not
arguments — `resolveColor` reads them from module state, and without them a
palette shift leaves stale colours and stale region boundaries baked in.

### Rounding in the cutting export

The cutting export honours the effect too, but through a **different path** — it
has its own boundary tracer (`traceUnionLoops`) and groups by *sheet assignment*
rather than by colour, so it picks up nothing from the colour-region code.

**Sheets are nested** (level *j* holds every triangle at level *j* and above), so
a rounded piece sits on a strictly larger one and cannot open a gap. There is no
airtightness constraint and therefore no boundary-degree test: every
non-collinear corner is eligible. That is why `roundPolygon` exists separately
from `roundRing` — the two consumers answer "which vertices may round" in
completely different ways, and only the *clamp* is shared, which is the part
that is easy to get wrong.

Rounding runs **after** the tiny-hexagon necks are inserted, and the run clamp is
what makes that safe: a neck's edges are `neck`-sized, so the clamp drives the
radius at those vertices to almost nothing by itself and the bridge keeps its
designed shape.

Loops are **flattened back to polylines**, not left carrying arcs, so bounds, the
SVG path emit and the 3D extrusion all keep working on plain points. A cutter
follows a dense polyline as happily as an arc.

**The dialog's 3D preview is deliberately NOT rounded** — it still extrudes the
raw lattice triangles, so it shows sharp corners while the SVG it downloads is
rounded. That mismatch is known and is the lesser evil.

Making it match needs a real polygon triangulator: `MeshBuilder.prism` takes only
triangles, while a rounded sheet is an arbitrary polygon that may enclose holes.
A hand-rolled ear clipper with hole bridging was tried and **reverted**. It looked
right on synthetic blocks and failed badly on real artwork — up to 36% area error
on multi-loop sheets, output degenerating into thin slivers, and O(n³) behaviour
that hung on sheets with hundreds of boundary vertices. The failure modes are the
classic ones (vertex-on-boundary containment tests, coincident vertices from the
hole bridges), and getting them right means an earcut-class implementation, not
a hundred lines. Do not retry it casually.

One real bug did come out of that attempt and is fixed: `flattenRoundedRing`
emitted **coincident consecutive points** wherever the clamp is tight enough that
one corner's exit tangent lands exactly on the next corner's entry tangent. Those
zero-length edges are invisible in a filled path but are degenerate input to
anything that reasons about the polygon — a clipper, a triangulator, a plotter —
so the flattener now dedupes before returning (measured 84 → 0 on a real sheet).

`mergedFillPainted` throws away layer identity, so a per-layer radius cannot
survive it: `mergedFillRoundFraction` takes the **largest enabled** radius among
visible fill layers. Predictable, and it matches the intent — if the artwork
reads as rounded, the cut should be too.

**Still not honoured by the cut dialog's 3D preview (above), the plotter,
apparel cuts, or the 3D export.** The plotter and apparel cuts run on
`region-outline.ts`'s `RawSeg` — a line family plus a 1-D interval —
which structurally cannot represent an arc; the 3D export extrudes the lattice
directly. With rounding on, apparel *fills* round but its cut gaps still follow
the straight lattice boundary, diverging slightly near corners.

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

## Apparel export

Its own dialog, off the hamburger ("Export for Apparel..."), in `src/lib/apparel-export.ts` + `ApparelDialog.tsx`. A **PNG with alpha**: the shirt is the background, so everything unpainted leaves the file transparent. Every other raster path in the app is opaque on purpose — the fabric sites document no alpha support — so this is not "the crop export with the background fill deleted", and it does not share `ExportSettings`.

**Deliberately not cropped**, exactly as the plotter is not: the fabric exports cut a seamless *repeat tile*, and a garment print is the whole artwork on a shirt. Sharing the crop drawer would mean every shirt silently inheriting a tiling rectangle that has nothing to do with it — hence its own `apparel` key in `trixel-settings`.

**The stencil cut.** A large unbroken area of transfer ink is stiff and cracks along fold lines after a few washes; breaking it into pieces separated by thin bare-fabric gaps lets the garment flex instead. The lines to cut along are the ones the plotter's outline pass already computes, punched out of the alpha with `destination-out`. Three decisions, all load-bearing:

- **Colour boundaries only, never the lattice.** A flat field of one colour comes out as one piece. Gridding it would turn a drawing into a mosaic, and the trixel lattice is far finer than anything a garment needs.
- **The silhouette is not cut** (`outlineSegments`' `silhouette: false`). The outside of the artwork is already the edge of the alpha, so cutting there buys no flex and only erodes the design by half a gap width. This is the **only** behavioural difference from the plotter's outline set.
- **Round caps and joins, not butt.** A joined run ends where runs of the other two families cross it; a butt cap stops half a gap short of the crossing and leaves a hairline of ink bridging every junction, which welds the pieces back together and undoes the cut. Verified: three regions meeting at a point export as 3 alpha-connected components, not 1.

The cut segments stay in **world** coordinates and ride the transform already on the context — no second mapping, and correct under a quarter turn for free.

**`region-outline.ts` is the shared primitive**, lifted out of `plotter-export.ts` unchanged: `outlineSegments` (every lattice edge whose two sides read as different *resolved* colours), `joinRuns` (the 1-D interval union per line, with its mask subtraction), `segToPoints`, `edgeDir`, `along`, `RawSeg`. The plotter draws those boundaries; apparel punches them. Neither imports the other.

**The row snap is kept, and it matters more here.** `apparelPixelSize` mirrors `cropPixelSize`, snapping the row-axis dimension to a whole multiple of the artwork's row count instead of the crop's `2n`. That count is always an exact integer — `getTriVertices` only ever produces `y = r*H` or `(r+1)*H`, so the world bbox is a whole multiple of `H` tall. Unsnapped, every horizontal lattice edge straddles a pixel row, and with no background to blend into the result is a *semi-transparent* line letting the garment through the full width of the print, at every row. `EDGE_PAD` (2px, on all four sides, so the seam-closing overdraw at the outer boundary is not sliced off) **must stay an integer**: an integer translation preserves that alignment, a fractional one throws it away.

**The garment colour is preview-only** and never written to the file. It exists because a transparent-on-checkerboard preview says nothing about whether the piece works on the colour it will be worn on. The preview composites the artwork on its own bitmap first and then draws it over the garment — drawing straight onto the garment would let `destination-out` punch holes in the shirt rather than gaps in the print.

Two preview zooms. **Fit** shows the whole design; **Actual size** reproduces the export's own scale, centred, because at 0.8 mm on a 10″ print a fitted preview renders the gap well under a pixel — i.e. it shows nothing about the one setting the dialog exists to judge.

`cutPieceReport` runs `connectedComponents` per resolved colour and reports how many pieces the cut leaves and how small the smallest is; under ~4 mm² it warns, since a piece that small lifts off in the wash. Grouped by **resolved** colour to match `outlineSegments` — two swatches that resolve to the same hex have no boundary between them, so they are one piece.

**No 40 MB ceiling.** `MAX_UPLOAD_BYTES` is Spoonflower's rule and has nothing to do with a garment transfer; the dialog reports the dimensions and lets the encode fail loudly instead.

The dialog draws every visible layer (hatch included, via `drawArtworkPlan`) but takes the cut's regions from `mergedFillPainted` alone — hatch is line work over the colour and bounds nothing of its own.

## Symmetry function panel

- Uses `new Function()` to eval user formulas against `a,b,c` coordinates
- Separately controlled via `ƒ` button in toolbar

## Fullscreen

- Toggle via toolbar button; uses `document.documentElement.requestFullscreen()` / `exitFullscreen()`

## Persistence (localStorage)

| Key | Stores | Hook/Component |
|---|---|---|
| `trixel-save` | The `ProjectSnapshot` (see below) | `useHistory` |
| `trixel-settings` | View/tool settings: `gridDivisions`, `hexMode`, `flowerRadius`, `symmetry`, `gridOrientation`, `brushSize`, `projectName`, `hueOffset`, `saturationOffset`, `svgExport`, `patternLayers`, `patternPaletteIdx`, `crop`, `exportSettings`, `hatchBrush`, `hatchify`, `plotter`, `apparel` | `TrixelGrid` |
| `trixel-selections` | Array of `SelectionSnapshot` | `TrixelGrid` |

`ProjectSnapshot` — the unit of undo, of `trixel-save`, and of the saved project file (see "Project file") — is `{ layers, activeLayerIdx, gridDivisions, hexMode, flowerRadius, symmetry, selections, patternPresets, lastPaintTri }`. Adding a field means updating **every** literal that builds one (TypeScript finds them) *and* the dependency array of the effect that writes `trixel-save`, or the value will live in memory and never persist.

The **split matters**: `trixel-settings` is view state, `ProjectSnapshot` is authored content. A few `trixel-settings` entries describe the *document* and so are copied into the saved project file as well — see "Project file". Pattern *layers* (the live stack you are editing) are a setting; pattern *presets* (saved slots) travel with the project, like stamp selections.

- Legacy migration: boolean `hexMode` → string `HexMode`, boolean `symmetry60` → string `Symmetry`
- **The first edit on a fresh document cannot be undone.** `useHistory` starts at `historyIdx = -1` with an empty stack, so one commit lands at `0` and `handleUndo` bails on `historyIdx <= 0` — there is no snapshot of the empty state to return to. Pre-existing for every tool; do not mistake it for a missing `pushHistory`.

## Project file

A saved project is **`{slug}.trixel.svg`** — a real SVG that draws the artwork, with the project's JSON embedded in it. `src/lib/project-file.ts` owns the format; `svg-export.ts` and the importer's migration path do the actual work.

**The point is the thumbnail.** A `.json` project is an opaque blob in a file browser; an SVG is rendered by Finder and Nautilus (**not** by Windows Explorer, which has no native SVG thumbnailer), so the user sees their piece in the folder listing. Verified end-to-end by running the real macOS thumbnailer (`qlmanage -t`) over a saved file.

**A container swap, not a data change.** The payload is the same object the `.json` format held — a `ProjectSnapshot` plus `name`, `svgExport`, `version` — so the whole legacy migration block in `handleFileChange` (`normalizeHexMode`, the flat-`painted` wrap, the `symmetry60` branch) serves both containers unchanged, and old `.json` files load forever. It gained three fields that `trixel-settings` also holds but which describe the **document** rather than the workspace, so they have to travel with it: `hueOffset`/`saturationOffset` shift every *resolved* colour, and `gridOrientation` turns the whole lattice a quarter turn. Without them a project reopens looking unlike the thumbnail inside its own file.

**Loading applies the grid settings; undo does not.** Divisions, hex mode, flower radius and symmetry are in `ProjectSnapshot`, so they were always *written* to the file — but nothing applied them on load, and a modern file opened onto whatever grid happened to be on screen (only the legacy `data.settings` branch ever set them). The importer now applies them from the snapshot. This is deliberately **not** symmetric with `registerRestore`, which still leaves them alone so that changing a setting between strokes is not rolled back by `Ctrl+Z`: opening a document and stepping through its history are different acts. `gridOrientation` is not in `ProjectSnapshot` — adding a field there means touching every literal that builds one, and undo would ignore it anyway — so it rides with the payload's other document-level view state.

`readProjectFile` returns the payload **as text**, not parsed. The importer reads some thirty properties off an untyped `data`; handing it a typed object would mean a cast at every one of them, and a legacy file then takes byte-for-byte the path it always did.

**Two independent version numbers.** `version` on the `<trixel:project>` element is the *envelope* — where the payload lives and how it is encoded; a reader that sees a higher one refuses, because it structurally cannot decode it. `version` *inside* the JSON is the *content*. Moving to compressed base64 would bump the first and leave the second alone. The namespace URI is deliberately **unversioned**: putting a version in it makes every older reader fail to find the element at all.

**`generateSVG` gained `background` and `metadata` options** rather than the project module string-splicing into its output. Both absent ⇒ byte-identical output, so the artwork export is untouched. The reason to prefer options is `EMPTY_SVG`: it is **self-closing**, and a project with nothing painted but selections saved is entirely reachable, so a naive splice would produce either a project file containing no project or corrupt markup. All three exits now route through one `wrap()`, which makes that case structural instead of a regex special-case.

**The `]]>` guard is at the JSON level**, not a split CDATA section: `json.replace(/\]\]>/g, "]]\\u003e")`. A user can type `]]>` into a project or layer name. `\u003e` is a valid JSON escape that parses back to the identical character, so nothing has to be unescaped on read — and the file stays a **single** CDATA section, which is what keeps the regex fallback exact. Safe because `]]>` can only occur inside a string literal: nothing structural may follow a `]` except `,`, `]`, `}` or whitespace.

**Reading is DOM-first, regex second.** `DOMParser` looks the element up **by namespace URI, not prefix** (a foreign tool may rename `trixel:` to anything) and its `textContent` reads CDATA, escaped text and multiple adjacent sections identically. Only when the document is malformed enough that `DOMParser` refuses does a regex go after the payload directly — a broken `<path>` is no reason to lose a project. Construct the `DOMParser` **inside** the function: the app statically exports, so client components are prerendered in Node at build time and a module-scope `new DOMParser()` breaks the build. The parsed document is inert and only `textContent` is read out; keep it that way if a preview of the loaded file is ever added.

The drawing is always `{ stroke: true, merge: true }`, not the user's `svgExport`: merging is the biggest size lever and same-colour strokes close the antialiasing seams between abutting fills, and a project file's bytes should not change because someone toggled a checkbox in an unrelated export dialog. `buildProjectSVG` draws `payload.layers` rather than taking the artwork as a second argument, so a file whose thumbnail disagrees with its data is unrepresentable; hidden layers are skipped by `buildRenderPlan`, so the picture shows what the canvas shows while the payload keeps everything.

Re-saving a project SVG from another editor is **lossy and unsupported** — Inkscape rewrites `<metadata>` with its own RDF and may not preserve foreign children. The reader searches the whole document rather than only under `<metadata>`, which mitigates a relocation but not a deletion.

The two menu items are "Save Project" (`.trixel.svg`, reloadable) and "Export Image (SVG)..." (`.svg`, not reloadable) — both write SVG now, so the labels have to say which is which.

### Example projects

`public/examples/*.trixel.svg` are ordinary project files saved by the app — not a separate format and not generated at build time, so a new one is added by drawing it, saving it into that folder and adding a line to `EXAMPLES` in `src/lib/examples.ts`. They live under `public/` because Next only serves that directory; they are fetched at runtime, never bundled.

**The thumbnails are the project files themselves.** A `.trixel.svg` draws its own artwork, so `<img src>` pointed at the very file that is about to be loaded *is* the preview — no generated thumbnails to keep in sync, and what the user clicks is exactly what they see.

`exampleUrl` prefixes `NEXT_PUBLIC_BASE_PATH`, set in `next.config.ts` from the same constant as `basePath`. This is load-bearing on GitHub Pages: `basePath`/`assetPrefix` rewrite framework assets and `<Image>` URLs but **not** a runtime `fetch()` or a plain `<img src>`, so an absolute `/examples/...` would 404 under `/trixelart/`.

`ExampleGallery` is presentational and used twice: as a labelled row on the splash (`compact`) and as a grid in the "Load Example..." dialog. On a first visit the canvas is empty, and "here is what this makes, click one" says more than the blurb can — hence thumbnails on the splash rather than another button. Loading pushes to history like any import, so it needs no confirmation: `Ctrl+Z` brings the previous work back.

The importer is split for this: `loadProjectText(text, label)` holds the container sniff, the version branch and every legacy migration, and `handleFileChange` is now just a `FileReader` wrapper around it. Both entry points arrive with the same thing — the text of a project file — so neither path can drift from the other.

## Key modules

| Module | Purpose |
|---|---|
| `src/lib/grid-math.ts` | Triangular grid coordinate system (`SIDE=50`, `H`, `worldToTri`, `getTriVertices`, `getTriPath`, `getTriABC`, `getTrianglesOnLine`) |
| `src/lib/hex-flower.ts` | Hex geometry, flower offsets, symmetry paint targets, selection snapshots (`triToHex`, `flowerOffsets`, `rotateTrixelCCW`, `hexCenterWorld`, `enumerateHexTrixels`, `hexTranslation`, `paintTargets`, `captureHexSnapshot`, `hexCenterTriAxial`) |
| `src/lib/config.ts` | Zoom/pinch constants (`ZOOM_MIN`, `ZOOM_MAX`, `WHEEL_DIVISOR`, `PINCH_SENSITIVITY`) |
| `src/lib/constants.ts` | `PALETTE_DEFS` (14 palettes × 9 lightnesses), `encodeColor`/`decodeColor`/`resolveColor`, palette shifting |
| `src/lib/tools/` | One module per tool + `types.ts` (`Tool`, `DragState`, `ToolContext`, `ToolHandler`) and `index.ts` (`toolMap`) |
| `src/lib/crop.ts` | Lattice-snapped export crop (`CropRect`, `cropWorldBounds`, `cropDisplayBounds`, `fitCropToPainted`, `hitTestHandle`, `applyCropDrag`). Pure, no DOM |
| `src/lib/png-export.ts` | Raster export: `renderCropToCanvas`, `renderCropPreview` (3×3 tiling), `cropPixelSize`, `drawArtworkPlan` (the shared world-space draw loop), 40 MB limit |
| `src/lib/round-corners.ts` | Corner-rounding effect: `regionRings`, `boundaryVertexDegrees`, `roundRing` (degree-2 test) / `roundPolygon` (geometry + run clamp, no eligibility policy), `roundedRegions`, `ROUND_RADIUS_AT_FULL`, `traceRoundedRing` (canvas) / `roundedRingToPath` (SVG) / `flattenRoundedRing` (clipping). Pure, no DOM |
| `src/lib/region-outline.ts` | Region boundaries shared by the plotter and apparel exports: `outlineSegments` (+ `silhouette` option), `joinRuns` (1-D interval union + mask subtraction), `segToPoints`, `edgeDir`, `RawSeg`. Pure, no DOM |
| `src/lib/apparel-export.ts` | PNG-with-alpha garment export: `artworkBounds`, `apparelPixelSize` (row snap + `EDGE_PAD`), `apparelCutSegments`, `cutPieceReport`, `renderApparelToCanvas`, `renderApparelPreview`. Pure except the `render*` functions |
| `src/lib/tri-pattern.ts` | Pattern brush maths: `triPatternValue`, stack compositing, OKLab palette quantization. Pure, no DOM |
| `src/lib/hatch.ts` | Hatch maths: `encodeHatch`/`decodeHatch`, `hatchU`/`hatchStep`, `hatchLinesInBox` (+ `HatchAlign`), `clipSegmentToTriangle`, `clipSegmentToRect`, `groupHatchMarks`, `rotateHatchValue`/`flipHatchValue`, `mapEncodedColor`. Pure, no DOM |
| `src/lib/hatch-render.ts` | `buildRenderPlan` (the shared bottom-to-top layer walk), `drawHatchLayer` for canvas, `hatchStrokes`/`hatchStrokesBounds` for SVG |
| `src/lib/hatchify.ts` | Convert-to-hatches maths: `hatchify`, `WEDGE_DIR`, `reduceLevels`, `HatchifySettings`. Pure, no DOM |
| `src/lib/hatchify-render.ts` | `renderHatchifyPreview` — fits a trixel set to a canvas and runs the GridCanvas draw loop |
| `src/lib/plotter-export.ts` | Single-pen plotter export: `buildPlotterPlot`, `plotterDensities`, `plotterLayout` (page/margin/fit), `plotterSVG`, the interval union + outline subtraction, travel ordering. Pure except `renderPlotterPreview` |
| `src/lib/pattern-render.ts` | Canvas rendering for pattern previews, thumbnails and palette slots |
| `src/lib/project-file.ts` | The `.trixel.svg` project format: `buildProjectSVG`, `readProjectFile`, `projectFileName`, the CDATA guard. Pure except `readProjectFile` (`DOMParser`) |
| `src/lib/examples.ts` | The bundled example projects: `EXAMPLES`, `exampleUrl` (basePath-aware), `fetchExample` |
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
- `LayerKind = "fill" | "hatch"`, `Layer`, `LayerEffect`, `RoundCornersEffect` — `src/hooks/use-history.ts`
- `Ring`, `RingPoint`, `RoundedRing`, `RoundedCorner`, `RegionRings` — `src/lib/round-corners.ts`
- `HatchBrush`, `HatchDir`, `HatchAlign` — `src/lib/hatch.ts`
- `HatchifySettings`, `HatchifyMode`, `HatchifyResult` — `src/lib/hatchify.ts`
- `PlotterSettings`, `PenMode`, `PageSizeId`, `PlotterLayout`, `PlotterPlot`, `PlotterStroke` — `src/lib/plotter-export.ts`
- `RawSeg`, `OutlineOptions` — `src/lib/region-outline.ts`
- `ApparelSettings`, `ArtworkBounds`, `ApparelSize`, `ApparelView`, `CutPieceReport` — `src/lib/apparel-export.ts`
- `CropRect`, `CropHandle` — `src/lib/crop.ts`
- `ProjectPayload`, `ReadResult` — `src/lib/project-file.ts`
- `ExportSettings` — `src/components/ExportPanel.tsx`
- `PatternLayer`, `PatternPreset`, `PatternBlendMode`, `QuantizeTarget` — `src/lib/tri-pattern.ts`

## Notable

- Deployed to GitHub Pages via `.github/workflows/pages.yml` (static export; `GITHUB_PAGES=true` sets `output: export` + `basePath` in `next.config.ts`)
- Remote image patterns configured for `placehold.co`, `images.unsplash.com`, `picsum.photos`
