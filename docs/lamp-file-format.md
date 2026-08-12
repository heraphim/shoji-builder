# Lamp file format (`*.lamp.json`), version 1

`src/lib/lampFile.ts`

## The premise

**A saved lamp is a recipe, not a snapshot** — the same premise as
[a saved component](component-file-format.md), one level up.

A component file is a recipe for a *part*: boxes as formulas, joints as
fractions. A lamp file is a recipe for an *assembly of them*: which components
are on the lamp, and how each one is fixed on. Neither carries a millimetre that
was only true at one setting of the variables.

The consequence is worth stating plainly, because it is the whole point:

> Opening a saved lamp and dragging a slider gives exactly what building that
> lamp and dragging the slider gives.

A file that had quietly baked one coordinate somewhere would still reload
correctly at the size it was saved at, and would go wrong the moment the design
changed. `src/lib/__lampfilecheck.ts` tests both, and the second is the one that
earns its keep.

## Schema

```jsonc
{
  "id": "example",                  // the file name, minus .lamp.json
  "type": "lamp",                   // the load guard checks this
  "format": 1,                      // LAMP_FORMAT
  "units": "mm",

  // The design's WHOLE raw dictionary — every variable, as an unevaluated
  // formula. Not a transitive closure like a component's: a lamp is the whole
  // design, not a piece being fitted into one.
  "variables": {
    "innerWidth": "200",
    "innerDepth": "#innerWidth",    // a collapsed pair, as the resolver sees it
    "innerHeight": "370"
  },

  // Which pairs are collapsed, and what is parked behind the collapsed ones.
  // See "The paired variables" below.
  "paired":  { "innerWidth": true },
  "stashed": { "innerDepth": "200" },

  "instances": [
    {
      "id": "leg-1",                // unique in the file; targets refer to it
      "label": "leg",               // what the sidebar row says
      "component": "leg.component.json",   // NAMED, not embedded — see below
      "connection": {
        // two anchors on this instance's own blocks
        "source": [
          { "at": [0, 1, 0], "block": "dbc975bd-…" },
          { "at": [0, 0, 0], "block": "31a419b3-…" }
        ],
        "target": {
          "kind": "mainBox",        // or "instance", with an "id"
          "anchors": [
            { "at": [0, 0, 0], "block": null },
            { "at": [0, 1, 0], "block": null }
          ]
        },
        "roll": 90                  // omitted when zero
      }
      // no "place": it is connected — see below
    },
    {
      "id": "frame-1",
      "label": "frame",
      "component": "frameVertical.component.json",
      "connection": null,
      "place": {                    // ONLY on a disconnected instance
        "position": [321.5, 12, -40.25],
        "quaternion": [0, 0, 0, 1]
      }
    }
  ]
}
```

### Anchors

An anchor is `{ at, block }`: fractions of a box, and **which box**. `0` is the
low face, `1` the high face, `null` the body's encasing box (and always the main
box, which has no parts). Both halves matter and the second is the easy one to
lose — see [lamp-assembly](algorithms/lamp-assembly.md#anchors-and-which-box-they-are-of).

### Components are named, not embedded

An instance carries the **file name** of its component, not a copy of its recipe.
The same rule as everywhere else: the def is derivable from the library, so
storing it would be storing a stale copy, and editing a component would leave
every lamp that uses it quietly on the old version.

The cost is that a lamp needs its components present. A missing one is reported
by name, its instances are dropped, and anything joined to a dropped instance is
**freed** rather than left holding a joint onto nothing — a target that is not
there resolves to no placement at all, which would stack the orphans at the
origin. Freed, they stand where the file left them: wrong-looking, but findable.

### What is deliberately not written

**Any geometry.** There is none to write; the lamp side holds none. Every solid
in the scene comes out of `computeScene` on each render.

**A connected instance's `place`.** It is dead state while the instance is
connected: `computeScene` resolves it from its anchors, and `disconnect` slides
it from that *resolved* placement rather than from the stored one. Only a
disconnected instance has a place of its own — and that is the one millimetre
fact in the file, because it is where the user put it.

### The paired variables

`variables` is the raw dictionary, so a collapsed pair is already in it the way
the resolver sees it: the dependent's formula is literally `"#driver"`. That
alone reloads to an identical *lamp* — but with the ⚭ toggle showing the wrong
state and the wrong value parked behind it, so `paired` and `stashed` are written
too.

`pairs` is **not** written. Which variables *may* pair is structure declared in
`public/data/variables.json`, not a decision the design made.

## Saving — `buildLampFile(id, instances, variables)`

Pure: it takes the instance list and the variables and returns the object above.
Numbers are rounded to 4 decimals, and instance ids are kept **verbatim** —
connections name them, so renumbering would have to rewrite the joints too.

`useLampStore.saveLamp` then hands it to `saveLibraryFile` (`lib/library.ts`),
which either commits it to the repository or downloads it — see [the library](#the-library).

## Loading — `toInstances(lamp, defs)`

Also pure, and the whole of what loading *decides*. Fetching the component defs
is the caller's job (`useLampStore.loadLamp`), which keeps the I/O in the store
and the format logic here.

Loading **replaces** the design, where loading a component *merges* into it. The
two are different acts: a component is being added to a design that already
exists and whose values therefore win; a lamp *is* a design, and merging one in
would leave it at values it was never drawn at. A variable the file does not
mention keeps what it has, so a lamp saved before the design gained a variable
does not blank it.

## The library

Lamps live in `public/models/lamps`, exactly as components live in
`public/models/components`, and all three libraries are read and written through
one module — `lib/library.ts` — which has two modes.

**Without a token** the listing comes from `index.json`. The folder has no
directory index of its own, so a Vite plugin (`library-index` in
`vite.config.ts`) serves one — read per request in dev, baked into `dist` on
build — and **Save** downloads the file for you to drop into the folder by hand.

**With one** (Library settings, at the foot of the file menu) both directions go
through GitHub's contents API against the branch: a save is a commit, and a read
is of the branch rather than of the deployed site. That second half is the part
worth stating — the site is a build, and a saved design does not trigger one
(`public/models/**` is ignored by the deploy workflow), so the site goes on
serving the library as it stood at the last code push. Reading the branch is
slower and correct.

Either way the picker re-lists on every open, so a lamp saved since the page
loaded is there the next time you look; the dev server needs no restart.

## Round-trip guarantees

Given the components it names are present:

1. **Every instance comes back** — same id, same label, same component, same
   connection, same roll.
2. **The lamp lays out identically** at the variables it was saved at: every
   part in the same place, cut to the same size, to six decimals.
3. **And identically at any other variables** — the file is a recipe, so a
   reloaded lamp and a rebuilt one respond to a slider the same way.
4. **A disconnected instance keeps its place**; a connected one never had one to
   keep.
5. **The ⚭ pairs come back as they were**, including the parked value behind a
   collapsed one.

## Version history

| Version | Change |
| --- | --- |
| 1 | First format. |
