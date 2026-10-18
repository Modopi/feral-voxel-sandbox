import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { WorldAtlas } from '../app/src/main/assets/content-runtime/atlas.js';

const content = Object.fromEntries(['environments', 'blocks', 'creatures', 'structures', 'bosses', 'progression']
  .map((key) => [key, JSON.parse(fs.readFileSync(new URL(`../design/content/${key}.json`, import.meta.url)))]));

test('paid dungeon lift moves its actual Rapier gate while retaining unchanged building colliders',async()=>{
 const {DungeonSystem}=await import('../app/src/main/assets/content-runtime/dungeons.js');
 const {Progression}=await import('../app/src/main/assets/content-runtime/progression.js');
 const asset=JSON.parse(fs.readFileSync(new URL('../design/assets/models/root_manor.voxel.json',import.meta.url)));
 const d=new DungeonSystem({catalog:content,assets:{root_manor:asset}}),i=d.ensureInstance('root_manor','physical-lift',[0,0,0]);
 const rt=runtime(),g=new Progression(content);Object.assign(rt.player,{x:35,y:.02,z:.25});rt.dungeons=d;rt.nearbyStructures=[i];
 const p=await RuntimePhysics.create(rt,null,{terrainRadius:1});
 try{
  p.synchronize(new Map(),rt.player);p.step(1/60);
  const initial=p.structures.get(i.id),staticEntry=initial.entry;
  assert.equal(p.hasAttackLineOfSight([36,1.25,.25],[38,1.25,.25]),false);
  g.grant({joint:1},{claimId:'prepared-lift-component'});const anchor=d.definition(i.id).puzzle.componentAnchors[0],position=d.worldPosition(i.id,anchor.positionM);
  assert(d.devices.act(i.id,`install:${anchor.id}`,{position,progression:g,claimId:'paid-joint'}).ok);
  assert(d.devices.act(i.id,'lift_gate',{position,progression:g}).ok);
  for(let n=0;n<300;n++)d.update(1/60,{progression:g,position,manualInstanceId:i.id});
  assert.equal(i.puzzle.phase,'open');assert(Math.abs(i.deviceState.metrics.manualInputEU-45)<1e-5);
  p.synchronize(new Map(),rt.player);p.step(1/60);
  assert.equal(p.structures.get(i.id).entry,staticEntry);
  assert.equal(p.hasAttackLineOfSight([36,1.25,.25],[38,1.25,.25]),true);
  const gate=[...p.structures.get(i.id).devices.values()].find(v=>v.entry.partId.startsWith('puzzle_gate:'));
  assert(gate);assert(gate.entry.colliders[0].translation().y>4.5);
 }finally{p.dispose();}
});
const flat = () => ({ revision: 0, isSolidCell: (_x, y) => y < 0, heightAt: () => 0 });
function runtime(atlas = flat()) { return { atlas, player: { x: 0, y: .02, z: 0 }, nearbyStructures: [] }; }
function model(id, { position = [0, 0, 0], kind = 'creature', parts = null } = {}) {
  const rows = parts ?? [{ id: 'body', parent: null, translation: [0, 0, 0], role: 'body', boxes: [{ center: [0, .5, 0], size: [1, 1, 1], material: 'stone' }] }];
  const group = new T.Group(), nodes = new Map(); group.position.set(...position);
  for (const p of rows) { const n = new T.Group(); n.position.set(...p.translation); nodes.set(p.id, n); }
  for (const p of rows) (p.parent ? nodes.get(p.parent) : group).add(nodes.get(p.id));
  return { group, parts: nodes, asset: { parts: rows, materials: [{ id: 'stone', collision: true }, { id: 'water', collision: false }, { id: 'glass', collision: true, opacity: .3 }] },
    desc: { id, kind, position: { x: position[0], y: position[1], z: position[2] } } };
}

// Integration tests use the real vendored Rapier, real Three parent transforms,
// and (where specified) the actual procedural atlas rather than fake predicates.
test('actual atlas 0.5m terrain becomes Rapier solids and supports a swept player', async () => {
  const atlas = new WorldAtlas(content, { seed: 'physics-integration', maxActiveChunks: 8 });
  const rt = runtime(atlas); rt.player.y = atlas.heightAt(0, 0) + 2;
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    p.synchronize(new Map(), rt.player); p.step(1 / 60);
    const before = { ...rt.player }, desired = { ...rt.player, y: atlas.heightAt(0, 0) - 2, vy: -5 };
    const result = p.movePlayer(before, desired);
    assert(result.grounded); assert(desired.y >= atlas.heightAt(0, 0) - .03);
    assert(Math.abs(p.groundHeight(0, 0, desired.y) - atlas.heightAt(0, 0)) < .03);
    assert(p.adapter.entries.some((e) => e.ownerId === '@terrain'));
  } finally { p.dispose(); }
});

