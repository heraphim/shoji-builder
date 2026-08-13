import type { ReactNode } from "react";

import { useFileStatus } from "../store/useFileStatus";

/**
 * What the last file action had to say, above the views.
 *
 * The actions themselves are up in the tab's file menu, which is shut by the
 * time there is anything to report — so the report goes where the work is
 * instead of where the click was. Not drawn at all when it has nothing to say,
 * rather than standing there empty.
 *
 * @param lead something the page wants said first — what is on the bench, say.
 * @param children a control the tab wants at the right-hand end of the strip.
 *        It keeps the bar on screen on its own, since a control that comes and
 *        goes with the last file action is a control you cannot reach.
 */
export function FileStatusBar({ lead, children }: { lead?: string | null; children?: ReactNode }) {
  const note = useFileStatus((state) => state.note);
  const error = useFileStatus((state) => state.error);

  if (!lead && !note && !error && !children) return null;

  return (
    <div className="file-status">
      {lead && <span className="source-file-name">{lead}</span>}
      {note && <span className="load-report">{note}</span>}
      {error && <span className="load-error">{error}</span>}
      {children && <div className="file-status-end">{children}</div>}
    </div>
  );
}
