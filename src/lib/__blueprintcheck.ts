import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { computeScene, outlineOfBoxes, parseComponentDef, type LampComponentDef } from "./lamp";
import { parseLampFile, toInstances } from "./lampFile";
import { buildCutList, pieceSize, sizeLabel, stockBySection } from "./cutlist";
import {
  DIM_RESERVE_MM,
  paperSheet,
  SHEET_VIEWS,
  boxStations,
  fitScale,
  placement,
  projectDrawing,
  sameDrawing,
  scaleLabel,
} from "./blueprint";
import {
  buildBlueprint,
  cutFor,
  divide,
  lampOrientation,
  pageRegions,
  paperFor,
  splitPage,
} from "./blueprintDoc";
import { viewCameraBasis } from "./picking";
import type { Vec3 } from "../store/useComponentEditorStore";

/**
 * The export, against the shipped lamp.
 *
 * Three kinds of claim are worth checking, and none of them can be checked by
 * looking at the sheet:
 *
 * - **The projection is a projection.** Hidden-line removal cuts one arris into
 *   several pieces, and the pieces have to add up to the arris — a pass that
 *   quietly drops a stretch produces a drawing that is wrong in exactly the way
 *   nobody notices, because what is missing is a line that was never there.
 * - **The counting is counting.** A cut list that disagrees with the model about
 *   how many pieces there are is worse than no cut list; the totals are checked
 *   against the scene rather than against themselves.
 * - **It fits on the paper.** A drawing is placed at a stated ratio, so whether
 *   it lands inside its frame is arithmetic with an answer, and the answer must
 *   not be "nearly".
 *
 * It also writes the real document, because none of the above says whether the
 * sheet is any good to read.
 *
 * Run from the project root:
 *
 *     npx vite build --ssr src/lib/__blueprintcheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__blueprintcheck.js
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? ` — ${detail}` : ""}`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Is this point on the boundary of the convex hull of those points? */
function hullTest(points: Array<[number, number]>): (u: number, v: number) => boolean {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: number[], p: number[], q: number[]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const chain = (list: typeof sorted) => {
    const out: typeof sorted = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const hull = [...chain(sorted).slice(0, -1), ...chain([...sorted].reverse()).slice(0, -1)];
  return (u, v) => {
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i];
      const q = hull[(i + 1) % hull.length];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) continue;
      const away = Math.abs((u - p[0]) * dy - (v - p[1]) * dx) / length;
      const along = ((u - p[0]) * dx + (v - p[1]) * dy) / (length * length);
      if (away < 0.05 && along > -1e-6 && along < 1 + 1e-6) return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------
// The shipped lamp, off the disk
// ---------------------------------------------------------------------------

const lampFile = parseLampFile(
  JSON.parse(readFileSync("public/models/lamps/basic.lamp.json", "utf8"))
);
const defs = new Map<string, LampComponentDef>();
for (const file of readdirSync("public/models/components")) {
  if (!file.endsWith(".json") || file === "index.json") continue;
  defs.set(
    file,
    parseComponentDef(file, JSON.parse(readFileSync(`public/models/components/${file}`, "utf8")))
  );
}
const { instances, missing, variables } = toInstances(lampFile, defs);
const raw = { ...variables, ...lampFile.variables };
const scene = computeScene(instances, raw);

console.log(`\n${lampFile.id}: ${instances.length} instances, ${defs.size} components in the library`);
check("every component the lamp names is in the library", missing.length === 0, missing.join(","));
check("the scene placed every instance", scene.placements.size === instances.length);

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

console.log("\nProjecting");

const boxes = instances.flatMap((instance) => {
  const shape = scene.shapes.get(instance.id)!;
  const place = scene.placements.get(instance.id)!;
  const matrix = new THREE.Matrix4().compose(place.position, place.quaternion, new THREE.Vector3(1, 1, 1));
  return shape.boxes.map((box) => {
    const out = new THREE.Box3();
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner
        .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
        .applyMatrix4(matrix);
      out.expandByPoint(corner);
    }
    return out;
  });
});

const front = projectDrawing(boxes, SHEET_VIEWS.front.normal as Vec3);
check("the front view has lines in it", front.visible.length > 0, `${front.visible.length} visible, ${front.hidden.length} hidden`);

