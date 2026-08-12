# Algorithms

Index of every non-trivial algorithm in the codebase, with where it lives and
what it costs. `n` is per-call and stated with each entry.

## Expression evaluation

| Algorithm | Location | Complexity |
| --- | --- | --- |
| Hand-written tokenizer | `formula.ts` `tokenize` | O(n) in characters |
| Recursive-descent parser, precedence climbing by rule | `formula.ts` `parse` | O(n) in tokens |
| AST tree-walk evaluation | `formula.ts` `evaluate` | O(n) in nodes |
| Memoised DFS resolution with cycle detection | `formula.ts` `resolveVariables` | O(V + E) over the variable dependency graph |

→ [formula-resolution.md](formula-resolution.md)

## Measurement

| Algorithm | Location | Complexity |
| --- | --- | --- |
| Axis classification of a direction (dominant component ≥ 0.999) | `measure.ts` `axisOfDirection` | O(1) |
| Span extraction from an edge | `measure.ts` `spanOfEdge` | O(1) |
| **Span solver: BFS shortest chain** over a station graph, per axis | `measure.ts` `buildSpanSolver` | build O(S); each `imply` O(V + E) |
| **Station extraction: area-weighted face bucketing** + 1-D clustering | `measure.ts` `axisStations` | O(T) triangles + O(k log k) |
| Run merging (sort + linear sweep of intervals) | `measure.ts` `solidRuns` | O(m log m) boxes |
| Block-size derivation (explicit → implied → literal) | `useComponentEditorStore.ts` `deriveBlocks` | O(M·E + B·(V+E)) |

→ [spans-and-measurements.md](spans-and-measurements.md)

## Assembly

| Algorithm | Location | Complexity |
| --- | --- | --- |
| **Connection replay with rigid-group translation** | `useComponentEditorStore.ts` `computeOffsets` | O(C·N) worst case |
| **Union–find** connected components of the mesh/connection graph | `useComponentEditorStore.ts` `meshGroups` | O(N + C·depth), no path compression |
| Minimum-overlap axis choice + clearance sweep for disassembly | `useComponentEditorStore.ts` `separateDetachedGroup` | O(N) |
| Quarter-turn axis permutation of a block's size formulas | `useComponentEditorStore.ts` `rotatedBlock` | O(1) |
| **Union–find** islands of an STL triangle soup by shared vertex | `picking.ts` `splitIntoIslands` | ~O(T) |

→ [assembly-layout.md](assembly-layout.md)

## Lamp assembly

| Algorithm | Location | Complexity |
| --- | --- | --- |
| Component joint replay (forest, shared-array groups) | `lamp.ts` `replayJoints` | O(J·B) worst case |
| Cut every instance at the current variables | `lamp.ts` `buildShape` | one resolver pass per instance |
| **Box-union outline by quadrant classification** — the CSG outline's answer in 0.2 ms instead of 19 ms | `lamp.ts` `outlineOfBoxes` | O(B·L), L = 12B candidate lines, after an O(B) touch filter |
| Encasing-box arrises the solid does not reach, drawn as construction lines | `lamp.ts` `projectedEdges` | O(A·S), A = 12 arrises |
| **Two-point alignment** to a rigid transform, plus a roll about the joint's axis | `lamp.ts` `alignPlacement` | O(1) |
| Memoised chain resolution of placements | `lamp.ts` `computeScene` | O(N), depth = longest chain |
| Cycle check by walking the target chain | `lamp.ts` `wouldCycle` | O(N) |
| **Clearance sweep** in fixed increments | `lamp.ts` `clearDistance` | O(steps · N) |
| Box feature-point snap (27-point lattice) | `lamp.ts` `snapToBoxFeature` | O(1) |

→ [lamp-assembly.md](lamp-assembly.md)

## Symmetry

| Algorithm | Location | Complexity |
| --- | --- | --- |
| Places a connection reaches under the box's eight rigid turns, deduplicated by **undirected** line | `symmetry.ts` `planSymmetryFill` | O(G·N), G = 8 |
| Isometry test of an operation against the current box | `symmetry.ts` `isMetric` | O(1) |
| **Roll by one-parameter least-squares fit** to the moved original | `symmetry.ts` `rollFor` | O(1) |
| Occupancy by resulting placement, not only by anchor | `symmetry.ts` `symmetryCopies` | O(G·N) |
| Dependent subtree, breadth-first over the connection graph | `symmetry.ts` `subtreeOf` | O(N·depth) |

