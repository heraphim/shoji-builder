import {
  LIBRARY_BRANCH,
  LIBRARY_OWNER,
  LIBRARY_REPO,
  commitFiles,
  deleteLibraryFile,
  listLibrary,
  rawUrl,
  readLibraryFile,
  saveLibraryFile,
  writeRepoConfig,
  type RepoFile,
} from "./library";

/**
 * That the visitor and the token holder are looking at one library.
 *
 * The bug this exists to make impossible is not a crash — it is two people
 * disagreeing about what is in the library and both being told they are right.
 * That cannot be eyeballed from inside the app, because you only ever have one
 * of the two views open, and the wrong one still looks perfectly fine.
 *
 * So both readers are run here against one branch, and the questions asked are:
 * do they reach the same place, does what a write leaves behind describe itself,
 * and does a name go into a commit as the name it actually is.
 *
 * The branch is a Map and GitHub is a switch statement — the point is which
 * requests `lib/library.ts` makes and what it puts in them, which a real
 * repository would answer more slowly and less precisely.
 *
 * Run from the project root:
 *
 * ```
 * npx vite build --ssr src/lib/__librarycheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__librarycheck.js
 * ```
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// A localStorage that is only a Map, since Node has none.
// ---------------------------------------------------------------------------

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const TOKEN = { owner: "heraphim", repo: "shoji-builder", branch: "library", token: "t" };
const asVisitor = () => writeRepoConfig(null);
const asHolder = () => writeRepoConfig(TOKEN);

// ---------------------------------------------------------------------------
// The branch, and a GitHub in front of it.
// ---------------------------------------------------------------------------

/** path -> contents. The one place a file is; both readers must end up here. */
let branch = new Map<string, string>();

/** Every URL asked for, in order, so a test can say where a read went. */
let asked: string[] = [];

/** The tree of the last commit, which is what a write is really judged on. */
let lastTree: { path: string; content?: string; sha?: null }[] = [];
let lastMessage = "";

function seed(): void {
  branch = new Map<string, string>();
  const put = (lib: string, names: string[]) => {
    for (const n of names) branch.set(`public/models/${lib}/${n}`, `{"id":"${n}"}`);
    branch.set(`public/models/${lib}/index.json`, JSON.stringify([...names].sort(), null, 2));
  };
  put("components", ["beam.component.json", "leg.component.json"]);
  put("lamps", ["basic-lamp-square.lamp.json"]);
  put("textures", ["walnut-gloss-9233.texture.json"]);
  asked = [];
  lastTree = [];
  lastMessage = "";
}

const ok = (body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  asked.push(url);

  // --- raw: one file, no credentials, no listing ---
  const rawPrefix = `https://raw.githubusercontent.com/${LIBRARY_OWNER}/${LIBRARY_REPO}/${LIBRARY_BRANCH}/`;
  if (url.startsWith(rawPrefix)) {
    const path = decodeURIComponent(url.slice(rawPrefix.length));
    const body = branch.get(path);
    return body === undefined ? new Response("404: Not Found", { status: 404 }) : ok(body);
  }

  // --- the contents and git APIs ---
  const api = "https://api.github.com/repos/heraphim/shoji-builder/";
  if (!url.startsWith(api)) throw new Error(`unexpected host: ${url}`);
  const rest = url.slice(api.length);
  const [route] = rest.split("?");

  if (route.startsWith("contents/")) {
    const path = decodeURIComponent(route.slice("contents/".length));
    // a folder: the listing GitHub gives that `raw` cannot
    const inside = [...branch.keys()].filter((k) => k.startsWith(`${path}/`));
    if (inside.length > 0) {
      return ok(
        inside.map((k) => ({ name: k.slice(path.length + 1), type: "file" }))
      );
    }
    const body = branch.get(path);
    return body === undefined ? new Response("{}", { status: 404 }) : ok(body);
  }

  if (route === "git/ref/heads/library") return ok({ object: { sha: "HEAD" } });
  if (route === "git/commits/HEAD") return ok({ tree: { sha: "TREE" } });
  if (route === "git/trees") {
    const body = JSON.parse(String(init?.body)) as { tree: typeof lastTree };
    lastTree = body.tree;
    // the tree is the commit: apply it so the next read sees what was written
    for (const entry of lastTree) {
      if (entry.sha === null) branch.delete(entry.path);
      else branch.set(entry.path, entry.content ?? "");
    }
    return ok({ sha: "NEWTREE" });
  }
  if (route === "git/commits") {
    lastMessage = (JSON.parse(String(init?.body)) as { message: string }).message;
    return ok({ sha: "NEWCOMMIT" });
  }
  if (route === "git/refs/heads/library") return ok({});
  throw new Error(`unexpected route: ${route}`);
}) as typeof fetch;

