# Glossary

Terms used consistently throughout the code and the other documents.

### anchor
A point on a box expressed as a **fraction** of that box on each axis: `0` is the
low face, `1` the high face. `[1, 0, 0.5]` is the middle of the right-hand
bottom edge. Anchors are what survive a resize — the corner two parts meet at is
the same corner once the part is 20 mm longer, but no longer the same coordinate.
`blocks.ts`.

### appearance
What a component is made of and how it is painted: a solid colour, a texture
name and a grain axis. The one part of a component file that describes nothing
about the shape — nothing in it can change a size. Carried through to the lamp so
an assembly shows what it will look like. `useComponentEditorStore.ts`.

### arris
The sharp edge where two faces of a block meet. Four parallel arrises bound a
block along each axis, and all four state the same measurement — which is why
picking one picks all four (`parallelEdges`).

### assembly
Everything currently on the bench: all meshes plus all connections. May be one
joined solid or several separate subcomponents.

### asset
One file in one of the three libraries, read as something to *look at* rather
than to work on: what kind it is, what a card should say about it, and the
geometry its preview draws. A file that will not parse is still an asset — a
`broken` one, which is how the Assets tab can say why a design is missing from
every other picker. The three libraries read at once are a **catalogue**.
`assets.ts`.

### bench
Informal name for the editor's current contents. An STL upload or a component
load *replaces* the bench.

### bench texture
The texture currently on the Textures tab, as opposed to a saved one from the
library. A component can name it (`BENCH_TEXTURE`), which is what lets a slider
drag on one tab redraw a component on another. `useTextureStore.ts`.

### block
A part that is an axis-aligned box, and therefore reproducible from three
formulas instead of from a frozen list of triangles. `SubMesh.block` is present
exactly when the solid passed `isBoxGeometry`. Only blocks can be saved
parametrically.

### block binding
What `deriveBlocks` returns: a block's three size formulas plus the `spanKey` of
each extent, so a later rebuild can find which measurement referred to which
extent.

### chord
In the rectangle partition: a segment joining two concave corners along a grid
line, staying inside the material for its whole length. Choosing a maximum set of
non-crossing chords is what makes the partition minimal.

### connection
A statement that a specific vertex of mesh A and a specific vertex of mesh B are
the same point. Stored both as local coordinates (used now) and as anchors (used
after a rebuild). Connections *join* subcomponents.

### cover parity
The technique `regionOutlines` uses to find a face's boundary: bucket every
triangle edge by its supporting line, and keep the stretches covered an **odd**
number of times. Interior edges (covered twice) and T-junctions (a long edge
against two short collinear ones) both cancel.

### end grain
The face left by cutting a piece across its length, showing the growth rings in
section. The one thing a texture wrapped on a surface cannot get right, and the
reason the wood texture is **solid** rather than mapped — see *solid texture*.

### grain axis
Which of a part's own axes the wood fibres run along. The two faces normal to it
are the end grain. Stored on the part rather than on the texture: a stile and a
rail can be the same oak with their grain at right angles, and that is the
difference between them.

### grain scale
How many millimetres one texture unit is. The number that ties the wood pattern
to real size — every other wood parameter is in texture units. Multiplied by
`ringThickness` it gives the real **ring pitch**, which is what a setting should
actually be judged by. `wood.ts`.

### group
A connected component of the mesh/connection graph — i.e. a **subcomponent**.
Meshes in one group move as a rigid body. `meshGroups`, `subcomponentCount`.

### implied value
A dimension nobody typed that nevertheless follows from ones they did, derived by
the span solver as the shortest chain of measured spans between the two
coordinates. Drawn bracketed as a reference dimension; also listed in the
sidebar's *Implied* panel.

### island
One connected piece of an STL triangle soup. One STL file often contains several;
each becomes its own `SubMesh`. `splitIntoIslands`.

### link
One segment of a dimension chain: the distance between two adjacent stations, or
the overall size across all of them.

### measurement
A formula plus the set of edges it was read off. Its *meaning* is the span those
edges cover, not the edges themselves.

### mesh / SubMesh
One part in the editor: an id, a name, a geometry in its own local frame, an
`offset` that places it, and optionally a `block`.

