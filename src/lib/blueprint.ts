import * as THREE from "three";
import type { Edge, Vec3 } from "../store/useComponentEditorStore";
import { outlineOfBoxes } from "./lamp";
import { viewCameraBasis } from "./picking";
import { solidRuns, stationsAlong, type Run } from "./measure";
import {
  dimensionReserve,
  formatLength,
  planDimensions,
  type DimBounds,
  type DimSeg,
} from "./dimensions";
import { clipText, textWidth, type PdfPage, type Seg } from "./pdf";

/**
 * A drawing sheet: projecting a design onto paper, and inking it.
 *
 * The screen and the page want the same drawing and almost none of the same
 * machinery. A cell frames on a zoom the user turns, draws with a renderer,
 * measures in pixels and can afford to redraw when a number changes. A sheet is
 * fixed at a **stated scale**, draws by writing coordinates into a file, and is
 * produced once. So this is a second front end onto the parts that are actually
 * shared — the box-union outline, the hidden-line pass and the dimension-chain
 * layout — rather than a print mode bolted onto the views.
 *
 * ## Colour, and what "blueprint style" can honestly mean on paper
 *
 * A blueprint was a contact print: white lines on cyanotype blue, because that
 * is what the process produced, not because anybody chose it. A PDF has one set
 * of colours, so a page that *looked* like a negative on screen and *printed*
 * positive would need optional-content groups, which the viewer most people
 * open a PDF in ignores.
 *
 * What actually makes a drawing read as a blueprint is the drafting, not the
 * dye: graph paper under the drawing, hidden work dashed, chains of dimensions
 * in two margins, a stated scale, a title block. All of that survives being
 * printed the right way up. So the default palette is dark blue ink on white —
 * which prints as near-black on any machine and costs nothing in toner — and
 * the negative is offered for looking at on screen, where it belongs.
 */

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

export interface Palette {
  paper: string;
  /** Sheet border and title block. */
  frame: string;
  /** Visible arrises. */
  line: string;
  /** Hidden arrises, dashed. */
  hidden: string;
  /** Dimension and extension lines. */
  dim: string;
  dimText: string;
  gridMinor: string;
  gridMajor: string;
  text: string;
  faint: string;
}

/**
 * The default. Dark blue on white — a drawing, printable on anything.
 *
 * The two greys the grid is in are chosen to survive being flattened to
 * greyscale without muddying the drawing over them: they land near 90% and 80%
 * white, which a laser printer renders as paper and a faint tint.
 */
export const PRINT_PALETTE: Palette = {
  paper: "#ffffff",
  frame: "#12325c",
  line: "#12325c",
  hidden: "#7b93b5",
  dim: "#4a6b8f",
  dimText: "#0f2547",
  gridMinor: "#e6eef8",
  gridMajor: "#cfdff1",
  text: "#0f2547",
  faint: "#8ba2bf",
};

/** The negative, for reading on screen. The app's own blueprint colours. */
export const NEGATIVE_PALETTE: Palette = {
  paper: "#0b2145",
  frame: "#bfe1ff",
  line: "#bfe1ff",
  hidden: "#5b7fb5",
  dim: "#5b7fb5",
  dimText: "#d8e9ff",
  gridMinor: "#152c53",
  gridMajor: "#22457c",
  text: "#d8e9ff",
  faint: "#5b7fb5",
};

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------

/**
 * Sheet sizes, in millimetres, stated long edge first.
 *
 * Which way up a sheet is used is not a property of the size — see
 * `paperSheet`, which turns one of these and an orientation into the page.
 */
export const PAPER = {
  a4: { long: 297, short: 210, label: "A4" },
  a3: { long: 420, short: 297, label: "A3" },
  letter: { long: 279.4, short: 215.9, label: "Letter" },
} as const;

export type PaperSize = keyof typeof PAPER;

/** Landscape is wider than it is tall; portrait the other way up. */
export type PaperOrientation = "landscape" | "portrait";

/** One sheet size, the right way up. */
export function paperSheet(
  size: PaperSize,
  orientation: PaperOrientation
): { width: number; height: number } {
  const { long, short } = PAPER[size];
  return orientation === "landscape"
    ? { width: long, height: short }
    : { width: short, height: long };
}

/** A rectangle on the sheet, in paper millimetres, y up from the bottom-left. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Ink weights, in millimetres. The visible outline is the heaviest thing on the
// page and the dimension work the lightest, which is the ordinary drafting
// hierarchy: the part first, what is behind it second, what is being said about
// it third.
export const WEIGHT = {
  line: 0.35,
  hidden: 0.18,
  dim: 0.13,
  frame: 0.5,
  grid: 0.08,
} as const;

/** Text sizes on paper, in millimetres. */
export const TYPE = {
  dimension: 2.2,
  caption: 2.6,
  heading: 3.6,
  title: 5,
  small: 2,
} as const;

