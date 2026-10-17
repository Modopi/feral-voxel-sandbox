import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BossSystem, bossShapeHits } from '../app/src/main/assets/content-runtime/bosses.js';
const bosses = JSON.parse(fs.readFileSync(new URL('../design/content/bosses.json', import.meta.url)));
const content = { bosses };
const target = (p = [4, 0, 4], extra = {}) => ({ id: 'player', position: { x: p[0], y: p[1], z: p[2] }, radius: .35, height: 1.8, hp: 100, ...extra });
const create = (id = 'rootback_beast', opts = {}) => {
  const system = new BossSystem(content);
  const entity = system.spawn(id, [0, 0, 4], { id: `instance:${id}`, instanceId: 'world:ruin:1', shellVoxels: [], ...opts });
  return { system, entity, def: bosses.entries.find((b) => b.id === id) };
};
const createVariant = (id, opts = {}) => {
  const variant = bosses.variants.find((v) => v.id === id);
  const system = new BossSystem(content);
  const entity = system.spawn(variant.baseBossId, [0, 0, 4], { id: `instance:${id}`, instanceId: 'world:ruin:1', contentVariantId: id, tier: variant.tier, shellVoxels: [], ...opts });
  return { system, entity, def: system.definitionFor(entity), variant };
};
const run = (system, seconds, ctx = {}) => {
  const events = [];
  for (let t = 0; t < seconds - 1e-8; t += .05) events.push(...system.tick(Math.min(.05, seconds - t), ctx));
  return events;
};
function enterPhase(system, e, def, index) {
  if (!index) return;
  const desired = (def.phases[index].hpFractionUpperInclusive + def.phases[index].hpFractionLowerExclusive) / 2;
  const response = system.phase(e).state.bodyReactionOverrides?.mechanical ?? def.stats.energyDamageMultipliers.mechanical;
  system.hit(e.id, { amount: (e.hp - e.maxHp * desired) / response, energyType: 'mechanical' });
  assert.equal(e.phaseIndex, index);
}

test('all eight bosses use real HP transitions through all 24 authored phases', () => {
  for (const def of bosses.entries) {
    const { system, entity: e } = create(def.id);
    assert.equal(e.phaseId, def.phases[0].id);
    for (let phase = 1; phase < 3; phase++) {
      enterPhase(system, e, def, phase);
      const events = system.tick(0);
      assert(events.some((v) => v.type === 'phase' && v.phaseId === def.phases[phase].id));
      assert.equal(e.cast, null);
      assert.equal(e.phaseTimer, def.phases[phase].onEnter.durationS);
    }
    e.hp = e.maxHp; system.updatePhase(e);
    assert.equal(e.phaseIndex, 2, 'healing never reverses a phase');
  }
});

test('four reviewed variants preserve the eight prototypes and use explicit tier-bound definitions', () => {
  const originals = structuredClone(bosses.entries);
  assert.equal(bosses.entries.length, 8);
  assert.equal(bosses.entries.reduce((n, b) => n + b.phases.length, 0), 24);
  assert.equal(bosses.entries.reduce((n, b) => n + b.skills.length, 0), 32);
  assert.deepEqual(bosses.variants.map(v => v.id), [
    'sanctuary_warden_t9', 'sanctuary_warden_t10', 'observatory_sentinel_t9', 'observatory_sentinel_t10',
  ]);

  for (const variant of bosses.variants) {
    const { system, entity: e, def } = createVariant(variant.id);
    const base = system.definitions.get(variant.baseBossId);
    assert.equal(e.bossId, variant.baseBossId);
    assert.equal(e.contentVariantId, variant.id);
    assert.equal(e.tier, variant.tier);
    assert.equal(e.encounterTier, variant.tier);
    assert.equal(e.assetId, undefined, 'content variant never replaces the authored asset identity');
    assert.equal(def.contentVariantId, variant.id);
    assert.equal(def.stats.maxHp, variant.stats.maxHp);
    assert.notEqual(def, base);
    assert(Object.isFrozen(def) && Object.isFrozen(def.skills[0]));
    assert.deepEqual(def.rewardOverride, variant.rewardOverride);
    for (const skill of def.skills) {
      const authored = variant.skills[skill.id];
      assert.equal(skill.damage.neutralTargetHp, authored.neutralTargetHp);
      assert.equal(skill.energyCost.amount, authored.energyCostEU);
      assert.equal(skill.energyCost.damageYieldHpPerEU, authored.neutralTargetHp / authored.energyCostEU);
    }
    assert.equal(def.phases.length, 3);
    assert.equal(def.skills.length, 4);
    assert.equal(def.arena.gimmicks.length, base.arena.gimmicks.length);
    for (let phase = 1; phase < 3; phase++) {
      enterPhase(system, e, def, phase);
      assert.equal(e.phaseIndex, phase, `${variant.id} enters authored phase ${phase + 1} by HP`);
      e.phaseTimer = 0;
    }
    e.hp = e.maxHp; system.updatePhase(e);
    assert.equal(e.phaseIndex, 2, 'variant healing never reverses a phase');

    assert.throws(() => system.spawn(variant.baseBossId, [0, 0, 4], { id: 'wrong-tier', tier: 9 }), /not authored/);
    assert.throws(() => system.spawn(variant.baseBossId, [0, 0, 4], { id: 'wrong-variant-tier', contentVariantId: variant.id, tier: variant.tier === 9 ? 10 : 9 }), /not authored/);
    assert.throws(() => system.spawn(variant.baseBossId, [0, 0, 4], { id: e.id, contentVariantId: variant.id, tier: variant.tier === 9 ? 10 : 9 }), /not authored/);
    assert.equal(system.spawn(variant.baseBossId, [9, 0, 4], { id: e.id, contentVariantId: variant.id, tier: variant.tier }), e);
    assert.throws(() => system.spawn('rootback_beast', [0, 0, 4], { id: 'wrong-base', contentVariantId: variant.id, tier: variant.tier }), /does not belong/);
  }
  assert.deepEqual(bosses.entries, originals, 'resolving variants never mutates prototype definitions');
  assert.throws(() => { const x = createVariant('sanctuary_warden_t9'); new BossSystem(content).definitionFor(x.entity).stats.maxHp = 1; }, TypeError);
});

