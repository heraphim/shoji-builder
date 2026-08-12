import * as THREE from "three";
import {
  sanitizeWoodParams,
  seedOffset,
  type GrainAxis,
  type WoodParams,
} from "./wood";

/**
 * The wood solid texture, as a material the app's existing renderer can draw.
 *
 * ## Why this is a port and not `WoodNodeMaterial`
 *
 * three.js ships the same texture as `examples/jsm/materials/WoodNodeMaterial.js`,
 * and that is where every constant in `wood.ts` comes from. It is a **node**
 * material, which means it only draws under `WebGPURenderer` — and the whole app
 * hangs off one `<Canvas>` shared by both tabs and all four views (see
 * `ViewportGrid`), whose scissored drei `<View>`s, hidden-line dashed overlays
 * and polygon-offset fills are all working today against `WebGLRenderer`.
 * Swapping the renderer under all of that to gain a texture would be trading a
 * feature for a risk to everything else on screen.
 *
 * Worse, `WoodNodeMaterial` would not survive the swap intact anyway: its pore
 * layer is written with `TSL.wgslFn`, which is raw WGSL, so it cannot fall back
 * to WebGPURenderer's own WebGL backend either.
 *
 * So the algorithm is reimplemented here in GLSL and injected into a
 * `MeshPhysicalMaterial` through `onBeforeCompile`. Parameter names, ranges and
 * preset values are kept identical, so a later move to the real class is a
 * swap of this file and nothing else.
 *
 * ## What differs from the original, deliberately
 *
 * - **Noise.** The original calls MaterialX's `mx_noise_float`/`mx_noise_vec3`.
 *   This uses ordinary Perlin gradient noise. Same character, different detail:
 *   a preset gives recognisably the same species, not the same board.
 * - **Ring profile.** `mapRange(rings, ringBias, 1, 1, 0, clamp)` in the
 *   original clamps to `max(min(x, 0), 1)`, which is 1 for every input — so the
 *   falling half of the ring never applies. Here the ramp is clamped the way it
 *   plainly means to be. The two agree wherever `barkThickness <= 1`, which is
 *   all ten presets bar two.
 * - **Anti-aliasing.** The original softens rings by camera distance, tuned for
 *   a scene measured in metres; this app measures in millimetres, where that
 *   same expression washes the texture out completely. Replaced with a screen
 *   derivative, which is what the blur was approximating and is scale-free.
 * - **Pore LOD dropped** for the same reason — `cellSize / (|viewPos| * 10)` is
 *   zero at any distance expressed in mm.
 *
 * Every one of these is noted again where it happens in the shader below.
 */

// ---------------------------------------------------------------------------
// Object space -> texture space
// ---------------------------------------------------------------------------

/**
 * Which part axis lands on the texture's Z, which is the log's axis.
 *
 * Each is a cyclic permutation, so each is a rotation — a reflection here would
 * mirror the figure, which on a symmetric texture is invisible but on the end
 * grain of a piece next to its mirror twin is not.
 */
