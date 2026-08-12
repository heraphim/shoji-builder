/**
 * What a wood texture *is*, as data.
 *
 * The model is the one three.js ships as `WoodNodeMaterial` — a **solid**
 * texture: a colour function of the position inside a virtual log, evaluated in
 * the object's own coordinates rather than through UVs. That single choice is
 * what earns the thing this project needs and nothing else gives for free:
 *
 * - the grain **wraps** a beam, because all four long faces are slices through
 *   one continuous volume and meet at the arris by construction;
 * - the ends show **end grain**, because a cross-cut face is a slice across the
 *   annual rings rather than the same picture rotated;
 * - a notch or a mortise cut into the middle of a piece reveals correct
 *   *interior* grain, which matters here because every solid in the app has been
 *   through a CSG cut.
 *
 * Rings are concentric cylinders about the texture's **Z axis**, and the grain
 * drifts slowly along it (`largeGrainStretch`) — so Z is the length of the log,
 * and `grainAxis` below is which of the part's own axes gets mapped onto it.
 *
 * This module is only the numbers. The shader that reads them is in
 * `woodMaterial.ts`; the file format that stores them is in `textureFile.ts`.
 * They are kept apart because the numbers travel: a saved *.texture.json is the
 * parameter set and nothing else, so a texture opened tomorrow regenerates
 * exactly rather than being an image somebody has to keep.
 *
 * Parameter names and preset values are taken verbatim from
 * `three/examples/jsm/materials/WoodNodeMaterial.js` so the two stay
 * interchangeable — see docs/algorithms/wood-texture.md for why the shader is a
 * port rather than that class itself.
 */

/** Which of the part's own axes runs along the grain. */
export type GrainAxis = "x" | "y" | "z";

export const GRAIN_AXIS_LABELS: Record<GrainAxis, string> = {
  x: "X — along width",
  y: "Y — along height",
  z: "Z — along depth",
};

export interface WoodParams {
  // ---- where the part sits in the log -------------------------------------
  /**
   * Which part axis runs along the grain. The fibres run this way and the two
   * faces normal to it are the end grain.
   */
  grainAxis: GrainAxis;
  /**
   * Size of one texture unit, in mm. Everything below is in texture units, so
   * this is the one number that ties the pattern to real millimetres: at 25,
   * a `ringThickness` of 1/34 puts a growth ring roughly every 0.74 mm.
   *
   * Without it the presets are unusable here — the app models in mm, so a
   * 200 mm beam spans 200 texture units and its 34 rings per unit come out as
   * several thousand rings of aliased grey.
   */
  grainScale: number;
  /**
   * Where the pith (the centre of the log) sits, in texture units, across the
   * grain. Near zero gives the tight arcs of a boxed-heart piece; further out
   * gives the flatter cathedral figure of a board sawn from the outside of the
   * log. Two numbers, one per cross-grain axis.
   */
  pith: [number, number];
  /**
   * Which slice of the log this piece was cut from. Any integer; it only ever
   * shifts the sample point, so the same seed always gives the same texture and
   * a saved file reproduces exactly.
   */
  seed: number;

  // ---- rings ---------------------------------------------------------------
  centerSize: number;
  ringThickness: number;
  ringBias: number;
  ringSizeVariance: number;
  ringVarianceScale: number;
  barkThickness: number;
  /**
   * How far towards `darkGrainColor` a ring is allowed to go. Not in the
   * original, which fixes it at 0.5; exposed because it is the one knob that
   * takes a species from "hint of figure" to "strongly marked" without
   * disturbing anything else.
   */
  grainContrast: number;

  // ---- how the rings are pushed about --------------------------------------
  largeWarpScale: number;
  largeGrainStretch: number;
  smallWarpStrength: number;
  smallWarpScale: number;
  fineWarpStrength: number;
  fineWarpScale: number;

  // ---- figure and pores ----------------------------------------------------
  splotchScale: number;
  splotchIntensity: number;
  cellScale: number;
  cellSize: number;
  /**
   * How strongly the pore structure shows. Fixed at 0.407 in the original.
   * Exposed mainly so it can be set to 0: the pores are a 27-tap voronoi and
   * skipping them is the one meaningful saving in the whole shader.
   */
  poreIntensity: number;

