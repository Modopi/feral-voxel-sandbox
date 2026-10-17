import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DungeonSystem } from '../app/src/main/assets/content-runtime/dungeons.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { WorldAtlas } from '../app/src/main/assets/content-runtime/atlas.js';
const document = name => JSON.parse(readFileSync(new URL(`../design/content/${name}.json`, import.meta.url)));
const catalog = Object.fromEntries(['blocks','structures','progression','environments','bosses','creatures'].map(name=>[name,document(name)]));
const assets = Object.fromEntries(catalog.structures.entries.map(e=>[e.id,JSON.parse(readFileSync(new URL(`../design/assets/models/${e.id}.voxel.json`,import.meta.url)))]));
const world = (i,p) => p.map((v,k)=>v+i.origin[k]);
const make = (options={})=>new DungeonSystem({catalog,seed:33,assets,...options});
const fakeAtlas = () => ({ reservations:new Map(),heightAt:()=>4,reserveArea(id,box){this.reservations.set(id,box);},findBuildingSites:()=>[] });
const input = (p,items) => p.grantReward({guaranteed:items},{claimId:'test-source:'+JSON.stringify(items)});

test('all 12 structures expose all 84 rooms, translated entrances, spawn and boss anchors',()=>{
  const d=make();let rooms=0;
  for(const [index,template] of catalog.structures.entries.entries()){
    const i=d.ensureInstance(template.id,'all-'+index,[index*384,4,1000],10);
    assert.equal(i.regionTier,10);assert.equal(i.tier,template.prototypeTier??10);
    assert(d.hasAssetModel(template.id));
    for(const room of template.rooms){rooms++;const entered=d.enter(i.id,world(i,room.centerM.map((v,k)=>k===1?v+.5:v)));assert.equal(entered.ok,true);assert.equal(entered.roomId,room.id);}
    const anchors=d.anchors(i.id);assert.equal(anchors.filter(a=>a.kind==='entrance').length,template.entrances.length);
    assert.equal(anchors.filter(a=>a.kind==='spawn').length,template.rooms.reduce((n,r)=>n+r.spawnGroups.length,0));
    if(template.bossArena){const boss=anchors.find(a=>a.kind==='boss');assert.equal(boss.bossInstanceId,i.boss.instanceId);assert.deepEqual(boss.position,world(i,template.bossArena.bossSpawnM));}
    assert(d.renderBoxes(i.id).length>0);
  }
  assert.equal(rooms,84);assert.equal(d.serialize().instances.length,12);
});

test('starter manor has a deterministic walkable approach outside spawn; large buildings span chunks',()=>{
  const atlas=fakeAtlas(),d=make({atlas}),first=d.bootstrap().find(i=>i.templateId==='root_manor');
  assert.equal(first.origin[0],160);assert.equal(first.origin[1],4.5);
  const approach=atlas.reservations.get(first.id+':approach');assert.equal(approach.minX,0);assert.equal(approach.maxX,154);
  const front=d.anchors(first.id).find(a=>a.id==='entrance:front');assert.deepEqual(front.position,[154,4.5,0]);
  assert.equal(d.roomAt(first.id,[0,4.5,0]),null);
  const chunks=new Set();for(let x=7;x<19;x++)if(d.instancesInChunk(x,0,16).some(i=>i.id===first.id))chunks.add(x);assert(chunks.size>=7);
  assert.deepEqual(make({atlas:fakeAtlas()}).bootstrap(),d.bootstrap());
});

