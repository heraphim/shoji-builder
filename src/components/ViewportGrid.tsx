import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { View } from "@react-three/drei";
import {
  GEOMETRY_LABELS,
  MATERIAL_LABELS,
  TEXTURE_READY,
  VIEWPORT_LABELS,
  hiddenViewports,
  type GeometryMode,
  type MaterialMode,
  type ViewportId,
  type ViewportStoreHook,
} from "../store/useViewportStore";

/**
 * The view grid, shared by both tabs: one to four cells over a single WebGL
 * canvas, each with its own header, its own draw modes, and a slot it can be
 * dragged out of.
 *
 * All cells are drawn by ONE `<Canvas>`: it contains nothing but `<View.Port />`,
 * and each cell renders a drei `<View>` whose DOM node defines a scissor
 * rectangle. `eventSource` is the container, so pointer events route to the
 * right cell. That is also what makes the layout cheap to change — showing,
 * hiding or reordering a view is a DOM rearrangement, and the scissor
 * rectangles follow it. Nothing about the GL context is rebuilt.
 *
 * Two consequences worth knowing: anything that takes over the render loop
 * (drei's GizmoHelper) breaks the scissoring — hence the hand-rolled AxisTriad —
 * and HTML overlays would not be clipped per cell, hence TextSprite.
 *
 * The layouts are presets rather than a splittable tree. Blender's recursive
 * areas are more powerful and are also the part of Blender everybody trips over;
 * for one to four views the preset family that Max, Maya and Rhino settled on is
 * what people already know, and it costs a `grid-template-areas` rule each.
 */

/** The named grid areas, in slot order. See `.views-grid` in App.css. */
const SLOT_AREAS = ["a", "b", "c", "d"] as const;

export interface CellSize {
  width: number;
  height: number;
}

export interface ViewportGridProps {
  /** Which page's layout this is — `useEditorViewports` or `useLampViewports`. */
  store: ViewportStoreHook;
  /** The scene for one cell. Mounted inside that cell's `<View>`. */
  render: (id: ViewportId, size: CellSize) => ReactNode;
  /** Extra per-cell controls, pinned to the cell's lower-right corner. */
  controls?: (id: ViewportId) => ReactNode;
  /** Wheel zoom, on the projections only. Omit to leave the wheel alone. */
  onZoom?: (id: ViewportId, factor: number) => void;
  /** Drag pan, on the projections only. */
  onPan?: (id: ViewportId, dx: number, dy: number) => void;
}

/**
 * The cell's own pixel size, measured from the DOM.
 *
 * Not `useThree().size`, which is what a scene inside a `<View>` would reach
 * for. drei injects that into the portal from the tracked element's rect *as of
 * the last render of the View*, while it refreshes the rect it actually scissors
 * with on every frame. The two agree while the only thing that resizes a cell is
 * the window — the root canvas resize re-renders everything — and come apart the
 * moment a cell is resized by the grid changing shape underneath it, which is
 * now a thing that happens. The scissor rectangle stays right either way; what
 * goes stale is any framing computed from the size, which is most of what an
 * orthographic view does.
 */
function useCellSize(ref: React.RefObject<HTMLDivElement | null>): CellSize {
  const [size, setSize] = useState<CellSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = (width: number, height: number) =>
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height }
      );

    // Measured once here, up front, and not left to the observer's first
    // callback: a ResizeObserver only delivers during the rendering steps, which
    // a page that is not being composited — a background tab, a hidden window —
    // never reaches. Waiting for it meant the cell had no size, and a cell with
    // no size draws nothing, so the whole grid stayed blank until the tab was
    // looked at. clientWidth/Height rather than the bounding rect, to match the
    // observer's contentRect: both exclude the cell's border, which is what the
    // tracked element is inset to.
    measure(element.clientWidth, element.clientHeight);

    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      measure(box.width, box.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function ModeSelect<T extends string>({
  value,
  labels,
  disabled,
  title,
  onChange,
}: {
  value: T;
  labels: Record<T, string>;
  disabled?: (option: T) => boolean;
  title: string;
  onChange: (value: T) => void;
}) {
  return (
    <select
      className="view-mode"
      value={value}
      title={title}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {(Object.keys(labels) as T[]).map((option) => (
        <option key={option} value={option} disabled={disabled?.(option)}>
          {labels[option]}
        </option>
      ))}
    </select>
  );
}

/**
 * One cell's header: what the view is, how it draws, and the way out of the
 * layout.
 *
 * In the cell rather than in a page toolbar because every setting on it is that
 * cell's own — a global control would have to ask which view it meant every
 * time. The label doubles as the drag handle, which is the only affordance that
 * has to be discovered; everything else is a plain control.
 */
function ViewportHeader({
  id,
  store,
  canHide,
}: {
  id: ViewportId;
  store: ViewportStoreHook;
  canHide: boolean;
}) {
  const modes = store((state) => state.modes[id]);
  const setMaterial = store((state) => state.setMaterial);
  const setGeometry = store((state) => state.setGeometry);
  const hideViewport = store((state) => state.hideViewport);
  const setDragging = store((state) => state.setDragging);

  return (
    <div className="view-toolbar">
      <span
        className="view-label view-drag"
        title="Drag onto another view to swap their places"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          setDragging(id);
        }}
      >
        {VIEWPORT_LABELS[id]}
      </span>
      <ModeSelect<MaterialMode>
        value={modes.material}
        labels={MATERIAL_LABELS}
        disabled={(option) => option === "texture" && !TEXTURE_READY}
        title="How the faces are drawn in this view"
        onChange={(material) => setMaterial(id, material)}
      />
      <ModeSelect<GeometryMode>
        value={modes.geometry}
        labels={GEOMETRY_LABELS}
        title="How the lines are drawn in this view"
        onChange={(geometry) => setGeometry(id, geometry)}
      />
      <button
        type="button"
        className="view-minimize"
        disabled={!canHide}
        title={canHide ? "Minimise this view" : "The last view cannot be minimised"}
        onClick={() => hideViewport(id)}
      >
        &#8211;
      </button>
    </div>
  );
}

