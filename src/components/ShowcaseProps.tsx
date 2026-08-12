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
 * mean the second showcase to mount inherits the first one's transform. The
 * geometry is copied with it rather than shared, because the fit is baked into
 * the vertices — see the note on that inside.
 */
/** Where a prop goes and how big it is — a {@link PropFit} without its materials. */
export type PropPlacement = Omit<PropFit, "dress" | "fallback">;

/**
 * The whole of the fit, as the two numbers that carry it: what the model's own
 * coordinates are multiplied by, and where they land.
 *
 * `world = turn * local * scale + offset`
 *
 * Pulled out of {@link Prop} because it is no longer only `Prop` that needs to
 * know — anything measuring a *feature* of a loaded prop in room millimetres has
 * to do the same arithmetic, and two copies of it are two answers waiting to
 * disagree. See {@link flatTopOf}.
 *
 * Measured off the cached scene rather than off a clone: `Prop` never writes to
 * the loaded geometry — it clones what it scales — so the two see the same
 * vertices.
 */
export function fitOf(
  scene: THREE.Object3D,
  fit: PropPlacement
): { turn: THREE.Matrix4; scale: number; offset: THREE.Vector3 } {
  scene.updateMatrixWorld(true);
  const turn = new THREE.Matrix4().makeRotationY(fit.turn ?? 0);

  // Measured after the turn, so a prop that is rotated a quarter turn is fitted
  // on the side that is actually its length once it is standing in the room.
  const box = new THREE.Box3();
  const local = new THREE.Matrix4();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    local.multiplyMatrices(turn, object.matrixWorld);
    box.union(object.geometry.boundingBox!.clone().applyMatrix4(local));
  });

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

  return {
    turn,
    scale,
    offset: new THREE.Vector3(fit.at[0] - corner.x, fit.at[1] - corner.y, fit.at[2] - corner.z),
  };
}

/** A flat, upward-facing patch of a prop, in room millimetres. */
export interface FlatTop {
  /** Its middle, in x and z. */
  center: [number, number];
  /** How far it runs, in x and z. */
  size: [number, number];
  /** The height of the plane itself. */
  y: number;
  /**
   * Where the prop's own coordinates start, in the room.
   *
   * Carried out with the rest because anything wanting to evaluate the prop's
   * *material* at a point on this surface needs it: every solid texture in this
   * app is a function of object position (see `wood.ts`), and the offset is what
   * turns a place in the room into a place on the board. See {@link Lacquer}.
   */
  origin: [number, number, number];
}

/**
 * How far from level a face may be and still count as part of the top. About
 * two and a half degrees.
 */
const LEVEL = 0.999;

/**
 * How far below the highest level face another one may sit and still be the
 * same surface, in millimetres of the room.
 *
 * Not zero, because a "flat" top out of a modeller is a few triangles that
 * disagree in the sixth decimal, and not large, because the first band of a
 * roundover is nearly level and only a little lower — which is the whole thing
 * this is trying to keep out.
 */
const SAME_SURFACE = 0.25;

/**
 * The flat part of a prop's upper surface, measured off its triangles.
 *
 * The nightstand's top is not a rectangle: it is a rectangle with its edges
 * rolled over, and a film cut to the model's *bounding box* hangs out over the
 * roll all the way round. At a soft blur nobody could see it. Sharpen the
 * reflection and it reads as a pane of glass resting on the table, which is the
 * one thing a lacquer must not look like.
 *
 * So the sheet is measured rather than written down: every triangle that faces
 * up and sits on the highest level surface, bounded in x and z. Change the
 * nightstand for a different one and the film changes shape with it.
 *
 * @returns null if the prop has no level upper surface at all, which is a thing
 *          worth hearing about rather than papering over — see the caller.
 */
