# AGENTS.md

## Quick start

```bash
npm run dev      # next dev --turbopack -p 9002
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

Validate order: `typecheck` → `lint`. `npm run build` ignores TS/ESLint errors (`next.config.ts`) so is not a reliable correctness gate.

No tests configured.

** DO NOT COMMIT CHANGES TO GIT! USER WILL DO SO MANUALLY **

## Architecture

- **Next.js 15** App Router, React 19, TypeScript, Tailwind CSS v3, shadcn/ui (button, alert-dialog)
- Single-page triangular grid drawing tool. Entrypoint: `src/app/page.tsx` → `src/components/TrixelGrid.tsx`
- Path alias `@/*` → `./src/*` (tsconfig paths)
- Dark mode only (`<html className="dark">`). Theme via CSS variables in `src/app/globals.css`
- State: React `useState` (no external state lib). Persisted to `localStorage` key `symmetria-save`
- Undo/redo: manual history stack capped at 50 entries
- Grayscale palette (5 colors), 3 tools: paint / erase / pan. Keyboard shortcuts: `P` paint, `E` erase, `1`-`5` select color, `Ctrl+Z` undo, `Ctrl+Shift+Z` redo
- Symmetry function panel uses `new Function()` to eval user formulas against `a,b,c` coordinates

## Key modules

| Module | Purpose |
|---|---|
| `src/lib/grid-math.ts` | Triangular grid coordinate system (`SIDE=50`, `H`, `worldToTri`, `getTriPath`, `getTriABC`) |
| `src/hooks/use-canvas-size.ts` | Container measurement via `ResizeObserver` |
| `src/lib/utils.ts` | `cn()` — clsx + tailwind-merge |

## Grid coordinate system

- Axial `(q, r)` with triangle type (`up`/`down`) identifies each triangle
- Analytical `(a, b, c)` for symmetry formulas: up triangles satisfy `a+b+c=0`, down satisfy `a+b+c=-1`
- SVG paths rendered via `getTriPath(q, r, type)`

## Notable

- Firebase App Hosting (`apphosting.yaml`). `.genkit/` and `.env*` in gitignore; no `.env.example`
- Genkit skill installed in `.agents/skills/developing-genkit-js/`
- Remote image patterns configured for `placehold.co`, `images.unsplash.com`, `picsum.photos`
