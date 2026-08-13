import * as THREE from "three";
import { PdfDocument, type PdfPage } from "./pdf";
import {
  DIM_RESERVE_MM,
  GAP,
  paperSheet,
  PRINT_PALETTE,
  SHEET_VIEWS,
  TYPE,
  WEIGHT,
  fitScale,
  paintDrawing,
  paintGrid,
  projectDrawing,
  PIECE_VIEW,
  sameDrawing,
  stockOrientation,
  scaleLabel,
  statedScale,
  type Drawing,
  type Frame,
  type Placement,
  type Palette,
  type PaperOrientation,
  type PaperSize,
} from "./blueprint";
import type { DimBounds } from "./dimensions";
import { sizeLabel, type PieceSize } from "./cutlist";
import type { LampInstance, LampScene } from "./lamp";
import type { Vec3 } from "../store/useComponentEditorStore";

/**
 * The document: which sheets a lamp becomes, and what goes on each of them.
 *
 * `blueprint.ts` knows how to put drawings on paper; this decides what a set of
 * sheets has to say before somebody can build the thing.
 *
 * **This half is being rebuilt.** The first version produced five kinds of sheet
 * — title, general arrangement, bill of materials, one per component, then every
 * piece — which was a good way to find out what the machinery could do and a bad
 * way to hand somebody something to work from: ten sheets for a four-component
 * lamp, most of it restating what the cut list already said. So the composition
 * starts again from an empty document and is put back a page at a time. The
 * arithmetic underneath it — projection, hidden lines, dimension chains, the cut
 * list, the writer — is untouched.
 *
 * ## Page one
 *
 * **The lamp decides which way up the paper is** — and it is the other way up
 * from the lamp, which reads backwards until you follow it through. What has to
 * fit the drawing is not the page but the *half* of it the picture gets, and
 * halving a page across its long axis turns it the other way up: a landscape
 * sheet cut down the middle gives two tall halves, a portrait one cut across
 * gives two wide ones. So a standing lamp goes on a landscape sheet and a lamp
 * lying down on a portrait one.
 *
 * The page is then divided in two **across its own long axis**, which is a fact
 * about the sheet rather than about the lamp: a wide page is cut down the middle
 * into two side by side, a tall one across the middle into two stacked. The lamp
 * has already had its say and applying the same fact twice would only compound
 * it.
 *
 * The first half — left on a wide page, top on a tall one — holds the picture of
 * the finished lamp. The second is divided **the same way again**: the
 * projections go in the first of those, every distinct piece of timber in the
 * last.
 *
 * ```
 *   landscape sheet (standing lamp)      portrait sheet (lamp lying down)
 *   +-----------+------+---------+       +---------------------------+
 *   |           | TOP  | ====    |       |         picture           |
 *   |           +------+  ===    |       +---------------------------+
 *   |  picture  | FRONT|   ==    |       | TOP  |  FRONT  |   SIDE   |
 *   |           +------+   ==    |       +---------------------------+
 *   |           | SIDE |    =    |       | ||    ||   |    |    |    |
 *   +-----------+------+---------+       +---------------------------+
 * ```
 *
 * Both lines run in the direction the lamp itself runs — down the page for a
 * standing lamp, along it for one lying down — which is also the direction their
 * piece of the page is longest in. The pieces lie the same way, so they stack
 * across their line rather than along it.
 *
 * **One elevation or two, depending on the lamp.** A design square in plan draws
 * the same front and side, and putting both on the sheet spends a cell saying it
 * twice. So the two are drawn, compared as shapes, and the second is kept only
 * if it differs — two cells rather than three, for most lamps.
 */

// ---------------------------------------------------------------------------
// Sheet furniture
// ---------------------------------------------------------------------------

const MARGIN = 7;
const TITLE_BLOCK_HEIGHT = 15;

interface SheetRecord {
  page: PdfPage;
  title: string;
  scale: string;
}

/**
 * The pages, and the strip along the bottom of each of them.
 *
 * The title block is painted at the end rather than as each sheet is started,
 * for one reason: it says "sheet 3 of 11", and nothing knows what eleven is
 * until the last drawing has been laid out. Painting it last also puts it over
 * anything that overran, which is the right way round — a drawing that has
 * strayed into the block should be visibly clipped by it rather than quietly
 * drawn on top of the sheet's identity.
 */