// The dimension chain's fixed sizes, on the paper rather than in the model.
const PAPER_METRICS = { text: TYPE.dimension, gap: 3.5, arrow: 1.6, overrun: 1 };
/** The strip a chain claims outside the drawing, on all four sides. */
export const DIM_RESERVE_MM = dimensionReserve(PAPER_METRICS);

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

/**
 * The conventional ratios, largest first — kept for reference, and for a caller
 * that would rather state one of these than fill its cell.
 *
 * They are no longer what the fit snaps to. The ladder steps by a factor of 2 or
 * 2.5, so snapping down to it throws away up to half the linear size of a
 * drawing: a lamp that exactly fits at 1:3 is drawn at 1:5, which on a 181 mm
 * cell leaves 60 mm of white space on every side. Stating a conventional ratio
 * is worth something, but not that.
 */
export const SCALES = [5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01] as const;

/**
 * The exact fit, reduced to a ratio short enough to print.
 *
 * Rounded **up** in the ratio, so the drawing still fits — 1:3.012 becomes 1:3.02
 * and never 1:3.01. Three significant figures costs at most 1% of the linear
 * size, which on the largest cell on the sheet is under 2 mm of slack, against
 * the tens of millimetres the conventional ladder was costing.
 */
export function statedScale(exact: number): number {
  if (!Number.isFinite(exact) || exact <= 0) return SCALES[SCALES.length - 1];
  const ratio = 1 / exact;
  const step = Math.pow(10, Math.floor(Math.log10(ratio)) - 2);
  return 1 / (Math.ceil(ratio / step) * step);
}

/**
 * A scale as it is written: paper to model.
 *
 * Two decimals at most, and trailing zeros dropped, so a drawing that does land
 * on a conventional ratio still says `1:10` rather than `1:10.00`.
 */
export function scaleLabel(scale: number): string {
  const ratio = scale >= 1 ? scale : 1 / scale;
  const text = String(Number(ratio.toFixed(2)));
  return scale >= 1 ? `${text}:1` : `1:${text}`;
}

/**
 * The largest ratio at which a drawing and its dimensions fit a frame.
 *
 * The reserved strip comes off first and is the same on all four sides, so what
 * is left is centred on the drawing rather than pushed over by its own numbers.
 * The ratio is the exact fit rounded to something printable — see `statedScale`
 * for why it is no longer snapped to the conventional ladder.
 */
/**
 * Is there room in this cell for dimension chains at all?
 *
 * The reserve is an absolute 8.9 mm on every side — it has to be, since it is
 * holding lettering at a fixed size — so it takes 17.8 mm out of a cell whatever
 * that cell measures. Below about twice that there is nothing left to draw in,
 * and a chain laid out anyway does not shrink politely: it runs straight out of
 * the cell and over its neighbours.
 *
 * So a cell too small to be dimensioned is drawn undimensioned instead. That is
 * a visible loss rather than a silent one — the numbers are simply absent — and
 * it is the honest outcome, because lettering scaled to fit a 7 mm band would be
 * four tenths of a millimetre tall and no more readable than nothing at all.
 */
export function canDimension(frame: Frame): boolean {
  const needed = DIM_RESERVE_MM * 2;
  return frame.width > needed * 1.5 && frame.height > needed * 1.5;
}

export function fitScale(
  bounds: DimBounds,
  frame: Frame,
  dimensioned = true,
  /**
   * Room to leave on all four sides, when the caller knows better than the two
   * defaults. Zero for a drawing that carries no caption and no chains: it has
   * nothing to leave room *for*, and reserving anyway is the cell's height spent
   * on nothing.
   */
  reserveOverride?: number
): number {
  const reserve =
    reserveOverride ?? (dimensioned && canDimension(frame) ? DIM_RESERVE_MM : TYPE.caption);
  const availableW = Math.max(frame.width - reserve * 2, 1);
  const availableH = Math.max(frame.height - reserve * 2, 1);
  const spanU = Math.max(bounds.maxU - bounds.minU, 1e-6);
  const spanV = Math.max(bounds.maxV - bounds.minV, 1e-6);
  return statedScale(Math.min(availableW / spanU, availableH / spanV));
}

// ---------------------------------------------------------------------------
// Projecting
// ---------------------------------------------------------------------------

/** The three orthographic views, plus the pictorial one. */
export const SHEET_VIEWS = {
  front: { normal: [0, 0, 1] as Vec3, label: "FRONT" },
  side: { normal: [1, 0, 0] as Vec3, label: "SIDE" },
  top: { normal: [0, 1, 0] as Vec3, label: "TOP" },
  pictorial: { normal: [1, 0.8, 1] as Vec3, label: "PICTORIAL" },
} as const;

export type SheetViewId = keyof typeof SHEET_VIEWS;