  // ---- colour and finish ---------------------------------------------------
  darkGrainColor: string;
  lightGrainColor: string;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Raw timber is lighter than finished; a film darkens what is under it. */
  clearcoatDarken: number;
}

/** The parameters a species preset fixes — everything but placement and finish. */
type SpeciesParams = Omit<
  WoodParams,
  | "grainAxis"
  | "grainScale"
  | "pith"
  | "seed"
  | "roughness"
  | "clearcoat"
  | "clearcoatRoughness"
  | "clearcoatDarken"
>;

// Shared by every species: the two knobs that are not in the original preset
// tables because the original does not expose them.
const EXTRA = { grainContrast: 0.5, poreIntensity: 0.407 };

/**
 * The ten species three.js ships, values unchanged.
 *
 * Left as literal numbers rather than tidied into ratios: they are somebody's
 * calibration against real timber and the only useful thing to do with them is
 * copy them exactly.
 */
export const WOOD_SPECIES = {
  teak: {
    centerSize: 1.11, largeWarpScale: 0.32, largeGrainStretch: 0.24, smallWarpStrength: 0.059,
    smallWarpScale: 2, fineWarpStrength: 0.006, fineWarpScale: 32.8, ringThickness: 1 / 34,
    ringBias: 0.03, ringSizeVariance: 0.03, ringVarianceScale: 4.4, barkThickness: 0.3,
    splotchScale: 0.2, splotchIntensity: 0.541, cellScale: 910, cellSize: 0.1,
    darkGrainColor: "#0c0504", lightGrainColor: "#926c50", ...EXTRA,
  },
  walnut: {
    centerSize: 1.07, largeWarpScale: 0.42, largeGrainStretch: 0.34, smallWarpStrength: 0.016,
    smallWarpScale: 10.3, fineWarpStrength: 0.028, fineWarpScale: 12.7, ringThickness: 1 / 32,
    ringBias: 0.08, ringSizeVariance: 0.03, ringVarianceScale: 5.5, barkThickness: 0.98,
    splotchScale: 1.84, splotchIntensity: 0.97, cellScale: 710, cellSize: 0.31,
    darkGrainColor: "#311e13", lightGrainColor: "#523424", ...EXTRA,
  },
  white_oak: {
    centerSize: 1.23, largeWarpScale: 0.21, largeGrainStretch: 0.21, smallWarpStrength: 0.034,
    smallWarpScale: 2.44, fineWarpStrength: 0.01, fineWarpScale: 14.3, ringThickness: 1 / 34,
    ringBias: 0.82, ringSizeVariance: 0.16, ringVarianceScale: 1.4, barkThickness: 0.7,
    splotchScale: 0.2, splotchIntensity: 0.541, cellScale: 800, cellSize: 0.28,
    darkGrainColor: "#8b4c21", lightGrainColor: "#c57e43", ...EXTRA,
  },
  pine: {
    centerSize: 1.23, largeWarpScale: 0.21, largeGrainStretch: 0.18, smallWarpStrength: 0.041,
    smallWarpScale: 2.44, fineWarpStrength: 0.006, fineWarpScale: 23.2, ringThickness: 1 / 24,
    ringBias: 0.1, ringSizeVariance: 0.07, ringVarianceScale: 5, barkThickness: 0.35,
    splotchScale: 0.51, splotchIntensity: 3.32, cellScale: 1480, cellSize: 0.07,
    darkGrainColor: "#c58355", lightGrainColor: "#d19d61", ...EXTRA,
  },
  poplar: {
    centerSize: 1.43, largeWarpScale: 0.33, largeGrainStretch: 0.18, smallWarpStrength: 0.04,
    smallWarpScale: 4.3, fineWarpStrength: 0.004, fineWarpScale: 33.6, ringThickness: 1 / 37,
    ringBias: 0.07, ringSizeVariance: 0.03, ringVarianceScale: 3.8, barkThickness: 0.3,
    splotchScale: 1.92, splotchIntensity: 0.71, cellScale: 830, cellSize: 0.04,
    darkGrainColor: "#716347", lightGrainColor: "#998966", ...EXTRA,
  },
  maple: {
    centerSize: 1.4, largeWarpScale: 0.38, largeGrainStretch: 0.25, smallWarpStrength: 0.067,
    smallWarpScale: 2.5, fineWarpStrength: 0.005, fineWarpScale: 33.6, ringThickness: 1 / 35,
    ringBias: 0.1, ringSizeVariance: 0.07, ringVarianceScale: 4.6, barkThickness: 0.61,
    splotchScale: 0.46, splotchIntensity: 1.49, cellScale: 800, cellSize: 0.03,
    darkGrainColor: "#b08969", lightGrainColor: "#bc9d7d", ...EXTRA,
  },
  red_oak: {
    centerSize: 1.21, largeWarpScale: 0.24, largeGrainStretch: 0.25, smallWarpStrength: 0.044,
    smallWarpScale: 2.54, fineWarpStrength: 0.01, fineWarpScale: 14.5, ringThickness: 1 / 34,
    ringBias: 0.92, ringSizeVariance: 0.03, ringVarianceScale: 5.6, barkThickness: 1.01,
    splotchScale: 0.28, splotchIntensity: 3.48, cellScale: 800, cellSize: 0.25,
    darkGrainColor: "#af613b", lightGrainColor: "#e0a27a", ...EXTRA,
  },
  cherry: {
    centerSize: 1.33, largeWarpScale: 0.11, largeGrainStretch: 0.33, smallWarpStrength: 0.024,
    smallWarpScale: 2.48, fineWarpStrength: 0.01, fineWarpScale: 15.3, ringThickness: 1 / 36,
    ringBias: 0.02, ringSizeVariance: 0.04, ringVarianceScale: 6.5, barkThickness: 0.09,
    splotchScale: 1.27, splotchIntensity: 1.24, cellScale: 1530, cellSize: 0.15,
    darkGrainColor: "#913f27", lightGrainColor: "#b45837", ...EXTRA,
  },
  cedar: {
    centerSize: 1.11, largeWarpScale: 0.39, largeGrainStretch: 0.12, smallWarpStrength: 0.061,
    smallWarpScale: 1.9, fineWarpStrength: 0.006, fineWarpScale: 4.8, ringThickness: 1 / 25,
    ringBias: 0.01, ringSizeVariance: 0.07, ringVarianceScale: 6.7, barkThickness: 0.1,
    splotchScale: 0.61, splotchIntensity: 2.54, cellScale: 630, cellSize: 0.19,
    darkGrainColor: "#9a5b49", lightGrainColor: "#ae745e", ...EXTRA,
  },
  mahogany: {
    centerSize: 1.25, largeWarpScale: 0.26, largeGrainStretch: 0.29, smallWarpStrength: 0.044,
    smallWarpScale: 2.54, fineWarpStrength: 0.01, fineWarpScale: 15.3, ringThickness: 1 / 38,
    ringBias: 0.01, ringSizeVariance: 0.33, ringVarianceScale: 1.2, barkThickness: 0.07,
    splotchScale: 0.77, splotchIntensity: 1.39, cellScale: 1400, cellSize: 0.23,
    darkGrainColor: "#501d12", lightGrainColor: "#6d3722", ...EXTRA,
  },
} satisfies Record<string, SpeciesParams>;