class Sheets {
  readonly document = new PdfDocument();
  private readonly records: SheetRecord[] = [];

  private readonly paper: { width: number; height: number };
  private readonly palette: Palette;
  private readonly heading: string;
  private readonly footnote: string;
  private readonly date: string;
  private readonly grid: boolean;

  constructor(
    paper: { width: number; height: number },
    palette: Palette,
    heading: string,
    footnote: string,
    date: string,
    grid: boolean
  ) {
    this.paper = paper;
    this.palette = palette;
    this.heading = heading;
    this.footnote = footnote;
    this.date = date;
    this.grid = grid;
  }

  /** A new sheet, and the rectangle a drawing may use on it. */
  add(title: string, scale = ""): { page: PdfPage; frame: Frame } {
    const page = this.document.addPage(this.paper.width, this.paper.height);
    page.rect(0, 0, this.paper.width, this.paper.height, { fill: this.palette.paper });
    const frame: Frame = {
      x: MARGIN,
      y: MARGIN + TITLE_BLOCK_HEIGHT,
      width: this.paper.width - MARGIN * 2,
      height: this.paper.height - MARGIN * 2 - TITLE_BLOCK_HEIGHT,
    };
    if (this.grid) paintGrid(page, frame, this.palette);
    this.records.push({ page, title, scale });
    return { page, frame };
  }

  /** Set the scale on the sheet being worked on, once the fit has decided it. */
  scale(value: string): void {
    const last = this.records[this.records.length - 1];
    if (last) last.scale = value;
  }

  finish(): Uint8Array {
    const total = this.records.length;
    this.records.forEach((record, i) => {
      paintTitleBlock(record.page, this.palette, {
        heading: this.heading,
        title: record.title,
        scale: record.scale || "—",
        sheet: `${i + 1} / ${total}`,
        date: this.date,
        footnote: this.footnote,
      });
    });
    return this.document.build();
  }
}

function paintTitleBlock(
  page: PdfPage,
  palette: Palette,
  fields: {
    heading: string;
    title: string;
    scale: string;
    sheet: string;
    date: string;
    footnote: string;
  }
): void {
  const width = page.width - MARGIN * 2;
  const stroke = { colour: palette.frame, width: WEIGHT.frame };

  // The border and the block are one figure: the drawing sits inside a box whose
  // bottom edge is the top of the block.
  page.rect(MARGIN, MARGIN, width, page.height - MARGIN * 2, { stroke });
  page.rect(MARGIN, MARGIN, width, TITLE_BLOCK_HEIGHT, { stroke });

  // Four cells on the right, in the order they are looked up.
  const cells = [
    { label: "SCALE", value: fields.scale, width: 26 },
    { label: "SHEET", value: fields.sheet, width: 22 },
    { label: "DATE", value: fields.date, width: 30 },
  ];
  let x = MARGIN + width;
  for (const cell of cells) {
    x -= cell.width;
    page.lines([{ x0: x, y0: MARGIN, x1: x, y1: MARGIN + TITLE_BLOCK_HEIGHT }], {
      colour: palette.frame,
      width: WEIGHT.dim,
    });
    page.text(cell.label, x + 2, MARGIN + TITLE_BLOCK_HEIGHT - 4.5, {
      size: TYPE.small,
      colour: palette.faint,
    });
    page.text(cell.value, x + 2, MARGIN + 4, { size: TYPE.caption, colour: palette.text, font: "monoBold" });
  }

  page.text(fields.heading, MARGIN + 3, MARGIN + TITLE_BLOCK_HEIGHT - 5.5, {
    size: TYPE.heading,
    colour: palette.text,
    font: "monoBold",
  });
  page.text(fields.title, MARGIN + 3, MARGIN + 6.5, { size: TYPE.caption, colour: palette.text });
  page.text(fields.footnote, MARGIN + 3, MARGIN + 2.5, { size: TYPE.small, colour: palette.faint });
}

/**
 * One padding band, recorded as the sheet is laid out.
 *
 * `outer` is what was given, `inner` what the drawing actually got. The ring
 * between them is the padding, and the label says where it came from.
 */
