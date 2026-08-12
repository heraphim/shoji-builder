import * as THREE from "three";
import { anchorOfPoint, boxSize, pointOfAnchor, roundAnchor } from "./blocks";
import { resolveVariables } from "./formula";
import type { ComponentFile } from "./componentFile";
import type { Appearance, AxisIndex, Edge, Vec3 } from "../store/useComponentEditorStore";

/**
 * The lamp assembly: the main box, the component instances hung off it, and the
 * arithmetic that places them.
 *
 * Everything here is pure. The rule the component editor works by holds on this
 * side too — **nothing positional is stored as a millimetre that was only true at
 * one setting of the variables**:
 *
 * - the main box is derived from `innerWidth`/`innerHeight`/`innerDepth` on every
 *   read, so it is never stale;
 * - an instance's parts are re-cut from the component file's size *formulas*;
 * - a connection is four *anchors* — fractions of a box — not four coordinates,
 *   so the joint holds when the lamp is resized.
 *
 * A free (disconnected) instance is the one exception, and deliberately so: it
 * has been taken off the lamp and parked, and parking it is a millimetre fact.
 *
 * See docs/algorithms/lamp-assembly.md.
 */

export type Quat = [number, number, number, number];

/** One part of a component: an axis-aligned box stated as three formulas. */
export interface LampBlock {
  id: string;
  size: [string, string, string];
  /** The block's low corner in the file's own frame; joints override it. */
  origin: Vec3;
}

/** A joint *inside* a component, replayed exactly as the editor replays it. */
export interface LampJoint {
  blockA: string;
  anchorA: Vec3;
  blockB: string;
  anchorB: Vec3;
}

/** A library component, reduced to what the lamp needs: boxes and joints. */
export interface LampComponentDef {
  /** File name in `public/models/components`. */
  file: string;
  name: string;
  blocks: LampBlock[];
  joints: LampJoint[];
  /** The variables the formulas are written against, for merging on insert. */
  variables: Record<string, string>;
  /**
   * What the component is made of, if the file says.
   *
   * Carried through even though the lamp never edits it, so that a component
   * dressed in the editor arrives in the assembly wearing the same wood. The
   * alternative — the lamp painting every part the same — makes the one view
   * where the whole thing is visible the one view that cannot show what it will
   * look like.
   */
  appearance?: Appearance;
}

/** What a connection is fixed to — the main box, or another instance. */
export type LampTargetKind = { kind: "mainBox" } | { kind: "instance"; id: string };

/**
 * One end of a joint: a point held as fractions **of a named box**.
 *
 * The fractions alone are what survives a resize — a corner is still that corner
 * once the part is 20 mm longer, but no longer at that coordinate. Which box
 * they are fractions *of* is the other half of the same promise, and the half
 * that is easy to lose: a component is several blocks, and a point on one of
 * them is only tracked by the encasing box for as long as the blocks keep their
 * proportions. A variable edit is precisely what ends that. Bolt a bar to the
 * bottom rail of a frame whose stiles are parametric, lengthen the stiles, and
 * an encasing-box fraction walks the bar up off the rail.
 *
 * So the block the point was picked on is recorded with it, and the fractions
 * are of that block's own box. `null` means the whole body — the instance's
 * encasing box, which is a real pick target in its own right (it is where a
 * rebated corner *would* be, see {@link pickBoxes}), and always the main box,
 * which has no parts to speak of.
 */
export interface LampAnchor {
  /** Fractions of the box named by `block`: 0 the low face, 1 the high face. */
  at: Vec3;
  block: string | null;
}

/**
 * A joint between an instance and something else, as four anchors.
 *
 * Two points on the instance are brought onto two points on the target: the part
 * is turned until the first-to-second direction matches, then slid until the two
 * first points coincide. All four then lie on one line, which is the whole
 * definition — a length mismatch between the two pairs leaves the parts aligned
 * rather than refusing the joint.
 */
export interface LampConnection {
  /** Anchors on the instance's own blocks. */
  source: [LampAnchor, LampAnchor];
  target: LampTargetKind & { anchors: [LampAnchor, LampAnchor] };
  /**
   * An extra turn about the connection line itself, in degrees.
   *
   * The two points fix the part's *axis* and nothing more — a rail brought onto
   * an edge is still free to lie flat or on its side, and which one the
   * alignment happens to pick is arbitrary. Spinning about the line the four
   * points lie on is the one degree of freedom the joint leaves open, so it is
   * the one the user gets to set, and it cannot break the joint: the first point
   * stays on the first target point and the second stays on the line.
   */
  roll?: number;
}

export interface LampInstance {
  id: string;
  label: string;
  def: LampComponentDef;
  /** Null once disconnected — `position`/`quaternion` then place it. */
  connection: LampConnection | null;
  position: Vec3;
  quaternion: Quat;
}

/** A component's parts, cut at the current variables, in instance-local mm. */
export interface InstanceShape {
  /** One box per block, with the assembly's low corner at the local origin. */
  boxes: THREE.Box3[];
  /** Each box's block id, index-aligned — what a {@link LampAnchor} names. */
  blocks: string[];
  size: Vec3;
}

