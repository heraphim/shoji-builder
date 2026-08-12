import * as THREE from "three";
import { boxSize, pointOfAnchor, roundAnchor } from "./blocks";
import { alignPlacement, localPointOfAnchor, rollTowards } from "./lamp";
import type { InstanceShape, LampConnection, LampInstance, LampScene, Placement } from "./lamp";
import type { Vec3 } from "../store/useComponentEditorStore";

/**
 * The main box's symmetries, and filling one out.
 *
 * The lamp is built *around* the main box, so the box's symmetries are the
 * lamp's: a rail on one top edge belongs on the other three and on the four
 * below, a post on one vertical arris belongs on all four. Placing those by
 * hand is four rounds of the same five-click pick, and any drift between them is
 * invisible until the lamp is stood up.
 *
 * A symmetry here is a map on **anchors** rather than on millimetres, which is
 * the same choice the rest of the assembly makes and for the same reason: a
 * connection is stated as fractions of the main box, so a symmetry of the box is
 * a permutation-with-flips of those fractions and nothing more. It stays true
 * when the box is resized, because it never mentioned a size.
 *
 * See docs/algorithms/symmetry-fill.md.
 */

// ---------------------------------------------------------------------------
// The eight
// ---------------------------------------------------------------------------

/**
 * A quarter turn about the vertical axis, optionally turned over.
 *
 * These eight generate every family the lamp needs so far — the eight
 * horizontal edges, the four vertical arrises, the four face centrelines, the
 * four top-and-bottom diagonals — and nothing else.
 *
 * Every one of them is a **rigid turn**, and that is the whole design. There
 * are more symmetries of a box than these — the mirrors, and the reflection
 * about half its height — but a reflection is not something a part can do. No
 * placement equals a body's own mirror image, so a copy made by reflecting is
 * only ever an approximation of one, and it loses exactly what you were
 * relying on: a face that sat flush comes back a fraction off. A turn loses
 * nothing, because the copy *is* the original, moved.
 *
 * `over` is a half turn about the horizontal X axis through the box's centre,
 * not a top-for-bottom mirror. Reaching the bottom of a face by turning it over
 * rather than by reflecting it is what keeps the flush face flush; the two land
 * on the same edge, and only the turn is a thing a real part can do.
 */
export interface SymmetryOp {
  turn: 0 | 1 | 2 | 3;
  over: boolean;
}

/** Upright before turned over, so the plainer operation claims a place first. */
export const SYMMETRY_OPS: SymmetryOp[] = [false, true].flatMap((over) =>
  ([0, 1, 2, 3] as const).map((turn) => ({ turn, over }))
);

export function opLabel(op: SymmetryOp): string {
  const turn = ["as placed", "a quarter turn round", "half a turn round", "three quarters round"][op.turn];
  return op.over ? `${turn}, turned over` : turn;
}

/** One quarter turn in anchor space, matching `Matrix4.makeRotationY(+90°)`. */
const quarterTurn = (a: Vec3): Vec3 => [a[2], a[1], 1 - a[0]];

/** Turning over in anchor space, matching `Matrix4.makeRotationX(180°)`. */
const turnOver = (a: Vec3): Vec3 => [a[0], 1 - a[1], 1 - a[2]];

/** Where an anchor lands. Complementing an exact 0/0.5/1 leaves it exact. */
function moveAnchor(op: SymmetryOp, anchor: Vec3): Vec3 {
  let a = anchor;
  for (let i = 0; i < op.turn; i++) a = quarterTurn(a);
  return roundAnchor(op.over ? turnOver(a) : a);
}

/** The operation as a rotation of world space, for carrying an orientation. */
function matrixOf(op: SymmetryOp): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY((op.turn * Math.PI) / 2);
  return op.over ? m.premultiply(new THREE.Matrix4().makeRotationX(Math.PI)) : m;
}

/**
 * Whether the operation moves *this* box onto itself, not just the unit cube.
 *
 * A quarter turn only does when the two horizontal spans agree. When they do
 * not it is still a perfectly good anchor map — a rail at half the width of the
 * front lands at half the depth of the side, level and where it belongs — but
 * the part arrives at its original cut length, so its size formulas have to have
 * been written against the span of the face it is on rather than against
 * `innerWidth`. That is the caller's problem to warn about, so this reports it.
 */
