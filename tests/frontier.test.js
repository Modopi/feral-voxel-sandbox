import test from "node:test";
import assert from "node:assert/strict";
// Frontier region terrain and the shared research items. The campaign rules are checked through the
// first-signal module (tests/first-signal-rules.test.js).
import { Inventory, RECIPES } from "../app/src/main/assets/inventory.js";
import { frontierWorld, regionInfo } from "../app/src/main/assets/frontier/terrain.js";
const invWith = (items) => {
  const i = new Inventory(false);
  for (const [id, n] of Object.entries(items)) i.add(id, n);
  return i;
};
test("frontier regions are seed-stable and structures retain player edits", () => {
  const a = regionInfo(42, -3, 2),
    b = regionInfo(42, -3, 2);
  assert.deepEqual(a, b);
  assert.notEqual(a.seed, regionInfo(42, -2, 2).seed);
  const w = frontierWorld(a.seed, a);
  const y = w.surface(77, 84);
  w.set(77, y, 84, 3);
  const saved = w.save();
  const restored = frontierWorld(a.seed, a);
  restored.load(saved);
  assert.equal(restored.get(77, y, 84), 3);
  assert.equal(restored.landmarks.length, 6);
  assert.ok(restored.landmarks.some((p) => p.name === "해체·운반 작업장"));
});
test("technology is obtainable without boss kills and prerequisite research survives save", () => {
  const i = invWith({
    knowledge: 40,
    crystal: 20,
    iron: 30,
    plank: 10,
    resin: 4,
  });
  const rover = RECIPES.find((r) => r.id === "rover");
  assert.equal(i.canCraft(rover), false);
  for (const id of ["engineering", "rover", "ballistics", "aviation"])
    assert.equal(i.craft(id), true);
  const restored = new Inventory();
  restored.load(i.save());
  assert.ok(restored.unlocks.has("aviation"));
  assert.equal(restored.canCraft(rover), false);
});
