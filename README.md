# Shoji Lamp Configurator

A browser CAD tool for designing a parametric shoji lamp. Parts are drawn
elsewhere (SketchUp → STL), imported here, joined into components, and
**measured in terms of design variables** rather than in millimetres. Change a
variable and every part written against it is re-cut and the assembly re-laid
out.

The unit throughout is the **millimetre**.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL (default <http://localhost:5173>).

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | `tsc -b` typecheck, then a production bundle into `dist/` |
| `npm run lint` | Oxlint over the repo |
| `npm run preview` | Serve the built `dist/` |

### The showcase's furniture

`public/models/props/*.glb` is the nightstand and the bed. Both arrived as OBJ
exports — 60 MB and 390,000 triangles for the bed, with a hundred megabytes of 4K
fabric maps beside it — and were converted with tools run through `npx`, not
added to the project:

```bash
npx obj2gltf -i bed.obj -o bed-raw.glb
npx @gltf-transform/cli weld bed-raw.glb bed-w.glb
npx @gltf-transform/cli simplify bed-w.glb bed-s.glb --ratio 0.08 --error 0.02
npx @gltf-transform/cli prune bed-s.glb bed-p.glb && npx @gltf-transform/cli dedup bed-p.glb bed.glb
```

The texture maps are stripped from the `.mtl` before conversion and the render
scene's backdrop plane is dropped, so what lands in the repo is 1.2 MB of pure
geometry. The materials come from the room — the same procedural wood and cloth
everything else wears, which needs no UVs and adds nothing to the download.

### The checks

`src/lib/__*check.ts` are standalone harnesses for the six things that are worth
asserting numerically rather than eyeballing: that a joint stays on the feature it
was picked on (`__anchorcheck`), that a saved lamp responds to a slider exactly as
a rebuilt one does (`__lampfilecheck`), that a union of boxes gives the outline
the CSG would (`__outlinecheck`), that the Assets tab's badges and previews
agree with the library they describe (`__assetscheck`), that the settings kept
in `localStorage` survive the round trip — including the malformed blobs, which is
the half nobody sees fail until the browser has been closed (`__settingscheck`) —
and that the showcase's paper shell is five faces, all wound to face outwards, at
one scale (`__papercheck`): none of which can be seen from the code, and all of
which are unmistakable the moment they are wrong on screen.

There is no test runner. Each is bundled to ESM and run under Node, from the
project root — `__assetscheck` answers `fetch` off `public/`, so it exercises the
real `lib/library.ts` path:

```bash
npx vite build --ssr src/lib/__anchorcheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__anchorcheck.js
```

Each prints a `PASS`/`FAIL` line per assertion and exits non-zero on a failure.
`dist-ssr/` is gitignored.

## The idea in one paragraph

A saved component is a **recipe, not a snapshot**. Every part is an
axis-aligned box whose three sizes are stored as *formulas* over the design
variables (`#frameWidth`, `1/2*#innerWidth`, …), and every joint is stored as a
*fraction of each box* rather than as a coordinate. Nothing in that description
mentions a millimetre that was only true on the day it was exported, so loading
the same file with different variables produces a different — and correct —
component instead of the old one at the old size. See
[docs/component-file-format.md](docs/component-file-format.md).

## Documentation

| Document | Covers |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Module map, state stores, data flow, render pipeline |
| [docs/algorithms/README.md](docs/algorithms/README.md) | Index of every algorithm, with complexity |
| [docs/algorithms/formula-resolution.md](docs/algorithms/formula-resolution.md) | Expression grammar, parser, dependency resolution |
| [docs/algorithms/spans-and-measurements.md](docs/algorithms/spans-and-measurements.md) | Spans, stations, runs, the span solver (implied values) |
| [docs/algorithms/assembly-layout.md](docs/algorithms/assembly-layout.md) | Connection replay, grouping, rebuild, disassembly |
| [docs/algorithms/lamp-assembly.md](docs/algorithms/lamp-assembly.md) | The main box, placing components on it, two-point alignment, clearance |
| [docs/algorithms/symmetry-fill.md](docs/algorithms/symmetry-fill.md) | The main box's symmetry group, orbits, and filling one out |
| [docs/algorithms/solid-simplification.md](docs/algorithms/solid-simplification.md) | CSG union, face topology, outline recovery, retessellation |
| [docs/algorithms/rectangle-partition.md](docs/algorithms/rectangle-partition.md) | Minimum rectilinear rectangle partition |
| [docs/algorithms/projection-and-dimensions.md](docs/algorithms/projection-and-dimensions.md) | Hidden-line removal, dimension chain layout, framing |
| [docs/algorithms/wood-texture.md](docs/algorithms/wood-texture.md) | Solid (3-D) wood texturing: noise, rings, warp, pores |
| [docs/component-file-format.md](docs/component-file-format.md) | `*.component.json` schema v5, save and load |
| [docs/lamp-file-format.md](docs/lamp-file-format.md) | `*.lamp.json` schema v1 — which components are on the lamp, and how |
| [docs/texture-file-format.md](docs/texture-file-format.md) | `*.texture.json` schema v1 — the wood as parameters, never an image |
| [docs/ui-guide.md](docs/ui-guide.md) | What each control does and the intended workflow |
| [docs/glossary.md](docs/glossary.md) | Block, span, station, run, group, anchor, … |
| [initial-plan.md](initial-plan.md) | The original iteration-1 plan (historical) |

## Stack

- **Vite** + **React 19** + **TypeScript**
- **@react-three/fiber** / **@react-three/drei** — declarative three.js; `<View>`
  gives four scissored viewports on a single WebGL canvas
- **three-bvh-csg** — boolean union of joined parts
- **Zustand** — one store per thing that has a life of its own: the design
  variables, the component editor, the lamp assembly, the texture bench, the
  view chrome, the folded panels, and what the last file action had to say

Data lives as JSON under `public/`: design variables in
`public/data/variables.json`, and the three libraries in
`public/models/components/`, `public/models/lamps/` and
`public/models/textures/` (each listed by a small Vite plugin, see
`vite.config.ts`).

## Deploying

The app is entirely client-side, so it is a static site. Pushing **code** to
`main` builds it and publishes it to GitHub Pages — see
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). Once, on a fresh
repository:

