import test from "node:test";
import assert from "node:assert/strict";
import { World, B } from "../app/src/main/assets/world.js";
import {
  CharacterController,
  FIXED_DT,
  EYE_HEIGHT,
  overlaps,
} from "../app/src/main/assets/physics.js";
import {
  Inventory,
  Pickups,
  resourceForBlock,
} from "../app/src/main/assets/inventory.js";
import {
  Ecology,
  SPECIES,
  cellPosition,
  toWorld,
} from "../app/src/main/assets/entities.js";
import { chunkGeometry } from "../app/src/main/assets/render.js";
function field() {
  const w = new World(18);
  for (let z = 4; z < 30; z++)
    for (let x = 4; x < 30; x++) {
      for (let y = 0; y < 4; y++) w.blocks[w.index(x, y, z)] = B.STONE;
      w.ground[x + z * 160] = 3;
    }
  return w;
}
function actor(x = 12.5, y = 4, z = 12.5) {
  return { x, y, z, yaw: 0, pitch: 0, vy: 0, flying: false, grounded: true };
}
const range = (a) => Math.max(...a) - Math.min(...a);
test("regression: old five-centimetre foot gap oscillates; swept support stays constant", () => {
  let y = 4.001,
    vy = 0;
  const old = [];
  for (let i = 0; i < 300; i++) {
    vy -= 18 * FIXED_DT;
    const ny = y + vy * FIXED_DT;
    if (ny + 0.05 >= 4) y = ny;
    else {
      y = Math.ceil(ny - 0.05) + 0.001;
      vy = 0;
    }
    old.push(y);
  }
  assert.ok(range(old) > 0.03);
  const w = field(),
    p = actor(),
    c = new CharacterController(w, p),
    values = [];
  for (let i = 0; i < 1200; i++) {
    c.step(FIXED_DT, {});
    values.push(c.render((i % 7) / 7).y);
  }
  assert.ok(range(values) < 1e-8);
  assert.equal(p.y, 4);
  assert.equal(p.grounded, true);
});
test("stationary floor contact is stable under irregular rendered frame intervals", () => {
  const w = field(),
    p = actor(),
    c = new CharacterController(w, p);
  let accumulator = 0;
  const cameras = [];
  for (let i = 0; i < 500; i++) {
    accumulator += [1 / 24, 1 / 90, 1 / 37, 1 / 120][i % 4];
    while (accumulator >= FIXED_DT) {
      c.step(FIXED_DT, {});
      accumulator -= FIXED_DT;
    }
    cameras.push(c.render(accumulator / FIXED_DT).y);
  }
  assert.ok(range(cameras) < 1e-8);
  assert.equal(cameras[0], 4 + EYE_HEIGHT);
});
test("jump lands once on exact ground without subsequent floor bounce", () => {
  const w = field(),
    p = actor(),
    c = new CharacterController(w, p);
  c.step(FIXED_DT, { jump: true });
  let high = p.y,
    landed = false;
  for (let i = 0; i < 180; i++) {
    c.step(FIXED_DT, {});
    high = Math.max(high, p.y);
    if (p.grounded) landed = true;
    if (landed) assert.equal(p.y, 4);
    assert.ok(!overlaps(w, p));
  }
  assert.ok(high > 4.9);
  assert.equal(p.y, 4);
});
test("removing the support causes a real fall; half-metre platforms stop it exactly", () => {
  const w = field(),
    p = actor(),
    c = new CharacterController(w, p);
  w.setCell(24, 7, 24, 0);
  w.setCell(25, 7, 24, 0);
  w.setCell(24, 7, 25, 0);
  w.setCell(25, 7, 25, 0);
  for (let i = 0; i < 180; i++) c.step(FIXED_DT, {});
  assert.equal(p.y, 3.5);
  assert.equal(p.grounded, true);
  assert.ok(!overlaps(w, p));
});
test("half-metre stair climb fits the full 1.5 metre body", () => {
  const w = field();
  for (let z = 10; z < 14; z++)
    for (let x = 14; x < 18; x++) {
      for (let dx = 0; dx < 2; dx++)
        for (let dz = 0; dz < 2; dz++)
          w.setCell(x * 2 + dx, 8, z * 2 + dz, B.STONE);
    }
  const p = actor(13.4, 4, 10.25),
    c = new CharacterController(w, p);
  for (let i = 0; i < 65; i++) c.step(FIXED_DT, { side: 1 });
  assert.ok(p.x > 14);
  assert.equal(p.y, 4.5);
  assert.ok(!overlaps(w, p));
});
test("a solid one-metre wall blocks walking and a low ceiling blocks jumping", () => {
  const w = field();
  for (let y = 4; y < 8; y++)
    for (let z = 8; z < 17; z++) w.set(15, y, z, B.STONE);
  const p = actor(13, 4, 12.5),
    c = new CharacterController(w, p);
  for (let i = 0; i < 120; i++) c.step(FIXED_DT, { side: 1 });
  assert.ok(p.x <= 14.770001);
  assert.ok(!overlaps(w, p));
  w.set(14, 6, 12, B.STONE);
  c.step(FIXED_DT, { jump: true });
  for (let i = 0; i < 40; i++) {
    c.step(FIXED_DT, {});
    assert.ok(!overlaps(w, p));
  }
  assert.equal(p.y, 4);
});
test("half-cell edits preserve the other seven children and collapse uniform cells", () => {
  const w = field();
  w.set(12, 7, 12, B.DIRT);
  w.setCell(24, 14, 24, 0);
  assert.equal(w.getCell(24, 14, 24), 0);
  assert.equal(w.getCell(25, 14, 24), B.DIRT);
  assert.equal(w.subcells.size, 1);
  w.setCell(24, 14, 24, B.DIRT);
  assert.equal(w.subcells.size, 0);
});
test("tools remove 0.125, 1 and 8 cubic metres on filled terrain", () => {
  const counts = [];
  for (const size of [0.5, 1, 2]) {
    const w = field();
    for (let z = 9; z <= 16; z++)
      for (let x = 9; x <= 16; x++)
        for (let y = 5; y <= 11; y++) w.set(x, y, z, B.DIRT);
    const r = w.mine({ hx: 24, hy: 16, hz: 24 }, size);
    counts.push(r.removed);
    assert.equal(r.counts.get(B.DIRT), r.removed);
  }
  assert.deepEqual(counts, [1, 8, 64]);
});
test("ray picking and visible half-cell mesh agree on the excavated boundary", () => {
  const w = new World();
  w.set(18, 5, 18, B.STONE);
  w.setCell(36, 10, 36, 0);
  const h = w.raycast({ x: 18.25, y: 5.25, z: 17 }, { x: 0, y: 0, z: 1 }, 5);
  assert.equal(h.hz, 37);
  assert.equal(h.distance, 1.5);
  const g = chunkGeometry(w, 1, 1),
    a = g.attributes.position.array;
  assert.ok(Array.from(a).some((v) => v === 18.5));
  g.dispose();
});
test("save and load preserve fine terrain and half-height support", () => {
  const w = field();
  w.setCell(24, 7, 24, 0);
  const saved = JSON.parse(JSON.stringify(w.save())),
    copy = field();
  copy.load(saved);
  assert.deepEqual([...copy.subcells], [...w.subcells]);
  assert.equal(copy.surface(12.25, 12.25), 3.5);
  assert.equal(copy.surface(12.75, 12.25), 4);
});
test("crafting is atomic: missing resources never disappear and outputs are exact", () => {
  const inv = new Inventory(false);
  inv.add("wood", 1);
  assert.equal(inv.craft("planks"), false);
  assert.equal(inv.count("wood"), 1);
  inv.add("wood", 1);
  assert.equal(inv.craft("planks"), true);
  assert.equal(inv.count("wood"), 0);
  assert.equal(inv.count("plank"), 4);
  assert.equal(inv.craft("hammer"), false);
  assert.equal(inv.count("plank"), 4);
});
test("resource collection enables crafted tools and an unlock cannot be charged twice", () => {
  const inv = new Inventory(false);
  for (const [id, n] of Object.entries({ stone: 12, plank: 4, bio: 6 }))
    inv.add(id, n);
  assert.equal(inv.craft("resin"), true);
  assert.equal(inv.craft("hammer"), true);
  assert.equal(inv.unlocks.has("hammer"), true);
  assert.equal(inv.craft("hammer"), false);
  assert.equal(inv.count("stone"), 0);
});
test("mined drops remain until approached, then collect only once", () => {
  const w = field(),
    inv = new Inventory(false),
    loot = new Pickups(),
    p = actor(20, 4, 20);
  loot.spawn(resourceForBlock(B.WOOD), 8, 12.5, 4.2, 12.5, {
    vx: 0,
    vy: 0,
    vz: 0,
  });
  for (let i = 0; i < 120; i++) loot.update(FIXED_DT, w, p, inv);
  assert.equal(inv.count("wood"), 0);
  assert.equal(loot.items.length, 1);
  assert.ok(Math.abs(loot.items[0].y - 4.075) < 1e-7);
  p.x = 12.5;
  p.z = 12.5;
  loot.update(FIXED_DT, w, p, inv);
  assert.equal(inv.count("wood"), 8);
  assert.equal(loot.items.length, 0);
  loot.update(FIXED_DT, w, p, inv);
  assert.equal(inv.count("wood"), 8);
});
test("voxel damage routes collectable fragments; death yields a separate reward once", () => {
  const w = field(),
    eco = new Ecology(w),
    loot = new Pickups(),
    inv = new Inventory(false),
    e = eco.spawn(0, 12.5, 12.5);
  e.yaw = 0;
  let deaths = 0;
  eco.onVoxel = (d) => loot.spawn("bio", 1, d.x, d.y, d.z, d);
  eco.onDeath = (m) => {
    deaths++;
    loot.spawn("essence", 1, m.x, m.y + 0.4, m.z);
  };
  const p = SPECIES[0].parts[2];
  eco.damageHit(
    { entity: e, part: 2, point: toWorld(e, p, 2, cellPosition(p, 0), 0) },
    0,
    0.3,
  );
  assert.ok(loot.items.some((d) => d.kind === "bio"));
  eco.kill(e);
  eco.kill(e);
  assert.equal(deaths, 1);
  loot.update(FIXED_DT, w, actor(12.5, 4, 12.5), inv);
  assert.ok(inv.count("bio") >= 1);
  assert.equal(inv.count("essence"), 1);
});
test("inventory, crafted unlocks and uncollected drops survive serialization", () => {
  const inv = new Inventory(false);
  for (const [id, n] of Object.entries({ stone: 12, plank: 4, resin: 2 }))
    inv.add(id, n);
  inv.craft("hammer");
  inv.add("wood", 7);
  const loot = new Pickups();
  loot.spawn("bio", 5, 20, 5, 20);
  const i2 = new Inventory(false),
    l2 = new Pickups();
  i2.load(JSON.parse(JSON.stringify(inv.save())));
  l2.load(JSON.parse(JSON.stringify(loot.save())));
  assert.equal(i2.count("wood"), 7);
  assert.equal(i2.unlocks.has("hammer"), true);
  assert.equal(l2.items[0].count, 5);
});
