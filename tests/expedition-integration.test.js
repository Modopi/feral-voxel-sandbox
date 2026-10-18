import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { loadAsset } from '../app/src/main/assets/content-runtime/assets.generated.js';
import { WorldAtlas } from '../app/src/main/assets/content-runtime/atlas.js';
import { CreatureSystem } from '../app/src/main/assets/content-runtime/creatures.js';
import { DungeonSystem } from '../app/src/main/assets/content-runtime/dungeons.js';
import { BossSystem } from '../app/src/main/assets/content-runtime/bosses.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { ExpeditionScene, T } from '../app/src/main/assets/content-runtime/scene.js';
import { buildResourceAsset } from '../app/src/main/assets/content-runtime/props.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { ExpeditionSave } from '../app/src/main/assets/content-runtime/save.js';
import {equipmentExposureProfile,resolveSurfaceDamage} from '../app/src/main/assets/content-runtime/material-effects.js';

const SEED = 31415;
const definition = id => CONTENT.progression.entries.find(entry => entry.id === id);
const point = p => ({ x: p[0], y: p[1], z: p[2] });
const clone = value => JSON.parse(JSON.stringify(value));
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}
function systems(saved = null) {
  const atlas = new WorldAtlas(CONTENT, { seed: SEED, state: saved?.atlas });
  return { atlas, creatures: new CreatureSystem(CONTENT, { seed: SEED, state: saved?.creatures, terrain: atlas }),
    dungeons: new DungeonSystem({ catalog: CONTENT, seed: SEED, state: saved?.dungeons, atlas }),
    bosses: new BossSystem(CONTENT, saved?.bosses), progression: new Progression(CONTENT, saved?.progression) };
}
function snapshot(s) {
  return { player: { x: 0, y: s.atlas.heightAt(0, 0), z: 0, hp: 100 },
    ...Object.fromEntries(Object.entries(s).map(([name, system]) => [name, system.serialize()])) };
}
function harvest(s, node) {
  const source = definition(node.sourceId);
  return s.progression.harvest(node.sourceId, { environmentId: s.atlas.sample(node.x, node.z).environmentId,
    nodeId: node.id, nodeType: node.nodeId, elapsed: source.seconds, claimId: `integration:harvest:${node.id}` });
}

// These are model integration tests, not a replacement for input/renderer playthroughs.
test('actual atlas harvest nodes are compatible with progression source ownership', () => {
  for (const seed of [1, SEED, 63026]) {
    const atlas = new WorldAtlas(CONTENT, { seed });
    for (const node of atlas.harvestNodesAround(0, 0, 256)) {
      const env = CONTENT.environments.entries.find(e => e.id === atlas.sample(node.x, node.z).environmentId);
      assert(env.harvestNodeIds.includes(node.nodeId), `seed ${seed}: ${node.id} is not harvestable in ${env.id}`);
      assert.equal(definition(node.sourceId)?.kind, 'source');
    }
  }
});

