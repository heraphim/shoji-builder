# Symmetry fill

`src/lib/symmetry.ts`, `src/store/useLampStore.ts` `fillSymmetry`, `src/components/LampSidebar.tsx`

The lamp is built *around* the main box, so the box's symmetries are the lamp's:
a rail on one top edge belongs on the other three and on the four below, a post
on one vertical arris belongs on all four. Doing that by hand is four rounds of
the same five-click pick, and any drift between them is invisible until the lamp
is stood up.

The ❖ button on a component row puts the part everywhere the symmetry says it
also belongs — **and only where nothing of that component already is**.

## A symmetry is a map on anchors

The same rule that governs the rest of the assembly governs this: nothing is
stated in millimetres that was only true at one setting of the variables. A
connection is already four *anchors* — fractions of the main box — so a symmetry
of the box is a permutation-with-flips of those fractions and nothing more.
Because it never mentions a size, it survives every variable edit for free,
exactly like the joints it maps.

## The eight

A **quarter turn about the vertical axis, optionally turned over**:

```
turn:  (u, v, w) -> (w, v, 1−u),  applied 0–3 times   # = Matrix4.makeRotationY(+90°)
over:  (u, v, w) -> (u, 1−v, 1−w)                     # = Matrix4.makeRotationX(180°)
```

Two small numbers, eight operations, no table.

### Every one of them is a rigid turn

That is the whole design, and it is the part worth defending.

A box has more symmetries than these: the four mirrors, and the reflection about
half its height. Both are tempting — the reflection is the obvious way to say
"the same, but at the bottom". But **a reflection is not something a part can
do**. No placement equals a body's own mirror image, so a copy made by
reflecting can only ever be *approximated* by a real placement, and what the
approximation loses is exactly what you were relying on: a rail sitting flush
against a face comes back a fraction off it.

So `over` is a **half turn about the horizontal X axis**, not a top-for-bottom
mirror. Both reach the same edge at the bottom of the same face; only the turn
is a thing a real part can do, and it carries every relationship the original
had — flush faces, offsets, which side a rebate is on — exactly.

Two ways to reach the bottom of a face, drawn in plan on that face:

```
  mirror (not used)            turn over (used)
  ┌───●────────────┐           ┌───●────────────┐
  │   ↓            │           │   ↓            │
  │                │           │                │
  │   ↑            │           │            ↑   │
  └───●────────────┘           └────────────●───┘
  same corner, reflected       opposite corner, turned
  needs a mirror-image part    the same part, turned over
```

For a part with a uniform cross-section the two land the same solid in the same
place, so nothing is lost by dropping the mirror. For a part that is not uniform
along its length, the mirror would need a left-hand and a right-hand version;
the turn needs one part, turned over — which is what a workshop would do anyway.

The mirrors go for the same reason, plus one more: **a mirror never reaches a
place a turn does not**.

### What each feature fills to

| Connected along | Fills to | |
| --- | --- | --- |
| a top or bottom edge | **8** | four top, four bottom |
| a top or bottom face diagonal | **4** | one per corner, each running to the corner opposite |
| a vertical arris | **4** | one corner post per corner |
| a face's centreline | **4** | one per face |

The vertical arrises being a single family holds at any width and depth: there
is exactly one corner-post recipe, always.

### Metric and parametric

A quarter turn only moves the box onto *itself* when `innerWidth` and
`innerDepth` agree. When they do not it is **still a good anchor map** — a rail
at half the width of the front lands at half the depth of the side, level and
where it belongs — but the part arrives at the length its formulas give. Those
have to be written against the span of the face it is on rather than against
`innerWidth`. The plan counts these and the tooltip says so; it is the one thing
about a rectangular plan the fill cannot check for you.

### What this asks of a component

The fill carries the original's relationship to its feature **exactly**, whatever
that relationship is. So it asks almost nothing — get the first one right and the
rest follow. The two things it cannot do for you:

- **Size against the face, not the box.** A part on a side face should be written
  against the span of the face it sits on, never against `innerWidth` directly.
  Write `1/2*#innerWidth` on a front panel and you have hard-coded which pair of
  faces it belongs to; the quarter turn will place it correctly on the side faces
  of a rectangular plan and it will be the wrong length there.