test('different moving entity blocks player, with actual cuboid gaps left traversable', async () => {
  const rt = runtime(), p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  const obstacle = model('creature:a', { position: [1, 0, 0], parts: [
    { id: 'root', parent: null, translation: [0, 0, 0], role: 'body', boxes: [] },
    { id: 'left', parent: 'root', translation: [0, 0, -1.5], role: 'leg', boxes: [{ center: [0, 1, 0], size: [1, 2, 1], material: 'stone' }] },
    { id: 'right', parent: 'root', translation: [0, 0, 1.5], role: 'leg', boxes: [{ center: [0, 1, 0], size: [1, 2, 1], material: 'stone' }] },
  ] });
  try {
    p.synchronize(new Map([['creature:a', obstacle]]), rt.player); p.step(1 / 60);
    const blocked = { x: 3, y: .02, z: 1.5 };
    p.movePlayer({ x: -1, y: .02, z: 1.5 }, blocked);
    assert(blocked.x < .3, `external part should block, got ${blocked.x}`);
    const throughGap = { x: 3, y: .02, z: 0 };
    p.movePlayer({ x: -1, y: .02, z: 0 }, throughGap);
    assert(throughGap.x > 2.8, 'aggregate entity AABB must not close its actual opening');
  } finally { p.dispose(); }
});

test('child matrixWorld rotates/translates colliders and same entity joints do not self-block', async () => {
  const rt = runtime({ revision: 0, isSolidCell: () => false, heightAt: () => 0 });
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 1 });
  rt.player.z = 3;
  const a = model('boss:a', { parts: [
    { id: 'root', parent: null, translation: [0, 0, 0], role: 'root', boxes: [] },
    { id: 'parent', parent: 'root', translation: [0, 1, 0], role: 'joint', boxes: [{ center: [0, 0, 0], size: [.5, .5, .5], material: 'stone' }] },
    { id: 'child', parent: 'parent', translation: [1, 0, 0], role: 'wing', boxes: [{ center: [.5, 0, 0], size: [1, .25, .25], material: 'stone' }] },
  ] });
  const models = new Map([['boss:a', a]]);
  try {
    p.synchronize(models, rt.player); p.step(1 / 60);
    a.parts.get('parent').rotation.z = Math.PI / 2;
    p.synchronize(models, rt.player); p.step(1 / 60);
    const child = p.parts.get('boss:a::child').entry.colliders[0];
    assert(Math.abs(child.translation().x) < .01);
    assert(Math.abs(child.translation().y - 2.5) < .01);
    const q = child.rotation(); assert(Math.abs(Math.abs(q.z) - Math.SQRT1_2) < .01);
    assert.equal(p.adapter.collisionEnabledBetween(child, p.parts.get('boss:a::parent').entry.colliders[0]), false);
    a.parts.get('child').visible = false;
    p.synchronize(models, rt.player); assert.equal(p.parts.has('boss:a::child'), false);
  } finally { p.dispose(); }
});

test('kinematic entity movement is actually swept against terrain rather than teleported through it', async () => {
  const rt = runtime({ revision: 0, isSolidCell: (x, y) => x === 0 && y >= 0 && y < 6, heightAt: () => 0 });
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 3 });
  rt.player.z = 3;
  const a = model('boss:wall-test', { position: [-2, 0, 0], kind: 'boss' });
  const models = new Map([['boss:wall-test', a]]);
  try {
    p.synchronize(models, rt.player); p.step(1 / 60);
    a.group.position.x = 2; a.desc.position.x = 2;
    p.synchronize(models, rt.player); p.step(1 / 60);
    const x = p.parts.get('boss:wall-test::body').entry.body.translation().x;
    assert(x < -.49 && x > -.55);
    assert(Math.abs(a.desc.position.x - x) < .01, 'visual/simulation root must follow the contact limit');
  } finally { p.dispose(); }
});

