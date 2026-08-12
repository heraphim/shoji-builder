import * as THREE from "three";
import { create } from "zustand";
import { listLibraryComponents } from "../lib/componentFile";
import {
  anchorOnInstance,
  anchorOnMainBox,
  buildShape,
  clearDistance,
  computeScene,
  dominantAxis,
  parseComponentDef,
  targetWorldPoints,
  worldBoxOf,
  wouldCycle,
  type BoxPick,
  type LampAnchor,
  type LampComponentDef,
  type LampInstance,
  type LampScene,
  type LampTargetKind,
  type Placement,
  type Quat,
} from "../lib/lamp";
import {
  buildLampFile,
  fetchLampFile,
  listLibraryLamps,
  parseLampFile,
  toInstances,
  type LampFile,
} from "../lib/lampFile";
import { sanitizeName } from "../lib/componentFile";
import { readLibraryFile, saveLibraryFile } from "../lib/library";
import { subtreeOf, symmetryCopies } from "../lib/symmetry";
import { useVariablesStore } from "./useVariablesStore";
import type { AxisIndex, Edge, Vec3 } from "./useComponentEditorStore";

/**
 * The lamp: which components have been inserted and how each one is fixed on.
 *
 * The store holds only what cannot be derived — the instance list, each one's
 * connection anchors, and the parked position of the ones that have none. Where
 * a part actually *is* comes out of `computeScene`, recomputed from the current
 * variables on every read, so a slider drag moves the whole lamp with nothing
 * here to keep in step.
 *
 * Connecting is a five-click pick: two points on the part, one click naming what
 * it goes onto — which takes everything else out of sight — then two points on
 * that. The draft holds the four points as world coordinates while the pick is
 * in flight and converts them to anchors at the moment it commits, because a
 * coordinate is only meaningful at the variable values it was picked at.
 *
 * See docs/algorithms/lamp-assembly.md and docs/ui-guide.md.
 */

/** What a pick landed on. */
export type LampPickSource = { kind: "mainBox" } | { kind: "instance"; id: string };

/** A committed pick: where it landed, the box lines that say which one, and the
 * block whose box it was snapped to — see `LampAnchor`. */
export interface PickedPoint {
  point: Vec3;
  edges: Edge[];
  block: string | null;
}

export interface ConnectDraft {
  /** The instance being connected — the first two points must be on it. */
  instanceId: string;
  /** Picks made on the instance, then on the target. */
  source: PickedPoint[];
  target: PickedPoint[];
  /**
   * What the part is going onto, chosen by a click of its own before either of
   * its points is picked.
   *
   * That click is the whole reason this is set early. A lamp is a box with parts
   * standing inside and around it, and the two points wanted next are often on a
   * face that something else is in front of. So naming the target is a step:
   * click it once, everything else goes out of sight, and the two points can be
   * picked on a body with nothing over it. Until then this is null and any body
   * but the part itself is fair game.
   */
  targetRef: LampPickSource | null;
}

// Where a newly inserted component is parked, and how far a disconnected one
// travels, both as fractions of the main box's width. 50% clears a box-sized
// part outright; 10% is a visible nudge when something is already there.
const DISCONNECT_FRACTION = 0.5;
const CLEARANCE_STEP_FRACTION = 0.1;
const INSERT_GAP_FRACTION = 0.25;

interface LampState {
  library: string[];
  libraryError: string | null;
  /** Saved lamps in public/models/lamps, and why that listing failed. */
  lampLibrary: string[];
  lampLibraryError: string | null;
  /** The last thing that went wrong, for the panel to show. */
  error: string | null;

  /**
   * What the lamp on the bench is called — the name a save writes under.
   *
   * Set when a lamp is opened and when one is saved under a new name; null for
   * a lamp built from scratch that has never been named, which is what makes
   * "Save (overwrite)" ask for a name the first time.
   */
  lampName: string | null;

  /** What the lamp is, in prose. Saved with it; nothing else reads it. */
  description: string;

