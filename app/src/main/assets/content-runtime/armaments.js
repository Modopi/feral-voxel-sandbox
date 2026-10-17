// Parameterized personal weapons are separate saved records. They never enter
// Progression.inventory, whose keys remain catalog item IDs.
const EPS = 1e-8;
const clone = value => structuredClone(value);
const finite = n => Number.isFinite(n) && n >= 0 && n <= 1e12;
const fail = reason => ({ ok: false, reason });
const success = extra => ({ ok: true, ...extra });

export const ARMAMENT_PATTERNS = Object.freeze(['weapon_slash', 'weapon_pierce', 'weapon_blunt']);
export const ARMAMENT_LIMITS = Object.freeze({ carried: 8, equipped: 1, maxOwned: 9, activeCrafts: 1 });

const MATERIAL_LABEL = Object.freeze({ slash: '베기 무기', pierce: '관통 무기', blunt: '둔기' });

/**
 * Owns crafted personal weapons, a one-item hand slot, and an eight-item rack.
 * Craft costs are atomically reserved from Progression; finished weapons live
 * only in this module and are serialized with their material/durability.
 */
export class Armaments {
  constructor(progression, state = {}) {
    this.progression = progression;
    this.catalog = progression.catalog;
    this.weapons = [];
    this.equippedId = null;
    this.jobs = [];
    this.attackClaims = [];
    this.attackClaimIndex = new Map();
    this.nextId = state.nextId ?? 1;
    this.clock = state.clock ?? 0;
    if (state.schemaVersion != null && state.schemaVersion !== 1) throw Error('Unsupported armaments save');
    if (!Number.isSafeInteger(this.nextId) || this.nextId < 1 || !finite(this.clock)) throw Error('Invalid armaments counters');
    if (!Array.isArray(state.weapons ?? []) || (state.weapons ?? []).length > ARMAMENT_LIMITS.maxOwned) throw Error('Invalid armament records');
    this.weapons = clone(state.weapons ?? []);
    this.equippedId = state.equippedId ?? null;
    this.jobs = clone(state.jobs ?? []);
    this.attackClaims = clone(state.attackClaims ?? []);
    this._validateState();
    this.attackClaimIndex = new Map(this.attackClaims.map(row => [row.claimId, row]));
    this._raiseSequenceFromRecords();
  }

  patterns() {
    return ARMAMENT_PATTERNS.map(id => this.catalog.get(id)).filter(row => row?.kind === 'weapon_pattern').map(clone);
  }

  _material(id) {
    const material = this.catalog.get(id);
    return material?.kind === 'material' ? material : null;
  }

  _pattern(id) {
    const pattern = this.catalog.get(id);
    return pattern?.kind === 'weapon_pattern' && ARMAMENT_PATTERNS.includes(id) ? pattern : null;
  }

  _materialRecipe(material) {
    const recipeId = material?.origin?.recipe;
    const recipe = recipeId && this.catalog.get(recipeId);
    return recipe?.kind === 'recipe' ? recipe : null;
  }

  _baseline(tier) {
    return this.catalog.get(`gear_baseline_t${tier}`);
  }

  _inputs(pattern, material) {
    const inputs = { [material.id]: pattern.materialVolumeLiters };
    for (const [id, amount] of Object.entries(pattern.additionalInputs ?? {})) inputs[id] = (inputs[id] ?? 0) + amount;
    return inputs;
  }

  _energy(pattern, recipe) {
    return Object.fromEntries(Object.entries(recipe.energy ?? {}).map(([type, amount]) => [type, amount * pattern.materialRecipeEnergyFraction]));
  }