test('a boss variant reposition is clamped by its real part sweep and the next tick cancels the blocked move', async () => {
  const { BossSystem } = await import('../app/src/main/assets/content-runtime/bosses.js');
  const atlas = { revision: 0, heightAt: () => 0,
    isSolidCell: (x, y, z) => (x === -1 || x === 0) && y >= 0 && y < 4 && z === 6 };
  const rt = runtime(atlas), bosses = new BossSystem(content);
  rt.bosses = bosses;
  const e = bosses.spawn('sanctuary_warden', [0, 0, 4], { id: 'boss:warden:t9', instanceId: 'dungeon:variant', tier: 9, contentVariantId: 'sanctuary_warden_t9' });
  const actor = model(e.id, { position: [0, 0, 4], kind: 'boss' });
  actor.desc.position = e.position;
  const models = new Map([[e.id, actor]]), p = await RuntimePhysics.create(rt, null, { radius: 8, terrainRadius: 6 });
  try {
    p.synchronize(models, rt.player); p.step(1 / 60);
    e.engaged = true; e.gap = 0; e.variantState.lastCompletedCast = { id: 'cast:wall-test', skillId: 'warden_hammer' };
    bosses.tick(.05, { targets: [{ id: 'player', ownerId: 'player', position: { x: 4, y: 0, z: 4 }, radius: .28, height: 1.5 }], terrain: { canMove: () => true } });
    assert(e.position.z < 4, 'the variant schedules and starts its side step');
    actor.desc.position = e.position;
    actor.group.position.set(e.position.x, e.position.y, e.position.z); actor.group.updateMatrixWorld(true);
    p.synchronize(models, rt.player); p.step(1 / 60);
    assert(e.position.z > 3.48, `actual cuboid wall sweep should stop at the wall, got z=${e.position.z}`);
    assert(Math.abs(actor.desc.position.z - e.position.z) < .01, 'the boss simulation root follows the collision correction');
    bosses.tick(.05, { targets: [{ id: 'player', ownerId: 'player', position: { x: 4, y: 0, z: 4 }, radius: .28, height: 1.5 }], terrain: { canMove: () => true } });
    assert.equal(e.variantState.pendingReposition, null, 'contact correction cancels the saved sweep');
  } finally { p.dispose(); }
});

test('structure destruction rebuilds exact renderBoxes; water excluded and translucent glass remains solid', async () => {
  const rt = runtime(), p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  const instance = { id: 'ruin:1', revision: 0 }; let broken = false;
  rt.nearbyStructures = [instance];
  rt.dungeons = { get: () => instance, renderBoxes: () => [
    ...(!broken ? [{ center: [1, 1, 0], size: [.5, 2, 2], collision: true, materialId: 'glass', opacity: .2 }] : []),
    { center: [0, .1, 0], size: [4, .2, 4], collision: false, materialId: 'visual_water' },
  ] };
  try {
    p.synchronize(new Map(), rt.player); p.step(1 / 60);
    assert.equal(p.structures.get(instance.id).entry.colliders.length, 1);
    const first = { x: 2, y: .02, z: 0 }; p.movePlayer({ x: -1, y: .02, z: 0 }, first);
    assert(first.x < .6);
    broken = true; instance.revision++;
    p.synchronize(new Map(), rt.player); p.step(1 / 60);
    const second = { x: 2, y: .02, z: 0 }; p.movePlayer({ x: -1, y: .02, z: 0 }, second);
    assert(second.x > 1.9);
    assert.equal(p.structures.get(instance.id).entry, null);
  } finally { p.dispose(); }
});

test('moving dungeon device parts preserve static colliders and their shared collision owner',async()=>{
 const rt=runtime(),p=await RuntimePhysics.create(rt,null,{terrainRadius:2}),instance={id:'moving-device',revision:0};let lift=0;
 rt.nearbyStructures=[instance];rt.dungeons={get:()=>instance,renderBoxes:()=>[
  {center:[4,1,0],size:[.5,2,2],partId:'wall',collision:true},
  ...[-.6,.6].map(z=>({center:[1,1+lift,z],size:[.5,2,.4],partId:'gate',devicePart:true,collision:true}))]};
 try{
  p.synchronize(new Map(),rt.player);p.step(1/60);const original=p.structures.get(instance.id).entry;
  assert.equal(p.structures.get(instance.id).devices.size,2);
  const blocked={x:2,y:.02,z:.6};p.movePlayer({x:0,y:.02,z:.6},blocked);assert(blocked.x<.6);
  lift=3;instance.revision++;p.synchronize(new Map(),rt.player);p.step(1/60);
  assert.equal(p.structures.get(instance.id).entry,original);
  const moved={x:2,y:.02,z:.6};p.movePlayer({x:0,y:.02,z:.6},moved);assert(moved.x>1.9);
  for(const {entry}of p.structures.get(instance.id).devices.values())assert.equal(p.adapter.collisionEnabledBetween(original.colliders[0],entry.colliders[0]),false);
 }finally{p.dispose();}
});

test('unbounded atlas streaming handles negative distant coordinates and mining revisions', async () => {
  const atlas = flat(); atlas.empty = false;
  atlas.isSolidCell = (x, y, z) => y < 0 && !atlas.empty;
  const rt = runtime(atlas); rt.player = { x: -10000.25, y: .05, z: 10000.25 };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 1 });
  try {
    p.synchronize(new Map(), rt.player); p.step(1 / 60);
    const oldVersion = p.terrainVersion;
    const grounded = { ...rt.player, y: -2 }; p.movePlayer(rt.player, grounded); assert(grounded.y > -.03);
    atlas.empty = true; atlas.revision++;
    p.synchronize(new Map(), rt.player); p.step(1 / 60);
    assert.notEqual(p.terrainVersion, oldVersion);
    const falling = { ...rt.player, y: -2 }; p.movePlayer(rt.player, falling); assert(falling.y < -1.9);
    assert(!p.adapter.entries.some((e) => e.ownerId === '@terrain'));
  } finally { p.dispose(); }
});

