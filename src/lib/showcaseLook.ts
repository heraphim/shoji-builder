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
}

/** The realistic showcase: a photograph, so no paint at all. */
const REALISTIC: ShowcaseLook = {
  background: "#0b0806",
  paint: null,
  bloom: { intensity: 0.85, threshold: 0.62, smoothing: 0.3 },
  vignette: { offset: 0.28, darkness: 0.62 },
  ambient: 1,
  fill: 0,
  fillColor: "#ffffff",
  bulb: 1,
  detail: 1,
  facet: 0,
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
  fill: 0.5,
  fillColor: "#ffd2a0",
  bulb: 1,
  detail: 0.25,
  facet: 0,
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
  fill: 0.7,
  fillColor: "#ffcf9a",
  bulb: 1,
  detail: 0.1,
  facet: 0,
};

export const SHOWCASE_LOOKS: Record<ShowcaseStyleId, ShowcaseLook> = {
  realistic: REALISTIC,
  anime: ANIME,
  cartoon: CARTOON,
  // Not drawn yet — see `built` in `showcaseStyles.ts`, which is what stops the
  // menu offering them. Pointed at the photograph rather than left out so that
  // this stays a total record and nothing has to check for a hole in it.
  ghibli: REALISTIC,
  watercolor: REALISTIC,
  inkWash: REALISTIC,
  minimalist: REALISTIC,
  lowPoly: REALISTIC,
};

export function showcaseLook(id: ShowcaseStyleId): ShowcaseLook {
  return SHOWCASE_LOOKS[id] ?? REALISTIC;
}
