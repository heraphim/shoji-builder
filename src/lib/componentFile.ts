import * as THREE from "three";
import {
  DEFAULT_APPEARANCE,
  deriveBlocks,
  meshGroups,
  meshWorldBox,
  useComponentEditorStore,
  type Appearance,
  type Edge,
  type LoadedBlock,
  type LoadedConnection,
  type SizeSource,
  type SubMesh,
  type Vec3,
} from "../store/useComponentEditorStore";
import { useVariablesStore } from "../store/useVariablesStore";
import { mergeGroupGeometry } from "./assembly";
import { roundAnchor } from "./blocks";
import { resolveVariables } from "./formula";
import { listLibrary, readLibraryFile } from "./library";
import { spanKey, spanOfEdge } from "./measure";

// A saved component is a recipe, not a snapshot.
//
// This module owns the *.component.json format in both directions. Full schema,
// round-trip guarantees and version history: docs/component-file-format.md
//
// Each part is a box stated as three formulas — one per axis — in terms of the
// design variables, and each joint is a point on one box brought onto a point
// on the next, named as a *fraction of the box* rather than as a coordinate.
// Nothing in that description mentions a millimetre that was only true on the
// day it was exported, so loading it at different variable values gives a
// different, correct component instead of the old one at the old size.
//
// `origin` is the exception, and it is deliberately not load-bearing: parts that
// a connection reaches are placed by the connection chain and their origins are
// overwritten, so the only thing an origin decides is where a part *no*
// connection reaches ends up. It is written relative to the assembly's own low
// corner, so it at least does not carry the bench position it was drawn at.
//
// A size formula is written together with *where it came from* (`sizeSource`),
// because the formula alone cannot say whether the designer measured that span
// or whether the solver worked it out from the ones they did. Both are needed —
// the formula to rebuild the part, the provenance so a loaded component knows
// which of its edges were decisions and which merely follow from them.
//
// The baked `preview` exists for anything that only wants to look at the
// component: it is the same solid evaluated at the variable values recorded in
// `variables`, and it is ignored on load.
//
// `appearance` (format 5) is the one part of the file that describes nothing
// about the shape: what the part is made of, and which way the grain runs
// through it. It names a texture rather than carrying one, so that editing a
// texture changes every component made of it — see docs/component-file-format.md.
// Optional, and absent means the defaults, so a format 4 file still loads.
export const COMPONENT_FORMAT = 5;

export interface ComponentFile {
  id: string;
  type: "component";
  format: number;
  units: "mm";
  // the variables the formulas are written against, so the file resolves on its
  // own; loading merges in any the current design does not already define
  variables: Record<string, string>;
  blocks: Array<{
    id: string;
    name: string;
    size: { x: string; y: string; z: string };
    // how each of those three formulas was arrived at — "set" is a decision the
    // designer made and comes back as a measurement, "implied" and "literal"
    // do not. Absent in format 3 files.
    sizeSource: { x: SizeSource; y: SizeSource; z: SizeSource };
    // the block's low corner, in mm from the assembly's low corner, at the
    // variable values in `variables`. Connections decide the final layout;
    // this only places parts that no connection reaches.
    origin: Vec3;
  }>;
  connections: Array<{
    id: string;
    a: { block: string; anchor: Vec3 };
    b: { block: string; anchor: Vec3 };
  }>;
  // measurements that are not simply a block's own size — spans across the
  // assembly, skew edges — kept so a loaded component can still be reasoned
  // about
  measurements: Array<{ id: string; formula: string; edges: Array<{ start: Vec3; end: Vec3 }> }>;
  /** How it is drawn. Absent in files written before format 5. */
  appearance?: Appearance;
  preview: {
    // the variable values the solids below were evaluated at
    variables: Record<string, number>;
    solids: Array<{ vertices: number[]; triangles: number[] }>;
  };
}

const DECIMALS = 4;
const round = (v: number) => Number(v.toFixed(DECIMALS));

