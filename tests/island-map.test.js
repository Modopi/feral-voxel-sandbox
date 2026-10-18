// The basic island as a map preset of the one runtime: same terrain as the original generator,
// the same three species, peaceful rules, and conversion of original island saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { MAPS, LEGACY_BLOCKS, LEGACY_ITEMS, LEGACY_SPECIES, applyLegacyIsland, mapFor } from '../app/src/main/assets/content-runtime/maps.js';
import { World, B } from '../app/src/main/assets/world.js';
import { Inventory, ITEMS } from '../app/src/main/assets/inventory.js';
import { Ecology } from '../app/src/main/assets/entities.js';

const SEED = 63026;
const blocks = new Map(CONTENT.blocks.entries.map(b => [b.id, b]));
const items = new Map(CONTENT.progression.entries.map(e => [e.id, e]));

test('legacy blocks, items and species point at real design entries', () => {
  for (const [legacy, id] of Object.entries(LEGACY_BLOCKS)) {
    assert(blocks.has(id), `${legacy} → ${id}`);
    const design = blocks.get(id);
    if (design.legacyBlockId != null && Number(legacy) !== 9) assert.equal(design.legacyBlockId, Number(legacy), `${id} keeps the design's legacy number`);
  }
  for (const value of Object.values(B)) if (value) assert(LEGACY_BLOCKS[value], `block ${value} has a design block`);
  for (const [legacy, rule] of Object.entries(LEGACY_ITEMS)) {
    assert(ITEMS[legacy], `${legacy} is an original item`);
    assert(items.has(rule.item), `${legacy} → ${rule.item}`);
    assert(rule.ratio > 0);
  }
  const grove = CONTENT.environments.entries.find(e => e.id === 'grove').spawning.rules.map(r => r.speciesId);
  for (const id of Object.values(LEGACY_SPECIES)) assert(grove.includes(id), `${id} lives in the island's grove`);
  assert.equal(mapFor('island'), MAPS.island);
  assert.equal(mapFor('unknown'), MAPS.expedition);
});

test('the island map builds the original island terrain on the shared runtime', async () => {
  const runtime = await ExpeditionRuntime.create(SEED, null, { map: 'island' });
  const legacy = new World(SEED); legacy.generate();
  assert.equal(runtime.map.id, 'island');
  assert.equal(runtime.atlas.generatorId, 'island-v1');
  assert.equal(runtime.player.x, 77.5);
  assert.equal(runtime.atlas.heightAt(77.5, 84.5), legacy.surface(77.5, 84.5));
  let checked = 0;
  for (let hx = 0; hx < 320; hx += 7) for (let hz = 0; hz < 320; hz += 11) for (let hy = 0; hy < 60; hy += 3) {
    const value = legacy.getCell(hx, hy, hz);
    assert.equal(runtime.atlas.getCell(hx, hy, hz), value ? LEGACY_BLOCKS[value] : null, `${hx},${hy},${hz}`);
    checked++;
  }
  assert(checked > 20000);
  runtime.atlas.loadAround(77.5, 84.5, { radiusChunks: 0, verticalRadius: 0, y: 12, chunkBudget: 4, workBudgetMs: 1e9 });
  const [chunk] = runtime.atlas.activeChunks.values();
  for (let i = 0; i < chunk.blocks.length; i += 97) {
    const x = i % 32, z = Math.floor(i / 32) % 32, y = Math.floor(i / 1024), value = legacy.getCell(chunk.cx * 32 + x, chunk.cy * 32 + y, chunk.cz * 32 + z);
    assert.equal(chunk.palette[chunk.blocks[i]] ?? null, value ? LEGACY_BLOCKS[value] : null, 'chunk meshes use the same cells');
  }
  assert.equal(runtime.atlas.heightAt(-20, -20), 4, 'sea floor around the island');
  assert(runtime.atlas.fluidAt(-20, 6, -20)?.volumeM3 > 0 || runtime.atlas.fluidAt(-20, 6, -20) > 0, 'the sea is water');
  assert.equal(runtime.nearbyStructures.length, 0, 'no expedition starter structures on the island');
  const species = new Set(runtime.creatures.entities.map(e => e.speciesId));
  for (const id of Object.values(LEGACY_SPECIES)) assert(species.has(id), `${id} spawns on the island`);
  assert(runtime.creatures.entities.every(e => e.x >= 0 && e.z >= 0 && e.x < 160 && e.z < 160), 'creatures stay on the island');
  assert(runtime.nodes.every(n => n.x >= 0 && n.z >= 0 && n.x < 160 && n.z < 160), 'harvest nodes are on the island');
  assert(runtime.nodes.some(n => n.id.startsWith('starter:') && Math.hypot(n.x - 77.5, n.z - 84.5) < 26), 'starter branches near the landing');
  assert.deepEqual(runtime.progression.inventory, MAPS.island.starter);
});

