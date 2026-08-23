# Layer effects

> Detail doc. Index and the rules that apply everywhere: [CLAUDE.md](../CLAUDE.md). Module/symbol map: [CODEMAP.md](../CODEMAP.md).

Non-destructive per-layer filters — three of geometry, one of colour, one of
texture, one of compositing.
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
list so further effects can be added without re-plumbing; today there are six
(round corners, outline, glow, adjust colour, subdivision noise and blend mode)
and all six may sit on the same layer. Hatch layers are excluded — line work has no filled
region to reshape, and the colour and texture filters follow them out rather than
being the one effect with a different eligibility rule.

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
cannot disagree about where an arc begins.

**Fabrication** — the 3D print, the cutting stack and the cutting SVG honour the
radius too, through `layersRoundFraction` (largest enabled wins, since they all
merge the fill stack before looking at geometry). They cannot extrude a ring
directly, so `mesh-export.ts` flattens it to a polyline and triangulates it
(`triangulateLoops`, ear-clipping with holes); the extruders keep taking
triangles and nothing downstream changes.

**Both obey the degree-2 rule; they differ only in how they can ask.** The 3D
print rounds per colour region, so `roundRing` reads the ring's own lattice
vertex ids. A cut sheet is a *union of colours* — its boundary has forgotten
which ones — so it recovers each vertex with `latticeVertexIdAt` and looks it up
in the original artwork's degree map. Skipping that (a sheet has no airtightness
constraint, so every corner *looks* fair game) rounds the junctions the artwork
keeps sharp and turns a scattered upper sheet into blobs. See
[fabrication-export.md](fabrication-export.md). The arc's centre and sweep are
recovered from the two tangent points (`cornerArc`); canvas draws it with `arc`
from the entry tangent, SVG emits explicit `A` commands with the sweep flag taken
from the turn direction, and the cropped SVG flattens arcs to chords first,
because an arc cannot survive Sutherland–Hodgman and that exporter clips for real
rather than hiding overflow behind a `<clipPath>`. Canvas deliberately avoids
`arcTo`: it re-derives the tangent distance from the corner, and where the run
clamp has pulled the tangent points inward it adds a connecting line that doubles
back along the edge — a hairpin sliver of the very curve the corner was meant to
be.

### Authoring a kink: the no-print marker

`NO_PRINT` (`src/lib/constants.ts`) is a swatch that paints like any other but
never renders. Its only purpose is to exploit the eligibility rule above: only a
vertex with exactly two boundary edges may round, so dropping a marker cell
beside a region raises the degree at the vertices it touches and those corners
stay sharp. That is a deliberate kink in a shape that rounding would otherwise
turn to a blob.

**Erasing is not a substitute.** An empty cell *removes* boundary edges; a marker
*adds* a differently-coloured one. Only the second changes the degree.

**The sentinel deliberately fails `decodeColor`.** Nearly every renderer and
exporter already skips what it cannot decode, so this direction makes them skip
the marker for free and leaves exactly one place — the cell loop in
`boundaryVertexDegrees` — that had to be taught to let it in. A reserved palette
index would have inverted that: a dozen sites would have needed a guard, and
forgetting one leaks the marker into a cut file rather than merely losing a kink.
`regionRings` keeps its own filter, so the marker never produces a ring to draw.

Sites that did *not* already filter, and so needed an explicit guard:
`generateTriangles` and `stepPaintedColors` (`svg-export.ts`), `GridCanvas`'s
fill loop — where an unparsable `fillStyle` makes canvas **silently keep the
previous colour** — `noiseSubFills`, `artworkBounds` (`apparel-export.ts`),
`fitCropToPainted` (`crop.ts`), and the glow's surface test in `LayerPanel`. The
fabrication exports (3D, cutting, apparel) are covered in one place by filtering
`mergedFillPainted` in `TrixelGrid`, which is the only gate in front of all of
them.

Palette transforms need no change: `remapGrid`, `shiftGridPalettes`, `dodgeColor`
and `burnColor` all return a value untouched when `decodeColor` fails, so a
marker survives a palette shift.

