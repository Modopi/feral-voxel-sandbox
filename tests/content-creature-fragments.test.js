import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { CreatureSystem } from '../app/src/main/assets/content-runtime/creatures.js';
import { WorldObjects } from '../app/src/main/assets/content-runtime/objects.js';
import { CreatureFragments,allocateCreatureMass,captureCreaturePose,CREATURE_MASS_POLICY } from '../app/src/main/assets/content-runtime/creature-fragments.js';
import { animateCreatureModel } from '../app/src/main/assets/content-runtime/creature-animation.js';
import { VoxelAssetBuilder,assertAuthoringInvariant } from '../app/src/main/assets/content-runtime/voxel/authoring.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
const load=id=>JSON.parse(fs.readFileSync(new URL(`../design/assets/models/${id}.voxel.json`,import.meta.url)));
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const atlas=()=>({getCell:()=>null,setCell:()=>true,isSolidCell:(_x,y)=>y<0,heightAt:()=>0,revision:0});
function record(e,asset=load(e.speciesId)){
 const group=new T.Group(),parts=new Map();group.position.set(e.x,e.y,e.z);group.rotation.y=e.yaw;
 for(const part of asset.parts){const node=new T.Group();node.userData.part=part;parts.set(part.id,node);}
 for(const part of asset.parts)(part.parent===null?group:parts.get(part.parent)).add(parts.get(part.id));
 const r={asset,group,parts,desc:{id:e.id,kind:'creature',entity:e}};animateCreatureModel(r,e,2,0);return r;
}
function setup(species='moss_deer',state={}){
 const a=atlas(),creatures=new CreatureSystem(CONTENT,{seed:12,state:state.creatures}),objects=new WorldObjects(CONTENT,a,state.objects);
 const e=creatures.entities[0]??creatures.spawn(species,{x:2,y:3,z:0}),models=new Map([[e.id,record(e)]]);
 const bridge=new CreatureFragments(CONTENT,creatures,objects,{getModelRecord:id=>models.get(id)});bridge.sync(models);
 return {a,creatures,objects,e,models,bridge};
}
function sever(r,part){const hp=r.e.parts[part].hp;return r.creatures.damage(r.e.id,hp+.001,part);}
const snapshot=r=>JSON.parse(JSON.stringify({creatures:r.creatures.serialize(),objects:r.objects.serialize()}));

test('all 34 authored SDK species allocate exactly existing mass with one owner for joint union volume',()=>{
 for(const species of CONTENT.creatures.entries){const asset=load(species.id),a=allocateCreatureMass(asset,species.body.massKg);
  assert.equal(a.policy,CREATURE_MASS_POLICY);near(Object.values(a.parts).reduce((n,p)=>n+p.massKg,0),species.body.massKg);
  near(Object.values(a.parts).reduce((n,p)=>n+p.ownedVolumeM3,0),a.unionVolumeM3);
  for(const part of asset.parts)if(part.boxes.length){assert(a.parts[part.id].massKg>0);near(a.parts[part.id].boxMassesKg.reduce((n,v)=>n+v,0),a.parts[part.id].massKg);}
 }
 const asset=load('moss_deer'),base={...asset,id:'overlap',visualGridM:1,parts:[{id:'root',parent:null,translation:[0,0,0],boxes:[]}],anchors:[]},builder=new VoxelAssetBuilder(base);
 builder.addPart({id:'first'});builder.addPart({id:'second',translation:[1,0,0]});
 for(const id of ['first','second'])builder.addBox(id,{center:[1,.5,.5],size:[2,1,1],material:'coat'});
 const a=allocateCreatureMass(builder.toJSON(),30);near(a.unionVolumeM3,3);near(a.parts.first.massKg,10);near(a.parts.second.massKg,20);
});

