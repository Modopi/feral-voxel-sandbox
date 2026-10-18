import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Progression, ENERGY_TYPES } from '../app/src/main/assets/content-runtime/progression.js';
const CONTENT = Object.fromEntries(['progression', 'environments', 'blocks'].map(name => [name, JSON.parse(fs.readFileSync(new URL(`../design/content/${name}.json`, import.meta.url)))]));
let serial = 0;
const grant = (p, items) => assert.equal(p.grant(items, { claimId: `test-reward:${serial++}` }).ok, true);
const tick = (p, seconds, options) => assert.equal(p.tick(seconds, options).ok, true);
const find = id => CONTENT.progression.entries.find(e => e.id === id);
function collect(p, sourceId, n, environmentId = 'grove') {
  const source = find(sourceId);
  for (let k = 0; k < n; k++) assert.equal(p.harvest(sourceId, { environmentId, elapsed: source.seconds, nodeId: `wild:${serial++}`, claimId: `harvest:${serial++}` }).ok, true, sourceId);
}
function study(p, id) { assert.equal(p.startResearch(id).ok, true, id); tick(p, find(id).work); assert.equal(p.research.has(id), true); }
function craft(p, id) { assert.equal(p.queueCraft(id).ok, true, id); tick(p, find(id).seconds + .01); }
function bootstrap() {
  const p = new Progression(CONTENT);
  collect(p, 'source_raw_timber', 30); collect(p, 'source_loose_stone', 20); collect(p, 'source_plant_fiber', 10); collect(p, 'source_clay', 8);
  study(p, 'observation'); study(p, 'joinery');
  assert.equal(p.buildStation('field_bench').ok, true); tick(p, 60);
  study(p, 'material:wood'); craft(p, 'make_wood');
  study(p, 'material:stone');
  for (let i = 0; i < 4; i++) craft(p, 'make_stone');
  assert.equal(p.buildStation('kiln').ok, true); tick(p, 60);
  return p;
}
test('empty inventory bootstraps wood, stone and kiln using actual harvest, samples and timed costs', () => {
  const p = bootstrap();
  assert.equal(p.stations.field_bench, 1); assert.equal(p.stations.kiln, 1);
  assert.equal(p.count('raw_timber'), 20); // observation1 + joinery2 + bench4 + wood research1 + wood craft2
  assert.equal(p.count('loose_stone'), 8); // observation1 + bench2 + stone sample1 + four cuts*2
  assert.equal(p.count('clay'), 4);
  assert.equal(p.count('wood'), 1); assert.equal(p.count('stone'), 0);
  assert.equal(p.availableResearch().some(r => r.id === 'material:scrap_iron'), false);
  assert.equal(p.recipeStatus('make_steel').reason, 'research_required');
});
test('harvest is immediate and still requires tool, source environment, depletion and persistent unique claim', () => {
  const p = new Progression(CONTENT);
  assert(p.list('source').every(s => s.seconds === 0), 'gathering has no channel time (frontier)');
  assert.equal(p.harvest('source_water', { environmentId: 'grove', nodeId: 'w', claimId: 'w1' }).reason, 'tool_required');
  assert.equal(p.harvest('source_titanium_ore', { environmentId: 'grove', nodeId: 't', claimId: 't1' }).ok, false);
  const context = { environmentId: 'grove', nodeId: 'b', claimId: 'h1' };
  assert.equal(p.harvest('source_berry', { ...context, elapsed: -1 }).reason, 'harvest_time_required');
  assert.equal(p.harvest('source_berry', context).ok, true); assert.equal(p.count('berry'), 2);
  assert.equal(p.harvest('source_berry', context).duplicate, true);
  const q = new Progression(CONTENT, p.serialize());
  assert.equal(q.harvest('source_berry', { ...context, claimId: 'h2' }).reason, 'source_depleted');
  tick(q, 600); assert.equal(q.harvest('source_berry', { ...context, claimId: 'h2' }).ok, true);
  assert.equal(q.count('berry'), 4);
});
test('inventory debit and energy costs are atomic, overflow remains reclaimable, legacy IDs are rejected', () => {
  const p = new Progression(CONTENT);
  assert.equal(p.grant({ iron: 1 }, { claimId: 'legacy' }).ok, false);
  grant(p, { wood: 2 });
  assert.equal(p.transaction({ items: { wood: 2 }, energy: { divine: 1 } }, { claimId: 'tx' }).ok, false);
  assert.equal(p.count('wood'), 2);
  p.supplyEnergy('divine', 1, { claimId: 'blessing' });
  assert.equal(p.transaction({ items: { wood: 2 }, energy: { divine: 1 } }, { claimId: 'tx' }).ok, true);
  assert.equal(p.transaction({ items: { wood: 2 }, energy: { divine: 1 } }, { claimId: 'tx' }).duplicate, true);
  assert.equal(p.count('wood'), 0); assert.equal(p.energy.divine, 0);
  grant(p, { stone: 2400 }); assert.equal(p.count('stone'), 2304); assert.equal(p.overflow.stone, 96);
  p.spend({ stone: 100 }, { claimId: 'spend' }); p.reclaim();
  assert.equal(p.count('stone'), 2300); assert.equal(p.overflow.stone, undefined);
});
test('research pause/save/resume charges samples once; discovered blueprints immediately unlock', () => {
  const p = new Progression(CONTENT); grant(p, { raw_timber: 1, loose_stone: 1 });
  assert.equal(p.startResearch('observation').ok, true); tick(p, 4); p.pauseResearch(); tick(p, 50);
  const q = new Progression(CONTENT, p.serialize()); assert.equal(q.researchProgress.observation.work, 4);
  assert.equal(q.startResearch('observation').ok, true); tick(q, 6);
  assert.equal(q.research.has('observation'), true); assert.equal(q.count('raw_timber'), 0);
  assert.equal(q.discover('blueprint:material:world_heartwood', { origin: 'discovery', claimId: 'archive1' }).ok, true);
  assert.equal(q.research.has('material:world_heartwood'), true); assert.equal(q.recipeStatus('make_world_heartwood').reason, 'station_required');
  q.discover('blueprint:material:world_heartwood', { origin: 'discovery', claimId: 'archive1' }); assert.equal(q.workCredits, 0);
  q.discover('blueprint:material:world_heartwood', { origin: 'discovery', claimId: 'archive2' }); assert.equal(q.workCredits, 500);
  grant(q, { 'blueprint:material:world_heartwood': 1 });
  q.discover('blueprint:material:world_heartwood', { origin: 'crafted', claimId: 'written1' }); assert.equal(q.workCredits, 500);
});
test('craft reserves inputs, pauses without energy, survives save and never repeats output', () => {
  const p = bootstrap();
  assert.equal(p.queueCraft('make_charcoal').ok, true); const woodAfterReserve = p.count('raw_timber');
  tick(p, 20); assert.equal(p.count('charcoal'), 0); assert.equal(p.jobs.length, 1);
  p.setSourceActive('wood_fire', true); tick(p, 10);
  const q = new Progression(CONTENT, p.serialize()); tick(q, 31);
  assert.equal(q.count('charcoal'), 1); assert.equal(q.jobs.length, 0); assert.ok(q.count('raw_timber') < woodAfterReserve);
  const after = new Progression(CONTENT, q.serialize()); after.setSourceActive('wood_fire', false); tick(after, 10);
  assert.equal(after.count('charcoal'), 1);
  assert.ok(Math.abs(after.metrics.generated.thermal - after.metrics.consumed.thermal - after.metrics.dissipated.thermal) < 1e-5);
});
test('all 39 research nodes execute from samples without discovery, preserving four freely mixed fields', () => {
  const p = new Progression(CONTENT), done = new Set();
  // Economy test fixture supplies laboratory materials; each study still spends its own samples.
  const pending = p.list('research');
  while (pending.length) {
    const i = pending.findIndex(r => r.prerequisites.every(x => done.has(x))); assert.notEqual(i, -1);
    const [r] = pending.splice(i, 1);
    if (r.station !== 'hand' && !p.stations[r.station]) { grant(p, { [r.station]: 1 }); assert.equal(p.installStation(r.station).ok, true); }
    grant(p, r.samples); const before = Object.fromEntries(Object.keys(r.samples).map(id => [id, p.count(id)]));
    study(p, r.id); for (const [id, n] of Object.entries(r.samples)) assert.equal(p.count(id), before[id] - n);
    done.add(r.id);
  }
  assert.equal(done.size, 39);
  for (const field of ['arcane_engineering', 'arcane_studies', 'sanctity', 'physics']) assert.equal(p.list('research').filter(r => r.field === field && p.research.has(r.id)).length, 5);
});
test('all 142 crafting contracts execute with finite debited energy and exact item output', () => {
  for (const r of CONTENT.progression.entries.filter(e => e.kind === 'recipe')) {
    const p = new Progression(CONTENT);
    if (r.research) p.discover(find(r.research).blueprint, { origin: 'discovery', claimId: 'fixture:knowledge' });
    if (r.station !== 'hand') { grant(p, { [r.station]: 1 }); p.installStation(r.station); }
    grant(p, r.inputs);
    for (const [type, amount] of Object.entries(r.energy)) p.supplyEnergy(type, amount, { claimId: `fixture:energy:${type}` });
    assert.equal(p.queueCraft(r.id).ok, true, r.id);
    const seconds = r.seconds * (r.energy.divine > 0 ? Math.max(1, r.energy.divine / r.seconds / 10) : 1) + .2;
    let remaining = seconds;
    while (remaining > 0) { tick(p, Math.min(3600, remaining)); remaining -= Math.min(3600, remaining); }
    assert.equal(p.jobs.length, 0, r.id);
    for (const [id, n] of Object.entries(r.outputs)) assert.equal(p.count(id), n, `${r.id} output ${id}`);
    for (const [type, amount] of Object.entries(r.energy)) {
      assert.ok(Math.abs(p.metrics.consumed[type] - amount) < 1e-4, `${r.id} energy ${type}`);
      assert.ok(p.energy[type] + p.energyOverflow[type] < 1e-4, `${r.id} unspent ${type}`);
    }
  }
});
function placeFixture(p, id, options) {
  const c = find(id); p.discover(find(c.research).blueprint, { claimId: `knowledge:${serial++}`, origin: 'discovery' });
  grant(p, { [id]: 1 }); const result = p.placeComponent(id, options); assert.equal(result.ok, true); return result.instanceId;
}
test('mechanical-electric-mechanical loop never creates energy and battery discharge obeys rated power', () => {
  const p = new Progression(CONTENT);
  placeFixture(p, 'battery'); placeFixture(p, 'motor'); placeFixture(p, 'generator'); placeFixture(p, 'inertial_cell');
  const stored = p.storeEnergy('electrical', 100); assert.equal(stored.stored, 90);
  const trial = p._allocation({}, .1, { mechanical: 100 }, .1);
  assert.equal(trial, null); // a 20 EU/s battery cannot provide a 10 EU burst in .1 s
  const a = p._allocation(Object.fromEntries(ENERGY_TYPES.map(t => [t, 0])), 1, { mechanical: 8 }, 1);
  assert.ok(a); assert.equal(a.energySpent.mechanical, 8); assert.equal(a.stored.electrical, 80); assert.ok(Math.abs(a.loss - 2) < 1e-8);
  const before = p.energy.electrical; tick(p, 10); assert.equal(p.energy.electrical, before);
});
test('first divinity comes from paid community work, then an intact relic generates at .1 EU/s', () => {
  const p = new Progression(CONTENT); grant(p, { food: 12, wood: 6 });
  for (let i = 0; i < 3; i++) assert.equal(p.startActivity('community_contribution', { communityId: 'grove-camp' }).ok, true);
  tick(p, 90); assert.equal(p.energy.divine, 20); assert.equal(p.count('food'), 0);
  p.discover('blueprint:consecration', { origin: 'discovery', claimId: 'first-knowledge' });
  grant(p, { consecration_table: 1, stone: 2, wood: 1 }); p.installStation('consecration_table');
  craft(p, 'assemble_relic'); assert.ok(p.energy.divine < 1e-6);
  const relic = p.placeComponent('relic'); assert.equal(relic.ok, true);
  tick(p, 10); assert.ok(Math.abs(p.energy.divine - 1) < 1e-5);
  p.setComponentCondition(relic.instanceId, { health: 0 }); tick(p, 10); assert.ok(Math.abs(p.energy.divine - 1) < 1e-5);
});
test('mana condenser and ordinary fluid container work without a preexisting mana item', () => {
  const p = new Progression(CONTENT);
  p.discover('blueprint:mana', { origin: 'discovery', claimId: 'mana-knowledge' });
  grant(p, { field_bench: 1, arcane_bench: 1, scrap_iron: 2, stone: 2, sand: 1, water: 1 });
  p.installStation('field_bench'); p.installStation('arcane_bench'); craft(p, 'assemble_mana_condenser');
  assert.equal(p.placeComponent('mana_condenser').ok, true); craft(p, 'condense_mana'); assert.equal(p.count('liquid_mana'), 1);
  const container = placeFixture(p, 'fluid_container', { fluidType: 'liquid_mana' });
  assert.equal(p.fillContainer(container, 'liquid_mana', 1).ok, true); assert.equal(p.count('liquid_mana'), 0);
  assert.ok(p.energy.magic >= 100); assert.equal(p.energyCapacity('magic'), 1000); assert.equal(p.energyCapacity('chemical'), 0);
});
test('machine material properties cannot invent functions or multiply component cores without spending them', () => {
  const p = new Progression(CONTENT); const id = placeFixture(p, 'motor');
  const before = p.evaluateComponent(id); assert.deepEqual(before.functions, ['rotation']);
  const steel = p.evaluateMaterial('steel', { volumeLiters: 1 }); assert.equal(steel.massKg, 7.8); assert.deepEqual(steel.functionsGranted, []);
  grant(p, { motor: 1 }); assert.equal(p.placeComponent('motor', { scale: 8 }).ok, false); assert.equal(p.count('motor'), 1);
  p.setComponentCondition(id, { health: .5 }); assert.equal(p.evaluateComponent(id).power, before.power / 2);
});
test('reward claims, kit ownership and save validation reject duplication or invalid state', () => {
  const p = new Progression(CONTENT);
  const reward = { guaranteed: { 'blueprint:joinery': 1, wood: 4 }, divineEnergy: 20 };
  assert.equal(p.grantReward(reward, { claimId: 'dungeon:archive' }).ok, true);
  const q = new Progression(CONTENT, p.serialize()); assert.equal(q.grantReward(reward, { claimId: 'dungeon:archive' }).duplicate, true);
  assert.equal(q.count('wood'), 4); assert.equal(q.energy.divine, 20); assert.equal(q.equip('gear_baseline_t10').ok, false);
  grant(q, { gear_baseline_t10: 1 }); assert.equal(q.equip('gear_baseline_t10').ok, true); assert.equal(q.evaluateLoadout().maxHp, 380);
  q.spend({ gear_baseline_t10: 1 }, { claimId: 'death' }); assert.equal(q.evaluateLoadout().tier, 0);
  assert.throws(() => new Progression(CONTENT, { schemaVersion: 1, energy: { electrical: 100 } }), /capacity/);
  assert.throws(() => new Progression(CONTENT, { schemaVersion: 1, inventory: { wood: -1 } }), /item/);
});

