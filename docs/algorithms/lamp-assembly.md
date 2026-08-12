# Lamp assembly

`src/lib/lamp.ts`, `src/store/useLampStore.ts`, `src/components/LampView.tsx`

The Lamp Design tab hangs saved components on one central reference box. This is
the assembly layer *above* the component editor: the editor decides what a part
is, this decides where it goes.

## The premise, again

The same rule that makes a component file a recipe rather than a snapshot holds
here. **Nothing positional is stored as a millimetre that was only true at one
setting of the variables**:

| Thing | Stored as | Derived from |
| --- | --- | --- |
| The main box | nothing | `innerWidth` / `innerHeight` / `innerDepth`, per read |
| An instance's parts | the component file's size *formulas* | the current variables |
| A joint | four **anchors** — fractions of a named box each — plus a roll angle | — |
| A *disconnected* instance's place | a position and a quaternion | — |

That last row is the one exception and it is deliberate: a part that has been
taken off the lamp and stood aside is somewhere because the user put it there,
and that is a millimetre fact.

The consequence is that `useLampStore` holds no geometry at all. `computeScene`
rebuilds the lot from `(instances, raw)` on every render, so dragging a variable
slider resizes the box and carries everything anchored to it — with nothing in
the store to keep in step.

## The main box

```
mainBoxOf(raw) = Box3(
    min = (-innerWidth/2, 0,           -innerDepth/2),
    max = ( innerWidth/2, innerHeight,  innerDepth/2))
```

Centred on X and Z with its base on the grid, so the lamp stands on the floor and
grows symmetrically when it is widened. A variable that will not resolve falls
back to the shipped default rather than leaving the scene with no reference.

It is not a part — nothing is cut from it, and it is never exported. It is drawn
as a translucent hull with an edge cage, and it is pickable like anything else.

## Cutting an instance — `buildShape`

```
1. evaluate every block's three size formulas, all in ONE resolver pass
2. build each block as a box at its saved `origin`
3. replay the component's OWN joints over those boxes           # same forest
   replay as the editor's computeOffsets
4. shift everything so the assembly's low corner is the local origin
```

Step 4 is what makes the result a *shape* rather than a position. Where the
component was drawn is not a property of it; an instance is placed by its
connection or by its stored position, never by where the file happened to put it.

A block whose formulas do not resolve to three positive numbers falls back to a
1 mm cube — visibly wrong, rather than a NaN box that poisons every bounding box
downstream.

## Drawing a component — one solid, not a heap of boxes

A component's parts are a construction detail of the recipe, not something to
look at. Drawing each part's own twelve arrises put a line across every face
where two parts butt flush — a seam that is not a bend in anything. On a
thirteen-piece apron that is 156 arrises where the shape has 60.

So the solid is drawn from the **outline of the union**. The component editor
gets that by CSG (`mergeGroupGeometry` → `outlineEdges`), which is correct but
costs 19 ms for a median library part and 389 ms for the ninety-piece kumiko
sill — paid again on every frame of a slider drag.

`outlineOfBoxes` answers the same question directly, because every part is an
axis-aligned box and that makes the question **local**:

```
for each candidate line (an arris of some box, answered once):
    keep only the boxes the line touches            # nearly all are dropped
    cut it at every face of those boxes
    for each stretch, look at the four quadrants of material around it:
        none / all four   -> empty space or solid interior, no surface
        two sharing a side -> the surface runs FLAT through: the seam case
        two diagonal       -> two solids meeting along a line
        one or three       -> an ordinary convex or concave arris
    join the neighbouring stretches that are creases
```

Candidate lines are the boxes' own arrises. For parts with **disjoint
interiors** — which is what a component made of butted blocks is — every edge of
the union lies on one, because a boundary crease bounds an exposed face region
and those regions are bounded by arrises.

Measured over all 244 shipped components: median 0.2 ms, worst 2.3 ms, against
19 ms / 389 ms for CSG. Checked against ground truth — the union's own occupancy,
sampled quadrant by quadrant — it is **sound** (nothing drawn that is not a
crease) and **complete** (no crease the CSG outline finds is missed) on every one
of them. It also drops 2492 stretches the CSG outline drew that are *not* creases
at all: seams across flush joins, which is the thing this replaced.

