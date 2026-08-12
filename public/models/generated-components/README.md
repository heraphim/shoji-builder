# Generated components

Parts for a shoji lamp, written as `*.component.json` files in the schema of
[docs/component-file-format.md](../../../docs/component-file-format.md) —
format 4, sizes as formulas over the design variables, joints as fractions of a
box.

Everything here obeys three rules:

1. **Every component is a beam.** One stick of wood, axis aligned, and nothing
   else. There are no sub-assemblies: a lattice panel is a dozen of these, not
   one of them.
2. **Every cut is a rectangle.** Mortise, tenon shoulder, half lap, groove,
   rebate, finger socket, vent slot — seen from any side each one is a
   rectangle. Nothing is arced, curved, tapered or mitred. Where tradition uses
   a taper (the kusabi wedge) it is replaced by a stepped equivalent, which
   does the same work in squares.
3. **Everything is built from blocks.** Each file is the beam minus its
   mortises, cut into axis-aligned boxes and joined corner to corner. The boxes
   fill exactly the wood that is left: no gap, no overlap.

## What the joints promise

A joint inside a component is stored as a fraction of each box. Every one of
them here is a *constant* fraction — a corner, a third of the way in, half way
up — never a millimetre measurement dressed up as a ratio. That is checked
symbolically when the file is written, so changing `#innerWidth` re-cuts the
part and the joints still land where they were drawn.

## The extra variables

The base variables come from `public/data/variables.json`. These are added by
the generated parts, each as a formula so it follows a resize. A design that
already defines one of these keeps its own value.

| Variable | Formula | At the shipped values |
| --- | --- | --- |
| `kumikoThickness` | `1/3*#beamHeight` | 5.0 mm |
| `kumikoWidth` | `2/3*#beamDepth` | 6.667 mm |
| `mortiseDepth` | `2/3*#legThickness` | 13.333 mm |
| `paperRebate` | `1/4*#frameWidth` | 1.75 mm |
| `pegDiameter` | `1/6*#legThickness` | 3.333 mm |
| `tenonLength` | `2/3*#legThickness` | 13.333 mm |

243 components in 20 groups.

## The andon carcass.

The traditional Japanese floor lamp is a four sided frame and panel: four corner posts (hashira), a pair of rails (kamachi) top and bottom on each face, and a lattice (kumiko) filling the opening, with washi paper behind it.  The rails are tenoned into the posts, and in the older lamps the kumiko strips are tenoned straight into the rails rather than made up as a separate panel.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `post-corner` | 15 | 20.0 x 430.0 x 20.0 mm | Corner post: rail mortises top and bottom on the two inward faces. |
| `post-corner-midrail` | 22 | 20.0 x 430.0 x 20.0 mm | Corner post with a third mortise for a mid rail. |
| `rail-top-x` | 15 | 226.7 x 15.0 x 10.0 mm | Top rail across the width; kumiko mortises on its underside. |
| `rail-bottom-x` | 15 | 226.7 x 15.0 x 10.0 mm | Bottom rail across the width; kumiko mortises on its top face. |
| `rail-top-z` | 15 | 226.7 x 15.0 x 10.0 mm | Top rail across the depth. |
| `rail-bottom-z` | 15 | 226.7 x 15.0 x 10.0 mm | Bottom rail across the depth. |
| `kumiko-upright` | 9 | 5.0 x 350.0 x 6.7 mm | Vertical lattice strip, tenoned both ends, half lapped four ways. |
| `kumiko-cross-x` | 9 | 210.0 x 5.0 x 6.7 mm | Horizontal lattice strip with the mating half laps. |
| `base-rail-x` | 7 | 240.0 x 15.0 x 20.0 mm | Foot rail with a through mortise under each post. |
| `cap-rail-x` | 17 | 240.0 x 10.0 x 20.0 mm | Cap rail with blind post mortises and a paper rebate. |

## The fittings an oki-andon actually needs.

The box-shaped floor andon is open top and bottom, stands the light on an inner stand, and very often has a drawer at the foot for the oil and the tapers and a handle over the top so it can be carried.  One side lifts out to get at the flame.  Those parts are all here, along with the two splices - watari-ago and a stepped scarf - that let a rail run further than a board is long.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `post-corner-doubletenon` | 11 | 20.0 x 430.0 x 20.0 mm | Corner post with paired mortises - niju-hozo - top and bottom. |
| `stand-upright` | 8 | 15.0 x 123.3 x 15.0 mm | Inner light stand upright, mortised for two bearers and a foot. |
| `stand-bearer-x` | 5 | 133.3 x 15.0 x 10.0 mm | Light tray bearer, cross lapped at the middle - watari-ago. |
| `drawer-runner` | 5 | 226.7 x 15.0 x 10.0 mm | Drawer runner with a groove along its length. |
| `handle-bar` | 19 | 140.0 x 15.0 x 20.0 mm | Carrying handle with through mortises and peg holes. |
| `handle-upright` | 6 | 10.0 x 60.0 x 10.0 mm | Handle upright, tenoned both ends, pinned through. |
| `splice-male` | 6 | 185.0 x 15.0 x 10.0 mm | Stepped scarf, male half, with a peg hole. |
| `splice-female` | 6 | 185.0 x 15.0 x 10.0 mm | Stepped scarf, female half. |
| `cap-vent-x` | 24 | 240.0 x 10.0 x 20.0 mm | Top cap with post mortises and a row of vent slots. |
| `track-upper-x` | 6 | 226.7 x 15.0 x 10.0 mm | Upper track for a lifting side panel. |
| `track-lower-x` | 6 | 226.7 x 15.0 x 10.0 mm | Lower track for a lifting side panel. |
| `apron-x` | 13 | 226.7 x 20.0 x 6.7 mm | Skirt board with a row of square lights cut through it. |

