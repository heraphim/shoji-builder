import * as THREE from "three";
import type { Edge, Measurement } from "../store/useComponentEditorStore";

/**
 * Spans, stations, runs — the measurement model.
 *
 * Everything the projections draw is square to the world axes, so a measured
 * distance is fully described by *which* axis it runs along and the two
 * coordinates it spans. That is the key idea behind implied values: two
 * measurements that happen to sit on different features but span the same pair
 * of coordinates are the same measurement, and measurements that share a
 * coordinate chain together.
 *
 * Three related notions, all keyed off the world axes:
 *
 * - **span**    — an axis plus two coordinates; the unit of measurement identity
 * - **station** — a coordinate where the solid has a face square to that axis;
 *                 dimension chains hang off these
 * - **run**     — a stretch of an axis the assembly actually occupies; used to
 *                 tell a feature from a gap
 *
 * The span solver (BFS over a per-axis graph of measured spans) is what derives
 * a value the user never set from the ones they did.
 *
 * Full write-up: docs/algorithms/spans-and-measurements.md
 */

export type AxisIndex = 0 | 1 | 2;

// Coordinates arrive from three sources — raw mesh vertices, the reconstructed
// endpoints of extracted outline edges, and projected bounding-box corners —
// which agree to about 1e-4 mm but not exactly. Quantising to 0.01 mm makes
// them compare equal without ever merging two genuinely distinct stations: the
// station extraction already collapses anything closer than 0.2% of the part.
const STATION_DECIMALS = 2;
// The `+ 0` normalises negative zero, and it is load-bearing rather than
// cosmetic: a coordinate a few times 1e-15 *below* zero renders as "-0.00",
// which is not the string "0.00", so a block whose face sits there states a
// span no edge of the model can match — its extent becomes unmeasurable, its
// size falls back to a literal, and a variable edit no longer resizes it.
// Turning the model leaves exactly that residue on the axis that was zero.
const stationKey = (c: number) => (Number(c.toFixed(STATION_DECIMALS)) + 0).toFixed(STATION_DECIMALS);

export interface Span {
  axis: AxisIndex;
  a: number; // lower world coordinate
  b: number; // higher world coordinate
}

export interface KnownSpan extends Span {
  formula: string;
}

/** The identity of a span: same key means the same measurement. */
export function spanKey(span: Span): string {
  return `${span.axis}:${stationKey(span.a)}:${stationKey(span.b)}`;
}

/**
 * Which world axis a unit direction runs along, and which way it points.
 *
 * The dominant component must carry at least 0.999 of the direction — roughly
 * 2.6° of tolerance. Returns null for anything skew: such a direction spans no
 * axis, so it has no station chain, takes no part in implication, and is the
 * only kind of edge that earns a free-floating label in the projections.
 */
export function axisOfDirection(dir: THREE.Vector3): { index: AxisIndex; sign: 1 | -1 } | null {
  const components = [Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z)];
  const index = components.indexOf(Math.max(...components)) as AxisIndex;
  if (components[index] < 0.999) return null;
  return { index, sign: dir.getComponent(index) >= 0 ? 1 : -1 };
}

// The span a picked edge measures. A skew edge (a chamfer, a brace) measures a
// length that belongs to no axis chain, so it never takes part in implication.
export function spanOfEdge(edge: Edge): Span | null {
  const dx = edge.end[0] - edge.start[0];
  const dy = edge.end[1] - edge.start[1];
  const dz = edge.end[2] - edge.start[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return null;
  const axis = axisOfDirection(new THREE.Vector3(dx / length, dy / length, dz / length));
  if (!axis) return null;
  const p = edge.start[axis.index];
  const q = edge.end[axis.index];
  return { axis: axis.index, a: Math.min(p, q), b: Math.max(p, q) };
}

/**
 * Every distinct span any measurement covers, tagged with that measurement's
 * formula. First writer wins on a duplicate key, which matches the order the
 * measurement list is drawn in.
 */
export function collectKnownSpans(measurements: Measurement[]): KnownSpan[] {
  const out: KnownSpan[] = [];
  const seen = new Set<string>();
  for (const measurement of measurements) {
    for (const edge of measurement.edges) {
      const span = spanOfEdge(edge);
      if (!span) continue;
      const key = spanKey(span);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...span, formula: measurement.formula });
    }
  }
  return out;
}

interface Link {
  to: string;
  formula: string;
  sign: 1 | -1;
}

export interface SpanSolver {
  // spans the user set explicitly, by key
  known: Map<string, string>;
  // formula for a span the user did *not* set, derived by walking the chain of
  // ones they did — set the overall size and one feature and the rest follow
  imply: (span: Span) => string | null;
}

