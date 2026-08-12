# Architecture

## Layers

```
                    ┌──────────────────────────────────────────┐
   React UI         │ App.tsx ─ Showcase (default)              │
                    │         └ tabs ─ Lamp Design / Component  │
                    │                  Editor / Textures /      │
                    │                  Texture Generator/Assets │
                    └───────────────┬──────────────────────────┘
                                    │ hooks / actions
        ┌───────────────────────────▼──────────────────────────┐
   State│ useVariablesStore   useComponentEditor   useLampStore │
 (zustand)  raw formulas       meshes               instances   │
        │   pairs / stashed    connections          connections │
        │                      measurements         (anchors)   │
        │                      appearance          useTexture   │
        └───────────────────────────┬──────────────────────────┘
                                    │ pure functions
                    ┌───────────────▼──────────────────────────┐
   Domain (src/lib) │ formula  blocks  measure  rectangles      │
                    │ assembly picking componentFile  lamp      │
                    │ symmetry wood  woodMaterial  textureFile  │
                    │ assets                                    │
                    └──────────────────────────────────────────┘
```

The first three tabs are the model's three levels: a lamp is made of components,
a component is made of a material. Textures is the only one of them that changes
no geometry at all, and **Texture Generator** is that same level approached from
the other end — whole woods rolled and kept or discarded, rather than one
designed by hand. It owns no store: the candidate is page state, and the only
thing it shares is the texture library it writes into.

**Assets** is not a level but a cross-section — every file all three libraries
hold — and owns no store: it reads the libraries, and loading anything from it
calls the same loader that tab's own file menu calls.

Everything under `src/lib` is pure and side-effect free apart from `library.ts`,
which is nothing but I/O — it is where `fetch`, `localStorage` and the download
anchor are allowed to live — `rollJournal.ts`, which holds a buffer, a timer and
two window listeners on purpose, because they have to outlive the page that
fills them — and `componentFile.ts`, which reads the two stores.
`lampFile.ts` reads no store: its format functions take what they need as
arguments, so the lamp store can own the fetching without an import cycle. The
stores hold state; the libraries hold the arithmetic.

## Module map

### `src/lib`

