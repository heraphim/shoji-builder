import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { boxSize, buildBoxGeometry } from "./blocks";
import { readAppearance, type ComponentFile } from "./componentFile";
import { listLibrary, readLibraryFile, type Library } from "./library";
import {
  buildShape,
  computeScene,
  parseComponentDef,
  placementMatrix,
  type LampComponentDef,
  type LampInstance,
} from "./lamp";
import { parseLampFile, toInstances } from "./lampFile";
import { buildSpanSolver, collectKnownSpans, spanKey } from "./measure";
import { parseTextureFile, type TextureFile } from "./textureFile";
import { isLiteralFormula } from "../store/useComponentEditorStore";
import type { Appearance, AxisIndex, SizeSource } from "../store/useComponentEditorStore";

/**
 * Everything in the three libraries, read as things to *look at* rather than as
 * things to work on.
 *
 * The rest of the app opens one design at a time and asks it to be editable. The
 * Assets tab asks a smaller question of all of them at once — what is in there,
 * what does it look like, is it finished — so it reads each file down to the
 * least it needs and stops. Nothing here loads anything onto a bench; that stays
 * with the three loaders the file menus already use, and the tab calls those
 * when the user actually asks for it. A browser that quietly used a second code
 * path to open a component would be a second definition of what opening one
 * means.
 *
 * ## What each kind carries
 *
 * A **component** is read down to its baked `preview` — which exists for exactly
 * this, see `buildComponentFile` — plus the two things worth judging it by
 * without opening it: how many of its sizes nothing measures, and what it is
 * dressed in.
 *
 * A **lamp** names its components rather than carrying them, so it is read into
 * the same instances the lamp store would build, against the components the
 * library holds *now*. That is also where the missing ones are found.
 *
 * A **texture** is its parameters, which is all a texture ever was.
 *
 * A file that will not parse comes back as a {@link BrokenAsset} rather than
 * being dropped: an asset browser that silently omits a file is one you cannot
 * use to find out why the file is not showing up anywhere else either.
 */

export type AssetKind = "component" | "lamp" | "texture" | "broken";

interface AssetCommon {
  kind: AssetKind;
  library: Library;
  /** The file name in that library, extension included — what a delete names. */
  file: string;
  /** The name it is known by everywhere else: the file name without extension. */
  name: string;
}

export interface ComponentAsset extends AssetCommon {
  kind: "component";
  library: "components";
  blocks: number;
  /**
   * Sizes that nothing determines — the ones that will not follow a variable.
   *
   * **Implied sizes are not counted.** An implied size is not a gap: it is what
   * the measurements the designer *did* make already say, worked out by the span
   * solver, and it scales with the lamp exactly as a set one does. Most
   * components have some, by design. Only a `literal` — the millimetre the solid
   * happened to be drawn at, with no chain reaching it — is a size that will
   * still be that many millimetres when the lamp changes size.
   *
   * Derived rather than read off the file's `sizeSource`, which is a note made
   * at save time and can be stale: `frameHorizontal` records three literal
   * heights and comes back with all three measured, because the `#frameHeight`
   * measurement in the same file covers them. What the editor shows when you
   * open the file is the truth, so this reproduces it — see {@link deriveSources}.
   *
   * Null when the file does not carry enough to judge, and then no badge is
   * shown: crying wolf over a hand-written file is worse than saying nothing.
   */
  unmeasured: number | null;
  appearance: Appearance;
  /** The preview baked at save time, in the component's own frame. */
  solids: ComponentFile["preview"]["solids"];
}

export interface LampAsset extends AssetCommon {
  kind: "lamp";
  library: "lamps";
  /** Its parts, against the components the library holds now. */
  instances: LampInstance[];
  /** The variables it was saved at — what the preview is drawn at. */
  variables: Record<string, string>;
  /** Components it names that the library no longer has. */
  missing: string[];
}

export interface TextureAsset extends AssetCommon {
  kind: "texture";
  library: "textures";
  texture: TextureFile;
}

export interface BrokenAsset extends AssetCommon {
  kind: "broken";
  error: string;
}

export type Asset = ComponentAsset | LampAsset | TextureAsset | BrokenAsset;

/** Every library, and whatever could not be listed. */
export interface Catalogue {
  assets: Asset[];
  /** One per library whose listing failed — the assets are simply not there. */
  errors: string[];
}

const LIBRARIES: Library[] = ["components", "lamps", "textures"];