test('64 instance owners remain independent and retain articulated children in the integrated scene', async () => {
  const rt = runtime({ revision: 0, isSolidCell: () => false, heightAt: () => 0 });
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 1, radius: 100 });
  const models = new Map();
  for (let i = 0; i < 64; i++) models.set(`instance:${i}`, model(`instance:${i}`, { position: [i % 8 * 2, 0, Math.floor(i / 8) * 2] }));
  try {
    p.synchronize(models, rt.player); p.step(1 / 60);
    assert.equal(p.parts.size, 64);
    for (let i = 0; i < 32; i++) assert(p.adapter.collisionEnabledBetween(p.parts.get(`instance:${i}::body`).entry.colliders[0], p.parts.get(`instance:${i + 32}::body`).entry.colliders[0]));
    const player = { x: 5, y: 0, z: 0 }; p.movePlayer({ x: -2, y: 0, z: 0 }, player);
    assert(player.x < -.7, 'movement must be blocked by the actual first entity');
    p.synchronize(new Map(), rt.player);
    assert.equal(p.parts.size, 0);
  } finally { p.dispose(); }
});

test('a collision-limited articulated owner keeps sibling body offsets and its visible root', async () => {
  const rt = runtime({ revision: 0, isSolidCell: (x, y) => x === 0 && y >= 0 && y < 6, heightAt: () => 0 });
  rt.player.z = 3;
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 3 });
  const a = model('long-owner', { position: [-2, 0, 0], parts: [
    { id: 'body', parent: null, translation: [0, 0, 0], role: 'body', boxes: [{ center: [0, .5, 0], size: [1, 1, 1], material: 'stone' }] },
    { id: 'tail', parent: 'body', translation: [-2, 0, 0], role: 'tail', boxes: [{ center: [0, .5, 0], size: [1, 1, 1], material: 'stone' }] },
  ] });
  try {
    const models = new Map([['long-owner', a]]); p.synchronize(models, rt.player); p.step(1 / 60);
    a.group.position.x = 2; a.desc.position.x = 2;
    p.synchronize(models, rt.player); p.step(1 / 60);
    const front = p.parts.get('long-owner::body').entry.body.translation();
    const tail = p.parts.get('long-owner::tail').entry.body.translation();
    assert(Math.abs(front.x - tail.x - 2) < .015);
    a.group.updateMatrixWorld(true);
    const visibleTail = new T.Vector3(); a.parts.get('tail').getWorldPosition(visibleTail);
    assert(Math.abs(tail.x - visibleTail.x) < .015);
  } finally { p.dispose(); }
});

test('moving kinematic owners are blocked by a stationary external player capsule', async () => {
  const rt = runtime({ revision: 0, isSolidCell: () => false, heightAt: () => 0 });
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 1 });
  const a = model('incoming', { position: [-2, 0, 0] });
  try {
    const models = new Map([['incoming', a]]); p.synchronize(models, rt.player); p.step(1 / 60);
    a.group.position.x = 2; a.desc.position.x = 2;
    p.synchronize(models, rt.player); p.step(1 / 60);
    const x = p.parts.get('incoming::body').entry.body.translation().x;
    assert(x < -.75 && x > -.85, `expected contact outside the player capsule, got ${x}`);
  } finally { p.dispose(); }
});

test('phase growth walls use exact shared bounds, block players and disappear when broken; water stays nonsolid', async () => {
  const rt = runtime();
  let effects = [{ type: 'solid', bossId: 'tree', gimmickId: 'growth', min: { x: 1, y: 0, z: -2 }, max: { x: 2, y: 3, z: 2 } },
    { type: 'water', bossId: 'worm', min: { x: -2, y: 0, z: -2 }, max: { x: 0, y: 1, z: 2 } }];
  rt.bosses = { getWorldEffects: () => effects };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    p.synchronize(new Map(), rt.player); p.step(1 / 60);
    assert.equal(p.bossEffects.size, 1);
    let desired = { ...rt.player, x: 3 }; p.movePlayer(rt.player, desired);
    assert(desired.x < .75 && desired.x > .65);
    assert(Math.abs(p.groundHeight(1.5, 0, 3) - 3) < .001);
    effects = []; p.synchronize(new Map(), rt.player); p.step(1 / 60);
    desired = { ...rt.player, x: 3 }; p.movePlayer(rt.player, desired);
    assert(desired.x > 2.9); assert.equal(p.bossEffects.size, 0);
  } finally { p.dispose(); }
});

