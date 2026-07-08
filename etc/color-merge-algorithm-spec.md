# Spec: Merging Same-Color Triangles in a Triangulated SVG Mesh

## 1. Problem Statement

**Input:** A flat list of triangles, each defined by 3 vertices and a fill color, forming a conforming triangulation (adjacent triangles share full edges — no T-junctions).

**Output:** For each distinct color, a single SVG `<path>` whose filled area is exactly the union of all triangles of that color, correctly rendering holes and disjoint regions.

**Non-goals:** This spec does not handle triangulations with T-junctions (a vertex lying mid-edge of a neighboring triangle), overlapping triangles, or non-conforming meshes. See §7 for how to detect these cases.

## 2. Key Assumptions

1. **Conforming mesh.** Any two triangles that touch either share a full edge, share a single vertex, or don't touch at all. No partial edge overlaps.
2. **Consistent winding.** All triangles are wound in the same rotational direction (all clockwise or all counter-clockwise) in the source coordinate system.
3. **Exact or near-exact shared vertices.** Adjacent triangles' shared edge endpoints are numerically identical (or identical within a fixed tolerance after rounding).

Given these, the algorithm below is exact and requires no polygon-clipping, no intersection math, and no explicit hole detection.

## 3. Core Principle: Edge Cancellation

In a conforming triangulation, every edge belongs to at most two triangles.

- If both triangles sharing an edge have the **same color**, that edge is interior to the merged region for that color and contributes nothing to its outline.
- If the two triangles have **different colors**, or the edge belongs to only one triangle (a mesh boundary edge), that edge **is** part of the outline for that color.

Collecting the surviving edges per color and stitching them into closed loops yields the exact boundary of that color's merged region — including outer contours, holes, and disconnected islands — with no separate hole-detection step, because:

> Consistent winding is preserved through the whole pipeline. An outer contour, traced in the triangles' original winding direction, comes out one way; a hole boundary — being the shared edge-loop between a region and internally-nested opposite-colored triangles — comes out reversed automatically. Rendering with `fill-rule: nonzero` (SVG's default) reproduces the correct filled/unfilled areas without additional logic.

## 4. Algorithm

### 4.1 Inputs
```
triangles: Array<{
  points: [ [x1,y1], [x2,y2], [x3,y3] ],  // in winding order
  fill:   string                           // color, e.g. "#5f1116"
}>
```

### 4.2 Steps

**Step 1 — Group by color.**
Partition `triangles` into buckets keyed by `fill`.

