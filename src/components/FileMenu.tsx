import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { useComponentEditorStore } from "../store/useComponentEditorStore";
import { useLampStore } from "../store/useLampStore";
import { useTextureStore, openTextureData } from "../store/useTextureStore";
import { useFileStatus } from "../store/useFileStatus";
import { splitIntoIslands } from "../lib/picking";
import { simplifySolid } from "../lib/assembly";
import {
  componentFileFor,
  listLibraryComponents,
  loadComponentFile,
  loadLibraryComponent,
  sanitizeName,
} from "../lib/componentFile";
import { loadLibraryTexture, textureDisplayName } from "../lib/textureFile";
import { canWriteToRepo, downloadLibraryFile, saveLibraryFile } from "../lib/library";
import { LibrarySettings } from "./LibrarySettings";

/**
 * The file menu, hung off whichever tab it belongs to.
 *
 * Everything that puts a design on the bench or takes one off it is here, and
 * nowhere else. It used to be spread between a toolbar above the views and a
 * panel at the bottom of the sidebar, which meant the two halves of one round
 * trip — save here, open there — were nowhere near each other, and both were
 * taking up room beside work they have nothing to do with. A design is opened
 * and saved a handful of times a session; it does not deserve permanent
 * furniture.
 *
 * The two tabs have nearly the same menu, because they are the same round trip
 * one level apart: a component is parts joined into a component, a lamp is
 * components hung on a box.
 *
 * ## The three ways out
 *
 * - **Save (overwrite)** replaces the file the design was opened from. It asks
 *   nothing, because the answer is already known — and it is offered only when
 *   there is genuinely a file to stand on, which is to say when the name on the
 *   bench is one the library is already holding. A component sawn out of an STL,
 *   a lamp built from scratch, a texture renamed to something new: none of them
 *   have anything to overwrite, and an "overwrite" that quietly creates a file
 *   is a different operation wearing the same word.
 * - **Save (copy)** writes a new file under a name you give it. It checks the
 *   library for that name first and asks before standing on one that is already
 *   there.
 * - **Download** hands the same file to the browser instead of the library.
 *
 * Both saves need a token — Library settings, at the foot of the menu — and are
 * disabled without one. The download never is. That split is the point: a save
 * that silently became a download was indistinguishable, on the way past, from
 * one that had filed the design where the rest of the library is, and the design
 * you thought you had saved is the one you find missing tomorrow. Offering the
 * download as its own item says which of the two just happened.
 */

// ---------------------------------------------------------------------------
// The menu shell
// ---------------------------------------------------------------------------

function MenuItem({
  label,
  onClick,
  disabled,
  title,
  trailing,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  trailing?: ReactNode;
}) {
  return (
    <button type="button" className="file-menu-item" disabled={disabled} title={title} onClick={onClick}>
      <span>{label}</span>
      {trailing != null && <span className="file-menu-trailing">{trailing}</span>}
    </button>
  );
}

/**
 * A file picker on the user's own disk, as a menu row.
 *
 * A label wrapping a hidden input rather than a button that clicks one: the
 * file dialog may only be opened from a real user gesture on the input itself,
 * and routing it through a ref is the version of this that browsers keep
 * breaking.
 */
function UploadItem({
  label,
  accept,
  multiple,
  title,
  onFiles,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  title?: string;
  onFiles: (files: File[]) => void;
}) {
  return (
    <label className="file-menu-item file-menu-upload" title={title}>
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const files = Array.from(event.target.files ?? []);
          // cleared so picking the same file twice running still fires a change
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </label>
  );
}

/**
 * Ask for a name, and refuse to walk over something quietly.
 *
 * The check is against the library listing, so it answers the question actually
 * being asked — "is there already one of these called that?" — rather than
 * "have I saved this before in this session".
 */
