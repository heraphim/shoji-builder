import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import {
  useComponentEditorStore,
  connectionWorldPoint,
  meshGroups,
  edgeKey,
  type Appearance,
  type Vec3,
  type Edge,
  type SubMesh,
  type Connection,
} from "../store/useComponentEditorStore";
import { usePartTexture, useWoodMaterial } from "./PartSurface";
import type { WoodMaterial } from "../lib/woodMaterial";
import {
  getEdgeEndpoints,
  nearestVertexOnFace,
  faceWorldNormal,
  faceWorldTriangle,
  combinedBoundingSphere,
} from "../lib/picking";
import {
  mergeGroupGeometry,
  meshIdForWorldVertex,
  outlineEdges,
  parallelEdges,
  releaseSolid,
  triangleEdges,
} from "../lib/assembly";
import type { GeometryMode, MaterialMode } from "../store/useViewportStore";
import { lineRaycast } from "../lib/measure";
import {
  buildEdgeClassifier,
  edgeStatusColors,
  segmentsOf,
  STATUS_COLOR,
  type EdgeClassifier,
} from "../lib/edgeStatus";

/**
 * The solids themselves, every selection/hover overlay, and the picking hooks
 * shared by all four views.
 *
 * "Uploaded mesh" is historical — what this renders is the *merged* solid of
 * each joined group, so a component that has been connected up draws as one
 * seamless object rather than as its constituent parts.
 *
 * Interaction is deliberately global: overlays are rendered by every view, so
 * hovering an edge in Top highlights it in Front and in 3D too. The one
 * asymmetry is occlusion — see `useOcclusionTest`.
 */

export const BLUEPRINT = {
  line: "#bfe1ff",
  lineFaint: "#5b7fb5",
  // dimension text: near the brightness of the drawing itself. The faint blue
  // the guide lines are drawn in reads as half-erased once it is a numeral
  // rather than a line, and a dimension nobody can read is worse than none.
  dimText: "#d8e9ff",
  fill: "#dbeafe",
  hover: "#ff9f43",
  selected: "#ffcc00",
  highlight: "#ffcc00",
  marker: "#4ade80",
  // how well a length is pinned down — green set, yellow derived, red neither.
  // One convention everywhere: the edges in all four views, the numbers on the
  // dimension chains, and the rows in the sidebar lists.
  known: STATUS_COLOR.known,
  implied: STATUS_COLOR.implied,
  unknown: STATUS_COLOR.unknown,
  // solids are painted in the panel blue (--bp-panel) so the model reads as an
  // opaque blueprint cutout — nothing behind it shows through, and only the
  // edge overlay describes its shape
  solid: "#1e4179",
  gridCell: "#22457c",
  gridSection: "#2d4f8a",
} as const;

// Grid pitch, in mm — the unit the editor works in. Every view draws the same
// 0.5 mm cell so distances read consistently between the 3D view and the
// projections.
export const GRID_CELL_MM = 0.5;

export interface MergedGroup {
  meshes: SubMesh[];
  geometry: THREE.BufferGeometry;
}

// The merged solids are wanted by five separate components — the 3D view, all
// three projections, and the sidebar's implied-values panel — and a per-caller
// useMemo gave each of them its own CSG union of the very same parts. That is
// five unions, five retessellations and five outline extractions per rebuild,
// four of them pure waste, on the slowest path in the app.
//
// So the result is cached here, outside React, against the identities of the
// two store arrays it derives from. Both are replaced wholesale on every edit,
// so reference equality is exactly the right invalidation test.
//
// The cache also gives the geometries an owner, which they previously did not
// have: a BufferGeometry that has been rendered holds GPU buffers that garbage
// collection will not reclaim, so superseded solids leaked one set per rebuild —
// once per frame while dragging a variable slider. Releasing the previous
// generation here is safe because every subscriber re-renders in the same commit
// and asks for the new one; three re-uploads on the (unlikely) chance one is
// drawn again in between.
let mergedCache: {
  meshes: SubMesh[];
  connections: Connection[];
  groups: MergedGroup[];
} | null = null;

