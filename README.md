# Shoji Lamp Configurator

A browser CAD tool for designing a parametric shoji lamp. Parts are drawn
elsewhere (SketchUp → STL), imported here, joined into components, and
**measured in terms of design variables** rather than in millimetres. Change a
variable and every part written against it is re-cut and the assembly re-laid
out.

**It exists to plan a lamp in order to build it** — a real object, cut and joined
by hand. That is what decides whether a feature is worth having: the showcase is
here to judge a design rather than to be the product, and a design that looks
right on screen but cannot be glued together is wrong. What that means in
practice is [docs/joinery-rules.md](docs/joinery-rules.md).

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

`src/lib/__*check.ts` are standalone harnesses for the eight things that are worth
asserting numerically rather than eyeballing: that a joint stays on the feature it
was picked on (`__anchorcheck`), that a saved lamp responds to a slider exactly as
a rebuilt one does (`__lampfilecheck`), that a union of boxes gives the outline
the CSG would (`__outlinecheck`), that the Assets tab's badges and previews
agree with the library they describe (`__assetscheck`), that the settings kept
in `localStorage` survive the round trip — including the malformed blobs, which is
the half nobody sees fail until the browser has been closed (`__settingscheck`) —
that the generator's roll journal buffers, survives a reload and lands as one
commit rather than one per click (`__rollscheck`), that the visitor and the token
holder are reading one library and that nothing can land in it unlisted
(`__librarycheck`), and that the showcase's paper shell is five faces, all wound
to face outwards, at one scale (`__papercheck`): none of which can be seen from
the code, and all of which are unmistakable the moment they are wrong on screen.

`__librarycheck` is the odd one, in that its failure is not visible on screen at
all — it is two people disagreeing about what is in the library and both being
shown something plausible. So GitHub is a switch statement and the branch is a
`Map`, and what is asserted is which requests are made and what goes in them.

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
| [docs/algorithms/blueprint-export.md](docs/algorithms/blueprint-export.md) | The lamp as printable drawing sheets: the PDF writer, scale, cut list |
| [docs/algorithms/wood-texture.md](docs/algorithms/wood-texture.md) | Solid (3-D) wood texturing: noise, rings, warp, pores |
| [docs/joinery-rules.md](docs/joinery-rules.md) | What makes an assembly buildable: the paper's frame, lapped ends, filled mortises |
| [docs/component-file-format.md](docs/component-file-format.md) | `*.component.json` schema v6, save and load |
| [docs/lamp-file-format.md](docs/lamp-file-format.md) | `*.lamp.json` schema v2 — which components are on the lamp, and how |
| [docs/texture-file-format.md](docs/texture-file-format.md) | `*.texture.json` schema v2 — the wood as parameters, never an image |
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

Data lives as JSON. Design variables are in `public/data/variables.json` and ship
with the build. The three libraries — `components`, `lamps` and `textures` — do
not: they are read at run time from the [`library`
branch](https://github.com/heraphim/shoji-builder/tree/library), which is the one
copy everybody sees. The folders under `public/models/` are the source those were
seeded from and are kept out of the built site on purpose, so that a second,
staler library cannot be published beside the real one — see `unpublishLibraries`
in `vite.config.ts`.

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

### The library branch

Everything the pickers offer lives on one branch, `library`, and everything reads
it. A visitor fetches it straight from `raw.githubusercontent.com`, which needs no
credentials and no API quota; the app is a static site with no server, and it does
not need one, because the branch is already a public file host.

That is the whole point of the arrangement, and it replaces a worse one. The
libraries used to be *in the build*, so a visitor saw them as they stood at the
last push of **code** — while whoever held a token read the branch and saw
something else. Two libraries, one app, and no way to tell which you had. Now
there is one, and the only thing a token changes is whether you may write to it.

The cost is that a save is public within the five minutes
`raw.githubusercontent.com` caches for, rather than instantly. The person who just
saved does not wait — with a token the app reads the same branch through the API,
which no cache has aged — but everyone else does. It buys back a manual deploy per
save and every Actions minute those cost.

**It is an orphan branch, and holds data only.** No source, no workflows, no
build — it shares no history with `main` and never merges into it. It carries a
README of its own saying so, four folders, and nothing else:

```
public/models/
  components/  lamps/  textures/      the three the app reads
  textures-rejected/                  where the generator puts the woods it turned down
```

The `public/models/` prefix is kept because that is where these files sit in the
source on `main`, which the branch was seeded from — a file is at one path
whichever way you arrive at it. `props/`, `stl/` and `generated-components/` are
deliberately *not* there: the first two are served by the site itself and the
third is not a library the app can reach.

Being data-only is worth more than tidiness. A branch that looks like the app
invites somebody to fix the app on it, and nothing here can be edited into a
broken build. It also means a leaked write token reaches designs and not source —
which matters, because a fine-grained token cannot be scoped to one branch, so
that is a matter of what is *on* the branch rather than of what the token permits.

### Saving to the library

A page has nowhere to write, so saving a component, lamp or texture has always
been a download you dropped into `public/models/…` by hand. With a token it is a
commit instead:

1. Make a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
   with access to this repository only, and **Repository permissions →
   Contents: Read and write**. Nothing else.
2. Open any file menu → **Library settings…**, and press Connect. The user,
   repository and branch already point at the library you are reading; only the
   token is yours to fill in.

Every save now commits the file, so a design is in the library for good rather
than for the session — and the **Assets** tab can delete one, which is the single
thing in the app that a token is *required* for: saving falls back to a download
you drop in by hand, and there is no equivalent gesture for taking a file out of
a site your browser only reads.

Each library carries an `index.json` of its own names, because
`raw.githubusercontent.com` serves a file and never a folder, so a reader without
a token has no other way to ask what is in one. Nothing maintains it by hand:
`commitFiles` rebuilds it from the branch inside the same commit that changes a
library, so a file cannot land unlisted, and a listing that has drifted is
corrected by the next save.

The token is kept in that browser's `localStorage`: it is never in the source,
never in the bundle, and never sent anywhere but `api.github.com`. Anyone else
opening the site has no token, reads the same library, and saves by downloading —
which is what makes a public site with a private save button possible at all.

An expiring token is worth choosing deliberately. **A fine-grained token cannot be
restricted to one branch**, so a token issued for the library can also write to
`main` — which is worth a ruleset on `main` if more than one person holds one, and
worth knowing about either way. A leaked token can rewrite the files in this
repository and nothing else; revoke it at Settings → Developer settings and press
Connect again with a new one.

To point a fork at its own library, build it with its own address:

```
VITE_LIBRARY_OWNER=you VITE_LIBRARY_REPO=your-fork npm run build
```
