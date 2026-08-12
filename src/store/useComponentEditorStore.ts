import * as THREE from "three";
import { create } from "zustand";
import {
  anchorOfPoint,
  boxSize,
  buildBoxGeometry,
  isBoxGeometry,
  localBox,
  pointOfAnchor,
  roundAnchor,
} from "../lib/blocks";
import { axisOfDirection, buildSpanSolver, spanKey, spanOfEdge } from "../lib/measure";
import { resolveVariables } from "../lib/formula";
import { useVariablesStore } from "./useVariablesStore";
import type { GrainAxis } from "../lib/wood";

/**
 * The component editor's state, and the layout arithmetic that goes with it.
 *
 * The model is: a list of **meshes** (parts), a list of **connections** (joints)
 * and a list of **measurements** (formulas attached to edges). Everything else
 * is derived:
 *
 * - a mesh's `offset` is a pure function of (meshes, connections) — `applyOffsets`
 * - a mesh's size formulas are a pure function of (meshes, measurements) —
 *   `deriveBlocks`
 * - which parts are one subcomponent is a pure function of the same two lists —
 *   `meshGroups`
 *
 * Nothing that must survive a rebuild may live in `offset`; it goes into the
 * geometry (see `separateDetachedGroup`) or into a connection's anchors.
 *
 * The subscription at the bottom of the file is what makes a variable edit
 * re-cut the model. It lives here rather than in a component so that an edit
 * made on the Lamp tab applies immediately, even though the editor is not
 * mounted.
 *
 * Algorithms — connection replay, grouping, rebuild, rotation, disassembly:
 * docs/algorithms/assembly-layout.md
 * Measurement derivation: docs/algorithms/spans-and-measurements.md
 */

export type Vec3 = [number, number, number];
export type AxisIndex = 0 | 1 | 2;

export interface Edge {
  start: Vec3;
  end: Vec3;
}

export interface Measurement {
  id: string;
  formula: string; // e.g. "1/2*#innerWidth" or "#frameWidth"
  edges: Edge[];
}

// A part that is an axis-aligned box, and therefore reproducible from three
// formulas instead of from a frozen list of triangles.
export interface BlockShape {
  size: [string, string, string]; // formula per world axis
}

export interface SubMesh {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  // current translation applied by connections; [0,0,0] until connected
  offset: Vec3;
  // present when the solid is a box — the only case where the saved file can
  // stay parametric
  block?: BlockShape;
}

export interface Connection {
  id: string;
  meshA: string;
  meshB: string;
  // The joint as a coordinate local to each mesh — what the layout actually
  // uses — and as a fraction of each mesh's box, which is what survives a
  // resize and is what gets written to file.
  vertexA: Vec3;
  vertexB: Vec3;
  anchorA: Vec3;
  anchorB: Vec3;
}

export type PickMode =
  | "none"
  | "selectingEdges"
  | "selectFace"
  | "connectA"
  | "connectB";

export type ViewId = "top" | "side" | "front";

// The projections are fixed world-axis views — Top looks down +Y, Side along
// +X, Front along +Z. Re-orienting a component means rotating the model, not
// moving these cameras, so what "top" means never drifts.
export const VIEW_AXES: Record<ViewId, Vec3> = {
  top: [0, 1, 0],
  side: [1, 0, 0],
  front: [0, 0, 1],
};

export interface LoadedBlock {
  id: string;
  name: string;
  size: [string, string, string];
  // Which of the three sizes the designer actually measured. Absent on a file
  // written before the format carried it, and then it has to be guessed —
  // see `loadBlocks`.
  source?: [SizeSource, SizeSource, SizeSource];
  origin: Vec3;
}

export interface LoadedConnection {
  id: string;
  meshA: string;
  anchorA: Vec3;
  meshB: string;
  anchorB: Vec3;
}

/**
 * How a component is drawn, in the two modes that draw it at all.
 *
 * Not geometry, and deliberately kept as far from geometry as the file format
 * allows: nothing here can change a size, so nothing here can make a component
 * cut differently. It travels with the component all the same, because "walnut,
 * grain along the length" is a decision about the part in exactly the way its
 * length is, and a component that forgets it is a component somebody has to
 * dress again every time they open it.
 *
 * `texture` names a library file (or the Textures bench) rather than holding a
 * copy of the parameters — see `useTextureStore`. One texture edited on its own
 * tab therefore changes every component wearing it, which is the point.
 */
export interface Appearance {
  /** Drawn in views set to Solid. A plain hex colour. */
  solidColor: string;
  /** Library file name, `BENCH_TEXTURE`, or null for "no texture chosen". */
  texture: string | null;
  /**
   * Which of the component's own axes the grain runs along, overriding whatever
   * the texture itself says. Which way a part is cut out of the board is a
   * property of the part: the same oak is quartersawn one way in a stile and
   * the other way in a rail.
   */
  grainAxis: GrainAxis;
}

export const DEFAULT_APPEARANCE: Appearance = {
  // the blueprint fill the editor has always drawn solids in, so turning the
  // panel on changes nothing until somebody asks it to
  solidColor: "#1e4179",
  texture: null,
  grainAxis: "x",
};

interface ComponentEditorState {
  meshes: SubMesh[];

  /**
   * What the component on the bench is called — the name a save writes under.
   *
   * Set when a component is opened and when one is saved under a new name; null
   * for a bench built from STL that has never been named, which is what makes
   * "Save (overwrite)" fall back to asking for a name the first time.
   */
  documentName: string | null;

  /** What the component is made of and how it is painted. See {@link Appearance}. */
  appearance: Appearance;

  pickMode: PickMode;

  // measurements
  pendingEdges: Edge[];
  measurements: Measurement[];
  highlightedMeasurementId: string | null;

  // connections
  connections: Connection[];
  pendingConnectA: { meshId: string; vertex: Vec3 } | null;
  highlightedConnectionId: string | null;

  // hover feedback. An edge hover is a *set*: every part is a block, so the
  // four arrises stating one extent are hovered as one thing.
  hoveredEdges: Edge[];
  hoveredVertex: Vec3 | null;
  hoveredFace: { normal: Vec3; triangle: [Vec3, Vec3, Vec3] } | null;

  // accumulated model rotation, as a quaternion [x, y, z, w]. The rotation is
  // already baked into the meshes; this is kept so late uploads land in the
  // same frame and so views know to re-frame after a turn.
  modelRotation: [number, number, number, number];
  armedView: ViewId | null;

