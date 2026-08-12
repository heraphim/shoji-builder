import * as fs from "node:fs";
import * as THREE from "three";
import {
  anchorOnInstance,
  anchorOnMainBox,
  computeScene,
  parseComponentDef,
  pickBoxes,
  snapToFeature,
} from "./lamp";
import type { LampAnchor, LampComponentDef, LampInstance } from "./lamp";
import { buildLampFile, parseLampFile, toInstances } from "./lampFile";

/**
 * A saved lamp is a recipe, not a snapshot.
 *
 * The round trip has to preserve two different things, and only the first is
 * obvious:
 *
 *  1. **The same lamp comes back.** Every part lands where it was, to the last
 *     decimal, at the variables it was saved at.
 *  2. **It comes back as a recipe.** Opening a lamp and then dragging a slider
 *     has to give what building it and dragging that slider gives. A file that
 *     had quietly baked a millimetre somewhere would pass (1) and fail (2), so
 *     (2) is the test that earns its keep.
 *
 * Run from the project root.
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}

const LIBRARY = "public/models/components";
const defOf = (file: string): LampComponentDef =>
  parseComponentDef(file, JSON.parse(fs.readFileSync(`${LIBRARY}/${file}`, "utf8")));

const RAW: Record<string, string> = {
  innerWidth: "200",
  innerDepth: "#innerWidth",
  innerHeight: "370",
  legThickness: "20",
  legExtraTop: "20",
  legExtraBottom: "40",
  beamHeight: "15",
  beamDepth: "10",
  beamExtra: "20",
  frameWidth: "7",
  frameHeight: "#frameWidth",
};
const PAIRED = { innerWidth: true, frameWidth: true };
const STASHED = { innerDepth: "200", frameHeight: "7" };

/**
 * The whole laid-out lamp as one comparable string — where every part is *and*
 * what size it was cut to. Both, because a variable can move a part without
 * resizing it (`innerHeight`) or resize it without moving it (`legThickness`),
 * and a round trip has to preserve either.
 */
