import { create } from "zustand";

/**
 * What the last file action had to say.
 *
 * It lives in a store rather than in a page because the two halves are no longer
 * in the same place: the actions are in the file menu, hung off the tab at the
 * top left, and what they have to report belongs beside the work — the strip
 * above the views. The menu is shut by the time there is anything to say.
 *
 * One message at a time, on purpose. These are reports on the thing you just
 * did; a list of them would be a log, and nobody wants a log of their own
 * clicks.
 */
interface FileStatus {
  note: string | null;
  error: string | null;
  setNote: (note: string | null) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useFileStatus = create<FileStatus>((set) => ({
  note: null,
  error: null,
  setNote: (note) => set({ note, error: null }),
  setError: (error) => set({ error, note: null }),
  clear: () => set({ note: null, error: null }),
}));
