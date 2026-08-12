import { useEffect, useState } from "react";
import { useVariablesStore } from "./store/useVariablesStore";
import { ShowcasePage } from "./components/ShowcasePage";
import { LampDesignPage } from "./components/LampDesignPage";
import { ComponentEditorPage } from "./components/ComponentEditorPage";
import { TexturesPage } from "./components/TexturesPage";
import { TextureGeneratorPage } from "./components/TextureGeneratorPage";
import { AssetsPage } from "./components/AssetsPage";
import { FileMenu, type FileMenuTab } from "./components/FileMenu";
import "./App.css";

type Tab = FileMenuTab | "textureGenerator" | "assets";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "lamp", label: "Lamp Design" },
  { id: "componentEditor", label: "Component Editor" },
  { id: "textures", label: "Textures" },
  { id: "textureGenerator", label: "Texture Generator" },
  { id: "assets", label: "Assets" },
];

/**
 * The two tabs with no file menu, and they have none for opposite reasons.
 *
 * **Assets** *is* the library — a menu of ways to reach the library, on the page
 * that shows all of it, would be a door into the room you are standing in.
 * **Texture Generator** keeps no document at all: nothing is on its bench to
 * open, save or rename, and its one write is a button in the middle of the page
 * rather than an item under a caret, because it is pressed every few seconds.
 */
const hasFileMenu = (id: Tab): id is FileMenuTab =>
  id !== "assets" && id !== "textureGenerator";

/** The showcase, or the four-tab workbench behind it. */
type View = "showcase" | "workbench";

/**
 * The showcase, and the five tabs behind it.
 *
 * The app opens on the **showcase** — the lamp itself, in wood, with two
 * sliders. It is not a tab: the tab strip is the workbench's own furniture, and
 * a view whose whole point is that there is nothing in front of the lamp cannot
 * carry a row of file menus across the top of it. The Editor button walks
 * through to the workbench and the leading tab-strip button walks back, with
 * the same lamp on the bench either way — the showcase keeps no design of its
 * own, it shows the one that is loaded.
 *
 * ## The workbench: five tabs over one shared design
 *
 * **Lamp Design** is the assembly — the main box in 3D, the variables that size
 * it, and the components hung on it; **Component Editor** is the four-view
 * workbench a component is drawn in; **Textures** is where what a component is
 * *made of* is designed. They share `useVariablesStore`, and a
 * variable edit made on either one re-cuts the model immediately — the
 * component-editor store subscribes to the variables store directly, so the
 * editor does not have to be mounted for the change to apply.
 *
 * The tabs are in the order the work runs down through the model: an assembly is
 * made of components, and a component is made of a material. Textures is last of
 * the three because it is the only one that changes nothing about the geometry.
 *
 * **Texture Generator** sits after Textures because it is the same subject
 * approached from the other end. Textures is thirty sliders for designing one
 * timber; the generator rolls whole timbers and asks only whether to keep each
 * one, which is what filling a library actually needs. It shares the texture
 * library and nothing else — not even the Textures bench, which it must not
 * disturb.
 *
 * **Assets** is after all of them and is not a bench at all: it is every file the
 * three libraries hold, side by side, which is the one view of the project that
 * cuts across the three. Its Load buttons send a design to whichever of the
 * other tabs owns it, which is why it is handed `setTab`.
 *
 * Each tab carries its own **file menu** under the caret: everything that puts a
 * design on the bench or takes one off it, per tab, in the one place. Pressing
 * the tab body switches to it; pressing the caret opens its menu — and switches
 * first, because a menu that acted on a tab you were not looking at would be
 * acting on a bench you cannot see.
 *
 * Variables are fetched once on mount; nothing renders until they arrive,
 * because every formula in the app resolves against them.
 */
function App() {
  const [view, setView] = useState<View>("showcase");
  const [tab, setTab] = useState<Tab>("lamp");
  const [menu, setMenu] = useState<FileMenuTab | null>(null);
  const loaded = useVariablesStore((state) => state.loaded);
  const loadError = useVariablesStore((state) => state.loadError);
  const loadVariables = useVariablesStore((state) => state.loadVariables);

  useEffect(() => {
    loadVariables();
  }, [loadVariables]);

  const select = (id: Tab) => {
    setTab(id);
    if (menu !== null && menu !== id) setMenu(null);
  };

  const toggleMenu = (id: FileMenuTab) => {
    setTab(id);
    setMenu((current) => (current === id ? null : id));
  };

  // Both views need the variables — every formula in the app resolves against
  // them, and the showcase is a lamp cut from them like any other.
  const loading = loadError ? (
    <div className="loading variables-error">{loadError}</div>
  ) : !loaded ? (
    <div className="loading">Loading...</div>
  ) : null;

  if (view === "showcase") {
    return (
      <div className="app">
        <div className="app-body">
          {loading ?? <ShowcasePage onOpenEditor={() => setView("workbench")} />}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-tabs">
        {/* the way back, in the strip rather than on a page: it leaves the
            workbench altogether, which is not something any one tab does */}
        <button
          type="button"
          className="app-back"
          title="Back to the lamp"
          onClick={() => setView("showcase")}
        >
          &#8592; Showcase
        </button>
        {TABS.map(({ id, label }) => (
          <div key={id} className={"app-tab" + (tab === id ? " active" : "")}>
            <button type="button" className="app-tab-label" onClick={() => select(id)}>
              {label}
            </button>
            {hasFileMenu(id) && (
              <button
                type="button"
                className="app-tab-caret"
                aria-haspopup="menu"
                aria-expanded={menu === id}
                title={`${label} file menu`}
                onClick={() => toggleMenu(id)}
              >
                ▾
              </button>
            )}
            {hasFileMenu(id) && menu === id && <FileMenu tab={id} onClose={() => setMenu(null)} />}
          </div>
        ))}
      </div>

      <div className="app-body">
        {loading ??
          (tab === "lamp" ? (
            <LampDesignPage />
          ) : tab === "componentEditor" ? (
            <ComponentEditorPage />
          ) : tab === "textures" ? (
            <TexturesPage />
          ) : tab === "textureGenerator" ? (
            <TextureGeneratorPage onEdit={() => setTab("textures")} />
          ) : (
            <AssetsPage onOpen={setTab} />
          ))}
      </div>
    </div>
  );
}

export default App;
