import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { RealisticShowcase } from "./ShowcaseScene";
import { LOADING_STAGES, ShowcaseLoading } from "./ShowcaseLoading";
import { useLampStore } from "../store/useLampStore";
import { useResolvedVariables, useVariablesStore } from "../store/useVariablesStore";
import { isLiteralFormula } from "../store/useComponentEditorStore";
import { assetName } from "../lib/assets";
import { siteUrl } from "../lib/library";
import {
  DEFAULT_SHOWCASE_STYLE,
  OUTSIDE_LABELS,
  SHOWCASE_STYLES,
  nextOutside,
  showcaseStyle,
  type OutsideLight,
  type ShowcaseStyleId,
} from "../lib/showcaseStyles";

/**
 * The showcase: the lamp in a room, two measurements, and the way to the bench.
 *
 * The page the app opens on, and the only one that is not a bench. Everything
 * else in this app is for building a lamp; this is for *having* one — so it
 * shows the model the way a finished piece is looked at, standing on a
 * nightstand in the dark with the light on, and offers the two numbers somebody
 * who is not building it would actually want to change.
 *
 * **Width and Height, not innerWidth and innerHeight.** The variables are the
 * inside of the box the frame is built around, which is the right way to state a
 * lamp you are drawing and the wrong way to describe one you are looking at.
 * Width also carries the depth with it whenever the pair is collapsed, which it
 * is by default — so the footprint stays square under the slider, which is what
 * "width" means about a lamp with four sides.
 *
 * Nothing here is a fifth store. The lamp on the bench *is* the lamp on show:
 * picking one from the list opens it exactly as the file menu would, so walking
 * through to the workbench finds the lamp you were just looking at. The style is
 * the one piece of state this page owns, and it is `useState` rather than a
 * store because nothing outside this page has ever needed to know it.
 *
 * ## Made to be held
 *
 * The chrome is three things pinned to the edges of one full-bleed canvas, and
 * every one of them is sized to survive a phone: the bar wraps, the sliders sit
 * above the home indicator (`env(safe-area-inset-bottom)`), and the page is
 * `100dvh` so that the browser's own address bar cannot push the controls off
 * the bottom of the screen — which is exactly what `100vh` does on iOS.
 */

/** The two measurements the showcase offers, in the words a visitor uses. */
const DIMENSIONS = [
  { variable: "innerWidth", label: "Width", min: 60, max: 600 },
  { variable: "innerHeight", label: "Height", min: 80, max: 900 },
] as const;

/** Millimetres per notch. Coarse: this is a slider to play with, not to set by. */
const STEP = 5;

/**
 * Where the lamp is turned up to when the page opens.
 *
 * A fifth. A shoji lantern is a bedside light and the room it is in should still
 * be a dark one — at anything like full the lamp stops being a lamp in a room and
 * becomes the room's lighting. The range runs past 1 all the same: the top of a
 * slider ought to be brighter than anybody would leave it.
 */
const DEFAULT_GLOW = 0.2;

/**
 * Below this the layout is a phone's: the bar tightens and the scene drops its
 * multisampling and halves its shadow map.
 *
 * A width rather than a user-agent test, because what actually matters is how
 * many pixels the chrome has to fit into and how many the GPU has to fill, and a
 * narrow window on a desktop is the same problem.
 */
const COMPACT_PX = 720;

