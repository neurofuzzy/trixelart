# Grid & canvas rendering

> Detail doc. Index and the rules that apply everywhere: [CLAUDE.md](../CLAUDE.md). Module/symbol map: [CODEMAP.md](../CODEMAP.md).

## Canvas rendering

- `GridCanvas` uses a `<canvas>` element with DPR scaling (not SVG)
- Triangles are batch-filled by color, grid outlines batched into single stroke
- `getTriVertices(q, r, type)` returns raw vertices; `getTriPath` wraps them into an SVG path string

## Hex grid system

- **HexMode**: `"world"` | `"honeycomb"` — set in the Grid Settings panel. `normalizeHexMode` (`Footer.tsx`) maps the legacy values (`true`/`false`, `"off"`/`"outlines"`/`"centers"`) onto these, so old saves keep working
  - `world`: no honeycomb — no hex outlines, and the hex lattice stops constraining the tools
  - `honeycomb`: flat-top honeycomb outlines, and hex-snapped tools
  - `hexEnabled` (`gridDivisions > 0 && hexMode !== "world"`) is the flag the tools read, on `ToolContext`. It gates the flower, hex-wedge brush, symmetry, and the snapping of the stamp and the hex selection
- **Grid divisions** (N): controls hex lattice spacing; slider in Grid Settings modal. When `N>0`, draws division guides (horizontal, `/`, `\` diagonals)
- **Flower radius** (R): hexagonal flower of trixels around a painted tri, cycled in Footer (disabled when `gridDivisions=0`)
- **Symmetry**: `"off"` | `"sym60"` | `"sym120"` — rotational symmetry for painting, cycled in Footer
  - `sym60`: 6-fold (60°) rotation
  - `sym120`: 3-fold (120°) rotation
  - `paintTargets()` in `hex-flower.ts` expands painted trixels into symmetry+flower copies
- **Selection snapshots** (the stamp palette, distinct from the hex *selection* below): capture all painted trixels within a hex; stored in `SelectionPalette` for stamping
  - `SelectionSnapshot { id, N, c, k, trixels: [{ dq, dr, type, color }] }`
  - `captureHexSnapshot(painted, c, k, N)` captures a stencil
  - `hexTranslation(sc, sk, dc, dk, N)` maps trixel offsets from source hex to destination hex
  - `enumerateHexTrixels(c, k, N)` returns all trixels in a hex (6N² triangles)
  - **Where a stamp lands is `placementAnchor(tri, N, hexEnabled)`**, read by both the commit (`stamp-tool.ts`) and the canvas ghost, or the two drift apart. In honeycomb mode it snaps to the hex centre under the cursor and the stamp *replaces* that hex — the destination trixels are cleared first, and a snapshot whose `N` differs from the current one is refused, because neither would tile. In world mode there is no hex to snap to or replace: the anchor is the hovered trixel, only the snapshot's own cells are written, and any `N` is accepted since the offsets are plain tri-axial deltas. Trixel resolution is the finest a stamp can be placed at either way — only whole `(dq, dr)` translations preserve triangle orientation
  - The white **hexagon** hover outline in `GridCanvas` is centred on the same `placementAnchor`, not on the hovered hex, so it frames the contents about to be placed in either mode. `latticePoint(qc, rc)` (`grid-math.ts`) turns the anchor into world space — it agrees with `hexCenterWorld` exactly when the anchor is a hex centre, which is what keeps honeycomb mode unchanged. In world mode it is sized by the snapshot's `N` rather than `gridDivisions`, since those need no longer match and the lattice may be off entirely
  - Capture (ALT-click, or the palette's `+`) still needs `N > 0` in both modes: the hex under the cursor is what defines the captured region — so capture keeps its dashed amber hexagon and its yellow `stampFlash` in world mode too

### The hex selection: `HexRegion`

The selection is **a list of `HexRegion`, not of `(c, k)` hex coordinates**
(`hex-flower.ts`). A region is `{ qc, rc, N }`: where the hexagon's centre sits
in tri-axial coordinates, and how big it is. `(c, k)` could only ever name a hex
of the global honeycomb, which is exactly the constraint world mode drops — the
size and shape stay hexagonal, the anchor is free.

- `placementAnchor` decides a **fresh** selection's anchor, the same call the
  stamp makes: the hex centre under the cursor in honeycomb mode, the clicked
  trixel in world mode.
- A hex **joining or leaving** an existing selection is placed on that
  selection's own lattice, via `regionContaining(tri, N, selection[0])`. The
  honeycomb tiling is invariant under any whole `(dq, dr)` shift, so a
  free-anchored selection still tiles edge-to-edge; only a fresh selection
  re-anchors. Verified: regions of a shifted lattice partition the plane with no
  overlap, and each holds 6N² trixels like any hex.
- Every consumer that treats the selection as a **boundary** goes through
  `regionMembership(regions)` — fill, ALT-erase, `clippedLine`, the paint-target
  clip in `use-interaction`, `clipLayersToSelection` (the selection-only
  exports, see [exports.md](exports.md)) and the move-to-new-layer split. None
  of them knows the lattice may be shifted.
- Every consumer that **operates on** the selection takes a region:
  `regionTrixels`, `rotateHexCW`/`CCW`, `flipHexVertical`/`Horizontal`,
  `remapHex`, `shiftHexPalettes`, `hatchify`. Because a region carries its own
  `N`, the outline on screen and the cells an operation touches cannot disagree
  — including after `gridDivisions` changes under a live selection, where the
  selection now keeps the size it was made at instead of silently resizing.
- **Dragging** translates the contents by `(dq, dr)` and the outline with them.
  In honeycomb mode the outline then re-snaps to the lattice, as it always has,
  through `nearestRegion(qc, rc, N)` — a cube-rounding of the moved anchor
  itself rather than of a triangle centroid. The old code re-snapped by feeding
  the moved world point to `worldToTri`, which is ambiguous at a hex corner (the
  usual case) and disagreed with the nearest hex in ~4.5% of drags.

### Move the selection to a new layer

The last button of `SelectionPalette` lifts everything the selection covers off
the **active** layer into a layer of its own. It asks for the layer's name first
(`NameLayerDialog` — see [ui.md](ui.md)), then
`splitLayerAt(layers, idx, moved, name)` (`use-history.ts`) is the whole
operation, as a pure function over the array.

- **The new layer goes directly above its source**, and inherits its kind, its
  visibility and a deep copy of its effects. All four say the same thing: a
  split must not change what the composite looks like. Anywhere else in the
  stack, a different kind, or a different effect list, and it would. Verified:
  the exported SVG's element set is unchanged by a split, differing only in the
  emission order of non-overlapping cells.
- It returns **null** rather than an array when there is nothing painted inside
  the selection or the stack is already at `MAX_LAYERS`, so the caller makes no
  edit and pushes no history entry. The button is disabled on the second of
  those; the first is only knowable after walking the layer.
- Two layers change at once, which is why this cannot go through `setPainted` /
  `snapshotWithPainted` — those address only `layers[activeLayerIdx]`. Like
  `applyHatchify` it rebuilds the array and pushes **one** snapshot, so the
  cells leaving one layer and arriving in the other undo together.

## Grid coordinate system

- Axial `(q, r)` with triangle type (`up`/`down`) identifies each triangle
- Analytical `(a, b, c)` for symmetry formulas: up triangles satisfy `a+b+c=0`, down satisfy `a+b+c=-1`
- Canvas rendered via `getTriVertices(q, r, type)` for direct vertex coordinates
- Hex coordinates: `{ c, k }` — cube-based hex addressing

