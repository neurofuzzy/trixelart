"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EXAMPLES, exampleUrl, type Example } from "@/lib/examples";

/**
 * Picker for the bundled example projects.
 *
 * The thumbnails are the project files themselves. A `.trixel.svg` draws its own
 * artwork, so `<img src>` on the very file that is about to be loaded *is* the
 * preview — no generated thumbnails to keep in sync, and what the user clicks is
 * exactly what they see.
 *
 * Presentational: the parent fetches and applies, because it already owns the
 * project state and the error dialog.
 */
export function ExampleGallery({
  onPick,
  loadingFile,
  compact = false,
}: {
  onPick: (example: Example) => void;
  /** File currently being fetched, if any. */
  loadingFile?: string | null;
  /** Tighter layout for the splash, where this sits under the welcome copy. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid w-full gap-3",
        compact ? "gap-2" : "grid-cols-2 sm:grid-cols-3",
      )}
      // The compact row is one line whatever the count, so the column template
      // is derived rather than a fixed Tailwind class — otherwise adding an
      // example silently wraps it and leaves an orphan on a second row.
      style={
        compact
          ? { gridTemplateColumns: `repeat(${EXAMPLES.length}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {EXAMPLES.map((ex) => {
        const busy = loadingFile === ex.file;
        return (
          <button
            key={ex.file}
            onClick={() => onPick(ex)}
            disabled={!!loadingFile}
            title={ex.name}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-lg border border-white/10",
              "bg-black/30 transition-colors hover:border-amber-400/50 focus:border-amber-400/50",
              "focus:outline-none disabled:opacity-60",
            )}
          >
            <span className="relative block aspect-square w-full">
              {/* eslint-disable-next-line @next/next/no-img-element --
                  a local static SVG: next/image would add a loader and a
                  configured size for no benefit under the static export. */}
              <img
                src={exampleUrl(ex.file)}
                alt={ex.name}
                loading="lazy"
                className="h-full w-full object-contain"
              />
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-200" />
                </span>
              )}
            </span>
            {!compact && (
              <span className="truncate border-t border-white/10 px-2 py-1.5 text-xs text-muted-foreground group-hover:text-foreground">
                {ex.name}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
