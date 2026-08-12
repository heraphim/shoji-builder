import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_APPEARANCE,
  useComponentEditorStore,
  subcomponentCount,
  type Measurement,
  type PickMode,
} from "../store/useComponentEditorStore";
import { useVariablesStore, useResolvedVariables } from "../store/useVariablesStore";
import {
  BENCH_TEXTURE,
  textureDisplayName,
  useTextureStore,
} from "../store/useTextureStore";
import { GRAIN_AXIS_LABELS, type GrainAxis } from "../lib/wood";
import { resolveVariables } from "../lib/formula";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { LookOptions } from "./LookOptions";
import { DocumentPanel } from "./DocumentPanel";
import { useMergedGroups } from "./UploadedMesh";
import {
  axisStations,
  buildSpanSolver,
  collectKnownSpans,
  spanKey,
  type AxisIndex,
} from "../lib/measure";

/**
 * The editor's sidebar: connections, measurements, implied values.
 *
 * The panel order mirrors the workflow — you connect parts into one solid, then
 * measure it, and the implied values are what falls out of what you measured.
 * Each panel gates its own action on `subcomponentCount`: connecting needs at
 * least two subcomponents, measuring needs exactly one. Every one of them folds
 * away, and stays folded across reloads — see `usePanelStore`.
 *
 * Opening and saving a component is in the tab's file menu, not here.
 *
 * See docs/ui-guide.md.
 */

const AXIS_LABELS: Record<AxisIndex, string> = { 0: "X", 1: "Y", 2: "Z" };

function pickModeLabel(pickMode: PickMode): string | null {
  switch (pickMode) {
    case "selectingEdges":
      return "Click edges — in any view — or a dimension guide to select them (click again to deselect), then set the formula and press Done.";
    case "selectFace":
      return "Hover a face in the 3D view; click to assign it to the armed projection.";
    case "connectA":
      return "Click a vertex on the first subcomponent.";
    case "connectB":
      return "Click a vertex on a different subcomponent — it snaps immediately.";
    default:
      return null;
  }
}

// Null for anything that is not a usable length. Resolving without throwing is
// not enough: `1/0` gives Infinity and `1.2.3` tokenizes to a single NaN number,
// and both used to pass as valid. That let the Done button accept a measurement
// the geometry then refused — rebuildBlocks rejects a non-finite size, so the
// block silently stopped responding to its variables while the sidebar showed
// "NaNmm" and the drawing showed "NaN".
function evaluateFormula(formula: string, rawVariables: Record<string, string>): number | null {
  try {
    const resolved = resolveVariables({ ...rawVariables, __measurement: formula });
    return Number.isFinite(resolved.__measurement) ? resolved.__measurement : null;
  } catch {
    return null;
  }
}

// What a measurement's edges actually span on the model right now. All the edges
// of one measurement state the same length, so the first one answers for them.
function spannedLength(measurement: Measurement): number | null {
  const edge = measurement.edges[0];
  if (!edge) return null;
  return Math.hypot(
    edge.end[0] - edge.start[0],
    edge.end[1] - edge.start[1],
    edge.end[2] - edge.start[2]
  );
}

// A measurement is a request, and the geometry can only grant it where some
// block's extent is free to be re-cut to it. Set the overall width of an
// assembly whose parts are all still fixed numbers and there is nothing to give:
// the value sits in the list, the drawing shows it, and the part stays the size
// it was. That used to be silent. Half a millimetre of slack, so a joint that
// lands a hair off from the formula evaluator's arithmetic does not read as a
// contradiction.
const SATISFIED_TOL_MM = 0.5;

