# Fabrication Export — Design Spec

> Status: **design/spec only, not implemented.** The 3D-print export (`src/lib/mesh-export.ts`, `Export3DDialog`, `Model3DPreview`) exists; the **cutting-machine (Cricut/paper) export** described here does not yet — except where a section says otherwise (see §8 phase 3 and §9). This document is the plan of record.

## 1. Why this exists

Trixel creations are digital, and the point is to make them into **physical objects**. This is a first-class product direction, not a one-off export button. During exploration we weighed several media for turning triangular-grid art into something you can hold:

- **FDM 3D printing** — shallow relief, one body per color, with a directional top-infill "shimmer" grain. Already partly built. Big limitation: online print *services* are effectively single-material; multi-color only works if the user slices it themselves (Bambu AMS / Prusa MMU). Grayscale art has an escape hatch: map value→height and print a single-material relief that any service accepts.
- **UV flatbed / full-color 3D** — the only path with exact arbitrary color and no fuss; needs a shop; reads as "textured picture."
- **Machine embroidery (Ink/Stitch)** — free, SVG-in, per-region stitch angle. Strong future facet.
- **Cricut / layered paper (or vinyl)** — fastest at-home path; SVG-native. **This spec.**
- **Quilting (60° equilateral-triangle patchwork / EPP)** — the most structurally honest match; highest craft/time cost. Future.

### Two throughlines worth keeping

1. **Directional sheen recurs everywhere.** FDM infill lines, embroidery floss sheen, fabric grain, brushed UV substrates. The "which way does this triangle shine" (grain angle) idea is a property of making a triangle from aligned fibers/lines — it is *not* 3D-print-specific and should stay a first-class, medium-agnostic concept.
2. **One shared export primitive.** Every medium wants the same thing: *"give each color as its own set of regions,"* then reason about **connectivity** and **ordering**. Cricut layers, quilt patches, embroidery color-stops, and print bodies are all the same substrate. Build the engine once (for cutting) and most of it transfers.

### Facet roadmap

| Facet | Status | Shares |
|---|---|---|
| 3D print (relief, per-color bodies, grain) | partial (built) | extrusion + preview |
| **Cutting machine (layered paper/vinyl)** | **this spec** | per-color regions, connectivity, ordering, exploded preview |
| Embroidery (Ink/Stitch, SVG) | later | per-color regions, stitch-angle = grain |
| Quilting (60° triangle patchwork) | later | per-color regions, templates |

---

## 2. The cutting facet: layered papercraft

### The physical model

A layered papercraft print is a stack of single-color cardstock sheets. Assign each color a **stacking level** (1 = bottom, K = top). The physical rules:

- **(A)** Colors are layers stacked on top of one another.
- **(B)** Each lower layer is the **union of every layer above it** (it's covered anyway) — this gives a continuous backing and a glue surface everywhere.
- **(C)** Upper layers may have holes, but should ideally stay **contiguous** (one connected piece). Isolated regions of a lower color are revealed through holes in the layers above.

### Formalization

- Colors `c₁…c_K`, each with a **visible triangle set** `V_c` on the tri grid (edge-adjacency via `triEdgeNeighbors`). The `V_c` partition the design.
- A **cut plan** assigns each color a distinct level `1..K` (one color per level, in the default "budget-0" mode).
- **Physical sheet at level i**: `Sᵢ = ⋃ { V_c : level(c) ≥ i }`, cut from cardstock of the color at level `i`. Sheets are **nested**: `S₁ ⊇ S₂ ⊇ … ⊇ S_K`. Bottom sheet `S₁` = full silhouette (solid, no holes); top sheet `S_K` = just the top color's region.
- **Correctness:** at any triangle `t ∈ V_c`, the topmost present sheet is exactly level `level(c)`, whose cardstock is `c`. **Every ordering reproduces the picture identically** — ordering only affects *manufacturability* (islands, weeding, glue, bulk), never the image.
- **Holes are free:** a sheet is a *set of triangles*, so lower colors are simply *absent* triangles = negative space. No boolean/CSG needed anywhere (cut paths or preview mesh).

---

## 3. The algorithmic problem

### Objective (locked): fewest islands, budget 0

- **Islands** of a plan = `Σᵢ (components(Sᵢ) − 1)`, where `components` = connected-component count of a triangle set via BFS over `triEdgeNeighbors` (this is the existing `countComponents` in `mesh-export.ts`).
- **Monotonicity:** `components(Sᵢ)` is non-increasing as `i` decreases (adding triangles only merges components, never splits). So `S₁` is always 1 component (if the design is connected), and **islands concentrate near the top**. Scattered colors want to be **low** (revealed through holes in a contiguous upper sheet) rather than **high** (cut as loose confetti).
- **Islands ⇔ suffix-union connectivity.** Because of rule (B), *nothing floats* except when a cumulative top-down union `Sᵢ` is itself disconnected. So "minimize islands" = "find an order where every suffix union stays geometrically connected."

### Why layers are a cost (the confetti reductio)

"Fewest islands" alone is degenerate: one layer per triangle, swept along an axis, trivially gives zero islands. That absurd fallback proves **sheet count is a cost**. In the honest constraint — **one sheet per color** — the layer count is *fixed at K* and the only freedom is the permutation. Zero islands is therefore **sometimes unreachable**: an inherently scattered color forces a fragmented sheet no matter the order.

### Algorithm

Colors are few, so **brute-force all `K!` permutations** (K=5→120, K=8→40k; trivial). Score each:

1. Primary: total islands `Σᵢ (components(Sᵢ) − 1)`.
2. Tiebreak: **paper/glue**, which has a closed form. Total layered area `= Σ_c area(c)·level(c)`, minimized by putting **largest-area colors on the bottom**. (Usually agrees with the island objective, since big colors tend to be the connective background.)

Return the best plan. Exact, not heuristic, and effectively instant.

### Budget 0 — behavior when zero islands is unreachable

Budget-0 **never auto-splits a color across levels.** When the best permutation still leaves islands, it is **honest**: report exactly which pieces will be loose/glued and where (e.g. "light gray → 2 glued islands, unavoidable without splitting"). The user then chooses how to resolve it:

- **Accept** the glued islands (they still bond to the continuous sheet below — structurally fine, just extra handling).
- **Bridge** — surface the exact triangles that, if connected (made edge-adjacent), would drop the component count. Same nudge as the 3D exporter's corner-touch warning; turns a fabrication constraint into a drawing hint.
- **Manual split via design layers** (below).

### Design layers as the manual override (soft **hint**)

The app already has real editing layers (`useHistory` layers, `LayerPanel`). Wire them in as the surgical escape hatch:

- The planner flattens visible layers and groups by color for the auto path.
- A **design-layer boundary is a soft hint** that biases those triangles toward their own sheet / to stay together — **not** a hard constraint. If a cleaner fully-auto ordering already satisfies budget-0, the planner may ignore the hint. (Decision: hint, not hard split — predictability yields to a better all-auto result.)
- Rule of thumb to keep the mental model simple: *colors auto-merge into sheets; a design-layer split is a suggestion to peel them apart.*

### Weeding / feature-size guards

- Triangle physical size = f(export width, grid) — reuse the width control from the 3D dialog. **Flag features below the machine's reliable cut/weed threshold** before cardstock is wasted.
- Per-sheet weeding-effort estimate: hole count (enclosed complement components) + total interior cut-path length.

### Live layerability feedback (the "tool" payoff)

The connectivity check is cheap enough to run **while drawing**: quietly report "cleanly layerable in 4 sheets, 0 islands" or "light gray forms 3 islands in any order — bridge here." Fabrication constraint becomes real-time compositional feedback. This is the differentiator vs. a plain export button.

**Live feedback ≠ a WebGL port.** The cost of the check is the *planner* — a pure graph computation (`K` suffix-unions × `countComponents` BFS × `K!` permutations), pure JS/CPU with nothing to do with rasterization. Porting `GridCanvas` to WebGL would not speed it up. The right architecture: keep `planCut` a **pure function** → run it in a **Web Worker**, **debounce** to stroke-end, and **memoize `V_c` per color** so a stroke only recomputes touched colors. Analysis then runs off the main thread and drawing stays at 60fps regardless of renderer. At the default `K=5` a full recompute is ~600 BFS passes (sub-ms–low-ms); it only strains near `K=8`, which the grayscale palette never reaches. *A WebGL port is a separate, profile-driven editor investment (e.g. the iPad drawing lag at large triangle counts) — justified on its own, never a prerequisite for this facet.*

---

## 4. Exploded 3D preview (reuse, not rebuild)

A cut sheet **is already a body** in the 3D exporter's sense — reuse `MeshBuilder.prism` and `Model3DPreview` almost verbatim. (The cutting facet lives in its **own `CutExportDialog`**, not a mode toggle on `Export3DDialog` — but the *preview component* `Model3DPreview` is still shared/extended with an exploded-stack mode. Separate dialogs, one viewer.)

- **Mesh per sheet:** extrude the triangle set `Sᵢ` to a thin *uniform* thickness `T_sheet`, placed at `Z = (i−1)·(T_sheet + gap)`. Color = the **cardstock** color of level `i` (physical, not the rendered art palette).
- **Holes for free** — `Sᵢ` is a triangle set, so absent triangles are negative space in the mesh automatically.
- **Explode slider** fans sheets apart to inspect each outline + holes; **assembled mode** (`gap = 0`) shows the top surface reproducing the design (it will, by construction — instant sanity check).
- **Island highlighting (float-aware)** — glow marks only pieces that *genuinely float*, not every fragmented sheet. Because sheets are nested supersets (`S₁ ⊇ … ⊇ S_K`), **every triangle of an upper sheet has solid material on every sheet below it** — upper-sheet fragments are *mounted*, not loose. The only sheet that can float is the **bottom** one, and only when the painted design is itself disconnected. So the preview glows only bottom-sheet components with nothing beneath them; a woven/lace design (fragmented top, interlocked bottom) correctly shows **zero glow**. (Earlier framing that glowed "every sheet with `components>1`" was wrong — it alarmed on pieces that actually glue straight onto the layer below.)
- **Physical model (top → bottom):** (1) a black **outline-silhouette mat** on top — a screen-rectangle with the design's outline cut out as a window (the exterior region, flood-filled inward so interior negative space stays a window); (2) **color sheets** = nested positive regions `Sᵢ` = {painted t : level(color(t)) ≥ i}; (3) bottom = level-1 sheet `S₁` = the painted silhouette, which **keeps holes** wherever the interior is unpainted.
- **Unpainted = through-holes.** Unpainted triangles are cut through the *entire* stack as see-through negative space. The **one exception is the outline silhouette** — the exterior, which the black mat fills as solid paper on top (and defines the outer edge). So a color sheet is exactly `Sᵢ` (no filling of unpainted), and only the mat lives outside the silhouette.
- `components(Sᵢ)−1` counts **pieces per color sheet** (handling cost / planner objective) — reported neutrally. A fragmented upper color is held in the glued sandwich; no floating alarm.
- **Ortho top-down of an exploded sheet == the SVG cut path** (outer boundary + hole boundaries). Preview and export look at the same geometry from two angles.

### Difference vs. 3D-print mode (one viewer, a mode toggle)

| | 3D print | Cutting (papercraft) |
|---|---|---|
| Body = | one color's own triangles `V_c` | cumulative union `Sᵢ` (level i and above) |
| Z layout | relief heights | thin equal slabs stacked by level (+explode) |
| Color | filament/art color | cardstock color |

---

## 5. Output (cutting export)

- Per-**sheet** SVG cut files, in stacking order (bottom→top), each labeled with its cardstock color.
- Registration consistent across sheets (shared coordinate origin) so the stack aligns when assembled.
- Cut path per sheet = outer boundary + hole boundaries of `Sᵢ`.
- Accompanying assembly notes: stack order, cardstock colors, count of any glued islands.
- **Cardstock color = art color (MVP).** Each sheet is labeled/previewed with its color's art-palette value; a physical art-color→cardstock-swatch mapping UI is a later refinement, not part of the first slice.

### Boundary tracing (the one genuinely new algorithm)

Everything else in this spec is set arithmetic on triangle sets (unions, `countComponents`, `K!` permutations) — instant, already-built primitives. Turning a triangle *set* `Sᵢ` into SVG cut paths is the real new work: trace the **boundary of a union of triangles** as ordered closed polygons (outer silhouette + each hole). No CSG/booleans — consistent with §2's "holes are free" principle:

1. **Boundary edges.** For each triangle in `Sᵢ`, each of its 3 edges is a boundary edge iff the triangle across that edge is *absent* from `Sᵢ`. (Neighbor lookup = the same `triEdgeNeighbors` adjacency used by `countComponents`.)
2. **Walk into loops.** Chain boundary half-edges head-to-tail (next-edge-around-shared-vertex) into closed loops. Each loop → one SVG subpath.
3. **Classify (labeling only).** Signed area / point-in-polygon separates outer boundary from holes for weeding stats and labels. The *path itself* needs no classification — render with `fill-rule: evenodd` and nesting resolves automatically.
4. **Merge collinear runs** so a straight edge of N triangles emits one line segment, not N.

Self-contained (~100 lines), no dependency on the mesh pipeline. Ortho top-down of the exploded preview sheet == this SVG (§4) — same geometry, two projections.

---

## 6. Reuse map (where to hook in)

| Need | Existing code |
|---|---|
| Connected components of a triangle set | `countComponents` (private in `mesh-export.ts:155` — **must be exported**; takes `string[]` keys), `triEdgeNeighbors` (`grid-math.ts`) |
| Prism extrusion for preview meshes | `MeshBuilder.prism` (`mesh-export.ts`) |
| Orbit/headlamp/gradient 3D preview | `Model3DPreview.tsx` (add exploded-stack mode) |
| Per-color grouping, resolveColor | `mesh-export.ts` grouping, `resolveColor` (`constants.ts`) |
| Manual splits | `useHistory` layers, `LayerPanel` |
| Export scale / width control | `Export3DDialog` options |

## 7. Decisions locked

- Priority objective: **fewest islands**.
- Default: **budget 0** (one sheet per color, no auto color-splits); report unavoidable islands honestly.
- Design-layer boundary: **soft hint**, overridable by a cleaner all-auto ordering.
- Search: **exhaustive `K!` permutations** (colors are few); tiebreak by `Σ area·level`.
- Preview: **reuse the 3D preview** as an exploded cut-stack viewer.
- UI: **separate `CutExportDialog`** (not a mode toggle on the 3D dialog); shares `Model3DPreview`.
- Cardstock color: **= art palette (MVP)**; a color→physical-swatch mapping UI is deferred.
- Boundary→SVG: **boundary-edge walk, no CSG**; `fill-rule: evenodd` for holes.
- Physical model (top→bottom): **black outline-silhouette mat · color sheets `Sᵢ` · bottom = `S₁`**. Unpainted = holes cut through the whole stack (negative space); the **only exception is the outline silhouette** (the mat, exterior region). Color sheet = positive region `Sᵢ`; the bottom keeps its interior holes.

## 8. Implementation phases

Ship **planner + exploded preview first**; SVG export lands second (cut paper only against previewed, verified geometry).

**Phase 1 — planner core (pure, testable).** New `src/lib/cut-export.ts`.
- Export `countComponents` from `mesh-export.ts` (or lift to `grid-math.ts`).
- Flatten visible `useHistory` layers → `painted`, group by color → `V_c`.
- `planCut(painted)`: enumerate `K!` level permutations, build each `Sᵢ = ⋃{V_c : level(c) ≥ i}`, score by `Σ(components(Sᵢ)−1)`, tiebreak `Σ area·level`. Return `{ order, sheets: [{ level, colorKey, triangles, componentCount }], islands }`.

**Phase 2 — exploded preview.** Extend `Model3DPreview` with a stacked-slab mode.
- Per sheet: `MeshBuilder.prism` over `Sᵢ` at uniform `T_sheet`, `Z = (i−1)·(T_sheet+gap)`, colored by art color.
- Explode slider (`gap`); assembled (`gap=0`) sanity-check; **island highlighting** for any sheet with `components>1`.
- New `CutExportDialog` hosting it + the plan summary / island report.

**Phase 3 — SVG cut export. ✅ built** (`src/lib/cut-svg.ts`). `traceUnionLoops` walks boundary edges (reverse-edge-absent test) into closed loops, merges collinear runs → **one compound path per layer** (outer + holes as sub-paths, opposite winding, `fill-rule: evenodd`) so the cutter cuts the union silhouette, never internal triangle edges. `buildCutSVG` auto-tiles the layers into a grid, each a labeled inkscape layer (`Sᵢ ∪ frame`; the mat is the frame alone), sized in mm from the width control. Wired to a **Download SVG** button in `CutExportDialog`.

**Phase 4+ (deferred).** Cardstock-swatch mapping UI · live layerability feedback while drawing · weeding guards · budget>0 auto-splits · bridge-hint surfacing. (Tab-and-slot joints landed separately — §10.)

---

## 9. Corner rounding in the fabrication paths

Both facets follow the artwork's **round corners** effect, read through
`layersRoundFraction` (`hatch-render.ts`) — the shared "largest enabled radius
wins" rule, since every fabrication path merges the fill stack before it looks at
geometry, so a per-layer radius could not survive the merge. It is not a dialog
setting in either export: a print or a cut that disagreed with the picture on
screen would be a bug, not an option.

**A cut sheet must round as if its colours had never been merged.** This is the
one place in the app holding geometry that has forgotten what colour it came
from: `Sᵢ` unions every colour at level i and above, so its boundary runs along
colour seams that are invisible in the artwork, and its corners have no region to
be a corner *of*.

Rounding that boundary on its own terms is the trap, and the argument for it is
seductive: a cut sheet genuinely has no airtightness constraint, because the
sheets are nested (`S₁ ⊇ … ⊇ S_K`) and a rounded piece always sits on a strictly
larger one. But airtightness was never the only thing the degree-2 rule bought.
It is also what keeps a corner where three colours meet sharp — and a sheet that
rounds everything turns each scattered upper sheet into a handful of discs that
look nothing like the picture. (Observed: on an interleaved four-colour design,
every sheet above the first came out as blobs.)

So `traceUnionLoops` takes the **original artwork's** `boundaryVertexDegrees`
and looks each of its vertices back up through `latticeVertexIdAt`, rounding only
under the same rule the screen applies. Neck points are not lattice vertices, so
they come back null and stay sharp — which is what a deliberate straight bridge
wants anyway. Without the degree map nothing rounds at all: rounding everything
is the failure the parameter exists to prevent, so it is not the fallback.

That is what `round-corners.ts` exposes `roundPolygon` for (geometry only, caller
decides eligibility) underneath `roundRing` (geometry + the degree-2 rule): the
two consumers do not differ on the *rule*, they differ on how they can ask. A
colour ring carries its own lattice vertex ids; a sheet has to recover them.

The 3D print never faced this, because it never merges colours: it rounds per
colour region with `roundRing` directly, and its abutting filament bodies still
meet with no gap and no overlap.

The one residual difference from the screen is the **clamp**, not the shape. Run
lengths are measured along the sheet's boundary, which can pass straight through
a junction where the colour's own ring turned, so a corner just before such a
junction may take a slightly larger radius than it does in the artwork. Both
corners at the junction itself stay sharp either way.

**Rounding runs after the necks are inserted**, and the run clamp is what makes
that safe: a neck's edges are `neck`-sized, so the clamp drives the radius at
those vertices to nearly nothing and the tiny-hexagon bridge keeps its shape.

**Meshes need triangles, so a rounded loop is triangulated** —
`triangulateLoops` (`mesh-export.ts`, ear-clipping with holes via the earcut
three vendors). Outer loops wind positive and holes negative by construction in
both producers, so nesting needs no containment analysis beyond assigning each
hole to the smallest outer loop containing it — which is also what puts an island
sitting inside a hole in its own group.

Two things that are easy to get wrong here, both found by measuring the exported
area against the flat renderer's:

- **The chord tolerance belongs to the finished part, not to the drawing.**
  `FAB_CHORD_MM` (20 µm) is divided by the model transform's `scale`, so the same
  physical error holds whether the piece is made at 20 mm or 300 mm, and the
  vertex count follows the size of the object rather than the size of the
  artwork. A fixed world-unit tolerance was a 3.7% area error on a small piece.
- **Earcut has no notion of winding.** At the top of the radius range a rounded
  boundary can fold back over itself; canvas and SVG both resolve that lobe away
  (winding number 0 under nonzero, parity 0 under even-odd) but a raw ear-clip
  fills it, putting solid material outside the silhouette the user drew — up to
  4% extra area from 80% of the slider up. `triangulateLoops` detects it by
  comparing the triangulated area against the loops' *signed* area, and only then
  runs the quadratic repair: split the loop at its proper self-crossings, keep
  the sub-loops that wind with the parent. Filtering earcut's output triangles by
  the winding number at their centroid does **not** work — the ears straddle the
  crossing.

---

## 10. Tab-and-slot joints (`src/lib/cut-joints.ts`)

Optional, off by default, one toggle in `CutExportDialog`. It answers the
question §3 leaves open: the planner minimises islands and then **reports the
ones it cannot remove**, and until now the only answer for those was glue.

### What holds a piece, and what does not

Every colour sheet is `Sᵢ ∪ frame`, so with a mat on, the component containing
the frame is held by the frame. Everything else is a **loose facet**: it rests on
solid paper — the sheets are nested, so there is always material beneath — but
nothing stops it sliding or lifting off. Which facets qualify:

- **Mat on** — every component of `Sᵢ ∪ frame` that does not contain a frame
  triangle.
- **Mat off** — every component except the largest, which is taken as the piece.

### The joint

A tab folds down at the lattice edge, passes through a **line slot** cut in the
first sheet below with paper there, and folds flat underneath it. Two fold lines
per tab — the root and the top of the riser — emitted as a stroked, dashed
`… — folds` layer so a machine scores them; a tab cut free at its root is just a
hole.

Three decisions here were wrong first time round and are worth stating as
decisions:

- **Every boundary edge gets a tab.** The first version scored candidate sites
  on a distance-to-boundary heatmap and spread a handful of them by
  farthest-point sampling. That was solving the wrong problem: one tab is a
  pivot, two are a hinge, and a single-cell facet on one tab simply lifts off.
  With a tab on every edge there is no scoring, no sampling and no count
  heuristic — the rule *is* the algorithm, and the module lost about half its
  code.
- **The tab tapers inward, not outward.** A dovetail — wider at the tip — is
  what a part slid into place sideways wants. A tab dropped straight down a slot
  only has to find the opening, so `TAB_TIP < TAB_ROOT` and it guides itself in.
- **One tab per hole, though.** Two facet cells can face the same neighbour
  cell, and their tabs are then cut from the same paper — measured at 36
  overlapping pairs on `basketweave` and 204 on `purple_cabbage` before the rule
  went in, 0 after, and it drops exactly as many tabs as there were overlaps.
  `MAX_TAB_REACH` keeps every tab inside the one cell it reaches into, which is
  what makes "one tab per cell reached into" sufficient by construction rather
  than by margin. The second edge onto a hole was redundant anyway — both tabs
  pin the facet through the same opening.

  Worth knowing how this hid: the area invariant that catches every other splice
  error cannot see it. Two overlapping lobes wound the same way contribute their
  overlap twice to the shoelace, and the expected total counts it twice as well,
  so the numbers agree to 1e-13 while the outline is self-intersecting. It takes
  a direct pairwise test — and one that demands a *proper* crossing, since a
  lattice is full of exactly-collinear edges that a sign test admitting zero
  reports as hits.
- **The slot is a line, not a pocket.** The first version cut the tab's own
  footprint out of the sheet below, which left nothing to lap into and the tab
  rattling in a window. A slot needs *length* — a little more than the tab is
  wide — and no width at all: cardstock flexes to admit paper. It sits on the
  lattice edge, pushed out by half a material thickness (`SLOT_OUTWARD`),
  because folded paper does not turn on a zero radius and the descending riser
  stands slightly outboard of its fold line.

### Depth, and sharing

The tab drops to the **first sheet below with paper under that cell**, not
necessarily the next one. The sheets in between have no paper there either —
that is precisely why they are not the host — so the tab passes through an
opening that already exists and only the host is cut. On an interleaved design
this is not an edge case: 41% of boundary edges on `purple_cabbage` have nothing
directly below them.

Where the sheet below is *also* missing paper there, it has a tab on that same
lattice edge aimed at the same host, and **the two share one slot** — a line
admits any number of tabs. Slots are therefore pooled by undirected lattice edge
across all sheets and cut once at the end, which on `purple_cabbage` turns 1095
tabs into 879 slots.

What actually bounds the drop is not the stack but the flat pattern: riser plus
tongue has to fit the one cell the tab reaches into, whose half-width narrows to
nothing over the triangle's height. `MAX_TAB_REACH` is that curve solved for
`TAB_SIDE_MARGIN`, so retuning the tab cannot quietly push it out through the
side of the cell. Measured on every example, no boundary edge lacks a host
entirely — the only thing that turns an edge down is this reach.

`CUT_MATERIAL_MM` (0.3) is the **physical** cardstock, deliberately not
`sheetThicknessMm`, which is the preview's fat slab. Using the preview value
would draw risers an order of magnitude too long.

### Where it plugs in

Planned once by the dialog and handed to **both** builders, the way `CutPlan`
already is — the preview is only worth looking at if it places the joints the
file will cut. Then:

- `traceUnionLoops` gains `tabs`, spliced by directed edge key. The splice
  happens **inside** `hexNeck`, not as a later pass: a tab's root points lie on
  the original edge line and the collinear filter would otherwise drop them.
  Emitting them explicitly after the vertex they follow bypasses that test.
- **Rounding needs no special case.** Tab vertices are not lattice vertices, so
  `latticeVertexIdAt` returns null and they stay sharp for free — the same
  mechanism that keeps the necks straight. And splicing *before* rounding is what
  makes it safe: the tab shortens the straight run either side, so
  `roundPolygon`'s own clamp already stops an arc reaching past the tab root.
  Measured across the full radius range on `purple_cabbage`, all 1152 tabs
  survive intact and the outline moves by under 0.15% at the very top of the
  slider, which is that clamp and nothing else.
- **Slots get their own SVG layer**, not a sub-path of the sheet's compound
  path. Same geometry for the machine either way, but a slot drawn as one more
  sub-path is indistinguishable from the artwork's own negative space — there
  was no way to tell which holes were joinery. It is also the only honest shape
  for it: a slot is a line, and a line cannot be a hole.
- **The 3D preview cuts slots as thin openings** (`slotRects`) where the file
  cuts a zero-width line, and a slot forces `sheetBody` onto the traced-loop path
  whatever the rounding radius — overlapping lattice prisms have nowhere to put
  an absence. An invisible slot would defeat the point of previewing them.
- **Tabs stay with their own sheet in the preview**, spliced and extruded at its
  Z rather than drawn folded down where the assembled paper really puts them.
  Folded reads as a tab on the wrong layer, especially exploded, and the question
  the preview has to answer is *which piece is this tab holding*.
- Sites adjacent to a **neck** pinch are rejected only when they would actually
  collide: the neck reaches `min(neck, 0.45·len)` from the vertex and the tab
  root sits half a root width in from the midpoint. Rejecting every pinched edge
  outright, without measuring, loses most of the sites on a woven design — and
  the dialog has to *pass* `neck` for the test to mean anything, which it did
  not at first.
