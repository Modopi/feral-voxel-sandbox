import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {WorldAtlas,deterministicUnit} from '../app/src/main/assets/content-runtime/atlas.js';
const content=Object.fromEntries(['environments','blocks','structures'].map(k=>[k,JSON.parse(fs.readFileSync(new URL(`../design/content/${k}.json`,import.meta.url)))]));
const create=(options={})=>new WorldAtlas(content,{seed:'atlas-regression',...options});
const loadSync=(atlas,x,z,options={})=>atlas.loadAround(x,z,{...options,workBudgetMs:Infinity,maxCellsPerLoad:Infinity});

test('atlas named random stream exactly matches SHA256 first 53 bits including negative/large coordinates',()=>{
 for(const parts of [['climate',0,0],['ore',-1,-32],['climate',4294967296,13],['한글',999999999999,0]]){
  const digest=crypto.createHash('sha256').update(JSON.stringify(['42','expedition-atlas-v1',...parts])).digest();
  const expected=(digest.readUInt32BE(0)*2097152+(digest.readUInt32BE(4)>>>11))/2**53;
  assert.equal(deterministicUnit(42,...parts),expected);assert.ok(expected>=0&&expected<1);
 }
 assert.notEqual(deterministicUnit(42,'x',0),deterministicUnit(42,'x',2**32));
});
test('initial spawn is dry grove tier one and starter resources are accessible without inventory grants',()=>{
 const a=create();for(const [x,z]of [[0,0],[12,-12],[-20,30]]){const s=a.sample(x,z);assert.equal(s.environmentId,'grove');assert.equal(s.height,4);assert.equal(s.waterLevel,null);assert.equal(s.hostileSpawnsAllowed,false);assert.equal(s.tier,1);}
 const nodes=a.harvestNodesAround(0,0,96);for(const [nodeId,count]of [['fallen_branch',8],['loose_stone',8],['fiber_patch',4],['berry_bush',6]])assert.equal(nodes.filter(n=>n.id.startsWith(`starter:${nodeId}:`)).length,count);
 assert.equal(a.fluidAt(80,-.5,24)?.type,'water');assert.equal(a.fluidAt(80,1,24),null);
 assert.equal(new Set(nodes.map(n=>n.id)).size,nodes.length);
});
test('negative chunk coordinates and exact boundaries map edits to unique cells and packed indices',()=>{
 const a=create({maxActiveChunks:3});const coordinates=[[-1,7,-1],[-32,7,-32],[-33,7,-33],[0,7,0],[31,7,31],[32,7,32]];
 for(const [i,p]of coordinates.entries())a.setCell(...p,i%2?'plank':'basalt');
 for(const p of coordinates){loadSync(a,p[0]*.5,p[2]*.5,{radiusChunks:0,y:3,chunkBudget:1});const c=[...a.activeChunks.values()][0];const x=p[0]-c.cx*32,y=p[1]-c.cy*32,z=p[2]-c.cz*32;assert.equal(c.palette[c.blocks[x+z*32+y*1024]],a.getCell(...p));}
 assert.equal(a.getCell(-2,7,-1),'grass');
});
test('edited terrain, deep cells and high construction survive unloading and JSON reload',()=>{
 const a=create({maxActiveChunks:2});const top=a.heightAt(-3,-3),hy=top*2-1;
 a.setCell(-6,hy,-6,null);assert.equal(a.heightAt(-3,-3),top-.5);
 a.setCell(-6,20000,-6,'plank');assert.equal(a.heightAt(-3,-3),10000.5);
 a.setCell(77,-20000,-111,'nickel_ore');
 loadSync(a,-3,-3,{radiusChunks:0,y:3,chunkBudget:1});loadSync(a,5000,5000,{radiusChunks:0,chunkBudget:1});
 const restored=WorldAtlas.fromState(content,JSON.parse(JSON.stringify(a.serialize())));
 assert.equal(restored.getCell(-6,hy,-6),null);assert.equal(restored.getCell(-6,20000,-6),'plank');assert.equal(restored.getCell(77,-20000,-111),'nickel_ore');assert.equal(restored.heightAt(-3,-3),10000.5);
 assert.equal(restored.activeChunks.size,0);
});
test('visit ordering and bounded active residency do not change generated cells or regions',()=>{
 const a=create({maxActiveChunks:2}),b=create({maxActiveChunks:2});const positions=[[0,0],[-20,-20],[40,0]];
 for(const [x,z]of positions)loadSync(a,x,z,{radiusChunks:0,chunkBudget:1});for(const [x,z]of [...positions].reverse())loadSync(b,x,z,{radiusChunks:0,chunkBudget:1});
 for(const [x,z]of positions){assert.deepEqual(a.sample(x,z),b.sample(x,z));for(let y=0;y<16;y++)assert.equal(a.getCell(x*2,y,z*2),b.getCell(x*2,y,z*2));}
 loadSync(a,0,0,{radiusChunks:8,verticalRadius:4,chunkBudget:1});assert.ok(a.activeChunks.size<=2);assert.equal(a.pendingChunkCount,1);loadSync(a,0,0,{radiusChunks:8,verticalRadius:4,chunkBudget:1});assert.equal(a.activeChunks.size,2);assert.equal(a.pendingChunkCount,0);
});
test('four directional high-tier anchors are isolated by connected dry baseline corridors',()=>{
 const a=create();for(const row of content.environments.world.difficulty.patchTiers){const n=Math.ceil((row.minimumRadiusM+256)/512);for(const [cx,cz]of [[n,0],[-n-1,0],[0,n],[0,-n-1]]){
  const probe=a.sample(cx*512+256,cz*512+256),p=probe.nearbyPatch;assert.ok(p);assert.equal(p.tier,row.tier);assert.equal(a.sample(p.x,p.z).tier,row.tier);
  for(let i=0;i<32;i++){const angle=i*Math.PI/16,s=a.sample(p.x+Math.cos(angle)*(p.radius+48),p.z+Math.sin(angle)*(p.radius+48));assert.equal(s.safeBypass,true);assert.equal(s.height,4);assert.equal(s.waterLevel,null);assert.ok(s.tier<=6);assert.equal(s.hostileSpawnsAllowed,false);}
  for(let x=cx*512+2;x<(cx+1)*512;x+=16){const s=a.sample(x,cz*512+2);assert.equal(s.safeBypass,true);assert.equal(s.height,4);}
 }}
});
test('moving a reservation invalidates old and new chunks and persists its new position',()=>{
 const a=create({maxActiveChunks:8});a.reserveArea('site',{minX:100,maxX:120,minZ:100,maxZ:120,height:8});assert.equal(a.heightAt(108,108),8);loadSync(a,108,108,{radiusChunks:0,chunkBudget:1});const oldKey=[...a.activeChunks.keys()][0];
 a.reserveArea('site',{minX:200,maxX:220,minZ:200,maxZ:220,height:12});assert.equal(a.activeChunks.has(oldKey),false);assert.equal(a.sample(108,108).reservedBy,null);assert.equal(a.heightAt(208,208),12);
 const b=WorldAtlas.fromState(content,a.serialize());assert.equal(b.heightAt(208,208),12);assert.equal(b.sample(108,108).reservedBy,null);
});
test('capsule caves actually carve rock, preserve roof and respect structure reservations',()=>{
 const c=structuredClone(content);for(const e of c.environments.entries){e.pattern.caveChancePerCell=1;e.pattern.caveRadiusM=[3,3];e.pattern.caveDepthM=[8,8];}
 const a=new WorldAtlas(c,{seed:'caves'}),h=a.heightAt(32,32);assert.equal(a.getCell(64,Math.floor((h-8)*2),64),null);assert.notEqual(a.getCell(64,Math.floor((h-.5)*2),64),null);
 a.reserveArea('foundation',{minX:20,maxX:44,minZ:20,maxZ:44,height:h});assert.notEqual(a.getCell(64,Math.floor((h-8)*2),64),null);
});
test('building candidates identify original templates and preserve deterministic ruin variants',()=>{
 const a=create();const sites=a.findBuildingSites(4096,4096,2048),again=create().findBuildingSites(4096,4096,2048);assert.deepEqual(sites,again);assert.ok(sites.length);const kinds=new Set(sites.map(s=>s.kind));assert.ok(kinds.has('dungeon'));assert.ok(kinds.has('community'));assert.ok(kinds.has('small_ruin'));
 for(const s of sites){assert.ok(content.structures.entries.some(t=>t.id===s.templateId));if(s.kind==='small_ruin'){assert.equal(s.variant,'small_ruin');assert.equal(s.templateId,'communal_archive');}}
});
test('invalid cells, unknown saves and non-finite loading budgets fail explicitly',()=>{
 const a=create();assert.throws(()=>a.setCell(0,0,0,'unknown'));assert.throws(()=>a.getCell(.1,0,0));assert.throws(()=>loadSync(a,0,0,{chunkBudget:NaN}));assert.throws(()=>a.sample(Infinity,0));assert.throws(()=>WorldAtlas.fromState(content,{schemaVersion:999}));
});