test('enter -> install joint -> supply held work -> defeat boss -> claim once -> damage -> reload',()=>{
  const d=make(),p=new Progression(catalog),i=d.ensureInstance('root_manor','run',[64,2,0]);
  assert.equal(d.enter(i.id,world(i,[0,.5,0])).first,true);
  const puzzle=d.anchors(i.id).find(a=>a.kind==='puzzle'),gate=world(i,[37.25,1.25,.25]);
  assert.equal(d.interact(i.id,puzzle.id,{position:puzzle.position,progression:p}).kind,'device');
  d.update(10);assert.equal(i.puzzle.phase,'locked');input(p,{joint:1});
  const anchor=d.definition(i.id).puzzle.componentAnchors[0];
  assert.equal(d.devices.act(i.id,`install:${anchor.id}`,{position:puzzle.position,progression:p,claimId:'install-joint'}).ok,true);assert.equal(p.count('joint'),0);
  assert.equal(d.devices.act(i.id,'lift_gate',{position:puzzle.position,progression:p}).ok,true);assert(d.solidAt(gate));
  d.update(1,{manualInstanceId:i.id,position:puzzle.position,progression:p});const restored=make({state:d.serialize()}),p2=new Progression(catalog,p.serialize());
  assert.equal(restored.get(i.id).deviceState.work.progressM,1);
  restored.update(3.5,{manualInstanceId:i.id,position:puzzle.position,progression:p2});assert.equal(restored.get(i.id).puzzle.phase,'open');assert.equal(restored.solidAt(gate),null);
  const bossAnchor=restored.anchors(i.id).find(a=>a.channel==='boss');
  assert.equal(restored.interact(i.id,bossAnchor.id,{position:bossAnchor.position,progression:p2}).reason,'boss_alive');
  assert.equal(restored.enter(i.id,world(i,[82,.5,0])).bossInstanceId,i.boss.instanceId);
  assert.equal(restored.defeatBoss(i.id,'wrong-id').ok,false);assert.equal(restored.defeatBoss(i.id,i.boss.instanceId).ok,true);
  assert.equal(restored.interact(i.id,bossAnchor.id,{position:bossAnchor.position,progression:p2}).ok,true);
  assert.equal(p2.count('stone'),4);assert.equal(p2.energy.divine,10);
  assert.equal(restored.interact(i.id,bossAnchor.id,{position:bossAnchor.position,progression:p2}).duplicate,true);assert.equal(p2.count('stone'),4);
  const wall=world(i,[-6.25,1.25,-4.25]),before=restored.solidAt(wall);assert(before);
  assert.equal(restored.damageAt(wall,before.maxHp).removed,true);assert.equal(restored.solidAt(wall),null);
  const final=make({state:restored.serialize()}),p3=new Progression(catalog,p2.serialize());
  assert.equal(final.solidAt(wall),null);assert.equal(final.get(i.id).boss.defeated,true);assert.equal(final.claimReward(i.id,'boss',p3).duplicate,true);assert.equal(p3.count('stone'),4);
  const center=before.position;assert(!final.renderBoxes(i.id).filter(b=>b.collision).some(b=>center.every((v,k)=>v>b.center[k]-b.size[k]/2&&v<b.center[k]+b.size[k]/2)));
});

test('archive discovery unlocks research without boss or puzzle; out-of-range collection does not mutate',()=>{
  const d=make(),p=new Progression(catalog),i=d.ensureInstance('root_manor','archive',[0,0,200]);
  const anchor=d.anchors(i.id).find(a=>a.channel==='archive');
  assert.equal(d.interact(i.id,anchor.id,{position:[0,0,0],progression:p}).reason,'out_of_range');assert.equal(Object.keys(i.claims).length,0);
  const result=d.interact(i.id,anchor.id,{position:anchor.position,progression:p});assert.equal(result.ok,true);assert(p.research.has('joinery'));assert.equal(i.boss.defeated,false);assert.equal(i.puzzle.phase,'locked');
  const saved=d.serialize();assert.equal(make({state:saved}).claimReward(i.id,'archive',new Progression(catalog,p.serialize())).duplicate,true);
});

test('legacy paid openings finish without repayment while new saves never gain a timer shortcut',()=>{
  const d=make(),i=d.ensureInstance('root_manor','legacy',[0,0,0]);
  const state=d.serialize(),saved=state.instances[0];delete saved.deviceState;
  saved.puzzle={phase:'opening',paid:true,elapsedS:1,durationS:3};
  const loaded=make({state});assert.equal(loaded.get(i.id).deviceState.work.legacyProgressS,1);
  loaded.update(2);assert.equal(loaded.get(i.id).puzzle.phase,'open');assert.equal(loaded.solidAt([37.25,1.25,.25]),null);
  const reloaded=make({state:loaded.serialize()});reloaded.update(1);assert.equal(reloaded.get(i.id).puzzle.phase,'open');
  d.update(100);assert.equal(i.puzzle.phase,'locked');
});