  _stats(pattern, material) {
    const baseline = this._baseline(material.tier);
    if (!baseline || !finite(material.properties?.cellHp) || !finite(material.properties?.densityKgM3)) return null;
    const hitDamage = baseline.stationaryDps * pattern.attackPeriodS * pattern.damageFactor;
    const maxDurability = Math.max(1, Math.floor(material.properties.cellHp * pattern.materialVolumeLiters * pattern.durabilityPerCellHpLiter));
    const massKg = this._itemMass(material.id) * pattern.materialVolumeLiters +
      Object.entries(pattern.additionalInputs ?? {}).reduce((sum, [id, amount]) => sum + this._itemMass(id) * amount, 0);
    if (![hitDamage, maxDurability, massKg].every(Number.isFinite) || hitDamage <= 0 || maxDurability <= 0 || massKg <= 0) return null;
    return { hitDamage, maxDurability, massKg };
  }

  _near(actual, expected) {
    return Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8;
  }

  _itemMass(id) {
    const entry = this.catalog.get(id);
    return entry?.properties?.densityKgM3 / 1000 || entry?.massKgPerUnit || 0;
  }

  _name(pattern, material) {
    return `${material.name} ${MATERIAL_LABEL[pattern.weaponKind] ?? '무기'}`;
  }

  /** Returns a complete quote even while blocked, so the UI can show the gate and stats. */
  quote(patternId, materialId) {
    const pattern = this._pattern(patternId), material = this._material(materialId);
    if (!pattern || !material) return fail('unknown_armament');
    const recipe = this._materialRecipe(material), stats = this._stats(pattern, material);
    if (!recipe || !stats) return fail('unsupported_material');
    const inputs = this._inputs(pattern, material), energy = this._energy(pattern, recipe);
    const seconds = Math.max(pattern.baseCraftSeconds, recipe.seconds * pattern.materialRecipeTimeFraction);
    const research = recipe.research ?? null, station = recipe.station ?? null;
    let reason = null;
    if (pattern.materialResearchRequired && research && !this.progression.research.has(research)) reason = 'research_required';
    else if (pattern.materialRecipeStationRequired && station && !this.progression._station(station)) reason = 'station_required';
    else if (!this.progression.hasItems(inputs)) reason = 'ingredients_required';
    else if (Object.entries(energy).some(([type, amount]) => this.progression.energyAvailable(type) + EPS < amount)) reason = 'insufficient_resources';
    else if (this.weapons.length >= this._ownedLimit()) reason = 'rack_full';
    else if (this.jobs.length) reason = 'workbench_busy';
    return {
      ok: !reason,
      ...(reason ? { reason } : {}),
      id: pattern.id,
      patternId: pattern.id,
      kind: pattern.weaponKind,
      weaponKind: pattern.weaponKind,
      shapeId: pattern.shapeId,
      name: this._name(pattern, material),
      materialId: material.id,
      materialTier: material.tier,
      materialVolumeLiters: pattern.materialVolumeLiters,
      massKg: stats.massKg,
      maxDurability: stats.maxDurability,
      hitDamage: stats.hitDamage,
      range: pattern.rangeM,
      attackPeriod: pattern.attackPeriodS,
      attackMode: pattern.attackMode,
      station,
      research,
      originRecipeId: recipe.id,
      inputs,
      energy,
      seconds,
    };
  }

  craft(patternId, materialId) {
    const quote = this.quote(patternId, materialId);
    if (!quote.ok) return fail(quote.reason);
    const localId = this.nextId;
    const outputId = `armament:${localId}`;
    const jobId = `armament-job:${localId}`;
    const claimId = `armament-craft:${outputId}`;
    const paid = this.progression.transaction({ items: quote.inputs, energy: quote.energy }, { claimId });
    if (!paid.ok) return paid;
    if (paid.duplicate) return success({ duplicate: true, jobId, outputId });
    this.nextId++;
    this.jobs.push({
      id: jobId,
      outputId,
      patternId: quote.patternId,
      materialId: quote.materialId,
      materialTier: quote.materialTier,
      station: quote.station,
      research: quote.research,
      originRecipeId: quote.originRecipeId,
      inputs: clone(quote.inputs),
      energy: clone(quote.energy),
      name: quote.name,
      shapeId: quote.shapeId,
      weaponKind: quote.weaponKind,
      materialVolumeLiters: quote.materialVolumeLiters,
      massKg: quote.massKg,
      maxDurability: quote.maxDurability,
      hitDamage: quote.hitDamage,
      range: quote.range,
      attackPeriod: quote.attackPeriod,
      attackMode: quote.attackMode,
      seconds: quote.seconds,
      progress: 0,
      ready: false,
    });
    return success({ jobId, outputId, seconds: quote.seconds, inputs: clone(quote.inputs), energy: clone(quote.energy) });
  }

