import * as THREE from "three";

/**
 * Raycast-hit helpers, STL island splitting, and view framing.
 *
 * Small, self-contained pieces used by the interaction layer. Nothing here
 * knows about measurements or connections — it turns a three.js intersection
 * into plain geometry, and geometry into camera parameters.
 */

/**
 * For a LineSegments built from an outline buffer, three's raycaster reports the
 * vertex index of the segment's first point on `intersection.index`; the second
 * point is always the next vertex (LineSegments = non-indexed pairs).
 */
export function getEdgeEndpoints(
  edgesGeometry: THREE.BufferGeometry,
  vertexIndex: number,
  matrixWorld: THREE.Matrix4
): { start: THREE.Vector3; end: THREE.Vector3 } {
  const position = edgesGeometry.attributes.position;
  const start = new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(matrixWorld);
  const end = new THREE.Vector3().fromBufferAttribute(position, vertexIndex + 1).applyMatrix4(matrixWorld);
  return { start, end };
}

/**
 * Snaps a raycast hit on a solid mesh to whichever of the hit triangle's 3
 * vertices is closest to the hit point — lets a click anywhere near a corner
 * select that corner, without needing a separate pickable points overlay.
 *
 * @throws when the intersection carries no face (e.g. a hit on a line).
 */
export function nearestVertexOnFace(intersection: THREE.Intersection): THREE.Vector3 {
  const mesh = intersection.object as THREE.Mesh;
  const face = intersection.face;
  if (!face) throw new Error("Intersection has no face data");
  const position = mesh.geometry.attributes.position;

  const candidates = [face.a, face.b, face.c].map((index) =>
    new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld)
  );

  let nearest = candidates[0];
  let nearestDist = nearest.distanceToSquared(intersection.point);
  for (let i = 1; i < candidates.length; i++) {
    const dist = candidates[i].distanceToSquared(intersection.point);
    if (dist < nearestDist) {
      nearest = candidates[i];
      nearestDist = dist;
    }
  }
  return nearest;
}

// Given two picked points meant to define a connection axis, returns whichever
// world axis is most nearly equal between them (the "shared"/contact axis).
export function detectConstrainedAxis(a: THREE.Vector3, b: THREE.Vector3): "x" | "y" | "z" {
  const diffs: Array<["x" | "y" | "z", number]> = [
    ["x", Math.abs(a.x - b.x)],
    ["y", Math.abs(a.y - b.y)],
    ["z", Math.abs(a.z - b.z)],
  ];
  diffs.sort((p, q) => p[1] - q[1]);
  return diffs[0][0];
}

// World-space face normal of a raycast hit (face normals from three are in
// object space).
export function faceWorldNormal(intersection: THREE.Intersection): THREE.Vector3 {
  const mesh = intersection.object as THREE.Mesh;
  const face = intersection.face;
  if (!face) throw new Error("Intersection has no face data");
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  return face.normal.clone().applyMatrix3(normalMatrix).normalize();
}

// World-space triangle corners of a raycast hit — used to render a hover
// highlight over the exact hit triangle.
export function faceWorldTriangle(intersection: THREE.Intersection): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const mesh = intersection.object as THREE.Mesh;
  const face = intersection.face;
  if (!face) throw new Error("Intersection has no face data");
  const position = mesh.geometry.attributes.position;
  return [face.a, face.b, face.c].map((index) =>
    new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld)
  ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

/**
 * Split a triangle-soup geometry into its connected islands, so each disjoint
 * solid becomes its own subcomponent and connections can join them.
 *
 * One STL file often contains several solids (a SketchUp export of a frame piece
 * with separate end blocks). Union-find with path halving over vertices keyed by
 * position rounded to 5 decimals; triangles sharing a vertex are one island.
 * ~O(T).
 *
 * @returns the input array-wrapped when there is only one island, so the common
 *          case allocates nothing.
 */