test('zero inventory reaches a researched crafted kit using actual atlas nodes and consumed materials', () => {
  const s = systems(), p = s.progression;
  assert.deepEqual(p.inventory, {});
  const nodes = s.atlas.harvestNodesAround(0, 0, 256).filter(n => ['source_raw_timber', 'source_loose_stone', 'source_plant_fiber'].includes(n.sourceId));
  let first;
  for (const node of nodes) {
    if (Object.keys(definition(node.sourceId).outputs).every(id => p.count(id) >= 32)) continue;
    const receipt = harvest(s, node);
    assert.equal(receipt.ok, true, `${node.id}: ${receipt.reason}`);
    first ??= node;
  }
  const beforeRetry = clone(p.inventory);
  assert.equal(harvest(s, first).duplicate, true);
  assert.deepEqual(p.inventory, beforeRetry);
  for (const id of ['observation', 'joinery']) {
    assert.equal(p.startResearch(id).ok, true, id);
    assert.equal(p.tick(definition(id).work + 1).ok, true);
    assert(p.research.has(id));
  }
  const timber = p.count('raw_timber');
  assert.equal(p.buildStation('field_bench').ok, true);
  assert.equal(p.count('raw_timber'), timber - definition('build_field_bench').inputs.raw_timber);
  p.tick(definition('build_field_bench').seconds + 1);
  assert.equal(p.stations.field_bench, 1);
  assert.equal(p.startResearch('material:wood').ok, true);
  p.tick(definition('material:wood').work + 1);
  assert.equal(p.queueCraft('make_wood', { count: 8 }).ok, true);
  p.tick(definition('make_wood').seconds * 8 + 1);
  assert.equal(p.count('wood'), 8);
  assert.equal(p.queueCraft('make_gear_baseline_t1').ok, true);
  p.tick(definition('make_gear_baseline_t1').seconds + 1);
  assert.equal(p.count('wood'), 2);
  assert.equal(p.equip('gear_baseline_t1').ok, true);
  assert.equal(p.evaluateLoadout().tier, 1);
  assert.equal([...p.claims].filter(id => id.includes('reward')).length, 0);
});

test('all authored dungeons instantiate ecological rooms and their corresponding boss together', () => {
  const s = systems();
  for (const [index, template] of CONTENT.structures.entries.filter(d => d.bossArena).entries()) {
    const instance = s.dungeons.ensureInstance(template.id, `integration-${index}`, [index * 512, 4.5, 0], template.prototypeTier);
    const region = s.creatures.ensureDungeon(instance.id, { structureId: template.id,
      x: instance.origin[0], y: instance.origin[1], z: instance.origin[2], tier: instance.tier });
    assert(Number.isFinite(region.radius));
    const population = s.creatures.entities.filter(e => e.dungeonId === instance.id);
    assert(population.length > 0);
    assert(population.length <= template.ecology.populationMaxExcludingBoss);
    for (const room of template.rooms) assert(population.filter(e => e.roomId === room.id).length <= room.maxPopulation);
    const anchor = s.dungeons.anchors(instance.id).find(a => a.kind === 'boss');
    const boss = s.bosses.spawn(anchor.bossId, anchor.position, { id: anchor.bossInstanceId, instanceId: instance.id,
      arenaOrigin: instance.origin, tier: instance.tier });
    assert.equal(boss.id, instance.boss.instanceId);
    assert.equal(boss.bossId, template.bossArena.bossId);
    assert.deepEqual(point(anchor.position), boss.position);
    const count = s.creatures.entities.length;
    s.creatures.ensureDungeon(instance.id, { structureId: template.id, x: instance.origin[0], z: instance.origin[2] });
    assert.equal(s.creatures.entities.length, count);
  }
});

test('boss, dungeon and progression ledgers survive a full six-system saved reward claim', () => {
  let s = systems();
  const [instance] = s.dungeons.bootstrap();
  s.creatures.ensureDungeon(instance.id, { structureId: instance.templateId, x: instance.origin[0], y: instance.origin[1], z: instance.origin[2], tier: instance.tier });
  const anchor = s.dungeons.anchors(instance.id).find(a => a.kind === 'boss');
  const boss = s.bosses.spawn(anchor.bossId, anchor.position, { id: anchor.bossInstanceId, instanceId: instance.id, arenaOrigin: instance.origin, tier: instance.tier });
  assert.equal(s.dungeons.claimReward(instance.id, 'boss', s.progression).reason, 'boss_alive');
  s.bosses.hit(boss.id, { amount: 1e9, energyType: 'mechanical', partId: 'body' });
  assert.equal(boss.defeated, true);
  assert.equal(s.dungeons.defeatBoss(instance.id, boss.id).ok, true);
  assert.equal(s.bosses.claimReward(boss.id, () => s.dungeons.claimReward(instance.id, 'boss', s.progression).ok), true);
  s.atlas.setCell(-3, 11, 9, 'stone');
  const save = new ExpeditionSave(storage(), 'integration');
  const expected = snapshot(s);
  save.write(expected);
  const restored = save.load();
  s = systems(restored);
  for (const key of ['atlas', 'creatures', 'dungeons', 'bosses', 'progression']) assert.deepEqual(s[key].serialize(), expected[key], key);
  const balance = s.progression.serialize();
  assert.equal(s.bosses.claimReward(boss.id, () => { throw Error('duplicate claim reached economy'); }), false);
  assert.equal(s.dungeons.claimReward(instance.id, 'boss', s.progression).duplicate, true);
  assert.deepEqual(s.progression.serialize(), balance);
  assert.equal(s.atlas.getCell(-3, 11, 9), 'stone');
  const before = s.creatures.entities.length;
  s.creatures.ensureDungeon(instance.id, { structureId: instance.templateId, x: instance.origin[0], z: instance.origin[2] });
  assert.equal(s.creatures.entities.length, before);
});

