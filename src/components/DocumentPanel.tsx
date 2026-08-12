import { CollapsiblePanel } from "./CollapsiblePanel";
import { sanitizeName } from "../lib/componentFile";

/**
 * What the thing on the bench is called, and what it is.
 *
 * The same panel at the top of all three sidebars, because all three tabs are
 * the same round trip one level apart — a texture is what a component is made
 * of, a component is what a lamp is built from — and the two questions every one
 * of them has to answer before it is worth saving are the same two.
 *
 * ## The name here is the file name
 *
 * Not a label beside one. **Save (overwrite)** writes `<name><extension>`, so
 * typing a new name here and overwriting is how a design is renamed — the old
 * file stays behind until it is deleted from the Assets tab, which is the only
 * place in the app that can take a file out of the library.
 *
 * That is also why the note under the field spells the file name out: what may
 * go in one is narrower than what may be typed (`sanitizeName`), and a design
 * saved as `frame2` when `frame/2` was typed should say so before the save
 * rather than in the status bar afterwards.
 *
 * ## Why a description at all
 *
 * Nothing reads it. A library of `frameHorizontal`, `frameVertical`,
 * `frameVertical2` cannot say which one takes the shoji panel, and a name long
 * enough to say it is not a name any more. It is written into the file beside
 * the geometry — see the `description` note in lib/componentFile.ts.
 */
export function DocumentPanel({
  id,
  what,
  extension,
  name,
  description,
  onName,
  onDescription,
}: {
  /** Where the collapsed state is remembered — unique across all sidebars. */
  id: string;
  /** "component", "lamp", "texture" — what the empty field is short of. */
  what: string;
  /** What a save appends to the name, e.g. `.component.json`. */
  extension: string;
  name: string | null;
  description: string;
  onName: (name: string | null) => void;
  onDescription: (description: string) => void;
}) {
  const clean = sanitizeName(name ?? "");

  return (
    <CollapsiblePanel id={id} title="Name & description">
      <div className="document-panel">
        <label className="document-field">
          <span className="document-label">Name</span>
          <input
            type="text"
            className="document-name"
            value={name ?? ""}
            placeholder={`unnamed ${what}`}
            // null rather than "" for an emptied field: null is what the rest of
            // the app already means by "never named", and it is what makes the
            // next overwrite ask for a name instead of writing `.component.json`
            onChange={(event) => onName(event.target.value || null)}
          />
        </label>

        <p className="document-note">
          {clean ? (
            <>
              Saving writes <code>{clean + extension}</code>.
            </>
          ) : (
            `No name yet — saving will ask for one.`
          )}
        </p>

        <label className="document-field">
          <span className="document-label">Description</span>
          <textarea
            className="document-description"
            rows={3}
            value={description}
            placeholder="What it is for, and anything worth knowing next time."
            onChange={(event) => onDescription(event.target.value)}
          />
        </label>
      </div>
    </CollapsiblePanel>
  );
}
