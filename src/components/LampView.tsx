import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useLampStore, type ConnectDraft, type LampPickSource } from "../store/useLampStore";
import { useVariablesStore } from "../store/useVariablesStore";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { boxSize, buildBoxGeometry, pointOfAnchor } from "../lib/blocks";
import { releaseSolid, triangleEdges } from "../lib/assembly";
import { viewCameraBasis } from "../lib/picking";
import { planSymmetryFill, type SymmetryPlan } from "../lib/symmetry";
import { AxisTriad } from "./AxisTriad";
import { BlueprintGrid } from "./OrthographicView";
import { BLUEPRINT } from "./UploadedMesh";
import { usePartTexture, useWoodMaterial } from "./PartSurface";
import { averageWoodColor, outlineColorFor } from "../lib/wood";
import type { CellSize } from "./ViewportGrid";
import { useLampViewports, type ViewportModes } from "../store/useViewportStore";
import { useLookStore } from "../store/useLookStore";
import {
  ContactShade,
  FAINT_OUTLINE_OPACITY,
  SceneLights,
  castsShade,
} from "./SceneLights";
import {
  computeScene,
  identityPlacement,
  localBoxOf,
  outlineOfBoxes,
  pickBoxes,
  projectedEdges,
  snapToFeature,
  type InstanceShape,
  type LampInstance,
  type LampScene,
  type PickBox,
  type Placement,
} from "../lib/lamp";
import {
  DEFAULT_APPEARANCE,
  VIEW_AXES,
  type Edge,
  type Vec3,
  type ViewId,
} from "../store/useComponentEditorStore";

/**
 * The lamp scene: the main box, every inserted component, and the connect pick.
 *
 * The scene is *derived*, never stored — `useLampScene` re-cuts every part from
 * the design variables on each render, so dragging a slider resizes the box and
 * carries everything anchored to it along. Nothing here writes geometry back.
 *
 * A component draws as **one solid**, not as its parts: the parts are a
 * construction detail of the recipe, and drawing each one's box left seam lines
 * across faces that are actually flat. Where a cut has taken a corner away, the
 * missing arrises come back dashed — see `projectedEdges`.
 *
 * The scene is drawn by four cameras, not one: {@link LampSceneContents} is
 * everything in the lamp, and {@link LampScene3D} and {@link LampOrthographicView}
 * are two ways of pointing a camera at it. Picking works the same in all four —
 * every handler works off `event.point`, which is a world coordinate whatever
 * projected onto it — so a joint can be picked in whichever view actually shows
 * the corner.
 */

const LAMP = {
  /** Warm timber, so the shoji parts read as wood against the dark bench. */
  part: "#c08f56",
  /**
   * No longer drawn: an arris is `outlineColorFor` of whatever the part is
   * actually made of, and a third of `part` above lands within a few counts of
   * this. Kept as the record of what that used to be, and of what the derived
   * colour has to keep reproducing for a part that names no colour of its own.
   */
  edge: "#4a2f16",
  /** Construction lines: where the encasing box is, not where material is. */
  projected: "#e6c49a",
  /** The reference box is a ghost: present, pickable, never in the way. */
  box: "#7fb2ff",
  boxEdge: "#5f8fd8",
  // the bench the lamp stands on, in the same blueprint blue the editor uses —
  // one drawing surface across both tabs
  grid: BLUEPRINT.gridCell,
  gridSection: BLUEPRINT.gridSection,
  hover: "#ff9f43",
  source: "#4ade80",
  target: "#ffcc00",
  highlight: "#ffcc00",
  /** The tessellation, when a view asks to see it: quieter than any arris. */
  tessellation: "#8a6b45",
  /** A place the symmetry reaches that something is already standing in. */
  symmetryFilled: "#ffcc00",
  /** One it does not: what pressing the button would add. */
  symmetryOpen: "#4ade80",
} as const;

/**
 * The timber a part with no texture of its own is shown in, in the showcase.
 *
 * Only there. On the benches a component that names no texture is drawn in flat
 * colour, and that is right: it is the honest report that nobody has said what
 * the part is made of. The showcase is not reporting on the design, it is
 * showing the lamp, and a lamp in flat plastic brown shows nothing — so the one
 * view whose whole job is to look like a lamp puts it in wood.
 */
const SHOWCASE_TEXTURE = "basic-pine.texture.json";

/** Grid pitch in mm — a lamp is hundreds of mm, so 10 mm cells read as scale. */
const GRID_CELL_MM = 10;

/** Dash pitch for the construction lines, in mm. */
const DASH_MM = 2;

const VIEW_DIR = new THREE.Vector3(1, 0.55, 1).normalize();
const FOV = 45;
const FIT_MARGIN = 1.35;

/** Everything placed, re-derived from the instances and the current variables. */
function useLampScene(): LampScene {
  const instances = useLampStore((state) => state.instances);
  const raw = useVariablesStore((state) => state.raw);
  return useMemo(() => computeScene(instances, raw), [instances, raw]);
}

