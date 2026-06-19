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
    <div className="mt-8 p-6 bg-card rounded-2xl border shadow-sm">
      <div className="flex flex-col gap-4">
        <Label htmlFor="grid-json" className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Grid JSON Data
        </Label>
        <Textarea
          id="grid-json"
          placeholder="Paste or copy grid JSON here..."
          className="font-mono text-xs min-h-[120px] bg-muted/50 focus:bg-background transition-colors"
          value={jsonValue}
          onChange={(e) => setJsonValue(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground italic">
          Tip: You can manually edit the array indices to precise values. The grid supports 36 positions (0-35).
        </p>
      </div>
    </div>
  );
}