test('variant saves retain encounter identity and pending reposition; defeat keeps the original reward key', () => {
  for (const variant of bosses.variants) {
    const { system, entity: e } = createVariant(variant.id);
    e.variantState.sideSign = -1; e.variantState.orbitSign = -1;
    e.variantState.repairCursor = 1;
    e.variantState.selectedRepairGimmickId = system.definitionFor(e).arena.gimmicks[1].id;
    e.variantState.lastRepositionCastId = 'cast:prior';
    e.variantState.lastCompletedCast = { id: 'cast:prior', skillId: system.definitionFor(e).skills[0].id };
    e.variantState.pendingReposition = { goal: { x: 3, y: 0, z: 4 }, remainingS: .5, sign: -1, expectedPosition: { ...e.position } };
    const saved = system.serialize(), restored = new BossSystem(content, saved), re = restored.get(e.id);
    assert.equal(re.contentVariantId, variant.id);
    assert.equal(re.encounterTier, variant.tier);
    assert.deepEqual(re.variantState, e.variantState);
    assert.equal(restored.definitionFor(re).stats.maxHp, e.maxHp);
    assert.throws(() => new BossSystem(content, { ...saved, entities: [{ ...saved.entities[0], contentVariantId: 'unknown_t10' }] }), /saved boss identity/);

    system.hit(e.id, { amount: 1e9 });
    assert.equal(e.reward.key, 'world:ruin:1:' + e.bossId + ':first_defeat');
    assert.equal(e.reward.poolId, system.definitions.get(e.bossId).persistence.rewardRef);
    assert.deepEqual(e.reward.bossChannelOverride, variant.rewardOverride);
  }
  const base = create('sanctuary_warden');
  base.system.hit(base.entity.id, { amount: 1e9 });
  assert.equal(Object.hasOwn(base.entity.reward, 'bossChannelOverride'), false);
  assert.equal(base.entity.reward.key, 'world:ruin:1:sanctuary_warden:first_defeat');
  const legacy = create('sanctuary_warden').system.serialize();
  delete legacy.entities[0].tier; delete legacy.entities[0].encounterTier;
  assert.equal(new BossSystem(content, legacy).get(legacy.entities[0].id).encounterTier, 7);
  legacy.entities[0].tier = 9; legacy.entities[0].encounterTier = 9;
  assert.throws(() => new BossSystem(content, legacy), /prototype tier/);
});

