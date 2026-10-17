import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CreatureSystem } from '../app/src/main/assets/content-runtime/creatures.js';

const CONTENT = Object.fromEntries(['creatures', 'environments', 'structures', 'progression'].map(name =>
  [name, JSON.parse(readFileSync(new URL(`../design/content/${name}.json`, import.meta.url), 'utf8'))]));
const make = (options = {}) => new CreatureSystem(CONTENT, { seed: 'biology-test', ...options });
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const inventory = (items = {}) => ({
  items: { ...items }, transactions: new Set(),
  canApply(delta) { return Object.entries(delta).every(([k, v]) => (this.items[k] ?? 0) + v >= 0); },
  apply(delta, id) {
    if (this.transactions.has(id)) return { ok: true, duplicate: true };
    if (!this.canApply(delta)) return { ok: false };
    for (const [key, value] of Object.entries(delta)) this.items[key] = (this.items[key] ?? 0) + value;
    this.transactions.add(id); return { ok: true };
  },
});

test('all 34 canonical species produce distinct typed bodies and finite serializable states', () => {
  const sys = make();
  for (const s of CONTENT.creatures.entries) {
    const e = sys.spawn(s.id, { x: 0, y: 0, z: 0 });
    assert.equal(e.assetId, s.id);
    assert.equal(e.entityType, s.entityType);
    assert.equal(e.civilization, s.civilization);
    assert.equal(e.calories === null, s.entityType === 'inorganic');
    assert.equal(e.pose.limbSupport.length, CONTENT.creatures.bodyProfiles[s.body.profile].limbCount);
    assert.ok(Object.values(e.parts).every(p => p.hp > 0));
  }
  assert.equal(sys.entities.length, 34);
  const loaded = make({ state: sys.serialize() });
  assert.deepEqual(loaded.serialize(), sys.serialize());
});

test('natural healing charges actual restored HP and never increases low calorie balance', () => {
  const sys = make(), e = sys.spawn('moss_deer', { x: 0, y: 0, z: 0 });
  sys.damage(e.id, 20);
  sys.interact(e.id, { type: 'rest' });
  const cp = e.calories;
  sys.tick(1);
  const s = CONTENT.creatures.entries.find(x => x.id === 'moss_deer');
  near(e.calories, cp - s.calories.basalCpPerS - (e.hp - 28) * s.calories.regenCpPerHp);
  assert.ok(e.hp > 28);
  e.calories = 1;
  const hp = e.hp;
  sys.tick(1);
  assert.equal(e.hp, hp);
  assert.ok(e.calories < 1);
});

test('inorganic creatures never heal naturally; repair consumes one material after full duration', () => {
  const sys = make(), e = sys.spawn('custodian_inorganic', { x: 0, y: 0, z: 0 });
  sys.damage(e.id, 60);
  sys.tick(20);
  assert.equal(e.hp, e.maxHp - 60);
  assert.equal(e.calories, null);
  const inv = inventory({ scrap_iron: 1 });
  assert.equal(sys.repair(e.id, { inventory: inv, atStation: false, dt: 20 }).ok, false);
  assert.equal(sys.repair(e.id, { inventory: inv, atStation: true, dt: 4 }).pending, true);
  assert.equal(inv.items.scrap_iron, 1);
  const loaded = make({ state: sys.serialize() });
  const result = loaded.repair(e.id, { inventory: inv, atStation: true, dt: 4 });
  assert.equal(result.restored, 40);
  assert.equal(inv.items.scrap_iron, 0);
  assert.equal(loaded.repair(e.id, { inventory: inv, atStation: true, dt: 8 }).ok, false);
  assert.equal(loaded.get(e.id).hp, e.maxHp - 20);
});

test('region initialization and corpse rewards never duplicate after save or repeated ensure', () => {
  const sys = make();
  sys.ensureRegion('grove:a', { environmentId: 'grove', x: 0, z: 0, tier: 2 });
  const initial = sys.entities.length;
  const e = sys.entities[0];
  sys.damage(e.id, 10000);
  const inv = inventory();
  assert.equal(sys.claimDrops(e.id, inv).ok, true);
  const before = { ...inv.items };
  const loaded = make({ state: sys.serialize() });
  loaded.ensureRegion('grove:a', { environmentId: 'grove', x: 0, z: 0, tier: 2 });
  assert.equal(loaded.entities.length, initial);
  assert.equal(loaded.claimDrops(e.id, inv).duplicate, true);
  assert.deepEqual(inv.items, before);
  assert.equal(loaded.get(e.id).dead, true);
});

