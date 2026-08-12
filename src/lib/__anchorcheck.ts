import * as THREE from "three";
import {
  anchorOnInstance,
  anchorOnMainBox,
  buildShape,
  computeScene,
  localBoxOf,
  pickBoxes,
  snapToFeature,
} from "./lamp";
import type { LampAnchor, LampComponentDef, LampInstance } from "./lamp";
import type { Vec3 } from "../store/useComponentEditorStore";

/**
 * A joint stays on the feature it was picked on, whatever the variables do.
 *
 * This is the one promise the anchor representation makes, and the only one that
 * matters: pick a corner, resize the lamp, and the part is still on that corner.
 * It has two halves, and they fail for different reasons —
 *
 *  - **against the main box**, an anchor is a fraction of the one box there is,
 *    so it follows the box by construction. Guarded here so it stays that way.
 *  - **against another component**, the box the fraction is of has to be the
 *    box the point was picked on. A component is several blocks, and a fraction
 *    of the encasing box only tracks a point on an inner block while the blocks
 *    keep their proportions — which is exactly what a variable edit changes.
 *
 * The fixture is the smallest component that can tell the two apart: a leg whose
 * height is a variable, and a tab at the bottom that is not. Anything bolted to
 * the tab must stay on the tab when the leg grows.
 *
 * Run from the project root.
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}

const near = (a: THREE.Vector3, b: THREE.Vector3, tol = 1e-6) => a.distanceTo(b) < tol;
const show = (v: THREE.Vector3) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

// A leg (parametric height) with a tab across the bottom (fixed 20 mm tall).
// The encasing box grows with the leg; the tab does not move.
const BRACKET: LampComponentDef = {
  file: "bracket.component.json",
  name: "bracket",
  blocks: [
    { id: "leg", size: ["20", "#legHeight", "20"], origin: [0, 0, 0] },
    { id: "tab", size: ["60", "20", "20"], origin: [0, 0, 0] },
  ],
  // the tab's low corner onto the leg's low-y, high-x corner
  joints: [{ blockA: "leg", anchorA: [1, 0, 0], blockB: "tab", anchorB: [0, 0, 0] }],
  variables: {},
};

// A plain bar, the thing bolted onto the tab.
const BAR: LampComponentDef = {
  file: "bar.component.json",
  name: "bar",
  blocks: [{ id: "bar", size: ["40", "10", "10"], origin: [0, 0, 0] }],
  joints: [],
  variables: {},
};

const vars = (legHeight: number) => ({
  innerWidth: "200",
  innerDepth: "200",
  innerHeight: "370",
  legHeight: String(legHeight),
});

const free = (id: string, def: LampComponentDef): LampInstance => ({
  id,
  label: id,
  def,
  connection: null,
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
});

/** The world point a pick would land on, snapped exactly as the UI snaps it. */
function pick(instances: LampInstance[], id: string, raw: Record<string, string>, at: Vec3) {
  const scene = computeScene(instances, raw);
  const shape = scene.shapes.get(id)!;
  const placement = scene.placements.get(id)!;
  return snapToFeature(pickBoxes(shape), placement, new THREE.Vector3(...at));
}

// ---------------------------------------------------------------------------

console.log("\n[1] the fixture itself — the tab must not move when the leg grows");
{
  const short = buildShape(BRACKET, vars(100));
  const tall = buildShape(BRACKET, vars(200));
  check(
    "encasing box grows 100 -> 200",
    Math.abs(short.size[1] - 100) < 1e-9 && Math.abs(tall.size[1] - 200) < 1e-9,
    `${short.size[1]} -> ${tall.size[1]}`
  );
  // boxes[1] is the tab, index-aligned with def.blocks
  check(
    "tab top stays at y = 20",
    Math.abs(short.boxes[1].max.y - 20) < 1e-9 && Math.abs(tall.boxes[1].max.y - 20) < 1e-9,
    `${short.boxes[1].max.y} -> ${tall.boxes[1].max.y}`
  );
}

