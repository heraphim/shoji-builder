import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { ShowcaseLamp, useLampScene } from "./LampView";
import { CAMERA_BOUNDS, CEILING_FIXTURE, WINDOW, ShowcaseRoom } from "./ShowcaseRoom";
import { useLampStore } from "../store/useLampStore";
import { RicePaperMaterial, paperShellGeometry, shellFloorGeometry } from "../lib/ricePaper";
import { PaintEffect, type PaintParams } from "../lib/paint";
import { showcaseLook } from "../lib/showcaseLook";
import type { OutsideLight, ShowcaseStyleId } from "../lib/showcaseStyles";

/**
 * The showcase: a lamp lit from the inside, in a bedroom, drawn whichever way
 * the visitor asked for.
 *
 * The room and the lighting below are the *realistic* answer, and every other
 * style is that same room with the painter's decisions laid over it — see
 * `lib/showcaseLook.ts` for what those are and `lib/paint.ts` for how the
 * picture is drawn. Nothing here branches on the style by name; it reads the
 * look's numbers, which is what keeps an eighth style from being an eighth
 * copy of the scene.
 *
 * One light. Everything you can see in this scene is there because the bulb
 * inside the shade put it there, which is the whole reason the picture works —
 * the wall is lit by a lamp rather than painted the colour of lamplight, the
 * nightstand top carries the lattice's shadow because the lattice is genuinely
 * between the bulb and the table, and the far corner of the room falls away to
 * nothing because nothing is lighting it.
 *
 * That has three consequences worth stating, because each of them is a thing
 * somebody would otherwise "fix":
 *
 * - **The paper casts no shadow.** It is what makes the light diffuse, not what
 *   stops it — see `lib/ricePaper.ts`. If it cast, the room would go black.
 * - **The light is in candela, and the numbers are enormous.** The app works in
 *   millimetres and three.js falls off as 1/d², so a lamp that reads correctly
 *   at 250 mm needs an intensity in the tens of thousands. That is not a bug and
 *   it must not be "tidied" to something that looks like a normal light.
 * - **Shadow maps are updated by hand.** A point light casts into a cube — six
 *   renders of the scene — and orbiting the camera changes not one pixel of it.
 *   See {@link StaticShadows}.
 */

/** Where the camera stands, as a direction from the lamp towards it. */
const VIEW_DIR = new THREE.Vector3(-0.26, 0.21, 1).normalize();

const FOV = 34;

/**
 * The narrowest the *horizontal* field may get, as the tangent of its half-angle.
 *
 * {@link FOV} is vertical, so how much of the room is beside the lamp is decided
 * by the window's shape, and an upright phone is the shape that decides it worst:
 * at 34° vertical and an aspect of one half, the picture is 17° wide. That is a
 * slice of wall about 840 mm across in a room nearly six metres wide — and there
 * is no dollying out of it, because {@link KeepInRoom} stops the camera at the
 * near edge of the room long before the frame has opened up. On a phone the whole
 * zoom range was a fifth wider than the first shot and every part of it was
 * lamp-and-wall.
 *
 * So below a certain aspect the vertical angle opens until the horizontal one
 * stops shrinking: 30° across, which a phone reaches at around 56° tall. Wide,
 * and a phone's own camera is wider still — an upright shot of a room is a
 * wide-angle shot, in this app and in the hardware people are used to.
 *
 * A window's shape rather than a phone test, for the same reason the layout uses
 * one: what starves the frame is a tall narrow viewport, whether that is a handset
 * or a docked panel. Anything from about 0.88 : 1 up — every landscape window,
 * including the same phone turned on its side — is already wider than the floor
 * and comes out at exactly {@link FOV}.
 */
const MIN_H_TAN = Math.tan((30 * Math.PI) / 360);

/**
 * The vertical field of view for a window of this shape: {@link FOV}, opened up
 * if that is what {@link MIN_H_TAN} costs.
 */
function fovFor(aspect: number): number {
  const vTan = Math.max(Math.tan((FOV * Math.PI) / 360), MIN_H_TAN / Math.max(aspect, 1e-6));
  return (Math.atan(vTan) * 360) / Math.PI;
}

