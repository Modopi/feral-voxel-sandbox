import { ENERGY_TYPES } from './progression.js';

const clone = value => structuredClone(value);
const ok = value => ({ ok: true, ...value });
const fail = reason => ({ ok: false, reason });
const finite = value => Number.isFinite(value) && value >= 0 && value <= 1e9;
const claimOK = id => typeof id === 'string' && id.length > 0 && id.length <= 512;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
// Runtime balance proposals: the design fixes add-property vs strengthen-property,
// but does not supply numerical enchantment recipes. These never change material IDs,
// grant component functions, reduce mass, or create motion/energy without a paid source.
export const MATERIAL_EFFECT_RULES = Object.freeze({
 thermal_shield: { name: '열 차폐', kind: 'magic', energyPerLiter: 10, damageMultiplier: .75 },
 acid_shield: { name: '산 차폐', kind: 'magic', energyPerLiter: 10, damageMultiplier: .75 },
 water_affinity: { name: '물 친화', kind: 'magic', energyPerLiter: 10, attribute: 'water' },
 wind_affinity: { name: '바람 친화', kind: 'magic', energyPerLiter: 10, attribute: 'wind' },
 maxHp: { name: '내구 축성', kind: 'divine', energyPerLiter: 10, multiplier: 1.25 },
 loadKn: { name: '강도 축성', kind: 'divine', energyPerLiter: 10, multiplier: 1.25 },
 heatLimitC: { name: '내열 축성', kind: 'divine', energyPerLiter: 10, multiplier: 1.25 },
 acidResistance: { name: '내산 축성', kind: 'divine', energyPerLiter: 10, multiplier: 1.25 },
});
export const ENERGY_INTERACTIONS = Object.freeze({
 mechanical: { damageType: 'physical', damagePerEU: 2/3 },
 electrical: { damageType: 'shock', damagePerEU: 2/3 },
 thermal: { damageType: 'fire', damagePerEU: 2/3 },
 chemical: { damageType: 'acid', damagePerEU: 2/3 },
 magic: { damageType: 'magic', damagePerEU: 2/3 },
 divine: { damageType: 'divine', damagePerEU: 2/3 },
});

