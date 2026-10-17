import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, mkdir, readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {CONTENT} from '../app/src/main/assets/content-runtime/catalog.generated.js';
import {ExpeditionRuntime} from '../app/src/main/assets/content-runtime/runtime.js';
import {WorldAtlas} from '../app/src/main/assets/content-runtime/atlas.js';
import {CreatureSystem} from '../app/src/main/assets/content-runtime/creatures.js';
import {ExpeditionSave} from '../app/src/main/assets/content-runtime/save.js';
import {ExpeditionScene, T} from '../app/src/main/assets/content-runtime/scene.js';
import {buildResourceAsset} from '../app/src/main/assets/content-runtime/props.js';

// Thresholds are fixed before measurement. These are deterministic state-model
// probes; coordinate assignment/material grants are not normal-play evidence.
const LIMITS={defaultActiveChunks:96,stressActiveChunks:4,outdoor:48,predators:8,corpses:32,resources:48,
  twoGenerationUtf16Bytes:5*1024*1024,deathRecords:128,objects:16,offlineSeconds:7200};
const POINTS=[... [1024,8192,32768].flatMap(n=>[[n,n/2],[-n,n/2],[n/2,-n],[-n,-n]])];
const evidence={schemaVersion:1,limits:LIMITS,points:POINTS,runs:[],
  scope:'Pure Node state-model probes with direct player coordinate assignment and explicit setup material grants. Not normal-play travel, GPU/model memory, Android or mobile memory evidence.'};
