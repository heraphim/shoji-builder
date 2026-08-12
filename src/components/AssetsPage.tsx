import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { View } from "@react-three/drei";
import { AssetPreview } from "./AssetPreview";
import { FileStatusBar } from "./FileStatusBar";
import { loadCatalogue, type Asset, type Catalogue } from "../lib/assets";
import { canWriteToRepo, deleteLibraryFile, type Library } from "../lib/library";
import { loadLibraryComponent } from "../lib/componentFile";
import { loadLibraryTexture, textureDisplayName } from "../lib/textureFile";
import { FINISH_LABELS, SPECIES_LABELS } from "../lib/wood";
import { useComponentEditorStore } from "../store/useComponentEditorStore";
import { useLampStore } from "../store/useLampStore";
import { BENCH_TEXTURE, useTextureStore } from "../store/useTextureStore";
import { useFileStatus } from "../store/useFileStatus";
import type { FileMenuTab } from "./FileMenu";

/**
 * The Assets tab: everything the library holds, as things you can look at.
 *
 * The other three tabs each own one bench and reach the library through a menu
 * that lists file names. That is the right shape for *opening* something you
 * already have in mind and the wrong one for the question this tab answers —
 * what is in there, which of it is finished, and what does any of it look like.
 * A list of names cannot answer that, so this is a grid of cards with a turning
 * model on each.
 *
 * Nothing here is a fourth way to open a design. **Load** calls exactly the
 * loader that tab's own file menu calls, and then switches to that tab, because
 * a design that has been loaded belongs in front of the tools that edit it.
 *
 * **Delete** is the one thing this tab can do that nothing else can, and the one
 * thing that needs a token: saving falls back to a download the user drops in by
 * hand, and there is no equivalent gesture for taking a file *out* of a site you
 * only read. Without a connected repository the button says so and does nothing.
 * With one it arms on the first press and goes on the second — the same
 * two-press confirmation the instance list and the overwrite prompt use, rather
 * than a modal for a file you can see in front of you.
 */

const SECTIONS: Array<{ library: Library; title: string; empty: string }> = [
  { library: "components", title: "Components", empty: "No components in public/models/components." },
  { library: "lamps", title: "Lamps", empty: "No lamps in public/models/lamps." },
  { library: "textures", title: "Textures", empty: "No textures in public/models/textures." },
];

/** Where a card's Load button sends the design. */
const DESTINATION: Record<Library, FileMenuTab> = {
  components: "componentEditor",
  lamps: "lamp",
  textures: "textures",
};

const key = (asset: Asset) => `${asset.library}/${asset.file}`;

/**
 * The two or three things worth knowing about an asset before opening it.
 *
 * All of them are states a *file* can be in that its name cannot tell you: a
 * size nothing measures will not follow a variable, and a component nobody has
 * dressed will arrive on the lamp in flat blue. They are the reasons to open one
 * file rather than another, so they are on the card.
 */