## Koushi and jigumi: the lattice itself.

Two traditions meet in a shoji lamp.  The outer face is *koushi*, the machiya shop lattice: bars at a chosen pitch crossing a few horizontal nuki, dense vertical (tateshige), dense horizontal (yokoshige), or in bundles (musha).  The inner face is *jigumi*, the fine kumiko grid, whose strips are half lapped into each other on a square pitch.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `jigumi-bar-upright-4` | 9 | 5.0 x 185.0 x 6.7 mm | Jigumi upright on a four square pitch, half lapped from the front. |
| `jigumi-bar-upright-6` | 13 | 5.0 x 185.0 x 6.7 mm | Jigumi upright on a six square pitch. |
| `jigumi-bar-cross-4` | 9 | 100.0 x 5.0 x 6.7 mm | Jigumi cross bar, lapped from the back to meet it. |
| `jigumi-bar-cross-6` | 13 | 100.0 x 5.0 x 6.7 mm | Jigumi cross bar on a six square pitch. |
| `koushi-rail-tateshige` | 47 | 226.7 x 15.0 x 10.0 mm | Rail for a dense vertical lattice - eleven bars. |
| `koushi-rail-medium` | 31 | 226.7 x 15.0 x 10.0 mm | Rail for a seven bar lattice. |
| `koushi-rail-open` | 19 | 226.7 x 15.0 x 10.0 mm | Rail for an open four bar lattice. |
| `koushi-stile-yokoshige` | 47 | 15.0 x 273.3 x 10.0 mm | Stile for a dense horizontal lattice. |
| `koushi-rail-musha` | 39 | 226.7 x 15.0 x 10.0 mm | Musha-goushi rail: three bundles of three bars. |
| `koushi-nuki-x` | 25 | 253.3 x 10.0 x 10.0 mm | Nuki passing through eleven lattice bars, through tenoned at both ends. |
| `osae-buchi-x` | 4 | 200.0 x 6.7 x 5.0 mm | Paper retaining strip, rebated and notched to clear the posts. |
| `koushi-sill-x` | 91 | 240.0 x 15.0 x 20.0 mm | Koushi sill with bar mortises and a drip groove. |

## The light itself, and the lamps that hang.

An andon has to hold a light and let its heat out, and the modern version has to hold a socket and lead a cord away without it showing.  Those are the first half of this batch.  The second half is the kake-andon: the andon hung on a post or a wall, which needs a bracket arm, a wall cleat, a yoke to hang from and - on the shop lanterns - a little wooden roof.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `light-cross-piece` | 8 | 226.7 x 15.0 x 15.0 mm | Cross piece under the light, cross lapped and notched for the cord. |
| `socket-mount` | 10 | 80.0 x 15.0 x 40.0 mm | Socket mounting block with a square aperture and two fixing slots. |
| `cord-rail` | 10 | 226.7 x 15.0 x 10.0 mm | Base rail with a cord channel and an exit notch. |
| `panel-stop-x` | 4 | 200.0 x 10.0 x 7.5 mm | Stop bead for a rigid diffuser panel. |
| `base-slat` | 5 | 200.0 x 7.5 x 30.0 mm | Floor slat, notched over the bearers. |
| `foot-rail-x` | 13 | 240.0 x 15.0 x 20.0 mm | Foot rail with post mortises and a clearance recess. |
| `bracket-arm` | 7 | 150.0 x 20.0 x 15.0 mm | Wall bracket arm for a kake-andon, with a wedged through mortise. |
| `wall-cleat` | 12 | 150.0 x 20.0 x 20.0 mm | Wall cleat with a square step and two fixing holes. |
| `hanging-yoke` | 16 | 190.0 x 15.0 x 20.0 mm | Yoke for a hanging lamp: strap mortises and a pinned hook post. |
| `roof-purlin` | 15 | 176.7 x 15.0 x 10.0 mm | Purlin of the roof over a shop lantern, with rafter seats. |
| `signboard-stile` | 11 | 15.0 x 185.0 x 15.0 mm | Signboard frame stile, grooved for the board. |
| `screen-foot` | 5 | 100.0 x 20.0 x 40.0 mm | Tsuitate foot with a wedged through mortise. |

## The shoji screen itself.