| Module | Responsibility |
| --- | --- |
| `formula.ts` | The variable expression language: tokenize → parse → evaluate, plus dependency-ordered resolution of a whole variable dictionary. |
| `blocks.ts` | Everything about a part *being a box*: is this geometry a box, build a box, convert a point ⇄ a fractional anchor on a box. |
| `measure.ts` | Spans (an axis + two coordinates), the span solver that derives unmeasured values, stations (where the solid has faces), runs (where the solid has material), and a raycast helper. |
| `rectangles.ts` | Minimum partition of a rectilinear polygon (with holes) into axis-aligned rectangles. |
| `assembly.ts` | CSG union of joined parts, face-topology extraction, outline recovery, solid retessellation, hidden-line splitting, parallel-edge lookup. |
| `picking.ts` | Raycast-hit helpers (nearest vertex, world normal, world triangle), STL island splitting, bounding volumes, orthographic camera basis. |
| `library.ts` | The one place that knows where the three libraries are read from and written to: the deployed site, or — when this browser has been given a token — the GitHub branch itself, where a save is a commit and a delete is a commit. Holds the settings and all the I/O. `commitFiles` is the exception to one-file-one-commit: any number of files as a single commit, over the git data API. |
| `rollJournal.ts` | Every roll the generator shows, kept or rejected, buffered to localStorage and pushed as one commit five seconds after the clicking stops. Module state rather than component state, so leaving the tab does not strand the batch. Rejects go to `public/models/textures-rejected`. |
| `componentFile.ts` | Serialise the editor to `*.component.json` and load it back. Owns the file format. |
| `lampFile.ts` | The same one level up: the `*.lamp.json` format — which components are on the lamp and how each is fixed on. Pure; the store does the fetching. |
| `lamp.ts` | The assembly layer above the editor: the main box, cutting a saved component at the current variables, the outline of a union of boxes, projected construction edges, two-point alignment, clearance sweeps, feature-point picking. |
| `symmetry.ts` | The main box's eight rigid turns, the places a connection reaches under them, and the roll each copy needs. Builds on `lamp.ts`; nothing depends on it but the lamp store and the lamp view. |
| `surfaces.ts` | The room's three non-timber materials — woven cloth, plaster and creased paper — as solid textures read in object space, with the bump taken from screen derivatives of a height function rather than from a normal map. Nothing in this app has UVs, which is what rules a map out; the file's own notes cover the band-limiting that keeps a 3 mm weave from aliasing into corduroy. |
| `ricePaper.ts` | The showcase's paper: the washi sheet as a tiling canvas texture, the five-faced shell it is stretched over — derived from the main box, so it follows the variables like everything else on the lamp side — and a material whose emissive falls off with distance from the bulb behind it. |
| `showcaseStyles.ts` | The eight styles the showcase can be drawn in, and which of them are built. One id keys the scene, the chrome in front of it, and the look below. Deliberately shader-free: the menu imports it. |
| `showcaseLook.ts` | What each style does to the room, as numbers — how much light the painter decided was in it, how much of the timber's grain survives being drawn, and which treatment goes over the top. |
| `paint.ts` | The one post-process every drawn style is made of: a tone curve, a posteriser, an outline detector that reads the second difference of depth, a watercolour bleed and a sheet of paper. Seven styles, one shader, eighteen uniforms. |
| `woodRandom.ts` | One wood the presets do not contain: picks a species and walks away from it inside bounds that are still timber, aims the finished lightness so a gloss on a dark species is dark rather than black, and names the result species-finish-seed. |
| `testBeams.ts` | The four 200 mm sticks a texture is judged on — 5, 10, 20 and 40 mm section, parallel, cut from one log, with their positions baked in so each samples a different place in it. Shared by the Textures tab and the generator. |
| `wood.ts` | What a wood texture *is*, as data: the parameter set, the ten species presets and four finishes taken verbatim from three.js's `WoodNodeMaterial`, and the seed. No three.js, no shader — just numbers, because the numbers are what gets saved. |
| `woodMaterial.ts` | Those numbers as something the renderer can draw — including the grain's *relief* and the gloss difference between earlywood and latewood, both derived from the same ring field the colour comes from: the solid-texture GLSL, injected into a `MeshPhysicalMaterial` through `onBeforeCompile`, plus the object → texture-space matrix. The one file that would be replaced wholesale by `WoodNodeMaterial` if the app ever moved to `WebGPURenderer`. |
| `textureFile.ts` | Serialise a texture to `*.texture.json` and read it back, field by field against the defaults. Owns that format. |
| `assets.ts` | All three libraries read as things to *look at*: one catalogue entry per file, cut down to what a card shows (how many sizes nothing measures, what it is dressed in, which components a lamp is missing), plus the geometry each preview draws. Loads nothing onto a bench — that stays with the three loaders above. |

### `src/store`

| Store | Holds |
| --- | --- |
| `useVariablesStore` | `raw: Record<string, string>` — every design variable as an unevaluated formula string. Plus the *pairing* mechanism (width/depth square by default). |
| `useComponentEditorStore` | `meshes`, `connections`, `measurements`, the current pick mode, the accumulated model rotation, and per-view zoom/pan. |
| `useLampStore` | The inserted component `instances`, each one's connection *anchors*, the parked position of the ones with none, which are hidden (`hiddenIds` — a way of working on a design, so not a flag on the instance and not in the saved file), the two library listings (components, saved lamps), and the five-click connect draft
(the middle click names the target and hides everything else). Plus two pointers into that list for the scene to highlight — `highlightedId` (row hovered) and `symmetryPreview` (row whose ❖ is hovered). No geometry — see below. |
| `useViewportStore` | The view chrome, one store per tab (`useEditorViewports`, `useLampViewports`, `useTextureViewports`): which views are on screen and in what slot order, each one's material, geometry and axis-triad draw settings, the saved 3D orbit, and the projections' zoom/pan. The first two of those — the *arrangement* — are written through to `localStorage` under a key per tab; the orbit and the framing are not, being facts about the model that was on the bench rather than about how the user works. The editor keeps its own zoom/pan in `useComponentEditorStore` instead, because turning a component resets it — that framing is part of the model edit, not part of the chrome. |
| `useLookStore` | How the whole app is lit (ambient / key / fill) and the two cues that stand in for arrises — contact shadows and the faint outline. One store for every tab, unlike the viewports: a face turned away from the key is hard to read everywhere for the same reason. Written through to `localStorage`. |
| `usePanelStore` | Which sidebar panels are folded, keyed by a stable per-panel id and written through to `localStorage`. |
| `useTextureStore` | Two things that are two views of one idea: the **bench** — the texture being designed on the Textures tab, which the sliders write straight into — and the **library**, every saved texture the project ships, cached once fetched, which is what a component picks from. The bench is offered to components too, under `BENCH_TEXTURE`, so a slider drag on one tab redraws a component on another. |
| `useFileStatus` | What the last file action had to say. It is a store because the two halves are no longer in the same place: the actions are in the tab's file menu, and their report belongs beside the work. |

