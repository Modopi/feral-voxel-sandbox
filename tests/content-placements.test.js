import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WorldPlacements} from '../app/src/main/assets/content-runtime/placements.js';
import {Progression} from '../app/src/main/assets/content-runtime/progression.js';
import {DungeonSystem} from '../app/src/main/assets/content-runtime/dungeons.js';
const read=name=>JSON.parse(readFileSync(new URL(`../design/content/${name}.json`,import.meta.url)));
const content=Object.fromEntries(['progression','environments','structures','blocks','bosses','creatures'].map(n=>[n,read(n)]));
const equipment=content.progression.entries.filter(e=>['station','component'].includes(e.kind));
const assets=new Map([...equipment.map(e=>e.id),'root_manor'].map(id=>[id,JSON.parse(readFileSync(new URL(`../design/assets/models/${id}.voxel.json`,import.meta.url)))]));
const floor={isSolidCell:(_x,y)=>y<0};
function economy(){const p=new Progression(content);for(const e of content.progression.entries.filter(e=>e.kind==='research'))p.research.add(e.id);return p;}
function give(p,items,id='test'){assert(p.grant(items,{claimId:id}).ok);}
async function world(p,options={}){const w=new WorldPlacements(content,p,{atlas:floor,assets,...options});await w.ready;return w;}

test('all 41 installable models consume real items and preserve distinct machine owners',async()=>{
  const p=economy();const w=await world(p);
  for(const [n,e]of equipment.entries()){give(p,{[e.id]:1},'item:'+e.id);const r=await w.place(e.id,[n*8,0,0]);assert(r.ok,`${e.id}: ${r.reason}`);assert.equal(p.count(e.id),0);assert.equal(r.entityType,'machine');}
  assert.equal(w.descriptors().length,41);assert.equal(new Set(w.collisionBoxes().map(b=>b.ownerId)).size,41);
  assert.equal(w.descriptors().filter(d=>d.fixed&&d.kind==='fixture').length,41);
});

test('actual cuboids allow a battery under a table but reject solid overlap without spending',async()=>{
  const p=economy();give(p,{field_bench:1,battery:2});const w=await world(p);
  assert((await w.place('field_bench',[0,0,0])).ok);
  assert.equal(w.solidAt([0,.4,0]),null,'table has real empty space below top');
  const battery=await w.place('battery',[0,0,0]);assert(battery.ok);
  const rejected=await w.place('battery',[0,0,0]);assert.equal(rejected.reason,'fixture_occupied');assert.equal(p.count('battery'),1);
  assert.equal(w.solidAt([0,.3,0]).ownerId,battery.id);
});

test('terrain, support, distance and real building wall checks fail before inventory consumption',async()=>{
  const p=economy();give(p,{battery:3});const w=await world(p);
  assert.equal((await w.place('battery',[0,2,0])).reason,'support_required');
  assert.equal((await w.place('battery',[20,0,0],{actorPosition:[0,0,0]})).reason,'out_of_range');assert.equal(p.count('battery'),3);
  const obstructed=await world(p,{atlas:{isSolidCell:(x,y,z)=>y<0||x===0&&y===0&&z===0}});
  assert.equal((await obstructed.place('battery',[0,0,0])).reason,'terrain_occupied');assert.equal(p.count('battery'),3);
  const d=new DungeonSystem({catalog:content,assets,seed:1});d.ensureInstance('root_manor','test',[0,0,0]);
  const indoors=await world(p,{dungeons:d});assert.equal((await indoors.place('battery',[-6.25,0,-4.25])).reason,'structure_occupied');assert.equal(p.count('battery'),3);
});

test('nearby station access, breakage, paid repair and save restoration synchronize progression',async()=>{
  const p=economy();give(p,{field_bench:1,raw_timber:10,loose_stone:10,plant_fiber:10});const w=await world(p);
  const r=await w.place('field_bench',[0,0,0]);assert(r.ok);
  w.syncAccess([1,0,0]);assert.equal(p._station('field_bench'),true);w.syncAccess([100,0,0]);assert.equal(p._station('field_bench'),false);
  w.syncAccess([1,0,0]);const max=w.records.get(r.id).maxHp;assert(w.damage(r.id,max).broken);assert.equal(p._station('field_bench'),false);
  const quote=w.repairQuote(r.id),before=p.count('raw_timber');assert(quote.items.raw_timber>0);assert(w.repair(r.id,{actorPosition:[1,0,0]}).ok);assert.equal(p.count('raw_timber'),before-quote.items.raw_timber);assert.equal(p._station('field_bench'),true);
  const restoredP=new Progression(content,p.serialize()),restored=await world(restoredP,{state:w.serialize()});restored.syncAccess([1,0,0]);
  assert.equal(restored.records.get(r.id).hp,max);assert.equal(restored.descriptors().length,1);assert.equal(restoredP.stations.field_bench,1);assert.equal(restoredP._station('field_bench'),true);
  assert(restored.dismantle(r.id,{actorPosition:[1,0,0]}).ok);assert.equal(restoredP.count('field_bench'),1);assert.equal(restoredP._station('field_bench'),false);
  assert.equal(restored.dismantle(r.id).reason,'unknown_fixture');assert.equal(restoredP.count('field_bench'),1);
});

