import type { SelectionSnapshot } from "@/lib/hex-flower";

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