console.log("\n[2] a bar bolted to the TAB of a bracket — the case that drifts");
{
  const bracket = free("bracket", BRACKET);
  const bar = free("bar", BAR);
  let instances = [bracket, bar];

  // pick the tab's top-outer corner and the tab's top-inner corner, at 100
  const raw = vars(100);
  const p1 = pick(instances, "bracket", raw, [80, 20, 20]);
  const p2 = pick(instances, "bracket", raw, [20, 20, 20]);
  check("pick 1 lands on the tab's far top corner", near(p1.point, new THREE.Vector3(80, 20, 20)), show(p1.point));
  check("pick 2 lands on the tab's near top corner", near(p2.point, new THREE.Vector3(20, 20, 20)), show(p2.point));

  // two points on the bar itself
  const b1 = pick(instances, "bar", raw, [0, 0, 0]);
  const b2 = pick(instances, "bar", raw, [40, 0, 0]);

  const scene = computeScene(instances, raw);
  const shape = scene.shapes.get("bracket")!;
  const placement = scene.placements.get("bracket")!;
  const barShape = scene.shapes.get("bar")!;
  const barPlacement = scene.placements.get("bar")!;

  // build the connection the way commitConnection does
  const targetAnchors: [LampAnchor, LampAnchor] = [
    anchorOnInstance(p1.point, shape, placement, p1.block),
    anchorOnInstance(p2.point, shape, placement, p2.block),
  ];
  check(
    "the tab's corner is stored as a fraction of the TAB, not of the encasing box",
    targetAnchors[0].block === "tab" && targetAnchors[0].at.every((c) => c === 0 || c === 1),
    JSON.stringify(targetAnchors[0])
  );

  instances = instances.map((i) =>
    i.id === "bar"
      ? {
          ...i,
          connection: {
            source: [
              anchorOnInstance(b1.point, barShape, barPlacement, b1.block),
              anchorOnInstance(b2.point, barShape, barPlacement, b2.block),
            ] as [LampAnchor, LampAnchor],
            target: { kind: "instance" as const, id: "bracket", anchors: targetAnchors },
          },
        }
      : i
  );

  // where the joint sits at the size it was picked at
  const at100 = computeScene(instances, vars(100));
  const bar100 = at100.placements.get("bar")!;
  // the bar's source[1] point is pinned onto the target's first point
  const pinned100 = bar100.position
    .clone()
    .add(new THREE.Vector3(40, 0, 0).applyQuaternion(bar100.quaternion));
  check("at legHeight 100 the bar is pinned to the tab corner", near(pinned100, new THREE.Vector3(80, 20, 20), 1e-3), show(pinned100));

  // ...and after the leg grows
  const at200 = computeScene(instances, vars(200));
  const shape200 = at200.shapes.get("bracket")!;
  const place200 = at200.placements.get("bracket")!;
  const tabCorner = shape200.boxes[1].max.clone().applyQuaternion(place200.quaternion).add(place200.position);
  const bar200 = at200.placements.get("bar")!;
  const pinned200 = bar200.position
    .clone()
    .add(new THREE.Vector3(40, 0, 0).applyQuaternion(bar200.quaternion));

  check(
    "at legHeight 200 the bar is STILL on the tab corner",
    near(pinned200, tabCorner, 1e-3),
    `bar at ${show(pinned200)}, tab corner at ${show(tabCorner)}, off by ${pinned200.distanceTo(tabCorner).toFixed(3)} mm`
  );
}

console.log("\n[3] the same bar bolted to the MAIN BOX — must already hold, and keep holding");
{
  const bar = free("bar", BAR);
  let instances = [bar];
  const raw = vars(100);

  const barScene = computeScene(instances, raw);
  const barShape = barScene.shapes.get("bar")!;
  const barPlacement = barScene.placements.get("bar")!;
  const b1 = pick(instances, "bar", raw, [0, 0, 0]);
  const b2 = pick(instances, "bar", raw, [40, 0, 0]);

  // the main box's top-front-right corner, and the one along from it
  const box = barScene.mainBox;
  const t1 = new THREE.Vector3(box.max.x, box.max.y, box.max.z);
  const t2 = new THREE.Vector3(box.min.x, box.max.y, box.max.z);

  instances = instances.map((i) => ({
    ...i,
    connection: {
      source: [
        anchorOnInstance(b1.point, barShape, barPlacement, b1.block),
        anchorOnInstance(b2.point, barShape, barPlacement, b2.block),
      ] as [LampAnchor, LampAnchor],
      target: {
        kind: "mainBox" as const,
        anchors: [anchorOnMainBox(t1, box), anchorOnMainBox(t2, box)] as [LampAnchor, LampAnchor],
      },
    },
  }));

  for (const height of [370, 800]) {
    const scene = computeScene(instances, { ...vars(100), innerHeight: String(height) });
    const corner = new THREE.Vector3(scene.mainBox.max.x, scene.mainBox.max.y, scene.mainBox.max.z);
    const p = scene.placements.get("bar")!;
    const pinned = p.position.clone().add(new THREE.Vector3(40, 0, 0).applyQuaternion(p.quaternion));
    check(
      `at innerHeight ${height} the bar is on the box's top corner`,
      near(pinned, corner, 1e-3),
      `bar at ${show(pinned)}, corner at ${show(corner)}`
    );
  }
}

console.log("\n[4] a point picked on the ENCASING box still tracks the encasing box");
{
  const bracket = free("bracket", BRACKET);
  const instances = [bracket];
  const raw = vars(100);
  // the encasing box's top-far corner: (80, 100, 20) at legHeight 100. The leg
  // reaches it, so this is a corner of a real part *and* of the encasing box.
  const p = pick(instances, "bracket", raw, [0, 100, 0]);
  check("pick lands on the leg's top corner", near(p.point, new THREE.Vector3(0, 100, 0)), show(p.point));

  const shape = buildShape(BRACKET, raw);
  const local = localBoxOf(shape);
  check("encasing box is 80 x 100 x 20", near(local.max, new THREE.Vector3(80, 100, 20)), show(local.max));
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}\n`);
process.exit(failures === 0 ? 0 : 1);