export interface Placement {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface LampScene {
  mainBox: THREE.Box3;
  shapes: Map<string, InstanceShape>;
  placements: Map<string, Placement>;
  worldBoxes: Map<string, THREE.Box3>;
}

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

// ---------------------------------------------------------------------------
// Reading a component file
// ---------------------------------------------------------------------------

/**
 * Reduce a `*.component.json` to the boxes-and-joints the lamp needs.
 *
 * Measurements, provenance and the baked preview are all deliberately dropped:
 * the lamp only ever *places* a component, it never re-measures one. That is the
 * editor's job, and the file already carries the answer as formulas.
 *
 * @throws when the payload is not a component file with parametric blocks.
 */
export function parseComponentDef(file: string, data: unknown): LampComponentDef {
  const parsed = data as Partial<ComponentFile>;
  if (!parsed || parsed.type !== "component" || !Array.isArray(parsed.blocks)) {
    throw new Error(`${file} is not a component file`);
  }
  if (parsed.blocks.length === 0) {
    throw new Error(`${file} has no parametric blocks`);
  }
  return {
    file,
    name: parsed.id || file.replace(/(\.component)?\.json$/, ""),
    blocks: parsed.blocks.map((block) => ({
      id: block.id,
      size: [block.size.x, block.size.y, block.size.z],
      origin: block.origin,
    })),
    joints: (parsed.connections ?? []).map((c) => ({
      blockA: c.a.block,
      anchorA: c.a.anchor,
      blockB: c.b.block,
      anchorB: c.b.anchor,
    })),
    variables: parsed.variables ?? {},
    appearance: parsed.appearance,
  };
}

// ---------------------------------------------------------------------------
// Cutting a component at the current variables
// ---------------------------------------------------------------------------

// Several formulas against one scope in a single resolver pass, by injecting
// them under reserved keys. Null if any of them throws, so a half-typed variable
// leaves every block at a visible fallback rather than collapsing the lamp.
function evaluateFormulas(formulas: string[], raw: Record<string, string>): number[] | null {
  const scope: Record<string, string> = { ...raw };
  formulas.forEach((formula, i) => {
    scope[`__lamp${i}`] = formula;
  });
  try {
    const resolved = resolveVariables(scope);
    return formulas.map((_, i) => resolved[`__lamp${i}`]);
  } catch {
    return null;
  }
}

// The same forest replay the editor uses (`computeOffsets`): a joint brings
// block B's anchor point onto block A's, and everything already joined to B
// travels with it. Groups are shared array references, so "already joined" is an
// identity test; a joint whose ends are already in one group is skipped, which
// is what keeps the replay from fighting itself.
function replayJoints(boxes: Map<string, THREE.Box3>, joints: LampJoint[]): void {
  const groups = new Map<string, string[]>();
  for (const id of boxes.keys()) groups.set(id, [id]);

  for (const joint of joints) {
    const boxA = boxes.get(joint.blockA);
    const boxB = boxes.get(joint.blockB);
    if (!boxA || !boxB) continue;
    const groupA = groups.get(joint.blockA)!;
    const groupB = groups.get(joint.blockB)!;
    if (groupA === groupB) continue;

    const a = pointOfAnchor(joint.anchorA, boxA);
    const b = pointOfAnchor(joint.anchorB, boxB);
    const delta = new THREE.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (const id of groupB) boxes.get(id)!.translate(delta);

    const merged = [...groupA, ...groupB];
    for (const id of merged) groups.set(id, merged);
  }
}

/**
 * Cut a component's parts at the current variable values.
 *
 * Blocks are built at their saved origins, the component's own joints are
 * replayed over them, and the result is shifted so the assembly's low corner
 * sits at the local origin. That last step is what makes the shape a *shape*
 * rather than a position: where the component was drawn is not a property of it,
 * and an instance is placed by its connection or by its stored position, never
 * by where the file happened to put it.
 *
 * A block whose formulas do not resolve to three positive numbers falls back to
 * a 1 mm cube — visibly wrong, rather than a NaN box that poisons every bounding
 * box downstream.
 */
export function buildShape(def: LampComponentDef, raw: Record<string, string>): InstanceShape {
  const values = evaluateFormulas(
    def.blocks.flatMap((block) => block.size),
    raw
  );

  const boxes = new Map<string, THREE.Box3>();
  def.blocks.forEach((block, i) => {
    const cut = values?.slice(i * 3, i * 3 + 3);
    const size = cut && cut.every((s) => Number.isFinite(s) && s > 0) ? cut : [1, 1, 1];
    const min = new THREE.Vector3(...block.origin);
    boxes.set(
      block.id,
      new THREE.Box3(min.clone(), min.clone().add(new THREE.Vector3(size[0], size[1], size[2])))
    );
  });

  replayJoints(boxes, def.joints);

  const overall = new THREE.Box3();
  for (const box of boxes.values()) overall.union(box);
  const size = boxSize(overall);
  const shift = overall.min.clone().negate();
  return {
    boxes: def.blocks.map((block) => boxes.get(block.id)!.translate(shift)),
    blocks: def.blocks.map((block) => block.id),
    size,
  };
}

/** An instance's own bounding box, in its local frame. Low corner at the origin. */
export function localBoxOf(shape: InstanceShape): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...shape.size));
}

