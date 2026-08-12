# UI guide

## Tabs

Four folder tabs at the top left. The first three each have a **▾** that opens
that tab's file menu, and they run down through the model: an assembly is made of
components, and a component is made of a material.

**Lamp Design** — the assembly. The main box, the variables that size it, and
the saved components hung on it.

**Component Editor** — the workbench where parts are imported, joined and
measured into a component.

**Textures** — where a wood is designed, on four test beams. The only tab that
changes no geometry at all.

**Assets** — everything the three libraries hold, side by side. Not a bench, and
so the one tab with no file menu of its own.

Pressing the tab switches to it; pressing its caret switches *and* opens the
menu — a menu that acted on a tab you were not looking at would be acting on a
bench you cannot see.

Variables are shared. Editing one on the Lamp tab immediately re-cuts every block
in the editor, even though the editor is not mounted — the store subscribes, not
a component.

## The file menu

Everything that puts a design on the bench or takes one off it is here, per tab,
and nowhere else. Nothing in the sidebars opens or saves anything.

| | Lamp Design | Component Editor | Textures |
| --- | --- | --- | --- |
| **Upload STL…** | — | Start a new component from one or more `.stl` solids off your own disk. | — |
| **Upload…** | Open a `.lamp.json` off your own disk. | Open a `.component.json` off your own disk. | Open a `.texture.json` off your own disk. |
| **Load…** | Open one from `public/models/lamps`. | Open one from `public/models/components`. | Open one from `public/models/textures`. |
| **Save (overwrite)** | Save over the file this was opened from. | Same. | Same. |
| **Save (copy)…** | Save under a new name. | Same. | Same. |

Textures has no "nothing on the bench" state — there is always a texture,
because the parameters have defaults — so neither of its saves is ever disabled.

**Load…** turns the menu into the library listing, with **← Back** to return.
The folder is re-read every time the menu opens, so a design saved a moment ago
is already there to be had.

**Save (copy)…** asks for a name. If the library already has one under that name
it says so, and the button becomes **Overwrite** — press it a second time to go
ahead. Changing the name clears that, so an armed overwrite can never be aimed at
a name you did not check.

**Save (overwrite)** asks nothing, because the answer is already known: it writes
under the name shown beside it. A design that has never been named has nothing to
overwrite, so the first save of a new one asks for a name like a copy would.

The strip above the views reports what the last file action did, and what is on
the bench.

**Library settings…**, at the foot of every file menu, is where a save stops
being a download. Give it a GitHub user, a repository, a branch and a
fine-grained token with *Contents: read and write*, and every save commits the
file to `public/models/…` instead, so the design is in the library for good
rather than for the session. The row says which mode you are in, `connected` or
`download only`.

A save does **not** rebuild the site — `public/models/**` is ignored by the
deploy workflow, because a minute of Actions to publish one JSON file is not
worth paying per save. Nothing is lost while you are the one working: with a
token the app reads the branch rather than the built site, so what you just saved
is what the pickers list. It is the *other* visitor's view that waits, since they
read the build (Actions → Deploy to GitHub Pages → **Run workflow** publishes the
library as it stands).

The settings are checked against GitHub before they are kept, so a token with the
wrong repository on it is caught there rather than at the first save. They live
in this browser's `localStorage` and nowhere else: anyone else opening the site
reads the same library and saves by download, which is why deploying it publicly
does not hand out write access.

> **Without a token, saving downloads a file**, and the round trip is what it
> always was: save, then drop the file into `public/models/lamps`,
> `public/models/components` or `public/models/textures`. Either way the pickers
> re-list on every open, so it is there the next time you look.

## The sidebars

Every panel on the right folds away from its header, on every tab. Which are
folded is kept in `localStorage`, so a panel you shut because it was in the way
is still shut tomorrow.

# Lamp Design

```
┌───────────────┬───────────────┬──────────────────┐
│      3D       │      Top      │ ▾ Variables (mm) │
├───────────────┼───────────────┤ ▾ Components     │
│     Side      │     Front     │                  │
└───────────────┴───────────────┴──────────────────┘
```

