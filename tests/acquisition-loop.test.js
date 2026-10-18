import test from "node:test";
import assert from "node:assert/strict";
import {
  auditAcquisition,
  acquisitionRules,
  sourceHints,
} from "../app/src/main/assets/acquisition.js";
import {
  Inventory,
  ITEMS,
  RECIPES,
  resourceForBlock,
} from "../app/src/main/assets/inventory.js";
import { GEAR, miningWork } from "../app/src/main/assets/equipment.js";
import { B, World } from "../app/src/main/assets/world.js";
import { Ecology, animalDrops } from "../app/src/main/assets/entities.js";
import { regionInfo } from "../app/src/main/assets/frontier/terrain.js";
import { resourceSites, GATHERABLES } from "../app/src/main/assets/frontier/content.js";
test("every item and prerequisite has a route without starter items in both game modes", () => {
  for (const frontier of [false, true]) {
    const report = auditAcquisition(frontier);
    assert.deepEqual(report.unreachableItems, []);
    assert.deepEqual(report.unreachableRecipes, []);
    for (const rule of acquisitionRules(frontier))
      for (const id of [...Object.keys(rule.cost), ...Object.keys(rule.give)])
        assert.ok(ITEMS[id], `${rule.id}: ${id}`);
    for (const id of Object.keys(report.items))
      assert.ok(sourceHints(id, frontier).length, id);
  }
});
test("every recipe executes from an empty bag using actual mining, regrowth, animals and prerequisite crafts", () => {
  const world = new World(42);
  world.generate();
  const metrics = { recipes: 0, minedCells: 0, gatherings: 0, hunts: 0 };
  for (const recipe of RECIPES) {
    const inv = new Inventory(false),
      eco = new Ecology(world);
    eco.onDeath = (e) => {
      for (const [id, n] of Object.entries(animalDrops(e.type)))
        assert.equal(inv.add(id, n), n);
    };
    const sites = resourceSites(regionInfo(42, 0, 0));
    const gatherFor = {
      wood: "wood",
      fiber: "wood",
      seed: "wood",
      berry: "berry",
      herb: "herb",
    };
    const blockFor = {
      dirt: B.DIRT,
      stone: B.STONE,
      sand: B.SAND,
      crystal: B.ORE,
    };
    const stack = [];
    function obtain(id, n) {
      if (inv.count(id) >= n) return;
      assert.ok(
        !stack.includes(id),
        "circular material dependency: " + [...stack, id].join(" -> "),
      );
      stack.push(id);
      let attempts = 0;
      while (inv.count(id) < n) {
        assert.ok(
          attempts++ < 2000,
          `${recipe.id}: cannot acquire ${id} x${n}`,
        );
        if (gatherFor[id]) {
          // A campaign gathering site gives its frontier reward (the first-signal module's gather rule).
          const site = sites.find((s) => s.kind === gatherFor[id]);
          for (const [item, count] of Object.entries(GATHERABLES[site.kind].reward)) assert.equal(inv.add(item, count), count);
          metrics.gatherings++;
        } else if (blockFor[id]) {
          const index = world.blocks.indexOf(blockFor[id], 160 * 160),
            [x, y, z] = world.decode(index);
          assert.ok(index >= 0, `world source exhausted: ${id}`);
          // Select a remaining half-cell in the physical block, including previously edited blocks.
          let h;
          for (let j = 0; j < 8; j++) {
            const cell = {
              hx: x * 2 + (j & 1),
              hy: y * 2 + ((j >> 1) & 1),
              hz: z * 2 + ((j >> 2) & 1),
            };
            if (world.getCell(cell.hx, cell.hy, cell.hz) === blockFor[id]) {
              h = cell;
              break;
            }
          }
          assert.ok(h);
          let result;
          do {
            result = world.strikeMining(
              h,
              0.5,
              (b) => 0.2 / miningWork(b, 0.5, GEAR.pick),
            );
          } while (!result.removed);
          for (const [b, count] of result.counts)
            assert.equal(inv.add(resourceForBlock(b), count), count);
          metrics.minedCells += result.removed;
        } else if (["meat", "bio", "essence"].includes(id)) {
          eco.migrate(eco.nextMigration, { x: 77, z: 84 });
          const prey = eco.entities.find((e) => !e.dead && e.type === 0);
          assert.ok(prey, "fertile world must support a returning herd");
          while (!prey.dead) eco.hurt(prey, 4, "사냥");
          metrics.hunts++;
        } else {
          const producer = [...RECIPES]
            .sort((a, b) => Number(b.id === id) - Number(a.id === id))
            .find((r) => r.give?.[id] || (r.id === id && GEAR[id]?.cost));
          assert.ok(producer, "missing producer " + id);
          craft(producer);
        }
      }
      stack.pop();
    }
    function craft(r) {
      if (r.requires && !inv.unlocks.has(r.requires)) {
        const pre = RECIPES.find((q) => q.unlock === r.requires);
        assert.ok(pre);
        craft(pre);
      }
      // Later ingredients can consume earlier ones (e.g. notes consume crystals).
      // Replenish until all required quantities coexist in the real bag.
      for (
        let pass = 0;
        pass < 10 &&
        !Object.entries(r.cost).every(([id, n]) => inv.count(id) >= n);
        pass++
      )
        for (const [id, n] of Object.entries(r.cost)) obtain(id, n);
      assert.equal(
        inv.craft(r.id),
        true,
        `${recipe.id}: ${r.id} must actually craft`,
      );
    }
    craft(recipe);
    metrics.recipes++;
    for (const [id, n] of Object.entries(recipe.give || {}))
      assert.ok(inv.count(id) >= n, recipe.id + ": " + id);
    if (GEAR[recipe.id]?.cost) assert.equal(inv.count(recipe.id), 1);
    if (recipe.unlock) assert.ok(inv.unlocks.has(recipe.unlock));
  }
  assert.equal(metrics.recipes, RECIPES.length);
  assert.ok(
    metrics.minedCells > 0 && metrics.hunts > 0 && metrics.gatherings > 0,
  );
  console.log("ZERO_STARTER_CRAFT_LOOP", JSON.stringify(metrics));
});
test("extinction recovery consumes fertile habitat, stays away from player and survives save", () => {
  const w = new World(1);
  w.generate();
  const eco = new Ecology(w),
    player = { x: 77, z: 84 };
  eco.migrate(89, player);
  assert.equal(eco.entities.length, 0);
  eco.migrate(90, player);
  for (const type of [0, 1, 2])
    assert.equal(eco.entities.filter((e) => e.type === type).length, 2);
  assert.ok(
    eco.entities.every((e) => Math.hypot(e.x - player.x, e.z - player.z) >= 16),
  );
  const restored = new Ecology(w);
  restored.load(eco.save());
  assert.equal(restored.nextMigration, 180);
  restored.migrate(91, player);
  assert.equal(restored.entities.length, 6);
  const barren = new World(2),
    empty = new Ecology(barren);
  empty.migrate(90, player);
  assert.equal(empty.entities.length, 0);
});