/**
 * The box an anchor's fractions are of.
 *
 * An anchor naming a block the component no longer has falls back to the
 * encasing box — the joint is then only as good as the old behaviour, which is
 * better than dropping it. It cannot happen from the UI (an instance keeps the
 * def it was inserted with) and is here for a hand-edited or reloaded state.
 */
function boxOfAnchor(anchor: LampAnchor, shape: InstanceShape): THREE.Box3 {
  if (anchor.block === null) return localBoxOf(shape);
  const i = shape.blocks.indexOf(anchor.block);
  return i === -1 ? localBoxOf(shape) : shape.boxes[i];
}

/** Where an anchor points, in the instance's own frame. */
export function localPointOfAnchor(anchor: LampAnchor, shape: InstanceShape): THREE.Vector3 {
  return new THREE.Vector3(...pointOfAnchor(anchor.at, boxOfAnchor(anchor, shape)));
}

// ---------------------------------------------------------------------------
// The main box
// ---------------------------------------------------------------------------

const MAIN_BOX_FALLBACK: Record<string, number> = {
  innerWidth: 200,
  innerDepth: 200,
  innerHeight: 370,
};

/**
 * The lamp's central reference box, derived from the design variables.
 *
 * Centred on X and Z with its base on the grid, so the lamp stands on the floor
 * and grows symmetrically when it is widened. Everything else in the scene is
 * positioned against this box, which is exactly what makes "resize the core and
 * everything attached moves" fall out for free — the anchors are fractions of
 * *this*, so they follow it.
 *
 * Falls back to the shipped defaults for a variable that will not resolve, so a
 * half-typed formula never leaves the scene without a reference.
 */
export function mainBoxOf(raw: Record<string, string>): THREE.Box3 {
  let values: Record<string, number>;
  try {
    values = resolveVariables(raw);
  } catch {
    values = {};
  }
  const read = (name: string) => {
    const value = values[name];
    return Number.isFinite(value) && value > 0 ? value : MAIN_BOX_FALLBACK[name];
  };
  const width = read("innerWidth");
  const depth = read("innerDepth");
  const height = read("innerHeight");
  return new THREE.Box3(
    new THREE.Vector3(-width / 2, 0, -depth / 2),
    new THREE.Vector3(width / 2, height, depth / 2)
  );
}

// ---------------------------------------------------------------------------
// Placing an instance
// ---------------------------------------------------------------------------

function trace(m: THREE.Matrix3): number {
  const e = m.elements;
  return e[0] + e[4] + e[8];
}

/** The cross-product matrix of a unit vector, row by row. */
function crossMatrix(n: THREE.Vector3): THREE.Matrix3 {
  // prettier-ignore
  return new THREE.Matrix3().set(
    0, -n.z, n.y,
    n.z, 0, -n.x,
    -n.y, n.x, 0
  );
}

function rotationMatrix(q: THREE.Quaternion): THREE.Matrix3 {
  return new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
}

/**
 * The roll about `axis` that brings `base` as near `wanted` as a roll can, in
 * radians, or null when every roll is equally good.
 *
 * A roll is a one-parameter family, so this is a one-parameter least-squares
 * fit: minimising ‖R(θ)·base − wanted‖² is maximising tr(R(θ)·C) with
 * `C = base·wantedᵀ`, and expanding Rodrigues' formula makes that
 * `p·cosθ + q·sinθ`. One `atan2` and it is done. When `wanted` is itself
 * reachable by a roll the fit is exact rather than approximate.
 *
 * `axis` must be a unit vector. Both callers want the same thing — an
 * orientation stated up front and the free spin solved for — but they state a
 * different one: `alignPlacement` wants the part square to the box, the
 * symmetry fill wants the original carried through a turn.
 */
export function rollTowards(
  base: THREE.Quaternion,
  wanted: THREE.Quaternion,
  axis: THREE.Vector3
): number | null {
  const c = rotationMatrix(base).multiply(rotationMatrix(wanted).transpose());
  const p = trace(c) - axis.dot(axis.clone().applyMatrix3(c));
  const q = trace(crossMatrix(axis).multiply(c));
  if (Math.abs(p) < 1e-12 && Math.abs(q) < 1e-12) return null; // no preference
  return Math.atan2(q, p);
}

/**
 * The 24 rotations that carry a box onto itself — every signed permutation of
 * the axes with a right-handed result.
 *
 * These are the orientations in which a part's faces are parallel to the box's
 * faces, which for a woodworking joint is every orientation that is not a
 * mistake: a rail lies flat or on its side, never canted.
 */
const BOX_ROTATIONS: THREE.Quaternion[] = (() => {
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];
  const out: THREE.Quaternion[] = [];
  for (const x of axes) {
    for (const y of axes) {
      if (Math.abs(x.dot(y)) > 1e-9) continue; // parallel: not a frame
      const z = new THREE.Vector3().crossVectors(x, y);
      out.push(
        new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
      );
    }
  }
  return out;
})();

const rolledBy = (base: THREE.Quaternion, axis: THREE.Vector3, radians: number) =>
  new THREE.Quaternion().setFromAxisAngle(axis, radians).multiply(base);

