import * as THREE from "three";

/**
 * The rice paper: the shell it is stretched over, the sheet itself, and how it
 * glows.
 *
 * The showcase needs a thing the lamp model does not have. A lamp in this app is
 * timber — every component is a box of wood, and the one part of a real shoji
 * lantern that nobody builds out of sticks is the part you actually look at. So
 * the paper is **derived rather than authored**: it is the main box, which is
 * already the volume the frame is built around (`mainBoxOf`), skinned on five
 * sides. Nothing is added to any file format, and a drag on the Width slider
 * carries the paper with the frame for free — the same no-stored-geometry rule
 * the whole lamp side keeps.
 *
 * Five sides, not six: the bottom is inside the base, where the only thing that
 * would ever see it is the table.
 *
 * The kumiko reads as dark bars over the glow because that is where the wood
 * actually is — outside the paper, between it and the eye. No trickery and no
 * translucency is needed for the picture's central effect; what the paper has to
 * do is be a sheet that is brighter near the bulb than at its corners, which is
 * the one thing a flat emissive colour cannot be. See {@link RicePaperMaterial}.
 */

/**
 * How far the sheet stands proud of the main box, in mm.
 *
 * See {@link paperShellGeometry} for why it is negative.
 */
const SIDE_INSET = -2.5;

/** How many mm of paper one tile of the fibre texture covers. */
const TILE_MM = 150;

/** Pixels across that tile. Small: it is noise, and it is tiled. */
const TILE_PX = 256;

/**
 * A fixed-seed PRNG, so the sheet is the same sheet every session.
 *
 * `Math.random` would re-mill the paper on every reload, which is the kind of
 * difference that makes a screenshot impossible to compare against the last one.
 *
 * Exported because the room's hanging scroll wants the same guarantee for the
 * same reason — both are hand-drawn noise that has to be the same drawing twice.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw something nine times, once per wrap of the tile.
 *
 * A tiled texture with a stroke running off the right edge and not back in at
 * the left has a seam, and on a 200 mm panel the seam is a visible vertical
 * line. Drawing every mark at all nine offsets costs nothing here — it is a
 * 256 px canvas built once — and makes the tile genuinely periodic.
 */
function wrapped(ctx: CanvasRenderingContext2D, draw: () => void): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      ctx.save();
      ctx.translate(dx * TILE_PX, dy * TILE_PX);
      draw();
      ctx.restore();
    }
  }
}

let sheet: THREE.CanvasTexture | null = null;

/**
 * The washi sheet, as a tiling texture: pulp, long fibres, and a few blotches.
 *
 * Built once for the whole app. It is the same paper on every lamp, it costs a
 * canvas and a texture upload, and there is nothing about it that varies.
 */