test('variant movement uses saved phase triggers, stops at consumed gimmicks or blocked sweeps', () => {
  const activate = (id, phaseIndex, skillId, usedGimmicks = []) => {
    const { system, entity: e, def } = createVariant(id);
    e.phaseIndex = phaseIndex; e.phaseId = def.phases[phaseIndex].id; e.phaseTimer = 0; e.gap = 0; e.engaged = true;
    e.variantState.lastCompletedCast = { id: `completed:${skillId}`, skillId };
    for (const gimmickId of usedGimmicks) { e.gimmicks[gimmickId].uses = 0; e.gimmicks[gimmickId].broken = true; }
    return { system, entity: e, def };
  };
  const t = target([4, 0, 4]);

  const warden9 = activate('sanctuary_warden_t9', 0, 'warden_hammer');
  warden9.system.tick(.05, { targets: [t] });
  assert(warden9.entity.position.z < 4, 'hammer queues a real lateral move');
  assert.equal(warden9.entity.variantState.pendingReposition.sign, 1);
  assert.equal(warden9.entity.variantState.sideSign, -1, 'the saved side alternates after the trigger');
  assert.equal(warden9.entity.cast, null, 'the reposition does not overlap an attack');
  const saved = warden9.system.serialize();
  const left = new BossSystem(content, saved), right = new BossSystem(content, saved);
  run(left, .35, { targets: [t] }); run(right, .35, { targets: [t] });
  assert.deepEqual(left.get(warden9.entity.id).position, right.get(warden9.entity.id).position);
  assert.deepEqual(left.get(warden9.entity.id).variantState, right.get(warden9.entity.id).variantState);

  const noTrigger = activate('sanctuary_warden_t9', 0, 'warden_ray');
  noTrigger.system.tick(.05, { targets: [t] });
  assert.equal(noTrigger.entity.variantState.pendingReposition, null);

  const warden10 = activate('sanctuary_warden_t10', 2, 'warden_ray');
  warden10.system.tick(.05, { targets: [t] });
  assert(warden10.entity.variantState.pendingReposition, 'live shrines allow the T10 phase-three ray move');
  const wardenShrines = bosses.entries.find(b => b.id === 'sanctuary_warden').arena.gimmicks.map(g => g.id);
  const noShrines = activate('sanctuary_warden_t10', 2, 'warden_ray', wardenShrines);
  noShrines.system.tick(.05, { targets: [t] });
  assert.equal(noShrines.entity.variantState.pendingReposition, null, 'both spent shrines stop T10 phase-three movement');

  const repair = createVariant('sanctuary_warden_t9');
  repair.entity.phaseIndex = 1; repair.entity.phaseId = repair.def.phases[1].id; repair.entity.engaged = true;
  repair.entity.hp = repair.entity.maxHp * .5;
  const shrines = repair.def.arena.gimmicks;
  repair.entity.position = {
    x: repair.entity.arenaOrigin.x + shrines[0].positionM[0],
    y: repair.entity.arenaOrigin.y + shrines[0].positionM[1],
    z: repair.entity.arenaOrigin.z + shrines[0].positionM[2],
  };
  repair.system.tick(.05, { targets: [target([repair.entity.position.x + 2, 0, repair.entity.position.z])] });
  assert.equal(repair.entity.action?.kind, 'repair');
  assert.equal(repair.entity.repairSupplies, 1);
  assert.equal(repair.entity.variantState.repairCursor, 1);
  assert.equal(repair.entity.variantState.selectedRepairGimmickId, null);
  repair.system.hit(repair.entity.id, { amount: 1 });
  repair.entity.age = repair.entity.lastRepairAge + repair.def.lifeRecovery.repairCooldownS;
  repair.entity.position = {
    x: repair.entity.arenaOrigin.x + shrines[1].positionM[0],
    y: repair.entity.arenaOrigin.y + shrines[1].positionM[1],
    z: repair.entity.arenaOrigin.z + shrines[1].positionM[2],
  };
  repair.system.tick(.05, { targets: [target([repair.entity.position.x + 2, 0, repair.entity.position.z])] });
  assert.equal(repair.entity.action?.kind, 'repair');
  assert.equal(repair.entity.repairSupplies, 0);

  const sentinel9 = activate('observatory_sentinel_t9', 1, 'sentinel_rail');
  sentinel9.entity.position = { x: 6, y: 0, z: 0 };
  sentinel9.system.tick(.05, { targets: [target([10, 0, 0])] });
  assert(sentinel9.entity.variantState.pendingReposition, 'P2 rail advances the T9 orbit');
  const spentAnchor = sentinel9.def.arena.gimmicks[0].id;
  const stopped9 = activate('observatory_sentinel_t9', 1, 'sentinel_rail', [spentAnchor]);
  stopped9.entity.position = { x: 6, y: 0, z: 0 };
  stopped9.system.tick(.05, { targets: [target([10, 0, 0])] });
  assert.equal(stopped9.entity.variantState.pendingReposition, null, 'any spent T9 anchor stops the orbit');

  const sentinel10West = activate('observatory_sentinel_t10', 2, 'sentinel_arc', [spentAnchor]);
  sentinel10West.entity.position = { x: 3, y: 0, z: 0 };
  sentinel10West.system.tick(.05, { targets: [target([7, 0, 0])] });
  assert.equal(sentinel10West.entity.variantState.pendingReposition.sign, 1, 'spending the west anchor blocks only negative orbit');
  const east = sentinel10West.def.arena.gimmicks[1].id;
  const sentinel10East = activate('observatory_sentinel_t10', 2, 'sentinel_arc', [east]);
  sentinel10East.entity.position = { x: 3, y: 0, z: 0 };
  sentinel10East.system.tick(.05, { targets: [target([7, 0, 0])] });
  assert.equal(sentinel10East.entity.variantState.pendingReposition.sign, -1, 'spending the east anchor blocks only positive orbit');
  const stopped10 = activate('observatory_sentinel_t10', 2, 'sentinel_arc', [spentAnchor, east]);
  stopped10.entity.position = { x: 3, y: 0, z: 0 };
  stopped10.system.tick(.05, { targets: [target([7, 0, 0])] });
  assert.equal(stopped10.entity.variantState.pendingReposition, null, 'both spent directional anchors stop movement');

  const blocked = activate('sanctuary_warden_t9', 0, 'warden_hammer');
  blocked.system.tick(.05, { targets: [t], terrain: { canMove: () => false } });
  assert.equal(blocked.entity.position.z, 4, 'blocked sweep never teleports through a wall');
  assert.equal(blocked.entity.variantState.pendingReposition, null);
});