test('four explicit boss variants preserve encounter tier and only override the one-time boss reward',()=>{
  for(const v of catalog.bosses.variants){
    const d=make(),template=catalog.structures.entries.find(e=>e.bossArena?.bossId===v.baseBossId);
    const i=d.ensureInstance(template.id,v.id,[0,0,0],v.tier),p=new Progression(catalog);
    assert.equal(i.boss.contentVariantId,v.id);assert.equal(i.boss.tier,v.tier);assert.equal(i.tier,template.prototypeTier);
    assert.equal(d.anchors(i.id).find(a=>a.kind==='boss').contentVariantId,v.id);
    assert(d.defeatBoss(i.id,i.boss.instanceId,v.rewardOverride).ok);
    const loaded=make({state:d.serialize()});assert(loaded.claimReward(i.id,'boss',p).ok);
    for(const [id,n]of Object.entries(v.rewardOverride.guaranteed))assert.equal(p.count(id),n);
    const inventory=structuredClone(p.inventory);assert(loaded.claimReward(i.id,'boss',p).duplicate);assert.deepEqual(p.inventory,inventory);
    assert(loaded.claimReward(i.id,'salvage',p).ok);
    const old=d.serialize();delete old.instances[0].boss.contentVariantId;delete old.instances[0].boss.rewardOverride;delete old.instances[0].boss.tier;
    assert.equal(make({state:old}).get(i.id).boss.tier,template.prototypeTier,'legacy encounter remains its original tier');
  }
});

test('destroying gate or entering alternate rooms never grants boss completion',()=>{
  const d=make(),i=d.ensureInstance('root_manor','breach',[0,0,0]),gate=[37.25,1.25,.25];assert(d.solidAt(gate));
  assert.equal(d.damageAt(gate,10000).removed,true);assert.equal(d.solidAt(gate),null);assert.equal(i.puzzle.phase,'locked');
  assert.equal(d.enter(i.id,[48,.5,0]).ok,true);assert.equal(i.boss.defeated,false);assert.equal(d.claimReward(i.id,'boss',new Progression(catalog)).reason,'boss_alive');
});

test('failed reward delivery leaves claim unconsumed; successful partial inventory uses progression overflow',()=>{
  const d=make(),i=d.ensureInstance('root_manor','transaction',[0,0,0]);
  assert.equal(d.claimReward(i.id,'salvage',{grantReward:()=>({ok:false,reason:'failed'})}).ok,false);assert.equal(i.claims.salvage,undefined);
  const p=new Progression(catalog);input(p,{stone:2304});assert.equal(d.claimReward(i.id,'salvage',p).ok,true);assert.equal(p.overflow.wood,4);assert.equal(p.overflow.plant_fiber,4);
  assert.equal(d.claimReward(i.id,'salvage',p).duplicate,true);assert.equal(p.overflow.wood,4);
});

test('small ruin reuses archive model and requires two persistent observations before research reward',()=>{
  const d=make(),p=new Progression(catalog),i=d.ensureInstance('communal_archive','ruin',[0,0,0],3,{variant:'small_ruin'});
  assert.equal(i.templateId,'communal_archive');assert.equal(d.claimReward(i.id,'archive',p).reason,'archive_observations_required');
  const anchors=d.anchors(i.id).filter(a=>a.kind==='inspect');assert.equal(anchors.length,2);
  assert.equal(d.interact(i.id,anchors[0].id,{position:anchors[0].position,progression:p}).solved,false);
  const reloaded=make({state:d.serialize()});assert.equal(reloaded.interact(i.id,anchors[1].id,{position:anchors[1].position,progression:p}).solved,true);
  assert.equal(reloaded.claimReward(i.id,'archive',p).ok,true);assert(p.research.size>0);assert.equal(reloaded.claimReward(i.id,'archive',p).duplicate,true);
});

test('basin and producer destruction emit one-way ecology events and persist through reload',()=>{
  const d=make({atlas:fakeAtlas()}),i=d.ensureInstance('root_manor','ecology',[0,4.5,0]);
  assert(d.fluidAt(world(i,[24,-.75,22])));
  const floor=world(i,[.25,-.25,-21.75]);assert(d.solidAt(floor));d.damageAt(floor,10000);
  assert(d.drainEvents().some(e=>e.type==='producer_destroyed'&&e.producerId==='root_manor_primary_producer'));
  const basinFloor=world(i,[24.25,-1.25,22.25]);assert(d.solidAt(basinFloor));d.damageAt(basinFloor,10000);assert.equal(d.fluidAt(world(i,[24,-.75,22])),null);
  const loaded=make({state:d.serialize()});assert.equal(loaded.get(i.id).waterBreached,true);assert.equal(loaded.get(i.id).producerStates.root_manor_primary_producer.destroyed,true);
});