/**
 * The aligned rotation, squared up to the box.
 *
 * `setFromUnitVectors` gives the *shortest* rotation onto the target direction,
 * which turns about `from × to` — and that axis belongs to neither body. When
 * both directions are box axes it happens to be a box axis too, so the part's
 * other two axes land on box axes by luck and the joint looks right. On a
 * **diagonal** the luck runs out: the turn is about an oblique axis, and it
 * carries the part's faces off the box's faces by 60° between two body
 * diagonals, 70.53° between two face diagonals, sign depending on which way the
 * target diagonal runs. The four points are still collinear — the part is
 * merely spun about the line they lie on, which is precisely what a roll fixes.
 *
 * So the wanted orientation is stated instead of hoped for: of the 24 ways a
 * part can sit square to the box, take the one a roll comes nearest, and roll to
 * it. Ties go to the smallest roll, which is what leaves a joint that was
 * already square where it already was — every axis-to-axis joint gets 0 here.
 *
 * A reachable square orientation is returned **verbatim** rather than as the
 * rolled base that approximates it. The two differ only by the last few bits,
 * but one of them has faces exactly parallel to the box's and the other merely
 * nearly so, and it costs nothing to prefer the first.
 *
 * When the two slopes differ no square answer exists at all (a 200×40 face
 * diagonal is not parallel to a 500×300 one), and the fit returns the nearest a
 * real part can get. That is the honest answer rather than a refusal.
 */
function squaredUp(base: THREE.Quaternion, axis: THREE.Vector3): THREE.Quaternion {
  let best = base;
  let off = Infinity;
  let least = Infinity;
  for (const square of BOX_ROTATIONS) {
    const roll = rollTowards(base, square, axis);
    if (roll === null) continue;
    const rolled = rolledBy(base, axis, roll);
    const distance = rolled.angleTo(square);
    const nearer = distance < off - 1e-6;
    const tied = distance < off + 1e-6 && Math.abs(roll) < least - 1e-6;
    if (nearer || tied) {
      // cloned: the caller premultiplies the roll into this, and `BOX_ROTATIONS`
      // is a shared constant
      best = distance < 1e-6 ? square.clone() : rolled;
      off = distance;
      least = Math.abs(roll);
    }
  }
  return best;
}

/**
 * The rigid transform that brings the part's second point `a2` onto the
 * target's first point `b1`, with the direction `a2`→`a1` laid onto `b2`→`b1`.
 *
 * Turn first, then slide: the rotation takes the source direction to the target
 * direction, and the translation is then whatever puts the rotated `a2` on `b1`.
 * Two coincident points give no direction, so the rotation degenerates to
 * identity and the joint becomes a pure translation rather than an error.
 *
 * All four points end up on one line, with `b1` (= `a2`) *between* `a1` and
 * `b2`: the picked point is where the two bodies meet, and each runs away from
 * it — the part continues the target's line rather than lying back over it.
 *
 * Lengths need not agree: only the *direction* of the target's second point from
 * its first is used, so a 200 mm rail on a 300 mm edge does something sensible
 * instead of nothing.
 *
 * Which way the part faces about that line is the one thing two points leave
 * open, and it is settled in two steps: `squaredUp` puts the part square to the
 * box, then `roll` is the user's turn away from square. Because the axis passes
 * through `b1` and `a2` lands on `b1`, neither can move a point off the line —
 * they are exactly that freedom, and nothing else.
 */
export function alignPlacement(
  a1: THREE.Vector3,
  a2: THREE.Vector3,
  b1: THREE.Vector3,
  b2: THREE.Vector3,
  roll = 0
): Placement {
  const from = a1.clone().sub(a2);
  const to = b1.clone().sub(b2);
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) {
    return { quaternion: new THREE.Quaternion(), position: b1.clone().sub(a2) };
  }

  // `setFromUnitVectors` needs unit inputs; normalising in place leaves `to` as
  // the connection axis, which is what the roll turns about
  from.normalize();
  to.normalize();
  const quaternion = squaredUp(new THREE.Quaternion().setFromUnitVectors(from, to), to);

  if (roll) {
    quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(to, (roll * Math.PI) / 180));
  }

  return {
    quaternion,
    position: b1.clone().sub(a2.clone().applyQuaternion(quaternion)),
  };
}

/** The 4×4 an instance's parts are drawn through. */
export function placementMatrix(placement: Placement): THREE.Matrix4 {
  return new THREE.Matrix4().compose(placement.position, placement.quaternion, UNIT_SCALE);
}

/** A local point carried into world space by a placement. */
export function toWorld(point: THREE.Vector3, placement: Placement): THREE.Vector3 {
  return point.clone().applyQuaternion(placement.quaternion).add(placement.position);
}

/** The inverse: a world point brought back into an instance's local frame. */
export function toLocal(point: THREE.Vector3, placement: Placement): THREE.Vector3 {
  return point
    .clone()
    .sub(placement.position)
    .applyQuaternion(placement.quaternion.clone().invert());
}

/** World-space bounding box of a placed instance. */
export function worldBoxOf(shape: InstanceShape, placement: Placement): THREE.Box3 {
  const matrix = placementMatrix(placement);
  const box = new THREE.Box3();
  for (const part of shape.boxes) box.union(part.clone().applyMatrix4(matrix));
  return box;
}

function freePlacement(instance: LampInstance): Placement {
  return {
    position: new THREE.Vector3(...instance.position),
    quaternion: new THREE.Quaternion(...instance.quaternion),
  };
}