test('all 32 authored skills actually cast, spend channel EU, share telegraph/hit shape and enter recovery', () => {
  const tested = new Set();
  for (const def of bosses.entries) for (const skill of def.skills) {
    const { system, entity: e } = create(def.id);
    const phase = def.phases.findIndex((p) => p.schedule.includes(skill.id));
    enterPhase(system, e, def, phase); e.phaseTimer = 0; e.gap = 0; e.repairSupplies = 0;
    e.sequenceIndex = system.phase(e).schedule.indexOf(skill.id);
    // Stand at a legal range, including the annular danger band; pools are
    // north of the protected escape strip. No future aim following is allowed.
    const p = skill.geometry.kind === 'annular_cylinder'
      ? [((skill.geometry.innerRadiusM + skill.geometry.outerRadiusM) / 2), 0, 4]
      : skill.id === 'acid_pool' ? [2, 0, 8] : [3, 0, 4];
    const t = target(p), before = e.energy[skill.energyType].amount;
    const initial = system.tick(.01, { targets: [t] });
    assert.equal(e.cast?.skillId, skill.id, `${def.id} should select ${skill.id}`);
    assert(initial.some((v) => v.type === 'cast'));
    assert.equal(e.energy[skill.energyType].amount, before - skill.energyCost.amount);
    const preview = system.getTelegraphs()[0];
    assert.deepEqual(preview.shape, e.cast.shape);
    const events = run(system, skill.windupS + skill.activeS + (skill.geometry.kind === 'sphere' ? .6 : .1), { targets: [t] });
    assert(events.some((v) => v.type === 'damage' && v.skillId === skill.id), `actual hit missing: ${skill.id}`);
    assert.equal(e.cast?.stage, 'recovery');
    assert(events.filter((v) => v.type === 'damage' && v.skillId === skill.id).length === 1, 'persistent overlap cannot multiply damage');
    tested.add(skill.id);
  }
  assert.equal(tested.size, 32);
});

test('same-owner multiple target parts receive at most one hit per cast and fixed aim can be evaded', () => {
  const { system, entity: e } = create(); e.gap = 0;
  const t = target([3, 0, 4], { ownerId: 'machine' });
  system.tick(.01, { targets: [t] });
  const shape = structuredClone(e.cast.shape);
  const moved = target([10, 0, 4], { ownerId: 'machine' });
  const evaded = run(system, 2, { targets: [moved] });
  assert(!evaded.some((v) => v.type === 'damage'));
  assert.deepEqual(e.cast.shape, shape);
  const next = create(); next.entity.gap = 0;
  const duplicates = [t, { ...t, id: 'second-part' }];
  const events = run(next.system, 2, { targets: duplicates });
  assert.equal(events.filter((v) => v.type === 'damage').length, 1);
});

