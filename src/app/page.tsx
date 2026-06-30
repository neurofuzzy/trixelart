
"use client";

import React, { useState, useEffect } from "react";
import { SymmetriaGrid } from "@/components/SymmetriaGrid";
import { Toolbar } from "@/components/Toolbar";
import { IOSection } from "@/components/IOSection";
import { useGridState } from "@/hooks/use-grid-state";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

export default function TriStudioPage() {
  const { grid, updateCell, undo, redo, clear, importGrid, canUndo, canRedo } = useGridState();
  const [activeColor, setActiveColor] = useState("#CBD5E1");
  const [jsonValue, setJsonValue] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    setJsonValue(JSON.stringify(grid));
  }, [grid]);

  const handleExport = () => {
    const data = JSON.stringify(grid, null, 2);
    setJsonValue(data);
    navigator.clipboard.writeText(data);
    toast({
      title: "Exported!",
      description: "Grid state copied to clipboard.",
    });
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      if (typeof parsed === 'object' && parsed !== null) {
        importGrid(parsed);
        toast({
          title: "Import Success",
          description: "Infinite grid restored.",
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: "Invalid JSON grid data.",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-4 md:p-8 overflow-hidden dark">
      <Toaster />
      
      <header className="w-full max-w-7xl flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 px-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter text-primary">
            InfiniteTri
          </h1>
          <p className="text-muted-foreground text-sm font-medium">Pan, zoom, and draw across an endless canvas.</p>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground bg-card border rounded-full px-4 py-2 font-mono">
          <span>DRAG/MIDDLE-CLICK: PAN</span>
          <span className="opacity-30">|</span>
          <span>CTRL+WHEEL: ZOOM</span>
        </div>
      </header>

      <main className="w-full max-w-7xl flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        <section className="lg:col-span-9 h-[calc(100vh-280px)] lg:h-[calc(100vh-200px)]">
          <SymmetriaGrid 
            grid={grid} 
            onCellClick={(id, current) => updateCell(id, current === activeColor ? null : activeColor)} 
            activeColor={activeColor}
          />
        </section>

        <section className="lg:col-span-3 flex flex-col gap-6 overflow-y-auto pr-2">
          <Toolbar
            activeColor={activeColor}
            setActiveColor={setActiveColor}
            onUndo={undo}
            onRedo={redo}
            onClear={clear}
            canUndo={canUndo}
            canRedo={canRedo}
            onExport={handleExport}
            onImport={handleImport}
            onGenerate={() => {}}
            isGenerating={false}
          />
          
          <IOSection 
            jsonValue={jsonValue} 
            setJsonValue={setJsonValue} 
          />
        </section>
      </main>

      <footer className="mt-8 text-center text-[10px] text-muted-foreground uppercase tracking-[0.2em] w-full max-w-7xl pb-4">
        TriStudio © 2024 • Endless Isotropic Surface
      </footer>
    </div>
  );
}