/** The name a file is known by: the extension, and the kind in it, taken off. */
export function assetName(file: string): string {
  return file.replace(/(\.(component|lamp|texture))?\.json$/, "");
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const AXES = ["x", "y", "z"] as const;

/**
 * How well each of a component's sizes is pinned down, as the editor will say
 * it once the file is open.
 *
 * This is `deriveBlocks` and `loadBlocks` between them, replayed on a file
 * nobody has opened. Reproducing it rather than reading the file's own
 * `sizeSource` is the whole point: that field records what the solver said on
 * the day of the save, and a file can come back better determined than it went
 * in — a measurement written into `measurements` can turn out to cover a block
 * extent that was literal when it was written.
 *
 * The two halves of the replay:
 *
 *  1. **The parts, laid out.** `buildShape` cuts every block and replays the
 *     component's own joints, which is what `loadBlocks` does, and leaves the
 *     assembly's low corner at the origin — the frame the file's measurement
 *     edges were written in.
 *  2. **Every span the solver will know.** The file's `measurements`, *plus* the
 *     block extents whose `sizeSource` is `set`. That second half is easy to
 *     miss and is not optional: `buildComponentFile` deliberately leaves a
 *     measurement out of `measurements` when it is already a block's size, so
 *     the file on its own understates what is known by exactly those spans, and
 *     `loadBlocks` puts them back before the solver ever runs.
 *
 * Everything is judged at the file's **own** saved variables rather than the
 * design's current ones. A library card is a fact about a file, and a badge that
 * changed because you dragged a slider on another tab would be answering a
 * different question every time you looked at it.
 *
 * @returns one source per block per axis, or null when the file cannot be
 *          judged — no baked variables, but formulas that need them.
 */
export function deriveSources(file: ComponentFile): SizeSource[][] | null {
  const variables: Record<string, string> = Object.fromEntries(
    Object.entries(file.preview?.variables ?? {}).map(([name, value]) => [name, String(value)])
  );
  const needsVariables = file.blocks.some((block) =>
    AXES.some((axis) => /#/.test(block.size[axis]))
  );
  if (needsVariables && Object.keys(variables).length === 0) return null;

  const shape = buildShape(parseComponentDef(file.id, file), variables);

  const spans = collectKnownSpans(file.measurements ?? []);
  const seen = new Set(spans.map(spanKey));
  // the block sizes the designer set, which the file states in `blocks` instead
  // of in `measurements` — see (2) above
  shape.boxes.forEach((box: THREE.Box3, i: number) => {
    const block = file.blocks[i];
    AXES.forEach((name, axis) => {
      const source =
        block.sizeSource?.[name] ?? (isLiteralFormula(block.size[name]) ? "literal" : "set");
      if (source !== "set") return;
      const span = { axis: axis as AxisIndex, a: box.min.getComponent(axis), b: box.max.getComponent(axis) };
      const key = spanKey(span);
      if (seen.has(key)) return;
      seen.add(key);
      spans.push({ ...span, formula: block.size[name] });
    });
  });

  const solver = buildSpanSolver(spans);
  return shape.boxes.map((box: THREE.Box3) =>
    AXES.map((_, axis): SizeSource => {
      const span = { axis: axis as AxisIndex, a: box.min.getComponent(axis), b: box.max.getComponent(axis) };
      if (solver.known.has(spanKey(span))) return "set";
      return solver.imply(span) ? "implied" : "literal";
    })
  );
}

function readComponent(file: string, data: unknown): ComponentAsset {
  const parsed = data as Partial<ComponentFile> | null;
  if (!parsed || parsed.type !== "component" || !Array.isArray(parsed.blocks)) {
    throw new Error("Not a component file");
  }

  // A component whose parts will not lay out at all is still a component worth
  // listing; it just cannot be judged, and says so by showing no badge.
  let sources: SizeSource[][] | null = null;
  try {
    sources = deriveSources(parsed as ComponentFile);
  } catch {
    sources = null;
  }

  return {
    kind: "component",
    library: "components",
    file,
    name: assetName(file),
    blocks: parsed.blocks.length,
    unmeasured: sources
      ? sources.flat().filter((source) => source === "literal").length
      : null,
    appearance: readAppearance(parsed.appearance),
    solids: parsed.preview?.solids ?? [],
  };
}

async function readLamp(
  file: string,
  data: unknown,
  defOf: (component: string) => Promise<LampComponentDef | null>
): Promise<LampAsset> {
  const lamp = parseLampFile(data);
  const defs = new Map<string, LampComponentDef>();
  await Promise.all(
    [...new Set(lamp.instances.map((i) => i.component))].map(async (component) => {
      const def = await defOf(component);
      if (def) defs.set(component, def);
    })
  );
  const { instances, missing } = toInstances(lamp, defs);
  return {
    kind: "lamp",
    library: "lamps",
    file,
    name: assetName(file),
    instances,
    variables: lamp.variables,
    missing,
  };
}

/**
 * Read every library.
 *
 * Files within a library are read at once rather than one after another — a
 * listing is a dozen small fetches and doing them in series is a dozen round
 * trips of waiting — and the component defs a lamp needs are memoised across the
 * whole catalogue, so a component used by four lamps is fetched once.
 *
 * A library that will not list contributes an error and no assets. One file that
 * will not parse contributes a {@link BrokenAsset} and does not take the rest of
 * its library with it.
 */
export async function loadCatalogue(): Promise<Catalogue> {
  const defs = new Map<string, Promise<LampComponentDef | null>>();
  const defOf = (component: string): Promise<LampComponentDef | null> => {
    const held = defs.get(component);
    if (held) return held;
    const request = readLibraryFile("components", component)
      .then((data) => parseComponentDef(component, data))
      .catch(() => null);
    defs.set(component, request);
    return request;
  };

  const assets: Asset[] = [];
  const errors: string[] = [];

  for (const library of LIBRARIES) {
    let files: string[];
    try {
      files = await listLibrary(library);
    } catch (e) {
      errors.push(message(e));
      continue;
    }

    const read = await Promise.all(
      files.map(async (file): Promise<Asset> => {
        try {
          const data = await readLibraryFile(library, file);
          if (library === "components") return readComponent(file, data);
          if (library === "lamps") return await readLamp(file, data, defOf);
          return {
            kind: "texture",
            library: "textures",
            file,
            name: assetName(file),
            texture: parseTextureFile(data),
          };
        } catch (e) {
          return { kind: "broken", library, file, name: assetName(file), error: message(e) };
        }
      })
    );
    assets.push(...read);
  }

  return { assets, errors };
}

// ---------------------------------------------------------------------------
// What a preview draws
// ---------------------------------------------------------------------------

/**
 * The test piece a texture is shown on: one beam, 200 mm long and 10 mm square.
 *
 * The Textures tab's own bench is four of these at four sections, because there
 * the question is how one wood behaves at every scale it will be cut to. Here
 * the question is only *which wood is this*, so one stick answers it, and the
 * 10 mm one because it is the section with both a long face and an end big
 * enough to read at thumbnail size.
 */
export const TEXTURE_BEAM = { length: 200, section: 10 } as const;

/**
 * Centre a geometry on its own bounding box and report the radius that contains
 * it *through a full turn about Y*.
 *
 * The preview spins, so what has to fit the cell is not the box but the cylinder
 * it sweeps: a beam framed on its 200 × 10 face would swing straight out of the
 * cell a quarter turn later. The radius is therefore taken across the horizontal
 * diagonal, and the height counted at its full extent.
 */
export function centreForSpin(geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  const [x, y, z] = boxSize(box);
  return Math.hypot(Math.hypot(x, z) / 2, y / 2);
}

/**
 * A component's baked preview as one drawable buffer, centred on the origin.
 *
 * `toNonIndexed` before the normals: the file welds coincident corners, so a box
 * arrives with eight vertices and averaged normals would round its arrises off.
 * A component is a box assembly and has to read as one.
 *
 * @returns null for a file that carries no preview — a hand-written one, or one
 *          from before the format baked it.
 */
export function componentPreviewGeometry(
  solids: ComponentFile["preview"]["solids"]
): THREE.BufferGeometry | null {
  const parts = solids
    .filter((solid) => solid.vertices.length > 0 && solid.triangles.length > 0)
    .map((solid) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(solid.vertices, 3));
      geometry.setIndex(solid.triangles);
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      return flat;
    });
  if (parts.length === 0) return null;

  const merged = mergeGeometries(parts) ?? parts[0];
  for (const part of parts) if (part !== merged) part.dispose();
  merged.computeVertexNormals();
  return merged;
}