test('manual mechanical supply and a real generator power a mixed-channel recipe with a conserved budget', () => {
  const p = new Progression(CONTENT);
  placeFixture(p, 'generator');
  p.discover('blueprint:material:inertial_alloy', { origin: 'discovery', claimId: 'physics:knowledge' });
  grant(p, { physics_station_t6: 1, steel: 2, nickel: 1 }); p.installStation('physics_station_t6');
  assert.equal(p.queueCraft('make_inertial_alloy').ok, true);
  tick(p, 100, { manual: true }); assert.equal(p.count('inertial_alloy'), 1);
  const m = p.metrics, generated = Object.values(m.generated).reduce((a,b)=>a+b,0);
  const consumed = Object.values(m.consumed).reduce((a,b)=>a+b,0), lost=Object.values(m.dissipated).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(generated-consumed-lost-m.conversionLoss) < 1e-4);
  assert.ok(Math.abs(m.consumed.mechanical-500) < 1e-5); assert.ok(Math.abs(m.consumed.electrical-200) < 1e-5);
});
test('acid extraction debits fluid once and stores the unspent chemical energy in the correct tank', () => {
  const p = new Progression(CONTENT); placeFixture(p, 'fluid_container', { fluidType: 'acid_fluid' });
  grant(p, { acid_fluid: 1 }); assert.equal(p.setSourceActive('acid_extractor', true).ok, true); tick(p, 10);
  assert.equal(p.count('acid_fluid'), 0); assert.ok(Math.abs(p.energy.chemical-40) < 1e-5);
  assert.ok(Math.abs(p.metrics.generated.chemical-40) < 1e-5);
  const q = new Progression(CONTENT, p.serialize()); tick(q, 10); assert.ok(Math.abs(q.energy.chemical-40) < 1e-5);
});

