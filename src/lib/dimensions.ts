import type { AxisIndex, Span } from "./measure";

/**
 * Drafting dimension chains, as arithmetic.
 *
 * This is the layout half of what the projections draw — where the stations
 * become links, which links earn a value, where the extension lines and the
 * arrowheads go, and which labels have room to be drawn at all. It is pure and
 * two-dimensional: everything is in the view's own plane, in `(u, v)`, and the
 * caller maps that back to wherever it is drawing.
 *
 * It has two callers with nothing else in common, which is why it is a module
 * rather than part of a component. The editor draws the plan as scene geometry
 * at a zoom, in world millimetres; the blueprint export draws the same plan on
 * paper at a scale, in paper millimetres. Both hand in *world units* for the
 * text height and the gaps — the editor divides pixels by its zoom, the export
 * divides paper millimetres by its scale — and the same arithmetic serves both,
 * because "a fixed size on the output, whatever the drawing is doing" is the
 * same requirement in a cell and on a sheet.
 *
 * Two things stay with the caller on purpose:
 *
 * - **What a link is worth** (`valueFor`). The editor asks the span solver, so a
 *   length the designer set comes back as their own formula, underlined; the
 *   export has no measurement model to ask and reads the millimetres off the
 *   drawing.
 * - **What counts as solid** (`isSolid`). A gap between two parts that are not
 *   joined is not a size, and only the caller knows what its runs are.
 *
 * Full write-up: docs/algorithms/projection-and-dimensions.md
 */