const clone=x=>structuredClone(x);
const storage=()=>{const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const countKinds=rows=>Object.fromEntries([...new Set(rows.map(r=>r.kind))].map(k=>[k,rows.filter(r=>r.kind===k).length]));
function counts(runtime) {
  const rows=runtime.descriptors(),living=runtime.creatures.visibleEntities(runtime.player).filter(e=>!e.dead&&!e.dungeonId);
  assert(living.length<=LIMITS.outdoor);
  assert(living.filter(e=>runtime.creatures.species.get(e.speciesId).role==='predator').length<=LIMITS.predators);
  assert(runtime.creatures.visibleCorpses(runtime.player).length<=LIMITS.corpses);
  assert(rows.filter(r=>r.kind==='resource').length<=LIMITS.resources);
  assert(runtime.atlas.activeChunks.size<=LIMITS.defaultActiveChunks);
  return {position:[runtime.player.x,runtime.player.z],activeChunks:runtime.atlas.activeChunks.size,
    pendingChunks:runtime.atlas.pendingChunkCount,chunkJobs:runtime.atlas._jobs.size,
    descriptors:countKinds(rows),regions:runtime.creatures.regions.size,entities:runtime.creatures.entities.length,
    corpses:runtime.creatures.corpses.size,seenRegions:runtime.seenRegions.size,structures:runtime.dungeons.instances.size,
    objects:runtime.objects.objects.size,edits:runtime.atlas.edits.size};
}
function stream(atlas,x,z,options={}) {
  let calls=0;
  do {
    atlas.loadAround(x,z,{radiusChunks:0,verticalRadius:0,chunkBudget:4,workBudgetMs:Infinity,maxCellsPerLoad:32768,...options});
    assert(atlas.activeChunks.size<=atlas.maxActiveChunks);
    assert(atlas.lastLoadWork.processedCells<=32768);
    assert(++calls<=64,'incremental chunk loading failed to converge');
  }while(atlas.pendingChunkCount>0);
  return calls;
}
function move(runtime,[x,z]) {
  Object.assign(runtime.player,{x,z,y:runtime.atlas.heightAt(x,z)+.05});
  runtime.refreshWorld();
  stream(runtime.atlas,x,z);
  return counts(runtime);
}
after(async()=>{
  if(!process.env.FERAL_STREAMING_REPORT)return;
  evidence.generatedAt=new Date().toISOString();evidence.node=process.version;
  evidence.codeHashes=Object.fromEntries(await Promise.all(['runtime.js','atlas.js','creatures.js','scene.js','save.js'].map(async name=>[name,createHash('sha256').update(await readFile(new URL('../app/src/main/assets/content-runtime/'+name,import.meta.url))).digest('hex')])));
  await mkdir(dirname(process.env.FERAL_STREAMING_REPORT),{recursive:true});
  await writeFile(process.env.FERAL_STREAMING_REPORT,JSON.stringify(evidence,null,2)+'\n');
});

test('far signed-coordinate roundtrip retains mining, damage, fixtures, deaths and object owners', async()=>{
  const start=performance.now();let runtime=await ExpeditionRuntime.create(31415);
  const initial=counts(runtime);
  // Exercise the real timed terrain harvest path with a deterministic cell fixture.
  runtime.atlas.setCell(0,80,0,'log');Object.assign(runtime.player,{x:0,y:40,z:0});
  const hit={kind:'terrain',point:{x:.25,y:40.5,z:.25},normal:{x:0,y:1,z:0},distance:1};
  const node=runtime.terrainResource(hit);assert(node);
  assert(runtime.beginHarvest(node).ok);
  const source=runtime.progression.catalog.get(node.sourceId);
  for(let elapsed=0;elapsed<source.seconds+.25;elapsed+=.25)runtime.tick(.25);
  assert.equal(runtime.atlas.getCell(0,80,0),null);assert.equal(runtime.harvestAction,null);
  runtime.atlas.setCell(-65,80,-65,'stone');
  const instance=runtime.nearbyStructures.find(s=>s.templateId==='root_manor');assert(instance);
  const box=runtime.dungeons.renderBoxes(instance.id).find(b=>b.collision&&b.size.every(v=>v>=.5));
  const destroyed=box.center.map(v=>Math.floor(v*2)/2+.25);
  assert(runtime.dungeons.damageAt(destroyed,1e6).ok);assert.equal(runtime.dungeons.solidAt(destroyed),null);

  // Paid APIs consume explicit test inventory; no claim of a researched playthrough.
  runtime.progression.grant({field_bench:1,wood:2},{claimId:'streaming:fixture-materials'});
  for(let x=-20;x<=-12;x++)for(let z=-20;z<=-12;z++)runtime.atlas.setCell(x,79,z,'stone');
  const placed=await runtime.placements.place('field_bench',[-8,40,-8]);assert(placed.ok,placed.reason);
  const fixture=runtime.placements.records.get(placed.id);runtime.placements.damage(placed.id,fixture.maxHp/4);
  const made=runtime.machines.create({name:'streaming machine',position:{x:8,y:40,z:0},gridM:.1});assert(made.ok);
  assert(runtime.machines.attachVoxel(made.machineId,{cell:[0,0,0],materialId:'wood'}).ok);
  for(let i=0;i<LIMITS.objects;i++){
    const x=16+i*4;runtime.atlas.setCell(x,100,0,'log');runtime.atlas.setCell(x,101,0,'leaves');
    const detached=runtime.objects.detachAround([x,99,0]);assert.equal(detached.objects.length,1);
    const object=detached.objects[0];
    assert(runtime.objects.setPhysicsPose(object.id,{position:{x:i+10,y:41,z:4},rotation:{x:0,y:0,z:0,w:1},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}}));
  }
  assert.equal(runtime.objects.objects.size,LIMITS.objects);
  const victim=runtime.creatures.entities.find(e=>!e.civilization&&!e.dead);assert(victim);
  runtime.creatures.damage(victim.id,1e6);assert(runtime.creatures.claimDrops(victim.id,runtime.progression).ok);
  for(let i=0;i<LIMITS.deathRecords;i++){
    runtime.progression.grant({wood:1},{claimId:`streaming:death-material:${i}`});
    Object.assign(runtime.player,{x:100+i*12,y:50,z:-500});runtime.die();
    if(i%2===0){const death=runtime.deaths.at(-1);Object.assign(runtime.player,death.position);assert(runtime.recoverDeath(death));}
  }
  const expected={deaths:clone(runtime.deaths),objects:runtime.objects.serialize(),fixture:clone(fixture),
    machine:runtime.machines.serialize(),claims:[...runtime.progression.claims],harvestClaims:clone(runtime.progression.serialize().harvestClaims),
    victim:clone(runtime.creatures.get(victim.id)),inventory:clone(runtime.progression.inventory)};
  const outbound=POINTS.map(point=>move(runtime,point));
  const outwardCounts=counts(runtime),outwardIds=new Set(runtime.creatures.entities.map(e=>e.id));
  const outwardBytes=Buffer.byteLength(JSON.stringify(runtime.serialize()));
  const returnRows=[...POINTS].reverse().map(point=>move(runtime,point));move(runtime,[0,0]);
  const returned=counts(runtime);
  assert.equal(returned.regions,outwardCounts.regions);assert.equal(returned.entities,outwardCounts.entities);
  assert.deepEqual(new Set(runtime.creatures.entities.map(e=>e.id)),outwardIds);
  for(let i=0;i<5;i++){runtime.refreshWorld();runtime.descriptors();}
  assert.equal(runtime.creatures.entities.length,outwardCounts.entities,'stationary refresh cannot duplicate residents');
  const store=storage(),save=new ExpeditionSave(store,'streaming');const snapshot=runtime.serialize();
  save.write(snapshot);save.write(snapshot);
  const envelopeCharacters=[...store.values.values()].reduce((n,s)=>n+s.length,0);
  assert(envelopeCharacters*2<LIMITS.twoGenerationUtf16Bytes,'two-generation UTF-16 budget exceeded');
  assert.deepEqual(save.load(),snapshot);
  runtime=await ExpeditionRuntime.create(31415,save.load());
  assert.equal(runtime.atlas.getCell(0,80,0),null);assert.equal(runtime.atlas.getCell(-65,80,-65),'stone');
  assert.equal(runtime.dungeons.solidAt(destroyed),null);
  assert.deepEqual(runtime.deaths,expected.deaths);assert.deepEqual(runtime.objects.serialize(),expected.objects);
  assert.deepEqual(runtime.placements.records.get(placed.id),expected.fixture);
  assert.deepEqual(runtime.machines.serialize(),expected.machine);
  assert.deepEqual([...runtime.progression.claims],expected.claims);
  assert.deepEqual(runtime.progression.serialize().harvestClaims,expected.harvestClaims);
  assert.deepEqual(runtime.creatures.get(victim.id),expected.victim);
  assert(runtime.creatures.claimDrops(victim.id,runtime.progression).duplicate);
  assert.deepEqual(runtime.progression.inventory,expected.inventory);
  for(const death of runtime.deaths.filter(d=>d.recovered))assert.equal(runtime.recoverDeath(death),false);
  assert.deepEqual(runtime.progression.inventory,expected.inventory);
  const reloaded=counts(runtime);assert.equal(reloaded.entities,returned.entities);assert.equal(reloaded.regions,returned.regions);
  evidence.runs.push({name:'roundtrip',elapsedMs:performance.now()-start,initial,outbound,returnRows,returned,reloaded,
    outwardJsonUtf8Bytes:outwardBytes,finalJsonUtf8Bytes:Buffer.byteLength(JSON.stringify(snapshot)),twoGenerationCharacters:envelopeCharacters,
    twoGenerationEstimatedUtf16Bytes:envelopeCharacters*2,
    retainedState:'Visited ecology regions, species owners, corpses, structure instances, player edits and claims remain resident and serialized. No paging/eviction of persistent ecology is asserted.'});
});

