import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { SceneLights } from "./SceneLights";
import { useWoodMaterial } from "./PartSurface";
import { Prop } from "./ShowcaseProps";
import { NIGHTSTAND } from "./ShowcaseRoom";
import { useTextureStore } from "../store/useTextureStore";
import { BEAMS } from "../lib/testBeams";
import { buildTextureFile, sanitizeName, textureDisplayName } from "../lib/textureFile";
import { canWriteToRepo, saveLibraryFile } from "../lib/library";
import { FINISH_LABELS, SPECIES_LABELS } from "../lib/wood";
import { freeName, randomWood, woodCandidateName, type WoodCandidate } from "../lib/woodRandom";

/**
 * The Texture Generator: one wood at a time, kept or thrown away.
 *
 * The Textures tab is for *designing* a timber — thirty sliders and a bench of
 * four sticks — and it is the right tool for "make this oak a little redder".
 * It is the wrong tool for filling a library, because thirty sliders is thirty
 * decisions and nobody has thirty opinions about the fortieth board. This tab
 * asks one question instead, over and over: **is this one worth keeping?**
 *
 * So there are two buttons and no sliders. Reject rolls another. Accept writes
 * the file and *then* rolls another, because stopping to admire it would break
 * the only rhythm this page has.
 *
 * What is rolled is in `lib/woodRandom.ts`, and the short version is that it does
 * not roll a wood — it picks one of the ten species and walks away from it, which
 * is the difference between a generator you can sit in front of and one whose
 * output is mostly marble.
 *
 * ## What it is shown on
 *
 * The nightstand out of the showcase, with the Textures bench's four test sticks
 * lying on it. Both, because they answer different questions and a texture that
 * passes one and fails the other is the usual case: the sticks say whether the
 * ring pitch survives being cut to 5 mm and whether the end grain agrees with
 * the sides, and the nightstand says whether it looks like furniture — which is
 * a question about broad figure across a wide panel that no 40 mm post can
 * answer.
 *
 * **In an empty studio, on nothing, under the app's shared rig.** No floor, no
 * room, no blueprint. Everything else on the workbench is drawn on the blueprint
 * blue because it is a drawing you are working on; this is not a drawing, it is
 * a colour judgement, and a blue ground shifts every warm timber towards grey.
 * The one thing on screen that is not the wood is a neutral mid grey, which is
 * what a colour is judged against everywhere else in the world.
 */

/**
 * Where the camera stands, as a direction from the model towards it.
 *
 * Lower than a furniture shot would be. From up here the sticks are four lines
 * on a table and the only face of them you can see is the top; dropped towards
 * the horizon they show a long side each, which is where the figure runs, and
 * the nightstand's front comes into view with them — the one large flat panel in
 * the scene, and the thing a broad cathedral figure is actually judged on.
 */
const VIEW_DIR = new THREE.Vector3(0.75, 0.46, 1).normalize();

const FOV = 40;

/**
 * How much of the frame the stage is allowed to overflow.
 *
 * Under 1, so it does. Framing the bounding sphere exactly puts the corners of
 * an empty box on the edges of the picture and the subject in the middle third,
 * and the subject here is small — a 5 mm stick has to survive being drawn at
 * 900 px across. The nightstand's outer corners leave the frame, which costs
 * nothing: they are the two places on it with the least wood showing.
 */
const FILL = 0.84;

/** A neutral ground for a colour judgement. See the note above. */
const STUDIO = "#3b3b3e";

/**
 * Where the sticks lie on the nightstand's top.
 *
 * Forward and to the right — which is to say *towards the camera*, since the
 * view stands off that corner. A 200 mm stick on a 1114 mm table is a small
 * object however it is framed, and the only lever that costs nothing is which
 * end of the table it is on. Centred, the four of them were a smudge; on the
 * near corner they are close enough to read the 5 mm one.
 */
const STICKS_AT: [number, number] = [300, 285];

/**
 * What the camera frames on.
 *
 * Not the whole nightstand. The bottom third of it is a plinth in shadow that
 * says nothing about a timber, and including it pushes the camera back far
 * enough that the test sticks stop resolving — so the box stops at −430 and the
 * feet run out of frame. Everything a wood is actually judged on is above that
 * line: the top, the front rail, the drawer face, and the four sticks.
 *
 * Written down rather than measured off the loaded model, because the model
 * arrives a frame or two after the camera has to exist, and a camera that
 * re-framed when the nightstand turned up would be a camera that moved under the
 * user. The numbers are the fit `NIGHTSTAND` asks for — 700 mm tall, and the top
 * the app measured at 1114 × 796.
 */
const STAGE = new THREE.Box3(
  new THREE.Vector3(-420, -430, -220),
  new THREE.Vector3(557, 50, 398)
);

/**
 * The sticks, standing on the nightstand's top.
 *
 * `position` rather than a translated geometry, and that is not laziness: the
 * texture is read in object space, so moving the mesh moves the piece without
 * moving the grain — each stick goes on showing the slice of log it was baked
 * from. See `lib/testBeams.ts`. Lifted by its own half-section so all four rest
 * on the same surface rather than sinking to their middles.
 */
