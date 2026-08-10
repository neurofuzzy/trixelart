# Interlocking ("weave") cutting export

Export menu → **Interlocking...**. Every painted cell becomes one flat piece:
the cell's own triangle, with three half-size triangles protruding, in a
pinwheel. The tabs slide **under** the neighbouring pieces, so the assembled
mosaic shows the artwork and nothing else. No glue, no joinery, no weeding.

A sibling of [the cutting export](fabrication-export.md), not a mode of it. That
one stacks a sheet per colour level and fastens them with folded tab-and-slot
joints (`cut-export.ts`, `cut-joints.ts`, `cut-svg.ts`, `cut-mesh.ts`). This one
shares none of that and is deliberately isolated, so it can be kept, dropped, or
promoted without disturbing the stack export.

| Module | Holds |
|---|---|
| `src/lib/interlock-geometry.ts` | The tile: templates, the two placements, tabs |
| `src/lib/interlock-export.ts` | Plan, nesting, mats, SVG, preview |
| `src/components/InterlockDialog.tsx` | The modal |

## The tile

| | |
|---|---|
| Core triangle edge | `SIDE` — the artwork cell itself |
| Tab edge | `SIDE/2` |
| Piece outline | 9 segments, no internal lines |
| Card per cell of picture | **1.75×** |
| Distinct shapes in the export | **2** — the up-cell piece and its 180° rotation |

**The tabs are hidden, and that is the whole idea.** A piece's core is the cell
at full size, and its three tabs reach out under its three neighbours. Every cell
therefore covers the three tabs reaching *into* it — one per edge, landing on its
three corner sub-triangles — with its own core. So the built mosaic is the
artwork: no seams in the wrong place, no rotation, nothing to look at that was
not on the canvas. The only tabs ever seen are the ones on the outer border, with
no neighbour to hide under, and those are what the backing's slots take.

The cost is material, not looks. The tabs are overlap rather than tiling, so a
piece is 1.75 cells of card for one cell of picture.

## Two placements

The same shape is laid down two different ways, and confusing them is the
mistake the code comments are written to prevent.

- **`"assembled"`** — the core sits exactly on its artwork cell, at fine base
  `(2q, 2r)`. Pieces overlap. This is what the thing looks like built, and what
  the assembly map, the mats and the preview are measured against.
- **`"nested"`** — the packing on the cut sheet, where the pieces *tile*: no
  overlap, no gaps, every internal line shared with a neighbour, so a sheet cuts
  in one pass with nothing to weed. Fine base `(3q + r, −q + 2r)`.

The nested tiling is **not the artwork's lattice**, and that is forced. A
triangle with three half-tabs has the area of 7 half-cells; 7 is a norm in the
triangular lattice; so the pieces tile a `√7`-scaled, `19.1066°`-rotated copy of
the half-cell lattice. That is why a nested sheet looks like a twisted pinwheel
mosaic while the assembled artwork looks like the artwork. Anything that reasons
about rows, shear or neighbours has to pick a placement and stay in it — a window
written for the artwork lattice lands somewhere else entirely in nest space and
admits nothing.

Both placements are pure translations of the same two template outlines, because
both fine bases are integer combinations of the artwork lattice's own basis
vectors. `pieceOutline` traces twice in the life of the module and then only
adds; tracing per piece was the slow part of the export.

### Working on the fine lattice

The tile is built on a **fine lattice** — the ordinary lattice at half scale, no
rotation — where the core is a side-2 triangle and each tab is one cell. Being an
ordinary lattice, none of the machinery needs a second version: fine cells are
ordinary `TriKey`s, they go through the ordinary `traceUnionLoops`, and only the
points that come back are halved. **Reaching for a second boundary tracer here is
the wrong move.**

`assertTiles` guards the nested placement on every plan. A broken tiling is
otherwise **silent**: the SVG still draws, the pieces simply do not fit, which is
only discoverable after cutting. It says nothing about the assembled placement,
where pieces overlap on purpose.

