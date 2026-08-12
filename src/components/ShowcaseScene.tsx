import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { ShowcaseLamp, useLampScene } from "./LampView";
import { CEILING_FIXTURE, ShowcaseRoom } from "./ShowcaseRoom";
import { useLampStore } from "../store/useLampStore";
import { RicePaperMaterial, paperShellGeometry } from "../lib/ricePaper";

/**
 * The realistic showcase: a lamp lit from the inside, in a dark bedroom.
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
 * Candela. See the note above about millimetres — at 250 mm this lights a table
 * top, and at 700 mm it is a quarter as bright on the wall behind.
 */
const BULB_CANDELA = 110000;

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
 */
const PAPER_SPILL = 0.72;

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
 * How far back the camera has to be for the lamp to take up {@link LAMP_FILL}.
 *
 * Measured on the lamp as an upright cylinder rather than on its bounding box:
 * the showcase turns, and a box framed on its width is a box that grows and
 * shrinks in the frame as you orbit it. Both fields of view are checked, so a
 * phone held upright frames the lamp on its height and a wide window frames it
 * on its girth, and neither crops it.
 */
function frameDistance(half: THREE.Vector3, aspect: number): number {
  const vTan = Math.tan((FOV * Math.PI) / 360);
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
function RicePaper({ box, lit }: { box: THREE.Box3; lit: boolean }) {
  const geometry = useMemo(() => paperShellGeometry(box), [box]);
  const material = useMemo(() => new RicePaperMaterial(), []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  // Switched off, the paper is just paper — a cream sheet for whatever else is
  // lighting the room to fall on. Written straight onto the material rather than
  // through a new one: `emissiveIntensity` is a uniform, and swapping materials
  // to flick a switch would recompile the program.
  material.emissiveIntensity = lit ? 1 : 0;

  const height = box.max.y - box.min.y;
  material.setBulb(
    new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.min.y + height * BULB_HEIGHT,
      (box.min.z + box.max.z) / 2
    ),
    height * BULB_REACH
  );

  return <mesh geometry={geometry} material={material} />;
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
 * Everything in the realistic showcase.
 *
 * **The camera is framed once, on the lamp, and then left alone.** Not on the
 * variables: a Width or Height drag is somebody watching *this* lamp change
 * size, and a camera that backed off to keep it the same size on screen would
 * be showing them nothing changing. Not on the window either — the user's orbit
 * is theirs to keep. So the box and the aspect are both read through refs, and
 * the only thing that re-frames is a different lamp arriving.
 */
export function RealisticShowcase({
  compact,
  lampOn,
  ceilingOn,
}: {
  compact: boolean;
  lampOn: boolean;
  ceilingOn: boolean;
}) {
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

  const aspectRef = useRef(1);
  aspectRef.current = size.width / Math.max(size.height, 1);
  const boxRef = useRef(lampBox);
  boxRef.current = lampBox;

  // Which lamp is on show. Not how big it is — that is the whole point.
  const lampKey = instances.map((instance) => instance.id).join(",");

  const { position, target, reach } = useMemo(() => {
    const current = boxRef.current;
    const half = current.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const centre = current.getCenter(new THREE.Vector3());
    const distance = frameDistance(half, aspectRef.current);
    return {
      position: [
        centre.x + VIEW_DIR.x * distance,
        centre.y + VIEW_DIR.y * distance,
        centre.z + VIEW_DIR.z * distance,
      ] as [number, number, number],
      target: centre,
      reach: distance,
    };
    // the box and the aspect are read through refs on purpose — see above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lampKey]);

  // What the shadow maps were drawn for. The placements move with the variables
  // and the instance list, and `scene` is rebuilt whenever either does.
  const token = useMemo(
    () => [scene.placements.size, box.max.toArray().join(","), lampOn, ceilingOn].join("|"),
    [scene, box, lampOn, ceilingOn]
  );

  return (
    <>
      <PerspectiveCamera makeDefault position={position} fov={FOV} near={5} far={12000} />

      {/* Night, not black: a trace of cool light so that what neither lamp
          reaches is a dark room rather than a hole in the screen. The ceiling
          light adds to it rather than replacing it, because a lit room bounces
          — a single point source with nothing coming back off the walls gives a
          moon landing, not a bedroom. */}
      <ambientLight intensity={ceilingOn ? 0.34 : 0.075} color={ceilingOn ? "#a99b86" : "#6d6355"} />

      {lampOn && (
        <pointLight
          position={bulb.toArray()}
          color="#ffcb92"
          intensity={BULB_CANDELA * PAPER_SPILL}
          decay={2}
        />
      )}

      {lampOn && (
        <pointLight
          position={bulb.toArray()}
          color={BULB_COLOR}
          intensity={BULB_CANDELA}
          decay={2}
          castShadow
          shadow-mapSize={compact ? [512, 512] : [1024, 1024]}
          shadow-camera-near={4}
          shadow-camera-far={5000}
          shadow-bias={-0.0006}
          // in world units, and the world is millimetres: a hair over the
          // thinnest section anything here is cut to, which is what stops a 7 mm
          // kumiko bar shadowing itself
          shadow-normalBias={1.4}
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
          shadow-normalBias={2}
        />
      )}

      <ShowcaseRoom standY={standY} ceilingOn={ceilingOn} />
      <RicePaper box={box} lit={lampOn} />
      <ShowcaseLamp scene={scene} />

      <StaticShadows token={token} />

      <OrbitControls
        makeDefault
        target={target}
        enablePan={false}
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.08}
        // never under the table and never over the top: both are views of the
        // undersides of a room that was only ever built to be seen from here
        minPolarAngle={Math.PI * 0.16}
        maxPolarAngle={Math.PI * 0.5}
        minDistance={reach * 0.35}
        maxDistance={reach * 3.5}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
      />

      {/* The halo. A lamp this bright against a room this dark blooms in every
          camera and in the eye, and without it the paper reads as a white card.
          Kept low: what is wanted is the glow around the shade, not a soft
          filter over the furniture. */}
      <EffectComposer multisampling={compact ? 0 : 4}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.3} />
        <Vignette offset={0.28} darkness={0.62} />
      </EffectComposer>
    </>
  );
}