test('actual animated leg transfers source boxes, posed world transform and exact budget to a new inert owner',()=>{
 const r=setup();r.e.pose.moving=true;r.e.pose.phase=1.2;animateCreatureModel(r.models.get(r.e.id),r.e,2,0);
 const original=captureCreaturePose(r.models.get(r.e.id),r.e),hp=r.e.hp,calories=r.e.calories;
 const expected=r.e.fragmentMass.parts.left_foreleg.massKg;const result=sever(r,'limb_0');assert.equal(result.dead,false);
 assert.equal(r.objects.objects.size,1);const object=[...r.objects.objects.values()][0];
 assert.notEqual(object.id,r.e.id);assert.equal(object.entityType,'object');assert.equal(object.fragment.sourcePartId,'left_foreleg');assert.equal(object.fragment.lootOwnerId,r.e.id);
 assert.deepEqual(object.position,original.parts.left_foreleg.position);assert.deepEqual(object.rotation,original.parts.left_foreleg.rotation);
 near(object.massKg,expected);near(r.e.massKg+object.massKg,r.e.fragmentMass.totalMassKg);assert(r.e.hp<hp);assert.equal(r.e.calories,calories);assert.equal(r.creatures.corpses.size,0);
 assertAuthoringInvariant(object.asset);assert.deepEqual(object.asset.parts[0].boxes,r.models.get(r.e.id).asset.parts.find(p=>p.id==='left_foreleg').boxes);
 assert.equal('inventory'in object,false);assert.equal('hp'in object,false);assert.equal('calories'in object,false);
 animateCreatureModel(r.models.get(r.e.id),r.e,3,0);assert.equal(r.models.get(r.e.id).parts.get('left_foreleg').visible,false);
 r.bridge.sync(r.models);assert.equal(r.objects.objects.size,1);near(r.creatures.massForVisualPart(r.e.id,'left_foreleg'),0);
});

test('physics snapshot overrides source animation with actual clamped body pose and inherited velocity',()=>{
 const r=setup(),physics={position:{x:4,y:5,z:6},rotation:{x:0,y:0,z:0,w:1},velocity:{x:2,y:3,z:4},angularVelocity:{x:.1,y:.2,z:.3}};
 r.bridge.getPartPhysics=(_id,part)=>part==='left_foreleg'?physics:null;sever(r,'limb_0');
 const o=[...r.objects.objects.values()][0];for(const k of ['position','rotation','velocity','angularVelocity'])assert.deepEqual(o[k],physics[k]);
});

test('multiple cuts and save restoration conserve total mass with idempotent fragment claims and one corpse reward',()=>{
 let r=setup();sever(r,'limb_0');sever(r,'limb_1');
 const saved=snapshot(r);r=setup('moss_deer',saved);assert.equal(r.objects.objects.size,2);r.bridge.sync(r.models);assert.equal(r.objects.objects.size,2);
 sever(r,'head');assert.equal(r.e.dead,false);assert.equal(r.creatures.corpses.size,0);r.creatures.damage(r.e.id,r.e.hp,'body');assert.equal(r.e.dead,true);assert.equal(r.creatures.corpses.size,1);
 const total=[...r.objects.objects.values()].reduce((n,o)=>n+o.massKg,0);near(r.e.massKg+total,85);
 const corpse=r.creatures.corpses.get(`corpse:${r.e.id}`),drops=structuredClone(corpse.drops);r.bridge.sync(r.models);assert.deepEqual(corpse.drops,drops);
 const objectCount=r.objects.objects.size;r=setup('moss_deer',snapshot(r));assert.equal(r.objects.objects.size,objectCount);assert.equal(r.creatures.corpses.size,1);
 assert.equal(r.creatures.damage(r.e.id,100,'head').ok,false);assert.equal(r.objects.objects.size,objectCount);
});

test('internal core failure preserves living exterior and mass while reducing functions',()=>{
 const r=setup('wayfarer_organic');sever(r,'core');assert.equal(r.e.dead,false);near(r.e.massKg,72);
 assert.equal(r.objects.objects.size,0);assert.equal(r.creatures.corpses.size,0);assert.equal(r.e.parts.core.broken,true);assert.equal(r.e.parts.core.detached,false);
 animateCreatureModel(r.models.get(r.e.id),r.e,3,0);assert(r.models.get(r.e.id).parts.get('torso').visible);
 assert.equal(r.creatures._structure(r.e).functions.attack,false);assert(r.e.pose.speedFactor>0&&r.e.pose.speedFactor<1);
});

