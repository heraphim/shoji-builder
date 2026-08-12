# Component file format (`*.component.json`), version 5

`src/lib/componentFile.ts`

## The premise

**A saved component is a recipe, not a snapshot.**

Each part is a box stated as three formulas — one per world axis — in terms of
the design variables. Each joint is a point on one box brought onto a point on
the next, named as a *fraction of the box* rather than as a coordinate. Nothing
in that description mentions a millimetre that was only true on the day it was
exported, so loading it at different variable values gives a different, correct
component instead of the old one at the old size.

## Schema

```jsonc
{
  "id": "frame",                    // derived from the first mesh's file name
  "type": "component",              // the load guard checks this
  "format": 5,                      // COMPONENT_FORMAT
  "units": "mm",

  // The variables the formulas are written against, so the file resolves on
  // its own. Transitively closed: a formula reaches every variable it names,
  // and everything those name in turn.
  "variables": {
    "frameWidth": "7",
    "innerWidth": "200"
  },

  "blocks": [
    {
      "id": "d3a065c3-…",           // stable; connections reference it
      "name": "frame.stl (1)",
      "size": {                     // one formula per WORLD axis
        "x": "#frameWidth",
        "y": "1/2*#frameWidth",
        "z": "#frameWidth"
      },
      // Which tier of `deriveBlocks` each of those came out of. The formula
      // alone cannot say: "#frameWidth" reads the same whether the designer
      // measured that span or the solver chained to it. Only "set" is a
      // decision, and only "set" comes back as a measurement on load.
      "sizeSource": { "x": "set", "y": "implied", "z": "literal" },
      // The block's low corner, in mm from the assembly's own low corner, at
      // the variable values in `variables`. Deliberately NOT load-bearing:
      // connections decide the layout, and this only places a part no
      // connection reaches.
      "origin": [0, -7, 0]
    }
  ],

  "connections": [
    {
      "id": "…",
      "a": { "block": "d3a065c3-…", "anchor": [1, 0, 0] },
      "b": { "block": "e4924d6b-…", "anchor": [0, 0, 0] }
    }
  ],

  // Measurements that are NOT simply a block's own size — spans across the
  // assembly, skew edges. A measurement that *is* a block size is already
  // stated in `blocks`; writing it twice would let the two drift apart.
  "measurements": [
    { "id": "…", "formula": "1/2*#innerWidth",
      "edges": [ { "start": [0,0,0], "end": [100,0,0] } ] }
  ],

  // How it is drawn. The only part of the file that says nothing about the
  // shape — nothing here can change a size. Optional: absent means the
  // defaults, so a format 4 file still loads.
  "appearance": {
    "solidColor": "#1e4179",              // views set to Solid
    "texture": "white-oak.texture.json",  // a library file, or null
    "grainAxis": "y"                      // which component axis the grain runs along
  },

  // Baked geometry for anything that only wants to LOOK at the component —
  // the Assets tab's turning card is what it is for. Ignored on load, which
  // rebuilds every block from the formulas instead.
  "preview": {
    "variables": { "frameWidth": 7, "innerWidth": 200 },   // resolved values
    "solids": [ { "vertices": [x,y,z, …], "triangles": [i,j,k, …] } ]
  }
}
```

### Anchors

`[0, 0, 0]` is the box's low corner, `[1, 1, 1]` its high corner, `[0.5, 0, 0.5]`
the middle of the bottom face. Written through `roundAnchor`: snapped to exactly
0 or 1 within 1e-4, then 4 decimals. A file that says `0.9999` would read as if
the joint were deliberately inset.

### Everything positional is relative to the assembly

Origins, measurement edges and the baked preview are all stated **from the
assembly's own low corner**, computed as the minimum of every mesh's world box.
Where the STL was drawn is not a property of the component, and a file that
carried it would make two components that should butt together load metres
apart.

All coordinates are rounded to 4 decimals (`DECIMALS`).

## Saving — `buildComponentFile()`

```
1. bindings ← deriveBlocks(meshes, measurements)     # the size recipe
2. used ← transitive closure of every variable named by any size formula
          or measurement formula
3. blockSpans ← every spanKey a block size is bound to
4. anchor ← min corner over every mesh's world box
5. blocks:        one per mesh that HAS a binding (i.e. that is a box);
                  size formulas plus the binding's `source` per axis
6. connections:   ids + rounded anchors
7. measurements:  edges filtered to those whose span is NOT a block span;
                  a measurement left with no edges is dropped entirely
8. appearance:    verbatim from the editor's store
9. preview:       one solid per joined group, CSG-merged, welded and indexed
```

A solid that is not a box has no parametric description, so it is **left out of
`blocks`** rather than saved as a size it cannot honour. It still contributes to
the preview.

`toIndexed` welds coincident vertices by rounded position, so the file carries
each corner once instead of once per triangle that touches it.