test('attack rays exclude only source and target owners, preserving articulated gaps and external solid glass', async () => {
  const rt = runtime(), p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    const boxes = [{ center: [0, 0, 0], size: [.2, .8, .8] }];
    p.adapter.addBody({ ownerId: 'attacker', type: 'fixed', position: [0, 1, 0], boxes });
    p.adapter.addBody({ ownerId: 'target', type: 'fixed', position: [3, 1, 0], boxes });
    p.adapter.step(1e-6);
    const from = [0, 1, 0], to = [3, 1, 0], opts = { excludeOwnerId: 'attacker', targetOwnerId: 'target' };
    assert(!p.hasAttackLineOfSight(from, to)); assert(p.hasAttackLineOfSight(from, to, opts));
    p.adapter.addBody({ ownerId: 'glass', type: 'fixed', position: [1.5, 1, 0], boxes }); p.adapter.step(1e-6);
    assert(!p.hasAttackLineOfSight(from, to, opts)); p.adapter.removeOwner('glass');
    p.adapter.addBody({ ownerId: 'other', type: 'fixed', boxes: [
      { center: [1.5, 1, -1], size: [.5, 1, .5] }, { center: [1.5, 1, 1], size: [.5, 1, .5] },
    ] }); p.adapter.step(1e-6);
    assert(p.hasAttackLineOfSight(from, to, opts));
    assert(!p.hasAttackLineOfSight([0, 1, 1], [3, 1, 1], opts));
  } finally { p.dispose(); }
});

async function machineFixture({ position = [0, 3, 0], cells = [[0, 0, 0]], atlas = flat(), materialId = 'wood' } = {}) {
  const { Progression } = await import('../app/src/main/assets/content-runtime/progression.js');
  const { MachineSystem } = await import('../app/src/main/assets/content-runtime/machines.js');
  const progression = new Progression(content); progression.grant({ [materialId]: 20000 }, { claimId: 'fixture' });
  const machines = new MachineSystem(content, progression), id = machines.create({ position, gridM: .5 }).machineId;
  for (const cell of cells) assert(machines.attachVoxel(id, { cell, materialId }).ok);
  const rt = runtime(atlas); rt.machines = machines; rt.progression = progression;
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 }); p.synchronize(new Map(), rt.player);
  return { rt, p, machines, progression, id, m: machines.machines.get(id) };
}

test('actual fluid displacement floats a light wooden hull while paid cargo changes its draft and can sink it',async()=>{
 const atlas={...flat(),fluidAt:(_x,y,_z)=>y>=0&&y<2?{type:'water',depth:2-y}:null};
 const {p,m,id,machines,progression}=await machineFixture({position:[0,.5,0],atlas});
 try{
  for(let frame=0;frame<420;frame++)p.step(1/60);
  assert(m.position.y>1.4&&m.position.y<2,`wood floats at waterline: ${m.position.y}`);
  progression.grant({steel:50},{claimId:'prepared-ballast'});assert(machines.loadCargo(id,{steel:50}).ok);assert.equal(progression.count('steel'),0);
  for(let frame=0;frame<420;frame++)p.step(1/60);
  assert(m.position.y<.1,`ballast sinks the same hull: ${m.position.y}`);
  assert.equal(m.metrics.generated,0);assert.equal(m.metrics.consumed,0);
 }finally{p.dispose();}
});

test('real machine cuboids fall, collide with terrain, retain physical mass/inertia and skip duplicate model integration', async () => {
  const { p, machines, id, m } = await machineFixture({ cells: [[0, 0, 0], [1, 0, 0]] });
  try {
    const body = p.machinePhysics.bodies.get(id).entry.body, mass = machines.evaluate(id).mass;
    assert(Math.abs(body.mass() - mass) < 1e-4); assert(body.principalInertia().x > 0);
    const before = structuredClone(m.position), clock = machines.clock; machines.tick(.1);
    assert.deepEqual(m.position, before); assert.equal(machines.clock, clock);
    for (let i = 0; i < 180; i++) p.step(1 / 60);
    assert(m.position.y > -.03 && m.position.y < .03, `actual floor contact ${m.position.y}`);
    assert(Math.abs(m.velocity.y) < .1); assert(Math.abs(machines.clock - 3) < 1e-7);
    assert.equal(p.machinePhysics.bodies.get(id).entry.colliders.length, 2);
  } finally { p.dispose(); }
});