test('runtime structure damage changes both rendered geometry and solid queries after restoration', async () => {
  const s = systems(), model = await loadAsset('root_manor');
  s.dungeons.setAssetModel(model.id, model);
  const [instance] = s.dungeons.bootstrap();
  const boxes = s.dungeons.renderBoxes(instance.id);
  const chosen = boxes.find(b => b.collision && b.size.every(n => n >= .5));
  assert(chosen);
  const target = chosen.center.map((v, i) => Math.floor(v * 2) / 2 + .25);
  assert(s.dungeons.solidAt(target));
  const damage = s.dungeons.damageAt(target, 1e6);
  assert.equal(damage.ok, true);
  assert.equal(s.dungeons.solidAt(target), null);
  const contains = b => b.collision && target.every((v, axis) => v > b.center[axis] - b.size[axis] / 2 && v < b.center[axis] + b.size[axis] / 2);
  assert(!s.dungeons.renderBoxes(instance.id).some(contains));
  const restored = new DungeonSystem({ catalog: CONTENT, seed: SEED, state: clone(s.dungeons.serialize()), atlas: s.atlas, assets: new Map([[model.id, model]]) });
  assert.equal(restored.solidAt(target), null);
  assert(!restored.renderBoxes(instance.id).some(contains));
});


test('actual runtime initializes outdoor creatures on terrain and rejects inedible item consumption', async () => {
  const runtime = await ExpeditionRuntime.create(SEED);
  const outdoor = runtime.creatures.entities.filter(e => !e.dungeonId && !e.communityId);
  assert(outdoor.length > 0);
  for (const entity of outdoor) {
    assert.equal(entity.y, runtime.atlas.heightAt(entity.x, entity.z), entity.id);
    const species = CONTENT.creatures.entries.find(s => s.id === entity.speciesId);
    if (species.role === 'predator') assert(Math.hypot(entity.x, entity.z) >= 64, entity.id);
  }
  for (const entity of runtime.creatures.entities.filter(e => e.communityId)) {
    assert.equal(entity.y, runtime.terrain.groundHeight(entity.x, entity.z, entity.y), 'community residents stand on their actual building floor');
  }
  runtime.progression.grant({ stone: 1 }, { claimId: 'fixture:inedible' });
  const before = clone(runtime.player), inventory = clone(runtime.progression.inventory);
  assert.equal(runtime.eat('stone').ok, false);
  assert.deepEqual(runtime.player, before);
  assert.deepEqual(runtime.progression.inventory, inventory);
});