/**
 * Cut every instance and work out where it sits.
 *
 * Connected instances are resolved in dependency order — an instance joined to
 * another needs that one placed first — by recursing through the target chain
 * and memoising. A cycle can only come from a corrupted state (`wouldCycle`
 * refuses to create one), and is broken by falling back to the free placement
 * rather than recursing forever.
 *
 * O(N) shapes plus O(N) placements; the recursion depth is the length of the
 * longest connection chain.
 */
export function computeScene(
  instances: LampInstance[],
  raw: Record<string, string>
): LampScene {
  const mainBox = mainBoxOf(raw);
  const shapes = new Map(instances.map((i) => [i.id, buildShape(i.def, raw)]));
  const byId = new Map(instances.map((i) => [i.id, i]));
  const placements = new Map<string, Placement>();
  const visiting = new Set<string>();

  const targetPoints = (
    target: LampConnection["target"]
  ): [THREE.Vector3, THREE.Vector3] | null => {
    if (target.kind === "mainBox") {
      return target.anchors.map(
        (anchor) => new THREE.Vector3(...pointOfAnchor(anchor.at, mainBox))
      ) as [THREE.Vector3, THREE.Vector3];
    }
    const instance = byId.get(target.id);
    const shape = instance ? shapes.get(instance.id) : undefined;
    if (!instance || !shape) return null;
    const placement = resolve(instance);
    return target.anchors.map((anchor) =>
      toWorld(localPointOfAnchor(anchor, shape), placement)
    ) as [THREE.Vector3, THREE.Vector3];
  };

  function resolve(instance: LampInstance): Placement {
    const done = placements.get(instance.id);
    if (done) return done;
    const free = freePlacement(instance);
    if (visiting.has(instance.id)) return free;
    visiting.add(instance.id);

    let placement = free;
    const shape = shapes.get(instance.id);
    if (instance.connection && shape) {
      const [a1, a2] = instance.connection.source.map((anchor) =>
        localPointOfAnchor(anchor, shape)
      );
      const target = targetPoints(instance.connection.target);
      if (target) {
        placement = alignPlacement(a1, a2, target[0], target[1], instance.connection.roll ?? 0);
      }
    }

    visiting.delete(instance.id);
    placements.set(instance.id, placement);
    return placement;
  }

  const worldBoxes = new Map<string, THREE.Box3>();
  for (const instance of instances) {
    const placement = resolve(instance);
    const shape = shapes.get(instance.id);
    if (shape) worldBoxes.set(instance.id, worldBoxOf(shape, placement));
  }

  return { mainBox, shapes, placements, worldBoxes };
}

/** The two world points a connection's target end names, at the current scene. */
export function targetWorldPoints(
  target: LampConnection["target"],
  scene: LampScene
): [THREE.Vector3, THREE.Vector3] | null {
  if (target.kind === "mainBox") {
    return target.anchors.map(
      (anchor) => new THREE.Vector3(...pointOfAnchor(anchor.at, scene.mainBox))
    ) as [THREE.Vector3, THREE.Vector3];
  }
  const shape = scene.shapes.get(target.id);
  const placement = scene.placements.get(target.id);
  if (!shape || !placement) return null;
  return target.anchors.map((anchor) =>
    toWorld(localPointOfAnchor(anchor, shape), placement)
  ) as [THREE.Vector3, THREE.Vector3];
}

/**
 * A world point recorded as a fraction of the box it was picked on — the form
 * that survives a variable edit. `roundAnchor` snaps the faces, so a corner
 * picked off a part stays exactly on that corner when the lamp is resized.
 *
 * The main box is one box, so there is no block to name.
 */
export function anchorOnMainBox(point: THREE.Vector3, mainBox: THREE.Box3): LampAnchor {
  return { at: roundAnchor(anchorOfPoint(point.toArray() as Vec3, mainBox)), block: null };
}

/**
 * The same, on an instance — as fractions of the **block the point was picked
 * on**, which is what {@link snapToFeature} reports and what makes the joint
 * hold when the component's blocks change size relative to each other.
 *
 * A pick on the encasing box passes `null` and is a fraction of that, unchanged.
 */
export function anchorOnInstance(
  point: THREE.Vector3,
  shape: InstanceShape,
  placement: Placement,
  block: string | null
): LampAnchor {
  const anchor: LampAnchor = { at: [0, 0, 0], block };
  return {
    at: roundAnchor(
      anchorOfPoint(toLocal(point, placement).toArray() as Vec3, boxOfAnchor(anchor, shape))
    ),
    block,
  };
}

/**
 * Would connecting `sourceId` to `targetId` close a loop?
 *
 * Placements are resolved by following the target chain, so a cycle would have
 * no fixed point to start from. Refusing it here is the same guard the editor
 * puts on connections, for the same reason: the layout has to be replayable.
 */
