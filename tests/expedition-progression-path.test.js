import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { WorldAtlas } from '../app/src/main/assets/content-runtime/atlas.js';
import { DungeonSystem } from '../app/src/main/assets/content-runtime/dungeons.js';
import { Progression, ENERGY_TYPES } from '../app/src/main/assets/content-runtime/progression.js';

const definitions = new Map(CONTENT.progression.entries.map(e => [e.id, e]));
const entries = kind => [...definitions.values()].filter(e => e.kind === kind);
const near = (a, b, message) => assert(Math.abs(a - b) < 1e-4, `${message}: ${a} != ${b}`);
const preservedCheckpointSha256 = '994fd5d257ffe02f32ac349ba08a87fd27d157c4c0dfcb87a6467163845a9002';

// Keep candidates in their original discovery order while retaining only nodes that may
// become eligible again. Permanently exhausted nodes are the only entries discarded.
function findEligibleWithCursor(nodes, state, eligible, permanentlyExhausted) {
  for (let i = 0; i < state.pending.length;) {
    const node = nodes[state.pending[i]];
    if (eligible(node)) return node;
    if (permanentlyExhausted(node)) state.pending.splice(i, 1);
    else i++;
  }
  while (state.cursor < nodes.length) {
    const index = state.cursor++, node = nodes[index];
    if (eligible(node)) {
      state.pending.push(index);
      return node;
    }
    if (!permanentlyExhausted(node)) state.pending.push(index);
  }
  return null;
}

test('harvest candidate cursor preserves find order and retries regrowing nodes', () => {
  const nodes = [
    { id: 'spent-a', permanent: true },
    { id: 'regrowing-b', permanent: false },
    { id: 'spent-c', permanent: true },
    { id: 'available-d', permanent: false },
  ];
  const ready = new Set(['available-d']);
  const checks = new Map();
  const eligible = node => {
    checks.set(node.id, (checks.get(node.id) || 0) + 1);
    return ready.has(node.id);
  };
  const state = { cursor: 0, pending: [] };

  assert.equal(findEligibleWithCursor(nodes, state, eligible, node => node.permanent)?.id,
    nodes.find(node => ready.has(node.id))?.id);
  ready.add('regrowing-b');
  assert.equal(findEligibleWithCursor(nodes, state, eligible, node => node.permanent)?.id,
    nodes.find(node => ready.has(node.id))?.id);
  assert.equal(checks.get('spent-a'), 1, 'permanently exhausted prefix entries are not revisited');
  assert.equal(checks.get('spent-c'), 1, 'permanently exhausted entries behind a regrow node are not revisited');
});

