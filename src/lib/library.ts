/**
 * Where the three libraries are read from, and where a save goes.
 *
 * A component, a lamp and a texture are the same round trip at three levels, and
 * all three used to end the same way: the browser downloaded a file and you
 * dropped it into `public/models/…` by hand, because a page has nowhere to write.
 *
 * Deployed, it has somewhere. The site is GitHub Pages, Pages is a branch of a
 * repository, and a repository can be written to — over the contents API, with a
 * token. So a save commits the file: the design is in the library for good
 * rather than for this session.
 *
 * The commit does not republish the site. `public/models/**` is ignored by the
 * deploy workflow, because a minute of Actions to publish one JSON file is not
 * worth paying per save — see .github/workflows/deploy.yml.
 *
 * ## The token
 *
 * Typed into the settings panel once and kept in this browser's localStorage. It
 * is never in the source, never in the bundle, and never sent anywhere but
 * api.github.com. Nobody else loading the site has it, which is what makes a
 * public read-only site with a private save button possible at all.
 *
 * ## One source, two ways of reading it
 *
 * The library used to be in two places at once. A visitor read what the *build*
 * served, which was the library as it stood at the last push of code — and a
 * save does not push code, so their copy was frozen at a moment that had nothing
 * to do with the library. Whoever held the token read the branch, and saw
 * something else. Same app, two libraries, and no way to tell from inside which
 * one you were looking at.
 *
 * Now there is one: the {@link LIBRARY_BRANCH} branch of this repository, which
 * everybody reads and only a token writes. What differs is the transport, and
 * only because the two readers want different things from it:
 *
 * - **Without a token** — `raw.githubusercontent.com`, which needs no
 *   credentials, sends `Access-Control-Allow-Origin: *` so a page may fetch it,
 *   and is a CDN rather than the API, so it is not spending the sixty
 *   unauthenticated API requests an hour that every visitor shares. It caches
 *   for five minutes, which is the whole cost of this design: a save is public
 *   within five minutes instead of instantly.
 * - **With one** — the contents API, against that same branch. Not for
 *   permission, which reading never needs, but for freshness: the person who
 *   just saved is the one person for whom a five-minute-old answer is obviously
 *   wrong, because they are looking for the file they just wrote.
 *
 * Neither can show the other something the branch does not say.
 *
 * ## Listing a folder nobody can list
 *
 * `raw` serves a file, never a directory, so a reader without a token cannot ask
 * what is in a library. Each one therefore carries an `index.json` of its own
 * names — and the danger with a listing kept beside the things it lists is that
 * it stops agreeing with them. So no caller maintains it: {@link commitFiles}
 * rebuilds it from the branch itself inside the very commit that changes a
 * library, and it is the only way anything here writes. A file cannot land
 * unlisted, because landing is what lists it.
 */

/** The three libraries, which are the three folders under `public/models`. */
export type Library = "components" | "lamps" | "textures";

/**
 * Where the library is when nobody has said otherwise.
 *
 * Compiled in rather than configured, because the reader who needs it most is
 * the one who has configured nothing: a visitor has no settings and must still
 * know which branch of which repository the pickers are showing. A fork
 * overrides them at build time —
 *
 * ```
 * VITE_LIBRARY_OWNER=you VITE_LIBRARY_REPO=your-fork npm run build
 * ```
 *
 * — and a token holder overrides them again in the settings panel, which is how
 * you point the app at a branch to try something out without publishing it.
 */
export const LIBRARY_OWNER = import.meta.env.VITE_LIBRARY_OWNER ?? "heraphim";
export const LIBRARY_REPO = import.meta.env.VITE_LIBRARY_REPO ?? "shoji-builder";
export const LIBRARY_BRANCH = import.meta.env.VITE_LIBRARY_BRANCH ?? "library";

/** Everything a write needs, as typed into the settings panel. */
export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** A fine-grained token with Contents: read and write on that repository. */
  token: string;
}

const CONFIG_KEY = "shoji-builder.repo";

/**
 * The branch the library was on before it had one of its own.
 *
 * Settings saved then still name it, and a browser that was connected before the
 * move goes on quietly committing designs to the branch the *app* is deployed
 * from: they land as source changes, they are not in the library anybody reads,
 * and each one spends a deploy publishing a site whose content did not change.
 * That is not a setting to be honoured, it is a setting left over, so it is
 * corrected on the way out rather than waiting to be noticed.
 *
 * Left alone if a build genuinely puts its library on `main` — a fork with no
 * branch of its own is pointing there on purpose, and this is only ever meant to
 * catch a stale value.
 */
const BRANCH_BEFORE_THE_MOVE = "main";

