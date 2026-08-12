import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { WoodMaterial } from "../lib/woodMaterial";
import { woodPreset } from "../lib/wood";
import { ClothMaterial, PaperMaterial, PlasterMaterial } from "../lib/surfaces";
import { ricePaperTexture } from "../lib/ricePaper";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshReflectorMaterial } from "@react-three/drei";
import { siteUrl } from "../lib/library";

/**
 * The room the lamp is shown in: a wall, a nightstand, the corner of a bed, and
 * a hanging scroll behind it.
 *
 * Everything here is built out of boxes, cylinders and one canvas — no
 * downloaded models and no downloaded texture maps. Three reasons, in order of
 * how much they mattered: the site is served from GitHub Pages with no CDN, so
 * every byte is one the visitor waits for; a CC0 bedroom set is tens of
 * megabytes before it is compressed and a licence file after; and a *solid*
 * material is the only kind that works here at all, because nothing in this app
 * has UVs — see `lib/surfaces.ts`.
 *
 * What carries the detail is therefore the surface rather than the silhouette:
 * plaster that a raking light finds, cotton with a weave in it and the sheen a
 * fibre gives at a grazing angle, timber with the grain standing proud of it.
 * The exception is the pillow, which has no straight line anywhere and gets its
 * shape from geometry — {@link pillowGeometry}.
 *
 * ## Where things are
 *
 * The lamp stands at the world origin, so the room is laid out *around* that:
 * the nightstand's top surface is the plane `y = 0` and its centre is the origin
 * in x and z both, the wall goes just behind it, and the bed runs off to `+x`.
 * All millimetres, like the rest of the app.
 *
 * The group is then dropped onto the lamp's real underside — see `standY` on
 * {@link ShowcaseRoom} — because `y = 0` is the base of the *reference box*, and
 * the timber hangs below it.
 */

/** The nightstand's top face — the plane the lamp stands on. */
const TABLE_Y = 0;

/** The wall behind everything. */
const WALL_Z = -270;

/** The floor, far enough down that a nightstand is a nightstand. */
const FLOOR_Y = -700;

/** The ceiling, at a bedroom's height above that floor. */
const CEILING_Y = 1800;

/**
 * The side wall, and the window in it.
 *
 * Off to `+x`, past the foot of the bed. At the default camera it is outside the
 * frame — what is in the frame is what comes *through* it, raking across the bed
 * from the right, and that is the whole reason it is there. Orbit right and the
 * window itself comes into view.
 *
 * The wall is built as four boxes around the opening rather than as a plane with
 * a hole, because the hole has to be real: a light outside is only a window if
 * the wall stops all of it except the part the opening lets through, and that is
 * a shadow, which needs geometry.
 */
const SIDE_X = 2680;
export const WINDOW = {
  x: SIDE_X,
  z: [340, 1320] as const,
  y: [260, 1300] as const,
};

/** How far the bed runs before it ends. The mattress goes all the way. */
const BED_END = 2000;

/**
 * Where the bed starts, in x.
 *
 * Far enough from the nightstand to walk between, which is not a detail: at
 * 190 mm the bedding was pressed against the lamp and filled the right-hand
 * third of the frame with an undifferentiated pale mass. A bed is a big object
 * and the only thing that keeps it from taking over a photograph of something
 * small is distance.
 */
const BED_X = 640;

/** And where it ends. The far post stands here, matching the near one. */
const BED_FAR = 2400;

/**
 * The pendant over the middle of the room, in room coordinates.
 *
 * Exported because the *light* is not part of the room — the room owns what you
 * can see of the fixture, the scene owns what it does — and the two have to
 * agree about where it hangs to within a millimetre or the glow will come from
 * beside the shade rather than out of it.
 */
export const CEILING_FIXTURE = { x: 420, y: 1584, z: 320 } as const;

/**
 * Where the scroll hangs.
 *
 * Behind the lamp and deliberately not behind the middle of it. A picture
 * centred on the object in front of it reads as a backdrop that was placed for
 * the object; one that is off to the side reads as a wall that was already like
 * that when the lamp was put down. The overlap is the point — the lamp crosses
 * the scroll's right-hand edge, which is what puts one in front of the other.
 */
const SCROLL_X = -168;

/**
 * The painting, filling the panel it is on.
 *
 * No mount. A kakejiku normally has one — silk borders in traditional and quite
 * unequal proportions — and this had one, and it was wrong here: the mount is a
 * frame, a frame reads as a picture *hung on* a wall, and what is wanted is the
 * painting itself. So the panel is the image, at the image's own ratio, and the
 * only thing left of the scroll is the two rods.
 */
