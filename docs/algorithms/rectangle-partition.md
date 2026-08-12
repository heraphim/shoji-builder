# Minimum rectilinear rectangle partition

`src/lib/rectangles.ts`

## What and why

Every face this app makes is rectilinear — blocks meeting square, laps, notches,
mortises. Such a face is an L, a T, a rectangle with a rectangular bite out of
it, and each of those is a handful of rectangles, two triangles apiece.

`partitionIntoRectangles(rings)` cuts such a face into the **provably fewest**
axis-aligned rectangles, instead of into whatever an ear-clipper happens to
produce. The payoff: a plain face is two triangles and a lap is four, the cut is
identical every time the part is rebuilt (no shimmering tessellation on a slider
drag), and no interior vertices are left to shade as creases.

Input is the face's boundary rings in plane coordinates, outer ring first, holes
after. Winding does not matter; containment is even-odd.

Returns `null` when the face is not rectilinear, is degenerate, or is large
enough that the caller is better off not trying. **`null` means "keep what you
had", never "the face is empty".**

## The optimality result

For a rectilinear polygon with `n` concave (reflex, 270°) corners, `h` holes, and
`l` the size of a maximum set of pairwise non-crossing chords each joining two
concave corners, the minimum number of rectangles is

```
n − l − h + 1
```

(Lipski et al. / Ohtsuki, the standard result.) Finding `l` is a **maximum
independent set** on the graph whose vertices are chords and whose edges are
crossings. That graph is **bipartite** — a horizontal chord can only ever cross a
vertical one — so by **König's theorem** the complement of a minimum vertex cover
is a maximum independent set, and a minimum vertex cover comes straight out of a
**maximum matching**.

That is the whole algorithm. The implementation detail is that everything runs on
a grid.

## Why a grid

A grid is built from the face's own coordinates (coordinate compression). Every
corner of the face lands on a grid line, so **every cell is wholly inside the
face or wholly outside it**, and the awkward geometric questions become array
lookups:

| Question | On the grid |
| --- | --- |
| Is this chord interior? | Are the cells either side of it filled, for its whole length? |
| Is this corner concave? | Does its 2×2 cell neighbourhood have exactly 3 filled? |
| Where does this cut stop? | At the first empty cell or the first wall already set. |
| What are the pieces afterwards? | A greedy sweep over unclaimed cells. |

## Stages

### 0. Rectilinearity check

Every ring edge must be axis-parallel to within `EPS = 1e-6`. One skew edge and
the whole face is somebody else's problem → `null`.

### 1. The grid

```
xs ← sorted unique x of every ring vertex
ys ← sorted unique y of every ring vertex
nx = xs.length − 1,  ny = ys.length − 1
bail out if nx < 1, ny < 1, or nx·ny > MAX_CELLS (4096)
```

Fill: probe each cell's centre against every ring; an odd number of containments
means filled. `containsPoint` is the standard even-odd ray-crossing test (it
lives in this module because the grid pass needs it per cell, and `assembly.ts`
reuses it for ring nesting).

`O(nx·ny·P)` in ring vertices.

### 2. Concave corners

Read off the **cells**, not the rings: a grid corner whose 2×2 neighbourhood has
exactly three filled cells is a 270° corner of the material, whichever ring it
came from and however that ring was wound.

```
quad = [ at(i−1,j−1), at(i,j−1), at(i−1,j), at(i,j) ]     # LL, LR, UL, UR
count === 3 → concave corner; `missing` = index of the empty one
count === 2 and diagonally opposite → bail out (null)
```

The diagonal case is a *pinch point*: two cells meeting corner to corner, where
the face narrows to nothing. That is not a polygon with a boundary this pass can
reason about.

`missing` records which of the four is empty, and that is what says which way a
cut from this corner has to run.

### 3. Chords

A chord joins two concave corners along a grid line and stays inside the material
the whole way — which, on the grid, is just "the cells either side of it are
filled for its whole length".

