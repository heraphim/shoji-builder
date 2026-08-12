import * as THREE from "three";

/**
 * The surround a finished board reflects, which is otherwise nothing at all.
 *
 * ## Why a board needs one
 *
 * Every light in this app is a delta light, and a delta light can only ever be
 * the *highlight*. It cannot be the rest of the reflection. A real gloss surface
 * spends most of its specular budget not on the lamp but on everything else in
 * the room — the ceiling above it, the wall it faces, the bench it lies on — and
 * a film with none of that is a film reflecting a black void with one dot in it.
 * That is what "brown plastic" actually was, and widening the dot (see
 * `SOURCE_ROUGHNESS` in `woodMaterial.ts`) does not put the room back.
 *
 * ## Why it is on the material rather than on the scene
 *
 * `scene.environment` would reach every physical and standard material in the
 * app — plaster, rice paper, the bedspread, the downloaded props — and it adds
 * an irradiance term to *diffuse*, not only to the mirror lobe. The eight
 * showcase styles each carry a hand-derived `ambient` that is a statement about
 * how much bounce is in that room; putting a second, differently coloured bounce
 * underneath all of them silently invalidates all eight. So this is assigned to
 * `WoodMaterial.envMap` and nothing else sees it.
 *
 * ## Why there is no light in it
 *
 * The obvious surround is `RoomEnvironment`, a studio with bright panels in it.
 * Two things are wrong with that here. A compact bright source in the
 * environment lands in the same place as the key light's own highlight and is
 * therefore the same highlight drawn twice — the punctual specular is still
 * being computed, and nothing here can switch it off per-light. And a studio's
 * panels are a second light source in a room that is meant to have one bulb in
 * it, which is exactly the night interior the showcase is.
 *
 * What is left is elevation and nothing else: dark below, dim above, and a soft
 * band where the two meet. That is genuinely what a board on a bench sees, and
 * it is rotationally symmetric on purpose — an azimuthal feature would be a
 * window, and a window is a source.
 *
 * ## How dim, and why it is not free
 *
 * An environment does not only reflect. It also lights, and three's
 * `getIBLIrradiance` hands back `PI * envMapColor * envMapIntensity` while an
 * `ambientLight` contributes its colour and intensity with no PI at all — so the
 * ramp below, whose mean radiance is about 0.1, arrives as roughly 0.31 of
 * irradiance against the 0.55 of ambient this app defaults to. Better than half
 * the room again, from something added for the sake of a reflection.
 *
 * Measured rather than reasoned about, on a gloss top at {@link
 * WOOD_ENV_LEVEL} 1: **+32%** on a flat surface facing the camera and **+57%**
 * on one seen close to edge-on. The second number is the Fresnel payoff and the
 * only reason any of this is worth having — a clearcoat reflects 4% head-on and
 * approaches 100% at a grazing angle, so the room shows up on the arrises of a
 * board long before it shows up across the middle.
 *
 * The awkward part, and the reason this constant is small: that ratio **does not
 * move with the level**. Swept from 1 down to 0.12 it sat between 1.76 and 1.83
 * throughout; on another board it sat at 1.66, so the number itself is a
 * property of the timber and the angle rather than a constant, but its
 * flatness is the point. Diffuse and specular both scale with the environment's
 * mean, so there is no intensity at which the sheen arrives without the lift —
 * sweeping it only slides both down together. Buying the
 * sheen without the lift would need *contrast* rather than dimness: a bright
 * feature in an otherwise dark surround, which is to say a window, which is to
 * say a light source, which is the thing this deliberately does not have.
 *
 * So it is a bargain struck rather than a problem solved. 0.25 pays about **8%**
 * on a flat face and **15%** on a grazing one, which is a visible finish on an
 * edge and not a visible relighting of the room.
 */

/**
 * How much of that room the timber is standing in. See above for what it costs.
 *
 * On the material rather than baked into the ramp so the ramp stays a statement
 * about what a room looks like and this stays a statement about how much of it
 * to admit — and so the number that was chosen by measurement is the number that
 * appears in the file.
 */
export const WOOD_ENV_LEVEL = 0.25;

/**
 * The equirectangular source, in pixels. Small on purpose.
 *
 * There is no detail in this to lose — it is a vertical ramp — and the PMREM
 * pass that follows is the expensive half whatever it is fed. 64 x 32 is above
 * the point where the ramp shows steps after filtering and far below the point
 * where it costs anything.
 */
const WIDTH = 64;
const HEIGHT = 32;

/** Linear radiance, top to bottom. Not colours in any space with a gamma. */
const UP: readonly [number, number, number] = [0.15, 0.16, 0.185];
const HORIZON: readonly [number, number, number] = [0.28, 0.265, 0.235];
const DOWN: readonly [number, number, number] = [0.028, 0.025, 0.022];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The ramp, as a float texture.
 *
 * Float rather than the usual byte texture because the values are radiance and
 * the whole image lives between 0.02 and 0.3 — quantised to 8 bits that range is
 * about seventy levels, and a smooth gradient across seventy levels is a
 * gradient with visible steps in it once a mirror magnifies it.
 */
function equirectangularRamp(): THREE.DataTexture {
  const data = new Float32Array(WIDTH * HEIGHT * 4);

  for (let y = 0; y < HEIGHT; y++) {
    // equirectangular: the row is a polar angle, 0 at the top
    const polar = ((y + 0.5) / HEIGHT) * Math.PI;
    const elevation = Math.cos(polar);

    const toSky = smoothstep(0, 0.55, elevation);
    const toFloor = smoothstep(0, -0.45, elevation);

    for (let x = 0; x < WIDTH; x++) {
      const at = (y * WIDTH + x) * 4;
      for (let c = 0; c < 3; c++) {
        data[at + c] =
          elevation >= 0
            ? HORIZON[c] + (UP[c] - HORIZON[c]) * toSky
            : HORIZON[c] + (DOWN[c] - HORIZON[c]) * toFloor;
      }
      data[at + 3] = 1;
    }
  }

  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * One prefiltered environment per renderer, built on first ask.
 *
 * Per renderer because a PMREM is a GPU resource and belongs to the context that
 * made it: this app mounts a separate `<Canvas>` on several pages, and handing a
 * target built by one to a material drawn by another is a texture from the wrong
 * context. Keyed weakly so a renderer that goes away is not held alive by this.
 *
 * The target itself is not disposed. It is a 64 x 32 source filtered to a small
 * cube — well under a megabyte — and the alternative is refcounting a shared
 * resource across every material on every page, which is a great deal of
 * bookkeeping to reclaim that.
 */
const built = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

export function woodEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const held = built.get(renderer);
  if (held) return held;

  const source = equirectangularRamp();
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromEquirectangular(source);
  generator.dispose();
  source.dispose();

  built.set(renderer, target.texture);
  return target.texture;
}
