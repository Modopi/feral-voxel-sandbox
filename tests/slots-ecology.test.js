import test from "node:test";
import assert from "node:assert/strict";
import { Inventory, ITEMS } from "../app/src/main/assets/inventory.js";
import { Ecology } from "../app/src/main/assets/entities.js";
import { World } from "../app/src/main/assets/world.js";

test("36 real slots split at 64 and transfers conserve counts through merge and swap", () => {
  const inv = new Inventory(false);
  assert.equal(inv.add("wood", 130), 130);
  assert.deepEqual(
    inv.slots.slice(0, 3).map((s) => s.count),
    [64, 64, 2],
  );
  inv.move(0, 9, true);
  assert.equal(inv.slots[0].count, 32);
  assert.equal(inv.slots[9].count, 32);
  inv.move(9, 2);
  assert.equal(inv.slots[2].count, 34);
  assert.equal(inv.slots[9], null);
  inv.add("stone", 5);
  const i = inv.slots.findIndex((s) => s?.id === "stone");
  inv.move(i, 0);
  assert.equal(inv.slots[0].id, "stone");
  assert.equal(inv.count("wood"), 130);
  assert.equal(inv.count("stone"), 5);
  assert.equal(inv.move(-1, 0), false);
});
test("full inventory does not discard pickups or charge failed crafting; costs can free output slots", () => {
  const inv = new Inventory(false);
  inv.add("wood", 36 * 64);
  assert.equal(inv.add("stone", 1), 0);
  const before = inv.save();
  assert.equal(inv.craft("planks"), false);
  assert.deepEqual(inv.save(), before);
  inv.take("wood", 64);
  assert.ok(inv.craft("planks"));
  assert.equal(inv.count("plank"), 4);
});
test("hotbar selection, exact layout, gear wear and consumption persist without duplicating items", () => {
  const inv = new Inventory();
  inv.add("plank", 8);
  inv.add("stone", 8);
  assert.ok(inv.craft("stonepick"));
  const i = inv.slots.findIndex((s) => s?.id === "stonepick");
  inv.move(i, 8);
  inv.select(8);
  inv.wear.stonepick = 17;
  const loaded = new Inventory(false);
  loaded.load(JSON.parse(JSON.stringify(inv.save())));
  assert.deepEqual(loaded.slots, inv.slots);
  assert.equal(loaded.selectedSlot, 8);
  assert.equal(loaded.wear.stonepick, 17);
  assert.equal(loaded.count("stonepick"), 1);
  assert.equal(loaded.craft("stonepick"), false);
  loaded.move(8, 16);
  assert.equal(loaded.slots[8], null);
  assert.equal(loaded.count("stonepick"), 1);
});
test("legacy large inventories migrate to recoverable overflow instead of losing items", () => {
  const inv = new Inventory(false);
  inv.load({
    items: { wood: 3000, stone: 120 },
    unlocks: ["bow"],
    wear: { bow: 31 },
  });
  const total = (id) =>
    inv.count(id) +
    inv.overflow.filter((s) => s.id === id).reduce((n, s) => n + s.count, 0);
  assert.equal(total("wood"), 3000);
  assert.equal(total("stone"), 120);
  assert.equal(total("bow"), 1);
  const old = total("wood");
  inv.take("wood", 128);
  inv.reclaim();
  assert.equal(total("wood"), old - 128);
  const loaded = new Inventory(false);
  loaded.load(JSON.parse(JSON.stringify(inv.save())));
  assert.deepEqual(loaded.overflow, inv.overflow);
});
test("earned rewards are recoverable and selected stacks are consumed first", () => {
  const inv = new Inventory(false);
  inv.add("stone", 2304);
  inv.grant("relic", 2);
  assert.equal(inv.overflow[0].count, 2);
  inv.take("stone", 64);
  inv.reclaim();
  assert.equal(inv.count("relic"), 2);
  assert.equal(inv.overflow.length, 0);
  inv.take("stone", 128);
  inv.add("seed", 70);
  const indexes = inv.slots
    .map((s, i) => (s?.id === "seed" ? i : -1))
    .filter((i) => i >= 0);
  inv.selectedSlot = indexes[1];
  inv.take("seed", 1);
  assert.equal(inv.slots[indexes[1]].count, 5);
});
function habitat() {
  const w = new World(1),
    eco = new Ecology(w),
    a = eco.spawn(0, 12, 12),
    b = eco.spawn(0, 13, 12);
  a.age = b.age = 40;
  eco.rehash();
  return { w, eco, a, b };
}
test("feeding two nearby adults consumes two seeds, creates one offspring, then enforces cooldown", () => {
  const { w, eco, a, b } = habitat(),
    inv = new Inventory(false);
  inv.add("seed", 4);
  eco.feed(a, inv, 0);
  assert.equal(eco.entities.length, 2);
  eco.feed(b, inv, 0);
  assert.equal(eco.entities.length, 3);
  assert.equal(inv.count("seed"), 2);
  assert.equal(w.reactions.births, 1);
  eco.feed(a, inv, 1);
  assert.equal(inv.count("seed"), 2);
  const s = eco.save(),
    restored = new Ecology(w);
  restored.load(s);
  assert.equal(restored.entities[0].breedAt, 90);
});
test("passive animals follow held seeds, flee hits, and predators attack only at night or in retaliation", () => {
  const { w, eco, a } = habitat();
  eco.context = { player: { x: 16, y: 0, z: 12 }, held: "seed" };
  eco.think(a, 0.25);
  assert.equal(a.behavior, "씨앗 따라가기");
  a.fear = 4;
  eco.think(a, 0.25);
  assert.equal(a.behavior, "도망");
  assert.ok(a.targetX < a.x);
  const fox = eco.spawn(1, 16.5, 12);
  let damage = 0;
  eco.context.hurt = (n) => (damage += n);
  eco.think(fox, 0.25);
  assert.equal(damage, 0);
  w.time = 12 * 60;
  eco.think(fox, 0.25);
  assert.equal(damage, 8);
  eco.think(fox, 0.25);
  assert.equal(damage, 8);
  w.time += 1.1;
  eco.think(fox, 0.25);
  assert.equal(damage, 16);
});

test("hunting materials can be cooked into food in the same inventory", () => {
  const inv = new Inventory(false);
  inv.add("meat", 2);
  inv.add("wood", 1);
  assert.ok(inv.craft("cooked_meat"));
  assert.equal(inv.count("meat"), 1);
  assert.equal(inv.count("wood"), 0);
  assert.equal(inv.count("food"), 2);
  const before = inv.save();
  assert.equal(inv.craft("cooked_meat"), false);
  assert.deepEqual(inv.save(), before);
});