// ---------------------------------------------------------------------------
// One component, one solid
// ---------------------------------------------------------------------------

interface InstanceSolid {
  /** Every part in one buffer, in the instance's local frame. */
  geometry: THREE.BufferGeometry;
  /** The outline of their union — no seams where two parts butt flush. */
  outline: THREE.BufferGeometry;
  /** The encasing-box arrises the solid does not reach, ready to draw dashed. */
  projected: THREE.BufferGeometry;
}

/** A `LineSegments` position buffer for a list of segments. */
function lineGeometry(edges: Edge[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const edge of edges) positions.push(...edge.start, ...edge.end);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/**
 * The same, with the `lineDistance` a dashed material needs.
 *
 * Written here rather than by `LineSegments.computeLineDistances()`, which needs
 * the object rather than the geometry and would therefore have to run from a ref
 * after mount. For LineSegments the distance restarts at every pair, so it is
 * just `0, length`.
 */
function dashedGeometry(edges: Edge[]): THREE.BufferGeometry {
  const geometry = lineGeometry(edges);
  const distances: number[] = [];
  for (const edge of edges) {
    distances.push(
      0,
      Math.hypot(
        edge.end[0] - edge.start[0],
        edge.end[1] - edge.start[1],
        edge.end[2] - edge.start[2]
      )
    );
  }
  geometry.setAttribute("lineDistance", new THREE.Float32BufferAttribute(distances, 1));
  return geometry;
}

/**
 * One component's drawable geometry: the parts, their union's outline, and the
 * construction lines for what a cut took away.
 *
 * The parts go into *one* buffer rather than one mesh each — they are drawn with
 * one material and butt flush, so nothing is lost and a ninety-piece kumiko sill
 * costs one draw call instead of ninety. The interior faces stay in the buffer;
 * back-face culling means a coincident pair never both draw, so there is no
 * z-fighting and no reason to pay for a boolean.
 *
 * The *outline* is where the union genuinely matters, and it is computed
 * analytically from the boxes — see `outlineOfBoxes`. Rebuilding it costs well
 * under a millisecond, so a slider drag can afford it every frame.
 */
function buildSolid(shape: InstanceShape): InstanceSolid {
  const parts = shape.boxes.map((box) => {
    const geometry = buildBoxGeometry(boxSize(box));
    geometry.translate(box.min.x, box.min.y, box.min.z);
    return geometry;
  });
  const geometry = mergeGeometries(parts) ?? parts[0];
  for (const part of parts) if (part !== geometry) part.dispose();
  geometry.computeBoundingBox();

  const outline = outlineOfBoxes(shape.boxes);
  return {
    geometry,
    outline: lineGeometry(outline),
    projected: dashedGeometry(projectedEdges(localBoxOf(shape), outline)),
  };
}

/**
 * A component's geometry, rebuilt whenever it is re-cut.
 *
 * A `BufferGeometry` that has been rendered holds GPU buffers garbage collection
 * will not reclaim, so the superseded generation has to be disposed rather than
 * dropped — hence the effect, which runs once React has swapped the new one in.
 */
function useSolid(shape: InstanceShape): InstanceSolid {
  const solid = useMemo(() => buildSolid(shape), [shape]);
  useEffect(
    () => () => {
      // through releaseSolid rather than dispose: a view set to "all triangles"
      // will have cached a wireframe against this geometry, and that buffer has
      // to go back with it
      releaseSolid(solid.geometry);
      solid.outline.dispose();
      solid.projected.dispose();
    },
    [solid]
  );
  return solid;
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

/**
 * Marker radius, in mm and *not* scaled to the model.
 *
 * A pick is a point, and a ball big enough to see from across the lamp covers
 * the very corner it is claiming — at a 7 mm frame it swallowed the part. What
 * makes the pick findable is the three highlighted box lines through it, so the
 * dot itself can stay honest about being a point.
 */
const MARKER_RADIUS_MM = 1;

function Marker({ position, color }: { position: Vec3; color: string }) {
  return (
    <mesh position={position} raycast={() => null}>
      <sphereGeometry args={[MARKER_RADIUS_MM, 16, 12]} />
      {/* depthTest off: a joint is often picked on a face that is turned away,
          and a marker hidden inside the solid is a marker nobody can check */}
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
    </mesh>
  );
}

/**
 * The box lines a pick sits on, drawn over the model.
 *
 * At a corner these are the three arrises meeting there — which is what says
 * *which* corner of *which* part is being joined. Every corner of an assembly
 * looks the same from a step back, and a 1 mm dot cannot tell them apart.
 */
function PickEdges({ edges, color }: { edges: Edge[]; color: string }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    for (const edge of edges) positions.push(...edge.start, ...edge.end);
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return buffer;
  }, [edges]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
    </lineSegments>
  );
}

function Pick({ pick, color }: { pick: { point: Vec3; edges: Edge[] }; color: string }) {
  return (
    <group>
      <PickEdges edges={pick.edges} color={color} />
      <Marker position={pick.point} color={color} />
    </group>
  );
}

