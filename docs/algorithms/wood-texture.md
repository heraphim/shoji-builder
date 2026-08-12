# Wood texture

How a part gets a grain, and why it is a solid texture rather than an image.

Code: `lib/wood.ts` (the numbers), `lib/woodMaterial.ts` (the shader),
`lib/textureFile.ts` (the file format), `store/useTextureStore.ts` (the bench and
the library).

---

## The problem this solves

A beam has four long faces and two cut ends. To look like wood it needs, all at
once:

1. fibres running **along its length** on all four long faces;
2. those four faces **agreeing at the arris** — no seam where two meet;
3. **end grain** on the two cut ends: concentric rings, at the same ring spacing
   as the sides, positioned where the sides say they should be;
4. the same to hold for a face **exposed by a cut** — a mortise wall, the cheek
   of a lap joint — because every solid in this app has been through CSG.

A 2-D image mapped through UVs can be made to do (1). It cannot do (2), (3) or
(4) without hand-authored unwrapping per part, and there is no unwrapping at all
here: every solid reaching a view is a position-only buffer out of
`simplifySolid` or `mergeGeometries`.

## The idea: texture the volume, not the surface

Make the colour a function of the **3-D position inside the part**, in the part's
own coordinates. The mesh is then a shape carved out of a virtual log, and all
four properties fall out of that one decision rather than being arranged
separately:

- the long faces agree at the arris because they are slices of one continuous
  volume, adjacent in it;
- a cut end is a slice *across* the ring cylinders, so it is end grain by
  construction, at the right spacing and in the right place;
- a notch cut halfway along reveals correct interior grain, because there is
  interior to reveal.

This is the classic Perlin/Peachey solid texture, and wood is its original
worked example. The model here is the one three.js ships as `WoodNodeMaterial`.

## The model

Rings are concentric cylinders about the texture's **Z axis** — so Z is the
length of the log — and the figure drifts slowly along Z. In order:

```
p        = M · positionLocal                    object mm -> texture units
center   = centerSize · min(|p.xy|, 1)          disturbance near the pith
mainWarp = spaceWarp(spaceWarp(p, center, …), …)    broad, then medium
detail   = spaceWarp(mainWarp, fine…)                     then fine
rings    = ringProfile(|detail|)                a radius, so: cylinders
colour   = mix(lateWood, earlyWood, rings)
         ⊕ pores (voronoi)  ⊕ blotches (noise)
```

`spaceWarp` displaces the point **radially** and returns a vector with no Z. The
Z coordinate is therefore used exactly once — as an input to the first warp's
noise — and that single use is what makes the grain wander gently down the length
of a board instead of being the same cross-section extruded.

`M` is assembled in `woodMatrix` from three user-facing ideas: which part axis is
the grain axis (a cyclic permutation, so it stays a rotation), how many
millimetres a texture unit is, and where in the log this piece was cut from
(pith offset + seed).

## The one thing that had to be measured

The species presets are calibrated for an object **about one texture unit
across** — the scale the three.js example renders at — and every warp strength in
them is an absolute number of texture units. The broad warp displaces by up to
±0.6 units, which is twenty ring-widths.

That is fine when the whole part is a fraction of a noise cell: the warp is then
nearly constant across it, so it *shifts* the rings coherently, which is figure.
It is not fine when the part spans a whole unit: the warp then varies across the
part by more than the ring spacing, and the rings scramble. The first working
version of this feature put a 40 mm post at 1.6 units and produced convincing
static.

So `grainScale` defaults to 160 mm per unit — a 40 mm post is a quarter of a
unit — and the sidebar reports the derived **ring pitch in millimetres**, because
that is the number worth judging the setting by. At the default it is 4.7 mm:
six or seven rings across that post, and barely one across a 5 mm kumiko strip,
which is what a 5 mm strip really looks like.

The seed learned the same lesson. It offsets the sample point, and its
cross-grain range is deliberately under half a unit; when it was larger it threw
every piece thirty units from the pith, where rings are so nearly parallel that
end grain is stripes and the pith control decided nothing.

## Deliberate departures from `WoodNodeMaterial`

`WoodNodeMaterial` is a **node** material: it draws only under `WebGPURenderer`.
The whole app hangs off one `<Canvas>` shared by three tabs and four views, whose
scissored drei `<View>`s, dashed hidden-line overlays and polygon-offset fills
all work today against `WebGLRenderer`. Swapping the renderer under all of that
to gain a texture trades a feature for a risk to everything else on screen — and
would not even work, because the material's pore layer is written with
`TSL.wgslFn`, raw WGSL, which cannot fall back to WebGPURenderer's own WebGL
backend either.

So the algorithm is reimplemented in GLSL and injected into a
`MeshPhysicalMaterial` via `onBeforeCompile`. Parameter names, ranges and preset
values are identical, so moving to the real class later is a swap of one file.

Four differences, each for a stated reason:

| | Original | Here | Why |
| --- | --- | --- | --- |
| Noise | MaterialX `mx_noise_float` / `mx_noise_vec3` | Perlin gradient noise | No MaterialX outside the node system. Same character, different detail: a preset gives recognisably the same species, not the same board. |
| Ring profile | `mapRange(rings, ringBias, 1, 1, 0, clamp)` | interpolant clamped instead | The original clamps with `max(min(x, 0), 1)`, which is 1 for every input, so the falling half of the ring never applies. The two agree wherever `barkThickness ≤ 1` — eight of the ten presets. |
| Anti-aliasing | blur by camera distance | screen derivative on the ring coordinate | The original is tuned for a scene in metres; in millimetres the same expression washes the texture out completely. `fwidth` is what the blur approximates, and is scale-free. Taken on the coordinate, **not** the profile — the profile has a `fract` in it, and a derivative across that seam draws a bright line down the board once per ring. |
| Pore LOD | `cellSize / (\|viewPos\| · 10)` | `cellSize` as given | Same reason: zero at any distance expressed in mm. |

Two knobs are added, both because the original hardcodes them: `grainContrast`
(fixed at 0.5) and `poreIntensity` (fixed at 0.407). The second earns its place
by being switchable to zero, which takes a 27-tap voronoi out of the fragment
shader — the only meaningful saving available.

## Cost

Per fragment: ~14 Perlin lookups (8 gradient evaluations each) for the three
warps, the ring variance and the blotches, plus 27 hash evaluations for the
pores when `poreIntensity > 0`. The pore branch is on a uniform, so it costs one
test per draw rather than per pixel.

That is heavy for a full-screen effect and unremarkable for what it is used on:
a lamp's parts are thin, and the parts cover little of the frame. The Textures
tab's own bench is four beams.

## Where it is drawn

| | Solid | Texture |
| --- | --- | --- |
| Textures tab, all four views | flat blueprint fill | the bench parameters |
| Component Editor, 3D + projections | the component's `appearance.solidColor` | the texture it names, at its own grain axis |
| Lamp, 3D + projections | the component's colour, or the lamp's timber if it never chose one | as above, except a highlighted part, which stays highlighted |

The projections carry their own two lights when a texture is drawn. Everything
else in them is unlit by design, and a lit material in an unlit scene is black.

## Related

- [projection-and-dimensions.md](projection-and-dimensions.md) — the views this
  is drawn into
- [solid-simplification.md](solid-simplification.md) — where the position-only
  buffers come from, and why there are no UVs to map
- `docs/texture-file-format.md` — the saved recipe
- `docs/component-file-format.md` — how a component names one
