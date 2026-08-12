import * as THREE from "three";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";

/**
 * The one shader every drawn style is made of.
 *
 * Seven of the eight showcase styles are not photographs, and none of them is a
 * different *room* — the lamp is the same lamp, the nightstand is the same
 * nightstand, and what changes is the hand that drew them. So there is one
 * effect with a set of knobs rather than seven effects: an anime cel and a
 * sumi-e wash differ in how many tones they keep, how hard the line round a
 * shape is, and whether the paper shows through, and those are three numbers.
 *
 * Writing it as seven shaders would mean seven copies of the edge detector, and
 * the edge detector is the part that is actually difficult.
 *
 * ## What arrives here
 *
 * **Linear HDR, not a picture.** `EffectComposer` sets the renderer's tone
 * mapping to `NoToneMapping` for as long as it is mounted and does the sRGB
 * conversion in its own final pass, so `inputColor` is scene-referred radiance
 * with values well past 1 in the paper panels. Every one of the operations
 * below — posterising a tone, drawing a line at a contrast step, letting paper
 * show through the thin parts — is defined on a *print*, so the shader makes
 * one first: exposure, a tone curve, and a gamma, in that order. It hands back
 * linear because the pass after it expects to do the encoding.
 *
 * That is also where the styles get their exposure from. The realistic showcase
 * is a dark room photographed as a dark room; a painting of the same room is
 * lit by the painter, and `exposure` is the only lever that opens it up without
 * putting a light in the scene that nothing in the scene is emitting.
 */

/**
 * How the picture is drawn.
 *
 * Every field is a uniform, so a style change is a set of numbers rather than a
 * new program — the shader is compiled once and switching styles does not stall
 * on the driver.
 */
export interface PaintParams {
  /** Stops of light before the tone curve. 1 is the scene as metered. */
  exposure: number;
  /**
   * How many tones survive. 0 leaves the gradient alone.
   *
   * This is the single loudest thing about a drawn style: four bands is a
   * cartoon, six is a cel, and a wash is not banded at all.
   */
  bands: number;
  /** How soft the step between two bands is. 0 is a hard cel edge, 1 is none. */
  bandSoft: number;
  /** How dark the drawn line gets. 0 draws none. */
  ink: number;
  inkColor: string;
  /** The line's width, in pixels of a 1600-wide frame. */
  inkWidth: number;
  /** How much of the line comes from a step in *depth* — a silhouette or a crease. */
  inkFromDepth: number;
  /** ...and how much from a step in *tone* — a shadow edge, a change of colour. */
  inkFromLuma: number;
  /** How much the colour pools at the edge of a shape, as watercolour does. */
  bleed: number;
  /** How much of the sheet shows through the paint. */
  paper: number;
  /** The size of the paper's tooth, in pixels of a 1600-wide frame. */
  paperScale: number;
  /** What colour the sheet is — the white of the picture, and what `lift` lifts towards. */
  paperColor: string;
  /** How far the wash slides off the drawing, in pixels. Watercolour, and nothing else. */
  wobble: number;
  /** The size of that wander, in pixels of a 1600-wide frame. */
  wobbleScale: number;
  /** 0 takes all the colour out; past 1 pushes it. */
  saturation: number;
  /** A colour the whole picture is multiplied by — the palette the style is mixed from. */
  tint: string;
  /** How far the blacks come up towards the paper. A wash never reaches black. */
  lift: number;
  /** About the mid grey. Under 1 flattens, over 1 snaps. */
  contrast: number;
}

export const NO_PAINT: PaintParams = {
  exposure: 1,
  bands: 0,
  bandSoft: 0.5,
  ink: 0,
  inkColor: "#000000",
  inkWidth: 1.4,
  inkFromDepth: 1,
  inkFromLuma: 0.4,
  bleed: 0,
  paper: 0,
  paperScale: 2.2,
  paperColor: "#ffffff",
  wobble: 0,
  wobbleScale: 40,
  saturation: 1,
  tint: "#ffffff",
  lift: 0,
  contrast: 1,
};