export function flatTopOf(scene: THREE.Object3D, fit: PropPlacement): FlatTop | null {
  const { turn, scale, offset } = fitOf(scene, fit);

  const faces: { y: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  const local = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!position) return;
    const index = object.geometry.index;
    local.multiplyMatrices(turn, object.matrixWorld);

    const corners = index ? index.count : position.count;
    for (let i = 0; i < corners; i += 3) {
      const at = (k: number) => (index ? index.getX(i + k) : i + k);
      a.fromBufferAttribute(position, at(0)).applyMatrix4(local).multiplyScalar(scale).add(offset);
      b.fromBufferAttribute(position, at(1)).applyMatrix4(local).multiplyScalar(scale).add(offset);
      c.fromBufferAttribute(position, at(2)).applyMatrix4(local).multiplyScalar(scale).add(offset);

      // The face normal off the geometry rather than the vertex normals, which
      // are averaged and so are already lying about the arris between the top
      // and the roll: a shared corner reports a normal halfway down the curve.
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      const length = normal.length();
      if (length < 1e-9 || normal.y / length < LEVEL) continue;

      faces.push({
        y: Math.max(a.y, b.y, c.y),
        minX: Math.min(a.x, b.x, c.x),
        maxX: Math.max(a.x, b.x, c.x),
        minZ: Math.min(a.z, b.z, c.z),
        maxZ: Math.max(a.z, b.z, c.z),
      });
    }
  });

  if (faces.length === 0) return null;

  const top = faces.reduce((highest, face) => Math.max(highest, face.y), -Infinity);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const face of faces) {
    if (top - face.y > SAME_SURFACE) continue;
    minX = Math.min(minX, face.minX);
    maxX = Math.max(maxX, face.maxX);
    minZ = Math.min(minZ, face.minZ);
    maxZ = Math.max(maxZ, face.maxZ);
  }

  return {
    center: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    size: [maxX - minX, maxZ - minZ],
    y: top,
    origin: [offset.x, offset.y, offset.z],
  };
}

/**
 * {@link flatTopOf} for a prop that has not been loaded yet.
 *
 * Suspends, like `Prop` does, and off the same cache — the model is fetched
 * once however many things are measuring it.
 */
export function useFlatTop(fit: PropPlacement): FlatTop | null {
  const { scene } = useGLTF(siteUrl(`models/props/${fit.file}`));
  return useMemo(() => flatTopOf(scene, fit), [scene, fit]);
}

export function Prop({ fit }: { fit: PropFit }) {
  const { scene } = useGLTF(siteUrl(`models/props/${fit.file}`));

  const model = useMemo(() => {
    const { scale, offset } = fitOf(scene, fit);

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

    // The fit is applied to the *geometry* rather than to the node, and it has
    // to be.
    //
    // Every material in this room is a solid texture read in the object's own
    // coordinates — the wood's grain scale, the cloth's weave pitch and fold
    // size are all millimetres of the model (see `wood.ts` and `surfaces.ts`).
    // A node scale does not reach them: the shader sees `position`, which is
    // whatever unit the file's author worked in. The bed arrives at 1 unit to
    // 830 mm, so a 55 mm fold was being asked for over 45 metres of bedspread
    // and a 4.7 mm ring over most of a tree — which is why the two downloaded
    // props were the only things in this room with no figure and no weave in
    // them, and why nobody noticed: a flat brown bed looks like a bed.
    //
    // So the vertices are moved instead and the node is left at unit scale,
    // which makes a prop's object space room millimetres like everything else.
    // The price is that the geometry can no longer be shared with `useGLTF`'s
    // cache — hence `cut`, which is disposed with the clone.
    const cut: THREE.BufferGeometry[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // Faceted first and in the geometry's own units, so the lattice is the
      // one the caller asked for in room millimetres either way.
      const source = fit.facet ? facetGeometry(object.geometry, fit.facet / scale) : object.geometry;
      const sized = fit.facet ? source : source.clone();
      sized.scale(scale, scale, scale);
      object.geometry = sized;
      cut.push(sized);
    });

    const group = new THREE.Group();
    group.add(root);
    group.position.copy(offset);
    return { group, cut };
  }, [scene, fit]);

  // The clone owns its nodes and its geometry, and not its materials — those
  // belong to the room, and disposing one from here would pull it out from under
  // whoever else is wearing it.
  //
  // The geometry it does own, because it had to be scaled into room millimetres
  // and could not stay the cache's. A style change makes a fresh set, so without
  // this, walking through the eight styles would leave eight beds' worth of
  // vertex buffers on the card.
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
