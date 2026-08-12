# Solid merging, face topology and simplification

`src/lib/assembly.ts`

The problem: two boxes joined at a lap have to render, project and export as
**one solid with no seam**. A CSG union gets the surface right and the
tessellation badly wrong — it retriangulates coplanar faces into fragments with
T-junctions, Steiner points and slivers. Those are what shade as phantom
diagonals across a flat face, what confuse edge picking, and what bloat the
exported file.

So the pipeline is: union → weld → **throw the tessellation away and re-cut every
flat face from its own outline**.

```
mergeGroupGeometry(meshes)
  │
  ├─ single mesh → just translate by its offset, done
  │
  ├─ Brush + Evaluator (three-bvh-csg), ADDITION, folded left to right
  ├─ mergeVertices(1e-4)          weld hairline cracks along seams
  └─ simplifySolid(…)             re-cut each face
       ├─ buildTopology           canonical vertices, coplanar regions
       ├─ regionOutlines          outline of each region by cover parity
       ├─ chainLoops              segments → closed rings
       ├─ dropCollinear           rings → real corners
       ├─ ring nesting            which rings are holes
       ├─ partitionIntoRectangles → 2 triangles per rectangle   (the usual case)
       │   └─ or ShapeUtils.triangulateShape (ear clipping)     (chamfers etc.)
       └─ area check              accept, or keep the original triangles
```

## Why exact coincidence, and the weld grid

Everything below is **parity arithmetic on exact coincidence**: an interior edge
only cancels if both triangles report it as *the same* edge, and a point only
lies on an edge if it lies on it exactly. The CSG evaluator misses that — by a
few times 1e-5 mm on a clean butt joint, by a few thousandths where several
coplanar faces meet — and any of it is enough to leave a seam diagonal standing.

So positions are snapped to a grid before any parity work:

```ts
const WELD_GRID = 1e-3;                                  // 1 micron
const snapTo = (v, grid) => Math.round(v / grid) * grid + 0;   // + 0 kills -0
```

The grid is deliberately a **round decimal** one: part sizes come out of the
formula evaluator as ordinary decimal millimetres, and a grid that is not a
decimal fraction would shift every one of them off its true value.

Where the evaluator's error is bigger than the grid, the affected face simply
fails to resolve into a loop and keeps the triangles it came in with. That is the
governing principle of this whole module: **wrong-looking beats wrong.** Every
stage has a bail-out that falls back to the input.

## `buildTopology(geometry, cosThreshold) → Topology`

### 1. Canonical vertices

Snap each position to the grid, key it as a string, and intern it. Two vertices
at the same snapped position become the same id. Degenerate triangles (two ids
equal) are dropped.

### 2. Sliver rejection

```
doubleArea = |ab × ac|
longest    = the longest of the three sides
drop if doubleArea < 1e-12  or  doubleArea / longest < grid
```

`doubleArea / longest` is twice the triangle's height on its longest side, so the
test is "this triangle stands less than one grid step tall". It is **absolute,
not a shape ratio** — vertices are on the grid, so anything shorter than a grid
step cannot be a real face, while a genuinely long thin one (200 mm along a
3.5 mm step) is real, and dropping it would leave its edges unpaired and put the
diagonal straight back.

### 3. T-junction adjacency

A face cut into rectangles meets its neighbour along an edge the neighbour
carries as one longer one — a T-junction — and the two sides then share **no
vertex at all**. Grouping by shared vertices alone would call that two faces and
draw the join as a line across the middle of a flat surface.

So a triangle counts as touching every vertex that lies *on* one of its edges as
well as the three it is built from:

```
for each triangle edge (a, b):
    for each canonical point p not a corner of this triangle:
        reject by AABB (edge box grown by one grid step)
        along = (p − a)·(b − a);  reject unless 0 < along < |b−a|²
        perpendicular distance² = |p−a|² − along²/|b−a|²;  reject if > grid²
        → p is on this edge: record the triangle against p
```

`O(T · P)` with a cheap AABB reject in the inner loop. This is the most
expensive pass in the module and the reason `outlineEdges` is cached.

### 4. Coplanar regions

Union–find with path halving. Two triangles that share a (possibly on-edge)
vertex are merged when

```
a.normal · b.normal > cosThreshold          # default cos 8°
and |a.planeD − b.planeD| < PLANE_EPS       # 1e-3
```

Both conditions are needed: the normal test alone would merge two parallel faces
on opposite sides of a part; the offset test alone would merge a face with its
own backside. `planeD = normal · anyVertex` is the signed plane offset, and
because normals are *oriented*, front and back faces have opposite normals and
never merge.

The 8° threshold (`EDGE_THRESHOLD_DEG`) is loose on purpose. CSG output
retriangulates coplanar faces with slight numeric wobble, and a tight 1° would
show phantom diagonals across flat faces.

## `regionOutlines(topo) → Map<region, Segment[]>`

Recovers the boundary of each coplanar region **by cover parity**, not by
counting shared edges.