export class MaterialEffects {
 constructor(content, progression, state = {}, { machines = null } = {}) {
  this.content = content; this.progression = progression; this.machines = machines;
  if (state.schemaVersion != null && state.schemaVersion !== 1) throw Error('Unsupported material effect save');
  this.jobs = clone(state.jobs || []); this.requests = clone(state.requests || {}); this.attacks = clone(state.attacks || {});
  this.clock = state.clock || 0; this.thermal = clone(state.thermal || { fuelEU: 0, storedEU: 0, generatedEU: 0, consumedEU: 0 });
  if (!finite(this.clock) || !Object.values(this.thermal).every(finite) || this.thermal.fuelEU > 4000 || this.thermal.storedEU > 100 || this.jobs.length > 64) throw Error('Invalid effect state');
  for (const job of this.jobs) if (!claimOK(job.claimId) || !claimOK(job.voxelId) || !MATERIAL_EFFECT_RULES[job.property] || !finite(job.progress) || !finite(job.seconds) || job.progress > job.seconds || job.seconds <= 0 || (job.receivedEU != null && (!finite(job.receivedEU) || job.receivedEU > job.energyEU)) || (job.sourceComponentId != null && !claimOK(job.sourceComponentId))) throw Error('Invalid effect job');
  for (const [id, request] of Object.entries(this.requests)) if (!claimOK(id) || typeof request.signature !== 'string') throw Error('Invalid effect request');
  for (const [id, attack] of Object.entries(this.attacks)) if (!claimOK(id) || !claimOK(attack.targetId) || !ENERGY_TYPES.includes(attack.energyType) || !finite(attack.energyEU) || !finite(attack.amount) || typeof attack.delivered !== 'boolean') throw Error('Invalid effect attack');
  if (machines) machines.materialEffects = this;
 }
 _voxel(voxelId) {
  if (!this.machines) return null;
  for (const machine of this.machines.machines.values()) { const voxel = machine.voxels.find(v => v.id === voxelId); if (voxel) return { machine, voxel }; }
  return null;
 }
 _request(claimId, signature) {
  if (!claimOK(claimId)) return fail('claim_required');
  const old = this.requests[claimId];
  return old ? (old.signature === signature ? ok({ duplicate: true, ...clone(old.result) }) : fail('request_conflict')) : null;
 }
 _ready(kind) {
  return kind === 'magic' ? this.progression.research.has('mana') && this.progression.hasComponent('property_imprinter') : this.progression.research.has('consecration') && this.progression._station('consecration_table');
 }
 queueImprint(machineId, voxelId, property, { claimId } = {}) { return this._queue('magic', machineId, voxelId, property, claimId); }
 queueConsecrate(machineId, voxelId, property, { claimId } = {}) { return this._queue('divine', machineId, voxelId, property, claimId); }
 _queue(kind, machineId, voxelId, property, claimId) {
  const signature = JSON.stringify([kind, voxelId, property]), retry = this._request(claimId, signature); if (retry) return retry;
  const rule = MATERIAL_EFFECT_RULES[property], target = this._voxel(voxelId);
  if (!target || target.machine.id !== machineId || rule?.kind !== kind) return fail('invalid_effect_target');
  const localComponent = target.machine.components.find(c => c.componentId === (kind === 'magic' ? 'property_imprinter' : 'relic') && this.machines._condition(target.machine,c) > 0);
  if (!localComponent && !this._ready(kind)) return fail('effect_facility_required');
  if (!this.progression.research.has(kind === 'magic' ? 'mana' : 'consecration')) return fail('effect_research_required');
  if (target.voxel.materialEffects?.includes(property) || this.jobs.some(j => j.voxelId === voxelId && j.property === property)) return fail('property_already_applied');
  if (this.jobs.length >= 64) return fail('effects_busy');
  const profile = this.profile(target.voxel);
  if (kind === 'divine' && !(profile[property] > 0)) return fail('existing_property_required');
  const energyEU = Math.max(1, target.voxel.volumeLiters) * rule.energyPerLiter;
  // Reserve once; work pauses if the required apparatus becomes unavailable.
  if (!localComponent) { const paid = this.progression.consumeEnergy(kind, energyEU, { claimId: `material-effect:${claimId}` });
   if (!paid.ok) return paid; if (paid.duplicate) return fail('energy_receipt_already_used'); }
  const rate = kind === 'magic' ? this.progression.catalog.get('property_imprinter').nominalPower : 5;
  const job = { claimId, voxelId, property, kind, energyEU, progress: 0, seconds: energyEU / rate, sourceComponentId: localComponent?.id || null, receivedEU: localComponent ? 0 : energyEU };
  this.jobs.push(job); const result = { jobId: claimId, energyEU, seconds: job.seconds, sourceComponentId: job.sourceComponentId };
  this.requests[claimId] = { signature, result }; return ok(result);
 }
 acceptMachineEnergy(machineId, componentId, available, dt) {
  const job = this.jobs.find(j => j.sourceComponentId === componentId), machine = this.machines?.machines.get(machineId), component = machine?.components.find(c => c.id === componentId);
  if (!job || !component || this._voxel(job.voxelId)?.machine.id !== machineId || !finite(dt) || dt <= 0) return {};
  const definition = this.progression.catalog.get(component.componentId), health = this.machines._condition(machine,component);
  const amount = Math.max(0, Math.min(available[job.kind] || 0, job.energyEU - job.receivedEU, definition.nominalPower * health * dt));
  if (!amount) return {};
  job.receivedEU += amount; job.progress = job.seconds * job.receivedEU / job.energyEU;
  if (job.receivedEU + 1e-8 >= job.energyEU) this._finish(job);
  return { [job.kind]: amount };
 }
 _finish(job) {
  const target = this._voxel(job.voxelId);
  if (target) { target.voxel.materialEffects ||= []; if (!target.voxel.materialEffects.includes(job.property)) target.voxel.materialEffects.push(job.property); target.voxel.maxHp = this.profile(target.voxel).maxHp; }
  this.jobs = this.jobs.filter(j => j !== job);
 }
 profile(voxel) {
  const base = this.progression.evaluateMaterial(voxel.materialId, { volumeLiters: voxel.volumeLiters });
  const profile = { ...base, thermalDamageMultiplier: 1, chemicalDamageMultiplier: 1, mechanicalDamageMultiplier: 1, magicAttributes: [], functionsGranted: [] };
  for (const property of voxel.materialEffects || []) {
   const rule = MATERIAL_EFFECT_RULES[property]; if (!rule) continue;
   if (rule.kind === 'divine') profile[property] *= rule.multiplier;
   if (property === 'thermal_shield') profile.thermalDamageMultiplier *= rule.damageMultiplier;
   if (property === 'acid_shield') profile.chemicalDamageMultiplier *= rule.damageMultiplier;
   if (rule.attribute) profile.magicAttributes.push(rule.attribute);
  }
  profile.acidResistance = clamp(profile.acidResistance, 0, .95);
  // Stronger existing heat tolerance reduces exposure proportionately; no new immunity.
  profile.thermalDamageMultiplier *= Math.min(1, base.heatLimitC / profile.heatLimitC);
  profile.mechanicalDamageMultiplier *= Math.min(1, base.loadKn / profile.loadKn);
  profile.chemicalDamageMultiplier *= 1 - profile.acidResistance;
  profile.hp = Math.min(voxel.hp, profile.maxHp); return profile;
 }
 resolveDamage(voxel, amount, energyType = 'mechanical') {
  if (!finite(amount) || !ENERGY_TYPES.includes(energyType)) return fail('invalid_material_damage');
  const profile = this.profile(voxel), multiplier = energyType === 'thermal' ? profile.thermalDamageMultiplier : energyType === 'chemical' ? profile.chemicalDamageMultiplier : energyType === 'mechanical' ? profile.mechanicalDamageMultiplier : 1;
  return ok({ amount: amount * multiplier, absorbed: amount * (1 - multiplier), profile });
 }
 loadThermalFuel(count = 1, { claimId } = {}) {
  const signature = JSON.stringify(['thermal_fuel', count]), retry = this._request(claimId, signature); if (retry) return retry;
  if (!Number.isInteger(count) || count < 1 || this.thermal.fuelEU + count * 400 > 4000) return fail('invalid_thermal_fuel');
  const paid = this.progression.spend({ raw_timber: count }, { claimId: `effect-fuel:${claimId}` });
  if (!paid.ok) return paid; if (paid.duplicate) return fail('fuel_receipt_already_used');
  this.thermal.fuelEU += count * 400; const result = { fuelEU: count * 400 };
  this.requests[claimId] = { signature, result }; return ok(result);
 }
 attack({ targetId, energyType, energyEU, magicAttribute = null, sourceVoxelId = null, claimId } = {}, applyDamage) {
  const signature = JSON.stringify(['attack', targetId, energyType, energyEU, magicAttribute, sourceVoxelId]), retry = this._request(claimId, signature); if (retry) return retry;
  if (!claimOK(targetId) || !ENERGY_TYPES.includes(energyType) || !finite(energyEU) || energyEU <= 0 || energyEU > 100 || typeof applyDamage !== 'function') return fail('invalid_energy_attack');
  if (magicAttribute && (energyType !== 'magic' || !['water','wind'].includes(magicAttribute))) return fail('invalid_magic_attribute');
  if (energyType === 'magic' && !this.progression.research.has('mana')) return fail('mana_research_required');
  if (magicAttribute && sourceVoxelId) { const source = this._voxel(sourceVoxelId); if (!source || !this.profile(source.voxel).magicAttributes.includes(magicAttribute)) return fail('affinity_required'); }
  if (energyType === 'thermal') { if (this.thermal.storedEU + 1e-8 < energyEU) return fail('thermal_heat_required'); this.thermal.storedEU -= energyEU; this.thermal.consumedEU += energyEU; }
  else { const paid = this.progression.consumeEnergy(energyType, energyEU, { claimId: `energy-attack:${claimId}` }); if (!paid.ok) return paid; if (paid.duplicate) return fail('energy_receipt_already_used'); }
  const packet = { claimId, targetId, energyType, energyEU, amount: energyEU * ENERGY_INTERACTIONS[energyType].damagePerEU, damageType: magicAttribute || ENERGY_INTERACTIONS[energyType].damageType, magicAttribute, delivered: true };
  // Commit the cast before invoking world damage. Retries never repeat a hit or refund
  // a paid miss; the world resolves target existence/range before calling this method.
  this.attacks[claimId] = clone(packet); this.requests[claimId] = { signature, result: { packet: clone(packet) } };
  const result = applyDamage(clone(packet)); return ok({ packet, result });
 }
 tick(dt) {
  if (!finite(dt) || dt > 60) return fail('invalid_dt'); this.clock += dt;
  const burn = Math.min(this.thermal.fuelEU, 20 * dt, 100 - this.thermal.storedEU);
  this.thermal.fuelEU -= burn; this.thermal.storedEU += burn; this.thermal.generatedEU += burn;
  // One apparatus works on one job; a huge dt never grants simultaneous free work.
  let remaining = dt;
  while (remaining > 1e-9 && this.jobs.length) {
   const job = this.jobs.find(j => !j.sourceComponentId); if (!job) break; const target = this._voxel(job.voxelId);
   if (!target) { this.jobs = this.jobs.filter(j => j !== job); continue; } // destroyed paid work is lost, never duplicated
   if (!this._ready(job.kind)) break;
   const workRate = job.kind === 'magic' ? this.progression.assemblies.filter(a => a.componentId === 'property_imprinter' && a.accessible !== false).reduce((sum,a) => sum + a.scale * Math.min(a.health,a.connected),0) : 1;
   if (workRate <= 0) break;
   const step = Math.min(remaining, (job.seconds - job.progress) / workRate); job.progress += step * workRate; remaining -= step;
   if (job.progress + 1e-8 < job.seconds) break;
   // More maximum durability is not healing. Repair must pay actual material.
   this._finish(job);
  }
  return ok();
 }
 cancelJob(claimId) { const before = this.jobs.length; this.jobs = this.jobs.filter(j => j.claimId !== claimId); return before === this.jobs.length ? fail('unknown_effect_job') : ok({ refundedEU: 0 }); }
 status() { return { jobs: clone(this.jobs), thermal: clone(this.thermal), rules: clone(MATERIAL_EFFECT_RULES), interactions: clone(ENERGY_INTERACTIONS) }; }
 serialize() { return { schemaVersion: 1, clock: this.clock, jobs: clone(this.jobs), requests: clone(this.requests), attacks: clone(this.attacks), thermal: clone(this.thermal) }; }
}
export default MaterialEffects;

