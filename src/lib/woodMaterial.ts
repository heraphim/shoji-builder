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
uniform float uWoodFilmRelief;
uniform float uWoodGlossVariance;

varying vec3 vWoodObjectPosition;

const float WOOD_TAU = 6.283185307179586;

/**
 * The narrowest a ring boundary may be, as a fraction of a ring.
 *
 * See {@link woodRings}. 0.2 puts the finished edge at 28% of a ring, which is
 * about what the earlywood-to-latewood transition looks like on real timber —
 * a gradient, not a line. Raising it softens the grain at close range without
 * touching how it reads across a room; lowering it back to 0 restores the
 * one-pixel edge this constant exists to prevent.
 */
const float RING_SOFTNESS = 0.2;

/**
 * The steepest the *timber's* own surface may turn inside one pixel, as a
 * gradient.
 *
 * 0.75 is a thirty-seven-degree slope. Far steeper than any planed board and
 * still, unmistakably, a surface — which is all this one has to be, because
 * what reads the timber's normal is a lobe nearly ten degrees wide and a
 * diffuse term that does not care.
 */
const float TIMBER_SLOPE = 0.75;

/**
 * The steepest the *film* may turn, which is six times less, and the reason the
 * ring boundaries stopped coming back as a field of white specks.
 *
 * These two started as one constant and that was the bug. The ring field is a
 * sawtooth and its drop is a cliff; the timber can wear a cliff at thirty-seven
 * degrees because nothing reading it is sharper than the cliff. A varnish is
 * the opposite case in every respect — it is a mirror a couple of degrees wide,
 * so a normal allowed to tip thirty-seven degrees between one pixel and the next
 * will, somewhere along every ring, happen to point at a lamp and return the
 * whole of it. That is what the stipple was: not the pores, not the
 * anti-aliasing, and not something a wider lobe could reach, because the tilt
 * that finds the light is an order of magnitude larger than the lobe is.
 *
 * The number is the physics of the film rather than a tuning. A finish is a
 * liquid that levelled and then set: it cannot hold a cliff, and what it leaves
 * over one is a slope of a few degrees. 0.12 is seven of them — still visibly
 * telegraphing the grain into the reflection, which is the whole point of
 * {@link FILM_RELIEF}, and no longer able to mirror a bulb from a single pixel.
 */
const float FILM_SLOPE = 0.12;

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

/**
 * The other surface term: how worn this patch of the board is, at the scale of a
 * hand rather than of a ring.
 *
 * A finish is not one number across a whole top. It is thicker where the brush
 * loaded and thinner where it dragged, it is polished where things are put down
 * and dull where they are not, and none of that has anything to do with the
 * grain underneath it. Without a term at this scale every board in the room came
 * back with the identical even sheen, which is the look of a material setting
 * rather than of a finish.
 */
float gWoodPatina = 0.5;

/** How much texture space one screen pixel covers, at this fragment. */
float gWoodTexel = 0.0;

/**
 * How hard the varnish's normal is turning inside this one pixel.
 *
 * Left behind by the clearcoat's perturbation for the roughness to read, and it
 * exists because the two cannot be done in one place: the normal is settled
 * three chunks before the material's roughness is assembled, and by then the
 * derivatives that measured it are gone.
 */