test('harvest candidates agree with the actual environment at their rounded position',()=>{
 const a=create({seed:31415});const envs=new Map(content.environments.entries.map(e=>[e.id,e]));
 for(const n of a.harvestNodesAround(0,0,256)){const e=envs.get(a.sample(n.x,n.z).environmentId);assert.ok(e.harvestNodeIds.includes(n.nodeId),`${n.id}: ${e.id}`);}
});

test('incremental chunks remain private until complete and match pre-optimization bytes',()=>{
 const a=create();let calls=0;
 do{a.loadAround(0,0,{radiusChunks:0,chunkBudget:1,workBudgetMs:Infinity,maxCellsPerLoad:2048});assert.ok(a.lastLoadWork.processedCells<=2048);calls++;if(calls<16)assert.equal(a.activeChunks.size,0);}while(a.pendingChunkCount&&calls<100);
 assert.equal(calls,16);const chunk=[...a.activeChunks.values()][0];assert.equal(crypto.createHash('sha256').update(new Uint8Array(chunk.blocks.buffer)).digest('hex'),'4595d6b04a79f8cfcb8432e7b052e35780a8ab3a0aa3d0390bf351ea99954620');
});
test('edits during incremental generation are reflected at atomic chunk publication',()=>{
 const a=create();a.loadAround(0,0,{radiusChunks:0,workBudgetMs:Infinity,maxCellsPerLoad:64});a.setCell(0,7,0,null);
 while(a.pendingChunkCount)a.loadAround(0,0,{radiusChunks:0,workBudgetMs:Infinity,maxCellsPerLoad:2048});
 const c=[...a.activeChunks.values()][0];assert.equal(c.blocks[7*1024],0);
});