// The projected extents must be the model's own extents in that plane, not a
// bounding sphere's — the whole reason the fit is on the box.
const overall = new THREE.Box3();
for (const box of boxes) overall.union(box);
check(
  "the front view is framed on the model's width and height",
  near(front.bounds.maxU - front.bounds.minU, overall.max.x - overall.min.x, 1e-6) &&
    near(front.bounds.maxV - front.bounds.minV, overall.max.y - overall.min.y, 1e-6),
  `${(front.bounds.maxU - front.bounds.minU).toFixed(1)} × ${(front.bounds.maxV - front.bounds.minV).toFixed(1)}`
);

// Hidden-line removal cuts an arris into visible and hidden runs. Summed over
// every segment, the projected length must come back to what was projected —
// this is the check that a stretch cannot go missing.
const projectedLength = (segments: typeof front.visible) =>
  segments.reduce((n, s) => n + Math.hypot(s.u1 - s.u0, s.v1 - s.v0), 0);
for (const view of ["front", "side", "top", "pictorial"] as const) {
  const normal = SHEET_VIEWS[view].normal as Vec3;
  const drawing = projectDrawing(boxes, normal);
  const { direction, up } = viewCameraBasis(normal);
  const right = new THREE.Vector3().crossVectors(up, direction);

  // Against the outline itself, not against another run of the same pass: every
  // millimetre of every edge has to come back as either seen or not seen.
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let outline = 0;
  for (const edge of outlineOfBoxes(boxes)) {
    a.fromArray(edge.start);
    b.fromArray(edge.end);
    outline += Math.hypot(a.dot(right) - b.dot(right), a.dot(up) - b.dot(up));
  }
  check(
    `${view}: every millimetre of the outline is accounted for`,
    near(projectedLength(drawing.visible) + projectedLength(drawing.hidden), outline, 1e-6),
    `${outline.toFixed(0)} mm, ${((100 * projectedLength(drawing.visible)) / outline).toFixed(0)}% of it in front`
  );

  // The silhouette is the strongest statement available about what must be
  // visible: an edge lying on the convex hull of the whole projection has
  // nothing in front of it, by definition of the hull.
  const points: Array<[number, number]> = [];
  const corner = new THREE.Vector3();
  for (const box of boxes) {
    for (let k = 0; k < 8; k++) {
      corner.set(
        k & 1 ? box.max.x : box.min.x,
        k & 2 ? box.max.y : box.min.y,
        k & 4 ? box.max.z : box.min.z
      );
      points.push([corner.dot(right), corner.dot(up)]);
    }
  }
  const onSilhouette = hullTest(points);
  const wrong = drawing.hidden.filter(
    (s) =>
      Math.hypot(s.u1 - s.u0, s.v1 - s.v0) > 0.5 &&
      onSilhouette(s.u0, s.v0) &&
      onSilhouette(s.u1, s.v1)
  );
  check(`${view}: nothing on the silhouette is called hidden`, wrong.length === 0, `${wrong.length} segments`);
}

// A view drawn without hidden lines is the same visible set, not a different
// drawing — switching them off must not change what is in front.
const plain = projectDrawing(boxes, SHEET_VIEWS.front.normal as Vec3, { withHidden: false });
check(
  "switching hidden lines off leaves the visible ones alone",
  plain.visible.length === front.visible.length && plain.hidden.length === 0
);

// ---------------------------------------------------------------------------
// Hidden lines: touching is not blocking
// ---------------------------------------------------------------------------

console.log("\nHidden-line removal");

// One box, from a direction square to none of its faces: three faces are toward
// the viewer, so nine of its twelve arrises are visible and the three meeting at
// the far corner are not. Hand-derived, and the anchor for everything below.
const cube = projectDrawing(
  [new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 20, 30))],
  [1, 0.8, 1.3] as Vec3
);
check(
  "one box shows nine of its twelve arrises",
  cube.visible.length === 9 && cube.hidden.length === 3,
  `${cube.visible.length} visible, ${cube.hidden.length} hidden`
);