// Indexed triangle list with coincident vertices welded, so the file carries
// each corner once instead of once per triangle that touches it. Welding is by
// *rounded* position, i.e. at the same 4 decimals everything else in the file
// is written at, so the index can never disagree with the coordinates.
function toIndexed(geometry: THREE.BufferGeometry): { vertices: number[]; triangles: number[] } {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const vertexAt = (i: number) => (index ? index.getX(i) : i);

  const vertices: number[] = [];
  const triangles: number[] = [];
  const lookup = new Map<string, number>();

  for (let i = 0; i < count; i++) {
    const v = vertexAt(i);
    const x = round(position.getX(v));
    const y = round(position.getY(v));
    const z = round(position.getZ(v));
    const key = `${x},${y},${z}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      lookup.set(key, id);
      vertices.push(x, y, z);
    }
    triangles.push(id);
  }
  return { vertices, triangles };
}

function joinedGroups(meshes: SubMesh[]): SubMesh[][] {
  const connections = useComponentEditorStore.getState().connections;
  const index = meshGroups(meshes, connections);
  const byGroup = new Map<number, SubMesh[]>();
  for (const mesh of meshes) {
    const g = index.get(mesh.id)!;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(mesh);
  }
  return Array.from(byGroup.values());
}

// A formula reaches every variable it names, and everything those name in turn.
// The `into.has` check both deduplicates and terminates on a cycle, so this is
// safe on a variable set the resolver would reject.
function collectVariables(formula: string, raw: Record<string, string>, into: Set<string>) {
  for (const name of formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (!(name in raw) || into.has(name)) continue;
    into.add(name);
    collectVariables(raw[name], raw, into);
  }
}

function edgeSpanKey(edge: Edge): string | null {
  const span = spanOfEdge(edge);
  return span ? spanKey(span) : null;
}

/**
 * Serialise the editor's current contents to the file format above.
 *
 * Steps: derive each block's size formulas, take the transitive closure of the
 * variables they name, note which spans a block size already states (so a
 * measurement is not written twice), find the assembly's low corner, then emit
 * blocks, connections, the remaining measurements and the baked preview.
 *
 * @returns null when the bench is empty. A non-box solid contributes to the
 *          preview but is omitted from `blocks` — there is no parametric
 *          description of it to write.
 */
export function buildComponentFile(): ComponentFile | null {
  const editor = useComponentEditorStore.getState();
  if (editor.meshes.length === 0) return null;

  const raw = useVariablesStore.getState().raw;
  const bindings = deriveBlocks(editor.meshes, editor.measurements);

  const used = new Set<string>();
  for (const binding of bindings.values()) {
    for (const formula of binding.size) collectVariables(formula, raw, used);
  }
  for (const measurement of editor.measurements) {
    collectVariables(measurement.formula, raw, used);
  }

  const blockSpans = new Set<string>();
  for (const binding of bindings.values()) {
    for (const key of binding.spanKeys) blockSpans.add(key);
  }

  let previewVariables: Record<string, number> = {};
  try {
    previewVariables = resolveVariables(raw);
  } catch {
    previewVariables = {};
  }

  // Everything written as a coordinate — origins, measurement edges, the baked
  // preview — is stated from the assembly's own low corner rather than from
  // wherever it happened to sit on the bench. Where the STL was drawn is not a
  // property of the component, and a file that carries it makes two components
  // that should butt together load metres apart.
  const anchor = new THREE.Vector3(Infinity, Infinity, Infinity);
  for (const mesh of editor.meshes) anchor.min(meshWorldBox(mesh).min);
  const shift = (v: Vec3): Vec3 => [
    round(v[0] - anchor.x),
    round(v[1] - anchor.y),
    round(v[2] - anchor.z),
  ];

  return {
    id: editor.meshes[0].name.replace(/\.[^/.]+$/, "").replace(/ \(\d+\)$/, ""),
    type: "component",
    format: COMPONENT_FORMAT,
    units: "mm",
    variables: Object.fromEntries([...used].sort().map((name) => [name, raw[name]])),

    blocks: editor.meshes.flatMap((mesh) => {
      const binding = bindings.get(mesh.id);
      // a solid that is not a box has no parametric description — it is left
      // out of `blocks` rather than saved as a size it cannot honour
      if (!binding) return [];
      const box = meshWorldBox(mesh);
      return [
        {
          id: mesh.id,
          name: mesh.name,
          size: { x: binding.size[0], y: binding.size[1], z: binding.size[2] },
          sizeSource: {
            x: binding.source[0],
            y: binding.source[1],
            z: binding.source[2],
          },
          origin: shift([box.min.x, box.min.y, box.min.z]),
        },
      ];
    }),

    connections: editor.connections.map((c) => ({
      id: c.id,
      a: { block: c.meshA, anchor: roundAnchor(c.anchorA) },
      b: { block: c.meshB, anchor: roundAnchor(c.anchorB) },
    })),

    // a measurement that *is* a block's size is already stated in `blocks`;
    // writing it twice would let the two drift apart
    measurements: editor.measurements.flatMap((m) => {
      const edges = m.edges.filter((edge) => {
        const key = edgeSpanKey(edge);
        return key === null || !blockSpans.has(key);
      });
      if (edges.length === 0) return [];
      return [
        {
          id: m.id,
          formula: m.formula,
          edges: edges.map((e) => ({ start: shift(e.start), end: shift(e.end) })),
        },
      ];
    }),

    appearance: editor.appearance,

    preview: {
      variables: Object.fromEntries(
        Object.entries(previewVariables).map(([k, v]) => [k, round(v)])
      ),
      solids: joinedGroups(editor.meshes).map((groupMeshes) => {
        const solid = toIndexed(mergeGroupGeometry(groupMeshes));
        for (let i = 0; i < solid.vertices.length; i += 3) {
          solid.vertices[i] = round(solid.vertices[i] - anchor.x);
          solid.vertices[i + 1] = round(solid.vertices[i + 1] - anchor.y);
          solid.vertices[i + 2] = round(solid.vertices[i + 2] - anchor.z);
        }
        return solid;
      }),
    },
  };
}

/** A file name reduced to what may safely go in one, or null if nothing is left. */
export function sanitizeName(name: string): string | null {
  const clean = name.trim().replace(/[^A-Za-z0-9 _-]/g, "").trim();
  return clean.length > 0 ? clean : null;
}

/**
 * The current component as the file it would be saved as, or null on an empty
 * bench. Where that file then goes is {@link saveLibraryFile}'s business.
 *
 * @param name what to write it under. Defaults to the id the component derives
 *        from its own parts, which is what an unnamed bench is called.
 */
export function componentFileFor(name?: string): ComponentFile | null {
  const built = buildComponentFile();
  if (!built) return null;
  return { ...built, id: (name && sanitizeName(name)) || built.id };
}

/**
 * The appearance block, validated field by field. Exported because the Assets
 * tab reads it off a file it is only *looking* at, and a second reader that
 * disagreed about what a malformed block means would be a second format.
 *
 * A missing block is a format 4 file and reads as the defaults; a *malformed*
 * one reads as the defaults too, field by field, rather than being rejected. The
 * geometry is the component; refusing to open one because somebody hand-edited
 * its colour to `blue` would be losing the part over the paint.
 */
export function readAppearance(raw: Appearance | undefined): Appearance {
  if (!raw || typeof raw !== "object") return DEFAULT_APPEARANCE;
  return {
    solidColor: /^#[0-9a-fA-F]{6}$/.test(raw.solidColor)
      ? raw.solidColor
      : DEFAULT_APPEARANCE.solidColor,
    texture: typeof raw.texture === "string" ? raw.texture : null,
    grainAxis:
      raw.grainAxis === "x" || raw.grainAxis === "y" || raw.grainAxis === "z"
        ? raw.grainAxis
        : DEFAULT_APPEARANCE.grainAxis,
  };
}

export interface LoadReport {
  blocks: number;
  connections: number;
  addedVariables: string[];
  keptVariables: string[];
}

// Components are loaded from the project's own library — public/models/components
// — and nowhere else, so what can be loaded is exactly what the project holds.
// Whether that is read off the deployed site or straight off the branch is
// lib/library.ts's decision, not this module's.

/** File names in the library. @throws if the listing cannot be had. */
export function listLibraryComponents(): Promise<string[]> {
  return listLibrary("components");
}

/**
 * Fetch one library component and load it onto the bench, replacing whatever
 * was there. @throws on a missing file or a file that is not a component.
 */
export async function loadLibraryComponent(fileName: string): Promise<LoadReport> {
  return loadComponentFile(await readLibraryFile("components", fileName));
}

/**
 * Loading is the inverse of {@link buildComponentFile}: the variables the file
 * was written against are merged in for anything the current design does not
 * already define, then every block is re-cut at *the current* values. A variable
 * the design already has wins — that is the whole point of saving formulas
 * instead of sizes.
 *
 * Validation is on shape, not on `format`: an older file fails the `type` /
 * `blocks` check rather than being half-read.
 *
 * @throws when the payload is not a component file, or carries no blocks.
 */
export function loadComponentFile(data: unknown): LoadReport {
  const file = data as Partial<ComponentFile>;
  if (!file || file.type !== "component" || !Array.isArray(file.blocks)) {
    throw new Error("Not a component file");
  }
  if (file.blocks.length === 0) {
    throw new Error("Component file has no parametric blocks");
  }

  const variables = useVariablesStore.getState();
  const addedVariables: string[] = [];
  const keptVariables: string[] = [];
  for (const [name, value] of Object.entries(file.variables ?? {})) {
    if (name in variables.raw) keptVariables.push(name);
    else {
      addedVariables.push(name);
      variables.setVariable(name, value);
    }
  }

  const blocks: LoadedBlock[] = file.blocks.map((block) => ({
    id: block.id,
    name: block.name,
    size: [block.size.x, block.size.y, block.size.z],
    // left undefined for a format 3 file, which carries no provenance at all;
    // `loadBlocks` then falls back to guessing from the formula
    source: block.sizeSource
      ? [block.sizeSource.x, block.sizeSource.y, block.sizeSource.z]
      : undefined,
    origin: block.origin,
  }));

  const connections: LoadedConnection[] = (file.connections ?? []).map((c) => ({
    id: c.id,
    meshA: c.a.block,
    anchorA: c.a.anchor,
    meshB: c.b.block,
    anchorB: c.b.anchor,
  }));

  const extraMeasurements = (file.measurements ?? []).map((m) => ({
    id: m.id,
    formula: m.formula,
    edges: m.edges.map((e) => ({ start: e.start, end: e.end })),
  }));

  useComponentEditorStore.getState().loadBlocks(blocks, connections, extraMeasurements);
  useComponentEditorStore.getState().setAppearance(readAppearance(file.appearance));

  return {
    blocks: blocks.length,
    connections: connections.length,
    addedVariables,
    keptVariables,
  };
}
