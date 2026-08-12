import { useRef } from "react";
import {
  useVariablesStore,
  useResolvedVariables,
  useHiddenVariables,
} from "../store/useVariablesStore";
import { isLiteralFormula } from "../store/useComponentEditorStore";

interface VariablesListProps {
  /** Make whole rows clickable (used when a caller is arming a variable). */
  selectable?: boolean;
  /** The row to mark as armed, if any. */
  armedVariable?: string | null;
  onSelect?: (name: string) => void;
  /** Extra text to show against a row — e.g. what the variable currently drives. */
  annotate?: (name: string) => string | null;
  /** Give plain numeric variables a slider as well as the formula box. */
  sliders?: boolean;
}

/**
 * The variables table: name, editable formula, resolved value, pair toggle, and
 * — for a variable that is a plain number — a slider.
 *
 * Inputs carry the raw *formula string*, not the number: that is what lets
 * `1/2*#innerWidth` keep its meaning. The dependent of a collapsed pair is driven
 * rather than independent, so it has no row at all (`useHiddenVariables`) and
 * cannot be edited into disagreeing with its driver.
 *
 * A slider writes a bare number, so it is only offered where the variable
 * already *is* a bare number. Dragging one on a variable written as a formula
 * would silently throw the formula away, and the formula is the design decision
 * — so those get a disabled slider showing where the value currently sits, and
 * clearing the formula gets the slider back.
 */
export function VariablesList({
  selectable = false,
  armedVariable = null,
  onSelect,
  annotate,
  sliders = false,
}: VariablesListProps) {
  const raw = useVariablesStore((state) => state.raw);
  const pairs = useVariablesStore((state) => state.pairs);
  const paired = useVariablesStore((state) => state.paired);
  const setVariable = useVariablesStore((state) => state.setVariable);
  const togglePair = useVariablesStore((state) => state.togglePair);
  const hidden = useHiddenVariables();
  const { values, error } = useResolvedVariables();
  const bounds = useSliderBounds();

  const names = Object.keys(raw).filter((name) => !hidden.has(name));

  return (
    <div className="variables-list">
      {error && <div className="variables-error">{error}</div>}
      {names.map((name) => {
        const annotation = annotate?.(name);
        const partner = pairs[name];
        const collapsed = partner ? paired[name] : false;
        const value = values[name];
        const driven = !isLiteralFormula(raw[name]);
        const range = sliders && Number.isFinite(value) ? bounds(name, value) : null;
        return (
          <div
            key={name}
            className={
              "variable-row" +
              (selectable ? " selectable" : "") +
              (armedVariable === name ? " armed" : "") +
              (collapsed ? " collapsed-pair" : "")
            }
            onClick={selectable ? () => onSelect?.(name) : undefined}
          >
            <span className="variable-name">{name}</span>
            <input
              type="text"
              value={raw[name]}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setVariable(name, e.target.value)}
            />
            <span className="variable-resolved">{name in values ? values[name].toFixed(2) : "?"}</span>
            {partner ? (
              <button
                type="button"
                className={"pair-toggle" + (collapsed ? " active" : "")}
                title={
                  collapsed
                    ? `${partner} follows ${name} — click to give it its own value`
                    : `Collapse ${name} and ${partner} into one measurement`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  togglePair(name);
                }}
              >
                {collapsed ? "⚭" : "⚮"}
              </button>
            ) : (
              <span />
            )}
            {range && (
              <input
                className="variable-slider"
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                // a value outside the slider's range would snap the thumb to an
                // end and read as if the variable were that number
                value={Math.min(range.max, Math.max(range.min, value))}
                disabled={driven}
                title={
                  driven
                    ? `${name} is written as a formula — clear it to use the slider`
                    : undefined
                }
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setVariable(name, e.target.value)}
              />
            )}
            {collapsed && <span className="variable-annotation">drives {partner}</span>}
            {annotation && <span className="variable-annotation">{annotation}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A stable slider range per variable, fixed the first time the variable is seen.
 *
 * Deriving the range from the current value on every render would move the ends
 * of the track while the thumb is being dragged, so the same drag distance would
 * mean a different number from one frame to the next. Fixed once, generously —
 * three times the starting value, rounded up to a 1/2/5 — a variable can still
 * be typed past its slider's reach in the formula box beside it.
 */
function useSliderBounds() {
  const cache = useRef(new Map<string, { min: number; max: number; step: number }>());
  return (name: string, value: number) => {
    const known = cache.current.get(name);
    if (known) return known;
    const base = Math.abs(value) > 1e-6 ? Math.abs(value) : 100;
    const max = niceCeil(base * 3);
    // never 0: a size of zero is not a lamp, and `rebuildBlocks` rejects it
    const step = max <= 50 ? 0.5 : 1;
    const range = { min: step, max, step };
    cache.current.set(name, range);
    return range;
  };
}

// Round up to the next 1, 2 or 5 times a power of ten, so a track ends on a
// number worth reading rather than on 62.7.
function niceCeil(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(value, 1e-6))));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}
