"use client";

import React, { useState, useEffect } from "react";
import { SymmetriaGrid } from "@/components/SymmetriaGrid";
import { Toolbar } from "@/components/Toolbar";
import { IOSection } from "@/components/IOSection";
import { useGridState } from "@/hooks/use-grid-state";
import { generatePatternFromPrompt } from "@/ai/flows/generate-pattern-from-prompt-flow";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

export default function SymmetriaGridPage() {
  const { grid, updateCell, undo, redo, clear, importGrid, setFullPattern, canUndo, canRedo } = useGridState();
  const [activeColor, setActiveColor] = useState("#334155");
  const [isDark, setIsDark] = useState(false);
  const [jsonValue, setJsonValue] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setJsonValue(JSON.stringify(grid));
  }, [grid]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

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
      if (Array.isArray(parsed) && parsed.length === 36) {
        importGrid(parsed);
        toast({
          title: "Import Success",
          description: "Grid state updated from JSON.",
        });
      } else {
        throw new Error("Invalid grid format");
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: "The JSON data is not valid for a 36-triangle grid.",
      });
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await generatePatternFromPrompt({
        prompt: "A complex geometric pattern with deep contrasts and balanced negative space.",
      });
      if (result.pattern) {
        setFullPattern(result.pattern, activeColor);
        toast({
          title: "Pattern Generated",
          description: "AI has applied a new symmetrical pattern.",
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description: "Could not reach the AI service.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-4 md:p-8 overflow-x-hidden">
      <Toaster />
      
      {/* Header */}
      <header className="w-full max-w-6xl flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-primary flex items-center gap-3">
            <span className="bg-primary text-white p-2 rounded-lg rotate-12 inline-block">S</span>
            SymmetriaGrid
          </h1>
          <p className="text-muted-foreground mt-2 font-medium">Precision 3-Fold Rotational Symmetry Studio</p>
        </div>
        <div className="hidden md:block bg-card px-4 py-2 rounded-full border shadow-sm text-xs font-semibold text-muted-foreground">
          36-Triangle Workspace • 120° Symmetry Vectors
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Drawing Area */}
        <section className="lg:col-span-8 flex justify-center items-center bg-card rounded-3xl border shadow-xl p-8 min-h-[600px] relative overflow-hidden">
          <div className="absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(#396FAD_1px,transparent_1px)] [background-size:20px_20px]" />
          <SymmetriaGrid 
            grid={grid} 
            onCellClick={(idx) => updateCell(idx, grid[idx] === activeColor ? null : activeColor)} 
            activeColor={activeColor}
          />
        </section>

        {/* Right Column: Controls */}
        <section className="lg:col-span-4 flex flex-col gap-8">
          <Toolbar
            activeColor={activeColor}
            setActiveColor={setActiveColor}
            onUndo={undo}
            onRedo={redo}
            onClear={clear}
            canUndo={canUndo}
            canRedo={canRedo}
            isDark={isDark}
            toggleDark={() => setIsDark(!isDark)}
            onExport={handleExport}
            onImport={handleImport}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
          />
          
          <IOSection 
            jsonValue={jsonValue} 
            setJsonValue={setJsonValue} 
          />
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-16 text-center text-sm text-muted-foreground w-full max-w-6xl">
        <div className="h-px bg-border mb-8 w-full" />
        <p>© 2024 SymmetriaGrid. Optimized for professional geometric composition.</p>
      </footer>
    </div>
  );
}
