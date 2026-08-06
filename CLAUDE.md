# AGENTS.md

Single-page triangular-grid drawing tool. This file holds the quick start, the
rules that apply everywhere, and an index. **Everything else lives in `docs/`**,
and the per-module/per-symbol map is generated — do not restate either here.

- [CODEMAP.md](CODEMAP.md) — auto-generated map of every module and export, with
  the first line of each doc comment. Regenerate with `npm run map`. **Look here
  first for "where does X live" / "what does this module export"**; the code's
  own doc comments are the detail below that.
- `docs/` — the design notes: what was tried, what is load-bearing, and why. Read
  the relevant one before changing that area, because most of it records
  decisions that look arbitrary and are not.

| Doc | Covers |
|---|---|
| [docs/grid.md](docs/grid.md) | Canvas rendering, the hex grid system, `(q, r)` / `(a, b, c)` coordinates |
| [docs/ui.md](docs/ui.md) | Keyboard shortcuts, zoom & touch, symmetry function panel, fullscreen |
| [docs/pattern-brush.md](docs/pattern-brush.md) | The procedural pattern brush and its layer stack |
| [docs/hatch-layers.md](docs/hatch-layers.md) | Hatch layers, the hatch brush, convert-to-hatches |
| [docs/layer-effects.md](docs/layer-effects.md) | Round corners, outline, glow, adjust colour, subdivision noise |
| [docs/exports.md](docs/exports.md) | Crop & export (PNG/SVG), plotter export, apparel export |
| [docs/persistence.md](docs/persistence.md) | localStorage keys, `ProjectSnapshot`, the `.trixel.svg` project file, examples |
| [docs/fabrication-export.md](docs/fabrication-export.md) | Design spec for the cutting-machine export (not implemented) |

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
- Deployed to GitHub Pages via `.github/workflows/pages.yml` (static export; `GITHUB_PAGES=true` sets `output: export` + `basePath` in `next.config.ts`). Remote image patterns configured for `placehold.co`, `images.unsplash.com`, `picsum.photos`
- Types are scattered across the files that own them — `CODEMAP.md` lists every one with its module. The two worth knowing without looking: `Symmetry` is declared in `src/lib/hex-flower.ts` **and duplicated** in `src/components/Footer.tsx`, and `HexMode` lives in `Footer.tsx` rather than in a lib

## Rules that apply everywhere

- **GOLDEN RULE**: Every editing action that changes anything inside `ProjectSnapshot` MUST push one via `pushHistory()`. That is `painted` — paint, erase, move-tool translations, stamp placement, palette remapping (`onShiftUp`/`onShiftDown`), selection deletion, pattern-brush strokes, pattern-preset capture/delete — **and the layer stack itself**: add, delete, duplicate, reorder, visibility, effects.
  - **Skipping the push is worse than "not undoable".** The next commit snapshots the changed value anyway, so undoing that *later* edit silently rolls this one back too. Layer visibility and reorder had exactly this bug: hide a layer, paint a stroke, undo the stroke, and the layer came back.
  - The escape hatch for state that should not be undoable is to **not apply it on restore**, not to skip the push. `registerRestore` deliberately leaves the grid settings alone, and undo/redo deliberately leave `activeLayerIdx` alone (clamped to the restored layer count), so that moving around between strokes is never rolled back.
  - Tools do not call `pushHistory` directly — they call `ctx.onCommit()`, which bumps a counter that an effect turns into one `pushHistory(buildSnapshot())`. Pushing from inside a `setPainted` updater would double-fire under StrictMode and desync `historyIdx`. Commit **once per stroke**, on pointer-up, not per cell. In `LayerPanel` every mutation goes through its local `commit()` for the same reason.
