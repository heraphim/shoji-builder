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
 */
export function FileStatusBar({ lead }: { lead?: string | null }) {
  const note = useFileStatus((state) => state.note);
  const error = useFileStatus((state) => state.error);

  if (!lead && !note && !error) return null;

  return (
    <div className="file-status">
      {lead && <span className="source-file-name">{lead}</span>}
      {note && <span className="load-report">{note}</span>}
      {error && <span className="load-error">{error}</span>}
    </div>
  );
}