test('dynamic assemblies exchange momentum with external owners and rotate on all three axes', async () => {
  const atlas = { revision: 0, isSolidCell: () => false, heightAt: () => -100 };
  const { p, machines, id, m, progression } = await machineFixture({ atlas });
  try {
    const other = machines.create({ position: [1, 3, 0], gridM: .5 }).machineId;
    assert(machines.attachVoxel(other, { cell: [0, 0, 0], materialId: 'wood' }).ok);
    p.machinePhysics.sync(); p.adapter.step(1e-6);
    p.machinePhysics.bodies.get(id).entry.body.applyImpulse({ x: 300, y: 0, z: 0 }, true);
    for (let i = 0; i < 15; i++) p.step(1 / 60);
    assert(machines.machines.get(other).velocity.x > .2, 'contact must transfer momentum to external dynamic owner');
    const body = p.machinePhysics.bodies.get(id).entry.body;
    body.setAngvel({ x: 1, y: .7, z: .5 }, true); p.step(.1);
    assert(Math.abs(m.rotation.x) > .01 && Math.abs(m.rotation.y) > .01 && Math.abs(m.rotation.z) > .01);
    assert(progression.count('wood') < 20000);
  } finally { p.dispose(); }
});

test('rotated machine damage uses actual cuboids, finite distribution, persistent claims and fragment body rebuilding', async () => {
  const { bossShapeHits } = await import('../app/src/main/assets/content-runtime/bosses.js');
  const { MachineSystem } = await import('../app/src/main/assets/content-runtime/machines.js');
  const { Progression } = await import('../app/src/main/assets/content-runtime/progression.js');
  const { p, machines, id, m, progression } = await machineFixture({ cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] });
  try {
    const q = new T.Quaternion().setFromEuler(new T.Euler(.3, .6, .2));
    const body = p.machinePhysics.bodies.get(id).entry.body; body.setRotation(q, true); p.machinePhysics.capture(); p.adapter.step(1e-6);
    const c = p.machinePhysics.bodies.get(id).entry.colliders[1].translation();
    const shape = { kind: 'sphere', radiusM: .05, center: { ...c } }, target = p.machineTargets()[0];
    assert(bossShapeHits(shape, target));
    const initial = m.voxels.reduce((s, v) => s + v.hp, 0), event = { targetId: id, bossId: 'test', castId: 'cast:1', amount: 1 };
    assert(p.damageMachineTarget(event).ok); assert(Math.abs(m.voxels.reduce((s, v) => s + v.hp, 0) - initial + 1) < 1e-6);
    target.intersectsShape(shape); assert(p.damageMachineTarget(event).duplicate);
    const restored = new MachineSystem(content, new Progression(content, progression.serialize()), machines.serialize());
    assert(restored.machines.get(id).damageClaims.includes('boss:test:cast:1'));
    target.intersectsShape(shape); assert(p.damageMachineTarget({ ...event, castId: 'cast:2', amount: 10000 }).ok);
    assert.equal(machines.machines.size, 2); assert.equal(p.machinePhysics.bodies.size, 2);
    for (const cache of p.machinePhysics.bodies.values()) assert.equal(cache.entry.colliders.length, 1);
  } finally { p.dispose(); }
});

test('machine OBB respects annular hole and tiny sphere outside a rotated cuboid AABB', async () => {
  const { p, id } = await machineFixture({ position: [0, 0, 0] });
  try {
    const body = p.machinePhysics.bodies.get(id).entry.body; body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 4), true);
    p.adapter.step(1e-6); const target = p.machineTargets()[0];
    assert(!target.intersectsShape({ kind: 'sphere', radiusM: .01, center: { x: .02, y: .25, z: .34 } }));
    assert(!target.intersectsShape({ kind: 'annular_cylinder', center: { x: 0, y: 1, z: 0 }, bottomY: 0, heightM: 2, innerRadiusM: 1, outerRadiusM: 3 }));
    assert(target.intersectsShape({ kind: 'annular_cylinder', center: { x: 0, y: 1, z: 0 }, bottomY: 0, heightM: 2, innerRadiusM: .4, outerRadiusM: 3 }));
  } finally { p.dispose(); }
});

test('placements become fixed collision before their async render model exists and prevent paid overlapping voxel placement', async () => {
  const { p, rt, machines, id, progression } = await machineFixture({ position: [0, 0, 0] });
  try {
    rt.placements = { collisionBoxes: () => [{ ownerId: 'fixture:1', center: [.75, .25, .25], size: [.5, .5, .5] }] };
    p.synchronize(new Map(), rt.player); p.step(1 / 60);
    assert(p.fixtures.has('fixture:1')); assert.equal(p.adapter.entries.find((e) => e.ownerId === 'fixture:1').type, 'fixed');
    const before = progression.count('wood'); assert(!machines.attachVoxel(id, { cell: [1, 0, 0], materialId: 'wood' }).ok);
    assert.equal(progression.count('wood'), before);
  } finally { p.dispose(); }
});