// This route accelerates elapsed simulation time and searches procedural coordinates.
// It does not simulate walking/combat or bypass item, research, tool or energy costs.
class ConsumptionRoute {
  constructor(checkpoint = null, checkpointProof = null) {
    this.atlas = checkpoint ? WorldAtlas.fromState(CONTENT, checkpoint.atlas) : new WorldAtlas(CONTENT, { seed: 31415 });
    this.p = new Progression(CONTENT, checkpoint?.progression);
    this.dungeons = new DungeonSystem({ catalog: CONTENT, seed: 31415, atlas: this.atlas });
    this.community = this.dungeons.bootstrap().find(s => s.templateId === 'grove_supply_camp');
    assert(this.community);
    this.nodes = new Map(); this.nodeSearch = new Map(); this.scanned = new Set(); this.nodeIds = new Set();
    this.used = new Map(Object.entries(this.p.harvestClaims).map(([key, claim]) => [key.slice(key.indexOf(':') + 1), claim.at]));
    this.stack = [];
    const claims = [...this.p.claims];
    this.serial = claims.reduce((next, claim) => {
      const match = /^path:harvest:(\d+)$/.exec(claim);
      return match ? Math.max(next, Number(match[1]) + 1) : next;
    }, 0);
    this.made = new Set(entries('material').filter(e => this.p.count(e.id) > 0).map(e => e.id)); this.harvested = {};
    this.crafted = {}; this.studied = new Set(this.p.research);
    this.activityCount = claims.filter(claim => /^complete:activity:\d+$/.test(claim)).length;
    const miningActions = Object.values(this.p.harvestClaims).filter(h => definitions.get(h.sourceId)?.requiredTool === 'stone_pick').length;
    const pickDurability = definitions.get('stone_pick')?.durabilityActions || 0;
    this.replacements = pickDurability ? Math.floor(Math.max(0, miningActions - 1) / pickDurability) : 0;
    this.resumeProof = checkpointProof;
    this.guard();
  }
  guard() {
    const grant = this.p.grant.bind(this.p);
    this.p.grant = (...args) => { assert(this.inHarvest, 'fixture inventory grants are forbidden'); return grant(...args); };
    for (const method of ['discover', '_discover', 'grantReward', 'supplyEnergy']) this.p[method] = () => { throw Error(`Forbidden shortcut ${method}`); };
  }
  advance(seconds, options = {}) {
    while (seconds > 1e-8) { const dt = Math.min(seconds, 3600); assert(this.p.tick(dt, options).ok); seconds -= dt; }
  }
  scan(cx, cz) {
    const key = `${cx},${cz}`; if (this.scanned.has(key)) return;
    this.scanned.add(key);
    const insert = n => { if (this.nodeIds.has(n.id)) return; this.nodeIds.add(n.id); const a = this.nodes.get(n.sourceId) || []; a.push(n); this.nodes.set(n.sourceId, a); };
    for (const n of this.atlas.harvestNodesAround(cx * 64 + 32, cz * 64 + 32, 46)) insert(n);
    // Enumerating generated vein candidates avoids an enormous blind 3D search. Every
    // selected cell is independently checked through the public terrain query below.
    for (const [key, blockId] of this.atlas._oreMap(cx, cz)) {
      const cell = key.split(',').map(Number), block = CONTENT.blocks.entries.find(b => b.id === blockId);
      const source = entries('source').find(s => s.outputs[block?.rawResourceId]);
      if (source) insert({ id: `ore:${key}`, sourceId: source.id, x: cell[0] * .5, y: cell[1] * .5, z: cell[2] * .5, cell, blockId, regrowS: 0 });
    }
  }
  node(source) {
    const nodes = this.nodes.get(source.id) || [];
    if (!this.nodes.has(source.id)) this.nodes.set(source.id, nodes);
    const search = this.nodeSearch.get(source.id) || { cursor: 0, pending: [] };
    this.nodeSearch.set(source.id, search);
    const eligible = n => {
      const at = this.used.get(n.id);
      if (at != null && (!n.regrowS || this.p.clock < at + n.regrowS)) return false;
      if (n.cell && this.atlas.getCell(...n.cell) !== n.blockId) return false;
      const env = CONTENT.environments.entries.find(e => e.id === this.atlas.sample(n.x, n.z).environmentId);
      return n.cell ? env.oreVeins.some(v => CONTENT.blocks.entries.find(b => b.id === v.blockId)?.rawResourceId === Object.keys(source.outputs)[0]) : env.harvestNodeIds.includes(n.nodeId);
    };
    const find = () => findEligibleWithCursor(nodes, search, eligible, n => this.used.get(n.id) != null && !n.regrowS);
    let found = find(); if (found) return found;
    for (let ring = 0; ring <= 96; ring++) {
      for (let x = -ring; x <= ring; x++) for (const z of ring ? [-ring, ring] : [0]) {
        if (this.scanned.has(`${x},${z}`)) continue;
        this.scan(x, z); found = find(); if (found) return found;
      }
      for (let z = -ring + 1; z < ring; z++) for (const x of [-ring, ring]) {
        if (this.scanned.has(`${x},${z}`)) continue;
        this.scan(x, z); found = find(); if (found) return found;
      }
    }
    throw Error(`No actual atlas source for ${source.id}`);
  }
  harvest(source) {
    if (source.requiredTool) {
      const tool = definitions.get(source.requiredTool);
      this.item(tool.id, (this.p.toolWear[tool.id] === 0 ? 2 : 1));
      if (this.p.toolWear[tool.id] === 0) this.replacements++;
    }
    const n = this.node(source), env = this.atlas.sample(n.x, n.z).environmentId;
    this.advance(source.seconds);
    const before = this.p.count(Object.keys(source.outputs)[0]);
    this.inHarvest = true;
    let result;
    try { result = this.p.harvest(source.id, { environmentId: env, nodeId: n.id, nodeType: n.nodeId, elapsed: source.seconds, claimId: `path:harvest:${this.serial++}` }); }
    finally { this.inHarvest = false; }
    assert(result.ok, `${source.id} @ ${n.id}: ${result.reason}`);
    this.used.set(n.id, this.p.clock);
    if (n.cell) { this.atlas.setCell(...n.cell, null); assert.equal(this.atlas.getCell(...n.cell), null); }
    const [id, amount] = Object.entries(source.outputs)[0];
    near(this.p.count(id), before + amount, `${source.id} actual yield, inventory must not overflow`);
    if (definitions.get(id)?.kind === 'material') this.made.add(id);
    this.harvested[source.id] = (this.harvested[source.id] || 0) + 1;
  }
  guarded(key, fn) {
    assert(!this.stack.includes(key), `Dependency cycle: ${[...this.stack, key].join(' -> ')}`);
    this.stack.push(key); try { return fn(); } finally { this.stack.pop(); }
  }
  inputs(cost) {
    for (let i = 0; !this.p.hasItems(cost) && i < 100; i++) for (const [id, n] of Object.entries(cost)) this.item(id, n);
    assert(this.p.hasItems(cost), `Cannot preserve recipe inputs: ${JSON.stringify(cost)}`);
  }
  item(id, quantity = 1) {
    this.p.reclaim(); if (this.p.count(id) + 1e-8 >= quantity) { if (definitions.get(id)?.kind === 'material') this.made.add(id); return; }
    this.guarded(`item:${id}`, () => {
      const source = entries('source').find(s => s.outputs[id]);
      const recipe = entries('recipe').find(r => r.outputs[id]);
      assert(source || recipe, `No non-discovery route to ${id}`);
      let iterations = 0;
      while (this.p.count(id) + 1e-8 < quantity) {
        assert(iterations++ < 10000, `No item progress ${id}`);
        if (source) this.harvest(source);
        else this.craft(recipe, Math.min(64, Math.ceil((quantity - this.p.count(id)) / recipe.outputs[id])));
        this.p.reclaim();
      }
    });
    if (definitions.get(id)?.kind === 'material' && this.p.count(id) + 1e-8 >= quantity) this.made.add(id);
  }
  station(id) {
    if (id === 'hand' || this.p.stations[id]) return;
    this.item(id); assert(this.p.installStation(id).ok, `install ${id}`);
  }
  research(id) {
    if (!id || this.p.research.has(id)) return;
    this.guarded(`research:${id}`, () => {
      const r = definitions.get(id);
      for (const parent of r.prerequisites) this.research(parent);
      this.station(r.station); this.inputs(r.samples);
      const before = { ...this.p.inventory };
      assert(this.p.startResearch(id).ok, `start ${id}`);
      for (const [item, n] of Object.entries(r.samples)) near(this.p.count(item), before[item] - n, `${id} sample debit`);
      this.advance(r.work / r.workRate + .001);
      assert(this.p.research.has(id), `research completion ${id}`); this.studied.add(id);
    });
  }
  component(id, count = 1) { while ((this.p.components[id] || 0) < count) { this.item(id); assert(this.p.placeComponent(id).ok, `place ${id}`); } }
  divine(amount) {
    const activity = definitions.get('community_contribution');
    while (this.p.energy.divine + this.p.energyOverflow.divine + 1e-5 < amount) {
      this.inputs(activity.inputs); const before = { ...this.p.inventory };
      assert(this.p.startActivity(activity.id, { communityId: this.community.id }).ok);
      for (const [id, n] of Object.entries(activity.inputs)) near(this.p.count(id), before[id] - n, 'community payment');
      this.advance(activity.secondsPerRepetition + .001); this.activityCount++;
    }
  }
  craft(recipe, count) {
    this.research(recipe.research); this.station(recipe.station);
    if (recipe.energy.magic) this.component('mana_condenser', 8);
    if (recipe.energy.electrical) this.component('generator');
    if (recipe.energy.chemical) {
      const required = recipe.energy.chemical * count;
      while (this.p.energyCapacity('chemical') < required) {
        this.item('fluid_container'); assert(this.p.placeComponent('fluid_container', { fluidType: 'acid_fluid' }).ok);
      }
      const batches = Math.ceil(Math.max(0, required - this.p.energy.chemical) / 40);
      if (batches) {
        this.item('acid_fluid', batches);
        assert(this.p.setSourceActive('acid_extractor', true).ok); this.advance(batches * 4);
        this.p.setSourceActive('acid_extractor', false);
      }
      assert(this.p.energy.chemical + 1e-5 >= required);
    }
    if (recipe.energy.divine) {
      if (recipe.id === 'assemble_relic') this.divine(recipe.energy.divine * count);
      else this.component('relic', 8);
    }
    this.inputs(Object.fromEntries(Object.entries(recipe.inputs).map(([id, n]) => [id, n * count])));
    const before = { ...this.p.inventory }, energyBefore = { ...this.p.metrics.consumed };
    assert(this.p.queueCraft(recipe.id, { count }).ok, `queue ${recipe.id}`);
    for (const [id, n] of Object.entries(recipe.inputs)) near(this.p.count(id), before[id] - n * count, `${recipe.id} debit ${id}`);
    const fire = Boolean(recipe.energy.thermal);
    if (fire) assert(this.p.setSourceActive('wood_fire', true).ok);
    let elapsed = 0;
    while (this.p.jobs.length) {
      if (fire) this.item('raw_timber', 2);
      this.advance(10, { manual: Boolean(recipe.energy.mechanical || recipe.energy.electrical) });
      elapsed += 10;
      assert(elapsed < Math.max(1000, recipe.seconds * count * 100), `Energy starvation ${recipe.id}: ${JSON.stringify(this.p.jobs[0])}`);
    }
    if (fire) this.p.setSourceActive('wood_fire', false);
    for (const [id, n] of Object.entries(recipe.outputs)) {
      near(this.p.count(id) + (this.p.overflow[id] || 0), (before[id] || 0) - (recipe.inputs[id] || 0) * count + n * count, `${recipe.id} output ${id}`);
      if (definitions.get(id)?.kind === 'material') this.made.add(id);
    }
    for (const type of ENERGY_TYPES) near(this.p.metrics.consumed[type] - energyBefore[type], (recipe.energy[type] || 0) * count, `${recipe.id} energy ${type}`);
    this.crafted[recipe.id] = (this.crafted[recipe.id] || 0) + count;
  }
}