  _ownedLimit() {
    return this.equippedId ? ARMAMENT_LIMITS.maxOwned : ARMAMENT_LIMITS.carried;
  }

  _createWeapon(job) {
    return {
      id: job.outputId,
      name: job.name,
      weaponKind: job.weaponKind,
      shapeId: job.shapeId,
      materialId: job.materialId,
      materialTier: job.materialTier,
      materialVolumeLiters: job.materialVolumeLiters,
      massKg: job.massKg,
      durability: job.maxDurability,
      maxDurability: job.maxDurability,
      hitDamage: job.hitDamage,
      range: job.range,
      attackPeriod: job.attackPeriod,
      attackMode: job.attackMode,
      nextAttackAt: 0,
      createdAt: this.clock,
    };
  }

  _finishJob(job) {
    if (this.weapons.length >= this._ownedLimit()) { job.progress = job.seconds; job.ready = true; return false; }
    this.weapons.push(this._createWeapon(job));
    this.jobs = this.jobs.filter(candidate => candidate !== job);
    return true;
  }

  tick(dt) {
    if (!Number.isFinite(dt) || dt < 0 || dt > 60) return fail('invalid_dt');
    this.clock += dt;
    const job = this.jobs[0];
    if (!job) return success();
    if (job.ready) { this._finishJob(job); return success({ completed: job.outputId }); }
    const recipe = this.catalog.get(job.originRecipeId);
    const pattern = this._pattern(job.patternId), material = this._material(job.materialId);
    if (!recipe || !pattern || !material || (job.research && !this.progression.research.has(job.research)) || (job.station && !this.progression._station(job.station))) return success({ paused: job.id });
    job.progress = Math.min(job.seconds, job.progress + dt);
    if (job.progress + EPS >= job.seconds) {
      job.progress = job.seconds;
      this._finishJob(job);
      return success({ completed: job.outputId });
    }
    return success({ progress: job.progress, remaining: job.seconds - job.progress });
  }

  equip(id = null) {
    if (id !== null && typeof id !== 'string') return fail('unknown_weapon');
    if (id === this.equippedId) return success({ equippedId: this.equippedId, duplicate: true });
    if (id === null) {
      if (!this.equippedId) return success({ equippedId: null, duplicate: true });
      const carried = this.weapons.length - 1;
      if (carried >= ARMAMENT_LIMITS.carried) return fail('rack_full');
      this.equippedId = null;
      return success({ equippedId: null });
    }
    if (!this.weapons.some(weapon => weapon.id === id)) return fail('unknown_weapon');
    this.equippedId = id;
    return success({ equippedId: id });
  }

  loadout() {
    const weapon = this.weapons.find(record => record.id === this.equippedId);
    if (!weapon) return null;
    return {
      id: weapon.id,
      name: weapon.name,
      weaponId: weapon.id,
      weaponKind: weapon.weaponKind,
      shapeId: weapon.shapeId,
      materialId: weapon.materialId,
      materialTier: weapon.materialTier,
      massKg: weapon.massKg,
      durability: weapon.durability,
      currentDurability: weapon.durability,
      maxDurability: weapon.maxDurability,
      hitDamage: weapon.hitDamage,
      range: weapon.range,
      attackPeriod: weapon.attackPeriod,
      attackMode: weapon.attackMode,
    };
  }

