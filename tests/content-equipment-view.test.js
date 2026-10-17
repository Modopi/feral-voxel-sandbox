import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import {EquipmentView,createEquipmentSlot,selectHeldEquipment,equipmentAttackOffset} from '../app/src/main/assets/content-runtime/equipment-view.js';
const content=JSON.parse(readFileSync(new URL('../design/content/progression.json',import.meta.url)));
const ids=[...Array.from({length:10},(_,n)=>'gear_baseline_t'+(n+1)),'hand_knife','stone_pick','bark_cup'];
const models=new Map(ids.map(id=>[id,JSON.parse(readFileSync(new URL(`../design/assets/models/${id}.voxel.json`,import.meta.url)))]));
function runtime(items={},equipped=null){return {progression:{catalog:new Map(content.entries.map(e=>[e.id,e])),equipped,inventory:items,count(id){return this.inventory[id]??0;}},player:{x:0,y:0,z:0,hp:100,resting:false},lastStrike:0,harvestAction:null};}
function scene(){return {camera:new T.PerspectiveCamera(72,1,.05,320),scene:new T.Scene()};}
function near(a,b){for(let n=0;n<3;n++)assert(Math.abs(a[n]-b[n])<1e-8,`${a} != ${b}`);}

test('all 10 gear and 3 tool models align their declared hand anchors without altering canonical pivots',()=>{
  for(const id of ids){const asset=models.get(id);for(const slot of asset.equipmentSlots.filter(s=>['main_hand','off_hand','tool_hand'].includes(s.slot))){
    const m=createEquipmentSlot(asset,slot.slot);m.group.position.set(.3,-.4,-.8);m.group.rotation.set(-.5,.2,.1);m.group.updateMatrixWorld(true);
    const anchor=m.parts.get(m.anchor.partId).localToWorld(new T.Vector3(...m.anchor.position));near(anchor.toArray(),m.group.position.toArray());
    for(const p of asset.parts)near(m.parts.get(p.id).position.toArray(),p.translation);
    for(const mesh of m.meshes){assert(mesh.userData.visualOnly);assert.equal(mesh.renderOrder,1000);assert.equal(mesh.material.depthWrite,false);const hits=[];mesh.raycast({},hits);assert.equal(hits.length,0);}
    if(slot.slot==='main_hand')assert(m.meshes.every(mesh=>mesh.userData.partId==='weapon'));
    if(slot.slot==='off_hand')assert(m.meshes.every(mesh=>mesh.userData.partId==='shield'));
    m.dispose();
  }}
});

test('selection respects ownership, active required harvesting tool and all equipped tiers',()=>{
  for(let tier=1;tier<=10;tier++){const id='gear_baseline_t'+tier;const r=runtime({[id]:1},id);assert.deepEqual(selectHeldEquipment(r).map(x=>x.slot),['main_hand','off_hand']);delete r.progression.inventory[id];assert.deepEqual(selectHeldEquipment(r),[]);}
  const r=runtime({gear_baseline_t4:1,hand_knife:1,stone_pick:1,bark_cup:1},'gear_baseline_t4');
  r.harvestAction={sourceId:'source_water',elapsed:1};assert.equal(selectHeldEquipment(r)[0].assetId,'bark_cup');
  delete r.progression.inventory.bark_cup;assert.deepEqual(selectHeldEquipment(r),[],'missing required cup is not replaced with a weapon');
  r.harvestAction={sourceId:'source_iron_ore',elapsed:1};assert.equal(selectHeldEquipment(r)[0].assetId,'stone_pick');
  r.harvestAction=null;r.heldToolId='unknown_tool';assert.deepEqual(selectHeldEquipment(r),[]);
  r.heldToolId='hand_knife';assert.equal(selectHeldEquipment(r)[0].assetId,'hand_knife');
  r.player.hp=0;assert.deepEqual(selectHeldEquipment(r),[]);
});

