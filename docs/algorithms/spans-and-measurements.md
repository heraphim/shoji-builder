# Spans, stations, runs, and the span solver

`src/lib/measure.ts`, plus `deriveBlocks` in `src/store/useComponentEditorStore.ts`

This is the core idea of the whole editor. Everything else exists to serve it.

## The key observation

Everything the projections draw is square to the world axes. So a measured
distance is fully described by two facts:

- **which axis** it runs along, and
- **the two coordinates** it spans.

Not *which edge* it was read off. That is what makes the following true:

1. Two measurements on entirely different features that happen to span the same
   pair of coordinates are **the same measurement**.
2. Measurements that share a coordinate **chain together**, so a value nobody
   typed can be derived from ones they did.

```ts
interface Span { axis: 0 | 1 | 2; a: number; b: number }   // a < b, world coords
```

`spanKey(span)` = `"axis:a:b"` with coordinates quantised to 2 decimals
(0.01 mm). That quantisation is not slop-hiding: coordinates arrive from three
different sources — raw mesh vertices, reconstructed outline endpoints, and
projected bounding-box corners — which agree to about 1e-4 mm but not exactly.
Station extraction already collapses anything closer than 0.2 % of the part, so
0.01 mm can never merge two genuinely distinct stations.

The key normalises **negative zero**, and that is load-bearing rather than
cosmetic. `(-2e-15).toFixed(2)` is `"-0.00"`, which is not the string `"0.00"`,
so a block whose face sits a few times 1e-15 below zero states an extent that no
edge of the model can match. Its size then falls back to a literal, it can never
be measured, and a variable edit no longer resizes it — the part silently stops
being parametric. Turning the model leaves exactly that residue on whichever
axis was zero: rotating a beam 90° about X put every block's `min.y` at
-2.2e-15 and made all five heights unmeasurable.

## Classifying a direction

```
axisOfDirection(unit dir):
    take the component with the largest magnitude
    if |that component| < 0.999  →  null      # skew
    else → { index, sign }
```

`0.999` is roughly 2.6° of tolerance. A skew edge (a chamfer, an angled brace)
returns `null` and therefore has **no span**: it takes no part in chaining, it is
never a link of a dimension chain, and it is the only kind of edge that gets a
free-floating label in the projections (`MeasurementLabels`). Everything else
would otherwise be labelled twice — once in each of the two views that see it.

`spanOfEdge` applies this to an edge's direction and returns the min/max of its
two endpoint coordinates on that axis.

## The span solver

`buildSpanSolver(knownSpans) → { known, imply }`

### Building

For each measured span, on its own axis:

- record `known[spanKey] = formula`;
- add an undirected edge between the two endpoint coordinates in that axis's
  graph, tagged with the formula and a sign: walking `a → b` **adds** the value,
  walking `b → a` **subtracts** it.

Nodes are quantised coordinates ("stations"); there are three independent
graphs, one per axis. Building is `O(S)` in measured spans.

### Implying

```
imply(span):
    if either endpoint is not a node of this axis's graph → null
    BFS from span.a to span.b
    if unreachable → null
    walk the predecessor chain back, collecting the links
    render as (f1) + (f2) - (f3) …
```

**BFS, not Dijkstra** — every edge has unit cost because the objective is the
*fewest terms*, which is what keeps the derived formula readable. A shortest
chain of three measured values produces a three-term formula; a longer path
through the same graph would produce the same number with more terms.

`O(V + E)` per query.

Signs come out of the traversal direction, so a value that is "the overall minus
the two legs" is produced as `(overall) - (leg) - (leg)` automatically. Every
term is parenthesised so an inner `a+b` cannot bind wrongly against an outer `*`.

### Why this is the right structure

Consider a leg: overall height set to `#innerHeight`, and the top shoulder set
to `#legExtraTop`. The shoulder-to-bottom distance is now **not a free choice** —
it is the difference. Typing it in a second time is how a drawing drifts out of
agreement with itself. The solver reports it instead, and the sidebar's *Implied*
panel and the projections' bracketed reference dimensions show it.

## Stations

`axisStations(geometries) → { stations: [number[], number[], number[]], box }`

Stations are the coordinates along each world axis where the solid has a face
square to that axis. They are what dimension chains hang off.

```
for every triangle of every geometry:
    n ← normalised cross product of two edges
    doubleArea ← |cross product|
    for each axis:
        if |n[axis]| < 0.999: continue          # not square to this axis
        bucket the triangle's area at coordinate a[axis], keyed to 0.01 mm
per axis:
    keep buckets whose accumulated area ≥ (0.03 × modelSize)²
    always add the two outer faces (box.min, box.max)
    sort, then merge anything within 0.002 × modelSize
```

Two design decisions:

- **A face earns a station by area, not by existing.** A chamfer sliver or a
  stray CSG triangle contributes too little to take a link of its own, so it
  cannot inject a bogus 0.4 mm dimension into the chain.
- **Computed once per model, in world-axis terms** — not per view. That is why a
  feature picked up in the Top view carries the same station in Front, and why
  implied values agree across all three projections.

`O(T)` triangles plus `O(k log k)` for the per-axis sort.

`stationsAlong(stations, direction)` projects them onto a view's screen axis,
flipping sign when the view looks at that axis from the far side.

## Runs

`solidRuns(boxes) → [Run[], Run[], Run[]]`

