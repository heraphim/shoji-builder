import { DEFAULT_LOOK, parseLook, useLookStore, type LookSettings } from "../store/useLookStore";
import {
  ALL_VIEWPORTS,
  parseLayout,
  useEditorViewports,
  type ViewportId,
  type ViewportModes,
} from "../store/useViewportStore";

/**
 * What survives a reload, checked against what was written.
 *
 * The two settings stores hand their state to `localStorage` as JSON and read it
 * back on the next page. That round trip is worth asserting rather than
 * eyeballing for the reason every persistence layer is: it is only wrong once
 * the browser is closed, which is exactly when nobody is looking. And the read
 * half faces a string the user can edit and that outlives the version of the app
 * that wrote it, so the interesting cases are all the malformed ones — a view id
 * that no longer exists, an intensity of `null`, an order with the same view in
 * it twice.
 *
 * Run from the project root:
 *
 * ```
 * npx vite build --ssr src/lib/__settingscheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__settingscheck.js
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
//
// Installed *after* the stores have been imported, so their own load-time read
// finds nothing and starts from the defaults — which is the state a first visit
// is in, and the one the writes below are measured from.
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

// ---------------------------------------------------------------------------

console.log("\nLighting and outlines: what a malformed blob reads as");

check("nothing saved is the defaults", same(parseLook(null), DEFAULT_LOOK));
check("a string is the defaults", same(parseLook("bright"), DEFAULT_LOOK));
check("an array is the defaults", same(parseLook([1, 2, 3]), DEFAULT_LOOK));

check(
  "a good blob comes back whole",
  same(
    parseLook({ ambient: 0.2, key: 2, fill: 0, contactShadows: true, faintOutline: true }),
    { ambient: 0.2, key: 2, fill: 0, contactShadows: true, faintOutline: true }
  )
);

check(
  "a missing field is that field's default, and only that field's",
  same(parseLook({ ambient: 0.2 }), { ...DEFAULT_LOOK, ambient: 0.2 })
);

// The one that matters: an intensity of NaN renders every cell black with
// nothing on screen to say why, so it must not be able to come out of storage.
for (const [label, value] of [
  ["NaN", NaN],
  ["null", null],
  ["a string", "0.5"],
  ["infinity", Infinity],
] as const) {
  const parsed = parseLook({ ...DEFAULT_LOOK, ambient: value });
  check(`ambient of ${label} falls back to the default`, parsed.ambient === DEFAULT_LOOK.ambient);
}

check(
  "a shadow flag that is not a boolean falls back",
  parseLook({ contactShadows: "yes" }).contactShadows === DEFAULT_LOOK.contactShadows
);

// ---------------------------------------------------------------------------

console.log("\nLighting and outlines: the round trip");

const looks: [keyof LookSettings, LookSettings[keyof LookSettings]][] = [
  ["ambient", 0.2],
  ["key", 2.4],
  ["fill", 0],
  ["contactShadows", true],
  ["faintOutline", true],
];
for (const [key, value] of looks) {
  useLookStore.getState().setLook(key, value as never);
  const written = store.get("shoji.look");
  check(
    `${key} is written as soon as it is set`,
    written !== undefined && parseLook(JSON.parse(written))[key] === value,
    written ?? "nothing written"
  );
}

{
  const written = JSON.parse(store.get("shoji.look") ?? "null");
  const state = useLookStore.getState();
  check(
    "every setting comes back, not just the last one changed",
    same(parseLook(written), {
      ambient: state.ambient,
      key: state.key,
      fill: state.fill,
      contactShadows: state.contactShadows,
      faintOutline: state.faintOutline,
    })
  );
}

useLookStore.getState().resetLook();
check(
  "a reset is written too, rather than leaving the old set to come back",
  same(parseLook(JSON.parse(store.get("shoji.look") ?? "null")), DEFAULT_LOOK)
);

// ---------------------------------------------------------------------------

console.log("\nView arrangements: what a malformed blob reads as");

const DEFAULTS: Record<ViewportId, ViewportModes> = {
  "3d": { material: "solid", geometry: "materialEdges", showAxes: true },
  top: { material: "none", geometry: "materialEdges", showAxes: true },
  side: { material: "none", geometry: "materialEdges", showAxes: false },
  front: { material: "none", geometry: "materialEdges", showAxes: true },
};

check(
  "nothing saved is the whole row in its own order",
  same(parseLayout(null, DEFAULTS), { order: [...ALL_VIEWPORTS], modes: DEFAULTS })
);

check(
  "a saved order is kept in its own order, not sorted back",
  same(parseLayout({ order: ["front", "3d", "top"] }, DEFAULTS).order, ["front", "3d", "top"])
);

check(
  "a view that no longer exists is dropped and the rest kept",
  same(parseLayout({ order: ["top", "isometric", "side"] }, DEFAULTS).order, ["top", "side"])
);

check(
  "the same view twice is one view — two slots showing one cell is not a layout",
  same(parseLayout({ order: ["top", "top", "3d"] }, DEFAULTS).order, ["top", "3d"])
);

check(
  "an order with nothing usable in it falls back to the whole row",
  same(parseLayout({ order: ["isometric"] }, DEFAULTS).order, [...ALL_VIEWPORTS])
);
check(
  "an empty order falls back to the whole row — an empty grid has no way out",
  same(parseLayout({ order: [] }, DEFAULTS).order, [...ALL_VIEWPORTS])
);

check(
  "a saved mode comes back",
  same(parseLayout({ modes: { top: { material: "texture", geometry: "allTriangles", showAxes: false } } }, DEFAULTS).modes.top, {
    material: "texture",
    geometry: "allTriangles",
    showAxes: false,
  })
);

check(
  "a draw mode that no longer exists costs that one setting, not the cell",
  same(parseLayout({ modes: { top: { material: "wireframe", showAxes: false } } }, DEFAULTS).modes.top, {
    ...DEFAULTS.top,
    showAxes: false,
  })
);

check(
  "a cell with nothing saved keeps its own default, including an axis default of false",
  same(parseLayout({ modes: { top: { material: "solid" } } }, DEFAULTS).modes.side, DEFAULTS.side)
);

check(
  "showAxes that is not a boolean falls back",
  parseLayout({ modes: { "3d": { showAxes: "yes" } } }, DEFAULTS).modes["3d"].showAxes ===
    DEFAULTS["3d"].showAxes
);

// ---------------------------------------------------------------------------

console.log("\nView arrangements: the round trip");

const KEY = "shoji.viewports.editor";
const layout = () => parseLayout(JSON.parse(store.get(KEY) ?? "null"), DEFAULTS);

useEditorViewports.getState().setMaterial("top", "texture");
check("a material change is written", layout().modes.top.material === "texture");

useEditorViewports.getState().setGeometry("top", "allTriangles");
check("a geometry change is written", layout().modes.top.geometry === "allTriangles");

useEditorViewports.getState().setShowAxes("top", false);
check("an axes change is written", layout().modes.top.showAxes === false);
check(
  "and the modes set beside it are still there",
  layout().modes.top.material === "texture" && layout().modes.top.geometry === "allTriangles"
);

useEditorViewports.getState().hideViewport("side");
check(
  "a minimised view is written",
  same(layout().order, useEditorViewports.getState().order),
  layout().order.join(",")
);

useEditorViewports.getState().showViewport("side");
useEditorViewports.getState().swapViewports("3d", "front");
check(
  "so are the two halves of a drag",
  same(layout().order, useEditorViewports.getState().order),
  layout().order.join(",")
);

check(
  "what is written is what the store is holding, mode for mode",
  same(layout().modes, useEditorViewports.getState().modes)
);

// A pan and a zoom are facts about the model that was on the bench, not about
// how the user likes to work, so they must not follow them into tomorrow.
const beforeFraming = store.get(KEY);
useEditorViewports.getState().zoomViewport("top", 2);
useEditorViewports.getState().panViewport("top", 30, 12);
useEditorViewports.getState().setOrbit({ key: "x", position: [1, 2, 3], target: [0, 0, 0] });
check("framing and orbit are not written", store.get(KEY) === beforeFraming);

// ---------------------------------------------------------------------------

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
