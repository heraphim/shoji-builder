/**
 * What the roll journal does to a session of clicking, asserted rather than
 * eyeballed.
 *
 * Every interesting thing in `rollJournal.ts` happens when nobody is watching:
 * the push is on a timer, the durability is a localStorage write you only find
 * out about after a crash, and the failure mode that matters — a batch silently
 * dropped — looks exactly like a batch that worked. None of that can be checked
 * by pressing the buttons, so it is checked here.
 *
 * The clock and `fetch` are both fakes, which makes this an end-to-end test of
 * the real `commitFiles` as well: the five requests it makes and the tree it
 * builds are asserted from the outside, as GitHub would see them.
 *
 * Run from the project root:
 *
 * ```
 * npx vite build --ssr src/lib/__rollscheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__rollscheck.js
 * ```
 */

import { buildTextureFile } from "./textureFile";
import { DEFAULT_WOOD_PARAMS } from "./wood";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}

// ---------------------------------------------------------------------------
// A browser, to the extent this file needs one
// ---------------------------------------------------------------------------

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

store.set(
  "shoji-builder.repo",
  JSON.stringify({ owner: "heraphim", repo: "shoji-builder", branch: "main", token: "t" })
);

/** A clock that only moves when this file says so. */
let pending: { at: number; fn: () => void; id: number }[] = [];
let now = 0;
let nextId = 1;
(globalThis as { setTimeout?: unknown }).setTimeout = (fn: () => void, ms: number) => {
  const id = nextId++;
  pending.push({ at: now + ms, fn, id });
  return id;
};
(globalThis as { clearTimeout?: unknown }).clearTimeout = (id: number) => {
  pending = pending.filter((t) => t.id !== id);
};
function advance(ms: number) {
  now += ms;
  const due = pending.filter((t) => t.at <= now);
  pending = pending.filter((t) => t.at > now);
  for (const t of due) t.fn();
}
/** Let every already-resolved promise run. */
const settle = () => new Promise((r) => process.nextTick(r));

interface Sent {
  method: string;
  url: string;
  body: unknown;
}
let sent: Sent[] = [];
let failNextPush = false;

const reply = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

(globalThis as { fetch?: unknown }).fetch = async (url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  sent.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
  if (failNextPush) return reply({ message: "no" }, false);
  // The texture library as it stands, which a commit reads so it can rewrite the
  // listing that goes with it — see `reindex` in lib/library.ts.
  if (url.includes("/contents/")) {
    return reply([{ name: "walnut-gloss-9233.texture.json", type: "file" }]);
  }
  if (url.includes("/git/ref/")) return reply({ object: { sha: "PARENT" } });
  if (url.includes("/git/commits/")) return reply({ tree: { sha: "BASETREE" } });
  if (url.endsWith("/git/trees")) return reply({ sha: "NEWTREE" });
  if (url.endsWith("/git/commits")) return reply({ sha: "NEWCOMMIT" });
  if (url.includes("/git/refs/")) return reply({});
  return reply({ message: "unexpected" }, false);
};

// Imported after the fakes are installed, so its load-time reads see them.
const { IDLE_MS, recordRoll, rollStatus, pendingRollNames, flushRolls } = await import(
  "./rollJournal"
);

const wood = (seed: number) =>
  buildTextureFile(`w-${seed}`, "teak", "gloss", { ...DEFAULT_WOOD_PARAMS, seed });

const paths = () =>
  ((sent.find((s) => s.url.endsWith("/git/trees"))?.body as { tree: { path: string }[] })?.tree ??
    []).map((t) => t.path);

function reset() {
  sent = [];
  failNextPush = false;
}

// ---------------------------------------------------------------------------
console.log("\nthe debounce");
// ---------------------------------------------------------------------------

recordRoll("reject", "w-1", wood(1));
advance(IDLE_MS - 1);
await settle();
check("nothing goes up before the idle time", sent.length === 0, `${sent.length} requests`);

recordRoll("reject", "w-2", wood(2));
advance(IDLE_MS - 1);
await settle();
check("a second roll pushes the clock back", sent.length === 0, `${sent.length} requests`);

check("both are held", rollStatus().pending === 2, `pending ${rollStatus().pending}`);

advance(1);
await settle();
// Five, the whole cost of a commit. Both of these are rejects, which land in a
// folder that is not a library, so there is no listing to rebuild and nothing is
// read to rebuild it from — see the keeps below, which do cost the extra read.
check("the batch lands once the rolling stops", sent.length === 5, `${sent.length} requests`);
check("as one commit", sent.filter((s) => s.url.endsWith("/git/commits")).length === 1);
check("and the buffer is empty", rollStatus().pending === 0);

