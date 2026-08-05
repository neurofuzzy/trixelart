# Layer effects

> Detail doc. Index and the rules that apply everywhere: [CLAUDE.md](../CLAUDE.md). Module/symbol map: [CODEMAP.md](../CODEMAP.md).

Non-destructive per-layer filters — three of geometry and one of colour.
`Layer.effects` is optional and
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
list so further effects can be added without re-plumbing; today there are four
(round corners, outline, glow and adjust colour) and all four may sit on the same
layer. Hatch layers are excluded — line work has no filled region to reshape, and
the colour filter follows them out rather than being the one effect with a
different eligibility rule.

`activeEffects` **switches on the effect type** rather than testing one field.
It used to be a two-way ternary; a third effect with two scalars broke that, and
the switch is what keeps "an effect that reduces to nothing renders
byte-identically to no effect" true for each type's own definition of nothing.

## Round corners

Replaces each corner of a contiguous same-colour region with a circular arc.
`src/lib/round-corners.ts` is the maths (pure); the UI is an Effects section in
the Layers drawer under the selected fill layer. All four effects share one row
shape driven by `EFFECT_SLIDERS`, so a new one is a table entry rather than a
branch — the geometry effects are 0–1 fractions shown as a percentage and colour
adjust carries its own signed range, which is the only reason that table has a
range at all.

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

**Rendering** — one shape, three backends, all driven off `ringTangents` so they
cannot disagree about where an arc begins. The arc's centre and sweep are
recovered from the two tangent points (`cornerArc`); canvas draws it with `arc`
from the entry tangent, SVG emits explicit `A` commands with the sweep flag taken
from the turn direction, and the cropped SVG flattens arcs to chords first,
because an arc cannot survive Sutherland–Hodgman and that exporter clips for real
rather than hiding overflow behind a `<clipPath>`. Canvas deliberately avoids
`arcTo`: it re-derives the tangent distance from the corner, and where the run
clamp has pulled the tangent points inward it adds a connecting line that doubles
back along the edge — a hairpin sliver of the very curve the corner was meant to
be.

## Outline

Swaps a fill layer's solid for a stroke of each region boundary at a selected
weight; the interior stays empty. It takes **the same region rings as corner
rounding** (`regionRings`), and the two effects compose: an outlined layer with
a round-corners effect strokes the *rounded* rings. `stepRegionGeometry` in
`round-corners.ts` returns the rings for either case as a single shape (plain
rings carry `radius: 0` corners), so the renderers trace/stroke/fill one path —
they never branch on whether the outline is rounded.

The weight is a 0–1 fraction of `OUTLINE_WEIGHT_AT_FULL` = `SIDE`, stored as a
fraction for the same reason as `radius` but denoting an absolute width, the same
at every edge. A zero weight is a no-op: `activeEffects` drops it and the layer
renders solid, byte-identical to no effect. Strokes join with `round`, which lands
exactly on the stroke edge; a miter at the lattice's sharp 60° corners pokes ~2×
past it (miter ratio 2), and beveling the same corner cuts back to the stroke's
midpoint — both wrong for a uniform-width outline. Because two adjacent regions'
outlines overlap at their shared boundary (each stroke is centred on it), the
rings are drawn in a deterministic colour order — `regionRings` sorts by encoded
colour index, then palette, so a lighter region's outline wins over a darker
neighbour's. Outline is honoured exactly where corner rounding is — the canvas
preview and the PNG/SVG (full + cropped) exports, all via `buildRenderPlan` — and
deliberately not in the 3D/plotter fabrication paths, which walk `painted`
directly and never saw rounding either. (The apparel cut is the exception: it
must *not* ignore outline, because a stroked layer cut along its own boundary
would erase itself — see [docs/exports.md](exports.md).) An SVG outline extends the document box by
`weight/2` (a stroke is centred on the boundary); the crop export needs no box
change since the crop rect is fixed.

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

## Glow

A non-directional drop shadow cast by a layer. `src/lib/glow.ts` is the maths and
both renderers; the UI is a third Effects row in `LayerPanel`.

**Two rules define it, and everything else follows from them.** It draws *under*
the layer that owns it — the layer casts, it does not receive — and it lands
**only on the solid cells of the fill layers below**. A shadow falls on a
surface; it does not hang in mid-air over bare canvas. So a glow on the
bottommost fill layer renders **nothing at all**, which is correct and is why the
panel says so inline rather than leaving it to look like a dead slider.

**This is the first effect that is not pure geometry**, and the first thing in
the codebase to emit `<defs>`, `<filter>` or `<clipPath>` — all three of which
the SVG exporters otherwise refuse, in three documented places. The refusal
still stands everywhere else. It cannot stand here: the visible shadow is
(blurred raster) ∩ (surface below), and **blur spreads**, so there is no polygon
to emit and nothing for Sutherland–Hodgman to cut. A `<clipPath>` is the only
representation, not a shortcut around doing it properly.

Chosen over a stepped stack of offset strokes (which would have been plain paths
and universally editable) with the trade-off on the table: browsers and
**Inkscape** render `feGaussianBlur` exactly — Inkscape's own Blur *is*
`feGaussianBlur` — while **Illustrator** imports it as a non-editable filter
effect and may rasterise or drop it on re-save, and **Affinity Designer** ignores
SVG filters on import. Known and accepted; do not treat it as a bug.

**The silhouette costs no new geometry code.** `regionRings` groups by
`resolveColor` and skips any value `decodeColor` rejects, so rewriting every cell
to one constant collapses a layer's colours into a single region and the existing
ring walk returns its outline — and hatch values stay excluded structurally, as
they are for the other two effects. `silhouetteGeometry` is that, and passing the
layer's own round radius is why a rounded layer casts a *rounded* shadow with no
extra work. (It is not quite the union of the per-colour rounded regions: a
vertex where an interior colour boundary meets the silhouette is degree 4 in the
colour-split walk and stays sharp, but degree 2 here and rounds. The difference
is a fraction of the blur.)