test('chunk caps, signed floor boundaries and headless model pruning stay bounded across travel', async()=>{
  const atlas=new WorldAtlas(CONTENT,{seed:63026,maxActiveChunks:LIMITS.stressActiveChunks}),rows=[];
  for(const [i,[x,z]]of [[0,0],[-.01,-.01],[-16,-16],[32768,-32768],[-32768,32768],[0,0]].entries()){
    const hx=Math.floor(x*2),hz=Math.floor(z*2);atlas.setCell(hx,101,hz,i%2?'stone':'log');
    stream(atlas,x,z,{radiusChunks:1,y:50.5});
    assert.equal(atlas.activeChunks.size,LIMITS.stressActiveChunks);
    for(const c of atlas.activeChunks.values()){
      assert(Math.abs(c.cx-Math.floor(x/16))<=1);assert(Math.abs(c.cz-Math.floor(z/16))<=1);
    }
    assert.equal(atlas.getCell(hx,101,hz),i%2?'stone':'log');
    const editedChunk=atlas.activeChunks.get(`${Math.floor(hx/32)},3,${Math.floor(hz/32)}`);
    assert(editedChunk);
    const offset=(hx-editedChunk.cx*32)+(hz-editedChunk.cz*32)*32+(101-96)*1024;
    assert.equal(atlas.palette[editedChunk.blocks[offset]],i%2?'stone':'log','signed chunk buffers include persisted edits');
    assert.equal(atlas._jobs.size,0);
    assert(atlas._columns.size<=8192&&atlas._samples.size<=8192&&atlas._hashes.size<=32768&&atlas._noiseCorners.size<=4096);
    rows.push({position:[x,z],activeChunks:atlas.activeChunks.size,jobCount:atlas._jobs.size,
      columns:atlas._columns.size,samples:atlas._samples.size,hashes:atlas._hashes.size,edits:atlas.edits.size});
  }
  const restored=new WorldAtlas(CONTENT,{seed:63026,state:atlas.serialize(),maxActiveChunks:4});
  assert.equal(restored.activeChunks.size,0);assert.deepEqual(restored.serialize(),atlas.serialize());
  const scene=Object.create(ExpeditionScene.prototype);
  Object.assign(scene,{geometryCache:new Map(),models:new Map(),pending:new Set(),wanted:new Map(),scene:new T.Scene()});
  const asset=buildResourceAsset('source_raw_timber');
  for(let i=0;i<20;i++){
    const descriptor={id:`streaming-model:${i}`,assetId:asset.id,asset,kind:'resource',position:{x:i*1024,y:0,z:-i*1024}};
    scene.wanted=new Map([[descriptor.id,descriptor]]);await scene.makeModel(descriptor);scene.syncModels([descriptor],0);
    assert.equal(scene.models.size,1);assert.equal(scene.pending.size,0);assert.equal(scene.scene.children.length,1);
  }
  scene.syncModels([],0);assert.equal(scene.models.size,0);assert.equal(scene.scene.children.length,0);
  for(const list of scene.geometryCache.values())for(const mesh of list){mesh.geometry.dispose();mesh.material.dispose();}
  evidence.runs.push({name:'bounded-transient-state',rows,headlessModelsVisited:20,maxSimultaneousHeadlessModels:1,
    limitation:'Headless scene graph allocation/release only. No WebGL renderer, GPU memory or all-model total cap is asserted.'});
});

