import { useEffect, useMemo, useRef, useState } from "react";
import { VariablesList } from "./VariablesList";
import { LookOptions } from "./LookOptions";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { DocumentPanel } from "./DocumentPanel";
import { mainBoxOf } from "../lib/lamp";
import { planSymmetryFill, type SymmetryPlan } from "../lib/symmetry";
import { useLampStore } from "../store/useLampStore";
import { useVariablesStore } from "../store/useVariablesStore";
import type { ConnectDraft } from "../store/useLampStore";

/**
 * The Lamp Design sidebar: the design variables, and the components hung on the
 * box.
 *
 * Both panels collapse, because the two halves of the job do not happen at the
 * same time — you place parts, then you size them, and neither wants the other
 * taking up the panel while it is the one being used. Which are folded is
 * remembered across reloads; see `usePanelStore`.
 *
 * Saving and opening a lamp is in the tab's file menu, not here.
 *
 * See docs/ui-guide.md.
 */

/**
 * The show/hide eye.
 *
 * Drawn rather than set as a character: every other icon in these rows is a
 * plain glyph, and the only eye Unicode offers is an emoji — which Windows
 * renders in full colour at a size of its own choosing, next to five monochrome
 * siblings. This one is `currentColor`, so it takes the button's state colour
 * with it and lines up with the rest.
 */
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M1 8s2.6-4.2 7-4.2S15 8 15 8s-2.6 4.2-7 4.2S1 8 1 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" fill="currentColor" />
      {/* the struck-through eye is the one that is *not* looking */}
      {!open && (
        <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="1.3" />
      )}
    </svg>
  );
}

// What the five clicks of a connection are asking for, in order. The second
// click is the one that lands on the fourth: the part meets the target there,
// and the fifth says which way the target runs from it.
//
// The third is the odd one and the prompt has to say so, because it is the only
// click that does not pick a point — it names the body, which clears everything
// else out of the way so the two after it can be picked on a face that was
// behind something.
function draftPrompt(draft: ConnectDraft): string {
  if (draft.source.length === 0) return "Click the far point on the part — its end of the axis.";
  if (draft.source.length === 1) return "Click the point on the part that meets the target.";
  if (!draft.targetRef) {
    return "Click the main box or the component this goes onto — everything else is hidden while you pick on it.";
  }
  if (draft.target.length === 0) return "Now click where that point lands.";
  return "Click a second point on it — the part runs the other way from it.";
}

// What pressing "fill the symmetry" would do, said in the tooltip so the count
// is known before the click rather than after it.
function symmetryHint(plan: SymmetryPlan): string {
  const places = plan.slots.length;
  if (plan.open.length === 0) {
    return `All ${places} symmetric places already hold this part.`;
  }
  const parametric =
    plan.parametric > 0
      ? ` ${plan.parametric} of them sit on a face of a different span — check the part is sized off that face, not off innerWidth.`
      : "";
  return (
    `Fill the symmetry: up to ${plan.open.length} more of these ${places} places` +
    ` — any whose wood would land inside a part already standing are skipped.${parametric}`
  );
}

