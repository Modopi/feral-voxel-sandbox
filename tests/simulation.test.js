import test from "node:test";
import assert from "node:assert/strict";
import { World, B, SIZE } from "../app/src/main/assets/world.js";
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