function isMetric(op: SymmetryOp, box: THREE.Box3): boolean {
  if (op.turn % 2 === 0) return true;
  const size = boxSize(box);
  return Math.abs(size[0] - size[2]) < 1e-6;
}

// ---------------------------------------------------------------------------
// Planning a fill
// ---------------------------------------------------------------------------

export interface SymmetrySlot {
  op: SymmetryOp;
  /**
   * The connection's target anchors, carried through the operation.
   *
   * Fractions of the main box and nothing else: only a part fixed to the box has
   * a symmetry of its own (see {@link planSymmetryFill}), and the box is one box,
   * so there is no block to name and these stay bare `Vec3`s. They are wrapped
   * back into `LampAnchor`s where a connection is built from them.
   */
  anchors: [Vec3, Vec3];
  /** False when the operation only holds in fraction space — see {@link isMetric}. */
  metric: boolean;
  /** The instance already sitting here, if any; the original occupies its own. */
  occupiedBy: string | null;
}

export interface SymmetryPlan {
  instanceId: string;
  /** Every distinct place the connection reaches, the original included. */
  slots: SymmetrySlot[];
  /**
   * The empty ones — an upper bound on what the button adds. The fill drops a
   * few more once it can see where the parts land; see {@link symmetryCopies}.
   */
  open: SymmetrySlot[];
  /** How many of the open ones land on a face of a different span. */
  parametric: number;
}

const ANCHOR_EPSILON = 1e-6;

function sameAnchors(a: readonly Vec3[], b: readonly Vec3[]): boolean {
  return a.every((anchor, i) => anchor.every((c, axis) => Math.abs(c - b[i][axis]) < ANCHOR_EPSILON));
}

/**
 * The instance already occupying a slot, if there is one.
 *
 * Occupancy is *the same component, at the same place on the box*: same file,
 * same target anchors. The part's own two anchors and its roll are deliberately
 * not compared — the roll is the thing the fill computes, and refusing to skip
 * a part that is already there because it is rolled differently would put a
 * second copy inside the first.
 */
function occupantOf(instances: LampInstance[], file: string, anchors: [Vec3, Vec3]): string | null {
  const found = instances.find(
    (instance) =>
      instance.def.file === file &&
      instance.connection?.target.kind === "mainBox" &&
      sameAnchors(
        instance.connection.target.anchors.map((a) => a.at),
        anchors
      )
  );
  return found?.id ?? null;
}

/**
 * What filling this instance's symmetry would do.
 *
 * Needs only the instance list and the main box — no scene — so it is cheap
 * enough for the sidebar to ask once per row on every render. The geometry that
 * does need a scene (which way each copy has to face) is deferred to
 * {@link symmetryCopies}, which runs once, when the button is pressed.
 *
 * Returns null for a part that is not fixed to the main box: a part hung off
 * *another* part has no symmetry of its own, it inherits its parent's, and
 * filling the parent carries it along.
 */
export function planSymmetryFill(
  instances: LampInstance[],
  mainBox: THREE.Box3,
  id: string
): SymmetryPlan | null {
  const instance = instances.find((i) => i.id === id);
  const target = instance?.connection?.target;
  if (!instance || target?.kind !== "mainBox") return null;

  // Distinct *places*, and a place is a **directed** line: the part meets the
  // box at `b1` and runs away from `b2`, so the same line with its ends swapped
  // is the part pinned at the other end, pointing the other way. That is
  // somewhere else on the lamp, not the same place twice.
  //
  // It is the half turn that makes this matter. On a face diagonal it lands the
  // line back on itself reversed — which is the diagonal *from the opposite
  // corner*, and the two corners a quarter turn cannot reach. Reading that as
  // "already claimed" is what left a diagonal joint with two of its four
  // corners empty.
  //
  // Turning over is the exception, and it is a real one: it is the operation
  // that can map a place onto itself end-for-end without moving the part
  // anywhere — every vertical arris does this — and there the reversal is the
  // same part hanging off the far end of the same line, into thin air. So a
  // turned-over op has to find a line no *upright* op already claimed, in
  // either direction. `SYMMETRY_OPS` runs the upright ones first for exactly
  // this.
  //
  // Against each other the turned-over ops are directed like everything else:
  // the reversal rule is there to stop turning over re-finding an upright
  // place, not to stop one turned-over corner being distinct from another.
  const slots = new Map<string, SymmetrySlot>();
  const upright = new Set<string>();
  for (const op of SYMMETRY_OPS) {
    const anchors: [Vec3, Vec3] = [
      moveAnchor(op, target.anchors[0].at),
      moveAnchor(op, target.anchors[1].at),
    ];
    const key = anchors.flat().join(",");
    const backwards = [anchors[1], anchors[0]].flat().join(",");
    if (slots.has(key)) continue;
    if (op.over && (upright.has(key) || upright.has(backwards))) continue;
    if (!op.over) upright.add(key);
    slots.set(key, {
      op,
      anchors,
      metric: isMetric(op, mainBox),
      occupiedBy: occupantOf(instances, instance.def.file, anchors),
    });
  }

  const all = [...slots.values()];
  const open = all.filter((slot) => !slot.occupiedBy);
  return {
    instanceId: id,
    slots: all,
    open,
    parametric: open.filter((slot) => !slot.metric).length,
  };
}