test('safe bypass regions exclude hostile predators at initial placement', () => {
  const sys = make();
  sys.ensureRegion('safe', { environmentId: 'grove', x: 0, z: 0, tier: 2, safeBypass: true });
  assert.ok(sys.entities.length > 0);
  assert.ok(sys.entities.every(e => sys.species.get(e.speciesId).role !== 'predator'));
});

test('dungeon food, water, room limits and permanent extinction survive a two-hour offline run', () => {
  const sys = make();
  const r = sys.ensureDungeon('manor:1', { structureId: 'root_manor', x: 48, y: 3, z: 0 });
  assert.equal(sys.entities.length, 10);
  assert.ok(sys.entities.every(e => e.dungeonId === 'manor:1' && e.y === 3));
  for (const e of sys.entities) sys.damage(e.id, 100000);
  const waterBefore = r.waterL;
  const result = sys.advanceOffline(7200);
  assert.equal(result.processedSeconds, 7200);
  assert.equal(sys.entities.filter(e => !e.dead).length, 0);
  assert.ok(r.waterL <= waterBefore);
  const loaded = make({ state: sys.serialize() });
  loaded.ensureDungeon('manor:1', { structureId: 'root_manor', x: 48, y: 3, z: 0 });
  assert.equal(loaded.entities.length, 10);
  assert.ok(loaded.entities.every(e => e.dead));
});

test('living outdoor and closed dungeon ecology remains finite and bounded for two hours', () => {
  const sys = make();
  sys.ensureRegion('field', { environmentId: 'grove', x: 0, z: 0 });
  sys.ensureDungeon('manor', { structureId: 'root_manor', x: 128, z: 0 });
  sys.advanceOffline(7200);
  for (const r of sys.regions.values()) {
    assert.ok(sys.entities.filter(e => !e.dead && e.regionId === r.id).length <= r.capacity);
    assert.ok(r.foodNodes.every(p => p.cp >= 0 && p.cp <= p.maxCp && Number.isFinite(p.cp)));
  }
  for (const e of sys.entities) {
    assert.ok(Number.isFinite(e.hp) && e.hp >= 0 && e.hp <= e.maxHp);
    assert.ok(e.calories === null || e.calories >= 0);
  }
  assert.doesNotThrow(() => make({ state: sys.serialize() }));
});

test('births debit both parents, require room capacity and persist their serial', () => {
  const sys = make();
  const r = sys.ensureRegion('nursery', { environmentId: 'grove', x: 0, z: 0, safeBypass: true });
  for (const e of sys.entities) sys.damage(e.id, 10000);
  const s = sys.species.get('moss_deer');
  const a = sys.spawn(s.id, { x: 0, y: 0, z: 0 }, { id: 'parent:a', regionId: r.id, calories: s.calories.maxCp });
  const b = sys.spawn(s.id, { x: 1, y: 0, z: 0 }, { id: 'parent:b', regionId: r.id, calories: s.calories.maxCp });
  a.breedAt = b.breedAt = 0; a.rest = b.rest = true;
  r.nextBirthAt = .25;
  const before = a.calories + b.calories;
  sys.tick(.25);
  const child = sys.entities.find(e => e.id.includes(':birth:'));
  assert.ok(child);
  near(before - a.calories - b.calories, child.calories * 2 + s.calories.basalCpPerS * .5);
  assert.equal(child.age, 0);
  assert.equal(r.births, 1);
  const loaded = make({ state: sys.serialize() });
  loaded.tick(1);
  assert.equal(loaded.entities.filter(e => e.id.includes(':birth:')).length, 1);
});

