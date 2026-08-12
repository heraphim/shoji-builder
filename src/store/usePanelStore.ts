import { create } from "zustand";

/**
 * Which sidebar panels are collapsed, kept across reloads.
 *
 * A panel's open/shut state is a working preference, not part of the design: it
 * says which half of the job you are on right now. That makes it exactly the
 * kind of thing that should still be true when you come back — a panel you shut
 * because it was in the way should not be open again tomorrow.
 *
 * Keyed by a stable string per panel rather than by position, so re-ordering the
 * sidebar or adding a panel above another does not shuffle everybody's state.
 * An unknown key reads as open, which is what a newly added panel should be.
 */

const STORAGE_KEY = "shoji.panels.collapsed";

function read(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Only the booleans: a hand-edited or half-written entry should cost that
    // one panel its state, not throw on every render of the sidebar.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "boolean")
    ) as Record<string, boolean>;
  } catch {
    // private mode, a full quota, a disabled storage — none of them are worth
    // failing to draw the sidebar over
    return {};
  }
}

function write(collapsed: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  } catch {
    // as above: the panel still collapses, it just will not be remembered
  }
}

interface PanelStore {
  collapsed: Record<string, boolean>;
  isCollapsed: (id: string, collapsedByDefault?: boolean) => boolean;
  togglePanel: (id: string, collapsedByDefault?: boolean) => void;
}

export const usePanelStore = create<PanelStore>((set, get) => ({
  collapsed: read(),

  isCollapsed: (id, collapsedByDefault = false) => get().collapsed[id] ?? collapsedByDefault,

  togglePanel: (id, collapsedByDefault = false) =>
    set((state) => {
      const collapsed = {
        ...state.collapsed,
        [id]: !(state.collapsed[id] ?? collapsedByDefault),
      };
      write(collapsed);
      return { collapsed };
    }),
}));