→ [symmetry-fill.md](symmetry-fill.md)

## Solid processing

| Algorithm | Location | Complexity |
| --- | --- | --- |
| CSG boolean union (BVH-accelerated, three-bvh-csg) | `assembly.ts` `mergeGroupGeometry` | library |
| Vertex canonicalisation on a 1 µm decimal grid | `assembly.ts` `buildTopology` | O(T) |
| T-junction adjacency (point-on-edge test) | `assembly.ts` `buildTopology` | O(T·P) with an AABB reject |
| **Union–find** coplanar regions (normal ∧ plane offset) | `assembly.ts` `buildTopology` | ~O(T·d²) |
| **Outline recovery by cover parity** on supporting lines | `assembly.ts` `regionOutlines` | O(E log E) per line bucket |
| Loop chaining with dangling-chain pruning | `assembly.ts` `chainLoops` | O(E) |
| Collinear-vertex removal | `assembly.ts` `dropCollinear` | O(n) |
| Ring nesting by even-odd containment depth | `assembly.ts` `simplifySolid` | O(R²·n) |
| Ear clipping (three.js `ShapeUtils`) as the non-rectilinear fallback | `assembly.ts` `simplifySolid` | O(n²) |
| Area-conservation check before accepting a rebuilt face | `assembly.ts` `simplifySolid` | O(n) |
| Nearest-vertex owner lookup for a merged-solid pick | `assembly.ts` `meshIdForWorldVertex` | O(V) |

→ [solid-simplification.md](solid-simplification.md)

## Rectilinear partition

