import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { OrthographicCamera } from "@react-three/drei";
import { AxisTriad } from "./AxisTriad";
import {
  useComponentEditorStore,
  meshWorldBox,
  subcomponentCount,
  VIEW_AXES,
  type Edge,
  type Vec3,
  type ViewId,
  type SubMesh,
} from "../store/useComponentEditorStore";
import { useVariablesStore } from "../store/useVariablesStore";
import { useEditorViewports, type GeometryMode, type MaterialMode } from "../store/useViewportStore";
import { useLookStore } from "../store/useLookStore";
import { FAINT_OUTLINE_OPACITY, SceneLights, castsShade } from "./SceneLights";
import { viewCameraBasis, combinedBoundingBox } from "../lib/picking";
import { splitVisibleHidden, buildOutlineEdges, parallelEdges, triangleEdges } from "../lib/assembly";
import { resolveVariables } from "../lib/formula";
import type { CellSize } from "./ViewportGrid";
import {
  axisStations,
  buildSpanSolver,
  collectKnownSpans,
  isSolidSpan,
  lineRaycast,
  solidRuns,
  spanKey,
  spanOfEdge,
  stationsAlong,
  type SpanSolver,
} from "../lib/measure";
import {
  dimensionReserve,
  formatLength,
  planDimensions,
  type DimScreenAxis,
  type DimSeg,
} from "../lib/dimensions";
import {
  BLUEPRINT,
  GRID_CELL_MM,
  PickableEdges,
  SelectionOverlays,
  useComponentAppearance,
  useEdgeClassifier,
  useMergedGroups,
  useStatusColors,
} from "./UploadedMesh";
import { TextSprite } from "./TextSprite";

/**
 * One orthographic projection cell — a blueprint of the assembly.
 *
 * Contents, back to front: graph-paper backdrop, hidden-line projection (solid
 * for visible edges, dashed for hidden), drafting-style dimension chains, labels
 * for skew measurements, an invisible pickable copy of the outline, the shared
 * selection overlays, and an axis triad pinned to a cell corner.
 *
 * The three projections are fixed world-axis views (VIEW_AXES): Top looks down
 * +Y, Side along +X, Front along +Z. Re-orienting a component rotates the model,
 * never these cameras, so what "top" means never drifts.
 *
 * Framing, dimension-chain layout and the hidden-line pass:
 * docs/algorithms/projection-and-dimensions.md
 */

type Group = { meshes: SubMesh[]; geometry: THREE.BufferGeometry };

// Graph-paper backdrop in the projection plane, on the same 0.5 mm pitch as the
// 3D view. Decade multiples ride on top of the base pitch so the paper still
// reads once the fine lines fall closer together than they can be drawn — a
// level whose spacing drops below a few pixels is dropped rather than smeared
// into a flat wash.
const GRID_LEVELS = [
  { pitch: GRID_CELL_MM, opacity: 0.14 },
  { pitch: GRID_CELL_MM * 10, opacity: 0.24 },
  { pitch: GRID_CELL_MM * 100, opacity: 0.38 },
];
const MIN_GRID_SPACING_PX = 5;