const treePaths = () => lastTree.map((e) => e.path).sort();
const wrote = (path: string) => lastTree.find((e) => e.path === path);
const indexAfter = (lib: string) =>
  JSON.parse(wrote(`public/models/${lib}/index.json`)?.content ?? "null");

// ---------------------------------------------------------------------------

console.log("\nThe visitor, who has no token");
seed();
asVisitor();

{
  const names = await listLibrary("components");
  check("reads the listing off the library branch, not the built site", asked.every((u) => u.startsWith("https://raw.")), asked[0]);
  check(
    "and the address is the branch this build publishes",
    asked[0] === `https://raw.githubusercontent.com/${LIBRARY_OWNER}/${LIBRARY_REPO}/${LIBRARY_BRANCH}/public/models/components/index.json`,
    asked[0]
  );
  check("gets the names in it", same(names, ["beam.component.json", "leg.component.json"]), names.join(","));
}

{
  asked = [];
  const file = (await readLibraryFile("lamps", "basic-lamp-square.lamp.json")) as { id: string };
  check("reads a design off the same branch", file.id === "basic-lamp-square.lamp.json");
  check(
    "spending none of the sixty API requests an hour a visitor's whole network shares",
    asked.every((u) => !u.includes("api.github.com")),
    asked.join(" ")
  );
}

check(
  "a name with a space is escaped into the URL, not sent raw",
  rawUrl("public/models/textures/pale ash.texture.json").endsWith("/pale%20ash.texture.json"),
  rawUrl("public/models/textures/pale ash.texture.json")
);

// ---------------------------------------------------------------------------

console.log("\nThe token holder, who is looking at the same branch");
seed();
asHolder();

{
  asked = [];
  const mine = await listLibrary("components");
  check("reads through the API, for an answer no cache has aged", asked.some((u) => u.includes("api.github.com")), asked[0]);
  asVisitor();
  const theirs = await listLibrary("components");
  check("and is shown the same library as the visitor", same(mine, theirs), `${mine.join(",")} vs ${theirs.join(",")}`);
  asHolder();
}

// ---------------------------------------------------------------------------

console.log("\nSaving: the file and the name it is found by, in one commit");
seed();
asHolder();

{
  await saveLibraryFile("lamps", "tall-lamp.lamp.json", { id: "tall" });
  check(
    "the design and its library's listing land together",
    same(treePaths(), ["public/models/lamps/index.json", "public/models/lamps/tall-lamp.lamp.json"]),
    treePaths().join(" ")
  );
  check(
    "the listing gains the new name, in order",
    same(indexAfter("lamps"), ["basic-lamp-square.lamp.json", "tall-lamp.lamp.json"]),
    JSON.stringify(indexAfter("lamps"))
  );
  check("and the commit says what it did", lastMessage === "Add lamps/tall-lamp.lamp.json", lastMessage);
}

