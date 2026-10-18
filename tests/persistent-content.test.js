import test from "node:test";
import assert from "node:assert/strict";
import { World, B } from "../app/src/main/assets/world.js";
import { miningWork, GEAR } from "../app/src/main/assets/equipment.js";
const hit = (hx, hy = 24, hz = 24) => ({ hx, hy, hz });
const strike = (w, h, size = 0.5, g = GEAR.pick) =>
  w.strikeMining(h, size, (b) => 0.2 / miningWork(b, size, g));
test("voxel damage survives different targets, time, tool and footprint changes, then clears only destroyed cells", () => {
  const w = new World(2),
    a = hit(24),
    b = hit(30);
  w.set(12, 12, 12, B.STONE);
  w.set(15, 12, 12, B.ORE);
  strike(w, a);
  const partial = w.damageAt(a);
  assert.ok(partial > 0 && partial < 1);
  strike(w, b);
  w.time = 500;
  assert.equal(w.damageAt(a), partial);
  assert.ok(w.damageAt(b) > 0);
  strike(w, a, 1, GEAR.stonepick);
  assert.ok(w.damageAt(a) > partial);
  assert.ok(w.damageAt(hit(25)) > 0);
  const neighbor = w.damageAt(hit(25));
  let removed = 0;
  for (let n = 0; n < 10; n++)
    removed += strike(w, a, 0.5, GEAR.ironpick).removed;
  assert.equal(removed, 1);
  assert.equal(w.damageAt(a), 0);
  assert.equal(w.damageAt(hit(25)), neighbor);
  w.setCell(24, 24, 24, B.STONE);
  assert.equal(w.damageAt(a), 0);
  strike(w, a);
  w.set(12, 12, 12, B.DIRT);
  assert.equal(w.damageAt(a), 0);
  assert.equal(w.damageAt(hit(25)), 0);
});
test("damage reloads with terrain, rejects stale/corrupt records, and legacy saves have no damage", () => {
  const w = new World(2);
  w.set(12, 12, 12, B.STONE);
  strike(w, hit(24));
  strike(w, hit(25));
  w.setCell(24, 24, 25, B.WOOD);
  const saved = JSON.parse(JSON.stringify(w.save())),
    restored = new World(2);
  restored.load(saved);
  assert.equal(restored.damageAt(hit(24)), w.damageAt(hit(24)));
  assert.equal(restored.damageAt(hit(25)), w.damageAt(hit(25)));
  saved.miningDamage.push(
    [-1, [3, 0.5]],
    [42, [3, NaN]],
    [w.damageKey(24, 24, 25), [B.STONE, 0.9]],
  );
  restored.load(saved);
  assert.equal(restored.miningDamage.size, 2);
  delete saved.miningDamage;
  restored.load(saved);
  assert.equal(restored.miningDamage.size, 0);
});
test("mixed-material mining and protected cells use their own hardness without duplicate drops", () => {
  const w = new World(2);
  w.set(12, 12, 12, B.STONE);
  w.setCell(24, 24, 24, B.ORE);
  w.setCell(25, 24, 24, B.LAVA);
  strike(w, hit(24), 1);
  assert.ok(w.damageAt(hit(24)) < w.damageAt(hit(24, 25)));
  assert.equal(w.damageAt(hit(25)), 0);
  let count = 0;
  for (let n = 0; n < 100; n++) count += strike(w, hit(24), 1).removed;
  assert.equal(count, 7);
  assert.equal(w.getCell(25, 24, 24), B.LAVA);
  assert.equal(w.miningDamage.size, 0);
  assert.equal(strike(w, hit(24, 0), 0.5).struck, 0);
});
