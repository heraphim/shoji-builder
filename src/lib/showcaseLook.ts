import { NO_PAINT, type PaintParams } from "./paint";
import type { ShowcaseStyleId } from "./showcaseStyles";

/**
 * What each style does to the room, as numbers.
 *
 * The scene is built once — one lamp, one nightstand, one bed, one wall — and
 * every style is that scene under a different hand. This file is the whole of
 * the difference: how much light the painter decided was in the room, how much
 * of the timber's grain survives being drawn, and what happens to the picture
 * on its way to the screen (`paint`, which is `lib/paint.ts`).
 *
 * Kept apart from `showcaseStyles.ts` on purpose. That file is what the *menu*
 * knows — a name, a line of description, and whether it works yet — and it is
 * imported by the page chrome. This one is what the *canvas* knows, and it
 * drags a shader in with it. A menu that had to load a shader to draw a list of
 * eight names would be paying for seven styles to show one.
 */

export interface ShowcaseLook {
  /** What is behind everything, for the frame before the room draws. */
  background: string;
  /** The treatment on the way to the screen, or none for a photograph. */
  paint: PaintParams | null;
  /** The halo round the lamp, or none. */
  bloom: { intensity: number; threshold: number; smoothing: number } | null;
  /** The corners going down, or none. */
  vignette: { offset: number; darkness: number } | null;
  /**
   * A multiplier on the room's own bounce.
   *
   * The realistic room is lit by one bulb and falls away to black, which is
   * true and is not what any of the drawn styles do: an illustrator lights the
   * whole room enough to draw it and then puts the lamp in as the brightest
   * thing. This is that decision, as a number.
   */
  ambient: number;
  /**
   * What colour that bounce is, if the style disagrees with the room about it.
   *
   * A separate lever from the fill, and the difference matters. The fill comes
   * from where the viewer is and lands on every face turned towards them —
   * colour it and the lamp's own paper goes that colour too, which is the one
   * thing in the room that must stay the colour of a bulb. This is the light
   * the *room* is full of, so it settles on the walls and the far side of
   * everything and leaves the lit side alone, which is where a painter's green
   * actually is.
   */
  ambientColor: { sky: string; ground: string } | null;
  /**
   * A flat light from where the viewer is, which no lamp in the scene is
   * emitting.
   *
   * Physically indefensible and exactly what a painter does — the near face of
   * the nightstand is turned away from every light in this room, and in every
   * one of the drawn references it is a readable brown rather than black.
   */
  fill: number;
  fillColor: string;
  /** A multiplier on the bulb. */
  bulb: number;
  /**
   * How much of the procedural surface detail survives — grain, weave, plaster
   * tooth, paper fibre.
   *
   * 1 is the room as built. Lower is not a saving; it is the point. Grain is a
   * fine high-contrast pattern, banding a fine high-contrast pattern turns it
   * into noise, and a cartoon whose every flat surface is boiling is a cartoon
   * that reads as a broken render rather than as a drawing.
   */
  detail: number;
  /**
   * How coarsely the downloaded props are faceted, in mm. 0 leaves them alone.
   *
   * Only low poly wants this, and only the props need it: everything else in
   * this room is already boxes and cylinders.
   */
  facet: number;
  /**
   * Hang the picture as a bare panel: no rollers, no end caps, no cord, no
   * hook.
   *
   * One style asks for this and it is the one whose whole claim is *the lamp,
   * and as little else*. A kakejiku's furniture is nine separate pieces around
   * a rectangle, and every one of them is a small dark object competing for the
   * eye in a picture that is trying not to have any. The painting stays,
   * because a blank wall behind the lamp is not minimal, it is empty.
   */
  bareScroll: boolean;
}

/** The realistic showcase: a photograph, so no paint at all. */
const REALISTIC: ShowcaseLook = {
  background: "#0b0806",
  paint: null,
  bloom: { intensity: 0.85, threshold: 0.62, smoothing: 0.3 },
  vignette: { offset: 0.28, darkness: 0.62 },
  ambient: 1,
  ambientColor: null,
  fill: 0,
  fillColor: "#ffffff",
  bulb: 1,
  detail: 1,
  facet: 0,
  bareScroll: false,
};

