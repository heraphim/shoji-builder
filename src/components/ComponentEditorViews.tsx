import { PerspectiveView } from "./PerspectiveView";
import { OrthographicView } from "./OrthographicView";
import { ViewportGrid, type CellSize } from "./ViewportGrid";
import { useComponentEditorStore, type ViewId } from "../store/useComponentEditorStore";
import { useEditorViewports, type ViewportId } from "../store/useViewportStore";

/**
 * The editor's views: one 3D cell and three orthographic projections, in
 * whatever layout the user has left them in.
 *
 * The grid, the headers, the draw modes and the shared canvas all live in
 * {@link ViewportGrid} — the lamp tab uses the same one. What is here is what is
 * particular to the editor: which scene each cell draws, the per-cell Select
 * Face and rotate buttons, and the fact that projection zoom and pan come out of
 * the component-editor store rather than the viewport store. They live there
 * because turning a component resets them: a turn changes what each projection
 * has to fit, so the framing is part of the model edit rather than part of the
 * chrome.
 *
 * See docs/ui-guide.md for the intended workflow.
 */

// how each view's axis reads in a tooltip — the projections are fixed world
// views, so these never change
const VIEW_AXIS_LABELS: Record<ViewId, { face: string; axis: string }> = {
  top: { face: "up (+Y)", axis: "Y" },
  side: { face: "right (+X)", axis: "X" },
  front: { face: "forward (+Z)", axis: "Z" },
};

// Face/rotate controls sit in the cell's lower-right corner, clear of the
// drawing area and of the axis triad in the opposite corner. Both actions turn
// the model itself, so every view reflects them.
function ViewControls({ viewId }: { viewId: ViewId }) {
  const armedView = useComponentEditorStore((state) => state.armedView);
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const armSelectFace = useComponentEditorStore((state) => state.armSelectFace);
  const rotateAboutViewAxis = useComponentEditorStore((state) => state.rotateAboutViewAxis);
  const hasMeshes = useComponentEditorStore((state) => state.meshes.length > 0);

  const isArmed = pickMode === "selectFace" && armedView === viewId;
  const { face, axis } = VIEW_AXIS_LABELS[viewId];

  return (
    <div className="view-controls">
      <button
        type="button"
        className={isArmed ? "armed" : ""}
        disabled={!hasMeshes}
        onClick={() => armSelectFace(viewId)}
        title={`Click a face on the model to turn the whole component until that face points ${face}`}
      >
        Select Face
      </button>
      <button
        type="button"
        disabled={!hasMeshes}
        onClick={() => rotateAboutViewAxis(viewId, -1)}
        title={`Turn the model 90° counter-clockwise about ${axis}`}
      >
        &#8634;
      </button>
      <button
        type="button"
        disabled={!hasMeshes}
        onClick={() => rotateAboutViewAxis(viewId, 1)}
        title={`Turn the model 90° clockwise about ${axis}`}
      >
        &#8635;
      </button>
    </div>
  );
}

function renderView(id: ViewportId, size: CellSize) {
  return id === "3d" ? (
    <PerspectiveView cellSize={size} />
  ) : (
    <OrthographicView viewId={id} cellSize={size} />
  );
}

export function ComponentEditorViews() {
  const zoomOrtho = useComponentEditorStore((state) => state.zoomOrtho);
  const panView = useComponentEditorStore((state) => state.panView);

  return (
    <ViewportGrid
      store={useEditorViewports}
      render={renderView}
      controls={(id) => (id === "3d" ? null : <ViewControls viewId={id} />)}
      onZoom={(id, factor) => id !== "3d" && zoomOrtho(id, factor)}
      onPan={(id, dx, dy) => id !== "3d" && panView(id, dx, dy)}
    />
  );
}
