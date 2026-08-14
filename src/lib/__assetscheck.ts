import * as fs from "node:fs";
import * as THREE from "three";
import {
  assetName,
  centreForSpin,
  componentPreviewGeometry,
  deriveSources,
  lampPreviewGeometry,
  loadCatalogue,
  type ComponentAsset,
  type LampAsset,
  type TextureAsset,
} from "./assets";
import { computeScene } from "./lamp";
import { loadComponentFile, type ComponentFile } from "./componentFile";
import { deriveBlocks, useComponentEditorStore } from "../store/useComponentEditorStore";
import { useVariablesStore } from "../store/useVariablesStore";

/**
 * What the Assets tab claims about the library, checked against the library.
 *
 * Two of the claims are geometry and are the ones worth the harness: the sweep
 * radius really does contain the model through a full turn (or a preview swings
 * out of its cell), and the lamp thumbnail really is the lamp (or it is a
 * picture of something else).
 *
 * Run from the project root. `fetch` is answered off `public/`, which is what
 * the dev server and the built site both serve, so this exercises the real
 * `lib/library.ts` path rather than a copy of it.
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}

const BASE = "/shoji-builder/";
// The three libraries are read from the library branch now, not from the site,
// so the addresses arriving here are raw.githubusercontent.com URLs whose tail
// is already the repository path — which is this working copy's own path, since
// the branch is these files. Everything else is still a path into `public/`.
const RAW = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\//;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const raw = RAW.exec(String(input));
  const url = String(input).replace(BASE, "");
  const path = raw
    ? decodeURIComponent(String(input).slice(raw[0].length))
    : `public/${decodeURIComponent(url)}`;
  const dir = path.replace(/\/index\.json$/, "");
  if (path.endsWith("/index.json") && fs.existsSync(dir)) {
    const listing = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json") && name !== "index.json")
      .sort();
    return new Response(JSON.stringify(listing), { status: 200 });
  }
  if (!fs.existsSync(path)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(path, "utf8"), { status: 200 });
}) as typeof fetch;

const { assets, errors } = await loadCatalogue();

console.log("\nThe catalogue");
check("every library listed", errors.length === 0, errors.join("; "));
check("nothing unreadable", assets.every((a) => a.kind !== "broken"),
  assets.filter((a) => a.kind === "broken").map((a) => a.file).join(", "));

for (const [library, kind] of [
  ["components", "component"],
  ["lamps", "lamp"],
  ["textures", "texture"],
] as const) {
  const onDisk = fs
    .readdirSync(`public/models/${library}`)
    .filter((n) => n.endsWith(".json") && n !== "index.json").length;
  const read = assets.filter((a) => a.library === library);
  check(
    `${library}: every file is an asset of its kind`,
    read.length === onDisk && read.every((a) => a.kind === kind),
    `${read.length}/${onDisk}`
  );
}

check(
  "names lose the extension and the kind",
  assetName("leg.component.json") === "leg" &&
    assetName("basic.lamp.json") === "basic" &&
    assetName("white-oak.texture.json") === "white-oak"
);

// ---------------------------------------------------------------------------
// Missing measurements
// ---------------------------------------------------------------------------

console.log("\nUnmeasured sizes, against what the editor says once the file is open");

/**
 * The other path to the same answer: really load the component and ask
 * `deriveBlocks`, which is what colours the edges in the four views.
 *
 * At the file's own baked variables, because that is the frame the card judges
 * it in — see `deriveSources`. The badge and the drawing must agree, or the
 * badge is describing a component nobody will see.
 */
function sourcesAfterLoad(raw: ComponentFile): string[][] {
  useVariablesStore.setState({
    raw: Object.fromEntries(
      Object.entries(raw.preview?.variables ?? {}).map(([k, v]) => [k, String(v)])
    ),
    loaded: true,
  });
  useComponentEditorStore.getState().reset();
  loadComponentFile(raw);
  const editor = useComponentEditorStore.getState();
  const bindings = deriveBlocks(editor.meshes, editor.measurements);
  return editor.meshes.map((m) => bindings.get(m.id)?.source ?? ["?", "?", "?"]);
}

const components = assets.filter((a): a is ComponentAsset => a.kind === "component");
for (const asset of components) {
  const raw = JSON.parse(
    fs.readFileSync(`public/models/components/${asset.file}`, "utf8")
  ) as ComponentFile;

  const editor = sourcesAfterLoad(raw);
  const card = deriveSources(raw);
  check(
    `${asset.name}: the card derives exactly what the editor derives`,
    JSON.stringify(card) === JSON.stringify(editor),
    `card ${JSON.stringify(card?.flat())}`
  );
  check(
    `${asset.name}: ${asset.unmeasured} unmeasured of ${asset.blocks * 3}`,
    asset.unmeasured === editor.flat().filter((s) => s === "literal").length &&
      asset.blocks === raw.blocks.length
  );

  // The point of the whole exercise: an implied size is not a gap. Every one of
  // these files leans on them, and none of them should raise a badge for it.
  const implied = editor.flat().filter((s) => s === "implied").length;
  check(
    `${asset.name}: its ${implied} implied size${implied === 1 ? "" : "s"} raise no warning`,
    implied === 0 || asset.unmeasured === 0 || asset.unmeasured! < implied,
    `${asset.unmeasured} unmeasured`
  );
}

