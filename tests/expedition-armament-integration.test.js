import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTENT} from '../app/src/main/assets/content-runtime/catalog.generated.js';
import {Progression} from '../app/src/main/assets/content-runtime/progression.js';
import {Armaments} from '../app/src/main/assets/content-runtime/armaments.js';
import {ExpeditionRuntime} from '../app/src/main/assets/content-runtime/runtime.js';
import {selectHeldEquipment,createEquipmentSlot} from '../app/src/main/assets/content-runtime/equipment-view.js';
import {loadAsset} from '../app/src/main/assets/content-runtime/assets.generated.js';

test('runtime weapon damage, wear, nine-item death overflow and repeated save/recovery share one inventory identity',async()=>{
 const p=new Progression(CONTENT);p.grant({wood:30,plant_fiber:20,field_bench:1},{claimId:'prepared-weapon-materials'});
 assert(p.installStation('field_bench').ok);p.research.add('material:wood');
 const arms=new Armaments(p);
 for(let i=0;i<9;i++){
  const q=arms.quote('weapon_pierce','wood');assert(q.ok,q.reason);assert(arms.craft('weapon_pierce','wood').ok);
  let remaining=q.seconds;while(remaining>0){const dt=Math.min(60,remaining);arms.tick(dt);remaining-=dt;}
  if(i===0)assert(arms.equip(arms.weapons[0].id).ok);
 }
 const seed=31415,base=await ExpeditionRuntime.create(seed),state=base.serialize();state.progression=p.serialize();state.armaments=arms.serialize();state.time=1000;
 let rt=await ExpeditionRuntime.create(seed,state);const weapon=rt.armaments.loadout(),enemy=rt.creatures.spawn('moss_deer',{x:rt.player.x,y:rt.player.y,z:rt.player.z+1});
 const hp=enemy.hp;assert(rt.strike({kind:'creature',id:enemy.id,partId:'body',distance:1}).ok);
 assert(enemy.hp<hp);assert.equal(rt.armaments.loadout().durability,weapon.durability-1);assert.equal(rt.lastAttackMode,'pierce');
 assert.equal(selectHeldEquipment(rt)[0].assetId,'weapon_pierce');
 const originals=structuredClone(rt.armaments.weapons);Object.assign(rt.player,{x:100,z:100});rt.die();
 assert.equal(rt.armaments.weapons.length,0);assert.equal(rt.deaths[0].weapons.length,9);
 rt=await ExpeditionRuntime.create(seed,rt.serialize());const death=rt.deaths[0];Object.assign(rt.player,death.position);
 assert(rt.recoverDeath(death));assert.equal(rt.armaments.weapons.length,8);assert.equal(death.weapons.length,1);assert.equal(death.recovered,false);
 rt=await ExpeditionRuntime.create(seed,rt.serialize());assert(rt.armaments.equip(rt.armaments.weapons[0].id).ok);assert(rt.recoverDeath(rt.deaths[0]));
 assert.equal(rt.armaments.weapons.length,9);assert.equal(rt.deaths[0].recovered,true);assert.equal(rt.recoverDeath(rt.deaths[0]),false);
 assert.deepEqual(rt.armaments.weapons,originals);
 assert.equal(new Set(rt.armaments.weapons.map(w=>w.id)).size,9);
});

test('crafted weapon material changes only the held working surface and preserves canonical geometry',async()=>{
 const asset=await loadAsset('weapon_slash'),source=JSON.stringify(asset);
 const wood=createEquipmentSlot(asset,'main_hand',{materialId:'wood'}),steel=createEquipmentSlot(asset,'main_hand',{materialId:'steel'});
 try{
  const body=m=>m.meshes.find(mesh=>mesh.name.endsWith(':body')),handle=m=>m.meshes.find(mesh=>mesh.name.endsWith(':wood'));
  assert.notEqual(body(wood).material.color.getHex(),body(steel).material.color.getHex());
  assert.equal(body(wood).material.metalness,0);assert.equal(body(steel).material.metalness,.65);
  assert.equal(handle(wood).material.color.getHex(),handle(steel).material.color.getHex());
  assert.deepEqual([...body(wood).geometry.attributes.position.array],[...body(steel).geometry.attributes.position.array]);
  assert.equal(JSON.stringify(asset),source);
 }finally{wood.dispose();steel.dispose();}
});
