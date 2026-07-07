Good feature, and it slots in nicely if it's designed at the right layer. Here's the strategy, working from geometry outward to UI.

## 1. Where "brush size" belongs conceptually

You already have a target-expansion pipeline: `tri → expandTargets(tri) → [flower copies × symmetry mirrors]`. Brush size is another expansion stage, and it needs to run **before** `expandTargets`, not instead of it — a user should be able to combine "hex-wedge brush" with flower/symmetry and get the wedge mirrored too, not just the single trixel.

So the pipeline becomes:

```
tri → brushTargets(tri, brushSize) → [seed trixels]
    → expandTargets(seed) for each seed → union, deduped
```

Concretely, add one function alongside `expandTargets` in `use-interaction.ts`:

```ts
const brushExpand = useCallback((tri: TriKey): TriKey[] => {
  const seeds = brushSizeRef.current === "hex"
    ? getHexWedgeTrixels(tri, gridDivisionsRef.current)
    : [tri];
  const out = new Map<string, TriKey>();
  for (const seed of seeds) {
    for (const t of expandTargets(seed)) {
      out.set(triToString(t), t);
    }
  }
  return [...out.values()];
}, [expandTargets]);
```

This becomes the new thing tools call instead of `expandTargets` directly. `select` and `stamp` keep using raw `expandTargets`/single-tri logic — brush size should only apply to the four edit tools (paint/erase/dodge/burn), since "brush" implies painting, not selection.

## 2. The new geometry primitive: `getHexWedgeTrixels`

This is the one genuinely new piece of math, and it belongs in `lib/hex-flower.ts` next to `enumerateHexTrixels`/`triToHex`, since it needs the same internal notion of "wedge" that must already exist for those (a hex divided into 6 triangular sectors, each sector subdivided N×N).

Signature:
```ts
export function getHexWedgeTrixels(tri: TriKey, N: number): TriKey[]
```

Implementation approach:
1. `const { c, k } = triToHex(tri.q, tri.r, tri.type, N)` — find which hex `tri` belongs to.
2. Determine which of the 6 wedges `tri` falls in. If `enumerateHexTrixels`/`captureHexSnapshot` already compute a per-trixel `(dq, dr, type)` offset relative to hex center (they do — `captureHexSnapshot` returns `trixels` with `dq/dr/type`), then whatever internal logic currently buckets those offsets into "which of 6 sectors" is the thing to expose. If that bucketing doesn't already exist as a named concept internally, you'll need to add a `wedgeIndexOf(dq, dr, type): 0-5` helper — likely just an angle check on the offset vector, snapped to 60° sectors, using `triCenter` to get each trixel's actual centroid relative to `hexCenterTriAxial(c, k, N)`.
3. Filter `enumerateHexTrixels(c, k, N)` down to just the trixels whose wedge index matches.

If N is 0 (hex lattice disabled) or `tri`'s hex can't be resolved meaningfully, fall back to `[tri]` — hex-brush degrades to single-triangle brush gracefully rather than erroring.

I don't have visibility into `hex-flower.ts`'s internals, so this is the one place I'd want to see the current `enumerateHexTrixels` implementation before writing the wedge-bucketing logic — reuse whatever sector math it already has rather than re-deriving it.

## 3. State & plumbing

- Add `brushSize: "single" | "hex"` to `useInteraction`'s args, alongside `symmetry`/`gridDivisions` — same pattern (owned by the parent component, passed down).
- Mirror it into a `brushSizeRef` in `use-interaction.ts`, same as every other setting.
- Add `brushSize` to `ToolContext` in `types.ts`, or — cleaner — don't put it on `ToolContext` at all. Since only the edit-tool factory needs it, and `brushExpand` is what gets passed to tools (replacing `ctx.expandTargets` calls with `ctx.brushExpand` in the four edit tools), you can keep `brushSize` itself out of the tool layer entirely and just swap the function reference on `ctx`.

That's actually the cleanest cut: **rename `expandTargets` → keep it as-is for select/stamp, add `brushExpand` as the new field edit tools use.** Minimal surface area change to `types.ts`, and Phase 2's `makeEditTool` factory (from the plan) would just call `ctx.brushExpand(tri)` instead of `ctx.expandTargets(tri)` — one line, in one place, benefiting paint/erase/dodge/burn simultaneously.

## 4. Interaction with non-idempotent tools (dodge/burn) — the part that'll bite you if skipped

This is exactly the bug class from your drag issue. With hex-brush on, a single drag stroke will pass over many trixels whose *wedge sets overlap* between adjacent mouse-move samples — e.g., two consecutive `onMove` samples might land in the same wedge, or in wedges that share trixels near a boundary (shouldn't happen if wedges partition cleanly, but flower/symmetry mirrors of different seeds absolutely can collide). The existing `visited` Set already guards this — as long as brush-expanded targets flow through the *same* "compute full candidate set → dedupe against `visited` → mutate `visited` once outside `setPainted` → apply" fix from before, you get brush support for free with no new bug surface. This is a strong argument for landing the drag-bug fix and the `makeEditTool` factory *before* brush size, so brush size is just "swap `expandTargets` for `brushExpand`" inside an already-correct shell, rather than needing the dedupe-outside-updater fix re-derived and re-applied under brush semantics.

## 5. Interaction with `selectedHex` clipping

`expandTargets` currently clips its output to `selectedHex` when one is active. Decide the semantics up front: if a hex is selected and the user hex-brushes on a *different* hex, do they get nothing (fully clipped, consistent with today) or does brush override the selection clip? I'd keep it clipping — selection is a stronger, more deliberate constraint than a brush setting — but call this out explicitly in a code comment since it's a one-line behavioral decision that's easy to get backwards.

## 6. UI

- Toolbar: a two-state toggle (single trixel icon / hex icon) next to wherever tool selection lives, enabled only when `gridDivisions > 0` (hex-brush is meaningless with the lattice off — disable or hide it, don't let it silently no-op).
- Optional: keyboard shortcut to cycle brush size, matching whatever pattern (if any) exists for symmetry/tool switching.

## Suggested sequencing

1. Land the dodge/burn drag fix + `makeEditTool` factory (Phase 2 item 1) first — brush size wants to build on a correct, deduplicated shell.
2. Add `getHexWedgeTrixels` in isolation with a couple of unit tests (pick a hex, verify it returns exactly N² trixels, verify the 6 wedges partition the hex with no overlap/gaps) — this is the riskiest new math and easiest to get subtly wrong at wedge boundaries.
3. Wire `brushExpand` into `use-interaction.ts` and swap it into the edit-tool factory.
4. UI toggle last, once the underlying behavior is verified via existing tools' drag/click paths.