/**
 * Anime: warm cels, a hard light, and a line round everything.
 *
 * The reference is a night interior from a television production, and the thing
 * that makes one of those readable is that the darks are *warm and open* rather
 * than black — a room lit by one lamp is painted as a room full of amber with
 * the lamp as the white centre of it. So the exposure is up nearly two stops,
 * the whole picture is pulled towards amber, and there is a fill from the
 * camera that nothing in the room is emitting.
 *
 * Six bands with a nearly hard edge: enough to keep the roll of a pillow, few
 * enough that a wall is one flat colour with a second one where the lamp
 * reaches it. The line is mostly a silhouette line — `inkFromLuma` is low,
 * because a cel painter draws the edge of the *object*, not the edge of the
 * shadow on it.
 */
const ANIME: ShowcaseLook = {
  background: "#1a1109",
  paint: {
    ...NO_PAINT,
    exposure: 1.9,
    bands: 6,
    bandSoft: 0.18,
    ink: 0.85,
    inkColor: "#38210f",
    inkWidth: 1.7,
    inkFromDepth: 1.1,
    inkFromLuma: 0.35,
    saturation: 1.22,
    tint: "#ffeedd",
    lift: 0.04,
    paperColor: "#fff4e2",
    contrast: 1.18,
  },
  bloom: { intensity: 1.1, threshold: 0.5, smoothing: 0.4 },
  vignette: { offset: 0.32, darkness: 0.52 },
  ambient: 2.1,
  ambientColor: null,
  fill: 0.5,
  fillColor: "#ffd2a0",
  bulb: 1,
  detail: 0.25,
  facet: 0,
  bareScroll: false,
};

/**
 * Cartoon: flat colour under a heavy ink line.
 *
 * The difference from the anime cel is not the palette, it is the *count*. Four
 * tones instead of six and a hard boundary between them, which is few enough
 * that a whole nightstand is one brown with a second brown where the lamp
 * reaches it, and a line thick enough to be the drawing rather than the edge of
 * one. The colour is pushed hard for the same reason a comic's is: with four
 * tones and a black line there is nothing else left to tell two objects apart.
 *
 * Almost no surface detail survives — a grain is a fine pattern and this style
 * has four values to render it in, which is a field of specks rather than a
 * board.
 */
const CARTOON: ShowcaseLook = {
  background: "#241608",
  paint: {
    ...NO_PAINT,
    exposure: 2.1,
    bands: 4,
    bandSoft: 0.07,
    ink: 1,
    inkColor: "#150d07",
    inkWidth: 3,
    inkFromDepth: 1.25,
    inkFromLuma: 0.9,
    saturation: 1.45,
    tint: "#fff0dd",
    lift: 0.03,
    paperColor: "#fff6e6",
    contrast: 1.24,
  },
  bloom: { intensity: 0.8, threshold: 0.62, smoothing: 0.5 },
  vignette: { offset: 0.4, darkness: 0.34 },
  ambient: 2.9,
  ambientColor: null,
  fill: 0.7,
  fillColor: "#ffcf9a",
  bulb: 1,
  detail: 0.1,
  facet: 0,
  bareScroll: false,
};

/**
 * Studio Ghibli: painted backgrounds, soft greens, hand-lit.
 *
 * The one drawn style here that is not a *drawing*. A Ghibli interior is a
 * painting — poster colour on board, with the brush visible in it — and the
 * things that say so are the opposite of what says cel: many tones rather than
 * few, boundaries that are soft rather than cut, a line that is a dark edge
 * where the paint ran up against something rather than an ink contour, and
 * shadows that are a colour rather than an absence.
 *
 * So `lift` is doing most of the work. Nothing in one of these rooms is black;
 * the darks are a warm grey-green, and the moment they are allowed to reach
 * zero the picture reads as a render again however soft everything else is.
 *
 * The green is in the room's *bounce* rather than in the tint or the fill, and
 * that is the whole of why it works. A green filter over the frame turns the
 * lamp green; a green fill from the camera turns the near face of everything
 * green, paper panel included. Put in the ambient it settles where a painter
 * puts it — on the walls and on the far side of things — and the lamp goes on
 * being the colour of a bulb.
 *
 * Half the surface detail survives, which is the most of any drawn style: a
 * painted background has texture in it, and with the tones this soft there is
 * no banding for a grain to break up into.
 */