  // per-view zoom multiplier for the three projection views (1 = fit)
  orthoZoom: Record<ViewId, number>;

  // per-view pan in screen pixels (converted to world units by the view's zoom)
  viewPans: Record<ViewId, { x: number; y: number }>;

  addMesh: (geometry: THREE.BufferGeometry, fileName: string) => void;
  loadBlocks: (
    blocks: LoadedBlock[],
    connections: LoadedConnection[],
    measurements: Measurement[]
  ) => void;
  rebuildBlocks: () => void;

  startSelectingEdges: () => void;
  toggleEdges: (edges: Edge[]) => void;
  finishSelectingEdges: (formula: string) => void;
  removeMeasurement: (id: string) => void;
  setMeasurementFormula: (id: string, formula: string) => void;
  setHighlightedMeasurement: (id: string | null) => void;

  startConnection: () => void;
  pickConnectionVertex: (meshId: string, worldPoint: THREE.Vector3) => void;
  removeConnection: (id: string) => void;
  setHighlightedConnection: (id: string | null) => void;

  setHoveredEdges: (edges: Edge[]) => void;
  setHoveredVertex: (v: Vec3 | null) => void;
  setHoveredFace: (f: { normal: Vec3; triangle: [Vec3, Vec3, Vec3] } | null) => void;

  armSelectFace: (view: ViewId) => void;
  alignFaceToArmedView: (worldNormal: THREE.Vector3) => void;
  rotateAboutViewAxis: (view: ViewId, direction: 1 | -1) => void;
  zoomOrtho: (view: ViewId, factor: number) => void;
  panView: (view: ViewId, dx: number, dy: number) => void;

  setDocumentName: (name: string | null) => void;
  setAppearance: (appearance: Partial<Appearance>) => void;

  cancelPick: () => void;
  reset: () => void;
}

const IDENTITY_ROTATION: [number, number, number, number] = [0, 0, 0, 1];

const DEFAULT_VIEW_PANS: Record<ViewId, { x: number; y: number }> = {
  top: { x: 0, y: 0 },
  side: { x: 0, y: 0 },
  front: { x: 0, y: 0 },
};

const DEFAULT_ORTHO_ZOOMS: Record<ViewId, number> = { top: 1, side: 1, front: 1 };

/**
 * Whether a formula is a bare number rather than a decision. Used on load to
 * decide which block sizes come back as visible, editable measurements: a
 * literal was never a choice, so surfacing it would only be noise.
 */
export function isLiteralFormula(formula: string): boolean {
  return /^\s*-?\d+(\.\d+)?\s*$/.test(formula);
}

// A measured length as a formula string. The Number() round-trip trims trailing
// zeros, so a literal reads as `186` rather than `186.0000`.
function formatSize(value: number): string {
  return String(Number(value.toFixed(4)));
}

// `crypto.randomUUID` only exists in a secure context, and `vite --host` served
// over a LAN IP is not one — reaching for it directly there throws on the first
// upload. Ids only have to be unique within one session, so any collision-proof
// -enough string will do.
function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// World-space box of a mesh: its local geometry box moved by the offset its
// connections gave it.
export function meshWorldBox(mesh: SubMesh): THREE.Box3 {
  return localBox(mesh.geometry).translate(new THREE.Vector3(...mesh.offset));
}

// Turning the component is a real change to the model, not a camera trick: the
// rotation is baked into every mesh and into everything that references one, so
// all four views, the projections and the export see the same re-oriented
// solid. It happens about the world origin, which keeps it consistent with the
// connection replay in computeOffsets — rotating every vertex and offset by R
// leaves `offset = vertexA + offsetA - vertexB` true in the rotated frame, so
// later connection edits still reproduce exactly these positions.
function rotatedModel(state: ComponentEditorState, rotation: THREE.Quaternion) {
  const spin = (p: Vec3): Vec3 => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyQuaternion(rotation);
    return [v.x, v.y, v.z];
  };
  const spinEdge = (edge: Edge): Edge => ({ start: spin(edge.start), end: spin(edge.end) });

  const accumulated = rotation
    .clone()
    .multiply(new THREE.Quaternion(...state.modelRotation))
    .normalize();

  const meshes = state.meshes.map((mesh) => {
    // geometry is stored local to its mesh and the offset places it; both
    // rotate about the origin, so their sum rotates about the origin too
    mesh.geometry.applyQuaternion(rotation);
    mesh.geometry.computeBoundingBox();
    return { ...mesh, offset: spin(mesh.offset), block: rotatedBlock(mesh, rotation) };
  });

  const boxes = new Map(meshes.map((mesh) => [mesh.id, localBox(mesh.geometry)]));
  const reanchor = (meshId: string, vertex: Vec3) => {
    const spun = spin(vertex);
    const box = boxes.get(meshId);
    return { vertex: spun, anchor: box ? anchorOfPoint(spun, box) : ([0, 0, 0] as Vec3) };
  };

  return {
    meshes,
    connections: state.connections.map((c) => {
      const a = reanchor(c.meshA, c.vertexA);
      const b = reanchor(c.meshB, c.vertexB);
      return { ...c, vertexA: a.vertex, anchorA: a.anchor, vertexB: b.vertex, anchorB: b.anchor };
    }),
    measurements: state.measurements.map((m) => ({ ...m, edges: m.edges.map(spinEdge) })),
    pendingEdges: state.pendingEdges.map(spinEdge),
    pendingConnectA: state.pendingConnectA
      ? { ...state.pendingConnectA, vertex: spin(state.pendingConnectA.vertex) }
      : null,
    modelRotation: accumulated.toArray() as [number, number, number, number],
    // a turn changes what each projection has to fit, so they all re-fit
    orthoZoom: DEFAULT_ORTHO_ZOOMS,
    viewPans: DEFAULT_VIEW_PANS,
    // hover cues were computed against the old orientation
    hoveredEdges: [],
    hoveredVertex: null,
    hoveredFace: null,
  };
}

// Which world axis an axis ends up on after a turn. Null when the rotation is
// not a quarter turn, in which case the box's sizes no longer line up with the
// world axes at all.
function rotatedAxis(axis: AxisIndex, rotation: THREE.Quaternion): AxisIndex | null {
  const direction = new THREE.Vector3();
  direction.setComponent(axis, 1);
  const mapped = axisOfDirection(direction.applyQuaternion(rotation).normalize());
  return mapped ? mapped.index : null;
}