test('3D height/OBB/SAT use actual volumes, preserving flight and machine holes', () => {
  const ground = { kind: 'cylinder', center: { x: 0, y: .5, z: 0 }, bottomY: 0, heightM: 1, radiusM: 3 };
  assert.equal(bossShapeHits(ground, target([0, 4, 0])), false);
  assert.equal(bossShapeHits(ground, target([0, 0, 0])), true);
  const sphere = { kind: 'sphere', center: { x: 0, y: 5, z: 0 }, radiusM: 1 };
  assert.equal(bossShapeHits(sphere, target([0, 4, 0])), true);
  assert.equal(bossShapeHits(sphere, { hitboxes: [{ center: [-4, 5, 0], size: [1, 1, 1] }, { center: [4, 5, 0], size: [1, 1, 1] }] }), false);
  const diagonal = { kind: 'oriented_box', center: { x: 0, y: 1, z: 0 }, axes: [{ x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 }, { x: 0, y: 1, z: 0 }, { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }], halfSize: [.5, 1, 4] };
  assert(bossShapeHits(diagonal, target([2, 0, 2])));
  assert(!bossShapeHits(diagonal, { hitboxes: [{ center: [2, 1, -2], size: [.5, 1, .5] }] }));
});

test('terrain blocks targeting, active attacks and moving projectiles', () => {
  const { system, entity: e } = create(); e.gap = 0;
  const t = target();
  run(system, 5, { targets: [t], terrain: { hasLineOfSight: () => false } });
  assert.equal(e.cast, null);
  e.sequenceIndex = 1; system.tick(.01, { targets: [t] });
  assert.equal(e.cast.skillId, 'root_seed');
  const events = run(system, 3, { targets: [t], terrain: { hasLineOfSight: () => false } });
  assert(events.some((v) => v.type === 'blocked'));
  assert(!events.some((v) => v.type === 'damage'));
});

test('exterior shell hits reduce total HP and exposed core break changes skills without forcing death', () => {
  const { system, entity: e, def } = create('rootback_beast', { shellVoxels: [{ id: 'shell:42', capacityEU: 50 }] });
  const original = e.hp;
  const result = system.hit(e.id, { amount: 20, energyEU: 20, shellVoxelId: 'shell:42' });
  assert.equal(result.damage, 20); assert.equal(e.hp, original - 20); assert.equal(e.shell['shell:42'], 30);
  system.hit(e.id, { amount: 50, energyEU: 50, shellVoxelId: 'shell:42' });
  assert.equal(e.hp, original - 70); assert.equal(e.shell['shell:42'], 0);
  e.exposedUntil = e.age + 100;
  system.hit(e.id, { amount: 200, partId: 'core' });
  assert(e.parts.core.broken); assert(e.hp > 0 && !e.defeated);
  const forbidden = def.parts[0].disabledSkillIds[0];
  enterPhase(system, e, def, 2); e.phaseTimer = 0;
  const events = run(system, 70, { targets: [target([4, 0, 4])] });
  assert(events.some((v) => v.type === 'cast'));
  assert(!events.some((v) => v.type === 'cast' && v.skillId === forbidden));
  const restored = new BossSystem(content, system.serialize());
  assert(restored.get(e.id).parts.core.broken);
});

test('authored phase mechanics include water/draining, growth cover, heat exposure, shields and orbit', () => {
  const acid = create('sluice_acidworm'); enterPhase(acid.system, acid.entity, acid.def, 1);
  assert.equal(acid.system.targetEffects(target([0, 0, 8])).speedMultiplier, .85);
  assert.equal(acid.system.targetEffects(target([0, 0, 0])).speedMultiplier, 1);
  acid.system.interactGimmick(acid.entity.id, acid.def.arena.gimmicks[0].id);
  assert.equal(acid.system.targetEffects(target([0, 0, 8])).speedMultiplier, 1);
  const tree = create('arboretum_symbiote'); enterPhase(tree.system, tree.entity, tree.def, 1);
  assert.equal(tree.system.getWorldEffects().filter((v) => v.type === 'solid').length, 2);
  assert(!tree.system.lineOfSight({ x: -12, y: 1, z: 10 }, { x: -8, y: 1, z: 10 }, {}));
  tree.system.interactGimmick(tree.entity.id, tree.def.arena.gimmicks[0].id, { action: 'damage', amount: 999 });
  assert.equal(tree.system.getWorldEffects().filter((v) => v.type === 'solid').length, 1);
  const furnace = create('furnace_carapace'); furnace.entity.gap = 0;
  run(furnace.system, 30, { targets: [target([3, 0, 4])] });
  assert(furnace.entity.completedAttacks >= 3);
  const guardian = create('sanctuary_warden');
  assert(guardian.system.coreExposed(guardian.entity, [0, 0, 0]));
  assert(!guardian.system.coreExposed(guardian.entity, [0, 0, 10]));
  const sentinel = create('observatory_sentinel'); enterPhase(sentinel.system, sentinel.entity, sentinel.def, 1);
  sentinel.entity.phaseTimer = 0; sentinel.entity.repairSupplies = 0;
  for (const skill of sentinel.def.skills) sentinel.entity.cooldowns[skill.id] = 100;
  run(sentinel.system, 2, { targets: [target([4, 0, 4])] });
  assert(sentinel.entity.orbitAngle > 0);
  assert(sentinel.entity.position.x > 0);
});