// The case that was wrong, at its smallest. Two 7 mm posts offset diagonally by
// exactly their own size, seen along the diagonal: the ray leaving the near
// post's arris arrives precisely at the far post's *corner*, entering and
// leaving it at the same instant. That is a graze, not an occlusion — but a
// triangle raycaster reports a hit for it, and since every part in this app is
// axis-aligned and laid out on a regular grid, it happens constantly. It cost
// 8% of the shipped lamp's visible outline, including whole full-height arrises.
const near1 = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(7, 10, 7));
const far1 = new THREE.Box3(new THREE.Vector3(7, 0, 7), new THREE.Vector3(14, 10, 14));
const grazing = projectDrawing([near1, far1], [1, 0, 1] as Vec3);
// The arris at x = 0, z = 7 runs the full 10 mm of the post's height, and the
// projection is along +y there, so it comes out 10 mm long.
const fullHeight = grazing.visible.filter(
  (s) => Math.abs(s.u1 - s.u0) < 1e-6 && Math.abs(Math.abs(s.v1 - s.v0) - 10) < 1e-6
);
check(
  "a ray that only touches the corner of the next part is not blocked",
  fullHeight.length >= 4,
  `${fullHeight.length} full-height arrises drawn solid, of ${grazing.visible.length} visible segments`
);
check(
  "and the arris the ray actually grazes past is one of them",
  fullHeight.some((s) => Math.abs(s.u0 - 7 / Math.SQRT2) < 1e-6 || Math.abs(s.u0 + 7 / Math.SQRT2) < 1e-6),
  fullHeight.map((s) => s.u0.toFixed(2)).join(", ")
);

// Stations are the faces the chains hang off, read straight off the boxes.
const stations = boxStations(boxes);
check(
  "the outermost stations are the model's own extents",
  near(stations[1][0], overall.min.y, 1e-6) &&
    near(stations[1][stations[1].length - 1], overall.max.y, 1e-6),
  `y from ${stations[1][0].toFixed(1)} to ${stations[1][stations[1].length - 1].toFixed(1)}`
);
check("stations are sorted and distinct", stations.every((axis) => axis.every((v, i) => i === 0 || v > axis[i - 1])));

// ---------------------------------------------------------------------------
// Scale and fit
// ---------------------------------------------------------------------------

console.log("\nScale");

const frame = { x: 10, y: 10, width: 130, height: 90 };
const scale = fitScale(front.bounds, frame);
const place = placement(front.bounds, frame, scale);
const corners = [
  place.toPaper(front.bounds.minU, front.bounds.minV),
  place.toPaper(front.bounds.maxU, front.bounds.maxV),
];
const room = DIM_RESERVE_MM;

// The exact fit, and how much of it the stated ratio gives back. Snapping to the
// conventional ladder used to cost up to half the linear size — a drawing that
// fitted at 1:3 was drawn at 1:5 — which on a full-height cell is tens of
// millimetres of white space on every side.
const exactFit = Math.min(
  (frame.width - room * 2) / (front.bounds.maxU - front.bounds.minU),
  (frame.height - room * 2) / (front.bounds.maxV - front.bounds.minV)
);
check("the scale never exceeds the exact fit", scale <= exactFit + 1e-12, scaleLabel(scale));
check(
  "and gives up under 1% of it to being printable",
  scale > exactFit * 0.99,
  `${scaleLabel(scale)} against an exact ${scaleLabel(exactFit)} — ${(100 * (1 - scale / exactFit)).toFixed(2)}% given up`
);
check(
  "the stated ratio is short enough to print",
  /^1:\d+(\.\d{1,2})?$|^\d+(\.\d{1,2})?:1$/.test(scaleLabel(scale)),
  scaleLabel(scale)
);