test('actual runtime recovers death inventory at 10 metres and keeps partial recovery after save', async () => {
  let runtime = await ExpeditionRuntime.create(SEED);
  runtime.progression.grant({ wood: 100 }, { claimId: 'fixture:death-items' });
  runtime.player.x = 300;
  runtime.player.y = runtime.atlas.heightAt(300, 0) + .05;
  runtime.drivingMachineId = 'previous-machine';
  runtime.interactionAction = { anchorId: 'previous-gimmick' };
  runtime.player.resting = true;
  runtime.die();
  assert.equal(runtime.drivingMachineId, null, 'respawn must release the former vehicle');
  assert.equal(runtime.interactionAction, null, 'death cancels the old location interaction');
  assert.equal(runtime.player.resting, false);
  const id = runtime.deaths[0].id, location = clone(runtime.deaths[0].position);
  assert.equal(runtime.progression.count('wood'), 0);
  runtime.progression.grant({ wood: 2304 }, { claimId: 'fixture:full-bag' });
  Object.assign(runtime.player, location, { x: location.x + 10.01 });
  runtime.tick(.01);
  assert.equal(runtime.deaths[0].items.wood, 100);
  Object.assign(runtime.player, location, { x: location.x + 9.99 });
  runtime.tick(.01);
  assert.equal(runtime.deaths[0].items.wood, 100, 'full inventory must leave items at the death location');
  runtime.progression.spend({ wood: 64 }, { claimId: 'fixture:free-one-stack' });
  runtime.tick(.01);
  assert.equal(runtime.progression.count('wood'), 2304);
  assert.equal(runtime.deaths[0].items.wood, 36);
  const store = new ExpeditionSave(storage(), 'runtime-death');
  store.write(runtime.serialize());
  runtime = await ExpeditionRuntime.create(SEED, store.load());
  assert.equal(runtime.deaths[0].id, id);
  assert.equal(runtime.deaths[0].items.wood, 36);
  runtime.progression.spend({ wood: 64 }, { claimId: 'fixture:free-second-stack' });
  runtime.tick(.01);
  assert.equal(runtime.deaths[0].recovered, true);
  assert.deepEqual(runtime.deaths[0].items, {});
  assert.equal(runtime.progression.count('wood'), 2276);
  runtime.tick(.01);
  assert.equal(runtime.progression.count('wood'), 2276, 'repeated proximity must not duplicate recovered items');
});


function headlessScene(descriptors) {
  const scene = Object.create(ExpeditionScene.prototype);
  Object.assign(scene, { geometryCache: new Map(), models: new Map(), pending: new Set(),
    wanted: new Map(descriptors.map(d => [d.id, d])), scene: new T.Scene() });
  return scene;
}

test('runtime mining follows the frontier rule, removes the cell once and keeps wounds and holes after reload', async () => {
  let runtime = await ExpeditionRuntime.create(SEED);
  const block = CONTENT.blocks.entries.find(b => b.rawResourceId === 'raw_timber');
  assert(block);
  const cell = [0, 16, 0];runtime.atlas.setCell(...cell, block.id);
  const hit = { kind:'terrain', point:{x:.25,y:8.5,z:.25}, normal:{x:0,y:1,z:0}, distance:1 };
  Object.assign(runtime.player,{x:0,y:8,z:0});
  const before=runtime.progression.count('raw_timber');
  assert.equal(runtime.strike(hit).mined,true,'attacking terrain mines it');
  assert.equal(runtime.strike(hit).reason,'공격 준비 중','one strike per 0.18 s');
  runtime.tick(.2);
  assert.equal(runtime.strike(hit).ok,true);
  assert.equal(runtime.atlas.getCell(...cell),block.id,'wood takes three bare-handed strikes');
  const store=new ExpeditionSave(storage(),'mining');store.write(runtime.serialize());
  runtime=await ExpeditionRuntime.create(SEED,store.load());
  assert(Math.abs(runtime.terrainDamage[cell.join(',')].damage-2/3)<1e-9,'the wound survives reload');
  runtime.tick(.2);const last=runtime.strike(hit);
  assert.equal(last.removed,1);
  assert.equal(runtime.atlas.getCell(...cell),null);
  assert.equal(runtime.progression.count('raw_timber'),before+block.harvestYieldPerCell);
  store.write(runtime.serialize());
  runtime=await ExpeditionRuntime.create(SEED,store.load());
  assert.equal(runtime.atlas.getCell(...cell),null);
  assert.equal(runtime.terrainDamage[cell.join(',')],undefined);
});