/**
 * Build the solver from the spans the user has set.
 *
 * Three independent graphs, one per axis. Nodes are quantised coordinates;
 * each measured span becomes an undirected edge between its two endpoints,
 * tagged with the formula and a sign — walking a->b adds the value, b->a
 * subtracts it. Building is O(S) in measured spans.
 *
 * `imply` is a **BFS**, not Dijkstra: every edge costs the same because the
 * objective is the *fewest terms*, which is what keeps a derived formula
 * readable. O(V + E) per query. Signs fall out of the traversal direction, so
 * "the overall minus the two legs" is produced as `(overall) - (leg) - (leg)`
 * without any special casing. Every term is parenthesised so an inner `a+b`
 * cannot bind wrongly against an outer `*`.
 */
export function buildSpanSolver(spans: KnownSpan[]): SpanSolver {
  const known = new Map<string, string>();
  const adjacency: Array<Map<string, Link[]>> = [new Map(), new Map(), new Map()];

  for (const span of spans) {
    known.set(spanKey(span), span.formula);
    const ka = stationKey(span.a);
    const kb = stationKey(span.b);
    if (ka === kb) continue;
    const adj = adjacency[span.axis];
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    // walking a-to-b adds the value, b-to-a subtracts it
    adj.get(ka)!.push({ to: kb, formula: span.formula, sign: 1 });
    adj.get(kb)!.push({ to: ka, formula: span.formula, sign: -1 });
  }

  const imply = (span: Span): string | null => {
    const start = stationKey(span.a);
    const goal = stationKey(span.b);
    if (start === goal) return null;
    const adj = adjacency[span.axis];
    if (!adj.has(start) || !adj.has(goal)) return null;

    // shortest chain of set values connecting the two ends — fewest terms wins,
    // which keeps the derived formula readable
    const cameFrom = new Map<string, { from: string; link: Link }>();
    const seen = new Set<string>([start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node === goal) break;
      for (const link of adj.get(node) ?? []) {
        if (seen.has(link.to)) continue;
        seen.add(link.to);
        cameFrom.set(link.to, { from: node, link });
        queue.push(link.to);
      }
    }
    if (!seen.has(goal)) return null;

    const terms: Link[] = [];
    let cursor = goal;
    while (cursor !== start) {
      const step = cameFrom.get(cursor);
      if (!step) return null;
      terms.unshift(step.link);
      cursor = step.from;
    }
    if (terms.length === 0) return null;

    return terms
      .map((term, i) => {
        const body = `(${term.formula})`;
        if (i === 0) return term.sign === 1 ? body : `-${body}`;
        return term.sign === 1 ? ` + ${body}` : ` - ${body}`;
      })
      .join("");
  };

  return { known, imply };
}

// Stations: the coordinates along each world axis where the solid has a face
// square to that axis. They are what the dimension chains hang off, and they
// are computed once per model rather than per view, so a feature picked up in
// the Top view carries the same station in Front.
//
// A face earns a station by area: a chamfer sliver or a stray CSG triangle
// contributes too little to take a link of its own.
const STATION_MIN_RUN = 0.03;

/**
 * Per-axis station lists for a whole model, plus its combined bounding box.
 *
 * For every triangle: if its normal is square to an axis (|n| >= 0.999 on that
 * component), accumulate the triangle's area into a bucket at that face's
 * coordinate, keyed to 0.01 mm. A bucket that reaches (0.03 * modelSize)^2 of
 * area earns a station — so a chamfer sliver or a stray CSG triangle cannot
 * inject a bogus dimension into the chain, while a real face always can. The
 * two outer faces are always added, since they carry the overall size, and the
 * result is finally clustered at 0.002 * modelSize.
 *
 * O(T) over triangles plus O(k log k) for the per-axis sort.
 */
