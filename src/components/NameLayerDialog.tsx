"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";

/**
 * Names a layer that is about to be created.
 *
 * Shown by the two actions that make a layer **out of something that already
 * exists** — duplicate, and lifting a selection onto its own layer — where the
 * user has a reason in mind and "Layer 4" throws it away. Adding an empty layer
 * deliberately does *not* ask: there is nothing yet to name it after, and a
 * modal on the panel's commonest action is a toll.
 *
 * Mount it only while open (`{open && <NameLayerDialog …/>}`) rather than
 * passing an `open` prop. The suggestion depends on which layer was clicked, so
 * every showing needs a fresh initial value, and mount/unmount gives that with
 * no effect to synchronise state that React already owns.
 */
export function NameLayerDialog({
  title,
  description,
  suggestion,
  confirmLabel = "Create",
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  /** Pre-filled and pre-selected, so Enter alone accepts it. */
  suggestion: string;
  confirmLabel?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(suggestion);
  const trimmed = name.trim();

  const commit = () => {
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <input
          value={name}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Escape is read by the global shortcuts *before* their
            // focused-INPUT guard, so without this, dismissing the dialog would
            // also clear the hex selection the layer is about to be made from.
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onCancel();
          }}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
        />

        <AlertDialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={!trimmed}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