check(
  "the drawing plus its dimensions land inside the frame",
  corners[0].x - room >= frame.x - 1e-9 &&
    corners[0].y - room >= frame.y - 1e-9 &&
    corners[1].x + room <= frame.x + frame.width + 1e-9 &&
    corners[1].y + room <= frame.y + frame.height + 1e-9,
  `${scaleLabel(scale)}: drawing ${(corners[1].x - corners[0].x).toFixed(1)} × ${(corners[1].y - corners[0].y).toFixed(1)} mm plus ${room} mm each side, in ${frame.width} × ${frame.height}`
);
check(
  "the drawing is centred in the frame",
  near((corners[0].x + corners[1].x) / 2, frame.x + frame.width / 2, 1e-9) &&
    near((corners[0].y + corners[1].y) / 2, frame.y + frame.height / 2, 1e-9)
);
// The slack left around the drawing, which is what the ratio is chosen to keep
// small: no more than 1% of the cell on the axis that binds.
const slackW = frame.width - room * 2 - (front.bounds.maxU - front.bounds.minU) * scale;
const slackH = frame.height - room * 2 - (front.bounds.maxV - front.bounds.minV) * scale;
check(
  "the tighter axis is left with almost no slack",
  Math.min(slackW, slackH) < frame.height * 0.01,
  `${Math.min(slackW, slackH).toFixed(2)} mm across the binding axis`
);

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

console.log("\nCounting");

const list = buildCutList(instances, scene);
const piecesInScene = instances.reduce((n, i) => n + (scene.shapes.get(i.id)?.boxes.length ?? 0), 0);
check(
  "the total piece count is the scene's own",
  list.totalPieces === piecesInScene,
  `${list.totalPieces} against ${piecesInScene}`
);
check(
  "every instance is accounted for exactly once",
  list.components.reduce((n, c) => n + c.instances, 0) === instances.length,
  `${list.components.reduce((n, c) => n + c.instances, 0)} of ${instances.length}`
);
check(
  "the cut list quantities add up to the same pieces",
  list.rows.reduce((n, r) => n + r.quantity, 0) === piecesInScene,
  `${list.rows.reduce((n, r) => n + r.quantity, 0)}`
);
check(
  "sizes are distinct",
  new Set(list.rows.map((r) => sizeLabel(r.size))).size === list.rows.length
);
check(
  "the cut list runs longest first",
  list.rows.every((row, i) => i === 0 || row.size[0] <= list.rows[i - 1].size[0])
);
check(
  "every row names at least one component that wants it",
  list.rows.every((row) => row.from.length > 0 && row.from.every((name) => list.components.some((c) => c.name === name)))
);

// A piece is its three dimensions, longest first, so the same stick standing up
// and lying down is one row rather than two.
const upright = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(7, 240, 7));
const flat = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(240, 7, 7));
check(
  "orientation does not make a second kind of piece",
  sizeLabel(pieceSize(upright)) === sizeLabel(pieceSize(flat)),
  `${sizeLabel(pieceSize(upright))}`
);

const stock = stockBySection(list);
check(
  "stock metres are the summed lengths",
  near(
    stock.reduce((n, s) => n + s.metres, 0),
    list.rows.reduce((n, r) => n + (r.size[0] * r.quantity) / 1000, 0),
    1e-9
  ),
  `${stock.reduce((n, s) => n + s.metres, 0).toFixed(2)} m over ${stock.length} sections`
);
check(
  "hiding a part on the bench does not take it off the lamp",
  buildCutList(instances, scene, []).totalPieces === list.totalPieces
);
const withoutOne = buildCutList(instances, scene, [instances[0].id]);
check(
  "but asking for it to be left out does",
  withoutOne.totalPieces < list.totalPieces,
  `${withoutOne.totalPieces} against ${list.totalPieces}`
);

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

console.log("\nThe document");

// The graph paper is opt-in, and it is the only thing on a sheet that is ink
// without being information — so what has to hold is that asking for it adds it
// and touches nothing else.
const gridded = buildBlueprint({
  name: lampFile.id,
  instances,
  scene,
  variables: raw,
  date: "2026-08-13",
  paper: "a4",
  grid: true,
});

const pdf = buildBlueprint({
  name: lampFile.id,
  description: lampFile.description,
  instances,
  scene,
  variables: raw,
  date: "2026-08-13",
  paper: "a4",
});
const text = Buffer.from(pdf).toString("latin1");
const pages = (text.match(/\/Type \/Page[^s]/g) ?? []).length;

check("it is a PDF", text.startsWith("%PDF-1.4"));
check(
  "one page, while the document is being rebuilt",
  pages === 1,
  `${pages} sheet, ${(pdf.length / 1024).toFixed(0)} kB`
);
check("the sheet is numbered against the total", text.includes("1 / 1"));
check("the title block states the units", text.includes("millimetres"));
check("A4 landscape, because the shipped lamp stands up", text.includes("/MediaBox [0 0 841.89 595.276]"));