test('island rules are peaceful and survive save and load', async () => {
  const runtime = await ExpeditionRuntime.create(SEED, null, { map: 'island' });
  runtime.hurt(500, 'test');
  for (let i = 0; i < 40; i++) runtime.tick(.1, { moving: true });
  assert.equal(runtime.player.hp, runtime.player.maxHp);
  assert.equal(runtime.player.calories, runtime.player.maxCalories);
  runtime.discoveredLandmarks.add('초록 능선');
  const state = JSON.parse(JSON.stringify(runtime.serialize()));
  assert.equal(state.map, 'island');
  const restored = new ExpeditionRuntime(SEED, state, new Map());
  assert.equal(restored.map.id, 'island');
  assert.deepEqual([...restored.discoveredLandmarks], ['초록 능선']);
  const expedition = await ExpeditionRuntime.create(SEED, null);
  expedition.hurt(10, 'test');
  assert.equal(expedition.player.hp, 90, 'the expedition keeps survival rules');
});

test('an original island save converts without touching the original', async () => {
  const world = new World(SEED); world.generate();
  world.set(77, 13, 84, B.STONE);
  world.set(78, 12, 84, 0);
  world.setCell(150, 30, 160, B.PLANK);
  world.pour(80, 12, 80, 2, 0);
  world.miningDamage.set(world.damageKey(154, 26, 168), [B.STONE, .5]);
  const inventory = new Inventory();
  inventory.add('berry', 3); inventory.add('crystal', 2); inventory.add('arrow', 5);
  const eco = new Ecology(world); eco.populate(12);
  const old = { version: 2, inventory: inventory.save(), world: world.save(), eco: eco.save(), player: { x: 90.5, y: 14, z: 70.5, yaw: 1, pitch: -0.2, flying: true }, playTime: 321, discovered: ['초록 능선', '굽이치는 강'] };
  const original = JSON.stringify(old);
  const runtime = await ExpeditionRuntime.create(SEED, null, { map: 'island', starter: false });
  assert.deepEqual(runtime.progression.inventory, {}, 'a converted save brings its own items instead of the new-world kit');
  const report = applyLegacyIsland(runtime, old);
  assert.equal(JSON.stringify(old), original, 'the original save object is unchanged');
  for (const [hx, hy, hz] of [[154, 26, 168], [155, 27, 169], [156, 24, 168], [157, 25, 169], [150, 30, 160]]) {
    const value = world.getCell(hx, hy, hz);
    assert.equal(runtime.atlas.getCell(hx, hy, hz), value ? LEGACY_BLOCKS[value] : null, `${hx},${hy},${hz}`);
  }
  assert(runtime.conversionCells >= 9, `${runtime.conversionCells} edited cells copied`);
  assert.deepEqual(runtime.terrainDamage['154,26,168'], { blockId: 'stone', damage: .5 }, 'a half-mined cell keeps its wound');
  assert.equal(runtime.progression.count('berry'), 3);
  assert.equal(runtime.progression.count('iron_ore'), 2);
  assert.equal(runtime.progression.count('loose_stone'), 4, 'original stone pieces carry over');
  assert.equal(runtime.progression.count('stone_pick'), 1, "the original starting pick becomes the island's stone pick");
  assert(report.unmapped.some(u => u.detail.startsWith('arrow 5')), 'unmapped items are listed');
  assert(report.unmapped.some(u => u.detail.startsWith('pulse 1')), 'the starting pulse weapon is listed');
  assert(report.unmapped.some(u => u.name === '부은 물·산'));
  assert(report.unmapped.some(u => u.name === '동물 개체'));
  assert.deepEqual({ x: runtime.player.x, z: runtime.player.z, yaw: runtime.player.yaw }, { x: 90.5, z: 70.5, yaw: 1 });
  assert.deepEqual([...runtime.discoveredLandmarks], ['초록 능선', '굽이치는 강']);
  const state = JSON.parse(JSON.stringify(runtime.serialize()));
  assert.equal(state.conversion.from, 'feral.world.v1');
  assert.equal(state.conversion.playTimeS, 321);
  const restored = new ExpeditionRuntime(SEED, state, new Map());
  assert.equal(restored.atlas.getCell(150, 30, 160), 'plank', 'converted terrain is saved');
  assert.equal(restored.conversion.unmapped.length, report.unmapped.length);
});