export interface PadTrace {
  label: string;
  outer: Frame;
  inner?: Frame;
}

/**
 * Draw every band that is padding rather than drawing.
 *
 * A debug view, and drawn **last** so it sits over everything — which is why it
 * is outlines and a label rather than a fill. The bands are not all empty: the
 * widest of them is the strip a dimension chain hangs in, and filling that would
 * hide the very thing it is reserving room for.
 */
function paintPadding(page: PdfPage, pads: PadTrace[]): void {
  const RULE = "#d81b60";
  const dashed = { colour: RULE, width: 0.12, dash: [1, 1] as [number, number] };
  for (const pad of pads) {
    const rect = (f: Frame) =>
      page.lines(
        [
          { x0: f.x, y0: f.y, x1: f.x + f.width, y1: f.y },
          { x0: f.x + f.width, y0: f.y, x1: f.x + f.width, y1: f.y + f.height },
          { x0: f.x + f.width, y0: f.y + f.height, x1: f.x, y1: f.y + f.height },
          { x0: f.x, y0: f.y + f.height, x1: f.x, y1: f.y },
        ],
        dashed
      );
    rect(pad.outer);
    if (pad.inner) rect(pad.inner);
    // Bottom-left of the band, where a drawing is least likely to be.
    page.text(pad.label, pad.outer.x + 0.6, pad.outer.y + 0.8, {
      size: 1.9,
      colour: RULE,
    });
  }
}

export interface HeroImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

export interface BlueprintInput {
  /** What the lamp is called. */
  name: string;
  description?: string;
  instances: LampInstance[];
  scene: LampScene;
  /** The design variables as written. */
  variables: Record<string, string>;
  /** Ids hidden on the bench. Still built, so still counted and drawn. */
  hidden?: readonly string[];
  paper?: PaperSize;
  palette?: Palette;
  /**
   * Graph paper under the drawings. **Off** by default.
   *
   * It is most of what makes a sheet read as a blueprint rather than as a
   * diagram — and it is also ink on every square millimetre of every page,
   * carrying no information, about 112 strokes a sheet. These sheets are for
   * working from, so the default is the working one and the decoration is opt-in.
   */
  grid?: boolean;
  /**
   * Outline every band that is padding rather than drawing, and label it.
   *
   * A debug view for deciding what to trim: it is far easier to judge a margin
   * with the drawing inside it than as a number in a table.
   */
  padding?: boolean;
  /** A rendered view of the finished lamp for the title sheet, if there is one. */
  hero?: HeroImage | null;
  /** Printed in the title block. The caller owns the clock. */
  date: string;
}

/** Every instance's boxes, in world coordinates. */
function worldBoxes(input: BlueprintInput): THREE.Box3[] {
  const skip = new Set(input.hidden ?? []);
  const out: THREE.Box3[] = [];
  const corner = new THREE.Vector3();
  for (const instance of input.instances) {
    if (skip.has(instance.id)) continue;
    const shape = input.scene.shapes.get(instance.id);
    const placement = input.scene.placements.get(instance.id);
    if (!shape || !placement) continue;
    const matrix = new THREE.Matrix4().compose(
      placement.position,
      placement.quaternion,
      new THREE.Vector3(1, 1, 1)
    );
    for (const box of shape.boxes) {
      // A placed part is only axis-aligned again if its turn was a box rotation,
      // which every joint on this lamp is (`squaredUp`). Transforming the corners
      // and re-boxing is exact in that case and is the nearest honest answer in
      // the one case it is not — a rolled part reads as its own envelope rather
      // than as a shape the drawing cannot describe.
      const placed = new THREE.Box3();
      for (let i = 0; i < 8; i++) {
        corner
          .set(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z
          )
          .applyMatrix4(matrix);
        placed.expandByPoint(corner);
      }
      out.push(placed);
    }
  }
  return out;
}
// ---------------------------------------------------------------------------
// Dividing a page to suit the lamp
// ---------------------------------------------------------------------------

export type Orientation = "vertical" | "horizontal";

/**
 * Whether the lamp stands up or lies down.
 *
 * Height against the *larger* of the two plan dimensions, because a lamp is
 * square in plan far more often than not — comparing against width alone would
 * call a tall square-plan lamp horizontal as soon as it was one millimetre
 * deeper than it was high.
 */
