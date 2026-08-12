import {
  FINISH_NAMES,
  WOOD_SPECIES,
  WOOD_SPECIES_NAMES,
  randomSeed,
  sanitizeWoodParams,
  woodPreset,
  type WoodFinish,
  type WoodParams,
  type WoodSpecies,
} from "./wood";

/**
 * A wood nobody wrote down, that could still have come out of a tree.
 *
 * The Texture Generator's whole loop is *look at one, keep it or don't*, and
 * that only works if most of what it offers is worth looking at. Twenty-eight
 * independent random numbers is not: the parameters in `wood.ts` are somebody's
 * calibration against real timber, and they are calibrated *against each other*
 * — a ring bias of 0.9 belongs with oak's wide latewood and nothing else, a
 * splotch intensity of 3.5 is pine's resin and would be a disease on maple.
 * Rolled independently they produce, overwhelmingly, plywood and marble.
 *
 * So this does not roll a wood. It **picks a species and then walks away from
 * it**: every number is the preset's own, moved by a bounded fraction of itself,
 * and clamped to a range that is still timber. What comes back is recognisably
 * cherry-ish or oak-ish and is not any cherry or oak in the table — which is the
 * useful kind of new, and the reason `species` is still recorded on the saved
 * file. It was where this one came from.
 *
 * ## What is rolled outright, and why
 *
 * Three things are not a species' business and so are drawn flat rather than
 * jittered:
 *
 * - **The finish.** A board can be left raw or lacquered whatever it is.
 * - **Where the piece sits in the log** — `pith` and `seed`. This is the sawyer,
 *   not the tree, and it changes the figure more than any other single number.
 * - **The grain scale.** The band is narrow on purpose: it is the one parameter
 *   that ties the pattern to millimetres, and outside 120–230 mm per unit the
 *   rings stop being a ring pitch a tree could grow at this latitude and start
 *   being either stripes or a bullseye.
 *
 * `grainAxis` is not rolled at all. Which way the grain runs is a property of
 * the *part* rather than of the timber — the same oak is quartersawn one way in
 * a stile and the other way in a rail — so a texture that shipped an opinion
 * about it would be wrong in half its uses. See `usePartTexture`.
 */

export interface WoodCandidate {
  /** The preset it was walked away from. Provenance, exactly as in a saved file. */
  species: WoodSpecies;
  finish: WoodFinish;
  params: WoodParams;
}

/** How far a number may move, as a fraction of itself, and where it may not go. */
interface Range {
  spread: number;
  min: number;
  max: number;
}

/**
 * The bounds, per parameter.
 *
 * Every one is a judgement about timber rather than about arithmetic, so they
 * are written out rather than derived from the spread of the ten presets. The
 * presets are ten points, and the range that matters is the one that is still
 * wood *between* and a little outside them — which the sample cannot tell you.
 */
const RANGES: Record<string, Range> = {
  // Rings. Thickness is the ring pitch and the loudest number here: at a grain
  // scale of 160 the band below runs a ring every 2.7 to 10 mm, which spans a
  // slow-grown hardwood to a fast softwood and stops short of both absurdities.
  centerSize: { spread: 0.2, min: 0.6, max: 2 },
  ringThickness: { spread: 0.35, min: 1 / 60, max: 1 / 16 },
  // The rising limb of the ring profile — how much of a ring is the dark band.
  // Oak sits near 0.9 and cedar near 0.01, so the spread is wide and the floor
  // is what `sanitizeWoodParams` would clamp to anyway.
  ringBias: { spread: 0.45, min: 0.01, max: 0.98 },
  ringSizeVariance: { spread: 0.5, min: 0, max: 0.45 },
  ringVarianceScale: { spread: 0.35, min: 0.6, max: 8.5 },
  barkThickness: { spread: 0.3, min: 0.05, max: 1.4 },

  // How the rings are pushed about. These are the figure — the cathedral loops
  // and the wander — and they are also where a random number set stops being
  // wood fastest, so the spreads are the tightest in the table.
  largeWarpScale: { spread: 0.3, min: 0.06, max: 0.65 },
  largeGrainStretch: { spread: 0.3, min: 0.09, max: 0.45 },
  smallWarpStrength: { spread: 0.4, min: 0.005, max: 0.11 },
  smallWarpScale: { spread: 0.3, min: 1.2, max: 12 },
  fineWarpStrength: { spread: 0.45, min: 0.002, max: 0.045 },
  fineWarpScale: { spread: 0.35, min: 3.5, max: 38 },

  // Figure and pores.
  splotchScale: { spread: 0.4, min: 0.12, max: 2.4 },
  splotchIntensity: { spread: 0.4, min: 0.25, max: 3.6 },
  cellScale: { spread: 0.25, min: 520, max: 1700 },
  cellSize: { spread: 0.4, min: 0.02, max: 0.38 },
};

