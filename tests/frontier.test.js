import test from "node:test";
import assert from "node:assert/strict";
import { Frontier, regionInfo } from "../app/src/main/assets/frontier/model.js";
import { Inventory, RECIPES } from "../app/src/main/assets/inventory.js";
import { frontierWorld } from "../app/src/main/assets/frontier/terrain.js";
import {
  evaluate,
  damage,
  TYPES,
} from "../app/src/main/assets/machine/model.js";
const camp = { x: 77.5, z: 84.5 };
const invWith = (items) => {
  const i = new Inventory(false);
  for (const [id, n] of Object.entries(items)) i.add(id, n);
  return i;
};
const tick = (s, i, seconds, p = camp) => {
  for (let n = 0; n < seconds * 4; n++) s.tick(0.25, p, i);
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
  assert.equal(restored.landmarks.length, 5);
});
test("trade and aid are atomic, finite, local, and lead to an alliance without a boss", () => {
  const s = new Frontier(),
    i = invWith({ wood: 8, food: 6, plank: 8 });
  const v = s.region.villages[0];
  const initial = i.save();
  assert.match(s.actVillage(v.id, "trade", i, camp), /접근/);
  assert.deepEqual(i.save(), initial);
  assert.match(s.actVillage(v.id, "trade", i, v), /결정 2/);
  assert.equal(v.crystal, 8);
  s.actVillage(v.id, "aid", i, v);
  s.actVillage(v.id, "aid", i, v);
  assert.equal(v.tech, 2);
  assert.equal(i.count("knowledge"), 4);
  s.actVillage(v.id, "ally", i, v);
  assert.deepEqual(s.allies, [v.faction]);
  const before = JSON.stringify({ v, i: i.save() });
  s.actVillage(v.id, "aid", i, v);
  assert.equal(JSON.stringify({ v, i: i.save() }), before);
  v.crystal = 0;
  const wood = i.count("wood");
  s.actVillage(v.id, "trade", i, v);
  assert.equal(i.count("wood"), wood);
});
test("distant settlements produce and consume, diplomacy conflicts drain stocks", () => {
  const s = new Frontier(),
    i = invWith({ food: 10 });
  const old = s.region;
  const wood = old.villages[0].wood;
  assert.equal(s.move(1, 0, i, camp), null);
  tick(s, i, 31);
  assert.ok(old.villages[0].wood > wood);
  assert.equal(s.regions["0,0"], old);
  s.diplomacy = [-30, -30, -30];
  const food = old.villages[0].food;
  s.socialStep();
  assert.ok(old.villages[0].food < food + 2);
});
test("raiding breaks alliances and triggers guards; peace restores trade", () => {
  const s = new Frontier(),
    i = invWith({ food: 20, iron: 5 });
  const v = s.region.villages[0];
  s.allies = [v.faction];
  s.actVillage(v.id, "raid", i, v);
  assert.equal(s.allies.length, 0);
  assert.ok(s.reputation[v.faction] <= -20);
  assert.match(s.actVillage(v.id, "trade", i, v), /적대/);
  const hp = s.hp;
  tick(s, i, 3, v);
  assert.ok(s.hp < hp);
  s.actVillage(v.id, "peace", i, v);
  assert.equal(s.reputation[v.faction], 0);
});
test("boss telegraphs can be dodged, damages the player on impact and rewards only once", () => {
  const s = new Frontier(),
    i = invWith({});
  const b = s.region.boss,
    p = { x: b.x + 3, z: b.z, flying: false };
  tick(s, i, 2.25, p);
  assert.ok(b.warning > 0);
  const hp = s.hp;
  p.x += 10;
  tick(s, i, 1.25, p);
  assert.equal(s.hp, hp);
  b.cooldown = 0;
  s.tick(0.1, p, i);
  tick(s, i, 1.25, p);
  assert.ok(s.hp < hp);
  s.hitBoss(999, i);
  const reward = i.count("knowledge");
  assert.ok(b.defeated);
  assert.ok(reward > 0);
  s.hitBoss(999, i);
  assert.equal(i.count("knowledge"), reward);
  assert.equal(s.xp, 60 + 8);
});
test("dungeon progresses under hazard, claims once, and cannot be claimed remotely", () => {
  const s = new Frontier(),
    i = invWith({});
  const d = s.info.dungeon;
  assert.match(s.claimRuin(camp, i), /접근/);
  assert.match(s.claimRuin(d, i), /해제/);
  tick(s, i, 19, d);
  assert.equal(s.region.dungeon, 3);
  assert.ok(s.hp < 100);
  assert.match(s.claimRuin(d, i), /연구 6/);
  const count = i.count("iron");
  s.claimRuin(d, i);
  assert.equal(i.count("iron"), count);
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
test("machine editing uses shared resources, connected damaged components change output, no duplication", () => {
  const s = new Frontier(),
    i = invWith({ iron: 40 });
  i.unlocks = new Set(["rover", "aviation", "ballistics"]);
  s.provisionMachine(i);
  const machine = s.machine;
  assert.ok(evaluate(machine).power > 0);
  assert.equal(machine.stock, 0);
  const before = i.count("iron");
  s.editMachine(i, "add", 0, 2, 0, "rotor");
  assert.equal(i.count("iron"), before - 10);
  assert.equal(evaluate(machine).lift, 1);
  const rotor = machine.blueprint.find((p) => p.type === "rotor");
  damage(machine, rotor.id, 25);
  assert.equal(evaluate(machine).lift, 0.5);
  s.editMachine(i, "repair", 0, 2, 0, "rotor");
  assert.equal(evaluate(machine).lift, 1);
  assert.equal(i.count("iron"), before - 15);
  s.editMachine(i, "remove", 0, 2, 0, "rotor");
  assert.equal(i.count("iron"), before - 5);
  const bp = machine.blueprint.length;
  s.provisionMachine(i);
  assert.equal(s.machine.blueprint.length, bp);
  for (const part of machine.blueprint)
    if (part.type === "motor") damage(machine, part.id, 1000);
  assert.match(s.toggleRide(i), /모터/);
});
test("travel validates adjacency, location, food and returns to persistent region state", () => {
  const s = new Frontier(),
    i = invWith({ food: 2 });
  s.region.boss.defeated = true;
  assert.match(s.move(1, 1, i, camp), /인접/);
  assert.equal(i.count("food"), 2);
  assert.match(s.move(1, 0, i, { x: 50, z: 50 }), /야영지/);
  assert.equal(s.move(1, 0, i, camp), null);
  assert.equal(s.move(-1, 0, i, camp), null);
  assert.ok(s.region.boss.defeated);
  assert.match(s.move(1, 0, i, camp), /식량/);
});
test("save roundtrip preserves social, boss, machine and health; rejects malformed states", () => {
  const s = new Frontier(),
    i = invWith({});
  i.unlocks.add("rover");
  s.provisionMachine(i);
  s.hp = 47;
  s.region.boss.hp = 22;
  const restored = Frontier.load(s.save());
  assert.deepEqual(restored.save(), s.save());
  for (const mutate of [
    (v) => (v.hp = NaN),
    (v) => (v.regions["0,0"].boss.hp = -1),
    (v) => (v.regions["0,0"].villages[0].food = -3),
    (v) => (v.machine.hp.p1 = -1),
  ]) {
    const bad = s.save();
    mutate(bad);
    assert.throws(() => Frontier.load(bad));
  }
});
test("starvation and defeat recover at camp without deleting inventory or blueprint", () => {
  const s = new Frontier(),
    i = invWith({ wood: 3 });
  s.hunger = 0;
  s.hp = 0.01;
  s.xp = 35;
  assert.equal(s.tick(0.25, camp, i), "respawn");
  assert.equal(s.deaths, 1);
  assert.equal(i.count("wood"), 3);
  assert.equal(s.xp, 20);
  assert.equal(s.hp, s.maxHP);
});

test("vehicle controls use power and mass, collision damages parts only while moving", async () => {
  const { FrontierMotion } = await import(
    "../app/src/main/assets/frontier/motion.js"
  );
  const s = new Frontier(),
    inv = invWith({});
  inv.unlocks.add("rover");
  s.provisionMachine(inv);
  s.toggleRide(inv);
  const player = { ...camp, y: 12, flying: false };
  const world = { surface: () => 20, get: () => 0 };
  const motion = new FrontierMotion({
    model: s,
    inventory: inv,
    player,
    world,
  });
  let input = motion.beforeStep({ forward: 1, side: 0 }, 1 / 60);
  assert.ok(input.speedScale > 1);
  const originalHP = { ...s.machine.hp };
  player.x += 1;
  motion.afterStep(1 / 60);
  assert.equal(player.x, camp.x);
  assert.ok(
    Object.keys(originalHP).some((k) => s.machine.hp[k] < originalHP[k]),
  );
  const after = JSON.stringify(s.machine.hp);
  s.time += 2;
  motion.beforeStep({ forward: 0, side: 0 }, 1 / 60);
  motion.afterStep(1 / 60);
  assert.equal(JSON.stringify(s.machine.hp), after);
  const motor = s.machine.blueprint.find((p) => p.type === "motor");
  damage(s.machine, motor.id, 70);
  input = motion.beforeStep({ forward: 1 }, 1 / 60);
  assert.ok(input.speedScale < 1);
});
