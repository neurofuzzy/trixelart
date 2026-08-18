"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, normalizeProjectFilename } from "@/lib/utils";
import { downloadBlob } from "@/lib/png-export";
import {
  buildMulticolorMatsSVG,
  buildMulticolorSVG,
  multicolorMetrics,
  planMulticolor,
  renderMulticolorPreview,
  type MulticolorOptions,
  type MulticolorPreviewMode,
} from "@/lib/multicolor-export";

/**
 * Multicolor ("flat") cutting export dialog.
 *
 * A sibling of the cut export and the interlock export. The stack cut nests
 * one sheet per colour level and joins them; this one cuts each colour as a
 * flat silhouette sheet whose cut lines land exactly where two colours meet —
 * the same region polygons the standard SVG export draws. Every sheet carries
 * every polygon, so cutting the whole design out of each colour of card leaves
 * all polygons in all colours, ready for colour-cycled assembly with zero
 * paper wasted. See `multicolor-export.ts`.
 */

type Unit = "mm" | "in";

/** Inches per millimetre. The dialog stores everything in mm; the unit toggle
 *  only changes how the fields are read and written. */
const IN_PER_MM = 1 / 25.4;

/** Rounds a length for display in the selected unit, dropping float noise. */
function fmtLen(mm: number, unit: Unit): string {
  const v = unit === "mm" ? mm : mm * IN_PER_MM;
  return String(Math.round(v * 100) / 100);
}

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

/** A length field. The value it carries is always in mm; when `unit` is "in"
 *  it is converted for display and the typed value is converted back on commit.
 *  Clamped on commit, not per keystroke, so a half-typed "1" on the way to
 *  "150" is not snapped away underneath. */
