// Deterministic boss simulation. No renderer, DOM, wall clock, or global RNG.
// World effects returned here must also be used by the movement/render bridge.
const clone = (v) => JSON.parse(JSON.stringify(v));
const finite = (n, label, min = 0) => {
  if (!Number.isFinite(n) || n < min) throw new TypeError(`${label} must be finite and >= ${min}`);
  return n;
};
const position = (p) => {
  const v = Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p?.x, y: p?.y ?? 0, z: p?.z };
  for (const n of Object.values(v)) if (!Number.isFinite(n)) throw new TypeError('Invalid position');
  return v;
};
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (v, n) => ({ x: v.x * n || 0, y: v.y * n || 0, z: v.z * n || 0 });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (v) => Math.hypot(v.x, v.y, v.z);
const distance = (a, b) => length(sub(a, b));
const normalize = (v) => length(v) > 1e-9 ? mul(v, 1 / length(v)) : { x: 0, y: 0, z: 1 };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const targetPosition = (t) => position(t.position ?? t);
const targetCenter = (t) => add(targetPosition(t), { x: 0, y: (t.height ?? 1.8) / 2, z: 0 });
const keyOf = (t) => String(t.ownerId ?? t.id);
const isFlyingTarget = (t) => Boolean(t.flying) || targetPosition(t).y > 2;
const BODY_PARTS = new Set(['body', 'core', 'locomotion']);

// Exact slab test for a world-aligned solid box; used for authored growth cover.
function segmentBox(from, to, box) {
  const d = sub(to, from); let low = 0, high = 1;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(d[axis]) < 1e-10) {
      if (from[axis] < box.min[axis] || from[axis] > box.max[axis]) return false;
    } else {
      let a = (box.min[axis] - from[axis]) / d[axis], b = (box.max[axis] - from[axis]) / d[axis];
      if (a > b) [a, b] = [b, a];
      low = Math.max(low, a); high = Math.min(high, b);
      if (low > high) return false;
    }
  }
  return high > 1e-5 && low < .99999;
}

/** Shared render/hit shape. target position is feet, radius/height a capsule.
 * Machines can supply hitboxes [{center:[x,y,z],size:[w,h,d]}] in WORLD space.
 * Each actual box is tested; the enclosing machine AABB is never substituted.
 */
export function bossShapeHits(shape, target) {
  if (typeof target.intersectsShape === 'function') return target.intersectsShape(shape);
  if (Array.isArray(target.hitboxes)) return target.hitboxes.some((b) => shapeHitsBox(shape, b));
  const feet = targetPosition(target), radius = target.radius ?? .35, height = target.height ?? 1.8;
  const c = { x: feet.x, y: feet.y + height / 2, z: feet.z };
  if (shape.kind === 'sphere') {
    const closest = { x: feet.x, y: clamp(shape.center.y, feet.y + radius, feet.y + Math.max(radius, height - radius)), z: feet.z };
    return distance(shape.center, closest) <= shape.radiusM + radius;
  }
  if (shape.kind === 'cylinder' || shape.kind === 'annular_cylinder') {
    if (feet.y > shape.bottomY + shape.heightM || feet.y + height < shape.bottomY) return false;
    const r = Math.hypot(feet.x - shape.center.x, feet.z - shape.center.z);
    return r - radius <= (shape.outerRadiusM ?? shape.radiusM) && r + radius >= (shape.innerRadiusM ?? 0);
  }
  const local = sub(c, shape.center), extent = Math.max(0, height / 2 - radius);
  return shape.axes.every((axis, i) => Math.abs(dot(local, axis)) <= shape.halfSize[i] + radius + Math.abs(axis.y) * extent);
}
function shapeHitsBox(s, b) {
  const c = position(b.center), h = b.size.map((x) => x / 2), d = sub(c, s.center);
  if (s.kind === 'sphere') return Math.hypot(Math.max(0, Math.abs(d.x) - h[0]), Math.max(0, Math.abs(d.y) - h[1]), Math.max(0, Math.abs(d.z) - h[2])) <= s.radiusM;
  if (s.kind === 'cylinder' || s.kind === 'annular_cylinder') {
    if (c.y - h[1] > s.bottomY + s.heightM || c.y + h[1] < s.bottomY) return false;
    const nearest = Math.hypot(Math.max(0, Math.abs(d.x) - h[0]), Math.max(0, Math.abs(d.z) - h[2]));
    const farthest = Math.hypot(Math.abs(d.x) + h[0], Math.abs(d.z) + h[2]);
    return nearest <= (s.outerRadiusM ?? s.radiusM) && farthest >= (s.innerRadiusM ?? 0);
  }
  // SAT: OBB against axis-aligned authored voxel box, including cross axes.
  const world = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  const axes = [...s.axes, ...world, ...s.axes.flatMap((a) => world.map((w) => cross(a, w)))];
  return axes.every((axis) => length(axis) < 1e-9 || Math.abs(dot(d, axis)) <=
    s.axes.reduce((sum, a, i) => sum + Math.abs(dot(a, axis)) * s.halfSize[i], 0) +
    Math.abs(axis.x) * h[0] + Math.abs(axis.y) * h[1] + Math.abs(axis.z) * h[2] + 1e-8);
}

function resolveVariant(base, variant) {
  const def=clone(base); def.contentVariantId=variant.id;def.baselineTier=variant.tier;def.baselineRef=variant.baselineRef;
  def.name=variant.name;def.stats.maxHp=finite(variant.stats.maxHp,'variant HP',1);def.balanceTarget={...def.balanceTarget,...clone(variant.balanceTarget)};
  for(const p of def.parts)p.breakThresholdHp=finite(variant.partThresholds[p.id],'variant part threshold');
  def.lifeRecovery.repairHp=finite(variant.repairHp,'variant repair HP');def.arena.gimmickBreakHp=finite(variant.gimmickBreakHp,'variant gimmick HP');
  for(const skill of def.skills){const v=variant.skills[skill.id];if(!v)throw Error('Missing variant skill');
    Object.assign(skill.damage,{neutralTargetHp:v.neutralTargetHp,baselinePlayerHpLost:v.baselinePlayerHpLost,baselineHpFraction:v.baselineHpFraction});
    skill.energyCost.amount=finite(v.energyCostEU,'variant cost',1);skill.energyCost.damageYieldHpPerEU=v.neutralTargetHp/v.energyCostEU;
  }
  for(const reserve of def.energyReserves){const v=variant.energyReserves.find(r=>r.energyType===reserve.energyType);if(!v)throw Error('Missing variant reserve');Object.assign(reserve,v);}
  def.variantBehavior=clone(variant.behavior);def.rewardOverride=clone(variant.rewardOverride);return def;
}
const freshVariantState=()=>({sideSign:1,orbitSign:1,repairCursor:0,selectedRepairGimmickId:null,pendingReposition:null,lastRepositionCastId:null,lastCompletedCast:null});
const freezeDeep=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freezeDeep);Object.freeze(value);}return value;};