float gWoodFilmVariance = 0.0;

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

  /**
   * The edge is never allowed to be as thin as a pixel.
   *
   * With the ramp taken straight off perPixel, the blur scaled with the pixel
   * and the barkThickness / ringBias factor cancelled against the profile's own
   * slope, so the finished edge came out 1.4 *pixels* wide for every species at
   * every zoom. That is a hard edge by definition, and a hard edge lying nearly
   * along the pixel rows — which a ring on a flat-sawn face does — is a
   * staircase. It was the one artefact that got worse the closer you looked,
   * because everything around it resolved while the edge stayed one pixel.
   *
   * Flooring the pixel term instead pins the edge to a fraction of a *ring*, so
   * it widens as the ring does. It engages when perPixel drops under 0.2, which
   * is when a ring spans more than five pixels; below that the measured term is
   * larger and takes over on its own, so the anti-aliasing that keeps a distant
   * beam from crawling is untouched.
   *
   * How wide the edge actually gets is then capped by the profile, not by this
   * constant: the transition happens on the rising limb, which is only
   * ringBias / barkThickness of a ring wide. On a species whose latewood is a
   * tenth of a ring — walnut, teak, cedar — that limb is narrow enough that a
   * two-pixel edge needs upwards of thirty pixels per ring, which no viewing
   * distance in this app supplies. Those stay hard, and the lever for them is
   * ringBias rather than anything here.
   */
  float ramp = max(perPixel, RING_SOFTNESS) * barkThickness / max(ringBias, 1e-3);
  // The ceiling is 0.4, not the 1.0 this was written with.
  //
  // blur is the half-width of a smoothstep centred on sharp - 0.5, and sharp
  // runs 0 to 1, so the input only ever spans +/-0.5. Any blur past that cannot
  // reach either end and the ring comes back grey: at 1.0 the narrow-latewood
  // species — walnut, teak, cedar, whose ringBias is under a tenth — kept only
  // about two thirds of their black-to-white range. 0.4 is the widest blur that
  // still resolves the whole of it, so it is a ceiling with nothing behind it.
  float blur = clamp(ramp * 0.7, 0.02, 0.4);
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
  gWoodTexel = max(fwidth(p.x), max(fwidth(p.y), fwidth(p.z)));

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
  // two turns of noise a hand's width apart, which is the size a wear pattern is
  gWoodPatina = clamp(woodNoise(p * 2.3) * 0.6 + woodNoise(p * 7.1) * 0.25 + 0.5, 0.0, 1.0);

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
 *
 * "relief" is a parameter rather than the uniform it used to read, because this
 * is called twice against two different surfaces: the timber, and the film of
 * varnish lying on it. They are not equally rough and the second one is the
 * whole reason a polished board looks polished. See "uWoodFilmRelief".
 *
 * "maxSlope" is a parameter for the same reason and it is the more important of
 * the two. See {@link TIMBER_SLOPE} and {@link FILM_SLOPE}.
 */
vec3 woodPerturbNormal(vec3 normal, vec3 surfacePosition, float height, float relief,
                       float maxSlope) {
  vec3 dpdx = dFdx(surfacePosition);
  vec3 dpdy = dFdy(surfacePosition);
  float dhdx = dFdx(height);
  float dhdy = dFdy(height);

  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);

  // A triangle that covers no area on screen.
  //
  // Everything below builds a frame out of the two screen derivatives of
  // position, and on a collapsed triangle those are parallel: the determinant
  // is zero and the normalise at the bottom returns NaN. It matters more than a
  // stray pixel would, because a NaN travels — anything that averages it with
  // its neighbours afterwards, a bloom's mip chain most of all, carries it
  // across the frame.
  //
  // Nothing here had this until the low-poly style started snapping vertices to
  // a lattice, which welds triangles down to nothing and leaves slivers of them
  // still rastering. The surface has no relief here because it has no extent
  // here, so hand back the normal it came with.
  if (abs(det) < 1e-12) return normal;

  // Faded against the **ring pitch** rather than against a fixed number of
  // millimetres.
  //
  // This was a constant, and a constant cannot be right: the whole point of the
  // grain scale is that a board can be coarse or fine, and a fade tuned for a
  // 20 mm ring leaves a 2 mm one being shaded from a field that changes twice
  // per pixel. Measuring the pixel in texture space and comparing it to the
  // pitch makes the relief switch itself off exactly when there is no longer a
  // ring to see, whatever scale the timber was cut at.
  float fade = 1.0 - smoothstep(uWoodRingThickness * 0.35, uWoodRingThickness * 1.4, gWoodTexel);

  vec3 gradient = sign(det) * (dhdx * r1 + dhdy * r2) * relief * fade;

  // The backstop, and the whole reason the grain stopped sparkling.
  //
  // The ring field is a sawtooth: it runs 0 to 1 across the pale band and drops
  // back over the dark one in a fraction of a millimetre. Zoom in far enough and
  // that drop lands inside a single pixel, the measured slope goes to something
  // enormous, and the normal tips past the surface's own horizon - N dot L turns
  // negative and the fragment goes black. On a planed board that is not grain,
  // it is a row of dots along every ring, which is exactly what it looked like.
  float limit = abs(det) * maxSlope;
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

