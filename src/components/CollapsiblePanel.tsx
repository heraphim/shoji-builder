import type { ReactNode } from "react";
import { usePanelStore } from "../store/usePanelStore";

/**
 * A sidebar panel that folds away, on both tabs.
 *
 * Every panel on the right is one of these, because the parts of the job do not
 * happen at the same time — you place parts, then you size them, and neither
 * wants the other taking up the sidebar while it is the one being used.
 *
 * `id` is what the collapsed state is remembered under (see `usePanelStore`), so
 * it has to be stable and unique across both sidebars — not the title, which is
 * free to be reworded.
 */
export function CollapsiblePanel({
  id,
  title,
  children,
  badge,
  collapsedByDefault = false,
}: {
  id: string;
  title: string;
  children: ReactNode;
  badge?: ReactNode;
  collapsedByDefault?: boolean;
}) {
  const collapsed = usePanelStore((state) => state.collapsed[id] ?? collapsedByDefault);
  const togglePanel = usePanelStore((state) => state.togglePanel);

  return (
    <div className={"side-panel" + (collapsed ? " collapsed" : "")}>
      <button
        type="button"
        className="side-panel-header"
        aria-expanded={!collapsed}
        onClick={() => togglePanel(id, collapsedByDefault)}
      >
        <span className="side-panel-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="side-panel-title">{title}</span>
        {badge != null && <span className="side-panel-badge">{badge}</span>}
      </button>
      {!collapsed && <div className="side-panel-body">{children}</div>}
    </div>
  );
}
