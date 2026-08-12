import { useMemo, useRef } from "react";
import * as THREE from "three";
import { OrthographicCamera, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { AxisTriad } from "./AxisTriad";
import { TextSprite } from "./TextSprite";
import { BlueprintGrid } from "./OrthographicView";
import { ViewportGrid, type CellSize } from "./ViewportGrid";
import { BLUEPRINT } from "./UploadedMesh";
import { ContactShade, SceneLights, castsShade } from "./SceneLights";
import { useWoodMaterial } from "./PartSurface";
import { useTextureStore } from "../store/useTextureStore";
import { useLookStore } from "../store/useLookStore";
import {
  useTextureViewports,
  type MaterialMode,
  type ViewportId,
} from "../store/useViewportStore";
import { VIEW_AXES, type ViewId } from "../store/useComponentEditorStore";
import { viewCameraBasis } from "../lib/picking";

/**
 * The Textures tab's four views, and the test pieces in them.
 *
 * ## Why four sticks and not a sphere
 *
 * Every material previewer shows a ball. A ball is the worst possible test for
 * this texture, because the two questions actually being asked are *does the
 * grain run the length of the piece* and *does the cut end show rings that
 * agree with it* — and a ball has neither a length nor an end.
 *
 * So the bench is four beams, 200 mm long, at the four sections this project
 * really uses: 5 mm kumiko, 10 mm bar, 20 mm rail, 40 mm post. All parallel, all
 * cut from one log, which is the second thing worth seeing: the same texture at
 * four scales, so a ring spacing that looks right on the post can be checked
 * against what it does to the 5 mm strip, where it is usually far too busy.
 *
 * The beams' positions are **baked into their geometry** rather than set on the
 * mesh. The texture is a function of object-space position, so four meshes
 * sharing a centred box would every one of them sample the same place in the log
 * and come out identical — informative about nothing. Baked, they are four
 * pieces sawn from one board, which is what they would be.
 *
 * ## Why the projections earn their place
 *
 * Side looks along the beams, so it *is* the end grain, at exactly the moment
 * Top and Front are showing the long faces. Putting those three beside each
 * other is the only way to see that the ends and the sides agree, which is the
 * one property this whole texture was chosen for.
 */

/** Section sizes, in mm — the four the project actually cuts. */
const SECTIONS = [5, 10, 20, 40];
const BEAM_LENGTH_MM = 200;
/** Clear air between beams. Wide enough that no two grains read as one piece. */
const BEAM_GAP_MM = 20;

/** Where the size labels hang: clear of every beam in all four views. */
const LABEL_X = -125;
const LABEL_Y = 34;
const LABEL_HEIGHT = 11;

interface Beam {
  section: number;
  centerZ: number;
  geometry: THREE.BufferGeometry;
}

/**
 * The bench, built once for the life of the page.
 *
 * Module scope rather than a hook: it depends on nothing, it is four boxes, and
 * giving it a lifecycle would only mean four disposals to get wrong. Everything
 * else in this app that owns geometry owns it because it is rebuilt when
 * variables change; this never is.
 */
const BEAMS: Beam[] = (() => {
  // laid out along Z, then shifted so the row is centred on the origin
  let cursor = 0;
  const placed = SECTIONS.map((section) => {
    const center = cursor + section / 2;
    cursor = center + section / 2 + BEAM_GAP_MM;
    return { section, center };
  });
  const width = cursor - BEAM_GAP_MM;

  return placed.map(({ section, center }) => {
    const centerZ = center - width / 2;
    const geometry = new THREE.BoxGeometry(BEAM_LENGTH_MM, section, section);
    geometry.translate(0, 0, centerZ);
    return { section, centerZ, geometry };
  });
})();

/**
 * What the views frame on. Fixed, because the bench is.
 *
 * Includes the labels, which sit outside the beams — framing on the beams alone
 * pushed every label off the left edge of its cell.
 */
const BENCH_BOX = new THREE.Box3(
  new THREE.Vector3(LABEL_X - 12, -Math.max(...SECTIONS) / 2, BEAMS[0].centerZ - SECTIONS[0]),
  new THREE.Vector3(
    BEAM_LENGTH_MM / 2,
    LABEL_Y + LABEL_HEIGHT,
    BEAMS[BEAMS.length - 1].centerZ + SECTIONS[SECTIONS.length - 1]
  )
);

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

function TextureBench({ material }: { material: MaterialMode }) {
  const params = useTextureStore((state) => state.params);
  const wood = useWoodMaterial(material === "texture" ? params : null);

  if (material === "none") return null;

  return (
    <group>
      {BEAMS.map((beam) =>
        wood ? (
          <mesh
            key={beam.section}
            ref={castsShade}
            geometry={beam.geometry}
            material={wood}
            raycast={() => null}
          />
        ) : (
          <mesh key={beam.section} ref={castsShade} geometry={beam.geometry} raycast={() => null}>
            <meshStandardMaterial color={BLUEPRINT.solid} flatShading />
          </mesh>
        )
      )}
      {BEAMS.map((beam) => (
        <TextSprite
          key={beam.section}
          text={`${beam.section} × ${beam.section}`}
          position={[LABEL_X, LABEL_Y, beam.centerZ]}
          height={LABEL_HEIGHT}
          color={BLUEPRINT.dimText}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// The 3D cell
// ---------------------------------------------------------------------------

const VIEW_DIR = new THREE.Vector3(1, 0.55, 1).normalize();
const FOV = 45;

function TexturePerspectiveView({ cellSize }: { cellSize: CellSize }) {
  const modes = useTextureViewports((state) => state.modes["3d"]);
  const contactShadows = useLookStore((state) => state.contactShadows);

  // The bench never changes shape, so this frames once and then leaves the
  // camera to OrbitControls — there is nothing that could make it want to refit,
  // and refitting on a cell resize would fight the user for the camera.
  const initial = useRef<{ position: [number, number, number]; target: THREE.Vector3 } | null>(null);
  if (!initial.current) {
    const center = BENCH_BOX.getCenter(new THREE.Vector3());
    const radius = BENCH_BOX.getSize(new THREE.Vector3()).length() / 2;
    // the bench is much wider than it is tall, so a cell narrower than it is
    // wide has to pull back further or the beams run off both sides
    const aspect = cellSize.width / Math.max(cellSize.height, 1);
    const vTan = Math.tan((FOV * Math.PI) / 360);
    const distance = (radius / Math.min(vTan, vTan * aspect)) * 1.15;
    initial.current = {
      position: [
        center.x + VIEW_DIR.x * distance,
        center.y + VIEW_DIR.y * distance,
        center.z + VIEW_DIR.z * distance,
      ],
      target: center,
    };
  }

  return (
    <>
      <PerspectiveCamera makeDefault position={initial.current.position} fov={FOV} near={1} far={5000} />
      {/* The shared rig, whose defaults are this bench's old triple: wood is
          judged on how the figure reads across a face, flat ambient light hides
          exactly the sheen the finish control exists to set, and that was the
          best-argued lighting in the app when the three sets were merged into
          one. See `useLookStore`. */}
      <SceneLights />
      {contactShadows && <ContactShade box={BENCH_BOX} floorY={BENCH_BOX.min.y} />}
      <TextureBench material={modes.material} />
      <OrbitControls
        makeDefault
        target={initial.current.target}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
      <AxisTriad position={[BENCH_BOX.min.x, BENCH_BOX.min.y, BENCH_BOX.max.z]} length={40} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The projection cells
// ---------------------------------------------------------------------------

const FIT_PAD_PX = 24;

function TextureOrthographicView({ viewId, cellSize }: { viewId: ViewId; cellSize: CellSize }) {
  const modes = useTextureViewports((state) => state.modes[viewId]);
  const framing = useTextureViewports((state) => state.framing[viewId]);

  const { basis, bounds, radius } = useMemo(() => {
    const { direction, up } = viewCameraBasis(VIEW_AXES[viewId]);
    const right = new THREE.Vector3().crossVectors(up, direction);

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;
    let minW = Infinity, maxW = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? BENCH_BOX.max.x : BENCH_BOX.min.x,
        i & 2 ? BENCH_BOX.max.y : BENCH_BOX.min.y,
        i & 4 ? BENCH_BOX.max.z : BENCH_BOX.min.z
      );
      minU = Math.min(minU, corner.dot(right)); maxU = Math.max(maxU, corner.dot(right));
      minV = Math.min(minV, corner.dot(up)); maxV = Math.max(maxV, corner.dot(up));
      minW = Math.min(minW, corner.dot(direction)); maxW = Math.max(maxW, corner.dot(direction));
    }

    return {
      basis: { right, up, direction },
      bounds: { minU, maxU, minV, maxV, w: (minW + maxW) / 2 },
      radius: Math.hypot(maxU - minU, maxV - minV, maxW - minW) / 2,
    };
  }, [viewId]);

  const { position, target, zoom } = useMemo(() => {
    const { right, up, direction } = basis;
    const availableW = Math.max(cellSize.width - FIT_PAD_PX * 2, 40);
    const availableH = Math.max(cellSize.height - FIT_PAD_PX * 2, 40);
    const fit = Math.min(
      availableW / Math.max(bounds.maxU - bounds.minU, 1e-6),
      availableH / Math.max(bounds.maxV - bounds.minV, 1e-6)
    );
    const zoom = fit * framing.zoom;

    // pan is in screen pixels; through the zoom it becomes world units, so the
    // drawing follows the cursor exactly however far in you are
    const center = new THREE.Vector3()
      .addScaledVector(right, (bounds.minU + bounds.maxU) / 2 - framing.pan.x / zoom)
      .addScaledVector(up, (bounds.minV + bounds.maxV) / 2 + framing.pan.y / zoom)
      .addScaledVector(direction, bounds.w);

    return {
      position: center.clone().addScaledVector(direction, radius * 4),
      target: center,
      zoom,
    };
  }, [basis, bounds, radius, cellSize, framing]);

  // Pinned to the cell's lower-left corner at a fixed screen size, the same
  // trick the editor's projections use — a triad that scaled with the zoom
  // would be either invisible or the whole cell within two wheel clicks.
  const triad = useMemo(() => {
    const inset = 64 / zoom;
    return {
      position: [
        target.x - basis.right.x * (cellSize.width / 2 / zoom - inset) - basis.up.x * (cellSize.height / 2 / zoom - inset),
        target.y - basis.right.y * (cellSize.width / 2 / zoom - inset) - basis.up.y * (cellSize.height / 2 / zoom - inset),
        target.z - basis.right.z * (cellSize.width / 2 / zoom - inset) - basis.up.z * (cellSize.height / 2 / zoom - inset),
      ] as [number, number, number],
      length: 38 / zoom,
    };
  }, [target, basis, zoom, cellSize]);

  return (
    <>
      <OrthographicCamera
        makeDefault
        position={position.toArray()}
        up={basis.up.toArray() as [number, number, number]}
        zoom={zoom}
        near={0.1}
        far={100000}
        onUpdate={(camera) => camera.lookAt(target)}
      />
      <BlueprintGrid
        target={target}
        right={basis.right}
        up={basis.up}
        viewDir={basis.direction}
        zoom={zoom}
        depth={radius * 2}
        size={cellSize}
      />
      {/* the projections are lit too: an unlit fill would show the colours but
          not the sheen, and half of what a finish changes is the sheen */}
      <SceneLights />
      <TextureBench material={modes.material} />
      <AxisTriad position={triad.position} length={triad.length} />
    </>
  );
}

// ---------------------------------------------------------------------------

function renderView(id: ViewportId, size: CellSize) {
  return id === "3d" ? (
    <TexturePerspectiveView cellSize={size} />
  ) : (
    <TextureOrthographicView viewId={id} cellSize={size} />
  );
}

export function TextureViews() {
  const zoomViewport = useTextureViewports((state) => state.zoomViewport);
  const panViewport = useTextureViewports((state) => state.panViewport);

  return (
    <ViewportGrid
      store={useTextureViewports}
      render={renderView}
      onZoom={zoomViewport}
      onPan={panViewport}
    />
  );
}