  equippedAsset() {
    const weapon = this.weapons.find(record => record.id === this.equippedId);
    return weapon ? { id: weapon.id, shapeId: weapon.shapeId, slot: 'main_hand', materialId: weapon.materialId } : null;
  }

  recordAttack({ distanceM, at = this.clock, claimId } = {}) {
    if (claimId != null) {
      if (typeof claimId !== 'string' || claimId.length < 1 || claimId.length > 512) return fail('invalid_claim');
      const previous = this.attackClaimIndex.get(claimId);
      if (previous) {
        const signature = `${previous.weaponId}:${distanceM}`;
        if (previous.signature !== signature) return fail('claim_conflict');
        return success({ duplicate: true, ...clone(previous.result) });
      }
    }
    const weapon = this.weapons.find(record => record.id === this.equippedId);
    if (!weapon) return fail('weapon_not_equipped');
    if (!finite(distanceM) || distanceM > weapon.range + EPS) return fail('out_of_range');
    if (!finite(at)) return fail('invalid_attack_time');
    if (weapon.durability <= 0) return fail('weapon_broken');
    if (at + EPS < weapon.nextAttackAt) return fail('attack_cooldown');
    weapon.durability = Math.max(0, weapon.durability - 1);
    weapon.nextAttackAt = at + weapon.attackPeriod;
    const result = {
      id: weapon.id,
      name: weapon.name,
      hitDamage: weapon.hitDamage,
      range: weapon.range,
      attackPeriod: weapon.attackPeriod,
      attackMode: weapon.attackMode,
      durability: weapon.durability,
      currentDurability: weapon.durability,
      maxDurability: weapon.maxDurability,
    };
    if (claimId) {
      const receipt = { claimId, weaponId: weapon.id, signature: `${weapon.id}:${distanceM}`, result: clone(result) };
      this.attackClaims.push(receipt);
      this.attackClaimIndex.set(claimId, receipt);
    }
    return success(result);
  }

  drainCarried() {
    const records = clone(this.weapons);
    this.weapons = [];
    this.equippedId = null;
    return records;
  }

  recoverCarried(records) {
    const acceptedIds = [], remaining = [];
    if (!Array.isArray(records)) return { acceptedIds, remaining: [] };
    for (const candidate of records) {
      if (!this._validWeapon(candidate)) { remaining.push(candidate); continue; }
      if (this.weapons.some(weapon => weapon.id === candidate.id)) { acceptedIds.push(candidate.id); continue; }
      if (this.weapons.length >= this._ownedLimit()) { remaining.push(clone(candidate)); continue; }
      this.weapons.push(clone(candidate));
      acceptedIds.push(candidate.id);
      const serial = /^armament:(\d+)$/.exec(candidate.id);
      if (serial) this.nextId = Math.max(this.nextId, Number(serial[1]) + 1);
    }
    return { acceptedIds, remaining };
  }

  _validWeapon(record) {
    if (!record || typeof record !== 'object' || !/^armament:\d+$/.test(record.id) || typeof record.name !== 'string' || !record.name.length || record.name.length > 120) return false;
    const pattern = this._pattern(record.shapeId), material = this._material(record.materialId), stats = pattern && material ? this._stats(pattern, material) : null;
    return !!pattern && !!material && !!stats && record.weaponKind === pattern.weaponKind && record.materialTier === material.tier &&
      record.shapeId === pattern.shapeId && finite(record.massKg) && record.massKg > 0 &&
      Number.isInteger(record.maxDurability) && record.maxDurability > 0 && Number.isInteger(record.durability) &&
      record.durability >= 0 && record.durability <= record.maxDurability && Number.isFinite(record.hitDamage) && record.hitDamage > 0 &&
      Number.isFinite(record.range) && record.range === pattern.rangeM && Number.isFinite(record.attackPeriod) && record.attackPeriod === pattern.attackPeriodS &&
      record.attackMode === pattern.attackMode && finite(record.nextAttackAt ?? 0) && finite(record.createdAt ?? 0) &&
      Number.isFinite(record.materialVolumeLiters) && record.materialVolumeLiters === pattern.materialVolumeLiters &&
      this._near(record.massKg, stats.massKg) && record.maxDurability === stats.maxDurability && this._near(record.hitDamage, stats.hitDamage);
  }