interface PickHandlers {
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut: () => void;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}

function sameSource(a: LampPickSource, b: LampPickSource): boolean {
  if (a.kind === "mainBox" || b.kind === "mainBox") return a.kind === b.kind;
  return a.id === b.id;
}

/**
 * Pointer handlers for one pickable body, or null when it is not a legal pick.
 *
 * Attaching no handlers is what takes an object out of the raycast entirely —
 * react-three-fiber only hit-tests objects that listen — so an illegal target
 * can neither be clicked nor stop a click reaching what is behind it. With no
 * connection in flight nothing listens at all, and the scene costs nothing to
 * hover.
 *
 * `yieldToOthers` is for the main box, which encloses everything: its near face
 * is always the first thing a ray meets, so stopping there would make a
 * component standing inside it unpickable. Declining to handle the event lets
 * react-three-fiber carry on to the next, farther object — and since handlers
 * run near-to-far, that farther one is also the last to write, so the part wins.
 *
 * The third click is the odd one: it names the body the part goes onto and
 * nothing more, so its handler is the same as any other and the store simply
 * declines to keep the point. What that click buys is the *next* two — see
 * {@link isolatedTo}.
 */
function usePickHandlers(
  source: LampPickSource,
  boxes: PickBox[],
  placement: Placement,
  yieldToOthers = false
): PickHandlers | null {
  const draft = useLampStore((state) => state.draft);
  const pickPoint = useLampStore((state) => state.pickPoint);
  const setHoveredPick = useLampStore((state) => state.setHoveredPick);

  if (!draft) return null;
  // clicks 1-2 belong to the part being connected, the rest to anything but it
  const wantsSelf = draft.source.length < 2;
  const isSelf = source.kind === "instance" && source.id === draft.instanceId;
  if (wantsSelf !== isSelf) return null;
  // once a target is named, it is the only thing left to click
  if (draft.targetRef && !sameSource(draft.targetRef, source)) return null;

  const yields = (event: ThreeEvent<PointerEvent | MouseEvent>) =>
    yieldToOthers && event.intersections.some((hit) => hit.eventObject !== event.eventObject);

  return {
    onPointerMove: (event) => {
      if (yields(event)) return;
      event.stopPropagation();
      setHoveredPick(snapToFeature(boxes, placement, event.point));
    },
    onPointerOut: () => setHoveredPick(null),
    onClick: (event) => {
      if (yields(event)) return;
      event.stopPropagation();
      pickPoint(source, snapToFeature(boxes, placement, event.point));
    },
  };
}

/**
 * The one body left in sight, or null when everything is.
 *
 * Once the target has been named, the two points still wanted are on it, and a
 * lamp is exactly the kind of assembly where they are behind something — inside
 * the box, or under a part already standing. So everything else stops being
 * drawn until the joint is made. Nothing is deleted and nothing moves; the parts
 * come straight back when the draft ends, whether it committed or was cancelled.
 *
 * The part being connected goes too. Its own two points are already picked, and
 * they keep showing: the pick markers are drawn over the model rather than in it
 * (`depthTest` off), so what was chosen stays legible with the body gone.
 */
function isolatedTo(draft: ConnectDraft | null): LampPickSource | null {
  return draft?.targetRef ?? null;
}

// ---------------------------------------------------------------------------
// Scene contents
// ---------------------------------------------------------------------------

/**
 * The arris cage of a box of this size.
 *
 * Held here rather than inline because it is rebuilt on every variable edit —
 * once per slider frame — and a `BufferGeometry` that has been drawn holds GPU
 * buffers garbage collection will not reclaim. The effect disposes the
 * superseded one as soon as React has swapped it in.
 */
function useBoxEdges(x: number, y: number, z: number): THREE.BufferGeometry {
  const edges = useMemo(() => {
    const geometry = new THREE.BoxGeometry(x, y, z);
    const wire = new THREE.EdgesGeometry(geometry);
    geometry.dispose();
    return wire;
  }, [x, y, z]);
  useEffect(() => () => edges.dispose(), [edges]);
  return edges;
}

/**
 * The design's central reference box, drawn as a translucent ghost.
 *
 * It is not a part — nothing is cut from it — so it is drawn as the hull the
 * parts hang on: faces you can see through and an edge cage that says where it
 * is. `depthWrite` is off so a component inside it is never hidden by it.
 */
