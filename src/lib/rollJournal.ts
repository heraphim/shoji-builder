import { canWriteToRepo, commitFiles, type RepoFile } from "./library";
import type { TextureFile } from "./textureFile";

/**
 * Every roll the generator shows, kept or thrown away, on its way to the branch.
 *
 * The generator used to commit on Accept and remember nothing about a Reject,
 * which threw away the more informative half of the session. Fifteen keeps
 * against a known prior can only find a bias big enough to see by eye; the rolls
 * you turned down are what say where the line actually is.
 *
 * They cannot be committed the way a keep was, though. A reject is one click and
 * the next wood, and a round trip in the middle of that is the whole page
 * ruined — so nothing here writes when it is told to. A roll goes in the buffer,
 * the buffer goes to localStorage, and a timer that {@link IDLE_MS} keeps
 * pushing forward lands the lot in one commit once you stop.
 *
 * ## Why the buffer is on disk and not in a ref
 *
 * Because the flush that matters most is the one nobody triggers. A tab closed
 * mid-batch gets a `pagehide` and about no time to use it — five chained
 * requests will not finish, and `keepalive` cannot carry a request chain. So
 * durability is not attempted at the exit at all: every roll is written to
 * localStorage the moment it happens, and an unflushed buffer is picked up and
 * pushed by the next mount. The exit handlers are an optimisation on top of
 * that, not the guarantee.
 *
 * ## Why this is not in the component
 *
 * The generator page unmounts when you change tabs, and a timer in a `useEffect`
 * would go with it — the buffer would sit there until you came back. Module
 * state outlives the page, so the push you walked away from still happens.
 */

/** How long the rolling has to stop before the batch goes up. */
export const IDLE_MS = 5000;

/** Where a kept wood lands: the texture library, exactly as before. */
const KEPT_DIR = "public/models/textures";

/**
 * And where a rejected one lands.
 *
 * Beside the library rather than inside it, because the app must never offer one
 * — `listLibrary` reads a folder and every file in it is a texture you can pick.
 * Still under `public/models`, which is what the deploy's `paths-ignore` is
 * written against: a push of rejects should not spend a minute of Actions
 * rebuilding the site. The cost of that choice is that they are copied into the
 * build whenever a deploy does run, so this folder is not free for ever.
 */
const REJECTED_DIR = "public/models/textures-rejected";

const STORE_KEY = "shoji-builder.rolls";

export type Verdict = "keep" | "reject";

interface PendingRoll {
  verdict: Verdict;
  /** The file name, without the extension. Already made unique. */
  name: string;
  file: TextureFile;
}

export interface RollStatus {
  /** How many rolls are written down but not yet on the branch. */
  pending: number;
  pushing: boolean;
  /** What the last push did, or null if none has finished this session. */
  note: string | null;
  /** Why the last push did not happen. The buffer is still intact. */
  error: string | null;
}

let buffer: PendingRoll[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let note: string | null = null;
let error: string | null = null;
let wired = false;

const listeners = new Set<() => void>();

// ---------------------------------------------------------------------------
// The buffer
// ---------------------------------------------------------------------------

/**
 * The buffer, read from localStorage the first time anything asks.
 *
 * Anything unparseable is dropped rather than repaired. The alternative is a
 * generator that will not start because of a half-written journal entry, and a
 * lost reject is worth less than a working page by a long way.
 */
function load(): PendingRoll[] {
  if (buffer) return buffer;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const saved = raw ? (JSON.parse(raw) as PendingRoll[]) : [];
    buffer = Array.isArray(saved) ? saved.filter((r) => r?.name && r?.file) : [];
  } catch {
    buffer = [];
  }
  return buffer;
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(buffer ?? []));
  } catch {
    // A full or disabled localStorage costs this session's durability and
    // nothing else: the buffer is still in memory and still gets pushed.
  }
}

function announce(): void {
  for (const fn of listeners) fn();
}

// ---------------------------------------------------------------------------
// What the page reads
// ---------------------------------------------------------------------------

export function rollStatus(): RollStatus {
  return { pending: load().length, pushing, note, error };
}

/**
 * The names already spoken for by the buffer.
 *
 * The library listing cannot know about them — they are not on the branch yet —
 * and `freeName` checking only the listing would hand the same name to two rolls
 * in one batch. Two entries at one path in a tree is a commit that silently
 * keeps whichever came last, which for a species, finish and seed that collided
 * would lose a roll without saying so.
 */
export function pendingRollNames(): string[] {
  return load().map((r) => r.name);
}

export function subscribeRolls(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Recording and pushing
// ---------------------------------------------------------------------------

/**
 * Write one roll down and restart the clock.
 *
 * @returns false when there is no token — nothing was recorded and the caller
 *   should do whatever it does without a repository, which for Accept is the
 *   download it has always offered. A reject with nowhere to go is simply not
 *   kept: a page that downloaded every wood you turned down would be a page
 *   nobody would press Reject on twice.
 */
export function recordRoll(verdict: Verdict, name: string, file: TextureFile): boolean {
  if (!canWriteToRepo()) return false;
  wire();
  load().push({ verdict, name, file });
  persist();
  note = null;
  arm();
  announce();
  return true;
}

/** Push the batch once the rolling has stopped for {@link IDLE_MS}. */
function arm(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushRolls();
  }, IDLE_MS);
}

/**
 * Send everything buffered, now.
 *
 * Kept on failure, always. The commit is all-or-nothing — see `commitFiles` —
 * so a throw means not one of these files landed, and clearing the buffer would
 * be throwing away the session to tidy up after a network blip. It stays, the
 * error goes on screen, and the next roll or the next mount tries again.
 */
export async function flushRolls(): Promise<void> {
  if (pushing) return;
  const batch = load();
  if (batch.length === 0) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  pushing = true;
  error = null;
  announce();

  const kept = batch.filter((r) => r.verdict === "keep").length;
  const sent = batch.length;
  const files: RepoFile[] = batch.map((r) => ({
    path: `${r.verdict === "keep" ? KEPT_DIR : REJECTED_DIR}/${encodeURIComponent(r.name)}.texture.json`,
    // The same bytes `saveLibraryFile` would have written, so a texture saved
    // here and re-saved from the file menu is not a diff.
    text: JSON.stringify(r.file, null, 2),
  }));

  try {
    await commitFiles(files, describe(kept, sent - kept));
    // Spliced rather than assigned empty: a roll recorded while the request was
    // in flight is at the end of this same array, and dropping it would lose
    // the one wood you judged while waiting.
    batch.splice(0, sent);
    persist();
    note = `Pushed ${kept} kept and ${sent - kept} rejected`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    pushing = false;
    // Anything that arrived mid-push, or a failure to retry, wants a clock.
    if (batch.length > 0) arm();
    announce();
  }
}

/** The commit subject, in the repository's voice. */
function describe(kept: number, rejected: number): string {
  const parts = [kept > 0 && `keep ${kept}`, rejected > 0 && `reject ${rejected}`].filter(
    (p): p is string => Boolean(p)
  );
  const said = parts.join(" and ");
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/**
 * The two exits worth trying, hooked up once.
 *
 * `visibilitychange` is the one that mostly works — switching browser tabs
 * leaves the page alive and the five requests complete behind you. `pagehide`
 * is a genuine long shot for the reasons in the file header, and it is here
 * because it costs one line and occasionally saves the batch. Neither is what
 * makes the buffer safe; localStorage is.
 */
function wire(): void {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flushRolls();
  });
  window.addEventListener("pagehide", () => {
    void flushRolls();
  });
}