/**
 * How much the varnish itself follows the grain under it, as a surface gradient.
 *
 * This is not the same surface as {@link RELIEF} and that is the entire point.
 * A clearcoat in `MeshPhysicalMaterial` is a second interface with its own
 * normal, and three.js sets that normal to the *unperturbed* geometric one —
 * so the grain was reaching the diffuse and the base specular and never once
 * reaching the mirror lobe on top. A gloss finish is almost nothing but that
 * lobe, which is why a polished board came out looking like a sheet of brown
 * plastic: it was, optically, a perfectly flat film.
 *
 * A real film is not flat. It is poured onto an uneven surface and it levels
 * only partly, and finishers have a word for what is left — the grain
 * *telegraphs* through. On an open-pored oak you can read the pores in the
 * reflection of a window across the room.
 *
 * How much survives depends on how much film there is, and `clearcoatRoughness`
 * is the same proxy for that used a few lines below: a matte lacquer is one thin
 * coat that follows everything, a built gloss is several that have been cut back
 * level. But the floor is high — a bit under half — because levelling and
 * *looking* level are opposites here. A mirror magnifies the shallowest slope,
 * so the flatter the film gets, the more plainly what is left of the grain shows
 * in it. Take the floor to zero and a gloss goes back to brown plastic; take it
 * to one and it reads as orange peel, which is a fault rather than a finish.
 */
const FILM_RELIEF = 0.24;

/**
 * How far the roughness swings between latewood and earlywood, as a fraction.
 *
 * Also drives the broader wear variation at 70% of this, so raising it makes a
 * board less even in both senses at once — which is the honest coupling: the
 * thing that stops a finish being uniform is not two independent effects.
 */
const GLOSS_VARIANCE = 0.58;

/**
 * How big the lights in this app are, expressed as the roughness that would
 * spread a highlight by the same amount.
 *
 * Every light in the app is a delta light — `directionalLight` and
 * `pointLight`, see `SceneLights` and `ShowcaseScene` — which means it has no
 * size at all. A highlight is the reflected *image* of the source, so a source
 * of no size reflects as a point, spread only by the material's own lobe. On a
 * gloss finish that lobe is 0.37° across: the varnish was mirroring something
 * sharper than the sun, at a peak radiance six hundred times the bare timber's,
 * and it landed as a hard white blob rather than as the long soft streak a
 * board under a window or a bulb actually shows.
 *
 * The stipple in it was the same fact seen from the other side. A lobe that
 * narrow is decided by a normal wobble of six thousandths of a radian, which is
 * less than the grain in the film puts across one pixel — so pixels fell in and
 * out of the highlight and it came back as a field of dots. Nothing was wrong
 * with the anti-aliasing below; it was measuring a real variance against a lobe
 * no variance could be small enough for.
 *
 * 0.25 is a 2.3° lobe, which is about what a bulb across a room subtends, and
 * it drops the peak by a factor of forty. Added in quadrature rather than as a
 * floor, and that is the point rather than a nicety: what a highlight's width
 * is, is the material's lobe convolved with the source's disc, and widths under
 * convolution add as squares. A matte film is already twenty times wider than
 * any source in the room and is left alone by the same arithmetic that opens a
 * gloss one right up.
 *
 * This is the cheap half of the real answer. The expensive half is giving the
 * clearcoat an environment to reflect instead of four points, which is what a
 * gloss finish is mostly made of and what this constant is standing in for.
 */