/**
 * The direction a piece is drawn from, which depends on which way it is lying.
 *
 * A piece is drawn in a cell far wider than it is tall (or far taller than it is
 * wide), because pieces are laid in a line. The drawing has to be about that
 * shape too, or its own height sets the scale and a 370 mm stick comes out half
 * the size it could have been.
 *
 * **Stood on end, nothing needs doing.** `up` is derived from world +Y, so
 * `right` is perpendicular to +Y for *any* view direction — a piece whose length
 * runs up the Y axis therefore projects exactly vertically no matter where the
 * viewer stands. The ordinary pictorial is already ideal for it.
 *
 * **Laid flat, the pictorial tilts it.** The same view puts a 370 mm stick at
 * 26° off horizontal, which is 153 mm of rise in a row 12 mm tall: the piece is
 * drawn at less than half the size the row could carry. Flattening the view to
 * `0.3, 0.35, 1` brings the rise to 16% of the run — just under what the row can
 * take, so length rather than height sets the scale — while still turning three
 * faces toward the reader. Going flatter than this buys nothing and only makes
 * the section harder to read.
 */
export const PIECE_VIEW = {
  horizontal: [0.3, 0.35, 1] as Vec3,
  vertical: [1, 0.8, 1] as Vec3,
} as const;

/** A design projected into one view's plane, in model millimetres. */
export interface Drawing {
  visible: DimSeg[];
  hidden: DimSeg[];
  bounds: DimBounds;
  /** Per-axis faces, for the chains to hang off. */
  stations: [number[], number[], number[]];
  /** Where the model actually has material, for telling a feature from a gap. */
  runs: [Run[], Run[], Run[]];
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/**
 * The coordinates each axis has a face at.
 *
 * `axisStations` answers this from triangles, by area, because a CSG solid's
 * faces have to be recovered from its tessellation. Every part here is an
 * axis-aligned box and a box states its six faces directly, so this reads them
 * off instead of re-deriving them — exact, and without building the geometry
 * that would be thrown away straight after.
 */
export function boxStations(boxes: THREE.Box3[]): [number[], number[], number[]] {
  if (boxes.length === 0) return [[], [], []];
  const overall = new THREE.Box3();
  for (const box of boxes) overall.union(box);
  const tol = Math.max(...overall.getSize(new THREE.Vector3()).toArray()) * 0.002;

  return [0, 1, 2].map((axis) => {
    const coords: number[] = [];
    for (const box of boxes) {
      coords.push(box.min.getComponent(axis), box.max.getComponent(axis));
    }
    coords.sort((a, b) => a - b);
    const merged: number[] = [];
    for (const coord of coords) {
      if (merged.length === 0 || coord - merged[merged.length - 1] > tol) merged.push(coord);
    }
    return merged;
  }) as [number[], number[], number[]];
}

// How much material has to be in the way before a point is behind something,
// and how far off a face's plane a point has to be to be inside it. Both are far
// below any real feature of a lamp — the thinnest part in the library is a 3.5 mm
// half-lap — and far above the noise in coordinates that came out of the
// evaluator as decimal millimetres.
const THROUGH_MM = 1e-3;
const ON_FACE_MM = 1e-4;

/**
 * Is the view of this point blocked by any of the boxes?
 *
 * A slab test per box, asking one question the obvious way: does the ray from
 * here toward the camera pass **through** material, rather than merely touch it?
 *
 * That distinction is the whole reason this exists instead of a raycast. Rays in
 * this app graze constantly — every part is axis-aligned, parts are laid out on a
 * regular grid, and the pictorial view looks along a direction with equal x and z
 * — so a ray leaving an arris routinely arrives exactly at the *corner* of a part
 * some whole number of millimetres away, entering and leaving it at the same
 * instant. A triangle raycaster counts that as a hit; it is not one, and counting
 * it lost 8% of the visible outline of the shipped lamp, including whole
 * full-height arrises of the frame.
 *
 * The same grazing happens in the axis-aligned views wherever a ray runs along a
 * face rather than across it, which is why a coplanar axis has to be *strictly*
 * inside the slab to count at all.
 */
function blocked(p: THREE.Vector3, direction: THREE.Vector3, boxes: THREE.Box3[]): boolean {
  for (const box of boxes) {
    let tmin = 0;
    let tmax = Infinity;
    for (const axis of AXES) {
      const origin = p[axis];
      const d = direction[axis];
      const lo = box.min[axis];
      const hi = box.max[axis];
      if (Math.abs(d) < 1e-12) {
        // The ray never crosses this pair of faces. It only stays inside them if
        // it started strictly between them — running *along* a face is grazing.
        if (origin <= lo + ON_FACE_MM || origin >= hi - ON_FACE_MM) {
          tmax = -1;
          break;
        }
        continue;
      }
      const t1 = (lo - origin) / d;
      const t2 = (hi - origin) / d;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (tmax - tmin > THROUGH_MM) return true;
  }
  return false;
}

const AXES = ["x", "y", "z"] as const;

/**
 * Split every edge into the stretches that can be seen and the ones that cannot.
 *
 * The same shape of answer as `splitVisibleHidden` in `assembly.ts` and the same
 * sampling: walk the edge, classify each sample, and close a run at the midpoint
 * between the two samples that disagreed. What is different is the classifier —
 * exact arithmetic against the boxes rather than raycasts against a tessellation
 * of them — which also means there is no surface offset to tune, nothing to lift
 * a ray origin off, and no dependence on which way a triangle happens to face.
 *
 * It is cheaper, too: a slab test per box against a ray, with no BVH and no
 * triangle intersection, so the step can be finer than the raycasting version
 * could afford.
 */
function splitAgainstBoxes(
  edges: Edge[],
  boxes: THREE.Box3[],
  direction: THREE.Vector3,
  step: number
): { visible: number[]; hidden: number[] } {
  const visible: number[] = [];
  const hidden: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const p = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();

  for (const edge of edges) {
    a.fromArray(edge.start);
    b.fromArray(edge.end);
    const length = a.distanceTo(b);
    const samples = Math.max(2, Math.ceil(length / step));

    const push = (isHidden: boolean, t0: number, t1: number) => {
      if (t1 - t0 < 1e-6) return;
      from.lerpVectors(a, b, t0);
      to.lerpVectors(a, b, t1);
      const out = isHidden ? hidden : visible;
      out.push(from.x, from.y, from.z, to.x, to.y, to.z);
    };

    // Sampled at the **centre** of each step rather than at its ends, which
    // keeps every sample off the edge's own endpoints. Those endpoints are
    // corners of the solid, where the ray leaves along the surface and nothing
    // is in front of it — so sampling them reports the far corner of a hidden
    // arris as visible and leaves a bright stub on a line that should be dashed
    // all the way.
    let runHidden: boolean | null = null;
    let runStart = 0;
    for (let s = 0; s < samples; s++) {
      p.lerpVectors(a, b, (s + 0.5) / samples);
      const isHidden = blocked(p, direction, boxes);
      if (runHidden === null) runHidden = isHidden;
      else if (isHidden !== runHidden) {
        const boundary = s / samples;
        push(runHidden, runStart, boundary);
        runHidden = isHidden;
        runStart = boundary;
      }
    }
    if (runHidden !== null) push(runHidden, runStart, 1);
  }

  return { visible, hidden };
}

function project(positions: number[], right: THREE.Vector3, up: THREE.Vector3): DimSeg[] {
  const out: DimSeg[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i + 5 < positions.length; i += 6) {
    p.set(positions[i], positions[i + 1], positions[i + 2]);
    const u0 = p.dot(right);
    const v0 = p.dot(up);
    p.set(positions[i + 3], positions[i + 4], positions[i + 5]);
    out.push({ u0, v0, u1: p.dot(right), v1: p.dot(up) });
  }
  return out;
}

/**
 * Project a design's boxes into one view.
 *
 * The outline is `outlineOfBoxes`, which is the lamp's own answer to "what are
 * the creases of this union" — a fraction of a millisecond where a CSG union
 * costs tens, and it leaves out the seams where two parts butt flush, which are
 * not bends in anything and have no business on a drawing.
 *
 * `withHidden` is worth switching off for a pictorial view, where dashed lines
 * through a whole lamp are noise rather than information — but the pass still
 * runs, because it is also what stops the far side of the object being drawn
 * through the near side.
 */
export function projectDrawing(
  boxes: THREE.Box3[],
  normal: Vec3,
  options: { withHidden?: boolean } = {}
): Drawing {
  const { direction, up } = viewCameraBasis(normal);
  const right = new THREE.Vector3().crossVectors(up, direction);

  const overall = new THREE.Box3();
  for (const box of boxes) overall.union(box);
  const empty: Drawing = {
    visible: [],
    hidden: [],
    bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 },
    stations: [[], [], []],
    runs: [[], [], []],
    right,
    up,
  };
  if (boxes.length === 0 || overall.isEmpty()) return empty;

  const radius = Math.max(overall.getSize(new THREE.Vector3()).length() / 2, 1e-6);
  // A finer step than the raycasting pass could afford, because a slab test per
  // box is a fraction of the cost of intersecting a tessellation.
  const split = splitAgainstBoxes(outlineOfBoxes(boxes), boxes, direction, radius / 200);

  // Framed on the projected bounding box rather than on a sphere: a sphere is
  // the same size in every view, which would leave a flat design marooned in the
  // two views that see it edge-on.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? overall.max.x : overall.min.x,
      i & 2 ? overall.max.y : overall.min.y,
      i & 4 ? overall.max.z : overall.min.z
    );
    const u = corner.dot(right);
    const v = corner.dot(up);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }

  return {
    visible: project(split.visible, right, up),
    hidden: options.withHidden === false ? [] : project(split.hidden, right, up),
    bounds: { minU, maxU, minV, maxV },
    stations: boxStations(boxes),
    runs: solidRuns(boxes),
    right,
    up,
  };
}

