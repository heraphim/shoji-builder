import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useComponentEditorStore } from "../store/useComponentEditorStore";
import { combinedBoundingSphere } from "../lib/picking";
import { TextSprite } from "./TextSprite";

const AXES = [
  { dir: [1, 0, 0], color: "#ff6b6b", label: "X" },
  { dir: [0, 1, 0], color: "#4ade80", label: "Y" },
  { dir: [0, 0, 1], color: "#60a5fa", label: "Z" },
] as const;

interface AxisTriadProps {
  // where to draw the triad; defaults to the world origin (3D view)
  position?: [number, number, number];
  // world-space axis length; defaults to scaling with the assembly
  length?: number;
}

// World-axes indicator. Plain scene geometry — unlike drei's GizmoHelper it
// doesn't take over the render loop, which breaks scissored <View> panels.
// Projections pass a corner position + screen-fixed length; the 3D view uses
// the defaults (origin, assembly-scaled).
export function AxisTriad({ position = [0, 0, 0], length: lengthProp }: AxisTriadProps) {
  const meshes = useComponentEditorStore((state) => state.meshes);

  const autoLength = useMemo(() => {
    const sphere = combinedBoundingSphere(meshes);
    return (sphere?.radius ?? 100) * 0.45;
  }, [meshes]);
  const length = lengthProp ?? autoLength;

  const lines = useMemo(() => {
    return AXES.map((axis) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 0, 0, axis.dir[0] * length, axis.dir[1] * length, axis.dir[2] * length], 3)
      );
      return { ...axis, geometry: g };
    });
  }, [length]);

  // in a projection the length is derived from the view's zoom, so this is three
  // new geometries on every wheel tick
  useEffect(() => () => lines.forEach((axis) => axis.geometry.dispose()), [lines]);

  return (
    <group position={position}>
      {lines.map((axis) => (
        <group key={axis.label}>
          <lineSegments geometry={axis.geometry} raycast={() => null}>
            <lineBasicMaterial color={axis.color} depthTest={false} transparent opacity={0.8} />
          </lineSegments>
          <TextSprite
            text={axis.label}
            position={[axis.dir[0] * length * 1.12, axis.dir[1] * length * 1.12, axis.dir[2] * length * 1.12]}
            height={length * 0.14}
            color={axis.color}
          />
        </group>
      ))}
    </group>
  );
}