A shoji is a frame of four kamachi - two stiles (tatezan) and two rails, the bottom one heavier than the top - filled with a kumiko lattice and papered on one face.  It runs in a pair of grooves: the kamoi overhead, deep enough to lift the screen into, and the shallower shikii underfoot, so the screen can be lifted up and swung out.  That difference in groove depth is the whole trick of a Japanese sliding door and it is stated here as two different numbers.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `shoji-stile` | 27 | 15.0 x 370.0 x 10.0 mm | Shoji stile: rail mortises and five kumiko mortises up the inside. |
| `shoji-stile-midrail` | 35 | 15.0 x 370.0 x 10.0 mm | Shoji stile with a mid rail mortise as well. |
| `shoji-rail-top` | 21 | 226.7 x 15.0 x 10.0 mm | Top rail, haunched tenons, kumiko mortises underneath. |
| `shoji-rail-bottom` | 21 | 226.7 x 25.0 x 10.0 mm | Bottom rail - deeper, as it always is - mortised on top. |
| `shoji-rail-mid` | 19 | 226.7 x 15.0 x 10.0 mm | Mid rail, mortised on both faces. |
| `shoji-kumiko-upright` | 11 | 5.0 x 246.7 x 6.7 mm | Vertical kumiko for the screen, four half laps. |
| `shoji-kumiko-cross` | 11 | 200.0 x 5.0 x 6.7 mm | Horizontal kumiko, lapped the other way. |
| `shoji-kamoi` | 20 | 240.0 x 15.0 x 30.0 mm | Kamoi: the deep head track, two grooves. |
| `shoji-shikii` | 22 | 240.0 x 15.0 x 30.0 mm | Shikii: the shallow sill, two grooves. |
| `shoji-hikite` | 13 | 60.0 x 40.0 x 5.0 mm | Finger pull block with a rectangular recess. |
| `ranma-rail` | 29 | 226.7 x 20.0 x 10.0 mm | Transom rail, mortised for five bars and rebated for the frame. |
| `fusuma-stile` | 7 | 10.0 x 370.0 x 15.0 mm | Fusuma stile, grooved for the panel. |

## The drawer at the foot of the lamp, and the case around it.

Many oki-andon have a drawer under the light for the oil, the wick and the tapers.  A drawer is four sides and a bottom, and the corner joint that suits this generator exactly is the finger joint: square pins and square sockets, rectangular from every direction, which is what a dovetail is not.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `drawer-front` | 15 | 133.3 x 30.0 x 7.5 mm | Drawer front, finger jointed, grooved for the bottom, with a sunk pull. |
| `drawer-side` | 10 | 133.3 x 30.0 x 7.5 mm | Drawer side with the mating fingers and a runner groove. |
| `drawer-back` | 6 | 133.3 x 25.0 x 7.5 mm | Drawer back, cut away underneath for the bottom to slide in. |
| `drawer-batten` | 9 | 133.3 x 7.5 x 7.5 mm | Batten under the drawer bottom, notched over the sides. |
| `case-divider` | 11 | 15.0 x 123.3 x 10.0 mm | Divider between drawers, dadoed both faces for the runners. |
| `case-bearer` | 7 | 226.7 x 15.0 x 10.0 mm | Drawer bearer with a stopped dado. |
| `case-kicker` | 7 | 226.7 x 10.0 x 10.0 mm | Kicker over the drawer, notched clear of the divider. |
| `drawer-stop` | 5 | 20.0 x 10.0 x 5.0 mm | Drawer stop block, pegged through. |
| `drawer-runner-rail` | 5 | 226.7 x 5.0 x 7.5 mm | Runner the drawer side rides on. |
| `dust-panel-rail` | 9 | 226.7 x 10.0 x 10.0 mm | Dust panel rail, grooved on its top edge. |

## Kumiko patterns that are made of rectangles.

Most of the famous kumiko patterns - asa-no-ha, kikko, sakura - are built on strips cut at 45 and 60 degrees, and none of them can be stated here: a bar that leans is not an axis-aligned box.  The patterns that CAN be stated are the orthogonal ones, and there are more of them than the angled ones get credit for:

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `kumiko-grid-8-cross` | 17 | 200.0 x 5.0 x 6.7 mm | Grid bar on an eight cell pitch, lapped from the back. |
| `kumiko-grid-8-upright` | 17 | 5.0 x 185.0 x 6.7 mm | The mating upright on the same pitch. |
| `kumiko-grid-12-cross` | 25 | 200.0 x 5.0 x 6.7 mm | Grid bar on a twelve cell pitch. |
| `kumiko-grid-12-upright` | 25 | 5.0 x 185.0 x 6.7 mm | The mating upright, twelve cells. |
| `kumiko-igeta-cross` | 15 | 200.0 x 5.0 x 6.7 mm | Igeta bar: three pairs of laps, so each cell is framed twice. |
| `kumiko-igeta-upright` | 15 | 5.0 x 185.0 x 6.7 mm | Igeta upright. |
| `kumiko-sangumi-1` | 13 | 200.0 x 5.0 x 6.7 mm | Sangumi first layer, lapped a third of the depth. |
| `kumiko-sangumi-2` | 13 | 200.0 x 5.0 x 6.7 mm | Sangumi second layer, lapped two thirds. |
| `kumiko-kawara-a` | 13 | 200.0 x 5.0 x 6.7 mm | Kawara course, laps on the pitch. |
| `kumiko-kawara-b` | 13 | 200.0 x 5.0 x 6.7 mm | Kawara course, offset half a cell. |
| `kumiko-insert-cell` | 5 | 30.0 x 5.0 x 6.7 mm | Short insert that fills one cell of the grid. |
| `kumiko-border-x` | 30 | 200.0 x 10.0 x 10.0 mm | Panel border, mortised for seven bars and rebated for the paper. |
| `kumiko-border-y` | 30 | 10.0 x 185.0 x 10.0 mm | Panel border, upright. |
| `kumiko-panel-corner` | 33 | 15.0 x 185.0 x 10.0 mm | Corner post of a kumiko panel. |

