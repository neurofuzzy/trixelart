# Shortcuts, input & chrome

> Detail doc. Index and the rules that apply everywhere: [CLAUDE.md](../CLAUDE.md). Module/symbol map: [CODEMAP.md](../CODEMAP.md).

## Keyboard shortcuts

| Key | Action |
|---|---|
| `P` | Paint tool |
| `E` | Erase tool (ALT-click erases every cell of that colour) |
| `H` | Move tool (ALT-drag moves all layers) |
| `S` | Select tool (ALT-drag a selection moves all layers; ALT-click deselects a hex) |
| `T` | Stamp tool |
| `F` | Fill tool (ALT-click erases the region instead) |
| `N` | Pattern brush |
| `G` | Hatch brush (hatch layers only) |
| `D` / `B` | Dodge / Burn |
| `C` | Clone |
| `I` | Eyedropper |
| `X` | Crop & export (also opens its drawer; there is no toolbar button) |
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

## The panel slot

Four right-hand drawers — **Layers**, **Grid Settings**, **Pattern** and **Crop & Export** — share one strip down the right edge of the canvas, and **exactly one may be open at a time**. That is held by a single `panel: PanelId | null` in `TrixelGrid` rather than a boolean per drawer: with four booleans "only one" is a rule every new call site has to remember, and the failure mode is two drawers stacked on the same 384px of screen with the lower one unreachable.

`PanelShell` (`components/PanelShell.tsx`) is the frame — the `<aside>`, the header, the close button, and the pointer handlers that stop a drag on a slider painting a stroke through the artwork behind it. It **overlays the canvas rather than docking**: drawers come and go as tools and toggles change, and docking would reflow and re-centre the artwork every time, so the piece would appear to jump while the user is drawing.

Children supply their own scroll container, because the four do not agree on what should absorb leftover height — `PatternPanel` and `ExportPanel` give it to a preview, the other two to nothing.

**Two kinds of drawer, and the difference is who opens them.**

- **Tool-owned** (`panelForTool`): the Pattern drawer *is* the pattern brush's controls, and Crop & Export is the crop tool's. Selecting the tool opens it; leaving the tool closes it.
  - **Crop goes further: the drawer owns the tool back.** Crop has no toolbar button — it is entered from the hamburger's "Export for Fabric..." — so closing its drawer, or letting another drawer take the slot, exits crop mode (`showPanel` → `leaveCropMode`). Without that, opening Layers over it left the canvas covered in crop handles with painting locked out and nothing on screen to explain why. A tool whose whole interface is one drawer cannot outlive the drawer.
- **Manual**: Layers and Grid Settings are toggled from the footer and survive a tool change — unless a tool-owned drawer takes the slot, which is the one thing that can evict them.

**The reconciliation lives in `changeTool`, not in an effect keyed on `tool`.** Re-selecting the tool that already owns the slot does not change `tool`, so an effect would never fire and the drawer's own close button would be a one-way door: closed, with no way back short of switching tools twice. Doing it in the handler also avoids the cascading render `setState` inside an effect costs.

That only works because **`changeTool` is now the sole caller of `setTool`** — the two colour-palette paths that forced `paint` directly were routed through it. They were already leaks in the layer-kind lock-out the wrapper exists to enforce; the slot only made them visible. The lock-out effect calls `changeTool` for the same reason: selecting a hatch layer while the Pattern drawer is open moves the tool to `hatch`, and the drawer belonging to the tool that just went away has to go with it.

`tool === "crop"` therefore implies `panel === "export"`, which is what lets the footer's toggle exit crop mode without reading the current panel at all.

Verified in a browser across the whole matrix — footer toggles, tool switches, close-and-reopen, and a tool change out of a tool-owned drawer: never more than one `<aside>` on screen, and no path that leaves a drawer stranded.

## Canvas background

The canvas backdrop defaults to faint diagonal stripes (`DEFAULT_EDITOR_BG` in
`GridSettingsPanel`), which is what tells transparent apart from white-painted.
Grid Settings can swap it for any palette colour through the shared
`ColorPickerDialog` — useful for finding near-black cells, or for judging the
piece against the colour it will be printed on.

It is stored **encoded**, like painted colour, so it follows `hueOffset` /
`satOffset`; `null` means the stripes. It lives in `trixel-settings`, not in
`ProjectSnapshot` — it is workspace state, not the document, and it is
deliberately unrelated to the *export* background in `exportSettings.bgColor`,
which is the one that actually prints.

## Transient popovers

The fan-out (flower radius) slider hangs off its toolbar button as a small popover. It closes on **any pointer-down outside its wrapper** — another tool, a menu, the canvas — via a listener on `document` in the **capture** phase. Bubble phase does not work here: the canvas container and every drawer call `stopPropagation` on pointer events to keep drags off the artwork, so a bubbling listener never hears the click that most needs to close it. It also unmounts if the hex lattice is switched off underneath it, since its own button is disabled in that state.

## Zoom & touch

- Mouse wheel zoom with configurable `WHEEL_DIVISOR`; clamped by `ZOOM_MIN`/`ZOOM_MAX`
- Touch pinch-to-zoom with `PINCH_SENSITIVITY`; two-finger gestures suppress pointer handlers
- Constants in `src/lib/config.ts`: `ZOOM_MIN=0.25`, `ZOOM_MAX=2`, `WHEEL_DIVISOR=100`, `PINCH_SENSITIVITY=2.5`, `FILL_MAX_RADIUS=24`
- Viewport meta tag disables browser zoom on mobile (`RootLayout`)

## Symmetry function panel

- Uses `new Function()` to eval user formulas against `a,b,c` coordinates
- Separately controlled via `ƒ` button in toolbar

## Fullscreen

- Toggle via toolbar button; uses `document.documentElement.requestFullscreen()` / `exitFullscreen()`