/**
 * Which way round the camera starts, as an OrbitControls azimuth.
 *
 * Derived from {@link VIEW_DIR} rather than written down twice: the swing limits
 * are relative to it, and two numbers that have to agree eventually will not.
 */
const DEFAULT_AZIMUTH = Math.atan2(VIEW_DIR.x, VIEW_DIR.z);

/**
 * How much of the frame's *height* the lamp takes up.
 *
 * Height rather than "the smaller of the two", which is what this was first
 * written as. An upright phone is narrow, and framing on the narrow dimension
 * walked the camera back until the lamp was under a third of the screen with the
 * rest of it wall — the picture stopped being of a lamp. Width is only ever
 * consulted to check the lamp is not cropped; see {@link frameDistance}.
 */
const LAMP_FILL = 0.44;

/** How much of the frame's width the lamp may take before the camera backs off. */
const CROP_LIMIT = 0.92;

/** The bulb's height up the shade, and how far its light carries. */
const BULB_HEIGHT = 0.42;
const BULB_REACH = 0.62;

/**
 * How much of its brightness the shade keeps when the lamp is turned all the way
 * down. See {@link RicePaper} for why it is not zero.
 */
const PAPER_FLOOR = 0.42;

/**
 * Candela at full. See the note above about millimetres — at 250 mm this lights
 * a table top, and at 700 mm it is a quarter as bright on the wall behind. The
 * Glow slider scales it, and ships at well under 1.
 */
/**
 * Raised when the shade got a floor. Closing the bottom took away every ray that
 * had been lighting the table through it — which was the point, and which also
 * removed a good deal of what was lighting the room, so the source has to give
 * back what the board now stops.
 */
const BULB_CANDELA = 88000;

/**
 * How much of the bulb is re-emitted by the paper, as a second light that casts
 * nothing.
 *
 * The shade is a two-foot lantern of glowing paper, and in a real room that is
 * the light source — a big soft one that wraps round the table and up the wall.
 * Three.js has no such thing: `emissive` is a colour a surface *is*, not one it
 * *gives*, so the paper lit nothing at all and the nightstand under the brightest
 * object in the room came out black.
 *
 * So the source is modelled as two lights in one place. The shadow-casting one
 * is the filament, and it is what throws the kumiko across the wall; this one
 * stands for the paper, and it casts nothing **on purpose** — a diffuser's whole
 * job is to have no sharp shadow, and passing through the timber is how a light
 * with no geometry behaves like one with a large area.
 *
 * **The ratio between the two is what shadow contrast means here.** Nearly all of
 * a shoji lantern's output leaves through the paper and only a little escapes
 * past the frame as a beam; a scene lit mostly by the filament has hard black
 * shadows, which is what a bare bulb does and not what this object does. So the
 * spill carries close to twice what the filament does, and the shadows are pale
 * because most of the light was never blocked in the first place — widening the
 * blur alone would have been a filter over the symptom.
 */
const PAPER_SPILL = 1.9;

/**
 * How wide the shadow's penumbra is, in shadow-map texels.
 *
 * Only five taps go into it — three.js samples a point light's cube shadow with a
 * five-point Vogel disk, rotated per pixel by interleaved-gradient noise. Past a
 * certain radius that stops reading as blur and starts reading as noise, and the
 * noise is what sets the ceiling here rather than taste. The per-pixel rotation
 * is what makes it dither rather than band, which is why it can go as far as it
 * does.
 */
const SHADOW_SOFTNESS = 15;

/** Tungsten, and a touch further into the amber than tungsten really is. */
const BULB_COLOR = "#ffb163";

/**
 * The pendant in the middle of the ceiling: two metres up rather than a
 * hand's width away, so it needs the square of that difference in candela.
 */
const CEILING_CANDELA = 2_100_000;

/** Warm white — a room light, not a bedside one. */
const CEILING_COLOR = "#ffe0b8";

/**
 * The street lamp outside the window.
 *
 * A point light, because it is twenty feet away and falls off across the room.
 * Sodium orange, dim, and below the window head, so what it draws on the ceiling
 * is the window upside down. It casts, and the side wall casts with it \— without
 * that there is no window, only a light that happens to be outside.
 */
