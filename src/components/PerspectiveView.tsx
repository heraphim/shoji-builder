import { useMemo, useRef } from "react";
import { PerspectiveCamera, OrbitControls, Grid } from "@react-three/drei";
import { AxisTriad } from "./AxisTriad";
import * as THREE from "three";
import { UploadedMesh, BLUEPRINT, GRID_CELL_MM } from "./UploadedMesh";
import { useComponentEditorStore } from "../store/useComponentEditorStore";
import { useEditorViewports } from "../store/useViewportStore";
import { useLookStore } from "../store/useLookStore";
import { ContactShade, SceneLights } from "./SceneLights";
import { combinedBoundingBox } from "../lib/picking";
import type { CellSize } from "./ViewportGrid";

// The 3/4 view the camera takes up, as a direction from the model towards it.
const VIEW_DIR = new THREE.Vector3(1, 0.8, 1).normalize();
const FOV = 45;
// breathing room left around the part once it fills the cell
const FIT_MARGIN = 1.12;

/**
 * Distance along {@link VIEW_DIR} at which the whole box fits the frustum.
 *
 * Fitting on the box rather than on its circumsphere: the sphere is the same
 * size whichever way the part lies, so an elongated part — a 370 mm frame 7 mm
 * thick — would be framed as if it were a 420 mm ball and end up a sliver in the
 * middle of the cell. Both the vertical and the horizontal field of view are
 * checked per corner, so the fit holds in a cell of any shape.
 */
function fitDistance(half: THREE.Vector3, aspect: number): number {
  const up0 = Math.abs(VIEW_DIR.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up0, VIEW_DIR).normalize();
  const up = new THREE.Vector3().crossVectors(VIEW_DIR, right).normalize();

  const vTan = Math.tan((FOV * Math.PI) / 360);
  const hTan = vTan * Math.max(aspect, 1e-6);

  // A corner at depth w (measured towards the camera) is inside the frustum when
  // |v| <= (distance - w) * vTan, so it needs distance >= w + |v| / vTan.
  const corner = new THREE.Vector3();
  let distance = 1e-6;
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? half.x : -half.x,
      i & 2 ? half.y : -half.y,
      i & 4 ? half.z : -half.z
    );
    const w = corner.dot(VIEW_DIR);
    distance = Math.max(
      distance,
      w + Math.abs(corner.dot(up)) / vTan,
      w + Math.abs(corner.dot(right)) / hTan
    );
  }
  return distance * FIT_MARGIN;
}

export function PerspectiveView({ cellSize }: { cellSize: CellSize }) {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const modelRotation = useComponentEditorStore((state) => state.modelRotation);
  const modes = useEditorViewports((state) => state.modes["3d"]);
  const setOrbit = useEditorViewports((state) => state.setOrbit);
  const contactShadows = useLookStore((state) => state.contactShadows);

  // Kept out of the framing memo below on purpose: that one is deliberately deaf
  // to a re-cut, because refitting the camera on every slider frame would yank
  // the view around — but the shade has to follow the part it pools under, and
  // a variable edit is exactly what changes its size.
  const modelBox = useMemo(() => combinedBoundingBox(meshes), [meshes]);

  // The fit needs the cell's aspect, but a resize must not re-frame: the user's
  // orbit is theirs to keep. Read through a ref so the size of the moment is
  // used without becoming a reason to refit.
  const sizeRef = useRef(cellSize);
  sizeRef.current = cellSize;

  // refit camera + orbit target whenever the set of meshes changes (uploads,
  // loads) or the model is turned; connections only nudge offsets, and refitting
  // on every snap would yank the camera around mid-flow, so those are excluded
  // on purpose
  const meshIds = meshes.map((m) => m.id).join(",");
  const fitKey = `${meshIds}|${modelRotation.join(",")}`;
  const { position, target, gridY } = useMemo(() => {
    const box = combinedBoundingBox(useComponentEditorStore.getState().meshes);
    if (!box) {
      return {
        position: [300, 250, 300] as [number, number, number],
        target: new THREE.Vector3(0, 0, 0),
        gridY: -200,
      };
    }
    const center = box.getCenter(new THREE.Vector3());
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const gridY = center.y - half.length() * 1.5;

    // An orbit saved against this very model comes back instead of a fresh fit —
    // minimising the view and bringing it back is not a reason to re-frame it.
    // Read through getState rather than as a subscription: this is a starting
    // position, and re-rendering the camera every time the user stops dragging
    // would fight OrbitControls for the camera it is driving.
    const saved = useEditorViewports.getState().orbit;
    if (saved && saved.key === fitKey) {
      return { position: saved.position, target: new THREE.Vector3(...saved.target), gridY };
    }

    const { width, height } = sizeRef.current;
    const distance = fitDistance(half, width / Math.max(height, 1));
    return {
      position: [
        center.x + VIEW_DIR.x * distance,
        center.y + VIEW_DIR.y * distance,
        center.z + VIEW_DIR.z * distance,
      ] as [number, number, number],
      target: center,
      gridY,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshIds, modelRotation]);

  return (
    <>
      <PerspectiveCamera makeDefault position={position} fov={FOV} />
      <SceneLights />
      {/* the app works in mm: cells are 0.5 mm with a heavier line every 10th
          (5 mm) so the fine grid still reads as a scale when zoomed out */}
      <Grid
        args={[1000, 1000]}
        position={[0, gridY, 0]}
        cellSize={GRID_CELL_MM}
        cellThickness={0.5}
        cellColor={BLUEPRINT.gridCell}
        sectionSize={GRID_CELL_MM * 10}
        sectionThickness={0.8}
        sectionColor={BLUEPRINT.gridSection}
        fadeDistance={1500}
        fadeStrength={1.5}
      />
      {/* On the grid, not under the part: the editor hangs its grid well below
          whatever is on the bench, as a horizon rather than a bench top, and a
          pool of shade floating at the part's own feet with the floor a metre
          under it reads as a card hanging in mid-air. */}
      {contactShadows && modelBox && <ContactShade box={modelBox} floorY={gridY} />}
      <UploadedMesh material={modes.material} geometry={modes.geometry} />
      {/* drag rotates, wheel zooms, wheel-button (middle) drag pans */}
      <OrbitControls
        makeDefault
        target={target}
        enablePan
        enableZoom
        enableRotate
        // where the user left it, so the view can be minimised and brought back
        // without losing the orbit. onEnd, not onChange: this is once per
        // gesture rather than once per frame of one.
        onEnd={(event) => {
          const controls = event?.target as { object: THREE.Camera; target: THREE.Vector3 };
          if (!controls?.object) return;
          setOrbit({
            key: fitKey,
            position: controls.object.position.toArray() as [number, number, number],
            target: controls.target.toArray() as [number, number, number],
          });
        }}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
      {modes.showAxes && <AxisTriad />}
    </>
  );
}