function useCompact(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.innerWidth < COMPACT_PX
  );

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${COMPACT_PX - 1}px)`);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return compact;
}

/**
 * A bulb, drawn once and turned two ways.
 *
 * The glass is a path either filled or hollow, which is the whole of the on/off
 * cue and the reason both switches can be the same drawing: a filled bulb reads
 * as lit at 18 px, and nothing else does.
 *
 * `hanging` adds the ceiling rose and the flex above it — the only thing that
 * distinguishes the pendant from the lamp on the table, and enough of one that
 * neither needs a label.
 */
function BulbIcon({ hanging }: { hanging?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      {hanging && (
        <path
          d="M4 2.5h16M12 2.5v3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
      <path
        d={
          hanging
            ? "M12 5.7a5.4 5.4 0 0 0-3.1 9.8v1.6h6.2v-1.6A5.4 5.4 0 0 0 12 5.7Z"
            : "M12 2.6a6 6 0 0 0-3.4 10.9v1.9h6.8v-1.9A6 6 0 0 0 12 2.6Z"
        }
        fill="currentColor"
        fillOpacity="var(--bulb-glass, 0)"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d={hanging ? "M9.4 19h5.2M10.2 21.3h3.6" : "M8.9 18.2h6.2M9.8 21h4.4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * What is outside, as one drawing per state.
 *
 * Three separate glyphs rather than one glyph in three colours, because these
 * are not three intensities of the same thing — an afternoon and a sodium lamp
 * are different light, and the control has to say which you are about to get
 * before you press it rather than after.
 */
function OutsideIcon({ mode }: { mode: OutsideLight }) {
  if (mode === "street") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M6.5 7.5h7l1.6 3.4H4.9L6.5 7.5Z" fill="currentColor" />
        <path
          d="M10 10.9v2.4a3.6 3.6 0 0 0 3.6 3.6H16a3 3 0 0 1 3 3v1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path d="M8.4 12.6h3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.75" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="4.2" y="3.4" width="15.6" height="17.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3.4v17.2M4.2 12h15.6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.7" />
    </svg>
  );
}

/**
 * Zen, as the glyph every full-screen control in the world uses.
 *
 * It was a diamond, which said nothing: a symbol has to be one somebody has
 * seen before, and nobody has ever pressed a diamond to hide a toolbar. Four
 * corner brackets pointing out is *give this the whole screen*, and the same
 * brackets pointing in is *give it back* — the same pair on every video player
 * and every map.
 */
function ZenIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <path
        d={
          open
            ? "M9.4 3.6H5.2a1.6 1.6 0 0 0-1.6 1.6v4.2M14.6 3.6h4.2a1.6 1.6 0 0 1 1.6 1.6v4.2M20.4 14.6v4.2a1.6 1.6 0 0 1-1.6 1.6h-4.2M3.6 14.6v4.2a1.6 1.6 0 0 0 1.6 1.6h4.2"
            : "M3.6 9.4V5.2a1.6 1.6 0 0 1 1.6-1.6h4.2M20.4 9.4V5.2a1.6 1.6 0 0 0-1.6-1.6h-4.2M14.6 20.4h4.2a1.6 1.6 0 0 0 1.6-1.6v-4.2M9.4 20.4H5.2a1.6 1.6 0 0 1-1.6-1.6v-4.2"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One light, as a switch. */
function LightSwitch({
  on,
  hanging,
  label,
  onToggle,
}: {
  on: boolean;
  hanging?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={"showcase-icon" + (on ? " on" : "")}
      aria-pressed={on}
      title={`${label} — ${on ? "on" : "off"}`}
      aria-label={label}
      onClick={onToggle}
    >
      <BulbIcon hanging={hanging} />
    </button>
  );
}

/**
 * How ready the showcase is, as a number between 0 and 1.
 *
 * Five milestones, weighted equally, because what a visitor wants from a
 * progress reading is *is it moving* rather than a calibrated fraction of the
 * bytes. Weighting them by how long each really takes would be more honest and
 * less useful: the slow one is the last one, and a bar that sits at 30% while
 * the shaders compile is a bar nobody believes.
 *
 * The reveal is one-way. Every input here can flicker \— loading a different lamp
 * empties the instance list for a frame \— and a loading screen that comes back
 * because you changed your mind about which lamp to look at is a bug wearing a
 * feature's clothes.
 */
function useShowcaseProgress(painted: boolean, drawn: boolean) {
  const loaded = useVariablesStore((state) => state.loaded);
  const library = useLampStore((state) => state.lampLibrary.length > 0);
  const parts = useLampStore((state) => state.instances.length > 0);
  const error = useLampStore((state) => state.error);
  const libraryError = useLampStore((state) => state.lampLibraryError);

  // Whatever cannot be waited for any longer. A library that is not there and a
  // lamp that would not parse are answers, not stalls, and the page behind this
  // one says so far better than a screen that never goes away.
  const done = [loaded, library || !!libraryError, parts || !!error, painted, drawn];
  const reached = useRef(0);
  reached.current = Math.max(reached.current, done.filter(Boolean).length);

  const stage = LOADING_STAGES[Math.min(reached.current, LOADING_STAGES.length - 1)];
  return { progress: reached.current / done.length, stage };
}

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

/**
 * The styles, as a list.
 *
 * The ones that are not drawn yet are still on it, disabled. A menu that only
 * showed what works today would answer "what else can this do" with silence, and
 * the answer is the whole reason there is a menu rather than one picture.
 */
function StyleMenu({
  current,
  onPick,
}: {
  current: ShowcaseStyleId;
  onPick: (id: ShowcaseStyleId) => void;
}) {
  return (
    <div className="showcase-menu showcase-menu-wide">
      {SHOWCASE_STYLES.map((style) => (
        <button
          key={style.id}
          type="button"
          className={"showcase-menu-item" + (style.id === current ? " current" : "")}
          disabled={!style.built}
          title={style.built ? style.note : `${style.note} — not built yet`}
          onClick={() => onPick(style.id)}
        >
          <span className="showcase-menu-label">{style.label}</span>
          {!style.built && <span className="showcase-menu-tag">soon</span>}
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
  const compact = useCompact();

  const [style, setStyle] = useState<ShowcaseStyleId>(DEFAULT_SHOWCASE_STYLE);
  const [menu, setMenu] = useState<"lamp" | "style" | null>(null);
  // The lamp lit and the room dark: the state the whole thing was designed for,
  // and the one where turning the ceiling on is a change worth making.
  const [lampOn, setLampOn] = useState(true);
  const [ceilingOn, setCeilingOn] = useState(false);
  // Lamp on, street lamp on: the picture the whole style was built for, so it is
  // the one you land on rather than one you have to press two buttons to reach.
  const [outside, setOutside] = useState<OutsideLight>("street");
  const [glow, setGlow] = useState(DEFAULT_GLOW);
  const [zen, setZen] = useState(false);
  const [painted, setPainted] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { progress, stage } = useShowcaseProgress(painted, drawn);

  // The painting is the one asset with a real download behind it. Fetched here
  // as well as in the room so that the loading screen has something to wait for;
  // the room's own loader then finds it in the browser cache, which is the
  // cheapest possible way to share it and needs no plumbing between the two.
  useEffect(() => {
    const image = new Image();
    const finish = () => setPainted(true);
    image.onload = finish;
    image.onerror = finish;
    image.src = siteUrl("painting.png");
  }, []);

  // A backstop. Every milestone above can fail to arrive for a reason nobody
  // predicted \— a driver that will not give a WebGL context, a fetch that hangs
  // \— and a loading screen is the one piece of UI where a bug means the app is
  // simply gone. After this it lifts regardless and whatever is behind it,
  // working or broken, is at least on screen and says so.
  useEffect(() => {
    const timer = window.setTimeout(() => setDismissed(true), 12000);
    return () => window.clearTimeout(timer);
  }, []);

  const ready = progress >= 1 || dismissed;

  // Held one beat past ready so the fade has something to fade.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setHidden(true), 420);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    void loadLampLibrary();
  }, [loadLampLibrary]);

  // Escape is the second way out of zen, and the one somebody reaches for
  // before they have found the first. Both exist because a mode that hides its
  // own exit is a trap, however quiet it looks.
  useEffect(() => {
    if (!zen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [zen]);

  // The first lamp the library offers, and only onto an empty bench: coming back
  // from the workbench must not throw away whatever was being worked on there.
  // A load that fails leaves the bench empty and the listing unchanged, so this
  // does not run again — the error under the name is what says why.
  useEffect(() => {
    if (instances.length > 0 || lampLibrary.length === 0) return;
    void loadLamp(lampLibrary[0]);
  }, [instances.length, lampLibrary, loadLamp]);

  const pick = (file: string) => {
    setMenu(null);
    void loadLamp(file);
  };

  // One button, rendered in whichever of the two places it belongs to right now.
  // Written once rather than twice because the two are the same control and a
  // second copy is a second thing to keep in step.
  const zenButton = (
    <button
      key="zen"
      type="button"
      className={"showcase-icon showcase-zen" + (zen ? " corner" : "")}
      aria-pressed={zen}
      title={zen ? "Bring the controls back (Esc)" : "Hide everything but the lamp"}
      onClick={() => {
        setZen((quiet) => !quiet);
        setMenu(null);
      }}
    >
      <ZenIcon open={!zen} />
    </button>
  );

  return (
    <div className="showcase" data-style={style}>
      <Canvas
        className="showcase-canvas"
        // A lamp in a dark room is all gradient, and a gradient is the one thing
        // eight bits per channel cannot hold — hence the higher precision on the
        // way in. The exposure and the curve are here rather than on a light
        // because they are what a camera does, not what a room does.
        // Supersampled, with a floor above 1.
        //
        // The wood has no resolution to raise — it is a function evaluated per
        // fragment, not an image — so the only thing that decides how much grain
        // survives is how many fragments there are. On an ordinary 1x monitor
        // this was drawing one sample per screen pixel and the ring
        // anti-aliasing, which blurs any ring finer than a sample, had nothing to
        // work with. A floor of 1.5 renders 2.25x the pixels and resolves it.
        dpr={compact ? [1, 1.75] : [1.5, 2]}
        shadows="soft"
        gl={{
          antialias: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
      >
        <color attach="background" args={["#0b0806"]} />
        <RealisticShowcase
          compact={compact}
          lampOn={lampOn}
          ceilingOn={ceilingOn}
          outside={outside}
          glow={glow}
          onDrawn={() => setDrawn(true)}
        />
      </Canvas>

      {!hidden && <ShowcaseLoading progress={progress} stage={stage} done={ready} />}

      {/* the click-away for either menu: over the scene, under the chrome, so
          the next click anywhere closes it instead of orbiting the lamp */}
      {menu && <div className="showcase-backdrop" onClick={() => setMenu(null)} />}

      {!zen && (
        <>
          <div className="showcase-bar">
            <div className="showcase-slot">
              <button
                type="button"
                className="showcase-button"
                aria-haspopup="menu"
                aria-expanded={menu === "lamp"}
                title="Choose which lamp to show"
                onClick={() => setMenu((open) => (open === "lamp" ? null : "lamp"))}
              >
                {lampName ?? "Lamp"} <span className="showcase-caret">▾</span>
              </button>
              {menu === "lamp" && <LampMenu onPick={pick} />}
            </div>

            <div className="showcase-slot showcase-slot-centre">
              <div className="showcase-anchor">
                <button
                  type="button"
                  className="showcase-button"
                  aria-haspopup="menu"
                  aria-expanded={menu === "style"}
                  title="Choose how the lamp is drawn"
                  onClick={() => setMenu((open) => (open === "style" ? null : "style"))}
                >
                  {showcaseStyle(style).label} <span className="showcase-caret">▾</span>
                </button>
                {menu === "style" && (
                  <StyleMenu
                    current={style}
                    onPick={(id) => {
                      setStyle(id);
                      setMenu(null);
                    }}
                  />
                )}
              </div>
            </div>

            <div className="showcase-slot showcase-slot-end">
              <button
                type="button"
                className="showcase-button"
                title="Open this lamp on the workbench"
                onClick={onOpenEditor}
              >
                Editor
              </button>
            </div>
          </div>

          {error && <div className="showcase-error">{error}</div>}
        </>
      )}

      {/* Zen: the one control that is on the page in both states.

          It is the last of the four switches while there are four, and it walks
          to the bottom corner on its own when it is the only one left — rather
          than staying in the middle of an empty screen, which is not zen, it is
          a button in the middle of an empty screen.

          What it must never do is go away. Every alternative way back — click
          anywhere, a hidden hot corner, Escape alone — is a mode somebody can
          get into and not out of, on a phone, with no keyboard and nothing on
          screen to press. */}
      {zen && zenButton}

      {!zen && (
        /* The dock: the switches, and the sliders under them.

           It sits with the lamp rather than up in the bar because it belongs to
           the same act — this is the row you reach for while looking at the
           lamp, and the bar is the row you reach for to go somewhere else. The
           switches are above the sliders so a thumb on the readout does not
           cover them. */
        <div className="showcase-dock">
          <div className="showcase-lights">
            <LightSwitch on={lampOn} label="Lamp light" onToggle={() => setLampOn((on) => !on)} />
            <LightSwitch
              on={ceilingOn}
              hanging
              label="Ceiling light"
              onToggle={() => setCeilingOn((on) => !on)}
            />
            <button
              type="button"
              className={"showcase-icon" + (outside === "none" ? "" : " on")}
              data-outside={outside}
              title={`${OUTSIDE_LABELS[outside]} — press for ${OUTSIDE_LABELS[nextOutside(outside)].toLowerCase()}`}
              aria-label={OUTSIDE_LABELS[outside]}
              onClick={() => setOutside(nextOutside)}
            >
              <OutsideIcon mode={outside} />
            </button>
            {zenButton}
          </div>

          <div className="showcase-controls">
            {DIMENSIONS.map((dimension) => (
              <Dimension
                key={dimension.variable}
                {...dimension}
                value={values[dimension.variable]}
              />
            ))}

            {/* Glow sits with the two measurements rather than beside the light
                switch, because it is the same kind of control: a thing you drag
                while looking at the lamp. The switch answers whether, this
                answers how much, and only one of those is a slider. */}
            <span className="showcase-dimension-label">Glow</span>
            <input
              className="showcase-slider"
              type="range"
              min={0}
              max={1.4}
              step={0.02}
              value={glow}
              disabled={!lampOn}
              title={lampOn ? "How far the lamp is turned up" : "The lamp is switched off"}
              onChange={(event) => setGlow(Number(event.target.value))}
            />
            <span className="showcase-dimension-value">{Math.round(glow * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
