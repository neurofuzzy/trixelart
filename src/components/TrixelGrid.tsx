"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCanvasSize } from "@/hooks/use-canvas-size";
import { useHistory } from "@/hooks/use-history";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useInteraction } from "@/hooks/use-interaction";
import { Toolbar } from "@/components/Toolbar";
import { GridCanvas } from "@/components/GridCanvas";
import { SymmetryPanel } from "@/components/SymmetryPanel";
import { ColorPalette } from "@/components/ColorPalette";
import { Footer } from "@/components/Footer";
import { GRAYSCALE_PALETTE } from "@/lib/constants";

export default function TrixelGrid() {
  const { size, containerRef, updateSize } = useCanvasSize();
  const { mounted, painted, setPainted, pushHistory, handleUndo, handleRedo, clearCanvas, history, historyIdx } = useHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<"paint" | "erase" | "pan">("paint");
  const [color, setColor] = useState(GRAYSCALE_PALETTE[4]);
  const [gridDivisions, setGridDivisions] = useState(0);

  const SETTINGS_KEY = "symmetria-settings";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (typeof data.gridDivisions === "number") {
          setGridDivisions(data.gridDivisions);
        }
      }
    } catch { /* ignore parse errors */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gridDivisions }));
  }, [gridDivisions]);

  const [isFunctionOpen, setIsFunctionOpen] = useState(false);
  const [formula, setFormula] = useState(
    "a % 5 === 0 || b % 5 === 0 || c % 5 === 0",
  );
  const [extent, setExtent] = useState(10);

  useEffect(() => {
    const timer = setTimeout(() => updateSize(), 500);
    return () => clearTimeout(timer);
  }, [updateSize]);

  useKeyboardShortcuts(handleUndo, handleRedo, setTool, (c) => {
    setColor(c);
    setTool("paint");
  });

  const {
    hoveredTri,
    setHoveredTri,
    screenToWorld,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  } = useInteraction({
    size,
    view,
    setView,
    tool,
    setTool,
    color,
    setColor,
    painted,
    setPainted,
    pushHistory,
    containerRef,
  });

  const handleExport = useCallback(() => {
    const dataStr = JSON.stringify(painted, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `symmetria-grid-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [painted]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const importedData = JSON.parse(content);
          if (typeof importedData === "object" && importedData !== null) {
            setPainted(importedData);
            pushHistory(importedData);
          }
        } catch (err) {
          console.error("Failed to import", err);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [setPainted, pushHistory],
  );

  const runSymmetryFunction = useCallback(() => {
    const newPainted = { ...painted };
    try {
      const check = new Function(
        "a",
        "b",
        "c",
        `try { return !!(${formula}); } catch(e) { return false; }`,
      );

      for (let a = -extent; a <= extent; a++) {
        for (let b = -extent; b <= extent; b++) {
          const cUp = -a - b;
          if (Math.abs(cUp) <= extent) {
            if (check(a, b, cUp)) {
              newPainted[`${b},${a},up`] = color;
            }
          }

          const cDown = -1 - a - b;
          if (Math.abs(cDown) <= extent) {
            if (check(a, b, cDown)) {
              newPainted[`${b},${a},down`] = color;
            }
          }
        }
      }
      setPainted(newPainted);
      pushHistory(newPainted);
      setIsFunctionOpen(false);
    } catch (e) {
      alert(
        "Invalid mathematical expression. Use JavaScript syntax, e.g. a % 5 === 0",
      );
    }
  }, [painted, formula, extent, color, setPainted, pushHistory]);

  const onColorChange = useCallback((c: string) => {
    setColor(c);
    setTool("paint");
  }, []);

  if (!mounted) return <div className="h-full w-full bg-background" />;

  return (
    <div className="flex flex-col h-full w-full bg-background select-none">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        className="hidden"
      />

      <Toolbar
        tool={tool}
        isFunctionOpen={isFunctionOpen}
        onToolChange={setTool}
        onFunctionToggle={() => setIsFunctionOpen((v) => !v)}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        historyIdx={historyIdx}
        historyLength={history.length}
        onExport={handleExport}
        onImportClick={handleImportClick}
        onClear={clearCanvas}
      />

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-crosshair touch-none outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoveredTri(null)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        tabIndex={0}
      >
        <GridCanvas
          size={size}
          view={view}
          mounted={mounted}
          painted={painted}
          hoveredTri={hoveredTri}
          screenToWorld={screenToWorld}
          gridDivisions={gridDivisions}
        />

        <SymmetryPanel
          isOpen={isFunctionOpen}
          formula={formula}
          onFormulaChange={setFormula}
          extent={extent}
          onExtentChange={setExtent}
          onApply={runSymmetryFunction}
          onClose={() => setIsFunctionOpen(false)}
        />

        <ColorPalette
          color={color}
          onColorChange={onColorChange}
        />
      </div>

      <Footer
        hoveredTri={hoveredTri}
        gridDivisions={gridDivisions}
        onGridDivisionsChange={setGridDivisions}
      />
    </div>
  );
}