// Nothing may be drawn outside the sheet: a coordinate off the page is not
// clipped by a PDF reader, it is simply drawn nowhere, and the loss is silent.
const points = [...text.matchAll(/(-?\d+\.?\d*) (-?\d+\.?\d*) (?:m|l)\b/g)];
const strays = points.filter((m) => {
  const x = Number(m[1]);
  const y = Number(m[2]);
  // The shipped lamp stands up, so its sheet is landscape.
  const sheetSize = paperSheet("a4", "landscape");
  return x < -1 || y < -1 || x > sheetSize.width * (72 / 25.4) + 1 || y > sheetSize.height * (72 / 25.4) + 1;
});
check(
  "nothing is drawn off the edge of the paper",
  strays.length === 0,
  `${strays.length} of ${points.length} points outside the sheet`
);

const paper = Buffer.from(gridded).toString("latin1");
const countPaths = (s: string) => (s.match(/ m [\d.]+ [\d.]+ l/g) ?? []).length;
// What it adds is countable rather than a matter of degree. The frame is
// 283 x 181 mm, so 5 mm paper is 57 + 37 lines and the 25 mm level over it is
// 12 + 8 — a bit over a hundred a sheet.
const addedPerSheet = (countPaths(paper) - countPaths(text)) / pages;
check(
  "asking for graph paper adds exactly the graph paper",
  addedPerSheet > 100 && addedPerSheet < 130,
  `${addedPerSheet.toFixed(0)} strokes a sheet, ${(gridded.length / 1024).toFixed(0)} kB against ${(pdf.length / 1024).toFixed(0)} kB`
);
check(
  "and brings nothing else with it",
  (paper.match(/\/Type \/Page[^s]/g) ?? []).length === pages && paper.includes("millimetres"),
  "same sheets, same title block"
);
check("and the default is the working sheet, without it", countPaths(text) < countPaths(paper));

// ---------------------------------------------------------------------------
// How the page is divided
// ---------------------------------------------------------------------------

console.log("\nDividing the page");

const v = new THREE.Vector3(200, 460, 200);
const h = new THREE.Vector3(600, 180, 240);
const squarePlan = new THREE.Vector3(300, 310, 300);
check("a lamp taller than it is wide stands up", lampOrientation(v) === "vertical");
check("one wider than it is tall lies down", lampOrientation(h) === "horizontal");
check(
  "height is judged against the larger plan dimension, not just the width",
  lampOrientation(squarePlan) === "vertical",
  "310 tall on a 300 x 300 plan is still a standing lamp"
);
check("the shipped lamp stands up", lampOrientation(overall.getSize(new THREE.Vector3())) === "vertical");

// The other way up from the lamp, because the half is what has to fit it: a
// landscape sheet cut down the middle gives two tall halves, a portrait one cut
// across gives two wide ones.
// A cut is named for the line that makes it, and the first half is the one a
// reader meets first.
const someFrame = { x: 7, y: 22, width: 200, height: 100 };
const [left, right] = divide(someFrame, "vertical");
const [above, below] = divide(someFrame, "horizontal");
check("a vertical cut leaves two side by side, left first", left.x < right.x && left.height === someFrame.height);
check("a horizontal cut leaves two stacked, top first", above.y > below.y && above.width === someFrame.width);
check("halving a wide rectangle cuts it down the middle", cutFor(someFrame) === "vertical");
check("halving a tall one cuts it across", cutFor({ ...someFrame, width: 100, height: 200 }) === "horizontal");