/** Instant exposure response for existing whole-HP fixtures and building cells.
 * A 180 C reference is a first balance proposal, not a temperature simulation.
 * Cosmetic model paint never supplies an equipment's material resistance.
 */
export function resolveSurfaceDamage(profile,amount,energyType='mechanical'){
 if(!finite(amount)||!ENERGY_TYPES.includes(energyType))return fail('invalid_material_damage');
 const acid=Number.isFinite(profile?.acidResistance)?clamp(profile.acidResistance,0,.95):0;
 const heat=profile?.heatLimitC??profile?.heatToleranceC;
 const multiplier=energyType==='chemical'?1-acid:energyType==='thermal'&&Number.isFinite(heat)&&heat>0?Math.min(1,180/heat):1;
 return ok({amount:amount*multiplier,absorbed:amount*(1-multiplier),energyType});
}

export function equipmentExposureProfile(content,assetId){
 const entries=new Map(content.progression.entries.map(e=>[e.id,e]));
 let mass=0,acid=0,thermalResponse=0;
 function add(id,n,path=new Set()){
  if(path.has(id))throw Error('Cyclic equipment material recipe');
  const e=entries.get(id);if(!e||!(n>0))return;
  const block=content.blocks.entries.find(b=>b.rawResourceId===id);
  const p=e.properties??block;
  if(p){const kg=n*(e.properties?.densityKgM3/1000||e.massKgPerUnit||1);mass+=kg;acid+=kg*(p.acidResistance??0);thermalResponse+=kg*resolveSurfaceDamage(p,1,'thermal').amount;return;}
  const recipe=entries.get(e.origin?.recipe);
  if(recipe){const next=new Set(path);next.add(id);const units=recipe.outputs[id]??1;for(const [input,count]of Object.entries(recipe.inputs))add(input,n*count/units,next);}
  else{const kg=n*(e.massKgPerUnit||1);mass+=kg;thermalResponse+=kg;}
 }
 add(assetId,1);
 return {acidResistance:mass?acid/mass:0,heatLimitC:mass&&thermalResponse?180*mass/thermalResponse:180};
}
