# Fabrication Export — Design Spec

> Status: **design/spec only, not implemented.** The 3D-print export (`src/lib/mesh-export.ts`, `Export3DDialog`, `Model3DPreview`) exists; the **cutting-machine (Cricut/paper) export** described here does not yet. This document is the plan of record.

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

**Phase 3 — SVG cut export.** Boundary tracing (§5) → per-sheet SVG files (bottom→top), shared origin, assembly notes.

**Phase 4+ (deferred).** Cardstock-swatch mapping UI · live layerability feedback while drawing · weeding/feature-size guards · budget>0 auto-splits · bridge-hint surfacing.