const SCROLL_W = 268;

/**
 * What shape the painting is until the file says otherwise.
 *
 * Only ever on screen for the frame or two before the image arrives — the real
 * ratio is read off the loaded texture, which is the whole point: this was a
 * hard-coded 135:516 and the day the picture was replaced with a 273:613 one
 * the panel went on being the old shape and squashed it. A number that describes
 * a file belongs to the file.
 */
const SCROLL_FALLBACK_ASPECT = 273 / 613;

/**
 * How far above the nightstand the painting starts.
 *
 * A quarter of a metre, so it begins around the lamp's shoulder. Half a metre
 * — the first try — was right about the object and wrong about the picture: it
 * put the painting so far up that the frame cut it off before anything in it
 * had happened. It still runs off the top, which is what the reference
 * photograph does too — a scroll is taller than a photograph of a bedside table.
 */
const SCROLL_BOTTOM = 250;

/**
 * Where the camera is allowed to be, in room coordinates.
 *
 * Exported because keeping a camera inside a room is a fact about the room, and
 * the alternative — a set of angle limits tuned by hand in the scene file — is
 * the same fact written down a second time in a form that cannot be checked
 * against the first. Angles also cannot express it: the ceiling is a plane, and
 * whether a given polar angle puts you through it depends on how far out you
 * have dollied.
 *
 * Inset from the surfaces themselves, because a camera *on* the wall shows you
 * the near-clipped inside of it.
 */
export const CAMERA_BOUNDS = {
  min: [-3000, TABLE_Y + 60, WALL_Z + 150] as const,
  max: [SIDE_X - 160, CEILING_Y - 160, 2600] as const,
};

/**
 * A box in world coordinates rather than one centred on the origin.
 *
 * Two reasons it is worth a helper. The layout above is written as extents —
 * "the top runs from −270 to 270" — and converting each one to a centre and a
 * size by hand is where the arithmetic slips. And both the wood and the cloth
 * shaders are *solid* textures read in object space, so a set of parts that all
 * shared one origin-centred geometry would come out with the identical length of
 * grain, or the identical fold, running through each of them.
 */
function boxAt(
  x: readonly [number, number],
  y: readonly [number, number],
  z: readonly [number, number]
): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x[1] - x[0], y[1] - y[0], z[1] - z[0]).translate(
    (x[0] + x[1]) / 2,
    (y[0] + y[1]) / 2,
    (z[0] + z[1]) / 2
  );
}

/** A rod lying along x, from one end to the other. */
function rodAlongX(
  x: readonly [number, number],
  radius: number,
  y: number,
  z: number,
  segments = 16
): THREE.BufferGeometry {
  const rod = new THREE.CylinderGeometry(radius, radius, x[1] - x[0], segments);
  rod.rotateZ(Math.PI / 2);
  return rod.translate((x[0] + x[1]) / 2, y, z);
}

/**
 * The film of lacquer on the nightstand's top, and the lamp standing in it.
 *
 * A separate sheet a fraction of a millimetre above the timber rather than a
 * property of it, because that is what it is: the wood is one surface and the
 * varnish over it is another, and the second one is a mirror. Doing it this way
 * costs nothing from the wood shader — the top is drawn exactly as every other
 * board in the room is — and the reflection is added over it, which is also how
 * the light actually arrives.
 *
 * It is a **real reflection**: drei renders the scene a second time from the
 * camera mirrored through this plane. That is what makes the lamp's shape sit in
 * the table and follow you as you orbit, which is the whole point — a painted-on
 * smudge is fixed to the wood and gives itself away the moment anything moves.
 *
 * Blurred hard and blended additively over a black base, so what lands on the
 * wood is a soft bright ghost and nothing else. A polished top is not a mirror
 * and a table with a sharp lamp in it looks like ice.
 */