function computeMergedGroups(meshes: SubMesh[], connections: Connection[]): MergedGroup[] {
  if (mergedCache && mergedCache.meshes === meshes && mergedCache.connections === connections) {
    return mergedCache.groups;
  }

  const groupIndex = meshGroups(meshes, connections);
  const byGroup = new Map<number, SubMesh[]>();
  for (const mesh of meshes) {
    const g = groupIndex.get(mesh.id)!;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(mesh);
  }
  const groups = Array.from(byGroup.values()).map((groupMeshes) => ({
    meshes: groupMeshes,
    geometry: mergeGroupGeometry(groupMeshes),
  }));

  const superseded = mergedCache?.groups ?? [];
  mergedCache = { meshes, connections, groups };
  for (const group of superseded) releaseSolid(group.geometry);
  return groups;
}

/**
 * Groups (joined subcomponents) with their merged world-space geometry —
 * derived state shared by every view.
 *
 * Every caller gets the *same* geometry objects, which is what the outline cache
 * in assembly.ts already assumed: edge picking identifies an edge by its index
 * into that solid's outline buffer, so two views holding different-but-equal
 * geometries would have been indexing into two different buffers.
 */
export function useMergedGroups(): MergedGroup[] {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const connections = useComponentEditorStore((state) => state.connections);
  return useMemo(() => computeMergedGroups(meshes, connections), [meshes, connections]);
}

/**
 * How well each edge is measured — shared by all four views so an edge reads the
 * same colour wherever it is drawn.
 *
 * Rebuilt only when the measurement list changes, which is also the only thing
 * that can change an answer.
 */
export function useEdgeClassifier(): EdgeClassifier {
  const measurements = useComponentEditorStore((state) => state.measurements);
  return useMemo(() => buildEdgeClassifier(measurements), [measurements]);
}

/**
 * Paint a line geometry by measurement status, in place.
 *
 * The outline of a solid is cached and shared (see `outlineEdges`), and the
 * status of an edge depends on nothing but the measurements — so every consumer
 * wants exactly this attribute and writing it onto the shared geometry is the
 * cheapest correct thing to do. Removed again when nothing has been measured, so
 * the material's own colour takes back over.
 *
 * @param sources the model edge each segment came from; defaults to the
 *        geometry's own segments, which is right for anything not cut up by the
 *        hidden-line pass.
 */
export function useStatusColors(
  geometry: THREE.BufferGeometry | null,
  classifier: EdgeClassifier,
  sources?: Edge[]
): void {
  useMemo(() => {
    if (!geometry) return;
    if (!classifier.active) {
      if (geometry.getAttribute("color")) geometry.deleteAttribute("color");
      return;
    }
    const segments = geometry.attributes.position.count / 2;
    const colors = edgeStatusColors(segments, sources ?? segmentsOf(geometry), classifier);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }, [geometry, classifier, sources]);
}

// Marker radius scales with the assembly so it never dwarfs a small part, and
// markers never raycast so they can't block further picking.
/**
 * How the component on the bench is painted, ready to hand to a mesh.
 *
 * One hook so that the 3D view and the three projections cannot disagree about
 * it — they draw the same component, and a colour that applied in one cell and
 * not the others would be a bug nobody would report as one.
 *
 * The texture is only resolved when the view is actually set to Texture: a
 * component that names a walnut still has to fetch and compile it, and doing
 * that for a view drawing flat blue would be paying for something nobody asked
 * to see.
 */
export function useComponentAppearance(material: MaterialMode): {
  appearance: Appearance;
  wood: WoodMaterial | null;
} {
  const appearance = useComponentEditorStore((state) => state.appearance);
  const params = usePartTexture(
    material === "texture" ? appearance.texture : null,
    appearance.grainAxis
  );
  return { appearance, wood: useWoodMaterial(params) };
}

export function useMarkerRadius(): number {
  const meshes = useComponentEditorStore((state) => state.meshes);
  return useMemo(() => {
    const sphere = combinedBoundingSphere(meshes);
    return (sphere?.radius ?? 30) * 0.015;
  }, [meshes]);
}