// ---------------------------------------------------------------------------
// Inking
// ---------------------------------------------------------------------------

/**
 * A piece as a box, turned to be drawn.
 *
 * Two decisions, in order:
 *
 * 1. **Which way it lies.** The longest dimension goes on the axis the caller is
 *    laying pieces along — across the sheet, or up it. A piece is drawn as
 *    *stock*, not as it happens to sit in the lamp: a 240 mm stick is a 240 mm
 *    stick whether it ended up a leg or a rail, and it is the same row of the
 *    cut list either way.
 * 2. **Which way up.** That leaves the other two dimensions free to swap, and
 *    the one to pick is whichever **shows the most**. For a box seen
 *    pictorially, three faces are toward the viewer and three away, so what
 *    "shows the most" means is the largest projected area — which is the sum of
 *    each face pair's area weighted by how square-on the view is to it.
 *
 * Every piece in this app is a plain box today, and the two candidates in step 2
 * are often within a few percent of each other. They stop being close the moment
 * a piece has a lap or a housing cut into it, which is exactly when it matters
 * which face is turned toward the reader.
 */
export function stockOrientation(
  boxes: THREE.Box3[],
  lay: "horizontal" | "vertical",
  normal: Vec3
): THREE.Box3[] {
  if (boxes.length === 0) return [];
  const longAxis = lay === "horizontal" ? 0 : 1;

  let best: THREE.Box3[] | null = null;
  let bestSeen = -1;
  for (const rotation of BOX_ROTATIONS) {
    const turned = applyRotation(boxes, rotation);
    const overall = new THREE.Box3();
    for (const box of turned) overall.union(box);
    const size = overall.getSize(new THREE.Vector3()).toArray();
    // Only the turns that put the piece's length along the line it is laid in.
    if (size.indexOf(Math.max(...size)) !== longAxis) continue;

    // Of those, the one that shows the most: measured as the length of outline
    // actually in front, which is what "hides the least" means once a piece has
    // a lap or a housing in it. On a plain box every candidate ties, and the
    // first is taken — deterministically, since the rotations are a fixed list.
    const drawing = projectDrawing(turned, normal, { withHidden: false });
    const seen = drawing.visible.reduce(
      (n, s) => n + Math.hypot(s.u1 - s.u0, s.v1 - s.v0),
      0
    );
    if (seen > bestSeen + 1e-6) {
      bestSeen = seen;
      best = turned;
    }
  }
  return best ?? boxes;
}