/**
 * How far the two grain colours may wander, in HSL.
 *
 * Hue tightest by a long way. Wood is a narrow wedge of the wheel — roughly 10°
 * to 45°, red-brown through to yellow-tan — and eight degrees either side of a
 * real species stays inside it, where twenty would find the green that no timber
 * has ever been.
 */
const HUE_DEGREES = 8;
const SATURATION_SHIFT = 0.09;

/**
 * How light the *finished* board comes out, as the lightness of its pale band
 * after the finish has darkened it.
 *
 * Drawn directly rather than left to fall out of the species and the finish,
 * and that is the single most important line in this file. A finish in this app
 * is a flat multiply on the colour — `clearcoatDarken`, 1 for raw down to 0.2
 * for gloss — so a gloss on one of the three dark species multiplies a colour
 * that was already near black by a fifth and returns tar. Half the rolls came
 * back as a silhouette of a nightstand.
 *
 * Aiming at the finished result instead makes every combination legible: a gloss
 * walnut is a *dark polished walnut* rather than a black one, because the timber
 * under the lacquer is chosen knowing the lacquer is going on. Which is what a
 * finisher does, and not a trick — nobody lacquers ebony and calls it walnut.
 *
 * The band is where furniture actually lives. Below 0.24 nothing reads across a
 * room; above 0.46 is bleached ash and pale maple, and there is one of those in
 * the species table rather than five.
 */
const FINISHED_LIGHTNESS = [0.24, 0.46] as const;

/** How much the two bands' lightnesses may separate, on top of the species'. */
const LIGHTNESS_SHIFT = 0.06;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A number moved by up to `spread` of itself, and kept inside its range. */
function wander(value: number, { spread, min, max }: Range): number {
  return clamp(value * (1 + (Math.random() * 2 - 1) * spread), min, max);
}

const between = (min: number, max: number) => min + Math.random() * (max - min);