function MeasurementsPanel() {
  const raw = useVariablesStore((state) => state.raw);
  const meshes = useComponentEditorStore((state) => state.meshes);
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const pendingEdges = useComponentEditorStore((state) => state.pendingEdges);
  const measurements = useComponentEditorStore((state) => state.measurements);
  const connections = useComponentEditorStore((state) => state.connections);

  const startSelectingEdges = useComponentEditorStore((state) => state.startSelectingEdges);
  const finishSelectingEdges = useComponentEditorStore((state) => state.finishSelectingEdges);
  const removeMeasurement = useComponentEditorStore((state) => state.removeMeasurement);
  const setMeasurementFormula = useComponentEditorStore((state) => state.setMeasurementFormula);
  const setHighlightedMeasurement = useComponentEditorStore((state) => state.setHighlightedMeasurement);

  const [formula, setFormula] = useState("");

  const selecting = pickMode === "selectingEdges";
  const idle = pickMode === "none";
  // measuring is for the finished part: everything must be joined into ONE
  // solid first (a single uploaded solid counts)
  const oneSolid = meshes.length > 0 && subcomponentCount(meshes, connections) === 1;

  const insertVariable = (name: string) => setFormula((f) => (f ? `${f}#${name}` : `#${name}`));

  return (
    <div className="measurements-panel">
      <button
        type="button"
        disabled={!oneSolid || !idle}
        onClick={startSelectingEdges}
        title={!oneSolid ? "Join all subcomponents into one solid before measuring" : undefined}
      >
        Select Edges
      </button>

      {selecting && (
        <div className="measurement-editor">
          <div className="pending-count">
            {pendingEdges.length} edge{pendingEdges.length === 1 ? "" : "s"} selected
          </div>
          <div className="variable-chips">
            {Object.keys(raw).map((name) => (
              <button key={name} type="button" className="chip" onClick={() => insertVariable(name)}>
                #{name}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="formula, e.g. 1/2*#innerWidth"
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
          />
          <button
            type="button"
            // a measurement is a length, and rebuildBlocks refuses a size that
            // is not > 0 — so accepting one here would store a measurement the
            // geometry then ignores, with nothing on screen saying why
            disabled={pendingEdges.length === 0 || !((evaluateFormula(formula, raw) ?? 0) > 0)}
            onClick={() => {
              finishSelectingEdges(formula);
              setFormula("");
            }}
          >
            Done
          </button>
        </div>
      )}

      <div className="measurement-list">
        {measurements.map((m) => {
          const value = evaluateFormula(m.formula, raw);
          const spans = spannedLength(m);
          const unmet =
            value !== null && spans !== null && Math.abs(value - spans) > SATISFIED_TOL_MM;
          return (
            <div
              key={m.id}
              // green: this one was set by the designer. The Implied panel below
              // is the yellow half of the same convention, and both match the
              // colours the edges are drawn in across all four views.
              className="measurement-row set-row"
              onPointerEnter={() => setHighlightedMeasurement(m.id)}
              onPointerLeave={() => setHighlightedMeasurement(null)}
            >
              <input
                type="text"
                value={m.formula}
                onChange={(e) => setMeasurementFormula(m.id, e.target.value)}
              />
              <span
                className={unmet ? "measurement-value measurement-unmet" : "measurement-value"}
                title={
                  unmet
                    ? `The model spans ${spans!.toFixed(2)}mm here, not ${value!.toFixed(2)}mm — ` +
                      "no block extent is free to be re-cut to it. Measure the parts this " +
                      "length is made of and it will follow."
                    : undefined
                }
              >
                {value !== null ? `${value.toFixed(2)}mm` : "?"}
                {unmet ? " !" : ""}
              </span>
              <span className="measurement-edges">
                {m.edges.length} edge{m.edges.length === 1 ? "" : "s"}
              </span>
              <button type="button" onClick={() => removeMeasurement(m.id)}>
                &times;
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Values the user never set but that follow from the ones they did. Set the
// overall height and the leg thickness and the shoulder-to-shoulder distance is
// no longer a free choice — it is the difference, and it is reported as such
// rather than left to be typed in a second time and drift.
//
// The links considered are exactly the ones the dimension chains draw — every
// adjacent pair of stations, plus the overall size across the whole part — so
// the panel and the drawings can never list different things.
function useImpliedSpans() {
  const groups = useMergedGroups();
  const measurements = useComponentEditorStore((state) => state.measurements);
  const raw = useVariablesStore((state) => state.raw);

  return useMemo(() => {
    if (groups.length === 0) return [];
    const { stations } = axisStations(groups.map((g) => g.geometry));
    const solver = buildSpanSolver(collectKnownSpans(measurements));

    const out: Array<{
      axis: AxisIndex;
      formula: string;
      value: number | null;
      nominal: number;
    }> = [];
    for (let axis = 0; axis < 3; axis++) {
      const values = stations[axis];
      if (values.length < 2) continue;
      // the same links the dimension chains draw: every adjacent pair, plus the
      // overall size across the whole part
      const links: Array<[number, number]> = [];
      for (let i = 0; i + 1 < values.length; i++) links.push([values[i], values[i + 1]]);
      if (values.length > 2) links.push([values[0], values[values.length - 1]]);

      for (const [a, b] of links) {
        const span = { axis: axis as AxisIndex, a, b };
        if (solver.known.has(spanKey(span))) continue;
        const formula = solver.imply(span);
        if (!formula) continue;
        out.push({
          axis: axis as AxisIndex,
          formula,
          value: evaluateFormula(formula, raw),
          nominal: b - a,
        });
      }
    }
    return out;
  }, [groups, measurements, raw]);
}

function ImpliedPanel() {
  const implied = useImpliedSpans();
  if (implied.length === 0) return null;

  return (
    <CollapsiblePanel id="editor.implied" title="Implied" badge={implied.length}>
      <div className="measurements-panel implied-panel">
        <div className="measurement-list">
          {implied.map((entry, i) => (
            <div key={`${entry.axis}-${i}`} className="measurement-row implied-row">
              <span className="implied-formula" title={entry.formula}>
                <span className="implied-axis">{AXIS_LABELS[entry.axis]}</span>
                {entry.formula}
              </span>
              <span className="measurement-value">
                {entry.value !== null ? `${entry.value.toFixed(2)}mm` : "?"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </CollapsiblePanel>
  );
}

function ConnectionsPanel() {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const connections = useComponentEditorStore((state) => state.connections);

  const startConnection = useComponentEditorStore((state) => state.startConnection);
  const removeConnection = useComponentEditorStore((state) => state.removeConnection);
  const setHighlightedConnection = useComponentEditorStore((state) => state.setHighlightedConnection);

  const idle = pickMode === "none";
  const meshName = (id: string) => meshes.find((m) => m.id === id)?.name ?? "?";

  // connections join subcomponents, so gate on how many separate ones remain —
  // once everything is joined into one, there's nothing left to connect
  const remaining = subcomponentCount(meshes, connections);

  return (
    <div className="connection-panel">
      <button
        type="button"
        disabled={remaining < 2 || !idle}
        onClick={startConnection}
        title={
          remaining < 2
            ? "All subcomponents are joined — upload another to connect more"
            : undefined
        }
      >
        Add Connection
      </button>

      <div className="connection-list">
        {connections.map((c) => (
          <div
            key={c.id}
            className="connection-row"
            onPointerEnter={() => setHighlightedConnection(c.id)}
            onPointerLeave={() => setHighlightedConnection(null)}
          >
            <span className="connection-label">
              {meshName(c.meshA)} &harr; {meshName(c.meshB)}
            </span>
            <button type="button" onClick={() => removeConnection(c.id)}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// What a component is drawn in when a view is set to Solid. One colour for the
// whole component rather than one per part: a component is a thing made of a
// material, and the editor already has four other ways to tell its parts apart.
function SolidPanel() {
  const appearance = useComponentEditorStore((state) => state.appearance);
  const setAppearance = useComponentEditorStore((state) => state.setAppearance);

  return (
    <div className="appearance-panel">
      <div className="texture-row">
        <span className="texture-label">Colour</span>
        <input
          type="color"
          className="texture-color"
          value={appearance.solidColor}
          onChange={(e) => setAppearance({ solidColor: e.target.value })}
        />
        <input
          type="text"
          className="texture-number texture-hex"
          value={appearance.solidColor}
          onChange={(e) => {
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
              setAppearance({ solidColor: e.target.value });
            }
          }}
        />
      </div>
      <button
        type="button"
        disabled={appearance.solidColor === DEFAULT_APPEARANCE.solidColor}
        onClick={() => setAppearance({ solidColor: DEFAULT_APPEARANCE.solidColor })}
      >
        Back to blueprint blue
      </button>
    </div>
  );
}

/**
 * What the component is made of, and which way the grain runs through it.
 *
 * The texture is stored by name, so this is a picker over the library plus one
 * extra entry for whatever is on the Textures bench. That entry is the one to
 * use while designing a wood: point the component at the bench, switch a view to
 * Texture, and every slider on the Textures tab now moves this component.
 *
 * The grain axis is here rather than on the texture because it belongs to the
 * part. A stile and a rail can be the same oak and still have their grain at
 * right angles — that is the whole difference between them.
 */
function TexturePanel() {
  const appearance = useComponentEditorStore((state) => state.appearance);
  const setAppearance = useComponentEditorStore((state) => state.setAppearance);
  const library = useTextureStore((state) => state.library);
  const libraryError = useTextureStore((state) => state.libraryError);
  const benchName = useTextureStore((state) => state.documentName);
  const benchSpecies = useTextureStore((state) => state.species);
  const loadLibrary = useTextureStore((state) => state.loadLibrary);

  // The picker has to be able to offer the library whether or not anybody has
  // been to the Textures tab this session.
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const named = appearance.texture;
  const missing =
    named !== null && named !== BENCH_TEXTURE && !library.includes(named);

  return (
    <div className="appearance-panel">
      <div className="texture-row">
        <span className="texture-label">Texture</span>
        <select
          className="texture-select"
          value={named ?? ""}
          onChange={(e) => setAppearance({ texture: e.target.value || null })}
        >
          <option value="">None — flat colour</option>
          <option value={BENCH_TEXTURE}>
            Textures bench{benchName ? ` — ${benchName}` : ` — ${benchSpecies} (unsaved)`}
          </option>
          {library.map((file) => (
            <option key={file} value={file}>
              {textureDisplayName(file)}
            </option>
          ))}
          {/* A component can name a texture that is not in this project's
              library — it came from somebody else's. Kept in the list rather
              than silently reset, so the name survives a round trip through
              somebody who does not have the file. */}
          {missing && (
            <option value={named}>{textureDisplayName(named)} (not in library)</option>
          )}
        </select>
      </div>

      {libraryError && <p className="appearance-note">{libraryError}</p>}

      <div className="texture-row">
        <span className="texture-label" title="Which of the component's own axes the fibres run along. The two faces normal to it are the end grain.">
          Grain along
        </span>
        <div className="axis-toggle">
          {(["x", "y", "z"] as GrainAxis[]).map((axis) => (
            <button
              key={axis}
              type="button"
              className={appearance.grainAxis === axis ? "active" : ""}
              title={GRAIN_AXIS_LABELS[axis]}
              onClick={() => setAppearance({ grainAxis: axis })}
            >
              {axis.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <p className="appearance-note">
        Set a view to <strong>Texture</strong> to see it. Side, Top and Front show
        it from three sides at once, which is how to check the end grain agrees
        with the length.
      </p>
    </div>
  );
}

export function ComponentEditorSidebar() {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const pickMode = useComponentEditorStore((state) => state.pickMode);
  const connections = useComponentEditorStore((state) => state.connections);
  const measurements = useComponentEditorStore((state) => state.measurements);
  const documentName = useComponentEditorStore((state) => state.documentName);
  const description = useComponentEditorStore((state) => state.description);
  const setDocumentName = useComponentEditorStore((state) => state.setDocumentName);
  const setDescription = useComponentEditorStore((state) => state.setDescription);
  const cancelPick = useComponentEditorStore((state) => state.cancelPick);
  const reset = useComponentEditorStore((state) => state.reset);
  useResolvedVariables(); // keep sidebar re-rendering on variable edits

  const statusLabel = pickModeLabel(pickMode);
  const hasMeshes = meshes.length > 0;

  return (
    <div className="component-sidebar">
      {statusLabel && (
        <div className="pick-status">
          <span>{statusLabel}</span>
          <button type="button" onClick={cancelPick}>
            Cancel
          </button>
        </div>
      )}

      {/* First, and above the working panels: it is what the file is called and
          what it is, which is the one thing about the bench that is not visible
          in the views. */}
      <DocumentPanel
        id="editor.document"
        what="component"
        extension=".component.json"
        name={documentName}
        description={description}
        onName={setDocumentName}
        onDescription={setDescription}
      />

      {/* The same panel as the other two tabs, driving the same one set of
          settings — see `useLookStore`. Only which panels are folded is per
          sidebar, which is why the id is not the lamp's. */}
      <CollapsiblePanel id="editor.options" title="Options" collapsedByDefault>
        <LookOptions />
      </CollapsiblePanel>

      <CollapsiblePanel
        id="editor.connections"
        title="Connections"
        badge={connections.length || null}
      >
        <ConnectionsPanel />
      </CollapsiblePanel>

      <CollapsiblePanel
        id="editor.measurements"
        title="Measurements"
        badge={measurements.length || null}
      >
        <MeasurementsPanel />
      </CollapsiblePanel>

      <ImpliedPanel />

      {/* Below the working panels and folded by default: what a part is made of
          is decided once and then left alone, while connections and
          measurements are worked on all session. */}
      <CollapsiblePanel id="editor.solid" title="Solid" collapsedByDefault>
        <SolidPanel />
      </CollapsiblePanel>

      <CollapsiblePanel id="editor.texture" title="Texture" collapsedByDefault>
        <TexturePanel />
      </CollapsiblePanel>

      {/* Not a file action — it empties the bench rather than writing anything —
          so it stays here while opening and saving moved to the file menu. */}
      <div className="sidebar-actions">
        <button type="button" disabled={!hasMeshes} onClick={reset}>
          Clear
        </button>
      </div>
    </div>
  );
}