  _validJob(job) {
    const pattern = this._pattern(job?.patternId), material = this._material(job?.materialId), recipe = material && this._materialRecipe(material);
    const quote = pattern && material && recipe ? this.quote(pattern.id, material.id) : null;
    if (!quote || typeof job?.outputId !== 'string' || !/^armament:\d+$/.test(job.outputId)) return false;
    const serial = job.outputId.split(':')[1];
    return typeof job.id === 'string' && job.id === `armament-job:${serial}` && job.station === recipe.station && job.research === (recipe.research ?? null) &&
      job.originRecipeId === recipe.id && this.progression._quantities(job.inputs) && this.progression._energyMap(job.energy) &&
      Number.isFinite(job.seconds) && job.seconds > 0 && Number.isFinite(job.progress) && job.progress >= 0 && job.progress <= job.seconds &&
      typeof job.ready === 'boolean' && job.name === quote.name && job.shapeId === pattern.shapeId && job.weaponKind === pattern.weaponKind &&
      job.materialTier === material.tier && job.massKg === quote.massKg && job.maxDurability === quote.maxDurability &&
      job.hitDamage === quote.hitDamage && job.range === quote.range && job.attackPeriod === quote.attackPeriod && job.attackMode === quote.attackMode &&
      job.seconds === quote.seconds && JSON.stringify(job.inputs) === JSON.stringify(quote.inputs) && JSON.stringify(job.energy) === JSON.stringify(quote.energy) &&
      this.progression.claims.has(`armament-craft:${job.outputId}`);
  }

  _validateState() {
    if (!Array.isArray(this.jobs) || this.jobs.length > ARMAMENT_LIMITS.activeCrafts || !Array.isArray(this.attackClaims)) throw Error('Invalid armaments state');
    const ids = new Set();
    for (const weapon of this.weapons) {
      if (!this._validWeapon(weapon) || ids.has(weapon.id)) throw Error('Invalid saved armament');
      ids.add(weapon.id);
    }
    if (this.equippedId != null && !ids.has(this.equippedId)) throw Error('Invalid equipped armament');
    if (this.weapons.length > this._ownedLimit()) throw Error('Armament rack capacity exceeded');
    if (!this.jobs.every(job => this._validJob(job)) || this.jobs.some(job => ids.has(job.outputId))) throw Error('Invalid armament job');
    const claims = new Set();
    for (const row of this.attackClaims) {
      if (!row || typeof row.claimId !== 'string' || !row.claimId.length || row.claimId.length > 512 || claims.has(row.claimId) ||
          !row.result || typeof row.weaponId !== 'string' || !/^armament:\d+$/.test(row.weaponId) || row.result.id !== row.weaponId ||
          typeof row.signature !== 'string' || row.signature !== `${row.weaponId}:${Number(row.signature.split(':').at(-1))}`) throw Error('Invalid armament attack ledger');
      claims.add(row.claimId);
    }
  }

  _raiseSequenceFromRecords() {
    for (const record of this.weapons) {
      const serial = /^armament:(\d+)$/.exec(record.id);
      if (serial) this.nextId = Math.max(this.nextId, Number(serial[1]) + 1);
    }
    for (const job of this.jobs) {
      const serial = /^armament:(\d+)$/.exec(job.outputId);
      if (serial) this.nextId = Math.max(this.nextId, Number(serial[1]) + 1);
    }
  }

  serialize() {
    return {
      schemaVersion: 1,
      nextId: this.nextId,
      clock: this.clock,
      weapons: clone(this.weapons),
      equippedId: this.equippedId,
      jobs: clone(this.jobs),
      attackClaims: clone(this.attackClaims),
    };
  }
}

export default Armaments;
