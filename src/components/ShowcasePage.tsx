import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { LampShowcase3D } from "./LampView";
import { useLampStore } from "../store/useLampStore";
import { useResolvedVariables, useVariablesStore } from "../store/useVariablesStore";
import { isLiteralFormula } from "../store/useComponentEditorStore";
import { assetName } from "../lib/assets";

/**
 * The showcase: the lamp, two measurements, and the way to the workbench.
 *
 * The page the app opens on, and the only one that is not a bench. Everything
 * else in this app is for building a lamp; this is for *having* one — so it
 * shows the model the way a finished piece is looked at, in wood and without a
 * single construction line, and offers the two numbers somebody who is not
 * building it would actually want to change.
 *
 * **Width and Height, not innerWidth and innerHeight.** The variables are the
 * inside of the box the frame is built around, which is the right way to state
 * a lamp you are drawing and the wrong way to describe one you are looking at.
 * Width also carries the depth with it whenever the pair is collapsed, which it
 * is by default — so the footprint stays square under the slider, which is what
 * "width" means about a lamp with four sides.
 *
 * Nothing here is a fifth store. The lamp on the bench *is* the lamp on show:
 * picking one from the list opens it exactly as the file menu would, so walking
 * through to the workbench finds the lamp you were just looking at.
 */

/** The two measurements the showcase offers, in the words a visitor uses. */
const DIMENSIONS = [
  { variable: "innerWidth", label: "Width", min: 60, max: 600 },
  { variable: "innerHeight", label: "Height", min: 80, max: 900 },
] as const;

/** Millimetres per notch. Coarse: this is a slider to play with, not to set by. */
const STEP = 5;

interface DimensionProps {
  label: string;
  variable: string;
  min: number;
  max: number;
  /** What the variable currently resolves to, or undefined if it will not. */
  value: number | undefined;
}

/**
 * One measurement, as a slider and a reading.
 *
 * A slider writes a bare number, so it is offered only where the variable
 * already is one — the same rule the variables table follows. A lamp whose
 * height is written as a formula shows where that formula lands and refuses to
 * be dragged, rather than silently throwing the formula away.
 */
function Dimension({ label, variable, min, max, value }: DimensionProps) {
  const raw = useVariablesStore((state) => state.raw[variable]);
  const setVariable = useVariablesStore((state) => state.setVariable);

  // a design that has never heard of this variable has no row for it, rather
  // than a slider that would invent one on first drag
  if (raw === undefined || value === undefined || !Number.isFinite(value)) return null;
  const driven = !isLiteralFormula(raw);

  return (
    <>
      <span className="showcase-dimension-label">{label}</span>
      <input
        className="showcase-slider"
        type="range"
        min={min}
        max={max}
        step={STEP}
        // a value past either end would snap the thumb there and read as if the
        // lamp were that size
        value={Math.min(max, Math.max(min, value))}
        disabled={driven}
        title={driven ? `${label} is written as a formula — clear it in the editor to drag it` : label}
        onChange={(event) => setVariable(variable, event.target.value)}
      />
      <span className="showcase-dimension-value">{Math.round(value)} mm</span>
    </>
  );
}

/** The lamp library, as a list to pick the one on show from. */
function LampMenu({ onPick }: { onPick: (file: string) => void }) {
  const lampLibrary = useLampStore((state) => state.lampLibrary);
  const lampLibraryError = useLampStore((state) => state.lampLibraryError);

  return (
    <div className="showcase-menu">
      {lampLibrary.length === 0 && (
        <div className="showcase-menu-empty">
          {lampLibraryError ?? "No lamps in the library yet."}
        </div>
      )}
      {lampLibrary.map((file) => (
        <button key={file} type="button" className="showcase-menu-item" onClick={() => onPick(file)}>
          {assetName(file)}
        </button>
      ))}
    </div>
  );
}

export function ShowcasePage({ onOpenEditor }: { onOpenEditor: () => void }) {
  const instances = useLampStore((state) => state.instances);
  const lampLibrary = useLampStore((state) => state.lampLibrary);
  const lampName = useLampStore((state) => state.lampName);
  const error = useLampStore((state) => state.error);
  const loadLampLibrary = useLampStore((state) => state.loadLampLibrary);
  const loadLamp = useLampStore((state) => state.loadLamp);
  const { values } = useResolvedVariables();

  const [listing, setListing] = useState(false);

  useEffect(() => {
    void loadLampLibrary();
  }, [loadLampLibrary]);

  // The first lamp the library offers, and only onto an empty bench: coming back
  // from the workbench must not throw away whatever was being worked on there.
  // A load that fails leaves the bench empty and the listing unchanged, so this
  // does not run again — the error under the name is what says why.
  useEffect(() => {
    if (instances.length > 0 || lampLibrary.length === 0) return;
    void loadLamp(lampLibrary[0]);
  }, [instances.length, lampLibrary, loadLamp]);

  const pick = (file: string) => {
    setListing(false);
    void loadLamp(file);
  };

  return (
    <div className="showcase">
      <Canvas className="showcase-canvas" dpr={[1, 2]}>
        <LampShowcase3D />
      </Canvas>

      {/* the click-away for the lamp list: over the scene, under the chrome, so
          the next click anywhere closes the list instead of orbiting the lamp */}
      {listing && <div className="showcase-backdrop" onClick={() => setListing(false)} />}

      <div className="showcase-name">
        <button
          type="button"
          className="showcase-button"
          aria-haspopup="menu"
          aria-expanded={listing}
          title="Choose which lamp to show"
          onClick={() => setListing((open) => !open)}
        >
          {lampName ?? "Lamp"} <span className="showcase-caret">▾</span>
        </button>
        {listing && <LampMenu onPick={pick} />}
        {error && <div className="showcase-error">{error}</div>}
      </div>

      <button
        type="button"
        className="showcase-button showcase-editor"
        title="Open this lamp on the workbench"
        onClick={onOpenEditor}
      >
        Editor
      </button>

      <div className="showcase-controls">
        {DIMENSIONS.map((dimension) => (
          <Dimension key={dimension.variable} {...dimension} value={values[dimension.variable]} />
        ))}
      </div>
    </div>
  );
}