/**
 * No backticks below: this is a template literal, and a backtick in a comment
 * ends the shader. The same rule `surfaces.ts` keeps, for the same reason.
 */
const FRAGMENT = /* glsl */ `
uniform float uExposure;
uniform float uBands;
uniform float uBandSoft;
uniform float uInk;
uniform vec3 uInkColor;
uniform float uInkWidth;
uniform float uInkDepth;
uniform float uInkLuma;
uniform float uBleed;
uniform float uPaper;
uniform float uPaperScale;
uniform vec3 uPaperColor;
uniform float uWobble;
uniform float uWobbleScale;
uniform float uSaturation;
uniform vec3 uTint;
uniform float uLift;
uniform float uContrast;

/**
 * One pixel of a 1600-wide frame, in pixels of this one.
 *
 * Every size in the parameters above is a size on the *picture* — a two-pixel
 * ink line, a paper tooth a couple of pixels across — and the frame is drawn at
 * anything from 1280 to 3840 across depending on the window and the device
 * pixel ratio. Without this the line on a retina laptop is half the line on a
 * phone, which is not a style, it is a bug that only shows on one machine.
 */
float pScale() {
  return max(resolution.x / 1600.0, 0.35);
}

float pLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float pHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float pNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x),
             mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float pFbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * pNoise(p);
    p *= 2.07;
    amplitude *= 0.5;
  }
  return sum;
}

/**
 * Where this pixel actually reads the picture from.
 *
 * A watercolour is two passes by two different means — a line, and colour
 * brushed near it — and the whole of what says *painted by hand* is that the
 * second one misses. So the sheet is sampled a little away from where the pixel
 * is, along a slow wander, and the shapes stop lining up with the geometry.
 *
 * Done by hand rather than through postprocessing's own UV hook, which is what
 * this was first written as and which the library refuses outright: an effect
 * that transforms its UVs cannot also be a convolution effect, and this one has
 * to be — the outline detector reads its neighbours. So the displacement is
 * applied to every read this shader makes instead, colour and depth alike,
 * which is also the only way the ink stays on the shape the paint went onto.
 *
 * The refusal is a **substring test over the shader source**, comment included.
 * Naming the hook anywhere in this file, even to say that it is not being used,
 * is enough to fail it — hence the circumlocution above, which is not style.
 */
vec2 pWander(vec2 uv) {
  if (uWobble <= 0.0) return uv;
  vec2 q = uv * resolution / max(uWobbleScale * pScale(), 1.0);
  vec2 drift = vec2(pFbm(q), pFbm(q + vec2(37.2, 11.9))) - 0.5;
  return uv + drift * uWobble * pScale() * texelSize;
}

/**
 * How much of a step there is at this pixel: in depth, and in tone.
 *
 * The depth term is the **second** difference and not the first. A floor
 * running away from the camera has an enormous first difference and no edge in
 * it at all, and every outline shader that compares a pixel with its neighbour
 * draws the floor. Comparing a pixel with the *average* of its two neighbours
 * cancels any surface of constant slope however steeply it is turned away, and
 * what is left is exactly what an outline is: a silhouette, or a crease.
 *
 * Divided by the distance, because the same physical step is a smaller depth
 * difference further off, and a line that fades out across the room is a line
 * that stops drawing the far side of the bed.
 *
 * The tone term is a plain gradient of luminance, relative to the local level
 * so that it means the same thing in the lit part of the picture as in the
 * dark. It is what catches a shadow's edge and the boundary between two colours
 * of the same depth — neither of which is a silhouette, and both of which an
 * inked drawing has a line at.
 */
vec2 pEdges(vec2 uv) {
  vec2 w = texelSize * max(uInkWidth, 0.5) * pScale();

  float z0 = getViewZ(readDepth(uv));
  float zl = getViewZ(readDepth(uv - vec2(w.x, 0.0)));
  float zr = getViewZ(readDepth(uv + vec2(w.x, 0.0)));
  float zd = getViewZ(readDepth(uv - vec2(0.0, w.y)));
  float zu = getViewZ(readDepth(uv + vec2(0.0, w.y)));
  float curve = abs(zl + zr - 2.0 * z0) + abs(zd + zu - 2.0 * z0);
  float depthEdge = curve / max(abs(z0) * 0.02, 1.0);

  float l0 = pLuma(texture2D(inputBuffer, uv).rgb);
  float ll = pLuma(texture2D(inputBuffer, uv - vec2(w.x, 0.0)).rgb);
  float lr = pLuma(texture2D(inputBuffer, uv + vec2(w.x, 0.0)).rgb);
  float ld = pLuma(texture2D(inputBuffer, uv - vec2(0.0, w.y)).rgb);
  float lu = pLuma(texture2D(inputBuffer, uv + vec2(0.0, w.y)).rgb);
  float lumaEdge = (abs(ll - lr) + abs(ld - lu)) / (l0 + 0.12);

  return vec2(depthEdge, lumaEdge);
}

/**
 * A tone, quantised to uBands of them.
 *
 * The boundary is a smoothstep rather than a step so that the edge between two
 * cels can be a brush edge — soft on a painted style, hard on a drawn one —
 * without a second pass. At uBandSoft of 0 it is a step; at 1 it is a curve
 * with barely a band left in it.
 */
float pBand(float tone) {
  float step = 1.0 / uBands;
  float index = floor(tone / step);
  float part = fract(tone / step);
  float edge = max(uBandSoft, 0.001) * 0.5;
  return (index + smoothstep(0.5 - edge, 0.5 + edge, part)) * step;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // Read where the brush went, which is only where the pixel is when the style
  // does not wander. inputColor and depth are the same two values at the
  // pixel's own place, and they are in the signature because that is how
  // postprocessing knows to hand this effect a depth buffer at all.
  vec2 puv = pWander(uv);

  // Scene radiance to a print: expose it, roll the highlights off, and encode
  // it. Everything below this line is arithmetic on a picture.
  vec3 c = max(texture2D(inputBuffer, puv).rgb, 0.0) * uExposure;
  c = c / (1.0 + c);
  c = pow(c, vec3(0.4545));

  c = mix(vec3(pLuma(c)), c, uSaturation);
  c *= uTint;
  c = clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);

  // The tone is banded and the hue is not: posterising the three channels
  // separately shifts the colour at every step, and a lamp that goes orange,
  // then yellow, then green on its way to white is a bug nobody can unsee.
  if (uBands > 0.0) {
    vec3 hsl = RGBToHSL(c);
    hsl.z = pBand(hsl.z);
    c = clamp(HSLToRGB(hsl), 0.0, 1.0);
  }

  vec2 edges = pEdges(puv);
  float raw = edges.x * uInkDepth + edges.y * uInkLuma;

  // The wash pools where it stops. Taken off a much lower threshold than the
  // line is, because the pooling is wide and soft and the line is neither —
  // they are the same measurement read at two different distances.
  if (uBleed > 0.0) {
    c *= 1.0 - uBleed * smoothstep(0.04, 0.7, raw);
  }

  c = mix(c, uPaperColor, uLift * (1.0 - pLuma(c)));

  if (uInk > 0.0) {
    c = mix(c, uInkColor, uInk * smoothstep(0.32, 0.95, raw));
  }

  // The sheet, last, because it is under everything and over everything: the
  // tooth of the paper breaks the paint that is lying on it and shows through
  // wherever the paint is thin. Screen space and not object space on purpose —
  // the paper is the page, not the furniture, and it must not orbit with the
  // room.
  if (uPaper > 0.0) {
    vec2 q = uv * resolution / max(uPaperScale * pScale(), 0.5);
    float tooth = pFbm(q) * 0.65 + pNoise(q * 3.3) * 0.35;
    c *= mix(1.0, 0.74 + 0.52 * tooth, uPaper);
    c = mix(c, uPaperColor, uPaper * 0.22 * (1.0 - pLuma(c)) * tooth);
  }

  outputColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), inputColor.a);
}
`;

