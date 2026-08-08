/** Preferred side to float a tour callout relative to its highlighted target.
 * `InterfaceTour` falls back to an on-screen position when the preferred side
 * would overflow the viewport. */
export type TourPlacement = "top" | "bottom" | "left" | "right";

export type TourStep = {
  /** The `data-tour="…"` value of the element this step spotlights. */
  target: string;
  title: string;
  body: string;
  placement: TourPlacement;
};

/**
 * The ordered spotlight interface tour. Each step names a `data-tour` anchor
 * placed on a real UI element (see the `data-tour` attributes across
 * components/) — `InterfaceTour` reads the live bounding rect at runtime, so
 * this stays layout-agnostic. Keep the order flowing naturally around the app.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    target: "canvas",
    title: "The canvas",
    body: "This is your drawing surface — a triangular grid. Click or drag to paint triangles. Scroll to zoom, and right-drag to pan around.",
    placement: "top",
  },
  {
    target: "tools",
    title: "Drawing tools",
    body: "Paint, erase, dodge, burn, stamp, clone, eyedropper, and move live here. Each has a single-key shortcut — hover to see it, or press the letter.",
    placement: "bottom",
  },
  {
    target: "effects",
    title: "Brush, symmetry & fan-out",
    body: "Switch to a hex-wedge brush, mirror your strokes with rotational symmetry, or fan a stroke out into a flower of trixels. Select mode lets you grab a whole hex.",
    placement: "bottom",
  },
  {
    target: "palette",
    title: "Colors",
    body: "Pick a paint color here, or press keys 1–9. Right-click a triangle on the canvas to eyedrop its color. Swap whole palettes from the picker.",
    placement: "right",
  },
  {
    target: "grid-settings",
    title: "Grid settings",
    body: "Set the honeycomb origin, flat- or pointy-top orientation, and hex size (N). Honeycomb mode unlocks symmetry, the hex brush, and fan-out.",
    placement: "top",
  },
  {
    target: "layers",
    title: "Layers",
    body: "Stack your artwork across multiple layers — add, hide, reorder, and duplicate them to keep parts of your design independent.",
    placement: "top",
  },
  {
    target: "history",
    title: "Undo & redo",
    body: "Step backward and forward through your edits. Every paint, erase, move, and stamp is undoable with ⌘/Ctrl+Z.",
    placement: "top",
  },
  {
    target: "menu",
    title: "Projects",
    body: "Start a new project, load an example, or save your work as a file. You can also save just the selected hexes as a project of their own.",
    placement: "bottom",
  },
  {
    target: "export-menu",
    title: "Exports",
    body: "Take your art out: an SVG image, a seamless fabric tile, a 3D print, a cutting file, a pen-plotter drawing, or an apparel print.",
    placement: "bottom",
  },
  {
    target: "help",
    title: "Need a hand?",
    body: "Open Help any time for the full list of keyboard shortcuts — or to replay this tour. Press ? to open it instantly.",
    placement: "bottom",
  },
];