/**
 * A whole lamp as one drawable buffer, centred on the origin.
 *
 * The scene is computed at the lamp's *own* saved variables rather than the
 * design's current ones: this is a picture of what is in the library, and a
 * thumbnail that changed shape because you dragged a slider on another tab would
 * be answering a question nobody asked of it.
 *
 * Every part of every instance goes into one buffer — the same trade
 * `buildSolid` makes in the lamp view, and more worth making here, where a dozen
 * previews are drawing at once.
 *
 * @returns null for a lamp with nothing left in it.
 */
export function lampPreviewGeometry(asset: LampAsset): THREE.BufferGeometry | null {
  const scene = computeScene(asset.instances, asset.variables);
  const parts: THREE.BufferGeometry[] = [];

  for (const instance of asset.instances) {
    const shape = scene.shapes.get(instance.id);
    const placement = scene.placements.get(instance.id);
    if (!shape || !placement) continue;
    const matrix = placementMatrix(placement);
    for (const box of shape.boxes) {
      const geometry = buildBoxGeometry(boxSize(box));
      geometry.translate(box.min.x, box.min.y, box.min.z);
      geometry.applyMatrix4(matrix);
      parts.push(geometry);
    }
  }
  if (parts.length === 0) return null;

  const merged = mergeGeometries(parts) ?? parts[0];
  for (const part of parts) if (part !== merged) part.dispose();
  return merged;
}