test('terrain solid lookups reuse a spatial effect index and invalidate it on boss state changes', () => {
  const tree = create('arboretum_symbiote'); enterPhase(tree.system, tree.entity, tree.def, 1);
  const effects = tree.system.getWorldEffects().filter(e => e.type === 'solid');
  const first = effects[0], point = { x: first.min.x + .1, y: first.min.y + .1, z: first.min.z + .1 };
  let traversals = 0; const original = tree.system.worldEffectsFor.bind(tree.system);
  tree.system.worldEffectsFor = entity => { traversals++; return original(entity); };
  assert.equal(tree.system.isSolidAt(point.x, point.y, point.z), true);
  const index = tree.system.solidEffectsIndex;
  for (let i = 0; i < 20; i++) assert.equal(tree.system.isSolidAt(point.x + i * .01, point.y, point.z), true);
  assert.equal(tree.system.solidEffectsIndex, index);
  assert.equal(traversals, 0, 'cell queries use the cached bucket instead of rebuilding or copying the world list');

  const revision = tree.system.effectsRevision;
  tree.system.hit(tree.entity.id, { amount: 1 });
  assert(tree.system.effectsRevision > revision);
  assert.equal(tree.system.solidEffectsIndex, null);
  assert.equal(tree.system.isSolidAt(point.x, point.y, point.z), true);
  const beforeBreak = tree.system.getWorldEffects();
  tree.system.interactGimmick(tree.entity.id, first.gimmickId, { action: 'damage', amount: 1e9 });
  assert.notEqual(tree.system.getWorldEffects(), beforeBreak);
  assert.equal(tree.system.isSolidAt(point.x, point.y, point.z), false);
  const beforeSpawn = tree.system.getWorldEffects();
  tree.system.spawn('rootback_beast', [100, 0, 4]);
  assert.notEqual(tree.system.getWorldEffects(), beforeSpawn);
  const beforeTick = tree.system.getWorldEffects();
  tree.system.tick(.05);
  assert.notEqual(tree.system.getWorldEffects(), beforeTick);
});

test('organic combat recovery consumes calories; inorganic repair consumes supplies and interrupts on hit', () => {
  const organic = create(); enterPhase(organic.system, organic.entity, organic.def, 1);
  organic.entity.phaseTimer = 0; organic.entity.hp = organic.entity.maxHp * .5;
  organic.entity.position = { x: -7, y: 0, z: 7 }; organic.entity.lastHitAge = -100;
  const hp = organic.entity.hp, calories = organic.entity.calories;
  run(organic.system, 5, { targets: [target([-5, 0, 7])] });
  assert(organic.entity.hp > hp); assert(organic.entity.calories < calories);
  assert.equal(organic.entity.regenActions, 1);
  const robot = create('sanctuary_warden'); enterPhase(robot.system, robot.entity, robot.def, 1);
  robot.entity.phaseTimer = 0; robot.entity.hp = robot.entity.maxHp * .5;
  robot.entity.position = { x: -11, y: 0, z: 11 };
  robot.system.tick(.1, { targets: [target([-9, 0, 11])] });
  assert.equal(robot.entity.action.kind, 'repair'); assert.equal(robot.entity.repairSupplies, 1);
  robot.system.hit(robot.entity.id, { amount: 1 });
  assert.equal(robot.entity.action, null); assert.equal(robot.entity.repairSupplies, 1);
  assert.equal(robot.entity.calories, null);
});

test('glider alternates actual altitude and grounded windows with phase-specific limits', () => {
  const { system, entity: e, def } = create('spire_glider');
  for (const skill of def.skills) e.cooldowns[skill.id] = 100;
  run(system, 7, { targets: [target([3, 0, 4])] });
  assert.equal(e.flightState, 'airborne'); assert(e.position.y > 1);
  run(system, 10, { targets: [target([3, 0, 4])] });
  assert.equal(e.flightState, 'grounded'); assert.equal(e.position.y, 0);
  enterPhase(system, e, def, 2);
  assert.equal(system.phase(e).state.minimumGroundedS, 7);
});