test('camera-held attack, harvesting and rest animation is read-only and disposes replaced geometry',async()=>{
  const s=scene(),r=runtime({gear_baseline_t5:1,bark_cup:1},'gear_baseline_t5'),v=new EquipmentView(s,{load:async id=>models.get(id)});
  await v.sync(r,1/60);assert.equal(v.root.parent,s.camera);assert.equal(s.camera.parent,s.scene);assert.equal(v.models.length,2);
  const before=JSON.stringify(r.progression.inventory),restRotation=v.models[0].group.rotation.x;
  r.lastStrike=1;await v.sync(r,.1);assert.notEqual(v.models[0].group.rotation.x,restRotation);assert.equal(JSON.stringify(r.progression.inventory),before);
  let disposed=0;for(const m of v.models)for(const mesh of m.meshes)mesh.geometry.addEventListener('dispose',()=>disposed++);
  r.harvestAction={sourceId:'source_water',elapsed:.2};await v.sync(r,.1);assert(disposed>0);assert.equal(v.models.length,1);assert.equal(v.models[0].asset.id,'bark_cup');
  const y=v.models[0].group.position.y;r.player.resting=true;await v.sync(r,.1);assert(v.models[0].group.position.y<y-.1);
  assert.equal(JSON.stringify(r.progression.inventory),before);assert.equal(r.player.hp,100);assert.equal(r.harvestAction.elapsed,.2);
  v.dispose();assert.equal(v.root.parent,null);assert.equal(v.models.length,0);
});

test('late asset loads and errors never restore stale equipment or silently substitute another model',async()=>{
  const pending=new Map(),s=scene(),r=runtime({stone_pick:1,bark_cup:1}),v=new EquipmentView(s,{load:id=>new Promise(resolve=>pending.set(id,resolve))});
  r.heldToolId='stone_pick';const old=v.sync(r,0);r.heldToolId='bark_cup';const newest=v.sync(r,0);
  pending.get('bark_cup')(models.get('bark_cup'));await newest;assert.equal(v.models[0].asset.id,'bark_cup');
  pending.get('stone_pick')(models.get('stone_pick'));await old;assert.equal(v.models[0].asset.id,'bark_cup');v.dispose();
  const broken=structuredClone(models.get('stone_pick'));broken.equipmentSlots=[];
  const bad=new EquipmentView(scene(),{load:async()=>broken});r.heldToolId='stone_pick';await bad.sync(r,0);assert.equal(bad.models.length,0);assert.match(bad.lastError.message,/Missing equipment slot/);bad.dispose();
});

test('disposing while loading prevents later camera children and geometry allocation',async()=>{
  let resolve;const s=scene(),v=new EquipmentView(s,{load:()=>new Promise(r=>resolve=r)}),r=runtime({stone_pick:1});
  const ready=v.sync(r,0);v.dispose();resolve(models.get('stone_pick'));await ready;assert.equal(v.root.parent,null);assert.equal(v.models.length,0);
});


test('strike, pierce and impact have distinct pure offsets and restore the original grip',()=>{
  const strike=equipmentAttackOffset('strike',.19),pierce=equipmentAttackOffset('pierce',.19),impact=equipmentAttackOffset('impact',.19);
  assert(strike.position[0]>0);assert.equal(pierce.position[0],0);assert(pierce.position[2]<strike.position[2]);assert.notDeepEqual(impact,strike);
  assert(equipmentAttackOffset('impact',.38*.175).position[1]>0,'impact raises the held weapon first');assert(impact.position[1]<0,'impact then strikes downward');
  for(const style of ['strike','pierce','impact'])for(const age of [0,.38,1,Infinity])assert.deepEqual(equipmentAttackOffset(style,age),{position:[0,0,0],rotation:[0,0,0]});
});

test('attack style is captured per strike, preserves state and returns both hands to their original grips',async()=>{
  const r=runtime({gear_baseline_t1:1},'gear_baseline_t1'),v=new EquipmentView(scene(),{load:async id=>models.get(id)});await v.sync(r,0);
  const baseline=v.models.map(m=>({position:m.group.position.toArray(),rotation:m.group.rotation.toArray()}));
  for(const [n,style]of ['strike','pierce','impact'].entries()){
    r.player.attackStyle=style;r.lastStrike=n+1;const snapshot=JSON.stringify(r);await v.sync(r,0);v.strikeAge=.19;v._pose(r,0);assert.equal(v.strikeStyle,style);assert.equal(JSON.stringify(r),snapshot);
    assert.notDeepEqual(v.models[0].group.position.toArray(),baseline[0].position);near(v.models[1].group.position.toArray(),baseline[1].position);
    r.player.attackStyle='changed-after-strike';v._pose(r,0);assert.equal(v.strikeStyle,style);
    v.strikeAge=.38;v._pose(r,0);for(let i=0;i<v.models.length;i++){near(v.models[i].group.position.toArray(),baseline[i].position);assert.deepEqual(v.models[i].group.rotation.toArray(),baseline[i].rotation);}
  }
  v.dispose();
});