- **Colors are stored encoded**, not as hex: `"paletteIdx,colorIdx"` via `encodeColor`, resolved through `resolveColor` (`src/lib/constants.ts`). `PALETTE_DEFS` holds 14 HSL-derived palettes × 9 lightnesses, shifted globally by `hueOffset`/`satOffset`. Painted data therefore follows palette changes automatically — compare encoded values, not resolved hex, when testing swatch identity (separate palettes can resolve to the same color). The documented exceptions all share one reason: where the only question is *whether the eye sees a boundary*, comparison is on the resolved hex (`region-outline.ts`, `round-corners.ts`).
  - **`NO_PRINT` is a colour that never renders.** A construction mark: it takes part in the boundary-degree count in `round-corners.ts` — which is what forces a corner to stay sharp — and is skipped everywhere else. It deliberately **fails `decodeColor`**, so the many consumers that already skip undecodable values skip it for free; the one place that had to be taught to admit it is `boundaryVertexDegrees`. Adding a new consumer of `painted` means deciding which side it is on, and the safe default (skip) is the one you get by doing nothing. See [docs/layer-effects.md](docs/layer-effects.md).
  - **`hueOffset`/`satOffset` live in module state** inside `constants.ts` rather than being arguments to `resolveColor`, so `setPaletteOffsets` **must be called during render, not in an effect**. It is a `useMemo` in `TrixelGrid` for exactly that reason. React flushes child effects before parent ones, so as an effect it landed *after* `GridCanvas` had already painted with the previous offsets — and since nothing else had changed, no further draw was scheduled. On first load the saved offsets arrive in one restore and never change again, so the artwork kept the unshifted palette until the next edit happened to redraw it. Anything else that syncs module state consumed by descendants has the same constraint.
- **`setPainted` updaters must be pure** — React StrictMode replays them. Precompute the keys/colors outside the updater (see `edit-tool.ts` and `pattern-tool.ts`).
- **Adding a field to `ProjectSnapshot`** means updating **every** literal that builds one (TypeScript finds them) *and* the dependency array of the effect that writes `trixel-save`, or the value will live in memory and never persist. See [docs/persistence.md](docs/persistence.md) for the view-state / authored-content split that decides whether a new setting belongs there at all.
- **Optional fields on `Layer` are read through a helper, never directly** — `layerKind(l)` for `kind`, `layerEffects(l)` / `activeEffects(l)` for `effects`. Absent means the pre-existing default, which is what lets every old save, project file and history snapshot keep working with no migration.

## Tools

Each tool is a `ToolHandler` (`onDown`/`onMove`/`onUp`) in `src/lib/tools/`, registered in `toolMap` and dispatched by `use-interaction.ts`. Adding a tool means touching `Tool` in `tools/types.ts`, `toolMap`, `editTools` **and `isEditTool`** in `Toolbar.tsx`, the `hoverTargets` guard in `use-interaction.ts`, and `use-keyboard-shortcuts.ts`. Tools that don't paint (`select`, `crop`) get their own button in the `data-tour="effects"` group instead and stay out of both `editTools` and `isEditTool`. (Hatch is the documented exception — it takes over the Paint slot rather than joining `editTools`; see [docs/hatch-layers.md](docs/hatch-layers.md).)

| Tool | Shortcut | Description |
|---|---|---|
| Paint | `P` | Paint triangles with selected color |
| Erase | `E` | Erase (clear) triangles. **ALT-click erases every cell of the clicked colour** on the layer, clipped to the hex selection when there is one |
| Fill | `F` | Edge-connected flood fill (`computeFillRegion`), bounded by `FILL_MAX_RADIUS` or clipped to the hex selection. **ALT-click erases that region** instead of recolouring it |
| Pattern | `N` | Procedural pattern brush; paints whole hexes |
| Hatch | `G` | Line-work brush; only on a hatch layer |
| Dodge / Burn | `D` / `B` | Step the palette index lighter/darker |
| Clone | `C` | Clone-stamp from a captured source |
| Eyedropper | `I` | Pick a painted color |
| Move | `H` | Drag to translate painted trixels; **ALT-drag moves every layer**. Click without dragging re-origins the lattice on that trixel. Right-click pans the view |
| Select | `S` | Click a hex to select it; captures all painted trixels inside as a snapshot. Drag the selection to move its contents — **ALT-drag moves every layer**, SHIFT-drag copies, ALT-*click* still removes a hex from the selection |
| Stamp | `T` | Alt-click a hex to define stamp source (yellow flash); click to stamp (right-click erases); `+` button in palette to enter capture mode |
| Crop | `X` | Drag handles to set the export region. **No toolbar button** — reached from the hamburger's "Export for Fabric...", and closing its drawer leaves the mode |