function fingerprint(instances: LampInstance[], raw: Record<string, string>): string {
  const scene = computeScene(instances, raw);
  const f = (n: number) => n.toFixed(6);
  return instances
    .map((i) => {
      const p = scene.placements.get(i.id)!;
      const boxes = scene.shapes
        .get(i.id)!
        .boxes.map((b) => [...b.min.toArray(), ...b.max.toArray()].map(f).join(","))
        .join(";");
      return `${i.id}:${p.position.toArray().map(f).join(",")}|${p.quaternion.toArray().map(f).join(",")}|${boxes}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// A lamp: a leg fixed to the main box, a beam hung off the leg, one part loose.
// ---------------------------------------------------------------------------

function buildLamp(): LampInstance[] {
  const leg = defOf("leg.component.json");
  const beam = defOf("beam.component.json");
  const frame = defOf("frameVertical.component.json");

  let instances: LampInstance[] = [
    { id: "leg-1", label: "leg", def: leg, connection: null, position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    { id: "beam-1", label: "beam", def: beam, connection: null, position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    // never connected: the one instance whose position is a real fact
    { id: "frame-1", label: "frame", def: frame, connection: null, position: [321.5, 12, -40.25], quaternion: [0, 0, 0, 1] },
  ];

  const scene = computeScene(instances, RAW);
  const pickOn = (id: string, at: [number, number, number]) => {
    const shape = scene.shapes.get(id)!;
    const placement = scene.placements.get(id)!;
    const hit = snapToFeature(pickBoxes(shape), placement, new THREE.Vector3(...at));
    return anchorOnInstance(hit.point, shape, placement, hit.block);
  };
  const shapeOf = (id: string) => scene.shapes.get(id)!;

  // the leg onto a vertical arris of the main box
  const box = scene.mainBox;
  const legSource: [LampAnchor, LampAnchor] = [
    pickOn("leg-1", [0, shapeOf("leg-1").size[1], 0]),
    pickOn("leg-1", [0, 0, 0]),
  ];
  const legTarget: [LampAnchor, LampAnchor] = [
    anchorOnMainBox(new THREE.Vector3(box.min.x, box.min.y, box.min.z), box),
    anchorOnMainBox(new THREE.Vector3(box.min.x, box.max.y, box.min.z), box),
  ];

  // the beam onto the top of the leg — a joint between two *components*
  const beamSource: [LampAnchor, LampAnchor] = [
    pickOn("beam-1", [shapeOf("beam-1").size[0], 0, 0]),
    pickOn("beam-1", [0, 0, 0]),
  ];
  const beamTarget: [LampAnchor, LampAnchor] = [
    pickOn("leg-1", [0, shapeOf("leg-1").size[1], 0]),
    pickOn("leg-1", [0, 0, 0]),
  ];

  instances = instances.map((i) => {
    if (i.id === "leg-1") {
      return { ...i, connection: { source: legSource, target: { kind: "mainBox" as const, anchors: legTarget } } };
    }
    if (i.id === "beam-1") {
      return {
        ...i,
        connection: {
          source: beamSource,
          target: { kind: "instance" as const, id: "leg-1", anchors: beamTarget },
          roll: 90,
        },
      };
    }
    return i;
  });
  return instances;
}

const built = buildLamp();
const defs = new Map(built.map((i) => [i.def.file, i.def]));

console.log("\n[1] the fixture is a real lamp, not three loose parts");
{
  check("leg is fixed to the main box", built[0].connection?.target.kind === "mainBox");
  check("beam is fixed to the leg", built[1].connection?.target.kind === "instance");
  check("frame is loose", built[2].connection === null);
  const scene = computeScene(built, RAW);
  check(
    "all three resolve to distinct places",
    new Set([...scene.placements.values()].map((p) => p.position.toArray().join(","))).size === 3
  );
}

console.log("\n[2] round trip through JSON");
const file = JSON.parse(JSON.stringify(buildLampFile("test-lamp", built, { raw: RAW, paired: PAIRED, stashed: STASHED })));
const reloaded = toInstances(parseLampFile(file), defs);
{
  check("nothing missing", reloaded.missing.length === 0, reloaded.missing.join(", "));
  check("all three instances came back", reloaded.instances.length === 3);
  check(
    "the variables came back",
    JSON.stringify(file.variables) === JSON.stringify(Object.fromEntries(Object.keys(RAW).sort().map((k) => [k, RAW[k]])))
  );
  check("the paired flags came back", JSON.stringify(file.paired) === JSON.stringify(PAIRED));
  check("the stashed values came back", JSON.stringify(file.stashed) === JSON.stringify(STASHED));
  check("the beam's roll came back", reloaded.instances[1].connection?.roll === 90);
  check(
    "the loose part kept its place",
    JSON.stringify(reloaded.instances[2].position) === JSON.stringify([321.5, 12, -40.25]),
    JSON.stringify(reloaded.instances[2].position)
  );
  check(
    "a connected instance writes NO place — it is dead state",
    file.instances[0].place === undefined && file.instances[1].place === undefined
  );
  check(
    "the beam's anchors kept their blocks",
    reloaded.instances[1].connection!.target.anchors.every((a: LampAnchor) => a.block !== undefined)
  );
}

console.log("\n[3] the same lamp comes back — every part to the last decimal");
{
  check("placements identical at the saved variables", fingerprint(built, RAW) === fingerprint(reloaded.instances, RAW));
}

console.log("\n[4] ...and it comes back as a RECIPE, not a snapshot");
{
  for (const [name, raw] of [
    ["innerHeight 370 -> 900", { ...RAW, innerHeight: "900" }],
    ["innerWidth 200 -> 450", { ...RAW, innerWidth: "450" }],
    ["legThickness 20 -> 35", { ...RAW, legThickness: "35" }],
  ] as const) {
    const before = fingerprint(built, raw);
    const after = fingerprint(reloaded.instances, raw);
    check(`identical after ${name}`, before === after);
    check(`  ...and the lamp actually changed`, before !== fingerprint(built, RAW));
  }
}

console.log("\n[5] a component the library no longer has");
{
  const short = new Map(defs);
  short.delete("leg.component.json");
  const { instances, missing } = toInstances(parseLampFile(file), short);
  check("the missing component is named", missing.join(",") === "leg.component.json", missing.join(","));
  check("its instance is dropped", instances.every((i) => i.id !== "leg-1"));
  check("the loose part is untouched", instances.some((i) => i.id === "frame-1"));
  const beam = instances.find((i) => i.id === "beam-1")!;
  check("the beam that hung off it is freed, not left pointing at nothing", beam.connection === null);
  // and the scene still resolves rather than throwing or collapsing to the origin
  const scene = computeScene(instances, RAW);
  check("the rest of the lamp still lays out", scene.placements.size === instances.length);
}

console.log("\n[6] a component that has gained a variable since the lamp was saved");
{
  // The leg, re-cut against a variable that did not exist when the lamp was
  // written — which is what editing a component in the meantime does. No lamp
  // file can carry it, so the file is not wrong; it simply cannot know.
  const leg = defOf("leg.component.json");
  const grown: LampComponentDef = {
    ...leg,
    blocks: leg.blocks.map((block, i) =>
      i === 0
        ? { ...block, size: [`(${block.size[0]}) * #legScale`, block.size[1], block.size[2]] as [string, string, string] }
        : block
    ),
    variables: { ...leg.variables, legScale: "3" },
  };
  const grownDefs = new Map(defs);
  grownDefs.set("leg.component.json", grown);

  const loaded = toInstances(parseLampFile(file), grownDefs);
  check("the variable the file lacks is handed back", loaded.variables.legScale === "3");
  check(
    "...and only that one — anything the file defines is the file's to decide",
    Object.keys(loaded.variables).join(",") === "legScale",
    Object.keys(loaded.variables).join(",")
  );

  const xOf = (raw: Record<string, string>) => {
    const box = computeScene(loaded.instances, raw).shapes.get("leg-1")!.boxes[0];
    return box.max.x - box.min.x;
  };
  const was = computeScene(built, RAW).shapes.get("leg-1")!.boxes[0];

  // the bug this guards: unresolvable formulas send every block of the
  // component to the 1 mm fallback, silently
  check("without it the leg collapses to the 1 mm fallback", xOf(RAW) === 1, `${xOf(RAW)} mm`);
  check(
    "with it the leg is cut at the new variable",
    Math.abs(xOf({ ...loaded.variables, ...RAW }) - (was.max.x - was.min.x) * 3) < 1e-9,
    `${xOf({ ...loaded.variables, ...RAW })} vs ${(was.max.x - was.min.x) * 3}`
  );
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}\n`);
process.exit(failures === 0 ? 0 : 1);