// A block's sizes are stated per world axis, so a quarter turn permutes them.
// Anything else leaves the solid no longer box-shaped in world terms, and it
// stops being a block.
function rotatedBlock(mesh: SubMesh, rotation: THREE.Quaternion): BlockShape | undefined {
  if (!mesh.block) return undefined;
  const size: [string, string, string] = ["0", "0", "0"];
  for (let axis = 0; axis < 3; axis++) {
    const to = rotatedAxis(axis as AxisIndex, rotation);
    if (to === null) return undefined;
    size[to] = mesh.block.size[axis];
  }
  return { size };
}

/** React key / dedupe key for an edge. Orientation-independent by construction. */
export function edgeKey(edge: Edge): string {
  const r = (v: Vec3) => v.map((n) => n.toFixed(4)).join(",");
  const a = r(edge.start);
  const b = r(edge.end);
  // orientation-independent: same key regardless of pick direction
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Connections are a translation chain: replaying them in creation order from
// zero offsets gives every mesh its current position. Deleting a connection
// and replaying the rest is what makes delete "revert" cleanly.
//
// Meshes joined by an earlier connection move as one rigid body, so a new
// connection translates every mesh in meshB's group by the same delta —
// moving meshB alone would leave its earlier partners behind and the already
// joined solid would visibly split apart.
//
// Groups are shared array references, so the "already joined" test is an O(1)
// identity comparison. Worst case O(C*N): each connection may translate every
// mesh. `pickConnectionVertex` refuses a connection whose two ends are already
// in the same group, so the connection set is always a forest and replay is
// well defined — there is never a second path demanding a conflicting position.
function computeOffsets(meshes: SubMesh[], connections: Connection[]): Map<string, Vec3> {
  const offsets = new Map<string, Vec3>();
  const groups = new Map<string, string[]>();
  for (const mesh of meshes) {
    offsets.set(mesh.id, [0, 0, 0]);
    groups.set(mesh.id, [mesh.id]);
  }
  for (const c of connections) {
    const oa = offsets.get(c.meshA);
    const ob = offsets.get(c.meshB);
    if (!oa || !ob) continue;
    const groupA = groups.get(c.meshA)!;
    const groupB = groups.get(c.meshB)!;
    if (groupA === groupB) continue; // already joined — nothing left to move
    // bring meshB's picked vertex onto meshA's picked vertex, in world space
    const delta: Vec3 = [
      c.vertexA[0] + oa[0] - (c.vertexB[0] + ob[0]),
      c.vertexA[1] + oa[1] - (c.vertexB[1] + ob[1]),
      c.vertexA[2] + oa[2] - (c.vertexB[2] + ob[2]),
    ];
    for (const id of groupB) {
      const o = offsets.get(id)!;
      offsets.set(id, [o[0] + delta[0], o[1] + delta[1], o[2] + delta[2]]);
    }
    const merged = [...groupA, ...groupB];
    for (const id of merged) groups.set(id, merged);
  }
  return offsets;
}

// The whole layout, recomputed from scratch. This is why deleting a connection
// and replaying the rest is a complete implementation of "revert its effect".
function applyOffsets(meshes: SubMesh[], connections: Connection[]): SubMesh[] {
  const offsets = computeOffsets(meshes, connections);
  return meshes.map((mesh) => ({ ...mesh, offset: offsets.get(mesh.id) ?? [0, 0, 0] }));
}

// How far apart a deleted connection leaves the two halves: enough to read as a
// gap at any scale, never so little that a big assembly looks like it is still
// touching.
const SEPARATION_FRACTION = 0.08;
const MIN_SEPARATION_MM = 2;

// Deleting a connection takes the assembly apart, so the freed half has to move
// out of the other one — the parts were placed *because* of that connection and
// without it they would sit inside each other, which reads as nothing having
// happened. It slides along whichever world axis it has the least distance to
// travel to clear, which for a part butted end-to-end is straight off the end.
//
// Returns null when the deletion did not actually split anything (another
// connection still holds the two together).
function separateDetachedGroup(
  meshes: SubMesh[],
  connections: Connection[],
  removed: Connection
): { meshes: SubMesh[]; connections: Connection[] } | null {
  const groups = meshGroups(meshes, connections);
  const groupA = groups.get(removed.meshA);
  const groupB = groups.get(removed.meshB);
  if (groupA === undefined || groupB === undefined || groupA === groupB) return null;

  const placed = applyOffsets(meshes, connections);
  const boxA = new THREE.Box3();
  const boxB = new THREE.Box3();
  const overall = new THREE.Box3();
  for (const mesh of placed) {
    const box = meshWorldBox(mesh);
    overall.union(box);
    const group = groups.get(mesh.id);
    if (group === groupA) boxA.union(box);
    else if (group === groupB) boxB.union(box);
  }
  if (boxA.isEmpty() || boxB.isEmpty()) return null;

  const gap = Math.max(
    MIN_SEPARATION_MM,
    Math.max(...overall.getSize(new THREE.Vector3()).toArray()) * SEPARATION_FRACTION
  );

  // the axis to slide along is the one the two halves have the least of each
  // other to get past — for parts butted end to end, straight off the end
  const overlapOn = (a: number) =>
    Math.max(
      0,
      Math.min(boxA.max.getComponent(a), boxB.max.getComponent(a)) -
        Math.max(boxA.min.getComponent(a), boxB.min.getComponent(a))
    );
  let axis = 0;
  for (let a = 1; a < 3; a++) if (overlapOn(a) < overlapOn(axis)) axis = a;
  const centreA = boxA.getCenter(new THREE.Vector3()).getComponent(axis);
  const centreB = boxB.getCenter(new THREE.Vector3()).getComponent(axis);
  const sign = centreB >= centreA ? 1 : -1;

  // far enough to clear everything it would otherwise slide into, not just the
  // half it was joined to: after a second deletion the freed part would
  // otherwise come to rest inside a third one that was already standing apart
  let push = gap;
  for (const mesh of placed) {
    if (groups.get(mesh.id) === groupB) continue;
    const box = meshWorldBox(mesh);
    const clearsAlready = [0, 1, 2].some(
      (a) =>
        a !== axis &&
        Math.min(box.max.getComponent(a), boxB.max.getComponent(a)) -
          Math.max(box.min.getComponent(a), boxB.min.getComponent(a)) <=
          1e-6
    );
    if (clearsAlready) continue; // misses it on another axis whatever we do here
    const needed =
      sign > 0
        ? box.max.getComponent(axis) + gap - boxB.min.getComponent(axis)
        : boxB.max.getComponent(axis) - (box.min.getComponent(axis) - gap);
    push = Math.max(push, needed);
  }

  const delta: Vec3 = [0, 0, 0];
  delta[axis] = sign * push;

  // The gap goes into the freed meshes' own geometry, not into their offsets:
  // offsets are recomputed from the connections on every later edit and would
  // wipe it out. Connection vertices are stated in that same local frame, so
  // they travel with the geometry and the remaining joints still hold.
  const moved = placed.map((mesh) => {
    if (groups.get(mesh.id) !== groupB) return mesh;
    const geometry = mesh.geometry.clone();
    geometry.translate(delta[0], delta[1], delta[2]);
    geometry.computeBoundingBox();
    mesh.geometry.dispose();
    return { ...mesh, geometry };
  });

  const shift = (v: Vec3): Vec3 => [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]];
  const shifted = connections.map((c) => ({
    ...c,
    vertexA: groups.get(c.meshA) === groupB ? shift(c.vertexA) : c.vertexA,
    vertexB: groups.get(c.meshB) === groupB ? shift(c.vertexB) : c.vertexB,
  }));

  return { meshes: moved, connections: shifted };
}

