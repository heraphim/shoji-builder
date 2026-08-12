import * as THREE from "three";
import { Brush, Evaluator, ADDITION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Edge, SubMesh, Vec3 } from "../store/useComponentEditorStore";
import { spanKey, spanOfEdge } from "./measure";
import { containsPoint, partitionIntoRectangles } from "./rectangles";

/**
 * Merging joined parts into one solid, and making that solid presentable.
 *
 * Two boxes joined at a lap have to render, project and export as one solid
 * with no seam. A CSG union gets the surface right and the tessellation badly
 * wrong: it retriangulates coplanar faces into fragments with T-junctions,
 * Steiner points and slivers, which is what shades as phantom diagonals across
 * a flat face, confuses edge picking, and bloats the exported file.
 *
 * So the pipeline throws the CSG tessellation away and re-cuts every flat face
 * from its own outline:
 *
 *     mergeGroupGeometry
 *       Brush/Evaluator ADDITION      union the group's parts
 *       mergeVertices(1e-4)           weld hairline cracks along seams
 *       simplifySolid
 *         buildTopology               canonical vertices, coplanar regions
 *         regionOutlines              each region's boundary, by cover parity
 *         chainLoops                  segments -> closed rings
 *         dropCollinear               rings -> the face's real corners
 *         ring nesting                which rings are holes (even-odd depth)
 *         partitionIntoRectangles     2 triangles per rectangle (usual case)
 *           or ShapeUtils.triangulateShape  ear clipping (chamfers etc.)
 *         area check                  accept, or keep the original triangles
 *
 * Everything here is parity arithmetic on *exact* coincidence, so positions are
 * snapped to WELD_GRID first. Every stage has a bail-out that returns the input
 * unchanged: a face left over-tessellated looks wrong, a face rebuilt to the
 * wrong shape *is* wrong.
 *
 * The module also owns the outline cache, parallel-edge lookup, the merged-solid
 * -> owning-mesh lookup, and the blueprint hidden-line pass.
 *
 * Full write-up: docs/algorithms/solid-simplification.md
 */

// EdgesGeometry threshold (degrees) for outlines of merged solids: CSG output
// retriangulates coplanar faces with slight numeric wobble, so a tight 1-degree
// threshold shows phantom diagonals across flat faces.
export const EDGE_THRESHOLD_DEG = 8;

function worldGeometry(mesh: SubMesh): THREE.BufferGeometry {
  const g = mesh.geometry.clone();
  g.translate(mesh.offset[0], mesh.offset[1], mesh.offset[2]);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// Merge a connected group's meshes into one world-space solid via CSG union —
// internal faces at the joints (including partial face overlaps) genuinely
// disappear, so the group renders and projects as a single mesh with no seam
// edges/vertices/faces left behind.
export function mergeGroupGeometry(meshes: SubMesh[]): THREE.BufferGeometry {
  if (meshes.length === 1) return worldGeometry(meshes[0]);

  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];

  let acc = new Brush(worldGeometry(meshes[0]));
  acc.updateMatrixWorld();
  for (let i = 1; i < meshes.length; i++) {
    const brush = new Brush(worldGeometry(meshes[i]));
    brush.updateMatrixWorld();
    acc = evaluator.evaluate(acc, brush, ADDITION);
    acc.updateMatrixWorld();
  }
  // weld near-coincident vertices the CSG pass leaves along seams so face
  // detection sees continuous surfaces instead of hairline cracks
  const welded = mergeVertices(acc.geometry, 1e-4);
  // ...then throw away the CSG tessellation entirely and re-cut each flat face
  // from its own outline. The union of two boxes is a handful of flat faces;
  // what comes back from the evaluator is those faces cut into fragments around
  // the seam, with T-junctions, Steiner points and slivers left behind. Those
  // are what shade as phantom diagonals and what bloat the exported file.
  const simplified = simplifySolid(welded);
  simplified.computeVertexNormals();
  return simplified;
}

// ─── shared face topology ───────────────────────────────────────────────────
// Both the outline pass and the simplifier need the same thing first: the
// triangles grouped into coplanar regions, and each region's outline recovered
// by cover parity. That work lives here once.

interface Tri {
  ids: [number, number, number];
  normal: THREE.Vector3;
  planeD: number;
}

interface Topology {
  points: THREE.Vector3[];
  tris: Tri[];
  // region root per triangle, from the union-find below
  regionOf: number[];
  // the grid every position in `points` sits on, so later passes can round the
  // same way and land on the same values
  grid: number;
}

const PLANE_EPS = 1e-3;

// Everything below is parity arithmetic on exact coincidence: an interior edge
// only cancels if both triangles report it as *the same* edge, and a point only
// lies on an edge if it lies on it exactly. The CSG evaluator misses that — by
// a few times 1e-5 mm on a clean butt joint, by a few thousandths where several
// coplanar faces meet — and any of it is enough to leave a seam diagonal
// standing. So positions are snapped to a grid before any of the parity work.
//
// The grid is a fixed 1 micron, and deliberately a round decimal one: part
// sizes come out of the formula evaluator as ordinary decimal millimetres, and
// a grid that is not a decimal fraction would shift every one of them off its
// true value. Where the evaluator's error is bigger than this — several
// coplanar faces meeting at one corner can reach a few thousandths — the
// affected face simply fails to resolve into a loop and keeps the triangles it
// came in with, which is wrong-looking but never wrong.
const WELD_GRID = 1e-3;