// The saved provenance disagrees with all of this, which is why it is not what
// the card reads: frameHorizontal records three literal heights and comes back
// with every size determined, because the `#frameHeight` measurement in the same
// file covers them.
const stale = JSON.parse(
  fs.readFileSync("public/models/components/frameHorizontal.component.json", "utf8")
);
check(
  "frameHorizontal: saved provenance says 3 literal, the file really has none",
  stale.blocks.flatMap((b: { sizeSource: Record<string, string> }) => Object.values(b.sizeSource))
    .filter((s: string) => s === "literal").length === 3 &&
    components.find((a) => a.name === "frameHorizontal")!.unmeasured === 0
);
check(
  "no component in the library raises the badge",
  components.every((a) => a.unmeasured === 0),
  components.filter((a) => a.unmeasured !== 0).map((a) => `${a.name}:${a.unmeasured}`).join(",")
);

// ---------------------------------------------------------------------------
// The spin radius really contains the model
// ---------------------------------------------------------------------------

console.log("\nFraming");

/** Every vertex's distance from the origin — invariant under the spin. */
function maxRadius(geometry: THREE.BufferGeometry): number {
  const position = geometry.attributes.position;
  const v = new THREE.Vector3();
  let max = 0;
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    max = Math.max(max, v.length());
  }
  return max;
}

/**
 * @param tight whether a vertex is expected *at* the bounding box corner the
 *        radius is taken to. True of one box assembly drawn about its own
 *        corner; false of a lamp, whose extreme X and extreme Z belong to
 *        different parts, so the corner is empty air and the radius is
 *        legitimately a little generous.
 */
function framing(name: string, geometry: THREE.BufferGeometry, tight: boolean) {
  const before = new THREE.Box3().setFromBufferAttribute(
    geometry.attributes.position as THREE.BufferAttribute
  );
  const radius = centreForSpin(geometry);
  const box = new THREE.Box3().setFromBufferAttribute(
    geometry.attributes.position as THREE.BufferAttribute
  );
  const centre = box.getCenter(new THREE.Vector3());
  check(`${name}: centred on the origin`, centre.length() < 1e-6, `centre ${centre.toArray()}`);
  check(
    `${name}: size unchanged by centring`,
    box.getSize(new THREE.Vector3()).distanceTo(before.getSize(new THREE.Vector3())) < 1e-6
  );
  const reach = maxRadius(geometry);
  check(
    `${name}: the sweep radius contains every vertex at every angle`,
    reach <= radius + 1e-6,
    `reach ${reach.toFixed(3)} <= radius ${radius.toFixed(3)}`
  );
  // and is not wastefully large, or the model sits in the middle of the cell at
  // half the size it could be drawn at
  check(
    `${name}: the radius is ${tight ? "exact" : "not wasteful"}`,
    tight ? Math.abs(reach - radius) < 1e-6 * Math.max(1, radius) : radius < reach * 1.35,
    `${reach.toFixed(3)} vs ${radius.toFixed(3)}`
  );
}

for (const asset of components) {
  const geometry = componentPreviewGeometry(asset.solids);
  if (!geometry) {
    check(`${asset.name}: has a baked preview`, false);
    continue;
  }
  check(
    `${asset.name}: preview is non-indexed, so its arrises stay sharp`,
    geometry.index === null && geometry.attributes.position.count % 3 === 0
  );
  framing(asset.name, geometry, true);
}

const beam = new THREE.BoxGeometry(200, 10, 10);
framing("texture beam", beam, true);

// ---------------------------------------------------------------------------
// The lamp thumbnail is the lamp
// ---------------------------------------------------------------------------

console.log("\nLamp previews");
const lamps = assets.filter((a): a is LampAsset => a.kind === "lamp");
for (const lamp of lamps) {
  check(`${lamp.name}: every component found`, lamp.missing.length === 0, lamp.missing.join(", "));
  const geometry = lampPreviewGeometry(lamp);
  if (!geometry) {
    check(`${lamp.name}: draws something`, false);
    continue;
  }

  // Independent path: the scene's own world boxes, which is what the Lamp
  // Design tab frames its camera on. The preview buffer must occupy exactly the
  // same millimetres — before it is centred, which is why this runs first.
  const scene = computeScene(lamp.instances, lamp.variables);
  const expected = new THREE.Box3();
  for (const box of scene.worldBoxes.values()) expected.union(box);

  const built = new THREE.Box3().setFromBufferAttribute(
    geometry.attributes.position as THREE.BufferAttribute
  );
  const drift = Math.max(
    built.min.distanceTo(expected.min),
    built.max.distanceTo(expected.max)
  );
  check(
    `${lamp.name}: the preview occupies the scene's own bounds`,
    drift < 1e-6,
    `drift ${drift.toExponential(2)} mm over ${lamp.instances.length} parts`
  );

  // 12 boxes of 12 triangles each, with nothing dropped on the way into the
  // merge: the count is what catches a silently skipped instance.
  const boxes = lamp.instances.reduce(
    (n, i) => n + (scene.shapes.get(i.id)?.boxes.length ?? 0),
    0
  );
  check(
    `${lamp.name}: every block is in the buffer`,
    geometry.index !== null
      ? geometry.index.count === boxes * 36
      : geometry.attributes.position.count === boxes * 36,
    `${boxes} blocks`
  );

  framing(lamp.name, geometry, false);
}

// ---------------------------------------------------------------------------

console.log("\nTextures");
for (const asset of assets.filter((a): a is TextureAsset => a.kind === "texture")) {
  const raw = JSON.parse(fs.readFileSync(`public/models/textures/${asset.file}`, "utf8"));
  check(
    `${asset.name}: ${asset.texture.species} / ${asset.texture.finish}`,
    asset.texture.species === raw.species && asset.texture.finish === raw.finish
  );
  check(
    `${asset.name}: parameters survive the read`,
    Object.entries(raw.params as Record<string, unknown>).every(([k, v]) =>
      Array.isArray(v)
        ? JSON.stringify((asset.texture.params as unknown as Record<string, unknown>)[k]) ===
          JSON.stringify(v)
        : (asset.texture.params as unknown as Record<string, unknown>)[k] === v
    )
  );
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