const pick = <T,>(from: readonly T[]): T => from[Math.floor(Math.random() * from.length)];

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function toHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const span = max - min;
  if (span === 0) return [0, 0, l];
  const s = l > 0.5 ? span / (2 - max - min) : span / (max + min);
  const h =
    max === r
      ? ((g - b) / span + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / span + 2) / 6
        : ((r - g) / span + 4) / 6;
  return [h, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): string {
  const channel = (t: number) => {
    const u = (t + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const v =
      u < 1 / 6 ? p + (q - p) * 6 * u
      : u < 1 / 2 ? q
      : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6
      : p;
    return Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`;
}

/**
 * The two grain colours, moved together and then aimed.
 *
 * **Together** is the first half of it: one hue shift and one saturation shift
 * are drawn and both colours take them, so what changes is which timber this is
 * rather than the relationship between its early and late wood. Shifted
 * independently they cross — the dark band comes out lighter than the pale one,
 * or a different colour from it — and a board whose rings are two unrelated
 * colours is not a board, it is a laminate.
 *
 * **Aimed** is the second half. Both are then scaled together so that the pale
 * band lands where {@link FINISHED_LIGHTNESS} wants it *after* the finish has
 * multiplied it down. Scaled rather than offset, because a ratio keeps the two
 * bands' relationship — offsetting both by the same amount flattens the contrast
 * of a dark timber and blows out a pale one.
 *
 * The dark band is held below the pale one by a margin at the end, which is the
 * one thing the species tables all agree on and the one thing a random walk
 * would otherwise break.
 */
function wanderColors(
  dark: string,
  light: string,
  darken: number
): { dark: string; light: string } {
  const hue = ((Math.random() * 2 - 1) * HUE_DEGREES) / 360;
  const saturation = (Math.random() * 2 - 1) * SATURATION_SHIFT;

  const move = (hex: string): [number, number, number] => {
    const [h, s, l] = toHsl(hex);
    return [
      (h + hue + 1) % 1,
      clamp(s + saturation, 0.06, 0.75),
      clamp(l + (Math.random() * 2 - 1) * LIGHTNESS_SHIFT, 0.02, 0.9),
    ];
  };

  const d = move(dark);
  const g = move(light);

  // Aim the pale band, and take the dark one with it. Bounded either way: a
  // factor free to run to twenty would turn teak's near-black latewood into
  // beech, which is a different tree rather than the same one finished
  // differently.
  const target = between(FINISHED_LIGHTNESS[0], FINISHED_LIGHTNESS[1]);
  const factor = clamp(target / Math.max(g[2] * darken, 1e-3), 0.55, 4);
  // Ceilings under 1, and they bind more often than the band does. A finish in
  // this app puts a clearcoat over the colour, and a nearly-white base under a
  // rough clearcoat is not pale timber — it is a white sheen with a hint of
  // grain in it, which was what a matte red oak came back as.
  d[2] = clamp(d[2] * factor, 0.02, 0.66);
  g[2] = clamp(g[2] * factor, 0.04, 0.72);

  const MARGIN = 0.05;
  if (d[2] > g[2] - MARGIN) d[2] = Math.max(0.02, g[2] - MARGIN);

  return { dark: fromHsl(d), light: fromHsl(g) };
}

// ---------------------------------------------------------------------------

/** One candidate: a species, walked away from. */
export function randomWood(): WoodCandidate {
  const species = pick(WOOD_SPECIES_NAMES);
  const finish = pick(FINISH_NAMES);
  const base = WOOD_SPECIES[species];
  const preset = woodPreset(species, finish);
  const colors = wanderColors(base.darkGrainColor, base.lightGrainColor, preset.clearcoatDarken);

  const params = sanitizeWoodParams({
    ...preset,

    // where the sawyer put it
    grainScale: between(120, 230),
    pith: [between(0.3, 1.15), between(-0.45, 0.45)],
    seed: randomSeed(),

    centerSize: wander(base.centerSize, RANGES.centerSize),
    ringThickness: wander(base.ringThickness, RANGES.ringThickness),
    ringBias: wander(base.ringBias, RANGES.ringBias),
    ringSizeVariance: wander(base.ringSizeVariance, RANGES.ringSizeVariance),
    ringVarianceScale: wander(base.ringVarianceScale, RANGES.ringVarianceScale),
    barkThickness: wander(base.barkThickness, RANGES.barkThickness),
    largeWarpScale: wander(base.largeWarpScale, RANGES.largeWarpScale),
    largeGrainStretch: wander(base.largeGrainStretch, RANGES.largeGrainStretch),
    smallWarpStrength: wander(base.smallWarpStrength, RANGES.smallWarpStrength),
    smallWarpScale: wander(base.smallWarpScale, RANGES.smallWarpScale),
    fineWarpStrength: wander(base.fineWarpStrength, RANGES.fineWarpStrength),
    fineWarpScale: wander(base.fineWarpScale, RANGES.fineWarpScale),
    splotchScale: wander(base.splotchScale, RANGES.splotchScale),
    splotchIntensity: wander(base.splotchIntensity, RANGES.splotchIntensity),
    cellScale: wander(base.cellScale, RANGES.cellScale),
    cellSize: wander(base.cellSize, RANGES.cellSize),

    // Drawn flat rather than jittered: the presets fix both at one value for all
    // ten species, so there is no species opinion to walk away from. How marked
    // the figure is and how open the pores are is the timber, not the table.
    grainContrast: between(0.32, 0.72),
    poreIntensity: between(0.05, 0.45),

    darkGrainColor: colors.dark,
    lightGrainColor: colors.light,
  });

  return { species, finish, params };
}

/**
 * What to call one, as a file name.
 *
 * Three parts, and each earns its place: the species it came from, the finish on
 * it, and the seed. The seed is not decoration — the parameters plus the seed
 * *are* the board, so a name carrying it is a name you can read off a shelf and
 * know which of forty near-identical oaks you are looking at.
 *
 * Only characters `sanitizeName` keeps, so what is generated here is what lands
 * on disk. The species keys carry the three.js underscore; a file name reads
 * better with a hyphen.
 */
export function woodCandidateName({ species, finish, params }: WoodCandidate): string {
  return `${species.replace(/_/g, "-")}-${finish}-${params.seed}`;
}

/**
 * The same, stepped until it is not one of `taken`.
 *
 * A clash needs four thousand seeds to collide inside one species and finish, so
 * this is nearly never reached — but *nearly* is the wrong number for a button
 * whose whole job is to write a file, and the alternative to a suffix is an
 * overwrite nobody asked for.
 */
export function freeName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