/**
 * The 24 rotations that carry a box onto itself — every signed permutation of
 * the axes with a right-handed result.
 *
 * A reflection is not something a piece of wood can do, which is why the
 * left-handed half is dropped rather than merely unused: a drawing of a mirrored
 * part is a drawing of a part nobody can cut.
 */
const BOX_ROTATIONS: Array<[number, number, number, number, number, number]> = (() => {
  const out: Array<[number, number, number, number, number, number]> = [];
  for (const [i, j, k] of [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]) {
    // Even permutations are right-handed with all-positive signs; odd ones need
    // an odd number of flips to come back to a rotation.
    const even = [i, j, k].join() === "0,1,2" || [i, j, k].join() === "1,2,0" || [i, j, k].join() === "2,0,1";
    for (const signs of [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ]) {
      const flip = even ? signs : [signs[0], signs[1], -signs[2]];
      out.push([i, j, k, flip[0], flip[1], flip[2]]);
    }
  }
  return out;
})();

/** Turn every box by one of {@link BOX_ROTATIONS}, then bring back to the origin. */
function applyRotation(
  boxes: THREE.Box3[],
  [i, j, k, sx, sy, sz]: [number, number, number, number, number, number]
): THREE.Box3[] {
  const source = [i, j, k];
  const signs = [sx, sy, sz];
  const turned = boxes.map((box) => {
    const min = box.min.toArray();
    const max = box.max.toArray();
    const out = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let corner = 0; corner < 8; corner++) {
      const from = [
        corner & 1 ? max[0] : min[0],
        corner & 2 ? max[1] : min[1],
        corner & 4 ? max[2] : min[2],
      ];
      point.set(
        from[source[0]] * signs[0],
        from[source[1]] * signs[1],
        from[source[2]] * signs[2]
      );
      out.expandByPoint(point);
    }
    return out;
  });
  // A piece is drawn as a shape, not at a position, so it starts at the origin.
  const overall = new THREE.Box3();
  for (const box of turned) overall.union(box);
  for (const box of turned) {
    box.min.sub(overall.min);
    box.max.sub(overall.min);
  }
  return turned;
}

