"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Puzzle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, normalizeProjectFilename } from "@/lib/utils";
import { downloadBlob } from "@/lib/png-export";
import {
  buildInterlockSVG,
  interlockMetrics,
  planInterlock,
  renderInterlockPreview,
  type InterlockOptions,
  type InterlockPreviewMode,
} from "@/lib/interlock-export";

/**
 * Interlocking ("weave") cut export dialog.
 *
 * A sibling of the cut export, not a mode of it. That one stacks a sheet per
 * colour and joins them; this one lays every cell out as its own interlocking
 * piece and joins nothing — see `interlock-export.ts` and
 * docs/interlock-export.md.
 *
 * The preview is 2D and defaults to **assembled**, which is simply the artwork:
 * every tab but the outermost slides under a neighbouring piece, so the built
 * mosaic shows nothing the canvas does not. **Puzzle** spreads the same pieces
 * onto the tiling, whole and in their right relative places, and is the view to
 * count from. **Cut sheets** is what the machine gets.
 */

/** The narrowest tab a domestic cutter holds without tearing the card, mm. */
const MIN_TAB_MM = 3;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5 py-4 first:pt-0 last:pb-0">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** A millimetre field. Clamped on commit, not per keystroke, so a half-typed
 *  "1" on the way to "150" is not snapped away underneath. */
function NumberMm({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw);
    setDraft(null);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
  };
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground flex-1 min-w-0">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        className="w-20 shrink-0 h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground tabular-nums outline-none focus:border-ring focus:ring-1 focus:ring-ring"
      />
      <span className="text-xs text-muted-foreground/60 w-5 shrink-0">mm</span>
    </label>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded accent-amber-400"
      />
      <span className="text-xs text-muted-foreground">{children}</span>
    </label>
  );
}