const STREET = {
  at: [4600, 1520, 1900] as const,
  color: "#ffa74e",
  candela: 7_000_000,
  sky: 0.05,
  skyColor: "#5c6b8c",
};

/**
 * How far back the camera has to be for the lamp to take up {@link LAMP_FILL}.
 *
 * Measured on the lamp as an upright cylinder rather than on its bounding box:
 * the showcase turns, and a box framed on its width is a box that grows and
 * shrinks in the frame as you orbit it. Both fields of view are checked, so a
 * phone held upright frames the lamp on its height and a wide window frames it
 * on its girth, and neither crops it.
 *
 * Takes the angle rather than reading {@link FOV}, because the phone's is wider —
 * see {@link fovFor}. Everything downstream is measured in this distance, so the
 * limits move with it: a wider lens frames the same lamp from closer, and
 * `minDistance` and the zoom ceiling both being multiples of it is what keeps
 * "as close as the shot allows" meaning the same composition on either.
 */
function frameDistance(half: THREE.Vector3, aspect: number, fov: number): number {
  const vTan = Math.tan((fov * Math.PI) / 360);
  const hTan = vTan * Math.max(aspect, 1e-6);
  const radius = Math.hypot(half.x, half.z);
  const forHeight = half.y / vTan / LAMP_FILL;
  const forWidth = radius / hTan / CROP_LIMIT;
  return Math.max(forHeight, forWidth) + radius;
}

/**
 * The paper, and the bulb behind it.
 *
 * The shell is the main box skinned on five sides, so it is re-derived whenever
 * the box is — which is every variable edit. Both the geometry and the material
 * are disposed with it: a `BufferGeometry` that has been drawn holds GPU buffers
 * that garbage collection will not reclaim, and a slider drag makes one per
 * frame.
 */
function RicePaper({ box, lit, glow }: { box: THREE.Box3; lit: boolean; glow: number }) {
  const geometry = useMemo(() => paperShellGeometry(box), [box]);
  const floor = useMemo(() => shellFloorGeometry(box), [box]);
  const material = useMemo(() => new RicePaperMaterial(), []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => floor.dispose(), [floor]);
  useEffect(() => () => material.dispose(), [material]);

  // Switched off, the paper is just paper — a cream sheet for whatever else is
  // lighting the room to fall on. Written straight onto the material rather than
  // through a new one: `emissiveIntensity` is a uniform, and swapping materials
  // to flick a switch would recompile the program.
  //
  // The shade dims *less* than the room does. Turning a lamp down takes the
  // spill off the walls long before the shade itself stops looking lit — you are
  // looking straight at the source, and it is the one thing in the picture whose
  // brightness barely moves. Dimming both by the same factor reads as the lamp
  // going out rather than as the room going dark.
  material.emissiveIntensity = lit ? PAPER_FLOOR + (1 - PAPER_FLOOR) * glow : 0;

  const height = box.max.y - box.min.y;
  material.setBulb(
    new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.min.y + height * BULB_HEIGHT,
      (box.min.z + box.max.z) / 2
    ),
    height * BULB_REACH
  );

  return (
    <>
      <mesh geometry={geometry} material={material} />
      {/* Casts, and is the only part of the shade that does. It is what makes
          the underside of the lamp dark. */}
      <mesh geometry={floor} castShadow>
        <meshStandardMaterial color="#3a2a1a" roughness={0.85} metalness={0} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/**
 * Shadow maps that are redrawn when the lamp changes and not when the camera
 * does.
 *
 * A point light shadows into a cube map: six renders of the whole room, every
 * frame, for a shadow that depends on nothing the camera is doing. Nothing in
 * this scene moves except the lamp itself, so the six renders are worth exactly
 * one per edit — which on a phone is the difference between the orbit being
 * smooth and not.
 *
 * `token` is whatever identifies the lamp as drawn. It changes on every frame of
 * a slider drag, which is correct: that is a frame where the shadow *is* stale.
 */
function StaticShadows({ token }: { token: string }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, token]);

  return null;
}

/**
 * How far a ray from `origin` in `direction` gets before it leaves the box.
 *
 * The slab method, minus the parts that only matter when the origin might be
 * outside: it never is here — the origin is the orbit target, which is the lamp.
 */
function exitDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  bounds: THREE.Box3
): number {
  let nearest = Infinity;
  for (const axis of ["x", "y", "z"] as const) {
    const d = direction[axis];
    if (Math.abs(d) < 1e-6) continue;
    const wall = d > 0 ? bounds.max[axis] : bounds.min[axis];
    nearest = Math.min(nearest, (wall - origin[axis]) / d);
  }
  return nearest;
}

/**
 * Keeps the camera inside the room, by telling the controls how far out they may
 * go rather than by moving the camera afterwards.
 *
 * The first version clamped `camera.position` every frame, and it worked and it
 * felt terrible: with damping on, the controls still hold momentum towards a
 * place the clamp keeps taking the camera back from, so the two argue once per
 * frame and the result is a stutter right where the user is pushing hardest.
 * Anything that moves the camera behind the controls' back has that problem.
 *
 * So nothing moves the camera. Each frame this works out how far the orbit could
 * go along its *current* direction before leaving the room, and hands that to
 * `maxDistance` — which OrbitControls already clamps the radius against, inside
 * its own update, with its own damping. Dollying out simply stops, smoothly, and
 * swinging towards a wall draws the camera gently in rather than shunting it.
 *
 * Eased rather than set, because the safe distance changes fast when the
 * direction sweeps past a corner, and a `maxDistance` that jumps is a radius
 * that jumps.
 */
function KeepInRoom({ standY, ceiling }: { standY: number; ceiling: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as
    | { target: THREE.Vector3; maxDistance: number }
    | null;

  const bounds = useMemo(
    () =>
      new THREE.Box3(
        new THREE.Vector3(CAMERA_BOUNDS.min[0], CAMERA_BOUNDS.min[1] + standY, CAMERA_BOUNDS.min[2]),
        new THREE.Vector3(CAMERA_BOUNDS.max[0], CAMERA_BOUNDS.max[1] + standY, CAMERA_BOUNDS.max[2])
      ),
    [standY]
  );

  const direction = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!controls) return;
    direction.subVectors(camera.position, controls.target);
    const distance = direction.length();
    if (distance < 1e-3) return;
    direction.divideScalar(distance);

    const room = exitDistance(controls.target, direction, bounds);
    const wanted = Math.min(ceiling, Math.max(1, room));
    controls.maxDistance += (wanted - controls.maxDistance) * 0.12;
  });

  return null;
}

/**
 * Fires once, on the first frame the renderer actually draws.
 *
 * The last thing the loading screen is waiting for, and the one with no other
 * signal: every asset can be in hand while the GPU is still compiling the
 * shaders for them, and on a cold cache that is the longest single wait on this
 * page. `useFrame` is the only place that knows it is over.
 */
function FirstFrame({ onDrawn }: { onDrawn: () => void }) {
  const drawn = useRef(false);
  useFrame(() => {
    if (drawn.current) return;
    drawn.current = true;
    onDrawn();
  });
  return null;
}

/**
 * The drawn styles' one shader, as a thing the composer can hold.
 *
 * The effect instance outlives every style change: switching from anime to
 * watercolour writes eighteen uniforms and compiles nothing, which is the
 * difference between the menu closing on a drawn frame and closing on a stall.
 * Written on render rather than in an effect because the composer may draw
 * before a `useEffect` has run, and one frame of the wrong style is one frame
 * the visitor sees.
 */
function Paint({ params }: { params: PaintParams }) {
  const effect = useMemo(() => new PaintEffect(params), [params]);
  useEffect(() => () => effect.dispose(), [effect]);
  effect.apply(params);
  return <primitive object={effect} dispose={null} />;
}

/**
 * Everything in the showcase.
 *
 * **The camera is framed once, on the lamp, and then left alone.** Not on the
 * variables: a Width or Height drag is somebody watching *this* lamp change
 * size, and a camera that backed off to keep it the same size on screen would
 * be showing them nothing changing. Not on the window either — the user's orbit
 * is theirs to keep. So the box and the aspect are both read through refs, and
 * the only thing that re-frames is a different lamp arriving.
 *
 * The style is not on that list either. Changing how the room is drawn is not a
 * reason to move the camera — you have just asked to see the same picture in a
 * different hand, and the first thing you would check is whether it is the same
 * picture.
 */