export function lampOrientation(size: THREE.Vector3): Orientation {
  return size.y > Math.max(size.x, size.z) ? "vertical" : "horizontal";
}

/**
 * The sheet a lamp of this shape belongs on — **the other way up from the lamp**.
 *
 * That reads backwards until you follow it through. What the drawing actually
 * has to fit is not the page but the *half* of it the picture gets, and
 * {@link splitPage} halves the page's long dimension — so the half always comes
 * out the other way up from the sheet:
 *
 * ```
 *   landscape sheet, cut down the middle   ->  two TALL halves
 *   portrait sheet,  cut across the middle ->  two WIDE halves
 * ```
 *
 * So a standing lamp wants a tall half, which is what a **landscape** sheet
 * produces, and a lamp lying down wants a wide half, off a **portrait** one.
 * Turning the paper to suit the object is what a drawing office does before it
 * starts rearranging what is on the paper, and it costs nothing — the ratio the
 * drawing ends up at is chosen from the room available either way.
 */
export function paperFor(orientation: Orientation): PaperOrientation {
  return orientation === "vertical" ? "landscape" : "portrait";
}

/**
 * A page cut in two, **across its own long axis**.
 *
 * A wide frame is cut down the middle into two side by side; a tall one is cut
 * across the middle into two stacked. The lamp does not come into it — it has
 * already had its say, in which way up the paper is, and having it decide the
 * division as well would be the same fact applied twice.
 *
 * @returns `[first, second]`, first being the half a reader meets first: the
 *          left one on a wide page, the top one on a tall page.
 */
export function splitPage(frame: Frame): [Frame, Frame] {
  return divide(frame, cutFor(frame));
}

/**
 * Which way a rectangle gets cut when it is halved across its long axis.
 *
 * `vertical` is a cut *by* a vertical line, leaving two side by side.
 */
export type Cut = "vertical" | "horizontal";

export function cutFor(frame: Frame): Cut {
  return frame.width >= frame.height ? "vertical" : "horizontal";
}

/**
 * A rectangle in two, the stated way.
 *
 * @returns `[first, second]` — left then right for a vertical cut, top then
 *          bottom for a horizontal one, which is reading order either way.
 */
export function divide(frame: Frame, cut: Cut): [Frame, Frame] {
  const [first, second] = slice(frame, cut, 2);
  return [first, second];
}

/**
 * A rectangle in `count` equal pieces, in reading order.
 *
 * Left to right for a vertical cut, **top to bottom** for a horizontal one —
 * which is why the y arithmetic counts backwards: PDF coordinates run up the
 * page and a reader runs down it.
 */
export function slice(frame: Frame, cut: Cut, count: number): Frame[] {
  if (count <= 1) return [frame];
  const out: Frame[] = [];
  if (cut === "vertical") {
    const width = (frame.width - GAP * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      out.push({ x: frame.x + i * (width + GAP), y: frame.y, width, height: frame.height });
    }
    return out;
  }
  const height = (frame.height - GAP * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    out.push({
      x: frame.x,
      y: frame.y + (count - 1 - i) * (height + GAP),
      width: frame.width,
      height,
    });
  }
  return out;
}

const opposite = (cut: Cut): Cut => (cut === "vertical" ? "horizontal" : "vertical");

/** One thing to be given a band: what it measures, and whether it is dimensioned. */
interface Band {
  bounds: DimBounds;
  dimensioned: boolean;
}

/**
 * Bands sized to what goes in them, at one shared scale.
 *
 * `slice` gives every band the same size, which is right when the things in them
 * are the same shape and wasteful when they are not: a square plan and a tall
 * elevation share a scale, so the plan ends up centred in a cell sized for the
 * elevation with 15 mm of nothing above and below it. That is the largest single
 * piece of white space on the sheet and it is not padding anybody chose — it is
 * the shared scale being paid for twice.
 *
 * So the scale is solved for first and the bands cut to suit:
 *
 * ```
 *   s = (room along the line − every band's reserve) / (sum of the spans)
 *   s = min(that, the tightest across-the-line fit)
 * ```
 *
 * Both are closed forms, so there is no iteration and no search. The shared
 * scale survives — which is the whole point, since it is what makes two views
 * comparable — and each band ends up as big as its drawing needs and no bigger.
 *
 * Any room the across-the-line fit leaves over is not spread back out as
 * padding: it stays as one unused strip at the end, where it reads as space
 * rather than as margin.
 */
