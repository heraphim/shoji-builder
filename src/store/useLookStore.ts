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
 * Not persisted, for the same reason `useViewportStore` is not: it is a way of
 * looking at the model right now, in the same class as which cells are on
 * screen, and it starts from a known place every session.
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

export const useLookStore = create<LookStore>((set) => ({
  ...DEFAULT_LOOK,

  setLook: (key, value) => set({ [key]: value } as Pick<LookSettings, typeof key>),

  // Three lights dragged into a mess is easy to reach and tedious to undo by
  // hand, and unlike a variable there is no number worth remembering to type
  // back in.
  resetLook: () => set(DEFAULT_LOOK),
}));