test('two-hour inactive ecology catches up once and preserves pending time and identities on reload', async()=>{
  const runtime=await ExpeditionRuntime.create(31415),sys=runtime.creatures,start=performance.now();
  const before={time:sys.time,entities:sys.entities.length,regions:sys.regions.size,ids:sys.entities.map(e=>e.id)};
  const result=sys.advanceOffline(LIMITS.offlineSeconds+300,{terrain:runtime.terrain});
  assert.equal(result.processedSeconds,LIMITS.offlineSeconds);assert.equal(result.remainingSeconds,300);
  assert.equal(sys.time,before.time+LIMITS.offlineSeconds);
  const state=sys.serialize(),loaded=new CreatureSystem(CONTENT,{seed:31415,terrain:runtime.terrain,state});
  assert.deepEqual(loaded.serialize(),state);
  for(const id of before.ids)assert(loaded.get(id),'owner history must survive death or migration');
  assert.equal(new Set(loaded.entities.map(e=>e.id)).size,loaded.entities.length);
  const pending=loaded.advanceOffline(0,{terrain:runtime.terrain});assert.equal(pending.processedSeconds,300);
  assert.equal(pending.remainingSeconds,0);assert.equal(loaded.time,before.time+7500);
  const final=loaded.serialize();loaded.advanceOffline(0);assert.deepEqual(loaded.serialize(),final);
  for(const e of loaded.entities){assert(Number.isFinite(e.hp)&&e.hp>=0);if(e.calories!==null)assert(Number.isFinite(e.calories)&&e.calories>=0);}
  evidence.runs.push({name:'inactive-ecology',elapsedMs:performance.now()-start,before,
    after:{time:loaded.time,entities:loaded.entities.length,dead:loaded.entities.filter(e=>e.dead).length,regions:loaded.regions.size,corpses:loaded.corpses.size},
    processedSeconds:result.processedSeconds,pendingProcessedSeconds:pending.processedSeconds,
    limitation:'Biology catch-up API only; not 2h full player/physics/render simulation. Inactive ecology updates every 60s but currently scans retained owner maps every 0.25s.'});
});