// Whether a second elevation is worth the quarter page it costs.
const frontView = projectDrawing(boxes, SHEET_VIEWS.front.normal as Vec3);
const sideView = projectDrawing(boxes, SHEET_VIEWS.side.normal as Vec3);
check(
  "a lamp square in plan draws one elevation, not two",
  sameDrawing(frontView, sideView),
  "front and side are the same drawing"
);
// The regression that made every symmetric lamp look asymmetric: a projection
// draws one line twice wherever two arrises land on top of each other, and how
// many times a line was drawn over itself is not visible on paper.
check(
  "coincident lines do not make two views differ",
  frontView.visible.length === sideView.visible.length &&
    new Set(frontView.visible.map((s) => [s.u0, s.v0, s.u1, s.v1].map((n) => n.toFixed(2)).join())).size <
      frontView.visible.length,
  `${frontView.visible.length} segments, ${new Set(frontView.visible.map((s) => [s.u0, s.v0, s.u1, s.v1].map((n) => n.toFixed(2)).join())).size} distinct`
);
// And a genuinely different pair still reads as different: turn the lamp's own
// side elevation into the comparison and it matches; compare with the plan, a
// different shape entirely, and it does not.
check(
  "two genuinely different views still compare as different",
  !sameDrawing(frontView, projectDrawing(boxes, SHEET_VIEWS.top.normal as Vec3))
);

check("a standing lamp goes on a landscape sheet, for the tall half", paperFor("vertical") === "landscape");
check("one lying down goes on a portrait sheet, for the wide half", paperFor("horizontal") === "portrait");
check(
  "A4 is the same sheet either way up",
  paperSheet("a4", "landscape").width === paperSheet("a4", "portrait").height &&
    paperSheet("a4", "landscape").height === paperSheet("a4", "portrait").width,
  `${paperSheet("a4", "portrait").width} × ${paperSheet("a4", "portrait").height} portrait`
);

// The division is a fact about the sheet, not about the lamp: a page is always
// cut across its own long axis, so each half is as close to the page's shape as
// halving allows.
const wide = { x: 7, y: 22, width: 283, height: 181 };
const tall = { x: 7, y: 22, width: 196, height: 268 };
for (const [name, sheet, cut, halves] of [
  ["a wide page", wide, "down the middle", "side by side"],
  ["a tall page", tall, "across the middle", "stacked"],
] as const) {
  const [first, second] = splitPage(sheet);
  const sideBySide = first.x < second.x;
  check(
    `${name} is cut ${cut}, two halves ${halves}`,
    sideBySide === (halves === "side by side") &&
      (sideBySide
        ? first.height === sheet.height && near(first.width, (sheet.width - 4) / 2, 1e-9)
        : first.width === sheet.width && near(first.height, (sheet.height - 4) / 2, 1e-9)),
    `${first.width.toFixed(1)} × ${first.height.toFixed(1)} mm`
  );
  check(
    `${name}: the first half is the ${sideBySide ? "left" : "top"} one`,
    sideBySide ? first.x < second.x : first.y > second.y
  );
  // Both halves inside the sheet, and neither overlapping the other.
  const inside = (f: typeof wide) =>
    f.x >= sheet.x - 1e-9 &&
    f.y >= sheet.y - 1e-9 &&
    f.x + f.width <= sheet.x + sheet.width + 1e-9 &&
    f.y + f.height <= sheet.y + sheet.height + 1e-9;
  check(`${name}: both halves stay on the sheet`, inside(first) && inside(second));
}

// Every lamp in the library through the page-one layout, rather than one lamp
// and a synthesised bounding box: the shipped designs cover both a tall lamp and
// a wide one, so both ways the page can divide are exercised on something real.
//
// Only marks *above* the title block count. The block's own cell rules run the
// full width of the sheet and are furniture rather than drawing; counting them
// would make this assertion impossible to pass and say nothing if it did.
console.log("\nEvery lamp in the library, on page one");