### offset
The translation a mesh's connections gave it. **Derived**, never authored:
recomputed from the connection list on every edit, so nothing that must survive
may be stored here.

### parametric (of a symmetry operation)
The opposite of **metric**: an operation that is a good anchor map but not an
isometry of the box as it currently stands. Only the quarter turns, and only when
`innerWidth` ≠ `innerDepth`. The copy lands correctly — half the width of the
front becomes half the depth of the side — but arrives at the length its formulas
give, so those must be written against the span of the face it sits on rather
than against `innerWidth`. `isMetric`.

### pith
The centre of the log. How far a part is from it decides whether its end grain
shows tight arcs (near) or nearly straight cathedral figure (far). Held in
texture units, so the real distance is `hypot(pith) x grainScale`.

### place
Where a part can sit on the main box, as a **directed line**: a pair of anchors,
which end is which included. The unit of identity for the symmetry fill. A joint
is directed — the part is pinned at `b1` and lies along the line from it — so the
ends swapped is the part pinned at the *other* end, which is somewhere else on
the lamp, not the same place twice. Turning over is the one operation that can
find a line an upright one already claimed, end for end, and it is refused there.
`planSymmetryFill`.

### pick mode
What the next click means: `none`, `selectingEdges`, `selectFace`, `connectA`,
`connectB`.

### reference dimension
Drafting term for a value that is derived rather than set, drawn in parentheses.
Here, an implied span.

### region
A maximal set of triangles that are coplanar and connected — i.e. one flat face
of a solid, however the tessellator happened to cut it up. `buildTopology`.

### run
A stretch of one world axis that the assembly actually occupies, with overlapping
and touching parts merged. Used to tell a *feature* (inside material) from a
*gap* (between parts not yet joined). `solidRuns`, `isSolidSpan`.

### solid texture
A texture that is a function of the **3-D position inside** an object rather than
of a surface parameterisation. The mesh becomes a shape carved out of a volume,
so its faces agree at every edge, a cut end shows correct end grain, and a notch
cut into it reveals correct interior grain — none of which needs UV coordinates,
of which this app generates none. `woodMaterial.ts`,
[algorithms/wood-texture.md](algorithms/wood-texture.md).

### span
An axis plus the two world coordinates a measured distance runs between. The unit
of identity for measurements: two measurements covering the same span are the
same measurement, whatever edges they were read off. `Span`, `spanKey`.

### span solver
`buildSpanSolver` — a per-axis graph whose nodes are coordinates and whose edges
are measured spans. `known` answers "did the user set this?"; `imply` answers
"does a chain of what they set reach it?" by BFS.

### station
A coordinate along a world axis where the solid has a face square to that axis.
Dimension chains hang off stations. A face earns one by **area**, so slivers do
not. `axisStations`.

### subcomponent
See **group**. Before any connection, every mesh is its own subcomponent.

### symmetry operation
One of the main box's eight **rigid turns**: a quarter turn about the vertical
axis (0–3 of them), optionally *turned over*. Written as two small numbers rather
than a table, and applied to anchors. The box's mirrors are deliberately not
among them — see **turned over**. `SYMMETRY_OPS`.

### T-junction
Where one face's edge meets another face that carries it as one longer edge, so
the two sides share no vertex. Ubiquitous in CSG output, and the reason
`buildTopology` treats a point lying *on* an edge as adjacent to that triangle.

### turned over
The half turn about the horizontal X axis that takes the top of the box to the
bottom — `(u, v, w) → (u, 1−v, 1−w)`. Deliberately *not* a top-for-bottom mirror,
though both reach the same edge: a mirror is not something a part can do, so a
reflected copy could only be approximated and the approximation loses flush
faces. Turning over is exact, at the price of landing the part at the opposite
corner of its face rather than the one directly below.

### variable
A named entry in `variables.json`, stored as an unevaluated formula string.
Referenced from formulas as `#name`.

### weld grid
The 1 µm decimal grid every position is snapped to before any parity arithmetic
in `assembly.ts`. Round decimal on purpose: part sizes are decimal millimetres.
