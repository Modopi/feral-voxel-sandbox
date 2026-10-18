import test from "node:test";
import assert from "node:assert/strict";
import { Frontier, regionInfo } from "../app/src/main/assets/frontier/model.js";
import {
  CAMP,
  PROJECTS,
  SIGNAL_ROUTES,
  CROPS,
  SORTIES,
  channels,
  milestones,
  surveySites,
} from "../app/src/main/assets/frontier/campaign.js";
import {
  Inventory,
  RECIPES,
  ITEMS,
  resourceForBlock,
} from "../app/src/main/assets/inventory.js";
import { GEAR, miningWork } from "../app/src/main/assets/equipment.js";
import { B } from "../app/src/main/assets/world.js";
import { frontierWorld } from "../app/src/main/assets/frontier/terrain.js";
import {
  resourceSites,
  relaySites,
  CONTRACTS,
  prepareAttack,
  attackZones,
  attackHits,
} from "../app/src/main/assets/frontier/content.js";
import { auditAcquisition } from "../app/src/main/assets/acquisition.js";

test("all campaign costs and rewards use reachable items; nearby regions guarantee all channels", () => {
  const reachable = auditAcquisition(true).items;
  for (const def of [
    ...PROJECTS,
    ...Object.values(SIGNAL_ROUTES),
    ...Object.values(CROPS),
    ...Object.values(SORTIES),
  ])
    for (const id of [
      ...Object.keys(def.cost || {}),
      ...Object.keys(def.reward || {}),
    ])
      assert.ok(ITEMS[id] && reachable[id], id);
  for (const seed of [0, 1, 42, 63026, 2147483647])
    assert.deepEqual(
      [
        [0, 0],
        [1, 0],
        [0, -1],
      ].map(([x, z]) => regionInfo(seed, x, z).biome),
      [0, 1, 2],
    );
});

