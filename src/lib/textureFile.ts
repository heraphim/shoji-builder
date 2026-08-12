import {
  DEFAULT_WOOD_PARAMS,
  sanitizeWoodParams,
  type GrainAxis,
  type WoodFinish,
  type WoodParams,
  type WoodSpecies,
} from "./wood";
import { listLibrary, readLibraryFile } from "./library";

/**
 * The `*.texture.json` format, both directions.
 *
 * A saved texture is a **recipe**, exactly as a saved component is: the numbers
 * that generate it and nothing else. There is no image in the file and never
 * will be, which is the whole reason the texture is procedural — a 40 mm post
 * and a 5 mm kumiko strip want the same wood at two very different scales, and
 * a baked image can only be right for one of them.
 *
 * That is also why `species` and `finish` are recorded *beside* the parameters
 * rather than instead of them. They are only a note of which preset the numbers
 * started from, so the sidebar can show it; the parameters are what is drawn,
 * and a file whose numbers have been nudged off a preset still loads as what it
 * looked like when it was saved. Loading never re-applies the preset.
 *
 * Round trip: save writes what the Textures tab currently shows; open restores
 * every control to the position it was in, seed included. Same seed, same
 * parameters, same board.
 *
 * `description` (format 2) is the one field no code reads: which timber this is
 * meant to be and where it is for. Thirty numbers cannot say "the quartersawn
 * oak for the posts", and the name has to stay short enough to be a name.
 */
export const TEXTURE_FORMAT = 2;

export interface TextureFile {
  id: string;
  /** What it is, in prose. Absent in files written before format 2. */
  description?: string;
  type: "texture";
  format: number;
  units: "mm";
  /** Which generator these parameters belong to. One so far. */
  model: "wood";
  /** Provenance only — the preset the numbers were last taken from. */
  species: WoodSpecies;
  finish: WoodFinish;
  params: WoodParams;
}

const DECIMALS = 6;
const round = (v: number) => Number(v.toFixed(DECIMALS));

export function buildTextureFile(
  id: string,
  species: WoodSpecies,
  finish: WoodFinish,
  params: WoodParams,
  description = ""
): TextureFile {
  return {
    id,
    // omitted rather than written empty — see componentFile.ts
    ...(description.trim() ? { description: description.trim() } : {}),
    type: "texture",
    format: TEXTURE_FORMAT,
    units: "mm",
    model: "wood",
    species,
    finish,
    params: {
      ...params,
      // written at a fixed precision so two saves of the same texture are the
      // same bytes — a file that differs only in float noise is a file that
      // shows up as changed in every diff
      grainScale: round(params.grainScale),
      pith: [round(params.pith[0]), round(params.pith[1])],
      centerSize: round(params.centerSize),
      ringThickness: round(params.ringThickness),
      ringBias: round(params.ringBias),
      ringSizeVariance: round(params.ringSizeVariance),
      ringVarianceScale: round(params.ringVarianceScale),
      barkThickness: round(params.barkThickness),
      grainContrast: round(params.grainContrast),
      largeWarpScale: round(params.largeWarpScale),
      largeGrainStretch: round(params.largeGrainStretch),
      smallWarpStrength: round(params.smallWarpStrength),
      smallWarpScale: round(params.smallWarpScale),
      fineWarpStrength: round(params.fineWarpStrength),
      fineWarpScale: round(params.fineWarpScale),
      splotchScale: round(params.splotchScale),
      splotchIntensity: round(params.splotchIntensity),
      cellScale: round(params.cellScale),
      cellSize: round(params.cellSize),
      poreIntensity: round(params.poreIntensity),
      roughness: round(params.roughness),
      clearcoat: round(params.clearcoat),
      clearcoatRoughness: round(params.clearcoatRoughness),
      clearcoatDarken: round(params.clearcoatDarken),
    },
  };
}

/** A file name reduced to what may safely go in one, or null if nothing is left. */
export function sanitizeName(name: string): string | null {
  const clean = name.trim().replace(/[^A-Za-z0-9 _-]/g, "").trim();
  return clean.length > 0 ? clean : null;
}

const GRAIN_AXES: GrainAxis[] = ["x", "y", "z"];