test('casting save/reload replays full warning without spending twice or repeating owner damage; inactive chunks freeze', () => {
  const { system, entity: e } = create(); e.gap = 0;
  system.tick(.1, { targets: [target()] });
  const amount = e.energy.mechanical.amount;
  const saved = system.serialize(), restored = new BossSystem(content, saved), re = restored.get(e.id);
  assert.equal(re.cast.stage, 'windup'); assert.equal(re.cast.remaining, re.cast.windupS);
  assert.equal(re.energy.mechanical.amount, amount);
  restored.tick(4, { targets: [target()], activeIds: [] });
  assert.equal(re.cast.remaining, re.cast.windupS);
  const events = run(restored, 2, { targets: [target()] });
  assert.equal(events.filter((v) => v.type === 'damage').length, 1);
  const again = new BossSystem(content, restored.serialize());
  assert.equal(run(again, 2, { targets: [target()] }).filter((v) => v.type === 'damage').length, 0);
});

test('defeat creates a durable entitlement and rewards require idempotent successful transfer', () => {
  const { system, entity: e } = create(); system.hit(e.id, 999999);
  assert(e.defeated); assert(e.reward && !e.reward.claimed);
  assert.equal(system.claimReward(e.id, () => false), false);
  assert.equal(e.reward.claimed, false);
  const restored = new BossSystem(content, system.serialize()); let grants = 0;
  assert(restored.claimReward(e.id, (r) => { assert(r.key.includes('first_defeat')); grants++; return true; }));
  assert.equal(restored.claimReward(e.id, () => { grants++; return true; }), false);
  assert.equal(grants, 1);
  assert.equal(restored.spawn(e.bossId, [0, 0, 4], { id: e.id }).defeated, true);
});

test('disengagement does not refill energy, restore parts, regenerate robots or respawn defeated bosses', () => {
  const { system, entity: e } = create('sanctuary_warden');
  system.hit(e.id, 100); e.energy.divine.amount = 1; e.parts.locomotion.broken = true;
  const hp = e.hp;
  run(system, 20, { targets: [] });
  assert.equal(e.hp, hp); assert.equal(e.energy.divine.amount, 1); assert(e.parts.locomotion.broken);
  assert.equal(e.engaged, false);
});

test('gimmick forced landing takes priority over an existing schedule cursor', () => {
  const { system, entity: e, def } = create('spire_glider');
  e.gap = 0; e.sequenceIndex = 3;
  assert(system.interactGimmick(e.id, def.arena.gimmicks[0].id));
  system.tick(.01, { targets: [target([3, 0, 4])] });
  assert.equal(e.cast.skillId, 'glider_landing');
});

test('area damage splits a finite EU budget across distinct owners and saves remaining budget', () => {
  const { system, entity: e } = create(); e.gap = 0;
  const targets = [target([3, 0, 4]), target([3, 0, 4], { id: 'ally' })];
  const events = run(system, 2, { targets });
  const hits = events.filter((v) => v.type === 'damage');
  assert.equal(hits.length, 2);
  assert(Math.abs(hits[0].amount - hits[1].amount) < 1e-6);
  assert(hits.reduce((n, h) => n + h.amount, 0) <= 26);
  assert.equal(e.cast.remainingEU, 0);
  const reloaded = new BossSystem(content, system.serialize());
  assert.equal(reloaded.get(e.id).cast.remainingEU, 0);
});

test('Three boss view renders all 32 actual 3D skill volumes without changing simulation state', async () => {
  const T = await import('../app/src/main/assets/vendor/three.module.js');
  const { BossView } = await import('../app/src/main/assets/content-runtime/boss-view.js');
  const scene = new T.Scene(), view = new BossView(scene);
  try {
    let count = 0;
    for (const def of bosses.entries) {
      const { system, entity: e } = create(def.id);
      for (const skill of def.skills) {
        const shape = system.makeShape(e, skill, target([4, 8, 4]), {});
        e.cast = { skillId: skill.id, shape, stage: 'windup', remaining: 1 };
        const before = JSON.stringify(system.serialize()); view.sync(system);
        assert.equal(JSON.stringify(system.serialize()), before);
        const hazard = view.hazards.get(e.id).node, volume = hazard.children[0];
        assert.deepEqual(volume.userData.shape, shape);
        assert.equal(volume.position.y, shape.center.y);
        if (shape.kind === 'annular_cylinder') {
          assert.equal(volume.children.length, 4);
          volume.updateMatrixWorld(true);
          for (const child of volume.children) {
            const p = child.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) {
              const v = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(child.matrixWorld);
              assert(Math.hypot(v.x - shape.center.x, v.z - shape.center.z) >= shape.innerRadiusM - .001);
            }
          }
        }
        if (shape.axes) {
          const direction = new T.Vector3(0, 0, 1).applyQuaternion(volume.quaternion);
          assert(direction.distanceTo(new T.Vector3(...['x', 'y', 'z'].map((k) => shape.axes[2][k]))) < 1e-7);
        }
        e.cast.stage = 'active'; view.sync(system); assert.equal(view.hazards.get(e.id).node.userData.stage, 'active');
        e.cast.stage = 'recovery'; view.sync(system); assert(view.hazards.get(e.id).node.children[0].children[0].material.wireframe);
        count++;
      }
    }
    assert.equal(count, 32);
  } finally { view.dispose(); }
  assert.equal(scene.children.length, 0);
});