test('machine rendered quaternion and gameplay hit identify the same rotated paid voxel without rebuilding on motion', async () => {
  const runtime=await ExpeditionRuntime.create(SEED);
  runtime.progression.grant({wood:1},{claimId:'fixture:rotation-material'});
  const made=runtime.machines.create({name:'rotation',position:{x:0,y:8,z:0},gridM:.1});
  assert.equal(made.ok,true);
  assert.equal(runtime.machines.attachVoxel(made.machineId,{cell:[0,0,0],materialId:'wood'}).ok,true);
  const machine=runtime.machines.machines.get(made.machineId);
  Object.assign(machine.rotation,{x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2});
  const hit={id:machine.id,kind:'machine',point:{x:.1,y:8.05,z:-.05},normal:{x:1,y:0,z:0},distance:1};
  assert.equal(runtime.machineVoxelAt(hit)?.id,machine.voxels[0].id);
  const descriptor=runtime.machines.sceneModels()[0],scene=headlessScene([descriptor]);
  try{
    const record=await scene.makeModel(descriptor);scene.syncModels([descriptor],1);
    assert(Math.abs(record.group.quaternion.y-Math.SQRT1_2)<1e-8);
    const geometry=record.dynamicGeometry[0].geometry;
    machine.position.x=1;
    scene.syncModels(runtime.machines.sceneModels(),2);
    assert.equal(scene.models.get(machine.id),record);
    assert.equal(record.dynamicGeometry[0].geometry,geometry);
    assert.equal(record.group.position.x,1);
  }finally{disposeHeadless(scene);}
});

test('thermal interaction consumes fuel once and deposits heat rather than duplicating heat and direct damage', async () => {
  let runtime=await ExpeditionRuntime.create(SEED);runtime.time=2;
  runtime.progression.grant({raw_timber:1},{claimId:'fixture:heat-fuel'});
  assert.equal(runtime.materialEffects.loadThermalFuel(1,{claimId:'fixture:heat-load'}).ok,true);
  runtime.materialEffects.tick(2);
  const y=runtime.atlas.heightAt(0,0),cell=[0,Math.floor((y-.25)*2),0];
  const hit={kind:'terrain',point:{x:.25,y,z:.25},normal:{x:0,y:1,z:0},distance:1};
  const before=runtime.materialEffects.thermal.storedEU;
  assert.equal(runtime.energyStrike(hit,'thermal',25).ok,true);
  assert.equal(runtime.materialEffects.thermal.storedEU,before-25);
  assert.equal(runtime.terrainDamage[cell.join(',')],undefined);
  assert(runtime.atlas.temperatureAtCell(...cell)>20);
  assert.equal(runtime.energyStrike(hit,'thermal',25).ok,false,'same frame cannot charge another attack');
  assert.equal(runtime.materialEffects.thermal.storedEU,before-25);
  const restored=await ExpeditionRuntime.create(SEED,runtime.serialize());
  assert.equal(restored.materialEffects.thermal.storedEU,before-25);
  assert.equal(restored.materialEffects.thermal.consumedEU,25);
});
function disposeHeadless(scene) {
  for (const model of scene.models.values()) for (const mesh of model.dynamicGeometry ?? []) { mesh.geometry.dispose(); mesh.material.dispose(); }
  for (const list of scene.geometryCache.values()) for (const mesh of list) { mesh.geometry.dispose(); mesh.material.dispose(); }
}

