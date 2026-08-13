# The blueprint export

`src/lib/pdf.ts`, `blueprint.ts`, `blueprintDoc.ts`, `cutlist.ts`, `dimensions.ts`,
with `src/components/ExportBlueprintDialog.tsx` and `LampRenderCapture.tsx`

The Lamp tab's file menu writes `*.blueprint.pdf` and opens it in a tab: the
design as drawing sheets — the lamp pictured, its plan and elevations dimensioned
at a stated scale, and every distinct piece of timber drawn as stock. It is the
one thing the app produces that cannot be opened back into it, and that is what
it is for. The three save paths write the **recipe**; this writes what the recipe
currently comes out as.

## Why it is a second front end and not a print stylesheet

The screen and the page want the same drawing and almost none of the same
machinery:

| | A projection cell | A drawing sheet |
| --- | --- | --- |
| Framing | fit to the cell, times the user's wheel | the exact fit, at a **stated ratio** |
| Sizes | pixels ÷ zoom | paper millimetres ÷ scale |
| Drawn by | a renderer, every frame | coordinates written into a file, once |
| Redrawn when | anything changes | never |

What they genuinely share is three pieces of arithmetic — the box-union outline,
the hidden-line pass, and the dimension-chain layout — and all three are now
modules either side can call. The layout was the one that had to move: it used to
live inside `Dimensions` in `OrthographicView.tsx`, emitting scene geometry, and
is now `lib/dimensions.ts`, emitting plain `(u, v)` segments.

## `dimensions.ts` — the drafting rules as arithmetic

`planDimensions` takes bounds, the station list per screen axis, four fixed sizes
and two callbacks, and returns extension lines, dimension lines with their
arrowheads, pickable guides and placed labels. It decides:

- stations → links, collapsing past `DIM_MAX_LINKS = 12`;
- which links are refused — one crossing a gap (`isSolid`), and the overall size
  when the design is not one solid;
- both margins per axis: features below and left, the overall size above and
  right, so no dimension line crosses the part;
- extension lines, keyed `outward:station`, so a station served on both sides
  earns one in each margin;
- arrowheads inside a link with room and flipped outside on one without;
- labels biggest-first, dropping any that clashes with one already placed.

The two callbacks are what let one function serve both callers:

| | `isSolid` | `valueFor` |
| --- | --- | --- |
| Editor | the model's runs | the span solver — the designer's own formula, underlined, bracketed if implied |
| Export | the lamp's runs | the measured millimetres, plain |

Fixed sizes arrive in **world units**: the editor divides pixels by its zoom, the
export divides paper millimetres by its scale. "A fixed size on the output
whatever the drawing is doing" is the same requirement in a cell and on a sheet,
so it is the same arithmetic.

→ [projection-and-dimensions.md](projection-and-dimensions.md) for what the
numbers mean and why the margins are split.

## `pdf.ts` — a writer for exactly this

Lines, dashed lines, filled rectangles, text and one embedded JPEG. That is the
whole of a drawing sheet, and a writer for it is shorter than the wrapper around
a general-purpose library would be — this file against 350 kB of jsPDF, in a
project whose every other dependency exists to put triangles on a screen.

Two decisions do most of the simplifying:

- **Courier and Courier-Bold only.** Two of the standard 14 fonts, so nothing is
  embedded, and every glyph is exactly 0.6 em wide — which makes centring text
  *exact* arithmetic rather than a lookup against a widths table the file would
  have to carry. A drawing lettered in a monospace face is the convention anyway.
- **Coordinates are millimetres**, y up from the bottom-left. The app works in
  millimetres; converting to points at the one place bytes are written keeps
  every caller in the unit it thinks in.

Streams are uncompressed — deflate without a dependency is the one piece of this
that would not be short, and a sheet is tens of kilobytes either way.

`clipText` exists because **nothing in a PDF clips**. Text that does not fit is
not cut off at its column, it is drawn over the top of its neighbour, so two
overlapping strings are less readable than either alone. Every table cell and
card heading goes through it.

The unforgiving part of the format is the **cross-reference table**: a list of
byte offsets into the file itself, where an off-by-one is not a wrong line on the
page but a file some readers open and others refuse. `__pdfcheck.ts` re-reads the
bytes the way a reader would — parse the trailer, seek to `startxref`, walk the
table, land on each object's header.

