import * as THREE from "three";
import type { Edge, Measurement, Vec3 } from "../store/useComponentEditorStore";
import { buildSpanSolver, collectKnownSpans, spanKey, spanOfEdge } from "./measure";

/**
 * How well each edge of the model is pinned down by what has been measured.
 *
 * Three states, and the whole point is that they are visible at a glance on the
 * drawing itself rather than only in the sidebar:
 *
 * - **known**   — the designer set this span; its length is a decision
 * - **implied** — nobody set it, but it follows from the ones that were set
 *                 (the span solver can chain to it)
 * - **unknown** — nothing determines it; it is still whatever the solid happened
 *                 to be drawn at, and a variable edit will not move it
 *
 * Identity is by *span*, exactly as everywhere else in the measurement model: an
 * edge is known because the distance it covers is known, not because that
 * particular arris was the one clicked. The four arrises bounding a block along
 * an axis therefore all colour the same, which is what the user means by
 * "that dimension is set".
 *
 * A skew edge (a chamfer, an angled brace) spans no axis, so it takes no part in
 * implication — it is known only if a measurement was hung on that very edge.
 *
 * See docs/algorithms/spans-and-measurements.md for the span model itself.
 */

export type EdgeStatus = "known" | "implied" | "unknown";

// The one place these three colours are decided. App.css mirrors them as
// --bp-known / --bp-implied / --bp-unknown for the sidebar lists, so a row in
// the list and the edges it refers to are the same colour.
export const STATUS_COLOR: Record<EdgeStatus, string> = {
  known: "#4ade80",
  implied: "#ffcc00",
  unknown: "#f87171",
};

// Identity for a skew edge, which has no span to be identified by. Orientation
// -independent, and at the same 1 micron the solid's vertices are snapped to.
function skewKey(edge: Edge): string {
  const r = (v: Vec3) => v.map((n) => n.toFixed(3)).join(",");
  const a = r(edge.start);
  const b = r(edge.end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface EdgeClassifier {
  /**
   * False until something has been measured. Before that every edge is
   * trivially unknown, and painting the whole drawing red would say nothing —
   * so the views keep their ordinary blueprint line colour instead.
   */
  active: boolean;
  status: (edge: Edge) => EdgeStatus;
  color: (edge: Edge) => THREE.Color;
}

/**
 * Build the classifier for one set of measurements.
 *
 * `imply` is a BFS per query and an outline has hundreds of segments, so
 * results are cached by span key — the four arrises of an extent, and every
 * segment a hidden-line split cut that extent into, all answer from one walk.
 */
export function buildEdgeClassifier(measurements: Measurement[]): EdgeClassifier {
  const solver = buildSpanSolver(collectKnownSpans(measurements));

  const skew = new Set<string>();
  for (const measurement of measurements) {
    for (const edge of measurement.edges) {
      if (!spanOfEdge(edge)) skew.add(skewKey(edge));
    }
  }

  // three treats a vertex-colour attribute as already being in the working
  // colour space, so the conversion has to happen here — via THREE.Color, which
  // is what the same hex would go through if it were a material colour.
  const colors: Record<EdgeStatus, THREE.Color> = {
    known: new THREE.Color(STATUS_COLOR.known),
    implied: new THREE.Color(STATUS_COLOR.implied),
    unknown: new THREE.Color(STATUS_COLOR.unknown),
  };

  const cache = new Map<string, EdgeStatus>();
  const status = (edge: Edge): EdgeStatus => {
    const span = spanOfEdge(edge);
    if (!span) return skew.has(skewKey(edge)) ? "known" : "unknown";
    const key = spanKey(span);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const resolved: EdgeStatus = solver.known.has(key)
      ? "known"
      : solver.imply(span)
        ? "implied"
        : "unknown";
    cache.set(key, resolved);
    return resolved;
  };

  return {
    active: measurements.length > 0,
    status,
    color: (edge) => colors[status(edge)],
  };
}

/**
 * A `color` attribute for a `LineSegments` position buffer, one colour per
 * vertex, taken from the source edge each segment came from.
 *
 * `sources` is per *segment* — the hidden-line pass cuts one model edge into
 * several segments, and every piece keeps the status of the edge it came off.
 * Pass the geometry's own segments when there was no such split.
 */
export function edgeStatusColors(
  segmentCount: number,
  sources: Edge[],
  classifier: EdgeClassifier
): Float32Array {
  const out = new Float32Array(segmentCount * 6);
  for (let i = 0; i < segmentCount; i++) {
    const source = sources[i];
    const color = source ? classifier.color(source) : new THREE.Color(STATUS_COLOR.unknown);
    // both ends of a segment carry the same colour — a length is one thing
    out.set([color.r, color.g, color.b, color.r, color.g, color.b], i * 6);
  }
  return out;
}

/** The segments of a `LineSegments` position buffer, as edges. */
export function segmentsOf(geometry: THREE.BufferGeometry): Edge[] {
  const position = geometry.attributes.position;
  const out: Edge[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i + 1 < position.count; i += 2) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    out.push({ start: a.toArray() as Vec3, end: b.toArray() as Vec3 });
  }
  return out;
}