The parts still go into one *buffer* (`mergeGeometries`, no boolean) so a
ninety-piece sill is one draw call. The interior faces stay in it: back-face
culling means a coincident pair never both draw, so there is nothing to z-fight
and no reason to pay for a union.

## Projected edges — the corners a cut took away

Rebate the end of a beam, or notch it for a mortice, and the corner you would
actually butt it by is gone: what is left is the corner of the cut, half a
thickness in. `projectedEdges` puts the original back as a construction line.

```
for each of the encasing box's twelve arrises:
    subtract the stretches the real outline already covers
    whatever is left is drawn dashed
```

The vertices those lines end at are exactly the ones `pickBoxes` makes
connectable, so what is drawn and what can be picked are the same set. A solid
that fills its own box — every single-part component, the main box — produces
nothing, which is the point: the lines appear only where material was removed.

Across the library, 205 of 244 components project something and 174 of those
recover at least one corner of their encasing box.

## Connecting — four points, one line

A connection is **two points on the part (`a1`, `a2`) and two points on the
target (`b1`, `b2`)**, in click order. The part's *second* point is the one that
lands, on the target's *first*:

```
alignPlacement(a1, a2, b1, b2, roll):
    quaternion = squaredUp(shortest rotation taking (a1-a2) onto (b1-b2))
    quaternion = turn(roll about b1-b2) ∘ quaternion
    position   = b1 - quaternion * a2
```

All four points then lie on one line, which is the whole definition. The meeting
point `a2` = `b1` sits **between** `a1` and `b2`: each body runs away from the
joint, so the part continues the target's line rather than lying back over it.
That is why the two pairs' lengths need not agree — only `b2`'s *direction* from
`b1` is used, and connecting a 200 mm rail to a 300 mm edge does something
sensible instead of nothing.

### The naming click

Four points, but **five clicks**. Between the pairs comes one that picks nothing:
it lands on the body the part is going onto and only says *which body*, and while
it stands every other part stops being drawn — the main box included, and the
part being connected with it.

That click is about **sight, not arithmetic**, which is why it is a step of its
own rather than the first of the target's two points. A lamp is parts standing
inside a box and in front of each other, and the two points wanted next are
usually behind something; picking the first of them through whatever is in the
way is exactly the problem. So the body is named first, cleared, and only then
picked on.

Not rendering is what does it, and it clears the eye and the raycast in one go:
react-three-fiber only hit-tests objects that listen, so a body that is not drawn
cannot be clicked or block a click either. Nothing is moved or deleted — the
draft ending, committed or cancelled, is all it takes to bring the lamp back. The
points already picked stay visible throughout, because the pick markers are drawn
over the model rather than in it (`depthTest` off).

The cycle check runs here rather than at the first target point, so a joint that
would loop back is refused before anything goes out of sight.

Two coincident points give no direction, so the rotation degenerates to identity
and the joint becomes a pure translation.

### Squaring up

Two points fix an axis and nothing more: a rail brought onto an edge is still
free to lie flat or on its side. `setFromUnitVectors` gives the **shortest**
rotation onto the target direction, which turns about `from × to` — an axis
belonging to neither body — so which of those it picks is arbitrary.

When both directions are box axes, `from × to` is a box axis too, so the part's
other two axes land on box axes by luck and the joint looks right. On a
**diagonal** the luck runs out: the turn is about an oblique axis, and it carries
the part's faces off the box's faces. Measured:

| Pick | Off square |
| --- | --- |
| Two body diagonals | 60° |
| Two face diagonals on adjacent faces | 70.53°, sign depending on which way the target runs |
| A 200×40 face diagonal onto a 500×300 one on a skew face | 43.32° |

The four points are still collinear — the part is merely spun about the line they
lie on, which is exactly what a roll fixes. So `squaredUp` states the wanted
orientation instead of hoping for it: of the **24 rotations that carry a box onto
itself** — every signed permutation of the axes with a right-handed result, i.e.
every orientation in which the part's faces are parallel to the box's — take the
one a roll comes nearest, and roll to it. `rollTowards` solves that roll.

