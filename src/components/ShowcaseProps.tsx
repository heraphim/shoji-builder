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
  /**
   * How coarsely to facet the prop, in millimetres of the room. 0 leaves it as
   * the file drew it. See {@link facetGeometry}.
   */
  facet?: number;
}

/**
 * A model chopped down to flat faces a given size.
 *
 * The low-poly style is the one style that cannot be done to the picture after
 * the fact: faceting is a property of the *surface*, and no filter reading a
 * finished frame can tell a curved thing from a many-sided one. Everything else
 * in this room is already boxes and cylinders and looks low-poly the moment the
 * shading flattens; the bed and the nightstand arrive smooth and have to be
 * cut.
 *
 * Three operations, and all three are needed.
 *
 * **Snapping** each vertex to a lattice is what removes the detail: neighbouring
 * vertices land on the same point and the surface between them flattens into a
 * coarse hull with visible corners.
 *
 * **Throwing away what collapsed** is not tidying up after that — it is half of
 * the work, and skipping it is a bug with a long fuse. On a bed at a 42 mm
 * lattice most triangles end up with no area: two corners on the same point, or
 * three distinct points in a line, which a coarse grid produces constantly.
 * `computeVertexNormals` gives those a zero-length face normal, and a zero
 * normal is `normalize(vec3(0))` in every lighting shader there is — a NaN. It
 * does not stay put either: the frame is drawn into a half-float buffer and the
 * bloom averages it up a mip chain, so one poisoned sliver comes back as a
 * *black frame* with a clean strip down one side, which is exactly as easy to
 * diagnose as it sounds. Dropping them also does what the style is named after:
 * the bed loses four fifths of its triangles.
 *
 * **Flat normals** are what make the result read. A faceted mesh shaded
 * smoothly is a lumpy smooth mesh, because the normals are still the original
 * surface's and the normals are what you can see. Non-indexed first, so each
 * triangle owns its three vertices and picks up its own face normal rather than
 * an average over whatever else used to share the corner.
 */
function facetGeometry(source: THREE.BufferGeometry, grid: number): THREE.BufferGeometry {
  const flat = source.index ? source.toNonIndexed() : source;
  const from = (flat.attributes.position as THREE.BufferAttribute).array;

  const kept: number[] = [];
  const snap = (v: number) => Math.round(v / grid) * grid;
  for (let t = 0; t < from.length; t += 9) {
    const p = [
      snap(from[t]), snap(from[t + 1]), snap(from[t + 2]),
      snap(from[t + 3]), snap(from[t + 4]), snap(from[t + 5]),
      snap(from[t + 6]), snap(from[t + 7]), snap(from[t + 8]),
    ];
    // Rejected on area rather than on whether two corners coincide, which is
    // what this checked first and which is not the whole of it: three *distinct*
    // lattice points are collinear often enough on a grid this coarse that a
    // third of the zero normals survived the corner test. The cross product of
    // the two edges is the face normal before it is normalised, so its length is
    // both the area and the answer.
    const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
    const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    if (cx * cx + cy * cy + cz * cz < grid * grid * grid * grid * 1e-6) continue;
    kept.push(...p);
  }

  // A fresh buffer rather than the source's, because everything else it brought
  // — the UVs, a tangent set, the original normals — is either about to be
  // wrong or was never read here. Only the corners survive, and the normals are
  // rebuilt from them.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (flat !== source) flat.dispose();
  return geometry;
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

    // Faceted after the scale is known and before it is applied: the lattice is
    // given in millimetres of the *room*, and the geometry is still in whatever
    // units its author used. Measuring first also means the prop keeps the size
    // it was fitted to rather than the slightly smaller one snapping leaves.
    const cut: THREE.BufferGeometry[] = [];
    if (fit.facet) {
      const grid = fit.facet / scale;
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry = facetGeometry(object.geometry, grid);
        cut.push(object.geometry);
      });
    }

    const corner = new THREE.Vector3(
      box.min.x + size.x * fit.anchor[0],
      box.min.y + size.y * fit.anchor[1],
      box.min.z + size.z * fit.anchor[2]
    ).multiplyScalar(scale);

    const group = new THREE.Group();
    group.add(root);
    root.scale.setScalar(scale);
    group.position.set(fit.at[0] - corner.x, fit.at[1] - corner.y, fit.at[2] - corner.z);
    return { group, cut };
  }, [scene, fit]);

  // The clone owns nodes, not geometry or materials — both of those belong to
  // the cache and to the room respectively, and disposing either from here would
  // pull them out from under whoever else is using them.
  //
  // The one exception is geometry this clone *cut* for itself. That is not the
  // cache's and nobody else holds it, and a style change makes a fresh set — so
  // without this, orbiting through the eight styles would leave eight beds'
  // worth of vertex buffers on the card.
  useEffect(
    () => () => {
      model.group.clear();
      for (const geometry of model.cut) geometry.dispose();
    },
    [model]
  );

  return <primitive object={model.group} />;
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
