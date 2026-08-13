import { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { ShowcaseLamp, lampCameraFit, useLampScene } from "./LampView";
import { SceneLights } from "./SceneLights";
import type { HeroImage } from "../lib/blueprintDoc";

/**
 * A picture of the finished lamp, for the blueprint's title sheet.
 *
 * Everything else in the export is drawn — vector lines written straight into
 * the file, at a stated scale, from boxes. This one thing is a photograph, and
 * the only way to take it is to render it, which is why it is a component at all
 * rather than another function in `lib/`.
 *
 * Four things about how it does that are deliberate:
 *
 * - **Its own canvas**, mounted for the duration and thrown away. The grid's
 *   canvas is shared by four scissored views and has no `preserveDrawingBuffer`,
 *   so reading pixels back off it returns a blank frame — and turning that on for
 *   the whole app would cost every frame of every slider drag to serve one
 *   button. A second context for a second is the cheaper trade.
 * - **It drives the renderer itself, synchronously**, rather than waiting to be
 *   called back. This is the one that took two goes to get right. `useFrame`
 *   rides `requestAnimationFrame`, which a browser does not fire *at all* for a
 *   tab that is not on screen; timers are no better, because a hidden tab
 *   throttles them to about one a second and, after a few minutes, to one a
 *   minute. Either way an export started and then left alone — which is exactly
 *   what somebody does while a file is being written — waits for a frame that
 *   never comes. `frameloop="never"` plus `advance` in an effect renders on
 *   demand, in one task, whether or not anybody is watching.
 * - **It renders more than once.** A program is compiled the first time the
 *   material it belongs to is drawn, so the first pass is the one that builds
 *   them and a later one is the first that could be said to be a picture of the
 *   lamp. Consecutive passes cost milliseconds and remove the question.
 * - **It gives up.** A context that never renders — lost, refused, blocked —
 *   would otherwise leave the export waiting forever on a picture it can do
 *   without. The timeout hands back null and the title sheet falls back to the
 *   pictorial line drawing, which is arguably the more traditional sheet anyway.
 */

// Enough passes for every program in the scene to have been compiled and then
// used. Consecutive, not spaced: see above — nothing here may depend on a
// browser agreeing to call this back.
const SETTLE_PASSES = 3;
// Not a budget — a deadlock breaker for a canvas that never mounts at all, since
// the grab itself is synchronous once it does.
const GIVE_UP_MS = 20000;

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  // A canvas that cannot be read back returns "data:," rather than throwing.
  if (comma < 0 || !dataUrl.startsWith("data:image/jpeg")) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.length > 0 ? out : null;
}

function Grab({
  width,
  height,
  onDone,
}: {
  width: number;
  height: number;
  onDone: (image: HeroImage | null) => void;
}) {
  const gl = useThree((state) => state.gl);
  const advance = useThree((state) => state.advance);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    try {
      // Effects run child-first and siblings in order, so by the time this one
      // runs the lamp above it is mounted and every material it needs exists.
      for (let pass = 0; pass < SETTLE_PASSES; pass++) advance(pass);
      const canvas = gl.domElement;
      // A canvas that has not been given a size yet is still a canvas, and it
      // still encodes — as a blank rectangle at whatever the HTML default is.
      // Refusing it is the difference between a title sheet that falls back to
      // the line drawing and one with an empty grey box where the lamp goes.
      if (canvas.width !== width || canvas.height !== height) {
        done.current(null);
        return;
      }
      const bytes = dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92));
      done.current(bytes ? { jpeg: bytes, width: canvas.width, height: canvas.height } : null);
    } catch {
      done.current(null);
    }
  }, [gl, advance, width, height]);

  return null;
}

export function LampRenderCapture({
  width,
  height,
  background,
  onDone,
}: {
  /** Pixel size of the render. */
  width: number;
  height: number;
  background: string;
  onDone: (image: HeroImage | null) => void;
}) {
  const scene = useLampScene();
  const fit = lampCameraFit(scene, width / height);
  const settled = useRef(false);
  const done = (image: HeroImage | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(image);
  };
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    const timer = setTimeout(() => doneRef.current(null), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      aria-hidden
      style={{ position: "fixed", left: "-20000px", top: 0, width, height, pointerEvents: "none" }}
    >
      <Canvas
        // Nothing renders until `advance` is called — see Grab.
        frameloop="never"
        // dpr 1 so the drawing buffer is exactly the size asked for: the sheet
        // scales the image by its aspect, and a retina-doubled buffer would put
        // four times the bytes in the file for no more detail on paper.
        dpr={1}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
        style={{ width, height }}
        onCreated={({ gl }) => gl.setClearColor(background, 1)}
      >
        <PerspectiveCamera
          makeDefault
          position={fit.position}
          fov={fit.fov}
          near={1}
          far={20000}
          onUpdate={(camera) => camera.lookAt(fit.target)}
        />
        <SceneLights />
        <ShowcaseLamp scene={scene} />
        <Grab width={width} height={height} onDone={done} />
      </Canvas>
    </div>
  );
}