export class BossSystem {
  constructor(content, state = null) {
    this.content = content;
    this.definitions = new Map((content.bosses?.entries ?? content.entries).map((b) => [b.id, b]));
    this.variants=new Map();this.variantDefinitions=new Map();
    for(const v of content.bosses?.variants ?? content.variants ?? []){
      const base=this.definitions.get(v.baseBossId);
      if(!base||this.variants.has(v.id)||![9,10].includes(v.tier)||v.schemaVersion!==1)throw Error('Invalid boss variant');
      this.variants.set(v.id,v);this.variantDefinitions.set(v.id,freezeDeep(resolveVariant(base,v)));
    }
    this.effectsRevision=0;this.effectsCache=null;this.solidEffectsIndex=null;
    this.entities = new Map(); this.pending = []; this.nextId = 1; this.time = finite(state?.time ?? 0, 'boss clock');
    if (state) {
      if (state.schemaVersion !== 1 || !Array.isArray(state.entities)) throw new Error('Unsupported boss save');
      this.nextId = finite(state.nextId, 'nextId', 1);
      for (const raw of state.entities) {
        const e = clone(raw), def = this.definitionFor(e);
        if (!def || typeof e.id !== 'string' || this.entities.has(e.id)) throw new Error('Invalid saved boss identity');
        if(e.tier!==undefined&&e.encounterTier!==undefined&&e.tier!==e.encounterTier)throw new Error('Invalid saved boss tier');
        e.encounterTier??=e.tier??def.baselineTier;e.tier??=e.encounterTier;
        if(!Number.isInteger(e.encounterTier)||e.encounterTier<1||e.encounterTier>10)throw new Error('Invalid saved boss tier');
        if(e.contentVariantId){const v=this.variants.get(e.contentVariantId);
          if(!v||v.baseBossId!==e.bossId||e.encounterTier!==v.tier||e.tier!==v.tier||e.variantSchemaVersion!==1||e.maxHp!==def.stats.maxHp)throw Error('Invalid saved boss variant');
          if(!e.variantState||![e.variantState.sideSign,e.variantState.orbitSign].every(n=>n===1||n===-1))throw Error('Invalid variant behavior state');
          const vs=e.variantState,gimmickIds=new Set(def.arena.gimmicks.map(g=>g.id)),skillIds=new Set(def.skills.map(s=>s.id));
          if(!Number.isInteger(vs.repairCursor)||vs.repairCursor<0||vs.repairCursor>=def.arena.gimmicks.length)throw Error('Invalid variant repair cursor');
          if(vs.selectedRepairGimmickId!==null&&!gimmickIds.has(vs.selectedRepairGimmickId))throw Error('Invalid selected repair gimmick');
          if(vs.lastRepositionCastId!==null&&typeof vs.lastRepositionCastId!=='string')throw Error('Invalid last reposition cast');
          if(vs.lastCompletedCast&&(!skillIds.has(vs.lastCompletedCast.skillId)||typeof vs.lastCompletedCast.id!=='string'))throw Error('Invalid completed variant cast');
          if(vs.pendingReposition){position(vs.pendingReposition.goal);finite(vs.pendingReposition.remainingS,'reposition timer');
            if(![1,-1].includes(vs.pendingReposition.sign)||vs.pendingReposition.remainingS>def.variantBehavior.maxDurationS+1e-6)throw Error('Invalid pending reposition');
            if(vs.pendingReposition.expectedPosition)position(vs.pendingReposition.expectedPosition);}
        }else if(e.variantState!==null&&e.variantState!==undefined){
          throw Error('Base boss cannot contain variant state');
        }else if(e.encounterTier!==def.baselineTier){
          throw Error('Invalid saved prototype tier');
        }
        position(e.position); position(e.home); position(e.arenaOrigin);
        finite(e.hp, 'hp'); finite(e.maxHp, 'maxHp', 1); if (e.hp > e.maxHp) throw new Error('Invalid saved HP');
        if (!Number.isInteger(e.phaseIndex) || e.phaseIndex < 0 || e.phaseIndex >= def.phases.length) throw new Error('Invalid saved phase');
        for (const energy of Object.values(e.energy)) { finite(energy.amount, 'energy'); finite(energy.charges, 'charges'); }
        for (const v of Object.values(e.shell)) finite(v, 'shell');
        if (e.cast && (!def.skills.some((s) => s.id === e.cast.skillId) || !['windup', 'flight', 'active', 'recovery'].includes(e.cast.stage))) throw new Error('Invalid saved cast');
        if (e.cast && ['windup', 'flight', 'active'].includes(e.cast.stage)) {
          e.cast.stage = 'windup'; e.cast.remaining = e.cast.windupS;
          e.cast.projectilePosition = clone(e.cast.origin);
          // The debit and hit-owner set survive; repeated loads grant no energy
          // and restarting an active cast cannot hit the same owner twice.
        }
        this.entities.set(e.id, e);
      }
    }
  }

