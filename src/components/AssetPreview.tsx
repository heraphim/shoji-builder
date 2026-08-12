import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PerspectiveCamera, View } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { usePartTexture, useWoodMaterial } from "./PartSurface";
import { BLUEPRINT } from "./UploadedMesh";
import { SceneLights } from "./SceneLights";
import {
  TEXTURE_BEAM,
  centreForSpin,
  componentPreviewGeometry,
  lampPreviewGeometry,
  type Asset,
  type TextureAsset,
} from "../lib/assets";
import type { GrainAxis } from "../lib/wood";

/**
 * The little turning window on an asset card.
 *
 * ## Why it turns
 *
 * A still thumbnail of a box assembly is a rectangle. Every component in this
 * library is a box assembly, so a wall of still thumbnails is a wall of
 * rectangles and the browser is no faster to read than the file names it already
 * has. One slow revolution is what makes a leg tell itself apart from a rail —
 * it costs no interaction, no hover, and nothing to discover.
 *
 * ## Why one canvas for all of them
 *
 * The same trick the view grid uses, for a harder reason: a browser allows a
 * page something like sixteen WebGL contexts, and a canvas per card would run
 * out on the first library worth browsing. So the page has one `<Canvas>` holding
 * nothing but `<View.Port />`, and each card renders a drei `<View>` whose DOM
 * node is the scissor rectangle. Cards are laid out, scrolled and re-flowed as
 * ordinary HTML and the rectangles follow.
 *
 * ## What each kind is drawn as
 *
 * - **component** — the preview baked into the file at save time, which is what
 *   that field is for. No formulas are resolved and no variables are read: this
 *   is the component as it was saved, which is what is in the library.
 * - **lamp** — every part of every instance, placed at the lamp's *own* saved
 *   variables.
 * - **texture** — a 10 × 10 × 200 mm beam with the grain along its length, so
 *   the two small faces are end grain. Which is the whole question a wood is
 *   judged on: the long faces show the figure, the ends show the rings that
 *   produced it, and a preview that cannot show both at once has not shown the
 *   wood. The grain axis is forced rather than taken from the file, exactly as a
 *   part overrides it — see `usePartTexture`.
 */

/** One revolution per twelve seconds: readable, and never the thing moving. */
const TURN_RATE = (Math.PI * 2) / 12;

/** The cards are a fixed shape (see `.asset-preview`), so framing needs no measuring. */
const PREVIEW_ASPECT = 4 / 3;
const FOV = 40;
/** Air around the sweep, so nothing grazes the edge at any point in the turn. */
const FIT_MARGIN = 1.12;

/** The distance that fits a sphere of this radius in the cell, both ways. */
function fitDistance(radius: number): number {
  const vTan = Math.tan((FOV * Math.PI) / 360);
  return (radius / Math.min(vTan, vTan * PREVIEW_ASPECT)) * FIT_MARGIN;
}

function Spin({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * TURN_RATE;
  });
  return <group ref={group}>{children}</group>;
}

/**
 * The geometry for one asset, with the framing distance it wants.
 *
 * Built once per asset and disposed with it: a `BufferGeometry` that has been
 * drawn holds GPU buffers garbage collection will not reclaim, and a browser tab
 * left open on a library is a lot of previews coming and going.
 */
function usePreviewGeometry(asset: Asset): { geometry: THREE.BufferGeometry; distance: number } | null {
  const built = useMemo(() => {
    const geometry =
      asset.kind === "component"
        ? componentPreviewGeometry(asset.solids)
        : asset.kind === "lamp"
          ? lampPreviewGeometry(asset)
          : asset.kind === "texture"
            ? new THREE.BoxGeometry(TEXTURE_BEAM.length, TEXTURE_BEAM.section, TEXTURE_BEAM.section)
            : null;
    if (!geometry) return null;
    return { geometry, distance: fitDistance(centreForSpin(geometry)) };
  }, [asset]);

  useEffect(() => () => built?.geometry.dispose(), [built]);
  return built;
}

/** A component, in whatever it says it is made of. */
function ComponentSolid({
  geometry,
  texture,
  grainAxis,
  solidColor,
}: {
  geometry: THREE.BufferGeometry;
  texture: string | null;
  grainAxis: GrainAxis;
  solidColor: string;
}) {
  const wood = useWoodMaterial(usePartTexture(texture, grainAxis));
  if (wood) return <mesh geometry={geometry} material={wood} raycast={() => null} />;
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial color={solidColor} flatShading />
    </mesh>
  );
}

/** The beam, wearing the texture this card is about. */
function TextureBeam({ asset, geometry }: { asset: TextureAsset; geometry: THREE.BufferGeometry }) {
  const params = useMemo(
    () => ({ ...asset.texture.params, grainAxis: "x" as GrainAxis }),
    [asset.texture.params]
  );
  const wood = useWoodMaterial(params);
  if (!wood) return null;
  return <mesh geometry={geometry} material={wood} raycast={() => null} />;
}

/** Warm timber, the colour the lamp view paints an untextured part. */
const LAMP_PART = "#c08f56";

function PreviewScene({ asset }: { asset: Asset }) {
  const built = usePreviewGeometry(asset);
  if (!built) return null;

  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={[built.distance * 0.62, built.distance * 0.5, built.distance * 0.62]}
        fov={FOV}
        near={built.distance / 100}
        far={built.distance * 10}
        onUpdate={(camera) => camera.lookAt(0, 0, 0)}
      />
      {/* The shared rig, like every other lit cell. The Assets tab has no
          Options panel of its own — it is a library, not an editor — so the
          cards are lit however the tab you came from was left. That is the point
          of one rig: a part browsed here looks like the part on the bench. */}
      <SceneLights />
      <Spin>
        {asset.kind === "component" ? (
          <ComponentSolid
            geometry={built.geometry}
            texture={asset.appearance.texture}
            grainAxis={asset.appearance.grainAxis}
            solidColor={asset.appearance.solidColor}
          />
        ) : asset.kind === "texture" ? (
          <TextureBeam asset={asset} geometry={built.geometry} />
        ) : (
          <mesh geometry={built.geometry} raycast={() => null}>
            <meshStandardMaterial color={LAMP_PART} flatShading />
          </mesh>
        )}
      </Spin>
    </>
  );
}

/**
 * The card's preview window.
 *
 * Anything with nothing to draw — a broken file, a component saved without a
 * preview, a lamp whose components have all gone — says so in the space the
 * model would have used, rather than leaving a hole the size of a thumbnail.
 */
export function AssetPreview({ asset }: { asset: Asset }) {
  const drawable =
    asset.kind === "texture" ||
    (asset.kind === "component" && asset.solids.length > 0) ||
    (asset.kind === "lamp" && asset.instances.length > 0);

  return (
    <div className="asset-preview">
      {drawable ? (
        <View className="view-tracking">
          <PreviewScene asset={asset} />
        </View>
      ) : (
        <span className="asset-preview-empty" style={{ color: BLUEPRINT.lineFaint }}>
          {asset.kind === "broken" ? "unreadable" : "nothing to draw"}
        </span>
      )}
    </div>
  );
}