export type WoodSpecies = keyof typeof WOOD_SPECIES;

export const WOOD_SPECIES_NAMES = Object.keys(WOOD_SPECIES) as WoodSpecies[];

/** Human labels — the keys carry the underscore the three.js presets use. */
export const SPECIES_LABELS: Record<WoodSpecies, string> = {
  teak: "Teak",
  walnut: "Walnut",
  white_oak: "White oak",
  pine: "Pine",
  poplar: "Poplar",
  maple: "Maple",
  red_oak: "Red oak",
  cherry: "Cherry",
  cedar: "Cedar",
  mahogany: "Mahogany",
};

export type WoodFinish = "raw" | "matte" | "semigloss" | "gloss";

export const FINISH_NAMES: WoodFinish[] = ["raw", "matte", "semigloss", "gloss"];

export const FINISH_LABELS: Record<WoodFinish, string> = {
  raw: "Raw",
  matte: "Matte",
  semigloss: "Semi-gloss",
  gloss: "Gloss",
};

/**
 * What a finish does. `roughness` is this port's addition — the original leaves
 * the base material's default, which reads as plastic under a clearcoat.
 */
export const WOOD_FINISHES: Record<
  WoodFinish,
  Pick<WoodParams, "roughness" | "clearcoat" | "clearcoatRoughness" | "clearcoatDarken">
