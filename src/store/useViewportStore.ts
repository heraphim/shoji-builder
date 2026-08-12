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
 * There is one store per page (see the three exports at the bottom): the editor,
 * the lamp and the textures bench are looked at differently and should not share
 * a layout — which is also why each keeps its own arrangement across reloads,
 * under its own key. See {@link parseLayout} for what is kept and what is not.
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
  /**
   * Whether the world-axis triad is drawn in this cell.
   *
   * Per cell rather than per page, and beside the other two for the same reason
   * they are beside each other: it is a question about *this drawing*. The triad
   * earns its place while you are working out which way a part is lying and is
   * in the way the moment you are looking at the part itself — and which of
   * those you are doing differs from cell to cell, which is why the four views
   * exist at all.
   */
  showAxes: boolean;
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
  setShowAxes: (id: ViewportId, showAxes: boolean) => void;
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

// ---------------------------------------------------------------------------
// What is kept across reloads
// ---------------------------------------------------------------------------

/**
 * The arrangement: which views are on screen, in what order, and how each draws.
 *
 * Exactly this much and no more. The framing and the orbit are *not* kept, and
 * the difference is what each one is a fact about: an arrangement is a fact
 * about how you like to work — three of us keep the Side view solid and the rest
 * blueprint — while a zoom is a fact about the model that was on the bench when
 * you left, and restoring it against a different one is restoring nothing.
 * `dragging` is a gesture in flight and cannot outlive the page it happened on.
 */
type ViewportLayout = Pick<ViewportStore, "order" | "modes">;

/** One value out of a labelled set, or the default for anything else. */
function oneOf<T extends string>(value: unknown, labels: Record<T, string>, fallback: T): T {
  return typeof value === "string" && value in labels ? (value as T) : fallback;
}

/**
 * A saved arrangement read back, with every field checked against what it is
 * allowed to be.
 *
 * Nothing here trusts the blob: it is a string in a store the user can edit, it
 * outlives the version of the app that wrote it, and a view id or a draw mode
 * that no longer exists must cost that one setting rather than the page. An
 * order that comes back empty — every id in it unknown — falls back to the full
 * row, because a grid with nothing in it is not a state anybody can get out of.
 *
 * Exported for `__settingscheck`; it is a pure function of its arguments.
 */
export function parseLayout(raw: unknown, defaults: Record<ViewportId, ViewportModes>): ViewportLayout {
  const saved = (raw && typeof raw === "object" ? raw : {}) as {
    order?: unknown;
    modes?: unknown;
  };

  const order = (Array.isArray(saved.order) ? saved.order : []).filter(
    (id, i, all): id is ViewportId =>
      ALL_VIEWPORTS.includes(id as ViewportId) && all.indexOf(id) === i
  );

  const savedModes = (
    saved.modes && typeof saved.modes === "object" ? saved.modes : {}
  ) as Partial<Record<ViewportId, Partial<Record<keyof ViewportModes, unknown>>>>;

  const modes = Object.fromEntries(
    ALL_VIEWPORTS.map((id) => {
      const mode = savedModes[id] ?? {};
      const fallback = defaults[id];
      return [
        id,
        {
          material: oneOf(mode.material, MATERIAL_LABELS, fallback.material),
          geometry: oneOf(mode.geometry, GEOMETRY_LABELS, fallback.geometry),
          showAxes: typeof mode.showAxes === "boolean" ? mode.showAxes : fallback.showAxes,
        },
      ];
    })
  ) as Record<ViewportId, ViewportModes>;

  return { order: order.length > 0 ? order : [...ALL_VIEWPORTS], modes };
}

function readLayout(key: string, defaults: Record<ViewportId, ViewportModes>): ViewportLayout {
  try {
    const raw = localStorage.getItem(key);
    return parseLayout(raw ? JSON.parse(raw) : null, defaults);
  } catch {
    // private mode, a full quota, storage switched off, half-written JSON —
    // none of them are worth failing to draw the grid over
    return parseLayout(null, defaults);
  }
}

