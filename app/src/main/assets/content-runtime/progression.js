import { FixtureEnergy } from './fixture-energy.js';
// Expedition-only economy. Legacy Inventory IDs and saves are deliberately not aliased.
const TYPES = ['mechanical', 'electrical', 'thermal', 'chemical', 'magic', 'divine'];
const EPS = 1e-8;
const copy = value => JSON.parse(JSON.stringify(value));
const positive = n => Number.isFinite(n) && n > 0 && n <= 1e12;
const nonnegative = n => Number.isFinite(n) && n >= 0 && n <= 1e12;
const fail = reason => ({ ok: false, reason });
const success = extra => ({ ok: true, ...extra });
const zeroEnergy = () => ({ mechanical: 0, electrical: 0, thermal: 0, chemical: 0, magic: 0, divine: 0 });
// Explicit runtime design proposal; catalog materials/gear remain unchanged.
export const PERSONAL_MANA_RULES = Object.freeze({ investedCapacityMax:700,totalCapacityMax:1000,minimumMaterialTier:5,minimumManaCoupling:.6,capacityPerTierCouplingLiter:20,focusCapacityPerTierAboveFour:50,cupCapacityEU:100 });
export class Progression {
  constructor(content, state = {}) {
    this.content = content;
    this.entries = content.progression?.entries || content.entries || [];
    this.catalog = new Map(this.entries.map(e => [e.id, e]));
    // Immutable catalog indexes keep the 0.1-second allocation hot path free of
    // repeated full-registry scans; source/conversion iteration order is preserved.
    this.energySources = this.entries.filter(e => e.kind === 'energy_source' && !e.activity);
    this.conversionsByOutput = new Map(TYPES.map(type => [type, this.entries.filter(e => e.kind === 'conversion' && e.output === type)]));
    this.items = new Set(this.entries.filter(e => ['item', 'material', 'tool', 'station', 'component', 'gear_baseline'].includes(e.kind)).map(e => e.id));
    this.inventory = {}; this.overflow = {}; this.research = new Set(); this.stations = {};
    this.assemblies = []; this.energy = zeroEnergy(); this.energyOverflow = zeroEnergy();
    this.claims = new Set(); this.harvestClaims = {}; this.jobs = []; this.researchJob = null;
    this.researchProgress = {}; this.workCredits = 0; this.activeSources = {}; this.sourceFuel = {};
    this.activityProgress = {}; this.activityRequests = {}; this.worldFixtures = []; this.fixtureAccess = null; this.communityStations = []; this.toolWear = {}; this.clock = 0; this.nextId = 1; this.equipped = null;
    this.metrics = { generated: zeroEnergy(), consumed: zeroEnergy(), dissipated: zeroEnergy(), conversionLoss: 0 };
    if (state.schemaVersion != null && state.schemaVersion !== 1) throw Error('Unsupported expedition progression save');
    for (const field of ['inventory', 'overflow']) for (const [id, amount] of Object.entries(state[field] || {})) {
      if (!this.items.has(id) || !nonnegative(amount)) throw Error('Invalid saved item');
      if (amount) this[field][id] = amount;
    }
    for (const id of state.research || []) { if (this.catalog.get(id)?.kind !== 'research') throw Error('Invalid saved research'); this.research.add(id); }
    for (const [id, n] of Object.entries(state.stations || {})) { if (this.catalog.get(id)?.kind !== 'station' || !Number.isInteger(n) || n < 0) throw Error('Invalid station'); this.stations[id] = n; }
    for (const t of TYPES) for (const field of ['energy', 'energyOverflow']) { const n = state[field]?.[t] ?? 0; if (!nonnegative(n)) throw Error('Invalid saved energy'); this[field][t] = n; }
    for (const field of ['assemblies', 'harvestClaims', 'jobs', 'researchJob', 'researchProgress', 'activeSources', 'sourceFuel', 'activityProgress', 'activityRequests', 'worldFixtures', 'fixtureAccess', 'communityStations', 'toolWear']) if (state[field] != null) this[field] = copy(state[field]);
    this.claims = new Set(state.claims || []);
    for (const f of ['workCredits', 'clock', 'nextId']) if (state[f] != null) { if (!nonnegative(state[f])) throw Error('Invalid save counter'); this[f] = state[f]; }
    this.equipped = state.equipped || null; this.personalManaVessel = state.personalManaVessel || null;
    this.personalMana = copy(state.personalMana || {investedCapacity:0,focusId:null,reserveEU:0,investments:{},cupEU:0,lastCapacity:0});
    this.personalMana.lastCapacity ??= 0;
    // Earlier prototype saves conflated a cup's liquid with the avatar's mana.
    if (!state.personalMana && state.personalManaVessel === 'bark_cup') {this.personalMana.cupEU=Math.min(100,this.energy.magic);this.personalMana.reserveEU=Math.max(0,this.energy.magic-100);this.energy.magic=0;}
    this.fixtureEnergy = new FixtureEnergy(this, state.fixtureEnergy || {});
    if (state.metrics) this.metrics = copy(state.metrics);
    this._validateState();
  }
  list(kind) { return this.entries.filter(e => !kind || e.kind === kind).map(copy); }
  count(id) { return this.inventory[id] || 0; }
  hasItems(cost) { return this._quantities(cost) && Object.entries(cost).every(([id, n]) => this.count(id) + EPS >= n); }
  _quantities(map) { return !!map && typeof map === 'object' && !Array.isArray(map) && Object.entries(map).every(([id, n]) => this.items.has(id) && nonnegative(n)); }
  _energyMap(map) { return !!map && typeof map === 'object' && Object.entries(map).every(([t, n]) => TYPES.includes(t) && nonnegative(n)); }
  _slotCount() { return Object.values(this.inventory).reduce((n, q) => n + Math.ceil((q - EPS) / 64), 0); }
  _put(id, amount) {
    const current = this.count(id), currentSlots = Math.ceil((current - EPS) / 64);
    const capacity = Math.max(0, (36 - this._slotCount() + currentSlots) * 64 - current);
    const put = Math.min(capacity, amount);
    if (put) this.inventory[id] = current + put;
    if (amount - put > EPS) this.overflow[id] = (this.overflow[id] || 0) + amount - put;
  }
  reclaim() {
    const pending = this.overflow; this.overflow = {};
    for (const [id, n] of Object.entries(pending)) this._put(id, n);
    return success({ remaining: copy(this.overflow) });
  }
  _take(cost) { for (const [id, n] of Object.entries(cost)) { this.inventory[id] = Math.max(0, this.count(id) - n); if (this.inventory[id] < EPS) delete this.inventory[id]; } this._reconcilePersonalMana(); }
  _claim(id) { return typeof id === 'string' && id.length > 0 && id.length <= 512; }
  canApply(delta) { return !!delta && Object.entries(delta).every(([id, n]) => this.items.has(id) && Number.isFinite(n) && Math.abs(n) <= 1e12 && (n >= 0 || this.count(id) + EPS >= -n)); }
  apply(delta, transactionId) {
    if (!this._claim(transactionId)) return fail('claim_required');
    if (this.claims.has(transactionId)) return success({ duplicate: true });
    if (!this.canApply(delta)) return fail('insufficient_or_unknown_item');
    for (const [id, n] of Object.entries(delta)) if (n < 0) this._take({ [id]: -n });
    for (const [id, n] of Object.entries(delta)) if (n > 0) this._put(id, n);
    this.claims.add(transactionId); return success({ duplicate: false });
  }
  grant(items, { claimId } = {}) { return this._quantities(items) ? this.apply(items, claimId) : fail('invalid_items'); }
  spend(items, { claimId } = {}) { return this._quantities(items) ? this.apply(Object.fromEntries(Object.entries(items).map(([id, n]) => [id, -n])), claimId) : fail('invalid_items'); }
  transaction({ items = {}, energy = {} } = {}, { claimId } = {}) {
    if (!this._claim(claimId)) return fail('claim_required');
    if (this.claims.has(claimId)) return success({ duplicate: true });
    if (!this.hasItems(items) || !this._energyMap(energy) || Object.entries(energy).some(([t, n]) => this.energyAvailable(t) + EPS < n)) return fail('insufficient_resources');
    for (const [t, n] of Object.entries(energy)) { this.energy[t] = Math.max(0, this.energy[t] - n); this.metrics.consumed[t] += n; } this._take(items);
    this.claims.add(claimId); return success({ duplicate: false });
  }
  _station(id) {
    if (id === 'hand') return true;
    const worldCount = this.worldFixtures.filter(r => r.kind === 'station' && r.assetId === id).length;
    return (!this.fixtureEnergy?.enabled && (this.stations[id] || 0) > worldCount) || this.communityStations.includes(id) || this.worldFixtures.some(r => r.kind === 'station' && r.assetId === id && r.active && r.health > 0 && this.fixtureAccess?.includes(r.ownerId));
  }
  syncWorldFixtures(records, { accessibleOwnerIds = [], communityStations = [] } = {}) {
    if (!Array.isArray(records) || !Array.isArray(accessibleOwnerIds) || !Array.isArray(communityStations) || new Set(records.map(r => r.ownerId)).size !== records.length || !records.every(r => this._claim(r.ownerId) && ['station','component'].includes(r.kind) && this.catalog.get(r.assetId)?.kind === r.kind && nonnegative(r.health) && positive(r.maxHealth) && r.health <= r.maxHealth && typeof r.active === 'boolean') || !accessibleOwnerIds.every(id => records.some(r => r.ownerId === id)) || !communityStations.every(id => this.catalog.get(id)?.kind === 'station')) return fail('invalid_world_fixtures');
    for (const r of this.worldFixtures) if (r.kind === 'station') this.stations[r.assetId] = Math.max(0, (this.stations[r.assetId] || 0) - 1);
    this.worldFixtures = copy(records); this.fixtureAccess = [...accessibleOwnerIds]; this.communityStations = [...communityStations];
    this.assemblies = this.assemblies.filter(a => !a.worldOwnerId);
    for (const r of records) {
      if (r.kind === 'station') this.stations[r.assetId] = (this.stations[r.assetId] || 0) + 1;
      else this.assemblies.push({ id: r.ownerId, worldOwnerId: r.ownerId, componentId: r.assetId, scale: 1, health: r.health / r.maxHealth, connected: r.active ? 1 : 0, accessible: accessibleOwnerIds.includes(r.ownerId), materialId: null, materialLiters: 0, fluidType: r.fluidType || 'liquid_mana' });
    }
    this.fixtureEnergy.sync(records); this._reconcilePersonalMana();
    for (const t of TYPES) { const excess = Math.max(0, this.energy[t] - this.energyCapacity(t)); this.energy[t] -= excess; this.metrics.dissipated[t] += excess; }
    return success();
  }
  recipeStatus(id) {
    const r = this.catalog.get(id); if (r?.kind !== 'recipe') return fail('unknown_recipe');
    if (r.research && !this.research.has(r.research)) return fail('research_required');
    if (!this._station(r.station)) return fail('station_required');
    if (!this.hasItems(r.inputs)) return fail('ingredients_required');
    return success();
  }
  researchStatus(id) {
    const r = this.catalog.get(id); if (r?.kind !== 'research') return fail('unknown_research');
    if (this.research.has(id)) return fail('already_known');
    if (!r.prerequisites.every(p => this.research.has(p))) return fail('prerequisite_required');
    if (!this._station(r.station)) return fail('station_required');
    if (!this.researchProgress[id]?.paid && !this.hasItems(r.samples)) return fail('samples_required');
    return success();
  }
  availableRecipes() { return this.list('recipe').filter(r => this.recipeStatus(r.id).ok); }
  availableResearch() { return this.list('research').filter(r => this.researchStatus(r.id).ok); }
  getAvailable() { return { recipes: this.availableRecipes(), research: this.availableResearch() }; }
  startResearch(id) {
    const available = this.researchStatus(id); if (!available.ok) return available;
    if (this.researchJob && this.researchJob.id !== id) return fail('research_busy');
    const r = this.catalog.get(id);
    if (!this.researchProgress[id]?.paid) { this._take(r.samples); this.researchProgress[id] = { paid: true, work: 0 }; }
    this.researchJob = { id }; return success({ id });
  }
  pauseResearch() { this.researchJob = null; return success(); }
  _discover(blueprintId, origin) {
    const r = this.entries.find(e => e.kind === 'research' && e.blueprint === blueprintId);
    if (!r) return fail('unknown_blueprint');
    if (this.research.has(r.id)) { if (origin === 'discovery') this.workCredits += r.work * (r.duplicateWorkFraction || 0); return success({ id: r.id, alreadyKnown: true }); }
    this.research.add(r.id); if (this.researchJob?.id === r.id) this.researchJob = null;
    return success({ id: r.id, alreadyKnown: false });
  }
  discover(blueprintId, { claimId, origin = 'crafted' } = {}) {
    if (!this._claim(claimId)) return fail('claim_required');
    if (this.claims.has(claimId)) return success({ duplicate: true });
    if (!['crafted', 'discovery'].includes(origin)) return fail('invalid_origin');
    if (!this.entries.some(e => e.kind === 'research' && e.blueprint === blueprintId)) return fail('unknown_blueprint');
    if (origin === 'crafted' && this.count(blueprintId) < 1) return fail('blueprint_required');
    if (origin === 'crafted') this._take({ [blueprintId]: 1 });
    const result = this._discover(blueprintId, origin); this.claims.add(claimId); return result;
  }
  grantReward(payload, { claimId } = {}) {
    if (!this._claim(claimId)) return fail('claim_required');
    if (this.claims.has(claimId)) return success({ duplicate: true });
    const items = payload?.guaranteed || {};
    if (!this._quantities(items) || !nonnegative(payload?.divineEnergy || 0)) return fail('invalid_reward');
    const unlocked = [];
    for (const [id, n] of Object.entries(items)) {
      if (id.startsWith('blueprint:')) { if (!Number.isInteger(n)) return fail('invalid_blueprint_quantity'); }
    }
    for (const [id, n] of Object.entries(items)) {
      if (id.startsWith('blueprint:')) for (let k = 0; k < n; k++) unlocked.push(this._discover(id, 'discovery').id);
      else this._put(id, n);
    }
    this.energyOverflow.divine += payload.divineEnergy || 0; this._reclaimEnergy();
    this.claims.add(claimId); return success({ duplicate: false, items: copy(items), unlocked, energy: payload.divineEnergy || 0 });
  }
  harvest(sourceId, { environmentId, nodeId, nodeType, elapsed = 0, claimId } = {}) {
    const source = this.catalog.get(sourceId), env = this.content.environments?.entries?.find(e => e.id === environmentId);
    if (source?.kind !== 'source' || !env || !this._claim(nodeId) || !this._claim(claimId)) return fail('invalid_harvest_context');
    if (this.claims.has(claimId)) return success({ duplicate: true });
    if (!Number.isFinite(elapsed) || elapsed + EPS < source.seconds) return fail('harvest_time_required');
    if (source.requiredTool && this.count(source.requiredTool) < 1) return fail('tool_required');
    const nodes = this.content.environments.world?.harvestNodes || [];
    const matches = nodes.filter(n => n.sourceId === sourceId && env.harvestNodeIds?.includes(n.id));
    const node = nodeType ? matches.find(n => n.id === nodeType) : matches[0];
    const blocks = new Map((this.content.blocks?.entries || []).map(b => [b.id, b]));
    const outputIds = Object.keys(source.outputs);
    const minerals = (env.oreVeins || []).some(v => outputIds.includes(blocks.get(v.blockId)?.rawResourceId));
    if (!node && !minerals) return fail('source_not_in_environment');
    const tool = this.catalog.get(source.requiredTool);
    if (tool?.durabilityActions && (this.toolWear[tool.id] ?? tool.durabilityActions) <= 0 && this.count(tool.id) < 2) return fail('tool_broken');
    const key = `${environmentId}:${nodeId}`;
    const previous = this.harvestClaims[key];
    if (previous && (previous.sourceId !== sourceId || !node?.regrowS || this.clock + EPS < previous.at + node.regrowS)) return fail('source_depleted');
    if (tool?.durabilityActions) {
      if (this.toolWear[tool.id] === 0) { this._take({ [tool.id]: 1 }); this.toolWear[tool.id] = tool.durabilityActions; }
      this.toolWear[tool.id] = (this.toolWear[tool.id] ?? tool.durabilityActions) - 1;
    }
    this.grant(source.outputs, { claimId }); this.harvestClaims[key] = { sourceId, at: this.clock };
    return success({ items: copy(source.outputs), seconds: source.seconds });
  }
  queueCraft(recipeId, { count = 1, autoInstall = false, fixtureId = null } = {}) {
    if (!Number.isInteger(count) || count < 1 || count > 64 || this.jobs.length >= 64) return fail('invalid_queue_count');
    const status = this.recipeStatus(recipeId); if (!status.ok) return status;
    const r = this.catalog.get(recipeId), inputs = Object.fromEntries(Object.entries(r.inputs).map(([id, n]) => [id, n * count]));
    if (!this.hasItems(inputs)) return fail('ingredients_required');
    if (autoInstall && !Object.keys(r.outputs).every(id => this.catalog.get(id)?.kind === 'station')) return fail('not_station_recipe');
    if (this.fixtureEnergy.enabled && r.station !== 'hand') {
      fixtureId ||= this.worldFixtures.find(f => f.assetId === r.station && f.active && f.health > 0 && this.fixtureAccess?.includes(f.ownerId))?.ownerId || null;
      const fixture = this.worldFixtures.find(f => f.ownerId === fixtureId);
      if (!fixture || fixture.assetId !== r.station || !fixture.active || !this.fixtureAccess?.includes(fixtureId)) return fail('physical_station_required');
    }
    if (this.fixtureEnergy.enabled && autoInstall) return fail('world_placement_required');
    this._take(inputs);
    const job = { id: `craft:${this.nextId++}`, type: 'craft', recipeId, count, progress: 0, autoInstall, ...(fixtureId ? {fixtureId} : {}) };
    this.jobs.push(job); return success({ jobId: job.id });
  }
  bindCraftJob(jobId, fixtureId) {
    const job = this.jobs.find(j => j.id === jobId), fixture = this.worldFixtures.find(f => f.ownerId === fixtureId);
    if (!this.fixtureEnergy.enabled || job?.type !== 'craft') return fail('unknown_physical_craft');
    const recipe = this.catalog.get(job.recipeId);
    if (recipe.station === 'hand' || !fixture || fixture.kind !== 'station' || fixture.assetId !== recipe.station || !fixture.active || fixture.health <= 0 || !this.fixtureAccess?.includes(fixtureId)) return fail('physical_station_required');
    if (job.fixtureId === fixtureId) return success({ jobId, fixtureId, duplicate: true });
    // An extant owner's reserved energy never teleports to another workbench.
    // Rebinding is only migration of an unlocated job, or recovery after its
    // old fixture was removed (that fixture's remaining energy was dissipated).
    if (job.fixtureId && this.worldFixtures.some(f => f.ownerId === job.fixtureId)) return fail('job_station_locked');
    job.fixtureId = fixtureId; job.autoInstall = false;
    return success({ jobId, fixtureId, progress: job.progress });
  }
  // Recipe outputs only appear at completion, so cancelling returns the paid item inputs.
  // Energy already spent or charged into a workbench for this job is not refunded.
  cancelJob(jobId, { claimId } = {}) {
    if (!this._claim(claimId)) return fail('claim_required');
    if (this.claims.has(claimId)) return success({ duplicate: true });
    const index = this.jobs.findIndex(j => j.id === jobId);
    if (index < 0) return fail('job_not_found');
    const job = this.jobs[index];
    if (job.type !== 'craft') return fail('job_not_cancellable');
    const r = this.catalog.get(job.recipeId), refund = Object.fromEntries(Object.entries(r.inputs).map(([id, n]) => [id, n * job.count]));
    this.jobs.splice(index, 1);
    for (const [id, n] of Object.entries(refund)) this._put(id, n);
    this.claims.add(claimId);
    return success({ jobId, refund: copy(refund) });
  }
  // Only the first queued job progresses; moving one forward never changes paid inputs or reservations.
  prioritizeJob(jobId) {
    const index = this.jobs.findIndex(j => j.id === jobId);
    if (index < 0) return fail('job_not_found');
    if (index > 0) this.jobs.unshift(...this.jobs.splice(index, 1));
    return success({ jobId });
  }
  jobStatus(job) {
    if (job?.type === 'activity') { const a = this.catalog.get(job.activityId); return { total: a.secondsPerRepetition, progress: job.progress, blocked: null, energy: {} }; }
    const r = this.catalog.get(job?.recipeId); if (r?.kind !== 'recipe') return { total: 0, progress: 0, blocked: 'job_not_found', energy: {} };
    const total = r.seconds * job.count, energy = Object.fromEntries(Object.entries(r.energy).map(([t, n]) => [t, n / r.seconds]));
    let blocked = null;
    if (r.research && !this.research.has(r.research)) blocked = 'research_required';
    else if (!this._station(r.station)) blocked = 'station_required';
    else if (this.fixtureEnergy.enabled && r.station !== 'hand') {
      const fixture = this.worldFixtures.find(f => f.ownerId === job.fixtureId);
      if (!fixture) blocked = 'physical_station_required';
      else if (!fixture.active || fixture.health <= 0) blocked = 'fixture_unavailable';
      else if (!this.fixtureAccess?.includes(job.fixtureId)) blocked = 'station_out_of_reach';
    }
    return { total, progress: job.progress, blocked, energy, fixtureId: job.fixtureId ?? null };
  }
  buildStation(id) { const station = this.catalog.get(id); return station?.kind === 'station' ? this.queueCraft(station.origin.recipe, { autoInstall: true }) : fail('unknown_station'); }
  installStation(id) {
    if (this.fixtureEnergy.enabled) return fail('world_placement_required');
    if (this.catalog.get(id)?.kind !== 'station' || this.count(id) < 1) return fail('station_item_required');
    this._take({ [id]: 1 }); this.stations[id] = (this.stations[id] || 0) + 1; return success({ id });
  }
  get components() { if (this._tickCache?.components) return this._tickCache.components; const counts = {}; for (const a of this.assemblies) if (a.health > 0 && a.connected > 0 && a.accessible !== false) counts[a.componentId] = (counts[a.componentId] || 0) + 1; if (this._tickCache) this._tickCache.components = counts; return counts; }
  hasComponent(id) { return (this.components[id] || 0) > 0; }
  evaluateMaterial(materialId, { volumeLiters = 1, connectedAreaM2 = .25, health = 1 } = {}) {
    const m = this.catalog.get(materialId);
    if (m?.kind !== 'material' || !positive(volumeLiters) || !positive(connectedAreaM2) || !nonnegative(health) || health > 1) return fail('invalid_material_geometry');
    const p = m.properties;
    return success({ materialId, tier: m.tier, field: m.field, massKg: p.densityKgM3 * volumeLiters / 1000, maxHp: p.cellHp * volumeLiters / 125, hp: p.cellHp * volumeLiters / 125 * health, loadKn: p.strengthIndex * .05 * connectedAreaM2 / .25 * health, heatLimitC: p.heatLimitC, acidResistance: p.acidResistance, manaCoupling: p.manaCoupling, functionsGranted: [] });
  }
  placeComponent(id, { scale = 1, materialId = null, materialLiters = 1, fluidType = 'liquid_mana' } = {}) {
    if (this.fixtureEnergy.enabled) return fail('world_placement_required');
    const c = this.catalog.get(id);
    if (c?.kind !== 'component' || this.count(id) < 1 || !this.research.has(c.research)) return fail('component_required');
    if (!positive(scale) || scale < c.designEnvelope.scaleMin || scale > c.designEnvelope.scaleMax) return fail('invalid_scale');
    // Larger cores require proportionally more manufactured component items, never free multiplication.
    const coreCount = Math.max(1, Math.ceil(scale)); const cost = { [id]: coreCount };
    if (materialId) { if (!this.evaluateMaterial(materialId, { volumeLiters: materialLiters }).ok) return fail('invalid_material'); cost[materialId] = materialLiters; }
    if (!this.hasItems(cost) || (id === 'fluid_container' && !c.fluidContents.includes(fluidType))) return fail('invalid_assembly_inputs');
    this._take(cost);
    const instance = { id: `component:${this.nextId++}`, componentId: id, scale, health: 1, connected: 1, materialId, materialLiters: materialId ? materialLiters : 0, fluidType };
    this.assemblies.push(instance); return success({ instanceId: instance.id, entityType: 'machine' });
  }
  evaluateComponent(instanceId) {
    const a = this.assemblies.find(x => x.id === instanceId); if (!a) return fail('unknown_component');
    const c = this.catalog.get(a.componentId), factor = a.scale * Math.min(a.health, a.connected);
    return success({ instanceId, componentId: c.id, entityType: 'machine', functions: [...c.functions], inputEnergies: [...c.inputEnergies], outputEnergies: [...c.outputEnergies], power: c.nominalPower * factor, capacity: c.capacity * factor, efficiency: c.efficiency, material: a.materialId ? this.evaluateMaterial(a.materialId, { volumeLiters: a.materialLiters, health: a.health }) : null });
  }
  setComponentCondition(instanceId, { health, connected } = {}) {
    const a = this.assemblies.find(x => x.id === instanceId); if (!a) return fail('unknown_component');
    for (const n of [health, connected]) if (n != null && (!nonnegative(n) || n > 1)) return fail('invalid_condition');
    if (health != null) a.health = health; if (connected != null) a.connected = connected;
    // Lost capacity dissipates rather than duplicating stored energy in a broken component.
    for (const t of TYPES) { const excess = Math.max(0, this.energy[t] - this.energyCapacity(t)); this.energy[t] -= excess; this.metrics.dissipated[t] += excess; }
    return success();
  }
  _rated(componentId, field) {
    const key = `${componentId}:${field}`, cache = this._tickCache?.ratings;
    if (cache?.has(key)) return cache.get(key);
    const value = this.assemblies.filter(a => a.componentId === componentId).reduce((s, a) => s + (this.catalog.get(componentId)[field] || 0) * a.scale * Math.min(a.health, a.connected), 0);
    cache?.set(key, value); return value;
  }
  energyCapacity(type) {
    if (!TYPES.includes(type)) return 0;
    if (this.fixtureEnergy?.enabled) return type === 'divine' ? 100 : type === 'magic' ? this.personalManaCapacity() : 0;
    if (this._tickCache?.capacities.has(type)) return this._tickCache.capacities.get(type);
    let capacity = type === 'divine' ? 100 : 0;
    for (const a of this.assemblies) {
      const c = this.catalog.get(a.componentId), factor = a.scale * Math.min(a.health, a.connected);
      if (c.stores.includes(type)) capacity += c.capacity * factor;
      if (a.componentId === 'fluid_container' && ((type === 'magic' && a.fluidType === 'liquid_mana') || (type === 'chemical' && a.fluidType === 'acid_fluid'))) capacity += c.capacityLiters * (type === 'magic' ? 100 : 40) * factor;
    }
    this._tickCache?.capacities.set(type, capacity); return capacity;
  }
  energyAvailable(type) { if(type==='magic')this._reconcilePersonalMana();return TYPES.includes(type) ? this.energy[type] : 0; }
  _reclaimEnergy() { this._reconcilePersonalMana(); for (const t of TYPES) { const n = Math.min(this.energyOverflow[t], Math.max(0, this.energyCapacity(t) - this.energy[t])); this.energyOverflow[t] -= n; this.energy[t] += n; } }
  supplyEnergy(type, amount, { claimId } = {}) {
    if (!TYPES.includes(type) || !nonnegative(amount) || !this._claim(claimId)) return fail('invalid_energy_supply');
    if (this.claims.has(claimId)) return success({ duplicate: true });
    // This is an externally debited reward/input escrow. It never regenerates by itself.
    this.energyOverflow[type] += amount; this.claims.add(claimId); this._reclaimEnergy(); return success({ accepted: amount, pending: this.energyOverflow[type] });
  }
  storeEnergy(type, amount) {
    if (!TYPES.includes(type) || !nonnegative(amount)) return fail('invalid_energy');
    const efficiency = type === 'electrical' || type === 'mechanical' ? .9 : 1;
    const accepted = Math.min(amount, Math.max(0, this.energyCapacity(type) - this.energy[type]) / efficiency);
    this.energy[type] += accepted * efficiency; this.metrics.dissipated[type] += accepted * (1 - efficiency);
    return success({ accepted, stored: accepted * efficiency, remainder: amount - accepted });
  }
  store(type, amount) { return this.storeEnergy(type, amount); }
  consume(type, amount, options) { return this.consumeEnergy(type, amount, options); }
  transfer(target, type, amount, options) { return this.transferEnergy(target, type, amount, options); }
  consumeEnergy(type, amount, { claimId } = {}) { return this.transaction({ energy: { [type]: amount } }, { claimId }); }
  transferEnergy(target, type, amount, { claimId } = {}) {
    if (!(target instanceof Progression) || target === this || !this._claim(claimId) || !TYPES.includes(type) || !positive(amount)) return fail('invalid_transfer');
    if (this.claims.has(`transfer:${claimId}`)) return success({ duplicate: true });
    if (this.energy[type] + EPS < amount) return fail('insufficient_energy');
    const room = Math.max(0, target.energyCapacity(type) - target.energy[type]);
    if (room + EPS < amount) return fail('target_capacity');
    this.energy[type] -= amount; target.energy[type] += amount;
    this.claims.add(`transfer:${claimId}`); target.claims.add(`received:${claimId}`); return success({ transferred: amount });
  }
  fillContainer(instanceId, fluid, liters) {
    if (this.fixtureEnergy.enabled) return fail('fixed_container_owner_required');
    const a = this.assemblies.find(x => x.id === instanceId);
    if (!a || a.componentId !== 'fluid_container' || a.fluidType !== fluid || !positive(liters)) return fail('invalid_container');
    const type = fluid === 'liquid_mana' ? 'magic' : fluid === 'acid_fluid' ? 'chemical' : null;
    if (!type || !this.hasItems({ [fluid]: liters })) return fail('invalid_fluid');
    const eu = liters * (type === 'magic' ? 100 : 40);
    if (this.energyCapacity(type) - this.energy[type] + EPS < eu) return fail('container_full');
    this._take({ [fluid]: liters }); this.energy[type] += eu; return success({ energy: eu });
  }
  personalManaCapacity() {
    const focus=this.personalMana&&this.catalog.get(this.personalMana.focusId),bonus=focus?.kind==='gear_baseline'&&focus.tier>=5&&this.count(focus.id)>0?(focus.tier-4)*PERSONAL_MANA_RULES.focusCapacityPerTierAboveFour:0;
    return Math.min(PERSONAL_MANA_RULES.totalCapacityMax,(this.personalMana?.investedCapacity||0)+bonus);
  }
  _reconcilePersonalMana() {
    if(!this.fixtureEnergy?.enabled||!this.personalMana)return;
    const capacity=this.personalManaCapacity(),excess=Math.max(0,this.energy.magic-capacity);
    this.energy.magic-=excess;this.personalMana.reserveEU+=excess;
    const restored=Math.min(this.personalMana.reserveEU,Math.max(0,capacity-this.personalMana.lastCapacity),Math.max(0,capacity-this.energy.magic));this.personalMana.reserveEU-=restored;this.energy.magic+=restored;this.personalMana.lastCapacity=capacity;
  }
  manaStatus() { this._reconcilePersonalMana(); return {...copy(this.personalMana),capacityEU:this.personalManaCapacity(),activeEU:this.energy.magic,cupAccessible:this.count('bark_cup')>0&&this.personalManaVessel==='bark_cup',rules:copy(PERSONAL_MANA_RULES)}; }
  quoteManaInvestment(materialId,liters=1) {
    const m=this.catalog.get(materialId),rules=PERSONAL_MANA_RULES;
    if(m?.kind!=='material'||m.tier<rules.minimumMaterialTier||m.properties.manaCoupling<rules.minimumManaCoupling||!Number.isInteger(liters)||liters<1||liters>10)return fail('invalid_mana_material');
    const gainPerLiter=Math.floor(rules.capacityPerTierCouplingLiter*m.tier*m.properties.manaCoupling),gain=Math.min(gainPerLiter*liters,rules.investedCapacityMax-this.personalMana.investedCapacity);
    return gain>0?success({items:{[materialId]:liters},capacityGain:gain,gainPerLiter,maxInvestedCapacity:rules.investedCapacityMax}):fail('mana_capacity_cap');
  }
  investMana(materialId,liters=1,{claimId}={}) {
    if(!this._claim(claimId))return fail('claim_required');if(this.claims.has(`mana-invest:${claimId}`))return success({duplicate:true});
    if(!this.fixtureEnergy.enabled||!this.research.has('mana'))return fail('mana_research_required');const quote=this.quoteManaInvestment(materialId,liters);if(!quote.ok)return quote;
    const paid=this.spend(quote.items,{claimId:`mana-invest:${claimId}`});if(!paid.ok)return paid;
    this.personalMana.investedCapacity+=quote.capacityGain;this.personalMana.investments[materialId]=(this.personalMana.investments[materialId]||0)+liters;this._reconcilePersonalMana();return success({capacityGain:quote.capacityGain,capacityEU:this.personalManaCapacity(),manaAddedEU:0});
  }
  equipManaFocus(id) {
    const g=this.catalog.get(id);if(!this.fixtureEnergy.enabled||!this.research.has('mana')||g?.kind!=='gear_baseline'||g.tier<5||this.count(id)<1)return fail('mana_focus_required');
    this.personalMana.focusId=id;this._reconcilePersonalMana();return success({capacityEU:this.personalManaCapacity(),manaAddedEU:0});
  }
  unequipManaFocus() {this.personalMana.focusId=null;this._reconcilePersonalMana();return success({capacityEU:this.personalManaCapacity(),preservedEU:this.personalMana.reserveEU});}
  useManaCup() {if(!this.research.has('mana')||this.count('bark_cup')<1)return fail('personal_mana_container_required');this.personalManaVessel='bark_cup';return success({externalCupCapacityEU:100,bodyCapacityEU:this.personalManaCapacity()});}
  fillManaCup(liters,{claimId}={}) {
    if(!this._claim(claimId))return fail('claim_required');if(this.claims.has(`mana-cup:${claimId}`))return success({duplicate:true});
    if(this.personalManaVessel!=='bark_cup'||this.count('bark_cup')<1||!positive(liters)||this.personalMana.cupEU+liters*100>100+EPS)return fail('personal_mana_container_required');
    const paid=this.spend({liquid_mana:liters},{claimId:`mana-cup:${claimId}`});if(!paid.ok)return paid;this.personalMana.cupEU+=liters*100;return success({storedCupEU:liters*100});
  }
  absorbManaCup(amount,{claimId}={}) {
    if(!this._claim(claimId))return fail('claim_required');if(this.claims.has(`mana-absorb:${claimId}`))return success({duplicate:true});this._reconcilePersonalMana();
    if(this.personalManaVessel!=='bark_cup'||this.count('bark_cup')<1||!positive(amount)||this.personalMana.cupEU+EPS<amount||this.energy.magic+amount>this.personalManaCapacity()+EPS)return fail('mana_capacity_or_cup');
    this.personalMana.cupEU-=amount;this.energy.magic+=amount;this.claims.add(`mana-absorb:${claimId}`);return success({absorbedEU:amount});
  }
  fillPersonalMana(liters,{claimId}={}) {
    if(!this._claim(claimId))return fail('claim_required');if(this.claims.has(`personal-mana:${claimId}`))return success({duplicate:true});this._reconcilePersonalMana();
    if(!this.fixtureEnergy.enabled||!this.research.has('mana')||!positive(liters)||this.energy.magic+liters*100>this.personalManaCapacity()+EPS)return fail('mana_capacity_required');
    const paid=this.spend({liquid_mana:liters},{claimId:`personal-mana:${claimId}`});if(!paid.ok)return paid;this.energy.magic+=liters*100;return success({storedEU:liters*100,capacityEU:this.personalManaCapacity()});
  }
  recoverUnpositionedFixtures({ claimId } = {}) {
    if (!this.fixtureEnergy.enabled || !this._claim(claimId)) return fail('migration_context_required');
    if (this.claims.has(`fixture-migration:${claimId}`)) return success({duplicate:true});
    const items={};
    for (const a of this.assemblies.filter(a=>!a.worldOwnerId)) { if(a.health>=1-EPS)items[a.componentId]=(items[a.componentId]||0)+Math.ceil(a.scale);else{const recipe=this.catalog.get(this.catalog.get(a.componentId).origin.recipe);for(const[id,n]of Object.entries(recipe.inputs))items[id]=(items[id]||0)+n*Math.ceil(a.scale)*a.health*.5;} if(a.materialId)items[a.materialId]=(items[a.materialId]||0)+a.materialLiters*a.health; }
    this.assemblies=this.assemblies.filter(a=>a.worldOwnerId);
    for (const[id,count]of Object.entries(this.stations)) {const located=this.worldFixtures.filter(f=>f.kind==='station'&&f.assetId===id).length,extra=Math.max(0,count-located);if(extra)items[id]=(items[id]||0)+extra;this.stations[id]=located;}
    for(const[id,time]of Object.entries(this.sourceFuel)){const source=this.catalog.get(id);if(source?.duration)for(const[item,n]of Object.entries(source.inputs))items[item]=(items[item]||0)+n*time/source.duration;}this.sourceFuel={};
    this.grant(items,{claimId:`fixture-migration:${claimId}`});return success({items,energyEscrow:copy(this.fixtureEnergy.legacyEscrow)});
  }
  setSourceActive(id, enabled) {
    if (this.fixtureEnergy.enabled) return fail('fixed_source_owner_required');
    const s = this.catalog.get(id); if (s?.kind !== 'energy_source' || s.activity || typeof enabled !== 'boolean') return fail('invalid_source');
    if (enabled && s.requiredComponent && !this.hasComponent(s.requiredComponent)) return fail('component_required');
    this.activeSources[id] = enabled; return success();
  }
  startActivity(id, { communityId, requestId } = {}) {
    if (requestId != null && !this._claim(requestId)) return fail('invalid_request');
    const previous = requestId && this.activityRequests[requestId];
    if (previous) return previous.activityId === id && previous.communityId === communityId ? success({ jobId: previous.jobId, duplicate: true }) : fail('request_conflict');
    const a = this.catalog.get(id); if (a?.kind !== 'activity' || !this._claim(communityId)) return fail('community_required');
    if (this.jobs.length >= 64 || !this.hasItems(a.inputs)) return fail('activity_inputs_required');
    this._take(a.inputs); const job = { id: `activity:${this.nextId++}`, type: 'activity', activityId: id, communityId, progress: 0 };
    this.jobs.push(job); if (requestId) this.activityRequests[requestId] = { jobId: job.id, activityId: id, communityId }; return success({ jobId: job.id });
  }
  equip(id) {
    if (this.catalog.get(id)?.kind !== 'gear_baseline' || this.count(id) < 1) return fail('gear_required');
    this.equipped = id; return success({ loadout: this.evaluateLoadout() });
  }
  evaluateLoadout() {
    const g = this.count(this.equipped) >= 1 ? this.catalog.get(this.equipped) : null;
    return g?.kind === 'gear_baseline' ? { id: g.id, tier: g.tier, hp: g.hp, maxHp: g.hp, damageReduction: g.damageReduction, incomingDamageMultiplier: g.incomingDamageMultiplier, sustainedDps: g.sustainedDps, hitDamage: g.hitDamage, attackPeriod: g.attackPeriod } : { id: null, tier: 0, hp: 100, maxHp: 100, damageReduction: 0, incomingDamageMultiplier: 1, sustainedDps: 4, hitDamage: 4, attackPeriod: 1 };
  }
  _generate(dt, options, demand) {
    const fresh = zeroEnergy(), escrowDraw = zeroEnergy();
    for (const s of this.energySources) {
      const autonomous = s.id === 'ambient_mana' || s.id === 'relic_divinity';
      if (!(this.activeSources[s.id] ?? autonomous) && !(s.id === 'manual_crank' && options.manual)) continue;
      if (s.id === 'manual_crank' && !options.manual) continue;
      if (s.requiredComponent && !this.hasComponent(s.requiredComponent)) continue;
      let factor = this._tickCache?.sourceFactors.get(s.id);
      if (factor === undefined) { factor = s.requiredComponent ? this.assemblies.filter(a => a.componentId === s.requiredComponent).reduce((n, a) => n + a.scale * Math.min(a.health, a.connected), 0) : 1; this._tickCache?.sourceFactors.set(s.id, factor); }
      let output = 0;
      if (s.duration) {
        let time = dt;
        while (time > EPS) {
          if ((this.sourceFuel[s.id] || 0) < EPS) {
            if (!this.hasItems(s.inputs)) break;
            this._take(s.inputs); this.sourceFuel[s.id] = s.duration;
          }
          const used = Math.min(time, this.sourceFuel[s.id]);
          // Fuel duration describes one paid batch, so multiple housings do not multiply its energy.
          output += used * s.power; this.sourceFuel[s.id] -= used; time -= used;
        }
      } else output = (s.power || 0) * factor * dt;
      if (s.storage) output = Math.min(output, Math.max(0, this.energyCapacity(s.energy) - this.energy[s.energy]) + (demand[s.energy] || 0));
      fresh[s.energy] += output; this.metrics.generated[s.energy] += output;
    }
    // An external receipt is finite escrow, not a regenerating source. At most this step's
    // process demand enters a transient channel without a physical accumulator.
    for (const t of TYPES) {
      const n = Math.min(this.energyOverflow[t], Math.max(0, (demand[t] || 0) - fresh[t] - this.energy[t]));
      fresh[t] += n; this.energyOverflow[t] -= n; escrowDraw[t] = n;
    }
    return { fresh, escrowDraw };
  }
  _allocation(fresh, dt, rates, seconds) {
    const stored = { ...this.energy }, pool = { ...zeroEnergy(), ...fresh }, conversionUsed = {}, energySpent = zeroEnergy(), released = zeroEnergy();
    const releaseLimits = { mechanical: this._rated('inertial_cell', 'nominalPower') * dt, electrical: this._rated('battery', 'nominalPower') * dt, thermal: 0, chemical: Infinity, magic: Infinity, divine: (10 + this._rated('relic', 'nominalPower')) * dt };
    let loss = 0;
    const draw = (type, n, seen = []) => {
      let got = 0;
      const take = (map, amount) => { const v = Math.min(map[type], amount); map[type] -= v; return v; };
      got += take(pool, n); const storedDraw = take(stored, Math.min(n - got, Math.max(0, releaseLimits[type] - released[type]))); got += storedDraw; released[type] += storedDraw;
      if (got + EPS >= n || seen.includes(type)) return got;
      for (const c of this.conversionsByOutput.get(type) || []) {
        if (!this.hasComponent(c.component) || seen.includes(c.input)) continue;
        const inputLimit = Math.max(0, this._rated(c.component, 'nominalPower') * dt - (conversionUsed[c.id] || 0));
        const inputNeed = Math.min(inputLimit, (n - got) / c.efficiency);
        if (inputNeed <= EPS) continue;
        const used = draw(c.input, inputNeed, [...seen, type]);
        conversionUsed[c.id] = (conversionUsed[c.id] || 0) + used;
        got += used * c.efficiency; loss += used * (1 - c.efficiency);
        if (got + EPS >= n) break;
      }
      return got;
    };
    for (const [type, rate] of Object.entries(rates)) {
      const need = rate * seconds, got = draw(type, need);
      if (got + EPS < need) return null;
      energySpent[type] = need;
    }
    return { stored, pool, loss, energySpent };
  }
  _finishJob(job) {
    const claimId = `complete:${job.id}`;
    if (this.claims.has(claimId)) return;
    if (job.type === 'craft') {
      const r = this.catalog.get(job.recipeId);
      for (const [id, n] of Object.entries(r.outputs)) {
        if (job.autoInstall) this.stations[id] = (this.stations[id] || 0) + n * job.count;
        else this._put(id, n * job.count);
      }
    } else {
      const a = this.catalog.get(job.activityId);
      this.activityProgress[a.id] = (this.activityProgress[a.id] || 0) + 1;
      if (this.activityProgress[a.id] >= a.repetitions) {
        this.activityProgress[a.id] -= a.repetitions;
        for (const [t, n] of Object.entries(a.outputEnergy)) this.energyOverflow[t] += n;
      }
    }
    this.claims.add(claimId);
  }
  _step(dt, options) {
    this.clock += dt; this._reclaimEnergy();
    if (this.researchJob && options.researching !== false) {
      const r = this.catalog.get(this.researchJob.id), progress = this.researchProgress[r.id];
      if (this._station(r.station)) {
        const credit = Math.min(this.workCredits, Math.max(0, r.work - progress.work));
        this.workCredits -= credit; progress.work = Math.min(r.work, progress.work + credit + dt * r.workRate);
        if (progress.work + EPS >= r.work) { this.research.add(r.id); this.researchJob = null; }
      }
    }
    const job = this.jobs[0]; let rates = {}, remaining = 0, permitted = true;
    if (job?.type === 'craft') {
      const r = this.catalog.get(job.recipeId); remaining = r.seconds * job.count - job.progress;
      permitted = this._station(r.station) && (!r.research || this.research.has(r.research));
      rates = Object.fromEntries(Object.entries(r.energy).map(([t, n]) => [t, n / r.seconds]));
    } else if (job) remaining = this.catalog.get(job.activityId).secondsPerRepetition - job.progress;
    const seconds = job && permitted ? Math.max(0, Math.min(dt, remaining)) : 0;
    const demand = Object.fromEntries(Object.entries(rates).map(([t, n]) => [t, n * seconds]));
    let progressed;
    if (this.fixtureEnergy.enabled) {
      if (job?.type === 'craft' && this.catalog.get(job.recipeId).station !== 'hand') permitted = permitted && !!job.fixtureId && this.fixtureAccess?.includes(job.fixtureId) && this.worldFixtures.some(f => f.ownerId === job.fixtureId && f.active && f.health > 0);
      progressed = this.fixtureEnergy.step(dt, {consumerId: job?.fixtureId, rates, seconds: permitted ? seconds : 0, manual: !!options.manual}).progressed;
    } else {
    const { fresh, escrowDraw } = this._generate(dt, options, demand);
    let result = this._allocation(fresh, dt, rates, seconds); progressed = seconds;
    if (!result) {
      let low = 0, high = seconds; result = this._allocation(fresh, dt, rates, 0);
      for (let k = 0; k < 20; k++) { const mid = (low + high) / 2, trial = this._allocation(fresh, dt, rates, mid); if (trial) { low = mid; result = trial; } else high = mid; }
      progressed = low;
    }
    this.energy = result.stored; this.metrics.conversionLoss += result.loss;
    for (const t of TYPES) {
      this.metrics.consumed[t] += result.energySpent[t];
      const refund = Math.min(result.pool[t], escrowDraw[t]);
      this.energyOverflow[t] += refund; result.pool[t] -= refund;
      const deposited = this.storeEnergy(t, result.pool[t]);
      this.metrics.dissipated[t] += deposited.remainder;
    }
    }
    if (job && permitted) {
      job.progress += progressed;
      if (job.progress + EPS >= (job.type === 'craft' ? this.catalog.get(job.recipeId).seconds * job.count : this.catalog.get(job.activityId).secondsPerRepetition)) {
        this._finishJob(job); this.jobs.shift();
      }
    }
    this._reclaimEnergy();
  }
  tick(dt, options = {}) {
    if (!Number.isFinite(dt) || dt < 0 || dt > 3600) return fail('invalid_dt');
    // Assemblies cannot change inside this synchronous legacy tick. Cache only
    // immutable assembly-derived values, discard even on failure, and never
    // apply this shortcut to positional networks or across separate tick calls.
    if (!this.fixtureEnergy.enabled) this._tickCache = { capacities: new Map(), ratings: new Map(), sourceFactors: new Map(), components: null };
    try {
    // Chunking bounds simulation cost and prevents rate-based energy bursts on large frame deltas.
    let left = dt; while (left > EPS) {
      const job = this.jobs[0], recipe = job?.type === 'craft' ? this.catalog.get(job.recipeId) : null;
      const quiet = !this.fixtureEnergy.enabled && !options.manual && this.assemblies.length === 0 && !Object.values(this.activeSources).some(Boolean) && (!recipe || Object.keys(recipe.energy).length === 0);
      const remaining = job ? (recipe ? recipe.seconds * job.count : this.catalog.get(job.activityId).secondsPerRepetition) - job.progress : left;
      const step = Math.min(quiet ? Math.max(EPS, remaining) : .1, left); this._step(step, options); left -= step;
    }
    return success({ clock: this.clock, jobs: this.jobs.length, research: this.researchJob?.id || null });
    } finally { this._tickCache = null; }
  }
  status() {
    return { inventory: copy(this.inventory), overflow: copy(this.overflow), research: [...this.research], researchJob: copy(this.researchJob), researchProgress: copy(this.researchProgress), workCredits: this.workCredits, jobs: copy(this.jobs), stations: copy(this.stations), components: this.components, assemblies: this.assemblies.map(a => ({ ...copy(a), ...this.evaluateComponent(a.id) })), energy: copy(this.energy), energyCapacity: Object.fromEntries(TYPES.map(t => [t, this.energyCapacity(t)])), energyOverflow: copy(this.energyOverflow), activeSources: copy(this.activeSources), loadout: this.evaluateLoadout(), toolWear: copy(this.toolWear), fixtureEnergy: this.fixtureEnergy.status(), personalManaVessel: this.personalManaVessel, personalMana: this.manaStatus(), clock: this.clock };
  }
  serialize() {
    this._reconcilePersonalMana();
    return { schemaVersion: 1, fixtureEnergy: this.fixtureEnergy.serialize(), personalManaVessel: this.personalManaVessel, personalMana: copy(this.personalMana), inventory: copy(this.inventory), overflow: copy(this.overflow), research: [...this.research], stations: copy(this.stations), assemblies: copy(this.assemblies), energy: copy(this.energy), energyOverflow: copy(this.energyOverflow), claims: [...this.claims], harvestClaims: copy(this.harvestClaims), jobs: copy(this.jobs), researchJob: copy(this.researchJob), researchProgress: copy(this.researchProgress), workCredits: this.workCredits, activeSources: copy(this.activeSources), sourceFuel: copy(this.sourceFuel), activityProgress: copy(this.activityProgress), activityRequests: copy(this.activityRequests), worldFixtures: copy(this.worldFixtures), fixtureAccess: copy(this.fixtureAccess), communityStations: copy(this.communityStations), toolWear: copy(this.toolWear), clock: this.clock, nextId: this.nextId, equipped: this.equipped, metrics: copy(this.metrics) };
  }
  _validateState() {
    if(!nonnegative(this.personalMana.lastCapacity)||this.personalMana.lastCapacity>1000||!nonnegative(this.personalMana.investedCapacity)||this.personalMana.investedCapacity>700||!nonnegative(this.personalMana.reserveEU)||!nonnegative(this.personalMana.cupEU)||this.personalMana.cupEU>100||(this.personalMana.focusId&&(this.catalog.get(this.personalMana.focusId)?.kind!=='gear_baseline'||this.catalog.get(this.personalMana.focusId).tier<5)))throw Error('Invalid personal mana');
    let investmentCap=0;for(const[id,liters]of Object.entries(this.personalMana.investments)){const material=this.catalog.get(id);if(material?.kind!=='material'||material.tier<5||material.properties.manaCoupling<.6||!Number.isInteger(liters)||liters<1)throw Error('Invalid mana investment');investmentCap+=Math.floor(20*material.tier*material.properties.manaCoupling)*liters;}
    if(this.personalMana.investedCapacity!==Math.min(700,investmentCap))throw Error('Mana capacity is not backed by paid investments');
    this._reconcilePersonalMana();
    for (const [id, r] of Object.entries(this.activityRequests)) if (!this._claim(id) || !this._claim(r.jobId) || !this._claim(r.communityId) || this.catalog.get(r.activityId)?.kind !== 'activity') throw Error('Invalid activity request');
    if (!Array.isArray(this.worldFixtures) || !Array.isArray(this.communityStations) || (this.fixtureAccess !== null && !Array.isArray(this.fixtureAccess))) throw Error('Invalid fixture state');
    if (new Set(this.worldFixtures.map(r => r.ownerId)).size !== this.worldFixtures.length || this.worldFixtures.some(r => !this._claim(r.ownerId) || !['station','component'].includes(r.kind) || this.catalog.get(r.assetId)?.kind !== r.kind || !nonnegative(r.health) || !positive(r.maxHealth) || r.health > r.maxHealth || typeof r.active !== 'boolean') || this.fixtureAccess?.some(id => !this.worldFixtures.some(r => r.ownerId === id)) || this.communityStations.some(id => this.catalog.get(id)?.kind !== 'station')) throw Error('Invalid fixture records');
    if (!Number.isInteger(this.nextId) || this.nextId < 1 || this.jobs.length > 64 || ![...this.claims].every(id => this._claim(id))) throw Error('Invalid progression ledger');
    for (const a of this.assemblies) {
      const c = this.catalog.get(a.componentId);
      if (c?.kind !== 'component' || !this._claim(a.id) || !positive(a.scale) || a.scale < c.designEnvelope.scaleMin || a.scale > c.designEnvelope.scaleMax || !nonnegative(a.health) || a.health > 1 || !nonnegative(a.connected) || a.connected > 1 || (a.materialId && !this.evaluateMaterial(a.materialId, { volumeLiters: a.materialLiters }).ok)) throw Error('Invalid saved assembly');
    }
    if (new Set(this.assemblies.map(a => a.id)).size !== this.assemblies.length || new Set(this.jobs.map(j => j.id)).size !== this.jobs.length) throw Error('Duplicate saved instance');
    for (const j of this.jobs) {
      const e = this.catalog.get(j.type === 'craft' ? j.recipeId : j.activityId);
      if (!this._claim(j.id) || !['craft', 'activity'].includes(j.type) || e?.kind !== (j.type === 'craft' ? 'recipe' : 'activity') || !nonnegative(j.progress) || (j.type === 'craft' && (!Number.isInteger(j.count) || j.count < 1 || j.count > 64))) throw Error('Invalid saved job');
      if (j.progress > (j.type === 'craft' ? e.seconds * j.count : e.secondsPerRepetition) + EPS) throw Error('Invalid job progress');
    }
    for (const [id, p] of Object.entries(this.researchProgress)) if (this.catalog.get(id)?.kind !== 'research' || p.paid !== true || !nonnegative(p.work) || p.work > this.catalog.get(id).work + EPS) throw Error('Invalid saved research progress');
    if (this.researchJob && (!this.researchProgress[this.researchJob.id] || this.research.has(this.researchJob.id))) throw Error('Invalid active research');
    for (const [id, fuel] of Object.entries(this.sourceFuel)) if (this.catalog.get(id)?.kind !== 'energy_source' || !nonnegative(fuel) || fuel > (this.catalog.get(id).duration || 0)) throw Error('Invalid source fuel');
    for (const [id, enabled] of Object.entries(this.activeSources)) if (this.catalog.get(id)?.kind !== 'energy_source' || typeof enabled !== 'boolean') throw Error('Invalid active source');
    for (const t of TYPES) if (this.energy[t] > this.energyCapacity(t) + EPS) throw Error('Saved energy exceeds capacity');
    if (this.equipped && this.catalog.get(this.equipped)?.kind !== 'gear_baseline') throw Error('Invalid equipped gear');
    for (const [id, n] of Object.entries(this.activityProgress)) if (this.catalog.get(id)?.kind !== 'activity' || !Number.isInteger(n) || n < 0 || n >= this.catalog.get(id).repetitions) throw Error('Invalid activity progress');
    for (const [id, wear] of Object.entries(this.toolWear)) if (!Number.isInteger(wear) || wear < 0 || wear > (this.catalog.get(id)?.durabilityActions || 0)) throw Error('Invalid tool wear');
    for (const h of Object.values(this.harvestClaims)) if (this.catalog.get(h.sourceId)?.kind !== 'source' || !nonnegative(h.at) || h.at > this.clock) throw Error('Invalid harvest ledger');
    for (const f of ['generated', 'consumed', 'dissipated']) for (const t of TYPES) if (!nonnegative(this.metrics[f]?.[t])) throw Error('Invalid energy metrics');
    if (!nonnegative(this.metrics.conversionLoss)) throw Error('Invalid conversion metric');
  }
}
export const ENERGY_TYPES = Object.freeze([...TYPES]);
export default Progression;
