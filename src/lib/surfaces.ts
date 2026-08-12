import * as THREE from "three";

/**
 * The two surfaces the room is made of that are not timber: woven cloth, and
 * plaster.
 *
 * Built the same way `woodMaterial.ts` is, and for the same reason — **solid
 * textures read in object space, with no UVs anywhere**. Nothing in this app
 * generates texture coordinates; a lamp part is a position-only buffer out of
 * `mergeGeometries`, and the room's props are boxes and inflated boxes. A normal
 * map would need the one thing none of them has, and hand-unwrapping a pillow to
 * get one would be a day's work to end up with seams.
 *
 * A function of position has none of that. It also scales correctly for free: a
 * weave is a real size in millimetres, so it stays that size whether it is on a
 * pillow or on a sheet, which is exactly what a tiled map does not do.
 *
 * ## Where the numbers come from
 *
 * The response to light matters more than the pattern, and those are measured
 * quantities rather than things to taste:
 *
 * - **Cotton** is a dielectric with a rough, fibrous surface and a strong
 *   grazing-angle lobe from the fibre ends standing off it. That last part is
 *   what `sheen` on `MeshPhysicalMaterial` exists for, and leaving it off is why
 *   untreated cloth in a render looks like painted clay. Roughness ~0.95, sheen
 *   near white, sheen roughness ~0.35.
 * - **Lime plaster** is rougher still and near-Lambertian — roughness ~0.97,
 *   no sheen, and a very low-amplitude bump at a hand's width, which is the
 *   trowel rather than the material.
 */

// ---------------------------------------------------------------------------
// The shared shader
// ---------------------------------------------------------------------------

/**
 * Value noise, fbm, and the bump construction, in the app's one dialect.
 *
 * Deliberately *not* shared with `woodMaterial.ts`: that file is a port of a
 * specific three.js example and every function in it has to keep matching the
 * original's output. Factoring the two together would tie a room prop's
 * appearance to a fidelity constraint that has nothing to do with it.
 *
 * No backticks anywhere below. This is a template literal, and a backtick in a
 * comment ends the shader.
 */
const SURFACE_COMMON = /* glsl */ `
varying vec3 vSurfacePosition;

float surfHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float surfNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(surfHash(i + vec3(0,0,0)), surfHash(i + vec3(1,0,0)), u.x),
        mix(surfHash(i + vec3(0,1,0)), surfHash(i + vec3(1,1,0)), u.x), u.y),
    mix(mix(surfHash(i + vec3(0,0,1)), surfHash(i + vec3(1,0,1)), u.x),
        mix(surfHash(i + vec3(0,1,1)), surfHash(i + vec3(1,1,1)), u.x), u.y),
    u.z);
}

/**
 * How much of a detail at this wavelength is left, at this pixel size.
 *
 * Every term in every height field below is a wave with a size, and a wave
 * sampled at fewer than a few pixels per period does not fade out gracefully -
 * it aliases, and what comes back is a coarse pattern that was never in the
 * function. Cloth was the loudest case: a 3 mm weave at a millimetre per pixel
 * turned a pillow into television static.
 *
 * So each term is faded out by its own size rather than the surface being faded
 * out by one number. This is what a mipmap does for a texture, done by hand
 * because there is no texture.
 */
float surfBandLimit(float wavelength, float pixel) {
  return 1.0 - smoothstep(wavelength * 0.3, wavelength * 1.1, pixel);
}

/** The size of one pixel, in the units the height field is written in. */
float surfPixel(vec3 p) {
  return max(max(fwidth(p.x), fwidth(p.y)), fwidth(p.z));
}

float surfFbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amplitude * surfNoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

/**
 * The same, with each octave dropped once it is finer than a pixel.
 *
 * This is where the speckle actually came from. Band-limiting the *named*
 * wavelengths was not enough, because an fbm four octaves deep contains three
 * more that nobody named: a 58 mm fold carries a 7 mm one inside it at an eighth
 * of the amplitude, which at that wavelength is a steeper slope than the fold
 * itself. Those were the black dots.
 */
float surfFbmLod(vec3 p, int octaves, float wavelength, float pixel) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amplitude * surfNoise(p) * surfBandLimit(wavelength, pixel);
    p *= 2.03;
    amplitude *= 0.5;
    wavelength /= 2.03;
  }
  return sum;
}

/**
 * The height field, as relief. Mikkelsen's construction, from screen
 * derivatives of a value the fragment has already computed - see
 * woodPerturbNormal in woodMaterial.ts, which does the same thing for grain.
 */
vec3 surfPerturbNormal(vec3 normal, vec3 surfacePosition, float height, float scale) {
  vec3 dpdx = dFdx(surfacePosition);
  vec3 dpdy = dFdy(surfacePosition);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  // No global fade here: every term in the height field band-limits itself, and
  // fading twice takes the large features out along with the small ones.
  vec3 gradient = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2) * scale;

  // The backstop. A gradient steeper than this tips the normal past the surface's
  // own horizon, N dot L goes negative, and the fragment goes black - which is
  // not a dark fold, it is a hole, and a field of them is the static this whole
  // file has been fighting. 0.7 is a thirty-five-degree slope: more than any
  // cloth lying on a made bed, and still a surface.
  float limit = abs(det) * 0.7;
  float steep = length(gradient);
  if (steep > limit) gradient *= limit / steep;

  return normalize(abs(det) * normal - gradient);
}
`;

