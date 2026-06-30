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
    <div className="p-8 bg-card rounded-[2rem] border border-white/10 shadow-2xl flex-1">
      <div className="flex flex-col gap-5 h-full">
        <Label htmlFor="grid-json" className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
          Coordinate Manifest
        </Label>
        <Textarea
          id="grid-json"
          placeholder="Sparse data map..."
          className="font-mono text-[10px] flex-1 min-h-[160px] bg-[#0a0a0a] border-white/5 focus:ring-1 focus:ring-primary rounded-2xl resize-none custom-scrollbar p-4"
          value={jsonValue}
          onChange={(e) => setJsonValue(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground/40 italic leading-relaxed">
          The canvas uses a sparse spatial index. Paste JSON to migrate session data.
        </p>
      </div>
    </div>
  );
}