# Assembly layout

`src/store/useComponentEditorStore.ts`, plus `splitIntoIslands` in `src/lib/picking.ts`

Parts are never dragged into place. A **connection** says "this vertex of part A
and this vertex of part B are the same point", and the layout falls out of
replaying every connection. Positions are therefore *derived*, and deleting a
connection reverts its effect exactly.

## Grouping — `meshGroups`

Union–find (disjoint-set) over the mesh/connection graph. Returns
`meshId → group index`, where indices are assigned in mesh order so they are
stable and comparable.

```
parent[m] = m for every mesh
for each connection (a, b):  parent[find(a)] = find(b)
relabel roots to 0, 1, 2, … in mesh order
```

Neither union-by-rank nor path compression, so `find` is `O(depth)` and the whole
pass is `O(N + C·depth)` rather than inverse-Ackermann. Deliberate: a component
has tens of parts, and the connection set is a forest built by hand, so chains
are short. (The two other union–finds in the codebase — `splitIntoIslands` and
`buildTopology` — *do* use path halving, because they run over triangle counts
where the depth actually matters.)

A **group is a subcomponent**: once two meshes are connected they are one thing,
and `subcomponentCount` — the number of distinct groups — is what the UI gates
on. "Add Connection" is disabled at 1; "Select Edges" is enabled only at 1.

## Connection replay — `computeOffsets`

```
offsets[m] = [0,0,0],  groups[m] = [m]           for every mesh
for each connection c, in creation order:
    if either mesh is gone: skip
    if groups[c.meshA] === groups[c.meshB]: skip     # already joined
    delta = (vertexA + offsetA) − (vertexB + offsetB)   # in world space
    for every mesh in meshB's group:  offset += delta
    merge the two group arrays; point every member at the merged array
```

Two things this gets right that the obvious version does not:

- **Whole groups move, not single meshes.** Meshes joined by an earlier
  connection are a rigid body. Translating `meshB` alone would leave its earlier
  partners behind and the already-joined solid would visibly split.
- **Creation order is the semantics.** The chain is replayed from zero every
  time, so `applyOffsets(meshes, connections.filter(…))` is a complete
  implementation of "delete this connection and revert its effect".

Worst case `O(C·N)` — each connection may translate every mesh. Groups are shared
array references, so the identity comparison `groupA === groupB` is O(1).

`pickConnectionVertex` refuses to create a connection whose two ends are already
in the same group, so **the connection set is always a forest**. That is what
makes replay well-defined: there is never a second path that would demand a
conflicting position.

## Anchors — surviving a resize

`src/lib/blocks.ts`

A connection stores its joint **twice**:

| Field | What it is | Used for |
| --- | --- | --- |
| `vertexA` / `vertexB` | a coordinate local to each mesh | the layout, right now |
| `anchorA` / `anchorB` | the same point as a fraction of each mesh's box | surviving a rebuild, and the saved file |

```
anchorOfPoint(p, box)[axis] = (p[axis] − box.min[axis]) / size[axis]
pointOfAnchor(a, box)[axis] =  box.min[axis] + a[axis] · size[axis]
```

`0` is the low face, `1` the high face. The corner two parts meet at is still the
same corner once the part is 20 mm longer — but it is no longer at the same
coordinate, which is exactly why the coordinate cannot be what is stored.

`roundAnchor` snaps anything within 1e-4 of 0 or 1 to exactly 0 or 1, then rounds
to 4 decimals. A corner picked off a mesh lands a hair off, and an anchor of
0.99998 would creep along the face on every rebuild — and would read, in the
file, as if the joint were deliberately inset.

## Rebuild — `rebuildBlocks`

Called on every variable edit (via the store subscription) and after every
measurement change. Safe to call always: it no-ops when nothing moved.

```
1. bindings ← deriveBlocks(meshes, measurements)          # size formulas per block
2. owners   ← spanKey → (meshId, axis, box-before)        # recorded against the CURRENT layout,
                                                           because after the re-cut those
                                                           coordinates no longer exist
3. for each block:
       sizes ← evaluateAll(binding.size, raw)
       reject if any is non-finite or ≤ 0        → keep the mesh as it is
       if sizes unchanged and formulas unchanged → keep the mesh object identity
       if sizes unchanged but formulas changed   → rebind only (no geometry work)
       else: build a fresh box, translate it to the old box's low corner,
             dispose the old geometry
4. if no size actually changed: set only if some binding was rebound, and return
5. re-derive every connection's vertices from its anchors on the new boxes
6. applyOffsets → the new layout
7. move each measurement's edges onto the re-cut part (movedEdge), for the
   edges whose span was a block extent; leave skew edges and cross-assembly
   spans where they were picked
```

