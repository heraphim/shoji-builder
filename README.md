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
| [docs/component-file-format.md](docs/component-file-format.md) | `*.component.json` schema v3, save and load |
| [docs/ui-guide.md](docs/ui-guide.md) | What each control does and the intended workflow |
| [docs/glossary.md](docs/glossary.md) | Block, span, station, run, group, anchor, … |
| [initial-plan.md](initial-plan.md) | The original iteration-1 plan (historical) |

## Stack

- **Vite** + **React 19** + **TypeScript**
- **@react-three/fiber** / **@react-three/drei** — declarative three.js; `<View>`
  gives four scissored viewports on a single WebGL canvas
- **three-bvh-csg** — boolean union of joined parts
- **Zustand** — three stores (design variables, component editor, lamp assembly)

Data lives as JSON under `public/`: design variables in
`public/data/variables.json`, the component library in
`public/models/components/` (listed by a small Vite plugin, see
`vite.config.ts`).

## Deploying

The app is entirely client-side, so it is a static site. Pushing to `main` builds
it and publishes it to GitHub Pages — see
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

Every save now commits the file, and the push rebuilds the site — so a design is
in the library for good rather than for the session. The token is kept in that
browser's `localStorage`: it is never in the source, never in the bundle, and
never sent anywhere but `api.github.com`. Anyone else opening the site has no
token, reads the same library, and saves by downloading — which is what makes a
public site with a private save button possible at all.

An expiring token is worth choosing deliberately. A leaked one can rewrite the
files in this repository and nothing else; revoke it at
Settings → Developer settings and press Connect again with a new one.