function Lacquer() {
  return (
    <mesh position={[0, TABLE_Y + 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[552, 456]} />
      <MeshReflectorMaterial
        // One extra pass. 512 across a 550 mm top is about a millimetre a texel,
        // which is far more than enough to hold the shape of a lamp — the
        // resolution was never what was missing.
        resolution={512}
        // The blur was, and by a mile: 420 texels of it on a 512-texel buffer is
        // not a soft reflection, it is an average. Everything the lamp is made
        // of — four bright panels divided by dark bars — smeared into one glow,
        // which is exactly what a bright blob and no lamp looks like. Small
        // enough now to keep the divisions, large enough that the top is still
        // polished wood rather than a mirror.
        blur={[60, 20]}
        mixBlur={0.3}
        mixStrength={1.3}
        depthScale={0}
        minDepthThreshold={0.85}
        maxDepthThreshold={1}
        roughness={1}
        metalness={0}
        color="#000000"
        transparent
        opacity={0.6}
        // Additive, so the reflection can only ever brighten the timber — which
        // is what a clear film over a dark surface does. It also means the lamp's
        // frame reads as the *gaps* between the reflected panels rather than as
        // dark bars of its own, and that only works if the panels have edges,
        // which is the other half of why the blur came down.
        blending={THREE.AdditiveBlending}
        // it is a film, not a slab: it must not take part in the depth buffer or
        // it would shadow and z-fight the board a half-millimetre under it
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  );
}

/**
 * One leaf of a sliding shoji screen, as its timber and its paper.
 *
 * Two stiles, two rails, a lattice between them and a sheet behind the lattice —
 * the same object the lamp is, built the same way and at the same sizes, because
 * it is the same object: a screen and a lantern are both a frame with paper on
 * the back of it, and a room with one in it should have the other match.
 *
 * The timber comes back as a single merged buffer. A leaf is twenty-odd bars and
 * there are two leaves, and forty draw calls for a prop that is off the edge of
 * the default frame is forty too many.
 *
 * @param x the plane it slides in. Two leaves that pass each other are two
 *        planes a few millimetres apart, which is what a sliding screen is.
 */
function shojiPanel(
  x: number,
  z: readonly [number, number],
  y: readonly [number, number]
): { frame: THREE.BufferGeometry; paper: THREE.BufferGeometry } {
  const STILE = 26;
  const BAR = 9;
  const DEPTH = 22;
  const parts: THREE.BufferGeometry[] = [
    boxAt([x, x + DEPTH], y, [z[0], z[0] + STILE]),
    boxAt([x, x + DEPTH], y, [z[1] - STILE, z[1]]),
    boxAt([x, x + DEPTH], [y[0], y[0] + STILE], z),
    boxAt([x, x + DEPTH], [y[1] - STILE, y[1]], z),
  ];

  // the kumiko: four squares across and seven up, which is a domestic screen
  const inner: [number, number] = [z[0] + STILE, z[1] - STILE];
  for (let i = 1; i < 4; i++) {
    const at = inner[0] + ((inner[1] - inner[0]) * i) / 4;
    parts.push(boxAt([x + 4, x + DEPTH - 4], [y[0] + STILE, y[1] - STILE], [at - BAR / 2, at + BAR / 2]));
  }
  for (let i = 1; i < 7; i++) {
    const at = y[0] + STILE + ((y[1] - y[0] - STILE * 2) * i) / 7;
    parts.push(boxAt([x + 4, x + DEPTH - 4], [at - BAR / 2, at + BAR / 2], inner));
  }

  const frame = mergeGeometries(parts) ?? parts[0];
  for (const part of parts) if (part !== frame) part.dispose();

  // pasted on the back of the lattice, as it is on a real one
  return { frame, paper: boxAt([x + DEPTH - 3, x + DEPTH], y, z) };
}

/**
 * A box puffed out into a cushion.
 *
 * Each face is pushed out along its own normal by how far the vertex is from the
 * face's edges — full in the middle, nothing at the seam — which is exactly what
 * stuffing does to a sewn rectangle. The corners stay pinched, and that is not a
 * defect: a real pillow has ears at its corners for the same reason.
 */
function pillowGeometry(
  width: number,
  height: number,
  depth: number,
  puff = 0.34
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth, 16, 16, 16);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const half = new THREE.Vector3(width / 2, height / 2, depth / 2);

  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    const n = new THREE.Vector3(p.x / half.x, p.y / half.y, p.z / half.z);
    const flat = new THREE.Vector3(1 - n.x * n.x, 1 - n.y * n.y, 1 - n.z * n.z);
    position.setXYZ(
      i,
      p.x + n.x * puff * half.x * flat.y * flat.z,
      p.y + n.y * puff * half.y * flat.x * flat.z,
      p.z + n.z * puff * half.z * flat.x * flat.y
    );
  }

  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The scroll on the wall, sized by the picture on it.
 *
 * Its own component, and the one thing in this room that is not built once and
 * left alone: the panel's height is the painting's height, and nothing knows
 * that until the image has loaded. So the geometry is rebuilt when the texture
 * arrives, from the texture — which means dropping a different picture into
 * `public/painting.png` is the whole of the work of changing it.
 *
 * The width is fixed and the height follows. The other way round would be
 * defensible but this is a wall: what is scarce is how far the picture can
 * spread sideways before it runs into the lamp, not how far it can go up.
 */