const SOURCE_ROUGHNESS = 0.25;

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
    uWoodFilmRelief: { value: 0 },
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

    // And how much of it the film's own surface still has. Zero without a film,
    // because then there is no second interface to give relief to. See
    // {@link FILM_RELIEF} for why the floor is so much higher than `filled`'s.
    u.uWoodFilmRelief.value =
      params.clearcoat > 0 ? FILM_RELIEF * (0.45 + 0.55 * params.clearcoatRoughness) : 0;
    u.uWoodGlossVariance.value = GLOSS_VARIANCE * (1 - 0.5 * params.clearcoat);

    const hadClearcoat = this.clearcoat > 0;
    this.roughness = params.roughness;
    this.clearcoat = params.clearcoat;
    // The authored roughness is what the finish is; what reaches the renderer is
    // that convolved with how big the lights are. See {@link SOURCE_ROUGHNESS}.
    // Only here — `filled` and the film relief above read the authored value on
    // purpose, because those are asking how many coats went on, and the size of
    // a lamp on the other side of the room has nothing to say about that.
    this.clearcoatRoughness = Math.min(
      1,
      Math.hypot(params.clearcoatRoughness, SOURCE_ROUGHNESS)
    );
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
    roughnessFactor
      * mix(1.0 - uWoodGlossVariance, 1.0 + uWoodGlossVariance, gWoodField)
      * mix(1.0 - uWoodGlossVariance * 0.7, 1.0 + uWoodGlossVariance * 0.7, gWoodPatina),
    0.02, 1.0);`
      )
      // After the map chunk, not before: this perturbs whatever normal the rest
      // of the pipeline settled on, and on a flat-shaded solid that is the face
      // normal.
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
  if (uWoodRelief > 0.0) {
    normal = woodPerturbNormal(normal, -vViewPosition, gWoodField, uWoodRelief, TIMBER_SLOPE);
  }`
      )
      // The varnish, which is a second surface and needs telling so.
      //
      // three.js opens the clearcoat with `clearcoatNormal = nonPerturbedNormal`
      // — the geometric normal, deliberately untouched by anything the base
      // normal has had done to it, because the usual reason to perturb a base
      // normal is a bump map of a texture *under* the film. Here it is the grain,
      // and the film sits on the grain rather than under it.
      //
      // So the same construction runs a second time at its own strength. It has
      // to be after this chunk and not before: the variable does not exist yet.
      .replace(
        "#include <clearcoat_normal_fragment_begin>",
        `#include <clearcoat_normal_fragment_begin>
#ifdef USE_CLEARCOAT
  if (uWoodFilmRelief > 0.0) {
    clearcoatNormal = woodPerturbNormal(clearcoatNormal, -vViewPosition, gWoodField, uWoodFilmRelief, FILM_SLOPE);
    vec3 filmDx = dFdx(clearcoatNormal);
    vec3 filmDy = dFdy(clearcoatNormal);
    gWoodFilmVariance = dot(filmDx, filmDx) + dot(filmDy, filmDy);
  }
#endif`
      )
      // What the wobble costs, paid back as roughness.
      //
      // A mirror sampled once per pixel over a normal that turns inside that
      // pixel does not average, it picks — so the grain that has just been put
      // into the film comes back as a field of white sparks that crawl when the
      // camera moves. The standard answer, and the one three itself uses on the
      // geometric normal a few lines above this: measure how far the normal
      // swings across the pixel and widen the lobe until it covers the swing.
      // A rougher clearcoat is what a surface that is not flat *is*.
      //
      // three's own version reads the unperturbed normal, which is flat here and
      // so contributes nothing — this is the same correction against the normal
      // that actually varies. Capped, because past a point it stops being
      // anti-aliasing and starts being a matte finish nobody asked for.
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoatRoughness = min(1.0, sqrt(
    material.clearcoatRoughness * material.clearcoatRoughness
      + min(2.0 * gWoodFilmVariance, 0.2)));
#endif`
      );
  }

  // Without this every WoodMaterial would share one compiled program with every
  // plain MeshPhysicalMaterial in the app — three keys the cache on the built-in
  // parameters, which onBeforeCompile is not one of.
  override customProgramCacheKey(): string {
    return "wood-solid-texture";
  }
}