test('boss view tracks actual projectile, phase water and breakable growth-wall bounds', async () => {
  const T = await import('../app/src/main/assets/vendor/three.module.js');
  const { BossView } = await import('../app/src/main/assets/content-runtime/boss-view.js');
  const view = new BossView(new T.Scene());
  try {
    const { system, entity: e, def } = create('sluice_acidworm');
    const skill = def.skills.find((s) => s.geometry.kind === 'sphere') ?? def.skills[0];
    e.cast = { skillId: skill.id, shape: system.makeShape(e, skill, target(), {}), stage: 'flight', remaining: 1, projectilePosition: { x: 1, y: 4, z: 3 } };
    view.sync(system);
    assert.deepEqual(view.hazards.get(e.id).node.getObjectByName('projectile').position.toArray(), [1, 4, 3]);
    e.cast.projectilePosition.x = 2; view.sync(system);
    assert.equal(view.hazards.get(e.id).node.getObjectByName('projectile').position.x, 2);
    for (let i = 0; i < 3; i++) {
      e.phaseIndex = i; system.invalidateEffects(); view.sync(system);
      for (const { node } of view.effects.values()) {
        assert.equal(node.userData.collision, false);
        assert.equal(node.geometry.parameters.height, node.userData.max.y - node.userData.min.y);
      }
    }
    system.interactGimmick(e.id, def.arena.gimmicks[0].id); view.sync(system); assert.equal(view.effects.size, 0);
    const grove = create('arboretum_symbiote'); grove.entity.phaseIndex = 1;
    view.sync(grove.system); assert(view.effects.size > 0);
    for (const g of grove.def.arena.gimmicks) grove.system.interactGimmick(grove.entity.id, g.id, { action: 'damage', amount: 1e9 });
    view.sync(grove.system); assert.equal(view.effects.size, 0);
  } finally { view.dispose(); }
});

test('weakpoint overlays follow authored part matrices and exposure without mutating asset materials', async () => {
  const T = await import('../app/src/main/assets/vendor/three.module.js');
  const { BossView } = await import('../app/src/main/assets/content-runtime/boss-view.js');
  const { system, entity: e } = create('arboretum_symbiote');
  const scene = new T.Scene(), group = new T.Group(), part = new T.Group();
  group.position.set(4, 2, 1); group.rotation.y = Math.PI / 2; part.position.set(0, 1, 0); group.add(part); scene.add(group);
  const asset = { anchors: [{ id: 'sap', partId: 'core', position: [1, 0, 0], purpose: 'weak_point' }], materials: [{ color: '#ffffff', emission: 0 }] };
  const view = new BossView({ scene, models: new Map([[e.id, { group, parts: new Map([['core', part]]), asset }]]) });
  try {
    const before = JSON.stringify(asset); view.sync(system);
    const node = view.markers.get(`${e.id}:sap`).node;
    assert(node.position.distanceTo(new T.Vector3(4, 3, 0)) < 1e-7); assert.equal(node.userData.state, 'protected');
    e.phaseIndex = 2; view.sync(system); assert.equal(view.markers.get(`${e.id}:sap`).node.userData.state, 'exposed');
    assert.equal(JSON.stringify(asset), before);
    group.visible = false; view.sync(system); assert.equal(view.markers.size, 0);
  } finally { view.dispose(); }
});

 test('multi-part allocations consume one total HP budget and reject duplicated structural damage', () => {
  const {system,entity:e}=create(); const old=e.hp;
  system.hit(e.id,{amount:100,structuralHits:[{partId:'locomotion',amount:40},{partId:'core',amount:60}]});
  assert.equal(old-e.hp,100); assert.equal(e.parts.locomotion.damage,40); assert.equal(e.parts.core.damage,60);
  assert.throws(()=>system.hit(e.id,{amount:10,structuralHits:[{partId:'body',amount:10},{partId:'core',amount:10}]}),/budget/);
  assert.equal(e.hp,old-100);
 });
