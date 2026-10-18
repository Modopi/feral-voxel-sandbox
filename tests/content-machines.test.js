import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { MachineSystem } from '../app/src/main/assets/content-runtime/machines.js';
import { assertAuthoringInvariant } from '../app/src/main/assets/content-runtime/voxel/authoring.js';
const CONTENT=Object.fromEntries(['progression','environments','blocks'].map(n=>[n,JSON.parse(fs.readFileSync(new URL(`../design/content/${n}.json`,import.meta.url)))]));
let n=0;
const grant=(p,items)=>assert.equal(p.grant(items,{claimId:'fixture:'+n++}).ok,true);
function known(p,id){const c=p.catalog.get(id);p.discover(p.catalog.get(c.research).blueprint,{origin:'discovery',claimId:'knowledge:'+n++});}
function fixture(){const p=new Progression(CONTENT),s=new MachineSystem(CONTENT,p);grant(p,{wood:20,raw_timber:2,heat_engine:1,transmission:1,controller:1});for(const id of ['heat_engine','transmission','controller'])known(p,id);const m=s.create({position:[0,0,0],gridM:.1}).machineId;const voxels=[];for(let x=0;x<3;x++)voxels.push(s.attachVoxel(m,{cell:[x,0,0],materialId:'wood'}).voxelId);const engine=s.installComponent(m,voxels[0],'heat_engine').componentInstanceId,wheel=s.installComponent(m,voxels[1],'transmission',{legacyType:'wheel'}).componentInstanceId;const controller=s.installComponent(m,voxels[2],'controller').componentInstanceId;assert.equal(s.connect(m,engine,wheel,'mechanical').ok,true);return {p,s,m,voxels,engine,wheel,controller};}
test('SDK placement debits exact material volume and is separate from component functions',()=>{
 const p=new Progression(CONTENT),s=new MachineSystem(CONTENT,p),m=s.create({gridM:.5}).machineId;
 assert.equal(s.attachVoxel(m,{cell:[0,0,0],materialId:'wood'}).ok,false);
 grant(p,{wood:125});const v=s.attachVoxel(m,{cell:[0,0,0],materialId:'wood'});assert.equal(v.ok,true);assert.equal(v.costLiters,125);assert.equal(p.count('wood'),0);
 assert.ok(Math.abs(s.evaluate(m).mass-75)<1e-8);assert.equal(s.machines.get(m).components.length,0);
 assertAuthoringInvariant(s.sceneModels()[0].model);
 assert.equal(s.attachVoxel(m,{cell:[0,0,0],materialId:'wood'}).reason,'occupied');
 assert.equal(s.removeVoxel(m,v.voxelId).ok,true);assert.equal(p.count('wood'),125);
});
test('finite paid fuel moves a real connected cart and stops providing power when exhausted',()=>{
 const {p,s,m,engine}=fixture();assert.equal(s.refuel(m,engine,1).ok,true);assert.equal(p.count('raw_timber'),1);
 s.control(m,{throttle:1});s.tick(10);assert.ok(s.machines.get(m).position.z>.1);assert.ok(s.evaluate(m).powerEUPerSecond>0);
 const state=s.serialize(),ps=p.serialize();const restored=new MachineSystem(CONTENT,new Progression(CONTENT,ps),state);
 restored.tick(11);assert.equal(restored.evaluate(m).powerEUPerSecond,0);assert.ok(restored.machines.get(m).position.z>s.machines.get(m).position.z);
 const q=restored.machines.get(m).metrics;assert.ok(Math.abs(q.generated-q.consumed-q.loss)<1e-5);assert.ok(Math.abs(q.generated-400)<1e-5);
});
test('ports must be explicit; disconnected motor shape produces no propulsion',()=>{
 const {s,m,engine,wheel}=fixture();assert.equal(s.connect(m,wheel,engine,'electrical').ok,false);
 const link=s.machines.get(m).links[0].id;s.disconnect(m,link);s.refuel(m,engine,1);s.control(m,{throttle:1});s.tick(1);
 assert.equal(s.evaluate(m).powerEUPerSecond,0);assert.equal(s.machines.get(m).position.z,0);
 assert.equal(s.installComponent(m,s.machines.get(m).voxels[2].id,'controller',{legacyType:'rotor'}).ok,false);
});
test('destroying a bridge separates structural groups, preserves momentum and cuts cross-fragment ports',()=>{
 const {s,m,voxels,engine}=fixture();s.refuel(m,engine,1);s.control(m,{throttle:1});s.tick(1);
 const before=s.machines.get(m).velocity.z;assert.equal(s.damage(m,voxels[1],100).destroyed,true);
 assert.equal(s.machines.size,2);for(const machine of s.machines.values()){assert.equal(machine.entityType,'machine');assert.equal(machine.links.length,0);assert.equal(machine.velocity.z,before);assertAuthoringInvariant(machine.asset);}
});
test('cargo actually leaves inventory, adds mass and can be returned exactly once per request',()=>{
 const {p,s,m}=fixture();grant(p,{steel:2});const before=s.evaluate(m).mass;
 assert.equal(s.loadCargo(m,{steel:2}).ok,true);assert.equal(p.count('steel'),0);assert.ok(Math.abs(s.evaluate(m).mass-before-15.6)<1e-8);
 assert.equal(s.unloadCargo(m,{steel:2}).ok,true);assert.equal(s.unloadCargo(m,{steel:2}).ok,false);assert.equal(p.count('steel'),2);
});
test('liquid transfer needs a powered pump, preserves litres, and uses inventory fuel',()=>{
 const p=new Progression(CONTENT),s=new MachineSystem(CONTENT,p);grant(p,{wood:4,heat_engine:1,fluid_container:2,pump:1,water:4,raw_timber:1});for(const id of ['heat_engine','fluid_container','pump'])known(p,id);
 const m=s.create().machineId;const v=[];for(let x=0;x<4;x++)v.push(s.attachVoxel(m,{cell:[x,0,0],materialId:'wood'}).voxelId);
 const engine=s.installComponent(m,v[0],'heat_engine').componentInstanceId,a=s.installComponent(m,v[1],'fluid_container').componentInstanceId,pump=s.installComponent(m,v[2],'pump').componentInstanceId,b=s.installComponent(m,v[3],'fluid_container').componentInstanceId;
 s.fillFluid(m,a,'water',4);s.connectFluid(m,a,pump,b);s.tick(1);assert.equal(s.machines.get(m).components.find(c=>c.id===b).fluids.water||0,0);
 s.connect(m,engine,pump,'mechanical');s.refuel(m,engine,1);s.tick(3);
 const components=s.machines.get(m).components,from=components.find(c=>c.id===a).fluids.water,to=components.find(c=>c.id===b).fluids.water;
 assert.ok(to>0);assert.ok(Math.abs(from+to-4)<1e-8);assert.equal(p.count('water'),0);assert.equal(p.count('raw_timber'),0);
});
test('external physics advances fuel exactly once and persists live corrected pose without geometry rebuilds',()=>{
 const {s,p,m,engine}=fixture();s.refuel(m,engine,1);s.control(m,{throttle:1});const row=s.sceneModels()[0],revision=row.revision;
 s.setPhysicsDriver({});s.tick(1);assert.equal(s.clock,0);assert.equal(s.machines.get(m).components.find(c=>c.id===engine).fuelItems,1);
 assert.deepEqual(s.preparePhysicsStep(1/60,{activeIds:[]}),[]);
 const packet=s.preparePhysicsStep(1/60)[0];assert.ok(packet.force.z>0);assert.equal(packet.force.y,0);assert.equal(row.position.z,0);
 const state={position:{x:1,y:3,z:4},velocity:{x:0,y:-2,z:5},rotation:{x:0,y:0,z:0,w:1},angularVelocity:{x:0,y:2,z:0}};
 assert.equal(s.acceptPhysicsState(m,state).ok,true);assert.equal(row.position.z,4);assert.equal(s.sceneModels()[0].revision,revision);
 const restored=new MachineSystem(CONTENT,p,s.serialize());assert.deepEqual(restored.machines.get(m).rotation,state.rotation);assert.deepEqual(restored.machines.get(m).angularVelocity,state.angularVelocity);
 const masses=s.physicsMasses(m);assert.ok(Math.abs(Object.values(masses.voxelMasses).reduce((a,b)=>a+b,0)+masses.cargoMassKg-s.evaluate(m).mass)<1e-8);
});
test('placement rejects external collisions before debit; repair consumes missing material and damage events replay once',()=>{
 const {s,p,m,voxels}=fixture();const wood=p.count('wood');s.setPhysicsDriver({canPlaceVoxel:()=>false});
 assert.equal(s.attachVoxel(m,{cell:[3,0,0]}).reason,'external_collision');assert.equal(p.count('wood'),wood);
 const v=s.machines.get(m).voxels[0],hit=v.hp/2;
 assert.equal(s.applyDamageEvent(m,'cast:a',{[voxels[0]]:hit}).ok,true);assert.equal(s.applyDamageEvent(m,'cast:a',{[voxels[0]]:hit}).duplicate,true);
 assert.equal(s.repair(m,voxels[0]).ok,true);assert.ok(Math.abs(p.count('wood')-wood+.5)<1e-8);assert.equal(v.hp,v.maxHp);
 const restore=new MachineSystem(CONTENT,p,s.serialize());assert.equal(restore.applyDamageEvent(m,'cast:a',{[voxels[0]]:hit}).duplicate,true);
});
test('manual push cannot create motion without an actual finite mechanical energy debit',()=>{
 const p=new Progression(CONTENT),s=new MachineSystem(CONTENT,p);grant(p,{wood:1,inertial_cell:1});known(p,'inertial_cell');p.placeComponent('inertial_cell');
 const m=s.create().machineId;s.attachVoxel(m,{});s.control(m,{push:1});s.tick(1);assert.equal(s.machines.get(m).position.z,0);
 p.supplyEnergy('mechanical',.5,{claimId:'manual-work-source'});s.tick(1);assert.ok(s.machines.get(m).position.z>0);assert.ok(p.energy.mechanical<1e-8);assert.ok(Math.abs(s.machines.get(m).metrics.consumed-.5)<1e-8);
});
test('rotating fragments retain the tangential velocities of their new centers of mass',()=>{
 const p=new Progression(CONTENT),s=new MachineSystem(CONTENT,p);grant(p,{wood:3});const m=s.create().machineId;
 const ids=[0,1,2].map(x=>s.attachVoxel(m,{cell:[x,0,0]}).voxelId);const machine=s.machines.get(m);machine.angularVelocity.y=2;
 s.damage(m,ids[1],1);const fragments=[...s.machines.values()].sort((a,b)=>a.voxels[0].cell[0]-b.voxels[0].cell[0]);
 assert.equal(fragments.length,2);assert.ok(Math.abs(fragments[0].velocity.z-.2)<1e-8);assert.ok(Math.abs(fragments[1].velocity.z+.2)<1e-8);
});