function HangingScroll({ paper, rods, wrap }: { paper: PaperMaterial; rods: THREE.Material; wrap: THREE.Material }) {
  const [aspect, setAspect] = useState(SCROLL_FALLBACK_ASPECT);

  // Measured off a plain `Image` rather than off the texture, because a
  // `THREE.Texture` has no "the picture arrived" event to listen for — only
  // `dispose`. The browser has the file in cache by now anyway: the loading
  // screen fetched it, and this is the same URL.
  useEffect(() => {
    const image = new Image();
    image.onload = () => setAspect(image.width / image.height);
    image.src = siteUrl("painting.png");
  }, []);

  const geometry = useMemo(() => {
    const height = SCROLL_W / Math.max(aspect, 0.01);
    const half = SCROLL_W / 2;
    const top = SCROLL_BOTTOM + height;

    // Everything stands clear of the wall.
    //
    // The rods used to be centred on the wall's own plane, so their back halves
    // were inside the plaster — which is invisible head-on and is a rod sliced
    // in half the moment you orbit. The face of the paper is 4 mm out and the
    // rods sit in front of that, each one's radius clear of it.
    const face = WALL_Z + 4;
    const rodZ = face + 12;
    const rollerZ = face + 16;

    return {
      art: boxAt([SCROLL_X - half, SCROLL_X + half], [SCROLL_BOTTOM, top], [face, face + 3]),

      // The rollers are papered, not bare. On a real scroll the backing sheet is
      // pasted round them and only the turned ends show timber, which is why the
      // wood here stops at the jiku: a bare dowel across the top reads as a
      // curtain pole, and the paper stopping dead at a stick reads as a poster
      // taped to one.
      rodTop: rodAlongX([SCROLL_X - half - 4, SCROLL_X + half + 4], 10, top + 7, rodZ, 24),
      rodBottom: rodAlongX([SCROLL_X - half - 6, SCROLL_X + half + 6], 14, SCROLL_BOTTOM - 10, rollerZ, 24),

      // and the short overlaps where the sheet turns the corner onto them
      lapTop: boxAt([SCROLL_X - half, SCROLL_X + half], [top - 3, top + 7], [face, rodZ]),
      lapBottom: boxAt([SCROLL_X - half, SCROLL_X + half], [SCROLL_BOTTOM - 10, SCROLL_BOTTOM + 3], [face, rollerZ]),

      // The jiku: the turned caps on the ends of the rollers, and the only wood
      // on the whole hanging. Smaller at the top than at the bottom, because the
      // rod they cap is smaller — the weighted roller a scroll hangs straight
      // from is the thicker of the two, and matching them would make the top
      // look like the bottom upside down.
      jikuLeft: rodAlongX([SCROLL_X - half - 26, SCROLL_X - half - 6], 20, SCROLL_BOTTOM - 10, rollerZ, 24),
      jikuRight: rodAlongX([SCROLL_X + half + 6, SCROLL_X + half + 26], 20, SCROLL_BOTTOM - 10, rollerZ, 24),
      jikuTopLeft: rodAlongX([SCROLL_X - half - 22, SCROLL_X - half - 4], 15, top + 7, rodZ, 24),
      jikuTopRight: rodAlongX([SCROLL_X + half + 4, SCROLL_X + half + 22], 15, top + 7, rodZ, 24),

      cord: boxAt([SCROLL_X - 2, SCROLL_X + 2], [top + 7, top + 150], [rodZ - 2, rodZ + 2]),
      hook: boxAt([SCROLL_X - 8, SCROLL_X + 8], [top + 150, top + 160], [face - 4, face + 14]),
    };
  }, [aspect]);

  useEffect(
    () => () => {
      for (const part of Object.values(geometry)) part.dispose();
    },
    [geometry]
  );

  return (
    <>
      <mesh geometry={geometry.art} material={paper} castShadow receiveShadow />
      <mesh geometry={geometry.rodTop} material={wrap} castShadow receiveShadow />
      <mesh geometry={geometry.rodBottom} material={wrap} castShadow receiveShadow />
      <mesh geometry={geometry.lapTop} material={wrap} castShadow receiveShadow />
      <mesh geometry={geometry.lapBottom} material={wrap} castShadow receiveShadow />
      <mesh geometry={geometry.jikuLeft} material={rods} castShadow />
      <mesh geometry={geometry.jikuRight} material={rods} castShadow />
      <mesh geometry={geometry.jikuTopLeft} material={rods} castShadow />
      <mesh geometry={geometry.jikuTopRight} material={rods} castShadow />
      <mesh geometry={geometry.cord} castShadow>
        <meshStandardMaterial color="#4a3b2a" roughness={0.9} metalness={0} />
      </mesh>
      <mesh geometry={geometry.hook} castShadow>
        <meshStandardMaterial color="#3b2f22" roughness={0.5} metalness={0.5} />
      </mesh>
    </>
  );
}