function ComponentsPanel() {
  const library = useLampStore((state) => state.library);
  const libraryError = useLampStore((state) => state.libraryError);
  const error = useLampStore((state) => state.error);
  const instances = useLampStore((state) => state.instances);
  const draft = useLampStore((state) => state.draft);

  const loadLibrary = useLampStore((state) => state.loadLibrary);
  const insertComponent = useLampStore((state) => state.insertComponent);
  const removeInstance = useLampStore((state) => state.removeInstance);
  const copyInstance = useLampStore((state) => state.copyInstance);
  const fillSymmetry = useLampStore((state) => state.fillSymmetry);
  const previewSymmetry = useLampStore((state) => state.previewSymmetry);
  const startConnect = useLampStore((state) => state.startConnect);
  const cancelConnect = useLampStore((state) => state.cancelConnect);
  const disconnect = useLampStore((state) => state.disconnect);
  const rollConnection = useLampStore((state) => state.rollConnection);
  const setHighlighted = useLampStore((state) => state.setHighlighted);
  const hiddenIds = useLampStore((state) => state.hiddenIds);
  const toggleVisibility = useLampStore((state) => state.toggleVisibility);

  const [picking, setPicking] = useState(false);
  const dropdown = useRef<HTMLDivElement>(null);

  // The sidebar scrolls, and the Components panel sits at the bottom of it, so
  // an open list hangs past the scroll edge and only its first row shows. Bring
  // it into view — again once the list lands, since it is fetched on opening and
  // the height it needs is not known until then.
  useEffect(() => {
    if (picking) dropdown.current?.scrollIntoView({ block: "nearest" });
  }, [picking, library.length]);

  // The orbit of a connection needs only the box the anchors are fractions of,
  // not a laid-out scene, so a row can ask on every render. The geometry that
  // does need one is deferred to the action.
  const raw = useVariablesStore((state) => state.raw);
  const mainBox = useMemo(() => mainBoxOf(raw), [raw]);
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const insert = async (file: string) => {
    setPicking(false);
    await insertComponent(file);
  };

  // Re-list on opening, not only on mount. The dev server reads the folder per
  // request, so a component saved since the page loaded is already there to be
  // had — and opening the picker is exactly when you would expect to see it.
  // Fire-and-forget: the list already on screen shows straight away and the
  // fresh one replaces it when it lands.
  const togglePicker = () => {
    if (!picking) void loadLibrary();
    setPicking(!picking);
  };

  return (
    <>
      <div className="insert-component">
        {/* Never disabled, even with nothing in the library: opening it is what
            re-reads the folder, so a disabled button would be a dead end for the
            one case it is meant to describe — an empty library that has since
            gained its first component. */}
        <button type="button" className="lamp-primary" onClick={togglePicker}>
          Insert component {picking ? "▴" : "▾"}
        </button>
        {picking && (
          <div className="insert-dropdown" ref={dropdown}>
            {library.length === 0 && <div className="lamp-empty">No components in the library.</div>}
            {library.map((file) => (
              <button key={file} type="button" onClick={() => insert(file)}>
                {file.replace(/(\.component)?\.json$/, "")}
              </button>
            ))}
          </div>
        )}
      </div>

      {libraryError && <div className="lamp-error">{libraryError}</div>}
      {error && <div className="lamp-error">{error}</div>}

      {draft && (
        <div className="lamp-pick-status">
          <span>{draftPrompt(draft)}</span>
          <button type="button" onClick={cancelConnect}>
            Cancel
          </button>
        </div>
      )}

      <div className="instance-list-lamp">
        {instances.length === 0 && (
          <div className="lamp-empty">Nothing inserted yet.</div>
        )}
        {instances.map((instance) => {
          const connected = instance.connection !== null;
          const busy = draft !== null && draft.instanceId !== instance.id;
          const picking = draft?.instanceId === instance.id;
          const visible = !hidden.has(instance.id);
          const symmetry = planSymmetryFill(instances, mainBox, instance.id);
          return (
            <div
              key={instance.id}
              className={"lamp-instance-row" + (draft?.instanceId === instance.id ? " armed" : "")}
              onPointerEnter={() => setHighlighted(instance.id)}
              onPointerLeave={() => {
                setHighlighted(null);
                // belt and braces: leaving the row must clear the preview even
                // if the pointer left the button by a route that skipped it
                previewSymmetry(null);
              }}
            >
              <span className="lamp-instance-name" title={instance.def.file}>
                {instance.label}
              </span>
              {/* One icon for both directions, because it is one state with two
                  sides: lit means the part is on the lamp, and pressing it takes
                  it off. The row is already outlined while its pick is running,
                  so the icon does not have to say "Picking…" as well. */}
              <button
                type="button"
                className={
                  "lamp-icon" +
                  (connected ? " lamp-icon-on" : "") +
                  (picking ? " lamp-icon-armed" : "")
                }
                disabled={busy}
                onClick={() =>
                  connected
                    ? disconnect(instance.id)
                    : picking
                      ? cancelConnect()
                      : startConnect(instance.id)
                }
                title={
                  connected
                    ? "Attached — take this part off and stand it aside"
                    : picking
                      ? "Cancel this pick"
                      : "Attach: pick two points on this part, then two on what it goes onto"
                }
              >
                ⚭
              </button>
              {/* Out of sight, out of the raycast — see `toggleVisibility`. Lit
                  means you can see it, which is the state worth reading at a
                  glance down a list of a dozen parts. */}
              <button
                type="button"
                className={"lamp-icon" + (visible ? " lamp-icon-on" : "")}
                title={visible ? "Visible — click to hide" : "Hidden — click to show"}
                onClick={() => toggleVisibility(instance.id)}
              >
                <EyeIcon open={visible} />
              </button>
              {/* Only while connected: the two picked points fix the part's axis
                  and leave it free to spin about that line, and this is that one
                  remaining choice. A loose part has no such axis to turn about. */}
              {connected && (
                <button
                  type="button"
                  className="lamp-icon"
                  title={`Turn 90° about the connection axis (now ${instance.connection?.roll ?? 0}°)`}
                  onClick={() => rollConnection(instance.id, 90)}
                >
                  ⟳
                </button>
              )}
              {/* Only for a part fixed to the main box, and only when the
                  feature it is fixed to has images other than itself. A part
                  hung off another part inherits its parent's symmetry, so it
                  gets carried by filling the parent rather than filled itself. */}
              {/* Not `disabled`: a disabled button fires no pointer events, and
                  a spent symmetry is exactly when you most want to hover it and
                  see which parts are the set. So it is dead by `aria-disabled`
                  and a class, and still hoverable. */}
              {symmetry && symmetry.slots.length > 1 && (
                <button
                  type="button"
                  className={
                    "lamp-icon" + (symmetry.open.length === 0 ? " lamp-icon-spent" : "")
                  }
                  aria-disabled={symmetry.open.length === 0}
                  title={symmetryHint(symmetry)}
                  onPointerEnter={() => previewSymmetry(instance.id)}
                  onPointerLeave={() => previewSymmetry(null)}
                  onClick={() => symmetry.open.length > 0 && fillSymmetry(instance.id)}
                >
                  ❖
                </button>
              )}
              <button
                type="button"
                className="lamp-icon"
                title="Duplicate"
                onClick={() => copyInstance(instance.id)}
              >
                ⧉
              </button>
              <button
                type="button"
                className="lamp-icon lamp-delete"
                title="Delete"
                onClick={() => removeInstance(instance.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function LampSidebar() {
  const instances = useLampStore((state) => state.instances);
  const lampName = useLampStore((state) => state.lampName);
  const description = useLampStore((state) => state.description);
  const setLampName = useLampStore((state) => state.setLampName);
  const setDescription = useLampStore((state) => state.setDescription);

  return (
    <div className="lamp-sidebar">
      <DocumentPanel
        id="lamp.document"
        what="lamp"
        extension=".lamp.json"
        name={lampName}
        description={description}
        onName={setLampName}
        onDescription={setDescription}
      />

      {/* Folded to start with, unlike every other newly added panel: it sits
          above Variables so that it is quick to reach when the view has gone
          unreadable, and a panel that is both above the working panel and open
          by default has pushed the working panel down for everyone who never
          needed it. */}
      <CollapsiblePanel id="lamp.options" title="Options" collapsedByDefault>
        <LookOptions />
      </CollapsiblePanel>

      <CollapsiblePanel id="lamp.variables" title="Variables (mm)">
        <VariablesList sliders />
      </CollapsiblePanel>

      <CollapsiblePanel id="lamp.components" title="Components" badge={instances.length || null}>
        <ComponentsPanel />
      </CollapsiblePanel>
    </div>
  );
}