/**
 * Which subcomponent each mesh belongs to.
 *
 * Connections JOIN subcomponents: once connected, two meshes are one
 * subcomponent. Groups are the connected components of the mesh/connection
 * graph; the number of groups is how many separate subcomponents remain.
 *
 * Union-find with path halving in `find`, ~O(N + C). Group *indices* are handed
 * out in mesh order, so they are stable and comparable across calls with the
 * same inputs.
 */
export function meshGroups(meshes: SubMesh[], connections: Connection[]): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const mesh of meshes) parent.set(mesh.id, mesh.id);
  for (const c of connections) {
    if (!parent.has(c.meshA) || !parent.has(c.meshB)) continue;
    parent.set(find(c.meshA), find(c.meshB));
  }
  const groups = new Map<string, number>();
  const indices = new Map<string, number>();
  for (const mesh of meshes) {
    const root = find(mesh.id);
    if (!indices.has(root)) indices.set(root, indices.size);
    groups.set(mesh.id, indices.get(root)!);
  }
  return groups;
}

/**
 * How many separate subcomponents remain. The UI gates on this: measuring needs
 * exactly 1 (the assembly is one solid), connecting needs at least 2.
 */
export function subcomponentCount(meshes: SubMesh[], connections: Connection[]): number {
  return new Set(meshGroups(meshes, connections).values()).size;
}

/** World position of the point a connection made common between its two meshes. */
export function connectionWorldPoint(connection: Connection, meshes: SubMesh[]): Vec3 | null {
  const meshA = meshes.find((m) => m.id === connection.meshA);
  if (!meshA) return null;
  return [
    connection.vertexA[0] + meshA.offset[0],
    connection.vertexA[1] + meshA.offset[1],
    connection.vertexA[2] + meshA.offset[2],
  ];
}

/**
 * Where a block's size formula came from — the three tiers of `deriveBlocks`,
 * kept apart because only the first is a decision the designer made.
 *
 * - **set**     — the designer measured this very span
 * - **implied** — nobody measured it; the solver chained to it from ones that
 *                 were measured, and the formula is that chain written out
 * - **literal** — nothing determines it, so it is the number the solid was
 *                 drawn at
 *
 * The distinction is invisible while designing (the formula is the same either
 * way) and load-bearing when saving: a file that forgets it comes back with
 * every implied size re-surfaced as a measurement, i.e. with the whole drawing
 * green — see `loadBlocks`.
 */
export type SizeSource = "set" | "implied" | "literal";

export interface BlockBinding {
  size: [string, string, string];
  source: [SizeSource, SizeSource, SizeSource];
  // where this block's three extents sit on the world axes, so an edge picked
  // on one of them can be found again after the block is re-cut
  spanKeys: [string, string, string];
}

/**
 * What each block's three sizes are *in terms of the design variables*.
 *
 * A size is whatever the user measured that span as; failing that, whatever the
 * chain of measurements implies it must be; failing that, the number the solid
 * was drawn at:
 *
 *     size[axis] = solver.known[span]  ??  solver.imply(span)  ??  literal
 *
 * This is the whole content of the saved file, and it is also what makes the
 * editor's model respond to a variable while it is being designed — so the two
 * can never disagree.
 *
 * `source` says which of the three tiers each formula came out of. The value is
 * the same either way; what differs is whether it records a decision, and that
 * is exactly what a saved file must not lose.
 *
 * `spanKeys` comes back alongside so `rebuildBlocks` can work out which block
 * extent a measured span referred to, and move that measurement's edges onto
 * the re-cut part.
 *
 * Non-box meshes are skipped: they have no parametric description.
 */
export function deriveBlocks(
  meshes: SubMesh[],
  measurements: Measurement[]
): Map<string, BlockBinding> {
  const spans = [];
  const seen = new Set<string>();
  for (const measurement of measurements) {
    for (const edge of measurement.edges) {
      const span = spanOfEdge(edge);
      if (!span) continue;
      const key = spanKey(span);
      if (seen.has(key)) continue;
      seen.add(key);
      spans.push({ ...span, formula: measurement.formula });
    }
  }
  const solver = buildSpanSolver(spans);

  const out = new Map<string, BlockBinding>();
  for (const mesh of meshes) {
    if (!mesh.block) continue;
    const box = meshWorldBox(mesh);
    const size = boxSize(box);
    const formulas: [string, string, string] = ["0", "0", "0"];
    const sources: [SizeSource, SizeSource, SizeSource] = ["literal", "literal", "literal"];
    const keys: [string, string, string] = ["", "", ""];
    for (let axis = 0; axis < 3; axis++) {
      const span = {
        axis: axis as AxisIndex,
        a: box.min.getComponent(axis),
        b: box.max.getComponent(axis),
      };
      keys[axis] = spanKey(span);
      const set = solver.known.get(keys[axis]);
      const implied = set === undefined ? solver.imply(span) : null;
      formulas[axis] = set ?? implied ?? formatSize(size[axis]);
      sources[axis] = set !== undefined ? "set" : implied !== null ? "implied" : "literal";
    }
    out.set(mesh.id, { size: formulas, source: sources, spanKeys: keys });
  }
  return out;
}

