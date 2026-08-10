"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useCanvasSize } from "@/hooks/use-canvas-size";
import {
  useHistory,
  layerKind,
  splitLayerAt,
  MAX_LAYERS,
  type ProjectSnapshot,
  type Layer,
  type LayerKind,
} from "@/hooks/use-history";
import { layersRoundFraction } from "@/lib/hatch-render";
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
  isNoPrint,
  NO_PRINT,
  remapGrid,
  resolveColor,
  shiftGridPalettes,
  setPaletteOffsets,
} from "@/lib/constants";
import {
  DEFAULT_TRI_PATTERN,
  makePatternLayer,
  makePatternPreset,
  normalizePatternPreset,
  buildQuantizeTargets,
  type PatternLayer,
  type PatternPreset,
} from "@/lib/tri-pattern";
import { PatternPanel } from "@/components/PatternPanel";
import { PatternPalette } from "@/components/PatternPalette";
import { stringToTri, triToString, type TriKey } from "@/lib/grid-math";
import { DEFAULT_PROJECT_NAME } from "@/lib/utils";
import { downloadBlob } from "@/lib/png-export";
import {
  buildProjectSVG,
  projectFileName,
  readProjectFile,
  selectionPayload,
  type ProjectPayload,
  type SelectionSaveOptions,
} from "@/lib/project-file";
import { SaveSelectionDialog } from "@/components/SaveSelectionDialog";
import { NameLayerDialog } from "@/components/NameLayerDialog";
import { fetchExample, type Example } from "@/lib/examples";
import { ExampleGallery } from "@/components/ExampleGallery";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SelectionSnapshot, HexRegion } from "@/lib/hex-flower";
import {
  rotateHexCW,
  rotateHexCCW,
  flipHexVertical,
  flipHexHorizontal,
  remapHex,
  shiftHexPalettes,
  regionTrixels,
  regionMembership,
  spreadHexArtwork,
} from "@/lib/hex-flower";
import { isToolAllowed, type Tool } from "@/lib/tools";
import { ExportDialog } from "@/components/ExportDialog";
import { Export3DDialog } from "@/components/Export3DDialog";
import { CutExportDialog } from "@/components/CutExportDialog";
import { InterlockDialog } from "@/components/InterlockDialog";
import type { SVGExportOptions } from "@/lib/svg-export";
import { LayerPanel } from "@/components/LayerPanel";
import {
  GridSettingsPanel,
  DEFAULT_EDITOR_BG,
} from "@/components/GridSettingsPanel";
import { panelForTool, type PanelId } from "@/components/PanelShell";
import {
  ExportPanel,
  DEFAULT_EXPORT_SETTINGS,
  type ExportSettings,
} from "@/components/ExportPanel";
import { DEFAULT_CROP, type CropRect } from "@/lib/crop";
import {
  DEFAULT_PLOTTER,
  normalizePlotterSettings,
  type PlotterSettings,
} from "@/lib/plotter-export";
import {
  DEFAULT_APPAREL,
  normalizeApparelSettings,
  type ApparelSettings,
} from "@/lib/apparel-export";
import { PlotterDialog } from "@/components/PlotterDialog";
import { ApparelDialog } from "@/components/ApparelDialog";
import { HatchBar } from "@/components/HatchBar";
import {
  DEFAULT_HATCH_BRUSH,
  MAX_DENSITY,
  MAX_WEIGHT,
  DIR_MASK_MAX,
  MIN_DENSITY,
  MIN_WEIGHT,
  type HatchBrush,
} from "@/lib/hatch";
import { HatchifyDialog } from "@/components/HatchifyDialog";
import {
  DEFAULT_HATCHIFY,
  MAX_LEVELS,
  MAX_SKIP,
  MIN_LEVELS,
  MIN_SKIP,
  hatchify,
  type HatchifySettings,
} from "@/lib/hatchify";
import { useOnboarding } from "@/hooks/use-onboarding";
import { SplashDialog } from "@/components/onboarding/SplashDialog";
import { HelpDialog } from "@/components/onboarding/HelpDialog";
import { InterfaceTour } from "@/components/onboarding/InterfaceTour";

const STORAGE_KEY = "trixel-save";

const DEFAULT_SVG_EXPORT: SVGExportOptions = { stroke: false, merge: false };

// Grid-setting defaults applied on first launch (no saved settings) and when
// starting a new project via handleClear.
const DEFAULT_HEX_MODE: HexMode = "honeycomb";
const DEFAULT_GRID_DIVISIONS = 3;

