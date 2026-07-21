"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Keyboard, Sparkles, X } from "lucide-react";
import { modKey, shortcutGroups } from "./shortcuts";

/** A single key rendered as a keycap chip. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

/**
 * Keyboard-shortcuts reference dialog, opened from the Help button or the `?`
 * shortcut. Content is grouped and sourced from `shortcuts.ts` (a mirror of the
 * real bindings). Also offers a button to replay the spotlight interface tour.
 */
export function HelpDialog({
  open,
  onClose,
  onStartTour,
}: {
  open: boolean;
  onClose: () => void;
  onStartTour: () => void;
}) {
  const groups = shortcutGroups(modKey());

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(92vw,40rem)] -translate-x-1/2 -translate-y-1/2
            flex-col rounded-xl border bg-card text-card-foreground shadow-2xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
              <Keyboard size={18} /> Keyboard Shortcuts
            </Dialog.Title>
            <div className="flex items-center gap-1">
              <button
                onClick={onStartTour}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-cyan-400 hover:bg-accent"
              >
                <Sparkles size={14} /> Replay interface tour
              </button>
              <Dialog.Close asChild>
                <button
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>
          </div>
          <Dialog.Description className="sr-only">
            A reference of all keyboard shortcuts, grouped by category.
          </Dialog.Description>

          <div className="grid grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto p-5 sm:grid-cols-2">
            {groups.map((group) => (
              <div key={group.title}>
                <h3 className="mb-2 select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {group.shortcuts.map((s) => (
                    <li
                      key={s.label}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-foreground/90">{s.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {s.keys.map((k, i) => (
                          <Key key={`${k}-${i}`}>{k}</Key>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