function NamePrompt({
  title,
  initial,
  existing,
  onCancel,
  onConfirm,
}: {
  title: string;
  initial: string;
  /** Names already taken, without extensions. */
  existing: string[];
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.select();
  }, []);

  const clean = sanitizeName(name);
  const clash =
    clean !== null && existing.some((e) => e.toLowerCase() === clean.toLowerCase());

  const submit = () => {
    if (clean === null) return;
    if (clash && !confirming) {
      setConfirming(true);
      return;
    }
    onConfirm(clean);
  };

  return (
    <div className="file-dialog-backdrop" onPointerDown={onCancel}>
      <div
        className="file-dialog"
        role="dialog"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <input
          ref={input}
          type="text"
          value={name}
          placeholder="name"
          aria-label="File name"
          onChange={(event) => {
            setName(event.target.value);
            // a changed name is a different question, so the answer to the old
            // one does not carry over
            setConfirming(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape") onCancel();
          }}
        />
        {clash && (
          <p className={confirming ? "file-dialog-warn armed" : "file-dialog-warn"}>
            {confirming
              ? `“${clean}” already exists. Press Overwrite again to stand on it.`
              : `“${clean}” already exists in the library.`}
          </p>
        )}
        <div className="file-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={clean === null} onClick={submit}>
            {clash ? "Overwrite" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The three ways out, which are the same three at all three levels.
 *
 * One component rather than three copies because the *rules* are what is shared:
 * which of them a token gates, which needs the design to be one the library is
 * already holding, and which is always there. Three copies of that is three
 * chances for the levels to disagree about when a save is a save.
 */
function SaveItems({
  connected,
  /** Why there is nothing to save, or null when there is. */
  emptyReason,
  /** What the design is called *as a file*, or null if it has no such name. */
  named,
  /** Whether the library is already holding a file of that name. */
  inLibrary,
  /** The file a download would write, for the row to name. */
  downloadFile,
  onOverwrite,
  onCopy,
  onDownload,
}: {
  connected: boolean;
  emptyReason: string | null;
  named: string | null;
  inLibrary: boolean;
  downloadFile: string;
  onOverwrite: () => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  const blocked = emptyReason ?? (connected ? null : "Saving needs a connected repository — see Library settings, below");

  return (
    <>
      <MenuItem
        label="Save (overwrite)"
        disabled={blocked !== null || !inLibrary}
        title={
          blocked ??
          (inLibrary
            ? `Save over “${named}”`
            : named
              ? `“${named}” is not in the library — save a copy to put it there`
              : "Nothing to overwrite: this has never been saved or opened from the library")
        }
        trailing={inLibrary ? (named ?? undefined) : undefined}
        onClick={onOverwrite}
      />
      <MenuItem
        label="Save (copy)…"
        disabled={blocked !== null}
        title={blocked ?? "Save under a new name"}
        onClick={onCopy}
      />
      {/* Never disabled by the token, only by an empty bench: the way out of the
          app has to be open to somebody who has no way into the repository. */}
      <MenuItem
        label="Download"
        disabled={emptyReason !== null}
        title={emptyReason ?? `Put ${downloadFile} in your downloads`}
        onClick={onDownload}
      />
    </>
  );
}

/** The library listing, as a second page of the menu rather than a submenu. */
function LibraryList({
  files,
  empty,
  strip,
  onPick,
  onBack,
}: {
  files: string[];
  empty: string;
  /** Extension to take off for display. */
  strip: RegExp;
  onPick: (file: string) => void;
  onBack: () => void;
}) {
  return (
    <>
      <button type="button" className="file-menu-item file-menu-back" onClick={onBack}>
        <span>&#8592; Back</span>
      </button>
      <div className="file-menu-list">
        {files.length === 0 && <div className="file-menu-empty">{empty}</div>}
        {files.map((file) => (
          <MenuItem key={file} label={file.replace(strip, "")} onClick={() => onPick(file)} />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The lamp's menu
// ---------------------------------------------------------------------------

function LampFileMenu({ close }: { close: () => void }) {
  const lampLibrary = useLampStore((state) => state.lampLibrary);
  const lampLibraryError = useLampStore((state) => state.lampLibraryError);
  const lampName = useLampStore((state) => state.lampName);
  const instances = useLampStore((state) => state.instances);
  const loadLampLibrary = useLampStore((state) => state.loadLampLibrary);
  const saveLamp = useLampStore((state) => state.saveLamp);
  const loadLamp = useLampStore((state) => state.loadLamp);
  const openLampFile = useLampStore((state) => state.openLampFile);
  const toFile = useLampStore((state) => state.toFile);
  const setError = useFileStatus((state) => state.setError);
  const setNote = useFileStatus((state) => state.setNote);

  const [listing, setListing] = useState(false);
  const [prompting, setPrompting] = useState(false);
  // read once per opening of the menu — it cannot change while this is mounted,
  // because reaching the settings unmounts it
  const [connected] = useState(canWriteToRepo);

  const empty = instances.length === 0;
  const names = lampLibrary.map((file) => file.replace(/(\.lamp)?\.json$/, ""));
  // What the lamp is *called as a file*, which is the question "overwrite"
  // asks. The name can be typed in the sidebar's Name panel, so it is not
  // necessarily something that may go in a file name.
  const named = sanitizeName(lampName ?? "");
  // Whether there is a file to stand on, rather than merely a name. Against the
  // listing loaded below, so a lamp renamed in the sidebar to something the
  // library has never held stops being an overwrite the moment it is renamed.
  const inLibrary =
    named !== null && names.some((n) => n.toLowerCase() === named.toLowerCase());

  // Read when the menu opens, not when the list is asked for.
  //
  // Two reasons. The dev server reads the folder per request, so a lamp saved
  // since the page loaded is already there to be had — and opening the menu is
  // when you would expect to see it. More to the point, "Save (copy)" checks
  // this listing for a name clash, and it has to be able to do that whether or
  // not you happened to browse the library first: a check that quietly passes
  // because it had nothing to check against is worse than no check.
  useEffect(() => {
    void loadLampLibrary();
  }, [loadLampLibrary]);

  const showLibrary = () => {
    void loadLampLibrary();
    setListing(true);
  };

  const upload = async (files: File[]) => {
    close();
    const file = files[0];
    try {
      await openLampFile(JSON.parse(await file.text()), file.name.replace(/(\.lamp)?\.json$/, ""));
      setNote(`Opened ${file.name}`);
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const open = async (file: string) => {
    close();
    await loadLamp(file);
    setNote(`Opened ${file.replace(/(\.lamp)?\.json$/, "")}`);
  };

  const save = async (name?: string) => {
    close();
    try {
      const note = await saveLamp(name);
      if (note) {
        setNote(note);
        void loadLampLibrary();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Not `saveLamp` with the settings taken away: a download is a copy taken out
  // of the app, and it should not rename the lamp on the bench the way filing
  // one under a name does.
  const downloadIt = () => {
    close();
    const built = toFile();
    if (built) setNote(downloadLibraryFile("lamps", `${built.id}.lamp.json`, built.data));
  };

  if (prompting) {
    return (
      <NamePrompt
        title="Save a copy"
        initial={lampName ?? "lamp"}
        existing={names}
        onCancel={() => {
          setPrompting(false);
          close();
        }}
        onConfirm={save}
      />
    );
  }

  if (listing) {
    return (
      <LibraryList
        files={lampLibrary}
        empty={lampLibraryError ?? "No lamps in public/models/lamps."}
        strip={/(\.lamp)?\.json$/}
        onPick={open}
        onBack={() => setListing(false)}
      />
    );
  }

  return (
    <>
      <UploadItem
        label="Upload…"
        accept=".json,application/json"
        title="Open a .lamp.json from your own disk"
        onFiles={upload}
      />
      <MenuItem label="Load…" title="Open a lamp from the project library" onClick={showLibrary} />
      <div className="file-menu-rule" />
      <SaveItems
        connected={connected}
        emptyReason={empty ? "Nothing to save yet" : null}
        named={named}
        inLibrary={inLibrary}
        downloadFile={`${named ?? "lamp"}.lamp.json`}
        onOverwrite={() => save()}
        onCopy={() => setPrompting(true)}
        onDownload={downloadIt}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// The component editor's menu
// ---------------------------------------------------------------------------

function ComponentFileMenu({ close }: { close: () => void }) {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const documentName = useComponentEditorStore((state) => state.documentName);
  const addMesh = useComponentEditorStore((state) => state.addMesh);
  const reset = useComponentEditorStore((state) => state.reset);
  const setDocumentName = useComponentEditorStore((state) => state.setDocumentName);
  const setError = useFileStatus((state) => state.setError);
  const setNote = useFileStatus((state) => state.setNote);

  const [library, setLibrary] = useState<string[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [connected] = useState(canWriteToRepo);

  const empty = meshes.length === 0;
  const names = library.map((file) => file.replace(/(\.component)?\.json$/, ""));
  // As in the lamp menu: what it is called *as a file*, which is what
  // "overwrite" needs and what the Name panel does not guarantee — and whether
  // the library is actually holding one under that name, which is what makes an
  // overwrite an overwrite rather than a first save in disguise.
  const named = sanitizeName(documentName ?? "");
  const inLibrary =
    named !== null && names.some((n) => n.toLowerCase() === named.toLowerCase());

  // On opening the menu, not on opening the list — see the same effect in
  // LampFileMenu for why: "Save (copy)" checks this listing for a name clash,
  // and a check with nothing to check against is worse than no check.
  useEffect(() => {
    let live = true;
    listLibraryComponents()
      .then((files) => {
        if (!live) return;
        setLibrary(files);
        setLibraryError(null);
      })
      .catch((e: unknown) => {
        if (live) setLibraryError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const showLibrary = () => setListing(true);

  /**
   * Import solids from STL.
   *
   * An upload **starts a new component**: the bench is cleared first, then every
   * file in that one selection accumulates onto it.
   *
   * The files are read one after another rather than by firing a FileReader per
   * file and letting them land in whatever order they finish: the order decides
   * which part is which in the parts list, and in the name the export takes its
   * id from, so it must be the order they were picked in.
   */
  const uploadSTL = async (files: File[]) => {
    close();
    reset();
    setNote(null);
    for (const file of files) {
      try {
        const geometry = new STLLoader().parse(await file.arrayBuffer());
        // SketchUp exports STL in cm; the app works in mm
        geometry.scale(10, 10, 10);
        // one STL can hold several disjoint solids — each becomes its own
        // subcomponent so connections can join them
        const islands = splitIntoIslands(geometry);
        islands.forEach((island, i) => {
          const name = islands.length === 1 ? file.name : `${file.name} (${i + 1})`;
          // STL is a triangle soup and a modeller is free to cut a flat face any
          // way it likes — SketchUp routinely splits one face of a block across
          // several triangles, with vertices part-way along an edge. Re-cutting
          // each face here means a block starts life as the twelve triangles it
          // should be, so a join has clean faces to work from and nothing
          // downstream has to cope with the modeller's tessellation.
          addMesh(simplifySolid(island), name);
        });
      } catch (e) {
        // A parse failure used to throw inside a FileReader callback, where
        // nothing could catch it: the file silently never appeared and the user
        // was left looking at a bench that had just been cleared for it.
        setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const report = (name: string, blocks: number, added: string[]) =>
    setNote(
      `${name}: ${blocks} block${blocks === 1 ? "" : "s"} rebuilt at the current variable values` +
        (added.length > 0 ? ` — added ${added.join(", ")}` : "")
    );

  const upload = async (files: File[]) => {
    close();
    const file = files[0];
    const name = file.name.replace(/(\.component)?\.json$/, "");
    try {
      const loaded = loadComponentFile(JSON.parse(await file.text()));
      setDocumentName(name);
      report(name, loaded.blocks, loaded.addedVariables);
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const open = async (file: string) => {
    close();
    const name = file.replace(/(\.component)?\.json$/, "");
    try {
      const loaded = await loadLibraryComponent(file);
      setDocumentName(name);
      report(name, loaded.blocks, loaded.addedVariables);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async (name?: string) => {
    close();
    const file = componentFileFor(name);
    if (!file) return;
    try {
      const note = await saveLibraryFile("components", `${file.id}.component.json`, file);
      setDocumentName(file.id);
      setNote(note);
      listLibraryComponents().then(setLibrary, () => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // As in the lamp menu: a copy taken out of the app, which does not rename the
  // component on the bench the way filing one under a name does.
  const downloadIt = () => {
    close();
    const file = componentFileFor();
    if (file) {
      setNote(downloadLibraryFile("components", `${file.id}.component.json`, file));
    }
  };

  if (prompting) {
    return (
      <NamePrompt
        title="Save a copy"
        initial={documentName ?? "component"}
        existing={names}
        onCancel={() => {
          setPrompting(false);
          close();
        }}
        onConfirm={save}
      />
    );
  }

  if (listing) {
    return (
      <LibraryList
        files={library}
        empty={libraryError ?? "No components in public/models/components."}
        strip={/(\.component)?\.json$/}
        onPick={open}
        onBack={() => setListing(false)}
      />
    );
  }

  return (
    <>
      <UploadItem
        label="Upload STL…"
        accept=".stl"
        multiple
        title="Start a new component from one or more STL solids"
        onFiles={uploadSTL}
      />
      <UploadItem
        label="Upload…"
        accept=".json,application/json"
        title="Open a .component.json from your own disk"
        onFiles={upload}
      />
      <MenuItem
        label="Load…"
        title="Open a component from the project library"
        onClick={showLibrary}
      />
      <div className="file-menu-rule" />
      <SaveItems
        connected={connected}
        emptyReason={empty ? "Nothing on the bench" : null}
        named={named}
        inLibrary={inLibrary}
        // an unnamed component is written under the id derived from the parts,
        // which is not a name this row can know without building the file
        downloadFile={named ? `${named}.component.json` : "this component"}
        onOverwrite={() => save()}
        onCopy={() => setPrompting(true)}
        onDownload={downloadIt}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// The textures menu
// ---------------------------------------------------------------------------

/**
 * The same round trip a third time, one level further down: a texture is a
 * recipe for what a component is made of.
 *
 * It has no "nothing on the bench" state — there is always a texture, because
 * the parameters have defaults and a wood with every slider at zero is still a
 * wood. So the only things that can disable a row here are the two that disable
 * one everywhere: no token, and nothing in the library under this name.
 */
function TextureFileMenu({ close }: { close: () => void }) {
  const documentName = useTextureStore((state) => state.documentName);
  const library = useTextureStore((state) => state.library);
  const libraryError = useTextureStore((state) => state.libraryError);
  const loadLibrary = useTextureStore((state) => state.loadLibrary);
  const openTexture = useTextureStore((state) => state.openTexture);
  const toFile = useTextureStore((state) => state.toFile);
  const setError = useFileStatus((state) => state.setError);
  const setNote = useFileStatus((state) => state.setNote);

  const [listing, setListing] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [connected] = useState(canWriteToRepo);

  const names = library.map(textureDisplayName);
  const named = sanitizeName(documentName ?? "");
  const inLibrary =
    named !== null && names.some((n) => n.toLowerCase() === named.toLowerCase());

  // As in the other two menus: "Save (copy)" checks this listing for a clash,
  // and a check with nothing to check against is worse than no check.
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const upload = async (files: File[]) => {
    close();
    const file = files[0];
    const name = textureDisplayName(file.name);
    try {
      openTextureData(JSON.parse(await file.text()), name);
      setNote(`Opened ${name}`);
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const open = async (fileName: string) => {
    close();
    const name = textureDisplayName(fileName);
    try {
      openTexture(await loadLibraryTexture(fileName), name);
      setNote(`Opened ${name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async (name?: string) => {
    close();
    // sanitised here as the other two menus sanitise theirs: the name can come
    // from the sidebar's Name panel, which takes anything that can be typed
    const id = sanitizeName(name ?? documentName ?? "") ?? "texture";
    try {
      const note = await saveLibraryFile("textures", `${id}.texture.json`, toFile(id));
      useTextureStore.getState().setDocumentName(id);
      setNote(note);
      void loadLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const downloadIt = () => {
    close();
    const id = named ?? "texture";
    setNote(downloadLibraryFile("textures", `${id}.texture.json`, toFile(id)));
  };

  if (prompting) {
    return (
      <NamePrompt
        title="Save a copy"
        initial={documentName ?? "texture"}
        existing={names}
        onCancel={() => {
          setPrompting(false);
          close();
        }}
        onConfirm={save}
      />
    );
  }

  if (listing) {
    return (
      <LibraryList
        files={library}
        empty={libraryError ?? "No textures in public/models/textures."}
        strip={/(\.texture)?\.json$/}
        onPick={open}
        onBack={() => setListing(false)}
      />
    );
  }

  return (
    <>
      <UploadItem
        label="Upload…"
        accept=".json,application/json"
        title="Open a .texture.json from your own disk"
        onFiles={upload}
      />
      <MenuItem
        label="Load…"
        title="Open a texture from the project library"
        onClick={() => {
          void loadLibrary();
          setListing(true);
        }}
      />
      <div className="file-menu-rule" />
      <SaveItems
        connected={connected}
        // never empty: the parameters have defaults, and a wood with every
        // slider at zero is still a wood
        emptyReason={null}
        named={named}
        inLibrary={inLibrary}
        downloadFile={`${named ?? "texture"}.texture.json`}
        onOverwrite={() => save()}
        onCopy={() => setPrompting(true)}
        onDownload={downloadIt}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

export type FileMenuTab = "lamp" | "componentEditor" | "textures";

/**
 * The dropdown itself: closes on Escape, and on a pointer press anywhere that is
 * not inside it.
 *
 * `pointerdown` rather than `click`, so the menu is gone before whatever was
 * pressed reacts — a click-to-close that fires after the target has already
 * handled the press reads as the menu having eaten it.
 */
export function FileMenu({ tab, onClose }: { tab: FileMenuTab; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState(false);
  // read once per opening of the menu, which is the only moment it can change
  // without this component being unmounted anyway
  const [connected, setConnected] = useState(canWriteToRepo);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menu.current?.contains(target)) return;
      // the tab's own caret closes the menu by toggling; letting this fire too
      // would close and immediately reopen it
      if (target instanceof Element && target.closest(".app-tab-caret")) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // The settings are the same settings whichever tab asked for them — one
  // library, read and written from three levels of the same design — so they
  // live in the shell rather than three times over in the menus.
  if (settings) {
    return (
      <div className="file-menu" ref={menu}>
        <LibrarySettings
          onClose={() => {
            setConnected(canWriteToRepo());
            setSettings(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="file-menu" ref={menu}>
      {tab === "lamp" ? (
        <LampFileMenu close={onClose} />
      ) : tab === "componentEditor" ? (
        <ComponentFileMenu close={onClose} />
      ) : (
        <TextureFileMenu close={onClose} />
      )}
      <div className="file-menu-rule" />
      <MenuItem
        label="Library settings…"
        title={
          connected
            ? "Saving commits to your repository"
            : "Saving is off until a repository is connected — download still works"
        }
        trailing={connected ? "connected" : "download only"}
        onClick={() => setSettings(true)}
      />
    </div>
  );
}
