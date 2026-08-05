"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Tool } from "@/lib/tools/types";

/**
 * The four right-hand drawers. Exactly one may be open at a time — see the
 * panel slot in `TrixelGrid`.
 *
 * `pattern` and `export` are *owned by a tool* (the pattern brush and crop):
 * selecting the tool opens them and leaving it closes them again. `layers` and
 * `grid` are toggled from the footer and are independent of the tool.
 */
export type PanelId = "layers" | "grid" | "pattern" | "export";

/** The drawer a tool owns, or `null` for the tools that own none. The single
 *  place that mapping is written down — `TrixelGrid` reads it both when a tool
 *  is selected and when one is re-selected. */
export function panelForTool(t: Tool): PanelId | null {
  if (t === "pattern") return "pattern";
  if (t === "crop") return "export";
  return null;
}

/**
 * The drawer shell: full-height, flush to the right edge, overlaying the canvas.
 *
 * **It overlays rather than docks.** A drawer comes and goes as tools and
 * toggles change, and docking it into the layout would reflow and re-centre the
 * artwork every time — the piece would appear to jump while the user is drawing.
 *
 * The pointer handlers stop events reaching the canvas underneath: without them
 * a drag that starts on a slider paints a stroke through the artwork behind it.
 *
 * Children supply their own scroll container, because the drawers do not agree
 * on what should absorb leftover height — `PatternPanel` and `ExportPanel` give
 * it to a preview, `LayerPanel` and `GridSettingsPanel` to nothing at all. Only
 * the frame is shared.
 */
export function PanelShell({
  title,
  trailing,
  tour,
  onClose,
  onPointerEnter,
  children,
}: {
  title: string;
  /** Header content left of the close button — a status readout or an action. */
  trailing?: ReactNode;
  /** `data-tour` anchor, for the onboarding spotlight. */
  tour?: string;
  onClose: () => void;
  onPointerEnter: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      className="absolute z-40 top-0 right-0 bottom-0 w-96 flex flex-col bg-card/95 backdrop-blur-lg border-l border-white/10 shadow-2xl cursor-default"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onPointerEnter={onPointerEnter}
      data-tour={tour}
    >
      <header className="flex items-center gap-2 px-4 h-11 border-b border-white/10 shrink-0">
        <span className="text-xs uppercase tracking-widest text-white/70">
          {title}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {trailing}
          <button
            onClick={onClose}
            title={`Close ${title.toLowerCase()}`}
            className="inline-flex items-center justify-center h-6 w-6 rounded text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      {children}
    </aside>
  );
}
