"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Scissors, CheckCircle2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { planCut } from "@/lib/cut-export";
import {
  buildCutStackModel,
  CUT_STACK_LIMITS,
  DEFAULT_CUT_STACK_OPTIONS,
  type CutFrame,
} from "@/lib/cut-mesh";
import { buildCutSVG } from "@/lib/cut-svg";
import { normalizeProjectFilename } from "@/lib/utils";

const FRAMES: { value: CutFrame; label: string; hint: string }[] = [
  {
    value: "mat",
    label: "Mat",
    hint: "Black top sheet: a rectangle with the design's outline cut out as a window",
  },
  {
    value: "none",
    label: "None",
    hint: "No mat — just the color sheets",
  },
];

// three.js is heavy and browser-only — load the preview as its own client chunk
// only when the dialog opens (shared with the 3D-print dialog).
const Model3DPreview = dynamic(
  () => import("@/components/Model3DPreview").then((m) => m.Model3DPreview),
  {
    ssr: false,
    loading: () => (
      <div className="h-[240px] w-full rounded-md border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
        Loading preview…
      </div>
    ),
  },
);

export function CutExportDialog({
  open,
  onOpenChange,
  painted,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  painted: Record<string, string>;
  projectName: string;
}) {
  const [widthMm, setWidthMm] = useState(DEFAULT_CUT_STACK_OPTIONS.widthMm);
  const [widthDraft, setWidthDraft] = useState(String(widthMm));
  const [explode, setExplode] = useState(DEFAULT_CUT_STACK_OPTIONS.explode);
  const [frame, setFrame] = useState<CutFrame>(DEFAULT_CUT_STACK_OPTIONS.frame);
  const [mergeIslands, setMergeIslands] = useState(true);
  const [joinSize, setJoinSize] = useState(0.6);

  const plan = useMemo(
    () => (open ? planCut(painted) : null),
    [open, painted],
  );

  // Hexagon-neck radius in world units (SIDE = 50); 0 = sharp weld.
  const neck = mergeIslands ? joinSize * 18 : 0;

  const stack = useMemo(
    () =>
      open && plan
        ? buildCutStackModel(plan, painted, {
            widthMm,
            sheetThicknessMm: DEFAULT_CUT_STACK_OPTIONS.sheetThicknessMm,
            explode,
            frame,
            mergeIslands,
            neck,
          })
        : null,
    [open, plan, painted, widthMm, explode, frame, mergeIslands, neck],
  );

  const commitWidth = () => {
    const { min, max } = CUT_STACK_LIMITS.widthMm;
    const n = Number(widthDraft);
    const clamped = Number.isFinite(n)
      ? Math.min(max, Math.max(min, n))
      : DEFAULT_CUT_STACK_OPTIONS.widthMm;
    setWidthMm(clamped);
    setWidthDraft(String(clamped));
  };

  const handleDownloadSVG = () => {
    if (!plan) return;
    const svg = buildCutSVG(plan, painted, {
      widthMm,
      frame,
      mergeIslands,
      neck,
    });
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${normalizeProjectFilename(projectName) || "trixel"}-cut.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Scissors className="w-5 h-5" /> Export for cutting
          </AlertDialogTitle>
          <AlertDialogDescription>
            Layered papercraft: every layer is a full framed sheet — its color
            plus the surrounding frame — so nothing floats. A black mat on top
            cuts the outline as a window; unpainted interior areas cut through
            the stack as negative space.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!plan || !stack ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nothing painted yet — draw something first.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-8">
              {/* Left: exploded preview + dimensions. */}
              <div className="flex min-h-[340px] flex-col gap-3">
                <div className="flex-1">
                  <Model3DPreview model={stack.model} />
                </div>
                <div className="flex justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {stack.model.widthMm.toFixed(0)} ×{" "}
                    {stack.model.heightMm.toFixed(0)} mm
                  </span>
                  <span>
                    {plan.colorCount} sheet{plan.colorCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              {/* Right: controls + per-sheet stack. */}
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">
                      Width <span className="opacity-60">(mm)</span>
                    </span>
                    <input
                      type="number"
                      min={CUT_STACK_LIMITS.widthMm.min}
                      max={CUT_STACK_LIMITS.widthMm.max}
                      step="1"
                      value={widthDraft}
                      onChange={(e) => setWidthDraft(e.target.value)}
                      onBlur={commitWidth}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">
                      Explode <span className="opacity-60">(preview)</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={explode}
                      onChange={(e) => setExplode(Number(e.target.value))}
                      className="h-8 accent-primary"
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Frame (photo mat)
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {FRAMES.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setFrame(f.value)}
                        title={f.hint}
                        className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          frame === f.value
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-input text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Merge touching islands
                    </span>
                    <button
                      role="switch"
                      aria-checked={mergeIslands}
                      onClick={() => setMergeIslands((v) => !v)}
                      className={`h-5 w-9 shrink-0 rounded-full border transition-colors ${
                        mergeIslands
                          ? "border-primary bg-primary/70"
                          : "border-input bg-muted"
                      }`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                          mergeIslands ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                  {mergeIslands && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="w-16 shrink-0">Join size</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={joinSize}
                        onChange={(e) => setJoinSize(Number(e.target.value))}
                        className="h-6 flex-1 accent-primary"
                      />
                    </label>
                  )}
                  <p className="text-[11px] text-muted-foreground/60">
                    Bridges corner-touching pieces with a tiny hexagon at each
                    join so the sheet cuts as one.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Stack (top → bottom)
                  </span>
                  <div className="flex flex-col gap-1">
                    {[...stack.sheets].reverse().map((s) => (
                      <div
                        key={s.level}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-sm border border-white/20"
                          style={{ background: s.colorHex }}
                        />
                        <span className="w-14 shrink-0 text-muted-foreground">
                          {s.isFrame ? "Mat" : `Level ${s.level}`}
                        </span>
                        <span className="flex-1 text-muted-foreground/80">
                          {s.isFrame ? "outline window" : `${s.triCount} tris`}
                        </span>
                        <span className="text-[11px] text-muted-foreground/50">
                          {s.isFrame ? "black" : "cardstock"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-200">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {plan.colorCount} color sheet
                {plan.colorCount === 1 ? "" : "s"}
                {frame === "mat"
                  ? ", each framed all the way around, under a black outline mat"
                  : " (no frame)"}
                . Every layer carries the frame, so nothing floats; unpainted
                interior areas cut through as negative space.
              </span>
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleDownloadSVG}
            disabled={!plan}
            className="gap-1.5"
          >
            <Download className="w-4 h-4" />
            Download SVG
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
