import type { LampAnchor, LampComponentDef, LampConnection, LampInstance, Quat } from "./lamp";
import type { Vec3 } from "../store/useComponentEditorStore";
import { listLibrary, readLibraryFile } from "./library";

/**
 * The `*.lamp.json` format, in both directions.
 *
 * A saved lamp is a recipe, exactly as a saved component is, and for the same
 * reason: **nothing positional is written as a millimetre that was only true at
 * one setting of the variables**. What goes in the file is the variables, which
 * components are on the lamp, and how each one is fixed on — the four anchors and
 * the roll. Where anything actually *is* comes back out of `computeScene` when
 * the file is loaded, at whatever the variables say then.
 *
 * A lamp therefore reloads at the size it was saved at, and reloads *correctly*
 * at any other size. Opening one and dragging `innerHeight` is the same thing as
 * building it and dragging `innerHeight`.
 *
 * ### Components are named, not embedded
 *
 * An instance carries the **file name** of its component, not a copy of the
 * component's recipe. The same rule as everywhere else: the def is derivable
 * from the library, so storing it would be storing a stale copy, and editing a
 * component would leave every lamp that uses it quietly on the old version. The
 * cost is that a lamp needs its components present — a missing one is reported
 * by name and the rest of the lamp still loads.
 *
 * ### What is deliberately not written
 *
 * - **Any geometry.** There is none to write; the lamp side holds none.
 * - **A connected instance's position and quaternion.** They are dead state
 *   while it is connected: `computeScene` resolves it from its anchors, and
 *   `disconnect` slides it from that *resolved* placement, not from the stored
 *   one. Only a disconnected instance has a place of its own, and that is the
 *   one millimetre fact in the file — it is where the user put it.
 *
 * ### The paired variables
 *
 * `variables` is the design's whole `raw` dictionary, so a collapsed pair is
 * already in it the way the resolver sees it: the dependent's formula is
 * literally `"#driver"`. That alone would reload identically but with the ⚭
 * toggle showing the wrong state and the wrong value behind it, so `paired` and
 * `stashed` are written too. `pairs` is not — which variables *may* pair is
 * structure from `data/variables.json`, not a decision the design made.
 *
 * ### `description`
 *
 * Format 2, and the only field in the file no code reads: what this lamp is, in
 * the designer's own words. Written only when there is one — see the same note
 * in lib/componentFile.ts.
 *
 * Full schema and round-trip guarantees: docs/lamp-file-format.md
 */
export const LAMP_FORMAT = 2;

/** An anchor as written: fractions, and the block they are fractions of. */
interface SavedAnchor {
  at: Vec3;
  /** null = the body's encasing box, and always the main box. */
  block: string | null;
}

interface SavedConnection {
  source: [SavedAnchor, SavedAnchor];
  target: {
    kind: "mainBox" | "instance";
    /** Present only for `kind: "instance"` — the id of another entry below. */
    id?: string;
    anchors: [SavedAnchor, SavedAnchor];
  };
  roll?: number;
}

export interface LampFile {
  id: string;
  /** What it is, in prose. Absent in files written before format 2. */
  description?: string;
  type: "lamp";
  format: number;
  units: "mm";
  /** Every design variable, as an unevaluated formula. */
  variables: Record<string, string>;
  /** Which pairs are collapsed, and the dependents' parked values. */
  paired: Record<string, boolean>;
  stashed: Record<string, string>;
  instances: Array<{
    /** Unique within the file; `connection.target.id` refers to it. */
    id: string;
    label: string;
    /** File name in the component library. */
    component: string;
    connection: SavedConnection | null;
    /** Only for a disconnected instance — where the user stood it aside. */
    place?: { position: Vec3; quaternion: Quat };
  }>;
}

const DECIMALS = 4;
const round = (v: number) => Number(v.toFixed(DECIMALS));
const roundVec = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];
const roundQuat = (q: Quat): Quat => [round(q[0]), round(q[1]), round(q[2]), round(q[3])];

const saveAnchor = (a: LampAnchor): SavedAnchor => ({ at: roundVec(a.at), block: a.block });

function saveConnection(c: LampConnection): SavedConnection {
  return {
    source: [saveAnchor(c.source[0]), saveAnchor(c.source[1])],
    target:
      c.target.kind === "mainBox"
        ? {
            kind: "mainBox",
            anchors: [saveAnchor(c.target.anchors[0]), saveAnchor(c.target.anchors[1])],
          }
        : {
            kind: "instance",
            id: c.target.id,
            anchors: [saveAnchor(c.target.anchors[0]), saveAnchor(c.target.anchors[1])],
          },
    ...(c.roll ? { roll: round(c.roll) } : {}),
  };
}