The file menu then hands the result to `saveLibraryFile` (`lib/library.ts`),
which either commits it to the repository or downloads it — see
[the library](#the-library).

## Loading — `loadComponentFile(data)`

```
1. validate: type === "component" and blocks is a non-empty array
2. merge variables: for each variable in the file,
       already defined in the current design → keep the design's value
       otherwise                            → add the file's
   (the design always wins — that is the point of saving formulas)
3. map to LoadedBlock / LoadedConnection and call
   useComponentEditorStore.loadBlocks(...)
4. setAppearance(readAppearance(file.appearance))
5. return a LoadReport: block count, connection count, added and kept variables
```

### What `loadBlocks` does

```
dispose every geometry currently on the bench     # a load REPLACES the bench
for each block:
    sizes ← evaluateAll(size formulas, current raw variables) ?? [1,1,1]
    geometry ← box of those sizes, low corner at the origin
    translate to the block's `origin`
for each connection:
    vertices ← pointOfAnchor(anchor, that block's local box)
applyOffsets(...)                                 # the connections lay it out
measurements ← the file's extra measurements
             + one per block axis whose sizeSource is "set",
               skipping any span those measurements already state
reset pick state, rotation, zoom and pan
rebuildBlocks()                                   # the formulas have the last word
```

### Why the load ends in a rebuild

`size` is a snapshot; the measurements are the decisions. The two can disagree —
a designer sets a span to `#beamHeight` while the solid is still drawn at the
height it came in at, and nothing re-cuts it until a variable moves. Saved that
way, the file states `y: 10` next to a measurement saying the height *is*
`#beamHeight`, which is 15.

So the load finishes by re-deriving every size from the measurements at the
current variable values, exactly as a variable edit does: a loaded component
always matches its own formulas. A file that already agrees with itself passes
through untouched — `rebuildBlocks` no-ops when no size changes, which is the
case for every component this project ships.

That last step is what makes a loaded component **as editable as one built from
scratch**: every size the designer decided comes back as a visible, editable
measurement hanging off the re-generated `blockSizeEdge` — along the measured
axis, on the block's low corner in the other two — rather than floating where it
was first picked.

### Why only `"set"`

An implied size is not a decision; it is what the decisions already say. Written
back as a measurement it would claim the designer set it, and since a saved file
states *every* block size, a loaded component came back with its whole drawing
green — `buildEdgeClassifier` had nothing left to call implied. So an implied
size is left as a formula on the block only: once the component is on the bench,
the span solver derives it again from the measurements that did come back, and
the edge reads yellow exactly as it did before the save.

A span is skipped if a measurement in the file already states it — identity is
by span here as everywhere else, so two identical parts sharing an extent, or a
cross-assembly measurement that lands on one, give one row rather than two.

A **format 3** file carries no provenance and cannot be given any after the
fact, so it keeps the old guess: anything that is not a bare literal is treated
as set.

## The library

`public/models/components/`, read and written through the one module every
library goes through — `lib/library.ts`, which has two modes.

**Without a token** the listing comes from `index.json`. The folder has no
directory index of its own, so the `library-index` Vite plugin
(`vite.config.ts`) serves one — read per request in dev, so dropping a file in
shows up on the next open, and emitted as a build asset for `dist`. **Save**
downloads the file for you to drop into the folder by hand.

**With one** (Library settings, at the foot of the file menu) both directions go
through GitHub's contents API against the branch: a save is a commit, and a read
is of the branch rather than of the deployed site, so what you open is what you
last saved rather than what the last build shipped.

```
listLibraryComponents()      → listLibrary("components")            → string[]
loadLibraryComponent(name)   → readLibraryFile("components", name)  → LoadReport
```

A component can also be opened straight off the user's own disk — **Upload…** in
the tab's file menu, which parses the JSON and calls `loadComponentFile` with it.
The library is where components are *kept*; it is not the only way in.

## Round-trip guarantees

| Property | Survives a save/load? |
| --- | --- |
| Block sizes as formulas | yes — re-evaluated at load time |
| Joints | yes — anchors are resize-invariant |
| Which sizes were set and which merely follow | yes — `sizeSource` |
| Measurements of a block extent | yes — regenerated from the bindings marked `set`, one edge per span |
| The other edges a measurement was picked on | no — a block-size measurement comes back on its `blockSizeEdge` alone |
| Cross-assembly and skew measurements | yes — in `measurements`, coordinates relative to the assembly |
| Non-box solids | no — dropped from `blocks`, preview only |
| Model rotation | no — a loaded component starts at identity |
| Which parts were which STL file | by name only |
| Colour, texture and grain axis | yes — `appearance`, from format 5 |

## Version history

| `format` | Notes |
| --- | --- |
| 5 | Current. Adds `appearance` — colour, texture and grain axis. Purely descriptive: nothing in it can change a size. |
| 4 | Adds `blocks[].sizeSource`, so a load can tell a size the designer set from one the solver worked out. Still loads; `appearance` falls back to the defaults. |
| 3 | Sizes as per-axis formula strings; anchors as box fractions; variables embedded; `preview` baked and ignored on load. Still loads — every non-literal size is guessed to be set. |

The version number is not a gate: `loadComponentFile` checks `type` and the
shape of `blocks`, so a file is read as far as its fields allow and anything it
does not carry falls back.

## `appearance`, and why it names a texture rather than carrying one

`texture` is a **file name in the texture library** (or the sentinel for the
Textures bench), not a copy of the wood's parameters. So editing a texture
changes every component made of it, which is the behaviour anyone who has ever
changed their mind about a timber wants, and a texture is stored once rather
than once per component.

The cost is that a component can name a texture the project does not have — it
came from somebody else's library. That is handled rather than prevented: the
name is kept, the Texture panel lists it as *(not in library)*, and the part
draws in its solid colour until the file turns up. Resetting it silently would
lose the only record of what the component was meant to be made of.

`grainAxis` lives here rather than on the texture because which way a part is cut
out of the board is a property of the **part**. A stile and a rail can be the
same oak and still have their grain at right angles; that is the difference
between them.

Validation is field by field, and a malformed value falls back to the default
rather than failing the load. The geometry is the component: refusing to open one
because somebody hand-edited its colour to `blue` would be losing the part over
the paint.

Format and meaning of the texture files themselves:
[texture-file-format.md](texture-file-format.md). How the texture is drawn:
[algorithms/wood-texture.md](algorithms/wood-texture.md).