export function Marker({ position, color }: { position: Vec3; color: string }) {
  const radius = useMarkerRadius();
  return (
    <mesh position={position} raycast={() => null}>
      <sphereGeometry args={[radius, 12, 12]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

function EdgeLine({ edge, color }: { edge: Edge; color: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([...edge.start, ...edge.end], 3));
    return g;
  }, [edge]);
  // hovered edges change on every pointer move, so this is a new geometry many
  // times a second — each one holding a GPU buffer until it is given back
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={color} depthTest={false} />
    </lineSegments>
  );
}

function FaceHighlight({ triangle }: { triangle: [Vec3, Vec3, Vec3] }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([...triangle[0], ...triangle[1], ...triangle[2]], 3)
    );
    g.computeVertexNormals();
    return g;
  }, [triangle]);
  // one per pointer move while a face pick is armed
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshBasicMaterial
        color={BLUEPRINT.hover}
        transparent
        opacity={0.5}
        side={THREE.DoubleSide}
        depthTest={false}
      />
    </mesh>
  );
}

// Every selection/hover cue in one place, rendered by ALL views (3D and the
// three projections) so highlighting anywhere highlights everywhere.
export function SelectionOverlays() {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const pendingEdges = useComponentEditorStore((state) => state.pendingEdges);
  const measurements = useComponentEditorStore((state) => state.measurements);
  const highlightedMeasurementId = useComponentEditorStore((state) => state.highlightedMeasurementId);
  const connections = useComponentEditorStore((state) => state.connections);
  const highlightedConnectionId = useComponentEditorStore((state) => state.highlightedConnectionId);
  const hoveredEdges = useComponentEditorStore((state) => state.hoveredEdges);
  const hoveredVertex = useComponentEditorStore((state) => state.hoveredVertex);
  const hoveredFace = useComponentEditorStore((state) => state.hoveredFace);
  const pendingConnectA = useComponentEditorStore((state) => state.pendingConnectA);

  const highlightedMeasurement = measurements.find((m) => m.id === highlightedMeasurementId);
  const highlightedConnection = connections.find((c) => c.id === highlightedConnectionId);
  const highlightedPoint = highlightedConnection
    ? connectionWorldPoint(highlightedConnection, meshes)
    : null;

  const connectPicking = pickMode === "connectA" || pickMode === "connectB";

  const pendingAWorld: Vec3 | null = useMemo(() => {
    if (!pendingConnectA) return null;
    const mesh = meshes.find((m) => m.id === pendingConnectA.meshId);
    if (!mesh) return null;
    return [
      pendingConnectA.vertex[0] + mesh.offset[0],
      pendingConnectA.vertex[1] + mesh.offset[1],
      pendingConnectA.vertex[2] + mesh.offset[2],
    ];
  }, [pendingConnectA, meshes]);

  return (
    <group>
      {/* the index is part of the key: two edges of one measurement can end up
          on the same coordinates after a rebuild, and on a duplicate key React
          drops all but one — which reads as part of the measurement having
          disappeared */}
      {pendingEdges.map((edge, i) => (
        <EdgeLine key={`${edgeKey(edge)}#${i}`} edge={edge} color={BLUEPRINT.selected} />
      ))}
      {highlightedMeasurement?.edges.map((edge, i) => (
        <EdgeLine key={`${edgeKey(edge)}#${i}`} edge={edge} color={BLUEPRINT.highlight} />
      ))}
      {pickMode === "selectingEdges" &&
        hoveredEdges.map((edge, i) => (
          <EdgeLine key={`${edgeKey(edge)}#${i}`} edge={edge} color={BLUEPRINT.hover} />
        ))}
      {hoveredFace && pickMode === "selectFace" && <FaceHighlight triangle={hoveredFace.triangle} />}
      {hoveredVertex && connectPicking && <Marker position={hoveredVertex} color={BLUEPRINT.hover} />}
      {pendingAWorld && <Marker position={pendingAWorld} color={BLUEPRINT.selected} />}
      {highlightedPoint && <Marker position={highlightedPoint} color={BLUEPRINT.highlight} />}
    </group>
  );
}