function fitBands(frame: Frame, cut: Cut, bands: Band[]): { scale: number; cells: Frame[] } {
  const along = cut === "vertical" ? "width" : "height";
  const across = cut === "vertical" ? "height" : "width";
  const span = (band: Band) =>
    cut === "vertical"
      ? { along: band.bounds.maxU - band.bounds.minU, across: band.bounds.maxV - band.bounds.minV }
      : { along: band.bounds.maxV - band.bounds.minV, across: band.bounds.maxU - band.bounds.minU };
  const reserveOf = (band: Band) => (band.dimensioned ? DIM_RESERVE_MM : TYPE.caption);

  const room = frame[along] - GAP * (bands.length - 1);
  const spans = bands.reduce((n, b) => n + Math.max(span(b).along, 1e-6), 0);

  // The reserves are charged before any drawing gets a millimetre, so a line of
  // enough bands can ask for more room than the whole strip has: six pieces with
  // four drawings each want 351 mm of reserve in a 181 mm column. Rather than
  // solve for a negative scale and run off the sheet, the reserves are given up
  // in order — the dimension strips first, then the caption strips — and what is
  // left is drawn without them. The loss is visible; overflowing is not.
  let reserveFor = reserveOf;
  const total = () => bands.reduce((n, b) => n + reserveFor(b) * 2, 0);
  if (room - total() < spans * 1e-4) reserveFor = () => TYPE.caption;
  if (room - total() < spans * 1e-4) reserveFor = () => 0;

  const lengthwise = (room - total()) / spans;
  const crosswise = Math.min(
    ...bands.map((b) => (frame[across] - reserveFor(b) * 2) / Math.max(span(b).across, 1e-6))
  );
  const scale = statedScale(Math.max(Math.min(lengthwise, crosswise), 1e-9));

  const cells: Frame[] = [];
  let at = cut === "vertical" ? frame.x : frame.y + frame.height;
  for (const band of bands) {
    const size = span(band).along * scale + reserveFor(band) * 2;
    if (cut === "vertical") {
      cells.push({ x: at, y: frame.y, width: size, height: frame.height });
      at += size + GAP;
    } else {
      // Counting down the page, from the top edge of the frame.
      at -= size;
      cells.push({ x: frame.x, y: at, width: frame.width, height: size });
      at -= GAP;
    }
  }
  return { scale, cells };
}

/**
 * What the picture stopped spending on itself, and where it went.
 *
 * It used to sit inside a 4 mm inset and then give up another 2.6 mm a side to a
 * caption reserve — for a caption it does not have. That is 13.2 mm across the
 * page held for nothing, and on a quarter-page column of pieces 13.2 mm is not a
 * rounding error: it is a fifth of their width.
 */
const PICTURE_FREED = 2 * (4 + TYPE.caption);

/**
 * The three regions of page one, with the picture's old padding handed on.
 *
 * The even split is still what decides the proportions — half the page to the
 * picture, a quarter each to the projections and the pieces — but the picture
 * now draws to its own edges, so the room it used to keep empty is given to the
 * pieces instead of left as a gap. The projections keep their size and simply
 * shift up against the picture.
 *
 * Exported because the check reads it: a layout that the tests re-derive by hand
 * is a layout the tests can be wrong about on their own.
 */
export function pageRegions(frame: Frame): { picture: Frame; views: Frame; pieces: Frame } {
  const cut = cutFor(frame);
  const [half, rest] = splitPage(frame);
  const [views, pieces] = divide(rest, cut);
  if (cut === "vertical") {
    return {
      picture: { ...half, width: half.width - PICTURE_FREED },
      views: { ...views, x: views.x - PICTURE_FREED },
      pieces: { ...pieces, x: pieces.x - PICTURE_FREED, width: pieces.width + PICTURE_FREED },
    };
  }
  // A horizontal cut puts the picture on top, so giving room away moves its
  // *bottom* edge up — which in a coordinate system that counts from the bottom
  // of the page means raising y and lowering the height by the same amount.
  return {
    picture: { ...half, y: half.y + PICTURE_FREED, height: half.height - PICTURE_FREED },
    views: { ...views, y: views.y + PICTURE_FREED },
    pieces: { ...pieces, height: pieces.height + PICTURE_FREED },
  };
}