// `+ 0` because -0 and 0 are the same point but not the same string
const snapTo = (value: number, grid: number) => Math.round(value / grid) * grid + 0;
const vectorKey = (v: THREE.Vector3, grid: number) =>
  `${snapTo(v.x, grid)},${snapTo(v.y, grid)},${snapTo(v.z, grid)}`;

/**
 * Group a solid's triangles into coplanar regions — one entry per flat face,
 * however the tessellator happened to cut it up.
 *
 * Four passes:
 *
 *  1. **Canonical vertices.** Snap to the grid, intern by string key. Two
 *     vertices at the same snapped position become one id.
 *  2. **Sliver rejection.** `doubleArea / longestSide` is twice the triangle's
 *     height on its longest side, so the test below is "stands less than one
 *     grid step tall". Absolute, not a shape ratio — see the comment inline.
 *  3. **T-junction adjacency.** A triangle counts as touching every vertex that
 *     lies *on* one of its edges, not just its own three. Without this, a face
 *     cut into rectangles and its neighbour carrying one longer edge share no
 *     vertex at all and would be called two faces. O(T*P) with an AABB reject.
 *  4. **Union-find coplanar regions.** Triangles sharing a (possibly on-edge)
 *     vertex merge when their normals agree to `cosThreshold` *and* their plane
 *     offsets agree to PLANE_EPS. Both are needed: the normal test alone would
 *     merge parallel faces on opposite sides of a part, the offset test alone a
 *     face with its own backside. Normals are oriented, so front and back never
 *     merge.
 *
 * @param cosThreshold cosine of the coplanarity angle (cos 8° by default)
 */
function buildTopology(geometry: THREE.BufferGeometry, cosThreshold: number): Topology {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vertexIndex = (t: number, v: number) => (index ? index.getX(t * 3 + v) : t * 3 + v);
  const grid = WELD_GRID;
  const snap = (value: number) => snapTo(value, grid);

  // canonical vertex ids by snapped position
  const keyToId = new Map<string, number>();
  const points: THREE.Vector3[] = [];
  const canon = (vi: number): number => {
    const x = snap(pos.getX(vi));
    const y = snap(pos.getY(vi));
    const z = snap(pos.getZ(vi));
    const key = `${x},${y},${z}`;
    let id = keyToId.get(key);
    if (id === undefined) {
      id = points.length;
      keyToId.set(key, id);
      points.push(new THREE.Vector3(x, y, z));
    }
    return id;
  };

  const tris: Tri[] = [];
  const vertexToTris = new Map<number, number[]>();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const ids = [canon(vertexIndex(t, 0)), canon(vertexIndex(t, 1)), canon(vertexIndex(t, 2))] as [
      number,
      number,
      number,
    ];
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    ab.subVectors(points[ids[1]], points[ids[0]]);
    ac.subVectors(points[ids[2]], points[ids[0]]);
    const normal = new THREE.Vector3().crossVectors(ab, ac);
    // CSG leaves sliver triangles (near-zero area, nonzero extent) whose stray
    // apex vertices would emit phantom diagonals. The test is absolute, not a
    // shape ratio: vertices are on the weld grid, so a triangle standing less
    // than one grid step tall cannot be a real face — while a genuinely long,
    // thin one (200 mm along a 3.5 mm step, say) is real and dropping it would
    // leave its edges unpaired and put the diagonal back.
    const doubleArea = normal.length();
    const longest = Math.max(ab.length(), ac.length(), points[ids[1]].distanceTo(points[ids[2]]));
    if (doubleArea < 1e-12 || doubleArea / longest < grid) continue;
    normal.normalize();
    const tri: Tri = { ids, normal, planeD: normal.dot(points[ids[0]]) };
    const triIndex = tris.length;
    tris.push(tri);
    for (const id of ids) {
      let list = vertexToTris.get(id);
      if (!list) {
        list = [];
        vertexToTris.set(id, list);
      }
      list.push(triIndex);
    }
  }

  // A face cut into rectangles meets its neighbour along an edge the neighbour
  // carries as one longer one — a T-junction, and the two sides then share no
  // vertex at all. Grouping by shared vertices alone would call that two faces
  // and draw the join as an edge across the middle of a flat surface. So a
  // triangle counts as touching every vertex that lies *on* one of its edges as
  // well as the three it is built from. (CSG output is full of the same thing,
  // for the same reason: it retriangulates one side of a seam and not the other.)
  const edge = new THREE.Vector3();
  const toPoint = new THREE.Vector3();
  for (let t = 0; t < tris.length; t++) {
    const { ids } = tris[t];
    for (let e = 0; e < 3; e++) {
      const a = points[ids[e]];
      const b = points[ids[(e + 1) % 3]];
      edge.subVectors(b, a);
      const lengthSq = edge.lengthSq();
      if (lengthSq < 1e-12) continue;
      const loX = Math.min(a.x, b.x) - grid;
      const hiX = Math.max(a.x, b.x) + grid;
      const loY = Math.min(a.y, b.y) - grid;
      const hiY = Math.max(a.y, b.y) + grid;
      const loZ = Math.min(a.z, b.z) - grid;
      const hiZ = Math.max(a.z, b.z) + grid;
      for (let id = 0; id < points.length; id++) {
        if (id === ids[0] || id === ids[1] || id === ids[2]) continue;
        const p = points[id];
        if (p.x < loX || p.x > hiX || p.y < loY || p.y > hiY || p.z < loZ || p.z > hiZ) continue;
        toPoint.subVectors(p, a);
        const along = toPoint.dot(edge);
        if (along <= 0 || along >= lengthSq) continue; // past an end, or on it
        if (toPoint.lengthSq() - (along * along) / lengthSq > grid * grid) continue; // off the line
        vertexToTris.get(id)?.push(t);
      }
    }
  }

  // union-find coplanar regions (triangles touching, same oriented plane)
  const parent = tris.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const list of vertexToTris.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = tris[list[i]];
        const b = tris[list[j]];
        if (a.normal.dot(b.normal) > cosThreshold && Math.abs(a.planeD - b.planeD) < PLANE_EPS) {
          parent[find(list[i])] = find(list[j]);
        }
      }
    }
  }

  return { points, tris, regionOf: tris.map((_, i) => find(i)), grid };
}

interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

/**
 * The outline of each coplanar region, **by cover parity**.
 *
 * Every triangle edge is bucketed by its supporting line. Within a bucket, every
 * endpoint is a break; the stretch between two consecutive breaks is boundary
 * when an *odd* number of intervals cover its midpoint.
 *
 * Why parity rather than counting shared edges: an interior edge is traversed by
 * exactly two triangles (cover 2, cancels), and a T-junction — one long edge
 * against two short collinear ones — also sums to cover 2 along its whole
 * length and cancels, which is precisely what edge-counting cannot do. A true
 * region boundary is traversed once and survives.
 *
 * Output is **maximal spans**, not the original pieces: collinear boundary
 * fragments come back merged, which is what lets the simplifier recover a
 * face's real corners.
 *
 * Two edges of one line **must** land in the same bucket or the stretch they
 * share cannot cancel and a diagonal is drawn across a flat face. Bucketing by a
 * quantised key cannot promise that: every quantisation has boundaries, and a
 * long edge and the halves a T-junction cut it into fall on opposite sides of
 * one for two independent reasons — the halves' arithmetic differs in the last
 * bit, and snapping a T-junction point to the grid moves it off the line by up
 * to a grid step. So a line is matched by *proximity* instead: an edge joins the
 * first line in its region that both its endpoints lie on. Longest edge first,
 * so the reference line is the most accurate one available — a short fragment's
 * direction is far noisier than that of the edge it sits on. O(E*L) per region
 * against a handful of lines, and every bucket now has a fixed, exactly
 * representable reference point rather than one derived from the world origin.
 */
