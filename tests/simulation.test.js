import test from "node:test";
import assert from "node:assert/strict";
import { World, B, SIZE } from "../app/src/main/assets/world.js";
import {
  Ecology,
  SPECIES,
  cellPosition,
  toWorld,
  occupied,
} from "../app/src/main/assets/entities.js";
function basin() {
  const w = new World(99);
  for (let z = 8; z <= 16; z++)
    for (let x = 8; x <= 16; x++) {
      w.blocks[w.index(x, 0, z)] = B.BASALT;
      for (let y = 1; y < 6; y++)
        if (x === 8 || x === 16 || z === 8 || z === 16)
          w.blocks[w.index(x, y, z)] = B.BASALT;
    }
  return w;
}
test("seed gives identical terrain and one metre cells", () => {
  const a = new World(31),
    b = new World(31);
  a.generate();
  b.generate();
  assert.deepEqual(a.blocks, b.blocks);
  assert.equal(a.index(2, 3, 4) - a.index(1, 3, 4), 1);
  assert.equal(a.index(2, 3, 5) - a.index(2, 3, 4), SIZE);
});
test("both quarter and eighth metre creatures are defined", () => {
  assert.deepEqual([...new Set(SPECIES.map((s) => s.cell))], [0.25, 0.125]);
});
test("fluid movement conserves volume and acid mass in a sealed basin", () => {
  const w = basin();
  w.pour(12, 4, 12, 4, 0.7);
  const before = w.totalFluid();
  for (let i = 0; i < 100; i++) {
    w.time += 0.13;
    w.fluidStep(1000);
  }
  const after = w.totalFluid();
  assert.ok(Math.abs(after.water - before.water) < 1e-8);
  assert.ok(Math.abs(after.acid - before.acid) < 1e-8);
  assert.ok(
    [...w.fluids].every(
      ([, f]) => f.v <= 1.00001 && f.a <= f.v + 0.00001 && f.v >= 0,
    ),
  );
  assert.ok([...w.fluids.keys()].some((i) => w.decode(i)[1] === 1));
});
test("mixing clean water dilutes acid without destroying solute", () => {
  const w = basin();
  w.pour(12, 3, 12, 1, 1);
  w.pour(12, 3, 12, 1, 0);
  for (let i = 0; i < 80; i++) w.fluidStep(1000);
  const f = w.totalFluid();
  assert.ok(Math.abs(f.water - 2) < 1e-8);
  assert.ok(Math.abs(f.acid - 1) < 1e-8);
});
test("water and lava form basalt and account for steam", () => {
  const w = basin();
  w.set(12, 1, 12, B.LAVA);
  w.pour(12, 2, 12, 1, 0);
  for (let i = 0; i < 8; i++) w.fluidStep(1000);
  assert.equal(w.get(12, 1, 12), B.BASALT);
  assert.equal(w.reactions.basalt, 1);
  assert.ok(Math.abs(w.totalFluid().water + w.reactions.steam - 1) < 1e-8);
});
test("burning wood consumes fuel and completes", () => {
  const w = new World();
  w.set(10, 3, 10, B.WOOD);
  w.ignite(10, 3, 10);
  for (let i = 0; i < 100; i++) w.chemistryStep(0.1);
  assert.equal(w.get(10, 3, 10), B.AIR);
  assert.equal(w.burning.size, 0);
  assert.equal(w.reactions.burned, 1);
});
test("voxel damage severs a limb and changes locomotion capability", () => {
  const w = new World(),
    e = new Ecology(w),
    mob = e.spawn(0, 12, 12),
    p = SPECIES[0].parts[2];
  const pt = toWorld(mob, p, 2, cellPosition(p, 1), 0);
  const count = e.damageHit({ entity: mob, part: 2, point: pt }, 0, 0.3);
  assert.equal(count, 2);
  assert.equal(e.legs(mob), 3);
  assert.ok(mob.lost & (1 << 2));
  assert.equal(occupied(mob, 2, 0), false);
  assert.ok(e.debris.length > 0);
});
test("head detachment propagates to attached ears", () => {
  const w = new World(),
    e = new Ecology(w),
    mob = e.spawn(0, 12, 12);
  e.detach(mob, 1, 0);
  assert.ok(mob.lost & (1 << 1));
  assert.ok(mob.lost & (1 << 7));
  assert.ok(mob.lost & (1 << 8));
});
test("grazing consumes vegetation and returns energy", () => {
  const w = new World(),
    eco = new Ecology(w),
    e = eco.spawn(0, 12, 12);
  w.plants[12 + 12 * SIZE] = 1;
  e.energy = 50;
  eco.rehash();
  eco.think(e, 0.5);
  assert.ok(w.plants[12 + 12 * SIZE] < 1);
  assert.ok(e.energy > 50);
});
test("predation transfers energy and death returns soil nutrients", () => {
  const w = new World(),
    eco = new Ecology(w),
    p = eco.spawn(1, 12, 12),
    prey = eco.spawn(0, 12.5, 12);
  p.energy = 30;
  prey.hp = 1; // Predation damages health, independently of nutrition.
  eco.rehash();
  eco.think(p, 0.5);
  assert.equal(prey.dead, true);
  assert.ok(p.energy > 30);
  assert.ok(w.nutrients[12 + 12 * SIZE] > 0);
});
test("well fed mature creatures reproduce within population budget", () => {
  const w = new World(),
    eco = new Ecology(w),
    e = eco.spawn(0, 12, 12);
  e.energy = 145;
  e.age = 35;
  eco.birthBudget = 1;
  eco.think(e, 0.25);
  assert.equal(eco.entities.length, 2);
  assert.equal(w.reactions.births, 1);
});
test("save roundtrip preserves terrain, fluid, population and severed parts", () => {
  const w = new World(100);
  w.generate();
  const e = new Ecology(w);
  e.populate(24);
  w.set(40, 25, 40, B.WOOD);
  w.pour(40, 26, 40, 2, 0.5);
  e.detach(e.entities[0], 2, 0);
  const state = JSON.parse(JSON.stringify({ w: w.save(), e: e.save() })),
    w2 = new World(state.w.seed);
  w2.generate();
  w2.load(state.w);
  const e2 = new Ecology(w2);
  e2.load(state.e);
  assert.deepEqual(w.blocks, w2.blocks);
  assert.equal(e2.entities.length, e.entities.length);
  assert.equal(e2.entities[0].lost, e.entities[0].lost);
  assert.ok(Math.abs(w.totalFluid().water - w2.totalFluid().water) < 0.0001);
});
test("3000 entities tick with finite positions and bounded population", () => {
  const w = new World(4);
  w.generate();
  const eco = new Ecology(w);
  eco.populate(3000);
  assert.ok(eco.entities.length <= 3200);
  for (let i = 0; i < 30; i++) eco.update(1 / 30, { x: 80, z: 80 }, i / 30);
  assert.ok(
    eco.entities.every((e) => [e.x, e.y, e.z, e.energy].every(Number.isFinite)),
  );
});

test("water extinguishes a burning wooden cell", () => {
  const w = basin();
  w.set(12, 1, 12, B.WOOD);
  w.ignite(12, 1, 12);
  w.pour(12, 2, 12, 1, 0);
  w.chemistryStep(0.1);
  assert.equal(w.burning.size, 0);
  assert.equal(w.get(12, 1, 12), B.WOOD);
});
test("concentrated acid consumes reagent while corroding organic material", () => {
  const w = basin();
  w.set(12, 1, 12, B.WOOD);
  w.pour(12, 2, 12, 1, 0.95);
  w.random = () => 0;
  w.fluidStep(1000);
  assert.equal(w.get(12, 1, 12), B.AIR);
  assert.equal(w.reactions.dissolved, 1);
  assert.ok(w.totalFluid().acid < 0.95);
});