## Carcasses that are divided, and joints that go right through.

A lamp face is not always one panel.  Put a post down the middle and each face becomes two, which needs a middle post mortised on both sides, half-width rails and a shorter kumiko.  Put a rail across and the face divides the other way.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `post-middle` | 7 | 15.0 x 430.0 x 20.0 mm | Middle post, mortised on both sides for a divided face. |
| `post-through` | 7 | 20.0 x 430.0 x 20.0 mm | Post cut for through tenons. |
| `post-wedged` | 19 | 20.0 x 430.0 x 20.0 mm | Through-mortised post with a key slot behind each mortise. |
| `rail-half-top` | 11 | 126.7 x 15.0 x 10.0 mm | Half-width top rail for a divided face. |
| `rail-half-bottom` | 11 | 126.7 x 15.0 x 10.0 mm | Half-width bottom rail. |
| `rail-through-x` | 25 | 253.3 x 15.0 x 10.0 mm | Rail with through tenons, each pierced for its key. |
| `rail-grooved-x` | 5 | 226.7 x 15.0 x 10.0 mm | Rail grooved for a solid panel instead of a lattice. |
| `rail-divider-x` | 15 | 226.7 x 20.0 x 10.0 mm | Rail dividing a face, mortised on both edges. |
| `corner-block` | 7 | 30.0 x 20.0 x 30.0 mm | Glue block for the inside of a corner. |
| `plinth-block` | 13 | 30.0 x 15.0 x 30.0 mm | Plinth under a post, recessed underneath. |
| `panel-spacer` | 5 | 15.0 x 185.0 x 6.7 mm | Spacer between two panels, grooved both sides. |

## The small parts that lock everything else together.

A note on wedges.  The traditional kusabi is tapered, and a taper is not a rectangle, so it cannot be stated here and is not pretended at.  What replaces it is the stepped key: a bar in two or three square steps that drops down behind a through tenon and draws it home a step at a time.  It does the same work, it is cut from blocks, and every face of it is a rectangle.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `key-stepped` | 5 | 10.0 x 60.0 x 6.7 mm | Stepped key for a through tenon - the rectangular answer to a wedge. |
| `loose-tenon` | 15 | 60.0 x 10.0 x 3.3 mm | Loose tenon, drawbored at both ends. |
| `spline-x` | 13 | 200.0 x 10.0 x 5.0 mm | Spline for a grooved edge joint, slotted for glue relief. |
| `peg-square` | 3 | 3.3 x 30.0 x 3.3 mm | Square peg with a withdrawal notch. |
| `pin-drawbore` | 3 | 3.3 x 50.0 x 3.3 mm | Drawbore pin, notched at both ends. |
| `clamp-caul` | 7 | 200.0 x 15.0 x 10.0 mm | Clamping caul, notched clear of the joints. |
| `story-stick` | 13 | 370.0 x 6.7 x 10.0 mm | Story stick carrying the lamp's own dimensions as notches. |
| `packing-block` | 6 | 40.0 x 15.0 x 15.0 mm | Stepped packing block, three square steps. |
| `panel-cleat` | 10 | 133.3 x 7.5 x 7.5 mm | Slotted cleat that lets a panel move. |
| `panel-batten` | 5 | 133.3 x 6.7 x 10.0 mm | Batten behind a paper panel, housed and relieved. |

## Shading the light, and the jigs that cut the parts.

A louvre is parallel blades with a gap between them: horizontal here rather than tilted, because a tilted blade is not an axis-aligned box.  Stacked flat with the gaps open, they still do the work - they let the heat up and hide the lamp from anyone looking straight in.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `louver-blade` | 5 | 226.7 x 5.0 x 10.0 mm | Louvre blade, tenoned both ends, mortised for the tie bar. |
| `louver-stile` | 35 | 10.0 x 246.7 x 10.0 mm | Louvre stile carrying seven blades. |
| `louver-tie` | 15 | 10.0 x 246.7 x 6.7 mm | Tie bar notched over every blade. |
| `baffle-bar-x` | 9 | 133.3 x 13.3 x 5.0 mm | Egg-crate baffle bar, four cells, lapped from above. |
| `baffle-bar-z` | 9 | 5.0 x 13.3 x 133.3 mm | The mating baffle bar, lapped from below. |
| `shelf-bearer` | 15 | 226.7 x 10.0 x 10.0 mm | Shelf bearer with three slat seats. |
| `shelf-slat` | 9 | 200.0 x 5.0 x 10.0 mm | Shelf slat, notched onto its bearers. |
| `tray-side-x` | 8 | 100.0 x 20.0 x 5.0 mm | Light tray side, finger jointed and grooved. |
| `tray-side-z` | 8 | 100.0 x 20.0 x 5.0 mm | The other tray side. |
| `jig-pitch-8` | 37 | 200.0 x 13.3 x 15.0 mm | Kumiko jig on an eight cell pitch. |
| `jig-pitch-12` | 57 | 200.0 x 13.3 x 15.0 mm | Kumiko jig on a twelve cell pitch. |
| `jig-fence` | 14 | 200.0 x 15.0 x 10.0 mm | Slotted jig fence. |
| `jig-depth-stop` | 4 | 40.0 x 20.0 x 10.0 mm | Adjustable depth stop block. |