  instances: LampInstance[];
  /**
   * Components the user has taken out of sight, by id.
   *
   * Not a flag on the instance and not in the saved file: which parts you are
   * currently looking at is a way of working on a design, not part of one. A
   * lamp opened tomorrow should come back whole.
   *
   * Hiding takes a part out of the scene entirely rather than making it
   * transparent, so it stops being pickable at the same time — which is the
   * point of hiding it. Same reasoning as the isolation a connect draft does.
   */
  hiddenIds: string[];
  draft: ConnectDraft | null;
  /** What the cursor would pick, so the scene can mark it. */
  hoveredPick: PickedPoint | null;
  /** Row the pointer is over, so the scene can pick that instance out. */
  highlightedId: string | null;
  /**
   * Row whose symmetry the pointer is over, so the scene can show every place
   * that symmetry reaches. Just the id: the places themselves are derived from
   * it and the main box, and deriving beats storing for the usual reason — a
   * stored place would be a millimetre fact that a variable edit invalidates.
   */
  symmetryPreview: string | null;

  loadLibrary: () => Promise<void>;
  loadLampLibrary: () => Promise<void>;
  /**
   * The lamp as the file it would be written as, or null on an empty bench.
   *
   * Where that file then goes is the caller's business — the library or the
   * user's downloads — which is the whole reason it is separate from
   * {@link LampState.saveLamp}. Naming the lamp is *saving's* business too: this
   * one settles what the file is called without claiming the bench is now called
   * that, because a download is a copy taken out rather than a design filed.
   */
  toFile: (name?: string) => { id: string; data: LampFile } | null;
  saveLamp: (name?: string) => Promise<string | null>;
  loadLamp: (file: string) => Promise<void>;
  /** Open a `*.lamp.json` the user picked off their own disk. */
  openLampFile: (data: unknown, name: string) => Promise<void>;
  insertComponent: (file: string) => Promise<void>;
  removeInstance: (id: string) => void;
  copyInstance: (id: string) => void;
  fillSymmetry: (id: string) => void;
  toggleVisibility: (id: string) => void;

  startConnect: (id: string) => void;
  cancelConnect: () => void;
  pickPoint: (source: LampPickSource, pick: BoxPick) => void;
  disconnect: (id: string) => void;
  rollConnection: (id: string, degrees: number) => void;

  setLampName: (name: string | null) => void;
  setDescription: (description: string) => void;

  setHoveredPick: (pick: BoxPick | null) => void;
  setHighlighted: (id: string | null) => void;
  previewSymmetry: (id: string | null) => void;
  clearError: () => void;
}

