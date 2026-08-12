import { useLookStore, DEFAULT_LOOK, type LookSettings } from "../store/useLookStore";

/**
 * The Options panel: how everything is lit, and what stands in for the arrises
 * when they are off.
 *
 * The **same component in all three sidebars**, driving the one store — see
 * `useLookStore` for why lighting is app-wide where the draw modes are per tab.
 * Rendered three times rather than lifted somewhere shared because a sidebar is
 * a column of panels and this is one of them; there is nowhere above it to put
 * it that is not a fourth place to look.
 *
 * It sits near the top of each sidebar, under the file's name and above the
 * working panels, because a panel you reach for when the view has gone
 * unreadable should not be behind the whole design.
 *
 * The sliders reach every lit cell, which after the merge is all of them — the
 * projections included. The shadow is the 3D cells only: a pool of shade on the
 * floor of a Top view is a shadow looked at straight down the barrel.
 *
 * See docs/ui-guide.md.
 */

/**
 * One light, as a slider with the value beside it.
 *
 * The readout is an input rather than a label for the same reason the texture
 * panel's is: these get set back to a number somebody found once, and a value
 * you can only reach by dragging is one you cannot set twice.
 */
function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="option-row option-slider-row" title={hint}>
      <span className="option-label">{label}</span>
      <input
        type="range"
        className="option-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        className="option-number"
        step={step}
        value={Number(value.toFixed(2))}
        onChange={(e) => {
          const next = Number(e.target.value);
          // a half-typed number is NaN for a keystroke or two, and an intensity
          // of NaN renders the whole cell black with nothing to say why
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="option-row option-toggle" title={hint}>
      <input
        type="checkbox"
        className="option-checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="option-toggle-label">{label}</span>
    </label>
  );
}

export function LookOptions() {
  const ambient = useLookStore((state) => state.ambient);
  const key = useLookStore((state) => state.key);
  const fill = useLookStore((state) => state.fill);
  const contactShadows = useLookStore((state) => state.contactShadows);
  const faintOutline = useLookStore((state) => state.faintOutline);
  const setLook = useLookStore((state) => state.setLook);
  const resetLook = useLookStore((state) => state.resetLook);

  const current: LookSettings = { ambient, key, fill, contactShadows, faintOutline };
  const changed = (Object.keys(DEFAULT_LOOK) as (keyof LookSettings)[]).some(
    (k) => current[k] !== DEFAULT_LOOK[k]
  );

  return (
    <div className="option-panel">
      <Slider
        label="Ambient"
        hint="Uniform light. The flattener: it lifts every face by the same amount, so the lower it is the more the shading has to say about which way a face points."
        value={ambient}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => setLook("ambient", v)}
      />
      <Slider
        label="Key light"
        hint="The main light, above and to the front-right. Contrast between faces comes from this one."
        value={key}
        min={0}
        max={3}
        step={0.05}
        onChange={(v) => setLook("key", v)}
      />
      <Slider
        label="Fill light"
        hint="The weaker light from behind and to the left, so the side the key misses does not fall to flat ambient."
        value={fill}
        min={0}
        max={3}
        step={0.05}
        onChange={(v) => setLook("fill", v)}
      />

      <Toggle
        label="Contact shadows"
        hint="A soft shadow pooled under whatever is on the bench, so it stands on the floor instead of floating over it. The 3D cells only."
        checked={contactShadows}
        onChange={(v) => setLook("contactShadows", v)}
      />
      <Toggle
        label="Draw solid outline"
        hint="Keep a faint outline on every part when a view is set to No lines. Two touching parts with faces in the same plane are the same colour lit the same way, and only a line tells them apart."
        checked={faintOutline}
        onChange={(v) => setLook("faintOutline", v)}
      />

      <button
        type="button"
        className="option-reset"
        onClick={resetLook}
        disabled={!changed}
        title="Back to the lighting the view shipped with"
      >
        Reset
      </button>
    </div>
  );
}
