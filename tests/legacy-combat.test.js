import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../app/src/main/assets/world.js';
import { Ecology, SPECIES, toWorld, cellPosition, condition } from '../app/src/main/assets/entities.js';
import { animalSkeleton } from '../app/src/main/assets/animal-skeleton.js';
import { boneHealth } from '../app/src/main/assets/structural-body.js';
function fixture(){const w=new World(2);w.surface=()=>10;const eco=new Ecology(w),e=eco.spawn(0,77,87);e.yaw=0;e.moving=0;e.phase=0;eco.rehash();return{w,eco,e};}
function shell(e,part,voxel){return{entity:e,part,voxel,layer:'shell',point:toWorld(e,SPECIES[e.type].parts[part],part,cellPosition(SPECIES[e.type].parts[part],voxel),0)};}
test('legacy ordinary exterior hits alone kill by HP with preserved skeleton; HP saves between hits',()=>{
 const {w,eco,e}=fixture();const skeleton=JSON.stringify(e.structure);
 eco.damageHit(shell(e,0,0),0,.001,12);assert.equal(e.hp,36);assert.equal(e.dead,false);assert.equal(JSON.stringify(e.structure),skeleton);
 const loaded=new Ecology(w);loaded.load(JSON.parse(JSON.stringify(eco.save())));const r=loaded.entities[0];assert.equal(r.hp,36);
 for(const voxel of [1,2,3])loaded.damageHit(shell(r,0,voxel),0,.001,12);
 assert.equal(r.hp,0);assert(r.dead);assert.equal(r.deathCause,'외피 타격');
});
test('legacy core and brain fractures change function without forced death or whole-body disappearance',()=>{
 for(const region of ['root','brain']){
  const {eco,e}=fixture();e.hp=e.maxHP=200;const model=animalSkeleton(SPECIES[e.type]),id=model[region],node=model.byId.get(id);
  eco.damageHit({...shell(e,node.part,node.voxel),layer:'structure',node:id},0,.01,30);
  assert.equal(boneHealth(model,e.structure,id),0);assert(e.hp>0);assert.equal(e.dead,false);
  eco.think(e,.1);assert.equal(e.dead,false,'think must not turn a structural flag into death');
  if(region==='root'){assert.equal(e.lost,0);assert.equal(condition(e).mode,'immobile');}
 }
});
test('legacy spear ray reaches covered bone in one attack and applies its HP budget only once',()=>{
 const {eco,e}=fixture();e.hp=e.maxHP=200;
 const at=shell(e,2,0).point,origin={x:at[0],y:at[1],z:at[2]-1},direction={x:0,y:0,z:1};
 const hit=eco.ray(origin,direction,2,0);assert.equal(hit.layer,'shell');assert(hit.rayDirection);
 const model=animalSkeleton(SPECIES[e.type]),before=boneHealth(model,e.structure,'2:0');
 eco.damageHit(hit,0,.01,24,{attackMode:'pierce'});
 assert.equal(e.hp,176);assert(boneHealth(model,e.structure,'2:0')<before);assert(e.damage[2][0]===0);
});
test('legacy impact weapon and physical collisions distribute one finite HP and structural budget',()=>{
 for(const mode of ['weapon','collision']){
  const {eco,e}=fixture();e.hp=e.maxHP=200;const hit=shell(e,2,0),point={x:hit.point[0],y:hit.point[1],z:hit.point[2]};
  if(mode==='weapon')eco.damageHit(hit,0,.01,24,{attackMode:'impact'});else{const receipt=eco.impact(e,point,2400,0);assert.equal(receipt.damage,24);assert(receipt.absorbedEnergy+receipt.internalEnergy+receipt.unspentEnergy<=2400+1e-8);}
  assert.equal(e.hp,176);const model=animalSkeleton(SPECIES[e.type]);assert(boneHealth(model,e.structure,'2:0')<24);
 }
 const {eco,e}=fixture(),hit=shell(e,2,0),point={x:hit.point[0],y:hit.point[1],z:hit.point[2]};
 eco.impact(e,point,100,0);assert.equal(e.hp,47);assert.equal(boneHealth(animalSkeleton(SPECIES[0]),e.structure,'2:0'),24);
});