export function splitIntoIslands(geometry: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const pos = geometry.attributes.position;
  const triCount = pos.count / 3;
  if (triCount <= 1) return [geometry];

  const keyToId = new Map<string, number>();
  const vertexIds = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    let id = keyToId.get(key);
    if (id === undefined) {
      id = keyToId.size;
      keyToId.set(key, id);
    }
    vertexIds[i] = id;
  }

  const parent = new Int32Array(keyToId.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let t = 0; t < triCount; t++) {
    parent[find(vertexIds[t * 3])] = find(vertexIds[t * 3 + 1]);
    parent[find(vertexIds[t * 3])] = find(vertexIds[t * 3 + 2]);
  }

  const groups = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const root = find(vertexIds[t * 3]);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(t);
  }
  if (groups.size <= 1) return [geometry];

  const normal = geometry.attributes.normal;
  return Array.from(groups.values()).map((tris) => {
    const island = new THREE.BufferGeometry();
    const p = new Float32Array(tris.length * 9);
    const n = normal ? new Float32Array(tris.length * 9) : null;
    tris.forEach((t, i) => {
      for (let v = 0; v < 3; v++) {
        const src = t * 3 + v;
        const dst = (i * 3 + v) * 3;
        p[dst] = pos.getX(src);
        p[dst + 1] = pos.getY(src);
        p[dst + 2] = pos.getZ(src);
        if (n && normal) {
          n[dst] = normal.getX(src);
          n[dst + 1] = normal.getY(src);
          n[dst + 2] = normal.getZ(src);
        }
      }
    });
    island.setAttribute("position", new THREE.BufferAttribute(p, 3));
    if (n) island.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    return island;
  });
}

/**
 * Combined world-space bounding box of several geometries, each translated by
 * an offset. The projections frame on the box rather than the sphere: a sphere
 * is the same size in every view, so framing on it leaves a flat part floating
 * in empty space in the two views that see it edge-on.
 *
 * @returns null when there is nothing to frame.
 */
export function combinedBoundingBox(
  items: Array<{ geometry: THREE.BufferGeometry; offset: [number, number, number] }>
): THREE.Box3 | null {
  if (items.length === 0) return null;
  const box = new THREE.Box3();
  const itemBox = new THREE.Box3();
  for (const { geometry, offset } of items) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) continue;
    itemBox.copy(geometry.boundingBox).translate(new THREE.Vector3(...offset));
    box.union(itemBox);
  }
  return box.isEmpty() ? null : box;
}

/**
 * Combined bounding sphere of several geometries, each translated by an offset —
 * derived from the box, so it is the box's circumsphere rather than a tight fit.
 * Used to frame the 3D view and to scale markers, triads and ray offsets.
 */
export function combinedBoundingSphere(
  items: Array<{ geometry: THREE.BufferGeometry; offset: [number, number, number] }>
): { center: THREE.Vector3; radius: number } | null {
  const box = combinedBoundingBox(items);
  if (!box) return null;
  const center = new THREE.Vector3();
  box.getCenter(center);
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-6);
  return { center, radius };
}

/**
 * Camera basis for an orthographic view looking down `normal`. Returns the
 * camera position direction (the normal) and its up vector; the caller derives
 * `right = up x direction`.
 *
 * The reference used to build `up` is chosen so it is never parallel to the view
 * direction (-Z for a near-vertical view, +Y otherwise). The three projections
 * are fixed world-axis views, so this never needs a spin: turning the component
 * rotates the model instead.
 */
export function viewCameraBasis(normal: [number, number, number]): {
  direction: THREE.Vector3;
  up: THREE.Vector3;
} {
  const dir = new THREE.Vector3(...normal).normalize();
  // pick a stable reference that isn't parallel to the view direction
  const reference =
    Math.abs(dir.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const up = reference.clone().projectOnPlane(dir).normalize();
  return { direction: dir, up };
}