export function axisStations(geometries: THREE.BufferGeometry[]): {
  stations: [number[], number[], number[]];
  box: THREE.Box3;
} {
  const box = new THREE.Box3();
  for (const geometry of geometries) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox);
  }
  if (box.isEmpty()) return { stations: [[], [], []], box };

  const size = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  const minArea = (STATION_MIN_RUN * size) ** 2;
  const tol = size * 0.002;

  const areas: Array<Map<string, { coord: number; area: number }>> = [
    new Map(),
    new Map(),
    new Map(),
  ];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const geometry of geometries) {
    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const vertexAt = (i: number) => (index ? index.getX(i) : i);
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(position, vertexAt(t));
      b.fromBufferAttribute(position, vertexAt(t + 1));
      c.fromBufferAttribute(position, vertexAt(t + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.crossVectors(ab, ac);
      const doubleArea = normal.length();
      if (doubleArea < 1e-9) continue;
      normal.divideScalar(doubleArea);
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(normal.getComponent(axis)) < 0.999) continue;
        const coord = a.getComponent(axis);
        const key = stationKey(coord);
        const bucket = areas[axis].get(key);
        if (bucket) bucket.area += doubleArea / 2;
        else areas[axis].set(key, { coord, area: doubleArea / 2 });
      }
    }
  }

  const stations = [0, 1, 2].map((axis) => {
    const coords = Array.from(areas[axis].values())
      .filter((entry) => entry.area >= minArea)
      .map((entry) => entry.coord);
    // the two outer faces always count — they carry the overall size
    coords.push(box.min.getComponent(axis), box.max.getComponent(axis));
    coords.sort((x, y) => x - y);
    const merged: number[] = [];
    for (const coord of coords) {
      if (merged.length === 0 || coord - merged[merged.length - 1] > tol) merged.push(coord);
    }
    return merged;
  }) as [number[], number[], number[]];

  return { stations, box };
}

// Runs: the stretches of each world axis the assembly actually occupies, with
// overlapping and touching parts merged. A single joined solid gives one run per
// axis — parts that touch must overlap on every axis — so runs only ever break
// where the design has genuinely separate pieces.
//
// They exist to tell a feature from a gap. A dimension states a size somebody
// decided; the stretch of nothing between two parts that are not joined yet is
// not a size, it is just how far apart they happen to be drawn, and it changes
// the moment they are connected.
export interface Run {
  min: number;
  max: number;
}

// Tolerance for "touching". Parts butted end to end share a coordinate exactly
// in intent, and to about 1e-4 mm in arithmetic.
const RUN_TOL = 1e-3;

/**
 * Merge each axis's occupied intervals. Sort by low end, extend the last run
 * when the next starts within RUN_TOL, otherwise start a new one. O(m log m).
 */
export function solidRuns(boxes: THREE.Box3[]): [Run[], Run[], Run[]] {
  return [0, 1, 2].map((axis) => {
    const intervals = boxes
      .map((box) => ({ min: box.min.getComponent(axis), max: box.max.getComponent(axis) }))
      .sort((a, b) => a.min - b.min);
    const runs: Run[] = [];
    for (const interval of intervals) {
      const last = runs[runs.length - 1];
      if (last && interval.min <= last.max + RUN_TOL) last.max = Math.max(last.max, interval.max);
      else runs.push({ ...interval });
    }
    return runs;
  }) as [Run[], Run[], Run[]];
}

// Whether a span lies inside material the whole way, rather than crossing a gap.
export function isSolidSpan(runs: [Run[], Run[], Run[]], span: Span): boolean {
  return runs[span.axis].some((run) => span.a >= run.min - RUN_TOL && span.b <= run.max + RUN_TOL);
}

/**
 * Stations projected onto a view's screen axis: `direction` is a world axis, so
 * this is the matching station list, flipped when the view looks at that axis
 * from the other side. Null for a direction that is not a world axis.
 */
export function stationsAlong(
  stations: [number[], number[], number[]],
  direction: THREE.Vector3
): { axis: AxisIndex; sign: 1 | -1; values: number[] } | null {
  const axis = axisOfDirection(direction);
  if (!axis) return null;
  const values = stations[axis.index].map((c) => c * axis.sign);
  values.sort((x, y) => x - y);
  return { axis: axis.index, sign: axis.sign, values };
}

// Raycast for a LineSegments with an explicit pick radius in world units.
// three reads the threshold off the shared raycaster, but each projection has
// its own zoom, so a fixed threshold would pick generously in one view and
// barely at all in another — this swaps in the caller's value for one test.
export function lineRaycast(threshold: number) {
  return function raycast(
    this: THREE.Line,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[]
  ) {
    // Swap the whole params.Line object and put the original back in `finally`,
    // rather than overwriting the threshold and restoring it afterwards. three
    // always defines params.Line, so the old form was correct in the normal
    // case; this one also holds if the raycast throws, and if params.Line is
    // ever absent it restores that too instead of leaving this view's threshold
    // installed on the raycaster every other view shares.
    const previous = raycaster.params.Line;
    raycaster.params.Line = { ...previous, threshold };
    try {
      THREE.LineSegments.prototype.raycast.call(this, raycaster, intersects);
    } finally {
      raycaster.params.Line = previous;
    }
  };
}