for (const file of readdirSync("public/models/lamps")) {
  if (!file.endsWith(".json") || file === "index.json") continue;
  const lamp = parseLampFile(JSON.parse(readFileSync(`public/models/lamps/${file}`, "utf8")));
  const built = toInstances(lamp, defs);
  const vars = { ...built.variables, ...lamp.variables };
  const lampScene = computeScene(built.instances, vars);

  const box = new THREE.Box3();
  for (const world of lampScene.worldBoxes.values()) box.union(world);
  const size = box.getSize(new THREE.Vector3());
  const orientation = lampOrientation(size);
  const page = paperSheet("a4", paperFor(orientation));
  const sheet = {
    x: 7,
    y: 22,
    width: page.width - 14,
    height: page.height - 14 - 15,
  };
  // Read off the layout itself rather than re-derived here: a check that
  // recomputes the thing it is checking can only ever agree with its own copy.
  const regions = pageRegions(sheet);

  const body = Buffer.from(
    buildBlueprint({
      name: lamp.id,
      instances: built.instances,
      scene: lampScene,
      variables: vars,
      date: "2026-08-13",
      paper: "a4",
    })
  ).toString("latin1");
  const marks = [...body.matchAll(/([\d.]+) ([\d.]+) (?:m|l)\b/g)]
    .map((m) => ({ x: Number(m[1]) / (72 / 25.4), y: Number(m[2]) / (72 / 25.4) }))
    .filter((p) => p.y >= sheet.y);
  // Everything has to land inside the border. The halves themselves are checked
  // as geometry above; what this adds is that a real design, at a real scale,
  // does not overrun the frame it was fitted to.
  const sideBySide = regions.picture.width < sheet.width;
  const strayed = marks.filter(
    (p) =>
      p.x < sheet.x - 1e-6 ||
      p.y < sheet.y - 1e-6 ||
      p.x > sheet.x + sheet.width + 1e-6 ||
      p.y > sheet.y + sheet.height + 1e-6
  );

  // And the elevations: two only when the two faces actually differ.
  const lampBoxes = built.instances.flatMap((instance) => {
    const shape = lampScene.shapes.get(instance.id)!;
    const place = lampScene.placements.get(instance.id)!;
    const m = new THREE.Matrix4().compose(place.position, place.quaternion, new THREE.Vector3(1, 1, 1));
    return shape.boxes.map((box) => {
      const out = new THREE.Box3();
      const c = new THREE.Vector3();
      for (let k = 0; k < 8; k++) {
        c.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(m);
        out.expandByPoint(c);
      }
      return out;
    });
  });
  const alike = sameDrawing(
    projectDrawing(lampBoxes, SHEET_VIEWS.front.normal as Vec3),
    projectDrawing(lampBoxes, SHEET_VIEWS.side.normal as Vec3)
  );
  // The elevations of the *lamp*, not of the pieces — every piece now emits
  // captions of its own using the same words, so counting them all together
  // measures nothing. What identifies the lamp's own pair is that its scale
  // caption sits beside them; simplest reliable test is the merged form, which
  // only the lamp's elevations ever use.
  const mergedElevation = body.includes("(FRONT & SIDE) Tj");

  // The last piece holds one drawing per distinct piece of timber, and a piece
  // is a **component** — its blocks are the joinery cut into it, not separate
  // sticks. Counting blocks produced sections like 7 × 3.5, which is not a size
  // anybody planes: it is half the thickness of a lap.
  const kinds = new Set(built.instances.map((i) => i.def.file)).size;
  const drawn = (body.match(/\(\d+× /g) ?? []).length;
  const inPieces = marks.filter(
    (p) =>
      p.x > regions.pieces.x - 1e-6 &&
      p.y > regions.pieces.y - 1e-6 &&
      p.x < regions.pieces.x + regions.pieces.width + 1e-6 &&
      p.y < regions.pieces.y + regions.pieces.height + 1e-6
  );

  check(
    `${file.replace(/(\.lamp)?\.json$/, "").padEnd(18)} ${size.x.toFixed(0)}×${size.y.toFixed(0)}×${size.z.toFixed(0)} — ${paperFor(orientation)}, picture ${sideBySide ? "left" : "top"}, ${alike ? "one elevation" : "two"}, ${kinds} pieces`,
    marks.length > 0 &&
      strayed.length === 0 &&
      mergedElevation === alike &&
      drawn === kinds &&
      inPieces.length > 0,
    strayed.length > 0
      ? `${strayed.length} of ${marks.length} marks outside the border`
      : `${drawn} of ${kinds} drawn, ${inPieces.length} marks in their quarter`
  );
}

const out = "dist-ssr/__blueprintcheck.pdf";
writeFileSync(out, pdf);
writeFileSync("dist-ssr/__blueprintcheck-grid.pdf", gridded);
console.log(
  `\nwrote ${out} (${(pdf.length / 1024).toFixed(0)} kB, ${pages} sheets)` +
    ` and __blueprintcheck-grid.pdf (${(gridded.length / 1024).toFixed(0)} kB) — open them`
);

console.log(failures === 0 ? "\nall good\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
