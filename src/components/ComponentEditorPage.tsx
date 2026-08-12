import { ComponentEditorViews } from "./ComponentEditorViews";
import { ComponentEditorSidebar } from "./ComponentEditorSidebar";
import { FileStatusBar } from "./FileStatusBar";
import { useComponentEditorStore } from "../store/useComponentEditorStore";

/**
 * The Component Editor tab: a status strip, the views, and the sidebar.
 *
 * Getting a component on and off the bench is in the tab's file menu (see
 * `FileMenu`), not here — the strip only reports what the last one did. See
 * docs/ui-guide.md for the intended workflow and docs/component-file-format.md
 * for what a load actually restores.
 */
export function ComponentEditorPage() {
  const meshes = useComponentEditorStore((state) => state.meshes);
  const documentName = useComponentEditorStore((state) => state.documentName);

  // What is on the bench, said once: the file it came from if it has a name,
  // otherwise the solids it was built from.
  const lead =
    meshes.length === 0
      ? null
      : (documentName ??
        Object.entries(
          meshes.reduce<Record<string, number>>((acc, m) => {
            const base = m.name.replace(/ \(\d+\)$/, "");
            acc[base] = (acc[base] ?? 0) + 1;
            return acc;
          }, {})
        )
          .map(([name, count]) => (count > 1 ? `${name} — ${count} solids` : name))
          .join(", "));

  return (
    <div className="component-editor-page">
      <FileStatusBar lead={lead} />
      <div className="component-editor-body">
        <div className="component-editor-canvas">
          <ComponentEditorViews />
        </div>
        <ComponentEditorSidebar />
      </div>
    </div>
  );
}