## The ariake andon, the lamp that dims itself.

The ariake ("daybreak") andon is the bedside version.  Its outer cover lifts off and turns over to become the base the lamp stands on, and a panel in one face slides across a window to let out as much or as little light as you want in the middle of the night.  The Musashino Art University example measures 300 x 230 x 232 mm, which is the same order as the box this configurator starts from.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `ariake-post` | 15 | 20.0 x 246.7 x 20.0 mm | Ariake body post with rail mortises and a shutter groove. |
| `ariake-shutter-stile` | 8 | 10.0 x 185.0 x 7.5 mm | Sliding shutter stile, rebated to lap the opening. |
| `ariake-shutter-rail` | 15 | 110.0 x 10.0 x 7.5 mm | Shutter rail, mortised for three stiffening bars. |
| `ariake-shutter-pull` | 13 | 40.0 x 20.0 x 5.0 mm | Shutter pull with a rectangular finger recess. |
| `ariake-window-rail` | 6 | 226.7 x 15.0 x 10.0 mm | Window rail: shutter track above, paper rebate behind. |
| `ariake-cover-rail` | 9 | 240.0 x 15.0 x 20.0 mm | Reversible cover rail, mortised on both edges. |
| `ariake-cover-post` | 7 | 15.0 x 61.7 x 15.0 mm | Short cover post, tenoned both ends. |
| `ariake-cover-handle` | 10 | 150.0 x 10.0 x 15.0 mm | Cover handle with a finger slot. |
| `ariake-dish-bearer` | 7 | 133.3 x 15.0 x 15.0 mm | Bearer with a well for the oil dish. |
| `ariake-guard-rail` | 15 | 160.0 x 7.5 x 7.5 mm | Guard rail in front of the flame. |

## The folding screen, and the wooden hinge that folds it.

A byobu folds, and a lamp that folds flat needs the same thing: a hinge.  The wooden knuckle hinge is the one that can be stated here - two leaves whose edges are cut into alternating knuckles that mesh, with a pin driven down the line where they meet.  The knuckles are a finger joint stood on end, and the pin is square, so nothing about it is round.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `hinge-leaf-a` | 23 | 10.0 x 123.3 x 15.0 mm | Knuckle hinge leaf, wood at the odd knuckles. |
| `hinge-leaf-b` | 17 | 10.0 x 123.3 x 15.0 mm | The meshing leaf, wood at the even knuckles. |
| `hinge-pin` | 3 | 3.3 x 123.3 x 3.3 mm | Square pin for a knuckle hinge. |
| `byobu-stile` | 16 | 10.0 x 277.5 x 7.5 mm | Folding screen stile, three rail mortises and a paper rebate. |
| `byobu-rail` | 15 | 156.7 x 10.0 x 7.5 mm | Folding screen rail. |
| `byobu-lattice-upright` | 9 | 5.0 x 277.5 x 6.7 mm | Coarse lattice upright behind the paper. |
| `byobu-lattice-cross` | 9 | 150.0 x 5.0 x 6.7 mm | The mating lattice cross bar. |
| `screen-shoe` | 21 | 100.0 x 15.0 x 30.0 mm | Shoe under a standing screen, keyed through. |
| `tsuitate-post` | 12 | 10.0 x 277.5 x 15.0 mm | Tsuitate post, keyed into its shoe. |
| `panel-corner-block` | 6 | 15.0 x 92.5 x 15.0 mm | Corner block grooved on two faces for a right-angled pair of panels. |

## The lamp that is also a cabinet.

A tansu-built andon puts the light on top of a small case: shelves for the tapers, a boarded back, a lift-off top.  The parts are the same vocabulary again - posts with housings, rails with tenons, boards with battens - but at case proportions rather than lattice ones.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `case-post` | 17 | 20.0 x 246.7 x 20.0 mm | Case post, housed on both inner faces for three shelves. |
| `case-shelf` | 11 | 210.0 x 10.0 x 80.0 mm | Shelf board, housed into the posts and dadoed for two battens. |
| `case-back-board` | 17 | 60.0 x 246.7 x 7.5 mm | Shiplapped back board, slotted for its nails. |
| `lid-rail` | 13 | 240.0 x 15.0 x 20.0 mm | Lift-off lid rail, grooved for the panel. |
| `lid-muntin` | 7 | 210.0 x 10.0 x 15.0 mm | Lid muntin, grooved both edges. |
| `chigaidana-post` | 11 | 15.0 x 123.3 x 20.0 mm | Post between two staggered shelves. |
| `plinth-rail` | 13 | 240.0 x 20.0 x 20.0 mm | Plinth rail, housed for the posts. |
| `door-stile` | 15 | 15.0 x 185.0 x 10.0 mm | Case door stile with a turn-button pivot. |
| `door-turn-button` | 5 | 30.0 x 10.0 x 5.0 mm | Wooden turn button on a square pin. |

