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
import { SelectionPalette } from "@/components/SelectionPalette";
import { Footer, type HexMode, type Symmetry } from "@/components/Footer";
import { GRAYSCALE_PALETTE } from "@/lib/constants";
import type { SelectionSnapshot } from "@/lib/hex-flower";

export default function TrixelGrid() {
  const { size, containerRef, updateSize } = useCanvasSize();
  const { mounted, painted, setPainted, pushHistory, handleUndo, handleRedo, clearCanvas, history, historyIdx } = useHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<"paint" | "erase" | "pan" | "select" | "stamp">("paint");
  const [activePalette, setActivePalette] = useState(GRAYSCALE_PALETTE);
  const [color, setColor] = useState(activePalette[4]);
  const [gridDivisions, setGridDivisions] = useState(0);
  const [hexMode, setHexMode] = useState<HexMode>("off");
  const [flowerRadius, setFlowerRadius] = useState(0);
  const [symmetry, setSymmetry] = useState<Symmetry>("off");
  const [selectedHex, setSelectedHex] = useState<{ c: number; k: number } | null>(null);
  const [selections, setSelections] = useState<SelectionSnapshot[]>([]);
  const [activeSelection, setActiveSelection] = useState<SelectionSnapshot | null>(null);
  const hexEnabled = gridDivisions > 0 && hexMode !== "off";
  const effectiveFlowerRadius = hexEnabled ? flowerRadius : 0;
  const effectiveSymmetry: Symmetry = hexEnabled ? symmetry : "off";

  const SETTINGS_KEY = "symmetria-settings";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (typeof data.gridDivisions === "number") {
          setGridDivisions(data.gridDivisions);
        }
        if (typeof data.hexMode === "boolean") {
          setHexMode(data.hexMode ? "outlines" : "off");
        } else if (typeof data.hexMode === "string") {
          setHexMode(data.hexMode as HexMode);
        }
        if (typeof data.flowerRadius === "number") {
          setFlowerRadius(data.flowerRadius);
        }
        if (typeof data.symmetry60 === "boolean") {
          setSymmetry(data.symmetry60 ? "sym60" : "off");
        } else if (typeof data.symmetry === "string") {
          setSymmetry(data.symmetry as Symmetry);
        }
      }
    } catch { /* ignore parse errors */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gridDivisions, hexMode, flowerRadius, symmetry }));
  }, [gridDivisions, hexMode, flowerRadius, symmetry]);

  // Selection snapshots persist with the project (separate key so existing
  // `symmetria-save` imports/exports stay backward-compatible).
  const SELECTIONS_KEY = "symmetria-selections";
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SELECTIONS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data)) {
          setSelections(data);
          // Restore the most recently captured snapshot as the active stamp so
          // the stamp tool has something to fire with immediately after load.
          const ok = data[0] && Array.isArray(data[0].trixels) && typeof data[0].N === "number";
          if (ok) setActiveSelection(data[0]);
        }
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SELECTIONS_KEY, JSON.stringify(selections));
    } catch { /* ignore */ }
  }, [selections]);

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
  }, activePalette);

  const {
    hoveredTri,
    hoverTargets,
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
    flowerRadius: effectiveFlowerRadius,
    gridDivisions,
    symmetry: effectiveSymmetry,
    selectedHex,
    setSelectedHex,
    activeSelection,
    setActiveSelection,
    setSelections,
  });

  const handleExport = useCallback(() => {
    const project = {
      version: 1,
      painted,
      settings: { gridDivisions, hexMode, flowerRadius, symmetry },
      selections,
    };
    const dataStr = JSON.stringify(project, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `symmetria-grid-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [painted, gridDivisions, hexMode, flowerRadius, symmetry, selections]);

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
          const data = JSON.parse(content);
          if (typeof data !== "object" || data === null) return;

          // New format: { version, painted, settings, selections }
          if (data.version === 1 || data.painted) {
            const grid = data.painted || {};
            setPainted(grid);
            pushHistory(grid);

            if (data.settings) {
              const s = data.settings;
              if (typeof s.gridDivisions === "number") setGridDivisions(s.gridDivisions);
              if (typeof s.hexMode === "boolean") {
                setHexMode(s.hexMode ? "outlines" : "off");
              } else if (typeof s.hexMode === "string") {
                setHexMode(s.hexMode as HexMode);
              }
              if (typeof s.flowerRadius === "number") setFlowerRadius(s.flowerRadius);
              if (typeof s.symmetry60 === "boolean") {
                setSymmetry(s.symmetry60 ? "sym60" : "off");
              } else if (typeof s.symmetry === "string") {
                setSymmetry(s.symmetry as Symmetry);
              }
            }

            if (Array.isArray(data.selections)) {
              setSelections(data.selections);
              const ok = data.selections[0] && Array.isArray(data.selections[0].trixels) && typeof data.selections[0].N === "number";
              if (ok) setActiveSelection(data.selections[0]);
            }
          } else {
            // Legacy format: plain painted grid object
            setPainted(data);
            pushHistory(data);
          }
        } catch (err) {
          console.error("Failed to import", err);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [setPainted, pushHistory, setGridDivisions, setHexMode, setFlowerRadius, setSymmetry, setSelections, setActiveSelection],
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

  const onCenterView = useCallback(() => setView({ x: 0, y: 0, zoom: 1 }), []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      // Wait one frame for the new layout, then re-measure.
      requestAnimationFrame(() => requestAnimationFrame(updateSize));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [updateSize]);

  const onToggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  if (!mounted) return <div className="h-full w-full bg-background" />;

  return (
    <div ref={rootRef} className="flex flex-col h-full w-full bg-background select-none">
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
        onCenterView={onCenterView}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        hasSelection={selections.length > 0}
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
          hoverTargets={hoverTargets}
          screenToWorld={screenToWorld}
          gridDivisions={gridDivisions}
          hexMode={hexMode}
          selectedHex={selectedHex}
          tool={tool}
          activeSelection={activeSelection}
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

        {tool === "select" || tool === "stamp" ? (
          <SelectionPalette
            selections={selections}
            activeSelectionId={activeSelection?.id ?? null}
            onSelect={(s) => setActiveSelection(s)}
            onPointerEnter={() => setHoveredTri(null)}
          />
        ) : (
          <ColorPalette
            color={color}
            palette={activePalette}
            onColorChange={onColorChange}
            onPaletteChange={(colors) => {
              setActivePalette(colors);
              setColor(colors[colors.length - 1]);
              setTool("paint");
            }}
            onPointerEnter={() => setHoveredTri(null)}
          />
        )}
      </div>

      <Footer
        hoveredTri={hoveredTri}
        gridDivisions={gridDivisions}
        onGridDivisionsChange={setGridDivisions}
        hexMode={hexMode}
        onHexModeChange={setHexMode}
        flowerRadius={flowerRadius}
        onFlowerRadiusChange={setFlowerRadius}
        symmetry={symmetry}
        onSymmetryChange={setSymmetry}
      />
    </div>
  );
}