```
collect every triangle edge of every triangle, longest first
for each edge:
    bucket ← the first line of this region that BOTH endpoints lie
             within lineTolerance of
             (none yet → start one: origin = a, dir = normalise(b − a))
    t(p) = (p − bucket.origin) · bucket.dir
    push the interval [min(t(a), t(b)), max(…)]

per bucket:
    breaks ← every interval endpoint, sorted, deduped to 4 dp
    for each gap between consecutive breaks:
        cover ← how many intervals contain its midpoint
        odd cover → boundary; even cover → interior
    emit maximal runs of odd cover as segments
```

Why parity works: an interior edge is traversed by exactly two triangles (cover
2, even, cancels). A T-junction — one long edge on one side, two short collinear
ones on the other — sums to cover 2 everywhere along its length and cancels too,
which is precisely what edge-counting cannot do. A true region boundary is
traversed once (cover 1, odd) and survives.

The output is **maximal spans**, not the original pieces: collinear boundary
fragments come back merged. That is what lets the simplifier recover a face's
real corners.

### Why lines are matched, not hashed

Parity only cancels if every edge of one line lands in the *same* bucket. This
used to be a quantised string key (`region | snapped dir | anchor rounded to
0.01`, the anchor being the foot of the perpendicular from the world origin),
and that cannot make the promise: every quantisation has boundaries, and a long
edge and the two halves a T-junction cuts it into fall on opposite sides of one
for two independent reasons.

1. **The rounding boundary.** Three collinear edges of one beam face produced
   anchors of `51.1650000000000205` and `51.1649999999999920` — one ulp apart,
   straddling `×100 → 5116.5`. Two went to key `5117`, one to `5116`.
2. **Snapping breaks collinearity.** The CSG puts a T-junction vertex at
   `(220.9090…, 9.5454…)`; the weld grid moves it to `(220.909, 9.545)`, 4.5e-4
   off the line it is supposed to lie on. Anchoring at the world origin then
   *amplifies* that by the distance to it — 0.011 at 221 mm out, wider than the
   0.01 key cell.

Either way the leftover stretch of the long edge has cover 1, and a diagonal is
drawn across a flat face. Which of them bites depends on where the assembly
happens to sit in space, so the same five blocks joined in four different orders
showed 0, 1, 3 and 8 phantom lines.

Matching by proximity has no boundaries to fall off:

- **Both endpoints must lie on the line**, rather than the directions matching.
  A short fragment can be visibly rotated by the snap; its ends still sit on the
  line. This makes the test independent of edge length.
- **Longest edge first**, so a line's reference comes from the most accurate edge
  available rather than from whichever fragment was seen first.
- **`lineTolerance` is two grid steps.** Lower bound: a snapped point can sit
  half a step off per axis, ~1.4 steps in the plane of the face. Upper bound: two
  genuinely distinct parallel lines 2 µm apart do not occur in a part measured in
  millimetres.
- **`t` runs from the line's own origin**, not from the world origin, so the
  parameters stay small and carry no distance amplification.
- Emitted endpoints are re-snapped to the grid. Reconstructing a point as
  `origin + dir·t` reintroduces exactly the noise the snapping just removed, and
  segments that share a corner must still share it exactly.

The cost is a linear scan of the region's lines per edge instead of a hash
lookup. A face has a handful of distinct lines, so this is not measurable.

## `buildOutlineEdges` / `outlineEdges`

`buildOutlineEdges` flattens the region outlines into a `LineSegments` position
buffer, deduplicating segments that appear in two regions (a crease is a boundary
of both faces that meet at it).

This replaces `THREE.EdgesGeometry`, which assumes a conforming mesh — every
interior edge shared by exactly two triangles. CSG output breaks that assumption
on retriangulated faces and EdgesGeometry then draws phantom diagonals.

`outlineEdges` memoises the result in a `WeakMap` keyed on the geometry object.
The same solid's outline is wanted several times over — drawn, made pickable, and
searched for an edge's parallels — and extraction is the expensive part of a
rebuild. Caching also guarantees every caller sees *identical segment indices*,
which matters because raycast hits are reported as an index into that buffer.

## `simplifySolid(geometry, thresholdDeg) → BufferGeometry`

Purely a retessellation: the surface is unchanged, there are just far fewer
triangles and no interior vertices left to shade as creases.

Per coplanar region:

1. **Record the original area** — this is the acceptance test at the end.
2. `chainLoops(segments)` — walk the outline into closed rings.
   - Adjacency by snapped position. Any node with exactly one neighbour is a
     **dangling end**; the whole dangling chain is pulled out iteratively.
     (Where the evaluator's arithmetic came apart it leaves a stray diagonal
     hanging off a real corner, its far end at a coordinate belonging to
     nothing. A segment with a free end cannot be part of any closed outline.)
   - After pruning, **every node must have exactly two neighbours** — otherwise
     return `null` and keep the original triangles.
   - Walk each unvisited node around its ring. Revisiting a node without closing
     means the outline is not a set of simple rings → `null`.
3. `dropCollinear(loop)` — remove vertices in the middle of a straight run
   (`d1·d2 > 1 − 1e-6`). What survives is the face's real corners.