Ties go to the smallest roll, which leaves a joint that was already square where
it already was: every axis-to-axis pick gets 0°. A reachable square orientation
is returned verbatim rather than as the rolled base approximating it, so a part
that can sit square sits *exactly* square.

When the two slopes differ, no square answer exists at all — a 200×40 face
diagonal is not parallel to a 500×300 one, and no rigid turn makes it so. The fit
then returns the nearest a real part can get (43.32° off square becomes 19.65°,
the residual the geometry itself forces), which is the honest answer rather than
a refusal.

### The roll

`roll` is the user's turn *away from square*, stored on the connection in degrees
and stepped in quarters from the sidebar. Zero means square to the box, which is
why it can be a plain button: the default it departs from is now a stated
orientation rather than whichever one the arithmetic happened to land on.

It **cannot break the joint**, and that is why it is safe to expose as a plain
button: the axis it turns about passes through `b1`, and `a2` lands on `b1`, so
`a2` cannot move and `a1` cannot leave the line. It is applied by premultiplying
the alignment, i.e. in world terms after it, and it survives a variable edit for
free — like everything else on the connection, it is re-applied when the scene is
rebuilt rather than baked into a stored transform.

### Anchors, and which box they are of

Once committed, the four world points are converted to anchors through
`roundAnchor`, exactly as the editor does. From then on the joint is stated as
fractions and survives every variable edit.

Fractions **of what** is the other half of that promise, and the half that is
easy to lose. A component is several blocks, and a point on one of them is only
tracked by the encasing box while the blocks keep their proportions — which is
exactly what a variable edit changes. Bolt a bar to the bottom rail of a frame
whose stiles are parametric, lengthen the stiles, and an encasing-box fraction
walks the bar up off the rail: the rail has not moved, but the fraction that
named its top now reads further up a taller box.

So a `LampAnchor` is a pair — the fractions, and the **block** they are fractions
of:

| End | Box the fractions are of |
| --- | --- |
| `source` (on the instance) | the block the point was picked on, or the encasing box |
| `target`, `kind: "instance"` | the same, on the target instance |
| `target`, `kind: "mainBox"` | the main box — one box, so `block` is `null` |

`snapToFeature` already decides which box a pick belongs to — the fractions 0,
0.5 and 1 are of *it* — so recording the winner alongside the point is the whole
change, and it makes every stored anchor exactly a feature fraction rather than
whatever fraction of the encasing box the feature happened to sit at.

`block: null` is a first-class case, not a fallback: the encasing box is a real
pick target (it is where a rebated corner *would* be, see below), and a joint
made to it is meant to follow the body's overall extent. An anchor naming a block
the component no longer has falls back to the encasing box, which cannot happen
from the UI and is there so a hand-edited state degrades rather than breaks.

Symmetry slots stay bare `Vec3` fractions: only a part fixed to the main box has
a symmetry of its own, and the main box has no blocks.

### Picking

Clicks snap to a body's **feature points**: the 27 points at every combination of
low face / middle / high face on any of its boxes, i.e. the 8 corners, 12 edge
midpoints, 6 face centres and the centre of each (`snapToFeature`). Raw triangle
vertices would only ever offer corners, and a corner is rarely where a shoji
frame meets the box it hangs on. Snapping to the lattice also lands the pick on
an anchor of exactly 0, 0.5 or 1, which is what keeps a joint on the same
*feature* when the lamp is resized rather than creeping along a face.

The candidate boxes are every part **plus the encasing box** (`pickBoxes`), and
the raycast target is the encasing box rather than the material — because a
projected corner sits in the empty space a rebate left, and nothing on the part
can be hovered to name it. Snapping per box and taking the nearest gives the same
answer as snapping over all the points at once, since each box's snap is already
the nearest of its own 27. Parts are offered before the encasing box, so a corner
both of them name resolves to the real arrises rather than to the box's longer
lines — and, since the winning box is what the anchor is a fraction of, so the
joint is stated against the part rather than against the box containing it.

