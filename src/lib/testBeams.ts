import * as THREE from "three";

/**
 * The four sticks a wood texture is judged on.
 *
 * ## Why four sticks and not a sphere
 *
 * Every material previewer shows a ball. A ball is the worst possible test for
 * this texture, because the two questions actually being asked are *does the
 * grain run the length of the piece* and *does the cut end show rings that agree
 * with it* — and a ball has neither a length nor an end.
 *
 * So the bench is four beams, 200 mm long, at the four sections this project
 * really uses: 5 mm kumiko, 10 mm bar, 20 mm rail, 40 mm post. All parallel, all
 * cut from one log, which is the second thing worth seeing: the same texture at
 * four scales, so a ring spacing that looks right on the post can be checked
 * against what it does to the 5 mm strip, where it is usually far too busy.
 *
 * ## Why the positions are baked
 *
 * The texture is a function of object-space position, so four meshes sharing one
 * centred box would every one of them sample the same place in the log and come
 * out identical — informative about nothing. Baked into the geometry they are
 * four pieces sawn from one board, which is what they would be.
 *
 * The corollary is worth stating because it is the thing that makes these
 * reusable: **moving the mesh does not move the grain.** A caller may stand the
 * beams anywhere it likes — on a bench, on a nightstand — and each one goes on
 * showing the slice of log it was cut from.
 *
 * Module scope rather than a hook, because it depends on nothing and is four
 * boxes. Everything else in this app that owns geometry owns it because it is
 * rebuilt when variables change; this never is.
 */

/** Section sizes, in mm — the four the project actually cuts. */
export const SECTIONS = [5, 10, 20, 40];

export const BEAM_LENGTH_MM = 200;

/** Clear air between beams. Wide enough that no two grains read as one piece. */
const BEAM_GAP_MM = 20;

export interface Beam {
  section: number;
  centerZ: number;
  geometry: THREE.BufferGeometry;
}

export const BEAMS: Beam[] = (() => {
  // laid out along Z, then shifted so the row is centred on the origin
  let cursor = 0;
  const placed = SECTIONS.map((section) => {
    const center = cursor + section / 2;
    cursor = center + section / 2 + BEAM_GAP_MM;
    return { section, center };
  });
  const width = cursor - BEAM_GAP_MM;

  return placed.map(({ section, center }) => {
    const centerZ = center - width / 2;
    const geometry = new THREE.BoxGeometry(BEAM_LENGTH_MM, section, section);
    geometry.translate(0, 0, centerZ);
    return { section, centerZ, geometry };
  });
})();
