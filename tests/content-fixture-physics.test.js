import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import R from '../app/src/main/assets/vendor/rapier/rapier.js';
import {AssetCollisionWorld} from '../app/src/main/assets/content-runtime/voxel/physics.js';
import {WorldPlacements} from '../app/src/main/assets/content-runtime/placements.js';
import {FixturePhysicsBridge} from '../app/src/main/assets/content-runtime/fixture-physics.js';
import {Progression} from '../app/src/main/assets/content-runtime/progression.js';
const content={progression:JSON.parse(fs.readFileSync(new URL('../design/content/progression.json',import.meta.url)))};
const assets=new Map(['battery','field_bench'].map(id=>[id,JSON.parse(fs.readFileSync(new URL(`../design/assets/models/${id}.voxel.json`,import.meta.url)))]));
await R.init();
function economy(state){const p=new Progression(content,state??{});for(const r of p.entries.filter(e=>e.kind==='research'))p.research.add(r.id);return p;}
async function system({state=null,pState=null,level=0}={}){
  const ground={level,isSolidCell(_x,y){return y*.5<this.level;}};
  const p=economy(pState),placements=new WorldPlacements(content,p,{atlas:ground,assets,state});await placements.ready;
  const world=new R.World({x:0,y:-9.81,z:0}),adapter=new AssetCollisionWorld(R,world),physics={world,adapter,fixtures:new Map(),runtime:{placements,player:{x:0,y:1,z:0}}};
  const bridge=new FixturePhysicsBridge(physics);
  function floor(y){ground.level=y;adapter.removeOwner('ground');adapter.addBody({ownerId:'ground',type:'fixed',boxes:[{center:[0,y-.25,0],size:[40,.5,40]}]});}
  floor(level);
  return {p,placements,physics,bridge,ground,floor,step(n){for(let i=0;i<n;i++){bridge.sync();adapter.step(1/60);bridge.capture();}},dispose(){bridge.dispose();adapter.dispose();world.free();}};
}

test('support loss replaces fixed owner with actual dynamic compound, falls and lands without granting function',async()=>{
  const s=await system();try{
    s.p.grant({battery:1},{claimId:'battery'});const {id}=await s.placements.place('battery',[0,0,0]);s.placements.syncAccess([0,0,1]);assert(s.p.hasComponent('battery'));
    const hp=s.placements.records.get(id).hp;s.physics.adapter.addBody({ownerId:id,type:'fixed',boxes:s.placements.collisionBoxes()});s.physics.fixtures.set(id,'fixed');
    s.floor(-3);s.bridge.sync();assert(s.placements.isDynamic(id));assert.equal(s.physics.fixtures.has(id),false);assert.equal(s.physics.adapter.entries.filter(e=>e.ownerId===id).length,1);
    const b=s.bridge.bodies.get(id).entry,body=s.placements.physicsBodies()[0];assert.equal(b.colliders.length,body.boxes.length);
    assert(Math.abs(b.body.mass()-body.massKg)<1e-4);assert.equal(s.p.hasComponent('battery'),false);
    s.step(480);const landed=s.placements.records.get(id);assert(landed.position[1]<-2.8&&landed.position[1]>-3.05,JSON.stringify(landed.position));assert.equal(landed.hp,hp);assert.equal(landed.motion.mode,'dynamic');assert(landed.motion.settled);assert.equal(s.p.count('battery'),0);
    for(const c of b.colliders){const meta=s.physics.adapter.ownershipForCollider(c);assert.equal(meta.ownerId,id);assert(body.boxes.some(x=>x.partId===meta.partId&&x.material===meta.materialId));}
  }finally{s.dispose();}
});

test('mid-fall save reload retains owner, authored mass, health, quaternion and momentum then lands',async()=>{
  const a=await system();let state,pState,id;
  try{a.p.grant({battery:1},{claimId:'battery'});id=(await a.placements.place('battery',[0,0,0])).id;a.placements.damage(id,3);a.floor(-3);a.step(12);state=a.placements.serialize();pState=a.p.serialize();assert(state.fixtures[0].motion.velocity.y<-.5);}finally{a.dispose();}
  const b=await system({state,pState,level:-3});try{
    const before=b.placements.records.get(id);assert.deepEqual(before.position,state.fixtures[0].position);assert.deepEqual(before.motion.rotation,state.fixtures[0].motion.rotation);assert.equal(before.hp,state.fixtures[0].hp);assert.equal(b.p.count('battery'),0);
    b.bridge.sync();assert(Math.abs(b.bridge.bodies.get(id).entry.body.linvel().y-state.fixtures[0].motion.velocity.y)<1e-5);
    b.step(480);assert(b.placements.records.get(id).position[1]<-2.8);assert.equal(b.placements.records.size,1);assert.equal(b.p.assemblies.filter(x=>x.worldOwnerId===id).length,1);
  }finally{b.dispose();}
});

test('rotated solids use OBB occupancy and allow objects in the empty corners of their AABB',async()=>{
  const s=await system();try{
    s.p.grant({battery:2},{claimId:'two'});const id=(await s.placements.place('battery',[0,0,0])).id;s.placements._makeDynamic(s.placements.records.get(id),'test_rotation');
    const q={x:0,y:Math.sin(Math.PI/8),z:0,w:Math.cos(Math.PI/8)};
    assert(s.placements.setPhysicsPose(id,{position:{x:0,y:0,z:0},rotation:q,velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0},settled:true}).ok);
    assert.equal(s.placements.solidAt([.34,.02,.34]),null);assert.equal(s.placements.solidAt([0,.3,0]).ownerId,id);
    const adjacent=await s.placements.place('battery',[.5,0,.5]);assert(adjacent.ok,adjacent.reason);
    const rotated=s.placements.collisionBoxes().find(b=>b.ownerId===id);assert.deepEqual(rotated.rotation,q);
    s.bridge.sync();const rot=s.bridge.bodies.get(id).entry.body.rotation();assert(Math.abs(rot.y-q.y)<1e-6);
  }finally{s.dispose();}
});

test('destroyed supporting fixture releases its stack under original owners and preserves upper HP',async()=>{
  const s=await system();try{
    s.p.grant({field_bench:1,battery:1},{claimId:'stack'});const base=(await s.placements.place('field_bench',[0,0,0])).id,upper=(await s.placements.place('battery',[0,1,0])).id;
    const hp=s.placements.records.get(upper).hp;s.placements.damage(base,s.placements.records.get(base).maxHp);
    assert.deepEqual(new Set(s.placements.checkSupports()),new Set([base,upper]));assert.equal(s.placements.records.get(upper).hp,hp);
    s.bridge.sync();assert.equal(s.bridge.bodies.size,2);assert.equal(s.placements.descriptors().filter(d=>d.fixed).length,0);
  }finally{s.dispose();}
});

test('legacy placement saves migrate to fixed identity; invalid rotation and velocity are rejected',async()=>{
  const s=await system();try{
    s.p.grant({battery:1},{claimId:'one'});await s.placements.place('battery',[0,0,0]);const legacy=s.placements.serialize();delete legacy.fixtures[0].motion;
    const old=new WorldPlacements(content,economy(),{atlas:s.ground,assets,state:legacy});await old.ready;assert.equal(old.descriptors()[0].fixed,true);
    const bad=s.placements.serialize();bad.fixtures[0].motion.rotation.w=0;assert.throws(()=>new WorldPlacements(content,economy(),{atlas:s.ground,assets,state:bad}),/fixture motion/);
  }finally{s.dispose();}
});