4. **Plane basis.** `planeBasis(normal)` builds an orthonormal `(u, v, normal)`
   right-handed frame, so a counter-clockwise ring in `(u, v)` faces along
   `+normal`.
5. **Ring nesting.** Which rings bound material and which punch holes is a
   question of *nesting*, not of winding — chaining walks a ring in whichever
   direction the outline happened to hand over, so the sign of its area says
   nothing. Depth is counted by even-odd containment (a majority of a ring's
   points inside another ring ⇒ nested in it). Even depth = outer boundary; odd
   depth = hole. Rings are then re-wound to what `triangulateShape` expects
   (outer CCW, holes CW).
6. **Triangulate.** For each outer ring plus its immediate holes:
   - `partitionIntoRectangles` first — every face a joint between two blocks
     produces is rectilinear, so a plain face comes back as **two** triangles and
     a lap as four, with no interior corners and the same cut every rebuild. See
     [rectangle-partition.md](rectangle-partition.md).
   - otherwise `THREE.ShapeUtils.triangulateShape` (ear clipping) — a chamfer, a
     splayed leg, anything the rectangles cannot describe.
7. **Back to world.** `(u, v, normal)` is orthonormal, so a plane point is its two
   in-plane coordinates plus the plane's offset along the normal. That offset is
   averaged over the face's own corners rather than read off one triangle, so a
   corner that makes the round trip lands back exactly where it started and
   shares its vertex with the faces either side of it. Results are re-snapped to
   the grid.
8. **Area check.** `triangulateShape` gives up on rings it cannot handle and
   returns nothing, and a misread outline comes back the wrong size. If the
   emitted area differs from the original by more than
   `max(originalArea · 1e-4, grid²)`, the face goes back in as it arrived.

Triangle winding is fixed on the way out: `pushTriangle` compares the emitted
cross product against the region normal and swaps two indices if it disagrees.

Vertices are interned by snapped position across the whole solid, so the result
is an indexed geometry with shared corners.

`simplifySolid` is also run on every uploaded STL island (`ComponentEditorPage`),
for the same reason: a modeller's tessellation of a flat face is arbitrary, and
everything downstream is easier if a block starts life as twelve triangles.

## `parallelEdges(edge, geometries) → Edge[]`

Every part is a block, so a measured extent is never carried by one edge on its
own: the four arrises that bound a block along an axis all run between the same
two coordinates and all state the same measurement. Hovering or picking one
therefore means all four.

```
span ← spanOfEdge(edge);  if skew → [edge] alone
scan every outline segment of every group's solid
keep those whose spanKey matches, deduplicated to 3 dp
if nothing matched → [edge]      # a dimension guide, which is not on the solid
```

This only makes visible what the span solver already believes: a measurement is
identified by the span it covers, never by the particular edge it was read off.

The fallback matters for dimension guides — a chain link is a line that only
exists at this zoom, so it finds its parallels on the model and hands over to
them, which is how a measurement always ends up hanging off the part.

## `meshIdForWorldVertex(groupMeshes, v, ε)`

Interaction happens on the *merged* solid, but a connection has to reference a
specific mesh. Scan every original mesh's vertices in that mesh's local frame:
return on the first within `ε` (1e-3), otherwise return whichever mesh had the
nearest vertex. The fallback is needed because the CSG union introduces new seam
vertices that belong to no original mesh.

`O(V)`.

## `splitVisibleHidden(edges, occluders, viewDir, sampleStep, surfaceOffset)`

Blueprint hidden-line pass. For each edge segment, sample along it and cast a ray
from each sample **toward the camera** against every solid; runs of hidden
samples become dashed lines, visible runs solid.

```
samples = max(3, ceil(length / sampleStep) + 1)
for each sample t:
    p = lerp(a, b, t) + viewDir · surfaceOffset     # lift off the surface
    hidden = raycast(p, viewDir) hits anything
    when the hidden flag flips, close the current run at the midpoint of the
    two straddling samples and start a new one
```

Three details:

- **Occluder material is `DoubleSide`.** An edge sunk inside a solid — a mortise
  wall, the far side of a notch — can only be occluded by the *inside* of the
  face between it and the camera. With the default `FrontSide` that exit face is
  culled and the edge would be misreported as visible.
- **The surface offset** lifts the ray origin off the face it starts on;
  otherwise every point reports itself as its own occluder.
- **The transition midpoint** is an approximation: the true crossing is somewhere
  between the two samples, and at `sampleStep = radius/60` the error is
  sub-pixel at the zoom the drawing is framed for.

`O(E · S)` raycasts, where `S` is samples per edge. This is the most expensive
thing in a projection re-render, which is why it is memoised on
`[groups, viewDir, radius]` and *not* on zoom.

The same ray-to-camera convention (rather than comparing raycast distances) is
used by `useOcclusionTest` in `UploadedMesh.tsx` to stop the 3D view from picking
edges it does not draw. Comparing distances fails near a silhouette, where the
ray grazes a face almost edge-on and the two distances say nothing about
visibility.
