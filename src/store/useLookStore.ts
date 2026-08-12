import { create } from "zustand";

/**
 * How everything in the app is lit, and the two cues that stand in for arrises
 * when the arrises are switched off.
 *
 * **One store for the whole app**, unlike `useViewportStore`, which keeps a
 * separate instance per tab. The split there is right for material and geometry:
 * those are answers to "what kind of drawing is this cell", and a blueprint and
 * an assembly view are honestly different drawings. Lighting is not that. A face
 * turned away from the key is hard to read on every tab for the same reason, and
 * somebody who wants it lit harder wants that everywhere — so the Options panel
 * appears in all three sidebars and they are all the same panel.
 *
 * The defaults are the Textures tab's old triple, which was the most directional
 * of the three hand-tuned sets in the app and had the best argument behind it:
 * wood is judged on how the figure reads across a face, and flat light hides
 * exactly that. Ambient is 33% of the total here rather than the 45% the lamp
 * shipped with, which is the difference between a face turned away from both
 * lights sitting at ~61% of a lit one's brightness and at ~70% — most of the
 * range the old lighting had no room for.
 *
 * Kept across reloads, in this browser's localStorage. It used to be dropped at
 * the end of every session on the argument that it is a way of *looking* at the
 * model right now rather than part of one — but that argument cuts the other
 * way: somebody who has found the light they can read a face by has found it for
 * good, and making them find it again every morning is the whole of what the
 * setting costs. The same goes for the outline, which is on or off because of
 * how you work rather than because of what is on the bench.
 */

export interface LookSettings {
  /** Uniform light. The one that flattens: it lifts every face by the same amount. */
  ambient: number;
  /** The main light, over the viewer's right shoulder. Contrast comes from this. */
  key: number;
  /** The back-left light that stops the unlit side going to pure ambient. */
  fill: number;
  /**
   * A soft shadow pooled under the model, which is what makes it stand on the
   * bench rather than float over it. The 3D cells only — a shadow on the floor
   * of a Top projection is a shadow drawn straight at the camera.
   */
  contactShadows: boolean;
  /**
   * Draw each part's outline faintly even when the view is set to "No lines".
   *
   * Needed because no lighting model can separate two touching parts whose faces
   * are coplanar: same normal and same colour is the same pixel. Only a line,
   * a different colour, or occlusion tells them apart, and a line is the one the
   * app already has the geometry for.
   */
  faintOutline: boolean;
}

export const DEFAULT_LOOK: LookSettings = {
  ambient: 0.55,
  key: 1.1,
  fill: 0.35,
  contactShadows: false,
  faintOutline: false,
};

export interface LookStore extends LookSettings {
  setLook: <K extends keyof LookSettings>(key: K, value: LookSettings[K]) => void;
  resetLook: () => void;
}

const STORAGE_KEY = "shoji.look";

/**
 * Saved settings read back, field by field, falling back to the default for
 * anything that is not the right shape.
 *
 * Field by field rather than all-or-nothing because the fields are independent:
 * a hand-edited or half-written `ambient` is no reason to throw away a shadow
 * setting that reads perfectly well. A number that is not finite is not a
 * number here — an intensity of NaN renders every cell black with nothing to say
 * why, which is worse than any value the slider can reach.
 *
 * Exported for `__settingscheck`; it is a pure function of its argument.
 */
export function parseLook(raw: unknown): LookSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_LOOK;
  const saved = raw as Partial<Record<keyof LookSettings, unknown>>;
  const number = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const boolean = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  return {
    ambient: number(saved.ambient, DEFAULT_LOOK.ambient),
    key: number(saved.key, DEFAULT_LOOK.key),
    fill: number(saved.fill, DEFAULT_LOOK.fill),
    contactShadows: boolean(saved.contactShadows, DEFAULT_LOOK.contactShadows),
    faintOutline: boolean(saved.faintOutline, DEFAULT_LOOK.faintOutline),
  };
}

function read(): LookSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseLook(JSON.parse(raw)) : DEFAULT_LOOK;
  } catch {
    // private mode, a full quota, storage switched off, half-written JSON —
    // none of them are worth failing to light the scene over
    return DEFAULT_LOOK;
  }
}

/** The five settings alone, out of a store that also holds its own actions. */
function settingsOf(state: LookSettings): LookSettings {
  return {
    ambient: state.ambient,
    key: state.key,
    fill: state.fill,
    contactShadows: state.contactShadows,
    faintOutline: state.faintOutline,
  };
}

/**
 * Write the whole set, and hand it back for the `set` that asked.
 *
 * Every change goes through here, which is what keeps "what is on screen" and
 * "what will come back tomorrow" the same thing by construction.
 */
function remember(look: LookSettings): LookSettings {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // as above: the light still changes, it just will not be remembered
  }
  return look;
}

export const useLookStore = create<LookStore>((set) => ({
  ...read(),

  setLook: (key, value) =>
    set((state) => remember({ ...settingsOf(state), [key]: value } as LookSettings)),

  // Three lights dragged into a mess is easy to reach and tedious to undo by
  // hand, and unlike a variable there is no number worth remembering to type
  // back in.
  resetLook: () => set(remember(DEFAULT_LOOK)),
}));
