# **App Name**: SymmetriaGrid

## Core Features:

- Symmetry-Enforced Drawing: Allow users to color triangles by click or drag, automatically applying 3-fold rotational symmetry across the grid using a computational tool to ensure precise pattern generation.
- Grayscale Color Palette: Select one of 5 predefined grayscale swatches to color the grid, with a clear visual indicator for the active selection.
- Undo/Redo History: Manage grid modifications with full undo and redo functionality, preserving interaction history with intuitive button controls.
- Grid Reset: A 'Clear' button to instantly reset the entire grid to its initial blank state.
- JSON State I/O: Import and export the grid's current state as a JSON array through dedicated buttons and a flexible textarea interface.
- Dark Mode Toggle: Switch between a light and dark theme to reduce eye strain during extended design sessions.

## Style Guidelines:

- Primary UI elements and interactive components use a medium slate blue (#396FAD) for technical precision.
- Light mode background: Very light bluish-gray (#ECF1F6). Dark mode background: Deep charcoal (#121212) with navy accents (#1B263B).
- Accent color: Energetic violet (#613ED2) used for active selections and key calls-to-action.
- Drawing palette: Strictly limited to 5 distinct shades of grayscale ranging from pure white/light gray to deep black.
- Consistent use of 'Inter' sans-serif font for all labels and data displays to ensure high legibility.
- Minimalist and geometric vector icons for toolbar actions to maintain a structured aesthetic.
- Large, unobstructed central drawing area with a persistent, logically grouped sidebar or top toolbar.
- Subtle transitions for theme switching and visual feedback when coloring triangles or interacting with the history stack.