export function BlueprintGrid({
  target,
  right,
  up,
  viewDir,
  zoom,
  depth,
  size,
}: {
  target: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  viewDir: THREE.Vector3;
  zoom: number;
  depth: number;
  size: CellSize;
}) {
  const levels = useMemo(() => {
    const halfW = size.width / 2 / zoom;
    const halfH = size.height / 2 / zoom;
    // grid lines are anchored to the world origin, not to the camera, so the
    // paper stays put under the drawing while panning
    const uCenter = target.dot(right);
    const vCenter = target.dot(up);
    // pushed behind the model along the view axis; the projection is
    // orthographic, so this only affects depth ordering, not the drawing
    const w = target.dot(viewDir) - depth;

    const toWorld = (u: number, v: number) =>
      new THREE.Vector3()
        .addScaledVector(right, u)
        .addScaledVector(up, v)
        .addScaledVector(viewDir, w);

    return GRID_LEVELS.flatMap(({ pitch, opacity }) => {
      if (pitch * zoom < MIN_GRID_SPACING_PX) return [];
      const positions: number[] = [];
      const pushLine = (u0: number, v0: number, u1: number, v1: number) => {
        const a = toWorld(u0, v0);
        const b = toWorld(u1, v1);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      };

      const uStart = Math.ceil((uCenter - halfW) / pitch);
      const uEnd = Math.floor((uCenter + halfW) / pitch);
      for (let i = uStart; i <= uEnd; i++) {
        pushLine(i * pitch, vCenter - halfH, i * pitch, vCenter + halfH);
      }
      const vStart = Math.ceil((vCenter - halfH) / pitch);
      const vEnd = Math.floor((vCenter + halfH) / pitch);
      for (let i = vStart; i <= vEnd; i++) {
        pushLine(uCenter - halfW, i * pitch, uCenter + halfW, i * pitch);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      return [{ pitch, opacity, geometry }];
    });
  }, [target, right, up, viewDir, zoom, depth, size]);

  // the grid is regenerated for the visible rectangle on every pan and zoom
  useEffect(() => () => levels.forEach((level) => level.geometry.dispose()), [levels]);

  return (
    <>
      {levels.map((level) => (
        <lineSegments key={level.pitch} geometry={level.geometry} raycast={() => null}>
          <lineBasicMaterial
            color={BLUEPRINT.gridSection}
            transparent
            opacity={level.opacity}
            depthWrite={false}
          />
        </lineSegments>
      ))}
    </>
  );
}

// Blueprint-style projection of the whole assembly: solid lines for visible
// edges, dashed for hidden ones — recomputed whenever meshes move (connections)
// or the view direction changes.
//
// Once anything has been measured the lines are coloured by how well each edge
// is pinned down (green set / yellow derived / red neither). That is a separate,
// cheap pass over the finished buffers on purpose: it depends on the
// measurements, and the hidden-line split below must NOT be redone every time
// one is typed.
function ProjectionLines({
  groups,
  viewDir,
  radius,
  mode,
  faint = false,
}: {
  groups: Group[];
  viewDir: THREE.Vector3;
  radius: number;
  mode: Exclude<GeometryMode, "none">;
  /**
   * Standing in for the drawing in "No lines", at the Options panel's asking.
   *
   * Only the visible arrises, quietly, and none of the rest: what the hidden
   * dashes and the status colours are for is measuring, and this is the drawing
   * somebody switched off. The hidden-line pass still runs — it is the only way
   * to get an outline that does not have the far side of the part drawn through
   * the near side — so this is the one setting here that is not free.
   */
  faint?: boolean;
}) {
  const classifier = useEdgeClassifier();
  const {
    visibleGeometry,
    hiddenGeometry,
    visibleSource,
    hiddenSource,
    tessellationGeometry,
    dashSize,
    occluderMaterial,
  } = useMemo(() => {
    // DoubleSide matters: an edge sunk inside a solid (a mortise wall, the far
    // side of a notch) can only be occluded by the *inside* of the face between
    // it and the camera. With the default FrontSide that exit face is culled and
    // the edge would be misreported as directly visible.
    const occluderMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const occluders = groups.map((g) => new THREE.Mesh(g.geometry, occluderMaterial));
    for (const o of occluders) o.updateMatrixWorld();

    const visible: number[] = [];
    const hidden: number[] = [];
    // which model edge each emitted segment was cut from — the hidden-line pass
    // breaks one arris into several pieces, and every piece states the same
    // length, so they all take that edge's status
    const visibleSource: Edge[] = [];
    const hiddenSource: Edge[] = [];
    // the tessellation, when asked for: only the parts of it that are in
    // sight, so it reads as a wireframe of the near side rather than of both
    // sides at once
    const tessellation: number[] = [];
    const sampleStep = radius / 60;
    const surfaceOffset = radius / 2000;
    for (const group of groups) {
      const edges = buildOutlineEdges(group.geometry);
      const split = splitVisibleHidden(edges, occluders, viewDir, sampleStep, surfaceOffset);
      visible.push(...split.visible);
      hidden.push(...split.hidden);
      visibleSource.push(...split.visibleSource);
      hiddenSource.push(...split.hiddenSource);
      edges.dispose();

      if (mode === "allTriangles") {
        // triangleEdges is cached against the solid, so it must not be disposed
        // here the way the throwaway outline above is
        const tris = triangleEdges(group.geometry);
        const triSplit = splitVisibleHidden(tris, occluders, viewDir, sampleStep, surfaceOffset);
        tessellation.push(...triSplit.visible);
      }
    }

    const makeGeometry = (positions: number[]) => {
      if (positions.length === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      return g;
    };
    return {
      visibleGeometry: makeGeometry(visible),
      hiddenGeometry: makeGeometry(hidden),
      visibleSource,
      hiddenSource,
      tessellationGeometry: makeGeometry(tessellation),
      dashSize: radius * 0.03,
      occluderMaterial,
    };
  }, [groups, viewDir, radius, mode]);

  useStatusColors(visibleGeometry, classifier, visibleSource);
  useStatusColors(hiddenGeometry, classifier, hiddenSource);

  const status = !faint && classifier.active;

  // both line geometries are rendered, and both are rebuilt whenever a part
  // moves or the model is turned
  useEffect(
    () => () => {
      visibleGeometry?.dispose();
      hiddenGeometry?.dispose();
      tessellationGeometry?.dispose();
      occluderMaterial.dispose();
    },
    [visibleGeometry, hiddenGeometry, tessellationGeometry, occluderMaterial]
  );

  return (
    <>
      {/* under the outline rather than instead of it — what the tessellation
          adds is the diagonals across a face, and the shape still has to read */}
      {tessellationGeometry && (
        <lineSegments geometry={tessellationGeometry} raycast={() => null}>
          <lineBasicMaterial color={BLUEPRINT.lineFaint} transparent opacity={0.5} />
        </lineSegments>
      )}
      {visibleGeometry && (
        <lineSegments geometry={visibleGeometry} raycast={() => null}>
          {/* `key` remounts the material when the status colouring comes and
              goes: `vertexColors` is a shader define. White, because the
              material colour multiplies the vertex colour. */}
          <lineBasicMaterial
            key={status ? "status" : "plain"}
            color={status ? "#ffffff" : BLUEPRINT.line}
            vertexColors={status}
            transparent={faint}
            opacity={faint ? FAINT_OUTLINE_OPACITY : 1}
          />
        </lineSegments>
      )}
      {!faint && hiddenGeometry && (
        <lineSegments
          geometry={hiddenGeometry}
          raycast={() => null}
          ref={(line) => line?.computeLineDistances()}
        >
          {/* a hidden edge keeps its status colour but stays quieter than the
              visible ones — dashed, and dimmed by the material colour */}
          <lineDashedMaterial
            key={classifier.active ? "status" : "plain"}
            color={classifier.active ? "#8f8f8f" : BLUEPRINT.lineFaint}
            vertexColors={classifier.active}
            dashSize={dashSize}
            gapSize={dashSize * 0.7}
          />
        </lineSegments>
      )}
    </>
  );
}

/**
 * The solids themselves, filled, when the view is set to draw material.
 *
 * A projection is a line drawing by default and the fill is the exception, so
 * this is off unless asked for. What it is good for is reading a crowded
 * assembly as shapes rather than as a mat of arrises — and it is drawn flat, not
 * lit, because a shaded solid in an orthographic projection reads as a 3D view
 * that has gone wrong rather than as a filled drawing.
 *
 * It never raycasts. Edge picking in a projection deliberately reaches hidden
 * edges (dashed lines are part of the drawing), and a fill that could be hit
 * would stand in front of all of them.
 */
function ProjectionFill({ groups, material }: { groups: Group[]; material: MaterialMode }) {
  const { appearance, wood } = useComponentAppearance(material);
  if (material === "none") return null;

  // Lit, on the same rig as every other cell.
  //
  // This fill used to be a flat unlit colour, on the argument that a projection
  // is a drawing and shading a hidden-line elevation only makes the lines harder
  // to read. What that argument misses is the case with no lines in it: a flat
  // fill is one colour with nothing in it at all, so a crowded assembly comes
  // back as a single silhouette and the setting meant to make shapes readable
  // was doing nothing here. The drawing is still one setting away — key and fill
  // at 0 is exactly the flat colour this used to be.
  return (
    <>
      <SceneLights />
      {groups.map((group, i) =>
        wood ? (
          <mesh
            key={i}
            ref={castsShade}
            geometry={group.geometry}
            material={wood}
            raycast={() => null}
          />
        ) : (
          <mesh key={i} ref={castsShade} geometry={group.geometry} raycast={() => null}>
            {/* the polygon offset pushes the surface back a hair so the lines
                drawn on it do not z-fight */}
            <meshStandardMaterial
              color={appearance.solidColor}
              flatShading
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
            />
          </mesh>
        )
      )}
    </>
  );
}

// Dimension chains, drafting-style: every link is terminated by arrowheads and
// extension lines carry each value back to the edge it measures. What a part is
// made of and how big the part is get a margin each — the features chain link by
// link below the drawing and to its left, the overall size rides above it and to
// its right — so no dimension line ever crosses the part and the two kinds of
// number are never told apart by how far out they sit.
//
// All offsets are fixed screen sizes converted through the view's zoom: text
// stays legible at any scale, and a value that has no room at one zoom simply
// appears once the user zooms in.
const DIM_TEXT_PX = 16;
const DIM_GAP_PX = 22; // drawing edge -> dimension line
const DIM_ARROW_PX = 9;
const DIM_OVERRUN_PX = 6; // extension line past the dimension line it serves
// The four of them as the layout wants them. Screen pixels here; the same
// numbers divided by the zoom are the world units it works in.
const DIM_METRICS_PX = {
  text: DIM_TEXT_PX,
  gap: DIM_GAP_PX,
  arrow: DIM_ARROW_PX,
  overrun: DIM_OVERRUN_PX,
};
// how far a chain reaches beyond the drawing — the camera fit gives up this
// strip on all four sides so no value can fall off the edge of the cell
const DIM_RESERVE_PX = dimensionReserve(DIM_METRICS_PX);
// pick radius for a dimension line, in screen pixels
const DIM_PICK_PX = 8;

interface Bounds {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  w: number;
}

// One ad-hoc expression against the current variables, by injecting it under a
// reserved key. Null on any resolver error — the caller then draws "?".
//
// Non-finite counts as an error: resolving without throwing is not enough, since
// `1/0` gives Infinity and `1.2.3` tokenizes to a single NaN number. Both used
// to reach formatLength and render as the literal text "NaN" on the drawing.
function evaluateFormula(formula: string, raw: Record<string, string>): number | null {
  try {
    const value = resolveVariables({ ...raw, __measurement: formula }).__measurement;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

// The guides are measurement targets in their own right: a chain link is the
// distance between two stations whether or not any single edge spans it, which
// is what lets an overall size be set directly. Hovering or clicking one hands
// over to the model edges that state the same span, so a measurement always ends
// up hanging off the part rather than off a line that only exists at this zoom.
function Dimensions({
  right,
  up,
  viewDir,
  zoom,
  bounds,
  uAxis,
  vAxis,
  geometries,
}: {
  right: THREE.Vector3;
  up: THREE.Vector3;
  viewDir: THREE.Vector3;
  zoom: number;
  bounds: Bounds;
  uAxis: DimScreenAxis | null;
  vAxis: DimScreenAxis | null;
  geometries: THREE.BufferGeometry[];
}) {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const connections = useComponentEditorStore((state) => state.connections);
  const measurements = useComponentEditorStore((state) => state.measurements);
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const toggleEdges = useComponentEditorStore((state) => state.toggleEdges);
  const setHoveredEdges = useComponentEditorStore((state) => state.setHoveredEdges);
  const raw = useVariablesStore((state) => state.raw);

  const solver: SpanSolver = useMemo(
    () => buildSpanSolver(collectKnownSpans(measurements)),
    [measurements]
  );

  const runs = useMemo(() => solidRuns(meshes.map(meshWorldBox)), [meshes]);
  // While the parts are still separate there is no whole, so nothing has an
  // overall size yet — only the individual parts do. Joining them is what brings
  // the outer level of the chain into existence.
  const separate = useMemo(() => subcomponentCount(meshes, connections) > 1, [meshes, connections]);

  const drawing = useMemo(() => {
    const { w } = bounds;
    const world = (u: number, v: number) =>
      new THREE.Vector3()
        .addScaledVector(right, u)
        .addScaledVector(up, v)
        .addScaledVector(viewDir, w);

    // Fixed screen sizes divided by the zoom, which is what the layout wants:
    // text stays legible at any scale, and a value that has no room at one zoom
    // simply appears once the user zooms in.
    const metrics = {
      text: DIM_METRICS_PX.text / zoom,
      gap: DIM_METRICS_PX.gap / zoom,
      arrow: DIM_METRICS_PX.arrow / zoom,
      overrun: DIM_METRICS_PX.overrun / zoom,
    };

    const plan = planDimensions({
      bounds,
      uAxis,
      vAxis,
      metrics,
      // While the parts are still separate there is no whole, so nothing has an
      // overall size yet — only the individual parts do. Joining them is what
      // brings the outer level of the chain into existence.
      overall: !separate,
      // A gap between two parts that are not joined yet is not a size — it is
      // just how far apart they happen to be drawn, and it changes the moment
      // they are connected.
      isSolid: (span) => isSolidSpan(runs, span),
      valueFor: (span, length) => {
        const explicit = solver.known.get(spanKey(span));
        const implied = explicit ? null : solver.imply(span);
        const formula = explicit ?? implied;
        if (!formula) {
          return { text: formatLength(length), colour: BLUEPRINT.dimText, underline: false };
        }
        const value = evaluateFormula(formula, raw);
        const shown = value === null ? "?" : formatLength(value);
        // Drafting convention: a value the designer sets or derives is
        // underlined, and a derived one is bracketed as a reference dimension.
        // The colours are the same ones the edges are drawn in — green for a
        // length that was set, yellow for one that follows from what was — so a
        // number and the arris it measures always agree.
        return explicit
          ? { text: shown, colour: BLUEPRINT.known, underline: true }
          : { text: `(${shown})`, colour: BLUEPRINT.implied, underline: true };
      },
    });

    const build = (segments: DimSeg[]) => {
      const positions: number[] = [];
      for (const segment of segments) {
        const a = world(segment.u0, segment.v0);
        const b = world(segment.u1, segment.v1);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      return g;
    };

    return {
      ext: build(plan.extension),
      dim: build(plan.dimension),
      pick: build(plan.guides.map((guide) => guide.pick)),
      guideEdges: plan.guides.map((guide) => ({
        start: world(guide.boundary.u0, guide.boundary.v0).toArray() as Vec3,
        end: world(guide.boundary.u1, guide.boundary.v1).toArray() as Vec3,
      })),
      labels: plan.labels.map((label) => ({
        text: label.text,
        position: world(label.u, label.v).toArray() as Vec3,
        color: label.colour,
        underline: label.underline,
      })),
      textHeight: metrics.text,
    };
  }, [bounds, right, up, viewDir, zoom, uAxis, vAxis, solver, raw, runs, separate]);

  // the layout is rebuilt on every zoom step, so its geometry has to go back
  useEffect(() => {
    return () => {
      drawing.ext.dispose();
      drawing.dim.dispose();
      drawing.pick.dispose();
    };
  }, [drawing]);

  const selecting = pickMode === "selectingEdges";
  const guideAt = (index: number | null | undefined): Edge | null =>
    index == null ? null : drawing.guideEdges[Math.floor(index / 2)] ?? null;

  return (
    <>
      <lineSegments geometry={drawing.ext} raycast={() => null}>
        <lineBasicMaterial color={BLUEPRINT.lineFaint} transparent opacity={0.7} />
      </lineSegments>
      <lineSegments geometry={drawing.dim} raycast={() => null}>
        <lineBasicMaterial color={BLUEPRINT.lineFaint} />
      </lineSegments>
      {selecting && drawing.guideEdges.length > 0 && (
        <lineSegments
          geometry={drawing.pick}
          raycast={lineRaycast(DIM_PICK_PX / zoom)}
          onPointerMove={(event) => {
            event.stopPropagation();
            const edge = guideAt(event.index);
            setHoveredEdges(edge ? parallelEdges(edge, geometries) : []);
          }}
          onPointerOut={() => setHoveredEdges([])}
          onClick={(event) => {
            event.stopPropagation();
            const edge = guideAt(event.index);
            if (edge) toggleEdges(parallelEdges(edge, geometries));
          }}
        >
          <lineBasicMaterial transparent opacity={0} depthWrite={false} />
        </lineSegments>
      )}
      {drawing.labels.map((label, i) => (
        <TextSprite
          key={`${label.text}-${i}`}
          text={label.text}
          position={label.position}
          height={drawing.textHeight}
          color={label.color}
          underline={label.underline}
        />
      ))}
    </>
  );
}

// User-defined measurement values at their edges — underlined, per the
// convention that underlined dimensions are set/derived by the designer while
// plain ones are read off the model.
//
// Only skew edges get one. A span that runs along a world axis is a link of the
// dimension chains in two of the three projections, so labelling it here as well
// puts a second copy of the same number in the middle of the drawing, hanging
// off nothing — that is what a part's thickness looked like in the front view. A
// chamfer or an angled brace spans no axis, belongs to no chain, and would go
// unlabelled in every view if not for this.
function MeasurementLabels({ radius }: { radius: number }) {
  const measurements = useComponentEditorStore((state) => state.measurements);
  const raw = useVariablesStore((state) => state.raw);

  const labels = useMemo(() => {
    const out: Array<{ id: string; text: string; position: Vec3 }> = [];
    for (const m of measurements) {
      const value = evaluateFormula(m.formula, raw);
      const text = value === null ? "?" : formatLength(value);
      for (const edge of m.edges) {
        if (spanOfEdge(edge)) continue;
        out.push({
          id: m.id,
          text,
          position: [
            (edge.start[0] + edge.end[0]) / 2,
            (edge.start[1] + edge.end[1]) / 2 + radius * 0.04,
            (edge.start[2] + edge.end[2]) / 2,
          ],
        });
      }
    }
    return out;
  }, [measurements, raw, radius]);

  return (
    <>
      {labels.map((label, i) => (
        <TextSprite
          key={`${label.id}-${i}`}
          text={label.text}
          position={label.position}
          height={radius * 0.07}
          color={BLUEPRINT.known}
          underline
        />
      ))}
    </>
  );
}

// Which cell corner each projection's triad hugs. The three projections sit
// around the 3D view in the 2x2 grid, so each puts its triad in the corner
// nearest the grid centre — the three triads then cluster at the middle of the
// screen instead of scattering to the outer edges.
const TRIAD_CORNER: Record<ViewId, { u: 1 | -1; v: 1 | -1 }> = {
  top: { u: -1, v: -1 }, // top-right cell -> bottom-left corner
  side: { u: 1, v: 1 }, // bottom-left cell -> top-right corner
  front: { u: -1, v: 1 }, // bottom-right cell -> top-left corner
};

// breathing room around the drawing on the two sides the chains do not use
const FIT_PAD_PX = 18;
// pick radius for a model edge in the projections, in screen pixels
const EDGE_PICK_PX = 6;

/**
 * One projection cell.
 *
 * Framing is on the projected bounding **box**, not the bounding sphere: a
 * sphere is the same size in every view, so framing on it would leave a flat
 * part marooned in the two views that see it edge-on. The dimension chains claim
 * DIM_RESERVE_PX on each of the four sides up front, so no value can fall off
 * the edge of the cell, and because that strip is the same all round the drawing
 * stays centred on the model.
 *
 * @param viewId which fixed world-axis view this cell is — also the key for its
 *        own zoom and pan.
 */
export function OrthographicView({ viewId, cellSize }: { viewId: ViewId; cellSize: CellSize }) {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const orthoZoom = useComponentEditorStore((state) => state.orthoZoom[viewId]);
  const pan = useComponentEditorStore((state) => state.viewPans[viewId]);
  const modelRotation = useComponentEditorStore((state) => state.modelRotation);
  const modes = useEditorViewports((state) => state.modes[viewId]);
  const faintOutline = useLookStore((state) => state.faintOutline);
  const groups = useMergedGroups();
  const geometries = useMemo(() => groups.map((group) => group.geometry), [groups]);
  const size = cellSize;

  // Stations come off the solid itself, once, in world-axis terms — so a
  // feature picked up in one view carries the same station in the others and
  // implied values agree across all three.
  const stations = useMemo(() => axisStations(groups.map((g) => g.geometry)).stations, [groups]);

  const meshIds = meshes.map((m) => m.id).join(",");
  const { basis, bounds, radius, uAxis, vAxis } = useMemo(() => {
    const { direction, up } = viewCameraBasis(VIEW_AXES[viewId]);
    const right = new THREE.Vector3().crossVectors(up, direction);
    const box = combinedBoundingBox(useComponentEditorStore.getState().meshes);

    // extents of the model in this view's own plane — the sphere the 3D view
    // frames on is the same size in every view, which leaves a flat part
    // marooned in the two views that see it edge-on
    let minU = -125, maxU = 125, minV = -125, maxV = 125, minW = -125, maxW = 125;
    if (box) {
      minU = Infinity; maxU = -Infinity;
      minV = Infinity; maxV = -Infinity;
      minW = Infinity; maxW = -Infinity;
      const corner = new THREE.Vector3();
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z
        );
        const u = corner.dot(right);
        const v = corner.dot(up);
        const w = corner.dot(direction);
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        minW = Math.min(minW, w); maxW = Math.max(maxW, w);
      }
    }

    const spanU = Math.max(maxU - minU, 1e-6);
    const spanV = Math.max(maxV - minV, 1e-6);
    const diagonal = Math.hypot(spanU, spanV, Math.max(maxW - minW, 1e-6));

    return {
      basis: { right, up, direction, minW, maxW },
      bounds: { minU, maxU, minV, maxV, w: (minW + maxW) / 2 },
      radius: Math.max(diagonal / 2, 1e-6),
      uAxis: stationsAlong(stations, right),
      vAxis: stationsAlong(stations, up),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, meshIds, modelRotation, stations]);

  const { position, target, zoom } = useMemo(() => {
    const { right, up, direction } = basis;
    const { minU, maxU, minV, maxV, w } = bounds;
    // The drawing plus its dimension chains has to fill the cell: the chains
    // take a fixed strip of pixels on each of the four sides, so the model gets
    // whatever is left over. orthoZoom is this view's own user multiplier
    // (wheel), applied on top of that fit.
    const availableW = Math.max(size.width - FIT_PAD_PX * 2 - DIM_RESERVE_PX * 2, 40);
    const availableH = Math.max(size.height - FIT_PAD_PX * 2 - DIM_RESERVE_PX * 2, 40);
    // floor the extents: a model with no thickness in this view's plane would
    // otherwise divide by zero and hand the camera an infinite zoom, from which
    // every derived position comes back NaN and the cell renders nothing
    const fit = Math.min(
      availableW / Math.max(maxU - minU, 1e-6),
      availableH / Math.max(maxV - minV, 1e-6)
    );
    const zoom = fit * orthoZoom;

    // pan is tracked in screen pixels; dividing by zoom converts to world
    // units so the drawing follows the cursor exactly at any zoom level
    const panOffset = right
      .clone()
      .multiplyScalar(-pan.x / zoom)
      .addScaledVector(up, pan.y / zoom);
    // the reserved strip is the same on every side, so what is drawn is centred
    // on the model itself
    const center = new THREE.Vector3()
      .addScaledVector(right, (minU + maxU) / 2)
      .addScaledVector(up, (minV + maxV) / 2)
      .addScaledVector(direction, w)
      .add(panOffset);

    return {
      position: center.clone().addScaledVector(direction, radius * 4),
      target: center,
      zoom,
    };
  }, [basis, bounds, radius, size, orthoZoom, pan]);

  // triad pinned to the cell corner nearest the grid centre, fixed screen size
  const { triadPosition, triadLength } = useMemo(() => {
    const halfW = size.width / 2 / zoom;
    const halfH = size.height / 2 / zoom;
    const inset = 70 / zoom;
    const { u, v } = TRIAD_CORNER[viewId];
    const corner = target
      .clone()
      .addScaledVector(basis.right, u * (halfW - inset))
      .addScaledVector(basis.up, v * (halfH - inset));
    return {
      triadPosition: corner.toArray() as [number, number, number],
      triadLength: 42 / zoom,
    };
  }, [target, basis, zoom, size, viewId]);

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
        size={size}
      />
      {meshes.length > 0 && <ProjectionFill groups={groups} material={modes.material} />}
      {meshes.length > 0 && (
        <Dimensions
          right={basis.right}
          up={basis.up}
          viewDir={basis.direction}
          zoom={zoom}
          bounds={bounds}
          uAxis={uAxis}
          vAxis={vAxis}
          geometries={geometries}
        />
      )}
      {/* "no lines" skips the hidden-line pass entirely rather than drawing its
          result invisibly — it is the expensive part of a projection, and the
          pickable copy of the outline below is a separate body anyway. Unless
          the Options panel asked for the faint outline, which is the one thing
          that needs the pass back. */}
      {meshes.length > 0 && (modes.geometry !== "none" || faintOutline) && (
        <ProjectionLines
          groups={groups}
          viewDir={basis.direction}
          radius={radius}
          mode={modes.geometry === "none" ? "materialEdges" : modes.geometry}
          faint={modes.geometry === "none"}
        />
      )}
      {meshes.length > 0 && <MeasurementLabels radius={radius} />}
      <PickableEdges groups={groups} threshold={EDGE_PICK_PX / zoom} />
      <SelectionOverlays />
      {modes.showAxes && <AxisTriad position={triadPosition} length={triadLength} />}
    </>
  );
}