- **Pick the joint the way you want it read.** A joint is directed — the part
  meets the target at the first of its two points and runs *away* from the second
  — and every copy inherits that. A part that runs out from a corner fills to
  parts running out from every corner, which is right; if that is not what you
  meant, the fill will reproduce the misunderstanding four or eight times over
  rather than correct it.

Two conventions worth holding to as an author, neither of which the code
enforces:

- **Every edge of a face reads inward.** Top edges point down, bottom edges point
  up, side edges point in toward the face's middle. A component anchored under
  that rule grows inward from whatever edge it is put on, so one recipe reads the
  same on all sixteen face-edges.
- **The four faces are related by the turn, never by a mirror** — which is what
  the fill does, so following it in hand-placed parts too keeps the whole lamp
  one handedness and one cut list.

## A place is a directed line, and it has to be empty

This decides how many copies you get, and it is not obvious.

A joint is **directed**: the part is pinned at `b1` and its body runs *away from*
`b2`. The ends swapped is therefore the part pinned at the **other end, pointing
the other way** — a different place, not the same one twice.

It is the half turn that makes this matter. On a face diagonal it lands the line
back on itself reversed, and that reversal is the diagonal *from the opposite
corner* — the two corners a quarter turn cannot reach. Reading it as "already
claimed" is what used to leave a diagonal joint with two of its four corners
empty, which is the one answer that is certainly wrong: a leg hung on the top
face's corner-to-corner diagonal belongs at all four corners.

**Turning over is the exception.** It is the operation that can map a place onto
itself end-for-end without moving the part anywhere — every vertical arris does
this, and every face centreline — and there the reversal really is the same part
hanging off the far end of the same line, into thin air. So a turned-over
operation must find a line no *upright* operation already claimed, in either
direction; `SYMMETRY_OPS` lists the upright ones first for exactly that. Against
each other the turned-over operations are directed like everything else.

That leaves places that are genuinely distinct but cannot both hold wood: turn a
diagonal joint over and it comes back to the corner it started from, offset by
the part's own length, so it lands *half inside* the part already there. Anchors
cannot see that — two different anchor pairs, no overlap in fraction space — so
the second test is on the solid. `symmetryCopies` walks the places in order and
refuses one that would share wood with a part already standing, its own earlier
copies included.

### Wood, not boxes

**Touching is not sharing.** Parts are *meant* to meet — that is what a joint is
— so coincident faces, coincident arrises and coincident corners all read as
clear. Only material inside material is a clash. Both blocks are shrunk by half a
margin before the test, so anything that merely touches comes apart and only a
real overlap survives; a hundredth of a millimetre is far below what a saw can
hold and far above the floating-point hair either side of a flush face.

Two things the test is careful to be, both of which an encasing box gets wrong:

- **Block by block, not component by component.** A component is a recipe of
  several boxes, and the box around an L-shaped or notched one is mostly air.
  Judging a copy by that box refuses joints that in truth had room.
- **In the part's own frame, not an axis-aligned box round it.** A leg turned 45°
  has an encasing box whose overlap with its neighbour's is 4.3 mm across while
  the sticks themselves pass clear.

So it is a **separating-axis** test between two oriented boxes: three axes from
each block plus the nine cross products of their axis pairs, fifteen in all. Find
one axis on which their shadows do not meet and they are apart; find none and
they are not. Exact at any angle, which matters because a part on a diagonal is
at some angle to everything else on the lamp.

So the plan is an **upper bound** — it has no scene and cannot know where the
parts land — and the fill is the answer. The tooltip says "up to".

The rule the fill obeys: **it moves a part to a place that is empty.** An
operation that would only turn the part end-for-end where it already is, or that
would stand a second part inside the first, does nothing.

## Which way the copy faces

Two points fix an axis and leave a spin about it undetermined. `alignPlacement`
settles that by squaring the part up to the box, which is the right default for
one part but says nothing about a *family* of them: left alone, four "symmetric"
rails come out square in whichever of the 24 ways each one landed nearest — and
on a vertical arris all four come out facing *the same way*, which is the one
answer that is certainly wrong.

