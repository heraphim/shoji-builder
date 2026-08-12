import * as THREE from "three";

// Cutting a flat face into rectangles rather than into whatever triangles an
// ear-clipper happens to produce. Every face this app makes is rectilinear —
// blocks meeting square, laps, notches, mortises — so a face is an L, a T, a
// rectangle with a rectangular bite out of it, and each of those is a handful
// of rectangles, two triangles apiece.
//
// The partition is the *minimum* one, by the standard result for rectilinear
// polygons (Lipski / Ohtsuki): with `n` concave corners, `l` the largest set of
// pairwise non-crossing chords joining two concave corners, and `h` holes, the
// fewest rectangles is `n - l - h + 1`. Finding `l` is a maximum independent set
// on the graph of crossing chords, which is bipartite — a horizontal chord can
// only ever cross a vertical one — so it falls out of a maximum matching by
// Koenig's theorem.
//
// Everything runs on a grid built from the face's own coordinates rather than on
// the polygon directly. Every corner of the face lands on a grid line, so every
// cell is wholly inside the face or wholly outside it, and the awkward parts —
// is this chord interior, where does this cut stop, what are the pieces
// afterwards — become array lookups.
//
// Stages, with cost (nx*ny cells, K concave corners, P ring vertices):
//
//   1. grid            coordinate compression + even-odd cell fill  O(nx*ny*P)
//   2. corners         2x2 cell neighbourhood test                  O(nx*ny)
//   3. chords          all corner pairs, interior check on the grid O(K^2 * n)
//   4. matching        Kuhn's augmenting paths                      O(V*E)
//      independent set Koenig: complement of the min vertex cover   O(V+E)
//   5. walls           chosen chords, then one cut per leftover corner
//   6. sweep           row-major greedy maximal rectangles          O(nx*ny)
//   7. verify          every filled cell claimed, or bail out
//
// Worked examples and the optimality argument:
// docs/algorithms/rectangle-partition.md

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Coordinates arrive snapped to a 1 micron grid and are read through an
// orthonormal plane basis, so equal coordinates are equal to the last bit for
// any face square to the world axes. The tolerance is for the rest.
const EPS = 1e-6;

// A face needing more cells than this is not a joint, it is a mistake — bail
// out and let the caller keep the triangles it already has.
const MAX_CELLS = 4096;

/**
 * Even-odd (ray-crossing) containment. Lives here because the grid pass needs it
 * for every cell; the ring-nesting pass in assembly.ts uses the same one.
 * Winding-independent by construction, which is why neither caller has to know
 * which way its rings run. O(n).
 */
export function containsPoint(polygon: THREE.Vector2[], p: THREE.Vector2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (out.length === 0 || value - out[out.length - 1] > EPS) out.push(value);
  }
  return out;
}

// A chord (and, later, a cut) named in grid terms: the line it sits on, and the
// half-open run of cells it covers.
interface Chord {
  horizontal: boolean;
  line: number;
  from: number;
  to: number;
}

/**
 * The minimum set of axis-aligned rectangles covering a rectilinear face,
 * given its boundary rings in plane coordinates — outer ring first, holes
 * after. Winding does not matter; containment is even-odd.
 *
 * Returns null when the face is not rectilinear, is degenerate, or is large
 * enough that the caller is better off not trying: null means "keep what you
 * had", never "the face is empty".
 */