test('finite flowing liquid conserves volume, reagent and thermal energy across negative chunk boundaries',()=>{
 const a=create();a.reserveArea('fluid_test',{minX:-30,maxX:30,minZ:-30,maxZ:30,height:4});
 assert.equal(a.pour(-.25,5,.25,.05,{acidFraction:.5,temperatureC:30}),.05);
 for(let i=0;i<10;i++)a.tick(.1);
 const total=a.fluidTotals();assert.ok(Math.abs(total.volumeM3+a.reactions.evaporatedM3-.05)<1e-9);assert.ok(Math.abs(total.acidM3+a.reactions.neutralizedAcidM3+a.reactions.evaporatedAcidM3-.025)<1e-9);assert.ok(Math.abs(total.thermalEu+a.reactions.steamThermalEu-2000)<1e-6);
 assert.ok([...a.fluidCells.keys()].some(k=>Number(k.split(',')[0])>=0),'flow crosses the x=0 chunk seam');
 const restored=WorldAtlas.fromState(content,JSON.parse(JSON.stringify(a.serialize())));assert.deepEqual(restored.fluidTotals(),total);
});
test('withdrawing natural water persists depletion and building cannot erase a live liquid cell',()=>{
 const a=create();const removed=a.takeFluid(80,-.25,24,1);assert.equal(removed.volumeM3,.125);assert.equal(a.fluidAt(80,-.25,24),null);
 const b=WorldAtlas.fromState(content,a.serialize());assert.equal(b.fluidAt(80,-.25,24),null);
 assert.equal(b.pour(0,5,0,.1),.1);assert.equal(b.setCell(0,10,0,'stone'),false);assert.equal(b.takeFluid(0,5,0,.1).volumeM3,.1);assert.equal(b.setCell(0,10,0,'stone'),true);
});
test('partial burning survives reload, spreads through heat and never refills fuel after extinguishing',()=>{
 const a=create();a.setCell(0,8,0,'plank');a.setCell(1,8,0,'leaves');assert.equal(a.igniteCell(0,8,0),true);
 for(let i=0;i<20;i++)a.tick(.1);const fuel=a.fuelRemaining.get('0,8,0');assert.ok(fuel>0&&fuel<3750);
 const b=WorldAtlas.fromState(content,a.serialize());assert.equal(b.fuelRemaining.get('0,8,0'),fuel);b.burning.delete('0,8,0');assert.equal(b.igniteCell(0,8,0),true);assert.equal(b.fuelRemaining.get('0,8,0'),fuel);
 for(let i=0;i<100;i++)b.tick(.1);assert.equal(b.getCell(0,8,0),null);assert.equal(b.getCell(1,8,0),null);assert.ok(b.reactions.combustionEu>=3750);
});
test('acid damage is bounded by available reagent and thermal energy actually damages vulnerable material',()=>{
 const a=create();a.reserveArea('dry',{minX:-8,maxX:8,minZ:-8,maxZ:8,height:4});a.setCell(0,8,0,'plank');a.pour(.5,4,0,.000001,{acidFraction:1});
 for(let i=0;i<10;i++)a.tick(.1);assert.equal(a.getCell(0,8,0),'plank');assert.ok(a.reactions.neutralizedAcidM3<=.000001+1e-12);
 assert.equal(a.setCell(5,20,0,'glass'),true);a.applyThermalEnergy(5,20,0,100000);a.tick(.1);assert.equal(a.getCell(5,20,0),null);assert.ok(a.reactions.heatReactedEu>0);
});
test('environment simulation is fixed-step, read-only queries do not advance it, and long catchup is bounded',()=>{
 const a=create(),b=create();for(const x of [a,b]){x.setCell(0,8,0,'plank');x.igniteCell(0,8,0);}
 a.tick(.4);for(let i=0;i<4;i++)b.tick(.1);assert.equal(a.fuelRemaining.get('0,8,0'),b.fuelRemaining.get('0,8,0'));
 const t=a.simulationTime;a.fluidAt(80,-.25,24);a.temperatureAtCell(0,8,0);a.serialize();assert.equal(a.simulationTime,t);
 const result=a.tick(100);assert.equal(result.steps,8);assert.ok(result.pendingSeconds>99);assert.throws(()=>a.tick(-1));
});
test('environment snapshots are independent and resume the same fluid and fire evolution',()=>{
 const a=create();a.reserveArea('saved_physics',{minX:-20,maxX:20,minZ:-20,maxZ:20,height:4});a.setCell(8,8,0,'plank');a.igniteCell(8,8,0);a.pour(-.25,5,.25,.05,{acidFraction:.2,temperatureC:30});a.tick(.25);
 const snapshot=a.serialize(),frozen=JSON.stringify(snapshot),b=WorldAtlas.fromState(content,snapshot);
 for(let i=0;i<10;i++)a.tick(.1);assert.equal(JSON.stringify(snapshot),frozen,'live simulation must not mutate a captured save');
 for(let i=0;i<10;i++)b.tick(.1);assert.deepEqual(b.serialize(),a.serialize());assert.equal(JSON.stringify(snapshot),frozen,'restored simulation must not mutate its input save');
});