/**
 * Are these two views of the design the same drawing?
 *
 * Compared as *shapes* — each is shifted to its own origin first — because the
 * question being asked is whether a second elevation would tell a reader
 * anything. A lamp square in plan draws the same front and side, and putting
 * both on the sheet spends a quarter of the page saying it twice.
 *
 * Exact rather than approximate: both drawings come out of the same arithmetic
 * on the same evaluated numbers, so two faces that are meant to be identical
 * agree to well within the rounding here, and two that differ do so by
 * millimetres.
 *
 * Compared as **sets**, with coincident segments collapsed. A projection
 * routinely draws one line twice — two arrises at different depths land on top
 * of each other, which is what a square-in-plan design does constantly — and how
 * many times a line was drawn on top of itself is not something a reader can
 * see. Counting multiplicity called every symmetric lamp in the library
 * asymmetric.
 */
export function sameDrawing(a: Drawing, b: Drawing): boolean {
  const key = (drawing: Drawing) => {
    const { minU, minV } = drawing.bounds;
    const canonical = (segments: DimSeg[]) => {
      const seen = new Set<string>();
      for (const s of segments) {
        const p: [number, number, number, number] =
          s.u0 < s.u1 || (s.u0 === s.u1 && s.v0 <= s.v1)
            ? [s.u0 - minU, s.v0 - minV, s.u1 - minU, s.v1 - minV]
            : [s.u1 - minU, s.v1 - minV, s.u0 - minU, s.v0 - minV];
        seen.add(p.map((n) => n.toFixed(3)).join(","));
      }
      return [...seen].sort().join(";");
    };
    return `${canonical(drawing.visible)}|${canonical(drawing.hidden)}`;
  };
  return key(a) === key(b);
}

/** Model plane to paper, at a scale, centred in a frame. */
export interface Placement {
  scale: number;
  toPaper: (u: number, v: number) => { x: number; y: number };
}

export function placement(bounds: DimBounds, frame: Frame, scale: number): Placement {
  const midU = (bounds.minU + bounds.maxU) / 2;
  const midV = (bounds.minV + bounds.maxV) / 2;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  return {
    scale,
    toPaper: (u, v) => ({ x: cx + (u - midU) * scale, y: cy + (v - midV) * scale }),
  };
}

const paperSegs = (segments: DimSeg[], place: Placement): Seg[] =>
  segments.map((s) => {
    const a = place.toPaper(s.u0, s.v0);
    const b = place.toPaper(s.u1, s.v1);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  });

/** Graph paper, in paper millimetres, clipped to a frame. */
export function paintGrid(page: PdfPage, frame: Frame, palette: Palette, pitch = 5): void {
  const levels: Array<{ step: number; colour: string }> = [
    { step: pitch, colour: palette.gridMinor },
    { step: pitch * 5, colour: palette.gridMajor },
  ];
  for (const { step, colour } of levels) {
    const segments: Seg[] = [];
    for (let x = Math.ceil(frame.x / step) * step; x <= frame.x + frame.width; x += step) {
      segments.push({ x0: x, y0: frame.y, x1: x, y1: frame.y + frame.height });
    }
    for (let y = Math.ceil(frame.y / step) * step; y <= frame.y + frame.height; y += step) {
      segments.push({ x0: frame.x, y0: y, x1: frame.x + frame.width, y1: y });
    }
    page.lines(segments, { colour, width: WEIGHT.grid });
  }
}

export interface PaintOptions {
  /** Draw the dimension chains. Off for a pictorial view. */
  dimensioned?: boolean;
  /** Under the drawing: what it is a view of, and at what scale. */
  caption?: string;
  palette: Palette;
}

/**
 * Ink a projected drawing onto a page, and return where it ended up.
 *
 * The dimension values are the millimetres the model is actually at. The editor
 * can do better — it has the designer's own formulas and prints them underlined,
 * per the convention that an underlined value is one somebody *set* rather than
 * one read off the drawing — but a lamp carries no measurements, so on this
 * sheet every number is a measured one and none of them is underlined. The title
 * block says as much, because a drawing that does not say which of its numbers
 * are intent and which are consequence is a drawing you cannot build twice.
 */