- Right-click on a painted triangle acts as a color picker (eyedropper)
- Clicking a triangle with the same color clears it (except during drag)
- Stroke painting: `getTrianglesOnLine` samples along pointer moves for continuous strokes
- **ALT is per-tool.** On the two dragging tools (move, and dragging a hex selection) it means "all layers"; on erase and fill it means "erase wholesale" — every cell of that colour, or the whole flood region. There is no single global meaning to rely on
- **ALT means "all layers" on both dragging tools** (move, and dragging a hex selection), read live on every pointer move so it can be pressed or released mid-drag. On the select tool it shares a target with the older ALT-click-to-deselect, and the two are split by gesture: a press that never travels a whole lattice step is a click
- **The move tool does not compensate the view after a drag.** It used to: the artwork's world position changed and the view shifted the same amount the other way, so on release the piece snapped back to exactly where it started on screen and the drag appeared to do nothing. The *click* branch still compensates, and there it is right — that gesture re-indexes the lattice origin and is meant to leave the picture where it is
- `setAllPainted` (`useHistory`, on `ToolContext`) writes every layer's map at once; `setPainted` can only address the active layer. Only the move tool's ALT path needs it, and it stays off the common path deliberately — writing the whole stack on every pointer move gives every layer a new identity and rebuilds all their effect geometry
- `isToolAllowed(tool, kind)` (`tools/types.ts`) is the single source of truth for which tools a layer kind permits, enforced once by wrapping `setTool` as `changeTool` in `TrixelGrid`. **`changeTool` is the only caller of `setTool`** — it also reconciles the panel slot, so a new tool-switching path must go through it
- **The four right-hand drawers share one slot** and only one is ever open: `panel: PanelId | null` in `TrixelGrid`, `PanelShell` for the frame. Pattern and Crop & Export are owned by their tool; Layers and Grid Settings are toggled from the footer. See [docs/ui.md](docs/ui.md)

Full keyboard map: [docs/ui.md](docs/ui.md).

## Rendering pipeline

Every backend that draws the artwork — the canvas preview, the PNG exports and
both SVG exporters — walks the **same plan**: `buildRenderPlan(layers)`
(`src/lib/hatch-render.ts`) returns visible layers bottom-to-top with
consecutive effect-free fill layers coalesced, and hatch layers as their own
steps. Per-step readers (`stepRoundRadius`, `stepOutlineWeight`, `stepGlow`,
`stepColorAdjust`, `stepSubdivisionNoise`, `glowReceivers`) hand each backend
what that step needs. A new effect or a new backend goes through the plan, or the
preview and the file will disagree. See
[docs/layer-effects.md](docs/layer-effects.md).

Colours resolve at the last moment and geometry is shared: `stepRegionGeometry`
is the one definition of a region boundary, `ringTangents` the one definition of
where an arc begins, `subdivideTri` the one definition of how a cell splits.
The two effects that are not silhouette — colour adjust and subdivision noise —
both ride `generateTriangles`' optional parameters rather than each emit site,
which is what lets one change carry the PNG exporter and both SVG exporters at
once. The fabrication paths (3D, cutting, plotter, apparel cut)
deliberately do **not** run the plan — see the per-export notes for what each one
ignores and why.