// `crypto.randomUUID` needs a secure context, and `vite --host` on a LAN IP is
// not one. Ids only have to be unique within a session.
function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `lamp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchComponentDef(file: string): Promise<LampComponentDef> {
  return parseComponentDef(file, await readLibraryFile("components", file));
}

/** The scene as it stands right now — the actions all need it to place things. */
function currentScene(instances: LampInstance[]): LampScene {
  return computeScene(instances, useVariablesStore.getState().raw);
}

// Two identical components are two rows in the list, so they need to be told
// apart: `frame`, `frame (2)`, `frame (3)`.
function labelFor(instances: LampInstance[], name: string): string {
  const taken = instances.filter((i) => i.def.name === name).length;
  return taken === 0 ? name : `${name} (${taken + 1})`;
}

/** A resolved placement in the plain form the instance list stores. */
function placementToState(placement: Placement): { position: Vec3; quaternion: Quat } {
  return {
    position: placement.position.toArray() as Vec3,
    quaternion: placement.quaternion.toArray() as Quat,
  };
}

/**
 * Slide a box along an axis until it is clear of everything else, and return the
 * placement that puts it there.
 *
 * This is the one piece of geometry shared by insert, copy and disconnect: all
 * three have to leave a part somewhere the user can actually see it, which means
 * somewhere nothing else already is.
 */
function placeClear(
  placement: Placement,
  box: THREE.Box3,
  obstacles: THREE.Box3[],
  axis: AxisIndex,
  sign: 1 | -1,
  start: number,
  step: number
): Placement {
  const distance = clearDistance(box, obstacles, axis, sign, start, step);
  const delta = new THREE.Vector3();
  delta.setComponent(axis, sign * distance);
  return { quaternion: placement.quaternion.clone(), position: placement.position.clone().add(delta) };
}

/** Every world box except one instance's — what it must not land inside. */
function obstaclesFor(scene: LampScene, exceptId: string): THREE.Box3[] {
  const boxes = [scene.mainBox];
  for (const [id, box] of scene.worldBoxes) if (id !== exceptId) boxes.push(box);
  return boxes;
}

// ---------------------------------------------------------------------------
// The connect pick
// ---------------------------------------------------------------------------

const pickedPointOf = (pick: BoxPick): PickedPoint => ({
  point: pick.point.toArray() as Vec3,
  edges: pick.edges,
  block: pick.block,
});

/** Whether two picks are different points, not the same one twice. */
function apart(a: PickedPoint, b: PickedPoint): boolean {
  return (
    Math.hypot(
      a.point[0] - b.point[0],
      a.point[1] - b.point[1],
      a.point[2] - b.point[2]
    ) > 1e-6
  );
}

/** The four world points as anchors, and the connection they make. */
function commitConnection(
  state: LampState,
  draft: ConnectDraft,
  onto: LampPickSource,
  target: PickedPoint[]
): Partial<LampState> {
  const scene = currentScene(state.instances);
  const shape = scene.shapes.get(draft.instanceId);
  const placement = scene.placements.get(draft.instanceId);
  if (!shape || !placement) return { draft: null, hoveredPick: null };

  const sourceAnchors = draft.source.map((p) =>
    anchorOnInstance(new THREE.Vector3(...p.point), shape, placement, p.block)
  ) as [LampAnchor, LampAnchor];

  const targetAnchors = target.map((p) => {
    const world = new THREE.Vector3(...p.point);
    if (onto.kind === "mainBox") return anchorOnMainBox(world, scene.mainBox);
    const targetShape = scene.shapes.get(onto.id)!;
    const targetPlacement = scene.placements.get(onto.id)!;
    return anchorOnInstance(world, targetShape, targetPlacement, p.block);
  }) as [LampAnchor, LampAnchor];

  return {
    instances: state.instances.map((instance) =>
      instance.id === draft.instanceId
        ? {
            ...instance,
            connection: {
              source: sourceAnchors,
              target:
                onto.kind === "mainBox"
                  ? { kind: "mainBox", anchors: targetAnchors }
                  : { kind: "instance", id: onto.id, anchors: targetAnchors },
            },
          }
        : instance
    ),
    draft: null,
    hoveredPick: null,
    error: null,
  };
}

/**
 * One click of the connect, which is five of them.
 *
 * Clicks 1–2 land on the part being connected. Click 3 lands on whatever it is
 * going onto and **only names it** — every other body goes out of sight, and
 * clicks 4–5 pick the two points on what is left. Click 5 commits: the four
 * world points become four anchors, and from then on the joint is stated as
 * fractions of two boxes and survives every variable edit.
 *
 * The naming click is a click of its own rather than the first of the target's
 * two points because the reason for it is *sight*, not arithmetic: it has to
 * happen before anything is picked on the target, or the first point would still
 * be picked through whatever is standing in front.
 */
function addPick(
  state: LampState,
  onto: LampPickSource,
  made: PickedPoint
): Partial<LampState> {
  const draft = state.draft;
  if (!draft) return {};

  // --- the two points on the part itself -----------------------------------
  if (draft.source.length < 2) {
    if (onto.kind !== "instance" || onto.id !== draft.instanceId) {
      return { error: "Pick both of the first two points on the part you are connecting." };
    }
    const source = [...draft.source, made];
    if (source.length > 1 && !apart(source[0], source[1])) {
      return { error: "The two points on the part must be different." };
    }
    return { draft: { ...draft, source }, hoveredPick: null, error: null };
  }

  // --- naming what it goes onto --------------------------------------------
  if (!draft.targetRef) {
    if (onto.kind === "instance" && onto.id === draft.instanceId) {
      return { error: "Click the main box or another component — the one this part goes onto." };
    }
    if (onto.kind === "instance" && wouldCycle(state.instances, draft.instanceId, onto.id)) {
      return { error: "That would connect the part to something already hanging off it." };
    }
    // the point under this click is deliberately dropped: it chose the body, and
    // the two that matter are picked next, on a body with nothing in front of it
    return { draft: { ...draft, targetRef: onto }, hoveredPick: null, error: null };
  }

  // --- the two points on it ------------------------------------------------
  if (!sameTarget(draft.targetRef, onto)) {
    return { error: "Both target points must be on the same part." };
  }

  const target = [...draft.target, made];
  if (target.length > 1 && !apart(target[0], target[1])) {
    return { error: "The two points on the target must be different." };
  }
  if (target.length < 2) {
    return { draft: { ...draft, target }, hoveredPick: null, error: null };
  }
  return commitConnection(state, draft, onto, target);
}

/**
 * Put a parsed lamp on the bench, replacing whatever was there.
 *
 * A lamp is a whole design, variables included, not something you add to the one
 * already loaded — so the variables go in first, since the instances below are
 * only meaningful against them.
 *
 * A component the library no longer has takes its instances with it, and is
 * named in the error. The rest of the lamp still loads, and anything that was
 * hanging off a dropped instance is freed where the file left it rather than
 * being placed by a joint pointing at nothing.
 */
async function applyLampFile(
  set: (partial: Partial<LampState>) => void,
  lamp: LampFile,
  name: string
): Promise<void> {
  const defs = new Map<string, LampComponentDef>();
  for (const component of new Set(lamp.instances.map((i) => i.component))) {
    try {
      defs.set(component, await fetchComponentDef(component));
    } catch {
      // reported by `toInstances` as missing, below
    }
  }

  useVariablesStore.getState().loadDesign(lamp.variables, lamp.paired, lamp.stashed);
  const { instances, missing, variables } = toInstances(lamp, defs);

  // A component that has been edited since the lamp was saved may name a
  // variable the file has never heard of, and the file is not wrong for that —
  // it could not have written one that did not exist. Merged in exactly as
  // `insertComponent` merges them, and for the same reason: the design always
  // wins, so this only ever fills a hole. Without it the improved component
  // comes back as 1 mm cubes and says nothing.
  for (const [name, formula] of Object.entries(variables)) {
    const design = useVariablesStore.getState();
    if (!(name in design.raw)) design.setVariable(name, formula);
  }

  set({
    instances,
    lampName: sanitizeName(name) ?? lamp.id,
    description: lamp.description ?? "",
    // a lamp comes back whole: what was out of sight was a way of working on
    // the last one, and its ids do not mean anything against this one
    hiddenIds: [],
    draft: null,
    hoveredPick: null,
    highlightedId: null,
    symmetryPreview: null,
    error: missing.length > 0 ? `Not in the component library: ${missing.join(", ")}` : null,
  });
}

export const useLampStore = create<LampState>((set, get) => ({
  library: [],
  libraryError: null,
  lampLibrary: [],
  lampLibraryError: null,
  error: null,

  lampName: null,
  description: "",
  instances: [],
  hiddenIds: [],
  draft: null,
  hoveredPick: null,
  highlightedId: null,
  symmetryPreview: null,

  loadLibrary: async () => {
    try {
      set({ library: await listLibraryComponents(), libraryError: null });
    } catch (e) {
      set({ libraryError: e instanceof Error ? e.message : String(e) });
    }
  },

  loadLampLibrary: async () => {
    try {
      set({ lampLibrary: await listLibraryLamps(), lampLibraryError: null });
    } catch (e) {
      set({ lampLibraryError: e instanceof Error ? e.message : String(e) });
    }
  },

  /**
   * Put the lamp in `public/models/lamps` — a commit when this browser has a
   * token, a download to be dropped in by hand when it has not. Either way the
   * folder is re-listed every time the picker is opened, so it shows up.
   *
   * @returns what happened, for the menu to report, or null when there was
   *          nothing to save and the reason is already in `error`.
   * @throws when the repository refuses the write.
   */
  toFile: (name) => {
    const state = get();
    if (state.instances.length === 0) return null;
    const id = sanitizeName(name ?? state.lampName ?? "") ?? "lamp";
    return {
      id,
      data: buildLampFile(id, state.instances, useVariablesStore.getState(), state.description),
    };
  },

  saveLamp: async (name) => {
    const built = get().toFile(name);
    if (!built) {
      set({ error: "Nothing to save — the lamp is empty." });
      return null;
    }
    const note = await saveLibraryFile("lamps", `${built.id}.lamp.json`, built.data);
    // saving under a name is what names the lamp, so the next save knows what
    // "overwrite" means
    set({ error: null, lampName: built.id });
    return note;
  },

  /**
   * Open a saved lamp, replacing whatever is on the bench.
   *
   * The file names its components rather than carrying them, so every distinct
   * one is fetched and re-parsed here — at the *current* library, which is the
   * point: a component that has been improved since the lamp was saved comes
   * back improved.
   *
   * A component the library no longer has takes its instances with it, and is
   * named in the error. The rest of the lamp still loads, and anything that was
   * hanging off a dropped instance is freed where the file left it rather than
   * being placed by a joint pointing at nothing.
   */
  loadLamp: async (file) => {
    let lamp: LampFile;
    try {
      lamp = await fetchLampFile(file);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    await applyLampFile(set, lamp, file.replace(/(\.lamp)?\.json$/, ""));
  },

  // Same path as a library lamp, from bytes the user handed over instead of
  // from the folder: a file off the disk is the same file, and a lamp that
  // opens one way and not the other would be a second format by accident.
  openLampFile: async (data, name) => {
    let lamp: LampFile;
    try {
      lamp = parseLampFile(data);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    await applyLampFile(set, lamp, name);
  },

  /**
   * Insert a library component and park it beside the lamp.
   *
   * The variables the file was written against are merged in for anything the
   * design does not already define — same rule as loading into the editor: the
   * design always wins, which is the whole point of components carrying formulas
   * instead of sizes.
   */
  insertComponent: async (file) => {
    let def: LampComponentDef;
    try {
      def = await fetchComponentDef(file);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }

    const variables = useVariablesStore.getState();
    for (const [name, value] of Object.entries(def.variables)) {
      if (!(name in variables.raw)) variables.setVariable(name, value);
    }

    const instances = get().instances;
    const scene = currentScene(instances);
    const shape = buildShape(def, useVariablesStore.getState().raw);

    // Start it at the main box's right-hand face, standing on the same floor,
    // then push it further right until it is clear of everything already there.
    const start: Placement = {
      quaternion: new THREE.Quaternion(),
      position: new THREE.Vector3(scene.mainBox.max.x, scene.mainBox.min.y, scene.mainBox.min.z),
    };
    const width = scene.mainBox.getSize(new THREE.Vector3()).x;
    const placed = placeClear(
      start,
      worldBoxOf(shape, start),
      [scene.mainBox, ...scene.worldBoxes.values()],
      0,
      1,
      width * INSERT_GAP_FRACTION,
      width * CLEARANCE_STEP_FRACTION
    );

    set({
      instances: [
        ...instances,
        {
          id: newId(),
          label: labelFor(instances, def.name),
          def,
          connection: null,
          ...placementToState(placed),
        },
      ],
      error: null,
    });
  },

  // Anything hanging off a deleted instance is freed where it stands rather than
  // deleted with it: the user asked to remove one part, and a part that silently
  // took two others with it would be a surprise.
  removeInstance: (id) =>
    set((state) => {
      const scene = currentScene(state.instances);
      const instances = state.instances
        .filter((instance) => instance.id !== id)
        .map((instance) => {
          if (instance.connection?.target.kind !== "instance") return instance;
          if (instance.connection.target.id !== id) return instance;
          const placement = scene.placements.get(instance.id);
          return {
            ...instance,
            connection: null,
            ...(placement
              ? placementToState(placement)
              : { position: instance.position, quaternion: instance.quaternion }),
          };
        });
      return {
        instances,
        draft: state.draft?.instanceId === id ? null : state.draft,
        highlightedId: state.highlightedId === id ? null : state.highlightedId,
        symmetryPreview: state.symmetryPreview === id ? null : state.symmetryPreview,
        // an id nobody can name again would sit in the hidden set forever, and
        // hide the next part unlucky enough to be given the same one
        hiddenIds: state.hiddenIds.filter((hidden) => hidden !== id),
        hoveredPick: null,
      };
    }),

  /**
   * Take a component out of sight, or bring it back.
   *
   * A crowded lamp is the case this is for: a kumiko panel standing in front of
   * the joint you are trying to pick is in the way of both the eye and the
   * raycast, and moving it is not an option because where it is *is* the design.
   */
  toggleVisibility: (id) =>
    set((state) => ({
      hiddenIds: state.hiddenIds.includes(id)
        ? state.hiddenIds.filter((hidden) => hidden !== id)
        : [...state.hiddenIds, id],
      // whatever the cursor was over may have just stopped being drawn
      hoveredPick: null,
    })),

  // A copy comes off unattached and parked clear of the original — two parts
  // occupying the same millimetres would read as nothing having happened.
  copyInstance: (id) =>
    set((state) => {
      const source = state.instances.find((instance) => instance.id === id);
      const scene = currentScene(state.instances);
      const shape = scene.shapes.get(id);
      const placement = scene.placements.get(id);
      if (!source || !shape || !placement) return state;

      const width = scene.mainBox.getSize(new THREE.Vector3()).x;
      const placed = placeClear(
        placement,
        worldBoxOf(shape, placement),
        [scene.mainBox, ...scene.worldBoxes.values()],
        0,
        1,
        width * CLEARANCE_STEP_FRACTION,
        width * CLEARANCE_STEP_FRACTION
      );

      return {
        instances: [
          ...state.instances,
          {
            id: newId(),
            label: labelFor(state.instances, source.def.name),
            def: source.def,
            connection: null,
            ...placementToState(placed),
          },
        ],
      };
    }),

  /**
   * Put this part everywhere the box's symmetry says it also belongs.
   *
   * Only the empty places: a slot that already holds this component is left
   * exactly as the user left it, which is what makes the button safe to press
   * twice and safe to press after filling three of four faces by hand.
   *
   * Anything hanging off the part comes with it — a panel with beads on it is
   * one thing, and copying the bare panel would be a fill that did three
   * quarters of the job. The followers' anchors are fractions of the parent's
   * own box, which the copy shares, so they need re-pointing at the new ids and
   * nothing else.
   */
  fillSymmetry: (id) =>
    set((state) => {
      const source = state.instances.find((instance) => instance.id === id);
      if (!source) return state;

      const copies = symmetryCopies(state.instances, currentScene(state.instances), id);
      if (copies.length === 0) return state;

      const followers = subtreeOf(state.instances, id);
      const instances = [...state.instances];

      for (const copy of copies) {
        const ids = new Map<string, string>([[id, newId()]]);
        for (const follower of followers) ids.set(follower.id, newId());

        instances.push({
          ...source,
          id: ids.get(id)!,
          label: labelFor(instances, source.def.name),
          connection: copy.connection,
          ...placementToState(copy.placement),
        });

        for (const follower of followers) {
          const connection = follower.connection!; // a follower is connected by construction
          instances.push({
            ...follower,
            id: ids.get(follower.id)!,
            label: labelFor(instances, follower.def.name),
            connection:
              connection.target.kind === "instance"
                ? { ...connection, target: { ...connection.target, id: ids.get(connection.target.id)! } }
                : connection,
          });
        }
      }

      return { instances, error: null };
    }),

  // Connecting a part means clicking two points on it, so it has to be on
  // screen: starting a pick brings it back into sight rather than arming a pick
  // against something nothing can be clicked on.
  startConnect: (id) =>
    set((state) => ({
      draft: { instanceId: id, source: [], target: [], targetRef: null },
      hiddenIds: state.hiddenIds.filter((hidden) => hidden !== id),
      hoveredPick: null,
      error: null,
    })),

  // whatever went wrong during the pick went wrong about a pick that no longer
  // exists, so the message goes with it
  cancelConnect: () => set({ draft: null, hoveredPick: null, error: null }),

  pickPoint: (source, pick) => set((state) => addPick(state, source, pickedPointOf(pick))),

  /**
   * Take a part off the lamp and stand it aside.
   *
   * It slides along the axis the connection ran along — the parts were placed
   * *because* of that joint, so leaving it where it is would read as nothing
   * having happened — starting at half the main box's width and stepping out
   * another tenth at a time until it is clear of the box and of every other
   * part.
   */
  disconnect: (id) =>
    set((state) => {
      const instance = state.instances.find((i) => i.id === id);
      if (!instance?.connection) return state;

      const scene = currentScene(state.instances);
      const shape = scene.shapes.get(id);
      const placement = scene.placements.get(id);
      const box = scene.worldBoxes.get(id);
      if (!shape || !placement || !box) return state;

      const line = targetWorldPoints(instance.connection.target, scene);
      const axis: AxisIndex = line ? dominantAxis(line[1].clone().sub(line[0])) : 0;

      // away from the lamp, so a part on the left goes left and one on the right
      // goes right rather than both piling up on the same side
      const centre = box.getCenter(new THREE.Vector3()).getComponent(axis);
      const middle = scene.mainBox.getCenter(new THREE.Vector3()).getComponent(axis);
      const sign: 1 | -1 = centre >= middle ? 1 : -1;

      const width = scene.mainBox.getSize(new THREE.Vector3()).x;
      const placed = placeClear(
        placement,
        box,
        obstaclesFor(scene, id),
        axis,
        sign,
        width * DISCONNECT_FRACTION,
        width * CLEARANCE_STEP_FRACTION
      );

      return {
        instances: state.instances.map((i) =>
          i.id === id ? { ...i, connection: null, ...placementToState(placed) } : i
        ),
      };
    }),

  /**
   * Turn a connected part about the line its joint runs along.
   *
   * Two points fix the part's axis and nothing more — a rail brought onto an
   * edge is still free to lie flat or on its side, and which of those the
   * alignment happens to land on is arbitrary. This is that one remaining degree
   * of freedom, and turning it cannot break the joint: the axis passes through
   * the point the part is pinned at.
   */
  rollConnection: (id, degrees) =>
    set((state) => ({
      instances: state.instances.map((instance) =>
        instance.id === id && instance.connection
          ? {
              ...instance,
              connection: {
                ...instance.connection,
                roll: (((instance.connection.roll ?? 0) + degrees) % 360 + 360) % 360,
              },
            }
          : instance
      ),
    })),

  // The Name panel writes straight through: the name a lamp is under is what
  // "Save (overwrite)" writes, so renaming here and overwriting is how a lamp is
  // renamed — the old file stays until it is deleted from the Assets tab.
  setLampName: (name) => set({ lampName: name }),
  setDescription: (description) => set({ description }),

  // Snapping quantises the cursor to 27 points per box, so most pointer moves
  // land on the point already marked. Bailing out on those keeps a hover from
  // rebuilding the highlight geometry on every frame of a mouse sweep.
  setHoveredPick: (pick) =>
    set((state) => {
      const current = state.hoveredPick;
      if (!pick) return current === null ? state : { hoveredPick: null };
      const point = pick.point.toArray() as Vec3;
      if (current && current.point.every((c, i) => Math.abs(c - point[i]) < 1e-6)) return state;
      return { hoveredPick: { point, edges: pick.edges, block: pick.block } };
    }),

  setHighlighted: (id) => set({ highlightedId: id }),

  // Set even when the button is spent — a symmetry that is already filled is
  // still worth being able to see, and pointing at the button is how you ask
  // "which parts are the set?".
  previewSymmetry: (id) => set({ symmetryPreview: id }),

  clearError: () => set({ error: null }),
}));

function sameTarget(a: LampPickSource, b: LampPickSource): boolean {
  if (a.kind === "mainBox" || b.kind === "mainBox") return a.kind === b.kind;
  return a.id === b.id;
}

/** Whether an instance is the target of some other instance's connection. */
export function isConnectionTarget(instances: LampInstance[], id: string): boolean {
  return instances.some(
    (instance) => instance.connection?.target.kind === "instance" && instance.connection.target.id === id
  );
}

export type { LampInstance, LampTargetKind };
