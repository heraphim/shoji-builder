import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ContactShadows } from "@react-three/drei";
import { useLookStore } from "../store/useLookStore";

/**
 * The one lighting rig, and the two cues that go with it.
 *
 * Every lit cell in the app renders {@link SceneLights} rather than lights of
 * its own, so the Options panel means the same thing wherever it is opened and
 * a lamp carried into the Component Editor is lit the way it was on the bench.
 * That is a deliberate reversal: each tab used to keep its own triple, tuned by
 * hand — the Textures tab more directional so the figure read, the projections
 * flat so they read as drawings — and the trouble with a hand-tuned constant is
 * that only the person who tuned it can change it.
 *
 * See `useLookStore` for what the numbers do and docs/ui-guide.md for the panel.
 */

/**
 * Ambient, key and fill, from the Options panel.
 *
 * The positions stay fixed. Where the lights are is a composition — over the
 * viewer's right shoulder, a weaker one behind and to the left, which is the
 * arrangement every drawing of a solid object has used for centuries — and it
 * is only how *hard* they are that is worth a control.
 */
export function SceneLights() {
  const ambient = useLookStore((state) => state.ambient);
  const key = useLookStore((state) => state.key);
  const fill = useLookStore((state) => state.fill);

  return (
    <>
      <ambientLight intensity={ambient} />
      <directionalLight position={[400, 600, 300]} intensity={key} />
      <directionalLight position={[-300, 200, -400]} intensity={fill} />
    </>
  );
}

/**
 * The layer a mesh has to be on to appear in a contact shadow.
 *
 * Enabled *alongside* layer 0, never instead of it — a mesh moved off 0 vanishes
 * from every ordinary camera in the app, which all test 0 and nothing else.
 */
export const SHADE_LAYER = 1;

/** Ref callback: this mesh is material, so it casts into the pool of shade. */
export function castsShade(mesh: THREE.Mesh | null) {
  mesh?.layers.enable(SHADE_LAYER);
}

/**
 * How far the pool of shade floats over the floor it lies on, in mm.
 *
 * Only to keep it out of a z-fight with a grid drawn at the same height, which
 * is the usual case: things stand on the bench.
 */
const SHADE_LIFT_MM = 0.2;

/**
 * The soft pool of shade under whatever is on the bench.
 *
 * Not a shadow map: no light here casts one, and what this is for is grounding
 * the model rather than lighting it. That also sets the limit — it darkens the
 * *floor* under the parts, not the joints between them. Part meeting part is an
 * occlusion question, and answering that needs an AO pass.
 *
 * `floorY` is separate from the box because the two are not the same everywhere:
 * a lamp stands on its grid, while the Component Editor hangs its grid well
 * below the part as a horizon rather than a bench. The shade belongs on the
 * floor the cell actually draws, or it reads as a card floating in mid-air.
 *
 * The layer is what makes it a shadow of the model rather than of the scene.
 * Drei builds the pool by rendering everything through a depth material from a
 * camera looking up off the floor, and these scenes are mostly things that are
 * not material: the grid, the reference box's ghost, pick bodies, dimension
 * labels, the symmetry preview. Through a depth material a ghost is as solid as
 * a rail, so the untouched version comes back as the silhouette of the reference
 * box sitting on a black square the size of the grid. So the parts opt *in* —
 * see {@link castsShade} — and this camera is told to look at nothing else.
 *
 * Opting in rather than the other way round because the exclusions are open
 * ended and the inclusions are not: a new overlay must not have to remember to
 * exempt itself, and there is only ever one kind of thing that casts a shadow.
 */
export function ContactShade({ box, floorY }: { box: THREE.Box3; floorY: number }) {
  const group = useRef<THREE.Group>(null);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());

  // Drei keeps the shadow camera inside the group it returns and exposes no way
  // to reach it, so it is found rather than passed. Guarded, not asserted: if a
  // future drei moves it, the pool goes back to including the whole scene, which
  // is a worse-looking shadow and not a crash.
  useEffect(() => {
    const camera = group.current?.children.find(
      (child): child is THREE.Camera => (child as THREE.Camera).isCamera
    );
    camera?.layers.set(SHADE_LAYER);
  }, []);

  return (
    <ContactShadows
      ref={group}
      position={[centre.x, floorY + SHADE_LIFT_MM, centre.z]}
      // wider than the model: the blur spreads the pool outwards, and a plane
      // cut to the footprint crops its soft edge back into a hard one
      scale={[Math.max(size.x, 1) * 1.7, Math.max(size.z, 1) * 1.7]}
      resolution={1024}
      // the falloff has to span from the floor to the top of the model, or a
      // part hung above the grid is outside the frustum and casts nothing
      far={Math.max(box.max.y - floorY, 1)}
      blur={2.5}
      opacity={0.55}
    />
  );
}

/**
 * How loud an outline is in "No lines" with the Options panel's outline on.
 *
 * Low enough that the drawing is still read as faces rather than as a wireframe
 * — the mode is called "No lines" and the setting is not meant to take it back —
 * and high enough to survive a kumiko lattice, where the lines are a millimetre
 * apart and anything fainter greys into one tone.
 */
export const FAINT_OUTLINE_OPACITY = 0.28;