export function Showcase({
  style,
  compact,
  lampOn,
  ceilingOn,
  outside,
  glow,
  onDrawn,
}: {
  style: ShowcaseStyleId;
  compact: boolean;
  lampOn: boolean;
  ceilingOn: boolean;
  outside: OutsideLight;
  /** How far the lamp is turned up: 0 is barely alight, 1 is the full bulb. */
  glow: number;
  onDrawn: () => void;
}) {
  const look = showcaseLook(style);
  const scene = useLampScene();
  const instances = useLampStore((state) => state.instances);
  const box = scene.mainBox;
  const size = useThree((state) => state.size);

  const height = box.max.y - box.min.y;
  const bulb = useMemo(
    () =>
      new THREE.Vector3(
        (box.min.x + box.max.x) / 2,
        box.min.y + height * BULB_HEIGHT,
        (box.min.z + box.max.z) / 2
      ),
    [box, height]
  );

  /**
   * The lamp as it actually is, timber and all.
   *
   * The main box is the volume the frame is built *around*: a cap stands above
   * it and a leg hangs below it, and both are the lamp. Framing on the reference
   * instead of on the wood is what cropped the finial off the top of the shot,
   * and standing the room on it is what buried the feet in the table.
   */
  const lampBox = useMemo(() => {
    const whole = box.clone();
    for (const world of scene.worldBoxes.values()) whole.union(world);
    return whole;
  }, [scene, box]);

  const standY = lampBox.min.y;

  // The street lamp is aimed at the window rather than at a number: move the
  // opening and the light outside it follows, which is the only way the patch it
  // throws stays a window shape.
  void WINDOW;

  const aspect = size.width / Math.max(size.height, 1);
  const fov = fovFor(aspect);

  const aspectRef = useRef(1);
  aspectRef.current = aspect;
  const fovRef = useRef(fov);
  fovRef.current = fov;
  const boxRef = useRef(lampBox);
  boxRef.current = lampBox;

  // Which lamp is on show. Not how big it is — that is the whole point.
  const lampKey = instances.map((instance) => instance.id).join(",");

  const { position, target, reach } = useMemo(() => {
    const current = boxRef.current;
    const half = current.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const centre = current.getCenter(new THREE.Vector3());
    const distance = frameDistance(half, aspectRef.current, fovRef.current);
    return {
      position: [
        centre.x + VIEW_DIR.x * distance,
        centre.y + VIEW_DIR.y * distance,
        centre.z + VIEW_DIR.z * distance,
      ] as [number, number, number],
      target: centre,
      reach: distance,
    };
    // the box, the aspect and the angle are read through refs on purpose — see
    // above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lampKey]);

  // What the shadow maps were drawn for. The placements move with the variables
  // and the instance list, and `scene` is rebuilt whenever either does.
  const token = useMemo(
    () => [scene.placements.size, box.max.toArray().join(","), lampOn, ceilingOn, outside].join("|"),
    // glow is deliberately absent: it changes how bright the shadows are, not
    // where they fall, and re-rendering six cube faces on every frame of a
    // slider drag would buy nothing
    [scene, box, lampOn, ceilingOn, outside]
  );

  return (
    <>
      {/* The lens follows the window's shape live, while the framing does not:
          turning a phone on its side narrows the angle back to {@link FOV} where
          the width no longer needs the help, and the camera stays exactly where
          the visitor left it. */}
      <PerspectiveCamera makeDefault position={position} fov={fov} near={5} far={12000} />

      {/* The room's own bounce, from whichever sources are lit.
       *
       * A hemisphere and not an ambient. Ambient light is one number added to
       * every fragment: it does not know which way a surface faces, so under it
       * a bumped board and a flat one are the same board and every material in
       * the room goes to paint. With the lamp off that was all there was, and
       * the timber went dead flat - the grain relief, the plaster tooth and the
       * weave were all still being computed and not one of them could show. A
       * hemisphere costs the same and knows up from down, so a normal means
       * something again.
       *
       * The ceiling light raises it rather than replacing it, because a lit room
       * bounces: a single point source with nothing coming back off the walls
       * gives a moon landing, not a bedroom. */}
      <hemisphereLight
        args={[
          look.ambientColor?.sky ?? (ceilingOn ? "#bfae94" : "#7d8296"),
          look.ambientColor?.ground ?? (ceilingOn ? "#6b5a44" : "#3b3228"),
          (ceilingOn ? 0.5 : 0.17) * look.ambient,
        ]}
      />

      {/* And the painter's own light, from where the viewer is.
       *
       * Zero in the realistic style, because there is nothing there. In every
       * drawn style there is: an illustrator lights a night interior enough to
       * draw it, and the near face of the nightstand — turned away from the
       * bulb, the ceiling and the window all three — is a readable brown in
       * every one of the references and would be black under this room's real
       * lighting. It casts nothing, which is what makes it a decision about the
       * drawing rather than a fifth lamp. */}
      {look.fill > 0 && (
        <directionalLight
          position={[-900, 1400, 3200]}
          intensity={look.fill}
          color={look.fillColor}
        />
      )}

      {/* And the sheen. Neither ambient nor hemisphere light makes a specular
          highlight - only a light with a direction can - so without this the
          finish on the timber is a number with nothing to demonstrate it. Dim
          enough to leave the lamp the brightest thing in the room by a long way,
          and from the window, because that is where the rest of the world is. */}
      <directionalLight position={[3200, 1400, 1600]} intensity={0.2} color="#c8d1e3" />

      {outside === "street" && <ambientLight intensity={STREET.sky} color={STREET.skyColor} />}

      {lampOn && (
        <pointLight
          position={bulb.toArray()}
          color="#ffcb92"
          intensity={BULB_CANDELA * PAPER_SPILL * glow * look.bulb}
          decay={2}
          // It casts, which reads as a contradiction with the note above and is
          // not one. What it must not do is throw a *sharp* shadow, and that is
          // the radius' job; what it must do is stop at the board in the bottom
          // of the shade, because a diffuser lets light through and a piece of
          // wood does not. The paper still casts nothing, so the sides are as
          // open to it as ever — only the floor of the lantern is shut.
          castShadow
          shadow-mapSize={compact ? [512, 512] : [1024, 1024]}
          shadow-camera-near={4}
          shadow-camera-far={5000}
          shadow-bias={-0.0006}
          shadow-normalBias={26}
          shadow-radius={SHADOW_SOFTNESS * 2.2}
        />
      )}

      {lampOn && (
        <pointLight
          position={bulb.toArray()}
          color={BULB_COLOR}
          intensity={BULB_CANDELA * glow * look.bulb}
          decay={2}
          castShadow
          shadow-mapSize={compact ? [512, 512] : [1024, 1024]}
          shadow-camera-near={4}
          shadow-camera-far={5000}
          shadow-bias={-0.0006}
          // World units, and the world is millimetres.
          //
          // This has to be read together with the radius below, and that is the
          // whole of the reason it is 18 and not the 1.4 it started at. A wide
          // sampling disk takes its samples up to a couple of centimetres away
          // across the receiving surface, and on anything curved or steeply lit
          // — a pillow, a duvet — the depth at that distance is far enough from
          // the depth here that the surface shadows itself: not a soft edge, a
          // field of black dots. The bias has to cover the reach of the blur.
          //
          // The cost is contact: an offset this big lifts the sample far enough
          // off the surface that a shadow starts to detach from the thing making
          // it. 18 is where the speckle has gone and the lamp's feet still sit on
          // the table — checked, not guessed.
          shadow-normalBias={34}
          // The penumbra. A bare filament would throw a hard edge, but nothing
          // in this room sees the filament — it sees a foot of glowing paper, and
          // an area source that size a hand's width from the lattice casts a
          // shadow with almost no edge left at all. three.js has no area shadow,
          // so the radius stands in for one: it widens the Vogel disk the point
          // shadow is already sampled with.
          shadow-radius={SHADOW_SOFTNESS}
        />
      )}

      {ceilingOn && (
        <pointLight
          position={[CEILING_FIXTURE.x, CEILING_FIXTURE.y + standY, CEILING_FIXTURE.z]}
          color={CEILING_COLOR}
          intensity={CEILING_CANDELA}
          decay={2}
          castShadow
          shadow-mapSize={compact ? [512, 512] : [1024, 1024]}
          shadow-camera-near={20}
          shadow-camera-far={9000}
          shadow-bias={-0.0006}
          shadow-normalBias={26}
          // Softer still: it is a shade two metres up, and the further a source
          // is the wider the penumbra it throws for the same size.
          shadow-radius={SHADOW_SOFTNESS * 1.6}
        />
      )}

      {outside === "street" && (
        <pointLight
          position={[STREET.at[0], STREET.at[1] + standY, STREET.at[2]]}
          color={STREET.color}
          intensity={STREET.candela}
          decay={2}
          castShadow
          shadow-mapSize={compact ? [512, 512] : [1024, 1024]}
          shadow-camera-near={40}
          shadow-camera-far={12000}
          shadow-bias={-0.0006}
          shadow-normalBias={9}
          shadow-radius={SHADOW_SOFTNESS * 0.5}
        />
      )}

      <ShowcaseRoom standY={standY} ceilingOn={ceilingOn} look={look} />
      <RicePaper box={box} lit={lampOn} glow={glow} />
      <ShowcaseLamp scene={scene} />

      <StaticShadows token={token} />
      <FirstFrame onDrawn={onDrawn} />
      <KeepInRoom standY={standY} ceiling={reach * 4} />

      <OrbitControls
        makeDefault
        target={target}
        enablePan={false}
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.08}
        // Wide open, because the room is what stops the camera now rather than
        // the angles — see {@link KeepInRoom}. What is left here is only what a
        // box cannot express: not straight down the barrel from overhead, and
        // not so far under the lamp that the shot is of the underside of the
        // nightstand.
        minAzimuthAngle={DEFAULT_AZIMUTH - 2.5}
        maxAzimuthAngle={DEFAULT_AZIMUTH + 2.5}
        minPolarAngle={Math.PI * 0.08}
        maxPolarAngle={Math.PI * 0.62}
        minDistance={reach * 0.35}
        // The starting value only; {@link KeepInRoom} writes it every frame.
        maxDistance={reach * 4}
        // Slower than the default 1, because the wheel was crossing the whole
        // range in three notches and arriving at the limits at speed — which is
        // what made stopping at one feel like hitting something.
        zoomSpeed={0.55}
        rotateSpeed={0.75}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
      />

      {/* The halo, and the edges.

          Bloom is why the paper reads as lit rather than as a white card: a lamp
          this bright against a room this dark blooms in every camera and in the
          eye. Kept low — what is wanted is the glow around the shade, not a soft
          filter over the furniture.

          Anti-aliasing takes two passes because there are two kinds of jaggy
          here and neither one catches the other. **Multisampling** is the one
          that fixes geometry, and it is the only thing that can: a 7 mm kumiko
          bar is a couple of pixels wide, and its edge is a hard step between two
          triangles that no filter reading the finished image can undo. **SMAA**
          is the one that fixes everything else — the specular sparkle along a
          grain line, the stepped rim of a shadow, the diagonal of a fold — none
          of which is a geometric edge at all, so multisampling never sees them.
          Last in the chain, because it has to work on the picture as it will be
          seen, bloom and vignette included.

          The paint goes between the two halves of that and not at either end.
          After the bloom, because the halo is part of what is being drawn — a
          cel painter paints the glow, they do not glow the painting. Before the
          anti-aliasing, because an ink line one pixel wide laid over a smoothed
          picture is a jagged ink line, and it is the last thing added. */}
      <EffectComposer multisampling={compact ? 4 : 8}>
        {look.bloom && (
          <Bloom
            mipmapBlur
            intensity={look.bloom.intensity}
            luminanceThreshold={look.bloom.threshold}
            luminanceSmoothing={look.bloom.smoothing}
          />
        )}
        {look.paint && <Paint params={look.paint} />}
        {look.vignette && (
          <Vignette offset={look.vignette.offset} darkness={look.vignette.darkness} />
        )}
        <SMAA />
      </EffectComposer>
    </>
  );
}
