import { create } from "zustand";
import {
  DEFAULT_WOOD_PARAMS,
  randomSeed,
  woodPreset,
  type WoodFinish,
  type WoodParams,
  type WoodSpecies,
} from "../lib/wood";
import {
  buildTextureFile,
  listLibraryTextures,
  loadLibraryTexture,
  parseTextureFile,
  textureDisplayName,
  type TextureFile,
} from "../lib/textureFile";

/**
 * The Textures tab's bench, and the texture library everything else draws from.
 *
 * Two jobs in one store because they are two views of the same thing. The
 * **bench** is the texture currently being designed — one set of parameters, the
 * sliders are bound straight to it, and the test beams redraw as it changes. The
 * **library** is every saved texture the project ships, which is what a
 * component picks from when it says what it is made of.
 *
 * The bench is offered to components too, under the name `BENCH_TEXTURE`. That
 * is the whole workflow: put a component on the Component Editor bench, point it
 * at the texture bench, then go and drag sliders on the Textures tab and watch
 * the component change. Without it you would have to save a file and reload it
 * to see a change, which for something adjusted by eye is no workflow at all.
 *
 * Library entries are fetched once and cached: a component asks for its texture
 * on every render, and the answer cannot be a promise.
 */

/** The id a component uses to mean "whatever is on the Textures bench". */
export const BENCH_TEXTURE = "__bench__";

interface TextureStore {
  // ---- the bench ----------------------------------------------------------
  params: WoodParams;
  /** The preset the numbers were last taken from. Provenance, not truth. */
  species: WoodSpecies;
  finish: WoodFinish;
  /** What the bench texture is called — the name a save writes under. */
  documentName: string | null;

  // ---- the library --------------------------------------------------------
  library: string[];
  libraryError: string | null;
  /** Parsed library textures, by file name. Fetched once, then held. */
  loaded: Record<string, TextureFile>;

  setParam: <K extends keyof WoodParams>(key: K, value: WoodParams[K]) => void;
  applySpecies: (species: WoodSpecies) => void;
  applyFinish: (finish: WoodFinish) => void;
  newSeed: () => void;
  reset: () => void;

  setDocumentName: (name: string | null) => void;
  /** Put a parsed file on the bench. Used by open and by upload alike. */
  openTexture: (file: TextureFile, name: string | null) => void;
  toFile: (name: string) => TextureFile;

  loadLibrary: () => Promise<void>;
  /** Fetch and cache one library texture. Resolves to null if it will not read. */
  ensureLoaded: (fileName: string) => Promise<TextureFile | null>;
}

// requests in flight, so a component that renders five times before the fetch
// lands does not start five fetches
const pending = new Map<string, Promise<TextureFile | null>>();

export const useTextureStore = create<TextureStore>((set, get) => ({
  params: DEFAULT_WOOD_PARAMS,
  species: "white_oak",
  finish: "raw",
  documentName: null,

  library: [],
  libraryError: null,
  loaded: {},

  setParam: (key, value) =>
    set((state) => ({ params: { ...state.params, [key]: value } })),

  // A species is the whole board bar where it was cut from: swapping oak for
  // walnut should not move the piece to a different part of the log, or the
  // change reads as two changes at once.
  applySpecies: (species) =>
    set((state) => ({
      species,
      params: {
        ...woodPreset(species, state.finish),
        grainAxis: state.params.grainAxis,
        grainScale: state.params.grainScale,
        pith: state.params.pith,
        seed: state.params.seed,
      },
    })),

  applyFinish: (finish) =>
    set((state) => ({
      finish,
      params: { ...state.params, ...woodPreset(state.species, finish) },
    })),

  newSeed: () => set((state) => ({ params: { ...state.params, seed: randomSeed() } })),

  reset: () =>
    set({ params: DEFAULT_WOOD_PARAMS, species: "white_oak", finish: "raw", documentName: null }),

  setDocumentName: (documentName) => set({ documentName }),

  openTexture: (file, name) =>
    set({ params: file.params, species: file.species, finish: file.finish, documentName: name }),

  toFile: (name) => {
    const state = get();
    return buildTextureFile(name, state.species, state.finish, state.params);
  },

  loadLibrary: async () => {
    try {
      set({ library: await listLibraryTextures(), libraryError: null });
    } catch (e) {
      set({ libraryError: e instanceof Error ? e.message : String(e) });
    }
  },

  ensureLoaded: (fileName) => {
    const cached = get().loaded[fileName];
    if (cached) return Promise.resolve(cached);

    const inFlight = pending.get(fileName);
    if (inFlight) return inFlight;

    const request = loadLibraryTexture(fileName)
      .then((file) => {
        set((state) => ({ loaded: { ...state.loaded, [fileName]: file } }));
        return file;
      })
      .catch(() => null)
      .finally(() => pending.delete(fileName));

    pending.set(fileName, request);
    return request;
  },
}));

/** Read a payload onto the bench. @throws when it is not a texture file. */
export function openTextureData(data: unknown, name: string | null): TextureFile {
  const file = parseTextureFile(data);
  useTextureStore.getState().openTexture(file, name);
  return file;
}

/**
 * The parameters a component should be drawn with, or null for "no texture".
 *
 * Not a hook and not memoised — it is called from render, and both of its
 * sources are plain store reads. The caller subscribes to whichever of them it
 * needs to re-render on; see `useAppearance` in UploadedMesh.
 */
export function resolveTexture(state: TextureStore, id: string | null): WoodParams | null {
  if (id === null) return null;
  if (id === BENCH_TEXTURE) return state.params;
  return state.loaded[id]?.params ?? null;
}

export { textureDisplayName };
