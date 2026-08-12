import { useEffect, useState } from "react";
import { useVariablesStore } from "./store/useVariablesStore";
import { LampDesignPage } from "./components/LampDesignPage";
import { ComponentEditorPage } from "./components/ComponentEditorPage";
import { TexturesPage } from "./components/TexturesPage";
import { FileMenu, type FileMenuTab } from "./components/FileMenu";
import "./App.css";

type Tab = FileMenuTab;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "lamp", label: "Lamp Design" },
  { id: "componentEditor", label: "Component Editor" },
  { id: "textures", label: "Textures" },
];

/**
 * Three tabs over one shared design.
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
 * made of components, and a component is made of a material. Textures is last
 * because it is the only one that changes nothing about the geometry.
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
  const [tab, setTab] = useState<Tab>("lamp");
  const [menu, setMenu] = useState<Tab | null>(null);
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

  const toggleMenu = (id: Tab) => {
    setTab(id);
    setMenu((current) => (current === id ? null : id));
  };

  return (
    <div className="app">
      <div className="app-tabs">
        {TABS.map(({ id, label }) => (
          <div key={id} className={"app-tab" + (tab === id ? " active" : "")}>
            <button type="button" className="app-tab-label" onClick={() => select(id)}>
              {label}
            </button>
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
            {menu === id && <FileMenu tab={id} onClose={() => setMenu(null)} />}
          </div>
        ))}
      </div>

      <div className="app-body">
        {loadError ? (
          <div className="loading variables-error">{loadError}</div>
        ) : !loaded ? (
          <div className="loading">Loading...</div>
        ) : tab === "lamp" ? (
          <LampDesignPage />
        ) : tab === "componentEditor" ? (
          <ComponentEditorPage />
        ) : (
          <TexturesPage />
        )}
      </div>
    </div>
  );
}

export default App;
