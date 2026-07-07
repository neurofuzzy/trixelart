import type { SelectionSnapshot } from "@/lib/hex-flower";

export function snapshotKey(snap: SelectionSnapshot): string {
  return JSON.stringify(
    snap.trixels.map((t) => [t.dq, t.dr, t.type, t.color]).sort(),
  );
}

export function upsertSelectionSnapshot(
  setSelections: React.Dispatch<React.SetStateAction<SelectionSnapshot[]>>,
  setActiveSelection: (s: SelectionSnapshot | null) => void,
  snap: SelectionSnapshot,
): void {
  const key = snapshotKey(snap);
  let activeSnap: SelectionSnapshot | null = null;
  setSelections((prev) => {
    const duplicate = prev.find(
      (s) => s.N === snap.N && snapshotKey(s) === key,
    );
    if (duplicate) {
      activeSnap = duplicate;
      return prev;
    }
    activeSnap = snap;
    const next = [snap, ...prev.filter((s) => s.id !== snap.id)];
    return next.slice(0, 5);
  });
  if (activeSnap) setActiveSelection(activeSnap);
}