test('whole-body damage applies once while structural injury changes movement without calorie regrowth', () => {
  const sys = make(), e = sys.spawn('moss_deer', { x: 0, y: 0, z: 0 });
  const before = e.hp, limbBefore = e.parts.limb_0.hp;
  sys.damage(e.id, 12, 'left_foreleg');
  near(before - e.hp, 12);
  near(limbBefore - e.parts.limb_0.hp, limbBefore);
  assert.equal(e.parts.limb_0.hp, 0);
  assert.equal(e.pose.speedFactor, .55);
  sys.interact(e.id, { type: 'rest' });
  sys.tick(100);
  assert.equal(e.parts.limb_0.hp, 0);
  const loaded = make({ state: sys.serialize() });
  assert.equal(loaded.get(e.id).pose.speedFactor, .55);
  sys.damage(e.id, 1000, 'head');
  assert.equal(e.dead, true);
});

test('attack telegraphs survive reload, can be dodged, and produce exactly one hit', () => {
  const sys = make(), e = sys.spawn('oath_sentinel', { x: 0, y: 0, z: 0 });
  const player = { x: 0, y: 0, z: 2, hp: 1000 };
  const events = sys.tick(2.5, { player });
  assert.ok(events.some(e => e.type === 'attack_telegraph'));
  assert.ok(e.attack && !e.attack.hitDone);
  const loaded = make({ state: sys.serialize() });
  const hits = loaded.tick(1.5, { player }).filter(e => e.type === 'player_hit');
  assert.equal(hits.length, 1);
  assert.equal(loaded.tick(.5, { player }).filter(e => e.type === 'player_hit').length, 0);
  const dodged = make({ state: sys.serialize() });
  assert.equal(dodged.tick(2, { player: { ...player, x: 20 } }).filter(e => e.type === 'player_hit').length, 0);
});

test('wall occlusion prevents attacks and solid terrain prevents crossing', () => {
  const terrain = { heightAt: () => 0, isSolidCell: (x, y, z) => z === 2 && y >= 0 && y <= 5 };
  const sys = make({ terrain }), e = sys.spawn('oath_sentinel', { x: 0, y: 0, z: 0 });
  const events = sys.tick(10, { terrain, player: { x: 0, y: 0, z: 2, hp: 100 } });
  assert.equal(events.filter(e => e.type === 'player_hit').length, 0);
  assert.ok(e.z < 1);
});

test('communal trade is finite, atomic and drops only existing personal inventory', () => {
  const sys = make(), e = sys.spawn('wayfarer_organic', { x: 0, y: 0, z: 0 }, { communityId: 'camp' });
  const inv = inventory({ food: 2 });
  assert.equal(sys.interact(e.id, { type: 'trade', offerId: 'made_up', inventory: inv }).ok, false);
  assert.equal(sys.interact(e.id, { type: 'trade', offerId: 'food_for_wood', inventory: inv }).ok, true);
  assert.equal(inv.items.wood, 2); assert.equal(inv.items.food, 1);
  assert.equal(e.inventory.wood, 4); assert.equal(e.inventory.food, 1);
  sys.damage(e.id, 10000);
  const result = sys.claimDrops(e.id, inv);
  assert.deepEqual(result.items, { wood: 4, food: 1 });
  assert.equal(inv.items.wood, 6);
});

test('feeding consumes inventory and different frame partitions produce the same state', () => {
  const a = make(), b = make();
  a.spawn('moss_deer', { x: 0, y: 0, z: 0 });
  b.spawn('moss_deer', { x: 0, y: 0, z: 0 });
  for (let i = 0; i < 100; i++) a.tick(.1);
  b.tick(10);
  const sa = a.serialize(), sb = b.serialize();
  near(sa.time, sb.time); near(sa.remainder, sb.remainder);
  sa.remainder = sb.remainder = 0;
  assert.deepEqual(sa, sb);
  const inv = inventory({ food: 1 }), e = a.entities[0], cp = e.calories;
  assert.equal(a.interact(e.id, { type: 'feed', inventory: inv }).ok, true);
  assert.equal(inv.items.food, 0); assert.ok(e.calories > cp);
});

