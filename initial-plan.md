# Shoji Lamp Configurator — Project Plan (Iteration 1)

## Goal
A React + three.js webapp that renders a parametric shoji lamp. Every component
is positioned relative to one central reference box. Changing a variable
regenerates the affected mesh(es); attached components move with their parent
automatically because their position is *derived*, not stored absolute.

## Stack
- Vite + React + TypeScript
- `@react-three/fiber` + `@react-three/drei` (R3F gives declarative three.js,
  drei gives OrbitControls/useGLTF/etc. for free)
- Zustand for the variables store (derived values computed via selectors)
- Data lives as JSON in `public/data/` and is fetched at runtime, per your
  earlier plan (with a serverless function later for GitHub save — not in
  scope for iteration 1)

## Core naming convention

Everything hangs off one **central box** (`id: "core"`). Its faces are named
semantically, not by axis letter, so JSON stays human-readable:

| Face name   | Axis  | Direction |
|-------------|-------|-----------|
| `frontSide` | +Z    | width plane |
| `backSide`  | -Z    | width plane |
| `leftSide`  | -X    | depth plane |
| `rightSide` | +X    | depth plane |
| `topSide`   | +Y    | height plane |
| `bottomSide`| -Y    | height plane |

Dimension mapping:
- **width** → distance between `frontSide` and `backSide`
- **depth** → distance between `leftSide` and `rightSide`
- **height** → distance between `topSide` and `bottomSide`

Any future component that attaches to the core references it by face name,
e.g. `"attachTo": "core.frontSide"` — never by raw coordinates. This is what
makes "resize the core, everything attached moves" work for free: attached
components resolve their world position from the parent's *current* face
position, recomputed every render.

## Data model (iteration 1 scope)

```json
{
  "id": "core",
  "type": "box",
  "variables": {
    "width":  { "value": 36, "min": 10, "max": 100, "step": 0.5 },
    "height": { "value": 70, "min": 10, "max": 150, "step": 0.5 },
    "depth":  { "value": 26, "min": 10, "max": 100, "step": 0.5 },
    "isSquare": { "value": false }
  },
  "faces": ["frontSide", "backSide", "leftSide", "rightSide", "topSide", "bottomSide"]
}
```

`isSquare` behavior: when `true`, `depth` tracks `width` **live** — every
width-slider frame while dragging, not just at toggle time — and the depth
slider is disabled (driven, not independent). This falls out naturally from
the resolver pattern below: `resolved.depth` reads `vars.width` on every
render whenever `isSquare` is true, so there's nothing extra to wire up.
Keep `vars.depth` (the raw input) untouched in the store while square mode
is on — don't overwrite it — so toggling `isSquare` off restores the last
independent depth value instead of snapping to whatever width happened to
be.

## Resolver pattern (spreadsheet-style, not imperative)

```
resolvedCore = {
  width:  vars.width,
  depth:  vars.isSquare ? vars.width : vars.depth,
  height: vars.height,
}
```

Store *inputs* (raw slider values) separately from *resolved* (derived,
recomputed on every read). The mesh-building code only ever reads resolved
values. This is the same principle we'll use later for segment-based beams
and joint anchors — inputs are the source of truth, geometry is disposable
and rebuilt each time.

## Mesh regeneration

- The core box mesh is rebuilt (new `BoxGeometry`) whenever
  width/height/depth change — don't try to mutate geometry in place.
- Use a `useMemo` keyed on `[width, height, depth]` in the R3F component so
  React only rebuilds when a dependency actually changes.
- No merging needed yet (single box), but structure the component so a
  future multi-segment beam can return a merged `BufferGeometry` from the
  same kind of memoized builder function.

## Iteration 1 deliverables

1. **Scene setup**: R3F `<Canvas>`, camera, lights, OrbitControls, ground
   grid (optional) for scale reference.
2. **Core box component**: reads resolved dimensions from the store, renders
   one `<mesh>` with `boxGeometry` sized to `[width, height, depth]`,
   centered at origin.
3. **Controls panel** (plain HTML/CSS, not part of the 3D scene):
   - Slider: Width (bound to `frontSide`/`backSide` distance)
   - Slider: Height (bound to all 4 vertical faces)
   - Slider: Depth (bound to `leftSide`/`rightSide` distance), **disabled**
     when `isSquare` is checked
   - Checkbox: "Square (width = depth)"
   - Live numeric readout next to each slider
4. **Store**: Zustand store with `inputs` (raw) and a `resolved` selector as
   described above.

## Explicitly out of scope for iteration 1
(so it's clear what NOT to build yet)
- No attached components/assemblies
- No segment-based beams or mortise/tenon notches
- No blueprint/cut-list export
- No GitHub save
- No face/edge/vertex naming beyond the 6 named core faces

## Suggested folder structure

```
/src
  /store
    useLampStore.ts        # variables + resolver
  /components
    Scene.tsx               # Canvas, camera, lights, controls
    CoreBox.tsx              # renders the central box mesh
    ControlsPanel.tsx        # sliders + checkbox UI
  /lib
    resolve.ts               # pure functions: inputs -> resolved dims
/public
  /data
    core.json                # matches the schema above
```

## Next iterations (for reference, not to build yet)
1. First attached component (e.g. one post) anchored to `core.frontSide`,
   proving the "move with parent" behavior.
2. Segment-based beam builder (per the notch/tenon schema already agreed)
   with merged geometry per beam.
3. Assembly grouping (components → assembly → assembly-of-assemblies).
4. Joint anchors + validator (anchors must coincide).
5. Blueprint/cut-list generation from the same resolved data.
6. GitHub save via serverless function.
