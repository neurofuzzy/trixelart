"use client";

import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { clipLayersToSelection } from "@/lib/hatch-render";
import { projectFileName, type SelectionSaveOptions } from "@/lib/project-file";
import type { Layer } from "@/hooks/use-history";
import type { HexRegion } from "@/lib/hex-flower";

/**
 * "Save Selection..." — names a project file holding only what the hex
 * selection covers.
 *
 * A *save*, not an export: the result is an ordinary `.trixel.svg` that loads
 * back through the ordinary importer, so this dialog only collects the three
 * decisions the narrowing cannot make on its own — what to call it, and whether
 * the stamps and the emptied layers come too. The clip itself lives in
 * `selectionPayload`.
 */
export function SaveSelectionDialog({
  onOpenChange,
  onSave,
  layers,
  selection,
  stampCount,
  projectName,
}: {
  /** Mounted only while open, so every visit starts from a fresh name and
   *  fresh checkboxes with no effect to synchronise them. */
  onOpenChange: (open: boolean) => void;
  onSave: (opts: SelectionSaveOptions) => void;
  /** The whole stack, hidden layers included — the payload carries them all. */
  layers: Layer[];
  selection: HexRegion[];
  /** How many stamps are in the palette, so the checkbox can say. */
  stampCount: number;
  projectName: string;
}) {
  const [name, setName] = useState(`${projectName} selection`);
  const [includeStamps, setIncludeStamps] = useState(false);
  const [includeEmptyLayers, setIncludeEmptyLayers] = useState(false);

  // What the save will actually contain, so the counts below are the file's and
  // not an estimate of it.
  const summary = useMemo(() => {
    const clipped = clipLayersToSelection(layers, selection);
    let cells = 0;
    let painted = 0;
    for (const l of clipped) {
      const n = Object.keys(l.painted).length;
      cells += n;
      if (n > 0) painted++;
    }
    return { cells, painted, empty: clipped.length - painted };
  }, [layers, selection]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && summary.cells > 0;

  const commit = () => {
    if (!canSave) return;
    onSave({ name: trimmed, includeStamps, includeEmptyLayers });
    onOpenChange(false);
  };

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save Selection</AlertDialogTitle>
          <AlertDialogDescription>
            Writes a project file holding only what the {selection.length} selected
            hex{selection.length === 1 ? "" : "es"} cover. It loads back like any
            other project.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Name
            </span>
            <input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Escape is read by the global shortcuts *before* their
                // focused-INPUT guard, so without this, dismissing the dialog
                // would also clear the selection being saved.
                e.stopPropagation();
                if (e.key === "Enter") commit();
                if (e.key === "Escape") onOpenChange(false);
              }}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
            {/* The name is slugged for the filename, so showing the result
                saves a round trip through the download folder to find out. */}
            <span className="text-[11px] font-mono text-muted-foreground/60 truncate">
              {trimmed ? projectFileName(trimmed) : " "}
            </span>
          </label>

          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeStamps}
                disabled={stampCount === 0}
                onChange={(e) => setIncludeStamps(e.target.checked)}
                className="rounded disabled:opacity-40"
              />
              <span className="text-sm text-muted-foreground">
                {stampCount === 0
                  ? "Include stamps (none captured)"
                  : `Include stamps (${stampCount})`}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeEmptyLayers}
                disabled={summary.empty === 0}
                onChange={(e) => setIncludeEmptyLayers(e.target.checked)}
                className="rounded disabled:opacity-40"
              />
              <span className="text-sm text-muted-foreground">
                {summary.empty === 0
                  ? "Include empty layers (none)"
                  : `Include empty layers (${summary.empty})`}
              </span>
            </label>
          </div>

          <p className="text-xs text-muted-foreground tabular-nums">
            {summary.cells === 0
              ? "Nothing painted inside the selection."
              : `${summary.cells} trixel${summary.cells === 1 ? "" : "s"} across ` +
                `${summary.painted} layer${summary.painted === 1 ? "" : "s"}` +
                (includeEmptyLayers && summary.empty > 0
                  ? `, plus ${summary.empty} empty`
                  : "")}
          </p>
        </div>

        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={!canSave} className="gap-1.5">
            <Save className="w-4 h-4" />
            Save
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