function regionOutlines(topo: Topology): Map<number, Segment[]> {
  const snap = (value: number) => snapTo(value, topo.grid);
  interface Bucket {
    region: number;
    // a point of the longest edge on this line, and the direction from it
    origin: THREE.Vector3;
    dir: THREE.Vector3;
    intervals: Array<{ t0: number; t1: number }>;
  }

  // Two grid steps. It has to clear the most a snapped point can sit off the
  // line it belongs to (half a step per axis, so ~1.4 steps in the plane of the
  // face), and two genuinely distinct parallel lines 2 microns apart do not
  // occur in a part measured in millimetres.
  const lineTolerance = 2 * topo.grid;

  const edges: Array<{ region: number; a: THREE.Vector3; b: THREE.Vector3; length: number }> = [];
  for (let t = 0; t < topo.tris.length; t++) {
    const region = topo.regionOf[t];
    const { ids } = topo.tris[t];
    for (let e = 0; e < 3; e++) {
      const a = topo.points[ids[e]];
      const b = topo.points[ids[(e + 1) % 3]];
      const length = a.distanceTo(b);
      if (length < 1e-12) continue;
      edges.push({ region, a, b, length });
    }
  }
  edges.sort((p, q) => q.length - p.length);

  const offset = new THREE.Vector3();
  const distanceToLine = (p: THREE.Vector3, line: Bucket): number => {
    offset.subVectors(p, line.origin);
    const along = offset.dot(line.dir);
    return Math.sqrt(Math.max(offset.lengthSq() - along * along, 0));
  };

  const byRegion = new Map<number, Bucket[]>();
  for (const edge of edges) {
    let lines = byRegion.get(edge.region);
    if (!lines) {
      lines = [];
      byRegion.set(edge.region, lines);
    }
    // both endpoints on the line, not just a matching direction: a short
    // fragment can be rotated by the snap, but its ends still sit on the line
    let bucket = lines.find(
      (line) =>
        distanceToLine(edge.a, line) <= lineTolerance &&
        distanceToLine(edge.b, line) <= lineTolerance
    );
    if (!bucket) {
      bucket = {
        region: edge.region,
        origin: edge.a.clone(),
        dir: new THREE.Vector3().subVectors(edge.b, edge.a).normalize(),
        intervals: [],
      };
      lines.push(bucket);
    }
    // parameters run from the line's own origin, so they stay small and two
    // traversal directions of one edge give the same interval either way
    const ta = offset.subVectors(edge.a, bucket.origin).dot(bucket.dir);
    const tb = offset.subVectors(edge.b, bucket.origin).dot(bucket.dir);
    bucket.intervals.push({ t0: Math.min(ta, tb), t1: Math.max(ta, tb) });
  }

  const out = new Map<number, Segment[]>();
  for (const bucket of Array.from(byRegion.values()).flat()) {
    const breaks = Array.from(
      new Set(bucket.intervals.flatMap((iv) => [iv.t0, iv.t1]).map((t) => +t.toFixed(4)))
    ).sort((x, y) => x - y);
    let runStart: number | null = null;
    for (let i = 0; i < breaks.length - 1; i++) {
      const mid = (breaks[i] + breaks[i + 1]) / 2;
      const cover = bucket.intervals.filter(
        (iv) => iv.t0 - 1e-4 <= mid && mid <= iv.t1 + 1e-4
      ).length;
      const odd = cover % 2 === 1;
      if (odd && runStart === null) runStart = breaks[i];
      if (!odd && runStart !== null) {
        emit(runStart, breaks[i]);
        runStart = null;
      }
    }
    if (runStart !== null) emit(runStart, breaks[breaks.length - 1]);

    function emit(t0: number, t1: number) {
      if (t1 - t0 < 1e-4) return;
      let list = out.get(bucket.region);
      if (!list) {
        list = [];
        out.set(bucket.region, list);
      }
      // reconstructing the endpoint from origin + direction reintroduces the
      // arithmetic noise the snapping just removed; put it back on the grid so
      // segments that share a corner still share it exactly
      const at = (t: number) => {
        const p = bucket.origin.clone().addScaledVector(bucket.dir, t);
        return p.set(snap(p.x), snap(p.y), snap(p.z));
      };
      list.push({ a: at(t0), b: at(t1) });
    }
  }
  return out;
}

// ─── outline extraction ─────────────────────────────────────────────────────

/**
 * A solid's visible outline as a `LineSegments` position buffer.
 *
 * Replaces `THREE.EdgesGeometry`, which assumes a conforming mesh (every
 * interior edge shared by exactly two triangles). CSG output breaks that on
 * retriangulated faces and EdgesGeometry then draws phantom diagonals; region
 * outlines carry no such assumption.
 *
 * Segments appearing in two regions — a crease is a boundary of both faces that
 * meet at it — are emitted once.
 *
 * Prefer {@link outlineEdges}, which caches.
 */