  spawn(bossId, pos, options = {}) {
    const def = options.contentVariantId ? this.variantDefinitions.get(options.contentVariantId) : this.definitions.get(bossId);
    if(options.contentVariantId && this.variants.get(options.contentVariantId)?.baseBossId!==bossId)throw Error('Variant does not belong to boss');
    if (!def) throw new Error(`Unknown boss ${bossId}`);
    const tier = options.tier ?? def.baselineTier;
    if (!Number.isInteger(tier) || tier < 1 || tier > 10) throw new Error('Invalid boss tier');
    // Prototype tier is authoritative. Other tiers need reviewed content variants.
    if (tier !== def.baselineTier) throw new Error('Boss tier variant is not authored');
    const id = options.id ?? `boss:${options.instanceId ?? this.nextId++}:${bossId}`;
    if (this.entities.has(id)) {
      const existing=this.entities.get(id);
      if (existing.bossId !== bossId || (existing.contentVariantId??null)!==(options.contentVariantId??null) || existing.encounterTier!==tier) throw new Error('Boss id belongs to another definition');
      return this.entities.get(id);
    }
    const p = position(pos), arenaOrigin = options.arenaOrigin ? position(options.arenaOrigin)
      : sub(p, position(def.arena.bossSpawnM));
    const e = {
      id, bossId, tier, encounterTier:tier, contentVariantId:options.contentVariantId??null, variantSchemaVersion:options.contentVariantId?1:null, variantState:options.contentVariantId?freshVariantState():null, instanceId: String(options.instanceId ?? id), position: p, home: clone(p), arenaOrigin,
      hp: def.stats.maxHp, maxHp: def.stats.maxHp, phaseIndex: 0, phaseId: def.phases[0].id,
      phaseTimer: 0, age: 0, sequenceIndex: 0, completedAttacks: 0, cooldowns: {}, gap: 1,
      facing: { x: 0, y: 0, z: 1 }, engaged: false, disengageS: 0, lastHitAge: -1000,
      parts: Object.fromEntries(def.parts.map((p) => [p.id, { damage: 0, broken: false }])),
      // Optional actual voxel shells are persisted individually. The default
      // exposes three authored body zones until a renderer supplies voxel IDs.
      shell: options.shellVoxels ? Object.fromEntries(options.shellVoxels.map((v) => [v.id, finite(v.capacityEU, 'shell capacity')]))
        : { body: def.stats.maxHp * .35, core: def.stats.maxHp * .06, locomotion: def.stats.maxHp * .09 },
      calories: def.entityType === 'organic' ? def.lifeRecovery.initialCalories : null,
      energy: Object.fromEntries(def.energyReserves.map((r) => [r.energyType, { amount: r.initialEU, charges: r.sourceCharges }])),
      regenActions: 0, regenRestored: 0, repairActions: 0, repairSupplies: def.lifeRecovery.repairSupplies ?? 0,
      lastRepairAge: -1000, action: null, cast: null, castCounter: 0, lastSkill: null, repeatCount: 0,
      exposedUntil: 0, staggerS: 0, threat: [], forcedSkill: null, cancelNext: [],
      gimmicks: Object.fromEntries(def.arena.gimmicks.map((g) => [g.id, { hp: def.arena.gimmickBreakHp, uses: def.arena.gimmickUsesEach, broken: false }])),
      waterDrained: false, airborneS: 0, groundedS: 0, flightState: 'grounded', orbitAngle: 0,
      defeated: false, reward: null,
    };
    this.entities.set(id, e);this.invalidateEffects();
    return e;
  }

  get(id) { return this.entities.get(id); }
  definitionFor(value) {
    const e=typeof value==='string'?this.entities.get(value):value;
    if(!e)return undefined;
    return e.contentVariantId ? this.variantDefinitions.get(e.contentVariantId) : this.definitions.get(e.bossId);
  }
  invalidateEffects(){this.effectsRevision++;this.effectsCache=null;this.solidEffectsIndex=null;}
  phase(e) { return this.definitionFor(e).phases[e.phaseIndex]; }
  emit(type, e, data = {}) { this.invalidateEffects();this.pending.push({ type, bossId: e.id, definitionId: e.bossId, ...data }); }
  serialize() { return { schemaVersion: 1, nextId: this.nextId, time: this.time, entities: clone([...this.entities.values()]) }; }

  coreExposed(e, attackerPosition) {
    const state = this.phase(e).state, exposure = state.coreExposure;
    if (e.parts.core.broken || e.exposedUntil > e.age || exposure.mode === 'always') return true;
    if (exposure.mode === 'grounded') return e.flightState === 'grounded';
    if (exposure.mode === 'rear_or_repair' && e.action?.kind === 'repair') return true;
    if (['rear_arc', 'rear_or_repair'].includes(exposure.mode) && attackerPosition) {
      const dir = normalize(sub(position(attackerPosition), e.position));
      return dot(dir, e.facing) <= -Math.cos(exposure.angleDeg / 2 * Math.PI / 180);
    }
    return false;
  }

  hit(id, attack, partArg) {
    const e = this.get(id); if (!e || e.defeated) return { accepted: false, damage: 0 };
    const a = typeof attack === 'number' ? { amount: attack } : attack;
    const amount = finite(a.amount, 'damage'), energyType = a.energyType ?? a.energy ?? 'mechanical';
    const def = this.definitionFor(e), state = this.phase(e).state;
    if (!(energyType in def.stats.energyDamageMultipliers)) throw new Error('Unknown attack energy');
    let partId = partArg ?? a.partId ?? 'body';
    if (!BODY_PARTS.has(partId)) partId = partId.includes('core') ? 'core' : partId.includes('locomotion') ? 'locomotion' : 'body';
    const exposed = partId === 'core' && this.coreExposed(e, a.attackerPosition);
    const incomingEU = finite(a.energyEU ?? amount, 'incoming energy');
    if (!amount || !incomingEU) return { accepted: true, damage: 0, absorbedEU: 0 };
    const structuralHits = a.structuralHits ?? [{ partId, amount }];
    if (!Array.isArray(structuralHits) || structuralHits.some(h => !Number.isFinite(h.amount) || h.amount < 0 || h.energyEU !== undefined && (!Number.isFinite(h.energyEU) || h.energyEU < 0))
      || structuralHits.reduce((sum,h)=>sum+h.amount,0) > amount + 1e-6
      || structuralHits.reduce((sum,h)=>sum+(h.energyEU ?? 0),0) > incomingEU + 1e-6) throw new RangeError('Structural damage exceeds the single hit budget');
    const shellKey = a.shellVoxelId ?? partId;
    let absorption = exposed || e.parts[partId]?.broken ? 0 : Math.min(incomingEU, e.shell[shellKey] ?? 0);
    // A lowered or flanked shield does not intercept the service aperture.
    if (e.bossId === 'sanctuary_warden' && a.attackerPosition && shellKey === 'body') {
      const front = dot(normalize(sub(position(a.attackerPosition), e.position)), e.facing);
      const covered = (state.shieldFrontCoverageDeg ?? 0) > 0 && front >= Math.cos(state.shieldFrontCoverageDeg / 2 * Math.PI / 180);
      if (!covered) absorption = 0;
    }
    if (shellKey in e.shell) e.shell[shellKey] -= absorption;
    const response = state.bodyReactionOverrides?.[energyType] ?? def.stats.energyDamageMultipliers[energyType];
    const partDef = def.parts.find((p) => p.id === partId);
    const multiplier = Math.max(exposed ? (partDef?.damageMultiplier ?? 1) : 1, e.action?.kind === 'recharge' ? 1.25 : 1);
    const damage = Math.min(e.hp, amount * response * multiplier);
    e.hp -= damage; e.lastHitAge = e.age;
    if (a.attackerId) e.threat.push({ id: String(a.attackerId), amount: damage, age: e.age });
    if (e.action) { this.emit('actionInterrupted', e, { action: e.action.kind }); e.action = null; }
    // Shell damage is an exterior damage ledger, not an invulnerable HP gate.
    // Structural allocations describe where the SAME hit was deposited; they
    // never deduct HP again, and a broken core never forces death.
    for (const h of structuralHits) {
      let targetPart = h.partId ?? partId;
      if (!BODY_PARTS.has(targetPart)) targetPart = targetPart.includes('core') ? 'core' : targetPart.includes('locomotion') ? 'locomotion' : 'body';
      const targetDef = def.parts.find(p => p.id === targetPart), part = e.parts[targetPart];
      if (!targetDef || !part || damage <= 0) continue;
      part.damage += damage * h.amount / amount;
      if (!part.broken && part.damage >= targetDef.breakThresholdHp) {
        part.broken = true; e.staggerS = Math.max(e.staggerS, targetDef.staggerS ?? 0);
        if (e.cast && targetDef.disabledSkillIds?.includes(e.cast.skillId)) e.cast = null;
        this.emit('partBroken', e, { partId: targetPart });
      }
    }
    if (e.hp <= 0) this.defeat(e);
    else this.updatePhase(e);
    this.emit('hit', e, { damage, absorbedEU: absorption, partId, energyType });
    return { accepted: true, damage, absorbedEU: absorption, hp: e.hp, defeated: e.defeated };
  }