// ---------------------------------------------------------------------------
// Turning a slot into a connection
// ---------------------------------------------------------------------------

/** A copy the fill would make: where it attaches, and where that puts it. */
export interface SymmetryCopy {
  op: SymmetryOp;
  connection: LampConnection;
  placement: Placement;
}

/** Degrees into [0, 360), snapped to a quarter turn when it is within a hair. */
function tidyDegrees(radians: number): number {
  const degrees = ((THREE.MathUtils.radToDeg(radians) % 360) + 360) % 360;
  const quarter = Math.round(degrees / 90) * 90;
  return Math.abs(degrees - quarter) < 1e-3 ? quarter % 360 : Number(degrees.toFixed(3));
}

/**
 * The roll that makes the copy the original *moved*, rather than merely the
 * original re-aligned somewhere else.
 *
 * Two points fix an axis and leave a spin about it undetermined. `alignPlacement`
 * settles that by squaring the part up to the box, which is the right default for
 * one part but says nothing about a *family* of them: left alone, four
 * "symmetric" rails come out square in whichever of the 24 ways each one landed
 * nearest, and on a vertical arris all four come out facing the same way, which
 * is the one answer that is certainly wrong.
 *
 * So the wanted orientation is stated instead — `A = M · Q`, the original carried
 * through the operation — and `rollTowards` solves for the roll that reaches it
 * from `B`, the alignment with no roll of its own.
 *
 * Every operation being a rigid turn is what makes `A` **reachable**, so the fit
 * is exact and the copy is the original moved, to the last decimal — a face that
 * sat flush on the box sits flush on the copy. The fit is a fit rather than a
 * solve only for the one case that is not an isometry: a quarter turn on a plan
 * that is not square, where an oblique joint's axis does not survive the turn.
 * There it returns the nearest a real part can get, which is the honest answer.
 */
function rollFor(
  op: SymmetryOp,
  quaternion: THREE.Quaternion,
  a1: THREE.Vector3,
  a2: THREE.Vector3,
  b1: THREE.Vector3,
  b2: THREE.Vector3,
  fallback: number
): number {
  const axis = b1.clone().sub(b2);
  if (axis.lengthSq() < 1e-12) return fallback; // a point, not a line: no roll to set
  axis.normalize();

  const wanted = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeRotationFromQuaternion(quaternion).premultiply(matrixOf(op))
  );
  const base = alignPlacement(a1.clone(), a2.clone(), b1.clone(), b2.clone(), 0);

  const solved = rollTowards(base.quaternion, wanted, axis);
  return solved === null ? fallback : tidyDegrees(solved);
}

/**
 * The connections the fill would add — one per empty place, in orbit order.
 *
 * The part's own two anchors never change: it is the same component, picked at
 * the same two points on itself. Only where those points land moves, and which
 * way the part then faces.
 */