test('component condition and damaged salvage survive reload without duplicating assemblies or items',async()=>{
  const p=economy();give(p,{motor:1});const w=await world(p),r=await w.place('motor',[0,0,0]);assert(r.ok);
  w.syncAccess([1,0,0]);assert(p.hasComponent('motor'));const max=w.records.get(r.id).maxHp;w.damage(r.id,max/2);
  const a=p.assemblies.find(a=>a.worldOwnerId===r.id);assert(a);assert.equal(a.health,.5);
  const p2=new Progression(content,p.serialize()),w2=await world(p2,{state:w.serialize()});w2.syncAccess([1,0,0]);
  assert.equal(p2.assemblies.filter(a=>a.worldOwnerId===r.id).length,1);assert.equal(w2.repair(r.id).ok,false,'no repair supplies');assert.equal(w2.records.get(r.id).hp,max/2);
  assert(w2.dismantle(r.id).ok);assert.equal(p2.count('motor'),0,'damaged component cannot be packed as a repaired core');assert.equal(p2.assemblies.some(a=>a.worldOwnerId===r.id),false);
});

test('concurrent placements serialize their commits and reject corrupted restore state',async()=>{
  const p=economy();give(p,{battery:2});const w=await world(p);
  const results=await Promise.all([w.place('battery',[0,0,0]),w.place('battery',[0,0,0])]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(p.count('battery'),1);
  const state=w.serialize();state.fixtures[0].hp=Infinity;assert.throws(()=>new WorldPlacements(content,p,{atlas:floor,assets,state}),/Invalid saved fixture/);
});

test('dismantling a supporting table requires packing the fixture resting on it first',async()=>{
  const p=economy();give(p,{field_bench:1,battery:1});const w=await world(p);
  const table=await w.place('field_bench',[0,0,0]);assert(table.ok);
  const battery=await w.place('battery',[0,1,0]);assert(battery.ok,battery.reason);
  assert.equal(w.dismantle(table.id).reason,'supporting_fixture');assert.equal(p.count('field_bench'),0);
  assert(w.dismantle(battery.id).ok);assert(w.dismantle(table.id).ok);assert.equal(p.count('field_bench'),1);
});

test('async loading cannot race past the 256 fixture limit',async()=>{
  const p=economy();give(p,{battery:256,motor:1});const w=await world(p);
  for(let n=0;n<255;n++){const placed=await w.place('battery',[n*2,0,0]);assert(placed.ok);}
  const results=await Promise.all([w.place('battery',[1000,0,0]),w.place('motor',[1004,0,0])]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).reason,'fixture_limit');assert.equal(w.records.size,256);
  assert.equal(p.count('battery')+p.count('motor'),1);
});

test('external actor or rotated-machine overlap rejects before any item is consumed',async()=>{
  const p=economy();give(p,{battery:1});const queries=[];const w=await world(p,{externalOverlap:(box,options)=>{queries.push({box,options});return true;}});
  assert.equal((await w.place('battery',[0,0,0])).reason,'external_occupied');assert.equal(p.count('battery'),1);assert.equal(w.records.size,0);
  assert(queries.length>0);assert.equal(queries[0].options.ignoreOwnerId,'fixture:1');assert(Array.isArray(queries[0].box.center));
});

test('geometry and access caches invalidate at exact range boundary and every dynamic pose',async()=>{
  const p=economy();give(p,{field_bench:1,battery:1});const w=await world(p),table=await w.place('field_bench',[0,0,0]);
  const bound=w._geometry(w.records.get(table.id)).bounds.max[0];w.syncAccess([bound+4-.001,.5,0]);assert(p._station('field_bench'));
  w.syncAccess([bound+4+.001,.5,0]);assert.equal(p._station('field_bench'),false,'2mm crossing must not be skipped by a movement threshold');
  const battery=await w.place('battery',[4,0,0]),record=w.records.get(battery.id);assert(w.solidAt([4,.3,0]));const first=w._geometry(record);
  w._makeDynamic(record,'test');w.setPhysicsPose(battery.id,{position:{x:5,y:0,z:0},rotation:{x:0,y:0,z:0,w:1},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0},settled:false});
  assert.notEqual(w._geometry(record),first);assert.equal(w.solidAt([4,.3,0]),null);assert(w.solidAt([5,.3,0]));
});