// ---------------------------------------------------------------------------
console.log("\nwhere the files go");
// ---------------------------------------------------------------------------

reset();
recordRoll("keep", "kept-one", wood(3));
recordRoll("reject", "turned-down", wood(4));
advance(IDLE_MS);
await settle();

const wrote = paths();
check(
  "a keep goes to the texture library",
  wrote.includes("public/models/textures/kept-one.texture.json"),
  wrote.join(" ")
);
check(
  "a reject goes to its own folder",
  wrote.includes("public/models/textures-rejected/turned-down.texture.json"),
  wrote.join(" ")
);
check(
  "and the listing that makes the keep findable goes with them, in that same tree",
  wrote.includes("public/models/textures/index.json"),
  wrote.join(" ")
);
check("all three in the one tree", wrote.length === 3, `${wrote.length} files`);

const commit = sent.find((s) => s.url.endsWith("/git/commits"))?.body as { message: string };
check("the commit says what it did", commit?.message === "Keep 1 and reject 1", commit?.message);

const tree = sent.find((s) => s.url.endsWith("/git/trees"))?.body as { base_tree: string };
check("built on the branch it read", tree?.base_tree === "BASETREE");

const moved = sent.find((s) => s.method === "PATCH");
check("and the branch is moved to it", (moved?.body as { sha: string })?.sha === "NEWCOMMIT");

// ---------------------------------------------------------------------------
console.log("\na push that fails");
// ---------------------------------------------------------------------------

reset();
failNextPush = true;
recordRoll("reject", "w-5", wood(5));
recordRoll("keep", "w-6", wood(6));
advance(IDLE_MS);
await settle();

check("the failure is reported", rollStatus().error !== null, rollStatus().error ?? "");
check("and nothing is dropped", rollStatus().pending === 2, `pending ${rollStatus().pending}`);

failNextPush = false;
reset();
advance(IDLE_MS);
await settle();
check(
  "the next window retries the same two",
  paths().includes("public/models/textures-rejected/w-5.texture.json") &&
    paths().includes("public/models/textures/w-6.texture.json"),
  paths().join(" ")
);
check("and clears them", rollStatus().pending === 0);

// ---------------------------------------------------------------------------
console.log("\nwhat survives the tab closing");
// ---------------------------------------------------------------------------

reset();
recordRoll("reject", "w-7", wood(7));
const onDisk = JSON.parse(store.get("shoji-builder.rolls") ?? "[]") as unknown[];
check("a roll is on disk before any push", onDisk.length === 1, `${onDisk.length} rolls`);
check("with the whole texture", Boolean((onDisk[0] as { file?: unknown })?.file));

advance(IDLE_MS);
await settle();
check(
  "and is taken off disk once it lands",
  (JSON.parse(store.get("shoji-builder.rolls") ?? "[]") as unknown[]).length === 0
);

// ---------------------------------------------------------------------------
console.log("\nnames");
// ---------------------------------------------------------------------------

reset();
recordRoll("keep", "teak-gloss-1", wood(8));
recordRoll("reject", "teak-gloss-2", wood(9));
check(
  "the buffer's names are visible to freeName",
  JSON.stringify(pendingRollNames()) === JSON.stringify(["teak-gloss-1", "teak-gloss-2"]),
  pendingRollNames().join(" ")
);
advance(IDLE_MS);
await settle();

// ---------------------------------------------------------------------------
console.log("\na roll judged while the push is in flight");
// ---------------------------------------------------------------------------

reset();
recordRoll("reject", "in-flight-a", wood(10));
const inFlight = flushRolls();
recordRoll("reject", "in-flight-b", wood(11));
await inFlight;
await settle();
check("only the first batch went", paths().length === 1, paths().join(" "));
check("the later one is still held", rollStatus().pending === 1, `pending ${rollStatus().pending}`);

reset();
advance(IDLE_MS);
await settle();
check("and goes up on its own clock", paths().length === 1, paths().join(" "));

// ---------------------------------------------------------------------------
console.log("\nwithout a token");
// ---------------------------------------------------------------------------

reset();
store.delete("shoji-builder.repo");
const recorded = recordRoll("reject", "w-12", wood(12));
check("recording says it did not", recorded === false);
check("and nothing is buffered", rollStatus().pending === 0, `pending ${rollStatus().pending}`);

console.log(`\n${failures === 0 ? "all good" : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
