# Projections, dimension chains and framing

`src/components/OrthographicView.tsx`, with `splitVisibleHidden` from `src/lib/assembly.ts`

Each of the three orthographic cells draws a blueprint: graph-paper backdrop,
solid lines for visible edges and dashed for hidden ones, drafting-style
dimension chains, an axis triad, and an invisible pickable copy of the outline.

## Camera and framing

The three projections are **fixed world-axis views** (`VIEW_AXES`): Top looks
down `+Y`, Side along `+X`, Front along `+Z`. Re-orienting a component rotates
the model, not the cameras, so what "top" means never drifts.

`viewCameraBasis(normal)` returns the view direction and an up vector, choosing a
reference (`+Y`, or `−Z` when the view direction is nearly `±Y`) that is never
parallel to the direction. `right = up × direction`.

### Fit

Framing is on the projected **bounding box**, not the bounding sphere. A sphere
is the same size in every view, so framing on it leaves a flat part marooned in
the two views that see it edge-on. All eight box corners are projected onto
`(right, up, direction)` to get `minU…maxW`.

```
availableW = cellWidth  − 2·FIT_PAD_PX − 2·DIM_RESERVE_PX
availableH = cellHeight − 2·FIT_PAD_PX − 2·DIM_RESERVE_PX
fit  = min(availableW / (maxU − minU), availableH / (maxV − minV))
zoom = fit × orthoZoom[view]                  # orthoZoom is the user's wheel
```

`DIM_RESERVE_PX = DIM_GAP_PX + 2·DIM_TEXT_PX + DIM_OVERRUN_PX` is the strip the
dimension chains claim on each of the four sides. It is reserved *up front* so no
value can fall off the edge of the cell, and it is the same on every side, so the
drawing stays centred on the model itself.

### Pan

Pan is tracked in **screen pixels** (`viewPans`) and divided by `zoom` when
converted to world units, so the drawing follows the cursor exactly at any zoom.
Middle-drag or shift+left-drag pans (plain left-click stays for picking);
`OrthoCell` uses pointer capture, best-effort.

Zoom is clamped to `[0.05, 50]` and is per-view: the wheel only affects the
projection under the cursor.

## Blueprint grid

Three decade levels ride on top of the base 0.5 mm pitch (`GRID_CELL_MM`), at
increasing opacity. A level whose on-screen spacing would drop below
`MIN_GRID_SPACING_PX = 5` is dropped entirely rather than smeared into a flat
wash. Lines are anchored to the world origin, not to the camera, so the paper
stays put under the drawing while panning, and only the lines inside the visible
rectangle are generated.

The grid is pushed behind the model along the view axis. The projection is
orthographic, so that affects depth ordering only, not the drawing.

## Hidden-line removal

`ProjectionLines` builds occluder meshes from every group's merged solid
(`DoubleSide` — see [solid-simplification.md](solid-simplification.md)) and runs
`splitVisibleHidden` per group. Visible runs become a solid `lineBasicMaterial`;
hidden runs become `lineDashedMaterial` with `dashSize = radius·0.03` and
`computeLineDistances()` called on mount.

Memoised on `[groups, viewDir, radius]` — deliberately **not** on zoom, since it
is by far the most expensive thing in the cell.

## Dimension chains

This is the drafting logic, in `Dimensions`.

### Where the numbers come from

Per screen axis, the station list (see
[spans-and-measurements.md](spans-and-measurements.md)) is filtered to those
strictly inside the drawing bounds, and the chain becomes

```
stations = [ lo, …interior stations…, hi ]
links    = consecutive pairs
```

with two guards:

- more than `DIM_MAX_LINKS = 12` links is unreadable at any zoom, so the chain
  collapses to just `[lo, hi]`;
- a link whose span is not solid the whole way (`isSolidSpan`) is dropped. A gap
  between two parts that are not joined yet is not a size — it is just how far
  apart they happen to be drawn.

### Two margins per axis

```
        ┌──────────────── overall size (far margin) ────────────────┐
        │                                                          │
        │        ╔══════════════════════════════════════╗          │
        │        ║             the drawing              ║          │
        │        ╚══════════════════════════════════════╝          │
        └─ feature ─┴─ feature ─┴──── feature ────┴─ feature ──────┘
                        (near margin)
```

What a part is *made of* and how big the part *is* get a margin each: features
chain link by link below the drawing and to its left, the overall size rides
above it and to its right. So no dimension line ever crosses the part, and the
two kinds of number are never told apart merely by how far out they sit.

The layout function is written in `(along, cross)` — `along` is the axis being
measured, `cross` steps away from the drawing — and `horizontal` maps that back
to the view plane, so both axes run through the same code. Each link carries the
boundary it hangs off and an `outward` direction, so everything downstream works
the same either way round.

The overall link is only added when there is more than one feature link (a chain
that came out as a single link already *is* the overall size) **and** the
assembly is one solid — nothing has an overall size until the parts are joined.

### Value, and how it is drawn

For each link's span, in order:

| Case | Text | Style |
| --- | --- | --- |
| `solver.known` has it | evaluated formula | underlined, `BLUEPRINT.known` (green) — a value the designer set |
| `solver.imply` derives it | evaluated formula, in parentheses | underlined, `BLUEPRINT.implied` (yellow) — a reference dimension |
| neither | the measured length | plain |

Underlining is the drafting convention for "set or derived by the designer";
parentheses mark a reference dimension.

The two colours are the same ones the model edges are drawn in (see *Edge
status colouring* below) and the same ones the sidebar's Measurements and
Implied lists use, so a number, the arris it measures and its row in the list
are never told apart by colour.

### Edge status colouring

Once **anything** has been measured, the projection's own lines stop being
uniform blueprint blue and are coloured by how well each edge is pinned down —
`src/lib/edgeStatus.ts`:

| Status | Colour | Meaning |
| --- | --- | --- |
| `known` | green | the designer set this span |
| `implied` | yellow | nobody set it, but the span solver can chain to it |
| `unknown` | red | nothing determines it; a variable edit will not move it |

Status is by **span**, exactly as everywhere else in the measurement model, so
the four arrises bounding a block along an axis always colour together. A skew
edge spans no axis and takes no part in implication: it is `known` only if a
measurement was hung on that very edge, otherwise `unknown`.

Before the first measurement every edge would trivially be `unknown`, and a
drawing painted entirely red says nothing — so `EdgeClassifier.active` is false
until then and the views keep `BLUEPRINT.line`.

Two implementation points:

- The colours ride on a `color` vertex attribute, not on the material, and the
  material is remounted (via a React `key`) when `active` flips, because
  `vertexColors` is a shader define.
- The hidden-line pass cuts one arris into several segments, so
  `splitVisibleHidden` returns the **source edge** for each emitted segment;
  every piece takes the status of the edge it came off. Colouring is a separate,
  cheap pass over the finished buffers so that typing a formula never re-runs
  the raycasting.

### Extension lines

A station earns an extension line only if some value was actually drawn against
it — the far side of a gap is a station of the drawing but of no dimension. A
station served on both sides earns one in each margin, which is why `served` is
keyed by `outward:station`.

### Arrowheads

Arrowheads sit inside a link that has room for them and flip to the outside,
pointing in, on one too short to take them:

```
inside = length > max(textAlong, 2.4·arrow) · 1.15
```

When outside, the dimension line is extended past both ends by `1.6·arrow` so the
arrows have something to sit on.

### Label placement

Links are laid out **biggest first**, so the overall size claims its place before
the features. Each label's screen-space AABB is tested against everything already
placed, and a clashing label is simply dropped. At a zoom where they would
collide the numbers are unreadable anyway, and zooming in brings them straight
back.

Text is always upright on screen: the footprint is `textAlong × textCross` with
the two swapped for a vertical chain. All of these are **fixed pixel sizes
divided by zoom**, so text stays legible at any scale.

### The guides are pickable

A chain link is a legitimate measurement target in its own right — the distance
between two stations, whether or not any single edge spans it. That is what lets
an overall size be set directly.

Clicking one does *not* store the guide. The pick is `parallelEdges(guideEdge,
geometries)`, which hands over to the model edges stating the same span, so a
stored measurement always hangs off the part rather than off a line that only
exists at this zoom. The guide edge itself is built on the drawing's **boundary**,
not on the dimension line, because the dimension line moves with zoom and a
stored measurement must stay put.

Pick radius is `DIM_PICK_PX / zoom` through `lineRaycast`, which swaps the
threshold into the shared raycaster for one test — each projection has its own
zoom, so a fixed world threshold would pick generously in one view and barely at
all in another.

## Free-floating measurement labels

`MeasurementLabels` labels **only skew edges**. A span that runs along a world
axis is already a link of the dimension chains in two of the three projections,
so labelling it here as well puts a second copy of the same number in the middle
of the drawing hanging off nothing. A chamfer or an angled brace spans no axis,
belongs to no chain, and would go unlabelled in every view if not for this.

## Text and the triad

Both are scene geometry, because the cells are scissored drei `<View>`s:

- `TextSprite` renders text to a 2D canvas and shows it as a camera-facing
  sprite — no font downloads, no DOM overlay to clip. Semibold, not regular: a
  numeral a few pixels tall loses its thin strokes to the mipmap, which reads as
  half-transparent rather than merely small. The underline is drawn straight onto
  the canvas.
- `AxisTriad` is plain line geometry. drei's `GizmoHelper` takes over the render
  loop, which breaks scissored views. Each projection pins its triad to the cell
  corner nearest the centre of the 2×2 grid (`TRIAD_CORNER`), so the three triads
  cluster in the middle of the screen instead of scattering to the outer edges.

## Edge picking across views

`PickableEdges` renders an invisible copy of each group's outline with
`lineRaycast(EDGE_PICK_PX / zoom)`. The 3D view instead hangs the same
`useEdgePicking` handlers on its *visible* edge overlay, with occlusion testing
enabled.

The asymmetry is deliberate: the projections let hidden edges be picked, because
dashed lines are part of the drawing and a feature is often clearest from the
view that only sees it through the part. The 3D view draws its edges depth-tested,
so an edge behind the solid is not on screen — and picking one would mean picking
something invisible.