test("a fresh empty-bag campaign finishes all chapters, all three routes and all repeatable sorties using real sources", () => {
  let s = new Frontier(42);
  const inv = new Inventory(false),
    worlds = new Map();
  const metrics = { mined: 0, gathered: 0, crafted: 0, attacks: 0, regions: 0 };
  function world() {
    if (!worlds.has(s.key)) {
      worlds.set(s.key, frontierWorld(s.info.seed, s.info));
      metrics.regions++;
    }
    return worlds.get(s.key);
  }
  function advance(seconds, p = CAMP) {
    for (let t = 0; t < seconds; t += 0.25) {
      if (s.hunger < 65) {
        if (!inv.count("food")) inv.craft("food");
        if (inv.count("food")) s.consume("food", inv);
      }
      s.tick(Math.min(0.25, seconds - t), p, inv);
    }
  }
  const gatherKinds = {
    wood: "wood",
    fiber: "wood",
    seed: "wood",
    berry: "berry",
    herb: "herb",
    scrap: "scrap",
    crystal: "crystal",
  };
  const minerals = { dirt: B.DIRT, stone: B.STONE, crystal: B.ORE };
  function obtain(id, n, chain = []) {
    assert.ok(!chain.includes(id), `cycle ${chain} -> ${id}`);
    for (let tries = 0; inv.count(id) < n; tries++) {
      assert.ok(tries < 500, `cannot obtain ${id}`);
      const sites = resourceSites(s.info)
        .filter(
          (p) => p.kind === gatherKinds[id] && s.region.resources[p.id] !== -1,
        )
        .sort(
          (a, b) =>
            (s.region.resources[a.id] || 0) - (s.region.resources[b.id] || 0),
        );
      if (sites.length) {
        const p = sites[0];
        advance(Math.max(0, (s.region.resources[p.id] || 0) - s.time));
        assert.match(s.gather(p.id, p, inv), /채집/);
        metrics.gathered++;
      } else if (minerals[id]) {
        const w = world();
        let hit;
        for (
          let index = w.blocks.indexOf(minerals[id], 160 * 160 * 2);
          index >= 0 && !hit;
          index = w.blocks.indexOf(minerals[id], index + 1)
        ) {
          const [x, y, z] = w.decode(index);
          for (let c = 0; c < 8; c++) {
            const h = {
              hx: x * 2 + (c & 1),
              hy: y * 2 + ((c >> 1) & 1),
              hz: z * 2 + ((c >> 2) & 1),
            };
            if (w.getCell(h.hx, h.hy, h.hz) === minerals[id]) {
              hit = h;
              break;
            }
          }
        }
        assert.ok(hit, `${id} exists in generated terrain`);
        let result;
        do {
          result = w.strikeMining(
            hit,
            0.5,
            (b) => 0.2 / miningWork(b, 0.5, GEAR.pick),
          );
        } while (!result.removed);
        for (const [b, count] of result.counts)
          assert.equal(inv.add(resourceForBlock(b), count), count);
        metrics.mined += result.removed;
      } else {
        const r =
          RECIPES.find((r) => r.id === (id === "resin" ? "plant_resin" : id)) ||
          RECIPES.find((r) => r.give?.[id]);
        assert.ok(r, `producer ${id}`);
        craft(r.id, [...chain, id]);
      }
    }
  }
  function pay(cost, chain = []) {
    for (
      let pass = 0;
      !Object.entries(cost).every(([id, n]) => inv.count(id) >= n);
      pass++
    ) {
      assert.ok(pass < 12);
      for (const [id, n] of Object.entries(cost)) obtain(id, n, chain);
    }
  }
  function craft(id, chain = []) {
    const r = RECIPES.find((r) => r.id === id);
    if (r.requires && !inv.unlocks.has(r.requires)) craft(r.requires, chain);
    pay(r.cost, chain);
    assert.equal(inv.craft(id), true, id);
    metrics.crafted++;
  }
  function action(id, arg, p = CAMP) {
    return s.campaign(id, arg, p, inv);
  }
  function collect() {
    for (const m of milestones(s))
      if (m.done && !s.journey.claimed.includes(m.id))
        assert.match(action("claim", m.id), /보상 수령/);
  }
  function restore() {
    const before = s.save();
    s = Frontier.load(before);
    assert.deepEqual(s.save(), before);
    const copy = new Inventory(false);
    copy.load(inv.save());
    assert.deepEqual(copy.save(), inv.save());
  }
  function move(x, z) {
    obtain("food", 1);
    assert.equal(s.move(x, z, inv, CAMP), null);
    world();
    restore();
  }
  function fight() {
    const b = s.activeBoss;
    let steps = 0;
    // Spend actual weapon cooldown/ammo/durability; use the same zones to choose safe ground.
    while (!b.defeated) {
      assert.ok(steps++ < 2000, "fight resolves");
      const p = { x: b.x + 5, z: b.z, flying: false };
      if (b.warning > 0) {
        const candidates = [
          [0, 2],
          [0, -5],
          [-5, 0],
          [4, 4],
          [-4, -4],
          [9, 9],
        ];
        const safe = candidates
          .map(([x, z]) => ({ x: b.x + x, z: b.z + z, flying: false }))
          .find((p) => !attackHits(b, p));
        Object.assign(p, safe || { x: b.x + 12, z: b.z + 12 });
      }
      if (Math.hypot(p.x - b.x, p.z - b.z) <= 6.5 && s.attack(inv))
        metrics.attacks++;
      advance(0.25, p);
    }
  }
  world();
  for (const kind of ["wood", "berry", "herb"]) obtain(kind, 1);
  collect();
  pay(PROJECTS[0].cost);
  assert.match(action("build", "garden"), /완성/);
  obtain("seed", 1);
  assert.match(action("plant", [0, "berry"]), /파종/);
  advance(90);
  assert.match(action("harvest", 0), /수확/);
  collect();
  const v = s.region.villages[0],
    q = CONTRACTS[0];
  pay(q.cost);
  assert.match(s.deliver(v.id, q.id, v, inv), /완료/);
  collect();
  // The exploration route never calls the boss reward function.
  for (const relay of relaySites(s.info)) s.activateRelay(relay.index, relay);
  assert.match(s.claimRuin(s.info.dungeon, inv), /유적 회수/);
  pay(SIGNAL_ROUTES.explorer.cost);
  assert.match(action("signal", "explorer"), /복원/);
  collect();
  restore();
  move(1, 0);
  craft("pulse_emitter");
  fight();
  assert.ok(s.region.boss.defeated);
  pay(SIGNAL_ROUTES.guardian.cost);
  assert.match(action("signal", "guardian"), /복원/);
  move(-1, 0);
  move(0, -1);
  const village = s.region.villages[0];
  for (const quest of [CONTRACTS[0], CONTRACTS[2]]) {
    pay(quest.cost);
    assert.match(s.deliver(village.id, quest.id, village, inv), /완료/);
  }
  pay({ food: 3, plank: 4 });
  s.actVillage(village.id, "aid", inv, village);
  assert.match(s.actVillage(village.id, "ally", inv, village), /체결/);
  pay(SIGNAL_ROUTES.community.cost);
  assert.match(action("signal", "community"), /복원/);
  assert.equal(s.region.boss.defeated, false);
  assert.equal(s.region.cacheClaimed, false);
  collect();
  move(0, 1);
  assert.equal(channels(s).length, 3);
  for (const def of PROJECTS.slice(1)) {
    pay(def.cost);
    assert.match(action("build", def.id), /완성/);
  }
  pay({ iron: 8, knowledge: 6 });
  assert.match(action("ignite"), /완료/);
  collect();
  assert.equal(s.journey.claimed.length, 6);
  restore();
  for (const kind of ["survey", "supply", "hunt"]) {
    advance(Math.max(0, s.region.outpost.nextSortie - s.time));
    assert.match(action("startSortie", kind), /시작/);
    if (kind === "survey")
      for (const site of surveySites(s.info))
        action("survey", site.index, site);
    if (kind === "supply") {
      pay(SORTIES.supply.cost);
      assert.match(action("deliverSortie", null, s.region.villages[0]), /전달/);
    }
    if (kind === "hunt") fight();
    restore();
    assert.equal(s.region.outpost.sortie.done, true);
    assert.match(action("claimSortie"), /수령/);
    const bag = inv.save();
    assert.match(action("claimSortie"), /먼저/);
    assert.deepEqual(inv.save(), bag);
  }
  assert.equal(s.journey.sorties, 3);
  assert.equal(
    s.region.boss.defeated,
    false,
    "echo does not consume original guardian",
  );
  assert.ok(
    metrics.gathered > 0 &&
      metrics.mined > 0 &&
      metrics.crafted > 0 &&
      metrics.attacks > 0,
  );
  console.log("First Signal source-backed playthrough", {
    ...metrics,
    simulatedSeconds: Math.ceil(s.time),
    deaths: s.deaths,
    signals: channels(s),
    chapters: s.journey.claimed.length,
    sorties: s.journey.sorties,
  });
});