/** Give a material the object-space position its shader reads. */
function carryPosition(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", "varying vec3 vSurfacePosition;\nvoid main() {")
    .replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n  vSurfacePosition = position;"
    );
}

// ---------------------------------------------------------------------------
// Cloth
// ---------------------------------------------------------------------------

export interface ClothParams {
  color: THREE.ColorRepresentation;
  /** Warp-and-weft pitch in mm. A bed sheet is finer than a linen cushion. */
  weave: number;
  /** How deep the weave sits, as a surface gradient. */
  weaveDepth: number;
  /** The size of the folds, in mm — how far the cloth spans between creases. */
  fold: number;
  /**
   * How sharp those folds are, as the *slope* of the steepest part.
   *
   * A slope, not a depth, because the two are only the same thing at one scale
   * and this shader is read at every scale. Written as an amplitude first, and
   * every value that looked right on a 50 mm crease was invisible on a 130 mm
   * one: a 3 mm rise over 130 mm is a one-degree tilt, and one degree does not
   * shade. 0.3 is a fold you can see across a room.
   */
  foldDepth: number;
  /** The fuzz standing off the fibres, which is what cloth has and clay does not. */
  sheen: number;
}

/**
 * Plain cotton sheeting.
 *
 * `weaveDepth` is deliberately tiny. Woven at a real pitch and a real depth the
 * threads came out as corduroy: a 2 mm rib is under a pixel across at this
 * distance, and a sub-pixel ridge does not average away, it aliases into stripes
 * far coarser than the thing that made them. What a bedspread actually shows
 * from across a room is the folds and the sheen; the weave is there to break the
 * highlight, not to be counted.
 */
export const COTTON: ClothParams = {
  color: "#cfc6b6",
  weave: 3.4,
  weaveDepth: 0.11,
  fold: 55,
  foldDepth: 0.3,
  sheen: 0.55,
};

const CLOTH_FRAGMENT = /* glsl */ `
uniform float uWeave;
uniform float uWeaveDepth;
uniform float uFold;
uniform float uFoldDepth;

/**
 * Plain weave: two sets of threads at right angles, each one passing over and
 * under the other. Two sines a quarter-period apart give exactly that - the
 * ridge of the warp sits where the weft dips - and the maximum of the two is
 * the thread that is on top at that point, which is what makes it read as
 * crossing threads rather than as a checkerboard.
 */
float clothHeight(vec3 p) {
  float px = surfPixel(p);
  vec3 q = p / max(uWeave, 0.01);
  float warp = sin(q.x * 6.2831853);
  float weft = sin(q.z * 6.2831853 + 1.5707963);
  float threads = (max(warp, weft) * 0.5 + 0.5) * surfBandLimit(uWeave, px);

  // The folds, and a coarse slub in the yarn under them. Each amplitude is
  // multiplied back up by its own wavelength, so the parameters are slopes and
  // a 130 mm fold and a 3 mm thread can be given the same number and read the
  // same amount.
  // Two octaves, not four. Bedding at arm's length is broad soft folds and
  // nothing else; the third and fourth octaves put 7 mm wrinkles into a duvet,
  // which at this distance is not detail, it is grain — and grain on cloth reads
  // as dirt. What carries the close-up detail is the weave and the sheen, both
  // of which are the right size for it.
  float fold = max(uFold, 1.0);
  float folds = surfFbmLod(p / fold, 2, fold, px) * fold;
  // The slub — the thick-and-thin of a spun yarn. Kept shallow: at 0.3 it was
  // not slub, it was static, because a bump whose wavelength is a few pixels
  // does not read as a surface at all.
  float slub = surfNoise(p / max(uWeave * 9.0, 0.1)) * uWeave * 0.12
             * surfBandLimit(uWeave * 9.0, px);

  return threads * uWeave * uWeaveDepth + (folds + slub) * uFoldDepth;
}
`;

/**
 * Cloth: a woven height field, folds over it, and the grazing-angle sheen that
 * makes it cloth.
 *
 * Physical rather than standard for the sheen alone. There is no cheaper way to
 * get it — a fabric's bright rim under a lamp is not a specular highlight and no
 * amount of roughness will produce it.
 */
export class ClothMaterial extends THREE.MeshPhysicalMaterial {
  private readonly clothUniforms = {
    uWeave: { value: COTTON.weave },
    uWeaveDepth: { value: COTTON.weaveDepth },
    uFold: { value: COTTON.fold },
    uFoldDepth: { value: COTTON.foldDepth },
  };