test('a real boss cast damages a rotating dynamic machine once, with actual collider cover blocking another cast', async () => {
  const { BossSystem } = await import('../app/src/main/assets/content-runtime/bosses.js');
  const { p, m, machines, id } = await machineFixture({ position: [3, 0, 0], cells: [[0, 0, 0], [1, 0, 0]] });
  try {
    const body = p.machinePhysics.bodies.get(id).entry.body;
    body.setRotation(new T.Quaternion().setFromEuler(new T.Euler(.1, .4, .15)), true); p.adapter.step(1e-6); p.machinePhysics.capture();
    const s = new BossSystem(content), e = s.spawn('rootback_beast', [0, 0, 0]);
    const skill = s.definitions.get(e.bossId).skills.find((v) => v.geometry.kind === 'cylinder');
    let delivered = 0;
    const ctx = { targets: p.machineTargets(), terrain: { groundHeight: () => 0, hasAttackLineOfSight: (...args) => p.hasAttackLineOfSight(...args) },
      damage: (event) => { delivered++; assert(p.damageMachineTarget(event).ok); } };
    const cast = () => s.startCast(e, { s: skill, shape: s.makeShape(e, skill, ctx.targets[0], ctx), windupS: skill.windupS }, ctx.targets[0]);
    const health = () => [...machines.machines.values()].flatMap((v) => v.voxels).reduce((sum, v) => sum + v.hp, 0);
    const before = health(); cast();
    for (let t = 0; t < skill.windupS + skill.activeS + .05; t += .05) s.tick(.05, ctx);
    assert.equal(delivered, 1); assert(health() < before); const after = health();
    p.adapter.addBody({ ownerId: 'actual-cover', type: 'fixed', boxes: [{ center: [1.5, 1, 0], size: [.5, 3, 4] }] }); p.adapter.step(1e-6);
    e.cast = null; e.staggerS = 0; cast();
    for (let t = 0; t < skill.windupS + skill.activeS + .05; t += .05) s.tick(.05, ctx);
    assert.equal(delivered, 1); assert.equal(health(), after);
  } finally { p.dispose(); }
});

test('detached matter uses cell masses, falls through no false leaf solids and reports saved 6DOF pose', async () => {
  const rt = runtime();
  const object = { id: 'object:1', position: { x: 10, y: 3, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, boxes: [
      { center: [0, .25, 0], size: [.5, .5, .5], massKg: 10 },
      { center: [0, 1, 0], size: [1, 1, 1], massKg: 1, collision: false },
    ] };
  rt.objects = { physicsBodies: () => [object], setPhysicsPose: (_id, pose) => Object.assign(object, pose) };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 1 });
  try {
    p.synchronize(new Map(), rt.player); const entry = p.objectPhysics.bodies.get(object.id).entry;
    assert(Math.abs(entry.body.mass() - 11) < 1e-6); assert(entry.colliders[1].isSensor());
    assert(p.hasAttackLineOfSight([8, 4, 0], [12, 4, 0]));
    for (let i = 0; i < 150; i++) p.step(1 / 60);
    assert(object.position.y < .03 && object.position.y > -.03, 'ground must stream around object outside player cache');
    assert(Math.abs(object.velocity.y) < .1); assert(Number.isFinite(object.rotation.w));
  } finally { p.dispose(); }
});

test('connected paid machine fuel drives actual Rapier forces once and recreated physics restores quaternion, momentum and ledger', async () => {
  const { MachineSystem } = await import('../app/src/main/assets/content-runtime/machines.js');
  const { Progression } = await import('../app/src/main/assets/content-runtime/progression.js');
  const { p, rt, m, id, machines, progression } = await machineFixture({ position: [0, 5, 0], cells: [[0, 0, 0], [1, 0, 0]] });
  let resumed;
  try {
    progression.grant({ heat_engine: 1, transmission: 1, raw_timber: 1 }, { claimId: 'engine-parts' });
    for (const part of ['heat_engine', 'transmission']) {
      const research = progression.catalog.get(progression.catalog.get(part).research);
      progression.discover(research.blueprint, { origin: 'discovery', claimId: `physics-research:${part}` });
    }
    const engine = machines.installComponent(id, m.voxels[0].id, 'heat_engine').componentInstanceId;
    const wheel = machines.installComponent(id, m.voxels[1].id, 'transmission', { legacyType: 'propeller' }).componentInstanceId;
    assert(machines.connect(id, engine, wheel, 'mechanical').ok); assert(machines.refuel(id, engine, 1).ok); machines.control(id, { throttle: 1 });
    p.machinePhysics.sync(); p.machinePhysics.bodies.get(id).entry.body.setAngvel({ x: .2, y: .3, z: .4 }, true);
    for (let i = 0; i < 12; i++) { machines.tick(1 / 60); p.step(1 / 60); }
    assert(m.velocity.z > .01); assert(Math.abs(m.metrics.generated - 4) < 1e-6); assert.equal(progression.count('raw_timber'), 0);
    assert(Math.abs(m.metrics.generated - m.metrics.loss - m.metrics.consumed) < 1e-6);
    const state = JSON.parse(JSON.stringify(machines.serialize())), restoredProgression = new Progression(content, progression.serialize());
    const restoredMachines = new MachineSystem(content, restoredProgression, state), restoredRuntime = { ...rt, machines: restoredMachines };
    resumed = await RuntimePhysics.create(restoredRuntime, null, { terrainRadius: 2 }); resumed.synchronize(new Map(), rt.player);
    const body = resumed.machinePhysics.bodies.get(id).entry.body;
    assert(Math.abs(body.linvel().z - m.velocity.z) < 1e-5);
    assert(Math.abs(body.rotation().x - m.rotation.x) < 1e-5); assert(body.angvel().z > .1);
    assert.deepEqual(restoredMachines.machines.get(id).metrics, m.metrics);
    assert(Math.abs(body.mass() - restoredMachines.evaluate(id).mass) < 1e-3);
  } finally { resumed?.dispose(); p.dispose(); }
});

