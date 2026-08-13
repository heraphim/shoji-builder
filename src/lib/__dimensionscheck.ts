import { planDimensions, dimensionReserve, formatLength, type DimInput } from "./dimensions";
import type { Span } from "./measure";

/**
 * The drafting rules, as arithmetic anybody can check by hand.
 *
 * This layout used to live inside the projection cell, where every one of its
 * decisions came out as scene geometry at a zoom and the only way to ask whether
 * it was right was to look at it. The rules it encodes are not visual, though —
 * how many links a chain has, which of them earn a value, which station earns an
 * extension line, when an arrowhead has to flip outside — and each of them has
 * an answer that can be counted.
 *
 * The numbers below are worked out from the inputs rather than recorded from a
 * run, so a change in behaviour fails here rather than being blessed.
 *
 * Run from the project root:
 *
 *     npx vite build --ssr src/lib/__dimensionscheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__dimensionscheck.js
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? ` — ${detail}` : ""}`);
}

const METRICS = { text: 4, gap: 6, arrow: 2, overrun: 1.5 };

// The value a link states, when nothing knows better than the drawing itself.
const measured = (_span: Span, length: number) => ({
  text: formatLength(length),
  colour: "#000000",
  underline: false,
});

function plan(over: Partial<DimInput>) {
  return planDimensions({
    bounds: { minU: 0, maxU: 100, minV: 0, maxV: 40 },
    uAxis: { axis: 0, sign: 1, values: [0, 30, 100] },
    vAxis: { axis: 1, sign: 1, values: [0, 40] },
    metrics: METRICS,
    overall: true,
    isSolid: () => true,
    valueFor: measured,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// The shape of a chain
// ---------------------------------------------------------------------------

console.log("\nA 100 x 40 drawing with one interior station at u = 30");

const base = plan({});

// u: two features [0,30] [30,100] plus the overall [0,100]. v: one link only,
// and a chain that came out as a single link already *is* the overall size, so
// it is not drawn twice.
check("three links across, one up", base.guides.length === 4, `${base.guides.length} guides`);

// Every link is a line plus four arrowhead strokes.
check("five strokes per link", base.dimension.length === 4 * 5, `${base.dimension.length}`);

// u: the features serve stations 0, 30, 100 below and the overall serves 0 and
// 100 above — 30 is shared by two links on the same side and earns one line, not
// two. v: two.
check("seven extension lines", base.extension.length === 7, `${base.extension.length}`);

check("every link is labelled when there is room", base.labels.length === 4, `${base.labels.length}`);
check(
  "the values are the lengths",
  base.labels.map((l) => l.text).sort().join(",") === "100,30,40,70",
  base.labels.map((l) => l.text).join(",")
);

// ---------------------------------------------------------------------------
// Which side of the drawing each kind of number sits on
// ---------------------------------------------------------------------------

const overall = base.labels.find((l) => l.text === "100")!;
const feature = base.labels.find((l) => l.text === "30")!;
check(
  "features hang below the drawing, the overall size rides above it",
  feature.v < 0 && overall.v > 40,
  `feature at v=${feature.v}, overall at v=${overall.v}`
);
check(
  "the up-axis chain sits to the left",
  base.labels.find((l) => l.text === "40")!.u < 0,
  `u=${base.labels.find((l) => l.text === "40")!.u}`
);
// The guide handed to the model is on the drawing's own boundary; the pickable
// line is out at the dimension line. Confusing the two is what would make a
// stored measurement move when somebody zoomed.
const overallGuide = base.guides.find((g) => Math.abs(g.boundary.u1 - g.boundary.u0) === 100)!;
check(
  "a guide's boundary is on the drawing, its pick line is not",
  overallGuide.boundary.v0 === 40 && overallGuide.pick.v0 === 46,
  `boundary v=${overallGuide.boundary.v0}, pick v=${overallGuide.pick.v0}`
);

// ---------------------------------------------------------------------------
// The three ways a link is refused
// ---------------------------------------------------------------------------

console.log("\nWhen a link is not drawn");

const separate = plan({ overall: false });
check(
  "no overall size until the parts are one solid",
  separate.guides.length === 3,
  `${separate.guides.length} guides`
);

// A span that crosses a gap is not a size, it is how far apart two parts happen
// to be drawn. Here: everything solid except the stretch from 30 to 100.
//
// Which takes the overall size with it, and should: refusing a feature leaves
// [0,30] as the only link across, and a chain of one link already states the
// whole of what it is allowed to state. Drawing 0..100 above it as well would be
// claiming an extent that the gap it just refused is sitting in the middle of.
const gapped = plan({
  isSolid: (span: Span) => !(span.axis === 0 && span.a === 30 && span.b === 100),
});
check(
  "a link that crosses a gap is dropped, and takes the overall size with it",
  gapped.guides.length === 2,
  `${gapped.guides.length} guides (one across, one up)`
);

// Past DIM_MAX_LINKS the chain is unreadable at any magnification and collapses
// to the overall size — which, being a single link, is then drawn as a feature.
const crowded = plan({
  uAxis: { axis: 0, sign: 1, values: [0, ...Array.from({ length: 14 }, (_, i) => (i + 1) * 6), 100] },
});
check(
  "a chain of more than twelve links collapses to the overall size",
  crowded.guides.length === 2,
  `${crowded.guides.length} guides (one across, one up)`
);

// ---------------------------------------------------------------------------
// Labels that will not fit
// ---------------------------------------------------------------------------

console.log("\nTwo short links, side by side, at a size where the numbers collide");

const tight = planDimensions({
  bounds: { minU: 0, maxU: 10, minV: 0, maxV: 10 },
  uAxis: { axis: 0, sign: 1, values: [0, 5, 10] },
  vAxis: null,
  metrics: { text: 8, gap: 6, arrow: 2, overrun: 1.5 },
  overall: true,
  isSolid: () => true,
  valueFor: measured,
});
// "5" at size 8 is 6 wide against a 5-long link, so the two feature labels
// overlap. Both links are still drawn and still pickable — only the second
// number is dropped, and zooming in brings it straight back.
check("all three links are drawn", tight.guides.length === 3, `${tight.guides.length}`);
check("the clashing label is dropped", tight.labels.length === 2, `${tight.labels.map((l) => l.text).join(",")}`);
check("the overall size is the one that keeps its place", tight.labels.some((l) => l.text === "10"));

// ---------------------------------------------------------------------------
// Arrowheads
// ---------------------------------------------------------------------------

console.log("\nArrowheads");

// A link with room takes its arrows inside and the dimension line runs exactly
// between the two stations; one without takes them outside, pointing in, and the
// line is extended past both ends so they have something to sit on.
const roomy = tight.dimension[0];
const longEnough = base.dimension.find((d) => Math.abs(d.u1 - d.u0) > 90)!;
check(
  "a link with room draws its line station to station",
  longEnough.u0 === 0 && longEnough.u1 === 100,
  `${longEnough.u0}..${longEnough.u1}`
);
check(
  "a link too short for its arrows extends past both ends",
  roomy.u0 === 0 - 2 * 1.6 && roomy.u1 === 10 + 2 * 1.6,
  `${roomy.u0}..${roomy.u1}`
);

// ---------------------------------------------------------------------------
// What the caller reserves for all of this
// ---------------------------------------------------------------------------

check(
  "the reserved strip covers the gap, two lines of text and the overrun",
  dimensionReserve(METRICS) === 6 + 8 + 1.5,
  `${dimensionReserve(METRICS)}`
);
// Both margins are used, and the reserve is the same on all four sides, so the
// drawing stays centred on the model rather than being pushed over by its own
// dimensions. What has to hold is that nothing reaches further out of the
// drawing than the strip the caller gave up for it — measured, for each label,
// as how far outside the bounds it actually lands.
const outside = (u: number, v: number) => Math.max(0, 0 - u, u - 100, 0 - v, v - 40);
const reach = Math.max(
  ...base.labels.map((l) => outside(l.u, l.v)),
  ...base.extension.flatMap((s) => [outside(s.u0, s.v0), outside(s.u1, s.v1)]),
  ...base.dimension.flatMap((s) => [outside(s.u0, s.v0), outside(s.u1, s.v1)])
);
check(
  "nothing is laid out beyond the reserved strip",
  reach <= dimensionReserve(METRICS),
  `furthest at ${reach.toFixed(1)}, reserve ${dimensionReserve(METRICS)}`
);

check("lengths are written to one decimal, without a trailing zero", formatLength(40) === "40" && formatLength(40.25) === "40.3");

console.log(failures === 0 ? "\nall good\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