/**
 * The finished lamp, filling a half page.
 *
 * The render when there is one, and the pictorial line drawing when there is
 * not — which is not really a fallback. A pictorial projection is what a
 * drawing sheet traditionally carries, it is vector, and it prints; the render
 * is the one thing on any of these sheets that is a photograph rather than a
 * drawing, and it is there because it answers "is this the lamp I designed?" at
 * a glance in a way no projection does.
 */
function paintLamp(
  page: PdfPage,
  frame: Frame,
  boxes: THREE.Box3[],
  hero: HeroImage | null | undefined,
  palette: Palette,
  pads?: PadTrace[]
): void {
  if (hero) {
    // Fitted by whichever dimension runs out first, so the render is never
    // stretched: the one thing here that is not drawn to a scale should at
    // least not be drawn to a wrong shape.
    const aspect = hero.width / hero.height;
    const width = Math.min(frame.width, frame.height * aspect);
    const height = width / aspect;
    const x = frame.x + (frame.width - width) / 2;
    const y = frame.y + (frame.height - height) / 2;
    page.image(hero.jpeg, hero.width, hero.height, x, y, width, height);
    pads?.push({ label: "picture: aspect only", outer: frame, inner: { x, y, width, height } });
    return;
  }
  if (boxes.length === 0) return;
  const drawing = projectDrawing(boxes, SHEET_VIEWS.pictorial.normal as Vec3, {
    withHidden: false,
  });
  // No inset and no reserve: this drawing carries neither a caption nor a
  // dimension chain, so there is nothing for padding to hold room for. What it
  // used to reserve has gone to the pieces — see `pageRegions`.
  const place = paintDrawing(page, drawing, frame, fitScale(drawing.bounds, frame, false, 0), {
    palette,
    dimensioned: false,
  });
  pads?.push({ label: "picture: no padding", outer: frame, inner: drawnRect(drawing, place) });
}