1. **Settings → Pages → Source: GitHub Actions.**
2. Push. The site comes up at `https://<user>.github.io/<repo>/`.

Pages serves a project site from `/<repo>/` rather than from the root, so the
build is given that prefix and the dev server uses it too — the path that gets
tested is the path that ships. The workflow takes it from the repository name; to
build for a differently named one by hand, `VITE_BASE=/my-fork/ npm run build`.

### Saving to the library from the deployed site

A page has nowhere to write, so saving a component, lamp or texture has always
been a download you dropped into `public/models/…` by hand. On a deployed site it
can be better than that, because the site *is* a branch of a repository:

1. Make a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
   with access to this repository only, and **Repository permissions →
   Contents: Read and write**. Nothing else.
2. Open any file menu → **Library settings…**, fill in the user, repository,
   branch and token, and press Connect.

Every save now commits the file, so a design is in the library for good rather
than for the session — and the **Assets** tab can delete one, which is the single
thing in the app that a token is *required* for: saving falls back to a download
you drop in by hand, and there is no equivalent gesture for taking a file out of
a site your browser only reads.

Saving does **not** rebuild the site — `public/models/**` is ignored by the
workflow, because a minute of Actions to publish one JSON file is not worth
paying per save. It costs nothing while you are the one working: with a token the
app reads the branch rather than the built site, so what you just saved is what
the pickers list. It is only the *other* visitor's view that waits, since they
read the build. Actions → Deploy to GitHub Pages → **Run workflow** publishes the
library as it stands whenever you want it seen.

The token is kept in that
browser's `localStorage`: it is never in the source, never in the bundle, and
never sent anywhere but `api.github.com`. Anyone else opening the site has no
token, reads the same library, and saves by downloading — which is what makes a
public site with a private save button possible at all.

An expiring token is worth choosing deliberately. A leaked one can rewrite the
files in this repository and nothing else; revoke it at
Settings → Developer settings and press Connect again with a new one.