const GHIBLI: ShowcaseLook = {
  background: "#141610",
  paint: {
    ...NO_PAINT,
    exposure: 1.85,
    bands: 8,
    bandSoft: 0.75,
    ink: 0.3,
    inkColor: "#3d3a22",
    inkWidth: 1.6,
    inkFromDepth: 0.9,
    inkFromLuma: 0.2,
    paper: 0.19,
    paperScale: 3.4,
    paperColor: "#f6f2dc",
    saturation: 1.38,
    tint: "#fdf8e8",
    lift: 0.07,
    contrast: 1.1,
  },
  bloom: { intensity: 1.15, threshold: 0.45, smoothing: 0.6 },
  vignette: { offset: 0.44, darkness: 0.22 },
  ambient: 3.1,
  ambientColor: { sky: "#93b57a", ground: "#55603f" },
  fill: 0.28,
  fillColor: "#e8dcc0",
  bulb: 1,
  detail: 0.5,
  facet: 0,
  bareScroll: false,
};

/**
 * Watercolour: washes that pool at the edges, paper showing through.
 *
 * Three things and no others make a watercolour, and all three are about the
 * water rather than the colour.
 *
 * **It pools.** A wash dries darkest where it stopped, because that is where
 * the pigment ended up — so `bleed` darkens the picture along every edge the
 * detector finds, off a much lower threshold and a wider foot than the line.
 * That is the single most recognisable thing about the medium and the thing
 * every "watercolour filter" leaves out.
 *
 * **It misses.** The line is drawn first and the colour is brushed near it, so
 * the two do not line up. `wobble` samples the whole picture along a slow
 * wander, which puts the paint a few pixels off the drawing everywhere and
 * nowhere by the same amount.
 *
 * **It is on paper.** Not behind it — the tooth of the sheet breaks the wash
 * lying on it, and the white of it is the only white in the picture. Hence the
 * heavy `lift`: a wash cannot go darker than the pigment, and it can never
 * reach black, so the shadows in the far corner of this room have to come up to
 * a warm grey however dark the room really is.
 *
 * The line stays, but it is a dry brown rather than ink, and it is almost
 * entirely a silhouette line — `inkFromLuma` near zero, because a watercolourist
 * does not draw round the edge of a shadow.
 */
const WATERCOLOR: ShowcaseLook = {
  background: "#efe6d2",
  paint: {
    ...NO_PAINT,
    exposure: 2,
    bands: 5,
    bandSoft: 0.62,
    ink: 0.34,
    inkColor: "#5b4030",
    inkWidth: 1.5,
    inkFromDepth: 0.95,
    inkFromLuma: 0.14,
    bleed: 0.34,
    paper: 0.44,
    paperScale: 2.4,
    paperColor: "#fdf5e3",
    wobble: 7,
    wobbleScale: 55,
    saturation: 1.4,
    tint: "#fff8ec",
    lift: 0.16,
    contrast: 1,
  },
  bloom: { intensity: 0.7, threshold: 0.55, smoothing: 0.6 },
  vignette: null,
  ambient: 2.4,
  ambientColor: { sky: "#96abc6", ground: "#7a6a58" },
  fill: 0.3,
  fillColor: "#f0e2c8",
  bulb: 1,
  detail: 0.35,
  facet: 0,
  bareScroll: false,
};

/**
 * Ink wash: grey on grey, one brush, no colour at all.
 *
 * Sumi-e is the watercolour with the pigment taken away and the *tone* asked to
 * do all of the work, which turns out to change almost every number. With no
 * hue left, two objects can only be told apart by how dark they are — so the
 * bands come down from five to four and the boundaries harden, because a wash
 * that shades smoothly from one grey to another in a monochrome picture is a
 * picture in which nothing has an edge.
 *
 * The lift is the heaviest of any style here and it has to be. Sumi is a dilute
 * ink: the darkest thing on the paper is one loaded stroke and everything else
 * is water, so the whole range lives in the top half and the black is spent on
 * the *line* rather than on the shadows. A monochrome picture with black
 * shadows is a photograph in black and white, which is a different medium.
 *
 * The warmth in the tint is the paper rather than a colour: the saturation is
 * flat zero, so what the multiply does is decide what shade of white the sheet
 * is, and it is not a blue one.
 */
const INK_WASH: ShowcaseLook = {
  background: "#e8e2d6",
  paint: {
    ...NO_PAINT,
    exposure: 2.7,
    bands: 4,
    bandSoft: 0.4,
    ink: 0.8,
    inkColor: "#221f1b",
    inkWidth: 2.1,
    inkFromDepth: 1.15,
    inkFromLuma: 0.4,
    bleed: 0.42,
    paper: 0.52,
    paperScale: 2.6,
    paperColor: "#f4eee1",
    wobble: 4,
    wobbleScale: 48,
    saturation: 0,
    tint: "#f7f1e4",
    lift: 0.22,
    contrast: 1.22,
  },
  bloom: { intensity: 0.6, threshold: 0.6, smoothing: 0.6 },
  vignette: null,
  ambient: 2.6,
  ambientColor: { sky: "#b9b6ae", ground: "#7a776f" },
  fill: 0.34,
  fillColor: "#eceae4",
  bulb: 1,
  detail: 0.3,
  facet: 0,
  bareScroll: false,
};