// Whether a point on the solid's surface is hidden from the camera by the solid
// itself. The projections deliberately let hidden edges be picked — dashed lines
// are part of the drawing, and a feature is often clearest from the view that
// only sees it through the part. The 3D view is the opposite case: there is
// nothing dashed in it, so an edge behind the solid is not drawn at all and
// picking one means picking something invisible.
//
// The test is a ray from the surface back to the camera, the same convention the
// hidden-line pass uses, rather than comparing raycast distances — near a
// silhouette the ray grazes a face almost edge-on and the two distances say
// nothing about visibility.
function useOcclusionTest(
  geometries: THREE.BufferGeometry[],
  enabled: boolean
): (point: THREE.Vector3) => boolean {
  const camera = useThree((state) => state.camera);
  const meshes = useComponentEditorStore((state) => state.meshes);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  // lift the ray off the surface it starts on, or every point reports itself
  const surfaceOffset = useMemo(
    () => (combinedBoundingSphere(meshes)?.radius ?? 30) / 2000,
    [meshes]
  );

  const occluders = useMemo(() => {
    if (!enabled) return [];
    // DoubleSide: an edge sunk inside the solid — a mortise wall, the far side
    // of a notch — is only occluded by the *inside* of the face in front of it
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    return geometries.map((geometry) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.updateMatrixWorld();
      return mesh;
    });
  }, [geometries, enabled]);

  // the meshes are throwaway wrappers around geometry owned elsewhere, but the
  // material is ours and is replaced on every rebuild
  useEffect(
    () => () => {
      const material = occluders[0]?.material;
      if (material instanceof THREE.Material) material.dispose();
    },
    [occluders]
  );

  return (point: THREE.Vector3) => {
    if (occluders.length === 0) return false;
    const toCamera = camera.position.clone().sub(point);
    const distance = toCamera.length();
    if (distance < 1e-6) return false;
    toCamera.divideScalar(distance);
    raycaster.set(point.clone().addScaledVector(toCamera, surfaceOffset), toCamera);
    raycaster.far = distance;
    return raycaster.intersectObjects(occluders, false).length > 0;
  };
}

// Edge picking, shared by every view: the 3D view hangs it on the visible edge
// overlay, the projections on an invisible copy of the same outline. Selecting
// an edge is therefore the same act wherever the user does it, and the edges
// that land in the measurement are identical either way.
//
// `geometries` is every group's solid, not just the one being picked: an edge's
// parallels are found across the whole assembly, and the occlusion test has to
// account for parts standing in front of this one.
function useEdgePicking(
  edgesGeometry: THREE.BufferGeometry,
  geometries: THREE.BufferGeometry[],
  occlude = false
) {
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const toggleEdges = useComponentEditorStore((state) => state.toggleEdges);
  const setHoveredEdges = useComponentEditorStore((state) => state.setHoveredEdges);
  const isHidden = useOcclusionTest(geometries, occlude);

  // three reports the point on the picked *segment*, not on the ray, so this is
  // the place on the edge whose visibility decides whether it can be picked
  const edgeFromEvent = (event: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>): Edge | null => {
    if (event.index == null) return null;
    if (isHidden(event.point)) return null;
    const identity = new THREE.Matrix4();
    const { start, end } = getEdgeEndpoints(edgesGeometry, event.index, identity);
    return { start: start.toArray() as Vec3, end: end.toArray() as Vec3 };
  };

  return {
    onPointerMove: (event: ThreeEvent<PointerEvent>) => {
      if (pickMode !== "selectingEdges") return;
      const edge = edgeFromEvent(event);
      // a hidden edge does not swallow the event: whatever is behind it in the
      // hit list still gets its turn
      if (!edge) {
        setHoveredEdges([]);
        return;
      }
      event.stopPropagation();
      setHoveredEdges(parallelEdges(edge, geometries));
    },
    onPointerOut: () => setHoveredEdges([]),
    onClick: (event: ThreeEvent<MouseEvent>) => {
      if (pickMode !== "selectingEdges") return;
      const edge = edgeFromEvent(event);
      if (!edge) return;
      event.stopPropagation();
      toggleEdges(parallelEdges(edge, geometries));
    },
  };
}

