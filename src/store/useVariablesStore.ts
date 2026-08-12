import { useMemo } from "react";
import { create } from "zustand";
import { resolveVariables } from "../lib/formula";
import { siteUrl } from "../lib/library";

/**
 * The design variables.
 *
 * `raw` is the source of truth and holds *formula strings*, never numbers —
 * `"370"`, `"1/2*#innerWidth"`, `"#innerHeight - 2*#legThickness"`. Resolved
 * numbers are derived on read (`useResolvedVariables`), so nothing can go stale.
 *
 * **Pairing** lets two variables be square by default but separable, and is
 * implemented entirely in the language rather than as a special case: while a
 * pair is collapsed, the dependent's raw value is literally the string
 * `"#driver"`, so it follows every edit of the driver with no extra wiring. Its
 * own value is parked in `stashed` and restored on expand, so toggling square
 * mode off gives back the last independent value rather than freezing at
 * whatever the driver happened to be.
 *
 * Loaded from public/data/variables.json. See
 * docs/algorithms/formula-resolution.md
 */

interface VariableDef {
  value: string;
  // a variable may declare a partner that normally tracks it — width/depth and
  // frame width/height are square by default but must stay separable
  pairedWith?: string;
  paired?: boolean;
}

interface VariablesData {
  units: string;
  variables: Record<string, VariableDef>;
}

interface VariablesState {
  loaded: boolean;
  // why the variables could not be loaded, if they could not be
  loadError: string | null;
  raw: Record<string, string>;
  // driver -> dependent, e.g. innerWidth -> innerDepth
  pairs: Record<string, string>;
  // driver -> collapsed? While collapsed the dependent is *driven*: its raw
  // value is the formula "#driver", so it follows every edit of the driver
  // without any extra wiring — the resolver already does the work.
  paired: Record<string, boolean>;
  // the dependent's own value, parked while it is driven, so expanding the pair
  // restores what it was instead of freezing at whatever the driver last read
  stashed: Record<string, string>;
  loadVariables: () => Promise<void>;
  loadDesign: (
    raw: Record<string, string>,
    paired: Record<string, boolean>,
    stashed: Record<string, string>
  ) => void;
  setVariable: (name: string, formula: string) => void;
  togglePair: (driver: string) => void;
}

export const useVariablesStore = create<VariablesState>((set) => ({
  loaded: false,
  loadError: null,
  raw: {},
  pairs: {},
  paired: {},
  stashed: {},

  // Nothing in the app can render before this resolves — every formula is
  // written against these. A failure therefore has to be reported rather than
  // rejected into nowhere, which left the app sitting on "Loading..." with no
  // indication that anything had gone wrong.
  loadVariables: async () => {
    let data: VariablesData;
    try {
      const res = await fetch(siteUrl("data/variables.json"));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      data = (await res.json()) as VariablesData;
    } catch (e) {
      set({ loadError: `Could not load variables: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const raw: Record<string, string> = {};
    const pairs: Record<string, string> = {};
    const paired: Record<string, boolean> = {};
    const stashed: Record<string, string> = {};
    for (const [name, def] of Object.entries(data.variables)) {
      raw[name] = def.value;
      if (def.pairedWith) {
        pairs[name] = def.pairedWith;
        paired[name] = def.paired ?? false;
      }
    }
    for (const [driver, dependent] of Object.entries(pairs)) {
      if (!paired[driver]) continue;
      stashed[dependent] = raw[dependent];
      raw[dependent] = `#${driver}`;
    }
    set({ raw, pairs, paired, stashed, loaded: true, loadError: null });
  },

  /**
   * Replace the design's values with a saved lamp's.
   *
   * **Replaces, where loading a component merges.** The two are different acts:
   * a component is being added to a design that already exists and whose values
   * therefore win, while a lamp *is* a design — merging one in would leave the
   * lamp at values it was never drawn at.
   *
   * `pairs` is untouched. Which variables may pair is structure declared in
   * `data/variables.json`; which of them are collapsed, and what the parked
   * value behind a collapsed one is, are the design's, and come from the file.
   * A variable the file does not mention keeps what it has — a lamp saved before
   * the design gained a variable should not blank it.
   */
  loadDesign: (raw, paired, stashed) =>
    set((state) => ({
      raw: { ...state.raw, ...raw },
      paired: { ...state.paired, ...paired },
      stashed: { ...state.stashed, ...stashed },
    })),

  setVariable: (name, formula) =>
    set((state) => ({ raw: { ...state.raw, [name]: formula } })),

  togglePair: (driver) =>
    set((state) => {
      const dependent = state.pairs[driver];
      if (!dependent) return state;
      const collapse = !state.paired[driver];
      return {
        paired: { ...state.paired, [driver]: collapse },
        stashed: collapse
          ? { ...state.stashed, [dependent]: state.raw[dependent] }
          : state.stashed,
        raw: {
          ...state.raw,
          [dependent]: collapse
            ? `#${driver}`
            : state.stashed[dependent] ?? state.raw[driver],
        },
      };
    }),
}));

// The dependent of a collapsed pair is driven, not independent: it has no row
// of its own and its input must not be editable.
export function useHiddenVariables(): Set<string> {
  const pairs = useVariablesStore((state) => state.pairs);
  const paired = useVariablesStore((state) => state.paired);
  return useMemo(() => {
    const hidden = new Set<string>();
    for (const [driver, dependent] of Object.entries(pairs)) {
      if (paired[driver]) hidden.add(dependent);
    }
    return hidden;
  }, [pairs, paired]);
}

/**
 * Every variable's numeric value, or the first error the resolver hit.
 *
 * On error `values` is empty and the message is surfaced in the variables panel;
 * the geometry keeps whatever it last successfully built, so a half-typed
 * formula never wipes the model.
 */
export function useResolvedVariables(): { values: Record<string, number>; error: string | null } {
  const raw = useVariablesStore((state) => state.raw);
  return useMemo(() => {
    try {
      return { values: resolveVariables(raw), error: null };
    } catch (e) {
      return { values: {}, error: e instanceof Error ? e.message : String(e) };
    }
  }, [raw]);
}
