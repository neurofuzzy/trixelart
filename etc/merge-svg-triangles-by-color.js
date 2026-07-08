/**
 * Merge same-colored triangles in an SVG (from a triangular-mesh generator)
 * into a single <path> per color, using edge-cancellation.
 *
 * Why this works without a full polygon-boolean-union library:
 * In a triangulated mesh, every interior edge is shared by exactly two
 * triangles. If both triangles are the same fill color, that edge is
 * interior to the merged region and can be dropped. If they differ (or
 * the edge is on the mesh's outer boundary), the edge belongs to the
 * merged region's outline. Because your triangles all wind the same way
 * (e.g. clockwise), the surviving boundary edges, kept in their original
 * direction, automatically trace outer contours one way and hole
 * contours the opposite way -- so SVG's default nonzero fill-rule
 * renders holes correctly with no extra winding logic.
 */

const PRECISION = 3; // decimal places for snapping coordinates into a shared key

function keyOf(x, y) {
  return `${x.toFixed(PRECISION)},${y.toFixed(PRECISION)}`;
}

/**
 * @param {Array<{points: [number, number][], fill: string}>} triangles
 * @returns {Array<{fill: string, d: string}>} one path spec per color
 */
function mergeTrianglesByColor(triangles) {
  const byColor = new Map();
  for (const tri of triangles) {
    if (!byColor.has(tri.fill)) byColor.set(tri.fill, []);
    byColor.get(tri.fill).push(tri.points);
  }

  const results = [];

  for (const [fill, polys] of byColor) {
    // edgeCount[undirectedKey] = { count, dir } where dir stores one
    // directed occurrence (a->b) so we know which way to walk it later.
    const edgeCount = new Map();

    for (const points of polys) {
      const n = points.length;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % n];
        const ka = keyOf(ax, ay);
        const kb = keyOf(bx, by);
        const undirected = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;

        if (!edgeCount.has(undirected)) {
          edgeCount.set(undirected, { count: 0, a: [ax, ay], b: [bx, by], ka, kb });
        }
        edgeCount.get(undirected).count++;
      }
    }

    // Keep only edges seen exactly once in this color group (boundary edges).
    // Build a directed adjacency map: from point-key -> [{to, toPoint}]
    const next = new Map();
    for (const e of edgeCount.values()) {
      if (e.count !== 1) continue; // interior edge shared by two same-color triangles -> cancel
      if (!next.has(e.ka)) next.set(e.ka, []);
      next.get(e.ka).push({ toKey: e.kb, toPoint: e.b, fromPoint: e.a });
    }

    // Trace closed loops out of the surviving directed edges.
    const used = new Set(); // "fromKey>toKey" strings
    const loops = [];

    for (const [startKey, edges] of next) {
      for (const startEdge of edges) {
        const edgeId = `${startKey}>${startEdge.toKey}`;
        if (used.has(edgeId)) continue;

        const loop = [startEdge.fromPoint];
        let curKey = startKey;
        let curEdge = startEdge;

        while (true) {
          used.add(`${curKey}>${curEdge.toKey}`);
          loop.push(curEdge.toPoint);
          if (curEdge.toKey === startKey) break; // closed the loop

          const candidates = next.get(curEdge.toKey) || [];
          const found = candidates.find(
            c => !used.has(`${curEdge.toKey}>${c.toKey}`)
          );
          if (!found) break; // dangling edge (shouldn't happen in a clean mesh); bail out
          curKey = curEdge.toKey;
          curEdge = found;
        }

        if (loop.length > 3) loops.push(loop);
      }
    }

    if (loops.length === 0) continue;

    const d = loops
      .map(loop => {
        const [first, ...rest] = loop;
        return `M${first[0]},${first[1]} ` + rest.map(p => `L${p[0]},${p[1]}`).join(' ') + ' Z';
      })
      .join(' ');

    results.push({ fill, d });
  }

  return results;
}

/**
 * Parses <polygon points="..." fill="..."/> elements out of a raw SVG string.
 */
function parseSvgTriangles(svgText) {
  const triangles = [];
  const re = /<polygon\s+points="([^"]+)"\s+fill="([^"]+)"\s*\/?>/g;
  let m;
  while ((m = re.exec(svgText))) {
    const points = m[1]
      .trim()
      .split(/\s+/)
      .map(pair => pair.split(',').map(Number));
    triangles.push({ points, fill: m[2] });
  }
  return triangles;
}

/**
 * End-to-end: raw SVG string of triangles -> raw SVG string of merged paths.
 */
function mergeSvgByColor(svgText) {
  const triangles = parseSvgTriangles(svgText);
  const merged = mergeTrianglesByColor(triangles);

  const headerMatch = svgText.match(/<svg[^>]*>/);
  const header = headerMatch ? headerMatch[0] : '<svg xmlns="http://www.w3.org/2000/svg">';

  const body = merged
    .map(({ fill, d }) => `  <path d="${d}" fill="${fill}"/>`)
    .join('\n');

  return `${header}\n${body}\n</svg>`;
}

module.exports = { mergeTrianglesByColor, parseSvgTriangles, mergeSvgByColor };