A pick carries the **three axis-aligned lines through it, clipped to the box**,
and the view draws them. At a corner they are exactly the three arrises meeting
there. This is the whole of the pick's legibility: the marker is 1 mm and *not*
scaled to the model — a ball big enough to see from across the lamp covers the
very corner it is claiming, and at a 7 mm frame it swallowed the part — so what
identifies the pick is the lines, not the dot. Away from a corner the same three
lines read as crosshairs on the face.

Hover state is only replaced when the *snapped* point changes. The lattice
quantises the cursor to 27 points per box, so most pointer moves land on the
point already marked, and bailing on those keeps a mouse sweep from rebuilding
the highlight geometry every frame.

Only legal targets carry pointer handlers, and react-three-fiber hit-tests only
objects that listen — so an illegal target can neither be clicked nor stop a
click reaching what is behind it, and with no connection in flight the scene is
not raycast at all.

### Resolving the layout — `computeScene`

An instance connected to another needs that one placed first, so placements are
resolved by recursing through the target chain and memoising. Depth is the length
of the longest chain.

`wouldCycle` refuses a connection that would close a loop — a loop has no fixed
point to start the resolution from. It is the same guard, for the same reason, as
the editor's refusal to re-connect two meshes already in one group. A cycle
reaching the resolver anyway (corrupted state) is broken by falling back to the
free placement rather than recursing forever.

## Disconnecting — standing a part aside

The parts were placed *because* of the joint, so simply dropping it would leave
the part exactly where it was and read as nothing having happened. Instead:

```
axis  = dominant world axis of the connection line (q2 - q1)
sign  = away from the main box's centre on that axis
start = 50% of the main box's width
step  = 10% of the main box's width

clearDistance: d = start
               while the part's world box at +d overlaps the main box
                     or any other instance's:  d += step
```

Boxes that merely *touch* are not overlapping (`TOUCH_TOLERANCE` = 1e-3 mm) — a
part butted against another is exactly where it should be, and treating that as a
collision would push every disconnected part one step further than it needs to
go. The sweep is capped at 400 steps so a pathological arrangement cannot spin
forever.

The main box counts as an obstacle, not just the other components: "off the lamp"
is the point of the operation, and half a width rarely clears a box-sized part on
its own.

The same sweep places an inserted component (starting at the box's right-hand
face) and a duplicate (starting beside its original), because all three have to
leave a part somewhere the user can actually see it.

## Deleting

Anything hanging off a deleted instance is **freed where it stands** — connection
cleared, current placement frozen into `position`/`quaternion` — rather than
deleted with it. The user asked to remove one part, and a part that silently took
two others with it would be a surprise.

## Complexity

| Algorithm | Location | Complexity |
| --- | --- | --- |
| Component joint replay (forest, shared-array groups) | `lamp.ts` `replayJoints` | O(J·B) worst case |
| Cut every instance at the current variables | `lamp.ts` `buildShape` | one resolver pass per instance |
| **Box-union outline by quadrant classification** | `lamp.ts` `outlineOfBoxes` | O(B·L), L = 12B candidate lines, after an O(B) touch filter |
| Encasing-box arrises the solid does not reach | `lamp.ts` `projectedEdges` | O(A·S), A = 12, plus a sort per arris |
| Two-point alignment to a rigid transform, plus a roll about the joint's axis | `lamp.ts` `alignPlacement` | O(1) |
| **Squaring the aligned part up to the box** — one `atan2` fit against each of the 24 box rotations | `lamp.ts` `squaredUp`, `rollTowards` | O(1), 24 fits |
| Memoised chain resolution of placements | `lamp.ts` `computeScene` | O(N), depth = longest chain |
| Cycle check by walking the target chain | `lamp.ts` `wouldCycle` | O(N) |
| Clearance sweep in fixed increments | `lamp.ts` `clearDistance` | O(steps · N) |
| Box feature-point snap (27-point lattice) | `lamp.ts` `snapToBoxFeature` | O(1) |