// An edge that measures a block's extent, moved onto the re-cut block. It keeps
// the corner it was picked at — a value read off the top-front arris stays on
// the top-front arris — so only its length changes.
function movedEdge(edge: Edge, axis: AxisIndex, from: THREE.Box3, to: THREE.Box3): Edge {
  const fromSize = boxSize(from);
  const toSize = boxSize(to);
  const start: Vec3 = [0, 0, 0];
  const end: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    if (a === axis) {
      start[a] = to.min.getComponent(a);
      end[a] = to.max.getComponent(a);
      continue;
    }
    const extent = fromSize[a];
    const fraction =
      extent < 1e-9 ? 0 : (edge.start[a] - from.min.getComponent(a)) / extent;
    start[a] = to.min.getComponent(a) + fraction * toSize[a];
    end[a] = start[a];
  }
  return { start, end };
}

// Evaluate several formulas against one scope in a single resolver pass, by
// injecting them under reserved keys. Returns null if any of them throws, so a
// half-typed formula leaves the block at its previous size rather than
// collapsing it.
function evaluateAll(
  formulas: string[],
  raw: Record<string, string>
): number[] | null {
  const scope: Record<string, string> = { ...raw };
  formulas.forEach((f, i) => {
    scope[`__size${i}`] = f;
  });
  try {
    const resolved = resolveVariables(scope);
    return formulas.map((_, i) => resolved[`__size${i}`]);
  } catch {
    return null;
  }
}

// The edge a block-size measurement hangs off: along the measured axis, on the
// block's low corner in the other two. Regenerated after every rebuild so the
// value stays on the part instead of floating where it was first picked.
function blockSizeEdge(mesh: SubMesh, axis: AxisIndex): Edge {
  const box = meshWorldBox(mesh);
  const start: Vec3 = [box.min.x, box.min.y, box.min.z];
  const end: Vec3 = [box.min.x, box.min.y, box.min.z];
  end[axis] = box.max.getComponent(axis);
  return { start, end };
}