/**
 * The painting.
 *
 * A real image — `public/painting.png` — because a painting is the one thing in
 * this room that is a *picture* rather than a material, and nothing procedural
 * was going to be a sumi-e landscape. Everything else about the scroll is: the
 * creases across it and the fibre in it are a height field over the flat panel
 * (see `PaperMaterial`), so the picture stays rectangular and only the light
 * across it bends.
 */
function paintingTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load(siteUrl("painting.png"));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Every surface in the room, and the materials they are made of.
 *
 * Built once and disposed together. The nightstand and the bed are drawn with
 * the app's own wood shader rather than a brown `MeshStandardMaterial` — it is
 * already here, it is the same timber language the lamp is described in, and a
 * nightstand with real grain in it is most of why the lamp's own grain reads as
 * grain rather than as a pattern.
 */
function useRoom() {
  const room = useMemo(() => {
    // The nightstand is the lighter of the two on purpose: it is the surface the
    // lamp's spill actually lands on, and dark walnut swallowed the pool of
    // light that is half of what says the lamp is lit. The bed is behind and
    // beside, where a darker timber keeps it from competing.
    //
    // The pores are turned right down from the 0.407 the species ship with. At
    // this grain scale red oak's cells land a bit under a millimetre apart, which
    // is a few pixels with your nose against the nightstand — resolved, not
    // aliased, and simply too many dark specks to read as a finished top. Real
    // oak has them; real oak also has them filled and polished over.
    const pores = { poreIntensity: 0.12 };

    /** How far the boards were cut from the heart of the tree, in mm. */
    const PITH_MM = 1600;

    /**
     * A board, cut a fixed distance from the heart of the tree.
     *
     * The pith is stored in *texture units*, so it moves whenever the grain
     * scale does — halve the scale to get finer rings and the pith comes twice
     * as close, the rings tighten into ovals, and the board turns back into a
     * slice of trunk. That coupling is the trap this helper exists to close:
     * here the distance is given in millimetres and converted, so the two can be
     * chosen independently, which is what they are in a timber yard.
     */
    const board = (species: Parameters<typeof woodPreset>[0], finish: Parameters<typeof woodPreset>[1], grainScale: number, roughness: number) => ({
      ...woodPreset(species, finish),
      ...pores,
      grainScale,
      roughness,
      pith: [PITH_MM / grainScale, (PITH_MM * 0.24) / grainScale] as [number, number],
      // Drawn out along the length of the board.
      //
      // `largeGrainStretch` scales the log's own axis before the warp noise is
      // sampled, so a *smaller* number means the wander varies more slowly down
      // the board and the figure comes out as long streaks with the occasional
      // cathedral loop — which is what a flat-sawn plank looks like. The presets
      // ship 0.25, tuned for an object about a texture unit across; on a top half
      // a metre long that reads as blotches rather than as grain.
      largeGrainStretch: 0.07,
    });

    // Grain scale is millimetres per texture unit and the rings run 34 to the
    // unit, so the pitch is scale/34: 90 gives a ring every 2.6 mm, which is a
    // slow-grown hardwood and about what a photograph of a walnut top shows.
    // It started at 700 — a ring every 21 mm — and looked like a board enlarged
    // eight times, which is exactly what it was.
    const oak = new WoodMaterial(board("red_oak", "semigloss", 90, 0.74));
    const walnut = new WoodMaterial(board("walnut", "matte", 120, 0.86));
    const ebony = new WoodMaterial(board("walnut", "gloss", 45, 0.6));

    return {
      oak,
      walnut,
      ebony,
      paper: new PaperMaterial(paintingTexture()),
      plaster: new PlasterMaterial("#b6a892"),
      ceiling: new PlasterMaterial("#c2b6a2", 0.6),
      floor: new PlasterMaterial("#4c3a2a", 0.4),
      // The mattress is a tight ticking, the sheet finer and slacker over it,
      // the pillow the loosest of the three — a cover with something soft in it
      // creases at a much bigger scale than a sheet pulled over a slab.
      ticking: new ClothMaterial({ color: "#a99f8e", weave: 2.6, weaveDepth: 0.08, fold: 70, foldDepth: 0.12 }),
      sheet: new ClothMaterial({ color: "#bdb5a5", weave: 2.8, weaveDepth: 0.08, fold: 60, foldDepth: 0.3 }),
      duvet: new ClothMaterial({ color: "#a0968a", weave: 4.2, weaveDepth: 0.1, fold: 150, foldDepth: 0.24, sheen: 0.4 }),
      pillow: new ClothMaterial({ color: "#bab1a1", weave: 3.0, weaveDepth: 0.08, fold: 90, foldDepth: 0.2 }),
      // The same washi the lamp is papered with, and not glowing: a screen is
      // lit from whichever side the light is on, which here is outside.
      screen: new THREE.MeshStandardMaterial({
        map: ricePaperTexture(),
        color: "#efe6d4",
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
      }),

      geometry: {
        wall: boxAt([-3200, SIDE_X], [FLOOR_Y, 2600], [WALL_Z - 120, WALL_Z]),

        // the side wall, in four pieces around the opening
        sideBelow: boxAt([SIDE_X, SIDE_X + 120], [FLOOR_Y, WINDOW.y[0]], [WALL_Z, 3000]),
        sideAbove: boxAt([SIDE_X, SIDE_X + 120], [WINDOW.y[1], CEILING_Y], [WALL_Z, 3000]),
        sideNear: boxAt([SIDE_X, SIDE_X + 120], WINDOW.y, [WINDOW.z[1], 3000]),
        sideFar: boxAt([SIDE_X, SIDE_X + 120], WINDOW.y, [WALL_Z, WINDOW.z[0]]),

        // the frame in it: a sill, a head, two jambs and a pair of mullions
        sill: boxAt([SIDE_X - 40, SIDE_X + 120], [WINDOW.y[0] - 34, WINDOW.y[0] + 6], [WINDOW.z[0] - 40, WINDOW.z[1] + 40]),
        winHead: boxAt([SIDE_X - 10, SIDE_X + 120], [WINDOW.y[1] - 24, WINDOW.y[1]], [WINDOW.z[0] - 30, WINDOW.z[1] + 30]),
        winJambA: boxAt([SIDE_X - 10, SIDE_X + 120], WINDOW.y, [WINDOW.z[0], WINDOW.z[0] + 26]),
        winJambB: boxAt([SIDE_X - 10, SIDE_X + 120], WINDOW.y, [WINDOW.z[1] - 26, WINDOW.z[1]]),
        winMullion: boxAt([SIDE_X + 34, SIDE_X + 58], WINDOW.y, [(WINDOW.z[0] + WINDOW.z[1]) / 2 - 11, (WINDOW.z[0] + WINDOW.z[1]) / 2 + 11]),
        winTransom: boxAt([SIDE_X + 34, SIDE_X + 58], [WINDOW.y[0] + 560, WINDOW.y[0] + 582], WINDOW.z),

        // The screen over it, slid open. Two leaves in two planes, both pushed
        // to the far end of the window so a third of it is left clear — which is
        // what makes it a screen that has been opened rather than a screen. The
        // paper casts, so what comes in through the clear part is the street
        // lamp itself and what comes past the leaves is nothing.
        screenA: shojiPanel(SIDE_X - 52, [WINDOW.z[0], WINDOW.z[0] + 380], WINDOW.y),
        screenB: shojiPanel(SIDE_X - 26, [WINDOW.z[0] + 300, WINDOW.z[0] + 680], WINDOW.y),

        floor: boxAt([-3200, SIDE_X + 120], [FLOOR_Y - 120, FLOOR_Y], [WALL_Z, 3000]),

        // The nightstand: a top with an overhang and a moulding under it, a
        // carcass set back, one drawer in a reveal, and a recessed plinth so it
        // does not sit flat on the floor.
        //
        // Centred on the origin in both directions, because the lamp stands at
        // the origin and a lamp pushed towards the front edge of the table it is
        // on reads as one about to be knocked off.
        top: boxAt([-278, 278], [TABLE_Y - 22, TABLE_Y], [-230, 230]),
        lip: boxAt([-268, 268], [-34, -22], [-220, 220]),
        carcass: boxAt([-246, 246], [-604, -34], [-200, 200]),
        drawer: boxAt([-224, 224], [-246, -74], [-198, 210]),
        drawerLip: boxAt([-224, 224], [-90, -74], [-198, 216]),
        plinth: boxAt([-224, 224], [-676, -604], [-178, 178]),
        knobStem: boxAt([-9, 9], [-169, -151], [210, 224]),
        knob: new THREE.SphereGeometry(17, 24, 16).translate(0, -160, 230),

        // the bed: a headboard panel between two posts, a mattress that runs the
        // whole length of it, and a duvet turned down at the top
        // The bed, as a bed is actually put together: a headboard between two
        // posts, side rails between the posts and the foot, and legs under all
        // four corners.
        //
        // It had one post, at the near end, and nothing at the far one — which
        // is not a style of bed, it is half a bed. And it stood on nothing: the
        // rails ran from the headboard to the foot with a metre of air beneath
        // them. Neither is visible from the default camera, and both are
        // obvious the moment you orbit, which is the whole point of being able
        // to.
        headboard: boxAt([BED_X, BED_FAR], [-300, 610], [WALL_Z, WALL_Z + 46]),
        headRail: boxAt([BED_X, BED_FAR], [610, 668], [WALL_Z - 14, WALL_Z + 60]),
        postNear: boxAt([BED_X, BED_X + 96], [FLOOR_Y, 706], [WALL_Z, WALL_Z + 96]),
        postFar: boxAt([BED_FAR - 96, BED_FAR], [FLOOR_Y, 706], [WALL_Z, WALL_Z + 96]),
        capNear: boxAt([BED_X - 16, BED_X + 112], [706, 730], [WALL_Z - 16, WALL_Z + 112]),
        capFar: boxAt([BED_FAR - 112, BED_FAR + 16], [706, 730], [WALL_Z - 16, WALL_Z + 112]),

        railNear: boxAt([BED_X + 12, BED_X + 78], [-350, -250], [WALL_Z + 46, BED_END]),
        railFar: boxAt([BED_FAR - 78, BED_FAR - 12], [-350, -250], [WALL_Z + 46, BED_END]),
        railFoot: boxAt([BED_X + 12, BED_FAR - 12], [-350, -250], [BED_END - 66, BED_END]),
        slats: boxAt([BED_X + 40, BED_FAR - 40], [-346, -320], [WALL_Z + 46, BED_END]),
        legFootNear: boxAt([BED_X + 12, BED_X + 90], [FLOOR_Y, -250], [BED_END - 78, BED_END]),
        legFootFar: boxAt([BED_FAR - 90, BED_FAR - 12], [FLOOR_Y, -250], [BED_END - 78, BED_END]),
        mattress: pillowGeometry(1900, 210, BED_END - (WALL_Z + 46), 0.06).translate(
          1600,
          -225,
          (WALL_Z + 46 + BED_END) / 2
        ),
        duvet: pillowGeometry(1900, 150, 1180, 0.14).translate(1600, -48, 620),
        // Turned down at the head of the bed, and the same soft cloth as the
        // pillow rather than a slab: it is the one piece of bedding the eye can
        // compare directly against the pillow beside it.
        sheet: pillowGeometry(1900, 96, 300, 0.3).translate(1600, -14, 130),

        // the scroll: paper, two rods, the end caps on the lower one, and the
        // cord it hangs by
        // the ceiling, and the pendant hanging off the middle of it
        ceiling: boxAt([-3200, SIDE_X + 120], [CEILING_Y, CEILING_Y + 120], [WALL_Z, 3000]),
        rod: boxAt(
          [CEILING_FIXTURE.x - 7, CEILING_FIXTURE.x + 7],
          [CEILING_FIXTURE.y + 96, CEILING_Y],
          [CEILING_FIXTURE.z - 7, CEILING_FIXTURE.z + 7]
        ),
        // open-ended, so the inside of the shade is a surface the bulb can light
        shade: new THREE.CylinderGeometry(46, 152, 132, 32, 1, true).translate(
          CEILING_FIXTURE.x,
          CEILING_FIXTURE.y + 30,
          CEILING_FIXTURE.z
        ),
        bulb: new THREE.SphereGeometry(30, 24, 16).translate(
          CEILING_FIXTURE.x,
          CEILING_FIXTURE.y,
          CEILING_FIXTURE.z
        ),

        // Upright: 380 tall on a 190 face, not 200 tall on a 380 one. A pillow
        // propped against a headboard stands on its long edge, and it is the
        // single loudest thing in this room about whether the bed is made.
        pillow: pillowGeometry(560, 380, 190),
      },
    };
  }, []);

  useEffect(
    () => () => {
      for (const value of Object.values(room)) {
        if (value instanceof THREE.Material) value.dispose();
      }
      room.paper.map?.dispose();
      for (const value of Object.values(room.geometry)) {
        if (value instanceof THREE.BufferGeometry) value.dispose();
        else {
          value.frame.dispose();
          value.paper.dispose();
        }
      }
    },
    [room]
  );

  return room;
}