export function paintDrawing(
  page: PdfPage,
  drawing: Drawing,
  frame: Frame,
  scale: number,
  options: PaintOptions
): Placement {
  const { palette } = options;
  const place = placement(drawing.bounds, frame, scale);
  // Agrees with the fit, which reserved room on the same test.
  const dimensioned = options.dimensioned !== false && canDimension(frame);

  if (dimensioned) {
    const metrics = {
      text: PAPER_METRICS.text / scale,
      gap: PAPER_METRICS.gap / scale,
      arrow: PAPER_METRICS.arrow / scale,
      overrun: PAPER_METRICS.overrun / scale,
    };
    const plan = planDimensions({
      bounds: drawing.bounds,
      uAxis: stationsAlong(drawing.stations, drawing.right),
      vAxis: stationsAlong(drawing.stations, drawing.up),
      metrics,
      // The lamp is one design and its extent is a real size, so the outer link
      // is always wanted here — unlike the editor, where it appears only once
      // the parts have been joined into something that *has* an overall size.
      overall: true,
      isSolid: (span) =>
        drawing.runs[span.axis].some((run) => span.a >= run.min - 1e-3 && span.b <= run.max + 1e-3),
      valueFor: (_span, length) => ({
        text: formatLength(length),
        colour: palette.dimText,
        underline: false,
      }),
    });

    page.lines(paperSegs(plan.extension, place), { colour: palette.dim, width: WEIGHT.dim });
    page.lines(paperSegs(plan.dimension, place), { colour: palette.dim, width: WEIGHT.dim });
    for (const label of plan.labels) {
      const at = place.toPaper(label.u, label.v);
      page.text(label.text, at.x, at.y, {
        size: TYPE.dimension,
        colour: label.colour,
        align: "center",
        baseline: "middle",
        underline: label.underline,
      });
    }
  }

  // Hidden first, so the visible outline is the thing on top wherever they meet.
  page.lines(paperSegs(drawing.hidden, place), {
    colour: palette.hidden,
    width: WEIGHT.hidden,
    dash: [1.4, 1],
  });
  page.lines(paperSegs(drawing.visible, place), { colour: palette.line, width: WEIGHT.line });

  if (options.caption) {
    // Under the *drawing*, not at the foot of the cell. A view is centred in
    // whatever room it was given, and a cell can be a great deal taller than the
    // view in it — a caption pinned to the bottom of one then floats away from
    // the thing it names and ends up nearer some other view's.
    //
    // The gap is the strip the fit already reserved, so the caption clears the
    // dimension chain hanging below the drawing and still lands inside the cell.
    const reserve = dimensioned ? DIM_RESERVE_MM : TYPE.caption;
    const bottom = place.toPaper(drawing.bounds.minU, drawing.bounds.minV).y;
    // Clipped to the cell, because nothing in a PDF clips: a caption naming a
    // long component would otherwise be set straight over its neighbour.
    const caption = clipText(options.caption, frame.width, TYPE.caption);
    page.text(caption, frame.x + frame.width / 2, bottom - reserve, {
      size: TYPE.caption,
      colour: palette.text,
      align: "center",
      font: "monoBold",
    });
  }

  return place;
}

// ---------------------------------------------------------------------------
// Laying out a frame
// ---------------------------------------------------------------------------

/** Breathing room between two things on a sheet, in millimetres. */
export const GAP = 4;

/** The four cells of a 2x2 arrangement: top-left, top-right, bottom-left, bottom-right. */
export function quadrants(frame: Frame): [Frame, Frame, Frame, Frame] {
  const w = (frame.width - GAP) / 2;
  const h = (frame.height - GAP) / 2;
  const top = frame.y + h + GAP;
  const right = frame.x + w + GAP;
  return [
    { x: frame.x, y: top, width: w, height: h },
    { x: right, y: top, width: w, height: h },
    { x: frame.x, y: frame.y, width: w, height: h },
    { x: right, y: frame.y, width: w, height: h },
  ];
}

export function inset(frame: Frame, by: number): Frame {
  return {
    x: frame.x + by,
    y: frame.y + by,
    width: Math.max(frame.width - by * 2, 1),
    height: Math.max(frame.height - by * 2, 1),
  };
}

/** Break a run of words into lines of at most `width` characters. */
export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length > 0 && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface Column {
  header: string;
  width: number;
  align?: "left" | "right";
}

/**
 * A table, and where it got to.
 *
 * Returns the y of the row after the last one drawn and how many rows were left
 * undrawn, so a caller can carry the remainder onto another sheet rather than
 * running off the bottom of this one. Silently truncating a bill of materials is
 * the one failure here that a reader cannot see.
 */
export function paintTable(
  page: PdfPage,
  palette: Palette,
  at: { x: number; y: number; bottom: number },
  columns: Column[],
  rows: string[][]
): { y: number; remaining: string[][] } {
  const lineHeight = 4.4;
  let y = at.y;

  // A column's own width less a gap, so a cell that fills it does not run into
  // the one beside it. Nothing in a PDF clips, so this is the only thing
  // standing between a long name and the column to its right.
  const drawRow = (cells: string[], bold: boolean) => {
    let x = at.x;
    cells.forEach((cell, i) => {
      const column = columns[i];
      if (!column) return;
      const text = clipText(cell, column.width - 2, TYPE.caption);
      // The last column is usually right-aligned against the frame, so its
      // figures would otherwise be set flush on the border rule.
      page.text(text, column.align === "right" ? x + column.width - 1 : x, y, {
        size: TYPE.caption,
        colour: bold ? palette.text : palette.dimText,
        font: bold ? "monoBold" : "mono",
        align: column.align === "right" ? "right" : "left",
      });
      x += column.width;
    });
  };

  const totalWidth = columns.reduce((n, c) => n + c.width, 0);
  drawRow(columns.map((c) => c.header), true);
  y -= 1.6;
  page.lines([{ x0: at.x, y0: y, x1: at.x + totalWidth, y1: y }], {
    colour: palette.frame,
    width: WEIGHT.dim,
  });
  y -= lineHeight;

  let i = 0;
  for (; i < rows.length; i++) {
    if (y < at.bottom) break;
    drawRow(rows[i], false);
    y -= lineHeight;
  }
  return { y, remaining: rows.slice(i) };
}