/** Where a drawing actually landed on the paper, once it had been placed. */
function drawnRect(drawing: Drawing, place: Placement): Frame {
  const a = place.toPaper(drawing.bounds.minU, drawing.bounds.minV);
  const b = place.toPaper(drawing.bounds.maxU, drawing.bounds.maxV);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * The whole document, which is currently one page.
 *
 * @returns the PDF, as bytes.
 */
export function buildBlueprint(input: BlueprintInput): Uint8Array {
  const palette = input.palette ?? PRINT_PALETTE;
  const boxes = worldBoxes(input);

  const overall = new THREE.Box3();
  for (const box of boxes) overall.union(box);
  const size = overall.isEmpty() ? new THREE.Vector3() : overall.getSize(new THREE.Vector3());
  const paper = paperSheet(input.paper ?? "a4", paperFor(lampOrientation(size)));

  const sheets = new Sheets(
    paper,
    palette,
    input.name || "lamp",
    "All dimensions in millimetres, at the variables the lamp was drawn at.",
    input.date,
    input.grid === true
  );

  const { page, frame } = sheets.add("General arrangement");
  const cut = cutFor(frame);
  const { picture, views, pieces } = pageRegions(frame);

  const pads: PadTrace[] | undefined = input.padding ? [] : undefined;
  paintLamp(page, picture, boxes, input.hero, palette, pads);
  sheets.scale(paintProjections(page, views, cut, boxes, palette, pads));
  paintPieces(page, pieces, cut, uniquePieces(input), palette, pads);

  if (pads) {
    // The two bands the layout takes before any drawing is placed.
    const border = {
      x: MARGIN,
      y: MARGIN,
      width: paper.width - MARGIN * 2,
      height: paper.height - MARGIN * 2,
    };
    pads.unshift(
      { label: "page margin 7", outer: { x: 0, y: 0, width: paper.width, height: paper.height }, inner: border },
      { label: "title block 15", outer: border, inner: frame }
    );
    paintPadding(page, pads);
  }

  return sheets.finish();
}

interface StockPiece {
  name: string;
  quantity: number;
  /** The whole component, in its own coordinates. */
  boxes: THREE.Box3[];
  size: PieceSize;
}

/**
 * The distinct pieces of timber the lamp is made of.
 *
 * **A component is a piece; its blocks are the joinery cut into it.** A rail
 * modelled as a full-section middle with a half-thickness stub at each end is
 * one stick 200 mm long that has been lapped twice — not three sticks — and the
 * blocks it is built from are how the *shape* is described, not how the timber
 * is bought. Counting them as pieces produced sections like `7 × 3.5`, which is
 * not a size anybody planes: it is half the thickness of a lap.
 *
 * So the grouping is by component, the count is how many are fitted, and the
 * size is the whole component's extent.
 */
function uniquePieces(input: BlueprintInput): StockPiece[] {
  const skip = new Set(input.hidden ?? []);
  const byComponent = new Map<string, StockPiece>();
  for (const instance of input.instances) {
    if (skip.has(instance.id)) continue;
    const shape = input.scene.shapes.get(instance.id);
    if (!shape || shape.boxes.length === 0) continue;
    const existing = byComponent.get(instance.def.file);
    if (existing) {
      existing.quantity++;
      continue;
    }
    const overall = new THREE.Box3();
    for (const box of shape.boxes) overall.union(box);
    const extent = overall.getSize(new THREE.Vector3());
    byComponent.set(instance.def.file, {
      name: instance.def.name,
      quantity: 1,
      boxes: shape.boxes,
      size: [extent.x, extent.y, extent.z]
        .map((n) => Math.round(n * 10) / 10)
        .sort((a, b) => b - a) as PieceSize,
    });
  }
  // Longest first, as a cut list is read: the long pieces decide what length of
  // stock has to be bought.
  return [...byComponent.values()].sort((a, b) => b.size[0] - a.size[0]);
}

/**
 * Every distinct piece, once each, drawn as stock.
 *
 * A picture of each is what turns a table of numbers into something you can hold
 * a board against — and, once a piece has laps and housings in it, the only
 * thing on the sheet that says *where* they go.
 *
 * They lie **along the lamp** and stack **across it** — laid flat and piled up
 * for a standing lamp, stood on end and ranked along for one lying down — which
 * is the same pairing the views use, and for the same reason: it is the
 * direction their piece of the page is longest in.
 *
 * One scale for all of them, so the piece that is twice as long looks twice as
 * long. Fitting each to its own cell would draw a 20 mm block and a 460 mm post
 * at the same size, which is the one thing a drawing of a cut list must not do.
 */
function paintPieces(
  page: PdfPage,
  cell: Frame,
  cut: Cut,
  pieces: StockPiece[],
  palette: Palette,
  pads?: PadTrace[]
): void {
  if (pieces.length === 0) return;
  const lay = cut === "vertical" ? "horizontal" : "vertical";
  const from = PIECE_VIEW[lay];

  // Each piece: the pictorial that shows where its joinery is, then the square-on
  // views that say how big it all is. The bands run the same way the pieces
  // stack, so a long piece stays long in every one of them.
  const drawn = pieces.map((piece) => {
    const oriented = stockOrientation(piece.boxes, lay, from);
    return {
      piece,
      pictorial: projectDrawing(oriented, from, { withHidden: false }),
      views: distinctViews(oriented),
    };
  });

  // Every drawing in the section, in order, as one long line of bands: each
  // piece's pictorial then its views, all at one scale, each band as tall as
  // what it holds. Laid out together rather than piece by piece so that a stubby
  // block does not claim the same room as a 460 mm post.
  const line: Band[] = [];
  for (const row of drawn) {
    line.push({ bounds: row.pictorial.bounds, dimensioned: false });
    for (const view of row.views) line.push({ bounds: view.drawing.bounds, dimensioned: true });
  }
  const { scale, cells } = fitBands(cell, opposite(cut), line);
  let next = 0;
  const laidOut = drawn.map((row) => ({
    ...row,
    bands: [cells[next++], ...row.views.map(() => cells[next++])],
  }));

  for (const row of laidOut) {
    const place = paintDrawing(page, row.pictorial, row.bands[0], scale, {
      palette,
      dimensioned: false,
      caption: `${row.piece.quantity}× ${row.piece.name}  ${sizeLabel(row.piece.size)}`,
    });
    pads?.push({
      label: `${row.piece.name}: caption 2.6`,
      outer: row.bands[0],
      inner: drawnRect(row.pictorial, place),
    });
    row.views.forEach((view, i) => {
      const at = paintDrawing(page, view.drawing, row.bands[i + 1], scale, {
        palette,
        caption: view.caption,
      });
      pads?.push({
        label: `${row.piece.name} ${view.caption.toLowerCase()}: reserve 8.9`,
        outer: row.bands[i + 1],
        inner: drawnRect(view.drawing, at),
      });
    });
  }
}

/**
 * The square-on views of one piece that are worth drawing — two or three.
 *
 * Top, side and front in that order, with any that comes out the same as one
 * already kept folded into its caption instead of drawn again. A 20 × 20 post is
 * the common case: two of its three views are the same drawing, and the second
 * would tell a reader nothing they could not read off the first.
 */
function distinctViews(boxes: THREE.Box3[]): Array<{ drawing: Drawing; caption: string }> {
  const kept: Array<{ drawing: Drawing; caption: string }> = [];
  for (const view of ["top", "side", "front"] as const) {
    const drawing = projectDrawing(boxes, SHEET_VIEWS[view].normal as Vec3);
    const same = kept.find((k) => sameDrawing(k.drawing, drawing));
    if (same) same.caption += ` & ${SHEET_VIEWS[view].label}`;
    else kept.push({ drawing, caption: SHEET_VIEWS[view].label });
  }
  return kept;
}

/**
 * The other half: every projection, in one line of cells.
 *
 * The half is divided **the same way the page was** — so the strip under a
 * pictured-on-top layout becomes two strips, and the column beside a
 * pictured-on-the-left one becomes two columns. All the views go in the first of
 * those. **The second is deliberately left empty**, held for what comes next.
 *
 * Inside that piece the views run in a single line: the plan, then the
 * elevation, in the direction the lamp itself runs — stacked down the page for a
 * standing lamp, laid along it for one lying down. That is the same direction
 * the piece is longest in, which is what gives each view the most room.
 *
 * **One elevation or two, depending on the lamp.** A design square in plan draws
 * the same front and side; putting both on the sheet spends a cell saying it
 * twice, and a reader who compares them learns nothing. So the two are drawn,
 * compared as shapes, and the second is kept only if it differs.
 *
 * All of them share one scale, which is what makes them comparable — a set of
 * views each fitted to its own cell is three drawings of three different
 * objects.
 *
 * @returns the shared scale, as it is written.
 */
function paintProjections(
  page: PdfPage,
  viewsCell: Frame,
  cut: Cut,
  boxes: THREE.Box3[],
  palette: Palette,
  pads?: PadTrace[]
): string {
  if (boxes.length === 0) return "";
  const front = projectDrawing(boxes, SHEET_VIEWS.front.normal as Vec3);
  const side = projectDrawing(boxes, SHEET_VIEWS.side.normal as Vec3);
  const views: Array<{ drawing: Drawing; caption: string }> = [
    { drawing: projectDrawing(boxes, SHEET_VIEWS.top.normal as Vec3), caption: "TOP" },
  ];
  if (sameDrawing(front, side)) {
    // Say which two faces the one drawing stands for, rather than leaving a
    // reader to wonder where the other elevation went.
    views.push({ drawing: front, caption: "FRONT & SIDE" });
  } else {
    views.push({ drawing: front, caption: "FRONT" });
    views.push({ drawing: side, caption: "SIDE" });
  }

  // Stacking down the piece needs horizontal cuts, and running along it needs
  // vertical ones — so the line of views is cut the opposite way to the page.
  const { scale, cells } = fitBands(
    viewsCell,
    opposite(cut),
    views.map((view) => ({ bounds: view.drawing.bounds, dimensioned: true }))
  );
  views.forEach((view, i) => {
    const place = paintDrawing(page, view.drawing, cells[i], scale, {
      palette,
      caption: view.caption,
    });
    pads?.push({
      label: `${view.caption.toLowerCase()}: dimension reserve 8.9`,
      outer: cells[i],
      inner: drawnRect(view.drawing, place),
    });
  });
  return scaleLabel(scale);
}