test('Atlas reservation and generated sites are deterministic and preserve prototype combat tier',()=>{
  const atlas=new WorldAtlas(catalog,{seed:33}),d=make({atlas});
  const one=d.ensureNear({x:0,y:0,z:0},384);assert(one.some(i=>i.templateId==='root_manor'));
  const save=d.serialize(),aSave=atlas.serialize();const reloaded=make({atlas:new WorldAtlas(catalog,{state:aSave}),state:save});
  assert.deepEqual(reloaded.ensureNear([0,0,0],384).map(i=>i.id),one.map(i=>i.id));
  const impossible=d.ensureInstance('root_manor','far-tier10',[4000,2,0],10);assert.equal(impossible.regionTier,10);assert.equal(impossible.tier,2);
  const corrupt=d.serialize();corrupt.instances.find(x=>x.id===impossible.id).tier=10;assert.throws(()=>make({state:corrupt}),/티어/);
});

test('procedural footprints reject steep/wet/bypass sites and keep overlapping buildings apart',()=>{
  const atlas=fakeAtlas();atlas.sample=(x,z)=>({height:Math.abs(x-1000)/2,environmentId:'grove',waterLevel:null});
  const d=make({atlas});
  const site={id:'fit',templateId:'root_manor',environmentId:'grove',x:1000,z:1000};
  assert.equal(d._fitSite(site,1000,1000),null,'2m foundation budget rejects steep whole footprint');
  atlas.sample=()=>({height:4,environmentId:'grove',waterLevel:5});assert.equal(d._fitSite(site,1000,1000),null);
  atlas.sample=()=>({height:4,environmentId:'grove',waterLevel:null,safeBypass:true});assert.equal(d._fitSite(site,1000,1000),null);
  atlas.sample=()=>({height:4,environmentId:'grove',waterLevel:null});assert.deepEqual(d._fitSite(site,1000,1000),[1000,4.5,1000]);
  d.ensureInstance('root_manor','already',[1000,4.5,1000]);assert.equal(d._fitSite(site,1010,1000),null);
});

test('candidate retries are bounded and deterministic while existing placements survive reload',()=>{
  const site={id:'candidate',templateId:'root_manor',environmentId:'grove',x:1100,z:1100,tier:6};
  const atlas=()=>({...fakeAtlas(),sample:(x,z)=>({height:4,environmentId:'grove',waterLevel:null,safeBypass:x>1080&&x<1120}),findBuildingSites:()=>[site]});
  const a=make({atlas:atlas()}),b=make({atlas:atlas()});a.ensureNear([1100,4,1100],600);b.ensureNear([1100,4,1100],600);
  const placed=[...a.instances.values()].find(i=>i.siteId==='candidate');assert(placed);assert.deepEqual(placed.origin,[...b.instances.values()].find(i=>i.siteId==='candidate').origin);
  assert.equal(placed.tier,2);assert.equal(placed.regionTier,6);
  const loaded=make({atlas:atlas(),state:a.serialize()});loaded.ensureNear([1100,4,1100],600);assert.deepEqual(loaded.get(placed.id).origin,placed.origin);
});

test('cached broad phase retains every authored solid center and invalidates after new structures and asset replacement',()=>{
  const d=make();assert.deepEqual(d.instancesNear([1024,0,1024],4),[]);
  for(const [n,t]of catalog.structures.entries.entries()){
    const i=d.ensureInstance(t.id,'cache-'+n,[1024+n*384,0,1024]);assert(d.instancesNear(i.origin,4).some(s=>s.id===i.id));
    for(const box of d.renderBoxes(i.id).filter(b=>b.collision))assert(d.solidAt(box.center),`${t.id}/${box.partId} solid was lost by broad phase`);
  }
  const i=d.get('structure:33:cache-0:root_manor'),p=world(i,[-6.25,1.25,-4.25]);assert(d.solidAt(p));
  d.damageAt(p,d.solidAt(p).maxHp);assert.equal(d.solidAt(p),null,'removed cell invalidates without caching occupancy');
  const model=structuredClone(assets.root_manor);for(const part of model.parts)part.boxes=[];d.setAssetModel('root_manor',model);assert.equal(d.solidAt(world(i,[0,-.25,0])),null,'asset replacement invalidates per-model cuboids');
});
