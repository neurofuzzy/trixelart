"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Box, Download, Copy, Check, AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import {
  buildTrixelModel,
  to3MF,
  buildPrinterNotes,
  clampMeshOption,
  DEFAULT_MESH_OPTIONS,
  MESH_LIMITS,
  GRAIN_ANGLE_CHOICES,
  type BaseMode,
  type MeshExportOptions,
} from "@/lib/mesh-export";
import { normalizeProjectFilename } from "@/lib/utils";

// three.js is heavy and browser-only — load the preview as its own client chunk
// only when the dialog opens.
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

const BASE_MODES: { value: BaseMode; label: string; hint: string }[] = [
  { value: "plate", label: "Base plate", hint: "Solid backing in the darkest color" },
  { value: "sandwich", label: "Sandwich", hint: "Design on both faces, base in the middle" },
  { value: "none", label: "Tiles only", hint: "Shallow tiles, no backing" },
];

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">
        {label} <span className="opacity-60">({unit})</span>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step="0.1"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const clamped = clampMeshOption(
            label.toLowerCase().includes("width")
              ? "widthMm"
              : label.toLowerCase().includes("base")
                ? "baseThicknessMm"
                : "topThicknessMm",
            Number(draft),
          );
          onCommit(clamped);
          setDraft(String(clamped));
        }}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

export function Export3DDialog({
  open,
  onOpenChange,
  painted,
  projectName,
  gridRotation = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  painted: Record<string, string>;
  projectName: string;
  /** The lattice's quarter turn, so a pointy-top design prints the way it is drawn. */
  gridRotation?: number;
}) {
  const [options, setOptions] = useState<MeshExportOptions>(DEFAULT_MESH_OPTIONS);
  const [copied, setCopied] = useState(false);

  const model = useMemo(
    () => (open ? buildTrixelModel(painted, options, gridRotation) : null),
    [open, painted, options, gridRotation],
  );

  const set = (patch: Partial<MeshExportOptions>) =>
    setOptions((o) => ({ ...o, ...patch }));

  const setGrain = (colorKey: string, angle: number) =>
    setOptions((o) => ({
      ...o,
      grainByColor: { ...o.grainByColor, [colorKey]: angle },
    }));

  const resetGrain = () => set({ grainByColor: {} });

  const handleDownload = () => {
    if (!model) return;
    const bytes = to3MF(model);
    // Copy into a fresh ArrayBuffer-backed view so the Blob types cleanly.
    const buf = new Uint8Array(bytes);
    const blob = new Blob([buf], { type: "model/3mf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${normalizeProjectFilename(projectName) || "trixel"}.3mf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onOpenChange(false);
  };

  const handleCopyNotes = async () => {
    if (!model) return;
    try {
      await navigator.clipboard.writeText(buildPrinterNotes(model, projectName));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Box className="w-5 h-5" /> Export for 3D printing
          </AlertDialogTitle>
          <AlertDialogDescription>
            One body per color, exported as 3MF. Each color is auto-assigned a
            grain angle (0°/60°/120°) for a directional top-layer shimmer.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!model ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nothing painted yet — draw something first.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-8">
              {/* Left: live preview + at-a-glance summary. */}
              <div className="flex min-h-[340px] flex-col gap-3">
                <div className="flex-1">
                  <Model3DPreview model={model} />
                </div>
                <div className="flex justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {model.widthMm.toFixed(0)} × {model.heightMm.toFixed(0)} ×{" "}
                    {model.depthMm.toFixed(1)} mm
                  </span>
                  <span>
                    {model.bodies.length} bodies · {model.triangleCount} tris
                  </span>
                </div>
              </div>

              {/* Right: dimensions, backing, and per-color grain angles. */}
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-2">
                  <NumberField
                    label="Width"
                    unit="mm"
                    value={options.widthMm}
                    min={MESH_LIMITS.widthMm.min}
                    max={MESH_LIMITS.widthMm.max}
                    onCommit={(n) => set({ widthMm: n })}
                  />
                  <NumberField
                    label="Tile height"
                    unit="mm"
                    value={options.topThicknessMm}
                    min={MESH_LIMITS.topThicknessMm.min}
                    max={MESH_LIMITS.topThicknessMm.max}
                    onCommit={(n) => set({ topThicknessMm: n })}
                  />
                  <NumberField
                    label="Base"
                    unit="mm"
                    value={options.baseThicknessMm}
                    min={MESH_LIMITS.baseThicknessMm.min}
                    max={MESH_LIMITS.baseThicknessMm.max}
                    onCommit={(n) => set({ baseThicknessMm: n })}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Backing</span>
                  <div className="grid grid-cols-3 gap-2">
                    {BASE_MODES.map((m) => (
                      <button
                        key={m.value}
                        onClick={() => set({ baseMode: m.value })}
                        title={m.hint}
                        className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          options.baseMode === m.value
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-input text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Grain angle per color
                    </span>
                    <button
                      onClick={resetGrain}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Auto-cycle
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {model.bodies.map((b) => (
                      <div
                        key={b.name}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
                          style={{ background: b.colorHex }}
                        />
                        <span className="flex-1 truncate text-muted-foreground">
                          {b.name}
                        </span>
                        {b.grainAngle === null ? (
                          <span className="flex h-7 items-center text-muted-foreground/70">
                            base · any angle
                          </span>
                        ) : (
                          <select
                            value={b.grainAngle}
                            onChange={(e) =>
                              setGrain(b.colorKey, Number(e.target.value))
                            }
                            className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                          >
                            {GRAIN_ANGLE_CHOICES.map((a) => (
                              <option key={a} value={a}>
                                {a}°
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {model.componentCount > 1 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                <AlertTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {model.componentCount} pieces only touch at corners and may
                  print detached. A base plate won&apos;t bridge corner-only
                  contacts — connect them with shared edges for a single part.
                </span>
              </div>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            onClick={handleCopyNotes}
            disabled={!model}
            className="gap-1.5"
          >
            {copied ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            {copied ? "Copied" : "Copy notes"}
          </Button>
          <Button onClick={handleDownload} disabled={!model} className="gap-1.5">
            <Download className="w-4 h-4" />
            Download .3mf
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
