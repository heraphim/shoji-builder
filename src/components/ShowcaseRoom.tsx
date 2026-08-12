import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { WoodMaterial } from "../lib/woodMaterial";
import { woodPreset } from "../lib/wood";
import { mulberry32 } from "../lib/ricePaper";

/**
 * The room the lamp is shown in: a wall, a nightstand, the corner of a bed, and
 * a scroll hanging behind.
 *
 * Everything here is built out of boxes and a canvas or two — no downloaded
 * models, no textures to fetch. Three reasons, in order of how much they
 * mattered: the site is served from GitHub Pages with no CDN, so every byte is
 * one the visitor waits for; a CC0 bedroom set is tens of megabytes before it is
 * compressed and a licence file after; and at this framing the props are almost
 * entirely **silhouette**. The room is dark. What the eye gets is the shape of a
 * nightstand top catching the lamp's spill and the edge of a pillow beyond it,
 * and a box with the right proportions gives that as well as a scan does.
 *
 * The one place that argument fails is the pillow, which has no straight lines
 * anywhere — so that one is a box inflated into a cushion, {@link pillowGeometry}.
 *
 * ## Where things are
 *
 * The lamp stands at the world origin, so the room is laid out *around* that:
 * the nightstand's top surface is the plane `y = 0` and its centre is the origin
 * in x and z both, the wall goes just behind it, and the bed runs off to `+x`.
 * All millimetres, like the rest of the app.
 *
 * The group is then dropped onto the lamp's real underside — see `standY` on
 * {@link ShowcaseRoom} — because `y = 0` is the base of the *reference box*, and
 * the timber hangs below it.
 */

/** The nightstand's top face — the plane the lamp stands on. */
const TABLE_Y = 0;

/** The wall behind everything. */
const WALL_Z = -270;

/** The floor, far enough down that a nightstand is a nightstand. */
const FLOOR_Y = -700;

/** The ceiling, at a bedroom's height above that floor. */
const CEILING_Y = 1800;

/**
 * The pendant over the middle of the room, in room coordinates.
 *
 * Exported because the *light* is not part of the room — the room owns what you
 * can see of the fixture, the scene owns what it does — and the two have to
 * agree about where it hangs to within a millimetre or the glow will come from
 * beside the shade rather than out of it.
 */
export const CEILING_FIXTURE = { x: 420, y: 1584, z: 320 } as const;

/**
 * A box in world coordinates rather than one centred on the origin.
 *
 * Two reasons it is worth a helper. The layout above is written as extents —
 * "the top runs from −270 to 270" — and converting each one to a centre and a
 * size by hand is where the arithmetic slips. And the wood shader is a *solid*
 * texture read in object space (see `woodMaterial.ts`), so a set of parts that
 * all shared one origin-centred geometry would come out with the identical
 * length of grain running through each of them.
 */
function boxAt(
  x: [number, number],
  y: [number, number],
  z: [number, number]
): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x[1] - x[0], y[1] - y[0], z[1] - z[0]).translate(
    (x[0] + x[1]) / 2,
    (y[0] + y[1]) / 2,
    (z[0] + z[1]) / 2
  );
}

/**
 * A box puffed out into a cushion.
 *
 * Each face is pushed out along its own normal by how far the vertex is from the
 * face's edges — full in the middle, nothing at the seam — which is exactly what
 * stuffing does to a sewn rectangle. The corners stay pinched, and that is not a
 * defect: a real pillow has ears at its corners for the same reason.
 */
function pillowGeometry(
  width: number,
  height: number,
  depth: number,
  puff = 0.34
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth, 14, 14, 14);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const half = new THREE.Vector3(width / 2, height / 2, depth / 2);

  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    const n = new THREE.Vector3(p.x / half.x, p.y / half.y, p.z / half.z);
    const flat = new THREE.Vector3(1 - n.x * n.x, 1 - n.y * n.y, 1 - n.z * n.z);
    position.setXYZ(
      i,
      p.x + n.x * puff * half.x * flat.y * flat.z,
      p.y + n.y * puff * half.y * flat.x * flat.z,
      p.z + n.z * puff * half.z * flat.x * flat.y
    );
  }

  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The hanging scroll, painted onto a canvas.
 *
 * Deliberately faint and mostly empty. It hangs a metre from a lamp that is the
 * only light in the room, so what actually reaches the eye is a warm rectangle
 * with something suggested in it — and a picture drawn to be read at full
 * brightness reads, at this one, as clutter.
 */
function kakejikuTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 640;
  const ctx = canvas.getContext("2d")!;

  const paper = ctx.createLinearGradient(0, 0, 0, 640);
  paper.addColorStop(0, "#efe3c8");
  paper.addColorStop(0.5, "#f6ecd6");
  paper.addColorStop(1, "#e6d9bb");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 320, 640);

  // the mounting silk, a shade darker than the painting it borders
  ctx.fillStyle = "#c9b998";
  ctx.fillRect(0, 0, 320, 54);
  ctx.fillRect(0, 586, 320, 54);

  // the mountain: a soft cone with snow down its shoulders
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(60, 400);
  ctx.lineTo(168, 214);
  ctx.lineTo(280, 400);
  ctx.closePath();
  const rock = ctx.createLinearGradient(0, 214, 0, 400);
  rock.addColorStop(0, "rgba(58,64,74,0.9)");
  rock.addColorStop(0.4, "rgba(88,94,102,0.6)");
  rock.addColorStop(1, "rgba(140,136,126,0.1)");
  ctx.fillStyle = rock;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = "rgba(250,248,242,0.72)";
  ctx.beginPath();
  ctx.moveTo(168, 214);
  ctx.lineTo(214, 292);
  ctx.lineTo(196, 286);
  ctx.lineTo(178, 306);
  ctx.lineTo(160, 282);
  ctx.lineTo(140, 300);
  ctx.lineTo(122, 292);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // mist across its feet, which is what puts it in the distance
  const mist = ctx.createLinearGradient(0, 344, 0, 420);
  mist.addColorStop(0, "rgba(239,229,205,0)");
  mist.addColorStop(0.5, "rgba(239,229,205,0.92)");
  mist.addColorStop(1, "rgba(239,229,205,0)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, 344, 320, 76);

  // The pine in the near corner: a trunk, three branches, and needles as a
  // scatter of small dots rather than a filled shape.
  //
  // Drawn as ellipses first, and it was the worst thing on the page — a flat
  // ellipse of dark green reads as a shape *of* foliage, not as foliage, in the
  // same way a filled circle reads as a ball rather than as a cloud. A few
  // hundred overlapping dots at a tenth of the opacity have soft edges and an
  // uneven density, which is what needles have and what ink does.
  const ink = mulberry32(4);
  ctx.strokeStyle = "rgba(34,30,26,0.9)";
  ctx.lineWidth = 4.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(74, 400);
  ctx.quadraticCurveTo(64, 302, 84, 200);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  for (const [x, y] of [
    [104, 240],
    [50, 272],
    [110, 304],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(78, y + 10);
    ctx.quadraticCurveTo((78 + x) / 2, y + 2, x, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(46,52,42,0.13)";
  for (const [cx, cy, rx] of [
    [86, 196, 54],
    [110, 236, 40],
    [52, 268, 38],
    [114, 300, 34],
  ] as const) {
    for (let i = 0; i < 150; i++) {
      // rejection-free: pick inside the unit disc, then squash it flat
      const a = ink() * Math.PI * 2;
      const r = Math.sqrt(ink());
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r * rx, cy + Math.sin(a) * r * rx * 0.36, 1.5 + ink() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // and the pagoda, three roofs on the far shore
  ctx.fillStyle = "rgba(42,38,32,0.8)";
  for (let i = 0; i < 3; i++) {
    const y = 366 - i * 24;
    const w = 34 - i * 6;
    ctx.beginPath();
    ctx.moveTo(206 - w, y);
    ctx.quadraticCurveTo(206, y - 16, 206 + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(206 - w * 0.4, y, w * 0.8, 12);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Every surface in the room, and the two woods they are made of.
 *
 * Built once and disposed together. The nightstand and the bed are drawn with
 * the app's own wood shader rather than a brown `MeshStandardMaterial` — it is
 * already here, it is the same timber language the lamp is described in, and a
 * nightstand with real grain in it is most of why the lamp's own grain reads as
 * grain rather than as a pattern.
 */
function useRoom() {
  const room = useMemo(() => {
    // The nightstand is the lighter of the two on purpose: it is the surface the
    // lamp's spill actually lands on, and dark walnut swallowed the pool of light
    // that is half of what says the lamp is lit. The bed is behind and beside,
    // where a darker timber is what keeps it from competing.
    const walnut = new WoodMaterial({ ...woodPreset("red_oak", "semigloss"), grainScale: 700 });
    const oak = new WoodMaterial({ ...woodPreset("walnut", "matte"), grainScale: 1700 });

    return {
      walnut,
      oak,
      scroll: kakejikuTexture(),
      geometry: {
        wall: boxAt([-3200, 3200], [FLOOR_Y, 2600], [WALL_Z - 120, WALL_Z]),
        floor: boxAt([-3200, 3200], [FLOOR_Y - 120, FLOOR_Y], [WALL_Z, 3000]),

        // The nightstand: a top with an overhang, a carcass set back under it,
        // one drawer, and a recessed plinth so it does not sit flat on the floor.
        //
        // Centred on the origin in **both** directions, because the lamp stands
        // at the origin and a lamp pushed towards the front edge of the table it
        // is on reads as one about to be knocked off. That is what fixes the
        // wall's distance too: the top is 460 deep, so the wall goes just behind
        // the back of it rather than wherever it was put first.
        top: boxAt([-278, 278], [TABLE_Y - 26, TABLE_Y], [-230, 230]),
        carcass: boxAt([-246, 246], [-604, -26], [-200, 200]),
        drawer: boxAt([-222, 222], [-244, -76], [-200, 212]),
        plinth: boxAt([-224, 224], [-676, -604], [-178, 178]),
        knobStem: boxAt([-9, 9], [-169, -151], [212, 226]),

        // the bed: a headboard panel between two posts, a mattress, and a
        // duvet turned down at the top
        headboard: boxAt([470, 2300], [-300, 610], [WALL_Z, WALL_Z + 46]),
        post: boxAt([470, 566], [-330, 706], [WALL_Z, WALL_Z + 96]),
        postCap: boxAt([454, 582], [706, 730], [WALL_Z - 16, WALL_Z + 112]),
        headRail: boxAt([470, 2300], [610, 668], [WALL_Z - 14, WALL_Z + 60]),
        mattress: boxAt([500, 2400], [-330, -132], [WALL_Z + 46, 1400]),

        // the scroll, and the dowels it hangs from
        // Hung at the lamp's own height, not at a person's, and low enough that
        // the *painting* is in shot rather than the mounting silk above it. It is
        // a prop in a photograph of a lamp: a scroll at the height a room would
        // really hang one is a scroll above the top of the frame.
        art: boxAt([-860, -400], [-60, 780], [WALL_Z - 1, WALL_Z + 3]),
        rodTop: boxAt([-894, -366], [780, 808], [WALL_Z - 2, WALL_Z + 22]),
        rodBottom: boxAt([-894, -366], [-88, -60], [WALL_Z - 2, WALL_Z + 22]),

        // the ceiling, and the pendant hanging off the middle of it
        ceiling: boxAt([-3200, 3200], [CEILING_Y, CEILING_Y + 120], [WALL_Z, 3000]),
        rod: boxAt(
          [CEILING_FIXTURE.x - 7, CEILING_FIXTURE.x + 7],
          [CEILING_FIXTURE.y + 96, CEILING_Y],
          [CEILING_FIXTURE.z - 7, CEILING_FIXTURE.z + 7]
        ),
        // open-ended, so the inside of the shade is a surface the bulb can light
        shade: new THREE.CylinderGeometry(46, 152, 132, 28, 1, true).translate(
          CEILING_FIXTURE.x,
          CEILING_FIXTURE.y + 30,
          CEILING_FIXTURE.z
        ),
        bulb: new THREE.SphereGeometry(30, 20, 14).translate(
          CEILING_FIXTURE.x,
          CEILING_FIXTURE.y,
          CEILING_FIXTURE.z
        ),

        knob: new THREE.SphereGeometry(17, 20, 14).translate(0, -160, 230),
        pillow: pillowGeometry(560, 190, 360).translate(0, 0, 0),
        duvet: pillowGeometry(1900, 150, 1300, 0.12).translate(1450, -60, 620),
        sheet: pillowGeometry(1900, 70, 300, 0.2).translate(1450, -20, 1180),
      },
    };
  }, []);

  useEffect(
    () => () => {
      room.walnut.dispose();
      room.oak.dispose();
      room.scroll.dispose();
      for (const geometry of Object.values(room.geometry)) geometry.dispose();
    },
    [room]
  );

  return room;
}

/**
 * @param standY where the lamp actually stands, in world millimetres.
 *
 * Not zero, and this is the one number in the file that cannot be a constant.
 * The lamp's *main box* has its base on `y = 0` — but the main box is the volume
 * the frame encloses, and a leg is anchored to it with an overhang below, so the
 * timber that touches the table is some tens of millimetres further down. Built
 * flat on zero, the nightstand rose through the lamp's own base and swallowed
 * the light that should have been pooling on it.
 */
export function ShowcaseRoom({ standY, ceilingOn }: { standY: number; ceilingOn: boolean }) {
  const room = useRoom();
  const g = room.geometry;

  return (
    <group position={[0, standY, 0]}>
      <mesh geometry={g.ceiling} receiveShadow>
        <meshStandardMaterial color="#cfc2ad" roughness={0.98} metalness={0} />
      </mesh>
      <mesh geometry={g.rod} castShadow>
        <meshStandardMaterial color="#2a2018" roughness={0.5} metalness={0.5} />
      </mesh>
      {/* The shade is what the pendant *is*, seen from below: an open cone whose
          inside is a bright ring when the bulb is lit and a dull one when it is
          not. Double-sided for that reason and no other. */}
      <mesh geometry={g.shade} castShadow receiveShadow>
        <meshStandardMaterial
          color="#e8dcc6"
          roughness={0.85}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={g.bulb}>
        <meshStandardMaterial
          color="#fff3dd"
          emissive="#ffd9a0"
          emissiveIntensity={ceilingOn ? 4 : 0}
          roughness={0.4}
        />
      </mesh>

      {/* Plaster. Nearly white as a colour and nearly black on screen — the only
          light in the room is inside the lamp, so what the wall shows is the
          spill, which is the point of having one. */}
      <mesh geometry={g.wall} receiveShadow>
        <meshStandardMaterial color="#b6a892" roughness={0.95} metalness={0} />
      </mesh>
      <mesh geometry={g.floor} receiveShadow>
        <meshStandardMaterial color="#4c3a2a" roughness={0.9} metalness={0} />
      </mesh>

      <mesh geometry={g.top} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.carcass} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.drawer} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.plinth} material={room.walnut} castShadow receiveShadow />
      <mesh geometry={g.knobStem} material={room.walnut} castShadow />
      <mesh geometry={g.knob} castShadow>
        <meshStandardMaterial color="#2a2018" roughness={0.35} metalness={0.6} />
      </mesh>

      <mesh geometry={g.headboard} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.post} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.postCap} material={room.oak} castShadow receiveShadow />
      <mesh geometry={g.headRail} material={room.oak} castShadow receiveShadow />

      <mesh geometry={g.mattress} castShadow receiveShadow>
        <meshStandardMaterial color="#bdb3a4" roughness={0.95} metalness={0} />
      </mesh>
      <mesh geometry={g.duvet} castShadow receiveShadow>
        <meshStandardMaterial color="#b3a898" roughness={1} metalness={0} />
      </mesh>
      <mesh geometry={g.sheet} castShadow receiveShadow>
        <meshStandardMaterial color="#c9c2b4" roughness={1} metalness={0} />
      </mesh>

      {/* Leaning back against the headboard, the way one does when the bed is
          made rather than slept in. */}
      <group position={[940, 55, -100]} rotation={[-0.42, -0.12, 0.03]}>
        <mesh geometry={g.pillow} castShadow receiveShadow>
          <meshStandardMaterial color="#c6bcac" roughness={1} metalness={0} />
        </mesh>
      </group>

      <mesh geometry={g.art} receiveShadow>
        <meshStandardMaterial map={room.scroll} roughness={0.95} metalness={0} />
      </mesh>
      <mesh geometry={g.rodTop} castShadow>
        <meshStandardMaterial color="#3a2b1e" roughness={0.6} metalness={0.1} />
      </mesh>
      <mesh geometry={g.rodBottom} castShadow>
        <meshStandardMaterial color="#3a2b1e" roughness={0.6} metalness={0.1} />
      </mesh>
    </group>
  );
}
