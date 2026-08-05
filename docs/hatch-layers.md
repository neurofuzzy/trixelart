# Hatch layers

> Detail doc. Index and the rules that apply everywhere: [CLAUDE.md](../CLAUDE.md). Module/symbol map: [CODEMAP.md](../CODEMAP.md).

A **second layer kind** holding line work instead of fills, so hatching composites over flats the way an inker works. `Layer.kind` is optional and **absent means `"fill"`** — read it through `layerKind(l)` (`use-history.ts`), never `l.kind` directly, and every pre-existing save, project JSON and history snapshot keeps working with no migration.

**Three directions**, one per grid-line family, each the level set of a linear functional `u` (`hatchU`): `y` (horizontal), `x − y·SKEW` (`/`), `x + y·SKEW` (`\`). All three have perpendicular spacing exactly `H`, so density `k` steps `u` by `H/k` for family 0 and `SIDE/k` for the other two. Lines sit at `(n + ½)·step`: **the half-step offset is load-bearing** — without it density 1 lands exactly on the triangle edges and draws nothing inside. With it, `density` reads as *lines per triangle*.

`u` is a pure function of world position, so the line field is **global** — trixels hatched in separate strokes line up as continuous lines rather than per-triangle tufts. Same reasoning as the pattern brush, and the same obvious failure mode.

**Storage.** Hatch marks live in the *same* `painted` map as fills, encoded `"dirMask|density|weight|paletteIdx,colorIdx"` (e.g. `"5|3|2|0,8"`; dirMask 1/2/4, so 5 = horizontal + `\`). Reusing `painted` is what makes it cheap — `setPainted`, undo, `trixel-save`, project JSON, and layer duplicate/delete/reorder/visibility all work unchanged. **The pipes are load-bearing**: a fill value is `"p,c"` with exactly one comma and no pipes, so `decodeColor` returns `null` on a hatch value and every existing decode site rejects it structurally. Palette shifts route through `mapEncodedColor` so the arrow keys shift the colour *inside* a mark and leave direction, density and weight intact.

**Rendering** — one shape, two backends, both driven by `buildRenderPlan(layers)` so hatch interleaves with fills in z-order. Canvas (`GridCanvas`, PNG export): one `ctx.clip()` over the group's triangles plus one stroke of the whole line family — the shared clip is what makes lines continuous across trixel boundaries, and the cost is per *line on screen*, not per mark × density. SVG: `clipSegmentToTriangle` clips each line to each triangle into real `<line>` elements, consistent with the crop exporter's refusal to use `<clipPath>`. That clipper derives each half-plane's inside sign **from the third vertex** — `getTriVertices` returns opposite windings for the two triangle types, which is also why `svg-export.ts` carries `ensureCW`.

**Lock-out.** `isToolAllowed(tool, kind)` (`tools/types.ts`) is the single source of truth, enforced once by wrapping `setTool` as `changeTool` in `TrixelGrid`, so the toolbar, keyboard, `1`–`9`, the eyedropper and the right-click pick are all covered without per-call-site wiring. Colour-writing tools (paint, fill, pattern, stamp, clone, dodge, burn) are blocked on a hatch layer; erase, pan, select, eyedropper and crop stay available on both. An effect keyed on the *kind* — not on `layers`, so it doesn't re-fire per stroke — moves to a usable tool on layer select, add, delete, reorder, undo/redo and project load alike.

Select **is** allowed: `rotateHatchValue`/`flipHatchValue` permute the direction mask alongside the geometry (a 60° rotation is a 3-cycle on the bits), so rotating a hatched selection carries its angles round with it.

**UI.** Deliberately *not* a drawer — hatch has four scalars and a colour, not a stack to edit, and it reuses the controls the app already has:

- The `+` in `LayerPanel` is a dropdown ("Normal layer" / "Hatch layer"); each row carries a kind icon.
- **Hatch is not in `editTools`.** It takes over the Paint slot via `brushTool(kind)` in `Toolbar.tsx`, so the toolbar shows *one* pencil that means Paint on a fill layer and Hatch on a hatch layer. Two pencils side by side, one of them permanently disabled, is worse than one button that changes meaning — so hatch is the documented exception to the "add the tool to `editTools`" rule in [CLAUDE.md](../CLAUDE.md#tools). It is still in `isEditTool`.
- The ordinary `ColorPalette` swatch row drives the hatch brush, pointed at the brush's **own** palette (`hatchPaletteIdx`, derived from `decodeColor(hatchBrush.color)`) rather than the paint palette — otherwise an eyedropper pick landing on a mark authored elsewhere highlights the wrong swatch, or none. `1`–`9` must encode against the same index for the same reason.
- `HatchBar` is a footer-sized strip overlaid at the bottom of the canvas holding the three direction toggles and the density and weight sliders. Keyed on `activeLayerKind`, not `tool`, so it doesn't flicker away when the user reaches for erase; `ColorPalette` takes `raised` to clear it on small screens.

Brush settings are view state → `trixel-settings`, not `ProjectSnapshot` (same split as the crop rect).

3D-print and cutting exports take `mergedFillPainted`, which filters hatch layers out — hatch lines have no meaning as an extruded body or a cut path.

## Convert to hatches

Re-renders existing flat colour as line work: reads the merged fills **below** the active hatch layer, inside the hex selection, and writes a whole selection's worth of marks in one undoable step. `src/lib/hatchify.ts` is the maths (pure); `HatchifyDialog` is the UI; the button lives in `HatchBar` and shows only under Select with a live selection.

**Direction is concentric.** `hexWedgeIndex` already gives the 0–5 sector; `WEDGE_DIR = [2, 0, 1, 2, 0, 1]` (i.e. `(w + 2) % 3`) picks the family running parallel to that wedge's outer hex edge, so the marks nest as rings rather than one uniform screen. Hexes are flat-top, so vertices sit at 0°, 60°, … and wedge `w`'s edge runs at `60w + 120`; the families run at 0°, 60°, 120°. **Derive from `hatchU`, never from `DIR_LABEL`** — the slash/backslash naming is inverted relative to screen space because world y points down. An off-by-one here silently destroys the concentric look; a correct run over one hex splits its marks evenly across all three families (18/18/18 at N=3).

**Density** comes from `colorIdx` alone (`a = 1 − colorIdx/8`, index 0 being the darkest swatch), mapped onto the dialog's min/max. Deliberately *not* perceptual lightness — simple and predictable, at the cost that the four custom-lightness palettes top out at 68% yet still map to the minimum.

**`densitySkip` exists for pen plotting.** Lines sit at `(n + ½)·base/density`, so two densities share lines exactly when their **ratio is odd** — 1 and 3 share, 1 and 2 share nothing, 4 shares with nothing but itself. So when every reachable density is *odd* they all contain the density-1 ladder, and those coarse lines run unbroken across the whole selection: a plotter draws them in one pass instead of lifting the pen at every tone change. `reachableDensities` returns the ladder plus an `allOdd` flag, and the dialog reports which case you are in rather than leaving it to be discovered. Odd `minDensity` + even skip is the combination that guarantees it (min 1, skip 2 → `{1,3,5,7}`). Rounding happens in **step units**, not on the raw density then snapped — snapping afterwards lets a value land off the ladder and quietly breaks the property.

**Reduce mode** collapses the 9 tones to `K` representatives `L[j] = round(j·8/(K−1))` and dithers between adjacent levels. **The fill takes the *lighter* neighbour and the ink the *darker* one** — this is load-bearing. Only that pairing averages back to the original tone; snapping the fill down *and* hatching darker over it drives the whole selection toward black. Verified: reconstructed lightness tracks the original within ~1–3% at every `K`. Chunking is per palette, so hue is preserved.

Reduce writes to layers *other* than the active one, so `applyHatchify` rebuilds the whole `layers` array and calls `pushHistory` directly — `setPainted`/`snapshotWithPainted` only address `layers[activeLayerIdx]` and cannot express it. Each requantised fill goes back into the topmost visible fill layer below that already held that trixel, i.e. the one that won the merge. Still one action, one history entry.

The selection is cleared wholesale before the new marks are merged, so re-running with different settings replaces rather than accumulates. Settings are view state → `trixel-settings`, like the brush.