test('editing a chunk boundary refreshes both exposed meshes without editing the neighbor voxels',()=>{
 const a=create();const left=a._generateChunk(0,0,0),right=a._generateChunk(1,0,0);a.activeChunks.set(left.key,left);a.activeChunks.set(right.key,right);const original=right.blocks.slice(),old=right.revision;
 a.setCell(31,7,0,null);assert.ok(left.revision>old);assert.equal(right.revision,left.revision);assert.deepEqual(right.blocks,original);
});
test('96 chunk residency selects all 49 nearby surface layers before remote underground or sky layers',()=>{
 const a=create({maxActiveChunks:96});a.loadAround(0,0,{radiusChunks:3,verticalRadius:1,y:4,chunkBudget:0,workBudgetMs:Infinity});
 const selected=a._loadPlan.wanted.slice(0,96),first=selected[0];assert.equal(first.key,'0,0,0');
 for(let cz=-3;cz<=3;cz++)for(let cx=-3;cx<=3;cx++){const cy=Math.floor(a.heightAt(cx*16+8,cz*16+8)/16);assert.ok(selected.some(c=>c.cx===cx&&c.cy===cy&&c.cz===cz));}
 assert.ok(a.activeChunks.size<=96);
});
test('default loading cell budget can use the remaining time instead of stopping at 2048 cells',()=>{
 const a=create();a.loadAround(0,0,{radiusChunks:0,workBudgetMs:Infinity});assert.equal(a.lastLoadWork.processedCells,32768);assert.equal(a.activeChunks.size,1);
});
test('environment destruction emits one support notification; ordinary edits and restoration do not',()=>{
 const cells=[],a=create({onCellDestroyed:cell=>cells.push(cell)});a.reserveArea('callbacks',{minX:-20,maxX:40,minZ:-20,maxZ:20,height:4});
 a.setCell(-4,8,0,'stone');a.setCell(-4,8,0,null);assert.deepEqual(cells,[]);
 a.setCell(0,8,0,'plank');a.igniteCell(0,8,0);for(let i=0;i<90;i++)a.tick(.1);assert.equal(cells.filter(p=>p.join(',')==='0,8,0').length,1);
 a.setCell(5,20,0,'glass');a.applyThermalEnergy(5,20,0,100000);a.tick(.1);assert.equal(cells.filter(p=>p.join(',')==='5,20,0').length,1);
 a.setCell(30,8,0,'leaves');for(const [x,z]of [[31,0],[29,0],[30,1],[30,-1]])a.setCell(x,9,z,'stone');a.pour(15.25,4.5,.25,.125,{acidFraction:1});for(let i=0;i<50;i++)a.tick(.1);assert.equal(cells.filter(p=>p.join(',')==='30,8,0').length,1);
 const restored=[];WorldAtlas.fromState(content,a.serialize(),{onCellDestroyed:cell=>restored.push(cell)});assert.deepEqual(restored,[]);
});