function PickableGroupEdges({
  geometry,
  geometries,
  threshold,
}: {
  geometry: THREE.BufferGeometry;
  geometries: THREE.BufferGeometry[];
  threshold: number;
}) {
  const edgesGeometry = outlineEdges(geometry);
  const handlers = useEdgePicking(edgesGeometry, geometries);
  return (
    <lineSegments geometry={edgesGeometry} raycast={lineRaycast(threshold)} {...handlers}>
      {/* invisible: the projection already draws these edges, solid or dashed.
          This copy exists only to be clicked, and it covers hidden edges too so
          a feature can be measured from whichever view shows it best. */}
      <lineBasicMaterial transparent opacity={0} depthWrite={false} />
    </lineSegments>
  );
}

// Edge pick targets for the projections. `threshold` is the pick radius in
// world units — the caller converts a comfortable pixel radius through its own
// zoom, so clicking feels the same in every view at every scale.
export function PickableEdges({
  groups,
  threshold,
}: {
  groups: Array<{ meshes: SubMesh[]; geometry: THREE.BufferGeometry }>;
  threshold: number;
}) {
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const geometries = useMemo(() => groups.map((group) => group.geometry), [groups]);
  if (pickMode !== "selectingEdges") return null;
  return (
    <>
      {groups.map((group) => (
        <PickableGroupEdges
          key={group.meshes.map((m) => m.id).join("+")}
          geometry={group.geometry}
          geometries={geometries}
          threshold={threshold}
        />
      ))}
    </>
  );
}