function NumberMm({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  /** The field's value, in mm. */
  value: number;
  /** Clamp bounds, in mm. */
  min: number;
  max: number;
  unit: Unit;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const factor = unit === "mm" ? 1 : IN_PER_MM;
  const commit = (raw: string) => {
    const n = Number(raw);
    setDraft(null);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n / factor)));
  };
  const shown = (n: number) => Math.round(n * 100) / 100;
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground flex-1 min-w-0">
        {label}
      </span>
      <input
        type="number"
        min={shown(min * factor)}
        max={shown(max * factor)}
        step={unit === "mm" ? 1 : 0.1}
        value={draft ?? String(shown(value * factor))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        className="w-20 shrink-0 h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground tabular-nums outline-none focus:border-ring focus:ring-1 focus:ring-ring"
      />
      <span className="text-xs text-muted-foreground/60 w-6 shrink-0">{unit}</span>
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

export function MulticolorDialog({
  open,
  onOpenChange,
  painted,
  roundFraction = 0,
  projectName,
  gridRotation = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Merged fill stack — the same map the cut, interlock and 3D exports take. */
  painted: Record<string, string>;
  /** Corner-rounding effect, as the 0-1 slider fraction. See `round-corners.ts`. */
  roundFraction?: number;
  projectName: string;
  /** The lattice's quarter turn, so a pointy-top design cuts the way it is drawn. */
  gridRotation?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [paperWidthMm, setPaperWidthMm] = useState(210);
  const [paperHeightMm, setPaperHeightMm] = useState(297);
  const [marginMm, setMarginMm] = useState(15);
  const [spacingMm, setSpacingMm] = useState(6);
  const [unit, setUnit] = useState<Unit>("mm");
  const [mat, setMat] = useState(false);
  const [mode, setMode] = useState<MulticolorPreviewMode>("sheets");
  const [busy, setBusy] = useState(false);

  const options = useMemo<MulticolorOptions>(
    () => ({
      paperWidthMm,
      paperHeightMm,
      marginMm,
      pageSpacingMm: spacingMm,
      mat,
    }),
    [paperWidthMm, paperHeightMm, marginMm, spacingMm, mat],
  );

  const plan = useMemo(
    () => (open ? planMulticolor(painted, options, roundFraction, gridRotation) : null),
    [open, painted, options, roundFraction, gridRotation],
  );
  const metrics = useMemo(
    () => (plan ? multicolorMetrics(plan, options) : null),
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
      renderMulticolorPreview(
        c,
        plan,
        mode,
        options,
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
  }, [open, plan, mode, options, gridRotation]);

  const handleExport = (file: "sheets" | "mats") => {
    if (!plan) return;
    setBusy(true);
    try {
      const svg =
        file === "sheets"
          ? buildMulticolorSVG(plan, options, gridRotation)
          : buildMulticolorMatsSVG(plan, options, gridRotation);
      if (!svg) return;
      const base = normalizeProjectFilename(projectName) || "trixel";
      downloadBlob(
        new Blob([svg], { type: "image/svg+xml" }),
        file === "sheets"
          ? `${base}-multicolor.svg`
          : `${base}-multicolor-mats.svg`,
      );
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const modes: [MulticolorPreviewMode, string][] = [
    ["sheets", "Color sheets"],
    ...(mat ? [["mats", "Mats"] as [MulticolorPreviewMode, string]] : []),
  ];
  const usableW = paperWidthMm - 2 * marginMm;
  const usableH = paperHeightMm - 2 * marginMm;
  const fits = usableW > 0 && usableH > 0;

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
          <h3 className="font-semibold text-sm">Export multicolor cut</h3>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md overflow-hidden border border-white/10">
              {(["mm", "in"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={cn(
                    "px-2.5 py-1 text-xs transition-colors",
                    unit === u
                      ? "bg-amber-400/20 text-amber-200"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onOpenChange(false)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
            <div className="flex rounded-md overflow-hidden border border-white/10 shrink-0">
              {modes.map(([id, label]) => (
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
              {!plan &&
                (Object.keys(painted).length === 0 ? (
                  <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                    Nothing painted yet.
                  </div>
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                    Can&apos;t fit — margin eats the whole sheet.
                  </div>
                ))}
            </div>
            {metrics && (
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed shrink-0">
                Design comes out at {fmtLen(metrics.designWmm, unit)} ×{" "}
                {fmtLen(metrics.designHmm, unit)} {unit} on a{" "}
                {fmtLen(metrics.usableWmm, unit)} × {fmtLen(metrics.usableHmm, unit)}{" "}
                {unit} usable area.
              </p>
            )}
          </div>

          <div className="sm:w-72 shrink-0 min-h-0 overflow-y-auto pr-1 divide-y divide-white/10">
            <Section title="Paper">
              <NumberMm
                key={`width-${unit}`}
                label="Width"
                value={paperWidthMm}
                min={50}
                max={1200}
                unit={unit}
                onChange={setPaperWidthMm}
              />
              <NumberMm
                key={`height-${unit}`}
                label="Height"
                value={paperHeightMm}
                min={50}
                max={1200}
                unit={unit}
                onChange={setPaperHeightMm}
              />
              <NumberMm
                key={`margin-${unit}`}
                label="Margin"
                value={marginMm}
                min={0}
                max={50}
                unit={unit}
                onChange={setMarginMm}
              />
              <NumberMm
                key={`spacing-${unit}`}
                label="Spacing"
                value={spacingMm}
                min={0}
                max={50}
                unit={unit}
                onChange={setSpacingMm}
              />
              {!fits && (
                <p className="text-[11px] text-red-400 leading-relaxed">
                  The margins meet — shrink the margin or enlarge the sheet.
                </p>
              )}
            </Section>

            <Section title="Mats">
              <Check checked={mat} onChange={setMat}>
                Mats (separate file)
              </Check>
            </Section>

            {plan && (
              <Section title="Sheets">
                <ul className="space-y-1">
                  {plan.sheets.map((sheet, i) => (
                    <li
                      key={`${sheet.hex}-${i}`}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <span
                        className="size-3 rounded-sm shrink-0 border border-white/20"
                        style={{ background: sheet.hex }}
                      />
                      <span className="flex-1 tabular-nums">{plan.polygons.length} polygons</span>
                      <span className="text-muted-foreground/60">sheet</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">
            {plan ? `${plan.colorCount} sheet${plan.colorCount === 1 ? "" : "s"} · ${plan.polygons.length} polygon${plan.polygons.length === 1 ? "" : "s"} each` : null}
          </span>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
          {mat && (
            <button
              onClick={() => handleExport("mats")}
              disabled={!plan || busy}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-amber-400/15 hover:bg-amber-400/25 disabled:opacity-40 text-sm text-amber-100"
            >
              <Palette className="w-4 h-4" />
              {busy ? "Building…" : "Export mats"}
            </button>
          )}
          <button
            onClick={() => handleExport("sheets")}
            disabled={!plan || busy}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-amber-400/15 hover:bg-amber-400/25 disabled:opacity-40 text-sm text-amber-100"
          >
            <Layers className="w-4 h-4" />
            {busy ? "Building…" : "Export color sheets"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}