export default function TrixelGrid() {
  const { size, containerRef, updateSize } = useCanvasSize();
  const {
    mounted,
    layers,
    setLayers,
    activeLayerIdx,
    painted,
    setPainted,
    setAllPainted,
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
    renameLayer,
    toggleLayerVisibility,
    setLayerEffects,
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
  const [saveSelectionOpen, setSaveSelectionOpen] = useState(false);
  const [nameSplitLayerOpen, setNameSplitLayerOpen] = useState(false);
  const [export3DOpen, setExport3DOpen] = useState(false);
  const [exportCutOpen, setExportCutOpen] = useState(false);
  const [exportInterlockOpen, setExportInterlockOpen] = useState(false);
  const [svgExport, setSvgExport] =
    useState<SVGExportOptions>(DEFAULT_SVG_EXPORT);
  const updateSvgExport = useCallback(
    (patch: Partial<SVGExportOptions>) =>
      setSvgExport((s) => ({ ...s, ...patch })),
    [],
  );

  // Crop region and export options are view state, like zoom or the grid
  // settings — deliberately *not* part of ProjectSnapshot, or dragging a crop
  // handle would land in the undo stack and Ctrl+Z would stop undoing paint.
  const [showNoPrint, setShowNoPrint] = useState(true);
  // Encoded, so the backdrop follows `hueOffset`/`satOffset` like painted
  // colour does; `null` keeps the default stripes.
  const [editorBg, setEditorBg] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  // Subdivision noise folds its grain onto this so a fabric tile repeats
  // seamlessly. Every backend must receive the same one — the preview, both
  // SVG exports, the fabric PNG, the apparel PNG and the project thumbnail —
  // or the grain on screen is not the grain in the file.
  const noisePeriod = useMemo(
    () => ({ m: crop.m, n: crop.n }),
    [crop.m, crop.n],
  );
  const [exportSettings, setExportSettings] = useState<ExportSettings>(
    DEFAULT_EXPORT_SETTINGS,
  );
  const updateExportSettings = useCallback(
    (patch: Partial<ExportSettings>) =>
      setExportSettings((s) => ({ ...s, ...patch })),
    [],
  );

  // Why a dialog and not a console line: the file picker now accepts every
  // `.svg`, so "picked the wrong one" is a routine mistake rather than a
  // programming error, and it has to say so.
  const [importError, setImportError] = useState<string | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  // Declared up here rather than beside the other dialogs because the example
  // loader below needs `closeSplash`: picking an example from the splash is a
  // way of dismissing it.
  const onboarding = useOnboarding();
  const { closeSplash } = onboarding;
  /** The example being fetched, so the gallery can show which one is loading. */
  const [loadingExample, setLoadingExample] = useState<string | null>(null);

  // Plotter settings live on their own rather than inside `exportSettings`:
  // the plot is not cropped and shares nothing with the fabric drawer.
  const [plotterOpen, setPlotterOpen] = useState(false);
  const [plotterSettings, setPlotterSettingsState] =
    useState<PlotterSettings>(DEFAULT_PLOTTER);
  const setPlotterSettings = useCallback(
    (patch: Partial<PlotterSettings>) =>
      setPlotterSettingsState((s) => ({ ...s, ...patch })),
    [],
  );

  // Apparel settings, for the same reason: a shirt print is the whole artwork
  // on a garment, so it inherits nothing from the crop drawer either.
  const [apparelOpen, setApparelOpen] = useState(false);
  const [apparelSettings, setApparelSettingsState] =
    useState<ApparelSettings>(DEFAULT_APPAREL);
  const setApparelSettings = useCallback(
    (patch: Partial<ApparelSettings>) =>
      setApparelSettingsState((s) => ({ ...s, ...patch })),
    [],
  );

  // Hatch brush. Like the pattern stack it carries its own colour, so it is a
  // view setting rather than authored content — `trixel-settings`, never
  // ProjectSnapshot.
  const [hatchBrush, setHatchBrushState] =
    useState<HatchBrush>(DEFAULT_HATCH_BRUSH);
  const setHatchBrush = useCallback(
    (patch: Partial<HatchBrush>) =>
      setHatchBrushState((b) => ({ ...b, ...patch })),
    [],
  );

  // Hatchify settings sit with the brush, for the same reason: they describe how
  // the tool behaves, not what the document contains.
  const [hatchifyOpen, setHatchifyOpen] = useState(false);
  const [hatchifySettings, setHatchifySettingsState] =
    useState<HatchifySettings>(DEFAULT_HATCHIFY);
  const setHatchifySettings = useCallback(
    (patch: Partial<HatchifySettings>) =>
      setHatchifySettingsState((s) => ({ ...s, ...patch })),
    [],
  );

  const computedPalettes = useMemo(
    () => computePaletteColors(PALETTE_DEFS, hueOffset, satOffset),
    [hueOffset, satOffset],
  );

  // **Written during render, not in an effect.** `resolveColor` reads these off
  // module state rather than taking them as arguments, so every descendant that
  // resolves a colour needs them current *before* it renders. As an effect this
  // was a frame late in a way that never corrected itself: React runs child
  // effects before parent ones, so `GridCanvas` painted the canvas with the
  // previous offsets and this ran afterwards, and since nothing else changed no
  // further draw was scheduled. On first load — where the saved offsets arrive
  // in a single restore and then never change again — the artwork simply kept
  // the unshifted palette until the next edit happened to redraw it.
  //
  // `useMemo` is the sync-external-state-during-render idiom here; the value is
  // unused and the offsets are the dependency.
  useMemo(() => {
    setPaletteOffsets(hueOffset, satOffset);
  }, [hueOffset, satOffset]);

  // Compositing two palette swatches rarely lands on a third, so the result is
  // snapped back to the nearest paintable colour — searched across every
  // palette, not just the active one.
  const quantizeTargets = useMemo(
    () => buildQuantizeTargets(computedPalettes),
    [computedPalettes],
  );

  const [activePaletteIdx, setActivePaletteIdx] = useState(0);
  const activePalette =
    computedPalettes[activePaletteIdx]?.colors ?? computedPalettes[0].colors;
  const [colorIdx, setColorIdx] = useState(8);

  const colorHex = activePalette[colorIdx] ?? activePalette[8];
  // The no-print pen is a *mode*, not a palette index: the marker has no
  // palette or lightness, so it cannot be represented as `(paletteIdx, colorIdx)`
  // the way every real swatch is.
  const [noPrintPen, setNoPrintPen] = useState(false);
  const paintKey = noPrintPen
    ? NO_PRINT
    : encodeColor(activePaletteIdx, colorIdx);

  // On a hatch layer the ordinary swatch row drives the hatch brush, so it
  // shows the brush's *own* palette rather than the paint palette. Anything
  // else and an eyedropper pick landing on a mark authored in another palette
  // would highlight the wrong swatch, or none. Both `hatchHex` and the row come
  // out of the same array, so identity by hex is safe here.
  const hatchColor = decodeColor(hatchBrush.color);
  const hatchPaletteIdx = hatchColor?.paletteIdx ?? activePaletteIdx;
  const hatchPalette =
    computedPalettes[hatchPaletteIdx]?.colors ?? activePalette;
  const hatchColorIdx = hatchColor?.colorIdx ?? 8;
  const hatchHex = hatchPalette[hatchColorIdx] ?? hatchPalette[8];
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [gridDivisions, setGridDivisions] = useState(DEFAULT_GRID_DIVISIONS);
  const [hexMode, setHexMode] = useState<HexMode>(DEFAULT_HEX_MODE);
  const [flowerRadius, setFlowerRadius] = useState(0);
  // Pattern brush stack, bottom-first. Each layer carries its own two colours,
  // so the brush no longer borrows the active paint colour.
  const [patternLayers, setPatternLayers] = useState<PatternLayer[]>(() => [
    makePatternLayer(),
  ]);
  const [activePatternIdx, setActivePatternIdx] = useState(0);
  // The pattern panel picks its own palette. Sharing the paint palette meant
  // switching colour to paint silently changed the pattern's swatch row.
  const [patternPaletteIdx, setPatternPaletteIdx] = useState(0);
  // Saved stacks. These ride in the project snapshot rather than view settings
  // — a stack is authored content, so it should travel with the artwork.
  const [patternPresets, setPatternPresets] = useState<PatternPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [symmetry, setSymmetry] = useState<Symmetry>("off");
  const [brushSize, setBrushSize] = useState<"single" | "hex">("single");
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [gridOrientation, setGridOrientation] =
    useState<GridOrientation>("flat-top");
  // Display-only rotation: pointy-top hexes are flat-top rotated 90°. The
  // underlying tri-axial lattice, hex geometry, symmetry math, history and
  // persistence remain untouched — only the screen↔world seam applies it.
  const gridRotation = gridOrientation === "pointy-top" ? Math.PI / 2 : 0;
  // Hex-shaped regions, not honeycomb coordinates: in world mode a selection
  // is anchored wherever it was made. See `HexRegion`.
  const [selectedHexes, setSelectedHexes] = useState<HexRegion[]>([]);
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
  // The panel slot. All four drawers occupy the same strip down the right-hand
  // edge, so at most one may be open — two would sit on top of each other, and
  // the second would be unreachable. One piece of state rather than a boolean
  // per drawer is what makes that structural instead of a rule to remember.
  const [panel, setPanel] = useState<PanelId | null>(null);
  const hexEnabled = gridDivisions > 0 && hexMode !== "world";
  const effectiveFlowerRadius = hexEnabled ? flowerRadius : 0;

  // Visible **fill** layers only. Hatch values are not colours, so letting them
  // through here would reach the 3D and cutting exporters as garbage "colours".
  // This one filter is what protects both of them — they take nothing else.
  const mergedFillPainted = useMemo(() => {
    const out: Record<string, string> = {};
    for (const layer of layers) {
      if (!layer.visible || layerKind(layer) === "hatch") continue;
      for (const key in layer.painted) {
        // No-print markers are construction marks, not material. This is the
        // single gate in front of the 3D, cutting and apparel exports — none of
        // which filters colours itself — so dropping them here keeps a marker
        // from being extruded, cut or printed.
        if (isNoPrint(layer.painted[key])) continue;
        out[key] = layer.painted[key];
      }
    }
    return out;
  }, [layers]);

  // Corner rounding for the exports that take `mergedFillPainted`. Shared with
  // the plotter, which merges the same way but builds its own map from the
  // layers, so the two cannot drift on what "the artwork's radius" means.
  const mergedFillRoundFraction = useMemo(
    () => layersRoundFraction(layers),
    [layers],
  );

  // What a hatch layer's marks actually sit on: the visible fill layers
  // *strictly below* the active one, merged bottom-to-top so the topmost wins.
  // Bounded above by the active layer because a fill painted over the hatch
  // hides it, and hatching the tone of something that covers you is nonsense.
  const hatchifySource = useMemo(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < activeLayerIdx; i++) {
      const layer = layers[i];
      if (!layer?.visible || layerKind(layer) === "hatch") continue;
      Object.assign(out, layer.painted);
    }
    return out;
  }, [layers, activeLayerIdx]);

  // Only the layers an exporter should draw, in z-order. PNG/SVG take this
  // rather than a flattened map, because hatch has to interleave with fills.
  const visibleLayers = useMemo(
    () => layers.filter((l) => l.visible),
    [layers],
  );

  const activeLayerKind: LayerKind = layerKind(layers[activeLayerIdx] ?? {});
  const isHatchLayer = activeLayerKind === "hatch";
  const activeLayerKindRef = useRef(activeLayerKind);
  activeLayerKindRef.current = activeLayerKind;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Every tool change funnels through here, so the layer-kind policy is
  // enforced once instead of at each of the toolbar, the keyboard bindings
  // (including 1-9, which force paint), the eyedropper and the right-click
  // pick. Because `tool` can then never hold a disallowed value, the dispatch
  // in use-interaction needs no guard of its own.
  const changeTool = useCallback((t: Tool) => {
    if (!isToolAllowed(t, activeLayerKindRef.current)) return;
    setTool(t);
    // The panel slot follows the tool, and this is the only place it can be
    // done: `tool` does not change when the *same* tool is re-selected, so an
    // effect keyed on it would never fire and the drawer's own close button
    // would be a one-way door.
    //
    // Pattern and crop *own* a drawer — the drawer is that tool's controls, so
    // selecting the tool opens it and leaving the tool closes it again. The
    // layers and grid drawers are opened by hand and survive a tool change,
    // unless a tool-owned drawer takes the slot from them.
    setPanel(
      (p) => panelForTool(t) ?? (p === "pattern" || p === "export" ? null : p),
    );
  }, []);

  /**
   * The only way the panel slot is set from outside `changeTool`.
   *
   * Crop is the one tool with no toolbar button — the Crop & Export drawer *is*
   * its interface — so leaving that drawer has to leave the mode too. Otherwise
   * opening Layers on top of it left the canvas covered in crop handles, with
   * painting locked out and nothing on screen to explain why. That was the whole
   * UX complaint the panel slot exposed.
   *
   * Order matters: `setPanel(id)` lands first, so `changeTool`'s own slot
   * reconciliation sees the pending value and leaves it alone rather than
   * clearing the drawer that is opening.
   */
  const leaveCropMode = useCallback(() => {
    if (toolRef.current !== "crop") return;
    changeTool(activeLayerKindRef.current === "hatch" ? "hatch" : "paint");
  }, [changeTool]);

  const showPanel = useCallback(
    (id: PanelId | null) => {
      setPanel(id);
      if (id !== "export") leaveCropMode();
    },
    [leaveCropMode],
  );

  // `tool === "crop"` implies `panel === "export"`: `changeTool` is the only
  // thing that can select crop and it opens the drawer, and `showPanel` is the
  // only thing that can take the slot away and it leaves the mode. So a footer
  // toggle — which can only reach `layers` or `grid` — always leaves the export
  // drawer if crop was active, in either direction, and needs no reading of the
  // current panel to decide.
  const togglePanel = useCallback(
    (id: PanelId) => {
      setPanel((p) => (p === id ? null : id));
      leaveCropMode();
    },
    [leaveCropMode],
  );

  // Move to a usable tool when the active layer's kind changes. Keyed on the
  // kind rather than on `layers`, so it doesn't re-run on every stroke, and it
  // fires for layer selection, add, delete, reorder, undo/redo and project load
  // alike. Only switches when the current tool is actually disallowed, so
  // clicking between layers while holding erase doesn't yank the tool away.
  // Routed through `changeTool` rather than `setTool` so this path reconciles
  // the panel slot too — selecting a hatch layer while the pattern drawer is
  // open has to close it, since the tool it belongs to is going away.
  useEffect(() => {
    if (!isToolAllowed(toolRef.current, activeLayerKind)) {
      changeTool(activeLayerKind === "hatch" ? "hatch" : "paint");
    }
  }, [activeLayerKind, changeTool]);

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
  const patternPresetsRef = useRef(patternPresets);
  patternPresetsRef.current = patternPresets;

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
      patternPresets: patternPresetsRef.current,
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
        patternPresets: patternPresetsRef.current,
        lastPaintTri: lastPaintTriBridgeRef.current?.current
          ? triToString(lastPaintTriBridgeRef.current.current)
          : null,
      };
    },
    [],
  );

  // Tools call setPainted(...) then onCommit() synchronously in the same event.
  // At that point layersRef still holds the pre-edit painted because React
  // hasn't re-rendered yet, so we can't snapshot here directly. We also must
  // NOT push from inside a setPainted updater: React StrictMode (on by default
  // in dev) double-invokes updaters to surface impurity, which would run the
  // pushHistory side effect twice and desync historyIdx (undo/redo then needs
  // an extra press). Instead bump a counter and push from an effect, which runs
  // once after the render that applied the edit — layersRef is current by then,
  // so buildSnapshot captures the fully-reduced latest painted for this batch.
  const [commitVersion, setCommitVersion] = useState(0);

  const onCommit = useCallback(() => {
    setCommitVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (commitVersion === 0) return;
    pushHistory(buildSnapshot());
    // pushHistory intentionally omitted from deps: its identity changes on every
    // history mutation, and re-running this effect without a new commit would
    // push a spurious duplicate. The closure already captures the latest
    // pushHistory from the render where commitVersion changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitVersion]);

  useEffect(() => {
    registerRestore((snap: ProjectSnapshot, from: ProjectSnapshot) => {
      // Undo/redo only reverts the *edit* data. View settings (hexMode,
      // gridDivisions, flowerRadius, symmetry) are persisted separately
      // (SETTINGS_KEY) and shouldn't be touched by undo — otherwise
      // changing a setting between edits would get rolled back alongside
      // the paint when the user hits undo.
      if (Array.isArray(snap.patternPresets)) {
        setPatternPresets(
          snap.patternPresets
            .map(normalizePatternPreset)
            .filter((p): p is PatternPreset => p !== null),
        );
      }
      if (Array.isArray(snap.selections)) {
        setSelections(snap.selections as SelectionSnapshot[]);
        const head = snap.selections[0] as SelectionSnapshot | undefined;
        if (head?.trixels && head.N) setActiveSelection(head);
      }
      // Spread-hex-artwork is a document transform: it remaps the painted
      // coordinates *and* changes the lattice spacing as one edit. Stepping
      // into or out of one of its snapshots must carry the spacing along, or
      // the artwork renders on the wrong lattice. Plain view settings are
      // deliberately left alone (see CLAUDE.md), so only spread transitions
      // restore it — `from.spreadHex` covers undoing back to the pre-spread
      // snapshot, `snap.spreadHex` covers redoing forward into the spread.
      if (
        (snap.spreadHex || from.spreadHex) &&
        typeof snap.gridDivisions === "number"
      ) {
        setGridDivisions(snap.gridDivisions);
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
    patternPresets,
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
        if (typeof data.showNoPrint === "boolean")
          setShowNoPrint(data.showNoPrint);
        if (typeof data.editorBg === "string") setEditorBg(data.editorBg);
        if (typeof data.projectName === "string" && data.projectName.trim())
          setProjectName(data.projectName);
        if (typeof data.hueOffset === "number") setHueOffset(data.hueOffset);
        if (typeof data.saturationOffset === "number")
          setSatOffset(data.saturationOffset);
        if (typeof data.patternPaletteIdx === "number")
          setPatternPaletteIdx(data.patternPaletteIdx);
        if (Array.isArray(data.patternLayers) && data.patternLayers.length) {
          setPatternLayers(
            data.patternLayers.map((l: Partial<PatternLayer>) =>
              makePatternLayer(l),
            ),
          );
        } else if (data.pattern && typeof data.pattern === "object") {
          // Pre-stack settings: one pattern plus a secondary colour, with the
          // primary borrowed from the active swatch. Lift it into a one-layer
          // stack so saved setups survive.
          setPatternLayers([
            makePatternLayer({
              ...DEFAULT_TRI_PATTERN,
              ...data.pattern,
              bg:
                typeof data.patternSecondary === "string"
                  ? data.patternSecondary
                  : undefined,
            }),
          ]);
        }
        if (data.svgExport && typeof data.svgExport === "object")
          setSvgExport({
            stroke: !!data.svgExport.stroke,
            merge: !!data.svgExport.merge,
          });
        if (data.hatchBrush && typeof data.hatchBrush === "object") {
          const h = data.hatchBrush;
          const num = (v: unknown, lo: number, hi: number, dflt: number) =>
            typeof v === "number" && Number.isFinite(v)
              ? Math.min(hi, Math.max(lo, v))
              : dflt;
          setHatchBrushState({
            // Clamped on ingest — this is a file-format boundary, and a mask of
            // 0 would be a brush that silently paints nothing.
            dirMask: num(h.dirMask, 1, DIR_MASK_MAX, DEFAULT_HATCH_BRUSH.dirMask),
            density: num(
              h.density,
              MIN_DENSITY,
              MAX_DENSITY,
              DEFAULT_HATCH_BRUSH.density,
            ),
            weight: num(
              h.weight,
              MIN_WEIGHT,
              MAX_WEIGHT,
              DEFAULT_HATCH_BRUSH.weight,
            ),
            color:
              typeof h.color === "string" ? h.color : DEFAULT_HATCH_BRUSH.color,
          });
        }
        if (data.hatchify && typeof data.hatchify === "object") {
          const hf = data.hatchify;
          const num = (v: unknown, lo: number, hi: number, dflt: number) =>
            typeof v === "number" && Number.isFinite(v)
              ? Math.min(hi, Math.max(lo, v))
              : dflt;
          const minDensity = num(
            hf.minDensity,
            MIN_DENSITY,
            MAX_DENSITY,
            DEFAULT_HATCHIFY.minDensity,
          );
          setHatchifySettingsState({
            mode: hf.mode === "reduce" ? "reduce" : "single",
            minDensity,
            // Clamped against the ingested minimum, not against MIN_DENSITY: an
            // inverted range would flatten every mark to one density.
            maxDensity: num(
              hf.maxDensity,
              minDensity,
              MAX_DENSITY,
              Math.max(minDensity, DEFAULT_HATCHIFY.maxDensity),
            ),
            weight: num(
              hf.weight,
              MIN_WEIGHT,
              MAX_WEIGHT,
              DEFAULT_HATCHIFY.weight,
            ),
            densitySkip: Math.round(
              num(
                hf.densitySkip,
                MIN_SKIP,
                MAX_SKIP,
                DEFAULT_HATCHIFY.densitySkip,
              ),
            ),
            color:
              typeof hf.color === "string" ? hf.color : DEFAULT_HATCHIFY.color,
            levels: Math.round(
              num(hf.levels, MIN_LEVELS, MAX_LEVELS, DEFAULT_HATCHIFY.levels),
            ),
          });
        }
        if (data.plotter && typeof data.plotter === "object") {
          setPlotterSettingsState(normalizePlotterSettings(data.plotter));
        }
        if (data.apparel && typeof data.apparel === "object") {
          setApparelSettingsState(normalizeApparelSettings(data.apparel));
        }
        if (data.crop && typeof data.crop === "object") {
          const { i, j, m, n } = data.crop;
          if ([i, j, m, n].every((v) => typeof v === "number")) {
            setCrop({ i, j, m: Math.max(1, m), n: Math.max(1, n) });
          }
        }
        if (data.exportSettings && typeof data.exportSettings === "object") {
          const es = data.exportSettings;
          setExportSettings({
            dpi:
              typeof es.dpi === "number" && es.dpi > 0
                ? es.dpi
                : DEFAULT_EXPORT_SETTINGS.dpi,
            widthInches:
              typeof es.widthInches === "number" && es.widthInches > 0
                ? es.widthInches
                : DEFAULT_EXPORT_SETTINGS.widthInches,
            bgColor:
              typeof es.bgColor === "string"
                ? es.bgColor
                : DEFAULT_EXPORT_SETTINGS.bgColor,
            svg: {
              stroke: !!es.svg?.stroke,
              merge: !!es.svg?.merge,
            },
          });
        }
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
        showNoPrint,
        editorBg,
        projectName,
        hueOffset,
        saturationOffset: satOffset,
        patternLayers,
        patternPaletteIdx,
        svgExport,
        crop,
        exportSettings,
        hatchBrush,
        hatchify: hatchifySettings,
        plotter: plotterSettings,
        apparel: apparelSettings,
      }),
    );
  }, [
    gridDivisions,
    hexMode,
    flowerRadius,
    symmetry,
    gridOrientation,
    brushSize,
    showNoPrint,
    editorBg,
    projectName,
    hueOffset,
    satOffset,
    patternLayers,
    patternPaletteIdx,
    svgExport,
    crop,
    exportSettings,
    hatchBrush,
    hatchifySettings,
    plotterSettings,
    apparelSettings,
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

  const onCloneCapture = useCallback(
    (
      x: number,
      y: number,
      c: number,
      k: number,
      q: number,
      r: number,
      type: string,
    ) => {
      setCloneSource({ x, y, q, r, type });
      setCloneFlash((prev) => ({
        c,
        k,
        q,
        r,
        type,
        opacity: 1,
        seq: (prev?.seq ?? 0) + 1,
      }));
    },
    [],
  );

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
    setTool: changeTool,
    color: paintKey,
    setColor: (encoded) => {
      // A marker is pickable like any other paint, or it would be the one thing
      // on the canvas the eyedropper silently ignored.
      if (isNoPrint(encoded)) {
        setNoPrintPen(true);
        changeTool("paint");
        return;
      }
      const d = decodeColor(encoded);
      if (d && PALETTE_DEFS[d.paletteIdx]) {
        setNoPrintPen(false);
        setActivePaletteIdx(d.paletteIdx);
        setColorIdx(d.colorIdx);
        changeTool("paint");
      }
    },
    patternLayers,
    quantizeTargets,
    painted,
    setPainted,
    setAllPainted,
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
    crop,
    setCrop,
    hatchBrush,
    setHatchBrush,
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
      const hexTris = regionTrixels(sel);
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

  const buildPayload = useCallback(
    (): ProjectPayload => ({
      ...buildSnapshot(),
      name: projectName,
      svgExport,
      // View state, but it shifts every resolved colour — without it a project
      // reopens in different colours from the ones its own thumbnail shows.
      hueOffset,
      saturationOffset: satOffset,
      // Likewise the lattice's quarter turn: the same trixels pointy-top are a
      // different picture. The other grid settings ride along inside the
      // snapshot already.
      gridOrientation,
      version: 1,
    }),
    [buildSnapshot, projectName, svgExport, hueOffset, satOffset, gridOrientation],
  );

  /** The one place a project file is written. Both saves go through it, so a
   *  saved selection and a saved project cannot drift apart as formats. */
  const writeProject = useCallback(
    (payload: ProjectPayload) => {
      const svg = buildProjectSVG(payload, noisePeriod, gridRotation);
      downloadBlob(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        projectFileName(payload.name),
      );
    },
    [noisePeriod, gridRotation],
  );

  const handleExport = useCallback(() => {
    writeProject(buildPayload());
  }, [buildPayload, writeProject]);

  const handleSaveSelection = useCallback(
    (opts: SelectionSaveOptions) => {
      if (selectedHexes.length === 0) return;
      writeProject(selectionPayload(buildPayload(), selectedHexes, opts));
    },
    [selectedHexes, buildPayload, writeProject],
  );

  const handleExportSVG = useCallback(() => {
    setExportDialogOpen(true);
  }, []);

  const handleExport3D = useCallback(() => {
    setExport3DOpen(true);
  }, []);

  const handleExportCut = useCallback(() => {
    setExportCutOpen(true);
  }, []);

  const handleExportInterlock = useCallback(() => {
    setExportInterlockOpen(true);
  }, []);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * Reads a project file's text and applies it.
   *
   * Shared by the file picker and the example gallery: both arrive with the
   * text of a `.trixel.svg` (or a legacy `.json`), and everything downstream —
   * the container sniff, the version branch, the legacy migrations — is the
   * same either way. Returns whether it worked so a caller can keep its own
   * dialog open on failure.
   */
  const loadProjectText = useCallback(
    (text: string, label: string): boolean => {
      try {
        // Both containers land here: a project SVG's embedded payload, or a
        // legacy `.json` file's text unchanged. Everything below is the same
        // migration path either way.
        const result = readProjectFile(text);
        if (!result.ok) {
          setImportError(result.error);
          return false;
        }
        const data = JSON.parse(result.json);
        if (typeof data !== "object" || data === null) return false;

        if (typeof data.name === "string" && data.name.trim())
          setProjectName(data.name);

        if (data.svgExport && typeof data.svgExport === "object")
          setSvgExport({
            stroke: !!data.svgExport.stroke,
            merge: !!data.svgExport.merge,
          });

        // Only when present, so a legacy file leaves the current offsets alone.
        if (typeof data.hueOffset === "number") setHueOffset(data.hueOffset);
        if (typeof data.saturationOffset === "number")
          setSatOffset(data.saturationOffset);

        if (data.version === 1 || data.painted) {
          let snapLayers: Layer[];
          let snapActive: number;
          if (Array.isArray(data.layers)) {
            snapLayers = data.layers as Layer[];
            snapActive =
              typeof data.activeLayerIdx === "number" ? data.activeLayerIdx : 0;
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
            patternPresets: Array.isArray(data.patternPresets)
              ? data.patternPresets
              : [],
            lastPaintTri:
              typeof data.lastPaintTri === "string" ? data.lastPaintTri : null,
          };
          // Apply the whole layer array, not just the active layer's pixels —
          // otherwise an imported multi-layer project writes into whatever
          // layer is currently selected and the real stack (kinds included)
          // only appears after an undo/redo round trip.
          setLayers(snapLayers);
          setActiveLayerIdx(
            Math.max(0, Math.min(snapActive, snapLayers.length - 1)),
          );
          pushHistory(snap);

          // The grid settings describe the document, not the workspace: the
          // same trixels on a different lattice are a different picture. They
          // have always been *written* into the file (they are part of
          // `ProjectSnapshot`), but nothing applied them on load — only the
          // legacy `data.settings` branch below did, so a modern file opened
          // onto whatever grid happened to be on screen.
          //
          // Note this is not the undo path: `registerRestore` still leaves
          // these alone on purpose, so changing a setting between strokes is
          // not rolled back by Ctrl+Z. Loading a document is a different act
          // from stepping through its history.
          setGridDivisions(snap.gridDivisions);
          setHexMode(snap.hexMode as HexMode);
          setFlowerRadius(snap.flowerRadius);
          setSymmetry(snap.symmetry as Symmetry);
          // Not in `ProjectSnapshot` — a quarter turn of the whole lattice is
          // authored content, but adding a field there means touching every
          // literal that builds one, and undo would still ignore it. It rides
          // with the payload's other document-level view state instead.
          if (
            data.gridOrientation === "flat-top" ||
            data.gridOrientation === "pointy-top"
          ) {
            setGridOrientation(data.gridOrientation);
          }

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
            patternPresets: [],
            lastPaintTri: null,
          };
          setLayers(snap.layers);
          setActiveLayerIdx(0);
          pushHistory(snap);
        }
        return true;
      } catch (err) {
        console.error("Failed to import", err);
        setImportError(`Could not read ${label}.`);
        return false;
      }
    },
    [
      setLayers,
      setActiveLayerIdx,
      pushHistory,
      setGridDivisions,
      setHexMode,
      setFlowerRadius,
      setSymmetry,
      setSelections,
      setActiveSelection,
      setProjectName,
      setSvgExport,
      setHueOffset,
      setSatOffset,
      setGridOrientation,
      setImportError,
    ],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) =>
        loadProjectText(event.target?.result as string, "that project file");
      reader.readAsText(file);
      // Cleared so picking the same file twice in a row still fires a change.
      e.target.value = "";
    },
    [loadProjectText],
  );

  /**
   * Fetches a bundled example and loads it. Undoable like any other import, so
   * it needs no "are you sure" — `Ctrl+Z` brings the previous work back.
   */
  const handlePickExample = useCallback(
    async (example: Example) => {
      setLoadingExample(example.file);
      try {
        const text = await fetchExample(example.file);
        if (loadProjectText(text, `the ${example.name} example`)) {
          setExamplesOpen(false);
          closeSplash(false);
        }
      } catch (err) {
        console.error("Failed to fetch example", err);
        setImportError(`Could not load the ${example.name} example.`);
      } finally {
        setLoadingExample(null);
      }
    },
    [loadProjectText, closeSplash],
  );

  const onColorChange = useCallback(
    (c: string) => {
      const idx = activePalette.indexOf(c);
      if (idx >= 0) setColorIdx(idx);
      setNoPrintPen(false);
      // Through `changeTool`, not `setTool`: picking a colour is a tool change
      // like any other, and it has to close a tool-owned drawer behind it.
      changeTool("paint");
    },
    [activePalette, changeTool],
  );

  const onPaletteShift = useCallback(
    (direction: number) => {
      const count = PALETTE_DEFS.length;
      setPainted((prev) => {
        let next = prev;
        if (selectedHexes.length > 0 && gridDivisions > 0) {
          for (const sel of selectedHexes) {
            next = shiftHexPalettes(next, sel, direction as 1 | -1, count);
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
      patternPresets: patternPresetsRef.current,
      lastPaintTri: lastPaintTriBridgeRef.current?.current
        ? triToString(lastPaintTriBridgeRef.current.current)
        : null,
    });
  }, [resetToSingleLayer, pushHistory]);

  /**
   * Re-centres every painted hexagon onto the same-index hexagon of a new
   * lattice spacing (the "spread hex artwork" edit). Rebuilds the whole layer
   * array and pushes one snapshot, so the remap and the spacing change undo
   * together — `spreadHex` marks it for the restore handler above.
   */
  const onSpreadHexArtwork = useCallback(
    (newN: number) => {
      const oldN = gridDivisionsRef.current;
      if (oldN <= 0 || newN <= 0 || newN === oldN) return;
      const nextLayers = layersRef.current.map((l) => ({
        ...l,
        painted: spreadHexArtwork(l.painted, oldN, newN),
      }));
      setGridDivisions(newN);
      setLayers(nextLayers);
      pushHistory({
        ...buildSnapshot(),
        layers: nextLayers,
        gridDivisions: newN,
        spreadHex: true,
      });
    },
    [setGridDivisions, setLayers, pushHistory, buildSnapshot],
  );

  const onShiftUp = useCallback(() => {
    setPainted((prev) => {
      let next = prev;
      if (selectedHexes.length > 0 && gridDivisions > 0) {
        for (const sel of selectedHexes) {
          next = remapHex(next, sel, 1, COLOR_COUNT);
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
          next = remapHex(next, sel, -1, COLOR_COUNT);
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
        next = rotateHexCW(next, sel);
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
        next = rotateHexCCW(next, sel);
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
        next = flipHexVertical(next, sel);
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
        next = flipHexHorizontal(next, sel);
      }
      if (next !== prev) {
        pushHistory(snapshotWithPainted(next));
      }
      return next;
    });
  }, [selectedHexes, gridDivisions, setPainted, pushHistory]);

  /**
   * Lifts everything the selection covers off the active layer and into a new
   * layer of its own, directly above it.
   *
   * Like `applyHatchify` this cannot go through `setPainted`: two layers change
   * at once and that only ever addresses the active one. So the whole array is
   * rebuilt and pushed as a single history entry — the cells leaving one layer
   * and arriving in the other are one edit and must undo as one.
   */
  const onMoveSelectionToLayer = useCallback(
    (name: string) => {
      if (selectedHexes.length === 0 || gridDivisions <= 0) return;
      const inside = regionMembership(selectedHexes);
      if (!inside) return;

      const idx = activeLayerIdxRef.current;
      const src = layersRef.current[idx];
      if (!src) return;

      const moved: Record<string, string> = {};
      for (const [key, value] of Object.entries(src.painted)) {
        if (inside(stringToTri(key))) moved[key] = value;
      }

      // Null covers both "the selection is empty of paint" and "the stack is
      // full" — neither is an edit, so neither pushes.
      const next = splitLayerAt(layersRef.current, idx, moved, name);
      if (!next) return;

      setLayers(next);
      setActiveLayerIdx(idx + 1);
      pushHistory({ ...buildSnapshot(), layers: next, activeLayerIdx: idx + 1 });
    },
    [
      selectedHexes,
      gridDivisions,
      setLayers,
      setActiveLayerIdx,
      pushHistory,
      buildSnapshot,
      layersRef,
      activeLayerIdxRef,
    ],
  );

  /**
   * Rewrites the selected hexes as hatch marks derived from the fills below.
   *
   * Reduce mode writes into layers *other* than the active one, so this cannot
   * go through `setPainted`/`snapshotWithPainted` — both address only
   * `layers[activeLayerIdx]`. The whole array is rebuilt and pushed once, which
   * keeps the golden rule intact: one editing action, one undo entry covering
   * both the new marks and the requantised fills.
   */
  const applyHatchify = useCallback(() => {
    if (selectedHexes.length === 0 || gridDivisions <= 0 || !isHatchLayer)
      return;

    const res = hatchify(
      hatchifySource,
      selectedHexes,
      gridDivisions,
      hatchifySettings,
    );

    const next = layers.map((l) => ({ ...l, painted: { ...l.painted } }));

    // Clear the selection wholesale before merging, so re-running with new
    // settings replaces the previous result rather than layering onto it.
    const active = next[activeLayerIdx];
    if (!active) return;
    for (const key of res.covered) delete active.painted[key];
    Object.assign(active.painted, res.hatch);

    // Each requantised fill goes back into the layer that won the merge — the
    // topmost visible fill layer below the hatch that already holds that trixel.
    // Writing it anywhere else would change which value the composite shows.
    for (const [key, fill] of Object.entries(res.fills)) {
      for (let i = activeLayerIdx - 1; i >= 0; i--) {
        const l = next[i];
        if (!l.visible || layerKind(l) === "hatch") continue;
        if (l.painted[key] !== undefined) {
          l.painted[key] = fill;
          break;
        }
      }
    }

    setLayers(next);
    pushHistory({ ...buildSnapshot(), layers: next });
  }, [
    selectedHexes,
    gridDivisions,
    isHatchLayer,
    hatchifySource,
    hatchifySettings,
    layers,
    activeLayerIdx,
    setLayers,
    pushHistory,
    buildSnapshot,
  ]);

  useKeyboardShortcuts(
    onUndo,
    onRedo,
    changeTool,
    (c) => {
      // On a hatch layer the number keys retint the hatch brush instead of
      // jumping to a tool that layer doesn't allow.
      if (activeLayerKindRef.current === "hatch") {
        // Against the *hatch* palette, so the number keys pick out of the row
        // the swatch strip is actually showing.
        setHatchBrush({ color: encodeColor(hatchPaletteIdx, c) });
        return;
      }
      setColorIdx(c);
      changeTool("paint");
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

  // Capture the live stack into a slot. Commits so the slot is undoable, the
  // same contract the stamp palette follows.
  const onCapturePattern = useCallback(() => {
    const preset = makePatternPreset(patternLayers);
    setPatternPresets((prev) => [...prev, preset]);
    setActivePresetId(preset.id);
    onCommit();
  }, [patternLayers, onCommit]);

  const onSelectPattern = useCallback((p: PatternPreset) => {
    // Copied on load as well as on save, so editing after loading a slot does
    // not write back into it.
    setPatternLayers(p.layers.map((l) => makePatternLayer(l)));
    setActivePatternIdx(0);
    setActivePresetId(p.id);
  }, []);

  const onDeletePattern = useCallback(
    (p: PatternPreset) => {
      setPatternPresets((prev) => prev.filter((x) => x.id !== p.id));
      setActivePresetId((cur) => (cur === p.id ? null : cur));
      onCommit();
    },
    [onCommit],
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
          patternPresets: [],
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
        // `.svg` already covers `.trixel.svg` — browsers match the final
        // extension — but naming the compound form makes the intent legible,
        // and the MIME types cover pickers that filter by type.
        accept=".trixel.svg,.svg,.json,image/svg+xml,application/json"
        className="hidden"
      />

      <Toolbar
        tool={tool}
        onToolChange={changeTool}
        activeLayerKind={activeLayerKind}
        onExport={handleExport}
        onSaveSelection={() => setSaveSelectionOpen(true)}
        hasSelection={selectedHexes.length > 0}
        onExportSVG={handleExportSVG}
        onExport3D={handleExport3D}
        onExportCut={handleExportCut}
        onExportInterlock={handleExportInterlock}
        onExportPlotter={() => setPlotterOpen(true)}
        onExportApparel={() => setApparelOpen(true)}
        onImportClick={handleImportClick}
        onLoadExample={() => setExamplesOpen(true)}
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
          background: editorBg ? resolveColor(editorBg) : DEFAULT_EDITOR_BG,
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
          crop={crop}
          showCrop={tool === "crop"}
          showNoPrint={showNoPrint}
        />

        {tool === "select" ? (
          <SelectionPalette
            onShiftUp={onShiftUp}
            onShiftDown={onShiftDown}
            onRotate={onRotateSelection}
            onFlip={onFlipSelection}
            onFlipHorizontal={onFlipHorizontal}
            onPaletteShift={onPaletteShift}
            onMoveToLayer={() => setNameSplitLayerOpen(true)}
            canMoveToLayer={layers.length < MAX_LAYERS}
            hasSelection={selectedHexes.length > 0}
            onPointerEnter={() => setHoveredTri(null)}
            gridOrientation={gridOrientation}
          />
        ) : tool === "pattern" ? (
          <PatternPalette
            presets={patternPresets}
            activePresetId={activePresetId}
            quantizeTargets={quantizeTargets}
            onSelect={onSelectPattern}
            onCapture={onCapturePattern}
            onDelete={onDeletePattern}
            onPointerEnter={() => setHoveredTri(null)}
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
        ) : isHatchLayer ? (
          /* Same swatch row, pointed at the hatch brush. The brush takes its
             colour from here, so there is only ever one colour control. */
          <ColorPalette
            color={hatchHex}
            palette={hatchPalette}
            palettes={computedPalettes}
            onColorChange={(c) => {
              const idx = hatchPalette.indexOf(c);
              if (idx >= 0)
                setHatchBrush({ color: encodeColor(hatchPaletteIdx, idx) });
            }}
            onPaletteChange={(colors, idx) => {
              setActivePaletteIdx(idx);
              setHatchBrush({ color: encodeColor(idx, hatchColorIdx) });
            }}
            onPointerEnter={() => setHoveredTri(null)}
            hueOffset={hueOffset}
            onHueOffsetChange={setHueOffset}
            saturationOffset={satOffset}
            onSaturationOffsetChange={setSatOffset}
            raised
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
              setNoPrintPen(false);
              changeTool("paint");
            }}
            onPointerEnter={() => setHoveredTri(null)}
            onNoPrintSelect={() => {
              setNoPrintPen(true);
              changeTool("paint");
            }}
            noPrintActive={noPrintPen}
            hueOffset={hueOffset}
            onHueOffsetChange={setHueOffset}
            saturationOffset={satOffset}
            onSaturationOffsetChange={setSatOffset}
          />
        )}
        {/* The panel slot. Every branch below is keyed on `panel`, so exactly
            one drawer can be on screen and no pair of them can collide. */}
        {panel === "pattern" && (
          <PatternPanel
            layers={patternLayers}
            onLayersChange={setPatternLayers}
            activeIdx={activePatternIdx}
            onActiveIdxChange={setActivePatternIdx}
            quantizeTargets={quantizeTargets}
            palettes={computedPalettes}
            paletteIdx={patternPaletteIdx}
            onPaletteIdxChange={setPatternPaletteIdx}
            onClose={() => showPanel(null)}
            onPointerEnter={() => setHoveredTri(null)}
          />
        )}
        {/* Keyed on the layer's kind, not the tool: erase and pan are legal on
            a hatch layer, and the bar shouldn't flicker away when reached for. */}
        {isHatchLayer && (
          <HatchBar
            brush={hatchBrush}
            onBrushChange={setHatchBrush}
            onPointerEnter={() => setHoveredTri(null)}
            tool={tool}
            hasSelection={selectedHexes.length > 0 && gridDivisions > 0}
            onConvert={() => setHatchifyOpen(true)}
          />
        )}
        {panel === "export" && (
          <ExportPanel
            layers={visibleLayers}
            crop={crop}
            onCropChange={setCrop}
            gridRotation={gridRotation}
            projectName={projectName}
            palettes={computedPalettes}
            settings={exportSettings}
            onSettingsChange={updateExportSettings}
            onClose={() => showPanel(null)}
            onPointerEnter={() => setHoveredTri(null)}
          />
        )}
        {panel === "layers" && (
          <LayerPanel
            layers={layers}
            activeLayerIdx={activeLayerIdx}
            onSelectLayer={setActiveLayerIdx}
            onAddLayer={addLayer}
            onDeleteLayer={deleteLayer}
            onDuplicateLayer={duplicateLayer}
            onRenameLayer={renameLayer}
            onToggleVisibility={toggleLayerVisibility}
            onSetLayerEffects={setLayerEffects}
            onMoveLayer={moveLayer}
            onCommit={onCommit}
            onClose={() => showPanel(null)}
            onPointerEnter={() => setHoveredTri(null)}
            palettes={computedPalettes}
          />
        )}
        {panel === "grid" && (
          <GridSettingsPanel
            gridDivisions={gridDivisions}
            onGridDivisionsChange={setGridDivisions}
            hexMode={hexMode}
            onHexModeChange={setHexMode}
            gridOrientation={gridOrientation}
            onGridOrientationChange={setGridOrientation}
            onSpreadHexArtwork={onSpreadHexArtwork}
            showNoPrint={showNoPrint}
            onShowNoPrintChange={setShowNoPrint}
            editorBg={editorBg}
            onEditorBgChange={setEditorBg}
            palettes={computedPalettes}
            onClose={() => showPanel(null)}
            onPointerEnter={() => setHoveredTri(null)}
          />
        )}
      </div>

      <Footer
        gridDivisions={gridDivisions}
        hexMode={hexMode}
        handleUndo={onUndo}
        handleRedo={onRedo}
        historyIdx={historyIdx}
        historyLength={history.length}
        tool={tool}
        captureMode={captureMode}
        cloneSourceSet={cloneSource !== null}
        tooltip={tooltip}
        hasSelection={selectedHexes.length > 0}
        panel={panel}
        onTogglePanel={togglePanel}
      />

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        layers={visibleLayers}
        projectName={projectName}
        settings={svgExport}
        onSettingsChange={updateSvgExport}
        noisePeriod={noisePeriod}
        gridRotation={gridRotation}
        selection={selectedHexes}
      />

      {/* The whole stack, not `visibleLayers`: this writes a project file, and
          a hidden layer is part of the project even though the thumbnail
          skips it. */}
      {saveSelectionOpen && (
        <SaveSelectionDialog
          onOpenChange={setSaveSelectionOpen}
          onSave={handleSaveSelection}
          layers={layers}
          selection={selectedHexes}
          stampCount={selections.length}
          projectName={projectName}
        />
      )}

      {/* The name is collected before the edit runs, so the split lands in the
          undo stack as one entry already carrying it — renaming afterwards
          would be a second entry to undo. */}
      {nameSplitLayerOpen && (
        <NameLayerDialog
          title="Move selection to a new layer"
          description={`Lifts what the selection covers off “${layers[activeLayerIdx]?.name ?? "this layer"}” onto a new layer directly above it.`}
          suggestion={`${layers[activeLayerIdx]?.name ?? "Layer"} selection`}
          confirmLabel="Move"
          onCancel={() => setNameSplitLayerOpen(false)}
          onConfirm={(name) => {
            onMoveSelectionToLayer(name);
            setNameSplitLayerOpen(false);
          }}
        />
      )}

      {/* 3D and cutting consume solid regions, so they take the fill-only
          flatten — hatch has no meaning as an extruded body or a cut path. */}
      <Export3DDialog
        open={export3DOpen}
        onOpenChange={setExport3DOpen}
        painted={mergedFillPainted}
        roundFraction={mergedFillRoundFraction}
        projectName={projectName}
        gridRotation={gridRotation}
      />

      <CutExportDialog
        open={exportCutOpen}
        onOpenChange={setExportCutOpen}
        painted={mergedFillPainted}
        roundFraction={mergedFillRoundFraction}
        projectName={projectName}
        gridRotation={gridRotation}
      />

      {/* No `roundFraction`: an interlocking cut deliberately does not honour
          corner rounding — every segment is a cut line shared between two
          pieces, convex to one and concave to the other. */}
      <InterlockDialog
        open={exportInterlockOpen}
        onOpenChange={setExportInterlockOpen}
        painted={mergedFillPainted}
        projectName={projectName}
        gridRotation={gridRotation}
      />

      <AlertDialog
        open={examplesOpen}
        onOpenChange={(open) => !open && setExamplesOpen(false)}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Load an example</AlertDialogTitle>
            <AlertDialogDescription>
              Opens a finished piece you can pick apart or paint over. Your
              current work is replaced, but undo brings it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ExampleGallery
            onPick={handlePickExample}
            loadingFile={loadingExample}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={importError !== null}
        onOpenChange={(open) => !open && setImportError(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Couldn&apos;t load that file</AlertDialogTitle>
            <AlertDialogDescription>{importError}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setImportError(null)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Draws every visible layer, hatch included — but the stencil cut takes
          its regions from the fills alone, since hatch is line work over the
          colour and bounds nothing of its own. */}
      <ApparelDialog
        open={apparelOpen}
        onOpenChange={setApparelOpen}
        layers={visibleLayers}
        fills={mergedFillPainted}
        gridRotation={gridRotation}
        projectName={projectName}
        palettes={computedPalettes}
        settings={apparelSettings}
        onSettingsChange={setApparelSettings}
        noisePeriod={noisePeriod}
      />

      <PlotterDialog
        open={plotterOpen}
        onOpenChange={setPlotterOpen}
        layers={visibleLayers}
        gridRotation={gridRotation}
        gridDivisions={gridDivisions}
        projectName={projectName}
        settings={plotterSettings}
        onSettingsChange={setPlotterSettings}
        selection={selectedHexes}
      />

      <HatchifyDialog
        open={hatchifyOpen}
        onClose={() => setHatchifyOpen(false)}
        onApply={applyHatchify}
        settings={hatchifySettings}
        onSettingsChange={setHatchifySettings}
        source={hatchifySource}
        hexes={selectedHexes}
        gridDivisions={gridDivisions}
        palettes={computedPalettes}
      />

      <SplashDialog
        open={onboarding.splashOpen}
        onClose={onboarding.closeSplash}
        onStartTour={onboarding.startTour}
        onPickExample={handlePickExample}
        loadingExample={loadingExample}
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