All pairs of corners, `O(K²)` with an `O(max(nx,ny))` interior check.

### 4. Maximum matching → maximum independent set

Adjacency: horizontal chord `h` crosses vertical chord `v` when `v`'s column lies
within `h`'s run and `h`'s row lies within `v`'s run.

**Kuhn's algorithm** — for each horizontal chord, try to find an augmenting path
by DFS over unvisited verticals:

```
augment(h, seen):
    for each v adjacent to h:
        if seen[v]: continue
        seen[v] = true
        if v is unmatched or augment(matchOfV[v], seen):
            match h ↔ v;  return true
    return false
```

`O(V·E)`.

**König's construction** — mark everything reachable from an *unmatched*
horizontal by an alternating path (out along non-matching edges, back along
matching ones). Then:

- minimum vertex cover = (unreached horizontals) ∪ (reached verticals);
- maximum independent set = its complement = **(reached horizontals) ∪
  (unreached verticals)**.

That set is `chosen`, the chords the partition will actually cut along.

### 5. Walls

Cuts are recorded on grid edges in two bitmaps: `vWall[i][j]` for the vertical
grid edge on column line `i` spanning row `j`, `hWall[i][j]` likewise. Only *cuts*
go in — the face's own boundary needs no wall, because a cell outside the face is
never merged into anything in the first place. (`getV`/`getH` return 1 for
out-of-range indices, which makes the sweep stop at the grid border for free.)

Every concave corner that no chosen chord covers still has to be cut, **once**, in
either direction; vertical throughout keeps it predictable. The cut runs from the
corner into the material and stops at the first thing it meets — the far side of
the face, or a cut already drawn:

```
step ← +1 if the empty cell is below the corner (missing ≤ 1), else −1
walk row by row while both flanking cells are filled:
    stop if this wall segment is already set
    set it
    stop if a horizontal wall blocks the far end of this step
```

### 6. The rectangles

Row-major greedy sweep. The first unclaimed filled cell is always the
**bottom-left corner** of a piece, so:

```
grow right  while filled, unclaimed, and no vertical wall in the way
grow up     while the whole row-strip is filled, unclaimed, has no horizontal
            wall below it, and no vertical wall splits it
claim the block; emit (xs[i], ys[j]) .. (xs[right], ys[top])
```

This is sound whatever stage 5 decided: bad walls could only cost a rectangle or
two, never produce something that is not a rectangle or miss a filled cell.

`O(nx·ny)`.

### 7. Verification

`claimedCount === filledCount` or return `null`. The sweep cannot leave a filled
cell behind — but a face rebuilt to the wrong shape is far worse than one left
over-tessellated, so it is checked anyway.

## Worked example — a lap joint

Two 20×20 boxes overlapping in an L. The face has one concave corner, no holes,
so `n = 1`, and no chord can join a corner to itself, so `l = 0`:

```
minimum rectangles = 1 − 0 − 0 + 1 = 2
```

Stage 5 cuts vertically from the single concave corner, and the sweep returns two
rectangles → four triangles for the whole face.

A rectangle with a rectangular hole through it (a mortise seen face-on) has
`n = 4` — the hole's own corners are the reflex ones — and `h = 1`. No chord
between two of them stays inside material (each candidate runs along the hole's
own boundary, with the hole on one side), so `l = 0`:

```
minimum rectangles = 4 − 0 − 1 + 1 = 4
```

which is the familiar pinwheel of four rectangles around the hole.

A cross-halving lap, where the face is a plus, has `n = 4` and `h = 0`. Here the
two horizontal chords (across the top and bottom of the centre square) and the
two vertical ones are all interior, and each horizontal meets each vertical, so
the crossing graph is `K₂,₂`: maximum matching 2, minimum vertex cover 2,
`l = 4 − 2 = 2`:

```
minimum rectangles = 4 − 2 − 0 + 1 = 3
```

— the top arm, the full-width middle bar, and the bottom arm.