**The receiver is computed once, in `glowReceivers`, not per backend** — the same
reasoning as `stepRegionGeometry`. It accumulates every *fill* step below,
each honouring its own radius; hatch steps contribute nothing, since line work
bounds no solid area. A lower layer carrying an outline effect contributes its
whole region rather than just its stroke ribbon. `glowReceivers` returns
immediately when nothing in the plan casts, so a glow-free document walks no
regions at all.

**The document box does not grow.** Unlike outline, which reaches `weight/2` past
its fill and grows every exporter's bounds, a glow is clipped to content already
inside the box. Verified: a glow-free export is byte-identical to before, in both
the full and the cropped SVG.

**Canvas parity has exactly one trap, and it is not the one it looks like.**

- `blur(N)` takes the standard deviation **directly** — the same quantity SVG's
  `stdDeviation` names, so no conversion. It is `box-shadow`, not `filter: blur`,
  whose length is 2σ. Assuming the factor of two made the preview twice as soft
  as the file; measured in Chrome, `blur(10px)` and `blur(20px)` produce σ of
  exactly 10 and 20.
- `ctx.filter` lengths are **device pixels and ignore the CTM** (verified: the
  same `blur(10px)` measures 10px of σ at CTM scale 1 and at scale 2), so the
  world σ must be scaled by hand. `ctxWorldScale` reads it off the live matrix
  rather than taking it as an argument, so it cannot drift from the transform the
  caller actually set.
- `color-interpolation-filters="sRGB"` is **insurance, not a fix**. SVG 1.1
  defaults filters to linearRGB while canvas blurs in sRGB, but measured it
  changes nothing here — the caster is one flat colour, so the blur ramps only
  alpha, which carries no gamma. Keep it (it pins the result against the
  renderer's default and stays correct if the chain ever grows an
  `feFlood`/`feComposite` that mixes colours) but do not cite it as the reason a
  density matches.

`filterUnits="userSpaceOnUse"` with an explicit region *is* load-bearing: the
default region is `-10%`/`120%` of the source bbox and visibly crops a wide blur.
The region is the caster's box grown by `GLOW_EXTENT_SIGMAS`.

**Apparel skips glow** — the one raster path that does, via `drawArtworkPlan`'s
`{ glow: false }`. A soft shadow spreads translucent ink straight across the
stencil cut gaps, welding the pieces back together and undoing the flex the cut
exists to provide. Same reasoning that keeps hatch out of the cut. The plotter,
cutting and 3D exports never saw rounding or outline either and do not see this.

## Adjust colour

Brightness, hue and saturation sliders over a layer's colours, each −100…100 and
each 0 by default. `src/lib/color-adjust.ts` is the maths (pure); the UI is a
fourth Effects row in `LayerPanel`.

**The one effect that is not geometry**, which is what makes its plumbing
different: the other three had somewhere to put a radius, a weight or a shadow in
every backend, while this one has to reach every place a fill colour is *emitted*
— a dozen sites across the canvas, the PNG path and the two SVG exporters. So it
is threaded into the **two places a step's colours are produced** instead:
`generateTriangles` and `stepRegionGeometry` take an optional `adjust`, and no
emit code changed at all. Only `GridCanvas`'s inline colour-grouping loop, which
resolves its own fills rather than going through either, applies it by hand.
`stepColorAdjust` reads it off the step like the other three `step*` readers, and
returns **`undefined`** rather than an identity function — that is what keeps an
unadjusted layer on byte-for-byte the path it walked before this existed
(verified: a zero-valued *or* disabled effect exports an identical SVG).

**Applied to the resolved hex, not to the encoded value.** The adjusted colour is
continuous and almost never lands on a palette swatch; quantizing back to one (as
the pattern brush does) would make the sliders step rather than glide and would
throw away the very shades the effect exists to reach. `painted` keeps its
encoded values, so the layer still follows the global hue/saturation shift
*underneath* the filter.

**The maths is HSL**, the space `PALETTE_DEFS` is defined in, so a hue rotation
moves a swatch exactly as changing its palette's hue would — and the round trip
through `hexToHsl` is exact on every palette colour (measured: 0/255 max channel
delta). Each slider is the same lerp in both directions, `towards(v, t)`: to 100
for positive, to 0 for negative. That is why ±100 lands on pure white, pure black
and flat grey *exactly*, and why the ends of the travel still do something —
adding an offset and clamping instead leaves the last third of the slider inert.
Hue at ±100 is a half turn (`ADJUST_HUE_AT_FULL`), so the two ends meet and every
hue is reachable; applying +100 twice is the identity.

**Regions are found before the filter, never after.** `stepRegionGeometry` runs
the ring walk on the painted colours and adjusts the resulting `fill`, so the
filter can only recolour a boundary, never move one. Two regions it collapses
onto one colour stay two rings — invisible for a fill, and for an outline just
means the shared edge is stroked twice in that one colour.

Coalescing breaks around it for free: `buildRenderPlan` splits a run wherever
`activeEffects` is non-empty, which is exactly what stops one layer's filter from
recolouring the layer flattened next to it (verified — the neighbour keeps its
original hex).

The glow's own colour is **not** filtered, on either the casting layer or any
other: it is authored directly in a colour picker rather than being layer
content. Honoured in the canvas preview and the PNG/SVG (full + cropped) exports,
i.e. exactly where the other three are, and likewise not in the fabrication
paths.

## Rounding in the cutting export

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