test('invalid saves, invalid time and unknown parts do not silently mutate population', () => {
  const sys = make(), e = sys.spawn('moss_deer', { x: 0, y: 0, z: 0 });
  assert.throws(() => sys.tick(-1)); assert.throws(() => sys.tick(Infinity));
  assert.equal(sys.damage(e.id, 10, 'does_not_exist').ok, false);
  assert.equal(e.hp, e.maxHp);
  const state = sys.serialize(); state.entities[0].calories = -2;
  assert.throws(() => make({ state }));
  assert.throws(() => sys.spawn('unknown', { x: 0, y: 0, z: 0 }));
});

test('producer destruction and harvesting share finite food; corpse decomposition conserves edible CP', () => {
  const sys = make(), r = sys.ensureRegion('food', { environmentId: 'grove', x: 0, z: 0 });
  for (const p of r.foodNodes) sys.setProducerState(r.id, p.id, { enabled: false });
  const initial = r.foodNodes.reduce((n, p) => n + p.cp, 0);
  assert.equal(sys.harvestFood(r.id, initial + 1), initial);
  assert.equal(sys.harvestFood(r.id, 1), 0);
  for (const e of sys.entities) sys.damage(e.id, 10000);
  const cp = [...sys.corpses.values()].reduce((n, c) => n + c.edibleCp, 0);
  sys.tick(10);
  assert.equal(r.foodNodes.reduce((n, p) => n + p.cp, 0), 0);
  near(cp, r.detritusCp + [...sys.corpses.values()].reduce((n, c) => n + c.edibleCp, 0));
  assert.equal(sys.claimDrops('player-death:0', inventory()).ok, false);
});

test('migration moves the same individual across an actual boundary and respects closed ecology', () => {
  const sys = make(), a = sys.ensureRegion('dry', { environmentId: 'grove', x: 0, z: 0 }), b = sys.ensureRegion('lush', { environmentId: 'grove', x: 64, z: 0 });
  for (const e of sys.entities) sys.damage(e.id, 10000);
  for (const p of a.foodNodes) { p.cp = 0; p.enabled = false; }
  const e = sys.spawn('moss_deer', { x: 0, y: 0, z: 0 }, { id: 'migrant', regionId: a.id, calories: 400 });
  e.foodShortageSeconds = 120;
  sys.tick(40);
  assert.equal(e.regionId, b.id);
  assert.ok(e.home.x >= 32);
  assert.equal(sys.entities.filter(x => x.id === e.id).length, 1);
  const count = sys.entities.length;
  const loaded = make({ state: sys.serialize() });
  assert.equal(loaded.get('migrant').regionId, b.id);
  assert.equal(loaded.entities.length, count);
});

test('retrying a repair transaction after an independently persisted inventory does not pay twice', () => {
  const sys = make(), e = sys.spawn('custodian_inorganic', { x: 0, y: 0, z: 0 });
  sys.damage(e.id, 60); sys.tick(2);
  const beforeRepair = sys.serialize(), inv = inventory({ scrap_iron: 1 });
  assert.equal(sys.repair(e.id, { inventory: inv, atStation: true, dt: 8 }).ok, true);
  assert.equal(inv.items.scrap_iron, 0);
  const stale = make({ state: beforeRepair });
  assert.equal(stale.repair(e.id, { inventory: inv, atStation: true, dt: 8 }).ok, true);
  assert.equal(inv.items.scrap_iron, 0);
  assert.equal(stale.get(e.id).hp, e.hp);
});

test('overlay species consume their host allocation instead of adding another ecology budget', () => {
  const sys = make();
  const r = sys.ensureRegion('sanctuary', { environmentId: 'sacred', baseEnvironmentId: 'grove', x: 256, z: 0, tier: 6 });
  assert.equal(r.capacity, 14);
  assert.ok(sys.entities.some(e => e.speciesId === 'moss_deer'));
  assert.ok(sys.entities.some(e => e.speciesId === 'candle_hare'));
  assert.ok(Object.values(r.speciesCaps).reduce((n, v) => n + v, 0) <= 14);
  assert.ok(sys.entities.filter(e => sys.species.get(e.speciesId).role === 'predator').length <= 2);
});

