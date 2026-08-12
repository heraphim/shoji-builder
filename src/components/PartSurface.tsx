import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { WoodMaterial } from "../lib/woodMaterial";
import { woodEnvironment } from "../lib/woodEnvironment";
import type { GrainAxis, WoodParams } from "../lib/wood";
import {
  resolveTexture,
  useTextureStore,
} from "../store/useTextureStore";

/**
 * How a solid is painted, shared by all three tabs.
 *
 * There are only two answers — a flat colour or the wood texture — and every
 * view in the app has to be able to give either, so the decision is made once
 * here rather than three times in three view files that would drift.
 */

/**
 * A wood material for these parameters, kept alive across parameter changes.
 *
 * The material is built once and its uniforms are written in place afterwards.
 * That is not an optimisation so much as a requirement: the Textures tab binds
 * sliders directly to these parameters, and a new material per change would
 * recompile the shader program on every frame of a drag.
 *
 * Returns null for null, so a caller can ask for "the texture, if there is one"
 * in one line.
 */
export function useWoodMaterial(params: WoodParams | null): WoodMaterial | null {
  const held = useRef<WoodMaterial | null>(null);
  const renderer = useThree((state) => state.gl);

  // Built on first use rather than up front: every view calls this, most of them
  // are not showing a texture at any given moment, and a material that is never
  // rendered still costs nothing only if it was never made.
  if (params) {
    if (held.current) held.current.setParams(params);
    else held.current = new WoodMaterial(params);

    // The room the finish reflects, which is a property of the renderer rather
    // than of the timber — hence here, where there is one, and not in the
    // material's own constructor, which has never needed one. Assigned rather
    // than compared away because the environment is built once per renderer and
    // handed back identical afterwards; the guard is for the recompile, since
    // three only emits the envMap chunks when there is one at compile time.
    const environment = woodEnvironment(renderer);
    if (held.current.envMap !== environment) {
      held.current.envMap = environment;
      held.current.needsUpdate = true;
    }
  }

  // A material holds a compiled program and its uniform buffers, and React
  // unmounts these whenever a view is minimised, which happens often.
  //
  // The handle is deliberately *not* cleared alongside the dispose. Under
  // StrictMode React tears an effect down and sets it straight back up without
  // re-rendering in between, so clearing it would strand the mesh holding a
  // material this hook had already forgotten, and mint a second one on the next
  // render for nothing. Keeping it is safe because `dispose` on a three
  // material only releases its GPU resources — the object stays usable, and the
  // renderer compiles it again the next time it is drawn.
  useEffect(() => () => held.current?.dispose(), []);

  return params ? held.current : null;
}

/**
 * The texture a part is drawn with, resolved from whatever it names.
 *
 * A component stores a texture *id* — a library file name, or the sentinel for
 * the Textures bench — not a copy of the parameters. That is what makes editing
 * a texture on its own tab show up on every component using it, and it is also
 * why this has to subscribe to both halves of the texture store: the bench
 * parameters change under a slider, and the library cache fills in after a
 * fetch.
 *
 * @param grainAxis overrides the texture's own, because which way the grain runs
 *        is a property of the *part* — the same oak is quartersawn one way in a
 *        stile and the other way in a rail.
 */
export function usePartTexture(
  textureId: string | null,
  grainAxis?: GrainAxis
): WoodParams | null {
  const params = useTextureStore((state) => resolveTexture(state, textureId));
  const ensureLoaded = useTextureStore((state) => state.ensureLoaded);

  // A library texture that has never been read has no parameters yet. Asking
  // here rather than at the point of selection means a component loaded from
  // file — which names a texture nobody has opened this session — still comes up
  // wearing it.
  useEffect(() => {
    if (textureId && params === null) void ensureLoaded(textureId);
  }, [textureId, params, ensureLoaded]);

  return useMemo(
    () => (params && grainAxis && grainAxis !== params.grainAxis ? { ...params, grainAxis } : params),
    [params, grainAxis]
  );
}