const AXIS_PERMUTATION: Record<GrainAxis, number[]> = {
  // (x, y, z) -> (y, z, x): the part's X becomes the length of the log
  x: [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1],
  // (x, y, z) -> (z, x, y)
  y: [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
  z: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
};

/**
 * The matrix the shader multiplies the object-space position by.
 *
 * Three things in one: turn the part so its grain axis is the log's axis, shrink
 * millimetres to texture units, and slide the piece to wherever in the log it
 * was cut from. Composed here rather than passed as three separate uniforms
 * because it is one transform and the shader has no business knowing it was
 * assembled from parts.
 */
export function woodMatrix(params: WoodParams): THREE.Matrix4 {
  const p = sanitizeWoodParams(params);
  const offset = seedOffset(p.seed);
  const s = 1 / p.grainScale;

  const permutation = new THREE.Matrix4().fromArray(AXIS_PERMUTATION[p.grainAxis]).transpose();
  return new THREE.Matrix4()
    .makeTranslation(p.pith[0] + offset[0], p.pith[1] + offset[1], offset[2])
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(permutation);
}

// ---------------------------------------------------------------------------
// The shader
// ---------------------------------------------------------------------------

const WOOD_COMMON = /* glsl */ `
uniform mat4  uWoodMatrix;
uniform vec3  uWoodDark;
uniform vec3  uWoodLight;
uniform float uWoodCenterSize;
uniform float uWoodLargeWarpScale;
uniform float uWoodLargeGrainStretch;
uniform float uWoodSmallWarpStrength;
uniform float uWoodSmallWarpScale;
uniform float uWoodFineWarpStrength;
uniform float uWoodFineWarpScale;
uniform float uWoodRingThickness;
uniform float uWoodRingBias;
uniform float uWoodRingSizeVariance;
uniform float uWoodRingVarianceScale;
uniform float uWoodBarkThickness;
uniform float uWoodGrainContrast;
uniform float uWoodSplotchScale;
uniform float uWoodSplotchIntensity;
uniform float uWoodCellScale;
uniform float uWoodCellSize;
uniform float uWoodPoreIntensity;
uniform float uWoodDarken;

uniform float uWoodRelief;
uniform float uWoodGlossVariance;

varying vec3 vWoodObjectPosition;

const float WOOD_TAU = 6.283185307179586;

/**
 * The surface, as one number, left behind by the last call to woodColor().
 *
 * 1 is earlywood — the pale, open, spring growth, which stands slightly proud
 * of a planed board because it is softer and the plane rides over it, and which
 * scatters light because it is porous. 0 is latewood and the open pores: dense,
 * dark, sunk, and glossy.
 *
 * A global rather than an out-parameter because the colour and the two surface
 * terms are consumed at three different points in three.js's fragment shader
 * (map, roughness, normal) and there is nowhere to thread a value between them.
 * It is written once per fragment, before either reader runs.
 */
float gWoodField = 1.0;

// --- noise -----------------------------------------------------------------

// [0,1] hash, straight from the original's WGSL helper — the pore layer's
// jitter has to match it or the cell sizes stop meaning what the presets say.
vec3 woodHash01(vec3 p) {
  vec3 p3 = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

vec3 woodHashGradient(vec3 p) {
  vec3 q = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                dot(p, vec3(269.5, 183.3, 246.1)),
                dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(q) * 43758.5453123);
}

// Perlin gradient noise, scaled to roughly [-1, 1]. Stands in for MaterialX's
// mx_noise_float; see the header for what that costs.
float woodNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = dot(woodHashGradient(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));
  float n100 = dot(woodHashGradient(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(woodHashGradient(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(woodHashGradient(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(woodHashGradient(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(woodHashGradient(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(woodHashGradient(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(woodHashGradient(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  return clamp(mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z) * 1.4, -1.0, 1.0);
}

// Three decorrelated samples. The original's mx_noise_vec3 is one call; the
// large offsets here are only there to stop the components moving together,
// which would collapse the warp onto a diagonal.
vec3 woodNoise3(vec3 p) {
  return vec3(
    woodNoise(p),
    woodNoise(p + vec3(37.19, 11.73, 91.31)),
    woodNoise(p + vec3(-63.41, 77.07, 24.59))
  );
}

// Smooth voronoi, ported from the original's WGSL. 27 taps, which is the whole
// cost of the pore layer — hence the uniform test that skips it, below.
float woodVoronoi(vec3 x, float smoothness, float randomness) {
  vec3 cell = floor(x);
  vec3 f = fract(x);

  float res = 0.0;
  float totalWeight = 0.0;
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 b = vec3(float(i), float(j), float(k));
        vec3 r = b - f + woodHash01(cell + b) * randomness;
        float d = length(r);
        float w = exp(-d * d / max(smoothness * smoothness, 0.001));
        res += d * w;
        totalWeight += w;
      }
    }
  }
  if (totalWeight > 0.0) res /= totalWeight;
  return smoothstep(0.0, 1.0, res);
}

// --- the texture -----------------------------------------------------------

// Clamped linear remap. The original's version clamps with
// max(min(x, toMax), toMin), which is wrong when toMax < toMin; clamping the
// interpolant instead is right in both directions.
float woodMapRange(float x, float fromMin, float fromMax, float toMin, float toMax) {
  float t = (x - fromMin) / max(fromMax - fromMin, 1e-6);
  return toMin + clamp(t, 0.0, 1.0) * (toMax - toMin);
}

/**
 * Push the rings about, radially.
 *
 * The displacement is along the radial direction in XY only, so the result has
 * no Z: after the first call the log's axis is gone and the pattern is purely a
 * function of where you are *across* the log. What the axis contributed is the
 * noise it seeded on the way through — which is exactly the grain drifting
 * slowly along the length of the board.
 */
vec3 woodSpaceWarp(vec3 p, float warpStrength, float xyScale, float zScale) {
  vec3 scaled = vec3(xyScale, xyScale, zScale) * p;
  vec3 n = woodNoise3(scaled * 2.4) * 0.5 * warpStrength;
  vec2 xy = p.xy;
  float len = length(xy);
  // dead on the pith there is no radial direction; normalising would be a
  // divide by zero and the bullseye would come out as a NaN hole
  vec2 dir = len > 1e-6 ? xy / len : vec2(0.0);
  return vec3(xy + n.xy * dir, 0.0);
}

/**
 * Annual rings at a radius, anti-aliased.
 *
 * fwidth() on the ring *coordinate* rather than on the finished profile: the
 * profile has a fract() in it, and a derivative taken across that seam reports
 * a whole ring's worth of change in one pixel and draws a bright line down the
 * middle of the board once per ring.
 */
float woodRings(float radius, float ringFreq, float ringBias, float ringSizeVariance,
                float ringVarianceScale, float barkThickness, float contrast) {
  float variance = woodNoise(vec3(radius * ringVarianceScale)) * 0.5 + 0.5;
  float coord = (variance * ringSizeVariance + radius) * ringFreq;
  float rings = fract(coord) * barkThickness;

  float sharp = min(woodMapRange(rings, 0.0, ringBias, 0.0, 1.0),
                    woodMapRange(rings, ringBias, 1.0, 1.0, 0.0));

  // rings crossed per pixel, and from it how wide the profile's own ramp is on
  // screen — that width is the smoothstep's blur radius
  float perPixel = fwidth(coord);
  float ramp = perPixel * barkThickness / max(ringBias, 1e-3);
  float blur = clamp(ramp * 0.7, 0.02, 1.0);
  float soft = smoothstep(-blur, blur, sharp - 0.5);

  // past roughly one ring per pixel there is nothing left to resolve, and
  // drawing it anyway is where a beam seen end-on turns into crawling moire
  soft = mix(soft, 0.5, clamp(perPixel * 1.5, 0.0, 1.0));

  return mix(1.0 - contrast, 1.0, soft);
}

// The broad blotches that make one board not look like the next one along.
float woodDetail(vec3 warp, vec3 p, float radius, float splotchScale) {
  float radial = clamp(atan(warp.y, warp.x) / WOOD_TAU + 0.5, 0.0, 1.0) * WOOD_TAU * 3.0;
  vec3 combined = vec3(sin(radial), radius, cos(radial) * p.z);
  return woodNoise(vec3(0.1, 1.19, 0.05) * combined * splotchScale) * 0.5 + 0.5;
}

// Pores and rays. cellSize is used as given: the original divides it by the
// camera distance, which in a scene measured in mm rounds every pore away.
float woodCells(vec3 mainWarp, float cellScale, float cellSize) {
  vec3 warp = woodSpaceWarp(mainWarp * (cellScale / 50.0), cellScale / 1000.0, 0.1, 1.77);
  float cells = woodVoronoi(vec3(warp.xy * 75.0, 0.0), 0.5, 1.0);
  return woodMapRange(cells, cellSize, cellSize + 0.21, 0.0, 1.0);
}

vec3 woodSoftLight(float t, vec3 base, vec3 blend) {
  vec3 one = vec3(1.0);
  vec3 screen = one - (one - blend) * (one - base);
  return (1.0 - t) * base + t * ((one - base) * blend * base + base * screen);
}

vec3 woodColor(vec3 objectPosition) {
  vec3 p = (uWoodMatrix * vec4(objectPosition, 1.0)).xyz;

  float center = uWoodCenterSize * min(length(p.xy), 1.0);
  vec3 mainWarp = woodSpaceWarp(
    woodSpaceWarp(p, center, uWoodLargeWarpScale, uWoodLargeGrainStretch),
    uWoodSmallWarpStrength, uWoodSmallWarpScale, 0.17);
  vec3 detailWarp = woodSpaceWarp(mainWarp, uWoodFineWarpStrength, uWoodFineWarpScale, 0.17);

  float radius = length(detailWarp);
  float rings = woodRings(radius, 1.0 / uWoodRingThickness, uWoodRingBias,
                          uWoodRingSizeVariance, uWoodRingVarianceScale,
                          uWoodBarkThickness, uWoodGrainContrast);

  vec3 color = mix(uWoodDark, uWoodLight, rings);
  gWoodField = rings;

  // a uniform branch, so it costs one test per draw rather than per pixel —
  // and skipping it takes 27 hash evaluations out of the fragment
  if (uWoodPoreIntensity > 0.001) {
    float pores = woodCells(mainWarp, uWoodCellScale, uWoodCellSize);

    // Faded out once a pore is down to about a pixel across.
    //
    // This is what the black speckle on the timber actually was, and it is worth
    // being precise about because it looks like an anti-aliasing problem and is
    // not one: a pore in red oak is a bit under a millimetre, the cell scale puts
    // them at 1/cellScale of a texture unit, and at arm's length that is roughly
    // one screen pixel each. A feature one pixel wide is not smoothed by any
    // amount of anti-aliasing — MSAA resolves *edges between triangles* and SMAA
    // resolves *edges in the finished image*, and this is neither. It is the
    // texture being asked a question finer than the screen can answer, and the
    // only fix is to stop asking it.
    float poreSize = 1.0 / max(uWoodCellScale, 1.0);
    float texel = max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z)));
    float poreFade = 1.0 - smoothstep(poreSize * 0.4, poreSize * 1.6, texel);

    color = woodSoftLight(uWoodPoreIntensity * poreFade, color, vec3(pores));
    // A pore is a hole. It cuts into whatever the ring underneath was doing
    // rather than averaging with it, which is why this is a min and not a mix —
    // an open-pored oak is a ring pattern with pits punched through it.
    // Multiplied rather than min'd, and at a third of the strength it has in the
    // colour. A min is a fold in the field - the two surfaces meet at a crease
    // with no slope on one side and all of it on the other - and every one of
    // those creases came back as a hard blotch once the field started driving a
    // normal as well as a colour. A pore is also a shallow pit rather than a
    // crater: it is visible because it is dark, not because it is deep.
    gWoodField *= mix(1.0, pores, uWoodPoreIntensity * poreFade * 0.3);
  }

  float detail = woodDetail(detailWarp, p, radius, uWoodSplotchScale);
  // splotchIntensity runs past 1 in three of the presets, which extrapolates
  // the blend — the clamp is what keeps that from going negative
  return clamp(woodSoftLight(uWoodSplotchIntensity, color, vec3(detail)), 0.0, 1.0) * uWoodDarken;
}

/**
 * The grain, as relief, without a normal map or a single UV.
 *
 * The height field is {@link gWoodField}, and the trick is that its slope costs
 * nothing to find: the GPU shades in 2×2 quads, so "dFdx"/"dFdy" of a value
 * already computed give its screen-space gradient for free. Converting that to a
 * surface gradient needs the surface position's own derivatives, which is the
 * standard Mikkelsen construction and is what three.js's own "bumpMap" does —
 * this is that, with the height coming from a function instead of a texture.
 *
 * Doing it this way is what keeps the whole wood pipeline UV-free. Nothing in
 * this app generates texture coordinates; every solid that reaches a view is a
 * position-only buffer out of "simplifySolid" or "mergeGeometries", and a normal
 * map would need the one thing none of them has.
 *
 * The relief is scaled by how far away the fragment is, in the crudest possible
 * way: a millimetre of grain that is a tenth of a pixel across is not relief,
 * it is noise, and left in it sparkles as the camera turns.
 */
vec3 woodPerturbNormal(vec3 normal, vec3 surfacePosition, float height) {
  vec3 dpdx = dFdx(surfacePosition);
  vec3 dpdy = dFdy(surfacePosition);
  float dhdx = dFdx(height);
  float dhdy = dFdy(height);

  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);

  // one screen pixel, in surface units: past a fraction of a millimetre the
  // grain is finer than the pixel and there is nothing left to shade
  float pixel = max(length(dpdx), length(dpdy));
  float fade = 1.0 - smoothstep(1.5, 6.0, pixel);

  vec3 gradient = sign(det) * (dhdx * r1 + dhdy * r2) * uWoodRelief * fade;

  // The backstop, and the whole reason the grain stopped sparkling.
  //
  // The ring field is a sawtooth: it runs 0 to 1 across the pale band and drops
  // back over the dark one in a fraction of a millimetre. Zoom in far enough and
  // that drop lands inside a single pixel, the measured slope goes to something
  // enormous, and the normal tips past the surface's own horizon - N dot L turns
  // negative and the fragment goes black. On a planed board that is not grain,
  // it is a row of dots along every ring, which is exactly what it looked like.
  //
  // 0.75 is a thirty-seven-degree slope. Far steeper than any planed timber and
  // still, unmistakably, a surface.
  float limit = abs(det) * 0.75;
  float steep = length(gradient);
  if (steep > limit) gradient *= limit / steep;

  return normalize(abs(det) * normal - gradient);
}
`;

// ---------------------------------------------------------------------------
// The material
// ---------------------------------------------------------------------------

/**
 * How steeply the grain rises, as a surface gradient on raw timber.
 *
 * The field runs 0 to 1 across a ring at a pitch of about 4.7 mm. This started
 * at 1.2, which reads correctly from across a room and turns to corduroy with
 * your nose against it — a planed board has grain you can see and almost none you
 * can feel, and at arm's length the second one is what shows.
 */
const RELIEF = 0.62;

/** How far the roughness swings between latewood and earlywood, as a fraction. */
const GLOSS_VARIANCE = 0.42;

type WoodUniforms = Record<string, THREE.IUniform>;

function makeUniforms(): WoodUniforms {
  return {
    uWoodMatrix: { value: new THREE.Matrix4() },
    uWoodDark: { value: new THREE.Color() },
    uWoodLight: { value: new THREE.Color() },
    uWoodCenterSize: { value: 1 },
    uWoodLargeWarpScale: { value: 0 },
    uWoodLargeGrainStretch: { value: 0 },
    uWoodSmallWarpStrength: { value: 0 },
    uWoodSmallWarpScale: { value: 0 },
    uWoodFineWarpStrength: { value: 0 },
    uWoodFineWarpScale: { value: 0 },
    uWoodRingThickness: { value: 1 / 34 },
    uWoodRingBias: { value: 0.1 },
    uWoodRingSizeVariance: { value: 0 },
    uWoodRingVarianceScale: { value: 1 },
    uWoodBarkThickness: { value: 0.5 },
    uWoodGrainContrast: { value: 0.5 },
    uWoodSplotchScale: { value: 1 },
    uWoodSplotchIntensity: { value: 0.5 },
    uWoodCellScale: { value: 800 },
    uWoodCellSize: { value: 0.2 },
    uWoodPoreIntensity: { value: 0.407 },
    uWoodDarken: { value: 1 },
    uWoodRelief: { value: 0 },
    uWoodGlossVariance: { value: 0 },
  };
}

/**
 * A `MeshPhysicalMaterial` whose diffuse colour comes from the solid wood
 * texture rather than from `color`.
 *
 * Physical rather than standard because a finish is a clearcoat, and clearcoat
 * over a rough base is precisely what varnish on timber is.
 *
 * `setParams` updates uniforms in place. That matters: these are driven by
 * sliders, and rebuilding the material per frame would recompile the program
 * per frame. The one change that *does* need a recompile — a finish appearing
 * or disappearing, since three only emits the clearcoat chunks when clearcoat
 * is non-zero at compile time — is detected and flagged.
 */
export class WoodMaterial extends THREE.MeshPhysicalMaterial {
  readonly isWoodMaterial = true;
  readonly woodUniforms: WoodUniforms = makeUniforms();

  constructor(params: WoodParams) {
    super({
      // white: the texture is written straight into diffuseColor, and any tint
      // here would multiply the species' own colours
      color: 0xffffff,
      metalness: 0,
      roughness: 0.9,
      // the same half-unit nudge the editor's solid fill uses, so the edge
      // overlay drawn on the surface does not z-fight with it
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.setParams(params);
  }

  setParams(raw: WoodParams): void {
    const params = sanitizeWoodParams(raw);
    const u = this.woodUniforms;

    u.uWoodMatrix.value = woodMatrix(params);
    (u.uWoodDark.value as THREE.Color).set(params.darkGrainColor);
    (u.uWoodLight.value as THREE.Color).set(params.lightGrainColor);
    u.uWoodCenterSize.value = params.centerSize;
    u.uWoodLargeWarpScale.value = params.largeWarpScale;
    u.uWoodLargeGrainStretch.value = params.largeGrainStretch;
    u.uWoodSmallWarpStrength.value = params.smallWarpStrength;
    u.uWoodSmallWarpScale.value = params.smallWarpScale;
    u.uWoodFineWarpStrength.value = params.fineWarpStrength;
    u.uWoodFineWarpScale.value = params.fineWarpScale;
    u.uWoodRingThickness.value = params.ringThickness;
    u.uWoodRingBias.value = params.ringBias;
    u.uWoodRingSizeVariance.value = params.ringSizeVariance;
    u.uWoodRingVarianceScale.value = params.ringVarianceScale;
    u.uWoodBarkThickness.value = params.barkThickness;
    u.uWoodGrainContrast.value = params.grainContrast;
    u.uWoodSplotchScale.value = params.splotchScale;
    u.uWoodSplotchIntensity.value = params.splotchIntensity;
    u.uWoodCellScale.value = params.cellScale;
    u.uWoodCellSize.value = params.cellSize;
    u.uWoodPoreIntensity.value = params.poreIntensity;
    u.uWoodDarken.value = params.clearcoatDarken;

    // How much grain there is to feel, and how much of it a finish has filled.
    // Raw timber off a plane has the softer rings standing a tenth of a
    // millimetre proud; a wiped oil leaves most of that; a built gloss is a
    // levelled film with the grain underneath it and nothing on top. The
    // clearcoat's own roughness is the best available proxy for how many coats
    // went on, which is exactly what decides the answer.
    const filled = params.clearcoat > 0 ? 0.15 + 0.6 * params.clearcoatRoughness : 1;
    u.uWoodRelief.value = RELIEF * filled;
    u.uWoodGlossVariance.value = GLOSS_VARIANCE * (1 - 0.5 * params.clearcoat);

    const hadClearcoat = this.clearcoat > 0;
    this.roughness = params.roughness;
    this.clearcoat = params.clearcoat;
    this.clearcoatRoughness = params.clearcoatRoughness;
    if (hadClearcoat !== params.clearcoat > 0) this.needsUpdate = true;
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.woodUniforms);

    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec3 vWoodObjectPosition;\nvoid main() {")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vWoodObjectPosition = position;"
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${WOOD_COMMON}\nvoid main() {`)
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\n  diffuseColor.rgb = woodColor(vWoodObjectPosition);"
      )
      // Latewood is denser than earlywood and takes a burnish; earlywood is open
      // and scatters. On a raw board that difference is most of what tells you it
      // is wood and not brown plastic, and it survives a finish — a wiped oil
      // sinks into the soft rings and sits on the hard ones.
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
  roughnessFactor = clamp(
    roughnessFactor * mix(1.0 - uWoodGlossVariance, 1.0 + uWoodGlossVariance, gWoodField),
    0.02, 1.0);`
      )
      // After the map chunk, not before: this perturbs whatever normal the rest
      // of the pipeline settled on, and on a flat-shaded solid that is the face
      // normal.
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  if (uWoodRelief > 0.0) {
    normal = woodPerturbNormal(normal, -vViewPosition, gWoodField);
  }`
      );
  }

  // Without this every WoodMaterial would share one compiled program with every
  // plain MeshPhysicalMaterial in the app — three keys the cache on the built-in
  // parameters, which onBeforeCompile is not one of.
  override customProgramCacheKey(): string {
    return "wood-solid-texture";
  }
}