test('only nearby capped individuals run detailed AI; remote ecology catches up without player hits', () => {
  const sys = make();
  for (let i = 0; i < 70; i++) sys.spawn(i < 20 ? 'copper_fox' : 'moss_deer', { x: i / 10, y: 0, z: 10 }, { id: `near:${i}` });
  const remote = sys.spawn('oath_sentinel', { x: 1000, y: 0, z: 0 });
  const player = { x: 0, y: 0, z: 0, hp: 100 };
  const visible = sys.visibleEntities(player);
  assert.equal(visible.length, 48);
  assert.ok(visible.filter(e => e.speciesId === 'copper_fox').length <= 8);
  const age = remote.age;
  sys.tick(10, { player });
  assert.equal(remote.age, age);
  assert.equal(sys.tick(50, { player }).filter(e => e.sourceId === remote.id && e.type === 'player_hit').length, 0);
  assert.equal(remote.age, age + 60);
});

test('weapon attachment damage disables attack without killing an otherwise viable body', () => {
  const sys = make(), e = sys.spawn('furnace_mantis', { x: 0, y: 0, z: 0 });
  const damage = Math.ceil(e.parts.weapon.hp / .65);
  assert.equal(sys.damage(e.id, damage, 'raptorial_arm_1').ok, true);
  assert.equal(e.dead, false);
  assert.equal(e.parts.weapon.hp, 0);
  e.angerUntil = 100;
  assert.equal(sys.tick(10, { player: { x: 0, y: 0, z: 1, hp: 1000 } }).filter(e => e.type === 'player_hit').length, 0);
  assert.ok(e.pose.parts.walking_leg_1_0);
});

test('unclaimed dead creatures remain visible for ray-selected loot and disappear after claiming', () => {
  const sys = make(), e = sys.spawn('moss_deer', { x: 0, y: 0, z: 2 });
  sys.damage(e.id, 10000);
  assert.ok(sys.visibleEntities({ x: 0, z: 0 }).includes(e));
  assert.ok(sys.visibleCorpses({ x: 0, z: 0 }).includes(e));
  sys.claimDrops(e.id, inventory());
  assert.ok(!sys.visibleEntities({ x: 0, z: 0 }).includes(e));
});

import * as THREE from '../app/src/main/assets/vendor/three.module.js';
import { animateCreatureModel, creatureBodyPart, creatureCollisionParts } from '../app/src/main/assets/content-runtime/creature-animation.js';
function sceneRecord(asset) {
  const group = new THREE.Group(), parts = new Map();
  for (const p of asset.parts) { const node = new THREE.Group(); node.position.set(...p.translation); node.userData.part = p; parts.set(p.id, node); }
  for (const p of asset.parts) (p.parent === null ? group : parts.get(p.parent)).add(parts.get(p.id));
  return { group, parts, asset };
}

test('all 34 real art models animate from original pivots with finite joint poses and instance collision ownership', () => {
  const sys = make();
  for (const s of CONTENT.creatures.entries) {
    const asset = JSON.parse(readFileSync(new URL(`../design/assets/models/${s.id}.voxel.json`, import.meta.url), 'utf8'));
    const before = JSON.stringify(asset), record = sceneRecord(asset);
    const e = sys.spawn(s.id, { x: 0, y: 0, z: 0 }); e.pose.moving = true; e.pose.phase = 1.2;
    const snapshot = JSON.stringify(e);
    const result = animateCreatureModel(record, e, 4, .016);
    assert.equal(result.profile, s.body.profile);
    assert.equal(JSON.stringify(e), snapshot, 'rendering must not tick simulation');
    assert.equal(JSON.stringify(asset), before, 'asset pivots are immutable');
    for (const [id, node] of record.parts) {
      assert.ok([node.position.x, node.position.y, node.position.z, node.rotation.x, node.rotation.y, node.rotation.z].every(Number.isFinite), `${s.id}:${id}`);
      assert.equal(node.userData.collisionOwnerId, e.id);
    }
    const shapes = creatureCollisionParts(record, e);
    assert.ok(shapes.length > 0);
    assert.ok(shapes.every(p => p.ownerId === e.id && p.selfCollision === false && p.boxes.length > 0));
  }
});