export function partitionIntoRectangles(rings: THREE.Vector2[][]): Rect[] | null {
  if (rings.length === 0) return null;
  for (const ring of rings) {
    if (ring.length < 4) return null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      // one skew edge and the whole face is somebody else's problem
      if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) return null;
    }
  }

  // ─── the grid ─────────────────────────────────────────────────────────────
  const xs = uniqueSorted(rings.flatMap((ring) => ring.map((p) => p.x)));
  const ys = uniqueSorted(rings.flatMap((ring) => ring.map((p) => p.y)));
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1 || nx * ny > MAX_CELLS) return null;

  const filled = new Uint8Array(nx * ny);
  const probe = new THREE.Vector2();
  let filledCount = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      probe.set((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
      let odd = false;
      for (const ring of rings) if (containsPoint(ring, probe)) odd = !odd;
      if (odd) {
        filled[j * nx + i] = 1;
        filledCount++;
      }
    }
  }
  if (filledCount === 0) return null;

  const at = (i: number, j: number): number =>
    i < 0 || j < 0 || i >= nx || j >= ny ? 0 : filled[j * nx + i];

  // ─── concave corners ──────────────────────────────────────────────────────
  // Read off the cells rather than off the rings: a grid corner with exactly
  // three filled neighbours is a 270-degree corner of the material, whichever
  // ring it came from and whichever way that ring was wound.
  //
  // `missing` is which of the four is empty, in the order lower-left,
  // lower-right, upper-left, upper-right — that is what says which way a cut
  // from this corner has to run.
  interface Corner {
    i: number;
    j: number;
    missing: number;
  }
  const corners: Corner[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const quad = [at(i - 1, j - 1), at(i, j - 1), at(i - 1, j), at(i, j)];
      const count = quad[0] + quad[1] + quad[2] + quad[3];
      // two filled cells meeting corner to corner: the face pinches to nothing
      // here, so it is not a polygon with a boundary this pass can reason about
      if (count === 2 && quad[0] === quad[3] && quad[1] === quad[2]) return null;
      if (count === 3) corners.push({ i, j, missing: quad.indexOf(0) });
    }
  }

  // ─── chords ───────────────────────────────────────────────────────────────
  // A chord joins two concave corners along a grid line and stays inside the
  // material the whole way — which, on the grid, is just "the cells either side
  // of it are filled for its whole length".
  const hChords: Chord[] = [];
  const vChords: Chord[] = [];
  for (let a = 0; a < corners.length; a++) {
    for (let b = a + 1; b < corners.length; b++) {
      const p = corners[a];
      const q = corners[b];
      if (p.j === q.j && p.i !== q.i) {
        const from = Math.min(p.i, q.i);
        const to = Math.max(p.i, q.i);
        let interior = true;
        for (let c = from; c < to && interior; c++) {
          interior = at(c, p.j - 1) === 1 && at(c, p.j) === 1;
        }
        if (interior) hChords.push({ horizontal: true, line: p.j, from, to });
      } else if (p.i === q.i && p.j !== q.j) {
        const from = Math.min(p.j, q.j);
        const to = Math.max(p.j, q.j);
        let interior = true;
        for (let r = from; r < to && interior; r++) {
          interior = at(p.i - 1, r) === 1 && at(p.i, r) === 1;
        }
        if (interior) vChords.push({ horizontal: false, line: p.i, from, to });
      }
    }
  }

  // ─── maximum independent set of chords ────────────────────────────────────
  // Two chords conflict when they cross. Horizontals never cross horizontals,
  // so the conflict graph is bipartite and Koenig's theorem applies: the
  // complement of a minimum vertex cover is a maximum independent set, and a
  // minimum vertex cover comes straight out of a maximum matching.
  const adjacency = hChords.map((h) => {
    const out: number[] = [];
    for (let k = 0; k < vChords.length; k++) {
      const v = vChords[k];
      if (v.line >= h.from && v.line <= h.to && h.line >= v.from && h.line <= v.to) out.push(k);
    }
    return out;
  });

  const matchOfH = new Int32Array(hChords.length).fill(-1);
  const matchOfV = new Int32Array(vChords.length).fill(-1);
  const augment = (h: number, seen: Uint8Array): boolean => {
    for (const v of adjacency[h]) {
      if (seen[v]) continue;
      seen[v] = 1;
      if (matchOfV[v] === -1 || augment(matchOfV[v], seen)) {
        matchOfV[v] = h;
        matchOfH[h] = v;
        return true;
      }
    }
    return false;
  };
  for (let h = 0; h < hChords.length; h++) augment(h, new Uint8Array(vChords.length));

  // Everything reachable from an unmatched horizontal by an alternating path.
  const reachedH = new Uint8Array(hChords.length);
  const reachedV = new Uint8Array(vChords.length);
  const stack: number[] = [];
  for (let h = 0; h < hChords.length; h++) {
    if (matchOfH[h] === -1) {
      reachedH[h] = 1;
      stack.push(h);
    }
  }
  while (stack.length > 0) {
    const h = stack.pop()!;
    for (const v of adjacency[h]) {
      if (reachedV[v] || matchOfH[h] === v) continue; // out along non-matching edges only
      reachedV[v] = 1;
      const back = matchOfV[v]; // ...and back along matching ones
      if (back !== -1 && !reachedH[back]) {
        reachedH[back] = 1;
        stack.push(back);
      }
    }
  }

  const chosen: Chord[] = [];
  for (let h = 0; h < hChords.length; h++) if (reachedH[h]) chosen.push(hChords[h]);
  for (let v = 0; v < vChords.length; v++) if (!reachedV[v]) chosen.push(vChords[v]);

  // ─── walls ────────────────────────────────────────────────────────────────
  // Where the partition cuts, recorded on the grid edges. Only cuts go in here:
  // the face's own boundary needs no wall, because a cell outside the face is
  // never merged into anything in the first place.
  const vWall = new Uint8Array((nx + 1) * ny); // grid edge on column line i, spanning row j
  const hWall = new Uint8Array(nx * (ny + 1)); // grid edge on row line j, spanning column i
  const setV = (i: number, j: number) => {
    vWall[j * (nx + 1) + i] = 1;
  };
  const getV = (i: number, j: number): number =>
    j < 0 || j >= ny ? 1 : vWall[j * (nx + 1) + i];
  const setH = (i: number, j: number) => {
    hWall[j * nx + i] = 1;
  };
  const getH = (i: number, j: number): number => (i < 0 || i >= nx ? 1 : hWall[j * nx + i]);

  for (const chord of chosen) {
    if (chord.horizontal) for (let c = chord.from; c < chord.to; c++) setH(c, chord.line);
    else for (let r = chord.from; r < chord.to; r++) setV(chord.line, r);
  }

  // Every concave corner a chord did not deal with still has to be cut, once,
  // in either direction; vertical throughout keeps it predictable. The cut runs
  // from the corner into the material and stops at the first thing it meets —
  // the far side of the face, or a cut already drawn.
  const coveredBy = (chord: Chord, i: number, j: number): boolean =>
    chord.horizontal
      ? chord.line === j && i >= chord.from && i <= chord.to
      : chord.line === i && j >= chord.from && j <= chord.to;

  for (const corner of corners) {
    if (chosen.some((chord) => coveredBy(chord, corner.i, corner.j))) continue;
    // the empty cell is below the corner (missing 0 or 1) -> the boundary edge
    // that stops here comes up from below, so its extension goes up
    const step = corner.missing <= 1 ? 1 : -1;
    let r = step === 1 ? corner.j : corner.j - 1;
    while (r >= 0 && r < ny && at(corner.i - 1, r) === 1 && at(corner.i, r) === 1) {
      if (getV(corner.i, r)) break;
      setV(corner.i, r);
      const reached = step === 1 ? r + 1 : r;
      if (getH(corner.i - 1, reached) || getH(corner.i, reached)) break;
      r += step;
    }
  }

  // ─── the rectangles ───────────────────────────────────────────────────────
  // Sweeping in row-major order, the first unclaimed cell is always the
  // bottom-left corner of a piece, so growing it right and then up as far as the
  // walls allow recovers that piece exactly. Note this is sound whatever the
  // cutting above decided: bad walls could only cost a rectangle or two, never
  // produce something that is not a rectangle or miss a filled cell.
  const claimed = new Uint8Array(nx * ny);
  const rects: Rect[] = [];
  let claimedCount = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (filled[j * nx + i] === 0 || claimed[j * nx + i] === 1) continue;

      let right = i + 1;
      while (
        right < nx &&
        filled[j * nx + right] === 1 &&
        claimed[j * nx + right] === 0 &&
        !getV(right, j)
      ) {
        right++;
      }

      let top = j + 1;
      for (; top < ny; top++) {
        let ok = true;
        for (let c = i; c < right && ok; c++) {
          ok =
            filled[top * nx + c] === 1 &&
            claimed[top * nx + c] === 0 &&
            !getH(c, top) &&
            (c === i || !getV(c, top));
        }
        if (!ok) break;
      }

      for (let r = j; r < top; r++) {
        for (let c = i; c < right; c++) {
          claimed[r * nx + c] = 1;
          claimedCount++;
        }
      }
      rects.push({ x0: xs[i], y0: ys[j], x1: xs[right], y1: ys[top] });
    }
  }

  // the sweep cannot leave a filled cell behind, but a face rebuilt to the wrong
  // shape is far worse than one left over-tessellated, so it is checked anyway
  return claimedCount === filledCount ? rects : null;
}