### `src/components`

| Component | Role |
| --- | --- |
| `FileMenu` | All three tabs' file menus, under the tab caret: upload, load from the library, and the two saves — plus the name dialog with its overwrite check. The only place a design is opened or written. Its header comment is the spec for what "overwrite" will mean once there is somewhere to write to. |
| `FileStatusBar` | The strip above the views: what the last file action did, and what is on the bench. |
| `LibrarySettings` | The panel behind **Library settings…**: the four fields that turn the saves on at all, checked against GitHub before they are kept. Kept in this browser and nowhere else — which is the whole security model. |
| `CollapsiblePanel` | One sidebar panel, on every tab. Folds from its header; the state is remembered by `usePanelStore`. |
| `ViewportGrid` | The view grid, shared by all three tabs: one to four cells over a single `<Canvas>`, the per-cell header (draw modes, minimise, drag-to-swap slots), the minimised strip, and each cell's measured pixel size. |
| `ShowcasePage` | The page the app opens on, and the only one that is not a bench: the lamp in a room, with the lamp picker, the two light switches, the style menu, Editor, zen and the Width/Height sliders over it. Holds only the style and the switches; the lamp it shows is the lamp on the bench. Its own `<Canvas>` rather than a cell in `ViewportGrid` — an `EffectComposer` takes over the render loop, which is exactly what the scissored `<View>`s cannot survive. |
| `ShowcaseScene` | The one scene every style is drawn from: the bulb inside the shade and the paper shell around it, the pendant, what comes through the window, the room, the bloom, and a camera framed on the lamp once rather than on every slider frame. Four switchable sources, and the notes on each say what its numbers mean — candela at millimetre scale runs to the millions, and the shadow bias has to be read together with the blur radius. What each style does to it is a block of numbers in `lib/showcaseLook.ts`, not a branch here. |
| `ShowcaseProps` | Downloaded furniture: loads a `.glb` from `public/models/props/`, swaps its materials for the room's own, and fits it by size-and-anchor rather than by a written-down scale factor — so replacing the file re-fits it. The fit is baked into the **vertices**, not the node, because every material in this room is a solid texture in millimetres and a node scale does not reach one. The models bring geometry only; their texture sets are stripped in conversion, because the cloth and wood shaders here need no UVs and cost no bytes. |
| `ShowcaseRoom` | The bedroom, out of boxes and cylinders: walls, ceiling, pendant, a window in the side wall with a shoji screen slid across it, and the painting hanging behind the lamp. The nightstand and the bed are the two things in here that are not boxes — see `ShowcaseProps`. |
| `LampDesignPage` | The Lamp tab: the status strip, the view grid, and the sidebar. |
| `LampView` | The lamp scene — main box, every instance, the connect pick overlay, the symmetry preview overlay — and the two cameras that draw it: `LampScene3D` and `LampOrthographicView`. `ShowcaseLamp` is the same parts with no camera, light or floor of its own, for a showcase style to put in a room of its choosing. |
| `LampSidebar` | Two collapsible panels: variables (with sliders) and components (insert / delete / copy / connect / roll / fill symmetry). Opening and saving a lamp is in the file menu. |
| `ComponentEditorPage` | Status strip + views + sidebar. |
| `ComponentEditorViews` | The editor's half of the grid: which scene each cell draws, the per-cell Select Face and rotate buttons, and wheel-zoom / drag-pan wired to the component-editor store. |
| `TexturesPage` | The Textures tab: status strip + views + sidebar. |
| `TextureViews` | Its four views and the test bench in them — see `lib/testBeams.ts` for the sticks. Not a sphere: the two questions being asked are whether the grain runs the length of a piece and whether its cut end agrees, and a sphere has neither a length nor an end. |
| `TextureGeneratorPage` | The Texture Generator tab: a random wood on the showcase nightstand with the test sticks on it, and two buttons. Both verdicts go to `rollJournal.ts` and roll again — neither waits for a write. One studio scene, mounted once, so the camera survives every roll. |
| `TextureSidebar` | Every generator control, grouped the way a timber is described rather than the way the shader is written: which tree, where in the log, the rings, how they wander, the figure, the finish. |
| `PartSurface` | The two hooks that decide how a solid is painted, shared by all three tabs: `useWoodMaterial` (build once, write uniforms in place, so a slider drag does not recompile the program) and `usePartTexture` (resolve a texture *name* to parameters, overriding its grain axis with the part's). |
| `PerspectiveView` | 3D cell: camera framing, lights, grid, `<UploadedMesh>`, OrbitControls. |
| `OrthographicView` | One projection cell: blueprint grid, hidden-line projection, dimension chains, pickable edges, axis triad. |
| `UploadedMesh` | The merged solids themselves plus every hover/selection overlay, and the edge-picking hooks shared by all four views. |
| `ComponentEditorSidebar` | Connections panel, measurements panel, implied-values panel, and Clear. All collapsible; saving is in the file menu. |
| `VariablesList` | The variable table (shared by the Lamp tab and, potentially, the editor). |
| `AssetsPage` | The Assets tab: the catalogue as sections of cards, the badges, Load (into the tab that owns the design) and Delete (the one action that needs a token), over one `<Canvas>` for every preview. |
| `AssetPreview` | One card's turning model — a `<View>` on that shared canvas — and the camera that frames its swept sphere so nothing leaves the cell mid-turn. |
| `AxisTriad`, `TextSprite` | Scene-space widgets that work inside scissored `<View>`s (drei's `GizmoHelper` and HTML overlays do not). |

## Data flow

### The variable → geometry loop

1. The user edits a formula in `VariablesList` → `useVariablesStore.setVariable`
   replaces `raw`.
2. A subscription at the bottom of `useComponentEditorStore.ts` notices `raw`
   changed and calls `rebuildBlocks()`.
   *It lives in the store module, not in a component, so an edit made on the
   Lamp tab applies immediately even though the editor is not mounted.*
3. `rebuildBlocks` re-derives each block's size formulas
   (`deriveBlocks`), evaluates them at the new values, rebuilds the box
   geometries, replays the connections, and moves the measurement edges onto the
   re-cut parts.
4. `useMergedGroups` re-unions each joined group, and every view re-renders from
   that.

### The lamp's variable → layout loop

The lamp side holds **no geometry at all**. `useLampStore` keeps the instance
list, each instance's connection as four *anchors*, and a position for the ones
that have been disconnected; `computeScene(instances, raw)` rebuilds the main
box, cuts every part and resolves every placement on each render.

So there is no rebuild step and no subscription to keep in step — a variable edit
re-renders, and everything anchored to the box follows it for free. The one thing
that is stored positionally is a *disconnected* instance's placement, because
that is where the user put it.

→ [algorithms/lamp-assembly.md](algorithms/lamp-assembly.md)

### Symmetry, and why it stores an id

The ❖ button copies a part to every place the box's symmetry says it also
belongs. Both halves of that follow the same no-stored-geometry rule as the rest
of the lamp side:

- A symmetry operation is a map on **anchors** — a permutation-with-flips of
  three fractions — so it never mentions a size and survives a variable edit for
  free, exactly like the joints it maps.
- The hover preview stores only `symmetryPreview`, the **id of the row being
  hovered**. `LampView` re-derives the places from that id and the main box on
  every render, so dragging a size slider with the preview up moves the lines
  with the box.

The split between `planSymmetryFill` (instances + main box, no scene) and
`symmetryCopies` (needs a laid-out scene) exists for the sidebar: the first is
cheap enough to ask once per row on every render, the second runs once, when the
button is pressed.

→ [algorithms/symmetry-fill.md](algorithms/symmetry-fill.md)

### The merged-solid cache

Five components want the merged solids: the 3D view, the three projections, and
the sidebar's implied-values panel. A per-caller `useMemo` gave each of them its
own CSG union of the same parts — five unions, five retessellations and five
outline extractions per rebuild, on the slowest path in the app.

`computeMergedGroups` (module scope in `UploadedMesh.tsx`) therefore caches the
result against the *identities* of `meshes` and `connections`. Both arrays are
replaced wholesale by the store on every edit, so reference equality is exactly
the right invalidation test.

The cache also gives the geometries an owner. A `BufferGeometry` that has been
rendered holds GPU buffers that garbage collection does not reclaim, so before
this every rebuild leaked a full set of solids — once per frame while dragging a
variable. Superseded solids now go through `releaseSolid`, which disposes the
geometry and every line buffer cached against it — the outline, and the
tessellation wireframe a view set to "all triangles" will have built. Releasing
during render is safe because every subscriber re-renders in the same commit and
asks for the new generation; StrictMode's double-invoke hits the reference check
and releases nothing.

Sharing the geometry objects also fixes a latent correctness issue: edge picking
identifies an edge by its index into that solid's outline buffer, and two views
holding different-but-equal geometries were indexing into two different buffers.

### A cell's size comes from the DOM, not from the `<View>`

Everything inside a drei `<View>` can reach `useThree().size`, and for a
projection that is most of what it needs: the fit-to-cell zoom, the pixel-to-world
conversion the pan uses, and how much graph paper to generate.

That value is not reliable here. drei injects it into the portal from the tracked
element's rect *as of the last render of the View*, while refreshing the rect it
actually scissors with on every frame. The two agree as long as the only thing
that resizes a cell is the window — a root canvas resize re-renders everything —
and come apart the moment a cell is resized by the grid changing shape under it,
which minimising a view or dragging one into another slot both do. The scissor
rectangle stays right either way; what goes stale is the framing computed from
the size.

So `ViewportGrid` measures each cell itself and passes `cellSize` down. The
measurement is taken synchronously in a layout effect and only *updated* by a
`ResizeObserver`: an observer callback is delivered during the rendering steps,
which a page that is not being composited never reaches, and waiting for the
first one left every cell sized zero — and a cell with no size draws nothing.

### The measurement → block-size loop

A measurement is a formula attached to a set of edges. `deriveBlocks` turns the
whole measurement set into a *span solver* and asks it, for each block and each
axis: what is this extent, in terms of the variables?

- **explicit** — the user measured exactly this span → that formula;
- **implied** — a chain of measured spans connects the two ends → the sum /
  difference along the shortest chain;
- **literal** — nothing reaches it → the number it is currently drawn at.

That answer is both what drives the live model and what gets written to file, so
the editor's behaviour and the saved recipe can never disagree.

### Rendering

Every cell shares one WebGL canvas. `ViewportGrid` renders a `<Canvas>`
containing only `<View.Port />`; each cell renders a `<View>` whose DOM node
defines a scissor rectangle. That is also what makes the layout cheap to change:
showing, hiding or reordering a view is a DOM rearrangement and the scissor
rectangles follow it — nothing about the GL context is rebuilt. Consequences
worth knowing:

- Anything that takes over the render loop (drei's `GizmoHelper`) breaks the
  scissoring — hence the hand-rolled `AxisTriad`.
- HTML overlays would not be clipped per cell — hence `TextSprite`, which draws
  text to a 2D canvas and shows it as a sprite.
- The renderer is `WebGLRenderer`, and the wood texture is written in GLSL for
  that reason: three.js's own `WoodNodeMaterial` is a node material and needs
  `WebGPURenderer`, which would mean swapping the renderer under the scissored
  views, the dashed hidden-line overlays and the polygon-offset fills that all
  work today. See [algorithms/wood-texture.md](algorithms/wood-texture.md).
- `eventSource` is the grid container, so pointer events route to the right cell.

## Coordinate conventions

- **World axes are the design axes.** The three projections are fixed world-axis
  views: Top looks down `+Y`, Side along `+X`, Front along `+Z`. "Re-orienting"
  a component rotates *the model*, never the cameras, so what "top" means never
  drifts. The accumulated rotation is kept in `modelRotation` only so that
  late uploads land in the same frame and views know to re-fit.
- **A mesh's geometry is local; `offset` places it.** World box =
  `localBox(geometry).translate(offset)`. Offsets are *derived* from the
  connection list on every edit and must never be treated as authored state —
  anything that has to survive a rebuild goes into the geometry itself (see
  `separateDetachedGroup`) or into an anchor.
- **A rebuilt block grows from its own low corner.** Where it ends up is then
  decided entirely by its connections.

## Invariants

These hold everywhere and most of the code depends on them:

1. Every part the editor can *save* is an axis-aligned box (`SubMesh.block`
   present). Non-box solids can be uploaded, joined and measured, but they are
   dropped from `blocks` on export because there is no parametric description of
   them.
2. `offset` is a pure function of `(meshes, connections)` — `applyOffsets`.
3. Connections form a forest: `pickConnectionVertex` refuses a connection whose
   two ends are already in the same group, so replaying them never fights itself.
4. Measurements only exist while the assembly is one solid. Deleting a
   connection that splits it discards them (`removeConnection`).
5. Anchors are snapped to 4 decimals with 0 and 1 rounded exactly
   (`roundAnchor`) so a joint at a corner stays at that corner across rebuilds.
   On the lamp side an anchor also **names the box its fractions are of**
   (`LampAnchor.block`): a component is several blocks, and a fraction of the
   encasing box only tracks a point on an inner block for as long as the blocks
   keep their proportions — which a variable edit is exactly what ends.
6. **Every symmetry operation is a rigid turn** (`det = +1`). A reflection is not
   something a part can do — no placement equals a body's own mirror image — so a
   copy made by reflecting could only ever be approximated, and the approximation
   loses exactly what you were relying on: a face that sat flush comes back a
   fraction off. `symmetry.ts` therefore leaves out the mirrors and reaches the
   bottom of a face by *turning over*, not by reflecting.

## Where the hard parts are

| Problem | Where | Doc |
| --- | --- | --- |
| Evaluating `1/2*#innerWidth` with dependencies | `formula.ts` | [formula-resolution](algorithms/formula-resolution.md) |
| "What is this dimension, in variables?" | `measure.ts`, `deriveBlocks` | [spans-and-measurements](algorithms/spans-and-measurements.md) |
| Laying parts out from joints alone | `useComponentEditorStore.ts` | [assembly-layout](algorithms/assembly-layout.md) |
| Making a CSG union look like a clean solid | `assembly.ts` | [solid-simplification](algorithms/solid-simplification.md) |
| Cutting an L/T/notched face into few triangles | `rectangles.ts` | [rectangle-partition](algorithms/rectangle-partition.md) |
| Drawing a readable blueprint | `OrthographicView.tsx` | [projection-and-dimensions](algorithms/projection-and-dimensions.md) |
| Copying a part to every place the box's symmetry reaches | `symmetry.ts` | [symmetry-fill](algorithms/symmetry-fill.md) |
| Keeping a joint on the feature it was picked on | `lamp.ts`, `LampAnchor` | [lamp-assembly](algorithms/lamp-assembly.md) |

### Saving and opening a lamp

The Lamp tab's file menu is the whole design's file I/O, and it mirrors the
component library because it is the same idea one level up — a component is a
recipe for a part, a lamp a recipe for an assembly of them.

- **Save** writes a `*.lamp.json` to `public/models/lamps` as a commit through
  GitHub's contents API, and needs a token to do it; **Download** hands the same
  file to the browser, to be dropped in by hand, and needs nothing
  (`lib/library.ts`). The same round trip a component takes.
- **Load…** lists that folder and replaces the bench: instances *and*
  variables, because a lamp is a whole design rather than something added to one.
- Instances name their components rather than embedding them, so a component
  improved since the lamp was saved comes back improved.

→ [lamp-file-format.md](lamp-file-format.md)

## Build-time pieces

`vite.config.ts` adds a tiny `library-index` plugin. None of
`public/models/components`, `public/models/lamps` or `public/models/textures`
has a directory index, so the plugin serves `index.json` for all three in dev and
emits the same listings as build assets. It is the no-token path only: a browser
with a token lists the branch through the contents API instead and never asks for
`index.json` at all (`lib/library.ts`).

The dev listing is `readdirSync` **per request**, so the server never needs
restarting for a new design — but the page fetched it once, on mount, which made
it look as though it did. Every picker therefore re-lists when it is opened:
**Insert component** in `togglePicker` (`LampSidebar`), and each tab's file menu
on mount and again on **Load…**. Fire-and-forget, so the list already on screen
shows straight away. The file menus list on *opening the menu* rather than on
opening the listing because **Save (copy)** checks the same listing for a name
clash, and a clash check with nothing to check against is worse than none.