  updatePhase(e) {
    const def = this.definitionFor(e);
    let index = e.phaseIndex;
    while (index + 1 < def.phases.length && e.hp / e.maxHp <= def.phases[index].hpFractionLowerExclusive) index++;
    if (index === e.phaseIndex) return;
    e.phaseIndex = index; e.phaseId = def.phases[index].id; e.phaseTimer = def.phases[index].onEnter.durationS;
    e.cast = null; e.action = null; e.sequenceIndex = 0; e.completedAttacks = 0;
    if(e.variantState){e.variantState.pendingReposition=null;e.variantState.lastRepositionCastId=e.variantState.lastCompletedCast?.id??null;}
    e.waterDrained = false;
    this.emit('phase', e, { phaseId: e.phaseId, phaseIndex: index, state: clone(this.phase(e).state) });
  }
  defeat(e) {
    e.hp = 0; e.defeated = true; e.defeatedAt = this.time; e.cast = null; e.action = null; e.engaged = false;
    const def = this.definitionFor(e);
    e.reward = { key: `${e.instanceId}:${e.bossId}:first_defeat`, poolId: def.persistence.rewardRef,
      ...(def.rewardOverride ? { bossChannelOverride: clone(def.rewardOverride) } : {}), claimed: false };
    this.emit('defeat', e, { reward: clone(e.reward) });
  }
  /** grant must use key as its own persistent idempotency key. No async grants. */
  claimReward(id, grant) {
    const e = this.get(id); if (!e?.reward || e.reward.claimed) return false;
    const result = grant(clone(e.reward));
    if (result && typeof result.then === 'function') throw new Error('Reward grant must be synchronous and atomic');
    if (result !== true) return false;
    e.reward.claimed = true; return true;
  }

  /** use requires one second (the bridge supplies progressS); damage is instant. */
  interactGimmick(id, gimmickId, { action = 'use', amount = 0, progressS = 1, actorPosition } = {}) {
    const e = this.get(id), g = e?.gimmicks[gimmickId];
    if (!g || e.defeated || g.broken || g.uses <= 0) return false;
    const def = this.definitionFor(e), gd = def.arena.gimmicks.find((x) => x.id === gimmickId);
    const point = add(e.arenaOrigin, position(gd.positionM));
    if (actorPosition && distance(position(actorPosition), point) > 3) return false;
    if (action === 'damage') { g.hp = Math.max(0, g.hp - finite(amount, 'gimmick damage')); if (g.hp > 0) return true; }
    else if (action !== 'use' || progressS < def.arena.gimmickInteractionS) return false;
    g.uses--; g.broken = action === 'damage';
    const state = this.phase(e).state;
    switch (e.bossId) {
      case 'rootback_beast': e.staggerS = state.foodChargeStaggerS ?? 3; break;
      case 'mine_carapace': e.staggerS = state.chargePillarStaggerS ?? 6; e.exposedUntil = e.age + 6; break;
      case 'sluice_acidworm': e.waterDrained = true; e.cancelNext.push('acid_pool'); if (e.cast?.skillId === 'acid_pool') e.cast = null; break;
      case 'furnace_carapace': e.exposedUntil = e.age + 6; e.cancelNext.push('furnace_ring'); if (e.cast?.skillId === 'furnace_ring') e.cast = null; break;
      case 'spire_glider': e.forcedSkill = 'glider_landing'; break;
      case 'arboretum_symbiote': g.broken = true; break;
      case 'sanctuary_warden': e.repairSupplies = Math.max(0, e.repairSupplies - 1); e.exposedUntil = e.age + 6; if (e.action?.kind === 'repair') e.action = null; break;
      case 'observatory_sentinel': e.repairSupplies = Math.max(0, e.repairSupplies - 1); if (e.action?.kind === 'repair') e.action = null; break;
    }
    this.emit('gimmick', e, { gimmickId, action, state: clone(g), worldEffects: this.worldEffectsFor(e) });
    return true;
  }

