import * as fs from "node:fs";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { splitIntoIslands } from "./picking";
import { simplifySolid, mergeGroupGeometry, buildOutlineEdges } from "./assembly";
import type { SubMesh } from "../store/useComponentEditorStore";

/**
 * Outlines of merged solids: every edge the solid has, and not one more.
 *
 * The failure this exists for is a *phantom diagonal* — a line drawn across a
 * flat face, left behind by the CSG tessellation when `regionOutlines` fails to
 * cancel it. It is entirely position-dependent, so the beam is assembled four
 * times with a different block held fixed; before the line-matching rewrite
 * those four showed 1, 0, 3 and 8 phantom lines.
 *
 * Counting diagonals is only half a check: an outline pass that dropped real
 * edges would also report none. So each case states the segment count its
 * profile must have, and [3] states the entire expected edge set independently.
 *
 * Run from the project root.
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}

const f3 = (n: number) => n.toFixed(3);
const segKey = (a: THREE.Vector3, b: THREE.Vector3) => {
  const ka = `${f3(a.x)},${f3(a.y)},${f3(a.z)}`;
  const kb = `${f3(b.x)},${f3(b.y)},${f3(b.z)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

// An edge running along one axis is a real arris of a rectilinear part; one
// running along two is either a chamfer or a phantom.
function segmentsOf(geometry: THREE.BufferGeometry) {
  const position = buildOutlineEdges(geometry).attributes.position;
  const out: Array<{ a: THREE.Vector3; b: THREE.Vector3; skew: boolean; key: string }> = [];
  for (let i = 0; i + 1 < position.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(position, i);
    const b = new THREE.Vector3().fromBufferAttribute(position, i + 1);
    const d = new THREE.Vector3().subVectors(b, a);
    const axes = (["x", "y", "z"] as const).filter((k) => Math.abs(d[k]) > 1e-6).length;
    out.push({ a, b, skew: axes > 1, key: segKey(a, b) });
  }
  return out;
}

// the upload path: parse, cm -> mm, split, re-cut each island
function load(file: string): THREE.BufferGeometry[] {
  const buffer = fs.readFileSync(`public/models/stl/${file}`);
  const raw = new STLLoader().parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  );
  raw.scale(10, 10, 10);
  const islands = splitIntoIslands(raw).map((island) => simplifySolid(island));
  for (const island of islands) island.computeBoundingBox();
  return islands;
}

console.log("\n[1] every island of every shipped STL outlines as its own 12 box edges");
for (const file of ["beam.stl", "frame.stl", "leg.stl"]) {
  load(file).forEach((geometry, i) => {
    const box = geometry.boundingBox!;
    const lo = [box.min.x, box.min.y, box.min.z];
    const hi = [box.max.x, box.max.y, box.max.z];
    const want = new Set<string>();
    for (let axis = 0; axis < 3; axis++) {
      const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
      for (const cu of [lo, hi])
        for (const cv of [lo, hi]) {
          const a = [0, 0, 0];
          const b = [0, 0, 0];
          a[u] = b[u] = cu[u];
          a[v] = b[v] = cv[v];
          a[axis] = lo[axis];
          b[axis] = hi[axis];
          want.add(segKey(new THREE.Vector3(...a), new THREE.Vector3(...b)));
        }
    }
    const got = segmentsOf(geometry);
    const keys = new Set(got.map((s) => s.key));
    check(
      `${file} island ${i}: the box's own 12 edges`,
      got.length === 12 && [...want].every((k) => keys.has(k)),
      `got ${got.length}${got.some((s) => s.skew) ? ", HAS SKEW" : ""}`
    );
  });
}

// Butt every block of the beam against the next, along the two bottom lines
// they all share. `order` is left to right; the first block named is the one
// that stays put, which is what decides the coordinates everything lands on.
function assemble(order: number[]) {
  const islands = load("beam.stl");
  const chain = order.map((i) => islands[i]);
  const offsets = [0];
  for (let i = 1; i < chain.length; i++) {
    offsets.push(chain[i - 1].boundingBox!.max.x + offsets[i - 1] - chain[i].boundingBox!.min.x);
  }
  const meshes = chain.map((geometry, i) => ({
    id: `m${i}`,
    name: `island ${i}`,
    geometry,
    offset: [offsets[i], 0, 0],
    block: null,
  })) as unknown as SubMesh[];
  const merged = mergeGroupGeometry(meshes);
  return { merged, segments: segmentsOf(merged) };
}

console.log("\n[2] beam.stl butted end to end — no phantom diagonals, whichever block is fixed");
// islands are 0: 0-20 (10 tall), 1: 22-32 (5), 2: 36-236 (10), 3: 256-276 (10),
// 4: 240-250 (5). A bar of n profile corners has 2n face edges + n joining them,
// and two full-height blocks landing side by side fuse into one, losing two.
const CASES: Array<{ label: string; order: number[]; segments: number }> = [
  { label: "left to right, first block fixed", order: [0, 1, 2, 4, 3], segments: 36 },
  { label: "sidebar order (3 and 4 swapped)", order: [0, 1, 2, 3, 4], segments: 30 },
  { label: "long block fixed", order: [2, 4, 3, 0, 1], segments: 30 },
  { label: "reversed, assembly at x 256-516", order: [3, 4, 2, 1, 0], segments: 36 },
];
for (const { label, order, segments: want } of CASES) {
  const { segments } = assemble(order);
  const skew = segments.filter((s) => s.skew);
  check(
    `${label}: no phantom diagonal`,
    skew.length === 0,
    skew.length === 0
      ? `${segments.length} segments`
      : `${skew.length} of them, e.g. (${f3(skew[0].a.x)},${f3(skew[0].a.z)})->(${f3(skew[0].b.x)},${f3(skew[0].b.z)})`
  );
  check(`${label}: ${want} segments, no real edge lost`, segments.length === want, `got ${segments.length}`);
}

console.log("\n[3] that beam's outline is exactly the 36 edges of its profile, stated independently");
{
  const { merged, segments } = assemble([0, 1, 2, 4, 3]);
  const profile: Array<[number, number]> = [
    [0, 0], [0, 10], [20, 10], [20, 5], [30, 5], [30, 10],
    [230, 10], [230, 5], [240, 5], [240, 10], [260, 10], [260, 0],
  ];
  const want = new Set<string>();
  for (let i = 0; i < profile.length; i++) {
    const [x0, z0] = profile[i];
    const [x1, z1] = profile[(i + 1) % profile.length];
    for (const y of [-10, 0]) {
      want.add(segKey(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z1)));
    }
    want.add(segKey(new THREE.Vector3(x0, -10, z0), new THREE.Vector3(x0, 0, z0)));
  }
  const got = new Set(segments.map((s) => s.key));
  check("nothing missing", [...want].every((k) => got.has(k)), [...want].filter((k) => !got.has(k)).join("  "));
  check("nothing extra", [...got].every((k) => want.has(k)), [...got].filter((k) => !want.has(k)).join("  "));
  // 12 profile corners cut into 6 rectangles worth of side face, 2 triangles
  // each, plus the ends, top steps and bottom: an outline the simplifier could
  // not read would show up here as a face left over-tessellated.
  check(
    "and the solid was re-cut, not left as the CSG had it",
    merged.index!.count / 3 <= 44,
    `${merged.index!.count / 3} triangles`
  );
}

console.log("\n[4] a genuine skew edge survives — a chamfer must not be flattened");
{
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(10, 0);
  shape.lineTo(0, 10);
  shape.closePath();
  const prism = simplifySolid(new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false }));
  const segments = segmentsOf(prism);
  const skew = segments.filter((s) => s.skew);
  check("triangular prism outlines as 9 edges", segments.length === 9, `got ${segments.length}`);
  check(
    "both hypotenuses kept, at full length",
    skew.length === 2 && skew.every((s) => Math.abs(s.a.distanceTo(s.b) - Math.hypot(10, 10)) < 1e-6),
    `${skew.length} skew: ${skew.map((s) => s.a.distanceTo(s.b).toFixed(4)).join(", ")}`
  );
}

console.log("\n[5] a cross lap — two blocks overlapping, the case the CSG merge exists for");
{
  const box = (size: [number, number, number], at: [number, number, number]) => {
    const g = new THREE.BoxGeometry(...size);
    g.translate(size[0] / 2 + at[0], size[1] / 2 + at[1], size[2] / 2 + at[2]);
    return g;
  };
  const meshes = [
    { id: "a", name: "a", geometry: box([100, 20, 20], [0, 0, 0]), offset: [0, 0, 0], block: null },
    { id: "b", name: "b", geometry: box([20, 20, 100], [40, 0, -40]), offset: [0, 0, 0], block: null },
  ] as unknown as SubMesh[];
  const segments = segmentsOf(mergeGroupGeometry(meshes));
  check("no phantom diagonal", segments.filter((s) => s.skew).length === 0, `${segments.length} segments`);
  // the union is a plus in xz: 12 corners, so 36 edges
  check("36 segments", segments.length === 36, `got ${segments.length}`);
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}\n`);
process.exit(failures === 0 ? 0 : 1);