The **Show/Hide** switch in Grid Settings is a view toggle only — markers shape
corners whether or not they are drawn, and they are never in an export either
way. Verified: markers added on empty cells produce byte-identical SVG while
dropping exactly the intended corners to radius 0, and the literal `"noprint"`
appears in no export body.

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
deliberately not in the fabrication paths, which walk `painted` directly. Those
now do see *rounding* (a silhouette is a shape a machine can make), but not
outline: a stroke is ink, and there is no ink in a print or a cut. (The apparel
cut is the exception: it
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
exists to provide. Same reasoning that keeps hatch out of the cut. No
fabrication path sees glow — a soft falloff is not a thing a nozzle or a blade
can make. Corner rounding is the one geometry effect all of them honour, because
it is the one that changes the *silhouette* rather than what is drawn on it.

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

## Subdivision noise

A dither *inside* each cell: the trixel splits into pieces and each is blended
toward the previous or next palette index. Two sliders — **Amount** 0–100 and
**Seed** 0–99 — a **Split** toggle, and `src/lib/subdivision-noise.ts` is the
maths. Verified against the cases that matter: amount 0 exports byte-identically
to no effect, each mode's pieces retile the parent exactly, the pattern is stable
across repeated renders and moves with the seed, and rounding clips it.

**The only effect that is texture rather than silhouette**, and the only one that
changes how many shapes a cell emits. The pieces exactly retile the cell they
came from, so the artwork's boundary, its bounding box and `painted` are all
unchanged — which is why nothing downstream had to learn about it beyond the two
chokepoints below.

### The two splits

`"midpoint"` cuts four sub-triangles at the edge midpoints. Every piece is a
triangle pointing the same way as the lattice, so the grain reads as a finer
version of the grid.

`"centroid"` cuts three quad **fins**, each owned by one corner and running
corner → edge midpoint → centroid → the other edge midpoint. Borrowed from
nemoworlds' `terrain_surface.frag.wgsl`, which makes the same cut barycentrically
to facet a rendered surface. Coarser and off-lattice, so it reads as faceting
rather than as a finer grid.

`mode` is **optional and absent means `"midpoint"`** — read through
`subdivisionMode(spec)`, never directly, exactly as with `layerKind`. Verified:
an explicit `"midpoint"` and an absent mode produce identical SVG.

**A fin is a quad, which is the one thing that rippled outward.** `SubFill.points`
is an open-ended `Pt[]` rather than a triple, and `ensureCW` had a latent bug for
anything but a triangle — its reversal was `[p0, p2, p1]`, which silently *drops*
a quad's fourth vertex. It now keeps the first vertex and reverses the rest,
which is the same result for a triangle and correct for a fin. Every other emit
site already walked `points.length`.

**Fixed at one subdivision** in both modes. No depth slider: 16 or 64 pieces per
cell would multiply an SVG export's element count by the same factor for a grain
finer than most exports resolve.

### The grain folds onto the crop, or fabric does not repeat

Hashing raw `(q, r)` makes the grain unbounded, and a fabric tile then **fails to
repeat** even though the lattice does: a cell straddling the crop edge takes its
two halves from `q` and `q + m`, which hash differently, so the discontinuity
lands exactly on the seam. Measured on a deliberately periodic painting — the
geometry tiled perfectly and the grain did not.

So `canonicalCell` folds the *hash key* (never the geometry) onto one repeat of
the crop, and the grain repeats with the tile. The fold is **not** a plain
`(q mod m, r mod 2n)`: the crop's translations are `(q+m, r)` and `(q−n, r+2n)`,
and the vertical one shifts `q` because `(0, 2H) = 2v − u`, so the row index has
to pay that shift back before `q` is reduced. Verified invariant under both
generators, and verified that the naive fold is *not*.

Two consequences worth knowing:

- **Where the crop sits does not matter**, only its `m`/`n`. The grain is
  periodic under the crop's own translation lattice, so any window of that size
  tiles — sliding the crop never re-rolls it. That is why `GridCanvas` keys its
  memo on the two numbers rather than the crop object, which is replaced on every
  handle drag.
- **Resizing the crop re-rolls the grain everywhere**, and on artwork larger than
  the crop the grain visibly repeats. That is the accepted price of a true fabric
  repeat; there is no period that both tiles the crop and never repeats.

`period` is threaded in by each backend rather than stored on the effect, because
it belongs to the export rectangle, not the layer — and **every** backend must
pass the same one (preview, both SVG exports, the fabric PNG, the apparel PNG and
the project thumbnail) or the grain on screen is not the grain in the file.

### Vector export states the grain once, as a `<pattern>`

Because the grain is periodic, one repeat *is* the whole of it — so both SVG
exporters emit `noiseTile` as a `<pattern>` and every region simply references it
in its `fill`. A noised layer therefore exports as its **own region geometry**
with a texture reference, not as confetti: the compositional shape stays in the
file and stays editable, which is the right structure for something that honours
the topology without being part of it.

Measured on 2,400 trixels: loose polygons 858 KB, pattern with an `m4 n2` crop
115 KB, with `m8 n4` 308 KB. The win scales with artwork ÷ crop area, since the
tile *is* the crop — a large crop is a large tile and buys less.

Three things that are load-bearing:

- **The tile opens with a solid `<rect>` of the region's colour**, so a region is
  a single path with nothing layered under it. That is also what makes the reflex-
  corner hole impossible here: there is no seam between a fill and a grain layer
  for the background to come through.
- **Rows tile the height exactly; columns do not.** A cell spans `[r·H, (r+1)·H]`
  so `2n` rows cover the tile with no overhang, but each row is sheared half a
  cell right of the one above, so the `q` range runs wide and the tile clips.
  Seamless rather than lossy: a piece cut off the right edge has a
  period-translate hanging over the left edge with identical grain.
- **The pattern is an optimisation, never a precondition.** Without a period
  there is no repeat to state, and `generateSVG` falls back to loose polygons
  clipped to the region. Emitting nothing would silently drop the texture for any
  caller that forgot the argument — which happened once during development.
  `generateCroppedSVG` needs no fallback: it is handed a crop, and `m`/`n` are
  clamped to at least 1 wherever they are produced.

`patternTransform` carries the world → display map in the cropped exporter
(`translate(-display) rotate(θ)`, applied right to left), which is what keeps the
pattern locked to the lattice so the fabric tile stays seamless.

**Threaded exactly where `adjust` is**, and for the same reason — it reaches the
flat-fill path of the PNG exporter and both SVG exporters through the single
`noise` parameter on `generateTriangles`, so no emit site changed. Only
`GridCanvas`'s inline grouping loop, which resolves its own fills, gathers its
own. `stepSubdivisionNoise` returns **`null`** for an absent, disabled or
zero-amount effect, keeping an unnoised layer on the path it walked before.
`subdivideCell` is the one definition of how a cell splits, so a mode cannot mean
one thing in the preview and another in a file.

**The blend is quantised** to `NOISE_LEVELS` (8) steps per direction and the
resulting ramp memoised per encoded colour. That is load-bearing, not a
micro-optimisation: a continuous blend gives nearly every piece its own
hex, which costs the canvas a `fillStyle` change per piece and costs
`mergeTrianglesByColor` the ability to merge anything. Eight steps caps a source
colour at 17 outputs. The cache key includes the *resolved* hex as well as the
encoded value, so a global hue/saturation shift invalidates it.

**Mixed in RGB, not HSL** — the opposite choice from adjust colour, and
deliberately. The four custom palettes carry a per-index hue as well as a
per-index lightness, so adjacent indices can differ in hue and an HSL
interpolation would swing through colours in neither swatch.

**Clamped at both ends of the ramp**, exactly as `dodgeColor` / `burnColor`
clamp: a cell in the darkest swatch has nothing darker to blend toward, so its
grain travels one way only. Same asymmetry dodge and burn already have.

**Under round corners the grain is clipped to the region, not emitted loose**, so
a rounded corner cuts it back exactly where it cuts the fill. Finding which cells
belong to a region needs no second connectivity walk: `regionRings` groups by
*resolved colour* and emits one entry per distinct colour — separate blobs and
holes fall out as extra rings inside that entry — so "this region's cells" is
"the cells whose resolved colour is this region's". `stepRegionGeometry` returns
`base`, the fill *before* `adjust`, for the match; using the filtered value would
pour one region's grain into another's whenever the filter collapses two colours
onto one.

**The solid fill goes down first and the grain rides on top — in all four
backends.** This is not belt-and-braces: the grain covers only the cells the
artwork was painted in, while the rounded ring *bulges past* them at every reflex
corner, so a region drawn as the clipped grain alone is unpainted exactly there.
Both SVG exporters originally emitted the clipped group *instead of* the fill and
shipped that way; it showed up as a transparent lens along every colour seam,
bounded by the arc on one side and raw cell edges on the other, and only when
noise and rounding were on the same layer. The regression check is that a rounded
layer's region paths are byte-identical with and without noise — the grain must
never move the silhouette.

**Under an outline the noise is skipped.** That effect leaves the region's
interior deliberately empty, so there is no fill there to texture.

**The raster overdraw needed a real fix, not just threading.** `drawArtworkPlan`
skips its seam-closing stroke on flat edges because the caller lands every
lattice row on an integer pixel boundary, and a stroke centred there straddles it
and discolours the whole row. Subdivision puts flat edges at `(r + ½)H` too,
which is *not* pixel-aligned and does need the stroke — so the test became "flat
**and** on a lattice row" (`onLatticeRow`). Without noise every flat edge is on a
row, so it reduces to the condition it always was.

## Blend mode

How the layer's finished result combines with the artwork beneath it: **multiply,
screen, overlay, soft light, hard light, difference**. `src/lib/blend.ts` holds
the mode list and the canvas half; the UI is a sixth Effects row in `LayerPanel`,
a 2×3 grid of buttons rather than sliders — it is a choice, not a quantity, and
picking one is a compare-them-all gesture.

**An effect rather than a field on `Layer`.** It could have been a per-layer
setting, and in most editors it is; putting it here costs nothing to persist
(effects already ride `ProjectSnapshot`), keeps the layer rows uncluttered, and
gets three things for free that a new field would each have needed by hand: the
enable/disable eye, undo/redo, and — the load-bearing one — **`activeEffects`
breaking `buildRenderPlan`'s coalescing**, which is exactly what a blend
requires. A layer that composites differently from its neighbour cannot be
flattened into the same map as that neighbour. Every mode offered is a real one,
so `activeEffects` keeps any enabled blend; "normal" is spelled by disabling the
effect.

**The one effect applied a level up.** The other five change what a step draws;
this changes what happens to the step once drawn. So the step readers' usual
shape does not fit: `stepBlendMode` is consumed *around* a backend's step loop,
never inside its emit code. Nothing in `generateTriangles`, `stepRegionGeometry`
or any emit site knows this effect exists.

**One string drives all four backends.** Canvas's `globalCompositeOperation` and
CSS's `mix-blend-mode` name the separable modes identically — both are Compositing
and Blending Level 1 — so the stored value goes straight into either with no
translation table to drift out of sync.

### A step is flattened before it blends

`drawComposited` paints the step into an offscreen canvas and composites the
result in one operation. Setting the composite op on the live context and drawing
the step's shapes into it is **not** the same thing, and fails in three places
that all exist today:

- the seam-closing **overdraw stroke** laps onto its neighbour, so `multiply`
  grows a dark line along every seam;
- a rounded region's **grain** sits on top of its own solid fill, so every noised
  cell blends with itself;
- a **glow** is painted under the very layer that casts it, so the layer burns
  through its own shadow.

Inside the buffer those overlaps stay ordinary source-over draws, exactly as they
are without the effect, and only the finished layer meets the backdrop. The SVG
side gets the same semantics from putting the whole step in one `<g>`. The buffer
inherits the caller's transform, so no drawing code changed; the cost is one
full-size canvas per blended step, paid only when a document blends.

### The artwork is isolated from the background

**A blend sees the layers below it and nothing else.** The canvas preview gets
this for free — the artwork is the first thing painted after the clear, on a
transparent surface. The raster exports do not: both paint an opaque background
first (the fabric page colour, the apparel garment), so `drawArtworkPlan` renders
the whole plan into a buffer of its own when `planBlends` is true. The SVG
exporters wrap their drawing in `isolation: isolate`, a sibling of the background
rect rather than its parent.

Without that, the bottom layer would blend against whatever the document happens
to be opened over — which the file does not state, and which the preview cannot
show. The rule as chosen is the one all four backends can honour identically.
Both isolation paths are conditional, so a blend-free export is byte-identical to
before this existed (verified, full and cropped SVG).

**A blend on the bottom layer does nothing**, for the same reason a glow there
does: there is no artwork underneath. The panel says so inline, reusing the glow's
surface test.

**Inkscape honours `mix-blend-mode`; Illustrator and Affinity Designer ignore it**
and open the layer plain. Same trade-off as the glow's `feGaussianBlur`, and made
the same way — there is no polygon that expresses a per-pixel function of two
paints, so this is the only representation, not a shortcut around one.

Honoured in the canvas preview, the fabric PNG, the apparel print (which is
`drawArtworkPlan`) and both SVG exporters. Not in the fabrication paths — the 3D,
cutting and plotter exports walk `painted` directly and see no colour effect at
all — nor in the apparel *cut*, which is `RawSeg` geometry with no compositing to
speak of.

## The WebGL preview backend

The live preview is a fourth backend (`src/lib/webgl/renderer.ts`), walking the
same plan and reading the same step readers as the other three. It reproduces
canvas semantics rather than approximating them, through three decisions worth
recording:

- **Region fills are a nonzero-winding stencil fill, not a triangulation.** Each
  ring is flattened once — `flattenRoundedRing`, the same function the cropped
  SVG export uses — and drawn as fan triangles into the stencil buffer with
  INCR/DECR chosen per triangle orientation; a masked quad then paints where
  the count is nonzero. That is the GPU phrasing of exactly what canvas's
  default `fill()` computes, and it needs no polygon machinery: holes cancel by
  winding, concavities and even self-intersections come out right, and there is
  no ear clipper to bail out or misfile a ring. The previous port triangulated
  each ring and classified outer vs hole from the first output triangle's sign,
  but the clipper normalised windings first — every ring got the same sign, so
  **holes filled solid**, and its bail-out could drop regions whole.
- **No preview-only clamp.** An earlier port re-clamped each corner's radius
  against region-local edges so its polygons stayed simple enough to clip;
  that is the region-local clamp the round-corners section above names as the
  way to tear seams and diverge from the files. The preview now flattens with
  the exporters' own radii, and ties the flattening *sagitta* to the view
  instead — small enough that a chord deviates from its arc by well under half
  a device pixel — so what is on screen matches what an exporter draws at any
  zoom.
- **The outline is an exact capsule union, not an approximation of a stroke.**
  A round-join stroke of a closed polyline is precisely the union of
  per-segment capsules — each segment swept by a disk of half the width — so
  the renderer emits one expanded quad per segment and the fragment shader
  keeps only pixels within half a width of the centreline, ramped over one
  device pixel. Uniform width by construction, joins are true circles, and the
  antialiasing is analytic rather than riding on multisample edges. An earlier
  take reused the generic polyline stroker (segment quads plus join disks
  emitted only above a turn-angle threshold), which left sub-pixel wedge notches
  at corners and tessellation lumps on dense arcs; before that, miter-offset
  donuts self-intersected on small features — anything canvas's `stroke()`
  survives.

One renderer-internal rule keeps all of this deterministic: enabled vertex-
attrib arrays are global GL state, and a deleted buffer leaves a dangling
enabled array that makes the next `drawArrays` fail silently (INVALID_OPERATION,
nothing painted). Every draw therefore disables the attribute locations it does
not use — the class of bug that presented as whole regions vanishing depending
on which other layers were edited first.

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

**Rounding runs before the necks, and the necks are spliced into the finished
polyline.** The other order is the obvious one and it was wrong: a neck inserted
first becomes two more ring vertices, and `roundPolygon` clamps every radius
against the straight run it sits on, so the corners flanking a join rounded less
than the same corner elsewhere on the same sheet — the join silently reshaping
the curve beside it. Rounding the plain boundary gives one radius rule for the
whole sheet and costs the necks nothing: they are measured off the lattice loop
either way, so the tiny hexagon keeps exactly its designed shape. What makes the
splice findable afterwards is holding pinch vertices **ineligible for rounding**
— which is right on its own terms, a pinch being a junction like any other.

A pinch is bridged **per visit, not per vertex**. A merged loop passes through a
`><` join twice, once per notch, and the two passes turn through opposite empty
sectors — so they are two different hexagon rings that merely share a
coordinate. Splicing the necks after rounding means finding them by coordinate,
and storing them in a map keyed by point kept only the last: one notch got the
other's ring and doubled back over itself, the other got none. They are recorded
and consumed in traversal order instead, which is well-defined because rounding
never reorders ring points and never removes a pinch. `etc/pinrose-test` has six
such joins on its top colour sheet, and they are the regression test: six proper
self-crossings when this is wrong, none when it is right.

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
survive it: `layersRoundFraction` (`hatch-render.ts`) takes the **largest
enabled** radius among visible fill layers, and every merged-fill export shares
it so they cannot drift. Predictable, and it matches the intent — if the artwork
reads as rounded, the cut should be too.

**Honoured by the plotter**, which is the one fabrication path that has been
taught it. It used to run entirely on `region-outline.ts`'s `RawSeg` — a line
family plus a 1-D interval — which structurally cannot represent an arc, so it
now switches to a polygon representation (`plot-geometry.ts`) whenever there is
a radius to honour or a contour fill to draw, and keeps the `RawSeg` path
byte-for-byte for the square-cornered hatch. See
[docs/exports.md](exports.md#corner-rounding-and-the-second-geometry-path) for
what that costs and what it buys. Note the plotter is fed its merged map with
`NO_PRINT` markers **intact**, precisely so kinks work there too.

**Still not honoured by the cut dialog's 3D preview (above), apparel cuts, or
the 3D export.** Apparel cuts still run on `RawSeg`; the 3D export extrudes the
lattice directly. With rounding on, apparel *fills* round but its cut gaps still
follow the straight lattice boundary, diverging slightly near corners.

