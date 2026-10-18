// The first signal's regions as islands of one world (S2): the unified runtime's frontier generator
// builds each region with the frontier's own region terrain, REGION_STRIDE apart across the sea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { FrontierAtlas, REGION_STRIDE, regionAt, LEGACY_BLOCKS, GENERATORS } from '../app/src/main/assets/content-runtime/maps.js';
import { frontierWorld, regionInfo } from '../app/src/main/assets/frontier/terrain.js';

const SEED = 63026;
const legacy = (rx, rz, terrainVersion = 3) => { const info = regionInfo(SEED, rx, rz); return frontierWorld(info.seed, { ...info, terrainVersion }); };
function sameCells(atlas, world, rx, rz, step = [7, 3, 11]) {
  let checked = 0;
  for (let hx = 0; hx < 320; hx += step[0]) for (let hz = 0; hz < 320; hz += step[2]) for (let hy = 0; hy < 64; hy += step[1]) {
    const value = world.getCell(hx, hy, hz), x = hx + rx * REGION_STRIDE * 2, z = hz + rz * REGION_STRIDE * 2;
    assert.equal(atlas.getCell(x, hy, z), value ? LEGACY_BLOCKS[value] : null, `region ${rx},${rz} cell ${hx},${hy},${hz}`);
    checked++;
  }
  return checked;
}

test('every region is the frontier region terrain at its own island, with sea between', () => {
  const atlas = new FrontierAtlas(CONTENT, { seed: SEED });
  for (const [rx, rz] of [[0, 0], [1, 0], [-1, 2]]) assert(sameCells(atlas, legacy(rx, rz), rx, rz) > 20000);
  assert.equal(regionAt(200, 50), null, 'the strait between regions is open sea');
  assert.deepEqual([atlas.getCell(400, 4, 100), atlas.getCell(400, 6, 100), atlas.getCell(400, 12, 100)], ['stone', 'sand', null]);
  assert.equal(atlas.sample(77.5, 84.5).tier, 1);
  assert.equal(atlas.sample(2 * REGION_STRIDE + 77, 2 * REGION_STRIDE + 84).tier, regionInfo(SEED, 2, 2).tier);
});

test('regions made by an older frontier keep their terrain version through save and load', () => {
  const atlas = new FrontierAtlas(CONTENT, { seed: SEED, state: null });
  atlas.regionTerrain.set('1,0', 1);
  const restored = FrontierAtlas.fromState(CONTENT, JSON.parse(JSON.stringify(atlas.serialize())));
  assert.deepEqual([...restored.regionTerrain], [['1,0', 1]]);
  sameCells(restored, legacy(1, 0, 1), 1, 0, [13, 5, 17]);
  assert.equal(legacy(1, 0, 1).workyard, undefined, 'version 1 regions have no workyard');
  assert(restored.regionLandmarks(REGION_STRIDE + 77, 84).every(l => l.name !== '해체·운반 작업장'));
});

test('region places and starter piles follow each region island', () => {
  const atlas = new FrontierAtlas(CONTENT, { seed: SEED });
  const places = atlas.regionLandmarks(REGION_STRIDE + 77, 84);
  const camp = places.find(l => l.name === '원정 야영지');
  assert.deepEqual([camp.x, camp.z], [REGION_STRIDE + 77, 84]);
  assert(places.some(l => l.name === '동력 유적') && places.some(l => l.name === '수호자 둥지') && places.some(l => l.name === '해체·운반 작업장'));
  const nodes = atlas.harvestNodesAround(REGION_STRIDE + 77.5, 84.5, 48);
  assert(nodes.some(n => n.id.startsWith('starter:1,0:')), 'starter piles at the region camp');
  assert(nodes.every(n => regionAt(n.x, n.z)), 'no harvest nodes on open sea');
  assert.deepEqual(atlas.regionLandmarks(200, 50), [], 'the sea has no places');
});

