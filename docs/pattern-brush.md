# Pattern brush

> Detail doc. Index and the rules that apply everywhere: [CLAUDE.md](../CLAUDE.md). Module/symbol map: [CODEMAP.md](../CODEMAP.md).

Ported from the `prismatic` cap mapping in the sibling **material-forge** repo. The two grids are *the same lattice*: `worldToTri` performs exactly the skew that shader's `mfTriCell` does, and `triCenter` already returns what `mfTriPos(mfTriCentroid(...))` computes — so the port was mostly reuse.

**How it works.** Each trixel's centroid is rotated, scaled, and re-quantized through `worldToTri`; the resulting cell's up/down parity is the pattern value. That is the whole predicate. The interest is emergent: above `scale = 1` the pattern lattice is finer than the trixel lattice, so each trixel point-samples a denser field and the two beat against each other. `scale 2.6 / rotation 235` gives interlocking hexagons.

Load-bearing consequences — all three were tried the other way and reverted:

- **Rotation is continuous and `scale` runs past 1.** Snapping the angle to the lattice's 6-fold symmetry, or capping the scale, makes the entire emergent family unreachable. The aliasing is the feature.
- **Sampling is at the centroid.** The patterns are aliasing artifacts, so the sample position is load-bearing, not incidental.
- **Values are a pure function of world position**, so the field is global. Hexes brushed in separate strokes line up as one continuous pattern rather than independent stamps.

`up`/`down` naming is **inverted** relative to the shader: trixelart's `'up'` (`lq + lr < 1`) is the shader's `up = 0`. Getting it backwards silently inverts the checker.

**Stack.** `PatternLayer[]`, bottom-first. Each layer has its own two encoded colors, a blend mode (`normal | multiply | screen | difference`, ported from `mfBlend`), opacity and visibility. Compositing starts from the bottom layer's `bg` — so a single `normal` layer at full opacity behaves exactly as it did before stacking existed — and runs in **authoring sRGB space, not linear**; the modes read differently in linear.

**Quantization.** Compositing two swatches rarely lands on a third, so the result snaps to the nearest palette color in **OKLab**, searched across *all* palettes. Plain RGB distance routinely prefers a wrong-hue swatch across 18 palettes. Results are memoized on the composited RGB (an N-layer stack yields only a handful of distinct colors), and the painter is built once per pointer event so the memo stays warm across hexes.

**UI.** `PatternPanel` is one of the four `PanelShell` drawers, and one of the two *owned by a tool* — selecting the pattern brush opens it, leaving the brush closes it (see the panel slot in [ui.md](ui.md)). Its preview is the only flex child, so it absorbs leftover height and is the first thing to give way on short displays; the square is sized in JS via `ResizeObserver` because CSS cannot fit a square to both axes of a box. The editor is tabbed (Pattern: blend mode, scale, rotation / Color: palettes, primary, secondary, opacity), which keeps both halves short enough to fit down to ~500px tall. The 18 palette chips need the drawer's full `w-96` width to stay on one line.

`PatternPalette` replaces `ColorPalette` while the tool is active — the brush takes every color from its own stack, so the paint swatches control nothing, and clicking one would silently switch tools. Slots save/load whole stacks, deep-copied in both directions.