export const useComponentEditorStore = create<ComponentEditorState>((set, get) => ({
  meshes: [],
  documentName: null,
  appearance: DEFAULT_APPEARANCE,

  pickMode: "none",

  pendingEdges: [],
  measurements: [],
  highlightedMeasurementId: null,

  connections: [],
  pendingConnectA: null,
  highlightedConnectionId: null,

  hoveredEdges: [],
  hoveredVertex: null,
  hoveredFace: null,

  modelRotation: IDENTITY_ROTATION,
  armedView: null,
  orthoZoom: DEFAULT_ORTHO_ZOOMS,
  viewPans: DEFAULT_VIEW_PANS,

  addMesh: (geometry, fileName) =>
    set((state) => {
      // a solid uploaded after the component has been turned arrives in raw STL
      // coordinates; bring it into the same frame as the meshes already loaded
      geometry.applyQuaternion(new THREE.Quaternion(...state.modelRotation));
      geometry.computeBoundingBox();
      // a box can be saved as three formulas; anything else can only be saved
      // as the shape it currently has
      const size = boxSize(localBox(geometry));
      const block: BlockShape | undefined = isBoxGeometry(geometry)
        ? { size: size.map(formatSize) as [string, string, string] }
        : undefined;
      return {
        meshes: [
          ...state.meshes,
          { id: newId(), name: fileName, geometry, offset: [0, 0, 0], block },
        ],
        pickMode: "none",
        // a new solid changes what has to fit, so each projection goes back to
        // its own fit-to-view zoom rather than keeping a zoom chosen for the
        // previous contents
        orthoZoom: DEFAULT_ORTHO_ZOOMS,
        viewPans: DEFAULT_VIEW_PANS,
      };
    }),

  // Rebuild a saved component: every part is a box stated in formulas, so it
  // comes back at whatever the variables say *now*, not at the sizes it had
  // when it was saved. The measurements come back with it, so the loaded
  // component is as editable as one built from scratch.
  //
  //   1. dispose the bench          — a load replaces, it does not add
  //   2. evaluate each block's size formulas at the current variables and
  //      build a box, placed at the block's saved origin
  //   3. turn each connection's anchors back into coordinates on those boxes
  //   4. applyOffsets — the connections decide the real layout, so the origins
  //      only matter for a part no connection reaches
  //   5. re-surface every block size the designer SET as a visible measurement;
  //      an implied one is left to the solver to derive again
  loadBlocks: (blocks, loadedConnections, loadedMeasurements) => {
    // a load replaces whatever was on the bench — the incoming component is a
    // whole component, not something to add to the current one
    for (const mesh of get().meshes) mesh.geometry.dispose();
    const raw = useVariablesStore.getState().raw;
    const meshes: SubMesh[] = [];
    for (const block of blocks) {
      // Same guard as rebuildBlocks: a formula can resolve without throwing and
      // still give NaN (1/0-1/0) or a negative. buildBoxGeometry's Math.max
      // floor does not catch NaN, and a NaN box poisons every bounding box,
      // station and projection downstream — so fall back to a visible unit cube
      // the designer can see is wrong.
      const evaluated = evaluateAll(block.size, raw);
      const sizes =
        evaluated && evaluated.every((s) => Number.isFinite(s) && s > 0)
          ? evaluated
          : [1, 1, 1];
      const geometry = buildBoxGeometry(sizes as Vec3);
      geometry.translate(...block.origin);
      geometry.computeBoundingBox();
      meshes.push({
        id: block.id,
        name: block.name,
        geometry,
        offset: [0, 0, 0],
        block: { size: block.size },
      });
    }

    const boxes = new Map(meshes.map((m) => [m.id, localBox(m.geometry)]));
    const connections: Connection[] = [];
    for (const c of loadedConnections) {
      const boxA = boxes.get(c.meshA);
      const boxB = boxes.get(c.meshB);
      if (!boxA || !boxB) continue;
      connections.push({
        id: c.id,
        meshA: c.meshA,
        meshB: c.meshB,
        anchorA: c.anchorA,
        anchorB: c.anchorB,
        vertexA: pointOfAnchor(c.anchorA, boxA),
        vertexB: pointOfAnchor(c.anchorB, boxB),
      });
    }

    const placed = applyOffsets(meshes, connections);

    // Only the sizes the designer *set* come back as measurements. An implied
    // size is not a decision — it is what the decisions already say — and once
    // the component is on the bench the span solver derives it again from them,
    // so it reads as implied exactly as it did before the save. Re-surfacing it
    // as a measurement instead claims the designer set it, which is what turned
    // a loaded component green from end to end.
    //
    // A file written before the format carried `source` cannot say which was
    // which, so it keeps the old guess: anything that is not a bare number was
    // a decision.
    const measurements: Measurement[] = [...loadedMeasurements];
    const stated = new Set<string>();
    for (const measurement of measurements) {
      for (const edge of measurement.edges) {
        const span = spanOfEdge(edge);
        if (span) stated.add(spanKey(span));
      }
    }
    const placedById = new Map(placed.map((mesh) => [mesh.id, mesh]));
    for (const block of blocks) {
      const mesh = placedById.get(block.id);
      if (!mesh) continue;
      const source =
        block.source ??
        (block.size.map((formula) =>
          isLiteralFormula(formula) ? "literal" : "set"
        ) as [SizeSource, SizeSource, SizeSource]);
      for (let axis = 0; axis < 3; axis++) {
        if (source[axis] !== "set") continue;
        const edge = blockSizeEdge(mesh, axis as AxisIndex);
        // one span is one measurement, here as everywhere else: two identical
        // parts side by side share an extent, and a cross-assembly measurement
        // can land on one, so a span already stated is not stated again
        const span = spanOfEdge(edge);
        const key = span ? spanKey(span) : null;
        if (key !== null) {
          if (stated.has(key)) continue;
          stated.add(key);
        }
        measurements.push({ id: newId(), formula: block.size[axis], edges: [edge] });
      }
    }

    set({
      meshes: placed,
      connections,
      measurements,
      pickMode: "none",
      pendingEdges: [],
      pendingConnectA: null,
      highlightedMeasurementId: null,
      highlightedConnectionId: null,
      hoveredEdges: [],
      hoveredVertex: null,
      hoveredFace: null,
      modelRotation: IDENTITY_ROTATION,
      armedView: null,
      orthoZoom: DEFAULT_ORTHO_ZOOMS,
      viewPans: DEFAULT_VIEW_PANS,
    });

    // The blocks above were cut at the sizes the *file* states. Those sizes are
    // a snapshot; the measurements are the decisions, and a measurement can say
    // something the snapshot does not — a span the designer set to #beamHeight
    // while the solid was still drawn at the height it came in at. So the load
    // finishes by re-deriving every size from the measurements at the current
    // variable values, exactly as a variable edit does. A file that already
    // agrees with itself passes through untouched: rebuildBlocks no-ops when no
    // size changes.
    get().rebuildBlocks();
  },

  // Re-cut every block at the current variable values and re-lay the assembly.
  // No-ops when nothing moved, so it is safe to call on every variable edit.
  //
  //   1. deriveBlocks               — the size formulas, from the measurements
  //   2. record which block extent each measured span refers to, against the
  //      CURRENT layout (after the re-cut those coordinates are gone)
  //   3. re-cut each block that changed, growing from its own low corner;
  //      reject sizes that are not finite and positive
  //   4. bail out early if only the formulas changed and no size did
  //   5. re-derive connection vertices from their anchors on the new boxes
  //   6. applyOffsets — the connections re-decide where everything sits
  //   7. move each block-extent measurement onto its re-cut part; leave skew
  //      edges and cross-assembly spans where they were picked
  rebuildBlocks: () => {
    const state = get();
    if (state.meshes.length === 0) return;
    const raw = useVariablesStore.getState().raw;
    const bindings = deriveBlocks(state.meshes, state.measurements);

    // Where every part sits *now*. Read before the re-cut, because a block that
    // changes size has its old geometry disposed on the way through.
    const beforeBoxes = new Map(state.meshes.map((m) => [m.id, meshWorldBox(m)] as const));

    // Which block extent each measured span refers to, recorded against the
    // *current* layout — after the re-cut those coordinates no longer exist.
    //
    // A key can have SEVERAL owners, and that is the normal case rather than a
    // corner one: two identical stiles standing side by side have the very same
    // extent on two of the three axes, and a measurement covering that span is
    // held by the four arrises of each of them. Keeping only the first owner
    // sent the other block's edges through `movedEdge` against a box they are
    // nowhere near — the cross-axis fraction then comes out far outside [0, 1]
    // and those edges land off in space, which is what made half a measurement
    // vanish off the part the moment its formula changed a size.
    interface SpanOwner {
      meshId: string;
      axis: AxisIndex;
      from: THREE.Box3;
    }
    const owners = new Map<string, SpanOwner[]>();
    for (const [meshId, binding] of bindings) {
      const from = beforeBoxes.get(meshId);
      if (!from) continue;
      binding.spanKeys.forEach((key, axis) => {
        const list = owners.get(key);
        const owner: SpanOwner = { meshId, axis: axis as AxisIndex, from };
        if (list) list.push(owner);
        else owners.set(key, [owner]);
      });
    }

    // Of the blocks stating this span, the one the edge is actually an arris of
    // — by distance from the edge's midpoint, which is zero for the block it
    // belongs to and at least the gap between parts for any other.
    const ownerOfEdge = (edge: Edge, candidates: SpanOwner[]): SpanOwner => {
      if (candidates.length === 1) return candidates[0];
      const mid = new THREE.Vector3(
        (edge.start[0] + edge.end[0]) / 2,
        (edge.start[1] + edge.end[1]) / 2,
        (edge.start[2] + edge.end[2]) / 2
      );
      let best = candidates[0];
      let bestDistance = Infinity;
      for (const candidate of candidates) {
        const distance = candidate.from.distanceToPoint(mid);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      return best;
    };

    let changed = false;
    const meshes = state.meshes.map((mesh) => {
      const binding = bindings.get(mesh.id);
      if (!mesh.block || !binding) return mesh;
      const sizes = evaluateAll(binding.size, raw);
      if (!sizes || sizes.some((s) => !Number.isFinite(s) || s <= 0)) return mesh;
      const box = localBox(mesh.geometry);
      const current = boxSize(box);
      const sameSize = sizes.every((s, i) => Math.abs(s - current[i]) < 1e-6);
      const sameFormulas = mesh.block.size.every((f, i) => f === binding.size[i]);
      if (sameSize && sameFormulas) return mesh;
      if (!sameSize) changed = true;
      if (sameSize) return { ...mesh, block: { size: binding.size } };
      // a block grows away from its own low corner; where it ends up in the
      // assembly is then re-decided by its connections
      const geometry = buildBoxGeometry(sizes as Vec3);
      geometry.translate(box.min.x, box.min.y, box.min.z);
      geometry.computeBoundingBox();
      mesh.geometry.dispose();
      return { ...mesh, geometry, block: { size: binding.size } };
    });

    if (!changed) {
      const rebound = meshes.some((m, i) => m !== state.meshes[i]);
      if (rebound) set({ meshes });
      return;
    }

    const boxes = new Map(meshes.map((m) => [m.id, localBox(m.geometry)]));
    const connections = state.connections.map((c) => {
      const boxA = boxes.get(c.meshA);
      const boxB = boxes.get(c.meshB);
      return {
        ...c,
        vertexA: boxA ? pointOfAnchor(c.anchorA, boxA) : c.vertexA,
        vertexB: boxB ? pointOfAnchor(c.anchorB, boxB) : c.vertexB,
      };
    });
    const placed = applyOffsets(meshes, connections);

    const byId = new Map(placed.map((m) => [m.id, m]));

    // Where every block face has moved to, per axis.
    //
    // A measurement that no single block owns — the overall width of an
    // assembly, the distance from one part's outside to another's, a chamfer
    // between two parts — still has both its ends ON block faces, and those
    // faces move when the blocks are re-cut. Leaving such an edge alone kept it
    // at coordinates the model no longer has anywhere: the value stayed in the
    // list but stopped naming anything on the part, so the span it used to
    // state went back to reading as unmeasured (red) the moment some *other*
    // measurement changed a size.
    //
    // Faces are keyed at the same 0.01 mm as stations, so a coordinate two
    // butted parts share resolves to the one place they both move to.
    const faceKey = (c: number) => c.toFixed(2);
    const movedFaces: Array<Map<string, number>> = [new Map(), new Map(), new Map()];
    for (const [meshId, from] of beforeBoxes) {
      const mesh = byId.get(meshId);
      if (!mesh) continue;
      const to = meshWorldBox(mesh);
      for (let axis = 0; axis < 3; axis++) {
        for (const side of ["min", "max"] as const) {
          const key = faceKey(from[side].getComponent(axis));
          if (!movedFaces[axis].has(key)) movedFaces[axis].set(key, to[side].getComponent(axis));
        }
      }
    }
    // A coordinate that is on no face is left where it is — an edge picked
    // part-way along a face has nothing to follow.
    const followFaces = (edge: Edge): Edge => {
      const follow = (p: Vec3): Vec3 =>
        [0, 1, 2].map((axis) => movedFaces[axis].get(faceKey(p[axis])) ?? p[axis]) as Vec3;
      return { start: follow(edge.start), end: follow(edge.end) };
    };

    // A measurement that names a block extent follows that block, which also
    // carries an edge picked part-way across the face it lies on; anything else
    // follows the faces its ends sit on.
    const measurements = state.measurements.map((measurement) => ({
      ...measurement,
      edges: measurement.edges.map((edge) => {
        const span = spanOfEdge(edge);
        if (!span) return followFaces(edge);
        const candidates = owners.get(spanKey(span));
        if (!candidates || candidates.length === 0) return followFaces(edge);
        const owner = ownerOfEdge(edge, candidates);
        const mesh = byId.get(owner.meshId);
        if (!mesh) return followFaces(edge);
        return movedEdge(edge, owner.axis, owner.from, meshWorldBox(mesh));
      }),
    }));

    set({
      meshes: placed,
      connections,
      measurements,
      pendingEdges: [],
      hoveredEdges: [],
      hoveredVertex: null,
      hoveredFace: null,
    });
  },

  startSelectingEdges: () => set({ pickMode: "selectingEdges", pendingEdges: [] }),

  // A pick is a set of parallel edges, not one edge — see `parallelEdges`. They
  // all state the same span, so they go in together and come out together;
  // dropping one of the four would leave a measurement that reads as partial
  // while meaning exactly the same thing.
  toggleEdges: (edges) =>
    set((state) => {
      if (state.pickMode !== "selectingEdges" || edges.length === 0) return state;
      const keys = edges.map(edgeKey);
      const selected = new Set(state.pendingEdges.map(edgeKey));
      if (keys.every((key) => selected.has(key))) {
        const drop = new Set(keys);
        return { pendingEdges: state.pendingEdges.filter((e) => !drop.has(edgeKey(e))) };
      }
      return {
        pendingEdges: [...state.pendingEdges, ...edges.filter((e) => !selected.has(edgeKey(e)))],
      };
    }),

  finishSelectingEdges: (formula) => {
    set((state) => {
      if (state.pendingEdges.length === 0) return { pickMode: "none", pendingEdges: [] };
      const measurement: Measurement = {
        id: newId(),
        formula,
        edges: state.pendingEdges,
      };
      return {
        measurements: [...state.measurements, measurement],
        pendingEdges: [],
        pickMode: "none",
      };
    });
    get().rebuildBlocks();
  },

  removeMeasurement: (id) => {
    set((state) => ({
      measurements: state.measurements.filter((m) => m.id !== id),
      highlightedMeasurementId:
        state.highlightedMeasurementId === id ? null : state.highlightedMeasurementId,
    }));
    get().rebuildBlocks();
  },

  setMeasurementFormula: (id, formula) => {
    set((state) => ({
      measurements: state.measurements.map((m) => (m.id === id ? { ...m, formula } : m)),
    }));
    get().rebuildBlocks();
  },

  setHighlightedMeasurement: (id) => set({ highlightedMeasurementId: id }),

  startConnection: () => set({ pickMode: "connectA", pendingConnectA: null }),

  pickConnectionVertex: (meshId, worldPoint) => {
    const state = get();
    const mesh = state.meshes.find((m) => m.id === meshId);
    if (!mesh) return;
    const local: Vec3 = [
      worldPoint.x - mesh.offset[0],
      worldPoint.y - mesh.offset[1],
      worldPoint.z - mesh.offset[2],
    ];
    if (state.pickMode === "connectA") {
      set({ pendingConnectA: { meshId, vertex: local }, pickMode: "connectB" });
    } else if (state.pickMode === "connectB" && state.pendingConnectA) {
      // a connection joins two separate subcomponents — meshes already joined
      // (directly or through a chain) count as one and can't be re-connected
      const groups = meshGroups(state.meshes, state.connections);
      if (groups.get(state.pendingConnectA.meshId) === groups.get(meshId)) return;
      const meshA = state.meshes.find((m) => m.id === state.pendingConnectA!.meshId);
      if (!meshA) return;
      const connection: Connection = {
        id: newId(),
        meshA: state.pendingConnectA.meshId,
        meshB: meshId,
        vertexA: state.pendingConnectA.vertex,
        vertexB: local,
        // The same two points as fractions of their boxes, so the joint holds
        // when the parts are rebuilt at other variable values. Snapped, because
        // a corner picked off a mesh lands a hair off 0 or 1 and an anchor of
        // 0.99998 would creep along the face every time the part is re-cut.
        anchorA: roundAnchor(anchorOfPoint(state.pendingConnectA.vertex, localBox(meshA.geometry))),
        anchorB: roundAnchor(anchorOfPoint(local, localBox(mesh.geometry))),
      };
      const connections = [...state.connections, connection];
      set({
        connections,
        meshes: applyOffsets(state.meshes, connections),
        pendingConnectA: null,
        pickMode: "none",
        hoveredVertex: null,
      });
    }
  },

  removeConnection: (id) =>
    set((state) => {
      const removed = state.connections.find((c) => c.id === id);
      const remaining = state.connections.filter((c) => c.id !== id);
      // measurements only make sense on the fully joined solid — if this
      // deletion splits the assembly back apart, they disappear with it
      const stillOneSolid = subcomponentCount(state.meshes, remaining) <= 1;
      const separated = removed
        ? separateDetachedGroup(state.meshes, remaining, removed)
        : null;
      return {
        connections: separated?.connections ?? remaining,
        meshes: separated?.meshes ?? applyOffsets(state.meshes, remaining),
        measurements: stillOneSolid ? state.measurements : [],
        highlightedMeasurementId: stillOneSolid ? state.highlightedMeasurementId : null,
        pendingEdges: stillOneSolid ? state.pendingEdges : [],
        // a half that just moved makes any half-finished vertex pick stale
        pendingConnectA: separated ? null : state.pendingConnectA,
        pickMode: separated && state.pickMode === "connectB" ? "none" : state.pickMode,
        highlightedConnectionId:
          state.highlightedConnectionId === id ? null : state.highlightedConnectionId,
      };
    }),

  setHighlightedConnection: (id) => set({ highlightedConnectionId: id }),

  setHoveredEdges: (edges) => set({ hoveredEdges: edges }),
  setHoveredVertex: (v) => set({ hoveredVertex: v }),
  setHoveredFace: (f) => set({ hoveredFace: f }),

  armSelectFace: (view) => set({ pickMode: "selectFace", armedView: view }),

  // Picking a face for a view turns the model until that face points along the
  // view's axis — pick a face in Top and it ends up facing +Y.
  alignFaceToArmedView: (worldNormal) => {
    const state = get();
    if (state.pickMode !== "selectFace" || !state.armedView) return;
    const target = new THREE.Vector3(...VIEW_AXES[state.armedView]);
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      worldNormal.clone().normalize(),
      target
    );
    set({
      ...rotatedModel(state, rotation),
      pickMode: "none",
      armedView: null,
    });
  },

  // Quarter turn of the model about the view's own axis: the buttons in Top
  // spin it about Y, so the other three views show the turn too. `direction`
  // 1 is clockwise as seen looking down that axis, which is negative rotation
  // under the right-hand rule.
  rotateAboutViewAxis: (view, direction) =>
    set((state) => {
      if (state.meshes.length === 0) return state;
      const axis = new THREE.Vector3(...VIEW_AXES[view]);
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        axis,
        (-direction * Math.PI) / 2
      );
      return rotatedModel(state, rotation);
    }),

  zoomOrtho: (view, factor) =>
    set((state) => ({
      orthoZoom: {
        ...state.orthoZoom,
        [view]: Math.min(50, Math.max(0.05, state.orthoZoom[view] * factor)),
      },
    })),

  panView: (view, dx, dy) =>
    set((state) => ({
      viewPans: {
        ...state.viewPans,
        [view]: { x: state.viewPans[view].x + dx, y: state.viewPans[view].y + dy },
      },
    })),

  setDocumentName: (name) => set({ documentName: name }),

  cancelPick: () =>
    set({
      pickMode: "none",
      armedView: null,
      pendingEdges: [],
      pendingConnectA: null,
      hoveredEdges: [],
      hoveredVertex: null,
      hoveredFace: null,
    }),

  setAppearance: (appearance) =>
    set((state) => ({ appearance: { ...state.appearance, ...appearance } })),

  reset: () => {
    for (const mesh of get().meshes) mesh.geometry.dispose();
    set({
      meshes: [],
      documentName: null,
      // Clear too: the bench is being emptied, and a fresh component inheriting
      // the last one's timber is the kind of thing nobody notices until they
      // have saved six components in a wood they did not choose.
      appearance: DEFAULT_APPEARANCE,
      pickMode: "none",
      pendingEdges: [],
      measurements: [],
      highlightedMeasurementId: null,
      connections: [],
      pendingConnectA: null,
      highlightedConnectionId: null,
      hoveredEdges: [],
      hoveredVertex: null,
      hoveredFace: null,
      modelRotation: IDENTITY_ROTATION,
      armedView: null,
      orthoZoom: DEFAULT_ORTHO_ZOOMS,
      viewPans: DEFAULT_VIEW_PANS,
    });
  },
}));

// Variables drive the geometry, so a variable edit is a change to every block
// written in terms of it. Subscribing here rather than from a component means
// that holds wherever the edit was made — the Lamp tab does not have the
// component editor mounted, and switching back to it should not be what finally
// applies the change.
//
// Module-level and never unsubscribed, on purpose: both stores live as long as
// the page does, and the reference comparison plus rebuildBlocks' own early
// exit make a no-op edit cost almost nothing.
useVariablesStore.subscribe((state, previous) => {
  if (state.raw !== previous.raw) useComponentEditorStore.getState().rebuildBlocks();
});
