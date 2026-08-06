import type { SelectionSnapshot } from "@/lib/hex-flower";
import { triToHex } from "@/lib/hex-flower";
import type { TriKey } from "@/lib/grid-math";
import type { ToolContext } from "./types";

/**
 * Builds a predicate clipping an operation to the active hex selection, or
 * `undefined` when there's no selection to constrain to. Shared by every tool
 * that treats the selection as a boundary rather than a target — fill walls
 * itself in with it, ALT-erase scopes its sweep to it.
 */
export function selectionConstraint(
  ctx: ToolContext,
): ((t: TriKey) => boolean) | undefined {
  const N = ctx.gridDivisions;
  if (ctx.selectedHexes.length === 0 || N <= 0) return undefined;
  const hexSet = new Set(ctx.selectedHexes.map((h) => `${h.c},${h.k}`));
  return (t: TriKey) => {
    const h = triToHex(t.q, t.r, t.type, N);
    return hexSet.has(`${h.c},${h.k}`);
  };
}

export function snapshotKey(snap: SelectionSnapshot): string {
  return JSON.stringify(
    snap.trixels.map((t) => [t.dq, t.dr, t.type, t.color]).sort(),
  );
}

export function upsertSelectionSnapshot(
  current: SelectionSnapshot[],
  setSelections: React.Dispatch<React.SetStateAction<SelectionSnapshot[]>>,
  setActiveSelection: (s: SelectionSnapshot | null) => void,
  snap: SelectionSnapshot,
): void {
  const key = snapshotKey(snap);

  // Capturing an area that already exists in the palette must not create a
  // duplicate — but it should still make that existing stamp the active
  // selection so the user can immediately start stamping it. Detect the
  // duplicate against the current list synchronously so setActiveSelection
  // runs with a concrete value (reading it back out of the setSelections
  // updater would be too late — that updater runs during the next render).
  const duplicate = current.find(
    (s) => s.N === snap.N && snapshotKey(s) === key,
  );
  if (duplicate) {
    setActiveSelection(duplicate);
    return;
  }

  setSelections((prev) => {
    // Re-check inside the updater to stay correct if the list changed since
    // this event started.
    if (prev.some((s) => s.N === snap.N && snapshotKey(s) === key)) return prev;
    return [snap, ...prev.filter((s) => s.id !== snap.id)].slice(0, 5);
  });
  setActiveSelection(snap);
}
