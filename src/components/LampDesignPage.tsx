import { LampScene3D, LampOrthographicView } from "./LampView";
import { LampSidebar } from "./LampSidebar";
import { FileStatusBar } from "./FileStatusBar";
import { ViewportGrid, type CellSize } from "./ViewportGrid";
import { useLampStore } from "../store/useLampStore";
import { useLampViewports, type ViewportId } from "../store/useViewportStore";

/**
 * The Lamp Design tab: the assembly, with the variables and the component list
 * beside it.
 *
 * The same view grid as the Component Editor, and for the same reason a
 * workshop drawing has plans as well as a perspective: a 3/4 view is the worst
 * possible way to check that a rail lines up with the one below it. The three
 * projections are the fixed world views — Top down +Y, Side along +X, Front
 * along +Z — so "square" is something you can see rather than something you
 * orbit around hoping to catch.
 *
 * Layout, minimising and the per-view draw modes are all in `ViewportGrid`;
 * this only says which scene goes in which cell. The lamp keeps its own layout,
 * separate from the editor's — the two tabs are looked at differently.
 */

function renderView(id: ViewportId, size: CellSize) {
  return id === "3d" ? (
    <LampScene3D cellSize={size} />
  ) : (
    <LampOrthographicView viewId={id} cellSize={size} />
  );
}

export function LampDesignPage() {
  const zoomViewport = useLampViewports((state) => state.zoomViewport);
  const panViewport = useLampViewports((state) => state.panViewport);
  const lampName = useLampStore((state) => state.lampName);

  return (
    <div className="lamp-page">
      <FileStatusBar lead={lampName} />
      <div className="lamp-body">
        <div className="lamp-canvas">
          <ViewportGrid
            store={useLampViewports}
            render={renderView}
            onZoom={zoomViewport}
            onPan={panViewport}
          />
        </div>
        <LampSidebar />
      </div>
    </div>
  );
}
