/**
 * The styles the showcase can be drawn in.
 *
 * A style is not a filter over one picture — it is a whole treatment: how the
 * lamp is lit, what the room around it is made of, and what the buttons and
 * sliders in front of it look like. A watercolour lamp behind a pane of smoked
 * glass would be two pictures fighting, so the chrome follows the scene, and
 * both are keyed off the one id here. See `.showcase[data-style]` in App.css for
 * the chrome half and `ShowcaseScene.tsx` for the scene half.
 *
 * `built` is honest rather than aspirational: the list is the whole set that is
 * planned, and an entry that cannot draw yet says so in the menu instead of
 * silently falling back to a style the visitor did not ask for.
 */

/**
 * What is going on outside the window: nothing, or a street lamp.
 *
 * One control rather than two switches, because these are answers to one
 * question and no two of them can be true at once \— a pair of toggles would let
 * you have two different nights at the same time.
 *
 * Daylight was here and has been taken out. It worked, and it was the wrong
 * thing to have: a lamp is for the dark, and a room with the sun in it is a room
 * where the lamp has nothing to do. Adding it back is a third entry in this list
 * and a branch in `ShowcaseScene` \— nothing else knows how many there are.
 */
export type OutsideLight = "none" | "street";

export const OUTSIDE_ORDER: readonly OutsideLight[] = ["none", "street"];

export const OUTSIDE_LABELS: Record<OutsideLight, string> = {
  none: "Outside: dark",
  street: "Outside: street lamp",
};

export function nextOutside(current: OutsideLight): OutsideLight {
  return OUTSIDE_ORDER[(OUTSIDE_ORDER.indexOf(current) + 1) % OUTSIDE_ORDER.length];
}

export type ShowcaseStyleId =
  | "realistic"
  | "anime"
  | "cartoon"
  | "ghibli"
  | "watercolor"
  | "inkWash"
  | "minimalist"
  | "lowPoly";

export interface ShowcaseStyle {
  id: ShowcaseStyleId;
  label: string;
  /** What it is, in the one line that fits under a menu item. */
  note: string;
  built: boolean;
}

export const SHOWCASE_STYLES: readonly ShowcaseStyle[] = [
  {
    id: "realistic",
    label: "Realistic",
    note: "One lamp, one dark room, and nothing lit that the bulb did not light.",
    built: true,
  },
  { id: "anime", label: "Anime", note: "Warm cels, hard light, drawn edges.", built: true },
  { id: "cartoon", label: "Cartoon", note: "Flat colour under a heavy ink line.", built: true },
  {
    id: "ghibli",
    label: "Studio Ghibli",
    note: "Painted backgrounds, soft greens, hand-lit.",
    built: true,
  },
  {
    id: "watercolor",
    label: "Watercolour",
    note: "Washes that pool at the edges, paper showing through.",
    built: false,
  },
  {
    id: "inkWash",
    label: "Ink wash (sumi-e)",
    note: "Grey on grey, one brush, no colour at all.",
    built: false,
  },
  { id: "minimalist", label: "Minimalist", note: "The lamp, and as little else.", built: false },
  { id: "lowPoly", label: "Low poly 3D", note: "Faceted everything, flat shaded.", built: false },
];

export const DEFAULT_SHOWCASE_STYLE: ShowcaseStyleId = "realistic";

export function showcaseStyle(id: ShowcaseStyleId): ShowcaseStyle {
  return SHOWCASE_STYLES.find((style) => style.id === id) ?? SHOWCASE_STYLES[0];
}