/**
 * Minimalist: the lamp, and as little else.
 *
 * The only style whose defining move is a *removal*, and the removals are in
 * three places. The scroll loses its furniture and hangs as a bare panel. The
 * line goes entirely — there is nothing to outline in a picture with no clutter
 * in it, and an outline is itself a mark. And the colour comes down rather than
 * up: everything else here pushes saturation to tell objects apart, and this
 * one lets them be the same warm off-white, because *not* distinguishing things
 * is the whole aesthetic.
 *
 * What is left is one gradient and one warm rectangle, and the picture only
 * survives that if it is genuinely well lit — so this is the brightest room of
 * the eight and the only one with no vignette and no bloom. A halo would be a
 * second thing happening.
 *
 * Ten bands, nearly soft, is the one mark it does make. It is not visible as
 * banding; it is visible as a wall that has resolved to a colour instead of
 * drifting, which is the difference between a bare room and an empty render.
 */
const MINIMALIST: ShowcaseLook = {
  background: "#efe9df",
  paint: {
    ...NO_PAINT,
    exposure: 2.3,
    bands: 10,
    bandSoft: 0.8,
    ink: 0,
    saturation: 0.88,
    tint: "#fff9f0",
    paperColor: "#fffaf2",
    lift: 0.07,
    contrast: 0.96,
  },
  bloom: null,
  vignette: null,
  ambient: 2.5,
  ambientColor: { sky: "#d8d3c8", ground: "#9c948a" },
  fill: 0.48,
  fillColor: "#fff2e2",
  bulb: 1,
  detail: 0.45,
  facet: 0,
  bareScroll: true,
};

/**
 * Low poly 3D: faceted everything, flat shaded.
 *
 * The one style that cannot be done to the picture after the fact. Faceting is
 * a property of the *surface* — no filter reading a finished frame can tell a
 * curved thing from a many-sided one — so this is the only look here that
 * reaches into the geometry, and the only reason `facet` exists. Everything in
 * this room except the bed and the nightstand is already boxes and cylinders
 * and needs nothing done to it; those two arrive smooth and are cut to a 42 mm
 * lattice. See `facetGeometry` in `ShowcaseProps`.
 *
 * `detail` is flat zero, which is the other half of it. Grain, weave, plaster
 * tooth and paper fibre are all *bump*, and bump is a lie about the surface
 * being finer than the geometry — which is the exact claim this style is built
 * to deny. A faceted bed with a woven bedspread on it is neither thing.
 *
 * The line is thin and only silhouettes, which is what makes the facets read.
 * Without it a low-poly render at this distance is just a slightly wrong smooth
 * one; with it every plane change has an edge, and the eye counts them.
 */
const LOW_POLY: ShowcaseLook = {
  background: "#1d1409",
  paint: {
    ...NO_PAINT,
    exposure: 2,
    bands: 6,
    bandSoft: 0.25,
    ink: 0.4,
    inkColor: "#2a1a10",
    inkWidth: 1.3,
    inkFromDepth: 1,
    inkFromLuma: 0.12,
    saturation: 1.32,
    tint: "#fff0d8",
    lift: 0.05,
    paperColor: "#fff6e6",
    contrast: 1.14,
  },
  bloom: { intensity: 0.95, threshold: 0.55, smoothing: 0.4 },
  vignette: { offset: 0.36, darkness: 0.42 },
  ambient: 2.3,
  ambientColor: null,
  fill: 0.52,
  fillColor: "#ffd6a6",
  bulb: 1,
  detail: 0,
  facet: 42,
  bareScroll: false,
};

export const SHOWCASE_LOOKS: Record<ShowcaseStyleId, ShowcaseLook> = {
  realistic: REALISTIC,
  anime: ANIME,
  cartoon: CARTOON,
  ghibli: GHIBLI,
  watercolor: WATERCOLOR,
  inkWash: INK_WASH,
  minimalist: MINIMALIST,
  lowPoly: LOW_POLY,
};

export function showcaseLook(id: ShowcaseStyleId): ShowcaseLook {
  return SHOWCASE_LOOKS[id] ?? REALISTIC;
}