// One joined subcomponent: merged world-space solid + its edge overlay, with
// all pick interactions.
//
// Both halves are drawn to the view's own settings, and both keep working when
// they are not drawn at all. That is the whole reason picking is separated from
// the overlay here: the outline is the thing an edge pick raycasts against, and
// the solid is the thing a face or vertex pick raycasts against, so turning
// either off for looks would otherwise quietly turn off half the editor. What
// changes with the mode is the material, not whether the body is in the scene.
function GroupView({
  group,
  geometries,
  material,
  geometry: geometryMode,
}: {
  group: { meshes: SubMesh[]; geometry: THREE.BufferGeometry };
  geometries: THREE.BufferGeometry[];
  material: MaterialMode;
  geometry: GeometryMode;
}) {
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const pendingConnectA = useComponentEditorStore((state) => state.pendingConnectA);
  const allMeshes = useComponentEditorStore((state) => state.meshes);
  const connections = useComponentEditorStore((state) => state.connections);

  const pickConnectionVertex = useComponentEditorStore((state) => state.pickConnectionVertex);
  const alignFaceToArmedView = useComponentEditorStore((state) => state.alignFaceToArmedView);
  const setHoveredVertex = useComponentEditorStore((state) => state.setHoveredVertex);
  const setHoveredFace = useComponentEditorStore((state) => state.setHoveredFace);

  const { appearance, wood } = useComponentAppearance(material);

  const edgesGeometry = outlineEdges(group.geometry);
  // The 3D view draws its edges depth-tested, so anything behind the solid is
  // not on screen — and must not be pickable either. With no material drawn
  // there is nothing to be behind: the far side of the part is on screen, so it
  // is fair game, and testing against a solid nobody can see would refuse picks
  // for a reason the user cannot observe.
  const edgePicking = useEdgePicking(edgesGeometry, geometries, material !== "none");
  const classifier = useEdgeClassifier();
  useStatusColors(edgesGeometry, classifier);

  const connectPicking = pickMode === "connectA" || pickMode === "connectB";
  // in connectB, the target must be a separate subcomponent (different group)
  const connectTargetsThisGroup = useMemo(() => {
    if (pickMode === "connectA") return true;
    if (pickMode !== "connectB" || !pendingConnectA) return false;
    const groups = meshGroups(allMeshes, connections);
    const pendingGroup = groups.get(pendingConnectA.meshId);
    return group.meshes.every((m) => groups.get(m.id) !== pendingGroup);
  }, [pickMode, pendingConnectA, allMeshes, connections, group.meshes]);

  const handleMeshMove = (event: ThreeEvent<PointerEvent>) => {
    if (pickMode === "selectFace") {
      event.stopPropagation();
      setHoveredFace({
        normal: faceWorldNormal(event).toArray() as Vec3,
        triangle: faceWorldTriangle(event).map((v) => v.toArray()) as [Vec3, Vec3, Vec3],
      });
    } else if (connectPicking && connectTargetsThisGroup) {
      event.stopPropagation();
      setHoveredVertex(nearestVertexOnFace(event).toArray() as Vec3);
    }
  };

  const handleMeshOut = () => {
    setHoveredFace(null);
    if (connectPicking) setHoveredVertex(null);
  };

  const handleMeshClick = (event: ThreeEvent<MouseEvent>) => {
    if (pickMode === "selectFace") {
      event.stopPropagation();
      alignFaceToArmedView(faceWorldNormal(event));
    } else if (connectPicking && connectTargetsThisGroup) {
      event.stopPropagation();
      const vertex = nearestVertexOnFace(event);
      const meshId = meshIdForWorldVertex(group.meshes, vertex);
      if (meshId) pickConnectionVertex(meshId, vertex);
    }
  };

  const drawFaces = material !== "none";
  const drawOutline = geometryMode !== "none";
  const faceMaterial = drawFaces ? wood : null;
  // With no material, the solid is still in the scene whenever a pick needs it —
  // a face pick has nothing else to hit, and a vertex pick snaps to the corner
  // of the triangle under the cursor. It writes neither colour nor depth, so it
  // is invisible and occludes nothing. Same trick the lamp uses for the pick
  // body a rebate left standing in empty space.
  const faceBody = drawFaces || pickMode === "selectFace" || connectPicking;

  return (
    <group>
      {faceBody && (
        <mesh
          geometry={group.geometry}
          onClick={handleMeshClick}
          onPointerMove={handleMeshMove}
          onPointerOut={handleMeshOut}
          // the wood material is an object this component owns rather than an
          // element R3F builds, so it goes on as a prop; when there is none the
          // prop is left off entirely, because `material={undefined}` would win
          // over the child element below
          {...(faceMaterial ? { material: faceMaterial } : {})}
        >
          {!faceMaterial &&
            (drawFaces ? (
              /* opaque, so the far side of the solid is genuinely hidden; the
                 polygon offset pushes the surface back a hair so the edge
                 overlay drawn on it doesn't z-fight. Also where Texture lands
                 when no texture has been chosen for this component. */
              <meshStandardMaterial
                key="solid"
                color={appearance.solidColor}
                flatShading
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
              />
            ) : (
              <meshBasicMaterial key="pick" colorWrite={false} depthWrite={false} />
            ))}
        </mesh>
      )}
      {/* the tessellation, under the outline rather than instead of it: what it
          adds is the diagonals across a face, and the shape still has to read */}
      {geometryMode === "allTriangles" && (
        <lineSegments geometry={triangleEdges(group.geometry)} raycast={() => null}>
          <lineBasicMaterial color={BLUEPRINT.lineFaint} transparent opacity={0.5} />
        </lineSegments>
      )}
      <lineSegments geometry={edgesGeometry} {...edgePicking}>
        {/* `key` remounts the material when the drawing switches between plain
            blueprint line, measurement status and not-drawn-at-all:
            `vertexColors` is a shader define, and three only rebuilds the
            program on needsUpdate. White, because the material colour multiplies
            the vertex colour. */}
        <lineBasicMaterial
          key={drawOutline ? (classifier.active ? "status" : "plain") : "hidden"}
          color={drawOutline && !classifier.active ? BLUEPRINT.line : "#ffffff"}
          vertexColors={drawOutline && classifier.active}
          transparent={!drawOutline}
          opacity={drawOutline ? 1 : 0}
          depthWrite={drawOutline}
        />
      </lineSegments>
    </group>
  );
}

// All joined subcomponents plus the shared overlays (3D view content).
export function UploadedMesh({
  material,
  geometry,
}: {
  material: MaterialMode;
  geometry: GeometryMode;
}) {
  const groups = useMergedGroups();
  const geometries = useMemo(() => groups.map((group) => group.geometry), [groups]);

  if (groups.length === 0) return null;

  return (
    <group>
      {groups.map((group) => (
        <GroupView
          key={group.meshes.map((m) => m.id).join("+")}
          group={group}
          geometries={geometries}
          material={material}
          geometry={geometry}
        />
      ))}
      <SelectionOverlays />
    </group>
  );
}
