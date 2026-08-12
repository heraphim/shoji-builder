import * as THREE from "three";
import { paperShellGeometry } from "./ricePaper";

/**
 * The paper shell is a shell: five faces, all facing out, all at one scale.
 *
 * Every one of these is something that is invisible until it is on screen and
 * then unmistakable, and none of them can be seen from the code — a quad wound
 * the wrong way round is four numbers in a different order, and the result is a
 * panel lit from the wrong side.
 *
 *  - **Five faces, not six.** The bottom is inside the base; a lid that grew a
 *    floor would put a glowing square on the table.
 *  - **Normals point out, and agree with the winding.** The material is
 *    double-sided, which is exactly what would *hide* a wound-inside-out quad
 *    until somebody looked at the shading and wondered why one panel was dark.
 *  - **One scale everywhere.** The UVs are in tiles of millimetres so the fibres
 *    are the same size on the tall panels as on the lid. Per-face 0..1 UVs — what
 *    a `BoxGeometry` gives — would stretch the grain by the panel's aspect.
 *  - **Inside the box it was cut from**, so the frame covers the paper's edges
 *    rather than the paper standing proud of the frame.
 *
 * Run from the project root:
 *
 *     npx vite build --ssr src/lib/__papercheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__papercheck.js
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}

const near = (a: number, b: number, tol = 1e-4) => Math.abs(a - b) <= tol;

// A lamp that is not square in any two directions, so a face swapped for another
// shows up as a wrong number rather than as the same number twice.
const WIDTH = 200;
const HEIGHT = 370;
const DEPTH = 260;
const INSET = 0.6;

const box = new THREE.Box3(
  new THREE.Vector3(-WIDTH / 2, 0, -DEPTH / 2),
  new THREE.Vector3(WIDTH / 2, HEIGHT, DEPTH / 2)
);

const geometry = paperShellGeometry(box, INSET);
const position = geometry.getAttribute("position");
const normal = geometry.getAttribute("normal");
const uv = geometry.getAttribute("uv");

console.log("\nThe paper shell");

check("five faces, six vertices each", position.count === 30, `${position.count} vertices`);

// ---------------------------------------------------------------------------
// Which faces there are
// ---------------------------------------------------------------------------

const faces = new Map<string, number[]>();
for (let i = 0; i < normal.count; i++) {
  const key = [normal.getX(i), normal.getY(i), normal.getZ(i)].join(",");
  faces.set(key, [...(faces.get(key) ?? []), i]);
}

check("five distinct facings", faces.size === 5, [...faces.keys()].join(" | "));
check("no floor", !faces.has("0,-1,0"));
check("a lid", faces.has("0,1,0"));
for (const wall of ["1,0,0", "-1,0,0", "0,0,1", "0,0,-1"]) {
  check(`a wall facing ${wall}`, faces.has(wall));
}

// ---------------------------------------------------------------------------
// Wound the way they are lit
// ---------------------------------------------------------------------------

let wrongWay = 0;
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
for (let t = 0; t < position.count; t += 3) {
  a.fromBufferAttribute(position, t);
  b.fromBufferAttribute(position, t + 1);
  c.fromBufferAttribute(position, t + 2);
  const geometric = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a))
    .normalize();
  const declared = new THREE.Vector3().fromBufferAttribute(normal, t);
  if (geometric.dot(declared) < 0.999) wrongWay++;
}
check("every triangle is wound to face the way its normal points", wrongWay === 0, `${wrongWay} inside out`);

// ---------------------------------------------------------------------------
// Inside the box it was cut from
// ---------------------------------------------------------------------------

// Grown by a micron, because every vertex is *on* this boundary and the buffer
// holds them at float32 — which lands a corner a ten-thousandth of a millimetre
// either side of the number it was computed from.
const SLOP = 1e-3;
const inner = new THREE.Box3(
  new THREE.Vector3(box.min.x + INSET - SLOP, box.min.y - SLOP, box.min.z + INSET - SLOP),
  new THREE.Vector3(box.max.x - INSET + SLOP, box.max.y - INSET + SLOP, box.max.z - INSET + SLOP)
);
let outside = 0;
const p = new THREE.Vector3();
for (let i = 0; i < position.count; i++) {
  p.fromBufferAttribute(position, i);
  if (!inner.containsPoint(p)) outside++;
}
check("no vertex stands proud of the frame", outside === 0, `${outside} outside`);

// The paper reaches the whole of the box it skins: as wide, as deep and as tall
// as the box, less the inset.
const bounds = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
const span = bounds.getSize(new THREE.Vector3());
check("as wide as the box", near(span.x, WIDTH - 2 * INSET), `${span.x}`);
check("as deep as the box", near(span.z, DEPTH - 2 * INSET), `${span.z}`);
check("as tall as the box", near(span.y, HEIGHT - INSET), `${span.y}`);

// ---------------------------------------------------------------------------
// One scale everywhere
// ---------------------------------------------------------------------------

/** Millimetres of paper per unit of UV, over one face. */
function scaleOf(indices: number[]): { u: number; v: number } {
  const us = indices.map((i) => uv.getX(i));
  const vs = indices.map((i) => uv.getY(i));
  const xs = indices.map((i) => new THREE.Vector3().fromBufferAttribute(position, i));

  const uSpan = Math.max(...us) - Math.min(...us);
  const vSpan = Math.max(...vs) - Math.min(...vs);
  const world = new THREE.Box3().setFromPoints(xs).getSize(new THREE.Vector3());
  // the face's two extents, in whatever order — the flat axis contributes 0
  const [across, up] = world.toArray().filter((n) => n > 1e-6).sort((m, n) => n - m);
  const [wide, tall] = [Math.max(uSpan, vSpan), Math.min(uSpan, vSpan)];
  return { u: across / wide, v: up / tall };
}

const scales = [...faces.values()].map(scaleOf);
const first = scales[0];
check(
  "the same millimetres per tile on every face, both ways",
  scales.every((s) => near(s.u, first.u, 1e-3) && near(s.v, first.u, 1e-3)),
  scales.map((s) => `${s.u.toFixed(2)}/${s.v.toFixed(2)}`).join(" ")
);
check("a tile is a real size, not a whole panel", first.u > 1 && first.u < 1000, `${first.u.toFixed(1)} mm`);

// ---------------------------------------------------------------------------
// The whole surface, and nothing but
// ---------------------------------------------------------------------------

const w = WIDTH - 2 * INSET;
const d = DEPTH - 2 * INSET;
const h = HEIGHT - INSET;
let area = 0;
for (let t = 0; t < position.count; t += 3) {
  a.fromBufferAttribute(position, t);
  b.fromBufferAttribute(position, t + 1);
  c.fromBufferAttribute(position, t + 2);
  area += new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
}
// A relative tolerance: this is a third of a square metre summed a triangle at a
// time out of float32 corners, so an absolute one in mm² is a test of the
// accumulator rather than of the shell.
const expected = 2 * w * h + 2 * d * h + w * d;
check(
  "four walls and a lid, exactly",
  near(area / expected, 1, 1e-5),
  `${Math.round(area)} mm² against ${Math.round(expected)}`
);

console.log(failures === 0 ? "\nall good\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