function MainBox({ box, modes }: { box: THREE.Box3; modes: ViewportModes }) {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // one box, so no block to name — see LampAnchor
  const boxes = useMemo(() => [{ box, block: null }], [box]);
  const handlers = usePickHandlers({ kind: "mainBox" }, boxes, identityPlacement(), true);
  const edges = useBoxEdges(size.x, size.y, size.z);

  // With no material the ghost's faces go, but the body stays in the scene
  // whenever it is still a legal pick — writing neither colour nor depth, so it
  // is invisible and blocks nothing. The box is what a great many joints are
  // made against, and losing it to a display setting would be losing the target.
  const drawFaces = modes.material !== "none";

  return (
    <group position={[centre.x, centre.y, centre.z]}>
      {(drawFaces || handlers) && (
        <mesh {...(handlers ?? {})}>
          <boxGeometry args={[size.x, size.y, size.z]} />
          <meshBasicMaterial
            color={LAMP.box}
            transparent
            opacity={drawFaces ? (handlers ? 0.14 : 0.06) : 0}
            colorWrite={drawFaces}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {modes.geometry !== "none" && (
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={LAMP.boxEdge} transparent opacity={0.85} />
        </lineSegments>
      )}
    </group>
  );
}

function Instance({
  instance,
  shape,
  placement,
  modes,
  inSymmetry = false,
  plain = false,
}: {
  instance: LampInstance;
  shape: InstanceShape;
  placement: Placement;
  modes: ViewportModes;
  /** Standing in one of the places the previewed symmetry reaches. */
  inSymmetry?: boolean;
  /** No drawing chrome — see {@link LampSceneContents}. */
  plain?: boolean;
}) {
  const highlightedId = useLampStore((state) => state.highlightedId);
  const draft = useLampStore((state) => state.draft);
  // the faint arris is a bench setting, and the showcase is not a bench: it is
  // there to separate two touching parts while you work, and it is the one line
  // left in a view that has been asked for none
  const faintOutline = useLookStore((state) => state.faintOutline) && !plain;
  const solid = useSolid(shape);

  const boxes = useMemo(() => pickBoxes(shape), [shape]);
  const handlers = usePickHandlers({ kind: "instance", id: instance.id }, boxes, placement);

  const lit = highlightedId === instance.id || draft?.instanceId === instance.id || inSymmetry;
  const encasing = localBoxOf(shape);
  const size = encasing.getSize(new THREE.Vector3());
  const centre = encasing.getCenter(new THREE.Vector3());
  const hasProjected = solid.projected.attributes.position.count > 0;

  // What the component file said it was made of, brought through by
  // `parseComponentDef`. The lamp never edits it — dressing a part is the
  // editor's job — it only honours it, so that the one view where the whole
  // assembly is visible is also the one that can show what it will look like.
  const appearance = instance.def.appearance;
  const woodParams = usePartTexture(
    // a highlighted part must read as highlighted, and the surest way to lose
    // that is to paint it in a wood at the same moment
    modes.material === "texture" && !lit
      ? (appearance?.texture ?? (plain ? SHOWCASE_TEXTURE : null))
      : null,
    appearance?.grainAxis
  );
  const wood = useWoodMaterial(woodParams);
  // The editor's default colour is the blueprint fill, which is what a solid
  // means *there*. Read here as "nobody chose one", so the lamp keeps its own
  // warm timber — otherwise every component saved since format 5 would drag the
  // editor's blue into an assembly that has never been a blueprint.
  const chosenColor =
    appearance && appearance.solidColor !== DEFAULT_APPEARANCE.solidColor
      ? appearance.solidColor
      : LAMP.part;

  // The arris, in the part's own timber rather than in one brown for everybody.
  //
  // A fixed dark brown is right for exactly one colour of wood and wrong for the
  // rest of them — on maple it reads as a drawn line laid over the part rather
  // than as the edge of it, and on a painted or blueprint-coloured component it
  // is simply a foreign colour. Taken from the timber it belongs to, the line is
  // the part's own shadow.
  //
  // Whichever colour is actually on the face, so it follows a highlight too: a
  // lit part is drawn in yellow and gets a dark yellow arris, which is the same
  // relationship the rest of the lamp has. The wood's average is the shader's
  // own far-field colour — see `averageWoodColor`.
  const edgeColor = useMemo(
    () =>
      outlineColorFor(
        woodParams ? averageWoodColor(woodParams) : lit ? LAMP.highlight : chosenColor
      ),
    [woodParams, lit, chosenColor]
  );

  return (
    <group
      position={placement.position.toArray()}
      quaternion={placement.quaternion.toArray() as [number, number, number, number]}
    >
      {/* `castsShade` is the whole of what puts a part into the contact shadow;
          everything else in the scene is overlay and stays out of it. */}
      {modes.material !== "none" &&
        (wood ? (
          <mesh ref={castsShade} geometry={solid.geometry} material={wood} />
        ) : (
          <mesh ref={castsShade} geometry={solid.geometry}>
            {/* the polygon offset pushes the surface back a hair so the arris
                overlay drawn on it does not z-fight */}
            <meshStandardMaterial
              color={lit ? LAMP.highlight : chosenColor}
              flatShading
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
            />
          </mesh>
        ))}

      {/* the tessellation, under the arrises rather than instead of them: what
          it adds is the diagonals across a face, and the shape still has to
          read */}
      {modes.geometry === "allTriangles" && (
        <lineSegments geometry={triangleEdges(solid.geometry)} raycast={() => null}>
          <lineBasicMaterial color={LAMP.tessellation} transparent opacity={0.6} />
        </lineSegments>
      )}

      {/* The arrises. In "No lines" they are still what says where one part ends
          and the next begins — two touching parts whose faces are coplanar have
          the same normal and the same colour, so no light reaches them
          differently and nothing but a line can separate them — so the Options
          panel can keep them, quietly, rather than only all or nothing. */}
      {(modes.geometry !== "none" || faintOutline) && (
        <lineSegments geometry={solid.outline}>
          <lineBasicMaterial
            color={edgeColor}
            transparent={modes.geometry === "none"}
            opacity={modes.geometry === "none" ? FAINT_OUTLINE_OPACITY : 1}
          />
        </lineSegments>
      )}

      {/* where a cut took a corner away: the encasing box's missing arrises,
          drawn as construction lines. Their ends are pickable — see pickBoxes. */}
      {hasProjected && modes.geometry !== "none" && (
        <lineSegments geometry={solid.projected}>
          <lineDashedMaterial
            color={LAMP.projected}
            dashSize={DASH_MM}
            gapSize={DASH_MM}
            transparent
            opacity={0.75}
          />
        </lineSegments>
      )}

      {/* The pick body is the ENCASING box, not the solid: a projected corner
          sits in the empty space a rebate left, and nothing on the material can
          be hovered to name it. Invisible — it writes neither colour nor depth —
          but still raycast, because it carries handlers. */}
      {handlers && (
        <mesh position={[centre.x, centre.y, centre.z]} {...handlers}>
          <boxGeometry args={[size.x, size.y, size.z]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
        </mesh>
      )}
    </group>
  );
}

/**
 * Every place a symmetry reaches, drawn on the box while its button is hovered.
 *
 * Drawn for a *spent* symmetry as well as a fillable one, which is the point:
 * once the button has nothing left to add, pointing at it is how you ask "which
 * parts are the set?" — and that is exactly when you can no longer tell by
 * pressing it.
 *
 * A place is a **line** on the box, so a line is what is drawn, with the meeting
 * point marked. Same reasoning as a pick: from a step back every corner of a
 * lamp looks the same, and a dot alone cannot say which one it means. Yellow is
 * a place already standing in, green one the button would fill — the same two
 * colours the connect pick uses for "settled" and "in play".
 */
function SymmetryOverlay({ plan, box }: { plan: SymmetryPlan; box: THREE.Box3 }) {
  const places = useMemo(
    () =>
      plan.slots.map((slot) => ({
        open: slot.occupiedBy === null,
        edge: {
          start: pointOfAnchor(slot.anchors[0], box),
          end: pointOfAnchor(slot.anchors[1], box),
        } as Edge,
      })),
    [plan, box]
  );

  const filled = useMemo(() => places.filter((p) => !p.open).map((p) => p.edge), [places]);
  const open = useMemo(() => places.filter((p) => p.open).map((p) => p.edge), [places]);

  return (
    <group>
      <PickEdges edges={filled} color={LAMP.symmetryFilled} />
      <PickEdges edges={open} color={LAMP.symmetryOpen} />
      {places.map((place, i) => (
        <Marker
          key={i}
          position={place.edge.start}
          color={place.open ? LAMP.symmetryOpen : LAMP.symmetryFilled}
        />
      ))}
    </group>
  );
}

/** The points already picked for the joint in flight, plus the one under the cursor. */
function PickOverlay() {
  const draft = useLampStore((state) => state.draft);
  const hoveredPick = useLampStore((state) => state.hoveredPick);
  if (!draft) return null;

  return (
    <group>
      {draft.source.map((pick, i) => (
        <Pick key={`s${i}`} pick={pick} color={LAMP.source} />
      ))}
      {draft.target.map((pick, i) => (
        <Pick key={`t${i}`} pick={pick} color={LAMP.target} />
      ))}
      {hoveredPick && <Pick pick={hoveredPick} color={LAMP.hover} />}
    </group>
  );
}

/**
 * Distance along {@link VIEW_DIR} at which a box of the given half-extents fills
 * the frustum. Fitting on the box rather than on its circumsphere: the sphere is
 * the same size whichever way the lamp lies, so a tall narrow one would be
 * framed as if it were a ball and end up a sliver in the middle of the view.
 */
function fitDistance(half: THREE.Vector3, aspect: number): number {
  const up0 = Math.abs(VIEW_DIR.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up0, VIEW_DIR).normalize();
  const up = new THREE.Vector3().crossVectors(VIEW_DIR, right).normalize();

  const vTan = Math.tan((FOV * Math.PI) / 360);
  const hTan = vTan * Math.max(aspect, 1e-6);

  const corner = new THREE.Vector3();
  let distance = 1e-6;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? half.x : -half.x, i & 2 ? half.y : -half.y, i & 4 ? half.z : -half.z);
    const w = corner.dot(VIEW_DIR);
    distance = Math.max(
      distance,
      w + Math.abs(corner.dot(up)) / vTan,
      w + Math.abs(corner.dot(right)) / hTan
    );
  }
  return distance * FIT_MARGIN;
}

/**
 * Everything in the lamp, without a camera: the box, the parts, the symmetry
 * preview and the pick.
 *
 * Shared by all four views, so a joint picked in the Top projection is the same
 * act as one picked in 3D and the isolation rule that clears the way for it
 * holds everywhere at once.
 *
 * `plain` is the showcase's view of the same scene: **the lamp and nothing that
 * says it is a drawing**. That is one setting rather than two because the
 * reference box and the faint arris are the same kind of thing — neither is
 * material, both are there to help you place a part, and a view that exists to
 * be looked at wants neither. The parts themselves are unchanged; only the
 * chrome around them goes.
 */
function LampSceneContents({
  scene,
  modes,
  plain = false,
}: {
  scene: LampScene;
  modes: ViewportModes;
  plain?: boolean;
}) {
  const instances = useLampStore((state) => state.instances);
  const symmetryPreview = useLampStore((state) => state.symmetryPreview);
  const hiddenIds = useLampStore((state) => state.hiddenIds);
  const isolated = isolatedTo(useLampStore((state) => state.draft));
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);

  // Derived, not stored: the places are fractions of a box that the variables
  // can resize under them, so they are worked out from the id on every read.
  const preview = useMemo(
    () => (symmetryPreview ? planSymmetryFill(instances, scene.mainBox, symmetryPreview) : null),
    [instances, scene.mainBox, symmetryPreview]
  );
  const inSymmetry = useMemo(
    () => new Set(preview?.slots.map((slot) => slot.occupiedBy).filter((id) => id !== null) ?? []),
    [preview]
  );

  return (
    <>
      {/* While a target is named, it is the only body drawn — the two points
          still to pick are on it, and in a lamp they are usually behind
          something. Not rendering is what clears the way for both the eye and
          the raycast at once. */}
      {!plain && (!isolated || isolated.kind === "mainBox") && (
        <MainBox box={scene.mainBox} modes={modes} />
      )}

      {instances.map((instance) => {
        if (isolated && !(isolated.kind === "instance" && isolated.id === instance.id)) return null;
        // Not drawn at all rather than drawn faintly: taking a part out of the
        // raycast is half of what hiding it is for — the other part is standing
        // in front of the joint you are trying to pick.
        if (hidden.has(instance.id)) return null;
        const shape = scene.shapes.get(instance.id);
        const placement = scene.placements.get(instance.id);
        if (!shape || !placement) return null;
        return (
          <Instance
            key={instance.id}
            instance={instance}
            shape={shape}
            placement={placement}
            modes={modes}
            inSymmetry={inSymmetry.has(instance.id)}
            plain={plain}
          />
        );
      })}

      {preview && <SymmetryOverlay plan={preview} box={scene.mainBox} />}

      <PickOverlay />
    </>
  );
}

