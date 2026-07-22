"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCanvasSize } from "@/hooks/use-canvas-size";
import { useHistory, type ProjectSnapshot, type Layer } from "@/hooks/use-history";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useInteraction } from "@/hooks/use-interaction";
import { Toolbar } from "@/components/Toolbar";
import { GridCanvas } from "@/components/GridCanvas";
import { ColorPalette } from "@/components/ColorPalette";
import { SelectionPalette } from "@/components/SelectionPalette";
import { StampPalette } from "@/components/StampPalette";
import {
  Footer,
  type HexMode,
  type Symmetry,
  type GridOrientation,
  normalizeHexMode,
} from "@/components/Footer";
import {
  PALETTE_DEFS,
  COLOR_COUNT,
  computePaletteColors,
  encodeColor,
  decodeColor,
  remapGrid,
  shiftGridPalettes,
  setPaletteOffsets,
} from "@/lib/constants";
import { stringToTri, triToString, type TriKey } from "@/lib/grid-math";
import { normalizeProjectFilename, DEFAULT_PROJECT_NAME } from "@/lib/utils";
import type { SelectionSnapshot } from "@/lib/hex-flower";
import {
  rotateHexCW,
  rotateHexCCW,
  flipHexVertical,
  flipHexHorizontal,
  remapHex,
  shiftHexPalettes,
  enumerateHexTrixels,
} from "@/lib/hex-flower";
import type { Tool } from "@/lib/tools";
import { ExportDialog } from "@/components/ExportDialog";
import { LayerPanel } from "@/components/LayerPanel";
import { useOnboarding } from "@/hooks/use-onboarding";
import { SplashDialog } from "@/components/onboarding/SplashDialog";
import { HelpDialog } from "@/components/onboarding/HelpDialog";
import { InterfaceTour } from "@/components/onboarding/InterfaceTour";

const STORAGE_KEY = "trixel-save";

// Grid-setting defaults applied on first launch (no saved settings) and when
// starting a new project via handleClear.
const DEFAULT_HEX_MODE: HexMode = "honeycomb";
const DEFAULT_GRID_DIVISIONS = 3;