export function wouldCycle(
  instances: LampInstance[],
  sourceId: string,
  targetId: string
): boolean {
  const byId = new Map<string, LampInstance>(instances.map((i) => [i.id, i]));
  const seen = new Set<string>();
  let at: string | undefined = targetId;
  while (at && !seen.has(at)) {
    if (at === sourceId) return true;
    seen.add(at);
    const connection: LampConnection | null = byId.get(at)?.connection ?? null;
    at = connection?.target.kind === "instance" ? connection.target.id : undefined;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Getting out of the way
// ---------------------------------------------------------------------------

// Boxes that merely touch are not overlapping — a part butted against another is
// exactly where it should be, and treating that as a collision would push every
// disconnected part one step further than it needs to go.
const TOUCH_TOLERANCE = 1e-3;

function overlaps(a: THREE.Box3, b: THREE.Box3): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const shared =
      Math.min(a.max.getComponent(axis), b.max.getComponent(axis)) -
      Math.max(a.min.getComponent(axis), b.min.getComponent(axis));
    if (shared <= TOUCH_TOLERANCE) return false;
  }
  return true;
}

// Far enough that a pathological arrangement cannot spin here forever; large
// enough that it is never reached by a real lamp.
const MAX_CLEARANCE_STEPS = 400;

/**
 * How far along `axis` a box has to travel to stop overlapping everything else.
 *
 * Starts at `start` and adds `step` until the box is clear — so a part
 * disconnected from the lamp lands at the nominal distance when there is nothing
 * in the way, and keeps going in fixed increments when there is.
 */
export function clearDistance(
  moving: THREE.Box3,
  obstacles: THREE.Box3[],
  axis: AxisIndex,
  sign: 1 | -1,
  start: number,
  step: number
): number {
  const increment = Math.max(step, 1e-3);
  const probe = new THREE.Box3();
  const delta = new THREE.Vector3();
  let distance = start;
  for (let i = 0; i <= MAX_CLEARANCE_STEPS; i++) {
    delta.set(0, 0, 0);
    delta.setComponent(axis, sign * distance);
    probe.copy(moving).translate(delta);
    if (!obstacles.some((obstacle) => overlaps(probe, obstacle))) break;
    distance += increment;
  }
  return distance;
}