The same view grid as the Component Editor — see [The views](#the-views) for
layouts, minimising, reordering and the draw modes. A 3/4 view is the worst
possible way to check that a rail lines up with the one below it, which is what
the three projections are for.

Bindings in the 3D cell:

| Input | Effect |
| --- | --- |
| Left drag | orbit |
| Middle / right drag | pan |
| Wheel | dolly |

The 3D view frames itself when a component is inserted or removed. It
deliberately does **not** re-frame on a variable edit — the camera would be
yanked around on every slider frame — so resize freely and orbit back out if the
lamp grows past the edge. Minimising it and bringing it back keeps the orbit.

The projections are the fixed world views (Top down +Y, Side along +X, Front
along +Z) and each frames itself on the whole lamp; wheel zooms one cell, middle
drag or shift + left drag pans it.

Connecting works in **any** cell. Every pick is a world coordinate whatever
projected onto it, so a joint can be picked in whichever view actually shows the
corner — often a projection, where a corner buried inside the box is on the
outline.

## The main box

The translucent blue box is the design's central reference: `innerWidth` ×
`innerHeight` × `innerDepth`, centred left-to-right and front-to-back, standing
on the grid. It is not a part — nothing is cut from it and it is never exported —
but it is what everything else is positioned against, which is why resizing it
carries every attached component with it.

## Variables

| Element | Behaviour |
| --- | --- |
| Name | Reference it in any formula as `#name` (or plain `name`). |
| Input | A formula string, not a number. `370`, `1/2*#innerWidth`, `#innerHeight - 2*#legThickness`. |
| Resolved | The evaluated value, 2 dp, or `?` if it does not resolve. |
| ⚭ / ⚮ | Pair toggle, on variables that declare a partner. |
| Slider | Drag to set the value live. Only on the Lamp tab, and only where the variable already is a plain number. |

A slider writes a bare number, so it is only offered where the variable *is* a
bare number. Dragging one on a variable written as a formula would silently throw
the formula away — the formula is the design decision — so those get a disabled
slider showing where the value currently sits. Clear the formula and the slider
comes back. Its range is fixed the first time the variable is seen (three times
its starting value, rounded up); type past it in the box beside it.

Both panels collapse from their headers, and stay collapsed across reloads. The
two halves of the job do not happen at the same time: you place parts, then you
size them.

## How a component is drawn

A component draws as **one solid**. Its parts are a construction detail of the
recipe, so where two of them butt flush the surface is one flat plane and no line
is drawn across it — only the edges the shape actually has.

Where a cut has taken a corner away — a rebate on the end of a rail, a notch for
a mortice — the arrises the part *would* have had come back as **dashed
construction lines**, completing the box that encloses it. Those lines are not
material; they are there so the original corner is visible, and so you can
connect by it. Their vertices snap like any other.

### Solid and Texture — what it is made of

Two panels at the bottom of the editor sidebar, folded by default: what a part is
made of gets decided once and then left alone, while connections and measurements
are worked on all session.

**Solid** is the colour views set to *Solid* draw it in. It starts as the
blueprint blue the editor has always used, so turning the panel on changes
nothing until you ask it to; **Back to blueprint blue** returns it.

**Texture** picks the wood:

| Entry | What it means |
| --- | --- |
| **None — flat colour** | Views set to Texture fall back to the solid colour. |
| **Textures bench** | Whatever is on the Textures tab right now. |
| a library name | One of `public/models/textures`. |
| *(not in library)* | The component names a texture this project does not have — it came from somebody else's library. The name is kept rather than reset, so it survives a round trip through someone who does not have the file. |

Pick **Textures bench** while you are designing a wood: point the component at
it, set a view to Texture, then go and drag sliders on the Textures tab and watch
the component change. Otherwise you would have to save and reload a file to see
each adjustment, which for something judged by eye is no workflow at all.

**Grain along — X / Y / Z** is which of the *component's own* axes the fibres run
along; the two faces normal to it are the end grain. It is set here rather than
on the texture because it belongs to the part: a stile and a rail can be the same
oak and still have their grain at right angles, and that is the difference
between them.

All three are saved with the component (format 5) and come back with it — and are
honoured on the Lamp tab too, so an assembly shows what it will actually look
like. A highlighted part stays highlighted rather than going wooden: the surest
way to lose a highlight is to paint over it.

## Components

**Insert component** opens a dropdown of everything in the shipped library
(`public/models/components/`). Picking one cuts it at the *current* variable
values and parks it beside the lamp, clear of anything already there. Any
variable the file names that the design does not already define is added; a
variable the design has wins.

**Insert component** re-reads `public/models/components` every time it is opened,
so a file dropped into that folder appears on the next open — no reload, and no
restarting the dev server, which reads the folder per request anyway.

Each inserted component gets a row of icons:

| Button | Effect |
| --- | --- |
| ⚭ | Attach or detach. **Lit** while the part is on the lamp; pressing it then takes the part off and stands it aside. Unlit, it starts the four-point pick below — and goes yellow while that pick is running, when pressing it again cancels. |
| 👁 | Show or hide the part. **Lit** while it is on screen. |
| ⟳ | *Connected parts only.* Turn 90° about the connection axis. |
| ❖ | *Parts fixed to the main box, on a symmetric feature.* Fill the symmetry. |
| ⧉ | Duplicate it, parked clear of the original. |
| × | Delete it. |

A lit icon says the thing it names is currently true, in the same green the rest
of the app uses for "settled" — so a dozen parts read as a column of states
rather than of buttons.

Hovering a row picks that component out in yellow in the views.

### Hiding a part — 👁

A hidden part is not drawn **and not pickable**: taking it out of the raycast is
half of what hiding it is for, the other half being that it was standing in front
of the joint you were trying to click. Nothing about the design changes, and
nothing is saved — which parts you are currently looking at is a way of working
on a lamp, not part of one, so a lamp opened again comes back whole.

Starting a connect on a hidden part brings it back into sight first. The pick
wants two clicks on it, and a pick armed against something invisible is a pick
that cannot be made.

### Connecting

**Five clicks:**

| Click | On | What it does |
| --- | --- | --- |
| 1 | the part | its far point — the end of its axis |
| 2 | the part | the point that meets the target |
| 3 | the main box or another component | **names it, and hides everything else** |
| 4 | what is left | where click 2 lands |
| 5 | what is left | which way the target runs from there |

The **third** click is the odd one: it picks no point. Click anywhere on the body
you are connecting to — a face will do, it does not have to be near anything —
and every other part goes out of sight, the main box included, along with the
part being connected. Clicks 4 and 5 are then made on a body with nothing in
front of it. Everything comes straight back the moment the joint is made, and if
you press **Cancel** instead.

That step exists because a lamp is the awkward case for picking: parts stand
inside a box and in front of each other, and the two points you want are usually
behind something. Nothing is moved or deleted while they are hidden — the points
already picked stay marked in mid-air, drawn over the model rather than in it.

The **second** click is the joint. The part is slid until that point sits on the
fourth click's point, and turned until all four are on one line — with the joint
in the middle, the part's first point on one side and the target's second on the
other. So the second says *where the part meets*, the first says *which way its
body runs*, and the fifth only says which way is "back" along the target.

The two pairs need not be the same length: only the direction of the fifth point
from the fourth is used, so a 200 mm rail on a 300 mm edge does something
sensible rather than nothing.

- Points snap to a box's **corners, edge midpoints, face centres or centre**, so
  you do not have to hit anything precisely — and a joint on a midpoint stays on
  that midpoint when the lamp is resized. Every part offers its own, and so does
  the box enclosing the whole component, which is how a corner a cut removed
  (the dashed ones) can still be picked.
- Each pick shows a 1 mm dot **plus the three box lines through it**. At a corner
  those are the three arrises meeting there, which is what tells you *which*
  corner of *which* part you are about to join — from a step back every corner of
  an assembly looks the same, and the dot alone cannot say. Away from a corner
  they read as crosshairs on the face.
- Green is the two points on the part, yellow the two on the target, orange the
  one under the cursor.
- The last two are necessarily on the same other thing, because it is the only
  thing in sight — which is what the naming click is for.
- A connection that would loop back onto something already hanging off the part
  is refused **at the naming click**, before anything is hidden.
- The sidebar says what it wants next; **Cancel** abandons the pick and brings
  everything back.

A joint is stored as four *fractions of two boxes*, never as coordinates. That is
what makes it survive a variable edit: widen the lamp and the part is re-cut,
re-placed, and still joined at the same corners.

### Turning a connected part — ⟳

Two points fix a part's **axis** and nothing more. A rail brought onto an edge is
still free to lie flat or on its side, so the alignment picks the orientation
that sits **square to the main box** — faces parallel to the box's faces, which
is the only way a real part is ever fitted. ⟳ steps away from square in 90°
quarters (the button's tooltip shows where it currently is).

Square is the default rather than the only option, and on a **diagonal** joint it
is the whole point: the plain shortest turn onto a diagonal lands the part canted
by 60° or 70.53° about its own axis, which is a part no joiner would cut. Where
the part's slope does not match the box's, no square answer exists — cut the
part to the box's proportions and it lands dead square.

⟳ cannot break the joint: the axis it turns about runs through the point the part
is pinned at, so all four points stay on their line.

### Filling the symmetry — ❖

The lamp is built around the main box, so the box's symmetries are the lamp's: a
post on one vertical arris belongs on all four, a panel on one side face belongs
on the others. ❖ puts the part everywhere the symmetry says it also belongs, in
one press, correctly turned — not four copies facing the same way.

- It appears on a part **fixed to the main box** whose joint has images other
  than itself. A part hung off another part inherits its parent's symmetry, so
  it is carried by filling the parent instead.
- What you get, at any width and depth:

  | Connected along | Fills to |
  | --- | --- |
  | a top or bottom edge | 8 — four top, four bottom |
  | a top or bottom face diagonal | 4 — **one per corner**, each running to the corner opposite |
  | a vertical arris | 4 — one corner post per corner |
  | a face's centreline | 4 — one per face |

  A joint is directed: the part is pinned at the first of the target's two points
  and runs away from the second. The same line with its ends swapped is the part
  pinned
  at the **other** corner — a different place, and on a face diagonal it is the
  pair of corners a quarter turn cannot reach. Turning over is the
  exception: it can put a part back on a line it already occupies, end-for-end,
  which off the end of an arris means sticking out into thin air, so a
  turned-over copy has to find a line no upright one claimed.
- **A copy that would land inside a part already standing is skipped.** Turning a
  diagonal joint over brings it back to the corner it came from, offset by the
  part's own length, and two legs cannot share the same wood. **Touching is not
  sharing**: parts meeting at a face, an arris or a corner are a joint, and only
  material inside material is refused. The test is on the wood itself — each
  block of a part, in the part's own frame — so a notched component is not judged
  by the box around it, and a part on a diagonal is not judged by the much larger
  box that a turned part needs. This is why the ❖ tooltip says "up to": the count
  is what the symmetry reaches, and the press is what will actually stand.
- Top and bottom are one family: a part on a top edge fills to the bottom edges
  too. A bottom copy is the part **turned over**, not reflected — so it arrives
  at the opposite corner of its face rather than the one directly below, and
  everything the original had stays exact: a face sitting flush on the box sits
  flush on every copy. Reflecting instead would put it directly below but a
  fraction off the face, because no part can be its own mirror image.
- Anything hanging off the part **comes with it**. Fill a panel and its beads
  come too.
- It only fills **empty** places. A place that already holds this component is
  left exactly as you left it, however you rolled it — so the button is safe to
  press twice, and safe to press after doing three of four faces by hand. When
  everything is filled it greys out rather than disappearing, so the row still
  says the part is one of a set.
- The tooltip counts the places before you press.
- **Hovering it shows the whole symmetry on the box**: a line on every place it
  reaches, with the meeting point marked — yellow where something already
  stands, green where the button would put one — and every part in the set lights
  up. This works when the button is spent as well as when it is live, which is
  the point: once there is nothing left to fill, hovering is the only way left
  to ask which parts are the set.

On a **rectangular plan** (`innerWidth` ≠ `innerDepth`) the quarter turns still
place correctly — half the width of the front lands at half the depth of the
side — but the part arrives at the length its formulas give. The tooltip warns
how many copies land on a face of a different span; write those parts against
the span of the face they sit on and one recipe covers all four.

A mirrored copy is the same part in the mirrored position, **not** a mirror-image
part: a body cannot be turned into its own reflection. For a part symmetric about
its own axis the two are the same thing.

### Disconnecting

The part slides along the axis the connection ran along, away from the lamp,
starting at half the main box's width and stepping out another tenth at a time
until it is clear of the box and of every other component. It keeps that position
until you connect it again.

Deleting a component that others are hanging off frees them where they stand
rather than deleting them too.

# Component Editor

A **collapsed pair** (⚭) makes the partner follow this variable: the partner's
formula literally becomes `#thisVariable`, and its row disappears from the list.
Expanding (⚮) restores the partner's own last value rather than freezing it at
whatever the driver happened to be. `innerWidth`/`innerDepth` and
`frameWidth`/`frameHeight` ship paired, which is what "square by default, but
separable" means.

A formula error (unknown variable, circular reference, syntax) shows above the
list. The geometry keeps whatever it last successfully built.

## The views

```
┌───────────────┬───────────────┐
│      3D       │      Top      │   Top   looks down +Y
├───────────────┼───────────────┤   Side  looks along +X
│     Side      │     Front     │   Front looks along +Z
└───────────────┴───────────────┘
```

All four share one WebGL canvas. Selection and hover are global: highlighting
anywhere highlights everywhere.

| Input | 3D cell | Projection cells |
| --- | --- | --- |
| Left drag | orbit | — (left click picks) |
| Middle / right drag | pan | — |
| Middle drag, or shift + left drag | — | pan |
| Wheel | dolly | zoom that cell only |

Projection zoom and pan are per-cell and reset whenever the model is turned or a
new solid arrives, since what has to fit has changed.

Both tabs have this grid, and each keeps its own layout.

### Layout

**–** in a cell's header minimises it; the layout reshapes to whatever is left.

| Views | Layout |
| --- | --- |
| 4 | 2 × 2 |
| 3 | one tall cell on the left, two stacked on the right |
| 2 | side by side |
| 1 | the whole area |

A minimised view becomes a chip in the strip above the grid; click it to bring it
back, at the end of the row. The last remaining view cannot be minimised.
Nothing is thrown away by minimising — a view comes back with its zoom, its pan
and its orbit exactly as it left.

**Drag a cell's name onto another cell** to swap their places. The cell you would
drop into is outlined in yellow.

### How a view draws

Two dropdowns in each cell's header, set per view. They are separate settings on
purpose — how the faces are drawn and how the lines are drawn are separate
questions, and one combined list would be every pairing of them.

**Material** — the faces:

| Mode | 3D cell | Projection cells |
| --- | --- | --- |
| No material | Wireframe: nothing hides anything, and edges behind the solid become pickable because they are now on screen. | The default: a line drawing, hidden lines dashed. |
| Solid | The default: opaque blueprint blue. | The solids filled as well, for reading a crowded assembly as shapes. |
| Texture | The part in its wood. The Component Editor and the Lamp use whatever texture the component names; the Textures tab uses whatever is on its bench. A component that names none falls back to Solid. | Same — and the projections light themselves for it, since everything else in them is unlit. |

**Geometry** — the lines:

| Mode | Draws |
| --- | --- |
| No lines | Nothing. In a projection this also skips the hidden-line pass, which is the expensive part of drawing one. |
| Material edges | The default: the edges the shape actually has, seams across flat faces removed. |
| All triangles | The same, plus the tessellation underneath in a fainter line — how the solid is *built* rather than what it looks like. Useful when a face has failed to resolve or a join has cut a solid oddly. |

Turning either off never turns off picking. The solid and its outline stay in the
scene as bodies that write no colour, so Select Edges, Select Face and vertex
picking work the same in a view drawing nothing at all.

### Per-cell controls (lower right of each projection)

| Button | Effect |
| --- | --- |
| **Select Face** | Arms the cell. Click a face on the model in the 3D view and the whole component turns until that face points along this view's axis. |
| ↺ / ↻ | Turn the model 90° about this view's axis, counter-clockwise / clockwise. |

Both turn **the model**, not the camera, so all four views show the turn and so
does the export. A quarter turn permutes a block's three size formulas; an
arbitrary rotation (from Select Face on a non-square face) makes the solid no
longer box-shaped in world terms, and it stops being a saveable block.

## Workflow

### 1. Import

From the tab's [file menu](#the-file-menu).

**Upload STL…** (multi-select allowed). An upload **starts a new component** —
the bench is cleared first, then every file in that one selection accumulates
onto it.

Two things happen per file:

- SketchUp exports STL in cm, so geometry is scaled ×10 into mm.
- One STL can hold several disjoint solids; each becomes its own subcomponent, so
  connections can join them. They are named `file.stl (1)`, `file.stl (2)`, …
- Each is re-cut face by face (`simplifySolid`), so a block starts life as the
  twelve triangles it should be rather than whatever the modeller emitted.

**Load…** picks from the project's shipped library, and **Upload…** takes the
same file off your own disk. Either replaces the bench and rebuilds every block
at the *current* variable values. The strip above the views reports how many
blocks were rebuilt and which variables the file contributed.

### 2. Connect

**Add Connection** → click a vertex on one subcomponent, then a vertex on a
**different** one. It snaps immediately: the second subcomponent's group is
translated so the two picked points coincide.

- Clicks snap to the nearest corner of the triangle you hit, so you do not have
  to hit the corner precisely.
- The target must be a different subcomponent. Parts already joined — directly or
  through a chain — are one thing and cannot be re-connected.
- The button is disabled once everything is joined into one solid.

Deleting a connection (× in the list) takes the assembly apart and **slides the
freed half clear**, along whichever axis it has least to travel to escape. It
also clears every measurement if the deletion split the assembly, because a
measurement only means something on the joined solid.

Hovering a connection row marks the joint in every view.

### 3. Measure

**Select Edges** — enabled only when everything is one solid (a single uploaded
solid counts).

Click edges in any view, or click a dimension guide in a projection. Clicking
again deselects. Picking one arris of a block extent picks **all four**: they all
run between the same two coordinates and all state the same measurement.

Type a formula — the `#variable` chips insert references — and press **Done**.
The button stays disabled until the formula resolves.

What a measurement does: it tells the editor that *this span*, in world-axis
terms, **is** that formula. Every block whose extent covers that span is now
sized by it, and every span reachable by a chain of measured spans is now
derivable.

Editing a formula in the list re-cuts the model live. × removes it. Hovering a
row highlights its edges in every view.

### 4. Read the drawing

| Appearance | Meaning |
| --- | --- |
| Solid line | Visible edge |
| Dashed line | Hidden edge (behind material) |
| Plain number | Measured off the model — nobody set it |
| Underlined, green | A value the designer set |
| Underlined, yellow, in parentheses | A reference dimension — implied by the ones that were set |

Feature dimensions chain below the drawing and to its left; the overall size
rides above and to the right. Nothing has an overall size until the parts are one
solid.

A number that has no room at the current zoom is simply not drawn — zoom in and
it reappears.

**Once anything has been measured, the model's own edges are colour-coded too**,
in all four views, so what is still undecided is visible at a glance:

| Edge colour | Meaning |
| --- | --- |
| Green | You set this length |
| Yellow | You did not set it, but it follows from what you did |
| Red | Nothing determines it — it is still whatever the solid was drawn at, and a variable edit will not move it |

Before the first measurement everything would be red, so the edges stay ordinary
blueprint blue until then.

The sidebar uses the same two colours: rows in **Measurements** are green
(values you set), rows in **Implied** are yellow (values nobody typed that
nevertheless follow from the ones they did).

A measurement whose value turns **red with a `!`** is one the geometry cannot
grant: no block extent is free to be re-cut to it, so the part is still the size
it was. Hover it for the length the model actually has there. This is the usual
reason an edge stays red after you have measured it — set the overall width of a
frame whose rails are still fixed numbers and there is nothing to give. Measure
the parts the length is made of (both ends of the frame, say) and the one
between them implies, at which point the overall size is honoured and goes
green.

### 5. Save

**Save (overwrite)** or **Save (copy)…** from the [file menu](#the-file-menu)
writes `<name>.component.json` — the recipe, plus a baked preview. See
[component-file-format.md](component-file-format.md).

**Clear**, in the sidebar, empties the bench and disposes the geometry. It stays
there rather than moving to the menu because it writes nothing — it is an edit to
what is on the bench, not a file action.

# Textures

```
┌───────────────┬───────────────┬──────────────────┐
│      3D       │      Top      │ ▾ Timber         │
├───────────────┼───────────────┤ ▾ In the log     │
│     Side      │     Front     │ ▾ Rings          │
└───────────────┴───────────────┴──────────────────┘
```

The same four views as the other two tabs, over a fixed bench: **four 200 mm
beams at 5, 10, 20 and 40 mm section**, all parallel, all cut from one log.

Four sticks rather than the usual material-preview ball, because the two
questions actually being asked are *does the grain run the length of the piece*
and *does its cut end agree with the sides* — and a ball has neither a length nor
an end. Four of them because the same wood has to work at four scales: a ring
spacing that looks handsome on the 40 mm post is often far too busy on the 5 mm
kumiko strip, and here they are side by side.

The projections are what settles it. **Side** looks along the beams, so it *is*
the end grain, at the same moment **Top** and **Front** are showing the long
faces. If the rings on the ends and the figure on the sides agree, they agree
because they are slices of one continuous volume — the texture is solid, not a
picture wrapped on.

## The panels

| Panel | Sets |
| --- | --- |
| **Timber** | Species preset, finish, the two grain colours, and how strongly the rings show. |
| **In the log** | Which part axis is the grain, how many millimetres a texture unit is, how far off the pith this piece was sawn, and the seed. Reports the real ring pitch and pith distance in millimetres underneath, which are the numbers worth judging a setting by. |
| **Rings** | Ring density, the width and depth of the dark line, how much consecutive rings vary, and how disturbed the wood is near the heart. |
| **Wander** | The three passes — broad, medium, fine — that turn perfect circles into wood. |
| **Figure & pores** | Broad blotching, and the open pores of a ring-porous timber. Pore strength 0 switches a 27-tap voronoi off entirely, which is much the cheapest thing on the panel. |
| **Surface** | Roughness and clearcoat. Set by the Finish picker; here to be nudged afterwards. |

Picking a **species** loads that timber's numbers but leaves where the piece sits
in the log alone — swapping oak for walnut should not also move the board, or the
change reads as two changes at once.

**Seed → New** takes another board out of the same log. Any integer works and the
same seed always gives the same board, which is what makes a saved texture
reproduce exactly.

Two settings decide whether it looks like anything at all:

- **Scale (mm)** has to keep a part well under one texture unit. The species
  numbers are calibrated for an object about a unit across, and below roughly
  60 mm per unit the grain warp starts to outrun the part and the figure turns to
  static.
- **Rings / unit** together with the scale is the real ring pitch, reported
  underneath. About 4.7 mm at the defaults — six or seven rings across a 40 mm
  post, and barely one across a 5 mm strip, which is what a 5 mm strip really
  looks like.

**Reset** returns the bench to the default white oak.

Save writes `<name>.texture.json` — the parameters and nothing else, no image.
See [texture-file-format.md](texture-file-format.md).

# Assets

```
┌─────────────────────────────────────────────┐
│ COMPONENTS  4                               │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│ │ ╱▔▔▔▔╱ │ │ ╱▔▔▔▔╱ │ │ ╱▔▔▔▔╱ │  turning  │
│ │╱____╱  │ │╱____╱  │ │╱____╱  │  models   │
│ │ leg     │ │ beam    │ │ frameH  │         │
│ │ 5▣ ■solid│ │ 5▣ ■solid│ │3▣ ⚠3 unm│        │
│ │ Load Del│ │ Load Del│ │ Load Del│         │
│ └─────────┘ └─────────┘ └─────────┘         │
│ LAMPS  1     TEXTURES  3                    │
└─────────────────────────────────────────────┘
```

Every file in `public/models/components`, `…/lamps` and `…/textures`, as a card
with a small model turning on it. The three file menus list the same files by
name, which is the right shape for opening something you already have in mind and
the wrong one for *browsing* — every component in the library is a box assembly,
so a still thumbnail of one is a rectangle, and a name is all a list can offer.
One slow revolution is what makes a leg tell itself apart from a rail.

What the preview is, per kind:

| Kind | Preview |
| --- | --- |
| Component | The picture baked into the file when it was saved, wearing whatever texture or flat colour the file dresses it in. No variables are read: this is the component as it is *in the library*. |
| Lamp | Every part of every instance, laid out at the lamp's own saved variables. |
| Texture | A 10 × 10 × 200 mm beam with the grain along its length, so the two small faces are end grain — the long faces show the figure and the ends show the rings that produced it. |

All of them are drawn by one WebGL canvas, the same way the four view cells are:
a canvas per card would run a page out of contexts on the first library worth
browsing.

The badges are the things a file name cannot tell you. They are **derived**, not
read off the file: a component records how well each size was pinned down at the
moment it was saved, and that note can be stale — `frameHorizontal` records three
literal heights and opens with every size determined, because a measurement in
the same file covers them. The card replays what the editor will say, so the
badge and the drawing agree.

| Badge | Means |
| --- | --- |
| **5 ▣** | How many parametric blocks a component has, or how many components are on a lamp. |
| **⚠ 3 unmeasured** | Three of this component's sizes are determined by nothing: no measurement states them and no chain of measurements reaches them, so they stay at the millimetres the solid was drawn at when the lamp changes size. **Implied sizes are not counted** — an implied size is what the measurements that *were* made already say, worked out by the span solver, and it scales like any other. Most components have some by design; none of the ones this project ships raises this badge, which `src/lib/__assetscheck.ts` holds them to. |
| **⚠ 2 missing** | This lamp names components the library no longer has. Those instances are not in the preview, and will not be there when it is loaded either. |
| **■ solid** | The component names no texture, so it is drawn in the flat colour shown in the swatch. |
| **▤ walnut-satin** | It is made of that texture. `▤ bench` means it is pointed at the Textures bench rather than at a saved file. |
| **⚠ unreadable** | The file is there and is not a design this app can read. Shown rather than hidden, so a file missing from every other picker has somewhere to say why. |

**Load** opens the asset on the tab that owns it — a component in the Component
Editor, a lamp in Lamp Design, a texture on the Textures bench — and switches to
that tab. It is the same loader the tab's own file menu uses, so a design opens
the same way whichever list you picked it from.

**Delete** removes the file from the library. It arms on the first press
(**Delete?**) and goes on the second. It is the one thing in the app that
*requires* a connected repository: saving without one falls back to a download
you drop into `public/models/…` by hand, and there is no equivalent gesture for
taking a file out of a site your browser only reads. Without a token the button
is greyed and says so.

> A delete is a commit, like a save, and like a save it does **not** rebuild the
> site — `public/models/**` is ignored by the deploy workflow. With a token you
> are reading the branch, so the file is gone from your pickers at once; another
> visitor reads the build and still sees it until the site is next published.

**Refresh** re-reads all three libraries.

## Why some buttons are disabled

| Disabled | Because |
| --- | --- |
| Select Edges | Nothing loaded, a pick is already in progress, or the parts are not yet joined into one solid. |
| Add Connection | Fewer than two subcomponents remain, or a pick is in progress. |
| Done (measurement) | No edges selected, or the formula does not resolve. |
| Select Face / ↺ / ↻ | Nothing loaded. |
| Clear | Nothing loaded. |
| Save (overwrite) / Save (copy) | Nothing on the bench to save. |
| Delete (Assets) | This browser has no repository token, and a page cannot remove a file from a site it only reads. |
| Load (Assets) | The file is there and cannot be read as a design. |
| Save, in the name dialog | The name is empty once the characters a file cannot carry are taken out of it. |
| ⚭ (Lamp) | A connect pick is in progress on a different component. |
| ❖ (Lamp) | Every place the symmetry reaches already holds this part. Greyed rather than removed, and still hoverable — see above. |

**Insert component** is never disabled: opening it is what re-reads the component
folder, so a disabled button would be a dead end for the one case it would be
describing — an empty library that has since gained its first component. An empty
library says so inside the dropdown instead.

Any pick in progress can be abandoned with **Cancel** in the status strip at the
top of the sidebar.