/** Serialise the lamp. Instance ids are kept verbatim — connections name them. */
export function buildLampFile(
  id: string,
  instances: LampInstance[],
  variables: { raw: Record<string, string>; paired: Record<string, boolean>; stashed: Record<string, string> },
  description = ""
): LampFile {
  return {
    id,
    // omitted rather than written empty — see componentFile.ts
    ...(description.trim() ? { description: description.trim() } : {}),
    type: "lamp",
    format: LAMP_FORMAT,
    units: "mm",
    variables: Object.fromEntries(Object.keys(variables.raw).sort().map((n) => [n, variables.raw[n]])),
    paired: { ...variables.paired },
    stashed: { ...variables.stashed },
    instances: instances.map((instance) => ({
      id: instance.id,
      label: instance.label,
      component: instance.def.file,
      connection: instance.connection ? saveConnection(instance.connection) : null,
      // written only when it means something — see the note at the top
      ...(instance.connection
        ? {}
        : { place: { position: roundVec(instance.position), quaternion: roundQuat(instance.quaternion) } }),
    })),
  };
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

// Lamps live in the project's own folder — public/models/lamps — exactly as
// components do, and are read and written by lib/library.ts the same way.

/** File names in the library. @throws if the listing cannot be had. */
export function listLibraryLamps(): Promise<string[]> {
  return listLibrary("lamps");
}

/** @throws on a missing file or one that is not a lamp. */
export async function fetchLampFile(fileName: string): Promise<LampFile> {
  return parseLampFile(await readLibraryFile("lamps", fileName));
}

/**
 * Check a payload is a lamp file and hand it back typed.
 *
 * Validation is on shape, not on `format` — the same rule the component loader
 * uses. A file that is not a lamp fails here rather than being half-read.
 */
export function parseLampFile(data: unknown): LampFile {
  const file = data as Partial<LampFile>;
  if (!file || file.type !== "lamp" || !Array.isArray(file.instances)) {
    throw new Error("Not a lamp file");
  }
  return {
    id: file.id ?? "lamp",
    ...(typeof file.description === "string" ? { description: file.description } : {}),
    type: "lamp",
    format: file.format ?? LAMP_FORMAT,
    units: "mm",
    variables: file.variables ?? {},
    paired: file.paired ?? {},
    stashed: file.stashed ?? {},
    instances: file.instances,
  };
}

/**
 * The connection as the store holds it.
 *
 * The only work is narrowing the target back to its discriminated union — an
 * `instance` target with no id is dropped to null rather than loaded as a joint
 * pointing at nothing, which would place the part at the origin.
 */
function toConnection(saved: SavedConnection | null): LampConnection | null {
  if (!saved) return null;
  const anchors: [LampAnchor, LampAnchor] = [saved.target.anchors[0], saved.target.anchors[1]];
  if (saved.target.kind === "instance" && !saved.target.id) return null;
  return {
    source: [saved.source[0], saved.source[1]],
    target:
      saved.target.kind === "mainBox"
        ? { kind: "mainBox", anchors }
        : { kind: "instance", id: saved.target.id!, anchors },
    ...(saved.roll ? { roll: saved.roll } : {}),
  };
}

/**
 * The file's instances as the store holds them, given the components it names.
 *
 * The inverse of {@link buildLampFile}, and the whole of what loading *decides*
 * — fetching the defs is the caller's job, so this stays pure.
 *
 * An instance whose component the library no longer has is **dropped**, and
 * anything joined to it is freed rather than left holding a joint onto nothing:
 * a target that is not there resolves to no placement at all, which would put
 * the part at the origin. Freed, it stands where the file left it, which is
 * wrong-looking but findable — and the caller names the missing component so it
 * is clear why.
 *
 * Freeing is one pass, not transitive: a part joined to a *freed* part still has
 * its target, and that target still has a place.
 */
export function toInstances(
  lamp: LampFile,
  defs: Map<string, LampComponentDef>
): { instances: LampInstance[]; missing: string[] } {
  const missing = [...new Set(lamp.instances.map((i) => i.component))].filter((n) => !defs.has(n));
  const kept = new Set(lamp.instances.filter((i) => defs.has(i.component)).map((i) => i.id));

  const instances = lamp.instances.flatMap((saved): LampInstance[] => {
    const def = defs.get(saved.component);
    if (!def) return [];
    const connection = toConnection(saved.connection);
    return [
      {
        id: saved.id,
        label: saved.label,
        def,
        connection:
          connection?.target.kind === "instance" && !kept.has(connection.target.id)
            ? null
            : connection,
        position: saved.place?.position ?? [0, 0, 0],
        quaternion: saved.place?.quaternion ?? [0, 0, 0, 1],
      },
    ];
  });

  return { instances, missing };
}