export default function TrixelGrid() {
  const { size, containerRef, updateSize } = useCanvasSize();
  const {
    mounted,
    layers,
    activeLayerIdx,
    painted,
    setPainted,
    paintedRef,
    pushHistory,
    handleUndo,
    handleRedo,
    history,
    historyIdx,
    registerRestore,
    addLayer,
    deleteLayer,
    duplicateLayer,
    toggleLayerVisibility,
    moveLayer,
    setActiveLayerIdx,
    resetToSingleLayer,
    layersRef,
    activeLayerIdxRef,
  } = useHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<Tool>("paint");
  const [hueOffset, setHueOffset] = useState(0);
  const [satOffset, setSatOffset] = useState(0);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const computedPalettes = useMemo(
    () => computePaletteColors(PALETTE_DEFS, hueOffset, satOffset),
    [hueOffset, satOffset],
  );

  useEffect(() => {
    setPaletteOffsets(hueOffset, satOffset);
  }, [hueOffset, satOffset]);

  const [activePaletteIdx, setActivePaletteIdx] = useState(0);
  const activePalette =
    computedPalettes[activePaletteIdx]?.colors ?? computedPalettes[0].colors;
  const [colorIdx, setColorIdx] = useState(8);

  const colorHex = activePalette[colorIdx] ?? activePalette[8];
  const paintKey = encodeColor(activePaletteIdx, colorIdx);
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [gridDivisions, setGridDivisions] = useState(DEFAULT_GRID_DIVISIONS);
  const [hexMode, setHexMode] = useState<HexMode>(DEFAULT_HEX_MODE);
  const [flowerRadius, setFlowerRadius] = useState(0);
  const [symmetry, setSymmetry] = useState<Symmetry>("off");
  const [brushSize, setBrushSize] = useState<"single" | "hex">("single");
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [gridOrientation, setGridOrientation] =
    useState<GridOrientation>("flat-top");
  // Display-only rotation: pointy-top hexes are flat-top rotated 90°. The
  // underlying tri-axial lattice, hex geometry, symmetry math, history and
  // persistence remain untouched — only the screen↔world seam applies it.
  const gridRotation = gridOrientation === "pointy-top" ? Math.PI / 2 : 0;
  const [selectedHexes, setSelectedHexes] = useState<
    { c: number; k: number }[]
  >([]);
  const [selections, setSelections] = useState<SelectionSnapshot[]>([]);
  const [activeSelection, setActiveSelection] =
    useState<SelectionSnapshot | null>(null);
  const [stampFlash, setStampFlash] = useState<{
    c: number;
    k: number;
    opacity: number;
    seq: number;
  } | null>(null);
  const [cloneSource, setCloneSource] = useState<{
    x: number;
    y: number;
    q: number;
    r: number;
    type: string;
  } | null>(null);
  const [cloneOffset, setCloneOffset] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [cloneFlash, setCloneFlash] = useState<{
    c: number;
    k: number;
    q: number;
    r: number;
    type: string;
    opacity: number;
    seq: number;
  } | null>(null);
  const [captureMode, setCaptureMode] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const hexEnabled = gridDivisions > 0 && hexMode !== "world";
  const effectiveFlowerRadius = hexEnabled ? flowerRadius : 0;

  const mergedPainted = useMemo(() => {
    const out: Record<string, string> = {};
    for (const layer of layers) {
      if (!layer.visible) continue;
      Object.assign(out, layer.painted);
    }
    return out;
  }, [layers]);

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

  const lastPaintTriBridgeRef =
    useRef<React.MutableRefObject<TriKey | null> | null>(null);

  const buildSnapshot = useCallback(
    (): ProjectSnapshot => ({
      layers: layersRef.current,
      activeLayerIdx: activeLayerIdxRef.current,
      gridDivisions: gridDivisionsRef.current,
      hexMode: hexModeRef.current,
      flowerRadius: flowerRadiusRef.current,
      symmetry: symmetryRef.current,
      selections: selectionsRef.current,
      lastPaintTri: lastPaintTriBridgeRef.current?.current
        ? triToString(lastPaintTriBridgeRef.current.current)
        : null,
    }),
    [],
  );

  const snapshotWithPainted = useCallback(
    (p: Record<string, string>): ProjectSnapshot => {
      const l = layersRef.current.map((ly, i) =>
        i === activeLayerIdxRef.current ? { ...ly, painted: p } : ly,
      );
      return {
        layers: l,
        activeLayerIdx: activeLayerIdxRef.current,
        gridDivisions: gridDivisionsRef.current,
        hexMode: hexModeRef.current,
        flowerRadius: flowerRadiusRef.current,
        symmetry: symmetryRef.current,
        selections: selectionsRef.current,
        lastPaintTri: lastPaintTriBridgeRef.current?.current
          ? triToString(lastPaintTriBridgeRef.current.current)
          : null,
      };
    },
    [],
  );

  const onCommit = useCallback(() => {
    // Tools call setPainted(...) then onCommit() synchronously in the same
    // event. At that point layersRef (and thus buildSnapshot) still holds the
    // pre-edit painted because React hasn't re-rendered yet — reading it here
    // would snapshot the state from BEFORE this edit and push an off-by-one
    // history entry (making a single undo appear to revert two actions).
    // Reading through a setPainted updater yields the fully-reduced latest
    // painted for this batch, so the snapshot matches the edit just made.
    setPainted((latest) => {
      pushHistory(snapshotWithPainted(latest));
      return latest;
    });
  }, [setPainted, pushHistory, snapshotWithPainted]);

  useEffect(() => {
    registerRestore((snap: ProjectSnapshot) => {
      // Undo/redo only reverts the *edit* data. View settings (hexMode,
      // gridDivisions, flowerRadius, symmetry) are persisted separately
      // (SETTINGS_KEY) and shouldn't be touched by undo — otherwise
      // changing a setting between edits would get rolled back alongside
      // the paint when the user hits undo.
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
    } catch {
      /* ignore */
    }
  }, [
    buildSnapshot,
    layers,
    painted,
    gridDivisions,
    hexMode,
    flowerRadius,
    symmetry,
    selections,
  ]);

  const SETTINGS_KEY = "trixel-settings";
  const SELECTIONS_KEY = "trixel-selections";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (typeof data.gridDivisions === "number")
          setGridDivisions(data.gridDivisions);
        if (data.hexMode !== undefined)
          setHexMode(normalizeHexMode(data.hexMode));
        if (typeof data.flowerRadius === "number")
          setFlowerRadius(data.flowerRadius);
        if (typeof data.symmetry60 === "boolean") {
          setSymmetry(data.symmetry60 ? "sym60" : "off");
        } else if (typeof data.symmetry === "string") {
          setSymmetry(data.symmetry as Symmetry);
        }
        if (typeof data.gridOrientation === "string") {
          setGridOrientation(data.gridOrientation as GridOrientation);
        }
        if (data.brushSize === "hex") setBrushSize("hex");
        if (typeof data.projectName === "string" && data.projectName.trim())
          setProjectName(data.projectName);
        if (typeof data.hueOffset === "number") setHueOffset(data.hueOffset);
        if (typeof data.saturationOffset === "number")
          setSatOffset(data.saturationOffset);
      }
    } catch {
      /* ignore parse errors */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        gridDivisions,
        hexMode,
        flowerRadius,
        symmetry,
        gridOrientation,
        brushSize,
        projectName,
        hueOffset,
        saturationOffset: satOffset,
      }),
    );
  }, [
    gridDivisions,
    hexMode,
    flowerRadius,
    symmetry,
    gridOrientation,
    brushSize,
    projectName,
    hueOffset,
    satOffset,
  ]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SELECTIONS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (Array.isArray(data)) {
          setSelections(data);
          const ok =
            data[0] &&
            Array.isArray(data[0].trixels) &&
            typeof data[0].N === "number";
          if (ok) setActiveSelection(data[0]);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SELECTIONS_KEY, JSON.stringify(selections));
    } catch {
      /* ignore */
    }
  }, [selections]);

  useEffect(() => {
    const timer = setTimeout(() => updateSize(), 500);
    return () => clearTimeout(timer);
  }, [updateSize]);

  const onStampCapture = useCallback((c: number, k: number) => {
    setStampFlash((prev) => ({ c, k, opacity: 1, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const onCloneOffset = useCallback((o: { x: number; y: number } | null) => {
    setCloneOffset(o);
  }, []);

  const onCloneCapture = useCallback((x: number, y: number, c: number, k: number, q: number, r: number, type: string) => {
    setCloneSource({ x, y, q, r, type });
    setCloneFlash((prev) => ({ c, k, q, r, type, opacity: 1, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

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
      if (d && PALETTE_DEFS[d.paletteIdx]) {
        setActivePaletteIdx(d.paletteIdx);
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
    symmetry,
    selectedHexes,
    hexEnabled,
    setSelectedHexes,
    activeSelection,
    setActiveSelection,
    selections,
    setSelections,
    onStampCapture,
    cloneSource,
    onCloneCapture,
    cloneOffset,
    onCloneOffset,
    captureMode,
    setCaptureMode,
    gridRotation,
    brushSize,
    layers,
    activeLayerIdx,
  });

  lastPaintTriBridgeRef.current = lastPaintTriRef;

  const onUndo = useCallback(() => {
    handleUndo();
  }, [handleUndo]);

  const onRedo = useCallback(() => {
    handleRedo();
  }, [handleRedo]);

  const clearSelection = useCallback(() => setSelectedHexes([]), []);

  useEffect(() => {
    if (!stampFlash) return;
    let raf = 0;
    const start = performance.now();
    const DURATION = 800;
    const tick = (now: number) => {
      const elapsed = now - start;
      const opacity = Math.max(0, 1 - elapsed / DURATION);
      if (opacity <= 0) {
        setStampFlash(null);
        return;
      }
      setStampFlash((prev) => (prev ? { ...prev, opacity } : null));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stampFlash?.seq]);

  useEffect(() => {
    if (!cloneFlash) return;
    let raf = 0;
    const start = performance.now();
    const DURATION = 800;
    const tick = (now: number) => {
      const elapsed = now - start;
      const opacity = Math.max(0, 1 - elapsed / DURATION);
      if (opacity <= 0) {
        setCloneFlash(null);
        return;
      }
      setCloneFlash((prev) => (prev ? { ...prev, opacity } : null));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cloneFlash?.seq]);

  useEffect(() => {
    if (tool === "stamp") setSelectedHexes([]);
  }, [tool]);

  useEffect(() => {
    if (tool === "clone") setSelectedHexes([]);
    else {
      setCloneSource(null);
      setCloneOffset(null);
    }
  }, [tool]);

  const onDeleteSelection = useCallback(() => {
    if (selectedHexes.length === 0 || gridDivisions <= 0) return;
    const prev = paintedRef.current;
    const next = { ...prev };
    let changed = false;
    for (const sel of selectedHexes) {
      const hexTris = enumerateHexTrixels(sel.c, sel.k, gridDivisions);
      for (const t of hexTris) {
        const key = triToString(t);
        if (key in next) {
          delete next[key];
          changed = true;
        }
      }
    }
    if (!changed) return;
    setPainted(next);
    pushHistory(snapshotWithPainted(next));
  }, [selectedHexes, gridDivisions, setPainted, pushHistory]);

  const handleExport = useCallback(() => {
    const project = buildSnapshot();
    const dataStr = JSON.stringify(
      { ...project, name: projectName, version: 1 },
      null,
      2,
    );
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${normalizeProjectFilename(projectName) || "trixel-grid"}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [buildSnapshot, projectName]);

  const handleExportSVG = useCallback(() => {
    setExportDialogOpen(true);
  }, []);

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

          if (typeof data.name === "string" && data.name.trim())
            setProjectName(data.name);

          if (data.version === 1 || data.painted) {
            let snapLayers: Layer[];
            let snapActive: number;
            if (Array.isArray(data.layers)) {
              snapLayers = data.layers as Layer[];
              snapActive =
                typeof data.activeLayerIdx === "number"
                  ? data.activeLayerIdx
                  : 0;
            } else {
              snapLayers = [
                {
                  id: "0",
                  name: "Layer 1",
                  painted: (data.painted || {}) as Record<string, string>,
                  visible: true,
                },
              ];
              snapActive = 0;
            }
            const snap: ProjectSnapshot = {
              layers: snapLayers,
              activeLayerIdx: snapActive,
              gridDivisions: data.gridDivisions ?? 1,
              hexMode: normalizeHexMode(data.hexMode),
              flowerRadius: data.flowerRadius ?? 0,
              symmetry: data.symmetry ?? "off",
              selections: Array.isArray(data.selections) ? data.selections : [],
              lastPaintTri:
                typeof data.lastPaintTri === "string"
                  ? data.lastPaintTri
                  : null,
            };
            setPainted(snapLayers[snapActive]?.painted ?? {});
            pushHistory(snap);

            if (data.settings) {
              const s = data.settings;
              if (typeof s.gridDivisions === "number")
                setGridDivisions(s.gridDivisions);
              if (s.hexMode !== undefined)
                setHexMode(normalizeHexMode(s.hexMode));
              if (typeof s.flowerRadius === "number")
                setFlowerRadius(s.flowerRadius);
              if (typeof s.symmetry60 === "boolean") {
                setSymmetry(s.symmetry60 ? "sym60" : "off");
              } else if (typeof s.symmetry === "string") {
                setSymmetry(s.symmetry as Symmetry);
              }
            }

            if (Array.isArray(data.selections)) {
              setSelections(data.selections);
              const ok =
                data.selections[0] &&
                Array.isArray(data.selections[0].trixels) &&
                typeof data.selections[0].N === "number";
              if (ok) setActiveSelection(data.selections[0]);
            }
          } else {
            const snap: ProjectSnapshot = {
              layers: [
                {
                  id: "0",
                  name: "Layer 1",
                  painted: (data as Record<string, string>) || {},
                  visible: true,
                },
              ],
              activeLayerIdx: 0,
              gridDivisions: 1,
              hexMode: "world",
              flowerRadius: 0,
              symmetry: "off",
              selections: [],
              lastPaintTri: null,
            };
            setPainted(snap.layers[0].painted);
            pushHistory(snap);
          }
        } catch (err) {
          console.error("Failed to import", err);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [
      setPainted,
      pushHistory,
      setGridDivisions,
      setHexMode,
      setFlowerRadius,
      setSymmetry,
      setSelections,
      setActiveSelection,
      setProjectName,
    ],
  );

  const onColorChange = useCallback(
    (c: string) => {
      const idx = activePalette.indexOf(c);
      if (idx >= 0) setColorIdx(idx);
      setTool("paint");
    },
    [activePalette],
  );

  const onPaletteShift = useCallback(
    (direction: number) => {
      const count = PALETTE_DEFS.length;
      setPainted((prev) => {
        let next = prev;
        if (selectedHexes.length > 0 && gridDivisions > 0) {
          for (const sel of selectedHexes) {
            next = shiftHexPalettes(
              next,
              sel.c,
              sel.k,
              gridDivisions,
              direction as 1 | -1,
              count,
            );
          }
        } else {
          next = shiftGridPalettes(next, direction as 1 | -1, count);
        }
        if (next !== prev) {
          pushHistory(snapshotWithPainted(next));
        }
        return next;
      });
    },
    [selectedHexes, gridDivisions, setPainted, pushHistory],
  );

  const handleClear = useCallback(() => {
    const cleared = resetToSingleLayer();
    // A new project resets grid settings to the launch defaults.
    setGridDivisions(DEFAULT_GRID_DIVISIONS);
    setHexMode(DEFAULT_HEX_MODE);
    setProjectName(DEFAULT_PROJECT_NAME);
    pushHistory({
      layers: cleared,
      activeLayerIdx: 0,
      gridDivisions: DEFAULT_GRID_DIVISIONS,
      hexMode: DEFAULT_HEX_MODE,
      flowerRadius: flowerRadiusRef.current,
      symmetry: symmetryRef.current,
      selections: selectionsRef.current,
      lastPaintTri: lastPaintTriBridgeRef.current?.current
        ? triToString(lastPaintTriBridgeRef.current.current)
        : null,
    });
  }, [resetToSingleLayer, pushHistory]);

  const onShiftUp = useCallback(() => {
    setPainted((prev) => {
      let next = prev;
      if (selectedHexes.length > 0 && gridDivisions > 0) {
        for (const sel of selectedHexes) {
          next = remapHex(next, sel.c, sel.k, gridDivisions, 1, COLOR_COUNT);
        }
      } else {
        next = remapGrid(prev, 1);
      }
      if (next !== prev) {
        pushHistory(snapshotWithPainted(next));
      }
      return next;
    });
  }, [selectedHexes, gridDivisions, setPainted, pushHistory]);

  const onShiftDown = useCallback(() => {
    setPainted((prev) => {
      let next = prev;
      if (selectedHexes.length > 0 && gridDivisions > 0) {
        for (const sel of selectedHexes) {
          next = remapHex(next, sel.c, sel.k, gridDivisions, -1, COLOR_COUNT);
        }
      } else {
        next = remapGrid(prev, -1);
      }
      if (next !== prev) {
        pushHistory(snapshotWithPainted(next));
      }
      return next;
    });
  }, [selectedHexes, gridDivisions, setPainted, pushHistory]);

  const onRotateSelection = useCallback(() => {
    if (selectedHexes.length === 0 || gridDivisions <= 0) return;
    setPainted((prev) => {
      let next = prev;
      for (const sel of selectedHexes) {
        next = rotateHexCW(next, sel.c, sel.k, gridDivisions);
      }
      if (next !== prev) {
        pushHistory(snapshotWithPainted(next));
      }
      return next;
    });
  }, [selectedHexes, gridDivisions, setPainted, pushHistory]);

  const onRotateSelectionCCW = useCallback(() => {
    if (selectedHexes.length === 0 || gridDivisions <= 0) return;
    setPainted((prev) => {
      let next = prev;
      for (const sel of selectedHexes) {
        next = rotateHexCCW(next, sel.c, sel.k, gridDivisions);
      }
      if (next !== prev) {
        pushHistory(snapshotWithPainted(next));
      }
      return next;
    });
  }, [selectedHexes, gridDivisions, setPainted, pushHistory]);

  const onFlipSelection = useCallback(() => {
    if (selectedHexes.length === 0 || gridDivisions <= 0) return;
    setPainted((prev) => {
      let next = prev;
      for (const sel of selectedHexes) {
        next = flipHexVertical(next, sel.c, sel.k, gridDivisions);
      }
      if (next !== prev) {
        pushHistory(snapshotWithPainted(next));
      }
      return next;
    });
  }, [selectedHexes, gridDivisions, setPainted, pushHistory]);

  const onFlipHorizontal = useCallback(() => {
    if (selectedHexes.length === 0 || gridDivisions <= 0) return;
    setPainted((prev) => {
      let next = prev;
      for (const sel of selectedHexes) {
        next = flipHexHorizontal(next, sel.c, sel.k, gridDivisions);
      }
      if (next !== prev) {
        pushHistory(snapshotWithPainted(next));
      }
      return next;
    });
  }, [selectedHexes, gridDivisions, setPainted, pushHistory]);

  const onboarding = useOnboarding();

  useKeyboardShortcuts(
    onUndo,
    onRedo,
    setTool,
    (c) => {
      setColorIdx(c);
      setTool("paint");
    },
    COLOR_COUNT,
    clearSelection,
    onDeleteSelection,
    onShiftUp,
    onShiftDown,
    onPaletteShift,
    onRotateSelection,
    onRotateSelectionCCW,
    selectedHexes.length > 0,
    handleExport,
    handleImportClick,
    onboarding.openHelp,
  );

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
          layers: layersRef.current,
          activeLayerIdx: activeLayerIdxRef.current,
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
    <div
      ref={rootRef}
      className="flex flex-col h-full w-full bg-background select-none safe-area-inset"
    >
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
        onExportSVG={handleExportSVG}
        onImportClick={handleImportClick}
        onClear={handleClear}
        onCenterView={onCenterView}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        symmetry={symmetry}
        onSymmetryChange={setSymmetry}
        brushSize={brushSize}
        onBrushSizeChange={setBrushSize}
        flowerRadius={flowerRadius}
        onFlowerRadiusChange={setFlowerRadius}
        hexMode={hexMode}
        gridDivisions={gridDivisions}
        tooltip={tooltip}
        onSetTooltip={setTooltip}
        onOpenHelp={onboarding.openHelp}
        projectName={projectName}
        onProjectNameChange={setProjectName}
      />

      <div
        ref={containerRef}
        data-tour="canvas"
        className="flex-1 relative overflow-hidden cursor-crosshair touch-none outline-none"
        style={{
          background:
            "repeating-linear-gradient(30deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 6px, rgba(0,0,0,0.06) 6px, rgba(0,0,0,0.06) 12px)",
        }}
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
          layers={layers}
          hoverTargets={hoverTargets}
          screenToWorld={screenToWorld}
          gridDivisions={gridDivisions}
          hexMode={hexMode}
          selectedHexes={selectedHexes}
          tool={tool}
          activeSelection={activeSelection}
          stampFlash={stampFlash}
          cloneFlash={cloneFlash}
          cloneSource={cloneSource}
          cloneOffset={cloneOffset}
          captureMode={captureMode}
          gridRotation={gridRotation}
          brushSize={brushSize}
          symmetry={symmetry}
          hueOffset={hueOffset}
          saturationOffset={satOffset}
        />

        {tool === "select" ? (
          <SelectionPalette
            onShiftUp={onShiftUp}
            onShiftDown={onShiftDown}
            onRotate={onRotateSelection}
            onFlip={onFlipSelection}
            onFlipHorizontal={onFlipHorizontal}
            onPaletteShift={onPaletteShift}
            hasSelection={selectedHexes.length > 0}
            onPointerEnter={() => setHoveredTri(null)}
            gridOrientation={gridOrientation}
          />
        ) : tool === "stamp" ? (
          <StampPalette
            selections={selections}
            activeSelectionId={activeSelection?.id ?? null}
            onSelect={(s) => {
              setActiveSelection(s);
              setCaptureMode(false);
            }}
            onPointerEnter={() => setHoveredTri(null)}
            onDelete={onDeletePaletteItem}
            onCapture={() => setCaptureMode(true)}
            gridRotation={gridRotation}
          />
        ) : (
          <ColorPalette
            color={colorHex}
            palette={activePalette}
            palettes={computedPalettes}
            onColorChange={onColorChange}
            onPaletteChange={(colors, idx) => {
              setActivePaletteIdx(idx);
              setColorIdx(colors.length - 1);
              setTool("paint");
            }}
            onPointerEnter={() => setHoveredTri(null)}
            hueOffset={hueOffset}
            onHueOffsetChange={setHueOffset}
            saturationOffset={satOffset}
            onSaturationOffsetChange={setSatOffset}
          />
        )}
        {layersOpen && (
          <LayerPanel
            layers={layers}
            activeLayerIdx={activeLayerIdx}
            onSelectLayer={setActiveLayerIdx}
            onAddLayer={addLayer}
            onDeleteLayer={deleteLayer}
            onDuplicateLayer={duplicateLayer}
            onToggleVisibility={toggleLayerVisibility}
            onMoveLayer={moveLayer}
            onCommit={onCommit}
            onPointerEnter={() => setHoveredTri(null)}
          />
        )}
      </div>

      <Footer
        gridDivisions={gridDivisions}
        onGridDivisionsChange={setGridDivisions}
        hexMode={hexMode}
        onHexModeChange={setHexMode}
        handleUndo={onUndo}
        handleRedo={onRedo}
        historyIdx={historyIdx}
        historyLength={history.length}
        tool={tool}
        captureMode={captureMode}
        cloneSourceSet={cloneSource !== null}
        gridOrientation={gridOrientation}
        onGridOrientationChange={setGridOrientation}
        tooltip={tooltip}
        layersOpen={layersOpen}
        onToggleLayers={() => setLayersOpen((o) => !o)}
      />

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        painted={mergedPainted}
        projectName={projectName}
      />

      <SplashDialog
        open={onboarding.splashOpen}
        onClose={onboarding.closeSplash}
        onStartTour={onboarding.startTour}
      />
      <HelpDialog
        open={onboarding.helpOpen}
        onClose={onboarding.closeHelp}
        onStartTour={onboarding.startTour}
      />
      <InterfaceTour
        active={onboarding.tourActive}
        step={onboarding.tourStep}
        next={onboarding.tourNext}
        prev={onboarding.tourPrev}
        end={onboarding.endTour}
      />
    </div>
  );
}
