import * as THREE from "three";
import type { InstanceShape, LampInstance, LampScene } from "./lamp";

/**
 * What the lamp is made of, counted.
 *
 * The whole of this is a group-by, and that is the point worth stating: the app
 * stores no piece list and it does not need one. `computeScene` cuts every
 * instance at the current variables on every render, so the parts are already
 * there as boxes — how many of each there are is a question about the design,
 * not a second copy of it that could drift.
 *
 * Two levels of counting, because two different people are asking:
 *
 * - **By component** — "the lamp has four corner posts, and each is three
 *   pieces" — which is how the thing goes together.
 * - **By size** — "cut twelve sticks at 240 x 7 x 7" — which is how it gets made.
 *   Identical pieces merge across components here, because at the saw a piece is
 *   nothing but its three dimensions.
 */

/** One piece: three dimensions, longest first. */
export type PieceSize = [number, number, number];

export interface Piece {
  /**
   * The block's id in the component file — a UUID, and traceability rather than
   * a name. Nothing shows it to anybody; see {@link Piece.label}.
   */
  block: string;
  /**
   * What the piece is called on a drawing.
   *
   * Its position in the component, because that is the only thing about it that
   * a person can use. The editor names blocks with UUIDs, and a cut list headed
   * `d8b37dab-475b-458e-aa8b-a58c820a7075` says less than `piece 3` while taking
   * eight times the room to say it.
   */
  label: string;
  size: PieceSize;
}

export interface ComponentTally {
  name: string;
  file: string;
  /** How many of this component are on the lamp. */
  instances: number;
  /** The pieces in *one* of them. */
  pieces: Piece[];
  /** `pieces.length * instances`. */
  totalPieces: number;
}

export interface CutRow {
  size: PieceSize;
  quantity: number;
  /** The components that want a piece this size, in the order they appear. */
  from: string[];
}

export interface CutList {
  components: ComponentTally[];
  rows: CutRow[];
  totalPieces: number;
  /** Distinct sizes to cut. */
  distinctSizes: number;
}

// A tenth of a millimetre. Sizes are evaluated formulas, so two pieces meant to
// be identical agree to floating-point noise rather than exactly, and a cut list
// that lists 240 and 239.9999 as two different sticks is worse than no cut list.
const SIZE_DECIMALS = 1;

const round = (value: number) => Number(value.toFixed(SIZE_DECIMALS));

/**
 * A box as a piece of timber: three dimensions, longest first.
 *
 * Sorted because at the saw a 240 x 7 x 7 stick standing up and one lying down
 * are the same stick, and which axis a part happens to run along in the file is
 * a fact about the model rather than about the cut.
 */
export function pieceSize(box: THREE.Box3): PieceSize {
  const size = box.getSize(new THREE.Vector3());
  return [round(size.x), round(size.y), round(size.z)].sort((a, b) => b - a) as PieceSize;
}

const sizeKey = (size: PieceSize) => size.join("x");

/** A piece size as it is written on a cut list. */
export function sizeLabel(size: PieceSize): string {
  return size.map((n) => String(n)).join(" × ");
}

function piecesOf(shape: InstanceShape): Piece[] {
  return shape.boxes.map((box, i) => ({
    block: shape.blocks[i] ?? `block ${i + 1}`,
    label: `piece ${i + 1}`,
    size: pieceSize(box),
  }));
}

/**
 * Tally a lamp.
 *
 * Instances are grouped by the component *file*, not by the label: two copies of
 * the same component are two of one thing however they were named on insert, and
 * every instance of a component is cut from the same formulas at the same
 * variables, so one of them stands for all.
 *
 * @param hidden ids being hidden while the design is worked on. They are still
 *        part of the lamp — hiding is a way of seeing past something, not a way
 *        of removing it — so they are counted. Passing them is what lets a
 *        caller say otherwise.
 */
export function buildCutList(
  instances: LampInstance[],
  scene: LampScene,
  hidden: readonly string[] = []
): CutList {
  const skip = new Set(hidden);
  const byFile = new Map<string, ComponentTally>();

  for (const instance of instances) {
    if (skip.has(instance.id)) continue;
    const shape = scene.shapes.get(instance.id);
    if (!shape) continue;
    const existing = byFile.get(instance.def.file);
    if (existing) {
      existing.instances++;
      existing.totalPieces = existing.pieces.length * existing.instances;
      continue;
    }
    const pieces = piecesOf(shape);
    byFile.set(instance.def.file, {
      name: instance.def.name,
      file: instance.def.file,
      instances: 1,
      pieces,
      totalPieces: pieces.length,
    });
  }

  const components = [...byFile.values()].sort((a, b) => a.name.localeCompare(b.name));

  const rows = new Map<string, CutRow>();
  for (const component of components) {
    for (const piece of component.pieces) {
      const key = sizeKey(piece.size);
      const row = rows.get(key);
      if (row) {
        row.quantity += component.instances;
        if (!row.from.includes(component.name)) row.from.push(component.name);
      } else {
        rows.set(key, {
          size: piece.size,
          quantity: component.instances,
          from: [component.name],
        });
      }
    }
  }

  // Longest first: a cut list is read in the order the stock is broken down, and
  // the long pieces are the ones that decide what length of stock is needed.
  const ordered = [...rows.values()].sort(
    (a, b) => b.size[0] - a.size[0] || b.size[1] - a.size[1] || b.size[2] - a.size[2]
  );

  return {
    components,
    rows: ordered,
    totalPieces: components.reduce((n, c) => n + c.totalPieces, 0),
    distinctSizes: ordered.length,
  };
}

/** Total length of stock, by section, in metres — what actually gets bought. */
export function stockBySection(list: CutList): Array<{ section: string; metres: number; pieces: number }> {
  const bySection = new Map<string, { metres: number; pieces: number }>();
  for (const row of list.rows) {
    const section = `${row.size[1]} × ${row.size[2]}`;
    const entry = bySection.get(section) ?? { metres: 0, pieces: 0 };
    entry.metres += (row.size[0] * row.quantity) / 1000;
    entry.pieces += row.quantity;
    bySection.set(section, entry);
  }
  return [...bySection.entries()]
    .map(([section, entry]) => ({ section, ...entry }))
    .sort((a, b) => b.metres - a.metres);
}
