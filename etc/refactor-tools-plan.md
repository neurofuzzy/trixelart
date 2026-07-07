## The dodge/burn drag bug

Found it, and it's a genuinely subtle one. Compare `dodge-burn-tool.ts`'s `onMove` to `paint-tool.ts`'s `onMove`: paint/erase are **idempotent** — applying the same color or delete twice does nothing extra, so it doesn't matter if the same key gets touched more than once during a drag. Dodge/burn is **not** idempotent — dodging the same trixel twice dodges it twice. That's why `visited` exists: to guarantee each trixel gets touched at most once per drag stroke.

The bug is *where* that guarantee gets enforced:

```ts
ctx.setPainted((prev) => {
  const next = { ...prev };
  for (const t of targets) {
    const k = triToString(t);
    if (drag.visited.has(k)) continue;
    const existing = next[k];
    if (existing) {
      next[k] = apply(existing);
      drag.visited.add(k);   // ← mutating a ref-backed Set INSIDE the updater
      changed = true;
    }
  }
  return changed ? next : prev;
});
```

`drag.visited.add(k)` is a side effect happening *inside* a function passed to `setState`. React requires updater functions to be pure — safe to call more than once for the same transition. In dev/StrictMode (and in some concurrent-render replay paths), React **does** call updaters twice to catch exactly this kind of impurity. First call: `visited` doesn't have `k` yet, so it dodges the color and marks it visited. React discards that render and replays the updater with the *same* `prev` to check purity — second call: `visited.has(k)` is now `true` (because the Set was already mutated), so it skips the key entirely, and the *second* (kept) result never applies the dodge. Net effect: the dodge silently doesn't stick, intermittently, which matches "doesn't work when dragging" way better than a total failure would.

**Fix — pull the visited-marking out of the updater so it happens exactly once, and keep the updater pure:**

```ts
onMove(ctx, e, pos) {
  const drag = ctx.drag.current;
  if (drag.kind !== "edit") return;
  if (!drag.lastPaintedWorld) return;
  const world = ctx.screenToWorld(pos.x, pos.y);
  drag.hasMoved = true;

  const tris = getTrianglesOnLine(
    drag.lastPaintedWorld.x, drag.lastPaintedWorld.y,
    world.x, world.y,
  );
  drag.lastPaintedWorld = world;

  // Compute + commit "visited" here, OUTSIDE setPainted, so it only
  // ever runs once per real move event, regardless of updater replay.
  const candidates = new Set<string>();
  for (const tri of tris) {
    for (const t of ctx.expandTargets(tri)) {
      const k = triToString(t);
      if (!drag.visited.has(k)) candidates.add(k);
    }
  }
  if (candidates.size === 0) return;
  for (const k of candidates) drag.visited.add(k);

  ctx.setPainted((prev) => {
    const next = { ...prev };
    let changed = false;
    for (const k of candidates) {
      const existing = next[k];
      if (existing) {
        next[k] = apply(existing);
        changed = true;
      }
    }
    return changed ? next : prev;
  });
},
```

Now the updater only reads `prev` and the already-finalized `candidates` list — it can be called any number of times and always produces the same result. Same fix should be considered anywhere else a `drag.visited`-style Set gets mutated inside a `setPainted` callback (worth grepping for `.add(` inside `setPainted((prev) =>`).

---

## Phase 2 refactor plan

**1. Collapse paint / erase / dodge / burn into one factory** *(highest value, kills the most duplication)*
Extract a `makeEditTool(applyKey)` in a new `edit-tool.ts` that owns the shared shell — shift-click line-draw, drag painting, click-vs-drag `onUp` branching — and takes a small callback for the per-key mutation:
```ts
type KeyOp = (next: Record<string,string>, k: string, ctx: ToolContext) => boolean; // returns changed
function makeEditTool(op: KeyOp, opts?: { skipRevisit?: boolean }): ToolHandler
```
`paintTool`/`eraseTool` become one-liners; `makeDodgeBurnTool` passes `{ skipRevisit: true }` and folds its `visited`-outside-updater fix into the shared shell once, instead of needing it re-applied per tool later. This is the single biggest LOC reduction available and it structurally prevents the class of bug above from recurring in paint/erase if their semantics ever become non-idempotent too.

**2. Extract the selection-snapshot dedupe helper**
`select-tool.ts` and `stamp-tool.ts` both do the "stringify sorted trixels → find duplicate in `prev` → unshift + slice(0,5)" dance. Pull into `upsertSelectionSnapshot(setSelections, setActiveSelection, snap)` in `selection-utils.ts`.

**3. Resolve the stamp-tool erase-mode question**
Confirm whether the old `erase` branch in the stamp-paste loop was live functionality (stamp-as-eraser) or dead code before the refactor. If it was live, restore it as an explicit parameter (e.g. `ctx.captureMode`/modifier key) rather than the current dead `delete` immediately overwritten by `next[key] = t.color`. If it was already dead, just delete those two no-op lines.

**4. Dedupe the Safari DPR-correction hack**
Still three copies (`getRelativePointer`, `onTouchStart`, `onTouchMove` in `use-interaction.ts`). Pull into `normalizePoint(cx, cy): {x,y}` in a small `touch-utils.ts` and call it from all three.

**5. Audit for other impure `setState` updaters**
Given #1 above was a real bug, worth a quick pass over every `ctx.setPainted((prev) => ...)` and `setSelections((prev) => ...)` call across all tool files to confirm none of them read-or-write a ref/Set/mutable value from inside the callback body. `pan-tool.ts`'s `onMove` looks safe (pure `Object.entries` map, no mutation), but worth a deliberate check rather than assuming.

**6. Consider narrowing `ToolContext`**
It's currently one flat 25-field interface shared by every tool, most of which only touch 5–8 fields. Not urgent, but if tools keep growing, splitting into composable slices (`GeometryCtx`, `PaintCtx`, `SelectionCtx`) would make each tool's actual dependencies self-documenting instead of implicit.

I'd sequence it as: fix the drag bug now (already done above) → #1 (factory) → #3 (regression check, since it's a correctness question not just cleanup) → #2 and #4 (quick wins) → #5 as a final pass before considering Phase 2 done.
