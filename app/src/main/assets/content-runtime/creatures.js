import { creatureBodyPart } from './creature-animation.js';
import { skeleton, structureState, breakBone, evaluateStructure, boneHealth, saveStructure } from '../structural-body.js';

const STEP = 0.25;
const MAX_CATCHUP = 7200;
const SPATIAL_CELL = 64;
// Indexed heap: rescheduling an active owner replaces its one node, rather than
// accumulating stale timer entries during a long session.
class DueQueue {
  constructor() { this.heap=[]; this.indices=new Map(); }
  _swap(a,b) { const h=this.heap;[h[a],h[b]]=[h[b],h[a]];this.indices.set(h[a].id,a);this.indices.set(h[b].id,b); }
  _fix(i) {
    while(i>0){const p=(i-1)>>1;if(this.heap[p].at<=this.heap[i].at)break;this._swap(p,i);i=p;}
    for(;;){const a=i*2+1,b=a+1;let n=i;if(a<this.heap.length&&this.heap[a].at<this.heap[n].at)n=a;if(b<this.heap.length&&this.heap[b].at<this.heap[n].at)n=b;if(n===i)break;this._swap(i,n);i=n;}
  }
  set(id,at) { const i=this.indices.get(id);if(i!==undefined){this.heap[i].at=at;this._fix(i);}else{this.indices.set(id,this.heap.length);this.heap.push({id,at});this._fix(this.heap.length-1);} }
  delete(id) { const i=this.indices.get(id);if(i===undefined)return;const last=this.heap.pop();this.indices.delete(id);if(i<this.heap.length){this.heap[i]=last;this.indices.set(last.id,i);this._fix(i);} }
  take(time) { const ids=[];while(this.heap.length&&this.heap[0].at<=time+1e-8){const id=this.heap[0].id;this.delete(id);ids.push(id);}return ids; }
}
const AQUATIC = new Set(['drain_eel', 'cistern_serpent']);
const AMPHIBIOUS = new Set(['mud_croc', 'reed_grazer', 'silt_snail', 'tide_crab']);
const clone = value => JSON.parse(JSON.stringify(value));
const finite = (n, name, min = -Number.MAX_VALUE) => {
  if (!Number.isFinite(n) || n < min) throw new TypeError(`Invalid ${name}`);
  return n;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const fraction = key => {
  let n = 2166136261;
  for (const ch of String(key)) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
};
const integer = (key, lo, hi) => lo + Math.floor(fraction(key) * (hi - lo + 1));
const allocateRules = (rules, budget) => {
  const totalWeight = rules.reduce((n, r) => n + r.weight, 0) || 1;
  const result = rules.map(r => ({ ...r, capPerEcologyCell: Math.min(r.capPerEcologyCell, Math.floor(budget * r.weight / totalWeight)) }));
  let remaining = budget - result.reduce((n, r) => n + r.capPerEcologyCell, 0);
  const order = rules.map((r, i) => ({ i, remainder: budget * r.weight / totalWeight % 1 }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  while (remaining > 0) {
    let changed = false;
    for (const { i } of order) if (remaining && result[i].capPerEcologyCell < rules[i].capPerEcologyCell) {
      result[i].capPerEcologyCell++; remaining--; changed = true;
    }
    if (!changed) break;
  }
  return result;
};

/** Pure, deterministic model. Visual parts are hints; this does not turn art boxes
 * into collision bodies. Structural connectivity uses the existing shared graph. */
export class CreatureSystem {
  constructor(content, options = {}) {
    this.content = content.creatures ? content : { creatures: content };
    this.catalog = this.content.creatures;
    this.species = new Map(this.catalog.entries.map(e => [e.id, e]));
    this.environments = new Map((this.content.environments?.entries || []).map(e => [e.id, e]));
    this.structures = new Map((this.content.structures?.entries || []).map(e => [e.id, e]));
    this.blocks = new Map((this.content.blocks?.entries || []).map(e => [e.id, e]));
    this.seed = String(options.seed ?? 'feral');
    this.terrain = options.terrain ?? null;
    this.time = 0;
    this.remainder = 0;
    this.pendingOfflineSeconds = 0;
    this.serial = 0;
    this._entities = new Map();
    this.regions = new Map();
    this.corpses = new Map();
    this._models = new Map();
    this._events = [];
    this._context = {};
    this._spatial = new Map(); this._regionSpatial = new Map();
    this._entityIndex = new Map(); this._regionMembers = new Map(); this._regionCorpses = new Map();
    this._regionOrder = new Map(); this._liveIds = new Set(); this._playerAttacking = new Set();
    this._entityDue = new DueQueue(); this._regionDue = new DueQueue();
    this.work = {steps:0,spatialCandidates:0,activeEntityUpdates:0,passiveEntityUpdates:0,regionUpdates:0};
    const baseline = this.content.progression?.entries?.find(e => e.id === 'calorie_baseline');
    this.foodCalories = baseline?.foodCalories ?? 400;
    if (options.state) this._load(options.state);
  }

  get entities() { return [...this._entities.values()]; }
  get(id) { return this._entities.get(id) ?? null; }

  _bucket(map,key,id,add) {
    if(add){if(!map.has(key))map.set(key,new Set());map.get(key).add(id);}
    else {const set=map.get(key);set?.delete(id);if(set?.size===0)map.delete(key);}
  }
  _spatialKey(x,z) { return `${Math.floor(x/SPATIAL_CELL)},${Math.floor(z/SPATIAL_CELL)}`; }
  _nearIds(map,point,radius) {
    const ids=[];
    for(let x=Math.floor((point.x-radius)/SPATIAL_CELL);x<=Math.floor((point.x+radius)/SPATIAL_CELL);x++)
      for(let z=Math.floor((point.z-radius)/SPATIAL_CELL);z<=Math.floor((point.z+radius)/SPATIAL_CELL);z++)
        for(const id of map.get(`${x},${z}`)??[])ids.push(id);
    return ids;
  }
  _indexRegion(r) {
    this._regionOrder.set(r.id,this._regionOrder.size);
    this._bucket(this._regionSpatial,this._spatialKey(r.x,r.z),r.id,true);
    this._regionDue.set(r.id,r.lastUpdatedAt+60);
  }
  _reindex(e) {
    const old=this._entityIndex.get(e.id);if(!old)return;
    const cell=this._spatialKey(e.x,e.z);
    if(old.cell!==cell){this._bucket(this._spatial,old.cell,e.id,false);this._bucket(this._spatial,cell,e.id,true);old.cell=cell;}
    if(old.region!==e.regionId||old.alive===e.dead){
      if(old.alive)this._bucket(this._regionMembers,old.region,e.id,false);
      old.region=e.regionId;old.alive=!e.dead;
      if(old.alive){this._liveIds.add(e.id);this._bucket(this._regionMembers,e.regionId,e.id,true);}
      else {this._liveIds.delete(e.id);this._entityDue.delete(e.id);}
    }
  }
  _indexEntity(e) {
    const cell=this._spatialKey(e.x,e.z);
    this._entityIndex.set(e.id,{cell,region:e.regionId,alive:!e.dead,order:this._entityIndex.size});
    this._bucket(this._spatial,cell,e.id,true);
    if(!e.dead){this._liveIds.add(e.id);this._bucket(this._regionMembers,e.regionId,e.id,true);this._entityDue.set(e.id,e.lastUpdatedAt+60);}
    // Existing external entity references keep their identity. Physics/test edits
    // to coordinates cannot silently leave a stale spatial index behind.
    for(const key of ['x','z','regionId','dead']){let value=e[key];Object.defineProperty(e,key,{enumerable:true,configurable:true,get:()=>value,set:next=>{value=next;this._reindex(e);}});}
    let attack=e.attack;
    if(attack?.targetId==='player')this._playerAttacking.add(e.id);
    Object.defineProperty(e,'attack',{enumerable:true,configurable:true,get:()=>attack,set:value=>{attack=value;if(value?.targetId==='player')this._playerAttacking.add(e.id);else this._playerAttacking.delete(e.id);}});
  }
  _ordered(ids) { return [...ids].sort((a,b)=>this._entityIndex.get(a).order-this._entityIndex.get(b).order); }
  _corpsesIn(regionId) { return [...(this._regionCorpses.get(regionId)??[])].map(id=>this.corpses.get(id)); }

  _model(speciesId, tier) {
    const key = `${speciesId}:${tier}`;
    if (this._models.has(key)) return this._models.get(key);
    const s = this.species.get(speciesId), profile = this.catalog.bodyProfiles[s.body.profile];
    const factor = this.catalog.contracts.tierScaling.hpPerTierMultiplier ** (tier - s.baselineTier);
    const cap = hp => Math.max(1, Math.round(hp * factor));
    const nodes = [
      { id: 'core', hp: cap(s.body.coreHp), links: ['head', 'spine', 'shell'] },
      { id: 'head', hp: cap(s.body.coreHp), links: ['core'] },
      { id: 'spine', hp: cap(s.body.coreHp), links: ['core'] },
      { id: 'shell', hp: cap(s.body.shellPatchHp), links: ['core'] },
    ];
    const functions = { attack: ['core', 'head'], feed: ['core', 'head'] };
    if (s.attacks.length) {
      nodes.push({ id: 'weapon', hp: cap(s.body.limbNodeHp), links: ['core'] });
      nodes[0].links.push('weapon'); functions.attack.push('weapon');
    }
    for (let i = 0; i < profile.limbCount; i++) {
      const id = `limb_${i}`;
      nodes.push({ id, hp: cap(s.body.limbNodeHp), links: ['core'] });
      nodes[0].links.push(id);
      functions[id] = ['core', id];
    }
    const model = skeleton(nodes, 'core', functions, ['head', 'spine']);
    this._models.set(key, model);
    return model;
  }

  spawn(speciesId, position, options = {}) {
    const s = this.species.get(speciesId);
    if (!s) throw new Error(`Unknown species ${speciesId}`);
    const p = Array.isArray(position) ? { x: position[0], y: position[1], z: position[2] } : position;
    finite(p?.x, 'spawn x'); finite(p?.z, 'spawn z');
    const id = String(options.id ?? `creature:${this.seed}:${this.serial++}`);
    if (this._entities.has(id)) return this._entities.get(id);
    const tier = clamp(Math.round(options.tier ?? s.baselineTier), 1, 10);
    const factor = this.catalog.contracts.tierScaling.hpPerTierMultiplier ** (tier - s.baselineTier);
    const y = p.y ?? this.terrain?.heightAt?.(p.x, p.z) ?? 0;
    finite(y, 'spawn y');
    const adult = options.adult !== false;
    const e = {
      id, speciesId, assetId: speciesId, bodyProfile: s.body.profile, bodySize: [...s.body.lengthWidthHeightM], entityType: s.entityType, civilization: s.civilization,
      tier, x: p.x, y, z: p.z, yaw: fraction(`${id}:yaw`) * Math.PI * 2,
      home: { x: p.x, y, z: p.z }, regionId: options.regionId ?? null,
      dungeonId: options.dungeonId ?? null, roomId: options.roomId ?? null,
      communityId: options.communityId ?? null,
      maxHp: Math.max(1, Math.round(s.stats.maxHp * factor)), hp: Math.max(1, Math.round(s.stats.maxHp * factor)),
      calories: s.calories ? clamp(options.calories ?? s.calories.maxCp * (adult ? s.calories.initialFraction : s.population.newbornCalorieFraction), 0, s.calories.maxCp) : null,
      reserveEu: s.energyReserve ? s.energyReserve.capacityEu * s.energyReserve.initialFraction : null,
      age: adult ? (s.population.maturityS ?? 0) : 0, dead: false, lastUpdatedAt: this.time,
      state: 'idle', targetId: null, targetPoint: null, lastHitAt: -1e9,
      lastSeenAt: 0, angerUntil: 0, starvingSeconds: 0, foodShortageSeconds: 0,
      rest: false, cooldownUntil: 0, attack: null, warningUntil: 0,
      breedAt: this.time + (s.population.breedingCooldownS ?? 0), nextDecisionAt: this.time,
      nextWanderAt: this.time, wanderSerial: 0, repairProgress: 0, repairSerial: 0,
      interactionSerial: 0, slowUntil: 0, verticalVelocity: 0, locomotion: 'ground', grounded: true, structure: structureState(this._model(speciesId, tier)),
      inventory: clone(options.inventory ?? (s.civilization ? (s.entityType === 'organic' ? { wood: 6 } : { stone: 6 }) : {})),
      pose: { phase: 0, speedFactor: 1, limbSupport: [], missingParts: [], moving: false },
      parts: {}, massKg: s.body.massKg,
      fragmentMass: null, fragmentCuts: [], fragmentSerial: 0, damageReceipts: {},
    };
    this._entities.set(id, e);
    this._indexEntity(e);
    this._pose(e);
    return e;
  }

  /** An ecology owner is initialized once, never refilled when revisited. */
  ensureRegion(regionId, options) {
    if (this.regions.has(regionId)) return this.regions.get(regionId);
    const env = this.environments.get(options.environmentId);
    if (!env) throw new Error(`Unknown environment ${options.environmentId}`);
    const cfg = env.spawning;
    const x = finite(options.x, 'region x'), z = finite(options.z, 'region z');
    const sample = this.terrain?.sample?.(x, z);
    const hostId = options.baseEnvironmentId ?? sample?.baseEnvironmentId ?? 'grove';
    const host = this.environments.get(hostId);
    const overlay = env.mode === 'overlay' && host && host.id !== env.id;
    const patchCount = env.decoration?.producerPatchesPer4096M2 ?? 8;
    const cpPerBu = this.catalog.contracts.edibleBiomassCpPerUnit;
    const capacity = options.capacity ?? (overlay ? host.spawning.totalCap : cfg.totalCap) ?? 14;
    const overlayBudget = overlay ? Math.floor(capacity * cfg.overlayBudgetFraction) : 0;
    const rules = overlay ? [...allocateRules(cfg.rules, overlayBudget), ...allocateRules(host.spawning.rules, capacity - overlayBudget)] : cfg.rules;
    const region = {
      id: regionId, kind: 'outdoor', environmentId: env.id, baseEnvironmentId: overlay ? host.id : env.id, x, y: options.y ?? 0, z,
      tier: clamp(Math.round(options.tier ?? 2), 1, 10), radius: (cfg.ecologyCellSizeM ?? 64) / 2,
      capacity: Math.max(0, capacity), speciesCaps: {}, initialized: true,
      births: 0, lastUpdatedAt: this.time, nextBirthAt: this.time + 60, waterL: null, closed: false,
      foodNodes: [], carrionCp: 0, detritusCp: 0, migrationCount: 0,
      safeBypass: Boolean(options.safeBypass ?? sample?.safeBypass) || options.hostileSpawnsAllowed === false || sample?.hostileSpawnsAllowed === false,
    };
    let allocation = options.foodCp;
    for (let i = 0; i < patchCount; i++) {
      const maxCp = cfg.producerBiomassUnitsPerPatch * cpPerBu;
      const point = { x: x + (fraction(`${this.seed}:${regionId}:patchx:${i}`) - .5) * 40, z: z + (fraction(`${this.seed}:${regionId}:patchz:${i}`) - .5) * 40 };
      region.foodNodes.push({ id: `${regionId}:producer:${i}`, ...point,
        cp: allocation == null ? maxCp : clamp(allocation / patchCount, 0, maxCp), maxCp,
        regenCpPerS: cfg.producerRegrowthUnitsPerSecond * cpPerBu,
        waterLPerS: 0, enabled: true, requiresLight: false, requiresMana: false,
        sourceId: env.id, roomId: null,
      });
    }
    this.regions.set(regionId, region);
    this._indexRegion(region);
    let slots = region.capacity;
    for (const rule of rules) {
      const s = this.species.get(rule.speciesId);
      if (!s || region.safeBypass && (s.role === 'predator' || s.baselineTier > region.tier + 1)) continue;
      const predatorCount = this._living(regionId).filter(e => this.species.get(e.speciesId).role === 'predator').length;
      const cap = Math.min(rule.capPerEcologyCell, slots, s.role === 'predator' ? Math.max(0, 2 - predatorCount) : Infinity);
      region.speciesCaps[s.id] = cap;
      const n = Math.min(cap, integer(`${this.seed}:${regionId}:${s.id}:group`, ...rule.groupSize));
      for (let i = 0; i < n; i++) {
        const node = region.foodNodes[i % Math.max(1, region.foodNodes.length)];
        const p = { x: (node?.x ?? x) + (fraction(`${regionId}:${s.id}:${i}:x`) - .5) * 8,
          z: (node?.z ?? z) + (fraction(`${regionId}:${s.id}:${i}:z`) - .5) * 8 };
        this.spawn(s.id, p, { id: `${regionId}:initial:${s.id}:${i}`, tier: region.tier, regionId });
      }
      slots -= n;
    }
    return region;
  }

  ensureDungeon(instanceId, options) {
    if (this.regions.has(instanceId)) return this.regions.get(instanceId);
    const template = this.structures.get(options.structureId);
    if (!template) throw new Error(`Unknown structure ${options.structureId}`);
    const x = finite(options.x, 'dungeon x'), z = finite(options.z, 'dungeon z');
    const y = finite(options.y ?? this.terrain?.heightAt?.(x, z) ?? 0, 'dungeon y');
    const ec = template.ecology;
    const region = { id: instanceId, kind: 'dungeon', structureId: template.id,
      environmentId: template.environmentId, x, y, z, tier: options.tier ?? template.prototypeTier,
      radius: template.footprintM ? Math.max(template.footprintM.max[0] - template.footprintM.min[0], template.footprintM.max[1] - template.footprintM.min[1]) : 100,
      capacity: ec?.populationMaxExcludingBoss ?? 0, speciesCaps: {}, initialized: true,
      births: 0, lastUpdatedAt: this.time, nextBirthAt: this.time + 60, waterL: ec?.water?.volumeL ?? null,
      closed: true, bounds: clone(template.footprintM), foodNodes: [], carrionCp: ec?.initialCarrionCp ?? 0, detritusCp: 0,
      migrationCount: 0, roomCaps: {}, rooms: clone(template.rooms ?? []), safeBypass: false };
    const totalRate = (ec?.producers || []).reduce((n, p) => n + p.foodUnitsPerHour, 0);
    for (const producer of ec?.producers || []) {
      const room = template.rooms.find(r => r.id === producer.roomId);
      const initial = (ec.initialPlantFoodUnits ?? 0) * (ec.foodUnitCp ?? 100) * producer.foodUnitsPerHour / Math.max(1, totalRate);
      region.foodNodes.push({ id: `${instanceId}:${producer.id}`, sourceId: producer.id,
        roomId: producer.roomId, x: x + (room?.centerM[0] ?? 0), z: z + (room?.centerM[2] ?? 0),
        cp: initial, maxCp: initial, regenCpPerS: producer.foodUnitsPerHour * (ec.foodUnitCp ?? 100) / 3600,
        waterLPerS: (producer.waterConsumptionLPerHour ?? 0) / 3600,
        enabled: true, requiresLight: Boolean(producer.requiresLight), requiresMana: Boolean(producer.requiresMana),
        lightAvailable: true, manaAvailable: true,
      });
    }
    this.regions.set(instanceId, region);
    this._indexRegion(region);
    for (const room of template.rooms || []) {
      region.roomCaps[room.id] = room.maxPopulation ?? 0;
      for (const group of room.spawnGroups || []) {
        region.speciesCaps[group.speciesId] = (region.speciesCaps[group.speciesId] ?? 0) + group.maxCount;
        for (let i = 0; i < group.initialCount; i++) {
          if (this._living(instanceId).length >= region.capacity) break;
          this.spawn(group.speciesId, { x: x + group.anchorM[0] + (i % 2) * .75, y: y + group.anchorM[1], z: z + group.anchorM[2] + Math.floor(i / 2) * .75 },
            { id: `${instanceId}:initial:${group.id}:${i}`, regionId: instanceId, dungeonId: instanceId, roomId: room.id, tier: region.tier });
        }
      }
    }
    return region;
  }

  setProducerState(regionId, producerId, state) {
    const r = this.regions.get(regionId), p = r?.foodNodes.find(p => p.id === producerId || p.sourceId === producerId);
    if (!p) return false;
    for (const k of ['enabled', 'lightAvailable', 'manaAvailable']) if (k in state) p[k] = Boolean(state[k]);
    return true;
  }
  setWater(regionId, liters) { const r = this.regions.get(regionId); if (!r) return false; r.waterL = finite(liters, 'water liters', 0); return true; }
  setDungeonOpen(regionId, open) { const r = this.regions.get(regionId); if (!r || r.kind !== 'dungeon') return false; r.closed = !open; return true; }
  harvestFood(regionId, requestedCp, producerId = null) {
    finite(requestedCp, 'food harvest', 0);
    const r = this.regions.get(regionId);
    if (!r) return 0;
    let taken = 0;
    for (const p of r.foodNodes) {
      if (producerId && p.id !== producerId && p.sourceId !== producerId) continue;
      const n = Math.min(p.cp, requestedCp - taken); p.cp -= n; taken += n;
      if (taken >= requestedCp) break;
    }
    return taken;
  }
  _living(regionId) { return this._ordered(this._regionMembers.get(regionId)??[]).map(id=>this.get(id)); }

  tick(dt, context = {}) {
    finite(dt, 'dt', 0);
    if (dt > MAX_CATCHUP) throw new RangeError('Use advanceOffline for catch-up above two hours');
    this._context = context;
    this.remainder += dt;
    while (this.remainder >= STEP - 1e-9) {
      this.remainder = Math.max(0, this.remainder - STEP);
      this.time += STEP;
      this._step(STEP, context);
    }
    const events = this._events;
    this._events = [];
    return events;
  }

  advanceOffline(seconds, context = {}) {
    finite(seconds, 'offline seconds', 0);
    const pending = this.pendingOfflineSeconds + seconds;
    const processedSeconds = Math.min(MAX_CATCHUP, pending);
    this.pendingOfflineSeconds = pending - processedSeconds;
    const events = this.tick(processedSeconds, { ...context, player: null, offline: true });
    return { processedSeconds, remainingSeconds: this.pendingOfflineSeconds, events };
  }

  /** Rendering and full AI share the catalogue's outdoor realization limits. */
  visibleEntities(player, radius = this.content.environments?.world?.population?.activeRadiusM ?? 96) {
    const limits = this.content.environments?.world?.population ?? {};
    const maxOutdoor = limits.maxActiveOutdoorIndividuals ?? 48, maxPredators = limits.maxActiveOutdoorPredators ?? 8;
    let outdoor = 0, predators = 0;
    const candidates=this._nearIds(this._spatial,player,radius);this.work.spatialCandidates+=candidates.length;
    const living = candidates.map(id=>this.get(id)).filter(e => !e.dead && dist(e, player) <= radius)
      .sort((a, b) => dist(a, player) - dist(b, player) || a.id.localeCompare(b.id))
      .filter(e => {
        if (e.dungeonId) return true;
        const predator = this.species.get(e.speciesId).role === 'predator';
        if (outdoor >= maxOutdoor || predator && predators >= maxPredators) return false;
        outdoor++; if (predator) predators++; return true;
      });
    return [...living, ...this.visibleCorpses(player, radius)];
  }

  visibleCorpses(player, radius = 96, limit = 32) {
    return this._nearIds(this._spatial,player,radius).map(id=>this.get(id)).filter(e => e.dead && !this.corpses.get(`corpse:${e.id}`)?.claimed && dist(e, player) <= radius)
      .sort((a, b) => dist(a, player) - dist(b, player) || a.id.localeCompare(b.id)).slice(0, limit);
  }

  _step(dt, context) {
    this.work.steps++;
    const active = new Set(context.offline?[]:context.player?this.visibleEntities(context.player).filter(e=>!e.dead).map(e=>e.id):this._liveIds);
    const activeRegions = new Set([...active].map(id => this.get(id).regionId));
    const processed = new Set();
    const regionIds=new Set([...this._regionDue.take(this.time),...activeRegions]);regionIds.delete(null);
    for (const id of [...regionIds].sort((a,b)=>this._regionOrder.get(a)-this._regionOrder.get(b))) {
      const r=this.regions.get(id);if(!r)continue;
      const elapsed = this.time - (r.lastUpdatedAt ?? this.time - dt);
      if (!activeRegions.has(r.id) && elapsed < 60 - 1e-8) continue;
      r.lastUpdatedAt = this.time; processed.add(r.id);
      this._regionDue.set(r.id,this.time+60);this.work.regionUpdates++;
      for (const n of r.foodNodes) {
        if (!n.enabled || n.requiresLight && n.lightAvailable === false || n.requiresMana && n.manaAvailable === false) continue;
        const availableTime = r.waterL === null || n.waterLPerS === 0 ? elapsed : Math.min(elapsed, r.waterL / n.waterLPerS);
        const growth = Math.min(n.maxCp - n.cp, n.regenCpPerS * availableTime);
        if (growth > 0) {
          n.cp += growth;
          if (r.waterL !== null && n.regenCpPerS > 0) r.waterL = Math.max(0, r.waterL - growth / n.regenCpPerS * n.waterLPerS);
        }
      }
      for (const c of this._corpsesIn(r.id)) {
        if (c.regionId !== r.id || c.claimed || c.edibleCp <= 0) continue;
        const amount = Math.min(c.edibleCp, c.initialEdibleCp / 3600 * elapsed);
        c.edibleCp -= amount; r.detritusCp += amount;
      }
    }
    const ids=this._ordered(new Set([...this._entityDue.take(this.time),...active]));
    const byRegion = new Map();
    for(const id of ids){const regionId=this.get(id).regionId;if(!byRegion.has(regionId))byRegion.set(regionId,this._living(regionId));}
    for (const id of ids) {
      const e=this.get(id);
      if (e.dead) continue;
      const s = this.species.get(e.speciesId), elapsed = this.time - (e.lastUpdatedAt ?? this.time - dt);
      const nearby = byRegion.get(e.regionId) || [];
      if (!active.has(e.id)) {
        if (elapsed >= 60 - 1e-8) { this._passive(e, s, elapsed, nearby, context); e.lastUpdatedAt = this.time;this.work.passiveEntityUpdates++; }
        if(!e.dead)this._entityDue.set(e.id,e.lastUpdatedAt+60);
        continue;
      }
      if (elapsed > dt + 1e-8) this._passive(e, s, elapsed - dt, nearby, context);
      e.lastUpdatedAt = this.time;
      this.work.activeEntityUpdates++;
      this._entityDue.set(e.id,this.time+60);
      if (e.dead) continue;
      e.age += dt; this._metabolism(e, s, dt);
      if (e.dead) continue;
      if (this.time >= e.nextDecisionAt && !e.attack) {
        this._decide(e, s, nearby, context); e.nextDecisionAt = this.time + .5;
      }
      this._act(e, s, dt, context); this._vertical(e, s, dt, context); this._pose(e);
    }
    for (const id of processed) { const r=this.regions.get(id);if(this.time + 1e-8 >= r.nextBirthAt) {
      this._breed(r); r.nextBirthAt = this.time + 60;
    }}
  }

  // Inactive owners advance in bounded 60-second ecology steps. No player combat
  // or remote damage callback is possible. Hunting debits the same attack and
  // corpse budgets as active simulation; it never creates virtual meat.
  _passive(e, s, elapsed, nearby, context) {
    e.age += elapsed;
    if (e.targetId === 'player') { e.targetId = null; e.attack = null; }
    const r = this.regions.get(e.regionId);
    if (s.calories && r) {
      const food = this._foodTarget(e, s, r);
      if (food && dist(e, food) <= s.stats.cruiseMps * elapsed + 2) {
        e.foodTargetId = food.id;
        this._eat(e, s, elapsed);
      } else if (s.role === 'predator' && this._structure(e).functions.attack && e.age >= s.population.maturityS && e.calories < s.calories.maxCp * s.behavior.huntBelowCalorieFraction) {
        const preyIds = new Set(s.ecology.diet.filter(d => d.kind === 'species').map(d => d.id));
        const prey = nearby.find(p => !p.dead && preyIds.has(p.speciesId) && p.hp <= e.hp * 2 && dist(e, p) < s.stats.detectionM + s.stats.sprintMps * elapsed && this._visible(e, p, context));
        const attack = s.attacks[0];
        if (prey && attack) {
          const attempts = Math.min(3, Math.floor(elapsed / attack.cooldownS));
          for (let i = 0; i < attempts && !prey.dead; i++) {
            if (e.calories < attack.calorieCostCp || (e.reserveEu ?? Infinity) < attack.reserveCostEu) break;
            e.calories -= attack.calorieCostCp;
            if (e.reserveEu !== null) e.reserveEu -= attack.reserveCostEu;
            if (fraction(`${e.id}:hunt:${Math.floor(this.time / 60)}:${i}`) < .65) {
              this.damage(prey.id, attack.damageHp * this.catalog.contracts.tierScaling.damagePerTierMultiplier ** (e.tier - s.baselineTier), 'body', { sourceId: e.id });
            }
          }
        }
      }
    }
    // Aggregate movement does not teleport through terrain. Courtship only
    // reduces separation within the traversable local habitat.
    if (s.calories && !s.civilization && e.breedAt <= this.time && e.calories >= s.calories.maxCp * s.population.reproductionCalorieFraction) {
      const mate = nearby.find(p => p !== e && !p.dead && p.speciesId === e.speciesId && p.roomId === e.roomId);
      if (mate) this._move(e, mate, Math.min(elapsed, 4), s.stats.cruiseMps, context);
    }
    e.state = 'idle'; e.targetId = null; e.attack = null; e.pose.moving = false;
    this._metabolism(e, s, elapsed);
    if (!e.dead && s.calories && r) {
      const food = r.foodNodes.reduce((n, p) => n + p.cp, 0), cap = r.foodNodes.reduce((n, p) => n + p.maxCp, 0) || 1;
      e.foodShortageSeconds = food / cap < s.ecology.migrationFoodFraction ? e.foodShortageSeconds + elapsed : 0;
      if (e.foodShortageSeconds >= s.ecology.migrationAfterS) { this._migrate(e, s, r); if (e.targetPoint) this._move(e, e.targetPoint, Math.min(elapsed, 4), s.stats.cruiseMps, context); }
    }
  }

  _metabolism(e, s, dt) {
    if (!s.calories) return;
    const c = s.calories;
    const active = e.state === 'chase' || e.state === 'flee';
    e.calories = Math.max(0, e.calories - (c.basalCpPerS + (active ? c.sprintExtraCpPerS : 0)) * dt);
    e.starvingSeconds = e.calories <= 0 ? e.starvingSeconds + dt : 0;
    if (e.starvingSeconds >= c.starvationDelayS) {
      e.hp = Math.max(0, e.hp - c.starvationDamageHpPerS * dt);
      if (e.hp === 0) { this._die(e, 'starvation'); return; }
    }
    const safeRest = e.rest && !e.targetId && !e.attack && this.time - e.lastHitAt >= STEP;
    if (e.hp < e.maxHp && (this.time - e.lastHitAt >= c.regenDelayS || safeRest)) {
      const heal = Math.max(0, Math.min(e.maxHp - e.hp,
        c.regenHpPerS * dt * (safeRest ? c.restMultiplier : 1),
        (e.calories - c.maxCp * c.minimumReserveFraction) / c.regenCpPerHp));
      e.hp += heal; e.calories -= heal * c.regenCpPerHp;
    }
    if (s.energyReserve && e.reserveEu < s.energyReserve.capacityEu && s.energyReserve.cpPerEu > 0) {
      // Biological channel producer: bounded rate, explicit CP debit. This is not
      // a free converter between arbitrary energy channels.
      const produced = Math.max(0, Math.min(s.energyReserve.capacityEu - e.reserveEu,
        dt * s.energyReserve.capacityEu / 120,
        (e.calories - c.maxCp * c.minimumReserveFraction) / s.energyReserve.cpPerEu));
      e.calories -= produced * s.energyReserve.cpPerEu; e.reserveEu += produced;
    }
  }

  _decide(e, s, nearby, context) {
    const player = context.player && context.player.hp !== 0 ? context.player : null;
    if (e.state === 'migrate' && e.migrationTarget && this.regions.has(e.migrationTarget)) return;
    const originDistance = dist(e, e.home);
    const wounded = e.hp / e.maxHp <= s.stats.retreatHpFraction;
    const hungry = s.calories && e.calories < s.calories.maxCp * s.behavior.huntBelowCalorieFraction;
    const canAttack = s.attacks.length && e.age >= (s.population.maturityS ?? 0) && this._structure(e).functions.attack;
    const threat = nearby.find(o => o !== e && !o.dead && o.targetId === e.id && dist(e, o) < s.stats.detectionM);
    const playerThreat = player && e.angerUntil > this.time && dist(e, player) < s.stats.detectionM;
    if ((s.behavior.disposition === 'avoidant' || wounded) && (threat || playerThreat)) {
      const from = threat || player;
      e.state = 'flee'; e.targetId = null; e.rest = false;
      const dx = e.x - from.x, dz = e.z - from.z, len = Math.hypot(dx, dz) || 1;
      e.targetPoint = { x: e.x + dx / len * 6, z: e.z + dz / len * 6 };
      if (playerThreat && canAttack && dist(e, player) < (s.attacks[0]?.rangeM ?? 0) && !this._canStep(e, e.targetPoint, context)) this._target(e, 'player');
      return;
    }
    if (originDistance > s.stats.chaseFromHomeM) {
      e.targetId = null; e.targetPoint = e.home; e.state = 'return'; e.rest = false; return;
    }
    if (e.targetId) {
      const target = e.targetId === 'player' ? player : this.get(e.targetId);
      if (target && !target.dead && dist(e, target) <= s.stats.detectionM && this._visible(e, target, context)) e.lastSeenAt = this.time;
      if (!target || target.dead || this.time - e.lastSeenAt > s.stats.loseSightS || dist(target, e.home) > s.stats.chaseFromHomeM) {
        e.targetId = null; e.targetPoint = e.home; e.state = 'return';
      } else { e.state = 'chase'; return; }
    }
    if (canAttack && player && this._visible(e, player, context)) {
      const close = dist(e, player) < s.stats.detectionM;
      const hostile = e.angerUntil > this.time || !s.civilization && s.entityType === 'inorganic' && dist(player, e.home) < 8;
      if (close && hostile) { this._target(e, 'player'); return; }
    }
    const day = context.isNight ?? ((8 + this.time / 60) % 24 >= 19 || (8 + this.time / 60) % 24 < 6);
    const active = s.behavior.activePeriod !== 'dusk_night' || day;
    if (hungry && canAttack && active && s.role === 'predator') {
      const foods = new Set(s.ecology.diet.filter(d => d.kind === 'species').map(d => d.id));
      const prey = nearby.filter(o => o !== e && !o.dead && foods.has(o.speciesId) && dist(e, o) <= s.stats.detectionM && this._visible(e, o, context))
        .sort((a, b) => dist(e, a) - dist(e, b) || a.id.localeCompare(b.id))[0];
      if (prey && prey.hp <= e.hp * 2) { this._target(e, prey.id); return; }
    }
    const region = this.regions.get(e.regionId);
    if (s.calories && e.calories < s.calories.maxCp * .85 && this._structure(e).functions.feed) {
      const food = this._foodTarget(e, s, region);
      if (food) { e.state = 'forage'; e.targetPoint = food; e.foodTargetId = food.id; e.rest = false; return; }
    }
    if (e.rest) { e.state = 'rest'; e.targetPoint = null; return; }
    if (s.calories && !s.civilization && e.breedAt <= this.time && e.calories >= s.calories.maxCp * s.population.reproductionCalorieFraction && region && nearby.filter(o => o.speciesId === s.id).length < (region.speciesCaps[s.id] ?? 0)) {
      const mate = nearby.find(o => o !== e && !o.dead && o.speciesId === s.id && o.roomId === e.roomId && o.breedAt <= this.time);
      if (mate) { e.state = 'courtship'; e.targetPoint = { x: mate.x, z: mate.z }; return; }
    }
    e.state = 'wander';
    if (!e.targetPoint || this.time >= e.nextWanderAt || dist(e, e.targetPoint) < .5) {
      const angle = fraction(`${e.id}:wander:${e.wanderSerial++}`) * Math.PI * 2;
      e.targetPoint = { x: e.home.x + Math.sin(angle) * 4, z: e.home.z + Math.cos(angle) * 4 };
      e.nextWanderAt = this.time + 8;
    }
  }

  _target(e, id) {
    if (e.targetId !== id) { e.warningUntil = this.time + this.species.get(e.speciesId).behavior.warningS; e.lastSeenAt = this.time; }
    e.targetId = id; e.targetPoint = null; e.state = 'chase'; e.rest = false;
  }

  _foodTarget(e, s, r) {
    if (!r) return null;
    if (s.role === 'predator') {
      const corpse = this._corpsesIn(r.id).filter(c => c.edibleCp > 0 && !c.claimed)
        .sort((a, b) => dist(e, a) - dist(e, b))[0];
      if (corpse) return { id: corpse.id, x: corpse.x, z: corpse.z, kind: 'corpse' };
      return r.carrionCp > 0 ? { id: `${r.id}:carrion`, x: r.x, z: r.z, kind: 'carrion' } : null;
    }
    if (s.ecology.diet.some(d => d.id === 'detritus') && r.detritusCp > 0) return { id: `${r.id}:detritus`, x: r.x, z: r.z, kind: 'detritus' };
    const node = r.foodNodes.filter(n => n.enabled && n.cp > 0).sort((a, b) => dist(e, a) - dist(e, b))[0];
    return node ? { id: node.id, x: node.x, z: node.z, kind: 'producer' } : null;
  }

  _act(e, s, dt, context) {
    if (e.attack && !this._structure(e).functions.attack) { e.attack = null; e.targetId = null; return; }
    if (e.attack) {
      const a = s.attacks.find(a => a.id === e.attack.attackId);
      e.state = e.attack.hitDone ? 'recover' : 'windup';
      if (!e.attack.hitDone && this.time + 1e-8 >= e.attack.hitAt) {
        e.attack.hitDone = true;
        const target = e.attack.targetId === 'player' ? context.player : this.get(e.attack.targetId);
        const shape = this._attackShape(e, s, a, target);
        if (target && !target.dead && target.hp !== 0 && shape && this._visible(e, target, context)) {
          const amount = a.damageHp * this.catalog.contracts.tierScaling.damagePerTierMultiplier ** (e.tier - s.baselineTier);
          const status = s.id === 'root_weaver' ? { type: 'slow', seconds: 2, multiplier: .7 } : null;
          if (e.attack.targetId === 'player') {
            const hit = { type: 'player_hit', sourceId: e.id, amount, energyType: a.energyType, status, appliedByCallback: Boolean(context.damagePlayer) };
            context.damagePlayer?.(amount, hit); this._events.push(hit);
          } else {
            this.damage(target.id, amount, 'body', { sourceId: e.id });
            if (status) target.slowUntil = this.time + 2;
          }
        }
      }
      if (this.time + 1e-8 >= e.attack.endAt) { e.attack = null; e.nextDecisionAt = this.time; }
      return;
    }
    if (e.targetId) {
      const target = e.targetId === 'player' ? context.player : this.get(e.targetId);
      if (!target || target.dead || target.hp === 0) { e.targetId = null; e.nextDecisionAt = this.time; return; }
      const a = s.attacks[0];
      if (!this._structure(e).functions.attack) { e.targetId = null; e.attack = null; return; }
      if (a && dist(e, target) <= a.rangeM && this.time >= e.warningUntil && this.time >= e.cooldownUntil && this._visible(e, target, context)) {
        if (e.targetId === 'player' && this._playerAttacking.size >= 2) return;
        if ((e.calories ?? Infinity) < a.calorieCostCp || (e.reserveEu ?? Infinity) < a.reserveCostEu) return;
        if (s.calories) e.calories -= a.calorieCostCp;
        if (e.reserveEu !== null) e.reserveEu -= a.reserveCostEu;
        e.yaw = Math.atan2(target.x - e.x, target.z - e.z);
        e.attack = { attackId: a.id, targetId: e.targetId, hitAt: this.time + a.windupS,
          endAt: this.time + a.windupS + a.recoveryS, hitDone: false,
          aim: { x: target.x, y: target.y ?? 0, z: target.z }, origin: { x: e.x, y: e.y, z: e.z } };
        e.cooldownUntil = this.time + a.cooldownS;
        this._events.push({ type: 'attack_telegraph', entityId: e.id, attackId: a.id, text: a.telegraph, duration: a.windupS, aim: clone(e.attack.aim), energyType: a.energyType });
        return;
      }
      if (a && dist(e, target) <= Math.min(a.rangeM * .75, 1.5)) { e.pose.moving = false; return; }
      this._move(e, target, dt, s.stats.sprintMps, context);
      return;
    }
    if (e.state === 'forage' && e.targetPoint && dist(e, e.targetPoint) < 2) {
      this._eat(e, s, dt); e.pose.moving = false;
    } else if (e.targetPoint) this._move(e, e.targetPoint, dt, e.state === 'flee' ? s.stats.sprintMps : s.stats.cruiseMps, context);
    else e.pose.moving = false;
    const r = this.regions.get(e.regionId);
    if (s.calories && r) {
      const available = r.foodNodes.reduce((n, f) => n + f.cp, 0) + (s.role === 'predator' ? r.carrionCp : 0);
      const capacity = r.foodNodes.reduce((n, f) => n + f.maxCp, 0) || 1;
      e.foodShortageSeconds = available / capacity < s.ecology.migrationFoodFraction ? e.foodShortageSeconds + dt : 0;
      if (e.foodShortageSeconds >= s.ecology.migrationAfterS || e.state === 'migrate') this._migrate(e, s, r);
    }
  }

  _attackShape(e, s, a, target) {
    if (!target || !e.attack) return false;
    if (Math.abs((target.y ?? 0) - e.y) > Math.max(2, s.body.lengthWidthHeightM[2] + 1) && !['winged', 'hover'].includes(s.body.profile)) return false;
    if (dist(e, target) > a.rangeM + .4) return false;
    const dx = target.x - e.attack.origin.x, dz = target.z - e.attack.origin.z;
    const ax = e.attack.aim.x - e.attack.origin.x, az = e.attack.aim.z - e.attack.origin.z;
    if (Math.hypot(dx, dz) < .05) return true;
    const dot = (dx * ax + dz * az) / Math.max(.001, Math.hypot(dx, dz) * Math.hypot(ax, az));
    return dot >= (a.rangeM > 3 ? .9 : .45);
  }

  _eat(e, s, dt) {
    const r = this.regions.get(e.regionId);
    if (!r || !s.calories) return;
    const need = Math.min(s.calories.maxCp - e.calories, s.calories.maxCp / 20 * dt);
    if (need <= 0) return;
    const corpse = this.corpses.get(e.foodTargetId);
    let eaten = 0;
    if (corpse && !corpse.claimed && corpse.regionId === r.id && s.role === 'predator') {
      eaten = Math.min(need, corpse.edibleCp); corpse.edibleCp -= eaten;
    } else if (e.foodTargetId === `${r.id}:carrion` && s.role === 'predator') {
      eaten = Math.min(need, r.carrionCp); r.carrionCp -= eaten;
    } else if (e.foodTargetId === `${r.id}:detritus` && s.ecology.diet.some(d => d.id === 'detritus')) {
      eaten = Math.min(need, r.detritusCp); r.detritusCp -= eaten;
    } else if (s.role !== 'predator') {
      const node = r.foodNodes.find(n => n.id === e.foodTargetId);
      if (node?.enabled) { eaten = Math.min(need, node.cp); node.cp -= eaten; }
    }
    e.calories += eaten;
    if (!eaten) e.nextDecisionAt = this.time;
  }

  _solid(t, x, y, z) {
    if (t.isSolidCell) return t.isSolidCell(x, y, z);
    if (!t.getCell) return false;
    const id = t.getCell(x, y, z);
    return id != null && id !== 0 && (this.blocks.get(id)?.collision ?? true);
  }

  _waterAt(t, x, y, z) {
    if (!t?.fluidAt) return null;
    let fluid = t.fluidAt(x, y + .05, z);
    if (!fluid) return null;
    let surface = y + .05 + fluid.depth;
    // Atlas fluid.depth is per 0.5m cell; follow contiguous cells for real depth.
    for (let i = 0; i < 12; i++) {
      const next = t.fluidAt(x, surface + .025, z);
      if (!next || next.depth <= 0) break;
      surface += .025 + next.depth;
    }
    return { ...fluid, depth: Math.max(0, surface - y), surface };
  }

  _flightEnabled(e, s) {
    return ['winged', 'hover'].includes(s.body.profile) && e.pose.limbSupport.every(Boolean) &&
      !e.dead && !e.rest && (e.calories === null || e.calories > 0) && (e.reserveEu === null || e.reserveEu > 0);
  }

  _canStep(e, p, context) {
    const r = this.regions.get(e.regionId);
    if (r?.closed && r.bounds && (p.x < r.x + r.bounds.min[0] || p.x > r.x + r.bounds.max[0] || p.z < r.z + r.bounds.min[1] || p.z > r.z + r.bounds.max[1])) return false;
    const t = context.terrain ?? this.terrain;
    if (!t) return true;
    const ground = t.heightAt?.(p.x, p.z, e.y) ?? e.y;
    if (!Number.isFinite(ground)) return false;
    const s = this.species.get(e.speciesId), flying = this._flightEnabled(e, s);
    const stepHeight = Math.min(1.2, Math.max(.25, s.body.lengthWidthHeightM[2] * .5)) * Math.max(.2, e.pose.speedFactor);
    const currentGround = t.heightAt?.(e.x, e.z, e.y) ?? e.y;
    if (!flying && ground - currentGround > stepHeight) return false;
    if (!flying && currentGround - ground > Math.max(1.5, s.body.lengthWidthHeightM[2]) && e.state !== 'flee') return false;
    const fluid = this._waterAt(t, p.x, ground, p.z);
    if (!flying && fluid?.type === 'acid') return false;
    if (!flying && fluid?.temperatureC > (s.ecology.environmentIds.includes('thermal') ? 95 : 55)) return false;
    if (!flying && fluid?.depth > s.body.lengthWidthHeightM[2] * .6 && !AQUATIC.has(s.id) && !AMPHIBIOUS.has(s.id)) return false;
    if (t.isSolidCell || t.getCell) {
      const [length, width, h] = s.body.lengthWidthHeightM;
      const yaw = Math.atan2(p.x - e.x, p.z - e.z), c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
      const halfX = width * .45 * c + length * .45 * sn, halfZ = length * .45 * c + width * .45 * sn;
      const base = flying ? Math.max(e.y, ground + .05) : ground;
      for (const dx of [-halfX, 0, halfX]) for (const dz of [-halfZ, 0, halfZ]) for (const dy of [.05, h * .5, Math.max(.05, h - .05)]) {
        if (this._solid(t, Math.floor((p.x + dx) * 2), Math.floor((base + dy) * 2), Math.floor((p.z + dz) * 2))) return false;
      }
    }
    return true;
  }

  _move(e, target, dt, baseSpeed, context) {
    const dx = target.x - e.x, dz = target.z - e.z, len = Math.hypot(dx, dz);
    if (len < .1) { e.pose.moving = false; return; }
    const s = this.species.get(e.speciesId), terrain = context.terrain ?? this.terrain;
    const ground = terrain?.heightAt?.(e.x, e.z, e.y) ?? e.y;
    const water = this._waterAt(terrain, e.x, ground, e.z);
    const medium = AQUATIC.has(s.id) && !water ? .25 : water && !AQUATIC.has(s.id) ? .65 : 1;
    const speed = baseSpeed * e.pose.speedFactor * medium * (e.slowUntil > this.time ? .7 : 1);
    const distance = Math.min(len, speed * dt);
    if (distance <= 0) { e.pose.moving = false; return; }
    // Substeps prevent coarse passive movement from skipping a wall or water edge.
    const steps = Math.max(1, Math.ceil(distance / .25));
    let moved = 0;
    for (let i = 0; i < steps; i++) {
      const nx = e.x + dx / len * distance / steps, nz = e.z + dz / len * distance / steps;
      const candidates = [{ x: nx, z: nz }, { x: nx, z: e.z }, { x: e.x, z: nz }];
      const selected = candidates.find(p => Math.hypot(p.x - e.x, p.z - e.z) > 1e-7 && this._canStep(e, p, context));
      if (!selected) break;
      const travelled = Math.hypot(selected.x - e.x, selected.z - e.z);
      e.yaw = Math.atan2(selected.x - e.x, selected.z - e.z);
      e.x = selected.x; e.z = selected.z; moved += travelled;
    }
    e.pose.moving = moved > 0;
    e.pose.phase += moved * 3;
  }

  _vertical(e, s, dt, context) {
    const t = context.terrain ?? this.terrain;
    const ground = t?.heightAt?.(e.x, e.z, e.y);
    if (!Number.isFinite(ground)) return;
    const water = this._waterAt(t, e.x, ground, e.z);
    if (this._flightEnabled(e, s)) {
      const targetY = ground + (s.body.profile === 'winged' ? 2 : 1);
      const nextY = e.y + clamp(targetY - e.y, -dt * 3, dt * 3);
      const h = s.body.lengthWidthHeightM[2];
      if (!this._solid(t, Math.floor(e.x * 2), Math.floor((nextY + h) * 2), Math.floor(e.z * 2))) e.y = nextY;
      e.verticalVelocity = 0; e.grounded = false; e.locomotion = 'flying';
    } else if (water && (AQUATIC.has(s.id) || AMPHIBIOUS.has(s.id))) {
      const offset = AQUATIC.has(s.id) ? Math.min(water.depth * .45, Math.max(0, water.depth - s.body.lengthWidthHeightM[2])) : Math.max(0, water.depth - s.body.lengthWidthHeightM[2] * .65);
      e.y += clamp(ground + offset - e.y, -dt * 2, dt * 2);
      e.verticalVelocity = 0; e.grounded = false; e.locomotion = 'swimming';
    } else {
      e.locomotion = AQUATIC.has(s.id) ? 'crawling' : 'ground';
      if (e.y > ground + .02) { e.verticalVelocity = Math.max(-20, (e.verticalVelocity ?? 0) - 9.81 * dt); e.y = Math.max(ground, e.y + e.verticalVelocity * dt); }
      else { e.y = ground; e.verticalVelocity = 0; }
      e.grounded = e.y <= ground + .02;
    }
    context.environmentDamage?.(e, water, dt);
  }

  _visible(a, b, context) {
    const t = context.terrain ?? this.terrain;
    const aSize = this.species.get(a.speciesId)?.body.lengthWidthHeightM[2] ?? 1.2;
    const bSize = this.species.get(b.speciesId)?.body.lengthWidthHeightM[2] ?? 1.6;
    const from = { x: a.x, y: (a.y ?? 0) + aSize * .55, z: a.z };
    const to = { x: b.x, y: (b.y ?? 0) + bSize * .55, z: b.z };
    if (t?.hasAttackLineOfSight) return t.hasAttackLineOfSight(from, to, { excludeOwnerId: a.id, targetOwnerId: b.id ?? 'player' });
    if (context.hasLineOfSight) return context.hasLineOfSight(from, to);
    if (t?.hasLineOfSight) return t.hasLineOfSight(from, to);
    if (!t || !t.isSolidCell && !t.getCell) return true;
    const distance = dist(a, b), steps = Math.max(1, Math.ceil(distance / .5));
    for (let i = 1; i < steps; i++) {
      const q = i / steps, x = a.x + (b.x - a.x) * q, z = a.z + (b.z - a.z) * q;
      const y = from.y + (to.y - from.y) * q;
      if (this._solid(t, Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2))) return false;
    }
    return true;
  }

  _breed(r) {
    let living = this._living(r.id);
    if (living.length >= r.capacity) return;
    const foodFraction = r.foodNodes.reduce((n, p) => n + p.cp, 0) / Math.max(1, r.foodNodes.reduce((n, p) => n + p.maxCp, 0));
    for (const s of this.species.values()) {
      if (!s.calories || s.civilization || !s.population.offspringCount || foodFraction < s.population.foodAvailabilityFraction) continue;
      const count = living.filter(e => e.speciesId === s.id).length;
      if (count >= (r.speciesCaps[s.id] ?? 0) || living.length >= r.capacity) continue;
      if (r.kind === 'outdoor' && s.role === 'predator' && living.filter(e => this.species.get(e.speciesId).role === 'predator').length >= 2) continue;
      if (s.role === 'predator') {
        const prey = new Set(s.ecology.diet.filter(d => d.kind === 'species').map(d => d.id));
        const production = living.filter(e => prey.has(e.speciesId)).reduce((n, e) => {
          const p = this.species.get(e.speciesId); return n + p.ecology.carcassEdibleCp / Math.max(1, p.population.breedingCooldownS) / 2;
        }, 0);
        if (production < (count + 1) * s.calories.basalCpPerS) continue;
      }
      const parents = living.filter(e => e.speciesId === s.id && e.age >= s.population.maturityS && e.calories >= s.calories.maxCp * s.population.reproductionCalorieFraction && e.breedAt <= this.time && !e.targetId && !e.attack);
      const first = parents[0], second = parents.find(e => e !== first && first && dist(first, e) <= 6 && e.roomId === first.roomId);
      if (!first || !second) continue;
      if (first.roomId && living.filter(e => e.roomId === first.roomId).length >= (r.roomCaps?.[first.roomId] ?? r.capacity)) continue;
      const newbornCp = s.calories.maxCp * s.population.newbornCalorieFraction;
      if (first.calories < newbornCp || second.calories < newbornCp) continue;
      const serial = r.births++;
      const child = this.spawn(s.id, { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 },
        { id: `${r.id}:birth:${serial}`, tier: first.tier, regionId: r.id, dungeonId: first.dungeonId, roomId: first.roomId, adult: false, calories: newbornCp });
      first.calories -= newbornCp; second.calories -= newbornCp;
      first.breedAt = second.breedAt = this.time + s.population.breedingCooldownS;
      living.push(child);
      this._events.push({ type: 'birth', entityId: child.id, parents: [first.id, second.id], regionId: r.id });
    }
  }

  _migrate(e, s, r) {
    if (r.closed || s.civilization) return;
    const nearbyRegions=this._nearIds(this._regionSpatial,r,96).sort((a,b)=>this._regionOrder.get(a)-this._regionOrder.get(b)).map(id=>this.regions.get(id));
    const destination = (e.migrationTarget && this.regions.get(e.migrationTarget)) || nearbyRegions.find(n => n.id !== r.id && !n.closed &&
      dist(r, n) <= 96 && n.environmentId && (s.ecology.environmentIds.includes(n.environmentId) || s.ecology.environmentIds.includes(n.baseEnvironmentId)) &&
      this._living(n.id).length < n.capacity && this._living(n.id).filter(x => x.speciesId === s.id).length < (n.speciesCaps[s.id] ?? 0) &&
      n.foodNodes.some(p => p.cp > p.maxCp * .4));
    if (!destination || this._living(destination.id).length >= destination.capacity) { e.migrationTarget = null; if (e.state === 'migrate') e.state = 'idle'; return; }
    // Cross the real boundary by movement. Ownership is transferred only on arrival.
    e.migrationTarget = destination.id; e.state = 'migrate'; e.targetPoint = { x: destination.x, z: destination.z };
    if (dist(e, destination) > destination.radius) return;
    const from = e.regionId;
    e.regionId = destination.id; e.dungeonId = destination.kind === 'dungeon' ? destination.id : null;
    e.migrationTarget = null; e.state = 'idle'; e.roomId = null; e.home = { x: e.x, y: e.y, z: e.z }; e.foodShortageSeconds = 0;
    r.migrationCount++; destination.migrationCount++;
    this._events.push({ type: 'migration', entityId: e.id, from, to: destination.id });
  }

  _structure(e) {
    const model = this._model(e.speciesId, e.tier), base = evaluateStructure(model, e.structure);
    const intact = id => boneHealth(model, e.structure, id) > 0;
    const functions = { attack: intact('core') && intact('head') && (!model.byId.has('weapon') || intact('weapon')), feed: intact('core') && intact('head') };
    for (const node of model.nodes) if (node.id.startsWith('limb_')) functions[node.id] = intact(node.id) && intact('spine');
    // Internal core/spine faults affect function, not attachment ownership or life.
    // Only total creature HP determines death; this overrides the older vital graph rule.
    return { ...base, alive: e.hp > 0, functions, connected: new Set(model.nodes.filter(n=>intact(n.id)).map(n=>n.id)) };
  }
  _partAlias(e, partId) {
    const model = this._model(e.speciesId, e.tier);
    if (model.byId.has(partId)) return partId;
    const logical = creatureBodyPart(e, partId);
    return logical && model.byId.has(logical) ? logical : null;
  }

  damage(id, amount, partId = 'body', options = {}) {
    finite(amount, 'damage', 0);
    const e = this.get(id);
    if (!e) return { ok:false,reason:'no_live_target' };
    if (options.attackId != null && (typeof options.attackId !== 'string' || !options.attackId || options.attackId.length > 512)) return {ok:false,reason:'invalid_attack_id'};
    if (options.attackId && Object.hasOwn(e.damageReceipts ?? {},options.attackId)) return {...clone(e.damageReceipts[options.attackId]),duplicate:true};
    if (e.dead || amount === 0) return { ok: false, reason: 'no_live_target' };
    const mode = options.attackMode ?? options.mode ?? 'strike';
    if (!['strike','pierce','impact'].includes(mode)) return {ok:false,reason:'unknown_attack_mode'};
    if (options.energyEU != null && (!Number.isFinite(options.energyEU) || options.energyEU < 0)) return {ok:false,reason:'invalid_energy_budget'};
    const model = this._model(e.speciesId, e.tier), part = partId === 'body' ? null : this._partAlias(e, partId);
    if (partId !== 'body' && !part) return { ok: false, reason: 'unknown_part' };
    const hits = options.structuralHits ?? (part ? [{partId:part,amount}] : []);
    if (!Array.isArray(hits) || hits.length > 64 || hits.some(h=>!h || !Number.isFinite(h.amount) || h.amount < 0 || (h.energyEU != null && (!Number.isFinite(h.energyEU) || h.energyEU < 0)))) return {ok:false,reason:'invalid_structural_hits'};
    const allocated = hits.reduce((n,h)=>n+h.amount,0), energy = hits.reduce((n,h)=>n+(h.energyEU??0),0);
    if (allocated > amount + 1e-7 || options.energyEU != null && energy > options.energyEU + 1e-7) return {ok:false,reason:'attack_budget_exceeded'};
    const species = this.species.get(e.speciesId), shell = model.byId.get('shell');
    const armor = clamp(species.stats.damageReduction ?? 0,0,1) * clamp(boneHealth(model,e.structure,'shell') / shell.hp,0,1), effectiveAmount = amount * (1-armor);
    const before=e.hp,beforeParts=e.parts;
    const beforePose=hits.length?Object.fromEntries(['id','speciesId','entityType','civilization','bodyProfile','bodySize','x','y','z','yaw','state','pose','parts','dead','rest','attack'].map(k=>[k,clone(e[k]??null)])):null;
    const captured=hits.length?this.fragmentBridge?.capture(e)??null:null;
    e.lastHitAt=this.time;e.rest=false;e.repairProgress=0;e.angerUntil=this.time+20;
    if(options.sourceId){e.targetId=options.sourceId;e.lastSeenAt=this.time;e.warningUntil=this.time+species.behavior.warningS;}
    // HP is one whole-body gauge. Structural HP is a derived injury state, not a
    // second subtraction from the attack's total HP/EU budget.
    e.hp=Math.max(0,e.hp-effectiveAmount);
    const structuralDamage=[];
    for(const hit of hits){const id=this._partAlias(e,hit.partId??hit.visualPartId??'body');if(!id)continue;
      const result=breakBone(model,e.structure,id,hit.amount*(1-armor));
      if(result.damage)structuralDamage.push({partId:id,damage:result.damage,broken:result.broken});
    }
    if(e.hp<=0)this._die(e,'hp_depleted');
    this._pose(e);
    const detached=Object.entries(e.parts).filter(([id,p])=>p.detached&&!beforeParts[id]?.detached).map(([id])=>id);
    if(detached.length){e.fragmentCuts.push({id:`${e.id}:cut:${e.fragmentSerial++}`,logicalParts:detached,before:beforePose,captured,time:this.time,processed:false});this.fragmentBridge?.flushEntity(e);}
    const result={ok:true,hpLost:before-e.hp,effectiveAmount,armorReduction:armor,structuralDamage,attackMode:mode,energyEU:options.energyEU??null,dead:e.dead,partId:part,corpseId:e.dead?`corpse:${e.id}`:null};
    if(options.attackId)Object.defineProperty(e.damageReceipts,options.attackId,{value:clone(result),enumerable:true,writable:true,configurable:true});
    return result;
  }

  damagePacket(id, packet = {}) {
    const hits=packet.hits??packet.structuralHits??[];
    if(!Array.isArray(hits))return {ok:false,reason:'invalid_structural_hits'};
    const amount=packet.amount??packet.effectiveAmount??hits.reduce((n,h)=>n+(h.amount??0),0);
    if(!Number.isFinite(amount)||amount<0)return {ok:false,reason:'invalid_damage'};
    return this.damage(id,amount,'body',{...packet,attackMode:packet.attackMode??packet.mode??'strike',structuralHits:hits});
  }

  setFragmentBridge(bridge) { this.fragmentBridge = bridge; }
  massForVisualPart(id, partId) { const e = this.get(id), part = e?.fragmentMass?.parts?.[partId]; return part ? (part.objectId ? 0 : part.massKg) : null; }

  _pose(e) {
    const s = this.species.get(e.speciesId), profile = this.catalog.bodyProfiles[s.body.profile], model = this._model(e.speciesId, e.tier), evaluated = this._structure(e);
    const supports = Array.from({ length: profile.limbCount }, (_, i) => Boolean(evaluated.functions[`limb_${i}`]));
    const intact = supports.filter(Boolean).length;
    let speed = profile.intactLimbSpeed[intact] ?? 0;
    if (s.body.profile === 'quadruped' && intact === 2 && supports[0] === supports[3] && supports[1] === supports[2]) speed = .22;
    if (s.body.profile === 'winged' && intact < 2) speed = .25;
    if (boneHealth(model,e.structure,'core') <= 0) speed *= .25;
    e.pose.limbSupport = supports; e.pose.speedFactor = e.dead ? 0 : speed;
    e.pose.missingParts = model.nodes.filter(n => !['core','spine'].includes(n.id) && boneHealth(model,e.structure,n.id) <= 0).map(n=>n.id);
    e.pose.moving = e.dead ? false : e.pose.moving;
    const poses = {}, moving = e.pose.moving ? 1 : 0;
    const limbPose = (name, index, phase = index * Math.PI) => { poses[name] = { rotation: [Math.sin(e.pose.phase + phase) * .42 * moving, 0, 0], hidden: boneHealth(model,e.structure,`limb_${index}`) <= 0 }; };
    if (s.body.profile === 'quadruped') ['left_foreleg', 'right_foreleg', 'left_hindleg', 'right_hindleg'].forEach((name, i) => limbPose(name, i, [0, Math.PI, Math.PI, 0][i]));
    else if (s.body.profile === 'winged') for (const [i, side] of [-1, 1].entries()) poses[`wing_${side}`] = { rotation: [0, 0, Math.sin(e.pose.phase * 1.7) * .4 * side], hidden: boneHealth(model,e.structure,`limb_${i}`) <= 0 };
    else if (s.body.profile === 'biped') for (const [i, side] of [-1, 1].entries()) limbPose(`leg_${side}`, i);
    else if (s.body.profile === 'hover') for (let i = 0; i < 3; i++) poses[`thruster_${i}`] = { rotation: [0, 0, 0], hidden: boneHealth(model,e.structure,`limb_${i}`) <= 0 };
    else if (['arthropod', 'arachnid'].includes(s.body.profile)) for (let i = 0; i < profile.limbCount; i++) {
      limbPose(`leg_${i % 2 ? 1 : -1}_${Math.floor(i / 2)}`, i);
      if (s.id === 'furnace_mantis' && i < 4) limbPose(`walking_leg_${i % 2 ? 1 : -1}_${Math.floor(i / 2)}`, i);
    }
    else if (s.body.profile === 'serpent') for (let i = 0; i < 12; i++) poses[`segment_${i}`] = { rotation: [0, Math.sin(e.pose.phase - i * .5) * .16 * moving, 0], hidden: boneHealth(model,e.structure,`limb_${Math.min(3,Math.floor(i/3))}`) <= 0 };
    if (e.attack) poses.head = { rotation: [-.15, 0, 0], hidden: e.parts.head?.detached ?? false };
    e.pose.parts = poses;
    e.parts = Object.fromEntries(model.nodes.map(n => [n.id, { hp: boneHealth(model, e.structure, n.id), maxHp: n.hp, broken: boneHealth(model,e.structure,n.id) <= 0, detached: !['core','spine'].includes(n.id) && boneHealth(model,e.structure,n.id) <= 0 }]));
  }

  _die(e, reason) {
    if (e.dead) return;
    e.dead = true; e.hp = 0; e.state = 'dead'; e.attack = null; e.targetId = null;
    const s = this.species.get(e.speciesId), id = `corpse:${e.id}`;
    const drops = s.civilization ? clone(e.inventory) : Object.fromEntries(s.drops.map(d => [d.itemId, integer(`${this.seed}:${id}:${d.itemId}`, d.min, d.max)]));
    this.corpses.set(id, { id, entityId: e.id, speciesId: e.speciesId, regionId: e.regionId,
      x: e.x, y: e.y, z: e.z, edibleCp: s.ecology.carcassEdibleCp, initialEdibleCp: s.ecology.carcassEdibleCp,
      drops, claimed: false, diedAt: this.time, reason });
    this._bucket(this._regionCorpses,e.regionId,id,true);
    this._events.push({ type: 'death', entityId: e.id, corpseId: id, reason });
    this._pose(e);
  }

  _transaction(inventory, delta, transactionId) {
    if (!inventory) return { ok: false, reason: 'inventory_required' };
    if (typeof inventory.apply === 'function') {
      const result = inventory.apply(delta, transactionId);
      return typeof result === 'boolean' ? { ok: result } : result;
    }
    // Plain records are useful for isolated model tests and embedded callers.
    for (const [id, n] of Object.entries(delta)) if (!Number.isFinite(n) || (inventory[id] ?? 0) + n < 0) return { ok: false, reason: 'insufficient_inventory' };
    for (const [id, n] of Object.entries(delta)) inventory[id] = (inventory[id] ?? 0) + n;
    return { ok: true };
  }

  claimDrops(id, inventory) {
    const c = this.corpses.get(id) ?? this.corpses.get(`corpse:${id}`);
    if (!c) return { ok: false, reason: 'no_corpse' };
    if (c.claimed) return { ok: true, duplicate: true, items: {} };
    const items = clone(c.drops);
    if (items.meat && c.initialEdibleCp > 0) items.meat = Math.floor(items.meat * c.edibleCp / c.initialEdibleCp);
    const result = this._transaction(inventory, items, `${c.id}:claim`);
    if (!result?.ok) return result;
    c.claimed = true; c.edibleCp = 0;
    const e = this.get(c.entityId); if (e?.civilization) e.inventory = {};
    return { ok: true, items, duplicate: Boolean(result.duplicate) };
  }

  repair(id, { inventory, atStation = false, dt = 0 } = {}) {
    finite(dt, 'repair dt', 0);
    const e = this.get(id), s = e && this.species.get(e.speciesId);
    if (!e || e.dead || !s.repair) return { ok: false, reason: 'not_repairable' };
    if (!atStation) return { ok: false, reason: 'station_required' };
    if (e.attack || e.targetId || this.time - e.lastHitAt < 1) return { ok: false, reason: 'in_combat' };
    if (e.hp >= e.maxHp) return { ok: false, reason: 'already_full' };
    e.repairProgress = Math.min(s.repair.durationS, e.repairProgress + dt);
    if (e.repairProgress < s.repair.durationS) return { ok: true, pending: true, progress: e.repairProgress / s.repair.durationS };
    const tx = this._transaction(inventory, { [s.repair.materialId]: -s.repair.unitsPerAction }, `${e.id}:repair:${e.repairSerial}`);
    if (!tx?.ok) return tx;
    const restored = Math.min(e.maxHp - e.hp, s.repair.hpPerAction);
    e.hp += restored; e.repairProgress = 0; e.repairSerial++;
    return { ok: true, restored };
  }

  recharge(id, channel, amount) {
    finite(amount, 'energy', 0);
    const e = this.get(id), s = e && this.species.get(e.speciesId);
    if (!e || e.dead || !s.energyReserve || s.energyReserve.kind !== channel) return 0;
    const accepted = Math.min(amount, s.energyReserve.capacityEu - e.reserveEu);
    e.reserveEu += accepted;
    return accepted; // caller must debit its matching external channel by this amount
  }

  interact(id, action = {}) {
    const e = this.get(id), s = e && this.species.get(e.speciesId);
    if (!e || e.dead) return { ok: false, reason: 'no_live_target' };
    if (action.type === 'repair') return this.repair(id, action);
    if (action.type === 'rest') { e.rest = action.enabled !== false; e.targetId = null; e.targetPoint = null; e.state = 'rest'; return { ok: true }; }
    if (action.type === 'feed') {
      if (!s.calories || e.calories >= s.calories.maxCp) return { ok: false, reason: 'not_hungry' };
      const tx = this._transaction(action.inventory, { food: -1 }, `${e.id}:feed:${e.interactionSerial}`);
      if (!tx?.ok) return tx;
      e.interactionSerial++; const restored = Math.min(this.foodCalories, s.calories.maxCp - e.calories); e.calories += restored;
      return { ok: true, restored };
    }
    if (!s.civilization) return { ok: false, reason: 'not_civilized' };
    if (e.angerUntil > this.time) return { ok: false, reason: 'hostile' };
    const offer = s.entityType === 'organic' ? { id: 'food_for_wood', give: { food: 1 }, receive: { wood: 2 } } : { id: 'iron_for_stone', give: { scrap_iron: 1 }, receive: { stone: 2 } };
    if (action.type === 'trade' && action.offerId) {
      if (action.offerId !== offer.id) return { ok: false, reason: 'unknown_offer' };
      if (Object.entries(offer.receive).some(([id, q]) => (e.inventory[id] ?? 0) < q)) return { ok: false, reason: 'out_of_stock' };
      const delta = { ...offer.receive };
      for (const [item, count] of Object.entries(offer.give)) delta[item] = (delta[item] ?? 0) - count;
      const tx = this._transaction(action.inventory, delta, `${e.id}:trade:${e.interactionSerial}`);
      if (!tx?.ok) return tx;
      for (const [item, count] of Object.entries(delta)) e.inventory[item] = (e.inventory[item] ?? 0) - count;
      e.interactionSerial++;
      return { ok: true, offer };
    }
    return { ok: true, name: s.name, communityId: e.communityId, offers: [offer], state: e.state };
  }

  serialize() {
    return clone({ version: 1, seed: this.seed, time: this.time, remainder: this.remainder,
      pendingOfflineSeconds: this.pendingOfflineSeconds, serial: this.serial,
      entities: [...this._entities.values()].map(e => ({ ...e, structure: saveStructure(e.structure) })),
      regions: [...this.regions.values()], corpses: [...this.corpses.values()] });
  }

  _load(state) {
    if (state.version !== 1 || !Array.isArray(state.entities) || !Array.isArray(state.regions) || !Array.isArray(state.corpses)) throw new Error('Unsupported creature save');
    this.seed = String(state.seed); this.time = finite(state.time, 'saved time', 0);
    this.remainder = finite(state.remainder ?? 0, 'saved remainder', 0);
    if (this.remainder >= STEP + 1e-8) throw new Error('Invalid step remainder');
    this.pendingOfflineSeconds = finite(state.pendingOfflineSeconds ?? 0, 'pending time', 0);
    this.serial = finite(state.serial, 'serial', 0);
    for (const raw of state.regions) {
      const r = clone(raw);
      if (this.regions.has(r.id)) throw new Error('Duplicate ecology region');
      finite(r.capacity, 'region capacity', 0);
      for (const n of r.foodNodes) { finite(n.cp, 'food', 0); finite(n.maxCp, 'food cap', 0); if (n.cp > n.maxCp + 1e-6) throw new Error('Food exceeds capacity'); }
      r.lastUpdatedAt ??= this.time;
      this.regions.set(r.id, r);
      this._indexRegion(r);
    }
    for (const raw of state.entities) {
      if (!this.species.has(raw.speciesId) || this._entities.has(raw.id)) throw new Error('Unknown or duplicate creature');
      const e = clone(raw), s = this.species.get(e.speciesId);
      finite(e.hp, 'HP', 0); finite(e.maxHp, 'max HP', 1); finite(e.x, 'x'); finite(e.y, 'y'); finite(e.z, 'z');
      if (e.hp > e.maxHp || e.entityType !== s.entityType) throw new Error('Invalid creature state');
      if (s.calories) { finite(e.calories, 'calories', 0); if (e.calories > s.calories.maxCp + 1e-6) throw new Error('Calories above capacity'); }
      else if (e.calories !== null) throw new Error('Inorganic creature cannot have calories');
      e.damageReceipts ??= {};
      if (!e.damageReceipts || typeof e.damageReceipts !== 'object' || Array.isArray(e.damageReceipts) || Object.values(e.damageReceipts).some(r=>!r?.ok || !Number.isFinite(r.hpLost) || r.hpLost<0)) throw new Error('Invalid damage receipts');
      e.massKg ??= s.body.massKg; e.fragmentMass ??= null; e.fragmentCuts ??= []; e.fragmentSerial ??= 0;
      finite(e.massKg, 'creature mass', 0);
      if (!Array.isArray(e.fragmentCuts) || !Number.isSafeInteger(e.fragmentSerial) || e.fragmentSerial < 0) throw new Error('Invalid fragment state');
      if (e.fragmentMass) {
        const ledger = e.fragmentMass;
        const claims = Object.values(ledger.claims ?? {}), parts = Object.values(ledger.parts ?? {});
        if (ledger.ownerId !== e.id || !parts.length || claims.some(c => !Number.isFinite(c.massKg) || c.massKg <= 0 || typeof c.objectId !== 'string') || parts.some(p => !Number.isFinite(p.massKg) || p.massKg < 0) || Math.abs(ledger.totalMassKg - s.body.massKg) > 1e-7 || Math.abs(ledger.remainingMassKg - e.massKg) > 1e-7 || Math.abs(claims.reduce((n,c)=>n+c.massKg,0)+e.massKg-s.body.massKg)>1e-7 || Math.abs(parts.reduce((n,p)=>n+p.massKg,0)-s.body.massKg)>1e-7) throw new Error('Invalid fragment mass');
      } else if (Math.abs(e.massKg - s.body.massKg) > 1e-7) throw new Error('Unallocated creature mass changed');
      if (e.fragmentCuts.length > 64 || new Set(e.fragmentCuts.map(c=>c.id)).size !== e.fragmentCuts.length || e.fragmentCuts.some(c=>typeof c.id !== 'string' || !Array.isArray(c.logicalParts) || !c.logicalParts.length || typeof c.processed !== 'boolean' || (!c.processed && (!c.before || !Number.isFinite(c.before.x) || !Number.isFinite(c.before.y) || !Number.isFinite(c.before.z))))) throw new Error('Invalid saved severance');
      e.lastUpdatedAt ??= this.time; e.bodyProfile ??= s.body.profile; e.bodySize ??= [...s.body.lengthWidthHeightM];
      e.structure = structureState(this._model(e.speciesId, e.tier), e.structure);
      this._entities.set(e.id, e);this._indexEntity(e);this._pose(e);
    }
    for (const raw of state.corpses) {
      const c = clone(raw);
      if (this.corpses.has(c.id) || !this.get(c.entityId)?.dead) throw new Error('Invalid corpse owner');
      finite(c.edibleCp, 'corpse calories', 0); finite(c.initialEdibleCp, 'corpse cap', 0);
      if (c.edibleCp > c.initialEdibleCp) throw new Error('Corpse calories exceed capacity');
      this.corpses.set(c.id, c);
      this._bucket(this._regionCorpses,c.regionId,c.id,true);
    }
  }
}