| Algorithm | Location | Complexity |
| --- | --- | --- |
| Coordinate-compression grid + even-odd cell fill | `rectangles.ts` | O(nx·ny·P) |
| Concave-corner detection from the 2×2 cell neighbourhood | `rectangles.ts` | O(nx·ny) |
| Interior chord enumeration between co-linear concave corners | `rectangles.ts` | O(K²·max(nx,ny)) |
| **Maximum bipartite matching** (Kuhn's augmenting paths) | `rectangles.ts` `augment` | O(V·E) |
| **König's theorem** → minimum vertex cover → maximum independent set | `rectangles.ts` | O(V + E) |
| Residual-corner cutting, then a row-major greedy maximal-rectangle sweep | `rectangles.ts` | O(nx·ny) |

Result size is the proven optimum `n − l − h + 1` for a rectilinear polygon with
`n` concave corners, `l` the maximum independent set of chords and `h` holes.

→ [rectangle-partition.md](rectangle-partition.md)

## Drawing

| Algorithm | Location | Complexity |
| --- | --- | --- |
| **Hidden-line removal by ray sampling** toward the camera | `assembly.ts` `splitVisibleHidden` | O(E·S·log T) with BVH-less raycast |
| Dimension chain layout (station list → links → margins) | `OrthographicView.tsx` `Dimensions` | O(K) links |
| Greedy largest-first label placement with AABB rejection | `OrthographicView.tsx` | O(K²) |
| Fit-to-cell framing on the projected bounding *box* | `OrthographicView.tsx` | O(1) |
| Decade grid levels with a minimum on-screen pitch | `OrthographicView.tsx` `BlueprintGrid` | O(lines in view) |

→ [projection-and-dimensions.md](projection-and-dimensions.md)

## Wood texture

| Algorithm | Location | Complexity |
| --- | --- | --- |
| **Solid (3-D) texturing in object space** — grain wraps a beam and its cut ends show matching end grain, with no UVs | `woodMaterial.ts` `woodColor` | O(1) per fragment |
| Perlin gradient noise, scalar and vector | `woodMaterial.ts` `woodNoise` / `woodNoise3` | 8 gradient evaluations per lookup |
| Radial space warp, three passes (broad, medium, fine) | `woodMaterial.ts` `woodSpaceWarp` | 3 vector-noise lookups |
| Ring profile with derivative anti-aliasing and a resolve limit | `woodMaterial.ts` `woodRings` | O(1) |
| Smooth voronoi pore structure (27 taps, skipped on a uniform test) | `woodMaterial.ts` `woodVoronoi` | O(27) hashes |
| Object → texture space: axis permutation, mm scale, pith and seed offset | `woodMaterial.ts` `woodMatrix` | O(1), CPU-side |

→ [wood-texture.md](wood-texture.md)

## Numerical tolerances, all in one place

Different passes snap at different scales, deliberately. Getting these confused
is the usual cause of a "phantom diagonal" or a duplicated dimension.

| Constant | Value | Where | Why |
| --- | --- | --- | --- |
| `WELD_GRID` | 1e-3 mm (1 µm) | `assembly.ts` | Parity arithmetic needs *exact* coincidence. A round decimal grid, because part sizes come out of the evaluator as decimal millimetres. |
| `PLANE_EPS` | 1e-3 | `assembly.ts` | Two triangles are on the same plane if their offsets agree to this. |
| `EDGE_THRESHOLD_DEG` | 8° | `assembly.ts` | Coplanarity angle for region grouping and outlines. Tighter values show CSG wobble as creases. |
| `EPS` | 1e-6 | `rectangles.ts` | Coordinates arrive pre-snapped; this is only for the leftovers. |
| `MAX_CELLS` | 4096 | `rectangles.ts` | A face needing more cells is a mistake, not a joint — bail out. |
| `STATION_DECIMALS` | 2 (0.01 mm) | `measure.ts` | Quantises coordinates from three different sources so they compare equal. |
| `STATION_MIN_RUN` | 0.03 × model size | `measure.ts` | A face earns a station by *area*; slivers do not. |
| `RUN_TOL` | 1e-3 mm | `measure.ts` | "Touching" for run merging. |
| anchor snap | 1e-4 → 0/1, 4 dp | `blocks.ts` | A corner picked off a mesh lands a hair off 0 or 1. |
| `TOUCH_TOLERANCE` | 1e-3 mm | `lamp.ts` | Boxes that merely touch are not overlapping, so a butted part is not pushed further. |
| feature snap | 0.25 / 0.75 of an extent | `lamp.ts` | Which third of a box face a click lands in, i.e. corner vs midpoint vs centre. |
| `PROBE_MM` | 1e-3 mm | `lamp.ts` | How far off a line to look for material. Smaller than any real feature of a part measured in millimetres, larger than the arithmetic wobble. |
| `OUTLINE_TOL` | 1e-6 mm | `lamp.ts` | "The same coordinate" for the outline pass. Butting parts are placed by anchor arithmetic on the same evaluated numbers, so they agree far closer than this. |
| `ON_ARRIS_TOL` | 1e-3 mm | `lamp.ts` | How close a segment must be to an encasing-box arris to count as covering it. |
| `isBoxGeometry` tol | 1e-3 | `blocks.ts` | Vertex-on-corner test. |
| `meshIdForWorldVertex` ε | 1e-3 | `assembly.ts` | Exact-match radius before falling back to nearest. |
| `ANCHOR_EPSILON` | 1e-6 | `symmetry.ts` | "The same place on the box". Both sides have been through `roundAnchor`, so genuinely different anchors differ by at least 1e-4 — this only absorbs float noise. |
| roll quarter snap | 1e-3° | `symmetry.ts` | A fitted roll within this of 0/90/180/270 is taken as that, so a symmetric copy reads as `90°` in the sidebar rather than `89.99997°`. |
| `samePlacement` | 1e-6 mm, 1e-9 on \|q·q\| | `symmetry.ts` | Two parts are in the same place if their positions and orientations agree this closely. Both come out of the same anchor arithmetic on the same evaluated numbers, so a real match agrees far closer. |
| degenerate axis | 1e-12 mm² | `symmetry.ts` | Below this the two target points are one point, there is no line to roll about, and the original roll is kept. |
| radial normalise | 1e-6 units | `woodMaterial.ts` | Dead on the pith there is no radial direction; normalising would be a divide by zero and the bullseye would come out as a NaN hole. |
| ring blur floor | 0.02 | `woodMaterial.ts` | Minimum smoothstep width for a ring edge. Below it the profile is a hard step and crawls when the camera moves. |
| ring resolve limit | 1 ring / pixel | `woodMaterial.ts` | Past this there is nothing left to resolve and the rings fade to their mean, which is where a beam seen end-on would otherwise turn into moiré. |
| texture file decimals | 6 | `textureFile.ts` | Two saves of the same texture must be the same bytes. A file differing only in float noise shows up as changed in every diff. |