export function InterlockDialog({
  open,
  onOpenChange,
  painted,
  projectName,
  gridRotation = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Merged fill stack — the same map the cut and 3D exports take. */
  painted: Record<string, string>;
  projectName: string;
  gridRotation?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [widthMm, setWidthMm] = useState(160);
  // Undefined until the user opts out of matching the mat, so the default
  // really is "whatever the mat came out as" rather than a number that happens
  // to agree with it today.
  const [matchMat, setMatchMat] = useState(true);
  const [sheetWidthMm, setSheetWidthMm] = useState(200);
  const [sheetHeightMm, setSheetHeightMm] = useState(280);
  const [clearanceMm, setClearanceMm] = useState(0);
  const [backingMat, setBackingMat] = useState(true);
  const [topMat, setTopMat] = useState(true);
  const [assemblyMap, setAssemblyMap] = useState(true);
  const [mode, setMode] = useState<InterlockPreviewMode>("assembled");
  const [busy, setBusy] = useState(false);

  const options = useMemo<InterlockOptions>(
    () => ({
      widthMm,
      sheetWidthMm: matchMat ? undefined : sheetWidthMm,
      sheetHeightMm: matchMat ? undefined : sheetHeightMm,
      clearanceMm,
      backingMat,
      topMat,
      assemblyMap,
    }),
    [
      widthMm,
      matchMat,
      sheetWidthMm,
      sheetHeightMm,
      clearanceMm,
      backingMat,
      topMat,
      assemblyMap,
    ],
  );

  const plan = useMemo(
    () => (open ? planInterlock(painted, options) : null),
    [open, painted, options],
  );
  const metrics = useMemo(
    () => (plan ? interlockMetrics(plan, options) : null),
    [plan, options],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const draw = () => {
      const c = canvasRef.current;
      if (!c || !plan) return;
      const dpr = window.devicePixelRatio || 1;
      renderInterlockPreview(
        c,
        plan,
        mode,
        Math.max(1, Math.round(wrap.clientWidth * dpr)),
        Math.max(1, Math.round(wrap.clientHeight * dpr)),
        gridRotation,
      );
      c.style.width = `${wrap.clientWidth}px`;
      c.style.height = `${wrap.clientHeight}px`;
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [open, plan, mode, gridRotation]);

  const handleExport = useCallback(() => {
    if (!plan) return;
    setBusy(true);
    buildInterlockSVG(plan, options, gridRotation)
      .then((svg) => {
        if (!svg) return;
        const base = normalizeProjectFilename(projectName) || "trixel";
        downloadBlob(
          new Blob([svg], { type: "image/svg+xml" }),
          `${base}_interlock.svg`,
        );
        onOpenChange(false);
      })
      .finally(() => setBusy(false));
  }, [plan, options, gridRotation, projectName, onOpenChange]);

  if (!open) return null;

  const tabTooSmall = !!metrics && metrics.tabMm < MIN_TAB_MM;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 bg-black/20"
        onClick={() => onOpenChange(false)}
      />
      <div
        className="fixed z-50 p-4 bg-card/95 backdrop-blur-md border rounded-xl shadow-2xl flex flex-col gap-3 w-[46rem] max-w-[calc(100vw-2rem)] h-[40rem] max-h-[calc(100vh-2rem)]"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-sm">Export interlocking cut</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onOpenChange(false)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
            <div className="flex rounded-md overflow-hidden border border-white/10 shrink-0">
              {(
                [
                  ["assembled", "Assembled"],
                  ["puzzle", "Puzzle"],
                  ["sheets", "Cut sheets"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={cn(
                    "flex-1 py-1.5 text-xs transition-colors",
                    mode === id
                      ? "bg-amber-400/20 text-amber-200"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              ref={wrapRef}
              className="flex-1 min-w-0 min-h-0 relative rounded-lg border border-white/10 bg-black/30 overflow-hidden"
            >
              <canvas ref={canvasRef} className="absolute inset-0" />
              {!plan && (
                <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                  Nothing painted yet.
                </div>
              )}
            </div>
          </div>

          <div className="sm:w-72 shrink-0 min-h-0 overflow-y-auto pr-1 divide-y divide-white/10">
            <Section title="Size">
              <NumberMm
                label="Artwork width"
                value={widthMm}
                min={20}
                max={1000}
                onChange={setWidthMm}
              />
              {metrics && (
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                  {metrics.heightMm.toFixed(0)} mm tall &middot; piece body{" "}
                  {metrics.coreMm.toFixed(1)} mm &middot; tab{" "}
                  {metrics.tabMm.toFixed(1)} mm &middot;{" "}
                  {metrics.areaRatio.toFixed(2)}&times; card per cell
                </p>
              )}
              {tabTooSmall && (
                <p className="text-[11px] text-red-400 leading-relaxed">
                  Tabs under {MIN_TAB_MM} mm tear out of card. Widen the artwork
                  or paint fewer, larger cells.
                </p>
              )}
            </Section>

            <Section title="Colour sheets">
              <Check
                checked={matchMat}
                onChange={(v) => {
                  if (!v && metrics) {
                    setSheetWidthMm(Math.round(metrics.matWidthMm));
                    setSheetHeightMm(Math.round(metrics.matHeightMm));
                  }
                  setMatchMat(v);
                }}
              >
                Match mat size
                {metrics
                  ? ` (${metrics.matWidthMm.toFixed(0)} × ${metrics.matHeightMm.toFixed(0)} mm)`
                  : ""}
              </Check>
              {!matchMat && (
                <>
                  <NumberMm
                    label="Sheet width"
                    value={sheetWidthMm}
                    min={40}
                    max={1200}
                    onChange={setSheetWidthMm}
                  />
                  <NumberMm
                    label="Sheet height"
                    value={sheetHeightMm}
                    min={40}
                    max={1200}
                    onChange={setSheetHeightMm}
                  />
                </>
              )}
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Pieces of one colour are nested into the interlocking tiling, so
                neighbours share a cut line: one pass, no weeding, no waste. Set
                a smaller sheet than the mat to cut the colours from offcuts.
              </p>
            </Section>

            <Section title="Fit">
              <NumberMm
                label="Clearance"
                value={clearanceMm}
                min={0}
                max={1}
                step={0.05}
                onChange={setClearanceMm}
              />
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Leave at 0 for a laser or blade — the kerf is taken once from
                between two pieces and is the clearance. Raise it only for a
                zero-kerf drag knife; it splits every shared seam into two cuts.
              </p>
            </Section>

            <Section title="Mats">
              <Check checked={backingMat} onChange={setBackingMat}>
                Backing (solid, slots for border tabs)
              </Check>
              <Check checked={topMat} onChange={setTopMat}>
                Top mat (outline frame)
              </Check>
              <Check checked={assemblyMap} onChange={setAssemblyMap}>
                Assembly + puzzle maps
              </Check>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Every tab but the outermost slides under its neighbour, so the
                built piece shows the artwork and nothing else. The backing takes
                the border tabs in slots.
              </p>
            </Section>

            {plan && (
              <Section title="Pieces">
                <ul className="space-y-1">
                  {plan.colours.map((colour) => (
                    <li
                      key={colour.encoded}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <span
                        className="size-3 rounded-sm shrink-0 border border-white/20"
                        style={{ background: colour.hex }}
                      />
                      <span className="flex-1 tabular-nums">
                        {colour.cells.length} pieces
                      </span>
                      <span className="tabular-nums text-muted-foreground/60">
                        {colour.sheets.length} sheet
                        {colour.sheets.length === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
                {plan.spareCount > 0 && (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    {plan.spareCount} spare piece
                    {plan.spareCount === 1 ? "" : "s"} — a nested block fills the
                    lattice, and the two orientations rarely come out even.
                  </p>
                )}
              </Section>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">
            {plan
              ? `${plan.pieceCount} pieces · ${metrics?.sheetCount ?? 0} sheet${
                  metrics?.sheetCount === 1 ? "" : "s"
                }`
              : null}
          </span>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!plan || busy}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-amber-400/15 hover:bg-amber-400/25 disabled:opacity-40 text-sm text-amber-100"
          >
            <Puzzle className="w-4 h-4" />
            {busy ? "Building…" : "Export SVG"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