/** The box and everything standing in or on it, as one bounding box. */
function overallBox(scene: LampScene): THREE.Box3 {
  const box = scene.mainBox.clone();
  for (const world of scene.worldBoxes.values()) box.union(world);
  return box;
}

/** The lamp in 3/4 view — the cell the lamp is usually looked at in. */
export function LampScene3D({ cellSize }: { cellSize: CellSize }) {
  const instances = useLampStore((state) => state.instances);
  const scene = useLampScene();
  const modes = useLampViewports((state) => state.modes["3d"]);
  const setOrbit = useLampViewports((state) => state.setOrbit);
  const contactShadows = useLookStore((state) => state.contactShadows);

  const overall = useMemo(() => overallBox(scene), [scene]);

  // The framing needs the viewport's aspect, but a resize must not re-frame:
  // the user's orbit is theirs to keep. Same for a variable edit — the camera
  // would be yanked around on every slider frame. So both are read through refs,
  // and only inserting or removing a component re-frames.
  const sizeRef = useRef(cellSize);
  sizeRef.current = cellSize;
  const overallRef = useRef(overall);
  overallRef.current = overall;

  const instanceIds = instances.map((i) => i.id).join(",");
  const { position, target } = useMemo(() => {
    const box = overallRef.current;
    const centre = box.getCenter(new THREE.Vector3());
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

    // An orbit saved against this very set of components comes back instead of a
    // fresh fit — minimising the view and bringing it back is not a reason to
    // re-frame it. Read through getState: this is a starting position, and
    // re-rendering the camera every time the user stops dragging would fight
    // OrbitControls for the camera it is driving.
    const saved = useLampViewports.getState().orbit;
    if (saved && saved.key === instanceIds) {
      return { position: saved.position, target: new THREE.Vector3(...saved.target) };
    }

    const { width, height } = sizeRef.current;
    const distance = fitDistance(half, width / Math.max(height, 1));
    return {
      position: [
        centre.x + VIEW_DIR.x * distance,
        centre.y + VIEW_DIR.y * distance,
        centre.z + VIEW_DIR.z * distance,
      ] as [number, number, number],
      target: centre,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceIds]);

  return (
    <>
      <PerspectiveCamera makeDefault position={position} fov={FOV} near={1} far={20000} />
      <SceneLights />

      {/* 10 mm cells with a heavier line every 100 mm, so the floor reads as a
          scale for a part measured in tens of millimetres */}
      <Grid
        args={[4000, 4000]}
        cellSize={GRID_CELL_MM}
        cellThickness={0.5}
        cellColor={LAMP.grid}
        sectionSize={GRID_CELL_MM * 10}
        sectionThickness={0.9}
        sectionColor={LAMP.gridSection}
        fadeDistance={6000}
        fadeStrength={1.2}
      />

      {/* The lamp stands on the grid, so its own floor is the bench — give or
          take the millimetre the sample lamp's feet hang below it. */}
      {contactShadows && <ContactShade box={overall} floorY={overall.min.y} />}

      <LampSceneContents scene={scene} modes={modes} />

      {/* At the world origin, which is the corner the box is built out from, and
          sized off the lamp rather than left to the triad's own default — that
          one measures the component editor's bench, which is not what is
          standing here. */}
      {modes.showAxes && (
        <AxisTriad length={overall.getSize(new THREE.Vector3()).length() * 0.2} />
      )}

      {/* the same bindings as the editor's 3D cell: drag rotates, wheel zooms,
          wheel-button (middle) drag pans */}
      <OrbitControls
        makeDefault
        target={target}
        enablePan
        enableZoom
        enableRotate
        // where the user left it, so the view survives being minimised. onEnd,
        // not onChange: once per gesture rather than once per frame of one.
        onEnd={(event) => {
          const controls = event?.target as { object: THREE.Camera; target: THREE.Vector3 };
          if (!controls?.object) return;
          setOrbit({
            key: instanceIds,
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
    </>
  );
}

/**
 * How the showcase draws: the timber, and no lines at all.
 *
 * Fixed rather than taken from a viewport store. The four cells on the benches
 * are settings because you are working and have to be able to ask the drawing a
 * different question; the showcase asks one question — what does this lamp look
 * like — and a dropdown that could answer it with a wireframe is a way of
 * getting it wrong.
 */
const SHOWCASE_MODES: ViewportModes = {
  material: "texture",
  geometry: "none",
  showAxes: false,
};

/**
 * The lamp on its own: textured, unlined, standing on nothing.
 *
 * The same scene as the Lamp Design tab's 3D cell and deliberately not the same
 * view of it. There is no grid, no reference box, no triad and no picking —
 * `usePickHandlers` returns nothing with no connect draft in flight, so the
 * parts are not even raycast — which leaves the orbit as the only thing the
 * pointer does here.
 *
 * The pool of shade is unconditional, where the benches leave it to the Options
 * panel. It is what puts the lamp on a floor rather than in front of a colour,
 * and there is no panel in this view to turn it back on with.
 *
 * Framing follows the lamp, not the variables: inserting or opening something
 * refits, while dragging Width refits nothing, so the model grows in the frame
 * the way it would grow on a bench. Same ref trick as {@link LampScene3D}, for
 * the same reason — a resize must not throw the user's orbit away either.
 */
export function LampShowcase3D() {
  const instances = useLampStore((state) => state.instances);
  const scene = useLampScene();
  const size = useThree((state) => state.size);

  const overall = useMemo(() => overallBox(scene), [scene]);

  const sizeRef = useRef(size);
  sizeRef.current = size;
  const overallRef = useRef(overall);
  overallRef.current = overall;

  const instanceIds = instances.map((i) => i.id).join(",");
  const { position, target } = useMemo(() => {
    const box = overallRef.current;
    const centre = box.getCenter(new THREE.Vector3());
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const { width, height } = sizeRef.current;
    const distance = fitDistance(half, width / Math.max(height, 1));
    return {
      position: [
        centre.x + VIEW_DIR.x * distance,
        centre.y + VIEW_DIR.y * distance,
        centre.z + VIEW_DIR.z * distance,
      ] as [number, number, number],
      target: centre,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceIds]);

  return (
    <>
      <PerspectiveCamera makeDefault position={position} fov={FOV} near={1} far={20000} />
      <SceneLights />
      <ContactShade box={overall} floorY={overall.min.y} />
      <LampSceneContents scene={scene} modes={SHOWCASE_MODES} plain />
      <OrbitControls
        makeDefault
        target={target}
        enablePan={false}
        enableZoom
        enableRotate
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
      />
    </>
  );
}

// breathing room around the lamp once it fills the cell
const ORTHO_PAD_PX = 24;

// Which cell corner each projection's triad hugs in the default 2x2 layout —
// the corner nearest the middle of the grid, so the three triads cluster there
// instead of scattering to the outer edges.
const TRIAD_CORNER: Record<ViewId, { u: 1 | -1; v: 1 | -1 }> = {
  top: { u: -1, v: -1 },
  side: { u: 1, v: 1 },
  front: { u: -1, v: 1 },
};

/**
 * One orthographic projection of the lamp — Top looks down +Y, Side along +X,
 * Front along +Z, the same three fixed world views the editor uses.
 *
 * Deliberately *not* the editor's blueprint projection. That one exists to be
 * measured: hidden-line removal, dimension chains, edge status colouring. A lamp
 * has no measurements on it, and what these views are for is placing parts
 * square — seeing that a rail lines up with the one below it, which a 3/4 view
 * is the worst possible way to check. So they are the same scene as the 3D cell
 * seen straight on, with the depth buffer left to sort out what is in front of
 * what.
 *
 * That is also why the material default here is solid rather than none: without
 * faces to occlude them, the far side of the lamp draws through the near side
 * and a kumiko panel becomes an unreadable mat of lines.
 */
export function LampOrthographicView({
  viewId,
  cellSize,
}: {
  viewId: ViewId;
  cellSize: CellSize;
}) {
  const scene = useLampScene();
  const modes = useLampViewports((state) => state.modes[viewId]);
  const framing = useLampViewports((state) => state.framing[viewId]);

  const overall = useMemo(() => overallBox(scene), [scene]);

  const { basis, bounds, radius } = useMemo(() => {
    const { direction, up } = viewCameraBasis(VIEW_AXES[viewId]);
    const right = new THREE.Vector3().crossVectors(up, direction);

    // extents in this view's own plane. Fitting on the projected box rather than
    // on a bounding sphere: the sphere is the same size in every view, which
    // would leave a flat lamp marooned in the two that see it edge-on.
    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;
    let minW = Infinity, maxW = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? overall.max.x : overall.min.x,
        i & 2 ? overall.max.y : overall.min.y,
        i & 4 ? overall.max.z : overall.min.z
      );
      const u = corner.dot(right);
      const v = corner.dot(up);
      const w = corner.dot(direction);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      minW = Math.min(minW, w); maxW = Math.max(maxW, w);
    }

    const diagonal = Math.hypot(
      Math.max(maxU - minU, 1e-6),
      Math.max(maxV - minV, 1e-6),
      Math.max(maxW - minW, 1e-6)
    );
    return {
      basis: { right, up, direction },
      bounds: { minU, maxU, minV, maxV, w: (minW + maxW) / 2 },
      radius: Math.max(diagonal / 2, 1e-6),
    };
  }, [viewId, overall]);

  const { position, target, zoom } = useMemo(() => {
    const { right, up, direction } = basis;
    const { minU, maxU, minV, maxV, w } = bounds;
    const availableW = Math.max(cellSize.width - ORTHO_PAD_PX * 2, 40);
    const availableH = Math.max(cellSize.height - ORTHO_PAD_PX * 2, 40);
    // floor the extents: a lamp with no thickness in this view's plane would
    // otherwise divide by zero and hand the camera an infinite zoom, from which
    // every derived position comes back NaN and the cell renders nothing
    const fit = Math.min(
      availableW / Math.max(maxU - minU, 1e-6),
      availableH / Math.max(maxV - minV, 1e-6)
    );
    const zoom = fit * framing.zoom;

    // pan is tracked in screen pixels; dividing by zoom converts to world units
    // so the drawing follows the cursor exactly at any zoom level
    const centre = new THREE.Vector3()
      .addScaledVector(right, (minU + maxU) / 2)
      .addScaledVector(up, (minV + maxV) / 2)
      .addScaledVector(direction, w)
      .addScaledVector(right, -framing.pan.x / zoom)
      .addScaledVector(up, framing.pan.y / zoom);

    return {
      position: centre.clone().addScaledVector(direction, radius * 4),
      target: centre,
      zoom,
    };
  }, [basis, bounds, radius, cellSize, framing]);

  // triad pinned to a cell corner, at a fixed screen size
  const { triadPosition, triadLength } = useMemo(() => {
    const inset = 70 / zoom;
    const { u, v } = TRIAD_CORNER[viewId];
    const corner = target
      .clone()
      .addScaledVector(basis.right, u * (cellSize.width / 2 / zoom - inset))
      .addScaledVector(basis.up, v * (cellSize.height / 2 / zoom - inset));
    return { triadPosition: corner.toArray() as Vec3, triadLength: 42 / zoom };
  }, [target, basis, zoom, cellSize, viewId]);

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
      {/* The same rig as every other cell. This used to be a flat ambient 1.1
          and nothing else, on the argument that an orthographic view with
          directional shading reads as a 3D view that has gone wrong — but the
          flat version is also the one where a solid has nothing in it but a
          silhouette, which is the whole of why the Options panel exists. The
          drawing is still one setting away: key and fill at 0 with ambient up
          is exactly what was here before. */}
      <SceneLights />
      <BlueprintGrid
        target={target}
        right={basis.right}
        up={basis.up}
        viewDir={basis.direction}
        zoom={zoom}
        depth={radius * 2}
        size={cellSize}
      />
      <LampSceneContents scene={scene} modes={modes} />
      {modes.showAxes && <AxisTriad position={triadPosition} length={triadLength} />}
    </>
  );
}
