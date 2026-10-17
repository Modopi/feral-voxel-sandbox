import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import { traceCombatModel } from '../app/src/main/assets/content-runtime/combat-trace.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
function model() {
 const group=new T.Group(),parts=new Map(),asset={materials:[{id:'skin',penetrationResistanceEUPerM:20},{id:'bone',penetrationResistanceEUPerM:100}],parts:[]};
 for(const [id,z,size,material] of [['shell',0,[1,1,.2],'skin'],['core',.35,[.3,.3,.3],'bone']]){
  const n=new T.Group();n.position.z=z;group.add(n);parts.set(id,n);asset.parts.push({id,translation:[0,0,z],boxes:[{center:[0,0,0],size,material}]});
 }
 return {group,parts,asset,desc:{id:'target',kind:'creature',position:{x:0,y:0,z:0}}};
}
const packet={from:{x:0,y:0,z:-2},to:{x:0,y:0,z:2},ownerId:'target',energyEU:100,amount:40};
test('strike HP budget reaches surface; pierce and impulse reach actual internal part with no duplicate energy',()=>{
 const m=model(),strike=traceCombatModel(m,{...packet,mode:'strike'});
 assert.equal(strike.effectiveAmount,40);assert.deepEqual(strike.hits.map(h=>h.partId),['shell']);
 for(const mode of ['pierce','impact']){
  const p=traceCombatModel(m,{...packet,mode});assert(p.hits.some(h=>h.partId==='core'&&h.amount>0));
  assert(Math.abs(p.hits.reduce((n,h)=>n+h.amount,0)-40)<1e-7);
  assert(Math.abs(p.hits.reduce((n,h)=>n+h.energyEU,0)-100)<1e-7);assert.equal(p.effectiveAmount,40);
 }
});
test('resistant front shell stops internal damage; thickness, finite depth and exact rotation matter',()=>{
 const m=model();m.asset.materials[0].penetrationResistanceEUPerM=1000;
 const stopped=traceCombatModel(m,{...packet,mode:'pierce'});assert(!stopped.hits.some(h=>h.partId==='core'));assert.equal(stopped.effectiveAmount,40);
 m.asset.materials[0].penetrationResistanceEUPerM=20;m.parts.get('core').position.z=1.8;
 assert(!traceCombatModel(m,{...packet,mode:'pierce'}).hits.some(h=>h.partId==='core'));
 m.group.rotation.y=Math.PI/2;m.group.position.set(4,1,0);
 const q=traceCombatModel(m,{...packet,from:{x:2,y:1,z:0},to:{x:6,y:1,z:0},mode:'pierce'});assert(q.effectiveAmount>0);
 assert.equal(traceCombatModel(m,packet).effectiveAmount,0,'old AABB coordinates must not hit rotated translated model');
});
test('real Rapier external cuboid blocks all modes before owner while exact gaps remain open',async()=>{
 const runtime={atlas:{revision:0,isSolidCell:()=>false},player:{x:0,y:0,z:-2},nearbyStructures:[]};
 const physics=await RuntimePhysics.create(runtime,null,{terrainRadius:1});
 try{
  const m=model();physics.synchronize(new Map([['target',m]]),runtime.player);physics.step(1/60);
  assert(physics.traceCombat({...packet,mode:'pierce'}).effectiveAmount>0);
  physics.adapter.addBody({ownerId:'external',type:'fixed',boxes:[{center:[0,0,-1],size:[1,1,.2]}]});physics.step(1/60);
  for(const mode of ['strike','pierce','impact']){const p=physics.traceCombat({...packet,mode});assert(p.blocked);assert.equal(p.effectiveAmount,0);}
  physics.adapter.removeOwner('external');physics.adapter.addBody({ownerId:'external',type:'fixed',boxes:[{center:[-.7,0,-1],size:[.5,1,.2]},{center:[.7,0,-1],size:[.5,1,.2]}]});physics.step(1/60);
  assert(physics.traceCombat({...packet,mode:'impact'}).effectiveAmount>0);
 }finally{physics.dispose();}
});