test('finite mining tool wear persists through save and replacement requires a second crafted tool', () => {
 const p = new Progression(CONTENT); grant(p,{stone_pick:1});
 for(let i=0;i<120;i++) assert.equal(p.harvest('source_iron_ore',{environmentId:'ridge',nodeId:'ore:'+i,elapsed:12,claimId:'ore-claim:'+i}).ok,true);
 const q=new Progression(CONTENT,p.serialize());assert.equal(q.toolWear.stone_pick,0);
 const context={environmentId:'ridge',nodeId:'ore:new',elapsed:12,claimId:'ore:new'};
 assert.equal(q.harvest('source_iron_ore',context).reason,'tool_broken');
 grant(q,{stone_pick:1});assert.equal(q.harvest('source_iron_ore',context).ok,true);assert.equal(q.count('stone_pick'),1);assert.equal(q.toolWear.stone_pick,119);
});
test('physical workshop access is local, changes atomically and survives reload without duplicating counts',()=>{
 const p=new Progression(CONTENT);p.research.add('material:wood');grant(p,{raw_timber:5});
 const records=[{ownerId:'fixture:1',assetId:'field_bench',kind:'station',health:100,maxHealth:100,active:true}];
 assert.equal(p.syncWorldFixtures(records,{accessibleOwnerIds:[]}).ok,true);assert.equal(p.recipeStatus('make_wood').reason,'station_required');
 p.syncWorldFixtures(records,{accessibleOwnerIds:['fixture:1']});assert.equal(p.recipeStatus('make_wood').ok,true);assert.equal(p.stations.field_bench,1);
 const q=new Progression(CONTENT,p.serialize());q.syncWorldFixtures(records,{accessibleOwnerIds:[]});assert.equal(q.stations.field_bench,1);assert.equal(q.recipeStatus('make_wood').ok,false);
 const before=q.serialize();assert.equal(q.syncWorldFixtures([{...records[0],health:101}]).ok,false);assert.deepEqual(q.serialize(),before);
 q.syncWorldFixtures([]);assert.equal(q.stations.field_bench,0);
});
test('community activity request retries preserve the original job and consume inputs once across reload',()=>{
 const p=new Progression(CONTENT),a=find('community_contribution');grant(p,Object.fromEntries(Object.entries(a.inputs).map(([id,n])=>[id,n*2])));
 const first=p.startActivity(a.id,{communityId:'camp',requestId:'work:1'});assert.equal(first.ok,true);const inventory={...p.inventory};
 const q=new Progression(CONTENT,p.serialize()),retry=q.startActivity(a.id,{communityId:'camp',requestId:'work:1'});assert.equal(retry.duplicate,true);assert.equal(retry.jobId,first.jobId);assert.deepEqual(q.inventory,inventory);
 assert.equal(q.startActivity(a.id,{communityId:'other',requestId:'work:1'}).reason,'request_conflict');
});
test('legacy tick-local assembly caches match uncached stepping and expire between calls',()=>{
 class Uncached extends Progression { _step(dt,options){const cache=this._tickCache;this._tickCache=null;try{return super._step(dt,options);}finally{this._tickCache=cache;}} }
 const p=bootstrap();for(const r of p.list('research'))p.research.add(r.id);
 grant(p,{battery:2,inertial_cell:1,fluid_container:1,mana_condenser:1,relic:1,generator:1,heat_engine:1,transmission:1,raw_timber:20});
 for(const id of ['battery','inertial_cell','fluid_container','mana_condenser','relic','generator','heat_engine','transmission'])assert.equal(p.placeComponent(id).ok,true);
 p.setSourceActive('wood_fire',true);p.queueCraft('make_charcoal',{count:2});
 const q=new Uncached(CONTENT,p.serialize());
 for(const seconds of [1,17,61,5]){p.tick(seconds,{manual:true});q.tick(seconds,{manual:true});assert.deepEqual(p.serialize(),q.serialize());assert.equal(p._tickCache,null);}
 const battery=p.assemblies.find(a=>a.componentId==='battery');p.setComponentCondition(battery.id,{health:.25});q.setComponentCondition(battery.id,{health:.25});
 p.tick(10);q.tick(10);assert.deepEqual(p.serialize(),q.serialize());
 grant(p,{battery:1});q.grant({battery:1},{claimId:[...p.claims].at(-1)});p.placeComponent('battery');q.placeComponent('battery');p.tick(2);q.tick(2);assert.deepEqual(p.serialize(),q.serialize());
});
