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
 * ## Two modes, not one with patches
 *
 * Without a token every read is a plain fetch of what the site serves, and there
 * is nothing to save with: the file menus disable the saves and leave the
 * download — which is exactly what a visitor should get.
 *
 * With one, *every* read goes through the API instead, including reads that the
 * site could have served. It is the slower path, and it is the right one: the
 * site is a build, and a saved design does not trigger one, so it goes on
 * serving the library as it stood at the last code push. Reading the branch
 * means what you open is what you last saved, rather than what was there the
 * last time the site was published — worth more than the hundred milliseconds it
 * costs the one person holding a token.
 */

/** The three libraries, which are the three folders under `public/models`. */
export type Library = "components" | "lamps" | "textures";

/** Everything a write needs, as typed into the settings panel. */
export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** A fine-grained token with Contents: read and write on that repository. */
  token: string;
}

const CONFIG_KEY = "shoji-builder.repo";

/** The saved settings, or null when this browser has never been given a token. */
export function readRepoConfig(): RepoConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<RepoConfig>;
    if (!saved.owner || !saved.repo || !saved.token) return null;
    return {
      owner: saved.owner,
      repo: saved.repo,
      branch: saved.branch || "main",
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

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

// The site serves the libraries at `models/…`; in the repository they are the
// sources under `public/`, which is what the contents API has to be given.
const repoPath = (lib: Library, file?: string) =>
  `public/models/${lib}${file ? `/${encodeURIComponent(file)}` : ""}`;

function contents(
  config: RepoConfig,
  path: string,
  init?: RequestInit & { headers?: Record<string, string> }
): Promise<Response> {
  return fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`,
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

/** GitHub's own explanation of a failure, which is nearly always the useful one. */
async function apiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ? `${body.message} (${res.status})` : `GitHub returned ${res.status}`;
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  // one byte at a time rather than spreading the array into fromCharCode, which
  // blows the argument limit on a file of any size
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
  // Static file serving has no directory index, so a Vite plugin bakes one in
  // at build time — see vite.config.ts.
  const res = await fetch(siteUrl(`models/${lib}/index.json`));
  if (!res.ok) throw new Error(`${lib} library unavailable (${res.status})`);
  return (await res.json()) as string[];
}

/** One library file, parsed. @throws on a missing file or one that is not JSON. */
export async function readLibraryFile(lib: Library, file: string): Promise<unknown> {
  const config = readRepoConfig();
  if (config) {
    const res = await contents(
      config,
      `${repoPath(lib, file)}?ref=${encodeURIComponent(config.branch)}`,
      { headers: { Accept: "application/vnd.github.raw" } }
    );
    if (!res.ok) throw new Error(`Could not read ${file}: ${await apiError(res)}`);
    return JSON.parse(await res.text());
  }
  const res = await fetch(siteUrl(`models/${lib}/${encodeURIComponent(file)}`));
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
 * Two requests for the same reason a save is two: the contents API will only
 * delete a blob it is handed the `sha` of, which is also the check that the file
 * is still the one being looked at.
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

  const path = repoPath(lib, file);
  const existing = await contents(config, `${path}?ref=${encodeURIComponent(config.branch)}`);
  if (existing.status === 404) throw new Error(`${file} is not in the library any more`);
  if (!existing.ok) throw new Error(`Could not delete ${file}: ${await apiError(existing)}`);
  const { sha } = (await existing.json()) as { sha: string };

  const res = await contents(config, path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Delete ${lib}/${file}`, sha, branch: config.branch }),
  });
  if (!res.ok) throw new Error(`Could not delete ${file}: ${await apiError(res)}`);
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

/** Hand the file to the browser to put in the user's downloads. */
function download(file: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
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
 * The write is two requests because the contents API needs the blob's `sha` to
 * agree to replace it — which doubles as the check for whether this is a new
 * file or an overwrite, and so for what the commit should be called.
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

  const text = JSON.stringify(data, null, 2);
  const path = repoPath(lib, file);
  const existing = await contents(
    config,
    `${path}?ref=${encodeURIComponent(config.branch)}`
  );
  let sha: string | undefined;
  if (existing.ok) sha = ((await existing.json()) as { sha: string }).sha;
  else if (existing.status !== 404) {
    throw new Error(`Could not save ${file}: ${await apiError(existing)}`);
  }

  const res = await contents(config, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `${sha ? "Update" : "Add"} ${lib}/${file}`,
      content: base64(text),
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Could not save ${file}: ${await apiError(res)}`);
  return `Saved ${file} to the library`;
}