test('sandbox maps build with mined resources, one unit per 0.5 m cell; the expedition does not', async () => {
  const runtime = await ExpeditionRuntime.create(SEED, null, { map: 'island' });
  const p = runtime.player, ground = runtime.atlas.heightAt(p.x + 3, p.z);
  const hit = { kind: 'terrain', distance: 3, point: { x: p.x + 3.1, y: ground, z: p.z + .1 }, normal: { x: 0, y: 1, z: 0 } };
  const cell = [Math.floor((p.x + 3.1) * 2), Math.floor(ground * 2), Math.floor((p.z + .1) * 2)];
  assert.equal(runtime.atlas.getCell(...cell), null);
  const stone = runtime.progression.count('loose_stone');
  const placed = runtime.placeBlocks(hit, 'loose_stone', .5);
  assert.equal(placed.ok, true, JSON.stringify(placed));
  assert.equal(runtime.atlas.getCell(...cell), 'stone');
  assert.equal(runtime.progression.count('loose_stone'), stone - 1);
  assert.equal(runtime.placeBlocks(hit, 'loose_stone', .5).ok, false, 'the same cell is occupied');
  const wide = { ...hit, point: { x: p.x + 6.1, y: ground, z: p.z + .1 } };
  assert.match(runtime.placeBlocks(wide, 'loose_stone', 1).reason, /8개/, '1 m needs eight units');
  runtime.progression.grant({ loose_stone: 8 }, { claimId: 'test:stone' });
  assert.equal(runtime.placeBlocks(wide, 'loose_stone', 1).cells, 8);
  const self = { ...hit, point: { x: p.x, y: runtime.atlas.heightAt(p.x, p.z), z: p.z } };
  assert.match(runtime.placeBlocks(self, 'raw_timber', .5).reason, /캐릭터/);
  assert.equal(runtime.buildableBlock('berry'), null);
  const expedition = await ExpeditionRuntime.create(SEED, null);
  assert.equal(expedition.buildableBlock('loose_stone'), null, 'the expedition builds with machine voxels instead');
});

test('a block placed into water pushes the water up instead of deleting it', async () => {
  const runtime = await ExpeditionRuntime.create(SEED, null, { map: 'island' });
  const p = runtime.player, x = p.x + 3.25, z = p.z + .25, ground = runtime.atlas.heightAt(x, z);
  runtime.atlas.pour(x, ground + .25, z, .1);
  const before = runtime.atlas.fluidTotals().volumeM3;
  const hit = { kind: 'terrain', distance: 3, point: { x, y: ground, z }, normal: { x: 0, y: 1, z: 0 } };
  const placed = runtime.placeBlocks(hit, 'loose_stone', .5);
  assert.equal(placed.ok, true, JSON.stringify(placed));
  assert(placed.displacedM3 > 0, 'some water was in the cell');
  assert.equal(placed.lostM3, 0);
  assert(Math.abs(runtime.atlas.fluidTotals().volumeM3 - before) < 1e-9, 'water volume is conserved');
});
