# Texture file format (`*.texture.json`), version 2

`src/lib/textureFile.ts`

## The premise

**A saved texture is a recipe, not an image.**

The file is the parameter set that generates the wood, seed included, and nothing
else. There is no bitmap in it and there is not going to be, for the same reason
the components are formulas rather than sizes: a 40 mm post and a 5 mm kumiko
strip want the same timber at two very different scales, and a baked image can
only ever be right for one of them.

Two consequences worth stating plainly:

- the same file always regenerates the same board, because the seed is in it;
- the file is a couple of kilobytes, so a library of them costs nothing.

## Schema

```jsonc
{
  "id": "white-oak",        // the file name it was saved under
  // What this timber is and where it is for, from the Name & description panel
  // at the top of the sidebar. Nothing reads it — thirty numbers cannot say
  // "quartersawn, for the posts". Omitted when blank. Format 2.
  "description": "Quartersawn white oak — the posts and the top rails.",
  "type": "texture",        // the load guard checks this
  "format": 2,              // TEXTURE_FORMAT
  "units": "mm",
  "model": "wood",          // which generator. One so far; the guard rejects others.

  // Provenance only: the preset the numbers were last taken from, so the
  // sidebar can show it. Loading NEVER re-applies the preset — a file whose
  // numbers have been nudged off it still opens as what it looked like when
  // it was saved.
  "species": "white_oak",
  "finish": "raw",

  "params": {
    // --- where the part sits in the log ---
    "grainAxis": "x",        // which part axis runs along the fibres
    "grainScale": 160,       // millimetres per texture unit
    "pith": [0.62, 0.15],    // offset from the log's centre, in texture units
    "seed": 1,               // which board out of the log

    // --- rings ---
    "centerSize": 1.23,        "ringThickness": 0.029412,
    "ringBias": 0.82,          "ringSizeVariance": 0.16,
    "ringVarianceScale": 1.4,  "barkThickness": 0.7,
    "grainContrast": 0.5,      // added here; the original fixes it at 0.5

    // --- how the rings are pushed about ---
    "largeWarpScale": 0.21,    "largeGrainStretch": 0.21,
    "smallWarpStrength": 0.034,"smallWarpScale": 2.44,
    "fineWarpStrength": 0.01,  "fineWarpScale": 14.3,

    // --- figure and pores ---
    "splotchScale": 0.2,       "splotchIntensity": 0.541,
    "cellScale": 800,          "cellSize": 0.28,
    "poreIntensity": 0.407,    // added here; 0 switches the voronoi off entirely

    // --- colour and finish ---
    "darkGrainColor": "#8b4c21",   // late wood: the dark line of each ring
    "lightGrainColor": "#c57e43",  // early wood: the pale ground between them
    "roughness": 0.92,   "clearcoat": 0,
    "clearcoatRoughness": 0,  "clearcoatDarken": 1
  }
}
```

Every parameter but the four placement ones comes verbatim from
`WoodNodeMaterial`'s preset tables, name for name, so a value can be copied
between the two. What each one does to the picture:
[algorithms/wood-texture.md](algorithms/wood-texture.md).

### The three that decide whether it looks like anything

`grainScale`, `ringThickness` and `pith` are the ones worth understanding,
because the preset numbers alone do not survive the move to millimetres.

- `grainScale × ringThickness` is the **real ring pitch in mm** — the number the
  sidebar reports and the one to judge a setting by. 4.7 mm at the defaults.
- `grainScale` also has to keep a part well under one texture unit, or the grain
  warp outruns the part and the figure turns to static. Below about 60 mm per
  unit this starts to show.
- `hypot(pith) × grainScale` is how far the piece is from the centre of the log,
  also reported in the sidebar. Near zero gives a bullseye; a hundred millimetres
  or so gives flat-sawn cathedral figure.

## Saving

`buildTextureFile(id, species, finish, params)` rounds every number to **6
decimals**. Not for size — for stability: two saves of the same texture have to
be the same bytes, or a file that differs only in float noise shows up as changed
in every diff.

The file menu then hands the result to `saveLibraryFile` (`lib/library.ts`) — the
same round trip as components and lamps: a commit to the repository when this
browser has a token, a download to be dropped into the folder by hand when it has
not.

## Loading — `parseTextureFile(data)`

Validated **field by field against the defaults**, not spread from whatever was
in the JSON. A texture goes straight into a shader: one string where a number
belonged is a NaN in a uniform, and in GLSL that is a black object with nothing
anywhere to say why.

```
1. type === "texture" and params present, else throw
2. model, if stated, must be "wood"
3. each numeric field: finite number, else the default
   each colour field: /^#[0-9a-f]{6}$/, else the default
   grainAxis:         one of x | y | z, else the default
4. sanitizeWoodParams: floor grainScale and ringThickness away from zero
   (the shader divides by both), clamp ringBias off 0 and 1, round the seed
```

Nothing throws for a bad *value*, only for a payload that is not a texture at
all.

## The library

`public/models/textures/`, read and written through `lib/library.ts` exactly as
the component and lamp libraries are: the `library-index` Vite plugin
(`vite.config.ts`) serves `index.json` for a browser with no token — read per
request in dev, emitted as a build asset for `dist` — and a browser with one
reads and commits against the branch through GitHub's contents API.

```
listLibraryTextures()      → listLibrary("textures")            → string[]
loadLibraryTexture(name)   → readLibraryFile("textures", name)  → TextureFile
```

A texture can also be opened straight off the user's own disk — `Upload…` in the
tab's file menu — as a component or a lamp can.

Library entries are fetched once and cached in `useTextureStore.loaded`: a
component asks for its texture on every render, and the answer cannot be a
promise. In-flight requests are deduplicated, so a component that renders five
times before the fetch lands starts one fetch, not five.

## Round-trip guarantees

| Property | Survives a save/load? |
| --- | --- |
| Every generator parameter | yes |
| The seed, and therefore the exact board | yes |
| Which preset the numbers came from | yes — `species` / `finish`, as a note; never re-applied |
| Exact float values | to 6 decimals, deliberately |
| The name it was saved under | yes — `id`, and the file name |
| The description | yes — `description`, from format 2 |

## Version history

| `format` | Notes |
| --- | --- |
| 2 | Current. Adds `description`. Prose about the timber; nothing reads it. |
| 1 | One generator, `"wood"`. Still loads; the description comes back blank. |
