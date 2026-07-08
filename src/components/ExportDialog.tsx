"use client";

import { useState, useMemo } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { generateSVG } from "@/lib/svg-export";

function stripSvgDimensions(svg: string): string {
  return svg.replace(
    /<svg([^>]*)>/,
    (_, attrs) =>
      `<svg${attrs.replace(/\s*width="[^"]*"|\s*height="[^"]*"/g, "")} width="100%">`,
  );
}

export function ExportDialog({
  open,
  onOpenChange,
  painted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  painted: Record<string, string>;
}) {
  const [stroke, setStroke] = useState(false);
  const [merge, setMerge] = useState(false);

  const svg = useMemo(
    () => generateSVG(painted, { stroke, merge }),
    [painted, stroke, merge],
  );

  const previewSvg = useMemo(() => stripSvgDimensions(svg), [svg]);

  const handlePrint = () => {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<!DOCTYPE html>
<html><head><style>
  html,body{margin:0;padding:0;height:100%}
  @media print{@page{size:letter;margin:.5in}}
  body{display:flex;align-items:center;justify-content:center;height:100vh}
  svg{max-width:100%;max-height:100%;height:auto;width:auto}
</style></head><body>${svg}</body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 200);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trixel-${new Date().toISOString().split("T")[0]}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Export SVG</AlertDialogTitle>
        </AlertDialogHeader>

        <div className="flex flex-col gap-4">
          <div className="border rounded-lg bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,_transparent_0%_50%)_50%_/_16px_16px] overflow-hidden max-h-[250px] w-full flex items-center justify-center">
            <div
              className="p-4"
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={stroke}
                onChange={(e) => setStroke(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-muted-foreground">
                Add 0.5pt stroke for overdraw
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={merge}
                onChange={(e) => setMerge(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-muted-foreground">
                Merge same color triangles
              </span>
            </label>
          </div>
        </div>

        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={handlePrint} className="gap-1.5">
            <Printer className="w-4 h-4" />
            Print
          </Button>
          <Button onClick={handleDownload} className="gap-1.5">
            <Download className="w-4 h-4" />
            Download
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
