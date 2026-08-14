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
| `postBTCE` | bottom, top, cap, and an eave above the cap | across |
| `postFBT` | a plinth at the very foot, then bottom and top | across |
| `postMidBT` | bottom and top | **through** — see below |

A post is `legExtraBottom` of foot, then a mortise, then the shaft, and so on,
ending in `legExtraTop` of head — except the capped ones, which end at the cap
ring because that *is* the top. `postFBT` is the other exception: it has no foot
at all, because its first mortise is at the bottom of the stick and the lamp
stands on the ring in it.

`postMidBT` is not a corner post. It stands in the middle of a face, and the
rail does not stop in it — it runs straight through and on to the corner beyond.
So the mortise is cut right across the section on one axis instead of into a
corner, and the post is threaded onto the ring rather than joined to its ends.

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

Two rails are cut for a particular ring rather than for any of them:

| | |
| --- | --- |
| `railWideEave` / `railDeepEave` | a horn of `2 × beamExtra`, for the second course of a double top |
| `railDeepGrate` | five notches along the top edge, each one slat square and right across the rail |

`railDeepGrate` goes in the bottom ring, and `grateSlat` — a plain stick of
frame stock, `innerWidth + 2 × beamDepth` long — drops into it. The slat crosses
both rails and finishes flush with the outside of each, which is what leaves no
notch open. It is the one part in the library with a single block and no joint
of its own.

### Frame — what the paper is actually glued to

Section `frameWidth` square, half-lapped at the corners. The stiles keep the
inner half of the thickness and the rails the outer half, so the face the paper
meets is unbroken all the way round.

| | |
| --- | --- |
| `frameRailWide` / `frameRailDeep` | the horizontal members, across the width or the depth |
| `frameRailWideHalf` | half the width less half a post, for an opening a centre post has split |
| `frameRailWideCross` / `frameRailDeepCross` | housed once at the centre, for a single bar |
| `frameRailWideBars` / `frameRailDeepBars` | housed three times at quarter spacing |
| `frameStile` | full height of the opening |
| `frameStileMid` | with a third housing at half height, for a panel divided by a frame rail |
| `frameStileHalf` | half height, for one of two openings stacked either side of a structural ring |

A **bar** is a stile standing inside the opening rather than at its edge, and it
is cut as one: `frameStile` where nothing crosses it, `frameStileMid` where a
middle rail does. The housings in a crossed rail keep the same outer half of the
thickness its end laps keep, so a bar lands on the inner face the paper is glued
to and the crossing is solid — one more course of the joint the frame is already
made of, rather than a grille laid over it.

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
| `andon-latticed` | `postBT` | horned | `…Cross` rails, one bar, `frameStileMid` |
| `andon-barred` | `postBT` | horned | `…Bars` rails, three bars |
| `andon-twin` | `postBT` + `postMidBT` | horned | two per wide face, `frameRailWideHalf` |
| `andon-plinth` | `postFBT` | horned, three rings | full |
| `andon-pagoda` | `postBTCE` | horned, `…Eave` on top | full |
| `andon-grate` | `postBT` | `railDeepGrate` below | full, plus `grateSlat` × 5 |

`postBMTC` is in the library and no lamp uses it yet — a post for a lamp that has
both a middle ring and a cap. Nothing exercises it, so nothing has checked it.

## Regenerating

These are written by a small generator kept outside the repository, the same
arrangement as `../generated-components`. It declares each part as a stick and a
list of rectangular bites, derives the blocks and the corner-to-corner joints,
solves each placement against the app's own `alignPlacement`, and then holds
every lamp to the five rules at eight sets of variables. Ask for it if the
catalogue needs to grow.

Not every part can be aimed at the main box: a bar at a quarter of the opening
and a slat at a sixth of the depth are at no fraction the box offers, so they
are anchored to the housing that was cut for them instead. That is the right
answer as well as the only one — the bar is fixed to its rail, not to the lamp,
and the file now says so.