function TestSticks({ material }: { material: THREE.Material }) {
  return (
    <>
      {BEAMS.map((beam) => (
        <mesh
          key={beam.section}
          geometry={beam.geometry}
          material={material}
          position={[STICKS_AT[0], beam.section / 2, STICKS_AT[1]]}
        />
      ))}
    </>
  );
}

function GeneratorScene({ candidate }: { candidate: WoodCandidate }) {
  // One material for the life of the page, its uniforms rewritten per candidate.
  // A new material per roll would recompile the program, and the whole appeal of
  // this tab is that the next wood is one click and no wait away.
  const wood = useWoodMaterial(candidate.params)!;

  // Held on the material rather than rebuilt per render: `Prop` re-clones the
  // model whenever the fit's identity changes, and re-cloning a nightstand on
  // every roll would undo the point of holding the material.
  const fit = useMemo(() => ({ ...NIGHTSTAND, dress: {}, fallback: wood }), [wood]);

  const camera = useMemo(() => {
    const centre = STAGE.getCenter(new THREE.Vector3());
    const radius = STAGE.getSize(new THREE.Vector3()).length() / 2;
    const distance = (radius / Math.tan((FOV * Math.PI) / 360)) * FILL;
    return {
      position: [
        centre.x + VIEW_DIR.x * distance,
        centre.y + VIEW_DIR.y * distance,
        centre.z + VIEW_DIR.z * distance,
      ] as [number, number, number],
      target: centre,
    };
  }, []);

  return (
    <>
      <color attach="background" args={[STUDIO]} />
      <PerspectiveCamera makeDefault position={camera.position} fov={FOV} near={5} far={12000} />
      <SceneLights />

      {/* Suspended rather than awaited, so the sticks are on screen while the
          nightstand downloads — which on a cold cache is the difference between
          an empty studio and a slow one. */}
      <Suspense fallback={null}>
        <Prop fit={fit} />
      </Suspense>
      <TestSticks material={wood} />

      {/* Mounted once and never keyed on the candidate. That is the whole of how
          the camera survives a roll: nothing here re-mounts when the wood
          changes, so where you had walked to is where you still are. */}
      <OrbitControls
        makeDefault
        target={camera.target}
        enableDamping
        dampingFactor={0.1}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  );
}

export function TextureGeneratorPage() {
  const library = useTextureStore((state) => state.library);
  const loadLibrary = useTextureStore((state) => state.loadLibrary);

  // The first candidate is rolled once, in a lazy initialiser: rolling it in the
  // render body would hand back a different wood every time React drew the page.
  const [candidate, setCandidate] = useState<WoodCandidate>(randomWood);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connected] = useState(canWriteToRepo);

  // Read for the name check below. Refreshed after every accept, because the
  // second accept has to know about the first.
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const roll = useCallback(() => setCandidate(randomWood()), []);

  // What the file would be called if it were kept. Shown before the press
  // rather than reported after it: the name is part of what is being accepted,
  // and a name you only see in a status line is a name you cannot object to.
  const names = useMemo(() => library.map(textureDisplayName), [library]);
  const name = useMemo(
    () => freeName(sanitizeName(woodCandidateName(candidate)) ?? "wood", names),
    [candidate, names]
  );

  // Guards a double press: the write is a round trip to GitHub, and the second
  // click would otherwise roll a new candidate out from under the first save.
  const busy = useRef(false);

  const accept = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const file = buildTextureFile(name, candidate.species, candidate.finish, candidate.params);
      setNote(await saveLibraryFile("textures", `${name}.texture.json`, file));
      void loadLibrary();
      roll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const reject = () => {
    setError(null);
    setNote(null);
    roll();
  };

  return (
    <div className="generator-page">
      <div className="generator-canvas">
        {/* `dpr` floored above 1 for the same reason the showcase floors it: the
            wood has no resolution of its own — it is a function evaluated per
            fragment — so how much grain resolves is decided by how many
            fragments there are, and the ring anti-aliasing has nothing to work
            with at one sample per pixel. */}
        <Canvas dpr={[1.5, 2]} gl={{ antialias: true }}>
          <GeneratorScene candidate={candidate} />
        </Canvas>
      </div>

      <div className="generator-bar">
        <div className="generator-what">
          <span className="generator-name">{name}</span>
          <span className="generator-detail">
            {SPECIES_LABELS[candidate.species]} · {FINISH_LABELS[candidate.finish]} · seed{" "}
            {candidate.params.seed} · ring {(candidate.params.grainScale * candidate.params.ringThickness).toFixed(1)} mm
          </span>
        </div>

        {/* Its own strip rather than the shared `FileStatusBar`. That one is the
            workbench's "what did the last file action do", and this page does a
            file action every few seconds — it would be shouting over the other
            three tabs all afternoon. */}
        <div className="generator-note">
          {error ? (
            <span className="generator-error">{error}</span>
          ) : note ? (
            <span>{note}</span>
          ) : !connected ? (
            <span className="generator-hint">
              No library token — Accept will download the file instead of committing it.
            </span>
          ) : null}
        </div>

        <div className="generator-actions">
          <button
            type="button"
            className="generator-button reject"
            title="Throw this one away and roll another"
            onClick={reject}
            disabled={saving}
          >
            Reject
          </button>
          <button
            type="button"
            className="generator-button accept"
            title={connected ? `Save as ${name}, then roll another` : `Download ${name}, then roll another`}
            onClick={() => void accept()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