function AssetBadges({ asset }: { asset: Asset }) {
  if (asset.kind === "broken") {
    return (
      <div className="asset-badges">
        <span className="asset-badge warn" title={asset.error}>
          ⚠ unreadable
        </span>
      </div>
    );
  }

  if (asset.kind === "component") {
    const textured = asset.appearance.texture;
    return (
      <div className="asset-badges">
        <span className="asset-badge" title={`${asset.blocks} parametric blocks`}>
          {asset.blocks} ▣
        </span>
        {asset.unmeasured !== null && asset.unmeasured > 0 && (
          <span
            className="asset-badge warn"
            title={
              `${asset.unmeasured} of this component's ${asset.blocks * 3} sizes are not determined by ` +
              "anything — no measurement states them and no chain of measurements reaches them, so " +
              "they stay at the millimetres the solid was drawn at when the lamp changes size. " +
              "Implied sizes are not counted: the solver derives those from the measurements that " +
              "were made, and they scale like any other."
            }
          >
            ⚠ {asset.unmeasured} unmeasured
          </span>
        )}
        {textured ? (
          <span
            className="asset-badge"
            title={`Made of ${textured === BENCH_TEXTURE ? "whatever is on the Textures bench" : textureDisplayName(textured)}, grain along ${asset.appearance.grainAxis.toUpperCase()}`}
          >
            ▤ {textured === BENCH_TEXTURE ? "bench" : textureDisplayName(textured)}
          </span>
        ) : (
          <span
            className="asset-badge"
            title={`No texture chosen — drawn in the flat colour ${asset.appearance.solidColor}`}
          >
            <i className="asset-swatch" style={{ background: asset.appearance.solidColor }} />
            solid
          </span>
        )}
      </div>
    );
  }

  if (asset.kind === "lamp") {
    return (
      <div className="asset-badges">
        <span className="asset-badge" title={`${asset.instances.length} components on the lamp`}>
          {asset.instances.length} ▣
        </span>
        {asset.missing.length > 0 && (
          <span
            className="asset-badge warn"
            title={`Not in the component library: ${asset.missing.join(", ")}`}
          >
            ⚠ {asset.missing.length} missing
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="asset-badges">
      <span className="asset-badge" title="A procedural wood — the numbers, not an image">
        ▤ {SPECIES_LABELS[asset.texture.species]}
      </span>
      <span className="asset-badge" title="The finish the numbers were last taken from">
        {FINISH_LABELS[asset.texture.finish]}
      </span>
    </div>
  );
}

function AssetCard({
  asset,
  armed,
  connected,
  onLoad,
  onArm,
  onDelete,
}: {
  asset: Asset;
  armed: boolean;
  connected: boolean;
  onLoad: () => void;
  onArm: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={"asset-card" + (armed ? " armed" : "")}>
      <AssetPreview asset={asset} />
      <div className="asset-name" title={asset.file}>
        {asset.name}
      </div>
      <AssetBadges asset={asset} />
      <div className="asset-actions">
        <button
          type="button"
          disabled={asset.kind === "broken"}
          title={
            asset.kind === "broken"
              ? "This file cannot be read"
              : `Open ${asset.name} on the ${
                  asset.library === "components"
                    ? "Component Editor"
                    : asset.library === "lamps"
                      ? "Lamp Design"
                      : "Textures"
                } tab`
          }
          onClick={onLoad}
        >
          Load
        </button>
        <button
          type="button"
          className={"asset-delete" + (armed ? " armed" : "")}
          disabled={!connected}
          title={
            connected
              ? armed
                ? `Press again to delete ${asset.file} from the library`
                : `Delete ${asset.file} from the library`
              : "Deleting commits to the repository — connect one under any file menu → Library settings"
          }
          onClick={armed ? onDelete : onArm}
        >
          {armed ? "Delete?" : "Delete"}
        </button>
      </div>
    </div>
  );
}

export function AssetsPage({ onOpen }: { onOpen: (tab: FileMenuTab) => void }) {
  const container = useRef<HTMLDivElement>(null!);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [reading, setReading] = useState(true);
  /** The card whose delete is armed, if any. One at a time. */
  const [armed, setArmed] = useState<string | null>(null);
  const setNote = useFileStatus((state) => state.setNote);
  const setError = useFileStatus((state) => state.setError);

  // Whether a save — or a delete — commits. Read on mount rather than
  // subscribed to: the settings are typed into a dialog on another tab, which
  // unmounts this one.
  const connected = canWriteToRepo();

  const refresh = useCallback(async () => {
    setReading(true);
    try {
      setCatalogue(await loadCatalogue());
    } finally {
      setReading(false);
      setArmed(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Put the asset on the bench it belongs on, and go there.
   *
   * Each branch is the same call that tab's file menu makes, deliberately: a
   * component that opened differently depending on which list you picked it from
   * would be two definitions of what opening one means.
   */
  const load = async (asset: Asset) => {
    if (asset.kind === "broken") return;
    try {
      if (asset.kind === "component") {
        const report = await loadLibraryComponent(asset.file);
        useComponentEditorStore.getState().setDocumentName(asset.name);
        setNote(
          `${asset.name}: ${report.blocks} block${report.blocks === 1 ? "" : "s"} rebuilt at the current variable values` +
            (report.addedVariables.length > 0 ? ` — added ${report.addedVariables.join(", ")}` : "")
        );
      } else if (asset.kind === "lamp") {
        // reports its own failure through the lamp store's error, as the file
        // menu's version of this does
        await useLampStore.getState().loadLamp(asset.file);
        setNote(`Opened ${asset.name}`);
      } else {
        useTextureStore.getState().openTexture(await loadLibraryTexture(asset.file), asset.name);
        setNote(`Opened ${asset.name}`);
      }
      onOpen(DESTINATION[asset.library]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (asset: Asset) => {
    setArmed(null);
    try {
      setNote(await deleteLibraryFile(asset.library, asset.file));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const assets = catalogue?.assets ?? [];

  return (
    <div className="assets-page">
      <FileStatusBar
        lead={
          reading
            ? "Reading the library…"
            : `${assets.length} asset${assets.length === 1 ? "" : "s"} — ${connected ? "read off the branch" : "as the site serves them"}`
        }
      />
      <div className="assets-body" ref={container}>
        <div className="assets-scroll">
          <div className="assets-toolbar">
            <button type="button" onClick={() => void refresh()} disabled={reading}>
              Refresh
            </button>
          </div>

          {catalogue?.errors.map((error) => (
            <div key={error} className="assets-error">
              {error}
            </div>
          ))}

          {SECTIONS.map(({ library, title, empty }) => {
            const inLibrary = assets.filter((asset) => asset.library === library);
            return (
              <section key={library} className="assets-section">
                <h2>
                  {title}
                  <span className="assets-count">{inLibrary.length}</span>
                </h2>
                {inLibrary.length === 0 ? (
                  <div className="assets-empty">{reading ? "…" : empty}</div>
                ) : (
                  <div className="assets-grid">
                    {inLibrary.map((asset) => (
                      <AssetCard
                        key={key(asset)}
                        asset={asset}
                        armed={armed === key(asset)}
                        connected={connected}
                        onLoad={() => void load(asset)}
                        onArm={() => setArmed(key(asset))}
                        onDelete={() => void remove(asset)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* One context for every card — see the note in AssetPreview. */}
        <Canvas className="assets-canvas" eventSource={container} dpr={[1, 2]}>
          <View.Port />
        </Canvas>
      </div>
    </div>
  );
}