> = {
  raw: { roughness: 0.92, clearcoat: 0, clearcoatRoughness: 0, clearcoatDarken: 1 },
  matte: { roughness: 0.8, clearcoat: 1, clearcoatRoughness: 1, clearcoatDarken: 0.6 },
  semigloss: { roughness: 0.66, clearcoat: 1, clearcoatRoughness: 0.4, clearcoatDarken: 0.4 },
  gloss: { roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.1, clearcoatDarken: 0.2 },
};

/**
 * Placement defaults, and the one thing about this port that had to be measured
 * rather than copied.
 *
 * The species tables above are calibrated for an object about **one texture unit
 * across** — that is the scale the three.js example renders at, and every
 * warp strength in them is an absolute number of texture units. Feed the same
 * numbers a piece that spans a whole unit at millimetre scale and the broad warp
 * displaces the rings by twenty ring-widths *across the width of the part*, which
 * does not read as figure; it reads as static.
 *
 * So `grainScale` has to keep a real part well under a unit. At 160 mm a 40 mm
 * post is a quarter of a unit and the warp becomes the gentle sweep it is meant
 * to be, while 34 rings to the unit works out at a 4.7 mm ring pitch — six or
 * seven rings across that post's face, and a 5 mm kumiko strip showing barely
 * one, which is exactly what a 5 mm strip looks like.
 *
 * The pith sits 0.62 units — about 100 mm — off to the side, so a part is
 * flat-sawn by default. Dead centre gives every piece a bullseye, which is the
 * one thing a joiner would never cut.
 */
export const DEFAULT_PLACEMENT: Pick<WoodParams, "grainAxis" | "grainScale" | "pith" | "seed"> = {
  grainAxis: "x",
  grainScale: 160,
  pith: [0.62, 0.15],
  seed: 1,
};

export function woodPreset(species: WoodSpecies, finish: WoodFinish): WoodParams {
  return { ...DEFAULT_PLACEMENT, ...WOOD_SPECIES[species], ...WOOD_FINISHES[finish] };
}

export const DEFAULT_WOOD_PARAMS: WoodParams = woodPreset("white_oak", "raw");

/**
 * A fresh seed.
 *
 * Small integers on purpose: the seed is displayed next to the button and gets
 * typed back in by hand when somebody wants the log they had ten minutes ago.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 10000);
}

/**
 * The seed as an offset into the log, in texture units.
 *
 * A plain hash rather than anything clever — all that is asked of it is that
 * consecutive seeds land nowhere near each other, so stepping the seed reads as
 * "another board" rather than as "the same board nudged".
 *
 * The two cross-grain offsets are deliberately **small**, half a unit at most.
 * They were much larger to begin with, and the effect was that the seed threw
 * every piece thirty units from the pith, where the rings are so nearly parallel
 * that the end grain is stripes — the pith slider was setting a number that no
 * longer decided anything. Moving *along* the log changes the figure without
 * moving the piece out of the tree, so that is where the range goes.
 */
export function seedOffset(seed: number): [number, number, number] {
  const hash = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return [hash(seed) - 0.5, hash(seed + 1000) - 0.5, hash(seed + 2000) * 120 - 60];
}

/** Anything a control could hand back, made safe for the shader. */
export function sanitizeWoodParams(params: WoodParams): WoodParams {
  const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  return {
    ...params,
    // a grain scale of zero divides the whole texture space by nothing
    grainScale: Math.max(0.01, finite(params.grainScale, DEFAULT_PLACEMENT.grainScale)),
    // likewise a ring thickness of zero: the shader divides by it
    ringThickness: Math.max(1e-4, finite(params.ringThickness, 1 / 34)),
    // the ring profile ramps over [0, ringBias]; at zero every ring is one
    // infinitely thin line, which is pure aliasing
    ringBias: Math.min(0.999, Math.max(1e-3, finite(params.ringBias, 0.1))),
    seed: Math.round(finite(params.seed, 1)),
  };
}