// ---------------------------------------------------------------------------
// Arrangements of several drawings
// ---------------------------------------------------------------------------

/**
 * Three ortho views at one scale, plus a pictorial, in a 2x2.
 *
 * The arrangement is the app's own: the pictorial where the 3D cell is, and the
 * three projections in the cells they occupy on screen. Somebody who has been
 * looking at the design in the app should not have to re-learn where "side" is
 * on the paper.
 *
 * One scale across all three, because that is what makes them comparable — a
 * sheet whose views are each fitted to their own cell is three drawings of
 * three different objects.
 *
 * @returns the shared scale, as it is written.
 */
export function paintArrangement(
  page: PdfPage,
  frame: Frame,
  boxes: THREE.Box3[],
  palette: Palette
): string {
  const cells = quadrants(frame);
  const order: Array<{ view: SheetViewId; cell: Frame }> = [
    { view: "pictorial", cell: cells[0] },
    { view: "top", cell: cells[1] },
    { view: "side", cell: cells[2] },
    { view: "front", cell: cells[3] },
  ];

  const drawings = new Map<string, Drawing>();
  for (const { view } of order) {
    drawings.set(
      view,
      projectDrawing(boxes, SHEET_VIEWS[view].normal as Vec3, {
        withHidden: view !== "pictorial",
      })
    );
  }

  // The shared scale is the smallest of the three the ortho views would each
  // have chosen for themselves.
  let scale = Infinity;
  for (const { view, cell } of order) {
    if (view === "pictorial") continue;
    scale = Math.min(scale, fitScale(drawings.get(view)!.bounds, inset(cell, 2)));
  }

  for (const { view, cell } of order) {
    const drawing = drawings.get(view)!;
    const dimensioned = view !== "pictorial";
    const own = dimensioned ? scale : fitScale(drawing.bounds, inset(cell, 2), false);
    paintDrawing(page, drawing, inset(cell, 2), own, {
      palette,
      dimensioned,
      caption: dimensioned
        ? SHEET_VIEWS[view].label
        : `${SHEET_VIEWS[view].label}  ${scaleLabel(own)}`,
    });
  }

  return scaleLabel(scale);
}

/**
 * A piece, three views, dimensioned, inside one card.
 *
 * Every piece on this lamp is an axis-aligned box, so its three views are three
 * rectangles and all six of their dimensions are the same three numbers twice
 * over. That is not a shortcoming of the drawing — it is what a piece of this
 * design *is*, and stating it in the ordinary three-view arrangement is what
 * lets somebody read it without being told which convention was skipped.
 */
export function paintPieceCard(
  page: PdfPage,
  card: Frame,
  box: THREE.Box3,
  palette: Palette,
  heading: string,
  note: string
): void {
  page.rect(card.x, card.y, card.width, card.height, {
    stroke: { colour: palette.faint, width: WEIGHT.dim },
  });
  const noteWidth = textWidth(note, TYPE.small);
  page.text(
    clipText(heading, card.width - noteWidth - 6, TYPE.caption),
    card.x + 2,
    card.y + card.height - 4,
    { size: TYPE.caption, colour: palette.text, font: "monoBold" }
  );
  page.text(note, card.x + card.width - 2, card.y + card.height - 4, {
    size: TYPE.small,
    colour: palette.dimText,
    align: "right",
  });

  const body: Frame = {
    x: card.x + 1,
    y: card.y + 1,
    width: card.width - 2,
    height: card.height - 6,
  };
  const cellWidth = body.width / 3;
  const views: SheetViewId[] = ["front", "side", "top"];
  const drawings = views.map((view) =>
    projectDrawing([box], SHEET_VIEWS[view].normal as Vec3)
  );

  let scale = Infinity;
  drawings.forEach((drawing, i) => {
    scale = Math.min(
      scale,
      fitScale(drawing.bounds, {
        x: body.x + cellWidth * i,
        y: body.y,
        width: cellWidth,
        height: body.height,
      })
    );
  });

  drawings.forEach((drawing, i) => {
    paintDrawing(
      page,
      drawing,
      { x: body.x + cellWidth * i, y: body.y, width: cellWidth, height: body.height },
      scale,
      { palette, caption: SHEET_VIEWS[views[i]].label }
    );
  });
}