export function ricePaperTexture(): THREE.CanvasTexture {
  if (sheet) return sheet;

  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(20250812);

  ctx.fillStyle = "#fbf4e4";
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);

  // Where the pulp settled thick or thin. Broad and very faint: backlit, a 4%
  // difference in thickness is the whole of what makes paper look like paper.
  for (let i = 0; i < 90; i++) {
    const x = rand() * TILE_PX;
    const y = rand() * TILE_PX;
    const r = 8 + rand() * 34;
    const thick = rand() < 0.5;
    wrapped(ctx, () => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.03 + rand() * 0.05;
      g.addColorStop(0, thick ? `rgba(150,126,92,${a})` : `rgba(255,252,244,${a * 1.4})`);
      g.addColorStop(1, "rgba(255,252,244,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // The fibres. Long, straight, every which way — kozo bast, not wood pulp, and
  // it is the one detail that says washi rather than tracing paper.
  ctx.lineCap = "round";
  for (let i = 0; i < 420; i++) {
    const x = rand() * TILE_PX;
    const y = rand() * TILE_PX;
    const angle = rand() * Math.PI;
    const length = 8 + rand() * 52;
    const alpha = 0.04 + rand() * 0.1;
    const width = 0.4 + rand() * 0.9;
    wrapped(ctx, () => {
      ctx.strokeStyle = `rgba(148,124,88,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    });
  }

  sheet = new THREE.CanvasTexture(canvas);
  sheet.wrapS = THREE.RepeatWrapping;
  sheet.wrapT = THREE.RepeatWrapping;
  sheet.colorSpace = THREE.SRGBColorSpace;
  sheet.anisotropy = 8;
  return sheet;
}

/**
 * One quad, as six vertices with mm-scaled UVs.
 *
 * `across` and `up` are the face's own two directions and are always given the
 * way the *texture* wants them — across is across, up is up — so that the grain
 * runs the same way on all four walls. Three of the five faces then come out
 * wound backwards, because a face's outward normal is `across × up` on one side
 * of the box and its negative on the other, so the triangles are reversed where
 * they need to be rather than the caller being asked to keep two right-hand
 * rules straight in its head.
 *
 * Winding matters even though the material is double-sided — in fact
 * *especially* so, because double-sided is what would hide the mistake: a quad
 * wound inside out is not invisible, it is lit as though its far side were its
 * near one, and the panel goes dark for no reason anybody can see.
 */
function quad(
  target: { position: number[]; normal: number[]; uv: number[] },
  origin: THREE.Vector3,
  across: THREE.Vector3,
  up: THREE.Vector3,
  normal: THREE.Vector3
): void {
  const corners = [
    origin,
    origin.clone().add(across),
    origin.clone().add(across).add(up),
    origin,
    origin.clone().add(across).add(up),
    origin.clone().add(up),
  ];
  const w = across.length() / TILE_MM;
  const h = up.length() / TILE_MM;
  const uvs = [0, 0, w, 0, w, h, 0, 0, w, h, 0, h];

  const backwards = new THREE.Vector3().crossVectors(across, up).dot(normal) < 0;
  const order = backwards ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];

  for (const i of order) {
    target.position.push(corners[i].x, corners[i].y, corners[i].z);
    target.normal.push(normal.x, normal.y, normal.z);
    target.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
  }
}

/**
 * The paper shell for a box: four walls and a lid, inset so the frame covers its
 * edges.
 *
 * UVs are in **tiles of millimetres**, not the 0..1 per face a `BoxGeometry`
 * would give: the fibres have a real size, and a sheet whose grain stretches
 * because the panel it is on is tall is a sheet nobody has ever seen.
 *
 * @param inset how far inside the box the paper sits, in mm. **Negative**, and
 *        that is the point: pasted a hair *inside* the main box the sheet stopped
 *        short of the corner posts, and from a low angle you could see between
 *        the two and straight into the lit inside of the lamp. Standing it a
 *        couple of millimetres proud buries its edges in the posts instead,
 *        which is also where they are on a real one — the paper goes on the back
 *        of the lattice and the lattice covers the join.
 * @param topInset the lid, which stays inside: it is under the cap rather than
 *        behind a post, and pushing it out would lift it through the cap.
 */
export function paperShellGeometry(
  box: THREE.Box3,
  inset = SIDE_INSET,
  topInset = 0.6
): THREE.BufferGeometry {
  const min = new THREE.Vector3(box.min.x + inset, box.min.y, box.min.z + inset);
  const max = new THREE.Vector3(box.max.x - inset, box.max.y - topInset, box.max.z - inset);
  const size = max.clone().sub(min);

  const target = { position: [] as number[], normal: [] as number[], uv: [] as number[] };
  const x = new THREE.Vector3(size.x, 0, 0);
  const y = new THREE.Vector3(0, size.y, 0);
  const z = new THREE.Vector3(0, 0, size.z);

  // Every wall is described the same way — across to the right, up is up — and
  // `quad` reverses the three whose outward normal that leaves backwards. The
  // alternative, writing each face's corners in the order its own normal wants,
  // is where the grain ends up running sideways on two of the four panels.
  quad(target, new THREE.Vector3(min.x, min.y, min.z), x, y, new THREE.Vector3(0, 0, -1));
  quad(target, new THREE.Vector3(min.x, min.y, max.z), x, y, new THREE.Vector3(0, 0, 1));
  quad(target, new THREE.Vector3(min.x, min.y, min.z), z, y, new THREE.Vector3(-1, 0, 0));
  quad(target, new THREE.Vector3(max.x, min.y, min.z), z, y, new THREE.Vector3(1, 0, 0));
  quad(target, new THREE.Vector3(min.x, max.y, min.z), x, z, new THREE.Vector3(0, 1, 0));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(target.position, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(target.normal, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(target.uv, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The board the shade sits on: the sixth face, and the one that is not paper.
 *
 * The shell is open underneath because the bottom is inside the base and nobody
 * sees it — but *the light* saw it. With nothing there the bulb lit the table
 * through the floor of its own shade, and a lantern that glows out of its
 * underside is one with no bottom in it, which no lantern has. A real one is
 * closed with a board.
 *
 * Separate from the shell rather than a sixth quad on it because it is a
 * different material and a different job: the paper is a diffuser that must not
 * cast, and this is a piece of wood whose entire purpose is to cast. Keeping
 * them apart is also what lets `__papercheck` go on asserting that the shell has
 * no floor.
 */
export function shellFloorGeometry(box: THREE.Box3, inset = SIDE_INSET): THREE.BufferGeometry {
  const target = { position: [] as number[], normal: [] as number[], uv: [] as number[] };
  const min = new THREE.Vector3(box.min.x + inset, box.min.y, box.min.z + inset);
  const size = new THREE.Vector3(
    box.max.x - inset - min.x,
    0,
    box.max.z - inset - min.z
  );
  quad(
    target,
    min,
    new THREE.Vector3(size.x, 0, 0),
    new THREE.Vector3(0, 0, size.z),
    new THREE.Vector3(0, -1, 0)
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(target.position, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(target.normal, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(target.uv, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Paper with a bulb behind it.
 *
 * A sheet lit from inside is not a sheet of one brightness. The centre of the
 * panel nearest the bulb is the brightest thing in the room and the far top
 * corner is barely above the timber around it, and that gradient is most of what
 * says *lit from within* rather than *painted white*. Emissive colour is one
 * number for the whole surface, so the falloff is injected into the shader —
 * the same `onBeforeCompile` route `woodMaterial.ts` takes, for the same reason:
 * it is one term added to a standard material, not a new material.
 *
 * The paper deliberately **casts no shadow**. The bulb inside it is what throws
 * the lattice across the wall and the table top, and a sheet of paper that
 * blocked its own light would swallow the whole effect. Physically it is the
 * right call too: the paper is what makes the light diffuse, not what stops it.
 */
export class RicePaperMaterial extends THREE.MeshStandardMaterial {
  private readonly bulb = { value: new THREE.Vector3() };
  private readonly reach = { value: 200 };

  constructor() {
    super({
      map: ricePaperTexture(),
      emissiveMap: ricePaperTexture(),
      emissive: new THREE.Color("#ffb469"),
      emissiveIntensity: 1,
      color: new THREE.Color("#fff6e6"),
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uBulb = this.bulb;
      shader.uniforms.uReach = this.reach;

      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "varying vec3 vPaperPos;\nvoid main() {")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n  vPaperPos = transformed;"
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          "uniform vec3 uBulb;\nuniform float uReach;\nvarying vec3 vPaperPos;\nvoid main() {"
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
  float paperD = length(vPaperPos - uBulb) / uReach;
  totalEmissiveRadiance *= 1.0 / (1.0 + paperD * paperD);`
        );
    };
  }

  /**
   * Where the bulb sits behind the paper, in the shell's own coordinates, and
   * how far its light carries before it has halved.
   */
  setBulb(position: THREE.Vector3, reach: number): void {
    this.bulb.value.copy(position);
    this.reach.value = Math.max(reach, 1);
  }
}