test('all ten tiers and four research fields are reached from actual terrain with consumed resources', { timeout: 1500000 }, t => {
  const resumePath = process.env.FERAL_ROUTE_RESUME;
  const reportPath = process.env.FERAL_ROUTE_REPORT ? path.resolve(process.env.FERAL_ROUTE_REPORT) : null;
  if (reportPath) {
    assert(!resumePath || reportPath !== path.resolve(resumePath), 'route report must not overwrite its input checkpoint');
    assert(!fs.existsSync(reportPath), 'route report path must be new so prior evidence is preserved');
  }
  const checkpointText = resumePath ? fs.readFileSync(resumePath, 'utf8') : null;
  const checkpoint = checkpointText ? JSON.parse(checkpointText) : null;
  const checkpointProof = checkpoint ? {
    sha256: createHash('sha256').update(checkpointText).digest('hex'),
    bytes: Buffer.byteLength(checkpointText),
    seed: checkpoint.atlas?.seed,
    reached: checkpoint.reached,
    clock: checkpoint.progression?.clock,
    claims: checkpoint.progression?.claims?.length,
    harvestLedgerEntries: Object.keys(checkpoint.progression?.harvestClaims || {}).length,
    research: checkpoint.progression?.research?.length,
  } : null;
  if (checkpoint) {
    assert.equal(checkpointProof.sha256, preservedCheckpointSha256, 'resume must use the preserved, previously consumed checkpoint bytes');
    assert.equal(checkpointProof.reached, 'material:superstring_aggregate');
    assert.equal(checkpointProof.claims, 26830);
    assert.equal(checkpointProof.harvestLedgerEntries, 25736);
    assert.equal(checkpointProof.research, 38);
    assert.equal(checkpointProof.clock, 524082.0439497821);
    assert.equal(checkpoint.complete, false, 'resume input must be an incomplete checkpoint');
    assert.equal(String(checkpoint.atlas?.seed), '31415', 'resume must preserve the original atlas seed');
    assert(checkpoint.progression && checkpoint.atlas, 'resume input needs both serialized systems');
    assert(checkpoint.progression.claims.every(claim => /^(?:path:harvest:\d+|complete:(?:craft|activity):\d+)$/.test(claim)), 'resume checkpoint contains only physical harvest, craft, and activity claims');
    assert.equal(checkpoint.progression.fixtureEnergy?.enabled, false, 'resume checkpoint must remain in abstract, unplaced-station mode');
    assert.equal(checkpoint.progression.worldFixtures?.length ?? 0, 0, 'resume checkpoint must not contain externally placed fixtures');
    assert.equal(checkpoint.progression.communityStations?.length ?? 0, 0, 'resume checkpoint must not contain granted community stations');
  }
  const route = new ConsumptionRoute(checkpoint, checkpointProof);
  if (!checkpoint) { assert.deepEqual(route.p.inventory, {}); assert.equal(route.p.research.size, 0); }
  else {
    assert.equal(route.p.clock, checkpoint.progression.clock, 'resume keeps consumed simulation time');
    assert.equal(route.p.claims.size, checkpoint.progression.claims.length, 'resume keeps transaction claims');
    assert.equal(route.p.harvestClaims && Object.keys(route.p.harvestClaims).length, Object.keys(checkpoint.progression.harvestClaims).length, 'resume keeps the harvested-node ledger');
  }
  // Research all paths in one character: no exclusive field selection, fixture state,
  // discovery blueprint, reward grant or external energy receipt is permitted.
  for (const r of entries('research')) {
    route.research(r.id);
    if (process.env.FERAL_ROUTE_TRACE) console.error(`route: ${r.id}, ${Math.round(route.p.clock)}s, nodes=${route.used.size}`);
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ complete: false, reached: r.id, resumedFrom: checkpointProof, progression: route.p.serialize(), atlas: route.atlas.serialize() }));
    if (r.field) t.diagnostic(`researched ${r.id} at ${Math.round(route.p.clock)} simulated seconds`);
  }
  for (const material of entries('material')) if (!route.made.has(material.id)) route.item(material.id);
  for (let tier = 1; tier <= 10; tier++) { route.item(`gear_baseline_t${tier}`); assert(route.p.equip(`gear_baseline_t${tier}`).ok); assert.equal(route.p.evaluateLoadout().tier, tier); }
  assert.equal(route.p.research.size, 39);
  for (const field of ['arcane_engineering', 'arcane_studies', 'sanctity', 'physics']) assert.equal(entries('research').filter(r => r.field === field && route.p.research.has(r.id)).length, 5);
  for (const m of entries('material')) assert(route.made.has(m.id), `material ${m.id} was really produced`);
  for (const s of entries('station')) assert(route.p.stations[s.id], `station ${s.id} was crafted and installed`);
  assert(route.activityCount >= 3); assert(route.replacements > 0, 'route must debit replacement mining tools');
  const total = map => Object.values(map).reduce((a, b) => a + b, 0);
  near(total(route.p.metrics.generated) + Math.floor(route.activityCount / 3) * 20,
    total(route.p.metrics.consumed) + total(route.p.metrics.dissipated) + route.p.metrics.conversionLoss + total(route.p.energy) + total(route.p.energyOverflow),
    'whole-route generated + earned energy = consumption + losses + remaining');
  const saved = route.p.serialize(), restored = new Progression(CONTENT, saved);
  assert.deepEqual(restored.serialize(), saved);
  assert.equal(restored.evaluateLoadout().tier, 10);
  assert.equal(Object.keys(saved.overflow).length, 0, 'the route must fit the real inventory limit');
  const report = { simulatedSeconds: route.p.clock, researched: route.p.research.size, stations: Object.keys(route.p.stations).length, materials: entries('material').length, activities: route.activityCount, toolReplacements: route.replacements, harvestActions: route.harvested, recipes: Object.keys(route.crafted).length, energyConsumed: route.p.metrics.consumed, progressionSaveBytes: Buffer.byteLength(JSON.stringify(saved)), atlasSaveBytes: Buffer.byteLength(JSON.stringify(route.atlas.serialize())), resumedFrom: checkpointProof };
  t.diagnostic(JSON.stringify(report));
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ complete: true, report, progression: saved, atlas: route.atlas.serialize() }));
});