test("campaign commands enforce location, prerequisites, atomic inventory and one-time rewards", () => {
  const s = new Frontier(),
    inv = new Inventory(false),
    far = { x: 0, z: 0 };
  for (const def of PROJECTS)
    for (const [id, n] of Object.entries(def.cost)) inv.add(id, n);
  let before = JSON.stringify({ s: s.save(), i: inv.save() });
  s.campaign("build", "garden", far, inv);
  assert.equal(JSON.stringify({ s: s.save(), i: inv.save() }), before);
  s.campaign("build", "garden", CAMP, inv);
  before = inv.save();
  s.campaign("build", "garden", CAMP, inv);
  assert.deepEqual(inv.save(), before);
  assert.match(s.campaign("signal", "explorer", CAMP, inv), /조건/);
  assert.match(s.campaign("ignite", null, CAMP, inv), /세 종류/);
  inv.add("seed", 1);
  s.campaign("plant", [0, "herb"], CAMP, inv);
  assert.match(s.campaign("harvest", 0, CAMP, inv), /수확까지/);
  s.time = 120;
  for (let i = 0; i < 36; i++) inv.slots[i] = { id: "stone", count: 64 };
  assert.match(s.campaign("harvest", 0, CAMP, inv), /가방/);
  assert.ok(s.region.outpost.plots[0]);
  inv.slots.fill(null);
  assert.match(s.campaign("harvest", 0, CAMP, inv), /수확/);
  assert.equal(inv.count("seed"), 2);
  const old = inv.save();
  s.campaign("harvest", 0, CAMP, inv);
  assert.deepEqual(inv.save(), old);
  s.region.resources = { "wood:0": 300, "berry:0": 180, "herb:0": 240 };
  assert.match(s.campaign("claim", "gather", CAMP, inv), /수령/);
  const xp = s.xp;
  s.campaign("claim", "gather", CAMP, inv);
  assert.equal(s.xp, xp);
});