  constructor(params: Partial<ClothParams> = {}) {
    const p = { ...COTTON, ...params };
    super({
      color: p.color,
      roughness: 0.95,
      metalness: 0,
      sheen: p.sheen,
      sheenColor: new THREE.Color("#fffaf0"),
      sheenRoughness: 0.35,
    });
    this.clothUniforms.uWeave.value = p.weave;
    this.clothUniforms.uWeaveDepth.value = p.weaveDepth;
    this.clothUniforms.uFold.value = p.fold;
    this.clothUniforms.uFoldDepth.value = p.foldDepth;
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.clothUniforms);
    carryPosition(shader);

    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${SURFACE_COMMON}\n${CLOTH_FRAGMENT}\nvoid main() {`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  normal = surfPerturbNormal(normal, -vViewPosition, clothHeight(vSurfacePosition), 1.0);`
      );
  }

  override customProgramCacheKey(): string {
    return "cloth-weave";
  }
}

// ---------------------------------------------------------------------------
// Plaster
// ---------------------------------------------------------------------------

const PLASTER_FRAGMENT = /* glsl */ `
uniform float uTrowel;

/**
 * A wall is flat, and the whole of what stops it looking like a plane in a
 * renderer is that it is not quite. Two scales: the sweep of the float, at a
 * hand's width, and the sand in the mix under it.
 */
float plasterHeight(vec3 p) {
  // Same rule as the cloth: each octave carries its own wavelength, so what is
  // written here is how steep it is rather than how tall, and a wall reads the
  // same whether you are across the room from it or beside it.
  float px = surfPixel(p);
  return surfFbmLod(p / 90.0, 3, 90.0, px) * 90.0 * 0.055
       + surfFbmLod(p / 14.0, 2, 14.0, px) * 14.0 * 0.045
       + surfNoise(p / 4.5) * 4.5 * 0.035 * surfBandLimit(4.5, px);
}
`;

/**
 * Lime plaster: nearly Lambertian, with a bump low enough that you would call it
 * flat and high enough that a raking light finds it.
 *
 * Standard rather than physical: plaster has no clearcoat, no sheen and no
 * transmission, and paying for those chunks on the largest surface in the scene
 * buys nothing.
 */
export class PlasterMaterial extends THREE.MeshStandardMaterial {
  private readonly plasterUniforms = { uTrowel: { value: 1 } };

  constructor(color: THREE.ColorRepresentation, trowel = 1) {
    super({ color, roughness: 0.97, metalness: 0 });
    this.plasterUniforms.uTrowel.value = trowel;
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.plasterUniforms);
    carryPosition(shader);

    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${SURFACE_COMMON}\n${PLASTER_FRAGMENT}\nvoid main() {`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  normal = surfPerturbNormal(normal, -vViewPosition, plasterHeight(vSurfacePosition), uTrowel);`
      );
  }

  override customProgramCacheKey(): string {
    return "plaster";
  }
}

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------

const PAPER_FRAGMENT = /* glsl */ `
uniform float uCrease;

/**
 * Paper that has been rolled and unrolled: long soft ridges running across it,
 * a few sharper ones where it was folded, and the fibre under both.
 *
 * The ridges run in one direction because a scroll is stored one way round. A
 * scroll creased evenly in both directions is a sheet of crumpled paper, which
 * is a different object entirely.
 */
float paperHeight(vec3 p) {
  float px = surfPixel(p);
  float ridges = sin(p.y / 26.0 * 6.2831853 + surfFbm(p / 70.0, 3) * 9.0) * 26.0 * 0.02
               * surfBandLimit(26.0, px);
  float slack = surfFbmLod(p / 130.0, 3, 130.0, px) * 130.0 * 0.03;
  float fibre = surfNoise(p / 2.6) * 2.6 * 0.035 * surfBandLimit(2.6, px);
  return (ridges + slack + fibre) * uCrease;
}
`;

/**
 * The scroll: a printed sheet with the memory of having been rolled up.
 *
 * Takes a map, because unlike everything else in this file the thing on it is a
 * picture rather than a material. The creases are geometry-free — they are a
 * height field over the flat panel, so the painting stays rectangular and only
 * the light across it bends.
 */
export class PaperMaterial extends THREE.MeshStandardMaterial {
  private readonly paperUniforms = { uCrease: { value: 1 } };

  constructor(map: THREE.Texture, crease = 1) {
    super({ map, roughness: 0.88, metalness: 0, side: THREE.FrontSide });
    this.paperUniforms.uCrease.value = crease;
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.paperUniforms);
    carryPosition(shader);

    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${SURFACE_COMMON}\n${PAPER_FRAGMENT}\nvoid main() {`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  normal = surfPerturbNormal(normal, -vViewPosition, paperHeight(vSurfacePosition), 1.0);`
      );
  }

  override customProgramCacheKey(): string {
    return "paper-crease";
  }
}