## `blueprint.ts` — projecting, and inking

`projectDrawing(boxes, normal)` is the whole drawing pipeline for one view:

```
outlineOfBoxes(boxes)          # the union's creases, without the flush seams
  -> splitAgainstBoxes(...)    # visible / hidden, by slab test
  -> project onto (right, up)  # the view plane
  + boxStations(boxes)         # the faces the chains hang off
  + solidRuns(boxes)           # where there is material, for isSolid
```

Two things are worth stating, and they are the same thing twice: **every part
here is an axis-aligned box, so stop approximating.**

- **`boxStations` reads faces off the boxes** rather than calling `axisStations`,
  which recovers them from triangles by area. A box states its six faces
  directly — exact, and without building geometry that would be thrown away
  immediately after.
- **`splitAgainstBoxes` answers occlusion by arithmetic**, not by raycasting a
  tessellation. See below, because getting this wrong was not a small error.

### Touching is not blocking

The first version used `splitVisibleHidden` from `assembly.ts` — the editor's
pass, which raycasts each sample of each edge against a mesh. On a lamp it threw
away **8% of the visible outline**, including whole full-height arrises of the
frame, and in the front elevation it called 361 segments hidden where 28 are.

The reason is geometric and systematic rather than a tolerance to tune:

> Every part is axis-aligned and laid out on a regular grid, and the pictorial
> view looks along a direction with equal x and z. So a ray leaving an arris
> arrives *exactly* at the corner of a part some whole number of millimetres
> away — entering and leaving it at the same instant. That is a graze. A triangle
> raycaster reports it as a hit.

The same thing happens in the axis-aligned views wherever a ray runs *along* a
face rather than across it, which is why the fix has to be careful about the
coplanar case too.

`blocked()` asks the question directly: a slab test per box, and a point is
behind something only if the ray passes **through** more than `THROUGH_MM` of it.
An axis the ray is parallel to only counts if the point started strictly between
that pair of faces — running along a face is grazing. There is no surface offset
to tune, nothing to lift a ray origin off, and no dependence on which way a
triangle happens to face. It is also far cheaper than intersecting triangles, so
the sampling step is finer than the raycasting version could afford.

Samples are taken at the **centre** of each step rather than at its ends. An
edge's endpoints are corners of the solid, where the ray leaves along the surface
and nothing is in front of it — sampling them reports the far corner of a hidden
arris as visible and leaves a bright stub on a line that should be dashed the
whole way. With centre sampling a single box comes out at exactly nine visible
arrises and three hidden, which is what a box seen from a generic direction has.

`assembly.ts`'s raycasting version stays where it is. The editor works on CSG
solids that are not boxes at all, and it has no cheaper question to ask.

### Scale, and why it is not a conventional ratio

A printed drawing states its scale. The first version took that to mean it should
state a *conventional* one — 5:1, 2:1, 1:1, 1:2, 1:5, 1:10 — and snapped down to
the largest of those that fitted.

That was wrong, and expensively so. Those steps are factors of 2 and 2.5, so a
drawing that exactly fits at 1:3 is drawn at 1:5: **up to half its linear size
thrown away**, which on a full-height cell is sixty millimetres of white paper on
every side. The argument for the ladder was that "1:3.7" tells a reader only that
the software chose the number — true, but a reader can measure a drawing at
1:3.7, and cannot un-shrink one drawn at half the size it could have been.

So `statedScale` takes the exact fit and rounds **the ratio, upward**, to three
significant figures: 1:3.012 becomes 1:3.02 and never 1:3.01, so the drawing
still fits inside what was reserved for it. Three figures costs under 1% of the
linear size — under 2 mm on the largest cell on the sheet.

`fitScale` still takes the reserve off first, and still takes it off all four
sides, so what is left is centred on the drawing rather than pushed over by its
own numbers.

### One scale, bands sized to suit

A set of views shares one scale, because that is what makes them comparable: a
sheet whose views are each fitted to their own cell is three drawings of three
different objects.

