import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Progression} from '../app/src/main/assets/content-runtime/progression.js';
const CONTENT={progression:JSON.parse(fs.readFileSync(new URL('../design/content/progression.json',import.meta.url)))};
let seq=0;const receipt=()=>({claimId:`fixed-test:${seq++}`});
const node=(ownerId,assetId,x=0,extra={})=>({ownerId,assetId,kind:CONTENT.progression.entries.find(e=>e.id===assetId).kind,position:{x,y:0,z:0},health:100,maxHealth:100,active:true,...extra});
function setup(records){const p=new Progression(CONTENT);for(const r of p.list('research'))p.research.add(r.id);p.grant({wood:100,clay:100,scrap_iron:100,stone:100,raw_timber:20,steel:5,nickel:5,bark_cup:1,liquid_mana:2},receipt());assert.equal(p.syncWorldFixtures(records,{accessibleOwnerIds:records.map(r=>r.ownerId)}).ok,true);return p;}
function connect(p,a,b,t){const r=p.fixtureEnergy.connect(a,b,t,receipt());assert.equal(r.ok,true,JSON.stringify(r));return r.link.id;}
test('unlinked nearby and distant stores remain isolated; explicit paid links carry power and removal stops transfer',()=>{
 const records=[node('source','mana_condenser',0),node('near','fluid_container',1),node('far','fluid_container',100)],p=setup(records),g=p.fixtureEnergy;
 p.tick(2);assert.equal(g.nodes.get('near').energy.magic,0);assert.equal(g.nodes.get('far').energy.magic,0);assert.equal(p.energy.magic,0);
 assert.equal(g.quoteLink('source','far','magic').reason,'cable_too_long');const clay=p.count('clay'),link=connect(p,'source','near','magic');assert.equal(p.count('clay'),clay-.1);
 p.tick(2);assert.ok(Math.abs(g.nodes.get('near').energy.magic-4)<1e-8);assert.equal(p.energyAvailable('magic'),0);
 g.disconnect(link);p.tick(2);assert.ok(Math.abs(g.nodes.get('near').energy.magic-4)<1e-8);assert.equal(g.nodes.get('far').energy.magic,0);
});
test('station energy requires directed ports and linked converters; leaving the work site pauses the job',()=>{
 const records=[node('crank','field_bench',0),node('shaft','transmission',1),node('dynamo','generator',2),node('accumulator','battery',3),node('forge','physics_station_t6',4)],p=setup(records),g=p.fixtureEnergy;
 assert.equal(g.setSource('crank','manual_crank',true).ok,true);connect(p,'crank','shaft','mechanical');connect(p,'shaft','dynamo','mechanical');connect(p,'dynamo','accumulator','electrical');connect(p,'accumulator','forge','electrical');
 assert.equal(g.connect('accumulator','forge','mechanical',receipt()).reason,'incompatible_ports');
 p.tick(10,{manual:true});assert.ok(g.nodes.get('accumulator').energy.electrical>0);
 assert.equal(p.queueCraft('make_inertial_alloy',{fixtureId:'forge'}).ok,true);p.tick(1,{manual:true});assert.equal(p.jobs[0].progress,0); // electrical alone cannot substitute for mechanical
 connect(p,'shaft','forge','mechanical');p.tick(1,{manual:true});assert.ok(p.jobs[0].progress>0);
 const before=p.jobs[0].progress;p.syncWorldFixtures(records,{accessibleOwnerIds:['crank']});p.tick(2,{manual:true});assert.equal(p.jobs[0].progress,before);
 p.syncWorldFixtures(records,{accessibleOwnerIds:['forge']});p.tick(2);assert.equal(p.jobs[0].progress,before); // crank requires actual held local work
});
test('fuel remains local and finite across range changes, save and link removal',()=>{
 const records=[node('fire','kiln'),node('engine','heat_engine',1),node('cell','inertial_cell',2)],p=setup(records),g=p.fixtureEnergy;
 assert.equal(g.refuel('fire','wood_fire',1,receipt()).ok,true);connect(p,'fire','engine','thermal');connect(p,'engine','cell','mechanical');p.tick(5);
 const before=g.nodes.get('cell').energy.mechanical;p.syncWorldFixtures(records,{accessibleOwnerIds:[]});p.tick(5);assert.ok(g.nodes.get('cell').energy.mechanical>before);
 const q=new Progression(CONTENT,p.serialize());q.tick(12);assert.equal(q.fixtureEnergy.nodes.get('fire').fuel.wood_fire,0);assert.ok(q.fixtureEnergy.nodes.get('cell').energy.mechanical<=140+1e-6);assert.equal(q.count('raw_timber'),19);
 q.syncWorldFixtures(records.map(r=>r.ownerId==='engine'?{...r,active:false}:r),{accessibleOwnerIds:[]});assert.equal(q.fixtureEnergy.links.length,0);
});
test('personal divinity funds the first relic only after explicit reservation at its actual workbench',()=>{
 const p=setup([node('altar','consecration_table')]);p.supplyEnergy('divine',20,receipt());assert.equal(p.queueCraft('assemble_relic',{fixtureId:'altar'}).ok,true);p.tick(1);assert.equal(p.jobs[0].progress,0);assert.equal(p.energy.divine,20);
 assert.equal(p.fixtureEnergy.charge('altar','divine',20,receipt()).ok,true);assert.equal(p.energy.divine,0);p.tick(30);assert.equal(p.count('relic'),1);assert.equal(p.jobs.length,0);
});
test('legacy nonpositional mode is unchanged; migration quarantines pooled energy instead of assigning it to a distant store',()=>{
 const p=new Progression(CONTENT);p.grant({battery:1,field_bench:1},receipt());p.research.add(p.catalog.get('battery').research);p.placeComponent('battery');p.installStation('field_bench');p.supplyEnergy('electrical',30,receipt());
 assert.equal(p.energy.electrical,30);assert.equal(p.fixtureEnergy.enabled,false);
 const records=[node('new-battery','battery',100)];p.syncWorldFixtures(records,{accessibleOwnerIds:['new-battery']});assert.equal(p.energy.electrical,0);assert.equal(p.fixtureEnergy.legacyEscrow.electrical,30);assert.equal(p.fixtureEnergy.nodes.get('new-battery').energy.electrical,0);
 assert.equal(p.recoverUnpositionedFixtures(receipt()).ok,true);assert.equal(p.count('battery'),1);assert.equal(p.count('field_bench'),1);
 assert.equal(p.fixtureEnergy.charge('new-battery','electrical',30,{...receipt(),fromLegacyEscrow:true}).ok,true);assert.equal(p.fixtureEnergy.legacyEscrow.electrical,0);
 const restored=new Progression(CONTENT,p.serialize());assert.equal(restored.fixtureEnergy.nodes.get('new-battery').energy.electrical,30);assert.equal(restored.energyAvailable('electrical'),0);
});
test('avatar mana uses paid growth and actual liquid without summing fixed tanks or the cup',()=>{
 const p=setup([node('tank','fluid_container')]);p.grant({mana_steel:2},receipt());p.investMana('mana_steel',2,receipt());assert.equal(p.fillPersonalMana(1,receipt()).ok,true);assert.equal(p.energy.magic,100);assert.equal(p.count('liquid_mana'),1);assert.equal(p.energyCapacity('magic'),130);
 p.fixtureEnergy.fillFluid('tank','liquid_mana',1,receipt());assert.equal(p.fixtureEnergy.nodes.get('tank').energy.magic,100);assert.equal(p.energyAvailable('magic'),100);
 p.consumeEnergy('magic',100,receipt());assert.equal(p.energyAvailable('magic'),0);assert.equal(p.fixtureEnergy.nodes.get('tank').energy.magic,100);
});
test('two simulated hours preserve source, storage, dissipation budgets without charging distant or personal stores',()=>{
 const records=[node('source','mana_condenser'),node('tank','fluid_container',1),node('other-base','fluid_container',100)],p=setup(records),g=p.fixtureEnergy;
 const id=receipt(),before=p.count('clay');assert.equal(g.connect('source','tank','magic',id).ok,true);assert.equal(g.connect('source','tank','magic',id).duplicate,true);assert.equal(p.count('clay'),before-.1);
 p.tick(3600);const q=new Progression(CONTENT,p.serialize());q.tick(3600);const m=q.fixtureEnergy.metrics,stored=[...q.fixtureEnergy.nodes.values()].reduce((sum,n)=>sum+n.energy.magic,0);
 assert.ok(Math.abs(m.generated.magic-14400)<1e-5);assert.ok(Math.abs(m.generated.magic+m.imported.magic-m.consumed.magic-m.exported.magic-m.dissipated.magic-stored)<1e-5);
 assert.equal(q.fixtureEnergy.nodes.get('other-base').energy.magic,0);assert.equal(q.energy.magic,0);assert.ok(stored<=1000+1e-8);
});
test('breakage cuts links and repair never silently reconnects; a single player cannot multiply manual power',()=>{
 const records=[node('one','field_bench'),node('two','field_bench',1),node('cell','inertial_cell',2)],p=setup(records),g=p.fixtureEnergy;
 g.setSource('one','manual_crank',true);connect(p,'one','cell','mechanical');g.setSource('two','manual_crank',true);connect(p,'two','cell','mechanical');p.tick(1,{manual:true});assert.ok(Math.abs(g.metrics.generated.mechanical-10)<1e-8);
 p.syncWorldFixtures(records.map(r=>r.ownerId==='cell'?{...r,health:0,active:false}:r),{accessibleOwnerIds:['one','two']});assert.equal(g.links.length,0);assert.equal(g.nodes.get('cell').energy.mechanical,0);
 p.syncWorldFixtures(records,{accessibleOwnerIds:records.map(r=>r.ownerId)});p.tick(1,{manual:true});assert.equal(g.nodes.get('cell').energy.mechanical,0);
});
test('legacy queued input and work survive explicit station binding; live reservations cannot move',()=>{
 const legacy=new Progression(CONTENT);for(const r of legacy.list('research'))legacy.research.add(r.id);
 legacy.grant({field_bench:1,raw_timber:10},receipt());legacy.installStation('field_bench');
 assert.equal(legacy.queueCraft('make_wood').ok,true);legacy.tick(1);
 const saved=legacy.serialize(),jobId=saved.jobs[0].id,progress=saved.jobs[0].progress,items=structuredClone(saved.inventory);
 const p=new Progression(CONTENT,saved),records=[node('bench','field_bench'),node('other','field_bench',1),node('wrong','kiln',2)];
 p.syncWorldFixtures(records,{accessibleOwnerIds:['bench','other','wrong']});p.tick(2);assert.equal(p.jobs[0].progress,progress);
 assert.equal(p.bindCraftJob(jobId,'wrong').reason,'physical_station_required');
 assert.equal(p.bindCraftJob(jobId,'bench').ok,true);assert.equal(p.bindCraftJob(jobId,'bench').duplicate,true);assert.deepEqual(p.inventory,items);assert.equal(p.jobs[0].progress,progress);
 assert.equal(p.bindCraftJob(jobId,'other').reason,'job_station_locked');
 p.syncWorldFixtures(records.filter(r=>r.ownerId!=='bench'),{accessibleOwnerIds:['other','wrong']});assert.equal(p.bindCraftJob(jobId,'other').ok,true);
 const q=new Progression(CONTENT,p.serialize());q.tick(30);assert.equal(q.count('wood'),1);assert.equal(q.jobs.length,0);assert.equal(q.count('raw_timber'),items.raw_timber);
});