function ViewportCell({
  id,
  slot,
  store,
  render,
  controls,
  onZoom,
  onPan,
  canHide,
}: {
  id: ViewportId;
  slot: number;
  store: ViewportStoreHook;
  render: ViewportGridProps["render"];
  controls?: ViewportGridProps["controls"];
  onZoom?: ViewportGridProps["onZoom"];
  onPan?: ViewportGridProps["onPan"];
  canHide: boolean;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const size = useCellSize(cellRef);
  const dragging = store((state) => state.dragging);
  const swapViewports = store((state) => state.swapViewports);
  const panState = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  // the 3D cell has orbit controls of its own; the wheel and drag bindings here
  // are the projections'
  const framed = id !== "3d";

  const handleWheel = (event: React.WheelEvent) => {
    if (!framed || !onZoom) return;
    // zoom is per-view: the wheel only affects the projection under the cursor
    onZoom(id, Math.exp(-event.deltaY * 0.001));
  };

  // pan: middle-button drag or shift+left drag (left-click stays for picking)
  const handlePointerDown = (event: React.PointerEvent) => {
    if (!framed || !onPan) return;
    if (event.button !== 1 && !(event.button === 0 && event.shiftKey)) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // capture is best-effort — panning still works while the pointer stays
      // over the cell even if the browser refuses the capture
    }
    panState.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const pan = panState.current;
    if (!pan || pan.pointerId !== event.pointerId || !onPan) return;
    // Pointer capture is best-effort above, so a release that happens outside
    // the cell may never reach handlePointerUp and would leave the view panning
    // with no button held. `buttons` is authoritative on every move event.
    if (event.buttons === 0) {
      panState.current = null;
      return;
    }
    onPan(id, event.clientX - pan.x, event.clientY - pan.y);
    pan.x = event.clientX;
    pan.y = event.clientY;
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (panState.current?.pointerId === event.pointerId) panState.current = null;
  };

  const isDropTarget = dragging !== null && dragging !== id;

  return (
    <div
      ref={cellRef}
      className="view-cell"
      style={{ gridArea: SLOT_AREAS[slot] }}
      data-slot={SLOT_AREAS[slot]}
      data-drop-target={isDropTarget || undefined}
      data-dragging={dragging === id || undefined}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => {
        handlePointerUp(event);
        // the drop half of the header drag — the release lands on whichever cell
        // the pointer is over, which is precisely the slot to swap with
        if (isDropTarget && dragging) swapViewports(dragging, id);
      }}
      onPointerCancel={handlePointerUp}
    >
      <ViewportHeader id={id} store={store} canHide={canHide} />
      {/* the cell has to have measured itself before the scene can frame
          against it — a zero-size cell gives every fit an infinite zoom */}
      {size.width > 0 && size.height > 0 && (
        <View className="view-tracking">{render(id, size)}</View>
      )}
      {controls?.(id)}
    </div>
  );
}

/** The minimised views, as a row of chips. Click one to bring it back. */
function MinimizedStrip({ store }: { store: ViewportStoreHook }) {
  const order = store((state) => state.order);
  const showViewport = store((state) => state.showViewport);
  const hidden = hiddenViewports(order);
  if (hidden.length === 0) return null;

  return (
    <div className="views-minimized">
      {hidden.map((id) => (
        <button
          key={id}
          type="button"
          className="view-chip"
          title={`Bring the ${VIEWPORT_LABELS[id]} view back`}
          onClick={() => showViewport(id)}
        >
          {VIEWPORT_LABELS[id]}
        </button>
      ))}
    </div>
  );
}

export function ViewportGrid({
  store,
  render,
  controls,
  onZoom,
  onPan,
}: ViewportGridProps) {
  const containerRef = useRef<HTMLDivElement>(null!);
  const order = store((state) => state.order);
  const dragging = store((state) => state.dragging);
  const setDragging = store((state) => state.setDragging);

  // A drag that ends anywhere else — off the grid, off the window, on a scroll
  // bar — has to end the drag too, or the next click anywhere would drop a view
  // nobody is still carrying.
  useEffect(() => {
    if (!dragging) return;
    const end = () => setDragging(null);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, setDragging]);

  return (
    <div ref={containerRef} className="views-container" data-dragging={dragging ?? undefined}>
      <MinimizedStrip store={store} />
      <div className="views-grid" data-count={order.length}>
        {order.map((id, slot) => (
          <ViewportCell
            key={id}
            id={id}
            slot={slot}
            store={store}
            render={render}
            controls={controls}
            onZoom={onZoom}
            onPan={onPan}
            canHide={order.length > 1}
          />
        ))}
      </div>
      <Canvas className="views-canvas" eventSource={containerRef} dpr={[1, 2]}>
        <View.Port />
      </Canvas>
    </div>
  );
}