test('logical limb loss hides the real model part and removes its collider; death and work poses are explicit', () => {
  const sys = make(), e = sys.spawn('moss_deer', { x: 0, y: 0, z: 0 });
  const asset = JSON.parse(readFileSync(new URL('../design/assets/models/moss_deer.voxel.json', import.meta.url), 'utf8'));
  const model = sceneRecord(asset);
  assert.equal(creatureBodyPart(e, 'left_foreleg'), 'limb_0');
  sys.damage(e.id, 12, 'left_foreleg');
  animateCreatureModel(model, e, 3, .1);
  assert.equal(model.parts.get('left_foreleg').visible, false);
  assert.ok(!creatureCollisionParts(model, e).some(p => p.partId === 'left_foreleg'));
  sys.damage(e.id, 10000);
  animateCreatureModel(model, e, 4, .5);
  assert.ok(model.parts.get('root').rotation.z > 1);
  const npc = sys.spawn('wayfarer_organic', { x: 0, y: 0, z: 0 }); npc.state = 'work';
  const npcModel = sceneRecord(JSON.parse(readFileSync(new URL('../design/assets/models/wayfarer_organic.voxel.json', import.meta.url), 'utf8')));
  animateCreatureModel(npcModel, npc, 1, .1);
  assert.notEqual(npcModel.parts.get('arm_1').rotation.x, 0);
});

test('wounded flying creatures fall even when idle, and amphibious movement uses actual fluid depth', () => {
  const ground = { heightAt: () => 0, isSolidCell: () => false, fluidAt: () => null };
  const sys = make({ terrain: ground }), bird = sys.spawn('gale_raptor', { x: 0, y: 2, z: 0 });
  sys.damage(bird.id, Math.ceil(bird.parts.limb_0.hp / .65), 'wing_-1');
  bird.rest = true;
  sys.tick(2);
  assert.equal(bird.y, 0);
  assert.equal(bird.grounded, true);
  const water = { heightAt: () => 0, isSolidCell: () => false, fluidAt: (x, y, z) => y < 2 ? { type: 'water', depth: 2 - y, temperatureC: 20 } : null };
  const swimmer = make({ terrain: water }), eel = swimmer.spawn('drain_eel', { x: 0, y: 0, z: 0 });
  swimmer.tick(1);
  assert.equal(eel.locomotion, 'swimming');
  assert.ok(eel.y > 0 && eel.y < 2);
});

test('near-height floor queries and actual collision line-of-sight hooks receive ownership', () => {
  let nearY = null, owners = null;
  const terrain = { heightAt: (x, z, y) => { nearY = y; return 4; }, isSolidCell: () => false,
    hasAttackLineOfSight: (a, b, o) => { owners = o; return false; } };
  const sys = make({ terrain }), e = sys.spawn('oath_sentinel', { x: 0, y: 4, z: 0 });
  const events = sys.tick(5, { player: { x: 0, y: 4, z: 2, hp: 100 } });
  assert.equal(nearY, 4);
  assert.equal(owners.excludeOwnerId, e.id);
  assert.equal(owners.targetOwnerId, 'player');
  assert.equal(events.filter(e => e.type === 'player_hit').length, 0);
});

test('all species can die from exterior-only hits or HP damage without breaking core bones', () => {
  const sys=make();
  for(const species of CONTENT.creatures.entries){
    const e=sys.spawn(species.id,{x:0,y:0,z:0}),core=e.parts.core.hp;
    while(!e.dead){const hp=e.hp;const result=sys.damage(e.id,Math.min(7,hp),'shell');near(result.hpLost,Math.min(7,hp));assert.equal(e.dead,e.hp===0);}
    assert.equal(e.parts.core.hp,core);assert.equal(sys.corpses.has(`corpse:${e.id}`),true);
    const direct=sys.spawn(species.id,{x:0,y:0,z:0});sys.damage(direct.id,direct.maxHp,'body');assert.equal(direct.dead,true);assert.equal(direct.parts.core.hp,core);
  }
});

