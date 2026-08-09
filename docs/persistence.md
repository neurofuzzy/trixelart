# Persistence & project files

> Detail doc. Index and the rules that apply everywhere: [CLAUDE.md](../CLAUDE.md). Module/symbol map: [CODEMAP.md](../CODEMAP.md).

## Persistence (localStorage)

| Key | Stores | Hook/Component |
|---|---|---|
| `trixel-save` | The `ProjectSnapshot` (see below) | `useHistory` |
| `trixel-settings` | View/tool settings: `gridDivisions`, `hexMode`, `flowerRadius`, `symmetry`, `gridOrientation`, `brushSize`, `showNoPrint`, `editorBg`, `projectName`, `hueOffset`, `saturationOffset`, `svgExport`, `patternLayers`, `patternPaletteIdx`, `crop`, `exportSettings`, `hatchBrush`, `hatchify`, `plotter`, `apparel` | `TrixelGrid` |
| `trixel-selections` | Array of `SelectionSnapshot` | `TrixelGrid` |

`ProjectSnapshot` — the unit of undo, of `trixel-save`, and of the saved project file (see "Project file") — is `{ layers, activeLayerIdx, gridDivisions, hexMode, flowerRadius, symmetry, selections, patternPresets, lastPaintTri }`. Adding a field means updating **every** literal that builds one (TypeScript finds them) *and* the dependency array of the effect that writes `trixel-save`, or the value will live in memory and never persist.

The **split matters**: `trixel-settings` is view state, `ProjectSnapshot` is authored content. A few `trixel-settings` entries describe the *document* and so are copied into the saved project file as well — see "Project file". Pattern *layers* (the live stack you are editing) are a setting; pattern *presets* (saved slots) travel with the project, like stamp selections.

- Legacy migration: boolean `hexMode` → string `HexMode`, boolean `symmetry60` → string `Symmetry`
- **The first edit on a fresh document cannot be undone.** `useHistory` starts at `historyIdx = -1` with an empty stack, so one commit lands at `0` and `handleUndo` bails on `historyIdx <= 0` — there is no snapshot of the empty state to return to. Pre-existing for every tool; do not mistake it for a missing `pushHistory`.

## Project file

A saved project is **`{slug}.trixel.svg`** — a real SVG that draws the artwork, with the project's JSON embedded in it. `src/lib/project-file.ts` owns the format; `svg-export.ts` and the importer's migration path do the actual work.

**The point is the thumbnail.** A `.json` project is an opaque blob in a file browser; an SVG is rendered by Finder and Nautilus (**not** by Windows Explorer, which has no native SVG thumbnailer), so the user sees their piece in the folder listing. Verified end-to-end by running the real macOS thumbnailer (`qlmanage -t`) over a saved file.

**A container swap, not a data change.** The payload is the same object the `.json` format held — a `ProjectSnapshot` plus `name`, `svgExport`, `version` — so the whole legacy migration block in `handleFileChange` (`normalizeHexMode`, the flat-`painted` wrap, the `symmetry60` branch) serves both containers unchanged, and old `.json` files load forever. It gained three fields that `trixel-settings` also holds but which describe the **document** rather than the workspace, so they have to travel with it: `hueOffset`/`saturationOffset` shift every *resolved* colour, and `gridOrientation` turns the whole lattice a quarter turn. Without them a project reopens looking unlike the thumbnail inside its own file.

**Loading applies the grid settings; undo does not.** Divisions, hex mode, flower radius and symmetry are in `ProjectSnapshot`, so they were always *written* to the file — but nothing applied them on load, and a modern file opened onto whatever grid happened to be on screen (only the legacy `data.settings` branch ever set them). The importer now applies them from the snapshot. This is deliberately **not** symmetric with `registerRestore`, which still leaves them alone so that changing a setting between strokes is not rolled back by `Ctrl+Z`: opening a document and stepping through its history are different acts. `gridOrientation` is not in `ProjectSnapshot` — adding a field there means touching every literal that builds one, and undo would ignore it anyway — so it rides with the payload's other document-level view state.

`readProjectFile` returns the payload **as text**, not parsed. The importer reads some thirty properties off an untyped `data`; handing it a typed object would mean a cast at every one of them, and a legacy file then takes byte-for-byte the path it always did.

**Two independent version numbers.** `version` on the `<trixel:project>` element is the *envelope* — where the payload lives and how it is encoded; a reader that sees a higher one refuses, because it structurally cannot decode it. `version` *inside* the JSON is the *content*. Moving to compressed base64 would bump the first and leave the second alone. The namespace URI is deliberately **unversioned**: putting a version in it makes every older reader fail to find the element at all.

**`generateSVG` gained `background` and `metadata` options** rather than the project module string-splicing into its output. Both absent ⇒ byte-identical output, so the artwork export is untouched. The reason to prefer options is `EMPTY_SVG`: it is **self-closing**, and a project with nothing painted but selections saved is entirely reachable, so a naive splice would produce either a project file containing no project or corrupt markup. All three exits now route through one `wrap()`, which makes that case structural instead of a regex special-case.

