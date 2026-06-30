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
    const timeout = setTimeout(() => {
      setJsonValue(JSON.stringify(grid));
    }, 100);
    return () => clearTimeout(timeout);
  }, [grid]);

  const handleExport = () => {
    const data = JSON.stringify(grid, null, 2);
    setJsonValue(data);
    navigator.clipboard.writeText(data);
    toast({
      title: "Data Exported",
      description: "Sparse coordinate map copied to clipboard.",
    });
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      if (typeof parsed === 'object' && parsed !== null) {
        importGrid(parsed);
        toast({
          title: "Session Restored",
          description: "Canvas state loaded from data.",
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: "Invalid grid manifest provided.",
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col p-6 md:p-10 overflow-hidden dark">
      <Toaster />
      
      <header className="w-full max-w-screen-2xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4 px-2">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-white mb-1">
            TriStudio<span className="text-primary">.</span>
          </h1>
          <p className="text-white/20 text-[10px] font-bold tracking-[0.4em] uppercase">Infinite Isotropic Environment</p>
        </div>
        <div className="hidden lg:flex items-center gap-3 bg-white/5 px-4 py-2 rounded-xl border border-white/10 text-[9px] text-white/40 font-mono tracking-tighter">
          <span>ALPHA VERSION 1.2.0</span>
          <span className="opacity-20">•</span>
          <span>SPARSE STORAGE ACTIVE</span>
        </div>
      </header>

      <main className="w-full max-w-screen-2xl mx-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 min-h-0">
        <section className="lg:col-span-8 xl:col-span-9 h-[550px] lg:h-auto">
          <SymmetriaGrid 
            grid={grid} 
            onCellClick={updateCell} 
            activeColor={activeColor}
          />
        </section>

        <section className="lg:col-span-4 xl:col-span-3 flex flex-col gap-8 h-full overflow-y-auto pr-2 custom-scrollbar">
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
          />
          
          <IOSection 
            jsonValue={jsonValue} 
            setJsonValue={setJsonValue} 
          />
        </section>
      </main>

      <footer className="mt-8 text-center text-[9px] text-white/10 uppercase tracking-[0.5em] w-full pb-6">
        Precise Vertex Tiling • Zero-Latency Render
      </footer>
    </div>
  );
}