Sharing a scale between cells of a *fixed* size, though, is paying for it twice.
A square plan and a tall elevation share a ratio, so the plan ends up centred in
a cell sized for the elevation with 25 mm of nothing above and below it — the
largest single piece of white space on the sheet, and not padding anybody chose.

`fitBands` solves for the scale first and cuts the bands to suit:

```
s = (room along the line − every band's reserve) / (sum of the spans)
s = min(that, the tightest across-the-line fit)
```

Both closed forms, so there is no iteration and no search. Each band comes out as
big as its drawing needs and no bigger, and the shared scale survives.

Two details worth keeping:

- Room the across-the-line fit leaves over is **not** spread back as padding. It
  stays as one unused strip at the end, where it reads as space rather than as
  margin.
- The reserves are charged before any drawing gets a millimetre, so a long enough
  line can ask for more room than the strip has — six pieces with four drawings
  each want 351 mm of reserve in a 181 mm column. Rather than solve for a
  negative scale and run off the sheet, the reserves are **given up in order**:
  the dimension strips first, then the captions, and what is left is drawn
  without them. The loss is visible; overflowing would not be.

### What the picture costs

Nothing. It carries no caption and no dimension chain, so it is drawn to the
edges of its region with no inset and no reserve — `fitScale` takes a reserve
override of zero. It used to sit inside a 4 mm inset and give up another 2.6 mm a
side for a caption it does not have, and `pageRegions` hands those 13.2 mm to the
pieces instead of leaving them as a gap.

### Colour, and what "blueprint style" can honestly mean on paper

A blueprint was a contact print: white lines on cyanotype blue because that is
what the process produced, not because anybody chose it. A PDF has **one** set of
colours, so a page that looked like a negative on screen and printed positive
would need optional-content groups, which the viewer most people open a PDF in
ignores.

What actually makes a drawing read as a blueprint is the drafting, not the dye:
graph paper under the drawing, hidden work dashed, chains of dimensions in two
margins, a stated scale, a title block. All of that survives being printed the
right way up. So the default palette is dark blue ink on white — which prints as
near-black on any machine and costs nothing in toner — and `NEGATIVE_PALETTE` is
offered for reading on screen, where it belongs.

The graph paper itself is a switch (`grid`, **off** by default). It is the single
biggest contributor to how the sheet *reads*, and also the only ink on it that
carries no information: about 112 strokes a sheet, on every sheet. These are
sheets to work from, so the working version is what you get and the decoration is
what you ask for.

## `cutlist.ts` — the counting

The whole of it is a group-by, and that is the point: the app stores no piece
list and does not need one. `computeScene` cuts every instance at the current
variables on every render, so the parts are already boxes.

Two levels, because two different people are asking:

- **By component** — "four corner posts, three pieces each" — which is how the
  thing goes together.
- **By size** — "cut twelve at 240 × 7 × 7" — which is how it gets made.
  Identical pieces merge across components here, because at the saw a piece is
  nothing but its three dimensions. That is also why `pieceSize` sorts them
  longest-first: the same stick standing up and lying down is one row, not two.

Sizes are rounded to 0.1 mm before they are keyed. They are evaluated formulas,
so two pieces meant to be identical agree to floating-point noise rather than
exactly, and a cut list with 240 and 239.9999 on separate rows is worse than no
cut list.

## `blueprintDoc.ts` — which sheets, and what is on them

**This half is being rebuilt.** The first version produced five kinds of sheet —
title, general arrangement, bill of materials, one per component, then every
piece — which was a good way to find out what the machinery could do and a bad
way to hand somebody something to work from: ten sheets for a four-component
lamp, most of it restating what the cut list already said. So the composition
starts again from an empty document and goes back a page at a time. Everything
above this line is untouched.

### Page one

A page divided in two, **across whichever axis gives each half the lamp's own
shape**:

| The lamp | The sheet | Cut | Halves | Picture |
| --- | --- | --- | --- | --- |
| taller than wide | **landscape** | down the middle | two tall | left |
| wider than tall | **portrait** | across the middle | two wide | top |

The paper ends up the other way up from the lamp, which reads backwards until you
follow it through: what has to fit the drawing is not the page but the *half* of
it the picture gets, and halving a page across its long axis turns it the other
way up. A landscape sheet cut down the middle gives two tall halves — which is
what a standing lamp wants.