Runs are the stretches of each axis the assembly actually occupies, with
overlapping and touching intervals merged (`RUN_TOL = 1e-3 mm`). Classic
interval merge: sort by `min`, extend the last run if the next starts within
tolerance, otherwise start a new one. `O(m log m)`.

`isSolidSpan(runs, span)` asks whether a span lies inside material the whole way.

They exist to **tell a feature from a gap**. A dimension states a size somebody
decided. The stretch of nothing between two parts that are not joined yet is not
a size — it is just how far apart they happen to be drawn, and it changes the
moment they are connected. A single joined solid gives exactly one run per axis
(parts that touch must overlap on every axis), so runs only break where the
design genuinely has separate pieces.

## `deriveBlocks` — the payoff

`deriveBlocks(meshes, measurements) → Map<meshId, { size, source, spanKeys }>`

This is what each block's three sizes are **in terms of the design variables**.
It is simultaneously:

- what the saved file contains,
- what makes the live model respond to a variable edit,

so the two can never disagree.

```
spans ← every distinct span covered by any measurement, tagged with its formula
solver ← buildSpanSolver(spans)

for each mesh that is a block:
    box ← its world box
    for axis in 0..2:
        span ← { axis, box.min[axis], box.max[axis] }
        size[axis] ←   solver.known[spanKey(span)]        # the user measured it
                     ?? solver.imply(span)                # a chain reaches it
                     ?? formatSize(box size on that axis)  # the number it is drawn at
        source[axis] ← "set" | "implied" | "literal"       # which of the three
```

Three tiers, in that order. `source` records **which** tier answered, because
the formula alone cannot say: a size reads the same whether it was decided or
derived. Nothing on the bench needs the distinction — the solver re-derives it
from the measurements every time — but a *saved* file has no measurements to
re-derive from for a block's own extents, so it writes `source` alongside and
`loadBlocks` re-surfaces only the `set` ones as measurements. Without it every
loaded component came back with all its edges green.

`spanKeys` is returned alongside so `rebuildBlocks` can later find which block
extent a given measured span referred to, and move the measurement's edges onto
the re-cut part.

`formatSize` writes `String(Number(v.toFixed(4)))`, which trims trailing zeros —
a literal comes out as `186`, not `186.0000`.

## Where the results surface

| Consumer | What it does with them |
| --- | --- |
| `rebuildBlocks` | Evaluates the size formulas, rebuilds box geometries, replays connections. |
| `buildComponentFile` | Writes them as the `blocks[].size` recipe, with `source` as `blocks[].sizeSource`. |
| `Dimensions` (projections) | `known` → underlined, coloured as *set*; `imply` → underlined and bracketed as a reference dimension; neither → plain measured number. |
| `useImpliedSpans` (sidebar) | Lists every adjacent-station link and overall size that the user did not set but the solver can derive. |
| `parallelEdges` | Finds the other edges stating the same span, so a pick selects all four arrises of a block extent at once. |
| `buildEdgeClassifier` | Colours every edge in all four views — green `known`, yellow `implied`, red `unknown`. See *Edge status colouring* in projection-and-dimensions.md. |

## Moving a measurement onto a re-cut part

After a rebuild, `rebuildBlocks` moves each measurement edge that names a block
extent onto the new box (`movedEdge` keeps the corner it was picked at and
changes only its length). Which block a span belongs to comes from `owners`,
built from every block's three `spanKeys`.

A span key can have **several** owners, and that is the ordinary case rather
than a corner one: two identical stiles standing side by side have literally the
same extent on two of the three axes. So `owners` maps a key to a *list*, and
each edge is matched to the candidate whose box its midpoint is nearest —
distance zero for the block it is an arris of.

Keeping only the first owner sent the other block's edges through `movedEdge`
against a box they are nowhere near; the cross-axis fraction then comes out far
outside `[0, 1]` and those edges land off in space. On the shipped `frame`
component, changing `frameWidth` from 7 to 12 threw two of the seven measurement
edges 121 mm clear of the part — which reads as half a measurement vanishing,
and also feeds the solver a bogus span at the stray coordinate.

### Spans no single block owns

An overall width, a distance from one part's outside to another's, a chamfer
between two parts — none of these is one block's extent, so `owners` has no
entry for them. They are **not** left where they were: both their ends still sit
on block *faces*, and `rebuildBlocks` records where every face moves to
(`movedFaces`, keyed at the same 0.01 mm as stations) and carries each endpoint
coordinate across. A coordinate on no face — an edge picked part-way along one —
stays put, as before.

Leaving these alone was the second half of the same defect: the edge kept
coordinates the model no longer had anywhere, so the value stayed in the list
but stopped naming anything on the part, and the span it used to state went back
to reading as unmeasured the moment some *other* measurement changed a size.

### Measurements the geometry cannot grant

A measurement is a request. `deriveBlocks` can only grant it where a block's
extent is free to be re-cut to it — directly, or through `imply`. Set the
overall width of an assembly whose parts are still fixed numbers and nothing
gives: the value sits in the list and on the drawing while the part stays the
size it was.

The sidebar compares each measurement's formula against the length its edges
actually span (0.5 mm slack) and marks the difference, since otherwise a number
sits next to a feature of a quite different size with nothing saying so.
Measuring the parts the length is made of clears it — with the two ends of a
frame measured, the rail between them implies, and the overall size is then
genuinely honoured.