export function symmetryCopies(
  instances: LampInstance[],
  scene: LampScene,
  id: string
): SymmetryCopy[] {
  const instance = instances.find((i) => i.id === id);
  const connection = instance?.connection;
  const shape = scene.shapes.get(id);
  const placement = scene.placements.get(id);
  if (!instance || !connection || !shape || !placement) return [];

  const plan = planSymmetryFill(instances, scene.mainBox, id);
  if (!plan) return [];

  // block-aware: the part's own two points are on whichever of its blocks they
  // were picked on, and a copy is the same component picked at the same points
  const a1 = localPointOfAnchor(connection.source[0], shape);
  const a2 = localPointOfAnchor(connection.source[1], shape);

  // Two different anchor pairs can name the same joint — the same line picked
  // at the corner or at the edge's midpoint — so a place the anchors say is
  // empty can still have this part standing in it. Occupancy by anchor is what
  // the plan can afford; here, where the placements are in hand anyway, it is
  // checked again by where the part actually ends up.
  const taken = instances
    .filter((other) => other.def.file === instance.def.file)
    .map((other) => scene.placements.get(other.id))
    .filter((p): p is Placement => p !== undefined);

  // And a place already *filled* is one where a part is standing, whoever's it
  // is. Two anchors can name the same joint without being equal, and an
  // operation can land a copy half inside a part that is already there — a
  // turned-over diagonal comes back to the corner it started from, offset by
  // the part's own length — so the second test is on the solid, not the joint.
  // A copy that would occupy wood another part already occupies is not a copy
  // of anything; it is a collision, and the fill's job is to leave the lamp
  // buildable. Wood is the standard: parts that meet at a face, an arris or a
  // corner are a joint, not a clash.
  const filled = instances.flatMap((other) => {
    const otherShape = scene.shapes.get(other.id);
    const otherPlacement = scene.placements.get(other.id);
    return otherShape && otherPlacement ? placedBlocks(otherShape, otherPlacement) : [];
  });

  const copies: SymmetryCopy[] = [];
  for (const slot of plan.open) {
    const b1 = new THREE.Vector3(...pointOfAnchor(slot.anchors[0], scene.mainBox));
    const b2 = new THREE.Vector3(...pointOfAnchor(slot.anchors[1], scene.mainBox));
    const roll = rollFor(slot.op, placement.quaternion, a1, a2, b1, b2, connection.roll ?? 0);
    const placed = alignPlacement(a1.clone(), a2.clone(), b1, b2, roll);
    if (taken.some((other) => samePlacement(other, placed))) continue;
    const blocks = placedBlocks(shape, placed);
    if (blocks.some((block) => filled.some((other) => interpenetrates(block, other)))) continue;
    filled.push(...blocks);
    taken.push(placed);
    copies.push({
      op: slot.op,
      connection: {
        source: connection.source,
        target: {
          kind: "mainBox",
          anchors: [
            { at: slot.anchors[0], block: null },
            { at: slot.anchors[1], block: null },
          ],
        },
        roll,
      },
      // Stored so a copy that is later disconnected stands still instead of
      // jumping to the origin; while it is connected this is never read.
      placement: placed,
    });
  }
  return copies;
}

function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.position.distanceToSquared(b.position) < 1e-12 &&
    Math.abs(a.quaternion.dot(b.quaternion)) > 1 - 1e-9
  );
}

/**
 * One block of a placed component, as a box in a frame of its own.
 *
 * The **block**, not the component: a component is a recipe of several boxes,
 * and its encasing box is mostly air for anything L-shaped or notched. Testing
 * a copy by that box refuses joints that in truth had room, which is the wrong
 * way for a rule to be wrong. And the frame, not an axis-aligned box round it:
 * a part turned onto a diagonal has an encasing box far larger than the part,
 * and again the extra is air.
 */
interface PlacedBlock {
  centre: THREE.Vector3;
  half: THREE.Vector3;
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

function placedBlocks(shape: InstanceShape, placement: Placement): PlacedBlock[] {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(placement.quaternion);
  const axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3().setFromMatrixColumn(m, 0),
    new THREE.Vector3().setFromMatrixColumn(m, 1),
    new THREE.Vector3().setFromMatrixColumn(m, 2),
  ];
  return shape.boxes.map((box) => ({
    centre: box
      .getCenter(new THREE.Vector3())
      .applyQuaternion(placement.quaternion)
      .add(placement.position),
    half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5),
    axes,
  }));
}