`lampOrientation` compares height against the **larger** of the two plan
dimensions, not against width alone: a lamp is square in plan far more often than
not, and comparing against width would call a tall square-plan lamp horizontal
the moment it was a millimetre deeper than it was high.

The first half holds the picture of the finished lamp — the render when there is
one, the pictorial line drawing when there is not, which is not really a
fallback.

The second half is divided **the same way again**: the projections go in the
first of those, every distinct piece of timber in the last.

```
  landscape sheet (standing lamp)      portrait sheet (lamp lying down)
  +-----------+------+---------+       +---------------------------+
  |           | TOP  | ====    |       |         picture           |
  |           +------+  ===    |       +---------------------------+
  |  picture  | FRONT|   ==    |       | TOP  |  FRONT  |   SIDE   |
  |           +------+   ==    |       +---------------------------+
  |           | SIDE |    =    |       | ||    ||   |    |    |    |
  +-----------+------+---------+       +---------------------------+
```

Both lines run in the direction the lamp itself runs — down the page for a
standing lamp, along it for one lying down — which is also the direction their
piece of the page is longest in, so each drawing gets the most room going.

### Drawing a piece

**A component is a piece; its blocks are the joinery cut into it.** A rail
modelled as a full-section middle with a half-thickness stub at each end is one
stick 200 mm long that has been lapped twice — not three sticks — and the blocks
it is built from are how the *shape* is described, not how the timber is bought.
Grouping by block produced sections like `7 × 3.5`, which is not a size anybody
planes: it is half the thickness of a lap. So the grouping is by component, the
count is how many are fitted, and the size is the whole component's extent.

`stockOrientation` then decides how each is turned, in two steps. **Which way it
lies**: of the 24 rotations that carry a box onto itself, only those that put the
piece's longest extent along the line it is laid in — a piece is drawn as *stock*,
not as it sits in the lamp. **Which way up**: of those, whichever shows the most,
measured as the length of outline actually in front. That is what "hides the
least" means once a piece has a lap or a housing in it; on a plain box every
candidate ties and the first is taken, deterministically.

`PIECE_VIEW` then depends on which way the piece is lying, and only one of the
two cases needs anything done to it:

- **Stood on end** — nothing. `up` is derived from world +Y, so `right` is
  perpendicular to +Y for *any* view direction, and a piece whose length runs up
  the Y axis projects exactly vertically wherever the viewer stands.
- **Laid flat** — the ordinary pictorial puts a 370 mm stick at 26° off
  horizontal, which is 153 mm of rise in a row 12 mm tall, so the piece is drawn
  at less than half the size the row could carry. Flattening the view to
  `0.3, 0.35, 1` brings the rise to 16% of the run — just under what the row can
  take, so length rather than height sets the scale — while still turning three
  faces toward the reader. Measured across a range of angles; flatter than this
  buys nothing and only makes the section harder to read.

Each piece then gets its **square-on views** as well — top, side and front, in
that order, with any that comes out the same as one already kept folded into its
caption (`TOP & SIDE`) instead of drawn again. A 20 × 20 post is the common case:
two of its three views are the same drawing.

Every drawing in the section — each piece's pictorial, then its views — is laid
out as one long line of bands at one shared scale, so the piece that is twice as
long looks twice as long and a stubby block does not claim the same room as a
460 mm post.

### One elevation or two

A design square in plan draws the same front and side, and putting both on the
sheet spends a cell saying it twice. So both are drawn, compared, and the second
kept only if it differs — two cells rather than three, for most lamps. When they
match, the single view is captioned `FRONT & SIDE` rather than leaving a reader
to wonder where the other one went.

`sameDrawing` compares the two as **shapes** — each shifted to its own origin —
and as **sets**, with coincident segments collapsed. That second point is not an
optimisation. A projection routinely draws one line twice, because two arrises at
different depths land on top of each other, and a square-in-plan design does that
constantly: the shipped lamp draws 372 segments at 141 distinct positions.
Counting multiplicity called every symmetric lamp in the library asymmetric, over
a difference no reader could see.

### Captions hug their drawing

