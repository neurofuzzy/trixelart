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
| [docs/layer-effects.md](docs/layer-effects.md) | Round corners, outline, glow, adjust colour |
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

- **GOLDEN RULE**: Every editing action that modifies `painted` state MUST push a `ProjectSnapshot` to history via `pushHistory()` so it is undoable. This includes paint strokes, erase strokes, move-tool translations, stamp placement, palette remapping (`onShiftUp`/`onShiftDown`), selection deletion, pattern-brush strokes, pattern-preset capture/delete, and any future editing features. Missing a `pushHistory` call means the user cannot undo that action.
  - Tools do not call `pushHistory` directly — they call `ctx.onCommit()`, which bumps a counter that an effect turns into one `pushHistory(buildSnapshot())`. Pushing from inside a `setPainted` updater would double-fire under StrictMode and desync `historyIdx`. Commit **once per stroke**, on pointer-up, not per cell.
- **Colors are stored encoded**, not as hex: `"paletteIdx,colorIdx"` via `encodeColor`, resolved through `resolveColor` (`src/lib/constants.ts`). `PALETTE_DEFS` holds 14 HSL-derived palettes × 9 lightnesses, shifted globally by `hueOffset`/`satOffset`. Painted data therefore follows palette changes automatically — compare encoded values, not resolved hex, when testing swatch identity (separate palettes can resolve to the same color). The documented exceptions all share one reason: where the only question is *whether the eye sees a boundary*, comparison is on the resolved hex (`region-outline.ts`, `round-corners.ts`).
- **`setPainted` updaters must be pure** — React StrictMode replays them. Precompute the keys/colors outside the updater (see `edit-tool.ts` and `pattern-tool.ts`).
- **Adding a field to `ProjectSnapshot`** means updating **every** literal that builds one (TypeScript finds them) *and* the dependency array of the effect that writes `trixel-save`, or the value will live in memory and never persist. See [docs/persistence.md](docs/persistence.md) for the view-state / authored-content split that decides whether a new setting belongs there at all.
- **Optional fields on `Layer` are read through a helper, never directly** — `layerKind(l)` for `kind`, `layerEffects(l)` / `activeEffects(l)` for `effects`. Absent means the pre-existing default, which is what lets every old save, project file and history snapshot keep working with no migration.

## Tools

Each tool is a `ToolHandler` (`onDown`/`onMove`/`onUp`) in `src/lib/tools/`, registered in `toolMap` and dispatched by `use-interaction.ts`. Adding a tool means touching `Tool` in `tools/types.ts`, `toolMap`, `editTools` **and `isEditTool`** in `Toolbar.tsx`, the `hoverTargets` guard in `use-interaction.ts`, and `use-keyboard-shortcuts.ts`. Tools that don't paint (`select`, `crop`) get their own button in the `data-tour="effects"` group instead and stay out of both `editTools` and `isEditTool`. (Hatch is the documented exception — it takes over the Paint slot rather than joining `editTools`; see [docs/hatch-layers.md](docs/hatch-layers.md).)

| Tool | Shortcut | Description |
|---|---|---|
| Paint | `P` | Paint triangles with selected color |
| Erase | `E` | Erase (clear) triangles |
| Fill | `F` | Edge-connected flood fill (`computeFillRegion`), bounded by `FILL_MAX_RADIUS` or clipped to the hex selection |
| Pattern | `N` | Procedural pattern brush; paints whole hexes |
| Hatch | `G` | Line-work brush; only on a hatch layer |
| Dodge / Burn | `D` / `B` | Step the palette index lighter/darker |
| Clone | `C` | Clone-stamp from a captured source |
| Eyedropper | `I` | Pick a painted color |
| Pan | `H` | Drag to translate painted trixels (grid offset); right-click pans view |
| Select | `S` | Click a hex to select it; captures all painted trixels inside as a snapshot |
| Stamp | `T` | Alt-click a hex to define stamp source (yellow flash); click to stamp (right-click erases); `+` button in palette to enter capture mode |
| Crop | `X` | Drag handles to set the export region |

- Right-click on a painted triangle acts as a color picker (eyedropper)
- Clicking a triangle with the same color clears it (except during drag)
- Stroke painting: `getTrianglesOnLine` samples along pointer moves for continuous strokes
- `isToolAllowed(tool, kind)` (`tools/types.ts`) is the single source of truth for which tools a layer kind permits, enforced once by wrapping `setTool` as `changeTool` in `TrixelGrid`. **`changeTool` is the only caller of `setTool`** — it also reconciles the panel slot, so a new tool-switching path must go through it
- **The four right-hand drawers share one slot** and only one is ever open: `panel: PanelId | null` in `TrixelGrid`, `PanelShell` for the frame. Pattern and Crop & Export are owned by their tool; Layers and Grid Settings are toggled from the footer. See [docs/ui.md](docs/ui.md)

Full keyboard map: [docs/ui.md](docs/ui.md).

## Rendering pipeline

Every backend that draws the artwork — the canvas preview, the PNG exports and
both SVG exporters — walks the **same plan**: `buildRenderPlan(layers)`
(`src/lib/hatch-render.ts`) returns visible layers bottom-to-top with
consecutive effect-free fill layers coalesced, and hatch layers as their own
steps. Per-step readers (`stepRoundRadius`, `stepOutlineWeight`, `stepGlow`,
`stepColorAdjust`, `glowReceivers`) hand each backend what that step needs. A new
effect or a new backend goes through the plan, or the preview and the file will
disagree. See [docs/layer-effects.md](docs/layer-effects.md).

Colours resolve at the last moment and geometry is shared: `stepRegionGeometry`
is the one definition of a region boundary, `ringTangents` the one definition of
where an arc begins. The fabrication paths (3D, cutting, plotter, apparel cut)
deliberately do **not** run the plan — see the per-export notes for what each one
ignores and why.