**Step 2 — Per color, count edge occurrences.**
For each triangle in the bucket, for each of its 3 directed edges `(a → b)`:
- Compute a canonical *undirected* key from the (rounded) endpoint coordinates, e.g. `min(ka,kb) + "|" + max(ka,kb)`.
- Increment a counter for that key.
- Record one representative directed occurrence `(a → b)` (any one; if the edge is a true boundary edge for this color, it will only occur once, so there's no ambiguity).

**Step 3 — Filter to boundary edges.**
Keep only edges whose count within this color bucket is exactly `1`. These are the color's outline edges. (Count `2` means both adjacent triangles share the color → interior → discard. Count `>2` indicates a non-conforming mesh — see §7.)

**Step 4 — Build a successor map.**
From the surviving directed edges, build `next[startKey] → [{endKey, endPoint, startPoint}, ...]`.

**Step 5 — Trace closed loops.**
While unvisited directed boundary edges remain:
1. Pick one as the loop's start.
2. Repeatedly follow `next[currentEndKey]` to an edge not yet visited, appending each endpoint, until the loop returns to its start key.
3. Mark all traversed directed edges as visited.
4. Emit the loop (an ordered list of points) if it has more than 2 vertices.

Each loop is either an outer contour or a hole; no explicit classification is needed (see §3).

**Step 6 — Emit SVG.**
For each color, join all its loops into a single `<path>`:
```
<path d="M x0,y0 L x1,y1 ... Z  M x0',y0' L x1',y1' ... Z  ..." fill="COLOR"/>
```
Default `fill-rule="nonzero"` is sufficient given assumption 2.

### 4.3 Complexity
- Time: `O(T)` where `T` = total triangle count (each triangle contributes 3 edges; each edge visited O(1) times during counting and O(1) times during tracing).
- Space: `O(T)`.

## 5. Pseudocode

```
function mergeByColor(triangles):
    buckets = groupBy(triangles, t => t.fill)
    output = []

    for (color, tris) in buckets:
        edgeCount = {}       # undirectedKey -> count
        edgeDir   = {}       # undirectedKey -> {from, to}

        for tri in tris:
            for (a, b) in edgesOf(tri.points):   # 3 directed edges, wrap-around
                uk = undirectedKey(a, b)
                edgeCount[uk] = (edgeCount[uk] or 0) + 1
                edgeDir[uk] = {from: a, to: b}    # last write wins; fine, see Step 3

        next = {}   # pointKey -> list of {toKey, toPoint, fromPoint}
        for uk in edgeDir:
            if edgeCount[uk] != 1: continue
            e = edgeDir[uk]
            next[key(e.from)] ||= []
            next[key(e.from)].append({toKey: key(e.to), toPoint: e.to, fromPoint: e.from})

        loops = []
        visited = set()
        for (startKey, edges) in next:
            for startEdge in edges:
                id = startKey + ">" + startEdge.toKey
                if id in visited: continue

                loop = [startEdge.fromPoint]
                curKey, curEdge = startKey, startEdge
                loop_ok = true
                while true:
                    visited.add(curKey + ">" + curEdge.toKey)
                    loop.append(curEdge.toPoint)
                    if curEdge.toKey == startKey: break
                    candidates = next[curEdge.toKey] or []
                    found = first candidate c in candidates where
                            (curEdge.toKey + ">" + c.toKey) not in visited
                    if found == null:
                        loop_ok = false   # dangling edge; mesh defect
                        break
                    curKey, curEdge = curEdge.toKey, found

                if loop_ok and loop.length > 3:
                    loops.append(loop)

        if loops.length > 0:
            output.append({fill: color, d: loopsToPathData(loops)})

    return output
```

## 6. Correctness Argument (sketch)

- **Every kept edge borders exactly one triangle of the target color and either the "outside" of the mesh or a triangle of a different color.** By construction (count == 1 within the color bucket), this is exactly the definition of a boundary edge of that color's union region.
- **Closure:** each vertex on the boundary of a color's region has exactly one incoming and one outgoing surviving directed edge in that region's local orientation (a consequence of the mesh being conforming and 2-manifold), so the successor map decomposes into disjoint simple cycles — no branching, no ambiguity in traversal.
- **Winding consistency ⇒ correct fill:** since all source triangles wind the same way, any surviving edge keeps that same directional sense. A loop enclosing filled area net-clockwise (say) contributes +1 to the nonzero winding count inside it; a loop enclosing a hole — traced net-counterclockwise because it's the reversed shared boundary with the interior different-colored region — contributes −1, correctly punching out the hole under `fill-rule="nonzero"`.

## 7. Failure Modes & Detection

| Symptom | Cause | Handling |
|---|---|---|
| Loop trace hits a vertex with no unvisited outgoing edge (`found == null`) | Non-conforming mesh (T-junction) or duplicate/degenerate triangle | Log and skip the loop, or fall back to a general polygon-union library for that color |
| An undirected edge key has count > 2 | More than two triangles claim the same edge — duplicate geometry or export bug | Flag as a data error before merging |
| Loop has only 2 distinct points | Degenerate/zero-area triangle in source data | Filter out before Step 2, or ignore loops with `length <= 3` (already handled in Step 5) |
| Visually adjacent triangles don't cancel | Coordinate rounding precision too tight/loose relative to source generator's float drift | Tune the rounding precision in the coordinate key, or snap coordinates once at mesh-generation time |

## 8. Extensions

- **Tolerance-based matching:** replace exact-after-rounding coordinate keys with a spatial hash + epsilon match if the source mesh has float drift larger than a fixed decimal-place rounding can absorb.
- **Non-conforming meshes:** if T-junctions or overlaps are possible, this algorithm no longer applies as-is; use a general polygon-boolean-union library (e.g. Martinez, Clipper) per color instead, at higher computational cost.
- **Path simplification:** consecutive collinear points along a merged boundary (very common — many small triangle edges lying on one straight line) can be collapsed post-hoc to shrink `d` string size further.