  worldEffectsFor(e) {
    if (e.defeated) return [];
    const def = this.definitionFor(e), state = this.phase(e).state, effects = [];
    if (state.northWaterDepthM > 0 && !e.waterDrained) {
      const region = def.arena.phaseWaterRegion;
      effects.push({ type: 'water', bossId: e.id, min: add(e.arenaOrigin, position(region.minM)),
        max: add(e.arenaOrigin, { x: region.maxM[0], y: state.northWaterDepthM, z: region.maxM[2] }),
        speedMultiplier: state.northWaterPlayerSpeedMultiplier ?? 1 });
    }
    if (state.growthNodeOcclusionEnabled) {
      for (const [id, g] of Object.entries(e.gimmicks)) {
        if (g.broken || !g.uses) continue;
        const base = add(e.arenaOrigin, position(def.arena.gimmicks.find((a) => a.id === id).positionM));
        const [w, h, l] = state.growthNodeCoverSizeM;
        effects.push({ type: 'solid', bossId: e.id, gimmickId: id,
          min: add(base, { x: -w / 2, y: 0, z: -l / 2 }), max: add(base, { x: w / 2, y: h, z: l / 2 }) });
      }
    }
    return effects;
  }
  getWorldEffects() {
    if(!this.effectsCache)this.effectsCache=freezeDeep([...this.entities.values()].flatMap(e=>this.worldEffectsFor(e)));
    return this.effectsCache;
  }
  indexSolidEffects() {
    if(this.solidEffectsIndex?.revision===this.effectsRevision)return this.solidEffectsIndex;
    const bucketSize=4,buckets=new Map(),effects=this.getWorldEffects();
    for(const effect of effects){
      if(effect.type!=='solid')continue;
      const min=[effect.min.x,effect.min.y,effect.min.z],max=[effect.max.x,effect.max.y,effect.max.z];
      const low=min.map(n=>Math.floor(n/bucketSize)),high=max.map(n=>Math.floor((n-1e-9)/bucketSize));
      for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++){
        const key=`${x},${y},${z}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(effect);
      }
    }
    this.solidEffectsIndex={revision:this.effectsRevision,bucketSize,buckets};
    return this.solidEffectsIndex;
  }
  isSolidAt(x,y,z){
    if(![x,y,z].every(Number.isFinite))return false;
    const {bucketSize,buckets}=this.indexSolidEffects(),candidates=buckets.get(`${Math.floor(x/bucketSize)},${Math.floor(y/bucketSize)},${Math.floor(z/bucketSize)}`)??[];
    return candidates.some(e=>x>=e.min.x&&x<e.max.x&&y>=e.min.y&&y<e.max.y&&z>=e.min.z&&z<e.max.z);
  }
  targetEffects(target) {
    const p = targetPosition(target); let speedMultiplier = 1;
    for (const e of this.getWorldEffects()) if (e.type === 'water' && ['x', 'y', 'z'].every((k) => p[k] >= e.min[k] && p[k] <= e.max[k])) speedMultiplier = Math.min(speedMultiplier, e.speedMultiplier);
    return { speedMultiplier };
  }

  lineOfSight(from, to, ctx, owners = {}) {
    if (ctx.terrain?.hasAttackLineOfSight && !ctx.terrain.hasAttackLineOfSight(from, to, owners)) return false;
    if (ctx.terrain?.hasLineOfSight && !ctx.terrain.hasLineOfSight(from, to)) return false;
    if (ctx.terrain?.raycast && ctx.terrain.raycast(from, to)) return false;
    return !this.getWorldEffects().some((b) => b.type === 'solid' && segmentBox(from, to, b));
  }
  ground(x, z, e, ctx) { return ctx.terrain?.groundHeight?.(x, z) ?? e.arenaOrigin.y; }
  makeShape(e, skill, target, ctx) {
    const g = clone(skill.geometry), aim = targetPosition(target), origin = add(e.position, { x: 0, y: 1, z: 0 });
    if (g.kind === 'sphere') return { ...g, center: targetCenter(target) };
    if (g.kind === 'cylinder') return { ...g, center: { x: aim.x, y: this.ground(aim.x, aim.z, e, ctx) + g.heightM / 2, z: aim.z }, bottomY: this.ground(aim.x, aim.z, e, ctx) };
    if (g.kind === 'annular_cylinder') return { ...g, center: { x: e.position.x, y: e.arenaOrigin.y + g.heightM / 2, z: e.position.z }, bottomY: e.arenaOrigin.y };
    // Ground-origin biological thrusts stay horizontal. Beams/wind can pitch.
    const airborneAim = ['glider_wind', 'warden_ray', 'sentinel_rail'].includes(skill.id) && isFlyingTarget(target);
    const end = airborneAim ? targetCenter(target) : { x: aim.x, y: origin.y, z: aim.z };
    const forward = normalize(sub(end, origin)), right = normalize(cross({ x: 0, y: 1, z: 0 }, forward)), up = normalize(cross(forward, right));
    let lengthM = g.lengthM;
    if (skill.id === 'symbiote_root' && Object.values(e.gimmicks).some((v) => v.broken)) lengthM *= .8;
    return { ...g, lengthM, center: add(origin, mul(forward, lengthM / 2)), axes: [right, up, forward], halfSize: [g.widthM / 2, g.heightM / 2, lengthM / 2], direction: forward };
  }

  getTelegraphs() {
    return [...this.entities.values()].filter((e) => e.cast && !e.defeated && ['windup', 'flight', 'active'].includes(e.cast.stage))
      .map((e) => ({ bossId: e.id, skillId: e.cast.skillId, stage: e.cast.stage, remainingS: e.cast.remaining,
        shape: clone(e.cast.shape), projectilePosition: e.cast.stage === 'flight' ? clone(e.cast.projectilePosition) : null }));
  }

  selectTarget(e, targets, ctx) {
    e.threat = e.threat.filter((t) => e.age - t.age <= 10);
    const candidates = targets.filter((t) => t.id !== e.id && t.hp !== 0 && distance(e.position, targetPosition(t)) <= 36);
    const score = (t) => e.threat.filter((h) => h.id === String(t.id)).reduce((n, h) => n + h.amount, 0);
    candidates.sort((a, b) => score(b) - score(a) || distance(e.position, targetPosition(a)) - distance(e.position, targetPosition(b)) || String(a.id).localeCompare(String(b.id)));
    return candidates.find((t) => this.lineOfSight(add(e.position, { x: 0, y: 1, z: 0 }), targetCenter(t), ctx, { excludeOwnerId: e.id, targetOwnerId: keyOf(t) }));
  }

  chooseSkill(e, target, ctx) {
    const def = this.definitionFor(e), phase = this.phase(e), core = def.parts.find((p) => p.id === 'core');
    const schedule = e.forcedSkill ? [e.forcedSkill, ...phase.schedule] : phase.schedule;
    const disabled = e.parts.core.broken ? core.disabledSkillIds : [];
    for (let n = 0; n < schedule.length; n++) {
      const index = ((e.forcedSkill ? 0 : e.sequenceIndex) + n) % schedule.length, id = schedule[index], s = def.skills.find((v) => v.id === id);
      if (!s || disabled.includes(id) || (e.cooldowns[id] ?? 0) > 0 || (id === e.lastSkill && e.repeatCount >= 2)) continue;
      if (distance(e.position, targetPosition(target)) > s.rangeM || e.energy[s.energyType].amount < s.energyCost.amount) continue;
      if (id === 'symbiote_root' && Object.values(e.gimmicks).some((v) => v.broken) && distance(e.position, targetPosition(target)) > s.rangeM * .8) continue;
      const shape = this.makeShape(e, s, target, ctx);
      if (s.activeS > 1 && shape.kind === 'cylinder' && Math.abs(shape.center.z - e.arenaOrigin.z) < 3 + shape.radiusM) continue;
      const windupS = s.windupS + (e.parts.core.broken && core.slowedSkillIds.includes(id) ? core.extraWindupS : 0);
      if (ctx.terrain?.safeEscape && !ctx.terrain.safeEscape(shape, target, windupS)) continue;
      if (!this.lineOfSight(add(e.position, { x: 0, y: 1, z: 0 }), targetCenter(target), ctx, { excludeOwnerId: e.id, targetOwnerId: keyOf(target) })) continue;
      e.sequenceIndex = (index + 1) % schedule.length;
      return { s, shape, windupS };
    }
    return null;
  }
  startCast(e, selected, target) {
    const { s, shape, windupS } = selected;
    if (e.cancelNext.includes(s.id)) { e.cancelNext.splice(e.cancelNext.indexOf(s.id), 1); e.gap = this.phase(e).interCastGapS; this.emit('castCancelled', e, { skillId: s.id, reason: 'gimmick' }); return; }
    e.energy[s.energyType].amount -= s.energyCost.amount;
    e.cooldowns[s.id] = s.cooldownS;
    e.repeatCount = e.lastSkill === s.id ? e.repeatCount + 1 : 1; e.lastSkill = s.id;
    if (e.forcedSkill === s.id) e.forcedSkill = null;
    const origin = add(e.position, { x: 0, y: 1, z: 0 });
    const aim = targetCenter(target);
    e.cast = { id: `${e.id}:cast:${++e.castCounter}`, skillId: s.id, stage: 'windup', remaining: windupS, windupS,
      origin, aim, targetOwnerId: keyOf(target), originBody: clone(e.position), shape, projectilePosition: clone(origin), hitOwners: [], spentEU: s.energyCost.amount, remainingEU: s.energyCost.amount, activeElapsed: 0 };
    e.facing = normalize({ x: aim.x - origin.x, y: 0, z: aim.z - origin.z });
    this.emit('cast', e, { skillId: s.id, shape: clone(shape), windupS });
  }

  move(e, destination, speed, dt, ctx) {
    const dir = sub(destination, e.position), delta = Math.min(length(dir), speed * dt);
    if (delta <= 0) return;
    const next = add(e.position, mul(normalize(dir), delta));
    if (ctx.terrain?.canMove && !ctx.terrain.canMove(e.position, next, e)) return;
    if (this.getWorldEffects().some((v) => v.type === 'solid' && segmentBox(e.position, next, v))) return;
    e.position = next;
  }

  updateFlight(e, dt, ctx) {
    const def = this.definitionFor(e); if (!def.flight) return;
    const state = this.phase(e).state;
    if (e.cast?.stage === 'active' && ['glider_dive', 'glider_landing'].includes(e.cast.skillId)) return;
    if (e.flightState === 'grounded') {
      e.groundedS += dt;
      if (e.engaged && e.groundedS >= state.minimumGroundedS && !e.cast && !e.action) { e.flightState = 'airborne'; e.airborneS = 0; }
    } else {
      e.airborneS += dt;
      const limit = Math.min(state.maxAirborneS, e.parts.locomotion.broken ? def.flight.maxAirborneAfterWingBreakS : Infinity);
      if (e.airborneS >= limit && !e.cast) { e.flightState = 'landing'; }
    }
    const floor = this.ground(e.position.x, e.position.z, e, ctx);
    const desiredY = e.flightState === 'airborne' ? floor + state.cruiseHeightM : floor;
    e.position.y += clamp(desiredY - e.position.y, -def.flight.flightSpeedMps * dt, def.flight.flightSpeedMps * dt);
    if (e.flightState === 'landing' && Math.abs(e.position.y - floor) < .01) { e.flightState = 'grounded'; e.groundedS = 0; e.position.y = floor; }
  }

  finishCast(e, skill) {
    e.completedAttacks++;
    if(e.variantState)e.variantState.lastCompletedCast={id:e.cast.id,skillId:skill.id};
    const exposure = this.phase(e).state.coreExposure;
    if ((exposure.mode === 'after_skill' && exposure.skillIds.includes(skill.id)) ||
      (exposure.mode === 'after_attack_count' && e.completedAttacks % exposure.completedAttackCount === 0)) e.exposedUntil = e.age + exposure.durationS;
    if (['glider_dive', 'glider_landing'].includes(skill.id)) { e.flightState = e.position.y <= e.arenaOrigin.y + .1 ? 'grounded' : 'landing'; e.groundedS = 0; }
    e.cast.stage = 'recovery';
    e.cast.remaining = skill.recoveryS + (skill.id === 'sentinel_ring' && Object.values(e.gimmicks).some((g) => g.broken || !g.uses) ? 1 : 0);
  }

  advanceCast(e, dt, ctx) {
    const cast = e.cast, def = this.definitionFor(e), skill = def.skills.find((s) => s.id === cast.skillId);
    cast.remaining -= dt;
    if (cast.stage === 'windup' && cast.remaining <= 0) {
      if (skill.geometry.kind === 'sphere') { cast.stage = 'flight'; cast.remaining = distance(cast.origin, cast.shape.center) / 12; }
      else { cast.stage = 'active'; cast.remaining = skill.activeS; }
    }
    if (cast.stage === 'flight') {
      const dir = sub(cast.shape.center, cast.projectilePosition), next = add(cast.projectilePosition, mul(normalize(dir), Math.min(length(dir), 12 * dt)));
      if (!this.lineOfSight(cast.projectilePosition, next, ctx, { excludeOwnerId: e.id, targetOwnerId: cast.targetOwnerId })) { this.emit('blocked', e, { skillId: skill.id }); this.finishCast(e, skill); return; }
      cast.projectilePosition = next;
      if (distance(next, cast.shape.center) < .001) { cast.stage = 'active'; cast.remaining = skill.activeS; }
    }
    if (cast.stage === 'active') {
      cast.activeElapsed += dt;
      if (['root_charge', 'mine_charge', 'glider_dive', 'glider_landing'].includes(skill.id)) {
        const goal = { x: cast.aim.x, y: this.ground(cast.aim.x, cast.aim.z, e, ctx), z: cast.aim.z };
        this.move(e, goal, distance(cast.originBody, goal) / skill.activeS, dt, ctx);
        for (const g of def.arena.gimmicks) {
          if (distance(e.position, add(e.arenaOrigin, position(g.positionM))) < 1.6 && ['root_charge', 'mine_charge'].includes(skill.id)) {
            this.interactGimmick(e.id, g.id, { action: 'damage', amount: def.arena.gimmickBreakHp });
          }
        }
      }
      const impactOrigin = skill.geometry.kind === 'sphere' ? cast.shape.center : cast.origin;
      const victims = new Map();
      for (const target of ctx.targets ?? []) {
        if (target.hp === 0 || cast.hitOwners.includes(keyOf(target)) || !bossShapeHits(cast.shape, target)) continue;
        if (!this.lineOfSight(impactOrigin, targetCenter(target), ctx, { excludeOwnerId: e.id, targetOwnerId: keyOf(target) })) continue;
        if (!victims.has(keyOf(target))) victims.set(keyOf(target), target);
      }
      const remainingEU = cast.remainingEU ?? cast.spentEU;
      const deliveredEU = victims.size ? remainingEU / victims.size : 0;
      for (const target of victims.values()) {
        if (deliveredEU <= 0) break;
        const reaction = target.energyMultipliers?.[skill.energyType] ?? 1;
        const reduction = clamp(target.armorReduction ?? 0, 0, 1);
        const base = Math.min(skill.damage.neutralTargetHp / victims.size, deliveredEU * skill.energyCost.damageYieldHpPerEU);
        const damage = base * reaction * (1 - reduction) * this.phase(e).damageMultiplier;
        cast.hitOwners.push(keyOf(target));
        this.emit('damage', e, { targetId: target.id, ownerId: keyOf(target), skillId: skill.id, castId: cast.id, amount: damage, energyType: skill.energyType, deliveredEU,
          impulse: skill.id === 'glider_wind' ? mul(normalize(sub(targetPosition(target), e.position)), 1) : null });
      }
      if (victims.size) cast.remainingEU = 0;
      if (cast.remaining <= 0 || e.staggerS > 0) this.finishCast(e, skill);
    } else if (cast.stage === 'recovery' && cast.remaining <= 0) { e.cast = null; e.gap = this.phase(e).interCastGapS; }
  }

  recovery(e, dt, target, ctx) {
    const def = this.definitionFor(e), life = def.lifeRecovery, state = this.phase(e).state;
    const usable = Object.entries(e.gimmicks).filter(([, g]) => !g.broken && g.uses > 0);
    if (e.action) {
      const a = e.action; a.remaining -= dt;
      if (a.kind === 'regen') {
        const hp = Math.min(e.maxHp - e.hp, life.naturalRegenHpPerS * dt, e.calories / life.caloriesPerHp, e.maxHp * life.combatRegenMaxHpFraction - e.regenRestored);
        e.hp += Math.max(0, hp); e.calories -= Math.max(0, hp) * life.caloriesPerHp; e.regenRestored += Math.max(0, hp);
      }
      if (a.remaining <= 0) {
        if (a.kind === 'rest') { e.action = { kind: 'regen', remaining: life.maxRegenDurationS }; return true; }
        if (a.kind === 'repair') e.hp = Math.min(e.maxHp, e.hp + life.repairHp);
        if (a.kind === 'recharge') {
          const reserve = def.energyReserves.find((r) => r.energyType === a.energyType);
          e.energy[a.energyType].amount = Math.min(reserve.capacityEU, e.energy[a.energyType].amount + reserve.rechargeEU);
        }
        this.emit('actionComplete', e, { action: a.kind }); e.action = null;
      }
      return true;
    }
    if (def.entityType === 'organic' && !e.engaged && e.age - e.lastHitAge >= life.noDamageDelayS && e.hp < e.maxHp) {
      const hp = Math.min(e.maxHp - e.hp, life.naturalRegenHpPerS * dt, e.calories / life.caloriesPerHp);
      e.hp += hp; e.calories -= hp * life.caloriesPerHp;
    }
    const lifeAllowed = state.combatRegenAllowed && e.regenActions < life.combatRegenMaxActions && e.age - e.lastHitAge >= life.noDamageDelayS && e.hp / e.maxHp <= life.triggerHpFraction && e.calories > 0;
    const repairAllowed = state.repairAllowed && e.repairSupplies > 0 && e.repairActions < life.maxRepairActions && e.age - e.lastRepairAge >= life.repairCooldownS && e.hp / e.maxHp <= life.repairTriggerHpFraction;
    if (e.engaged && usable.length && (lifeAllowed || repairAllowed)) {
      let selectedId=usable[0][0];
      if(def.variantBehavior?.alternateRepairShrines&&repairAllowed){const vs=e.variantState;
        if(!usable.some(([id])=>id===vs.selectedRepairGimmickId))vs.selectedRepairGimmickId=null;
        if(!vs.selectedRepairGimmickId){const ids=def.arena.gimmicks.map(g=>g.id);for(let n=0;n<ids.length;n++){const candidate=ids[(vs.repairCursor+n)%ids.length];if(usable.some(([id])=>id===candidate)){vs.selectedRepairGimmickId=candidate;break;}}}
        selectedId=vs.selectedRepairGimmickId;
      }
      const g = def.arena.gimmicks.find((x) => x.id === selectedId), point = add(e.arenaOrigin, position(g.positionM));
      if (distance(e.position, point) > 2) { this.move(e, point, def.stats.moveSpeedMps, dt, ctx); return true; }
      if (repairAllowed) { if(e.variantState){e.variantState.repairCursor=(def.arena.gimmicks.findIndex(g=>g.id===selectedId)+1)%def.arena.gimmicks.length;e.variantState.selectedRepairGimmickId=null;} e.repairSupplies--; e.repairActions++; e.lastRepairAge = e.age; e.action = { kind: 'repair', remaining: life.repairActionS }; }
      else { e.regenActions++; e.action = { kind: 'rest', remaining: life.restWindupS }; }
      this.emit('action', e, { action: e.action.kind }); return true;
    }
    // Recharging is finite and spends its source charge at start, not finish.
    if (target) for (const r of def.energyReserves) {
      const need = Math.min(...def.skills.filter((s) => s.energyType === r.energyType).map((s) => s.energyCost.amount));
      const stock = e.energy[r.energyType];
      if (stock.amount < need && stock.charges > 0) {
        stock.charges--; e.action = { kind: 'recharge', remaining: r.rechargeActionS, energyType: r.energyType };
        this.emit('action', e, { action: 'recharge', energyType: r.energyType }); return true;
      }
    }
    return false;
  }

  movement(e, target, dt, ctx) {
    const def = this.definitionFor(e), state = this.phase(e).state;
    const speed = (e.flightState === 'airborne' ? def.flight?.flightSpeedMps ?? def.stats.moveSpeedMps : def.stats.moveSpeedMps)
      * state.moveSpeedMultiplier * (e.parts.locomotion.broken ? def.parts.find((p) => p.id === 'locomotion').speedMultiplierAfterBreak : 1);
    let goal = target ? targetPosition(target) : e.home;
    const d = distance(e.position, goal);
    if (state.orbitRadiusM > 0 && target) {
      e.orbitAngle += dt * speed / state.orbitRadiusM;
      goal = add(e.arenaOrigin, { x: Math.cos(e.orbitAngle) * state.orbitRadiusM, y: e.position.y - e.arenaOrigin.y, z: Math.sin(e.orbitAngle) * state.orbitRadiusM });
    } else if (state.behavior === 'hold_north_basin') goal = add(e.arenaOrigin, { x: 0, y: 0, z: 8 });
    else if (state.behavior === 'circle_food_then_charge' && target) {
      e.orbitAngle += dt * .4; goal = add(e.arenaOrigin, { x: Math.cos(e.orbitAngle) * 5, y: 0, z: 5 + Math.sin(e.orbitAngle) * 2 });
    } else if (['sideways_retreat', 'protect_broken_back'].includes(state.behavior) && target && d < 4) {
      goal = add(e.position, { x: -e.facing.z * 3, y: 0, z: e.facing.x * 3 });
    } else if (['guard_food', 'protect_growth_nodes'].includes(state.behavior) && target && d > 12) goal = e.home;
    else if (target && d < 4) return;
    goal = { ...goal, y: e.position.y };
    const ar = def.arena, o = e.arenaOrigin;
    goal.x = clamp(goal.x, o.x - ar.widthM / 2 + 1, o.x + ar.widthM / 2 - 1);
    goal.z = clamp(goal.z, o.z - ar.depthM / 2 + 1, o.z + ar.depthM / 2 - 1);
    this.move(e, goal, speed, dt, ctx);
  }

  variantMovement(e,target,dt,ctx){
    const def=this.definitionFor(e),rule=def.variantBehavior,vs=e.variantState;if(!rule||!vs||!target)return false;
    const usable=def.arena.gimmicks.map(g=>!e.gimmicks[g.id].broken&&e.gimmicks[g.id].uses>0);
    const allowed=sign=>rule.gimmickPolicy==='any_consumed_stops'?usable.every(Boolean)
      :rule.gimmickPolicy==='phase3_requires_live_shrine'&&e.phaseIndex===2?usable.some(Boolean)
      :rule.gimmickPolicy==='directional_anchors'?usable[sign<0?0:1]:true;
    if(vs.pendingReposition&&!allowed(vs.pendingReposition.sign)){vs.pendingReposition=null;this.emit('variantRepositionStopped',e,{reason:'gimmick'});return false;}
    if(!vs.pendingReposition){const completed=vs.lastCompletedCast;
      if(!completed||completed.id===vs.lastRepositionCastId)return false;vs.lastRepositionCastId=completed.id;
      if(!rule.triggersByPhase[String(e.phaseIndex)]?.includes(completed.skillId))return false;
      let sign=rule.kind==='lateral_guard'?vs.sideSign:vs.orbitSign;
      if(!allowed(sign)){sign=-sign;if(!allowed(sign))return false;}
      let goal;
      if(rule.kind==='lateral_guard'){const delta=normalize(sub(targetPosition(target),e.position));goal=add(e.position,{x:delta.z*rule.distanceM*sign,y:0,z:-delta.x*rule.distanceM*sign});}
      else{const radius=this.phase(e).state.orbitRadiusM;if(!radius)return false;const angle=Math.atan2(e.position.z-e.arenaOrigin.z,e.position.x-e.arenaOrigin.x)+rule.angleStepRad*sign;goal=add(e.arenaOrigin,{x:Math.cos(angle)*radius,y:e.position.y-e.arenaOrigin.y,z:Math.sin(angle)*radius});}
      goal.x=clamp(goal.x,e.arenaOrigin.x-def.arena.widthM/2+1,e.arenaOrigin.x+def.arena.widthM/2-1);goal.z=clamp(goal.z,e.arenaOrigin.z-def.arena.depthM/2+1,e.arenaOrigin.z+def.arena.depthM/2-1);
      vs.pendingReposition={goal,remainingS:rule.maxDurationS,sign,expectedPosition:null};
      if(rule.reverseOnSkillIds.includes(completed.skillId)){if(rule.kind==='lateral_guard')vs.sideSign=-sign;else vs.orbitSign=-sign;}
      this.emit('variantRepositionStart',e,{goal:clone(goal),sign});
    }
    const action=vs.pendingReposition;
    // RuntimePhysics clamps real articulated cuboid sweeps after simulation.
    // A correction means the planned move contacted an external solid: stop
    // instead of repeatedly pushing/teleporting through the same obstacle.
    if(action.expectedPosition&&distance(action.expectedPosition,e.position)>.02){vs.pendingReposition=null;this.emit('variantRepositionStopped',e,{reason:'physics_contact'});return false;}
    const before=clone(e.position);this.move(e,action.goal,def.stats.moveSpeedMps*this.phase(e).state.moveSpeedMultiplier*(e.parts.locomotion.broken?.8:1),dt,ctx);
    action.remainingS-=dt;action.expectedPosition=clone(e.position);
    if(distance(e.position,before)<1e-6||distance(e.position,action.goal)<.05||action.remainingS<=0){vs.pendingReposition=null;this.emit('variantRepositionStopped',e,{reason:distance(e.position,before)<1e-6?'blocked':'complete'});}
    return true;
  }

  stepEntity(e, dt, ctx) {
    if (e.defeated) return;
    const def = this.definitionFor(e); e.age += dt;
    e.gap = Math.max(0, e.gap - dt); e.staggerS = Math.max(0, e.staggerS - dt);
    for (const key of Object.keys(e.cooldowns)) e.cooldowns[key] = Math.max(0, e.cooldowns[key] - dt);
    if (e.calories !== null) e.calories = Math.max(0, e.calories - def.lifeRecovery.activityCaloriesPerS * dt);
    const target = this.selectTarget(e, ctx.targets ?? [], ctx), o = e.arenaOrigin;
    const outside = !target || Math.abs(targetPosition(target).x - o.x) > def.arena.widthM / 2 + def.persistence.leashBeyondArenaM || Math.abs(targetPosition(target).z - o.z) > def.arena.depthM / 2 + def.persistence.leashBeyondArenaM;
    e.disengageS = outside ? e.disengageS + dt : 0;
    if (target && !outside) e.engaged = true;
    if (e.disengageS >= def.persistence.disengageDelayS) { e.engaged = false; e.cast = null; e.action = null; }
    this.updateFlight(e, dt, ctx);
    if (e.phaseTimer > 0) { e.phaseTimer = Math.max(0, e.phaseTimer - dt); return; }
    if (e.staggerS > 0) return;
    if (e.cast) { this.advanceCast(e, dt, ctx); return; }
    if (this.recovery(e, dt, target, ctx)) return;
    if (!e.engaged || !target) { this.movement(e, null, dt, ctx); return; }
    if (e.gap > 0) return;
    if(this.variantMovement(e,target,dt,ctx))return;
    const selected = this.chooseSkill(e, target, ctx);
    if (selected) this.startCast(e, selected, target);
    else this.movement(e, target, dt, ctx);
  }

  tick(dt, ctx = {}) {
    finite(dt, 'dt'); if (dt > 60) throw new RangeError('Use bounded simulation steps, not offline elapsed time');
    this.invalidateEffects();
    let remaining = dt;
    const active = ctx.activeIds ? new Set(ctx.activeIds) : null;
    while (remaining > 1e-9) {
      const step = Math.min(remaining, .05); this.time += step;
      for (const e of this.entities.values()) if (!active || active.has(e.id) || active.has(e.instanceId)) this.stepEntity(e, step, ctx);
      remaining -= step;
    }
    const events = this.pending.splice(0);
    for (const event of events) {
      if (event.type === 'damage') ctx.damage?.(event);
      else if (event.type === 'phase') ctx.onPhase?.(event);
      else if (event.type === 'gimmick') ctx.onGimmick?.(event);
      else if (event.type === 'defeat') ctx.onDefeat?.(event);
    }
    return events;
  }
}
