import { create } from "zustand";
import type { ViewId, Vec3 } from "./useComponentEditorStore";

/**
 * The viewport chrome: which views are on screen, in what order, and how each
 * one draws.
 *
 * Two ideas, borrowed from how 3D tools have settled on this:
 *
 * - **A slot is not a view.** The layout hands out slots; `order` says which
 *   view is currently sitting in each. Reordering swaps assignments — nothing
 *   about a view is rebuilt when it moves, and a view keeps its framing.
 * - **Minimising is a visibility flag, never a teardown.** A hidden view keeps
 *   its modes and comes back exactly as it left, which is what makes it worth
 *   using rather than something to be avoided.
 *
 * `material` and `geometry` are deliberately two independent settings rather
 * than one "visual style" list of every combination — how the faces are drawn
 * and how the lines are drawn are separate questions, and pairing them off
 * produces a menu that grows as their product.
 *
 * There is one store per page (see the two exports at the bottom): the editor
 * and the lamp are looked at differently and should not share a layout.
 */

export type ViewportId = "3d" | ViewId;

/** How the faces are drawn. */
export type MaterialMode = "none" | "solid" | "texture";

/** How the lines are drawn. */
export type GeometryMode = "none" | "materialEdges" | "allTriangles";

export const ALL_VIEWPORTS: readonly ViewportId[] = ["3d", "top", "side", "front"];

export const VIEWPORT_LABELS: Record<ViewportId, string> = {
  "3d": "3D",
  top: "Top",
  side: "Side",
  front: "Front",
};

export const MATERIAL_LABELS: Record<MaterialMode, string> = {
  none: "No material",
  solid: "Solid",
  texture: "Texture",
};

export const GEOMETRY_LABELS: Record<GeometryMode, string> = {
  none: "No lines",
  materialEdges: "Material edges",
  allTriangles: "All triangles",
};

/**
 * Whether `texture` is a mode that draws anything.
 *
 * It was false for a long time, with this note: texture needs UV coordinates,
 * and nothing in the app generates them — every solid reaching a view is a
 * position-only buffer out of `simplifySolid` or `mergeGeometries`.
 *
 * What settled it is that the wood texture is **solid**: it is a function of the
 * position inside the part, not of a surface parameterisation, so it wants no
 * UVs at all and works on exactly the buffers the app already produces. See
 * `lib/wood.ts`. The flag is kept because the menu entry still has to be
 * disabled anywhere the mode would do nothing, and because turning the whole
 * feature off from one line is worth a constant.
 */
export const TEXTURE_READY = true;

export interface ViewportModes {
  material: MaterialMode;
  geometry: GeometryMode;
}

/**
 * Where the 3D view's camera has been left.
 *
 * Kept outside the view so that minimising it and bringing it back is not the
 * same thing as re-framing it — a view that forgets where you were looking is a
 * view you learn not to minimise.
 *
 * `key` is the framing the orbit was made against (which solids, which model
 * rotation). When that changes the model itself has changed and the view refits,
 * exactly as it did before any of this was stored — the saved orbit is for the
 * model it was made on, not for whatever comes next.
 */
export interface ViewportOrbit {
  key: string;
  position: Vec3;
  target: Vec3;
}

export interface ViewportFraming {
  /** Zoom multiplier over the fit-to-view framing; 1 = fit. */
  zoom: number;
  /** Pan in screen pixels, converted to world units by the view's own zoom. */
  pan: { x: number; y: number };
}

export interface ViewportStore {
  /** The views on screen, in slot order. Never empty. */
  order: ViewportId[];
  modes: Record<ViewportId, ViewportModes>;
  /**
   * Per-view zoom and pan for the projections.
   *
   * Optional in practice: a page whose framing has to be reset by model edits
   * keeps it with the model instead. The component editor does exactly that —
   * turning a component changes what each projection has to fit, so its framing
   * lives in `useComponentEditorStore` and is reset as part of the rotation.
   */
  framing: Record<ViewportId, ViewportFraming>;
  /** The 3D view's camera, so minimising it does not throw the orbit away. */
  orbit: ViewportOrbit | null;
  /** The view being dragged onto another slot, while a drag is in flight. */
  dragging: ViewportId | null;

  showViewport: (id: ViewportId) => void;
  hideViewport: (id: ViewportId) => void;
  swapViewports: (a: ViewportId, b: ViewportId) => void;
  setMaterial: (id: ViewportId, material: MaterialMode) => void;
  setGeometry: (id: ViewportId, geometry: GeometryMode) => void;
  setDragging: (id: ViewportId | null) => void;
  setOrbit: (orbit: ViewportOrbit) => void;
  zoomViewport: (id: ViewportId, factor: number) => void;
  panViewport: (id: ViewportId, dx: number, dy: number) => void;
  resetFraming: () => void;
}