export function buildOutlineEdges(
  geometry: THREE.BufferGeometry,
  thresholdDeg = EDGE_THRESHOLD_DEG
): THREE.BufferGeometry {
  const topo = buildTopology(geometry, Math.cos(THREE.MathUtils.degToRad(thresholdDeg)));
  const outlines = regionOutlines(topo);

  const segments: number[] = [];
  const seen = new Set<string>();
  const segKey = (a: THREE.Vector3, b: THREE.Vector3) => {
    const ka = vectorKey(a, topo.grid);
    const kb = vectorKey(b, topo.grid);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (const list of outlines.values()) {
    for (const seg of list) {
      const key = segKey(seg.a, seg.b);
      if (seen.has(key)) continue; // creases appear in both adjacent regions
      seen.add(key);
      segments.push(seg.a.x, seg.a.y, seg.a.z, seg.b.x, seg.b.y, seg.b.z);
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
  return out;
}

// The same solid's outline is wanted several times over — drawn, made pickable,
// and searched for an edge's parallels — and extracting it is the expensive part
// of a rebuild. Cached against the geometry object itself, so every caller gets
// one identical segment list (and therefore identical segment indices) and a
// solid that has not been re-cut is never re-outlined.
const outlineCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Memoised {@link buildOutlineEdges}. Every caller gets one identical segment
 * list — and therefore identical segment *indices*, which matters because a
 * raycast hit is reported as an index into this buffer.
 *
 * Do not dispose the result: it is shared and outlives any one component.
 */
export function outlineEdges(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let edges = outlineCache.get(geometry);
  if (!edges) {
    edges = buildOutlineEdges(geometry);
    outlineCache.set(geometry, edges);
  }
  return edges;
}

// Same deal for the tessellation wireframe: built on demand — only a view set to
// "all triangles" ever asks — and then kept, because it is wanted once per view
// showing it and the solid does not change underneath it.
const triangleCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Every triangle edge of a solid, as line segments — the tessellation itself,
 * not the shape.
 *
 * Where {@link outlineEdges} answers "what does this thing look like", this
 * answers "how is it built": it keeps the diagonals across a flat face that the
 * outline pass exists to remove, which is exactly what makes it worth looking at
 * when a face has failed to resolve or a join has left a solid cut oddly.
 *
 * An edge shared by two triangles is emitted once, on the same welded grid the
 * outline pass uses — so a shared arris is one line rather than two coincident
 * ones drawn twice.
 *
 * Do not dispose the result: like the outline, it is shared and released through
 * {@link releaseSolid}.
 */
export function triangleEdges(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = triangleCache.get(geometry);
  if (cached) return cached;

  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vertexIndex = (t: number, v: number) => (index ? index.getX(t * 3 + v) : t * 3 + v);

  const segments: number[] = [];
  const seen = new Set<string>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      a.fromBufferAttribute(pos, vertexIndex(t, v));
      b.fromBufferAttribute(pos, vertexIndex(t, (v + 1) % 3));
      const ka = vectorKey(a, WELD_GRID);
      const kb = vectorKey(b, WELD_GRID);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
  triangleCache.set(geometry, out);
  return out;
}

/**
 * Give back a merged solid and the line buffers cached against it.
 *
 * All of them are rendered, so all of them hold GPU buffers that garbage
 * collection does not free — dropping the reference is not enough. They have to
 * go through here rather than through `outlineEdges(...).dispose()`, which would
 * rebuild the outline of a solid nobody wants just to throw it away.
 */
export function releaseSolid(geometry: THREE.BufferGeometry): void {
  for (const cache of [outlineCache, triangleCache]) {
    const lines = cache.get(geometry);
    if (lines) {
      cache.delete(geometry);
      lines.dispose();
    }
  }
  geometry.dispose();
}

const segmentKey = (edge: Edge): string => {
  const r = (v: Vec3) => v.map((n) => n.toFixed(3)).join(",");
  const a = r(edge.start);
  const b = r(edge.end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

// Every part is a block, so a measured extent is never carried by one edge on
// its own: the four arrises that bound a block along an axis all run between the
// same two coordinates and all state the same measurement. Hovering or picking
// one therefore means all four. This is only making visible what the span solver
// already believes — it identifies a measurement by the span it covers, never by
// the particular edge it was read off.
//
// A skew edge spans no axis and so has no parallels; it stands alone.
//
// @param geometries every group's merged solid, not just the picked one —
//        parallels are found across the whole assembly.
// @returns the matching edges, or `[edge]` when nothing on the model states the
//        same span (which is the case for a dimension guide).
export function parallelEdges(edge: Edge, geometries: THREE.BufferGeometry[]): Edge[] {
  const span = spanOfEdge(edge);
  if (!span) return [edge];
  const key = spanKey(span);

  const out: Edge[] = [];
  const seen = new Set<string>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const geometry of geometries) {
    const position = outlineEdges(geometry).attributes.position;
    for (let i = 0; i + 1 < position.count; i += 2) {
      a.fromBufferAttribute(position, i);
      b.fromBufferAttribute(position, i + 1);
      const candidate: Edge = { start: a.toArray() as Vec3, end: b.toArray() as Vec3 };
      const candidateSpan = spanOfEdge(candidate);
      if (!candidateSpan || spanKey(candidateSpan) !== key) continue;
      const dedupe = segmentKey(candidate);
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push(candidate);
    }
  }
  // A dimension guide is not an edge of the solid, so it finds its parallels on
  // the model and hands over to them; nothing on the model to match means the
  // edge as picked is all there is.
  return out.length > 0 ? out : [edge];
}

// ─── simplification ─────────────────────────────────────────────────────────

// Chain a region's outline segments into closed rings. Returns null when the
// outline isn't a clean set of loops — every corner must join exactly two
// segments — which is the signal to keep that region's original triangles
// rather than guess at a face that can't be read off reliably.
// Adjacency is by snapped position; after pruning, every node must have exactly
// two neighbours, and a walk that revisits a node without closing is rejected.
// O(E).
function chainLoops(segments: Segment[], grid: number): THREE.Vector3[][] | null {
  const key = (v: THREE.Vector3) => vectorKey(v, grid);
  const nodes = new Map<string, THREE.Vector3>();
  const adjacency = new Map<string, string[]>();
  for (const seg of segments) {
    const ka = key(seg.a);
    const kb = key(seg.b);
    if (ka === kb) continue;
    nodes.set(ka, seg.a);
    nodes.set(kb, seg.b);
    if (!adjacency.has(ka)) adjacency.set(ka, []);
    if (!adjacency.has(kb)) adjacency.set(kb, []);
    adjacency.get(ka)!.push(kb);
    adjacency.get(kb)!.push(ka);
  }

  // Where the evaluator's arithmetic came apart it leaves a stray diagonal
  // hanging off a real corner, its far end at a coordinate belonging to nothing.
  // A segment with a free end cannot be part of any closed outline, so pull the
  // whole dangling chain out and let the rest of the face close normally.
  const loose = [...adjacency].filter(([, to]) => to.length === 1).map(([node]) => node);
  while (loose.length > 0) {
    const node = loose.pop()!;
    const to = adjacency.get(node);
    if (!to || to.length !== 1) continue;
    const other = to[0];
    adjacency.delete(node);
    const back = adjacency.get(other);
    if (!back) continue;
    back.splice(back.indexOf(node), 1);
    if (back.length === 1) loose.push(other);
    else if (back.length === 0) adjacency.delete(other);
  }

  if (adjacency.size < 3) return null;
  for (const list of adjacency.values()) if (list.length !== 2) return null;

  const visited = new Set<string>();
  const loops: THREE.Vector3[][] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const loop: THREE.Vector3[] = [];
    let previous: string | null = null;
    let current = start;
    for (;;) {
      visited.add(current);
      loop.push(nodes.get(current)!);
      const neighbours = adjacency.get(current)!;
      const next = neighbours[0] === previous ? neighbours[1] : neighbours[0];
      previous = current;
      current = next;
      if (current === start) break;
      // a walk that revisits a node without closing means the outline is not a
      // set of simple rings
      if (visited.has(current)) return null;
    }
    if (loop.length < 3) return null;
    loops.push(loop);
  }
  return loops.length > 0 ? loops : null;
}

// Drop vertices that sit in the middle of a straight run — the T-junctions the
// CSG left behind. What survives is the face's real corners.
function dropCollinear(loop: THREE.Vector3[]): THREE.Vector3[] {
  const n = loop.length;
  if (n < 3) return loop;
  const out: THREE.Vector3[] = [];
  const d1 = new THREE.Vector3();
  const d2 = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    d1.subVectors(loop[i], loop[(i - 1 + n) % n]);
    d2.subVectors(loop[(i + 1) % n], loop[i]);
    if (d1.lengthSq() < 1e-18 || d2.lengthSq() < 1e-18) continue;
    if (d1.normalize().dot(d2.normalize()) < 1 - 1e-6) out.push(loop[i]);
  }
  return out.length >= 3 ? out : loop;
}

function planeBasis(normal: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const seed = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  // (u, v, normal) is right-handed, so a counter-clockwise ring in (u, v)
  // faces along +normal
  const u = seed.addScaledVector(normal, -seed.dot(normal)).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  return { u, v };
}

function signedArea(points: THREE.Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Re-cut a solid so each flat face is rebuilt from its own corners, instead of
 * however the CSG happened to fragment it. Purely a retessellation: the surface
 * is unchanged, there are just far fewer triangles and no interior vertices left
 * to shade as creases.
 *
 * A rectilinear face — which is every face a joint between two blocks produces —
 * is cut into the fewest rectangles it can be, two triangles apiece, so a plain
 * face comes back as two triangles and a lap as four. Anything else falls back
 * to ear-clipping the outline.
 *
 * Per region the stages are: record the original area, chain the outline into
 * rings, drop collinear vertices, build a plane basis, work out ring nesting,
 * triangulate, map back to world, then **check the area**. Any stage failing —
 * an outline that will not close, a triangulator that gives up, a rebuilt face
 * of the wrong size — falls back to that region's original triangles.
 *
 * Also run on every uploaded STL island: a modeller's tessellation of a flat
 * face is arbitrary, and everything downstream is easier if a block starts life
 * as the twelve triangles it should be.
 *
 * @returns a fresh indexed geometry, or the input unchanged if it has no usable
 *          triangles. Never mutates the input.
 */
export function simplifySolid(
  geometry: THREE.BufferGeometry,
  thresholdDeg = EDGE_THRESHOLD_DEG
): THREE.BufferGeometry {
  const topo = buildTopology(geometry, Math.cos(THREE.MathUtils.degToRad(thresholdDeg)));
  if (topo.tris.length === 0) return geometry;
  const outlines = regionOutlines(topo);

  const trisByRegion = new Map<number, number[]>();
  for (let t = 0; t < topo.tris.length; t++) {
    const region = topo.regionOf[t];
    if (!trisByRegion.has(region)) trisByRegion.set(region, []);
    trisByRegion.get(region)!.push(t);
  }

  const vertices: number[] = [];
  const indices: number[] = [];
  const vertexIds = new Map<string, number>();
  const idOf = (p: THREE.Vector3): number => {
    const key = vectorKey(p, topo.grid);
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      vertexIds.set(key, id);
      vertices.push(p.x, p.y, p.z);
    }
    return id;
  };
  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, normal: THREE.Vector3) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const facing = new THREE.Vector3().crossVectors(ab, ac);
    if (facing.lengthSq() < 1e-18) return;
    const ia = idOf(a);
    const ib = idOf(b);
    const ic = idOf(c);
    if (facing.dot(normal) >= 0) indices.push(ia, ib, ic);
    else indices.push(ia, ic, ib);
  };

  const triangleArea = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    new THREE.Vector3()
      .crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
      .length() / 2;

  for (const [region, triIndices] of trisByRegion) {
    const normal = topo.tris[triIndices[0]].normal;
    const keepOriginal = () => {
      for (const t of triIndices) {
        const { ids } = topo.tris[t];
        pushTriangle(topo.points[ids[0]], topo.points[ids[1]], topo.points[ids[2]], normal);
      }
    };

    // What the face covers now. Whatever comes out of the retessellation has to
    // cover the same, or it is not the same face and does not go in — every
    // step below reads an outline the evaluator may have produced garbage for,
    // and a face quietly rebuilt to the wrong shape is far worse than one left
    // over-tessellated.
    let originalArea = 0;
    for (const t of triIndices) {
      const { ids } = topo.tris[t];
      originalArea += triangleArea(topo.points[ids[0]], topo.points[ids[1]], topo.points[ids[2]]);
    }

    const segments = outlines.get(region);
    const loops = segments ? chainLoops(segments, topo.grid) : null;
    if (!loops || loops.length === 0) {
      keepOriginal();
      continue;
    }

    const { u, v } = planeBasis(normal);
    const rings = loops.map((loop) => {
      const corners = dropCollinear(loop);
      return {
        world: corners,
        plane: corners.map((p) => new THREE.Vector2(p.dot(u), p.dot(v))),
        depth: 0,
      };
    });

    // Which rings bound material and which punch holes in it is a question of
    // nesting, not of winding: chaining a ring walks it in whichever direction
    // the outline happened to hand over, so the sign of its area says nothing.
    // A ring nested inside an even number of others is an outer boundary; an
    // odd one is a hole in whatever encloses it.
    for (const ring of rings) {
      for (const other of rings) {
        if (other === ring) continue;
        const inside = ring.plane.filter((p) => containsPoint(other.plane, p)).length;
        if (inside * 2 > ring.plane.length) ring.depth++;
      }
    }
    // triangulateShape wants the outer ring counter-clockwise and its holes
    // clockwise, and counter-clockwise in (u, v) is the side the face looks out of
    for (const ring of rings) {
      const wantPositive = ring.depth % 2 === 0;
      if (signedArea(ring.plane) > 0 !== wantPositive) {
        ring.plane.reverse();
        ring.world.reverse();
      }
    }

    const outers = rings.filter((ring) => ring.depth % 2 === 0);
    const holes = rings.filter((ring) => ring.depth % 2 === 1);
    if (outers.length === 0) {
      keepOriginal();
      continue;
    }

    // Reading a plane coordinate back out to world: (u, v, normal) is
    // orthonormal, so a point is its two in-plane coordinates plus the plane's
    // offset along the normal. That offset is averaged over the face's own
    // corners rather than read off one triangle, so a corner that makes the
    // round trip lands back exactly where it started and shares its vertex with
    // the faces either side of it.
    const cornerPoints = rings.flatMap((ring) => ring.world);
    const planeD =
      cornerPoints.reduce((sum, p) => sum + normal.dot(p), 0) / Math.max(cornerPoints.length, 1);
    const toWorld = (x: number, y: number): THREE.Vector3 => {
      const p = new THREE.Vector3()
        .addScaledVector(u, x)
        .addScaledVector(v, y)
        .addScaledVector(normal, planeD);
      return p.set(snapTo(p.x, topo.grid), snapTo(p.y, topo.grid), snapTo(p.z, topo.grid));
    };

    const emitted: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
    let emittedArea = 0;
    const emit = (triangle: [THREE.Vector3, THREE.Vector3, THREE.Vector3]) => {
      emitted.push(triangle);
      emittedArea += triangleArea(...triangle);
    };

    for (const outer of outers) {
      const own = holes.filter(
        (hole) =>
          hole.depth === outer.depth + 1 &&
          hole.plane.filter((p) => containsPoint(outer.plane, p)).length * 2 > hole.plane.length
      );

      // The face as rectangles, where it is rectilinear — two triangles each,
      // no interior corners, and the same cut every time the part is rebuilt.
      const rects = partitionIntoRectangles([outer.plane, ...own.map((hole) => hole.plane)]);
      if (rects) {
        for (const rect of rects) {
          const a = toWorld(rect.x0, rect.y0);
          const b = toWorld(rect.x1, rect.y0);
          const c = toWorld(rect.x1, rect.y1);
          const d = toWorld(rect.x0, rect.y1);
          emit([a, b, c]);
          emit([a, c, d]);
        }
        continue;
      }

      // a chamfer, a splayed leg, anything the rectangles cannot describe
      const faces = THREE.ShapeUtils.triangulateShape(
        outer.plane,
        own.map((hole) => hole.plane)
      );
      const ring = [...outer.world, ...own.flatMap((hole) => hole.world)];
      for (const face of faces) {
        emit([ring[face[0]], ring[face[1]], ring[face[2]]]);
      }
    }

    // triangulateShape gives up on rings it can't handle and returns nothing,
    // and a misread outline comes back the wrong size. Either way the face goes
    // back in as it arrived.
    const tolerance = Math.max(originalArea * 1e-4, topo.grid * topo.grid);
    if (emitted.length === 0 || Math.abs(emittedArea - originalArea) > tolerance) {
      keepOriginal();
      continue;
    }
    for (const triangle of emitted) pushTriangle(...triangle, normal);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  out.setIndex(indices);
  out.computeBoundingBox();
  return out;
}

/**
 * Which constituent mesh of a group owns a picked world-space vertex — needed
 * because interaction happens on the merged solid but connections reference a
 * specific mesh. Exact vertex match first; the CSG union can introduce new
 * seam vertices that belong to no original mesh, so fall back to whichever
 * mesh has the nearest vertex. O(V) over the group's original vertices.
 */
export function meshIdForWorldVertex(
  groupMeshes: SubMesh[],
  v: THREE.Vector3,
  epsilon = 1e-3
): string | null {
  let nearestId: string | null = null;
  let nearestDist = Infinity;
  for (const mesh of groupMeshes) {
    const pos = mesh.geometry.attributes.position;
    const lx = v.x - mesh.offset[0];
    const ly = v.y - mesh.offset[1];
    const lz = v.z - mesh.offset[2];
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - lx;
      const dy = pos.getY(i) - ly;
      const dz = pos.getZ(i) - lz;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < epsilon * epsilon) return mesh.id;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = mesh.id;
      }
    }
  }
  return nearestId;
}