/**
 * Whether two blocks share wood, rather than a face, an arris or a corner.
 *
 * Parts are *meant* to touch — that is what a joint is — so coincident faces,
 * edges and vertices all have to read as clear. They overlap by exactly nothing,
 * which floating point renders as a hair either side of nothing, so both blocks
 * are shrunk by half a margin before the test: anything that merely touches
 * comes apart, and only a real overlap survives. A hundredth of a millimetre is
 * far below what a saw can hold and far above the hair.
 *
 * Fifteen candidate separating axes — three per block, and the nine cross
 * products of their axis pairs — is the whole of the separating-axis theorem for
 * two boxes: find one axis on which their shadows do not meet and they are
 * apart; find none and they are not. Exact for boxes at any angle, which matters
 * because a part on a diagonal is at some angle to everything else on the lamp.
 */
const TOUCHING_MM = 0.01;

function interpenetrates(a: PlacedBlock, b: PlacedBlock): boolean {
  const pull = TOUCHING_MM / 2;
  const ha = [a.half.x - pull, a.half.y - pull, a.half.z - pull].map((v) => Math.max(v, 0));
  const hb = [b.half.x - pull, b.half.y - pull, b.half.z - pull].map((v) => Math.max(v, 0));

  // `abs` is nudged so a pair of parallel axes, where the cross product is zero
  // and its test degenerates, does not report a spurious gap
  const r: number[][] = [];
  const abs: number[][] = [];
  for (let i = 0; i < 3; i++) {
    r[i] = [];
    abs[i] = [];
    for (let j = 0; j < 3; j++) {
      r[i][j] = a.axes[i].dot(b.axes[j]);
      abs[i][j] = Math.abs(r[i][j]) + 1e-9;
    }
  }

  const d = b.centre.clone().sub(a.centre);
  const t = [d.dot(a.axes[0]), d.dot(a.axes[1]), d.dot(a.axes[2])];

  // one block's own three axes, then the other's
  for (let i = 0; i < 3; i++) {
    const rb = hb[0] * abs[i][0] + hb[1] * abs[i][1] + hb[2] * abs[i][2];
    if (Math.abs(t[i]) > ha[i] + rb) return false;
  }
  for (let j = 0; j < 3; j++) {
    const ra = ha[0] * abs[0][j] + ha[1] * abs[1][j] + ha[2] * abs[2][j];
    if (Math.abs(t[0] * r[0][j] + t[1] * r[1][j] + t[2] * r[2][j]) > ra + hb[j]) return false;
  }

  // the nine cross products, as (i, j) with the two axes each one is built from
  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3;
      const j2 = (j + 2) % 3;
      const ra = ha[i1] * abs[i2][j] + ha[i2] * abs[i1][j];
      const rb = hb[j1] * abs[i][j2] + hb[j2] * abs[i][j1];
      if (Math.abs(t[i2] * r[i1][j] - t[i1] * r[i2][j]) > ra + rb) return false;
    }
  }

  return true;
}

/**
 * Whether two placed parts share wood — the rule the fill refuses on.
 *
 * Block against block, so a component is judged by the material it is made of
 * rather than by the box that would contain it. Touching is not sharing: two
 * parts meeting at a face, an arris or a corner are a joint.
 */
export function partsOverlap(
  a: InstanceShape,
  placementA: Placement,
  b: InstanceShape,
  placementB: Placement
): boolean {
  const blocks = placedBlocks(b, placementB);
  return placedBlocks(a, placementA).some((one) =>
    blocks.some((other) => interpenetrates(one, other))
  );
}

/**
 * Everything hanging off an instance, however deep.
 *
 * A filled copy has to bring these: a panel with beads on it is one thing to
 * the user, and putting the bare panel on the other three faces would be a fill
 * that did three quarters of the job.
 */
export function subtreeOf(instances: LampInstance[], rootId: string): LampInstance[] {
  const found: LampInstance[] = [];
  const seen = new Set([rootId]);
  const frontier = [rootId];
  while (frontier.length > 0) {
    const parent = frontier.pop()!;
    for (const instance of instances) {
      const target = instance.connection?.target;
      if (target?.kind !== "instance" || target.id !== parent || seen.has(instance.id)) continue;
      seen.add(instance.id);
      found.push(instance);
      frontier.push(instance.id);
    }
  }
  return found;
}