test('core and spine faults impair behavior while HP and intact exterior remain alive', () => {
  const sys=make(),e=sys.spawn('wayfarer_organic',{x:0,y:0,z:0});const core=e.parts.core.hp;
  sys.damage(e.id,core,'core');assert.equal(e.parts.core.hp,0);assert.equal(e.dead,false);near(e.hp,e.maxHp-core);assert.equal(e.parts.core.detached,false);assert.equal(e.pose.missingParts.includes('core'),false);
  assert.equal(sys._structure(e).functions.attack,false);assert.equal(sys._structure(e).functions.feed,false);assert(e.pose.speedFactor>0&&e.pose.speedFactor<1);
  sys.damage(e.id,e.parts.spine.hp,'spine');assert.equal(e.dead,false);assert.equal(e.pose.speedFactor,0);assert.equal(e.parts.spine.detached,false);
  const asset=JSON.parse(readFileSync(new URL('../design/assets/models/wayfarer_organic.voxel.json',import.meta.url))),model=sceneRecord(asset);animateCreatureModel(model,e,1,0);
  assert.equal(model.parts.get('torso').visible,true);assert.equal(model.parts.get('leg_-1').visible,true);assert.equal(model.parts.get('leg_1').visible,true);
  assert.equal(e.fragmentCuts.length,0);const loaded=make({state:sys.serialize()});assert.equal(loaded.get(e.id).dead,false);assert.equal(loaded.get(e.id).pose.speedFactor,0);
});

test('piercing and transmitted impact allocate one HP budget across exterior and internal injuries', () => {
  for(const mode of ['pierce','impact']){
    const sys=make(),e=sys.spawn('moss_deer',{x:0,y:0,z:0}),hp=e.hp,core=e.parts.core.hp,shell=e.parts.shell.hp,cp=e.calories;
    const packet={attackId:`${mode}:one`,attackMode:mode,amount:10,energyEU:20,structuralHits:[{partId:'shell',amount:3,energyEU:6},{partId:'core',amount:7,energyEU:14}]};
    const result=sys.damagePacket(e.id,packet);assert.equal(result.ok,true);near(result.hpLost,10);near(e.hp,hp-10);near(e.parts.shell.hp,shell-3);near(e.parts.core.hp,core-7);assert.equal(e.calories,cp);
    assert.equal(result.energyEU,20);assert.equal(sys.damagePacket(e.id,packet).duplicate,true);near(e.hp,hp-10);
    const loaded=make({state:sys.serialize()});assert.equal(loaded.damagePacket(e.id,packet).duplicate,true);near(loaded.get(e.id).hp,hp-10);
  }
});

test('caller structural and energy over-allocation rejects the entire hit before changing HP', () => {
  const sys=make(),e=sys.spawn('custodian_inorganic',{x:0,y:0,z:0}),before=sys.serialize();
  assert.equal(sys.damage(e.id,10,'body',{structuralHits:[{partId:'core',amount:6},{partId:'shell',amount:6}]}).reason,'attack_budget_exceeded');
  assert.equal(sys.damage(e.id,10,'body',{energyEU:10,structuralHits:[{partId:'core',amount:5,energyEU:11}]}).reason,'attack_budget_exceeded');
  assert.deepEqual(sys.serialize(),before);
  const reserve=e.reserveEu;sys.damage(e.id,10,'body',{attackMode:'impact',energyEU:10,structuralHits:[{partId:'core',amount:10,energyEU:10}]});assert.equal(e.reserveEu,reserve,'target reserve must not pay attacker energy a second time');
});

test('authored armor reduces the whole-body hit once and its broken shell loses that protection', () => {
  const data=structuredClone(CONTENT);data.creatures.entries.find(e=>e.id==='moss_deer').stats.damageReduction=.25;
  const sys=new CreatureSystem(data),e=sys.spawn('moss_deer',{x:0,y:0,z:0}),hp=e.hp;
  const result=sys.damage(e.id,20,'shell');near(result.hpLost,15);near(e.hp,hp-15);assert.equal(e.parts.shell.hp,0);
  const second=sys.damage(e.id,4,'shell');near(second.hpLost,4);assert.equal(second.armorReduction,0);assert.equal(e.parts.core.hp,17);
});