**The `]]>` guard is at the JSON level**, not a split CDATA section: `json.replace(/\]\]>/g, "]]\\u003e")`. A user can type `]]>` into a project or layer name. `\u003e` is a valid JSON escape that parses back to the identical character, so nothing has to be unescaped on read — and the file stays a **single** CDATA section, which is what keeps the regex fallback exact. Safe because `]]>` can only occur inside a string literal: nothing structural may follow a `]` except `,`, `]`, `}` or whitespace.

**Reading is DOM-first, regex second.** `DOMParser` looks the element up **by namespace URI, not prefix** (a foreign tool may rename `trixel:` to anything) and its `textContent` reads CDATA, escaped text and multiple adjacent sections identically. Only when the document is malformed enough that `DOMParser` refuses does a regex go after the payload directly — a broken `<path>` is no reason to lose a project. Construct the `DOMParser` **inside** the function: the app statically exports, so client components are prerendered in Node at build time and a module-scope `new DOMParser()` breaks the build. The parsed document is inert and only `textContent` is read out; keep it that way if a preview of the loaded file is ever added.

The drawing is always `{ stroke: true, merge: true }`, not the user's `svgExport`: merging is the biggest size lever and same-colour strokes close the antialiasing seams between abutting fills, and a project file's bytes should not change because someone toggled a checkbox in an unrelated export dialog. `buildProjectSVG` draws `payload.layers` rather than taking the artwork as a second argument, so a file whose thumbnail disagrees with its data is unrepresentable; hidden layers are skipped by `buildRenderPlan`, so the picture shows what the canvas shows while the payload keeps everything.

Re-saving a project SVG from another editor is **lossy and unsupported** — Inkscape rewrites `<metadata>` with its own RDF and may not preserve foreign children. The reader searches the whole document rather than only under `<metadata>`, which mitigates a relocation but not a deletion.

The two are "Save Project" in the hamburger (`.trixel.svg`, reloadable) and "Image (SVG)..." in the Export menu (`.svg`, not reloadable) — both write SVG, so the labels have to say which is which. Being in different menus helps but does not say it.

### Save Selection

Last item of the hamburger menu, next to Save Project because it writes the **same format**: a project file, loadable through the ordinary importer. Disabled with no hex selection.

`selectionPayload(payload, regions, opts)` is the whole of it — a **payload transform, not a second format**. It runs `clipLayersToSelection` (see [exports.md](exports.md)) over the layers and hands the result to `buildProjectSVG` like any other save, so the thumbnail is the selection and the data is the selection and neither can drift from the other. Everything else the payload carries rides along untouched: divisions, hex mode, symmetry, the palette offsets and the orientation all have to match, or the piece reopens meaning something different.

The dialog collects only what the narrowing cannot decide on its own:

- **Name** — becomes both `payload.name` and, slugged, the filename. The dialog shows the slugged result, which saves a trip through the download folder to find out what it was.
- **Include stamps** — the stamp palette (`selections`). Off by default: they are workspace furniture, not part of the selected artwork.
- **Include empty layers** — the clip empties any layer that had nothing inside the selection. Off by default, so the file is just the layers that contribute; on, the stack's shape survives the save. Either way **one layer always survives**, because a project with none cannot be opened — and it is the active one, emptied, so the file stays honest about where the selection came from.

`SaveSelectionDialog` is mounted only while open (`{saveSelectionOpen && …}`) rather than self-closing on an `open` prop like its neighbours. Every visit then starts from a fresh suggested name and fresh checkboxes with no effect to synchronise them — which is the whole reason: the project can be renamed, or a different selection made, between two visits.

`handleExport` and `handleSaveSelection` both go through one `writeProject(payload)` in `TrixelGrid`, so the two saves cannot diverge as formats.

### Example projects

`public/examples/*.trixel.svg` are ordinary project files saved by the app — not a separate format and not generated at build time, so a new one is added by drawing it, saving it into that folder and adding a line to `EXAMPLES` in `src/lib/examples.ts`. They live under `public/` because Next only serves that directory; they are fetched at runtime, never bundled.

**The thumbnails are the project files themselves.** A `.trixel.svg` draws its own artwork, so `<img src>` pointed at the very file that is about to be loaded *is* the preview — no generated thumbnails to keep in sync, and what the user clicks is exactly what they see.

`exampleUrl` prefixes `NEXT_PUBLIC_BASE_PATH`, set in `next.config.ts` from the same constant as `basePath`. This is load-bearing on GitHub Pages: `basePath`/`assetPrefix` rewrite framework assets and `<Image>` URLs but **not** a runtime `fetch()` or a plain `<img src>`, so an absolute `/examples/...` would 404 under `/trixelart/`.

`ExampleGallery` is presentational and used twice: as a labelled row on the splash (`compact`) and as a grid in the "Load Example..." dialog. On a first visit the canvas is empty, and "here is what this makes, click one" says more than the blurb can — hence thumbnails on the splash rather than another button. Loading pushes to history like any import, so it needs no confirmation: `Ctrl+Z` brings the previous work back.

The importer is split for this: `loadProjectText(text, label)` holds the container sniff, the version branch and every legacy migration, and `handleFileChange` is now just a `FileReader` wrapper around it. Both entry points arrive with the same thing — the text of a project file — so neither path can drift from the other.