test('fixture placement checks rotating cuboid occupancy without filling its empty AABB corners', async () => {
  const { p, id } = await machineFixture({ position: [3, 2, 0] });
  try {
    const body = p.machinePhysics.bodies.get(id).entry.body; body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 4), true); p.adapter.step(1e-6);
    assert(p.externalOverlap({ center: [3.35, 2.25, 0], size: [.03, .03, .03] }));
    assert(!p.externalOverlap({ center: [3.02, 2.25, .34], size: [.01, .01, .01] }));
    assert(!p.externalOverlap({ center: [3.35, 2.25, 0], size: [.03, .03, .03] }, { ignoreOwnerId: id }));
  } finally { p.dispose(); }
});

test('real WorldObjects detachment feeds exact original mass into Rapier and saves the landed pose', async () => {
  const { WorldObjects } = await import('../app/src/main/assets/content-runtime/objects.js');
  const cells = new Map([['0,5,0', 'log'], ['0,6,0', 'leaves']]);
  const atlas = { revision: 0, getCell: (x, y, z) => cells.get(`${x},${y},${z}`) ?? null,
    setCell(x, y, z, id) { const key = `${x},${y},${z}`; if (id == null) cells.delete(key); else cells.set(key, id); this.revision++; return true; },
    isSolidCell: (_x, y) => y < 0, heightAt: () => 0 };
  const rt = runtime(atlas); rt.objects = new WorldObjects(content, atlas);
  const object = rt.objects.detachAround([0, 4, 0]).objects[0]; assert(object);
  const expectedMass = object.massKg, p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    p.synchronize(new Map(), rt.player); assert(Math.abs(p.objectPhysics.bodies.get(object.id).entry.body.mass() - expectedMass) < 1e-4);
    for (let i = 0; i < 150; i++) p.step(1 / 60);
    const saved = JSON.parse(JSON.stringify(rt.objects.serialize())), restored = new WorldObjects(content, atlas, saved);
    assert(Math.abs(restored.get(object.id).position.y) < .03); assert.equal(restored.get(object.id).massKg, expectedMass);
    assert.equal(cells.size, 0); assert.equal(restored.detachAround([0, 4, 0]).objects.length, 0);
  } finally { p.dispose(); }
});

test('grabbing applies bounded physical impulses and throwing adds at most the specified work to a moving object',async()=>{
 const {WorldObjects}=await import('../app/src/main/assets/content-runtime/objects.js');
 const cells=new Map([['0,2,0','log']]);
 const atlas={...flat(),getCell:(x,y,z)=>cells.get(`${x},${y},${z}`)??null,setCell:(x,y,z,id)=>id==null?cells.delete(`${x},${y},${z}`):cells.set(`${x},${y},${z}`,id),revision:0};
 const rt=runtime(atlas);Object.assign(rt.player,{hp:100,yaw:0,pitch:0});rt.objects=new WorldObjects(content,atlas);const o=rt.objects.detachAround([0,1,0]).objects[0];
 const p=await RuntimePhysics.create(rt,null,{terrainRadius:1});try{
  p.synchronize(new Map(),rt.player);const bridge=p.objectPhysics,body=bridge.bodies.get(o.id).entry.body;
  assert.equal(bridge.grab(o.id,{x:.25,y:1.25,z:.25}).ok,true);const mass=body.mass(),before=body.linvel();bridge.prepare(1/60);const after=body.linvel();
  assert(Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z)*mass<=1800/60+.001);
  body.setLinvel({x:0,y:0,z:-10},true);const initial=.5*mass*100;assert.equal(bridge.throwHeld().ok,true);const velocity=body.linvel(),final=.5*mass*(velocity.x**2+velocity.y**2+velocity.z**2);
  assert(final-initial<=300.01);assert(final>initial);assert.equal(bridge.held,null);assert.equal(bridge.throwHeld().ok,false);
  assert.equal(bridge.grab(o.id,{x:100,y:0,z:0}).ok,false);
 }finally{p.dispose();}
});