/** The drawing's extents in the view plane. */
export interface DimBounds {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

/**
 * A world axis as seen by one screen axis: which axis, whether this view looks
 * at it from the far side, and the stations along it in screen order.
 */
export interface DimScreenAxis {
  axis: AxisIndex;
  sign: 1 | -1;
  values: number[];
}

/**
 * The chain's fixed sizes, in the same units as the bounds.
 *
 * A caller working at a zoom or a scale divides its output-space constants by
 * that factor before handing them over, which is what keeps text legible at any
 * magnification.
 */
export interface DimMetrics {
  /** Text em size. */
  text: number;
  /** Drawing edge to dimension line. */
  gap: number;
  arrow: number;
  /** How far an extension line runs past the dimension line it serves. */
  overrun: number;
}

export interface DimSeg {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** What a link says, and how it is dressed. */
export interface DimValue {
  text: string;
  colour: string;
  /** The drafting convention for a value the designer set or derived. */
  underline: boolean;
}

export interface DimLabel extends DimValue {
  u: number;
  v: number;
}

/**
 * A chain link as something that can be picked.
 *
 * `pick` is the dimension line itself — what the cursor is actually near.
 * `boundary` is the same span drawn on the *drawing's* edge, and it is the one
 * handed on to the model, because the dimension line moves with the zoom and a
 * stored measurement has to stay put.
 */
export interface DimGuide {
  pick: DimSeg;
  boundary: DimSeg;
}

export interface DimPlan {
  extension: DimSeg[];
  /** Dimension lines and their arrowheads. */
  dimension: DimSeg[];
  guides: DimGuide[];
  labels: DimLabel[];
}

export interface DimInput {
  bounds: DimBounds;
  uAxis: DimScreenAxis | null;
  vAxis: DimScreenAxis | null;
  metrics: DimMetrics;
  /**
   * Whether to add the outer link that states the whole extent.
   *
   * False while the parts are still separate: nothing has an overall size until
   * they are joined, and until then only the individual features do.
   */
  overall: boolean;
  isSolid: (span: Span) => boolean;
  valueFor: (span: Span, length: number) => DimValue;
}

// Past this many links a chain is unreadable at any magnification, and only the
// overall size is worth drawing.
const DIM_MAX_LINKS = 12;

/**
 * Lay out both axes' chains.
 *
 * Per axis: the stations strictly inside the bounds become the interior of the
 * chain, consecutive pairs become links, and a link whose span crosses a gap is
 * dropped. Features hang below the drawing and to its left; the overall size
 * rides above it and to its right, so no dimension line ever crosses the part
 * and the two kinds of number are not told apart merely by how far out they sit.
 *
 * Links are drawn biggest first and a label that would land on one already
 * placed is dropped — at a magnification where they would collide the numbers
 * are unreadable anyway.
 */
export function planDimensions(input: DimInput): DimPlan {
  const { bounds, metrics, overall, isSolid, valueFor } = input;
  const { minU, maxU, minV, maxV } = bounds;
  const { text: th, gap, arrow, overrun } = metrics;

  const extension: DimSeg[] = [];
  const dimension: DimSeg[] = [];
  const guides: DimGuide[] = [];
  const labels: DimLabel[] = [];
  const placed: Array<[number, number, number, number]> = [];

  const seg = (out: DimSeg[], u0: number, v0: number, u1: number, v1: number) => {
    out.push({ u0, v0, u1, v1 });
  };

  // A chain is laid out in (along, cross): `along` is the axis being measured,
  // `cross` steps away from the drawing. `horizontal` maps that back to the view
  // plane, and also decides which way round a label's footprint sits — text is
  // always upright.
  //
  // `nearEdge` is the boundary the features hang off, `farEdge` the opposite one
  // the overall size hangs off. A link carries the edge it belongs to and the
  // direction that steps away from the drawing, so everything downstream works
  // the same either way round.
  const layout = (
    screen: DimScreenAxis | null,
    lo: number,
    hi: number,
    nearEdge: number,
    farEdge: number,
    horizontal: boolean
  ) => {
    if (!screen) return;
    const tol = Math.max(maxU - minU, maxV - minV, 1e-6) * 0.002;
    const inRange = screen.values.filter((c) => c > lo + tol && c < hi - tol);
    let stations = [lo, ...inRange, hi];
    if (stations.length - 1 > DIM_MAX_LINKS) stations = [lo, hi];
    if (stations.length < 2) return;

    const uv = (along: number, cross: number): [number, number] =>
      horizontal ? [along, cross] : [cross, along];

    // back to world-axis coordinates: the screen axis may look at the world axis
    // from the far side, in which case `along` runs the other way
    const worldSpan = (a: number, b: number): Span => {
      const wa = a * screen.sign;
      const wb = b * screen.sign;
      return { axis: screen.axis, a: Math.min(wa, wb), b: Math.max(wa, wb) };
    };

    interface Link {
      a: number;
      b: number;
      span: Span;
      edge: number; // the drawing boundary this link hangs off
      outward: 1 | -1; // which way it steps away from the drawing
    }
    const links: Link[] = [];
    const pushLink = (a: number, b: number, edge: number, outward: 1 | -1) => {
      const span = worldSpan(a, b);
      if (isSolid(span)) links.push({ a, b, span, edge, outward });
    };
    for (let i = 0; i + 1 < stations.length; i++) {
      pushLink(stations[i], stations[i + 1], nearEdge, -1);
    }
    // A chain that came out as a single link already *is* the overall size, so
    // it stays with the features rather than being drawn twice.
    if (links.length > 1 && overall) {
      pushLink(stations[0], stations[stations.length - 1], farEdge, 1);
    }
    if (links.length === 0) return;

    const lineAt = (link: Link) => link.edge + link.outward * gap;

    // A station only earns an extension line if some value was actually drawn
    // against it — the far side of a gap is a station of the drawing but of no
    // dimension. A station served on both sides earns one in each margin.
    const served = new Map<string, Link & { station: number }>();
    for (const link of links) {
      for (const station of [link.a, link.b]) {
        served.set(`${link.outward}:${station}`, { ...link, station });
      }
    }
    for (const { station, edge, outward } of served.values()) {
      seg(
        extension,
        ...uv(station, edge + outward * gap * 0.3),
        ...uv(station, edge + outward * (gap + overrun))
      );
    }

    // biggest first, so the overall size claims its place before the features
    const ordered = [...links].sort((x, y) => y.b - y.a - (x.b - x.a));
    for (const link of ordered) {
      const c = lineAt(link);
      const length = link.b - link.a;
      const { text, colour, underline } = valueFor(link.span, length);

      // the picked span sits on the drawing's own boundary, not on the dimension
      // line — the dimension line moves with the magnification, the boundary
      // does not, and a stored measurement has to stay put
      const [gu0, gv0] = uv(link.a, link.edge);
      const [gu1, gv1] = uv(link.b, link.edge);
      const [pu0, pv0] = uv(link.a, c);
      const [pu1, pv1] = uv(link.b, c);
      guides.push({
        boundary: { u0: gu0, v0: gv0, u1: gu1, v1: gv1 },
        pick: { u0: pu0, v0: pv0, u1: pu1, v1: pv1 },
      });

      // arrowheads sit inside a link with room for them and flip to the outside,
      // pointing in, on one too short to take them
      const textAlong = horizontal ? th * (0.45 * text.length + 0.3) : th;
      const textCross = horizontal ? th : th * (0.45 * text.length + 0.3);
      const inside = length > Math.max(textAlong, arrow * 2.4) * 1.15;
      const reach = inside ? 0 : arrow * 1.6;
      seg(dimension, ...uv(link.a - reach, c), ...uv(link.b + reach, c));
      for (const [end, sign] of [
        [link.a, 1],
        [link.b, -1],
      ] as const) {
        const d = sign * (inside ? arrow : -arrow);
        seg(dimension, ...uv(end, c), ...uv(end + d, c + arrow * 0.3));
        seg(dimension, ...uv(end, c), ...uv(end + d, c - arrow * 0.3));
      }

      // the value sits on the far side of its dimension line, never between the
      // line and the part
      const mid = (link.a + link.b) / 2;
      const cText = c + link.outward * (textCross * 0.5 + th * 0.3);
      const [u0, v0] = uv(mid - textAlong / 2, cText - textCross / 2);
      const [u1, v1] = uv(mid + textAlong / 2, cText + textCross / 2);
      const box: [number, number, number, number] = [
        Math.min(u0, u1),
        Math.min(v0, v1),
        Math.max(u0, u1),
        Math.max(v0, v1),
      ];
      const clash = placed.some(
        (q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]
      );
      if (clash) continue;
      placed.push(box);
      const [lu, lv] = uv(mid, cText);
      labels.push({ text, colour, underline, u: lu, v: lv });
    }
  };

  layout(input.uAxis, minU, maxU, minV, maxV, true);
  layout(input.vAxis, minV, maxV, minU, maxU, false);

  return { extension, dimension, guides, labels };
}

/**
 * How far a chain reaches beyond the drawing, in the same units as the metrics.
 *
 * Reserved on all four sides *before* the drawing is framed, so no value can
 * fall off the edge — and the same on every side, so what is drawn stays centred
 * on the model rather than being pushed over by its own dimensions.
 */
export function dimensionReserve(metrics: DimMetrics): number {
  return metrics.gap + metrics.text * 2 + metrics.overrun;
}

/** A length as it is written on a drawing: one decimal, and no trailing zero. */
export function formatLength(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