/**
 * Read a payload back into parameters.
 *
 * Field by field against the defaults rather than a spread of whatever was in
 * the JSON: a texture is fed straight to a shader, and one string where a number
 * belonged is a NaN in a uniform, which in GLSL is a black object with no error
 * anywhere to say why.
 *
 * @throws when the payload is not a texture file this app can draw.
 */
export function parseTextureFile(data: unknown): TextureFile {
  const file = data as Partial<TextureFile> | null;
  if (!file || file.type !== "texture" || !file.params) {
    throw new Error("Not a texture file");
  }
  if (file.model !== undefined && file.model !== "wood") {
    throw new Error(`Unknown texture model “${String(file.model)}”`);
  }

  const raw = file.params as Partial<WoodParams>;
  const num = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const str = (value: unknown, fallback: string) =>
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  const d = DEFAULT_WOOD_PARAMS;

  const params: WoodParams = sanitizeWoodParams({
    grainAxis: GRAIN_AXES.includes(raw.grainAxis as GrainAxis)
      ? (raw.grainAxis as GrainAxis)
      : d.grainAxis,
    grainScale: num(raw.grainScale, d.grainScale),
    pith: [
      num(Array.isArray(raw.pith) ? raw.pith[0] : undefined, d.pith[0]),
      num(Array.isArray(raw.pith) ? raw.pith[1] : undefined, d.pith[1]),
    ],
    seed: num(raw.seed, d.seed),
    centerSize: num(raw.centerSize, d.centerSize),
    ringThickness: num(raw.ringThickness, d.ringThickness),
    ringBias: num(raw.ringBias, d.ringBias),
    ringSizeVariance: num(raw.ringSizeVariance, d.ringSizeVariance),
    ringVarianceScale: num(raw.ringVarianceScale, d.ringVarianceScale),
    barkThickness: num(raw.barkThickness, d.barkThickness),
    grainContrast: num(raw.grainContrast, d.grainContrast),
    largeWarpScale: num(raw.largeWarpScale, d.largeWarpScale),
    largeGrainStretch: num(raw.largeGrainStretch, d.largeGrainStretch),
    smallWarpStrength: num(raw.smallWarpStrength, d.smallWarpStrength),
    smallWarpScale: num(raw.smallWarpScale, d.smallWarpScale),
    fineWarpStrength: num(raw.fineWarpStrength, d.fineWarpStrength),
    fineWarpScale: num(raw.fineWarpScale, d.fineWarpScale),
    splotchScale: num(raw.splotchScale, d.splotchScale),
    splotchIntensity: num(raw.splotchIntensity, d.splotchIntensity),
    cellScale: num(raw.cellScale, d.cellScale),
    cellSize: num(raw.cellSize, d.cellSize),
    poreIntensity: num(raw.poreIntensity, d.poreIntensity),
    darkGrainColor: str(raw.darkGrainColor, d.darkGrainColor),
    lightGrainColor: str(raw.lightGrainColor, d.lightGrainColor),
    roughness: num(raw.roughness, d.roughness),
    clearcoat: num(raw.clearcoat, d.clearcoat),
    clearcoatRoughness: num(raw.clearcoatRoughness, d.clearcoatRoughness),
    clearcoatDarken: num(raw.clearcoatDarken, d.clearcoatDarken),
  });

  return {
    id: typeof file.id === "string" ? file.id : "texture",
    ...(typeof file.description === "string" ? { description: file.description } : {}),
    type: "texture",
    format: num(file.format, TEXTURE_FORMAT),
    units: "mm",
    model: "wood",
    species: (file.species ?? "white_oak") as WoodSpecies,
    finish: (file.finish ?? "raw") as WoodFinish,
    params,
  };
}

// Textures are read and written the same way components and lamps are —
// public/models/textures, through lib/library.ts.

/** File names in the library. @throws if the listing cannot be had. */
export function listLibraryTextures(): Promise<string[]> {
  return listLibrary("textures");
}

/** Fetch and parse one library texture. @throws on a missing or bad file. */
export async function loadLibraryTexture(fileName: string): Promise<TextureFile> {
  return parseTextureFile(await readLibraryFile("textures", fileName));
}

/** The library file name a texture is referred to by elsewhere, without extension. */
export function textureDisplayName(fileName: string): string {
  return fileName.replace(/(\.texture)?\.json$/, "");
}