## The pitch family.

The same bar at every pitch a panel is likely to want, in both orientations, generated rather than written out one at a time.  A configurator needs the whole ladder available: three cells reads as a shoji, fourteen reads as a tateshige koushi, and the ones in between are what most lamps actually use.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `pitch-3-cross` | 7 | 200.0 x 5.0 x 6.7 mm | Lattice cross bar dividing the width into 3, lapped from the back. |
| `pitch-3-upright` | 7 | 5.0 x 185.0 x 6.7 mm | The mating upright, 3 cells, lapped from the front. |
| `pitch-5-cross` | 11 | 200.0 x 5.0 x 6.7 mm | Lattice cross bar dividing the width into 5, lapped from the back. |
| `pitch-5-upright` | 11 | 5.0 x 185.0 x 6.7 mm | The mating upright, 5 cells, lapped from the front. |
| `pitch-7-cross` | 15 | 200.0 x 5.0 x 6.7 mm | Lattice cross bar dividing the width into 7, lapped from the back. |
| `pitch-7-upright` | 15 | 5.0 x 185.0 x 6.7 mm | The mating upright, 7 cells, lapped from the front. |
| `pitch-9-cross` | 19 | 200.0 x 5.0 x 6.7 mm | Lattice cross bar dividing the width into 9, lapped from the back. |
| `pitch-9-upright` | 19 | 5.0 x 185.0 x 6.7 mm | The mating upright, 9 cells, lapped from the front. |
| `pitch-10-cross` | 21 | 200.0 x 5.0 x 6.7 mm | Lattice cross bar dividing the width into 10, lapped from the back. |
| `pitch-10-upright` | 21 | 5.0 x 185.0 x 6.7 mm | The mating upright, 10 cells, lapped from the front. |
| `pitch-14-cross` | 29 | 200.0 x 5.0 x 6.7 mm | Lattice cross bar dividing the width into 14, lapped from the back. |
| `pitch-14-upright` | 29 | 5.0 x 185.0 x 6.7 mm | The mating upright, 14 cells, lapped from the front. |
| `pitch-5-cross-third` | 11 | 200.0 x 5.0 x 6.7 mm | Three-layer lattice bar, 5 cells, lapped third depth. |
| `pitch-5-cross-twothird` | 11 | 200.0 x 5.0 x 6.7 mm | Three-layer lattice bar, 5 cells, lapped twothird depth. |
| `pitch-9-cross-third` | 19 | 200.0 x 5.0 x 6.7 mm | Three-layer lattice bar, 9 cells, lapped third depth. |
| `pitch-9-cross-twothird` | 19 | 200.0 x 5.0 x 6.7 mm | Three-layer lattice bar, 9 cells, lapped twothird depth. |
| `pitch-5-alternating` | 11 | 200.0 x 5.0 x 6.7 mm | Bar lapped alternately front and back, 5 cells. |
| `pitch-9-alternating` | 19 | 200.0 x 5.0 x 6.7 mm | Bar lapped alternately front and back, 9 cells. |

## The cube light, the box andon, and lamps in tiers.

Three ways of building the same idea.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `cube-edge-x` | 18 | 226.7 x 10.0 x 10.0 mm | Cube light edge running across the width, mortised on two faces. |
| `cube-edge-y` | 18 | 10.0 x 211.7 x 10.0 mm | Cube light upright edge. |
| `cube-edge-z` | 18 | 10.0 x 10.0 x 226.7 mm | Cube light edge running back to front. |
| `cube-corner` | 11 | 30.0 x 30.0 x 30.0 mm | Cube corner block, mortised on three faces. |
| `hako-side-x` | 19 | 200.0 x 185.0 x 10.0 mm | Box andon side, finger jointed, with a rebated window opening. |
| `hako-side-z` | 19 | 200.0 x 185.0 x 10.0 mm | The other box side. |
| `hako-back` | 8 | 200.0 x 185.0 x 10.0 mm | Box andon back, finger jointed, no window. |
| `hako-lid-rail` | 6 | 200.0 x 15.0 x 20.0 mm | Box lid rail, rebated to locate inside the box. |
| `hako-base-rail` | 17 | 200.0 x 15.0 x 15.0 mm | Box base rail, rebated for the bottom and vented. |
| `tier-rail-upper` | 12 | 240.0 x 15.0 x 20.0 mm | Stacking rail of an upper tier. |
| `tier-rail-lower` | 12 | 240.0 x 15.0 x 20.0 mm | Stacking rail of a lower tier. |
| `tier-post` | 8 | 15.0 x 123.3 x 15.0 mm | Post of one tier, mortised for a mid rail. |
| `carrying-bar` | 22 | 200.0 x 10.0 x 20.0 mm | Carrying bar for a tiered lantern. |

## Windows: renji, shitomi, degoshi.