test("new campaign state migrates old saves and survives travel, death and malformed-save checks", () => {
  const s = new Frontier(),
    inv = new Inventory(false);
  inv.add("food", 5);
  inv.add("wood", 6);
  inv.add("dirt", 4);
  inv.add("seed", 2);
  s.campaign("build", "garden", CAMP, inv);
  s.campaign("plant", [0, "berry"], CAMP, inv);
  s.move(1, 0, inv, CAMP);
  for (let i = 0; i < 400; i++) s.tick(0.25, CAMP, inv);
  s.move(-1, 0, inv, CAMP);
  const loaded = Frontier.load(s.save());
  assert.match(loaded.campaign("harvest", 0, CAMP, inv), /수확/);
  loaded.hp = 0;
  assert.equal(loaded.tick(0.25, CAMP, inv), "respawn");
  assert.ok(loaded.region.outpost.projects.includes("garden"));
  const old = s.save();
  delete old.journey;
  for (const r of Object.values(old.regions)) {
    delete r.outpost;
    delete r.terrainVersion;
  }
  const migrated = Frontier.load(old);
  assert.deepEqual(migrated.journey.claimed, []);
  assert.equal(migrated.region.terrainVersion, 1);
  for (const mutate of [
    (d) => (d.journey.claimed = ["fake"]),
    (d) => (d.journey.fedUntil = -1),
    (d) =>
      (d.regions["0,0"].outpost.plots = [{ crop: "fake", ready: 2 }, null]),
    (d) =>
      (d.regions["0,0"].outpost.signal = { channel: 3, route: "explorer" }),
  ]) {
    const bad = s.save();
    mutate(bad);
    assert.throws(() => Frontier.load(bad));
  }
});

test("telegraphs and collisions share all five shapes including safe ring centres and charge flanks", () => {
  for (let biome = 0; biome < 3; biome++)
    for (let phase = 0; phase < 3; phase++) {
      const b = { x: 20, z: 20, phase };
      prepareAttack(b, biome, { x: 25, z: 20 });
      assert.ok(b.warning >= 1.15);
      assert.ok(attackZones(b).length);
      if (b.pattern === "ring") {
        assert.equal(attackHits(b, { x: 20, z: 20 }), false);
        assert.equal(attackHits(b, { x: 25, z: 20 }), true);
        assert.equal(attackHits(b, { x: 29, z: 20 }), false);
      }
      if (b.pattern === "charge") {
        assert.equal(attackHits(b, { x: 24, z: 20 }), true);
        assert.equal(attackHits(b, { x: 24, z: 24 }), false);
      }
      if (b.pattern === "cross") {
        assert.equal(attackHits(b, { x: 25, z: 24 }), true);
        assert.equal(attackHits(b, { x: 28, z: 23 }), false);
      }
      if (b.pattern === "burst") {
        assert.equal(attackHits(b, { x: 25, z: 20, flying: true }), true);
        assert.equal(attackHits(b, { x: 25, z: 25 }), false);
      }
      if (b.pattern === "stomp") {
        assert.equal(attackHits(b, { x: 25, z: 20 }), true);
        assert.equal(attackHits(b, { x: 25, z: 25 }), false);
      }
    }
});

test("food buffs expire without stacking and field workshop restores worn equipment at a real cost", () => {
  const s = new Frontier(),
    inv = new Inventory(false);
  inv.add("stew", 2);
  inv.add("tonic", 1);
  s.hp = 40;
  s.hunger = 30;
  s.consume("stew", inv);
  s.consume("stew", inv);
  assert.equal(s.journey.fedUntil, 180);
  const hp = s.hp;
  s.damagePlayer(10, inv);
  assert.equal(s.hp, hp - 9);
  s.consume("tonic", inv);
  s.hunger = 50;
  const damaged = s.hp;
  s.tick(0.25, CAMP, inv);
  assert.ok(s.hp > damaged);
  s.time = 181;
  const before = s.hp;
  s.damagePlayer(10, inv);
  assert.equal(s.hp, before - 10);
  inv.add("ironpick", 1);
  inv.wear.ironpick = 0;
  inv.add("iron", 1);
  inv.add("wood", 1);
  s.region.outpost.projects.push("workshop");
  assert.match(s.campaign("repair", null, CAMP, inv), /내구도/);
  assert.equal(inv.wear.ironpick, 60);
  assert.equal(inv.count("iron"), 0);
});
