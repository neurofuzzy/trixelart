"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCanvasSize } from "@/hooks/use-canvas-size";
import { useHistory, type ProjectSnapshot } from "@/hooks/use-history";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useInteraction } from "@/hooks/use-interaction";
import { Toolbar } from "@/components/Toolbar";
import { GridCanvas } from "@/components/GridCanvas";
import { ColorPalette } from "@/components/ColorPalette";
import { SelectionPalette } from "@/components/SelectionPalette";
import { StampPalette } from "@/components/StampPalette";
import { Footer, type HexMode, type Symmetry } from "@/components/Footer";
import { GRAYSCALE_PALETTE, PALETTES, encodeColor, decodeColor, remapGrid } from "@/lib/constants";
import { stringToTri, triToString, type TriKey } from "@/lib/grid-math";
import type { SelectionSnapshot } from "@/lib/hex-flower";
import { rotateHexCW, remapHex, enumerateHexTrixels } from "@/lib/hex-flower";

const STORAGE_KEY = "symmetria-save";

export default function TrixelGrid() {
  const { size, containerRef, updateSize } = useCanvasSize();
  const { mounted, painted, setPainted, pushHistory, handleUndo, handleRedo, history, historyIdx, registerRestore } = useHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<"paint" | "erase" | "pan" | "select" | "stamp">("paint");
  const [activePalette, setActivePalette] = useState(GRAYSCALE_PALETTE);
  const [activePaletteIdx, setActivePaletteIdx] = useState(0);
  const [colorIdx, setColorIdx] = useState(4);

  const colorHex = activePalette[colorIdx] ?? activePalette[4];
  const paintKey = encodeColor(activePaletteIdx, colorIdx);
  const [gridDivisions, setGridDivisions] = useState(1);
  const [hexMode, setHexMode] = useState<HexMode>("off");
  const [flowerRadius, setFlowerRadius] = useState(0);
  const [symmetry, setSymmetry] = useState<Symmetry>("off");
  const [selectedHex, setSelectedHex] = useState<{ c: number; k: number } | null>(null);
  const [selections, setSelections] = useState<SelectionSnapshot[]>([]);
  const [activeSelection, setActiveSelection] = useState<SelectionSnapshot | null>(null);
  const hexEnabled = gridDivisions > 0 && hexMode !== "off";
  const effectiveFlowerRadius = hexEnabled ? flowerRadius : 0;
  const effectiveSymmetry: Symmetry = hexEnabled ? symmetry : "off";

  const paintedRef = useRef(painted);
  paintedRef.current = painted;
  const gridDivisionsRef = useRef(gridDivisions);
  gridDivisionsRef.current = gridDivisions;
  const hexModeRef = useRef(hexMode);
  hexModeRef.current = hexMode;
  const flowerRadiusRef = useRef(flowerRadius);
  flowerRadiusRef.current = flowerRadius;
  const symmetryRef = useRef(symmetry);
  symmetryRef.current = symmetry;
  const selectionsRef = useRef(selections);
  selectionsRef.current = selections;

  const lastPaintTriBridgeRef = useRef<React.MutableRefObject<TriKey | null> | null>(null);

  const buildSnapshot = useCallback((): ProjectSnapshot => ({
    painted: paintedRef.current,
    gridDivisions: gridDivisionsRef.current,
    hexMode: hexModeRef.current,
    flowerRadius: flowerRadiusRef.current,
    symmetry: symmetryRef.current,
    selections: selectionsRef.current,
    lastPaintTri: lastPaintTriBridgeRef.current?.current
      ? triToString(lastPaintTriBridgeRef.current.current)
      : null,
  }), []);

  const onCommit = useCallback(() => {
    pushHistory(buildSnapshot());
  }, [pushHistory, buildSnapshot]);

  useEffect(() => {
    registerRestore((snap: ProjectSnapshot) => {
      if (typeof snap.gridDivisions === "number") setGridDivisions(snap.gridDivisions);
      if (typeof snap.hexMode === "string") setHexMode(snap.hexMode as HexMode);
      if (typeof snap.flowerRadius === "number") setFlowerRadius(snap.flowerRadius);
      if (typeof snap.symmetry === "string") setSymmetry(snap.symmetry as Symmetry);
      if (Array.isArray(snap.selections)) {
        setSelections(snap.selections as SelectionSnapshot[]);
        const head = snap.selections[0] as SelectionSnapshot | undefined;
        if (head?.trixels && head.N) setActiveSelection(head);
      }
      if (lastPaintTriBridgeRef.current) {
        lastPaintTriBridgeRef.current.current =
          typeof snap.lastPaintTri === "string"
            ? stringToTri(snap.lastPaintTri)
            : null;
      }
    });
  }, [registerRestore]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSnapshot()));
    } catch { /* ignore */ }
  }, [buildSnapshot, painted, gridDivisions, hexMode, flowerRadius, symmetry, selections]);

  const SETTINGS_KEY = "symmetria-settings";
  const SELECTIONS_KEY = "symmetria-selections";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (typeof data.gridDivisions === "number") setGridDivisions(data.gridDivisions);
        if (typeof data.hexMode === "boolean") {
          setHexMode(data.hexMode ? "outlines" : "off");
        } else if (typeof data.hexMode === "string") {
          setHexMode(data.hexMode as HexMode);
        }
        if (typeof data.flowerRadius === "number") setFlowerRadius(data.flowerRadius);
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SELECTIONS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data)) {
          setSelections(data);
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

  useEffect(() => {
    const timer = setTimeout(() => updateSize(), 500);
    return () => clearTimeout(timer);
  }, [updateSize]);

  const {
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
    lastPaintTriRef,
  } = useInteraction({
    size,
    view,
    setView,
    tool,
    setTool,
    color: paintKey,
    setColor: (encoded) => {
      const d = decodeColor(encoded);
      if (d && PALETTES[d.paletteIdx]) {
        setActivePaletteIdx(d.paletteIdx);
        setActivePalette(PALETTES[d.paletteIdx].colors);
        setColorIdx(d.colorIdx);
        setTool("paint");
      }
    },
    painted,
    setPainted,
    onCommit,
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

  lastPaintTriBridgeRef.current = lastPaintTriRef;

  const onUndo = useCallback(() => {
    handleUndo();
  }, [handleUndo]);

  const onRedo = useCallback(() => {
    handleRedo();
  }, [handleRedo]);

  const clearSelection = useCallback(() => setSelectedHex(null), []);

  const onDeleteSelection = useCallback(() => {
    if (!selectedHex || gridDivisions <= 0) return;
    const hexTris = enumerateHexTrixels(selectedHex.c, selectedHex.k, gridDivisions);
    const prev = paintedRef.current;
    const next = { ...prev };
    let changed = false;
    for (const t of hexTris) {
      const key = triToString(t);
      if (key in next) {
        delete next[key];
        changed = true;
      }
    }
    if (!changed) return;
    setPainted(next);
    pushHistory({
      painted: next,
      gridDivisions: gridDivisionsRef.current,
      hexMode: hexModeRef.current,
      flowerRadius: flowerRadiusRef.current,
      symmetry: symmetryRef.current,
      selections: selectionsRef.current,
      lastPaintTri: lastPaintTriBridgeRef.current?.current
        ? triToString(lastPaintTriBridgeRef.current.current)
        : null,
    });
  }, [selectedHex, gridDivisions, setPainted, pushHistory]);

  useKeyboardShortcuts(onUndo, onRedo, setTool, (c) => {
    setColorIdx(c);
    setTool("paint");
  }, activePalette.length, clearSelection, onDeleteSelection);

  const handleExport = useCallback(() => {
    const project = buildSnapshot();
    const dataStr = JSON.stringify({ ...project, version: 1 }, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `symmetria-grid-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [buildSnapshot]);

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

          if (data.version === 1 || data.painted) {
            const snap: ProjectSnapshot = {
              painted: data.painted || {},
              gridDivisions: data.gridDivisions ?? 1,
              hexMode: typeof data.hexMode === "boolean"
                ? (data.hexMode ? "outlines" : "off")
                : (data.hexMode ?? "off"),
              flowerRadius: data.flowerRadius ?? 0,
              symmetry: data.symmetry ?? "off",
              selections: Array.isArray(data.selections) ? data.selections : [],
              lastPaintTri: typeof data.lastPaintTri === "string" ? data.lastPaintTri : null,
            };
            setPainted(snap.painted);
            pushHistory(snap);

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
            const snap: ProjectSnapshot = {
              painted: data,
              gridDivisions: 1,
              hexMode: "off",
              flowerRadius: 0,
              symmetry: "off",
              selections: [],
              lastPaintTri: null,
            };
            setPainted(data);
            pushHistory(snap);
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

  const onColorChange = useCallback((c: string) => {
    const idx = activePalette.indexOf(c);
    if (idx >= 0) setColorIdx(idx);
    setTool("paint");
  }, [activePalette]);

  const handleClear = useCallback(() => {
    const snap: ProjectSnapshot = {
      painted: {},
      gridDivisions: gridDivisionsRef.current,
      hexMode: hexModeRef.current,
      flowerRadius: flowerRadiusRef.current,
      symmetry: symmetryRef.current,
      selections: selectionsRef.current,
      lastPaintTri: lastPaintTriBridgeRef.current?.current
        ? triToString(lastPaintTriBridgeRef.current.current)
        : null,
    };
    setPainted({});
    pushHistory(snap);
  }, [pushHistory]);

  const onShiftUp = useCallback(() => {
    setPainted((prev) => {
      let next: Record<string, string>;
      if (selectedHex && gridDivisions > 0) {
        next = remapHex(prev, selectedHex.c, selectedHex.k, gridDivisions, activePaletteIdx, 1, activePalette.length);
      } else {
        next = remapGrid(prev, activePaletteIdx, 1);
      }
      if (next !== prev) {
        pushHistory({
          painted: next,
          gridDivisions: gridDivisionsRef.current,
          hexMode: hexModeRef.current,
          flowerRadius: flowerRadiusRef.current,
          symmetry: symmetryRef.current,
          selections: selectionsRef.current,
          lastPaintTri: lastPaintTriBridgeRef.current?.current
            ? triToString(lastPaintTriBridgeRef.current.current)
            : null,
        });
      }
      return next;
    });
  }, [activePaletteIdx, activePalette.length, selectedHex, gridDivisions, setPainted, pushHistory]);

  const onShiftDown = useCallback(() => {
    setPainted((prev) => {
      let next: Record<string, string>;
      if (selectedHex && gridDivisions > 0) {
        next = remapHex(prev, selectedHex.c, selectedHex.k, gridDivisions, activePaletteIdx, -1, activePalette.length);
      } else {
        next = remapGrid(prev, activePaletteIdx, -1);
      }
      if (next !== prev) {
        pushHistory({
          painted: next,
          gridDivisions: gridDivisionsRef.current,
          hexMode: hexModeRef.current,
          flowerRadius: flowerRadiusRef.current,
          symmetry: symmetryRef.current,
          selections: selectionsRef.current,
          lastPaintTri: lastPaintTriBridgeRef.current?.current
            ? triToString(lastPaintTriBridgeRef.current.current)
            : null,
        });
      }
      return next;
    });
  }, [activePaletteIdx, activePalette.length, selectedHex, gridDivisions, setPainted, pushHistory]);

  const onRotateSelection = useCallback(() => {
    if (!selectedHex || gridDivisions <= 0) return;
    setPainted((prev) => {
      const next = rotateHexCW(prev, selectedHex.c, selectedHex.k, gridDivisions);
      if (next !== prev) {
        pushHistory({
          painted: next,
          gridDivisions: gridDivisionsRef.current,
          hexMode: hexModeRef.current,
          flowerRadius: flowerRadiusRef.current,
          symmetry: symmetryRef.current,
          selections: selectionsRef.current,
          lastPaintTri: lastPaintTriBridgeRef.current?.current
            ? triToString(lastPaintTriBridgeRef.current.current)
            : null,
        });
      }
      return next;
    });
  }, [selectedHex, gridDivisions, setPainted, pushHistory]);

  const onDeletePaletteItem = useCallback(
    (snap: SelectionSnapshot) => {
      setSelections((prev) => {
        const next = prev.filter((s) => s.id !== snap.id);
        if (snap.id === activeSelection?.id && next.length > 0) {
          setActiveSelection(next[0]);
        } else if (snap.id === activeSelection?.id) {
          setActiveSelection(null);
        }
        pushHistory({
          painted: paintedRef.current,
          gridDivisions: gridDivisionsRef.current,
          hexMode: hexModeRef.current,
          flowerRadius: flowerRadiusRef.current,
          symmetry: symmetryRef.current,
          selections: next,
          lastPaintTri: lastPaintTriBridgeRef.current?.current
            ? triToString(lastPaintTriBridgeRef.current.current)
            : null,
        });
        return next;
      });
    },
    [activeSelection, pushHistory],
  );

  const onCenterView = useCallback(() => setView({ x: 0, y: 0, zoom: 1 }), []);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
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
        onToolChange={setTool}
        onExport={handleExport}
        onImportClick={handleImportClick}
        onClear={handleClear}
        onCenterView={onCenterView}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        hasSelection={selections.length > 0}
      />

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-crosshair touch-none outline-none"
        style={{ background: "repeating-linear-gradient(30deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 6px, rgba(0,0,0,0.06) 6px, rgba(0,0,0,0.06) 12px)" }}
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

        {tool === "select" ? (
          <SelectionPalette
            onShiftUp={onShiftUp}
            onShiftDown={onShiftDown}
            onRotate={onRotateSelection}
            hasSelection={selectedHex !== null}
            onPointerEnter={() => setHoveredTri(null)}
          />
        ) : tool === "stamp" ? (
          <StampPalette
            selections={selections}
            activeSelectionId={activeSelection?.id ?? null}
            onSelect={(s) => setActiveSelection(s)}
            onPointerEnter={() => setHoveredTri(null)}
            onDelete={onDeletePaletteItem}
          />
        ) : (
          <ColorPalette
            color={colorHex}
            palette={activePalette}
            onColorChange={onColorChange}
            onPaletteChange={(colors, idx) => {
              setActivePalette(colors);
              setActivePaletteIdx(idx);
              setColorIdx(colors.length - 1);
              setTool("paint");
            }}
            onShiftUp={onShiftUp}
            onShiftDown={onShiftDown}
            onPointerEnter={() => setHoveredTri(null)}
          />
        )}
      </div>

      <Footer
        gridDivisions={gridDivisions}
        onGridDivisionsChange={setGridDivisions}
        hexMode={hexMode}
        onHexModeChange={setHexMode}
        flowerRadius={flowerRadius}
        onFlowerRadiusChange={setFlowerRadius}
        symmetry={symmetry}
        onSymmetryChange={setSymmetry}
        handleUndo={onUndo}
        handleRedo={onRedo}
        historyIdx={historyIdx}
        historyLength={history.length}
      />
    </div>
  );
}
