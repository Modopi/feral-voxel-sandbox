import test from "node:test";
import assert from "node:assert/strict";
import { Inventory } from "../app/src/main/assets/inventory.js";
import {
  GEAR,
  activeGear,
  spendGear,
  miningWork,
} from "../app/src/main/assets/equipment.js";
import { World, B } from "../app/src/main/assets/world.js";
import { Ecology } from "../app/src/main/assets/entities.js";
function supplied() {
  const i = new Inventory(false);
  for (const g of Object.values(GEAR))
    for (const k in g.cost) if (i.count(k) < 40) i.add(k, 40 - i.count(k));
  return i;
}
test("gear crafting, ammo, breakage, repair and save restore form a finite loop", () => {
  const i = supplied();
  assert.ok(i.craft("bow"));
  assert.ok(i.equip("bow"));
  assert.equal(activeGear(i, "weapon"), GEAR.bow);
  assert.equal(spendGear(i, "weapon"), false);
  assert.equal(i.wear.bow, 140);
  assert.ok(i.craft("arrows"));
  i.wear.bow = 1;
  assert.ok(spendGear(i, "weapon"));
  assert.equal(i.count("arrow"), 11);
  assert.equal(activeGear(i, "weapon"), GEAR.pulse);
  const restored = new Inventory();
  restored.load(JSON.parse(JSON.stringify(i.save())));
  assert.equal(restored.wear.bow, 0);
  assert.equal(restored.equip("bow"), false);
  assert.ok(restored.repair("bow"));
  assert.ok(restored.equip("bow"));
  assert.equal(restored.wear.bow, 140);
  assert.equal(restored.repair("bow"), false);
});
test("tools specialize in materials", () => {
  assert.ok(
    miningWork(B.WOOD, 1, GEAR.axe) < miningWork(B.WOOD, 1, GEAR.ironpick),
  );
  assert.ok(
    miningWork(B.ORE, 1, GEAR.ironpick) < miningWork(B.ORE, 1, GEAR.axe),
  );
});
test("limb loss impairs movement; vital loss kills once; health is independent of food", () => {
  const w = new World(1),
    eco = new Ecology(w),
    e = eco.spawn(0, 12, 12);
  let deaths = 0;
  eco.onDeath = () => deaths++;
  eco.detach(e, 2, 0);
  assert.equal(e.dead, false);
  assert.equal(eco.legs(e), 3);
  const energy = e.energy;
  eco.hurt(e, 10);
  assert.equal(e.hp, 38);
  assert.equal(e.energy, energy);
  eco.detach(e, 1, 0);
  assert.equal(e.dead, true);
  assert.equal(e.hp, 0);
  assert.equal(e.deathCause, "머리 파괴");
  eco.kill(e);
  eco.hurt(e, 200);
  assert.equal(deaths, 1);
});
test("legacy animal and inventory saves migrate without losing materials or injuries", () => {
  const eco = new Ecology(new World(1)),
    e = eco.spawn(1, 12, 12);
  eco.detach(e, 3, 0);
  const s = eco.save();
  delete s.entities[0].hp;
  delete s.entities[0].maxHP;
  eco.load(s);
  assert.equal(eco.entities[0].hp, 72);
  assert.equal(eco.legs(eco.entities[0]), 3);
  const i = new Inventory();
  i.load({ items: { wood: 7 }, unlocks: ["hammer"] });
  assert.equal(i.count("wood"), 7);
  assert.equal(activeGear(i, "weapon"), GEAR.pulse);
  assert.ok(i.unlocks.has("hammer"));
});

test("legacy headless creatures and zero-health creatures cannot remain alive", () => {
  for (const state of [{ lost: 2 }, { hp: 0 }, { energy: 0 }]) {
    const eco = new Ecology(new World(1)),
      e = eco.spawn(0, 12, 12);
    Object.assign(e, state);
    eco.think(e, 0.25);
    assert.equal(e.dead, true);
  }
});