test('offscreen damage survives save and lazily reconstructs its recorded pre-cut pose once',()=>{
 const a=atlas(),creatures=new CreatureSystem(CONTENT,{seed:12}),objects=new WorldObjects(CONTENT,a),e=creatures.spawn('gale_raptor',{x:8,y:6,z:-4});
 e.pose.phase=2;e.pose.moving=true;const before=structuredClone(e);creatures.damage(e.id,e.parts.limb_0.hp/.65+.001,'limb_0');assert.equal(e.fragmentCuts.length,1);assert.equal(e.fragmentCuts[0].processed,false);
 const c2=new CreatureSystem(CONTENT,{seed:12,state:JSON.parse(JSON.stringify(creatures.serialize()))}),e2=c2.get(e.id),r=record(e2),b=new CreatureFragments(CONTENT,c2,objects),models=new Map([[e.id,r]]);
 const oldRecord=record(before);animateCreatureModel(oldRecord,before,0,0);const expected=captureCreaturePose(oldRecord,before);
 b.sync(models);assert.equal(objects.objects.size,1);const object=[...objects.objects.values()][0];
 assert.deepEqual(object.position,expected.parts['wing_-1'].position);assert.deepEqual(object.rotation,expected.parts['wing_-1'].rotation);
 b.sync(models);assert.equal(objects.objects.size,1);assert.equal(e2.fragmentCuts[0].processed,true);assert.equal(e2.fragmentCuts[0].before,null);
 b.dispose();assert.equal(models.size,1,'bridge disposal must not clear caller scene models');
});

test('mass ledger conflicts and overdraw never create a duplicate fragment or alter world sources',()=>{
 const r=setup();sever(r,'limb_0');const original=[...r.objects.objects.values()][0],f=original.fragment,ledger=r.e.fragmentMass;
 const packet={sourceOwnerId:r.e.id,sourcePartId:f.sourcePartId,claimId:f.claimId,asset:original.asset,position:original.position,rotation:original.rotation,
  allocation:{policy:f.policy,allocationId:f.allocationId,totalMassKg:f.totalMassKg,massKg:f.massKg,boxMassesKg:f.boxMassesKg},sourceLedger:ledger};
 assert.equal(r.objects.spawnFragment(packet).duplicate,true);assert.equal(r.objects.objects.size,1);
 const before=JSON.stringify(r.objects.serialize());assert.equal(r.objects.spawnFragment({...packet,claimId:'other'}).reason,'mass_already_transferred');
 assert.equal(r.objects.spawnFragment({...packet,allocation:{...packet.allocation,massKg:900}}).reason,'invalid_mass_ledger');assert.equal(JSON.stringify(r.objects.serialize()),before);
});

test('real SDK limb reaches actual Rapier cuboids with exact mass, falls, and preserves its landed pose across saves',async()=>{
 const r=setup();sever(r,'limb_0');const object=[...r.objects.objects.values()][0],initialY=object.position.y;
 const rt={atlas:r.a,objects:r.objects,creatures:r.creatures,player:{x:0,y:.02,z:0},nearbyStructures:[]};
 const physics=await RuntimePhysics.create(rt,null,{terrainRadius:2});
 try{
  physics.synchronize(new Map(),rt.player);const entry=physics.objectPhysics.bodies.get(object.id).entry;
  near(entry.body.mass(),object.massKg,1e-5);assert.equal(entry.colliders.length,object.boxes.length);assert(entry.body.isCcdEnabled());
  for(let i=0;i<180;i++)physics.step(1/60);
  assert(object.position.y<initialY-1);assert(Math.abs(object.velocity.y)<.2);const saved=snapshot(r),restored=setup('moss_deer',saved),o2=restored.objects.get(object.id);
  assert.deepEqual(o2.position,object.position);for(const k of ['x','y','z','w'])near(o2.rotation[k],object.rotation[k],1e-12);near(o2.massKg,object.massKg);near(restored.e.massKg+o2.massKg,85);
 }finally{physics.dispose();}
});

test('all 34 actual species survive internal core failure without exterior loss or duplicate mass',()=>{
 for(const species of CONTENT.creatures.entries){const r=setup(species.id);sever(r,'core');assert.equal(r.e.dead,false,species.id);near(r.e.massKg,species.body.massKg);
  assert.equal(r.objects.objects.size,0);assert.equal(r.creatures.corpses.size,0);assert.equal(r.creatures._structure(r.e).functions.attack,false);
  const hp=r.e.hp;r.bridge.sync(r.models);assert.equal(r.e.hp,hp);near(r.e.massKg,species.body.massKg);
 }
});