/** Which world axis a direction lies most nearly along. */
export function dominantAxis(direction: THREE.Vector3): AxisIndex {
  const x = Math.abs(direction.x);
  const y = Math.abs(direction.y);
  const z = Math.abs(direction.z);
  return (x >= y && x >= z ? 0 : y >= z ? 1 : 2) as AxisIndex;
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

// A fraction snapped to the nearest third of a box: 0 is the low face, 0.5 the
// middle, 1 the high face.
function snapFraction(fraction: number): number {
  return fraction < 0.25 ? 0 : fraction < 0.75 ? 0.5 : 1;
}

/** A snapped pick: the point, the three box lines that meet there, and which
 * block's box it came off — `null` for the encasing box or the main box. */
export interface BoxPick {
  point: THREE.Vector3;
  edges: Edge[];
  block: string | null;
}

/** A box a pick may land on, and the block it belongs to. */
export interface PickBox {
  box: THREE.Box3;
  /** null for a body's encasing box, and for the main box. */
  block: string | null;
}

/** A placement that does nothing — for bodies already stated in world terms. */
export function identityPlacement(): Placement {
  return { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
}

// The nearest of one box's 27 feature points to a point in the same frame.
function snapWithinBox(point: THREE.Vector3, box: THREE.Box3): THREE.Vector3 {
  const size = box.getSize(new THREE.Vector3());
  return new THREE.Vector3(
    ...([0, 1, 2].map((axis) => {
      const low = box.min.getComponent(axis);
      const extent = size.getComponent(axis);
      if (extent < 1e-9) return low;
      return low + snapFraction((point.getComponent(axis) - low) / extent) * extent;
    }) as Vec3)
  );
}

/**
 * The boxes a pick on this instance may snap to: every part, **and the encasing
 * box**.
 *
 * The encasing box is what makes a cut-away corner reachable. Rebate the end of
 * a beam and the corner you actually want to butt it by is no longer on the
 * solid at all — it is where the corner *would* be, and nothing on the part can
 * be hovered to name it. Adding the encasing box puts those points back, and the
 * dashed lines from {@link projectedEdges} are the same idea drawn.
 *
 * A one-part component needs no extra: its own box already is the encasing box.
 */
export function pickBoxes(shape: InstanceShape): PickBox[] {
  const boxes: PickBox[] = shape.boxes.map((box, i) => ({ box, block: shape.blocks[i] }));
  // parts first, so a corner both of them name resolves to the real arrises
  // rather than to the encasing box's longer lines — and, now that the winner
  // is recorded, so the anchor is a fraction of the part rather than of the box
  // that merely contains it
  if (boxes.length > 1) boxes.push({ box: localBoxOf(shape), block: null });
  return boxes;
}

/**
 * The nearest *feature point* of a body to a raycast hit — one of the 27 points
 * at every combination of low face / middle / high face on any of its boxes,
 * i.e. the 8 corners, 12 edge midpoints, 6 face centres and the centre of each.
 *
 * Picking raw triangle vertices would only ever offer corners, and a corner is
 * rarely where a shoji frame meets the box it hangs on. Snapping to the lattice
 * instead gives the midpoints for free, and lands the pick on an anchor of
 * exactly 0, 0.5 or 1 — which is what keeps the joint on the same feature when
 * the lamp is resized rather than creeping along the face.
 *
 * Every box is offered rather than just the one that was hit, because the hit is
 * on the *encasing* box: a pick has to be able to name a corner the part no
 * longer has, and that corner is in empty space where nothing can be hovered.
 * Snapping per box and then taking the nearest is the same answer as snapping
 * over all the points at once, since each box's snap is already the nearest of
 * its own 27.
 *
 * `edges` are the three axis-aligned lines through the winning point, clipped to
 * the box it came from. At a corner — the usual pick — they are exactly the three
 * arrises meeting there, which is what says *which* corner of *which* part is
 * about to be joined; a 1 mm dot on its own cannot, since every corner of the
 * assembly looks the same from a step back. Away from a corner the same three
 * lines read as crosshairs on the face.
 *
 * The winning box is reported as well as the point. It is already the thing the
 * snap decided — the fractions 0, 0.5 and 1 are of *it* — and a joint that
 * stored the point without it would be a fraction of the encasing box, which
 * stops naming the same feature as soon as the blocks change size relative to
 * each other. See {@link LampAnchor}.
 */
export function snapToFeature(
  boxes: PickBox[],
  placement: Placement,
  worldPoint: THREE.Vector3
): BoxPick {
  const local = toLocal(worldPoint, placement);

  let best: THREE.Vector3 | null = null;
  let bestBox: PickBox | null = null;
  let bestDistance = Infinity;
  for (const candidate of boxes) {
    const snapped = snapWithinBox(local, candidate.box);
    const distance = snapped.distanceToSquared(local);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = snapped;
      bestBox = candidate;
    }
  }
  if (!best || !bestBox) return { point: worldPoint.clone(), edges: [], block: null };

  const edges: Edge[] = [0, 1, 2].map((axis) => {
    const start = best.clone();
    const end = best.clone();
    start.setComponent(axis, bestBox.box.min.getComponent(axis));
    end.setComponent(axis, bestBox.box.max.getComponent(axis));
    return {
      start: toWorld(start, placement).toArray() as Vec3,
      end: toWorld(end, placement).toArray() as Vec3,
    };
  });

  return { point: toWorld(best, placement), edges, block: bestBox.block };
}

// ---------------------------------------------------------------------------
// The outline of a union of boxes
// ---------------------------------------------------------------------------

// "The same coordinate". Butting parts are placed by anchor arithmetic on the
// same evaluated numbers, so they agree far closer than this.
const OUTLINE_TOL = 1e-6;
// How far off a line to probe for material. Smaller than any real feature of a
// part measured in millimetres, larger than the arithmetic wobble.
const PROBE_MM = 1e-3;

// Which of the four quadrants around a line have material at this parameter.
// Bit 0 is the +u side, bit 1 the +v side, so quadrant q is (u ± , v ±).
function quadrantMask(
  boxes: THREE.Box3[],
  axis: AxisIndex,
  u: AxisIndex,
  v: AxisIndex,
  u0: number,
  v0: number,
  t: number
): number {
  let mask = 0;
  for (let q = 0; q < 4; q++) {
    const pu = u0 + (q & 1 ? PROBE_MM : -PROBE_MM);
    const pv = v0 + (q & 2 ? PROBE_MM : -PROBE_MM);
    for (const box of boxes) {
      if (t <= box.min.getComponent(axis) + OUTLINE_TOL) continue;
      if (t >= box.max.getComponent(axis) - OUTLINE_TOL) continue;
      if (pu < box.min.getComponent(u) - OUTLINE_TOL) continue;
      if (pu > box.max.getComponent(u) + OUTLINE_TOL) continue;
      if (pv < box.min.getComponent(v) - OUTLINE_TOL) continue;
      if (pv > box.max.getComponent(v) + OUTLINE_TOL) continue;
      mask |= 1 << q;
      break;
    }
  }
  return mask;
}

/**
 * Is the surface creased along this line, given which quadrants hold material?
 *
 * - nothing or everything — empty space or solid interior, no surface at all;
 * - **two quadrants sharing a side** — the surface runs *flat* through the line.
 *   This is the seam case: two parts butting face to face make one continuous
 *   plane, and drawing each part's own arris there put a line across a face that
 *   is not bent;
 * - two quadrants diagonally — two solids meeting along a line, creased twice;
 * - one or three — an ordinary convex or concave arris.
 */
function isCrease(mask: number): boolean {
  if (mask === 0 || mask === 0b1111) return false;
  // 0b0011 / 0b1100 share a v side; 0b0101 / 0b1010 share a u side
  return mask !== 0b0011 && mask !== 0b1100 && mask !== 0b0101 && mask !== 0b1010;
}

/**
 * The visible outline of a union of axis-aligned boxes, computed directly.
 *
 * Drawing each part's own twelve arrises is wrong: where two parts butt flush
 * the surface is one flat plane, and their shared arris is a line across it that
 * is not there. The honest answer is the outline of the *union*, which the
 * component editor gets by CSG — correct, but tens of milliseconds a part and a
 * few hundred for a ninety-piece kumiko sill, paid again on every frame of a
 * slider drag.
 *
 * Every part here is an axis-aligned box, and that makes the question local. A
 * line is a crease exactly where the four quadrants around it are not all
 * material and not a flat continuation, so it is enough to walk each candidate
 * line, cut it at every box face it passes, and ask {@link isCrease} of each
 * stretch. Candidate lines are the boxes' own arrises: for parts with disjoint
 * interiors — which is what a component made of butted blocks is — every edge of
 * the union lies on one, because a boundary crease bounds an exposed face
 * region, and those regions are bounded by arrises.
 *
 * O(B · L) for B boxes and L candidate lines, after an O(B) filter per line
 * drops every box the line does not touch — which is nearly all of them.
 */
export function outlineOfBoxes(boxes: THREE.Box3[]): Edge[] {
  const out: Edge[] = [];
  const done = new Set<string>();
  const key = (n: number) => n.toFixed(4);

  for (const box of boxes) {
    for (let a = 0; a < 3; a++) {
      const axis = a as AxisIndex;
      const [u, v] = [0, 1, 2].filter((other) => other !== axis) as [AxisIndex, AxisIndex];

      for (const u0 of [box.min.getComponent(u), box.max.getComponent(u)]) {
        for (const v0 of [box.min.getComponent(v), box.max.getComponent(v)]) {
          // two parts can share an arris line; answer it once
          const line = `${axis}:${key(u0)}:${key(v0)}`;
          if (done.has(line)) continue;
          done.add(line);

          // only boxes the line actually touches can say anything about it
          const touching = boxes.filter(
            (other) =>
              other.min.getComponent(u) - PROBE_MM <= u0 &&
              u0 <= other.max.getComponent(u) + PROBE_MM &&
              other.min.getComponent(v) - PROBE_MM <= v0 &&
              v0 <= other.max.getComponent(v) + PROBE_MM
          );
          if (touching.length === 0) continue;

          // cut the line at every face it passes, then classify each stretch
          const cuts = new Set<number>();
          for (const other of touching) {
            cuts.add(other.min.getComponent(axis));
            cuts.add(other.max.getComponent(axis));
          }
          const stops = [...cuts].sort((p, q) => p - q);

          const emit = (from: number, to: number) => {
            const start: Vec3 = [0, 0, 0];
            const end: Vec3 = [0, 0, 0];
            start[u] = end[u] = u0;
            start[v] = end[v] = v0;
            start[axis] = from;
            end[axis] = to;
            out.push({ start, end });
          };

          let run: number | null = null;
          for (let i = 0; i + 1 < stops.length; i++) {
            if (stops[i + 1] - stops[i] < OUTLINE_TOL) continue;
            const mid = (stops[i] + stops[i + 1]) / 2;
            if (isCrease(quadrantMask(touching, axis, u, v, u0, v0, mid))) {
              if (run === null) run = stops[i];
            } else if (run !== null) {
              emit(run, stops[i]);
              run = null;
            }
          }
          if (run !== null) emit(run, stops[stops.length - 1]);
        }
      }
    }
  }

  return out;
}

// How close a segment has to be to an arris to count as lying on it.
const ON_ARRIS_TOL = 1e-3;

/**
 * The parts of a body's encasing box that its solid does not actually reach —
 * the arrises a cut took away, to be drawn dashed.
 *
 * Rebate the end of a beam and the beam's own corner is gone: what is left is
 * the corner of the rebate, half a thickness in, and joining by that is not what
 * anybody means. So each of the encasing box's twelve arrises is compared with
 * the real outline, and whatever is missing comes back as a construction line.
 * The vertices those lines end at are exactly the ones {@link pickBoxes} makes
 * connectable, so what is drawn and what can be picked are the same set.
 *
 * A solid that fills its own box — every single-part component, the main box —
 * produces nothing, which is the point: the lines only appear where material was
 * removed.
 *
 * O(A · S) for A = 12 arrises and S outline segments, plus a sort per arris.
 */
export function projectedEdges(box: THREE.Box3, outline: Edge[]): Edge[] {
  const out: Edge[] = [];

  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [0, 1, 2].filter((a) => a !== axis);
    const lo = box.min.getComponent(axis);
    const hi = box.max.getComponent(axis);

    for (const cornerU of [box.min.getComponent(u), box.max.getComponent(u)]) {
      for (const cornerV of [box.min.getComponent(v), box.max.getComponent(v)]) {
        // which stretches of this arris the solid actually has
        const covered: Array<[number, number]> = [];
        for (const edge of outline) {
          if (Math.abs(edge.start[u] - edge.end[u]) > ON_ARRIS_TOL) continue;
          if (Math.abs(edge.start[v] - edge.end[v]) > ON_ARRIS_TOL) continue;
          if (Math.abs(edge.start[u] - cornerU) > ON_ARRIS_TOL) continue;
          if (Math.abs(edge.start[v] - cornerV) > ON_ARRIS_TOL) continue;
          const a = Math.min(edge.start[axis], edge.end[axis]);
          const b = Math.max(edge.start[axis], edge.end[axis]);
          if (b - a > ON_ARRIS_TOL) covered.push([a, b]);
        }
        covered.sort((p, q) => p[0] - q[0]);

        const emit = (from: number, to: number) => {
          if (to - from <= ON_ARRIS_TOL) return;
          const start: Vec3 = [0, 0, 0];
          const end: Vec3 = [0, 0, 0];
          start[u] = end[u] = cornerU;
          start[v] = end[v] = cornerV;
          start[axis] = from;
          end[axis] = to;
          out.push({ start, end });
        };

        // the gaps between the covered stretches, and the two ends
        let at = lo;
        for (const [a, b] of covered) {
          if (a > at) emit(at, a);
          at = Math.max(at, b);
        }
        emit(at, hi);
      }
    }
  }

  return out;
}
