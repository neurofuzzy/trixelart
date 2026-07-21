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
  - **GOLDEN RULE**: Every editing action that modifies `painted` state MUST push a `ProjectSnapshot` to history via `pushHistory()` so it is undoable. This includes paint strokes, erase strokes, move-tool translations, stamp placement, palette remapping (`onShiftUp`/`onShiftDown`), selection deletion, and any future editing features. Missing a `pushHistory` call means the user cannot undo that action.

## Canvas rendering

- `GridCanvas` uses a `<canvas>` element with DPR scaling (not SVG)
- Triangles are batch-filled by color, grid outlines batched into single stroke
- `getTriVertices(q, r, type)` returns raw vertices; `getTriPath` wraps them into an SVG path string

## Tools

| Tool | Shortcut | Description |
|---|---|---|
| Paint | `P` | Paint triangles with selected color |
| Erase | `E` | Erase (clear) triangles |
| Pan | `H` | Drag to translate painted trixels (grid offset); right-click pans view |
| Select | `S` | Click a hex to select it; captures all painted trixels inside as a snapshot |
| Stamp | `T` | Alt-click a hex to define stamp source (yellow flash); click to stamp (right-click erases); `+` button in palette to enter capture mode |

- Color palette: 5 grayscale colors (`#000`, `#404040`, `#808080`, `#c0c0c0`, `#fff`). Keys `1`–`5` select color and switch to Paint tool
- Right-click on a painted triangle acts as a color picker (eyedropper)
- Clicking a triangle with the same color clears it (except during drag)
- Stroke painting: `getTrianglesOnLine` samples along pointer moves for continuous strokes

## Keyboard shortcuts

| Key | Action |
|---|---|
| `P` | Paint tool |
| `E` | Erase tool |
| `H` | Pan tool |
| `S` | Select tool |
| `T` | Stamp tool |
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
- Constants in `src/lib/config.ts`: `ZOOM_MIN=0.25`, `ZOOM_MAX=15`, `WHEEL_DIVISOR=100`, `PINCH_SENSITIVITY=2.5`
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

## Symmetry function panel

- Uses `new Function()` to eval user formulas against `a,b,c` coordinates
- Separately controlled via `ƒ` button in toolbar

## Fullscreen

- Toggle via toolbar button; uses `document.documentElement.requestFullscreen()` / `exitFullscreen()`

## Persistence (localStorage)

| Key | Stores | Hook/Component |
|---|---|---|
| `trixel-save` | Painted trixel grid (`Record<string,string>`) + undo/redo history stack | `useHistory` |
| `trixel-settings` | `{ gridDivisions, hexMode, flowerRadius, symmetry }` | `TrixelGrid` |
| `trixel-selections` | Array of `SelectionSnapshot` | `TrixelGrid` |

- Legacy migration: boolean `hexMode` → string `HexMode`, boolean `symmetry60` → string `Symmetry`

## Key modules

| Module | Purpose |
|---|---|
| `src/lib/grid-math.ts` | Triangular grid coordinate system (`SIDE=50`, `H`, `worldToTri`, `getTriVertices`, `getTriPath`, `getTriABC`, `getTrianglesOnLine`) |
| `src/lib/hex-flower.ts` | Hex geometry, flower offsets, symmetry paint targets, selection snapshots (`triToHex`, `flowerOffsets`, `rotateTrixelCCW`, `hexCenterWorld`, `enumerateHexTrixels`, `hexTranslation`, `paintTargets`, `captureHexSnapshot`, `hexCenterTriAxial`) |
| `src/lib/config.ts` | Zoom/pinch constants (`ZOOM_MIN`, `ZOOM_MAX`, `WHEEL_DIVISOR`, `PINCH_SENSITIVITY`) |
| `src/lib/constants.ts` | `GRAYSCALE_PALETTE` — 5 grayscale colors |
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
- `Tool = "paint" | "erase" | "pan" | "select" | "stamp"` — inline (not extracted to a shared types file)

## Notable

- Deployed to GitHub Pages via `.github/workflows/pages.yml` (static export; `GITHUB_PAGES=true` sets `output: export` + `basePath` in `next.config.ts`)
- Remote image patterns configured for `placehold.co`, `images.unsplash.com`, `picsum.photos`