/** The saved settings, or null when this browser has never been given a token. */
export function readRepoConfig(): RepoConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<RepoConfig>;
    if (!saved.owner || !saved.repo || !saved.token) return null;
    const branch = saved.branch || LIBRARY_BRANCH;
    return {
      owner: saved.owner,
      repo: saved.repo,
      branch:
        branch === BRANCH_BEFORE_THE_MOVE && LIBRARY_BRANCH !== BRANCH_BEFORE_THE_MOVE
          ? LIBRARY_BRANCH
          : branch,
      token: saved.token,
    };
  } catch {
    // Unreadable settings are settings that were never there. localStorage also
    // throws outright when the browser has storage switched off, and a
    // configurator that will not start because of a preferences read is worse
    // than one that cannot save.
    return null;
  }
}

/** Save the settings, or forget them when handed null. */
export function writeRepoConfig(config: RepoConfig | null): void {
  try {
    if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    // as above: nothing here is worth taking the app down for
  }
}

/** Whether saving writes to the repository or falls back to a download. */
export function canWriteToRepo(): boolean {
  return readRepoConfig() !== null;
}

// ---------------------------------------------------------------------------
// What the site itself serves
// ---------------------------------------------------------------------------

/**
 * A path into the deployed site.
 *
 * `BASE_URL` rather than a leading slash, because Pages serves the app from
 * `/<repo>/` and not from the root: an absolute `/models/…` there asks
 * github.io for a file one directory above anything this project ever deployed.
 */
export function siteUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

/**
 * A path in the library branch, as a URL anyone may fetch.
 *
 * The read path for everybody without a token, which is nearly everybody. No
 * credentials, no API quota, and — the part that makes it usable from a page at
 * all — `Access-Control-Allow-Origin: *`.
 *
 * Deliberately built from the compiled-in constants and not from the settings:
 * this is the address of the *published* library, so it stays the same for the
 * token holder and the visitor standing next to them.
 */