{
  await saveLibraryFile("lamps", "tall-lamp.lamp.json", { id: "taller" });
  check("saving over a design is an update, not a second add", lastMessage === "Update lamps/tall-lamp.lamp.json", lastMessage);
  check(
    "and does not list it twice",
    same(indexAfter("lamps"), ["basic-lamp-square.lamp.json", "tall-lamp.lamp.json"]),
    JSON.stringify(indexAfter("lamps"))
  );
}

{
  asVisitor();
  const seen = await listLibrary("lamps");
  check(
    "so the visitor now sees what was just saved — the whole point of the branch",
    seen.includes("tall-lamp.lamp.json"),
    seen.join(",")
  );
  asHolder();
}

check(
  "a name with a space is committed as that name, not as a percent sign",
  await (async () => {
    await saveLibraryFile("textures", "pale ash.texture.json", { id: "pale" });
    return wrote("public/models/textures/pale ash.texture.json") !== undefined;
  })(),
  treePaths().join(" ")
);

// ---------------------------------------------------------------------------

console.log("\nDeleting: the name goes with the file");
seed();
asHolder();

{
  const note = await deleteLibraryFile("components", "leg.component.json");
  check("says so", note === "Deleted leg.component.json from the library", note);
  check(
    "the file is removed by sha-null, which is how a tree spells a removal",
    wrote("public/models/components/leg.component.json")?.sha === null
  );
  check(
    "and the listing stops naming it, in the same commit",
    same(indexAfter("components"), ["beam.component.json"]),
    JSON.stringify(indexAfter("components"))
  );
  check("named for what it did", lastMessage === "Delete components/leg.component.json", lastMessage);
}

{
  let message = "";
  try {
    await deleteLibraryFile("components", "leg.component.json");
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  check("deleting it twice is refused, and says which file", message.includes("not in the library any more"), message);
}

// ---------------------------------------------------------------------------

console.log("\nThe generator, which commits in batches and must not skip the listing");
seed();
asHolder();

{
  // the shape lib/rollJournal.ts sends: kept woods into the library, rejected
  // ones into a folder beside it that is not a library at all
  const files: RepoFile[] = [
    { path: "public/models/textures/oak-matte-1.texture.json", text: "{}" },
    { path: "public/models/textures/oak-matte-2.texture.json", text: "{}" },
    { path: "public/models/textures-rejected/oak-matte-3.texture.json", text: "{}" },
  ];
  await commitFiles(files, "Keep 2 and reject 1");
  check(
    "a batch of kept woods is listed, every one of them",
    same(indexAfter("textures"), [
      "oak-matte-1.texture.json",
      "oak-matte-2.texture.json",
      "walnut-gloss-9233.texture.json",
    ]),
    JSON.stringify(indexAfter("textures"))
  );
  check(
    "the rejects are written but not listed — they are not in the library",
    wrote("public/models/textures-rejected/oak-matte-3.texture.json") !== undefined &&
      !JSON.stringify(indexAfter("textures")).includes("oak-matte-3"),
    JSON.stringify(indexAfter("textures"))
  );
  check(
    "and a folder whose name merely starts with a library's does not rewrite that library's listing",
    !treePaths().includes("public/models/textures-rejected/index.json"),
    treePaths().join(" ")
  );
  check("the caller's own commit subject is kept", lastMessage === "Keep 2 and reject 1", lastMessage);
}

// ---------------------------------------------------------------------------

console.log("\nA listing that had drifted from the folder it describes");
seed();
asHolder();

{
  // a file put on the branch by hand, which no commit of ours ever listed
  branch.set("public/models/lamps/by-hand.lamp.json", "{}");
  await saveLibraryFile("lamps", "another.lamp.json", { id: "another" });
  check(
    "the next save rebuilds the listing from the folder, so the stray file is found",
    same(indexAfter("lamps"), [
      "another.lamp.json",
      "basic-lamp-square.lamp.json",
      "by-hand.lamp.json",
    ]),
    JSON.stringify(indexAfter("lamps"))
  );
}

// ---------------------------------------------------------------------------

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
