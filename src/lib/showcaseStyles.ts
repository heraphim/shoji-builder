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
  { id: "anime", label: "Anime", note: "Warm cels, hard light, drawn edges.", built: false },
  { id: "cartoon", label: "Cartoon", note: "Flat colour under a heavy ink line.", built: false },
  {
    id: "ghibli",
    label: "Studio Ghibli",
    note: "Painted backgrounds, soft greens, hand-lit.",
    built: false,
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