A shoji lamp is a window that has been shrunk, and the window vocabulary comes with it.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `renji-bar` | 5 | 10.0 x 185.0 x 6.7 mm | Renji bar, tenoned both ends and notched for the mid rail. |
| `renji-head` | 39 | 226.7 x 15.0 x 10.0 mm | Renji head, mortised for nine bars. |
| `renji-sill` | 39 | 226.7 x 15.0 x 10.0 mm | Renji sill, mortised upwards. |
| `renji-mid-rail` | 21 | 226.7 x 5.0 x 7.5 mm | Mid rail notched behind every renji bar. |
| `shitomi-stile` | 31 | 10.0 x 246.7 x 10.0 mm | Shitomi shutter stile with a square pivot hole. |
| `shitomi-rail` | 23 | 226.7 x 15.0 x 10.0 mm | Shitomi rail, mortised for five bars. |
| `shitomi-prop` | 20 | 7.5 x 185.0 x 7.5 mm | Prop with four setting notches. |
| `degoshi-bracket` | 9 | 100.0 x 15.0 x 10.0 mm | Bracket carrying a projecting lattice. |
| `window-jamb` | 7 | 20.0 x 277.5 x 20.0 mm | Window jamb, grooved for the frame. |
| `window-lintel` | 13 | 240.0 x 20.0 x 30.0 mm | Window lintel with jamb mortises and a frame groove. |
| `mushiko-post` | 27 | 15.0 x 123.3 x 15.0 mm | Mushiko window post, mortised for six close bars. |

## Open joints and splices.

The mitred tenon that a fine andon corner uses cannot be stated here: a mitre is a cut at forty-five degrees and there is no such box.  What can be stated is the family of open, square-shouldered joints that do the same job:

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `post-bridle` | 11 | 20.0 x 430.0 x 20.0 mm | Post slotted right across the top for a bridle joint. |
| `rail-bridle` | 21 | 240.0 x 15.0 x 20.0 mm | Rail tongued at both ends to drop into a bridle. |
| `kane-tsugi-male` | 5 | 100.0 x 20.0 x 20.0 mm | Right-angle splice, tongued arm. |
| `kane-tsugi-female` | 10 | 100.0 x 20.0 x 20.0 mm | Right-angle splice, housed arm. |
| `ne-tsugi-post` | 6 | 20.0 x 185.0 x 20.0 mm | Foot splice: the standing post, stepped back twice. |
| `ne-tsugi-foot` | 6 | 20.0 x 80.0 x 20.0 mm | Foot splice: the new foot, stepped to match. |
| `lap-corner-a` | 4 | 100.0 x 15.0 x 10.0 mm | Half-lapped corner member, lapped from the front. |
| `lap-corner-b` | 4 | 100.0 x 15.0 x 10.0 mm | The mating half-lapped corner member. |
| `post-housed-shelf` | 11 | 20.0 x 430.0 x 20.0 mm | Post dadoed right across for a shelf. |
| `rail-stub-tenon` | 19 | 210.0 x 15.0 x 10.0 mm | Rail with short stub tenons for light work. |

## The same lamp in three weights.

The proportion of a lamp is decided by the thickness of its members long before any pattern is chosen.  A slender andon reads as paper held up by threads; a heavy one reads as a piece of furniture with light inside it.  The difference is one number, and because every size here is a formula, it is the same part three times rather than three parts.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `weight-slender-post` | 15 | 15.0 x 430.0 x 15.0 mm | Corner post, slender section. |
| `weight-slender-rail-top` | 19 | 220.0 x 11.2 x 7.5 mm | Top rail, slender section. |
| `weight-slender-rail-bottom` | 19 | 220.0 x 11.2 x 7.5 mm | Bottom rail, slender section. |
| `weight-slender-foot` | 13 | 230.0 x 11.2 x 15.0 mm | Foot rail, slender section. |
| `weight-slender-cap` | 17 | 230.0 x 7.5 x 15.0 mm | Cap rail, slender section. |
| `weight-standard-post` | 15 | 20.0 x 430.0 x 20.0 mm | Corner post, standard section. |
| `weight-standard-rail-top` | 19 | 226.7 x 15.0 x 10.0 mm | Top rail, standard section. |
| `weight-standard-rail-bottom` | 19 | 226.7 x 15.0 x 10.0 mm | Bottom rail, standard section. |
| `weight-standard-foot` | 13 | 240.0 x 15.0 x 20.0 mm | Foot rail, standard section. |
| `weight-standard-cap` | 17 | 240.0 x 10.0 x 20.0 mm | Cap rail, standard section. |
| `weight-heavy-post` | 15 | 30.0 x 430.0 x 30.0 mm | Corner post, heavy section. |
| `weight-heavy-rail-top` | 19 | 240.0 x 22.5 x 15.0 mm | Top rail, heavy section. |
| `weight-heavy-rail-bottom` | 19 | 240.0 x 22.5 x 15.0 mm | Bottom rail, heavy section. |
| `weight-heavy-foot` | 13 | 260.0 x 22.5 x 30.0 mm | Foot rail, heavy section. |
| `weight-heavy-cap` | 17 | 260.0 x 15.0 x 30.0 mm | Cap rail, heavy section. |

## Getting at the flame: the access door.