/**
 * Blueprint hidden-line pass: split world-space edge segments into visible and
 * hidden portions by sampling along each edge and raycasting toward the camera
 * against every solid. Hidden runs render dashed, per drafting convention.
 *
 * When the hidden flag flips between two samples the run is closed at their
 * midpoint — an approximation, but at the default sampleStep (radius/60) the
 * error is sub-pixel at the zoom the drawing is framed for.
 *
 * O(E * S) raycasts. The most expensive thing in a projection re-render, hence
 * the caller memoises on [groups, viewDir, radius] and *not* on zoom.
 *
 * The occluder meshes must use a `DoubleSide` material: an edge sunk inside a
 * solid can only be occluded by the *inside* of the face between it and the
 * camera, and with FrontSide that exit face is culled.
 *
 * @param viewDir unit vector pointing from the scene toward the camera
 * @param surfaceOffset how far to lift each ray origin off the surface it starts
 *        on — without it every point reports itself as its own occluder
 * @returns the two position buffers, plus the model edge each emitted segment
 *        was cut from. One edge can produce several segments, and the caller
 *        needs to know which — a segment's colour states how well the *edge* is
 *        measured, not the fragment of it that happens to be in view.
 */
export function splitVisibleHidden(
  edges: THREE.BufferGeometry,
  occluders: THREE.Object3D[],
  viewDir: THREE.Vector3,
  sampleStep: number,
  surfaceOffset: number
): { visible: number[]; hidden: number[]; visibleSource: Edge[]; hiddenSource: Edge[] } {
  const raycaster = new THREE.Raycaster();
  const pos = edges.attributes.position;
  const visible: number[] = [];
  const hidden: number[] = [];
  const visibleSource: Edge[] = [];
  const hiddenSource: Edge[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const p = new THREE.Vector3();
  let source: Edge = { start: [0, 0, 0], end: [0, 0, 0] };

  const pushSeg = (isHiddenRun: boolean, t0: number, t1: number) => {
    if (t1 - t0 < 1e-6) return;
    const p0 = new THREE.Vector3().lerpVectors(a, b, t0);
    const p1 = new THREE.Vector3().lerpVectors(a, b, t1);
    const arr = isHiddenRun ? hidden : visible;
    arr.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    (isHiddenRun ? hiddenSource : visibleSource).push(source);
  };

  for (let e = 0; e < pos.count; e += 2) {
    a.fromBufferAttribute(pos, e);
    b.fromBufferAttribute(pos, e + 1);
    source = { start: a.toArray() as Vec3, end: b.toArray() as Vec3 };
    const length = a.distanceTo(b);
    const samples = Math.max(3, Math.ceil(length / sampleStep) + 1);

    let runHidden: boolean | null = null;
    let runStart = 0;
    let prevT = 0;
    for (let s = 0; s < samples; s++) {
      const t = s / (samples - 1);
      p.lerpVectors(a, b, t).addScaledVector(viewDir, surfaceOffset);
      raycaster.set(p, viewDir);
      const isHidden = raycaster.intersectObjects(occluders, false).length > 0;
      if (runHidden === null) {
        runHidden = isHidden;
      } else if (isHidden !== runHidden) {
        const mid = (prevT + t) / 2;
        pushSeg(runHidden, runStart, mid);
        runStart = mid;
        runHidden = isHidden;
      }
      prevT = t;
    }
    pushSeg(runHidden === true, runStart, 1);
  }

  return { visible, hidden, visibleSource, hiddenSource };
}
