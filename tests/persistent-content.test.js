import test from "node:test";
import assert from "node:assert/strict";
import { World, B } from "../app/src/main/assets/world.js";
import { miningWork, GEAR } from "../app/src/main/assets/equipment.js";
import { Frontier } from "../app/src/main/assets/frontier/model.js";
import {
  GATHERABLES,
  resourceSites,
  relaySites,
  CONTRACTS,
} from "../app/src/main/assets/frontier/content.js";
import { Inventory } from "../app/src/main/assets/inventory.js";
import { Ecology } from "../app/src/main/assets/entities.js";
const hit = (hx, hy = 24, hz = 24) => ({ hx, hy, hz });
const strike = (w, h, size = 0.5, g = GEAR.pick) =>
  w.strikeMining(h, size, (b) => 0.2 / miningWork(b, size, g));
const stocked = (items = {}) => {
  const i = new Inventory(false);
  for (const [id, n] of Object.entries(items)) i.add(id, n);
  return i;
};
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
test("gathering has finite/re-growing sources, atomic full-bag failure and deterministic locations", () => {
  const s = new Frontier(42),
    i = stocked(),
    sites = resourceSites(s.info);
  assert.deepEqual(sites, resourceSites(s.info));
  const berry = sites.find((n) => n.kind === "berry"),
    scrap = sites.find((n) => n.kind === "scrap");
  assert.match(s.gather(berry.id, { x: 0, z: 0 }, i), /접근/);
  s.gather(berry.id, berry, i);
  assert.equal(i.count("berry"), 3);
  s.gather(berry.id, berry, i);
  assert.equal(i.count("berry"), 3);
  s.time += GATHERABLES.berry.regrow;
  s.gather(berry.id, berry, i);
  assert.equal(i.count("berry"), 6);
  s.gather(scrap.id, scrap, i);
  s.time += 9999;
  s.gather(scrap.id, scrap, i);
  assert.equal(i.count("scrap"), 3);
  const full = stocked({ stone: 36 * 64 }),
    herb = sites.find((n) => n.kind === "herb");
  assert.match(s.gather(herb.id, herb, full), /가방/);
  assert.equal(s.region.resources[herb.id], undefined);
  const r = Frontier.load(s.save());
  assert.equal(r.region.resources[scrap.id], -1);
  assert.ok(r.region.resources[berry.id] > 0);
});
test("ruin relays, bonus cache, observations and contracts are persistent one-time progression", () => {
  const s = new Frontier(42),
    i = stocked({ berry: 6, herb: 4, bio: 2, scrap: 6 }),
    v = s.region.villages[0];
  for (const q of CONTRACTS) {
    assert.match(s.deliver(v.id, q.id, v, i), /완료/);
    const saved = i.save();
    s.deliver(v.id, q.id, v, i);
    assert.deepEqual(i.save(), saved);
  }
  assert.equal(s.reputation[v.faction], 24);
  assert.equal(s.study(0, i), true);
  const notes = i.count("knowledge");
  assert.equal(s.study(0, i), false);
  assert.equal(i.count("knowledge"), notes);
  const sites = relaySites(s.info);
  assert.match(s.activateRelay(0, { x: 0, z: 0 }), /4m/);
  s.activateRelay(0, sites[0]);
  const xp = s.xp;
  s.activateRelay(0, sites[0]);
  assert.equal(s.xp, xp);
  const r = Frontier.load(s.save());
  assert.equal(r.region.relays.length, 1);
  assert.equal(r.region.contracts.length, 3);
  assert.deepEqual(r.region.studies, [0]);
  for (const site of sites.slice(1)) r.activateRelay(site.index, site);
  const full = stocked({ stone: 36 * 64 });
  assert.match(r.claimRuin(r.info.dungeon, full), /가방/);
  assert.equal(r.region.cacheClaimed, false);
  assert.match(r.claimRuin(r.info.dungeon, i), /유적 핵 1/);
  const after = i.save();
  r.claimRuin(r.info.dungeon, i);
  assert.deepEqual(i.save(), after);
  assert.equal(i.count("relic"), 1);
});
test("legacy ruin progress migrates and malformed new content is rejected", () => {
  const s = new Frontier(42),
    old = s.save();
  old.regions["0,0"].dungeon = 2.5;
  for (const key of ["relays", "contracts", "studies", "resources"])
    delete old.regions["0,0"][key];
  const r = Frontier.load(old);
  assert.deepEqual(r.region.relays, [0, 1]);
  assert.equal(r.region.dungeon, 2.5);
  const last = relaySites(r.info)[2];
  r.activateRelay(2, last);
  assert.equal(r.region.dungeon, 3);
  const bad = r.save();
  bad.regions["0,0"].relays = [0, 0];
  assert.throws(() => Frontier.load(bad));
});
test("new gathering materials close crafting loop and relic tool uses real durability", () => {
  const i = stocked({
    berry: 3,
    fiber: 1,
    herb: 2,
    resin: 1,
    scrap: 3,
    wood: 1,
    relic: 1,
    iron: 8,
    crystal: 6,
  });
  for (const id of [
    "berry_meal",
    "herbal_medicine",
    "salvage_iron",
    "relicpick",
  ])
    assert.equal(i.craft(id), true, id);
  assert.equal(i.count("food"), 3);
  assert.equal(i.count("medicine"), 2);
  assert.equal(i.count("iron"), 3);
  assert.equal(i.wear.relicpick, 520);
  const r = new Inventory(false);
  r.load(i.save());
  assert.equal(r.count("relicpick"), 1);
  assert.equal(r.count("scrap"), 0);
});
test("animal healing consumes once only when injured and never restores lost limbs", () => {
  const eco = new Ecology(new World(1)),
    e = eco.spawn(0, 12, 12),
    i = stocked({ medicine: 2 });
  assert.match(eco.heal(e, i), /건강/);
  assert.equal(i.count("medicine"), 2);
  eco.detach(e, 2, 0);
  eco.hurt(e, 20);
  const lost = e.lost;
  eco.heal(e, i);
  assert.equal(e.hp, e.maxHP);
  assert.equal(e.lost, lost);
  assert.equal(i.count("medicine"), 1);
  eco.kill(e);
  eco.heal(e, i);
  assert.equal(i.count("medicine"), 1);
});