## Nesting

Only two shapes exist, so a colour's sheet is not a picture of anything — it only
needs the right *count* of each orientation. Pieces are packed into a patch of
the tiling and the maps say where they go.

The sheet rectangle is chosen first, in world units, and the `(Q, R)` range is
derived from it by inverting the tiling basis. Candidates are ordered by **banded
y, then x** — not raw y, because an up piece and the down piece beside it sit at
slightly different heights, so exact-y ordering runs every up in a band ahead of
every down and a block then has to overshoot badly on one orientation to collect
enough of the other.

Each sheet restarts at the same corner, because each sheet is a fresh piece of
card. A block is filled until *both* needs are met; the overshoot is reported as
spares rather than cut around, since cutting around it would put a ragged free
edge through the block and hand back the weeding this export exists to avoid.

## Mats

- **Backing — solid, no window, only slots.** Every tab but the outermost is
  already hidden under a neighbouring piece, so there is no fringe for a window
  to clear: the assembled mosaic's visible edge *is* the artwork's plain
  silhouette. What the border tabs need is somewhere to go, and that is a slot —
  one per exposed tab, along its root half-edge and standing a little outboard of
  it, the same arrangement `cut-joints.ts` uses for a folded tab. Cutting a
  window instead would remove exactly the paper the border pieces rest on.
- **Top mat — the cut export's mat, unchanged.** A frame at `MAT_BORDER`
  (`1.6 · SIDE`, matching `FRAME_MARGIN_SIDES`) whose window is the plain
  silhouette. It needs no inset, because nothing pokes out past that silhouette
  once the slots have taken the border tabs.

`exposedTabs` is the one function that decides which tabs are visible: a tab
whose named neighbour is unpainted. It is also what makes interior holes work —
an unpainted cell inside the artwork exposes the tabs around it, and gets slots
like any other border.

## Two decisions

**No corner rounding.** [CLAUDE.md](../CLAUDE.md) says round corners is the one
effect every fabrication path honours, so the exception needs a reason. Here the
outline is not a silhouette: on a nested sheet every segment is a **cut line
shared between two pieces**, convex to one and concave to the other. Rounding is
only consistent at degree-2 vertices of the piece graph — the rule
`boundaryVertexDegrees` already encodes — and at the degree-3 vertices where
three pieces meet it is undefined. Deferred, not overlooked. This path also does
not run `buildRenderPlan`, like the other fabrication paths.

**Kerf is the clearance.** Cut lines are shared, so a blade or laser takes its
kerf once from between two pieces and both come out slightly undersized: a slide
fit, for free. The `clearance` setting exists only for zero-kerf drag knives, and
raising it splits every shared seam into two cuts and gives up the single-pass,
zero-waste property. It defaults to 0 and the dialog says so.

## Output

One SVG, Inkscape layers:

- `Sheet n — #rrggbb` — one per nested colour block, filled in that colour *and*
  stroked with the deduplicated cut path. The fill is how a sheet is identified
  at a glance; it has to be per piece, because the cut path is a set of open
  polylines and an open polyline has no inside.
- `Backing mat` — the solid silhouette, with the slots as a stroked line set.
- `Top mat` — the outline frame.
- `Assembly map` — the artwork as built: whole pieces first, then every cell's
  plain triangle over the top. That second pass is what buries the tabs, and it
  leaves exactly the border tabs showing.
- `Puzzle map` — the same pieces on the tiling, each one whole and in its right
  relative place. The view to count from, and the one that shows what a piece
  actually looks like.

Fills use **non-zero**, not even-odd; only the mats use even-odd, to punch their
window. Even-odd on overlapping pieces of one colour cancels them against each
other, which turned the first assembly map into lace.

The mats and both maps share one measuring box so they stay in register — a mat
window is only checkable by laying it over a map. Nested sheets are measured on
their own.

`NO_PRINT` and anything else that fails `decodeColor` is skipped, so it becomes a
hole in the mosaic and is slotted like any other border.