test('energy channels reach building cells and fixed equipment using actual material resistance',async()=>{
 const runtime=await ExpeditionRuntime.create(SEED);
 const inst=runtime.dungeons.ensureInstance('root_manor','surface-energy',[600,4.5,0],2);
 const box=runtime.dungeons.renderBoxes(inst.id).find(b=>b.blockId==='stone'&&b.size.every(n=>n>=.5));assert(box);
 const cell=box.center.map(v=>Math.floor(v*2)/2+.25),position=point(cell),before=runtime.dungeons.solidAt(position);assert(before);
 const block=CONTENT.blocks.entries.find(b=>b.id===before.blockId);
 const result=runtime.damageHit({kind:'structure',id:inst.id,point:position},{amount:10,energyType:'chemical',energyEU:15});
 assert.equal(result.ok,true);assert(Math.abs(result.hp-(before.hp-10*(1-block.acidResistance)))<1e-8);
 runtime.progression.grant({field_bench:1},{claimId:'fixture:surface-bench'});
 for(let x=-3;x<3;x++)for(let z=-3;z<3;z++)runtime.atlas.setCell(x,199,z,'stone');
 const placed=await runtime.placements.place('field_bench',{x:0,y:100,z:0},{actorPosition:{x:0,y:100,z:2}});assert.equal(placed.ok,true,placed.reason);
 const fixture=runtime.placements.records.get(placed.id),initialHp=fixture.hp;
 const profile=equipmentExposureProfile(CONTENT,'field_bench');assert(profile.acidResistance>0&&profile.acidResistance<1);
 const response=runtime.damageHit({kind:'fixture',id:placed.id},{amount:10,energyType:'chemical',energyEU:15});
 assert.equal(response.ok,true);assert(Math.abs(fixture.hp-(initialHp-resolveSurfaceDamage(profile,10,'chemical').amount))<1e-8);
 const restored=await ExpeditionRuntime.create(SEED,runtime.serialize());assert.equal(restored.placements.records.get(placed.id).hp,fixture.hp);
 assert.equal(restored.dungeons.solidAt(position).hp,result.hp);
});

test('actual scene renders puzzle gate and keeps damage separate between repeated building instances', async () => {
  const runtime = await ExpeditionRuntime.create(SEED);
  const template = 'root_manor';
  const first = runtime.dungeons.ensureInstance(template, 'render-one', [600, 4.5, 0], 2);
  const second = runtime.dungeons.ensureInstance(template, 'render-two', [900, 4.5, 0], 2);
  const descriptor = instance => ({ id: instance.id, assetId: template, kind: 'structure', position: point(instance.origin),
    revision: instance.revision, getBoxes: () => runtime.dungeons.renderBoxes(instance.id) });
  const a = descriptor(first), b = descriptor(second), scene = headlessScene([a, b]);
  try {
    const ma = await scene.makeModel(a), mb = await scene.makeModel(b);
    const gate = ma.parts.get('puzzle_gate');
    assert(gate?.children.some(child => child.isMesh && child.geometry.getAttribute('position').count > 0), 'a closed collidable puzzle gate must have rendered geometry');
    const secondBefore = JSON.stringify(mb.boxes);
    const chosen = ma.boxes.find(box => box.collision && box.size.every(n => n >= .5));
    const target = chosen.center.map(v => Math.floor(v * 2) / 2 + .25);
    assert.equal(runtime.dungeons.damageAt(target, 1e6).ok, true);
    scene.syncModels([descriptor(first), descriptor(second)], 0);
    assert.equal(ma.revision, first.revision);
    assert(!ma.boxes.some(box => box.collision && target.every((v, i) => v > box.center[i] - box.size[i] / 2 && v < box.center[i] + box.size[i] / 2)));
    assert.equal(JSON.stringify(mb.boxes), secondBefore);
  } finally { disposeHeadless(scene); }
});

test('actual scene accepts SDK-authored inline resource geometry outside the canonical manifest', async () => {
  const asset = buildResourceAsset('source_raw_timber');
  const descriptor = { id: 'resource:integration:1', assetId: asset.id, asset, kind: 'resource', position: { x: 0, y: 4, z: 0 } };
  const scene = headlessScene([descriptor]);
  try {
    const model = await scene.makeModel(descriptor);
    assert.equal(model.asset.id, asset.id);
    assert(model.boxes.length > 0);
    assert(scene.models.has(descriptor.id));
    scene.syncModels([descriptor], 0);
    assert.equal(model.group.position.y, 4);
  } finally { disposeHeadless(scene); }
});
