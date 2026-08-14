# The component library

Saved components — `*.component.json`, the format in
[docs/component-file-format.md](../../../docs/component-file-format.md). The
folder is listed automatically (the `library-index` plugin in `vite.config.ts`)
and every picker re-reads it when it opens, so a file dropped in shows up on the
next **Load…** without restarting the dev server.

Everything here is built to the rules in
[docs/joinery-rules.md](../../../docs/joinery-rules.md): the paper is glued to an
inner frame and to nothing else, every end joint is lapped or housed rather than
butted, and no mortise is cut that something does not fill.

## The four originals

`beam`, `leg`, `frameHorizontal`, `frameVertical` — sawn out of SketchUp STL by
hand, and what `basic.lamp.json` is made of. They are the reference the rules
were measured from; leave them alone.

## The kit

The rest are generated, and all of them are one stick with rectangular bites
taken out of it. They come in three families.

### Posts — the corner uprights

Section `legThickness` square. Where a pair of rails crosses, the post is
mortised so the two rails fill the cut and lap into each other **inside** it, so
the joint never shows.

| | Rings it is mortised for | Mortise |
| --- | --- | --- |
| `postBT` | bottom and top | right across; the post keeps its outer corner |
| `postBTStub` | bottom and top | into the corner only; the post keeps an L |
| `postBMT` | bottom, middle, top | across |
| `postBTC` | bottom, top, and a cap ring over the head | across |
| `postBMTC` | all four | across |

A post is `legExtraBottom` of foot, then a mortise, then the shaft, and so on,
ending in `legExtraTop` of head — except the capped ones, which end at the cap
ring because that *is* the top.

### Rails — the structural rings

Section `beamHeight` × `beamDepth`, half-lapped a rail's depth from each end
where they cross. `…Wide` spans `innerWidth`, `…Deep` spans `innerDepth`: the
pair is what lets a lamp be rectangular in plan rather than square.

| Ending | Runs to | Goes with |
| --- | --- | --- |
| `railWide` / `railDeep` | a horn out past the post | any post mortised across |
| `railWideFlush` / `railDeepFlush` | flush with the post's outer face | a post mortised across |
| `railWideStub` / `railDeepStub` | stops at the crossing | `postBTStub` only |

The flush and stub rails are the two answers to rule 5 and are **not
interchangeable**: a stub rail in a post mortised across leaves the far half of
the mortise open to the air.

### Frame — what the paper is actually glued to

Section `frameWidth` square, half-lapped at the corners. The stiles keep the
inner half of the thickness and the rails the outer half, so the face the paper
meets is unbroken all the way round.

| | |
| --- | --- |
| `frameRailWide` / `frameRailDeep` | the horizontal members, across the width or the depth |
| `frameStile` | full height of the opening |
| `frameStileMid` | with a third housing at half height, for a panel divided by a frame rail |
| `frameStileHalf` | half height, for one of two openings stacked either side of a structural ring |

## Which lamp uses what

| Lamp | Posts | Rails | Frame |
| --- | --- | --- | --- |
| `basic` | `leg` | `beam` | `frameHorizontal`, `frameVertical` |
| `andon-classic` | `postBT` | horned | full |
| `andon-flush` | `postBT` | flush | full |
| `andon-stub` | `postBTStub` | stub | full |
| `andon-divided` | `postBT` | horned | `frameStileMid` |
| `andon-capped` | `postBTC` | horned | full |
| `andon-capped-divided` | `postBTC` | horned | `frameStileMid` |
| `andon-open-front` | `postBT` | horned | three faces |
| `andon-tower` | `postBMT` | horned | two stacked, `frameStileHalf` |

`postBMTC` is in the library and no lamp uses it yet — a post for a lamp that has
both a middle ring and a cap. Nothing exercises it, so nothing has checked it.

## Regenerating

These are written by a small generator kept outside the repository, the same
arrangement as `../generated-components`. It declares each part as a stick and a
list of rectangular bites, derives the blocks and the corner-to-corner joints,
solves each placement against the app's own `alignPlacement`, and then holds
every lamp to the five rules at eight sets of variables. Ask for it if the
catalogue needs to grow.