A view is centred in whatever room it was given, and a cell can be far taller
than the view in it — so a caption pinned to the foot of the cell floats away
from the thing it names and ends up nearer some other view's. It is placed under
the drawing instead, by the same strip the fit already reserved, so it clears the
dimension chain and still lands inside the cell.

### Sheet furniture, which stays

Every sheet is landscape, bordered, optionally gridded, and carries the same
title block. The block is painted **last**, once every sheet has been laid out,
for one reason: it says "sheet 3 of 11" and nothing knows what eleven is until
then.

`paintTable`, `paintArrangement` and `paintPieceCard` moved to `blueprint.ts`
when the composition was emptied. They are how you put a table, a 2×2 of views or
a dimensioned piece on paper — machinery rather than composition — and the pages
still to come will want them. Tables return how many rows they could not fit
rather than running off the bottom: silently truncating a bill of materials is
the one failure here a reader cannot see.

### What the numbers are, and are not

Every dimension on these sheets is a **measured millimetre** — what the model is
at, right now. The editor can do better, because it has the designer's own
formulas and prints them underlined per the convention that an underlined value
was *set* rather than read off; but a lamp carries no measurements
(see [lamp-assembly.md](lamp-assembly.md)), so nothing here is underlined. The
title block says as much on every sheet, because a drawing that does not say
which of its numbers are intent and which are consequence is a drawing you cannot
build twice.

## The one raster thing

`LampRenderCapture` mounts its own `<Canvas>` for a second, renders
`ShowcaseLamp`, reads the frame back as JPEG and unmounts. Its own canvas because
the grid's is shared by four scissored views and has no `preserveDrawingBuffer`,
so reading pixels off it returns a blank frame — and turning that on for the whole
app would cost every frame of every slider drag to serve one button.

It waits eight frames before grabbing, because materials compile on first use and
the wood textures may still be arriving, so the first frame is routinely a lamp in
the wrong clothes. And it gives up after 25 seconds — which is a deadlock breaker,
not a budget. Eight frames take a few hundred milliseconds once the program is
compiled, but the *first* compile of the wood shader on a cold context is seconds
rather than milliseconds, and a timeout set to what the warm case needs turns the
first export of a session into the one that silently comes back without its
picture. When it does give up, the title sheet falls back to the pictorial line
drawing, which is arguably the more traditional sheet anyway.

## Complexity

| Algorithm | Location | Complexity |
| --- | --- | --- |
| Dimension chain layout (stations → links → margins) | `dimensions.ts` `planDimensions` | O(K) links |
| Greedy largest-first label placement with AABB rejection | `dimensions.ts` | O(K²) |
| Faces per axis, read off the boxes and clustered | `blueprint.ts` `boxStations` | O(B log B) |
| Hidden-line removal by slab test, no raycaster | `blueprint.ts` `splitAgainstBoxes` | O(E·S·B) slab tests |
| Turning a piece: 24 box rotations, scored by visible outline | `blueprint.ts` `stockOrientation` | 24 projections per piece |
| Are two views the same drawing? Sets of canonical segments | `blueprint.ts` `sameDrawing` | O(n log n) |
| Shared scale with bands sized to their contents | `blueprintDoc.ts` `fitBands` | O(n), closed form |
| Largest standard ratio that fits | `blueprint.ts` `fitScale` | O(1), 9 candidates |
| Piece tally and merge by size | `cutlist.ts` `buildCutList` | O(N·B) |
| Document assembly | `blueprintDoc.ts` `buildBlueprint` | one projection per view per sheet |
| Cross-reference table | `pdf.ts` `build` | O(objects) |

## Checks

    npx vite build --ssr src/lib/__pdfcheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__pdfcheck.js
    npx vite build --ssr src/lib/__dimensionscheck.ts --outDir dist-ssr && node dist-ssr/__dimensionscheck.js
    npx vite build --ssr src/lib/__blueprintcheck.ts --outDir dist-ssr && node dist-ssr/__blueprintcheck.js

The first two are arithmetic. The third builds the shipped lamp's own document
off the disk and asserts the three things a sheet cannot be looked at to check:
that the hidden-line split loses no length, that the counts are the scene's own,
and that nothing lands outside the paper. All three leave a file in `dist-ssr/`
to open, because none of the above says whether the sheet is any good to read.