**A block grows away from its own low corner** (step 3). Where it ends up in the
assembly is then re-decided entirely by its connections in step 6, so the growth
direction of an individual box is not something the user has to think about.

`movedEdge` keeps the corner the edge was picked at: a value read off the
top-front arris stays on the top-front arris, expressed as the same *fraction*
along the two axes it is not measuring. Only its length changes.

## Rotation — `rotatedModel`

Turning the component is a real change to the model, not a camera trick. The
rotation is baked into every mesh and into everything that references one, so all
four views, the projections and the export see the same re-oriented solid.

It happens **about the world origin**, which is what keeps it consistent with
connection replay: rotating every vertex and every offset by `R` leaves
`offset = vertexA + offsetA − vertexB` true in the rotated frame, so later
connection edits reproduce exactly these positions.

What gets rotated:

- each mesh's geometry (in place, then `computeBoundingBox`) and its offset;
- each connection's vertices, **and its anchors are recomputed** from the rotated
  boxes;
- measurement edges and any pending pick;
- `modelRotation` accumulates (`R · previous`, normalised) so a late STL upload
  can be brought into the same frame;
- `orthoZoom` and `viewPans` reset — a turn changes what each projection has to
  fit;
- hover cues clear — they were computed against the old orientation.

Block size formulas are **permuted, not rotated** (`rotatedBlock`): sizes are
stated per world axis, so a quarter turn moves `size[axis]` to
`size[rotatedAxis(axis)]`. `rotatedAxis` returns `null` for anything that is not
a quarter turn, and then the solid is no longer box-shaped in world terms and
stops being a block (`block` becomes `undefined`, and it will be omitted from the
export). Both entry points behave accordingly:

- `rotateAboutViewAxis` is always a quarter turn → blocks survive;
- `alignFaceToArmedView` uses `setFromUnitVectors(faceNormal, viewAxis)`, which is
  a quarter turn only when the picked face was already square to the axes.

## Disassembly — `separateDetachedGroup`

Deleting a connection takes the assembly apart, so the freed half has to move out
of the other one. The parts were placed *because* of that connection; without it
they would sit inside each other, which reads as nothing having happened.

```
if the deletion did not actually split anything (another connection still
   holds the two together) → null, nothing to do

gap ← max(2 mm, 0.08 × largest dimension of the whole assembly)

axis ← the axis on which the two halves overlap least
       (for parts butted end to end, that is straight off the end)
sign ← whichever side group B's centre already sits on

push ← gap
for every mesh NOT in group B:
    if it already misses group B on some other axis: skip
    push ← max(push, distance needed to clear it by `gap` along `axis`)

translate group B by sign · push
```

The clearance sweep matters after a *second* deletion: without it the freed part
would come to rest inside a third one that was already standing apart.

**Where the translation goes is the subtle part.** It is baked into the freed
meshes' own *geometry*, not into their offsets — offsets are recomputed from the
connections on every later edit and would wipe it out. The remaining connections'
vertices are stated in that same local frame, so they travel with the geometry
and the remaining joints still hold.

`removeConnection` also discards every measurement if the deletion split the
assembly: measurements only make sense on the fully joined solid.

## STL islands — `splitIntoIslands`

One STL file often contains several disjoint solids (a SketchUp export of a frame
piece with separate end blocks). Union–find over vertices, keyed by position
rounded to 5 decimals; triangles sharing a vertex are one island. Each island
becomes its own `SubMesh`, so connections can join them.

`~O(T)` with path halving. Returns the input unchanged when there is only one
island, so the common case allocates nothing.

Note the upload path in `ComponentEditorPage` also runs each island through
`simplifySolid` before adding it: STL is a triangle soup and a modeller is free
to cut a flat face any way it likes, so re-cutting each face means a block starts
life as the twelve triangles it should be.
