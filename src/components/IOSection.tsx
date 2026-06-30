
"use client";

import React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface IOSectionProps {
  jsonValue: string;
  setJsonValue: (val: string) => void;
}

export function IOSection({ jsonValue, setJsonValue }: IOSectionProps) {
  return (
    <div className="p-6 bg-card rounded-3xl border shadow-xl">
      <div className="flex flex-col gap-4">
        <Label htmlFor="grid-json" className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          Spatial Data
        </Label>
        <Textarea
          id="grid-json"
          placeholder="Sparse coordinate JSON..."
          className="font-mono text-[10px] min-h-[140px] bg-muted/20 border-none focus:ring-1 focus:ring-primary rounded-xl resize-none"
          value={jsonValue}
          onChange={(e) => setJsonValue(e.target.value)}
        />
        <p className="text-[9px] text-muted-foreground italic leading-relaxed">
          The canvas is stored as a spatial map. You can paste coordinates from other sessions here.
        </p>
      </div>
    </div>
  );
}
