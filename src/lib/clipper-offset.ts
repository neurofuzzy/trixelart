import type * as ClipperNS from "clipper-lib";
import type { Seg } from "@/lib/hatch";

/**
 * Polygon offsetting and line clipping, and the one place the Clipper
 * dependency lives.
 *
 * The plotter needs two things a lattice cannot give it once corner rounding is
 * on. **Insetting** a region's boundary, for the contour fill: that is not the
 * local operation it looks like, because as a shape shrinks it splits into
 * several, holes merge into it, thin waists pinch off and whole regions vanish,
 * and every one of those is a global self-intersection question. And
 * **clipping a straight hatch line to a region**, which stops being a
 * clip-to-triangle the moment the boundary is an arc rather than a lattice edge.
 *
 * **Loaded on demand.** `clipper-lib` is a single ~200 KB script and the plotter
 * is one dialog behind a hamburger menu, so it is pulled in with `import()` the
 * first time a plot that needs it is built, and never enters the main bundle.
 * That is why `buildPlotterPlot` is async: the alternative was a module-level
 * mutable loaded by one component and read by another, which is exactly the
 * ordering hazard `setPaletteOffsets` documents.
 *
 * Pure: no DOM, no React.
 */

/** A closed ring, world units, **without** a repeated final point. */
export type PlotPoly = [number, number][];

/**
 * Clipper integer units per world unit. Clipper 6 is an integer library, so
 * every coordinate is scaled on the way in and back on the way out.
 *
 * 1000 matches `fmt`'s three decimals in `svg-export.ts`: the export already
 * declines to write anything finer, so this can lose nothing that would have
 * reached the file. A world unit plots at roughly 1/50 inch, making this a
 * resolution of about 20 nm on paper.
 */
export const CLIPPER_SCALE = 1000;

/**
 * Chord tolerance wherever a curve is approximated, world units — used both for
 * flattening the rounded rings and for Clipper's own round joins, so the two
 * cannot disagree about how fine a curve is.
 *
 * 0.05 world units is ~24 µm on a typical page against a 300 µm nib: an order
 * of magnitude below the thinnest line the machine can draw.
 */
export const PLOT_SAGITTA = 0.05;

export interface ClipperApi {
  /** Inset (negative delta) or outset (positive) a set of rings, world units.
   *  Empty when the shape has been consumed. */
  offset(rings: PlotPoly[], delta: number): PlotPoly[];
  /** The parts of each segment that fall inside the region the rings bound. */
  clipLines(segs: Seg[], rings: PlotPoly[]): Seg[];
}

let pending: Promise<ClipperApi> | null = null;

/**
 * The Clipper-backed geometry, loading the library on first use and caching it.
 *
 * Concurrent callers share the one in-flight promise rather than racing two
 * `import()`s — the dialog rebuilds its plot on every settings change, so the
 * first few overlap as a matter of course.
 */
export function loadClipper(): Promise<ClipperApi> {
  if (!pending) {
    pending = import("clipper-lib").then((mod) => {
      // `clipper-lib` is CommonJS (`module.exports = ClipperLib`). Webpack
      // re-exports its properties as named bindings, Node's ESM loader does
      // not, so neither form can be relied on by itself.
      const C = ((mod as unknown as { default?: typeof ClipperNS }).default ??
        mod) as typeof ClipperNS;
      return makeApi(C);
    });
  }
  return pending;
}

function makeApi(C: typeof ClipperNS): ClipperApi {
  const toPath = (ring: PlotPoly): ClipperNS.Path =>
    ring.map(([x, y]) => ({
      X: Math.round(x * CLIPPER_SCALE),
      Y: Math.round(y * CLIPPER_SCALE),
    }));

  return {
    offset(rings, delta) {
      if (rings.length === 0 || !Number.isFinite(delta)) return [];

      const co = new C.ClipperOffset(2, PLOT_SAGITTA * CLIPPER_SCALE);
      let added = false;
      for (const ring of rings) {
        if (ring.length < 3) continue;
        co.AddPath(toPath(ring), C.JoinType.jtRound, C.EndType.etClosedPolygon);
        added = true;
      }
      if (!added) return [];

      // Orientation is left to Clipper. `FixOrientations` locates the path
      // holding the lowest point — necessarily an outer boundary, never a hole
      // — and flips the whole set if it is wound the wrong way, so a negative
      // delta shrinks the solid and grows the holes whichever way
      // `regionRings` happened to wind them.
      const solution: ClipperNS.Paths = [];
      co.Execute(solution, delta * CLIPPER_SCALE);

      // Round joins emit a great many nearly-collinear vertices. Cleaning drops
      // those, and the duplicate points a pinch-off leaves behind, at a
      // threshold of ~1.4 thousandths of a world unit — pure win for a format
      // whose coordinates carry three decimals anyway.
      const cleaned = C.Clipper.CleanPolygons(solution);

      const out: PlotPoly[] = [];
      for (const path of cleaned) {
        if (path.length < 3) continue;
        out.push(
          path.map(
            (p) =>
              [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE] as [number, number],
          ),
        );
      }
      return out;
    },

    clipLines(segs, rings) {
      if (segs.length === 0 || rings.length === 0) return [];

      const clipper = new C.Clipper();
      let hasClip = false;
      for (const ring of rings) {
        if (ring.length < 3) continue;
        clipper.AddPath(toPath(ring), C.PolyType.ptClip, true);
        hasClip = true;
      }
      if (!hasClip) return [];

      for (const [x0, y0, x1, y1] of segs) {
        clipper.AddPath(
          [
            { X: Math.round(x0 * CLIPPER_SCALE), Y: Math.round(y0 * CLIPPER_SCALE) },
            { X: Math.round(x1 * CLIPPER_SCALE), Y: Math.round(y1 * CLIPPER_SCALE) },
          ],
          C.PolyType.ptSubject,
          false,
        );
      }

      const tree = new C.PolyTree();
      clipper.Execute(
        C.ClipType.ctIntersection,
        tree,
        C.PolyFillType.pftNonZero,
        C.PolyFillType.pftNonZero,
      );

      // A line lying exactly *on* the clip boundary is dropped rather than kept,
      // which is what we want and is why this path needs no outline mask: the
      // grid-aligned hatch sits on the lattice, an outline is already drawing
      // every boundary stretch of it, and Clipper removes precisely those spans.
      const out: Seg[] = [];
      for (const path of C.Clipper.OpenPathsFromPolyTree(tree)) {
        // Every point is collinear by construction, but they are emitted as a
        // polyline; consecutive pairs are re-joined by `joinRuns` downstream,
        // so there is nothing to be gained by collapsing them here.
        for (let i = 1; i < path.length; i++) {
          out.push([
            path[i - 1].X / CLIPPER_SCALE,
            path[i - 1].Y / CLIPPER_SCALE,
            path[i].X / CLIPPER_SCALE,
            path[i].Y / CLIPPER_SCALE,
          ]);
        }
      }
      return out;
    },
  };
}