/** A colour uniform, kept as a `Vector3` so the shader can multiply by it. */
function rgb(hex: string): THREE.Vector3 {
  const color = new THREE.Color(hex);
  return new THREE.Vector3(color.r, color.g, color.b);
}

export class PaintEffect extends Effect {
  constructor(params: PaintParams) {
    super("PaintEffect", FRAGMENT, {
      // DEPTH for the silhouettes, CONVOLUTION because the edge detector and
      // the paper both read the input buffer away from the pixel being written.
      // The second one is what makes this the only convolving effect in its
      // pass; `@react-three/postprocessing` splits the chain for us.
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      // Not the SCREEN the base class defaults to. This effect *replaces* the
      // picture — screening it over itself is a double exposure, which reads as
      // "the style nearly works but everything is washed out".
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["uExposure", new THREE.Uniform(1)],
        ["uBands", new THREE.Uniform(0)],
        ["uBandSoft", new THREE.Uniform(0.5)],
        ["uInk", new THREE.Uniform(0)],
        ["uInkColor", new THREE.Uniform(rgb("#000000"))],
        ["uInkWidth", new THREE.Uniform(1.4)],
        ["uInkDepth", new THREE.Uniform(1)],
        ["uInkLuma", new THREE.Uniform(0.4)],
        ["uBleed", new THREE.Uniform(0)],
        ["uPaper", new THREE.Uniform(0)],
        ["uPaperScale", new THREE.Uniform(2.2)],
        ["uPaperColor", new THREE.Uniform(rgb("#ffffff"))],
        ["uWobble", new THREE.Uniform(0)],
        ["uWobbleScale", new THREE.Uniform(40)],
        ["uSaturation", new THREE.Uniform(1)],
        ["uTint", new THREE.Uniform(rgb("#ffffff"))],
        ["uLift", new THREE.Uniform(0)],
        ["uContrast", new THREE.Uniform(1)],
      ]),
    });

    this.apply(params);
  }

  /**
   * Point the shader at a different style.
   *
   * Writing the uniforms rather than building a second effect: every one of
   * these is a `uniform` and none of them is a `#define`, so the program is
   * compiled once for the session and changing style is free. A style that
   * needed a new program would stall the first frame after the menu closes,
   * which is the one frame the visitor is looking at.
   */
  apply(params: PaintParams): void {
    const u = this.uniforms;
    u.get("uExposure")!.value = params.exposure;
    u.get("uBands")!.value = params.bands;
    u.get("uBandSoft")!.value = params.bandSoft;
    u.get("uInk")!.value = params.ink;
    (u.get("uInkColor")!.value as THREE.Vector3).copy(rgb(params.inkColor));
    u.get("uInkWidth")!.value = params.inkWidth;
    u.get("uInkDepth")!.value = params.inkFromDepth;
    u.get("uInkLuma")!.value = params.inkFromLuma;
    u.get("uBleed")!.value = params.bleed;
    u.get("uPaper")!.value = params.paper;
    u.get("uPaperScale")!.value = params.paperScale;
    (u.get("uPaperColor")!.value as THREE.Vector3).copy(rgb(params.paperColor));
    u.get("uWobble")!.value = params.wobble;
    u.get("uWobbleScale")!.value = params.wobbleScale;
    u.get("uSaturation")!.value = params.saturation;
    (u.get("uTint")!.value as THREE.Vector3).copy(rgb(params.tint));
    u.get("uLift")!.value = params.lift;
    u.get("uContrast")!.value = params.contrast;
  }
}