An oil lamp has to be reached - to be lit, trimmed and filled - so one face of an andon opens.  The Japanese door of this size does not swing on hinges; it turns on two square pins, one in the head and one in the sill, let into pivot blocks.  That suits this generator exactly, because a square pin in a square socket is two rectangles.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `lamp-door-stile-pivot` | 23 | 10.0 x 246.7 x 10.0 mm | Hanging stile with a pivot socket at each end. |
| `lamp-door-stile-latch` | 20 | 10.0 x 246.7 x 10.0 mm | Shutting stile, pierced for the latch. |
| `lamp-door-rail-top` | 15 | 140.0 x 10.0 x 10.0 mm | Door top rail. |
| `lamp-door-rail-bottom` | 15 | 140.0 x 10.0 x 10.0 mm | Door bottom rail. |
| `door-pivot-upper` | 13 | 30.0 x 15.0 x 20.0 mm | Upper pivot block - the deep socket the door lifts into. |
| `door-pivot-lower` | 13 | 30.0 x 15.0 x 20.0 mm | Lower pivot block - the shallow socket it drops into. |
| `door-latch-bar` | 6 | 50.0 x 7.5 x 5.0 mm | Latch bar turning on a square pin. |
| `door-latch-keeper` | 6 | 20.0 x 7.5 x 10.0 mm | Keeper the latch drops over. |
| `door-stop-strip` | 14 | 5.0 x 246.7 x 10.0 mm | Rebated stop strip, so no light shows at the crack. |
| `door-jamb-post` | 11 | 20.0 x 246.7 x 20.0 mm | Jamb post, housed for the pivot blocks and the stop. |

## The panel and the paper.

The kumiko in an andon is very often not tenoned into the lamp at all.  It is made up as a separate panel in its own light sub-frame, papered on the bench where it can be laid flat, and then dropped into a rebate in the lamp and held with a bead.  It is the repairable way to build one: the paper is renewed by taking the panel out, not by taking the lamp apart.

| Component | Blocks | Size at the shipped variables | What it is |
| --- | --- | --- | --- |
| `panel-frame-rail-3` | 15 | 150.0 x 10.0 x 10.0 mm | Sub-frame rail mortised for a 3 cell panel, lapped at the corners. |
| `panel-frame-stile-3` | 15 | 10.0 x 185.0 x 10.0 mm | Sub-frame stile for a 3 cell panel. |
| `panel-bar-3-cross` | 7 | 150.0 x 5.0 x 6.7 mm | Panel bar across, 3 cells. |
| `panel-bar-3-upright` | 7 | 5.0 x 185.0 x 6.7 mm | Panel bar upright, 3 cells. |
| `panel-frame-rail-5` | 25 | 150.0 x 10.0 x 10.0 mm | Sub-frame rail mortised for a 5 cell panel, lapped at the corners. |
| `panel-frame-stile-5` | 25 | 10.0 x 185.0 x 10.0 mm | Sub-frame stile for a 5 cell panel. |
| `panel-bar-5-cross` | 11 | 150.0 x 5.0 x 6.7 mm | Panel bar across, 5 cells. |
| `panel-bar-5-upright` | 11 | 5.0 x 185.0 x 6.7 mm | Panel bar upright, 5 cells. |
| `panel-frame-rail-7` | 35 | 150.0 x 10.0 x 10.0 mm | Sub-frame rail mortised for a 7 cell panel, lapped at the corners. |
| `panel-frame-stile-7` | 35 | 10.0 x 185.0 x 10.0 mm | Sub-frame stile for a 7 cell panel. |
| `panel-bar-7-cross` | 15 | 150.0 x 5.0 x 6.7 mm | Panel bar across, 7 cells. |
| `panel-bar-7-upright` | 15 | 5.0 x 185.0 x 6.7 mm | Panel bar upright, 7 cells. |
| `panel-frame-rail-9` | 45 | 150.0 x 10.0 x 10.0 mm | Sub-frame rail mortised for a 9 cell panel, lapped at the corners. |
| `panel-frame-stile-9` | 45 | 10.0 x 185.0 x 10.0 mm | Sub-frame stile for a 9 cell panel. |
| `panel-bar-9-cross` | 19 | 150.0 x 5.0 x 6.7 mm | Panel bar across, 9 cells. |
| `panel-bar-9-upright` | 19 | 5.0 x 185.0 x 6.7 mm | Panel bar upright, 9 cells. |
| `panel-bead-x` | 17 | 150.0 x 6.7 x 10.0 mm | Bead trapping the panel, running across. |
| `panel-bead-y` | 17 | 6.7 x 185.0 x 10.0 mm | Bead trapping the panel, upright. |
| `panel-bead-corner` | 3 | 40.0 x 6.7 x 10.0 mm | Short corner bead, lapped where it meets its neighbour. |
| `washi-frame-x` | 5 | 150.0 x 10.0 x 10.0 mm | Frame the paper is stretched on, across. |
| `washi-frame-y` | 5 | 10.0 x 185.0 x 10.0 mm | Frame the paper is stretched on, upright. |

## Regenerating

These files are generated. The generator is a small Python program — a symbolic
expression type, a `Beam` that takes rectangular bites out of a box, a
partitioner that cuts what is left into blocks, and one module per batch
describing the parts. It is not checked in here; ask for it if the catalogue
needs to grow.