test('a frontier world starts at the expedition camp on the unified runtime and reopens its terrain', async () => {
  const config = { configVersion: 1, preset: 'frontier', seed: SEED, terrain: { generator: 'frontier' }, rules: { survival: true } };
  const runtime = await ExpeditionRuntime.create(SEED, null, { config });
  assert.equal(runtime.generator, GENERATORS.frontier);
  assert.equal(runtime.atlas.generatorId, 'frontier-v1');
  assert.deepEqual([runtime.player.x, runtime.player.z], [77.5, 84.5]);
  assert.equal(runtime.nearbyStructures.length, 0, 'no expedition structures on frontier regions');
  assert(runtime.creatures.entities.length > 0 && runtime.creatures.entities.every(e => regionAt(e.x, e.z)), 'life stays on the region islands');
  runtime.atlas.setCell(160, 30, 170, 'stone');
  const state = JSON.parse(JSON.stringify(runtime.serialize()));
  assert.equal(state.terrain, 'frontier');
  const reopened = new ExpeditionRuntime(SEED, state, new Map(), { config });
  assert.equal(reopened.atlas.getCell(160, 30, 170), 'stone');
});

test('death follows the world setting: keep belongings or leave them for the fairy, waking at the region camp', async () => {
  const config = (dropOnDeath) => ({ configVersion: 1, preset: 'frontier', seed: SEED, terrain: { generator: 'frontier' }, rules: { survival: true, dropOnDeath } });
  const fall = (runtime, x, z) => { Object.assign(runtime.player, { x, y: runtime.atlas.heightAt(x, z) + .05, z, hp: 0 }); runtime.die(); };
  const keep = await ExpeditionRuntime.create(SEED, null, { config: config(false) });
  keep.progression.grant({ loose_stone: 5, raw_timber: 3 }, { claimId: 'test:keep' });
  fall(keep, REGION_STRIDE + 100, 100);
  assert.deepEqual([keep.progression.count('loose_stone'), keep.progression.count('raw_timber'), keep.deaths.length], [5, 3, 0], 'belongings stay with the player');
  assert.deepEqual([keep.player.x, keep.player.z, keep.player.hp], [REGION_STRIDE + 77.5, 84.5, 100], 'wakes at the camp of the region it fell in');
  assert.match(keep.messages.at(-1), /지역 야영지에서 깨어났습니다\. 소지품은 그대로입니다/);
  fall(keep, 200, 50);
  assert.deepEqual([keep.player.x, keep.player.z], [77.5, 84.5], 'a fall at sea wakes at the nearest region camp');

  const drop = await ExpeditionRuntime.create(SEED, null, { config: config(true) });
  drop.progression.grant({ loose_stone: 5 }, { claimId: 'test:drop' });
  fall(drop, REGION_STRIDE + 100, 100);
  assert.deepEqual([drop.progression.count('loose_stone'), drop.deaths.length, drop.deaths[0].items.loose_stone], [0, 1, 5], 'belongings stay where the player fell');
  assert.deepEqual([drop.player.x, drop.player.z], [REGION_STRIDE + 77.5, 84.5]);
  Object.assign(drop.player, { x: REGION_STRIDE + 98, z: 100 });
  drop.tick(1 / 60);
  assert.deepEqual([drop.deaths[0].recovered, drop.progression.count('loose_stone')], [true, 5], 'the fairy brings them back within 10 m');

  const plain = new ExpeditionRuntime(SEED, null, new Map());
  plain.progression.grant({ loose_stone: 2 }, { claimId: 'test:plain' });
  fall(plain, 30, 30);
  assert.deepEqual([plain.progression.count('loose_stone'), plain.deaths.length, plain.player.x, plain.player.z], [0, 1, 0, 0], 'without a config the world drops belongings and wakes at its spawn');
  assert.match(plain.messages.at(-1), /^출발지에서 깨어났습니다\. 사망 장소 10m 안에 가면/);
});