So the wanted orientation is stated first and the roll is solved for, by the same
`rollTowards` the squaring-up uses — the two differ only in what they state:

```
A = M · Q                       # the original carried through the operation
B = alignPlacement(..., roll 0) # what the joint gives with no roll
C = B · Aᵀ

maximise tr(R(θ) · C)  over θ about the connection axis
  = p·cosθ + q·sinθ,   p = tr C − nᵀCn,  q = tr([n]× C)
  -> θ = atan2(q, p)
```

A one-parameter least-squares fit, one `atan2`, O(1).

Every operation being a rigid turn is what makes `A` **reachable**, so the fit is
exact and the copy is the original moved, to the last decimal. It is a fit
rather than a solve only for the one case that is not an isometry: a quarter
turn on a plan that is not square, where an oblique joint's axis does not
survive the turn. There it returns the nearest a real part can get.

Checked two ways, on a chiral test part (a bar with a rebate down one arris, so
any orientation slip shows):

- against a brute-force sweep of the roll at 0.05° over every family above,
  square and oblong plans — the chosen roll is the closest reachable in every
  case, and exact (residual 0) for every isometry;
- a rail laid on a top edge with its top face flush with the box top and its
  outer face flush with the front — all seven copies come out flush on a
  horizontal *and* a vertical box plane, and each copy's orientation and world
  box match the original transformed by its own operation to within 1e-6.

## Only where nothing is

Occupancy is asked twice, because it is cheap to ask badly and expensive to ask
well:

1. **By anchor**, in `planSymmetryFill` — same component file, same target
   anchors. Needs only the instance list and the main box, no laid-out scene, so
   the sidebar can ask once per row on every render.
2. **By placement**, in `symmetryCopies` — where the part actually ends up. Two
   different anchor pairs can name the same joint (the same line picked at the
   corner, or at that edge's midpoint), so a place the anchors call empty can
   still have this part standing in it.

Neither compares the roll or the part's own two anchors. The roll is the thing
the fill computes; refusing to skip a part that is already there because it is
rolled differently would put a second copy inside the first.

So the button is safe to press twice, and safe to press after three of four
faces have been placed by hand. The tooltip says "up to N" because the second
check can only ever remove more.

## Showing it

Hovering the button previews the symmetry in the scene: a line on every place it
reaches, the meeting point marked, and every part standing in one lit up. Yellow
is a place already taken, green one the button would fill.

Two details make it work:

- The store holds only `symmetryPreview`, the **id of the row being hovered**.
  The places are re-derived from it and the main box on every read, for the same
  reason nothing else here is stored: a stored place is a millimetre fact that
  the next variable edit invalidates.
- The button is disabled by `aria-disabled` and a class, never by the `disabled`
  attribute. **A disabled button fires no pointer events**, and a spent symmetry
  is exactly when you most want to hover it — pressing it is no longer available
  as a way to find out what it means.

## What comes with it

A filled copy brings **everything hanging off it**, however deep — a panel with
beads on it is one thing to the user, and copying the bare panel would be a fill
that did three quarters of the job. The followers' anchors are fractions of the
parent's own box, which the copy shares, so they need re-pointing at the new ids
and nothing else.

For the same reason a part hung off *another part* gets no button: it has no
symmetry of its own, it inherits its parent's, and filling the parent carries it.

## Complexity

| Algorithm | Location | Complexity |
| --- | --- | --- |
| Places a connection reaches, deduplicated by directed line (turned-over ops also against upright lines reversed) | `symmetry.ts` `planSymmetryFill` | O(G·N), G = 8 |
| Refusing a copy that would stand inside a part already there — separating-axis, block against block, in each part's own frame | `symmetry.ts` `partsOverlap` | O(G·N·B²), 15 axes per block pair |
| **Roll by one-parameter least-squares fit** to the moved original | `symmetry.ts` `rollFor` | O(1) |
| Occupancy by resulting placement | `symmetry.ts` `symmetryCopies` | O(G·N) |
| Dependent subtree, breadth-first over the connection graph | `symmetry.ts` `subtreeOf` | O(N·depth) |