export function rawUrl(path: string): string {
  return `https://raw.githubusercontent.com/${LIBRARY_OWNER}/${LIBRARY_REPO}/${LIBRARY_BRANCH}/${encodePath(path)}`;
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

/** The listing each library carries so that `raw` can be asked what is in it. */
const INDEX = "index.json";

// Where a library sits in the repository. The site serves them at `models/…`;
// the branch keeps them where they have always been in the source, under
// `public/`, so a file is at one path whichever way you arrive at it.
//
// The true path, unescaped: the tree API stores exactly the bytes it is handed,
// so a name escaped on the way in becomes a file called `a%20b.json`. Escaping
// belongs to the two transports that put a path in a URL, and is theirs to do —
// see {@link encodePath}.
const repoPath = (lib: Library, file?: string) =>
  `public/models/${lib}${file ? `/${file}` : ""}`;

const indexPath = (lib: Library) => repoPath(lib, INDEX);

/** A repository path as a URL wants it: escaped, but still a path. */
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** One request against this repository, `suffix` being everything after it. */
function repoApi(
  config: RepoConfig,
  suffix: string,
  init?: RequestInit & { headers?: Record<string, string> }
): Promise<Response> {
  return fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/${suffix}`,
    {
      ...init,
      // The API is the fresh side of the two; letting the browser answer from
      // its cache would give up the only reason to be on it.
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init?.headers,
      },
    }
  );
}

const contents = (
  config: RepoConfig,
  path: string,
  init?: RequestInit & { headers?: Record<string, string> }
) => repoApi(config, `contents/${path}`, init);

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** GitHub's own explanation of a failure, which is nearly always the useful one. */
async function apiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ? `${body.message} (${res.status})` : `GitHub returned ${res.status}`;
}

/**
 * Check settings before they are kept, by reading the branch with them.
 *
 * A token that cannot see the repository is otherwise not found out until the
 * first save, which is the worst moment to discover it — the design is finished
 * and the error arrives instead of the file.
 *
 * @returns null when the settings work, or what went wrong.
 */
export async function checkRepoConfig(config: RepoConfig): Promise<string | null> {
  try {
    const res = await contents(
      config,
      `public/models?ref=${encodeURIComponent(config.branch)}`
    );
    if (res.ok || res.status === 404) return null;
    return await apiError(res);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---------------------------------------------------------------------------
// The three operations every library needs
// ---------------------------------------------------------------------------

/** File names in one library. @throws if the listing cannot be had. */
export async function listLibrary(lib: Library): Promise<string[]> {
  const config = readRepoConfig();
  if (config) {
    const res = await contents(
      config,
      `${repoPath(lib)}?ref=${encodeURIComponent(config.branch)}`
    );
    // git has no empty directories, so a library nothing has been saved to yet
    // is a 404 rather than an empty listing
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`${lib} library unavailable: ${await apiError(res)}`);
    const entries = (await res.json()) as { name: string; type: string }[];
    return entries
      .filter((e) => e.type === "file" && e.name.endsWith(".json") && e.name !== "index.json")
      .map((e) => e.name)
      .sort();
  }
  // No token: the listing the branch carries, because `raw` cannot be asked what
  // is in a folder. Written by whatever last committed to that folder, so it is
  // the same set of names the request above would have returned.
  const res = await fetch(rawUrl(indexPath(lib)), { cache: "no-store" });
  if (!res.ok) throw new Error(`${lib} library unavailable (${res.status})`);
  return (await res.json()) as string[];
}

/** One library file, parsed. @throws on a missing file or one that is not JSON. */
export async function readLibraryFile(lib: Library, file: string): Promise<unknown> {
  const config = readRepoConfig();
  if (config) {
    const res = await contents(
      config,
      `${encodePath(repoPath(lib, file))}?ref=${encodeURIComponent(config.branch)}`,
      { headers: { Accept: "application/vnd.github.raw" } }
    );
    if (!res.ok) throw new Error(`Could not read ${file}: ${await apiError(res)}`);
    return JSON.parse(await res.text());
  }
  const res = await fetch(rawUrl(repoPath(lib, file)));
  if (!res.ok) throw new Error(`Could not read ${file} (${res.status})`);
  return await res.json();
}

/**
 * Take a file out of the library.
 *
 * Saving has a fallback — no token means a download the user drops into
 * `public/models/…` by hand — and deleting has none: there is no gesture in a
 * browser that removes a file from a site it only reads. So the Assets tab asks
 * {@link canWriteToRepo} and disables the button rather than offering one that
 * cannot work, and this refuses outright if it is called anyway.
 *
 * The file goes and the listing that named it is rewritten together, in one
 * commit, because {@link commitFiles} will not let them go separately — a
 * delete that landed without its listing would leave a name in the pickers that
 * opens nothing.
 *
 * Still asks whether the file is there first, which the commit does not need:
 * the answer is the difference between "already gone" and a write the
 * repository refused, and those want different words.
 *
 * @returns what happened, in the words the Assets tab shows.
 * @throws when there is no token, when the file is already gone, or when the
 *         repository refuses the write.
 */
export async function deleteLibraryFile(lib: Library, file: string): Promise<string> {
  const config = readRepoConfig();
  if (!config) {
    throw new Error(
      `Deleting needs a connected repository — a page cannot remove ${file} from a site it only reads`
    );
  }

  const existing = await contents(
    config,
    `${encodePath(repoPath(lib, file))}?ref=${encodeURIComponent(config.branch)}`
  );
  if (existing.status === 404) throw new Error(`${file} is not in the library any more`);
  if (!existing.ok) throw new Error(`Could not delete ${file}: ${await apiError(existing)}`);

  try {
    await commitFiles([{ path: repoPath(lib, file), text: null }]);
  } catch (e) {
    throw new Error(`Could not delete ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return `Deleted ${file} from the library`;
}

/**
 * Take a design out of the app as a file, whatever the settings say.
 *
 * The way out that is always open. Saving to the library needs a token, and the
 * file menus disable it when there is none rather than quietly doing something
 * else — but a page you cannot get your work out of is a page that can lose it,
 * so this sits beside the saves and is never disabled. Dropped into
 * `public/models/<lib>` by hand it is the same file a commit would have written.
 *
 * @returns what happened, in the words the file menu shows.
 */
export function downloadLibraryFile(lib: Library, file: string, data: unknown): string {
  download(file, JSON.stringify(data, null, 2));
  return `Saved ${file} to your downloads — drop it into public/models/${lib} to have it listed`;
}

/**
 * Take something out of the app that is not a design.
 *
 * The blueprint export is the first thing here that leaves as bytes rather than
 * as JSON, and that is the whole of the difference — it is still the download
 * anchor, still in the one module allowed to touch the DOM for I/O, and still
 * the way out that needs no token.
 *
 * @returns what happened, in the words the file menu shows.
 */
export function downloadBytes(file: string, bytes: Uint8Array, type: string): string {
  download(file, new Blob([bytes as BlobPart], { type }));
  return `Saved ${file} to your downloads`;
}

/**
 * Show something in a tab of its own instead of filing it away.
 *
 * The right way out for a document that is *looked at* rather than kept: the
 * browser already has a PDF viewer, and a drawing you have to go and find in a
 * downloads folder — once per attempt, while you are still deciding what should
 * be on the sheet — is a worse way to look at a drawing than a tab you can
 * refresh. Saving it is still one click away, in the viewer's own toolbar.
 *
 * Falls back to a download if the tab is refused. A popup blocker will do that
 * to anything not obviously coming from a click, and silently producing nothing
 * is the one outcome worth ruling out.
 *
 * The object URL is deliberately **not** revoked straight away, the way the
 * download path revokes its own: the tab is still reading from it. A minute is
 * long enough for it to have loaded and short enough not to be a leak.
 *
 * @returns what happened, in the words the file menu shows.
 */
export function openBytes(file: string, bytes: Uint8Array, type: string): string {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const tab = window.open(url, "_blank", "noopener");
  if (!tab) {
    URL.revokeObjectURL(url);
    download(file, new Blob([bytes as BlobPart], { type }));
    return `Your browser blocked the new tab, so ${file} went to your downloads instead`;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return `Opened ${file} in a new tab`;
}

/** Hand the file to the browser to put in the user's downloads. */
function download(file: string, body: string | Blob): void {
  const blob =
    typeof body === "string" ? new Blob([body], { type: "application/json" }) : body;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Put a design in the library: a commit when there is a token.
 *
 * One commit carrying the design and its library's listing, which is
 * {@link commitFiles}'s doing rather than this function's — the design and the
 * name a visitor finds it by land together or not at all.
 *
 * Without a token it falls back to {@link downloadLibraryFile}. The menus no
 * longer reach that: they disable the saves and offer the download as its own
 * item, because a "Save" that silently means something else is a save you cannot
 * tell has not happened. The fallback stays because this is the general way to
 * put a file in a library and it should not lose the work of the one caller that
 * forgets to ask.
 *
 * @returns what happened, in the words the file menu shows.
 * @throws when the repository refuses the write.
 */
export async function saveLibraryFile(
  lib: Library,
  file: string,
  data: unknown
): Promise<string> {
  const config = readRepoConfig();
  if (!config) return downloadLibraryFile(lib, file, data);

  try {
    await commitFiles([{ path: repoPath(lib, file), text: JSON.stringify(data, null, 2) }]);
  } catch (e) {
    throw new Error(`Could not save ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return `Saved ${file} to the library`;
}

/** A file as a commit wants it: where it goes, and what is in it. */
export interface RepoFile {
  /** Full path from the root of the repository, unescaped. */
  path: string;
  /** What the file should contain, or null to remove it. */
  text: string | null;
}

/** `public/models/<lib>/<name>.json`, and nothing nested deeper or beside it. */
const LIBRARY_FILE = /^public\/models\/(components|lamps|textures)\/([^/]+\.json)$/;

/**
 * Rewrite the listing of every library this commit disturbs.
 *
 * Built from the branch rather than from the last listing: the names are asked
 * of the folder itself and then this commit's own changes are applied on top,
 * so a listing that had drifted — a file put there by hand, a commit from
 * before any of this existed — is corrected by the next save rather than
 * carried forward. Costs one request per library touched, and a commit touches
 * one.
 *
 * Emitted unconditionally. A listing that was already right compiles to the blob
 * it already was, and a tree entry identical to its parent's is not a change, so
 * an unnecessary rewrite costs a comparison on GitHub's side and nothing here.
 *
 * @returns the listings to commit, and the names that were already in them —
 *   which is only good for deciding whether a save reads as `Add` or `Update`.
 */
async function reindex(
  config: RepoConfig,
  files: RepoFile[]
): Promise<{ listings: RepoFile[]; before: Set<string> }> {
  const touched = new Map<Library, { added: string[]; removed: string[] }>();
  for (const file of files) {
    const match = LIBRARY_FILE.exec(file.path);
    if (!match) continue;
    const [, lib, name] = match as unknown as [string, Library, string];
    if (name === INDEX) continue;
    const entry = touched.get(lib) ?? { added: [], removed: [] };
    (file.text === null ? entry.removed : entry.added).push(name);
    touched.set(lib, entry);
  }

  const listings: RepoFile[] = [];
  const before = new Set<string>();
  for (const [lib, { added, removed }] of touched) {
    const res = await contents(
      config,
      `${repoPath(lib)}?ref=${encodeURIComponent(config.branch)}`
    );
    // git has no empty directories, so a library nothing has ever been saved to
    // is a 404 and not an empty listing.
    let current: string[] = [];
    if (res.ok) {
      const entries = (await res.json()) as { name: string; type: string }[];
      current = entries
        .filter((e) => e.type === "file" && e.name.endsWith(".json") && e.name !== INDEX)
        .map((e) => e.name);
    } else if (res.status !== 404) {
      throw new Error(`Could not read the ${lib} library: ${await apiError(res)}`);
    }
    for (const name of current) before.add(`${lib}/${name}`);

    const gone = new Set(removed);
    const names = [...new Set([...current, ...added])].filter((n) => !gone.has(n)).sort();
    listings.push({ path: indexPath(lib), text: JSON.stringify(names, null, 2) });
  }
  return { listings, before };
}

/** What to call a commit nobody named: the one thing it did, in the log's voice. */
function describe(files: RepoFile[], before: Set<string>): string {
  if (files.length !== 1) return `Save ${files.length} files`;
  const [file] = files;
  const match = LIBRARY_FILE.exec(file.path);
  const what = match ? `${match[1]}/${match[2]}` : file.path;
  if (file.text === null) return `Delete ${what}`;
  return `${before.has(what) ? "Update" : "Add"} ${what}`;
}

/**
 * Write many files as **one** commit.
 *
 * {@link saveLibraryFile} is the right shape for a save: one file, one commit,
 * named after what you saved. The generator is the wrong shape for it — it
 * produces a file every few seconds, most of them rejects, and one commit each
 * would be a history nobody can read and a round trip in the middle of the only
 * rhythm that page has. So the journal buffers them and this lands the lot.
 *
 * Five requests whatever the batch size, because the tree API takes file
 * *contents* inline rather than blob shas — the alternative is a blob upload per
 * file, which is the per-file round trip this exists to avoid. Against the
 * contents API the same batch would be two requests per file.
 *
 * **Every** write to a library goes through here, which is the point: this is
 * where {@link reindex} folds in the listings that make the written files
 * findable, so no caller has to remember to and none of them can get it wrong.
 * A save, a delete and a batch of generated woods are all one commit that leaves
 * the branch describing itself.
 *
 * No force, and no retry. If the branch moved under us the ref update fails and
 * this throws with the whole batch unwritten, which is exactly what the caller
 * wants: the journal has not dropped anything, so the next flush sends the same
 * files against the new head. Forcing would take somebody else's commit off the
 * branch to land a pile of rejects, which is the wrong trade in every case.
 *
 * @param message what to call the commit; when left out, {@link describe} names
 *   it after the one thing it did.
 * @returns what happened, in the words the generator's status line shows.
 * @throws when there is no token, or when any step of the write is refused.
 */
export async function commitFiles(files: RepoFile[], message?: string): Promise<string> {
  const config = readRepoConfig();
  if (!config) throw new Error("Pushing needs a connected repository — see Library settings");
  if (files.length === 0) return "Nothing to push";

  const { listings, before } = await reindex(config, files);
  const subject = message ?? describe(files, before);

  // Slashes in a branch name are path separators here, so the ref is not
  // encoded as one component — `heads/feature/x` is the ref `feature/x`.
  const ref = `heads/${config.branch}`;

  const head = await repoApi(config, `git/ref/${ref}`);
  if (!head.ok) throw new Error(`Could not read ${config.branch}: ${await apiError(head)}`);
  const parent = ((await head.json()) as { object: { sha: string } }).object.sha;

  const parentCommit = await repoApi(config, `git/commits/${parent}`);
  if (!parentCommit.ok) throw new Error(`Could not read the branch: ${await apiError(parentCommit)}`);
  const baseTree = ((await parentCommit.json()) as { tree: { sha: string } }).tree.sha;

  const tree = await repoApi(
    config,
    "git/trees",
    json({
      base_tree: baseTree,
      // A `sha` of null is how the tree API spells a removal; `content` is how
      // it spells everything else.
      tree: [...files, ...listings].map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        ...(f.text === null ? { sha: null } : { content: f.text }),
      })),
    })
  );
  if (!tree.ok) throw new Error(`Could not write the files: ${await apiError(tree)}`);
  const treeSha = ((await tree.json()) as { sha: string }).sha;

  const commit = await repoApi(
    config,
    "git/commits",
    json({ message: subject, tree: treeSha, parents: [parent] })
  );
  if (!commit.ok) throw new Error(`Could not commit: ${await apiError(commit)}`);
  const commitSha = ((await commit.json()) as { sha: string }).sha;

  const moved = await repoApi(config, `git/refs/${ref}`, {
    ...json({ sha: commitSha }),
    method: "PATCH",
  });
  if (!moved.ok) throw new Error(`Could not move ${config.branch}: ${await apiError(moved)}`);

  return `Pushed ${files.length} file${files.length === 1 ? "" : "s"}`;
}
