/**
 * Human-readable keyboard-shortcut reference for the Help dialog.
 *
 * This is a hand-maintained MIRROR of the real bindings — keep it in sync with
 * `src/hooks/use-keyboard-shortcuts.ts`. When you add or change a binding there,
 * update this list too.
 */

export type Shortcut = { keys: string[]; label: string };
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

/** The Cmd/Ctrl modifier, shown per-platform in the Help dialog. */
export const modKey = (): string =>
  typeof navigator !== "undefined" &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

export function shortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      title: "Tools",
      shortcuts: [
        { keys: ["P"], label: "Paint" },
        { keys: ["E"], label: "Erase" },
        { keys: ["D"], label: "Dodge" },
        { keys: ["B"], label: "Burn" },
        { keys: ["T"], label: "Stamp" },
        { keys: ["C"], label: "Clone" },
        { keys: ["I"], label: "Eyedropper" },
        { keys: ["H"], label: "Move" },
        { keys: ["S"], label: "Select" },
      ],
    },
    {
      title: "Color",
      shortcuts: [
        { keys: ["1", "–", "9"], label: "Pick color + Paint" },
        { keys: ["Right-click"], label: "Eyedropper (pick color)" },
      ],
    },
    {
      title: "History & project",
      shortcuts: [
        { keys: [mod, "Z"], label: "Undo" },
        { keys: [mod, "Shift", "Z"], label: "Redo" },
        { keys: [mod, "S"], label: "Save project" },
        { keys: [mod, "O"], label: "Load project" },
      ],
    },
    {
      title: "Selection",
      shortcuts: [
        { keys: ["R"], label: "Rotate 60° clockwise" },
        { keys: ["Shift", "R"], label: "Rotate 60° counter-clockwise" },
        { keys: ["↑"], label: "Shift colors lighter" },
        { keys: ["↓"], label: "Shift colors darker" },
        { keys: ["←"], label: "Shift palettes backward" },
        { keys: ["→"], label: "Shift palettes forward" },
        { keys: ["Delete"], label: "Erase selected hex" },
        { keys: ["Esc"], label: "Clear selection" },
      ],
    },
    {
      title: "General",
      shortcuts: [
        { keys: ["Shift", "Drag"], label: "Draw a straight line" },
        { keys: ["Scroll"], label: "Zoom in / out" },
        { keys: ["?"], label: "Open this shortcuts help" },
      ],
    },
  ];
}
