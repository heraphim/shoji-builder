import { CollapsiblePanel } from "./CollapsiblePanel";
import { DocumentPanel } from "./DocumentPanel";
import { useTextureStore } from "../store/useTextureStore";
import {
  FINISH_LABELS,
  FINISH_NAMES,
  GRAIN_AXIS_LABELS,
  SPECIES_LABELS,
  WOOD_SPECIES_NAMES,
  type GrainAxis,
  type WoodFinish,
  type WoodParams,
  type WoodSpecies,
} from "../lib/wood";

/**
 * Every control that makes a wood texture, grouped by what part of the timber it
 * describes.
 *
 * The grouping is the timber's, not the shader's: which tree, what colour, where
 * in the log this piece came from, how the rings run, how they wander, the
 * figure, the finish. A designer picking a wood is asking those questions in
 * that order, and the panels fold away so the two or three that are in play at
 * any moment are the ones on screen.
 *
 * Saving, opening and uploading are in the tab's file menu, like everywhere else
 * in the app — see FileMenu.
 */

// ---------------------------------------------------------------------------

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="texture-row" title={hint}>
      <span className="texture-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * One number, as a slider with the value beside it.
 *
 * The readout is a text input rather than a label: half these parameters are
 * copied between textures by hand, and a value you can only reach by dragging is
 * a value you cannot set to the same thing twice.
 */
function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  decimals = 3,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="texture-row texture-slider-row" title={hint}>
      <span className="texture-label">{label}</span>
      <input
        type="range"
        className="texture-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        className="texture-number"
        step={step}
        value={Number(value.toFixed(decimals))}
        onChange={(e) => {
          const next = Number(e.target.value);
          // a half-typed number is NaN for a keystroke or two; writing it into
          // a uniform paints the part black with nothing to say why
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </div>
  );
}

function ColorRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="texture-row" title={hint}>
      <span className="texture-label">{label}</span>
      <input
        type="color"
        className="texture-color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        className="texture-number texture-hex"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function TextureSidebar() {
  const params = useTextureStore((state) => state.params);
  const species = useTextureStore((state) => state.species);
  const finish = useTextureStore((state) => state.finish);
  const setParam = useTextureStore((state) => state.setParam);
  const applySpecies = useTextureStore((state) => state.applySpecies);
  const applyFinish = useTextureStore((state) => state.applyFinish);
  const newSeed = useTextureStore((state) => state.newSeed);
  const reset = useTextureStore((state) => state.reset);
  const documentName = useTextureStore((state) => state.documentName);
  const description = useTextureStore((state) => state.description);
  const setDocumentName = useTextureStore((state) => state.setDocumentName);
  const setDescription = useTextureStore((state) => state.setDescription);

  const set =
    <K extends keyof WoodParams>(key: K) =>
    (value: WoodParams[K]) =>
      setParam(key, value);

  return (
    <div className="texture-sidebar">
      <DocumentPanel
        id="textures.document"
        what="texture"
        extension=".texture.json"
        name={documentName}
        description={description}
        onName={setDocumentName}
        onDescription={setDescription}
      />

      <CollapsiblePanel id="textures.species" title="Timber">
        <div className="texture-panel">
          <Row label="Species" hint="Loads that species' numbers. Where the piece sits in the log is left alone.">
            <select
              className="texture-select"
              value={species}
              onChange={(e) => applySpecies(e.target.value as WoodSpecies)}
            >
              {WOOD_SPECIES_NAMES.map((name) => (
                <option key={name} value={name}>
                  {SPECIES_LABELS[name]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Finish" hint="A film over the timber: it darkens what is under it and adds a sheen.">
            <select
              className="texture-select"
              value={finish}
              onChange={(e) => applyFinish(e.target.value as WoodFinish)}
            >
              {FINISH_NAMES.map((name) => (
                <option key={name} value={name}>
                  {FINISH_LABELS[name]}
                </option>
              ))}
            </select>
          </Row>
          <ColorRow
            label="Late wood"
            hint="The dark line of each growth ring — the dense wood a tree lays down late in the season."
            value={params.darkGrainColor}
            onChange={set("darkGrainColor")}
          />
          <ColorRow
            label="Early wood"
            hint="The pale ground between the rings."
            value={params.lightGrainColor}
            onChange={set("lightGrainColor")}
          />
          <Slider
            label="Contrast"
            hint="How far towards the late-wood colour a ring is allowed to go. 0 is a plain board."
            value={params.grainContrast}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={set("grainContrast")}
          />
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel id="textures.log" title="In the log">
        <div className="texture-panel">
          <Row
            label="Grain axis"
            hint="Which of the part's own axes runs along the fibres. The two faces normal to it are the end grain."
          >
            <select
              className="texture-select"
              value={params.grainAxis}
              onChange={(e) => setParam("grainAxis", e.target.value as GrainAxis)}
            >
              {(Object.keys(GRAIN_AXIS_LABELS) as GrainAxis[]).map((axis) => (
                <option key={axis} value={axis}>
                  {GRAIN_AXIS_LABELS[axis]}
                </option>
              ))}
            </select>
          </Row>
          <Slider
            label="Scale (mm)"
            hint="How many millimetres one texture unit is. The one number that ties the pattern to real size — everything else below is in texture units. Below about 60 the grain warp starts to outrun the part and the figure turns to static."
            value={params.grainScale}
            min={20}
            max={400}
            step={1}
            decimals={0}
            onChange={set("grainScale")}
          />
          <Slider
            label="Pith across"
            hint="How far off the centre of the log this piece was sawn. Near zero gives a bullseye; further out flattens the arcs into cathedral figure."
            value={params.pith[0]}
            min={0}
            max={6}
            step={0.01}
            decimals={2}
            onChange={(v) => setParam("pith", [v, params.pith[1]])}
          />
          <Slider
            label="Pith up"
            hint="The same, on the other cross-grain axis."
            value={params.pith[1]}
            min={-6}
            max={6}
            step={0.01}
            decimals={2}
            onChange={(v) => setParam("pith", [params.pith[0], v])}
          />
          <p className="texture-note">
            Pith is {(Math.hypot(params.pith[0], params.pith[1]) * params.grainScale).toFixed(0)} mm
            from this piece.
          </p>
          <div className="texture-row" title="Which board out of the log. Any integer; the same seed always gives the same board, which is what makes a saved texture reproduce.">
            <span className="texture-label">Seed</span>
            <input
              type="number"
              className="texture-number"
              step={1}
              value={params.seed}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) setParam("seed", Math.round(next));
              }}
            />
            <button type="button" className="texture-seed" onClick={newSeed}>
              New
            </button>
          </div>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel id="textures.rings" title="Rings">
        <div className="texture-panel">
          <Slider
            label="Rings / unit"
            hint="Growth rings per texture unit. Together with the scale above this is the real ring spacing, reported below — which is the number worth judging it by."
            value={1 / params.ringThickness}
            min={4}
            max={90}
            step={0.5}
            decimals={1}
            onChange={(v) => setParam("ringThickness", 1 / Math.max(v, 0.5))}
          />
          <p className="texture-note">
            One ring every {(params.grainScale * params.ringThickness).toFixed(2)} mm — about{" "}
            {Math.max(1, Math.round(40 / (params.grainScale * params.ringThickness)))} across a 40 mm
            post.
          </p>
          <Slider
            label="Ring width"
            hint="Where in each ring the dark line falls. Low keeps the late wood to a thin line; high makes it most of the ring."
            value={params.ringBias}
            min={0.01}
            max={0.99}
            step={0.01}
            decimals={2}
            onChange={set("ringBias")}
          />
          <Slider
            label="Ring depth"
            hint="How much of the ring the pattern uses before it repeats. Above 1 the rings start to run into each other."
            value={params.barkThickness}
            min={0.02}
            max={1.2}
            step={0.01}
            decimals={2}
            onChange={set("barkThickness")}
          />
          <Slider
            label="Width variance"
            hint="Good years and bad ones: how much consecutive rings differ in width."
            value={params.ringSizeVariance}
            min={0}
            max={0.6}
            step={0.005}
            decimals={3}
            onChange={set("ringSizeVariance")}
          />
          <Slider
            label="Variance scale"
            hint="Over how many rings that variation plays out."
            value={params.ringVarianceScale}
            min={0.2}
            max={12}
            step={0.1}
            decimals={1}
            onChange={set("ringVarianceScale")}
          />
          <Slider
            label="Heart size"
            hint="How disturbed the wood is near the pith, where a young tree grows unevenly."
            value={params.centerSize}
            min={0}
            max={3}
            step={0.01}
            decimals={2}
            onChange={set("centerSize")}
          />
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel id="textures.warp" title="Wander" collapsedByDefault>
        <div className="texture-panel">
          <p className="texture-note">
            Rings are perfect circles until something pushes them about. These three
            passes — broad, medium, fine — are what turn them into wood.
          </p>
          <Slider
            label="Broad scale"
            hint="The size of the largest sweep in the grain."
            value={params.largeWarpScale}
            min={0}
            max={2}
            step={0.01}
            decimals={2}
            onChange={set("largeWarpScale")}
          />
          <Slider
            label="Stretch"
            hint="How fast the figure changes as you move along the length. Low is a long straight-grained board; high is a short twisty one."
            value={params.largeGrainStretch}
            min={0}
            max={2}
            step={0.01}
            decimals={2}
            onChange={set("largeGrainStretch")}
          />
          <Slider
            label="Medium strength"
            value={params.smallWarpStrength}
            min={0}
            max={0.3}
            step={0.001}
            onChange={set("smallWarpStrength")}
          />
          <Slider
            label="Medium scale"
            value={params.smallWarpScale}
            min={0.1}
            max={20}
            step={0.1}
            decimals={1}
            onChange={set("smallWarpScale")}
          />
          <Slider
            label="Fine strength"
            value={params.fineWarpStrength}
            min={0}
            max={0.1}
            step={0.0005}
            decimals={4}
            onChange={set("fineWarpStrength")}
          />
          <Slider
            label="Fine scale"
            value={params.fineWarpScale}
            min={0.5}
            max={60}
            step={0.1}
            decimals={1}
            onChange={set("fineWarpScale")}
          />
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel id="textures.figure" title="Figure & pores" collapsedByDefault>
        <div className="texture-panel">
          <Slider
            label="Blotch scale"
            hint="Size of the broad colour variation across a board."
            value={params.splotchScale}
            min={0}
            max={4}
            step={0.01}
            decimals={2}
            onChange={set("splotchScale")}
          />
          <Slider
            label="Blotch strength"
            value={params.splotchIntensity}
            min={0}
            max={4}
            step={0.01}
            decimals={2}
            onChange={set("splotchIntensity")}
          />
          <Slider
            label="Pore strength"
            hint="The open pores of a ring-porous timber like oak. Zero switches the layer off entirely, which is much the cheapest thing on this panel."
            value={params.poreIntensity}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={set("poreIntensity")}
          />
          <Slider
            label="Pore density"
            value={params.cellScale}
            min={100}
            max={2000}
            step={10}
            decimals={0}
            onChange={set("cellScale")}
          />
          <Slider
            label="Pore size"
            value={params.cellSize}
            min={0}
            max={0.6}
            step={0.005}
            decimals={3}
            onChange={set("cellSize")}
          />
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel id="textures.surface" title="Surface" collapsedByDefault>
        <div className="texture-panel">
          <p className="texture-note">
            Set by the Finish picker above; here to be nudged afterwards.
          </p>
          <Slider
            label="Roughness"
            value={params.roughness}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={set("roughness")}
          />
          <Slider
            label="Clearcoat"
            value={params.clearcoat}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={set("clearcoat")}
          />
          <Slider
            label="Coat roughness"
            value={params.clearcoatRoughness}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={set("clearcoatRoughness")}
          />
          <Slider
            label="Darkening"
            hint="How much the film darkens the timber under it. 1 is bare wood."
            value={params.clearcoatDarken}
            min={0.1}
            max={1}
            step={0.01}
            decimals={2}
            onChange={set("clearcoatDarken")}
          />
        </div>
      </CollapsiblePanel>

      <div className="sidebar-actions">
        <button type="button" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}