export function ShowcaseRoom({ standY, ceilingOn }: { standY: number; ceilingOn: boolean }) {
  const room = useRoom();
  const g = room.geometry;

  return (
    <group position={[0, standY, 0]}>
      {/* Plaster. Nearly white as a colour and nearly black on screen — the only
          light in the room is inside the lamp, so what the wall shows is the
          spill, which is the point of having one. */}
      <mesh geometry={g.wall} material={room.plaster} receiveShadow />
      {/* The side wall casts as well as receives: it is the thing that turns a
          light outside into a window-shaped patch on the floor. */}
      <mesh geometry={g.sideBelow} material={room.plaster} castShadow receiveShadow />
      <mesh geometry={g.sideAbove} material={room.plaster} castShadow receiveShadow />
      <mesh geometry={g.sideNear} material={room.plaster} castShadow receiveShadow />
      <mesh geometry={g.sideFar} material={room.plaster} castShadow receiveShadow />
      <mesh geometry={g.sill} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.winHead} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.winJambA} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.winJambB} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.winMullion} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.winTransom} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.screenA.frame} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.screenB.frame} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.screenA.paper} material={room.screen} castShadow receiveShadow />
      <mesh geometry={g.screenB.paper} material={room.screen} castShadow receiveShadow />
      <mesh geometry={g.floor} material={room.floor} receiveShadow />
      <mesh geometry={g.ceiling} material={room.ceiling} receiveShadow />

      <mesh geometry={g.rod} material={room.ebony} castShadow />
      {/* The shade is what the pendant *is*, seen from below: an open cone whose
          inside is a bright ring when the bulb is lit and a dull one when it is
          not. Double-sided for that reason and no other. */}
      <mesh geometry={g.shade} castShadow receiveShadow>
        <meshStandardMaterial
          color="#e8dcc6"
          roughness={0.85}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={g.bulb}>
        <meshStandardMaterial
          color="#fff3dd"
          emissive="#ffd9a0"
          emissiveIntensity={ceilingOn ? 4 : 0}
          roughness={0.4}
        />
      </mesh>

      <mesh geometry={g.top} material={room.oak} castShadow receiveShadow />
      <Lacquer />
      <mesh geometry={g.lip} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.carcass} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.drawer} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.drawerLip} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.plinth} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.knobStem} material={room.ebony} castShadow />
      <mesh geometry={g.knob} castShadow>
        <meshStandardMaterial color="#2f2418" roughness={0.32} metalness={0.55} />
      </mesh>

      <mesh geometry={g.headboard} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.headRail} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.postNear} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.postFar} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.capNear} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.capFar} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.railNear} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.railFar} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.railFoot} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.slats} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.legFootNear} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.legFootFar} material={room.walnut} castShadow receiveShadow />

      <mesh geometry={g.mattress} material={room.ticking} castShadow receiveShadow />
      <mesh geometry={g.duvet} material={room.duvet} castShadow receiveShadow />
      <mesh geometry={g.sheet} material={room.sheet} castShadow receiveShadow />

      {/* Upright against the headboard, the way a made bed has it — propped on
          its long edge rather than lying flat, which is what the reference photo
          shows and what a pillow does when the bed is not slept in. */}
      <group position={[1090, 76, -116]} rotation={[-0.15, -0.09, 0.02]}>
        <mesh geometry={g.pillow} material={room.pillow} castShadow receiveShadow />
      </group>

      <HangingScroll paper={room.paper} rods={room.ebony} wrap={room.screen} />
    </group>
  );
}
