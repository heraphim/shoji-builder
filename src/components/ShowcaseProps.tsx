import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { siteUrl } from "../lib/library";

/**
 * Downloaded furniture, dressed in the room's own materials.
 *
 * Everything else in this room is built out of boxes because nothing in this app
 * has UVs and a downloaded model is megabytes. Both of those objections turn out
 * to be about *textures* rather than about geometry: a bed's shape is a few
 * hundred kilobytes once it has been simplified, and its material can be the same
 * procedural cloth every other soft thing here uses, which needs no UVs and adds
 * no bytes at all.
 *
 * So the pipeline strips the source's texture set and keeps only its form. The
 * bed came in as a 60 MB OBJ with 390,000 triangles and a hundred megabytes of
 * 4K fabric maps, and it is 1.2 MB of pure geometry here. What it brings that a
 * box cannot is the shape of a mattress with somebody's weight remembered in it.
 *
 * ## Fitting
 *
 * A model arrives at whatever size and origin its author left it — feet for the
 * SketchUp side table, metres for the Blender bed — and the room is in
 * millimetres. Rather than write down a scale factor per model, which is a
 * number nobody can check and which silently rots when the file is replaced,
 * each prop says **how big it should be and where one of its corners goes**, and
 * the transform is derived from the geometry's own bounding box. Drop in a
 * different bed and it lands in the same place at the same size.
 */

export interface PropFit {
  /** The file, under `public/models/props/`. */
  file: string;
  /** How long the prop is along its longest horizontal axis, in mm. */
  length?: number;
  /**
   * How tall it is instead, in mm.
   *
   * For anything that has to *reach the floor and meet something else at the
   * top*, which is the nightstand exactly: its upper face is where the lamp
   * stands and its feet are on the boards, and those two facts fix the scale
   * between them. Fitted on its width instead it came out 90 mm short and hung
   * in the air, which is the kind of mistake that only shows from a low angle.
   */
  height?: number;
  /**
   * Which corner of the bounding box is being placed, as a fraction per axis —
   * `[0.5, 0, 0.5]` is the middle of the underside, `[0, 0, 0]` a bottom corner.
   */
  anchor: [number, number, number];
  /** Where that corner goes, in room coordinates. */
  at: [number, number, number];
  /** Turn about Y, in radians, applied before fitting. */
  turn?: number;
  /** Which room material dresses each of the model's own material names. */
  dress: Record<string, THREE.Material>;
  /** The fallback for any material name not in `dress`. */
  fallback: THREE.Material;
}

/**
 * A loaded prop, scaled and placed, with its materials swapped out.
 *
 * The scene graph is cloned rather than used directly: `useGLTF` caches by URL
 * and hands every caller the same objects, so mutating the loaded meshes would
 * mean the second showcase to mount inherits the first one's transform. Cloning
 * is cheap here because the geometry is shared by reference — only the nodes are
 * copied.
 */
export function Prop({ fit }: { fit: PropFit }) {
  const { scene } = useGLTF(siteUrl(`models/props/${fit.file}`));

  const model = useMemo(() => {
    const root = scene.clone(true);
    root.rotation.y = fit.turn ?? 0;
    root.updateMatrixWorld(true);

    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const name = Array.isArray(object.material)
        ? object.material[0]?.name
        : (object.material as THREE.Material | undefined)?.name;
      object.material = fit.dress[name ?? ""] ?? fit.fallback;
      object.castShadow = true;
      object.receiveShadow = true;
    });

    // Measured after the turn, so a prop that is rotated a quarter turn is fitted
    // on the side that is actually its length once it is standing in the room.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale =
      fit.height !== undefined
        ? fit.height / Math.max(size.y, 1e-6)
        : (fit.length ?? 1000) / Math.max(size.x, size.z, 1e-6);

    const corner = new THREE.Vector3(
      box.min.x + size.x * fit.anchor[0],
      box.min.y + size.y * fit.anchor[1],
      box.min.z + size.z * fit.anchor[2]
    ).multiplyScalar(scale);

    const group = new THREE.Group();
    group.add(root);
    root.scale.setScalar(scale);
    group.position.set(fit.at[0] - corner.x, fit.at[1] - corner.y, fit.at[2] - corner.z);
    return group;
  }, [scene, fit]);

  // The clone owns nodes, not geometry or materials — both of those belong to
  // the cache and to the room respectively, and disposing either from here would
  // pull them out from under whoever else is using them.
  useEffect(
    () => () => {
      model.clear();
    },
    [model]
  );

  return <primitive object={model} />;
}

/**
 * Fetch a prop before anything asks for it.
 *
 * Called at module scope so the download starts with the page rather than when
 * the room first renders, which is after the variables, the library and the lamp
 * have all been and gone.
 */
export function preloadProps(files: string[]): void {
  for (const file of files) useGLTF.preload(siteUrl(`models/props/${file}`));
}