/**
 * The views that are off screen, derived rather than stored.
 *
 * Two lists that have to agree drift apart the first time one of them is
 * updated without the other; the visible order is the only thing worth keeping.
 */
export function hiddenViewports(order: ViewportId[]): ViewportId[] {
  return ALL_VIEWPORTS.filter((id) => !order.includes(id));
}

const NO_FRAMING: ViewportFraming = { zoom: 1, pan: { x: 0, y: 0 } };

const DEFAULT_FRAMING: Record<ViewportId, ViewportFraming> = {
  "3d": NO_FRAMING,
  top: NO_FRAMING,
  side: NO_FRAMING,
  front: NO_FRAMING,
};

function createViewportStore(defaults: Record<ViewportId, ViewportModes>) {
  return create<ViewportStore>((set) => ({
    order: [...ALL_VIEWPORTS],
    modes: defaults,
    framing: DEFAULT_FRAMING,
    orbit: null,
    dragging: null,

    // restored to the end of the row rather than to the slot it left: the slots
    // are positions in a layout that has since changed shape, so there is no
    // "its own" slot to go back to
    showViewport: (id) =>
      set((state) =>
        state.order.includes(id) ? state : { order: [...state.order, id] }
      ),

    // the last one standing cannot be minimised — a grid with nothing in it is
    // not a state the user can get out of
    hideViewport: (id) =>
      set((state) =>
        state.order.length <= 1 ? state : { order: state.order.filter((v) => v !== id) }
      ),

    swapViewports: (a, b) =>
      set((state) => {
        const i = state.order.indexOf(a);
        const j = state.order.indexOf(b);
        if (i < 0 || j < 0 || i === j) return state;
        const order = [...state.order];
        order[i] = b;
        order[j] = a;
        return { order };
      }),

    setMaterial: (id, material) =>
      set((state) => ({ modes: { ...state.modes, [id]: { ...state.modes[id], material } } })),

    setGeometry: (id, geometry) =>
      set((state) => ({ modes: { ...state.modes, [id]: { ...state.modes[id], geometry } } })),

    setDragging: (id) => set({ dragging: id }),

    setOrbit: (orbit) => set({ orbit }),

    zoomViewport: (id, factor) =>
      set((state) => ({
        framing: {
          ...state.framing,
          [id]: {
            ...state.framing[id],
            zoom: Math.min(50, Math.max(0.05, state.framing[id].zoom * factor)),
          },
        },
      })),

    panViewport: (id, dx, dy) =>
      set((state) => ({
        framing: {
          ...state.framing,
          [id]: {
            ...state.framing[id],
            pan: { x: state.framing[id].pan.x + dx, y: state.framing[id].pan.y + dy },
          },
        },
      })),

    resetFraming: () => set({ framing: DEFAULT_FRAMING }),
  }));
}

export type ViewportStoreHook = ReturnType<typeof createViewportStore>;

/**
 * The component editor's viewports. The projections start with no material at
 * all: they are hidden-line blueprints, and a filled solid is the exception
 * there rather than the norm.
 */
export const useEditorViewports = createViewportStore({
  "3d": { material: "solid", geometry: "materialEdges" },
  top: { material: "none", geometry: "materialEdges" },
  side: { material: "none", geometry: "materialEdges" },
  front: { material: "none", geometry: "materialEdges" },
});

/**
 * The lamp's viewports. Its projections *do* start solid: the lamp has no
 * hidden-line pass, so the depth buffer is what stops the far side of the
 * assembly being drawn over the near side, and without faces a kumiko panel
 * projects as an unreadable mat of lines.
 */
export const useLampViewports = createViewportStore({
  "3d": { material: "solid", geometry: "materialEdges" },
  top: { material: "solid", geometry: "materialEdges" },
  side: { material: "solid", geometry: "materialEdges" },
  front: { material: "solid", geometry: "materialEdges" },
});

/**
 * The Textures tab's viewports. Textured everywhere and with no lines at all:
 * the whole page exists to be looked at, and an edge overlay across a grain
 * pattern is the one thing guaranteed to be mistaken for part of it.
 *
 * The projections are where the claim is actually checked — Side looks along the
 * beams, so it is the end grain, while Top and Front are the long faces. Being
 * able to put those beside each other is the point of giving this tab the same
 * four views as the rest of the app rather than a single preview.
 */
export const useTextureViewports = createViewportStore({
  "3d": { material: "texture", geometry: "none" },
  top: { material: "texture", geometry: "none" },
  side: { material: "texture", geometry: "none" },
  front: { material: "texture", geometry: "none" },
});
