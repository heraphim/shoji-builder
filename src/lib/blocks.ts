import * as THREE from "three";
import type { Vec3 } from "../store/useComponentEditorStore";

/**
 * Everything about a part *being a box*.
 *
 * A part is a box: three sizes and the corners where the next part attaches.
 * That is the whole reason the saved file can stay parametric — a box is fully
 * described by three numbers, so three *formulas* describe it at every setting
 * of the variables. An arbitrary triangle soup can only be saved as the shape
 * it happened to have when it was exported.
 *
 * The other half of the module is the point <-> anchor conversion, which is what
 * lets a joint survive a resize. See docs/algorithms/assembly-layout.md.
 */

/** The geometry's own bounding box, computed on demand. Always a fresh clone. */
export function localBox(geometry: THREE.BufferGeometry): THREE.Box3 {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return geometry.boundingBox!.clone();
}

/** A box's extents as a plain triple. */
export function boxSize(box: THREE.Box3): Vec3 {
  const size = box.getSize(new THREE.Vector3());
  return [size.x, size.y, size.z];
}

/**
 * True when every vertex sits on a corner of the solid's own bounding box —
 * exactly the case where rebuilding it from three sizes loses nothing.
 *
 * Two conditions, both necessary: every coordinate is within `tolerance` of one
 * of its axis's two extremes (so nothing sits part-way along an edge or in the
 * middle of a face), and all eight corners are actually occupied (so a single
 * quad, or a box missing a corner, is rejected). O(V).
 */
export function isBoxGeometry(geometry: THREE.BufferGeometry, tolerance = 1e-3): boolean {
  const box = localBox(geometry);
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();
  const corners = new Set<string>();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    for (let axis = 0; axis < 3; axis++) {
      const c = p.getComponent(axis);
      const lo = box.min.getComponent(axis);
      const hi = box.max.getComponent(axis);
      if (Math.abs(c - lo) > tolerance && Math.abs(c - hi) > tolerance) return false;
    }
    corners.add(
      [0, 1, 2]
        .map((a) => (p.getComponent(a) - box.min.getComponent(a) > tolerance ? 1 : 0))
        .join("")
    );
  }
  return corners.size === 8;
}

/**
 * A box of the given size with its **minimum corner at the local origin**.
 *
 * Where it ends up in the assembly comes entirely from its connections, so
 * growing a block grows it away from that corner and its partners follow.
 * Sizes are floored at 1e-4 so a degenerate formula cannot produce an inverted
 * or zero-volume box.
 */
export function buildBoxGeometry(size: Vec3): THREE.BufferGeometry {
  const [x, y, z] = size.map((s) => Math.max(s, 1e-4)) as Vec3;
  const geometry = new THREE.BoxGeometry(x, y, z);
  geometry.translate(x / 2, y / 2, z / 2);
  return geometry;
}

/**
 * A connection point held as a fraction of the box it belongs to (0 = the low
 * face, 1 = the high face) rather than as a coordinate. This is what survives a
 * resize: the corner two parts meet at is still the same corner once the part
 * is 20 mm longer, but it is no longer at the same coordinate.
 *
 * A zero-extent axis yields 0 rather than a division by zero.
 */
export function anchorOfPoint(point: Vec3, box: THREE.Box3): Vec3 {
  const size = boxSize(box);
  return [0, 1, 2].map((axis) => {
    const extent = size[axis];
    return extent < 1e-9 ? 0 : (point[axis] - box.min.getComponent(axis)) / extent;
  }) as Vec3;
}

/** Inverse of {@link anchorOfPoint}: the coordinate an anchor names on a box. */
export function pointOfAnchor(anchor: Vec3, box: THREE.Box3): Vec3 {
  const size = boxSize(box);
  return [0, 1, 2].map((axis) => box.min.getComponent(axis) + anchor[axis] * size[axis]) as Vec3;
}

/**
 * Snap an anchor to the face it was meant to be on, then round.
 *
 * Anything within 1e-4 of 0 or 1 becomes exactly 0 or 1. A corner picked off a
 * mesh lands a hair off, and an anchor of 0.99998 would creep along the face
 * every time the part is re-cut — and would read, in the saved file, as if the
 * joint were deliberately inset.
 */
export function roundAnchor(anchor: Vec3, decimals = 4): Vec3 {
  return anchor.map((a) => {
    const snapped = Math.abs(a) < 1e-4 ? 0 : Math.abs(a - 1) < 1e-4 ? 1 : a;
    return Number(snapped.toFixed(decimals));
  }) as Vec3;
}