function createViewportStore(key: string, defaults: Record<ViewportId, ViewportModes>) {
  const saved = readLayout(key, defaults);

  return create<ViewportStore>((set) => {
    /**
     * Write the arrangement, and hand it back for the `set` that asked.
     *
     * Every action that changes one goes through here, so what is on screen and
     * what comes back tomorrow are the same thing by construction — rather than
     * a subscription on the whole store, which would write on every frame of a
     * pan for a value that pans do not touch.
     */
    const remember = (layout: ViewportLayout): ViewportLayout => {
      try {
        localStorage.setItem(key, JSON.stringify(layout));
      } catch {
        // as above: the view still changes, it just will not be remembered
      }
      return layout;
    };

    return {
      order: saved.order,
      modes: saved.modes,
      framing: DEFAULT_FRAMING,
      orbit: null,
      dragging: null,

      // restored to the end of the row rather than to the slot it left: the
      // slots are positions in a layout that has since changed shape, so there
      // is no "its own" slot to go back to
      showViewport: (id) =>
        set((state) =>
          state.order.includes(id)
            ? state
            : remember({ order: [...state.order, id], modes: state.modes })
        ),

      // the last one standing cannot be minimised — a grid with nothing in it is
      // not a state the user can get out of
      hideViewport: (id) =>
        set((state) =>
          state.order.length <= 1
            ? state
            : remember({ order: state.order.filter((v) => v !== id), modes: state.modes })
        ),

      swapViewports: (a, b) =>
        set((state) => {
          const i = state.order.indexOf(a);
          const j = state.order.indexOf(b);
          if (i < 0 || j < 0 || i === j) return state;
          const order = [...state.order];
          order[i] = b;
          order[j] = a;
          return remember({ order, modes: state.modes });
        }),

      setMaterial: (id, material) =>
        set((state) =>
          remember({
            order: state.order,
            modes: { ...state.modes, [id]: { ...state.modes[id], material } },
          })
        ),

      setGeometry: (id, geometry) =>
        set((state) =>
          remember({
            order: state.order,
            modes: { ...state.modes, [id]: { ...state.modes[id], geometry } },
          })
        ),

      setShowAxes: (id, showAxes) =>
        set((state) =>
          remember({
            order: state.order,
            modes: { ...state.modes, [id]: { ...state.modes[id], showAxes } },
          })
        ),

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
    };
  });
}

export type ViewportStoreHook = ReturnType<typeof createViewportStore>;

/**
 * The component editor's viewports. The projections start with no material at
 * all: they are hidden-line blueprints, and a filled solid is the exception
 * there rather than the norm.
 */
export const useEditorViewports = createViewportStore("shoji.viewports.editor", {
  "3d": { material: "solid", geometry: "materialEdges", showAxes: true },
  top: { material: "none", geometry: "materialEdges", showAxes: true },
  side: { material: "none", geometry: "materialEdges", showAxes: true },
  front: { material: "none", geometry: "materialEdges", showAxes: true },
});

/**
 * The lamp's viewports. Its projections *do* start solid: the lamp has no
 * hidden-line pass, so the depth buffer is what stops the far side of the
 * assembly being drawn over the near side, and without faces a kumiko panel
 * projects as an unreadable mat of lines.
 */
export const useLampViewports = createViewportStore("shoji.viewports.lamp", {
  "3d": { material: "solid", geometry: "materialEdges", showAxes: true },
  top: { material: "solid", geometry: "materialEdges", showAxes: true },
  side: { material: "solid", geometry: "materialEdges", showAxes: true },
  front: { material: "solid", geometry: "materialEdges", showAxes: true },
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
export const useTextureViewports = createViewportStore("shoji.viewports.textures", {
  "3d": { material: "texture", geometry: "none", showAxes: true },
  top: { material: "texture", geometry: "none", showAxes: true },
  side: { material: "texture", geometry: "none", showAxes: true },
  front: { material: "texture", geometry: "none", showAxes: true },
});
