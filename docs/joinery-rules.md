# Joinery rules

The lamp is a plan for something that will be **cut out of sticks and glued
together**. That is the whole point of the app, and it is a stronger constraint
than "the parts must not overlap": a drawing where every piece is in the right
place can still be a lamp that cannot be built, or one that falls apart the first
time it is picked up.

These are the rules an assembly on the Lamp tab has to satisfy to be buildable.
They were not invented — they were **measured off `basic.lamp.json`**, which was
built by hand and is the reference for all of them. Every rule below is stated so
that `basic` passes it, and `basic` is run as the control whenever they are
checked.

Nothing in the app enforces these yet. See
[Checking them](#checking-them) at the foot.

## 1. Nothing interpenetrates

Two parts may share a face, an arris or a corner. They may not share volume.

Touching is not overlapping — the app's own `TOUCH_TOLERANCE` of 1e-3 mm draws
that line, and the clearance sweep in `lib/lamp.ts` already relies on it. A joint
*is* two parts touching; only material inside material is a fault.

This is the cheap rule and the one every other rule is measured against.

## 2. The paper needs an inner frame

**Each face of the main box must carry a closed ring of frame material lying in
the paper's own plane and inside the paper's rectangle.**

This is the rule that is easiest to miss, because a lamp can look complete
without it. The paper for a face is the rectangle of the main box's face. On
`basic`'s right-hand face that is `z ∈ [-100, 100]`, `y ∈ [0, 370]`, at
`x = 100`. Now look at what is around it:

| Part | Where it is | What it offers the paper |
| --- | --- | --- |
| corner post | `x 100…120`, `z -120…-100` | the **line** `z = -100` — an edge, no area |
| bottom rail | `x 100…110`, `y -15…0` | the **line** `y = 0` — an edge, no area |
| frame stile | `x 100…107`, `z -100…-93` | a 7 mm strip up the whole height |

The posts and the rails sit *outside* the paper's rectangle. They come as close
as touching it, and they are still no use: you cannot glue a sheet to an arris.
Only the inner frame has material in the plane and inside the rectangle, and that
is what the paper is stretched onto. The frame is made up separately, papered
flat on the bench, and then dropped into the carcass — which is also the
repairable way to build one, because renewing the paper means taking the panel
out rather than taking the lamp apart.

So the check is on the **border** of each face rectangle: all four edges must be
covered along their whole length by material coplanar with the face. A frame that
does not close is a frame the paper will lift off.

## 3. Every end joint interlocks

**Where a stick meets another across its own long axis — an L at a corner, a T
into a face — the two must touch on at least two plane orientations.**

A single plane is a butt joint. In a stick frame that is end grain against long
grain, over a section of a few hundred square millimetres, and it holds nothing:
the lamp is a set of levers and every joint is in racking, not compression.

Two planes or more means the joint is *housed* — the parts wrap around each
other and the glue is in shear on faces that cannot pull straight apart. What
`basic` actually does, measured:

| Joint | Planes | Glue | What it is |
| --- | --- | --- | --- |
| beam × beam | **3** | 400 mm² | the two rails half-lapped into each other |
| beam × leg | **2** | 450 mm² | the lap sitting in the leg's housing |
| frame rail × frame stile | **3** | 98 mm² | the frame's corner half-lap |
| frame stile × leg | 1 | **2541 mm²** | the finished frame glued flat to the post |

The last row is a single plane and is *not* a fault: it is not an end joint. The
stile's long face is glued to the post's long face over 2541 mm² of long grain,
which is the strongest joint in the lamp. The rule is about **ends**.

`basic` also has 32 contacts of 24.5 mm² where a frame rail's end happens to
graze a post. Those are not joints and nothing is holding by them — the parts
they belong to are held by their laps and by the row above. A contact that small
is a graze, and the check ignores it rather than pretending it is structural.

### Where the joints are hidden

The rails are half-lapped into each other, and the lap lands **inside the post's
housing** — so from outside the lamp the joint is invisible: what shows is a post
with a rail running into it. That is the andon's own detail, and it is why the
post is mortised across two faces rather than the rails being notched around it.

## 4. Every part has glue area

At least one face contact of real size. A part touching the rest of the lamp only
along an arris or at a corner is a part lying against the design rather than
joined to it.

## 5. No unfilled mortise

**Every void inside a part's own encasing box must be filled by the parts it was
cut for.**

Wood is removed for a reason. A mortise cut the full thickness of a post and met
by a rail that only reaches half way across leaves a slot open to the air: a hole
in the lamp, and a joint with half the glue it was drawn for.

`basic`'s legs are the model. Each housing takes out
`20 × 20 × 15 − 10 × 15 × 10 = 4500 mm³`, and the two rails put back exactly
4500 mm³ — one filling two of the three squares at full height, the other filling
the third, and the two sharing the middle square half and half as their lap.
Nothing is left over and nothing is missing.

There are **two ways to satisfy this**, and the library carries a lamp for each,
because they are different pieces of work in the shop and they look nearly alike:

| | `andon-flush` | `andon-stub` |
| --- | --- | --- |
| the cut | mortise right across the post | mortise only into the corner |
| what is left of the post | a corner, `(T-BD) × (T-BD)` | an **L**, two blocks |
| the rail | runs `legThickness - beamDepth` past its lap, ending flush with the post's outer face | stops at the crossing |
| trade | less post, more rail | more post, less rail |

`andon-flush` depends on `legThickness - beamDepth` staying positive; `andon-stub`
cannot open a mortise at any variables at all, because the depth of the cut and
the reach of the rail are the same variable.

The rule also constrains the horned rails of every other lamp: a horn fills the
mortise only while `beamDepth + beamExtra ≥ legThickness`. It holds at every
section the library ships, and it is checked rather than assumed.

## The standing constraints

These come from the app rather than from joinery, and everything above is written
inside them.

6. **Every design is a recipe, not a drawing.** Sizes are formulas over the
   design variables and joints are fractions of a box, so a lamp has to be right
   at *any* variables — not at the ones it was drawn at. A joint that is correct
   at one size and creeps at another is a bug even though nothing looks wrong on
   screen. See [component-file-format.md](component-file-format.md).

7. **Everything is an axis-aligned box.** No mitres, no tapers, no angled kumiko.
   `public/models/generated-components/README.md` sets out what that rules in and
   out, and the stepped key that replaces the tapered wedge.

## Checking them

There is no runner for these in the app. They are enforced by a generator kept
outside the repository — the same arrangement as the one that wrote
`public/models/generated-components` — which lays every lamp out through the
app's own `computeScene` and then measures:

- **1** and **4** from the overlap of every pair of blocks across two components:
  all three axes positive is a clash, exactly one zero is a face contact and its
  area is glue.
- **3** by grouping those contacts per pair of components and counting distinct
  plane orientations, with the contact treated as an end joint when it lies
  across either part's own long axis.
- **2** by collecting the rectangles of material coplanar with each face and
  testing that the four borders of the opening are covered end to end.
- **5** by cutting each part's encasing box at every block face — its own and
  those of whatever reaches into it — and testing each cell for being inside the
  part, inside something else, or empty. Exact rather than sampled, because
  everything is a box.

Each rule has a **negative control**, because a check that has never failed is a
check nobody has tested: shortening a horn to 2 mm opens 4800 mm³ of mortise per
post and rule 5 says so; asking rule 2 about a face that was deliberately left
open reports it; dropping rule 3's graze threshold to zero surfaces `basic`'s own
24.5 mm² touches.

Every lamp in the library is held to all five at eight different sets of
variables — tall and narrow, a cube, small, a rectangular plan, light stock,
heavy stock, a deep foot, and nothing to stand on — and each individual joint is
re-proved against a ninth that changes everything at once.
