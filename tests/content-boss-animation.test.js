import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { loadAsset } from '../app/src/main/assets/content-runtime/assets.generated.js';
import { BossSystem } from '../app/src/main/assets/content-runtime/bosses.js';
import { animateBossModel, bossLogicalPart } from '../app/src/main/assets/content-runtime/boss-animation.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
async function setup(id, options = {}) {
  const asset = await loadAsset(id), group = new T.Group(), parts = new Map();
  for (const p of asset.parts) { const node = new T.Group(); node.position.set(...p.translation); parts.set(p.id, node); }
  for (const p of asset.parts) (p.parent ? parts.get(p.parent) : group).add(parts.get(p.id));
  const system = new BossSystem(CONTENT), e = system.spawn(id, [0, 0, 0], options), record = { asset, group, parts, desc: { id: e.id, kind: 'boss', position: e.position } };
  return { asset, system, e, record, def: system.definitionFor(e) };
}
const pose = (r) => JSON.stringify([...r.parts].map(([id, n]) => [id, n.rotation.toArray(), n.position.toArray(), n.visible]));
function finitePose(record) {
  for (const part of record.asset.parts) {
    const node = record.parts.get(part.id); assert(node.matrixWorld.elements.every(Number.isFinite));
    assert.equal(node.parent, part.parent ? record.parts.get(part.parent) : record.group);
    assert.deepEqual(node.scale.toArray(), [1, 1, 1]);
    if (part.id !== 'root') assert.deepEqual(node.position.toArray(), part.translation, `pivot drift ${part.id}`);
  }
}

test('all eight actual boss rigs keep pivots/hierarchy while 24 phase poses and all 32 cast poses differ', async () => {
  let skills = 0, phases = 0;
  for (const definition of CONTENT.bosses.entries) {
    const { system, e, record, asset, def } = await setup(definition.id), originalAsset = JSON.stringify(asset);
    const phasePoses = new Set();
    for (let i = 0; i < 3; i++) { e.phaseIndex = i; const before = JSON.stringify(system.serialize()); animateBossModel(record, e, system, 2.3, 1 / 60); finitePose(record); phasePoses.add(pose(record)); assert.equal(JSON.stringify(system.serialize()), before); phases++; }
    assert.equal(phasePoses.size, 3, definition.id);
    e.phaseIndex = 0; const distinct = new Set();
    for (const skill of def.skills) {
      e.cast = { skillId: skill.id, stage: 'windup', windupS: skill.windupS, remaining: skill.windupS * .2 };
      const before = JSON.stringify(system.serialize()); animateBossModel(record, e, system, 2.3, 1 / 60); const warning = pose(record); finitePose(record);
      distinct.add(warning); assert.equal(JSON.stringify(system.serialize()), before);
      e.cast.stage = 'active'; e.cast.remaining = skill.activeS / 2; animateBossModel(record, e, system, 2.3, 1 / 60);
      assert.notEqual(pose(record), warning, skill.id); finitePose(record);
      const active = pose(record); e.cast.stage = 'recovery'; e.cast.remaining = skill.recoveryS / 2; animateBossModel(record, e, system, 2.3, 1 / 60);
      assert.notEqual(pose(record), active, skill.id); skills++;
    }
    assert.equal(distinct.size, 4, definition.id); assert.equal(JSON.stringify(asset), originalAsset);
  }
  assert.equal(skills, 32); assert.equal(phases, 24);
});

test('actual locomotion, broken organs and frozen grounded death poses never mutate gameplay or lose nested wings/rings', async () => {
  for (const definition of CONTENT.bosses.entries) {
    const { system, e, record } = await setup(definition.id);
    animateBossModel(record, e, system, 1, .1); const idle = pose(record);
    e.position.z += .2; animateBossModel(record, e, system, 1, .1); assert.notEqual(pose(record), idle);
    e.parts.core.broken = true; e.parts.locomotion.broken = true; record.desc.missingParts = ['core', 'locomotion'];
    animateBossModel(record, e, system, 1, .1);
    assert(record.parts.get('core').visible); assert(record.parts.get('core').userData.bossBroken);
    for (const [id, node] of record.parts) if (id.startsWith('locomotion')) assert(node.userData.bossBroken);
    e.defeated = true; e.cast = null; const before = JSON.stringify(system.serialize());
    animateBossModel(record, e, system, 2, .1); animateBossModel(record, e, system, 4, .1); const settled = pose(record);
    animateBossModel(record, e, system, 5, .1); assert.equal(pose(record), settled); assert.equal(JSON.stringify(system.serialize()), before); finitePose(record);
    const inverse = record.group.matrixWorld.clone().invert();
    for (const part of record.asset.parts) for (const box of part.boxes) {
      const m = new T.Matrix4().multiplyMatrices(inverse, record.parts.get(part.id).matrixWorld).elements;
      const y = m[1] * box.center[0] + m[5] * box.center[1] + m[9] * box.center[2] + m[13];
      const extent = (Math.abs(m[1]) * box.size[0] + Math.abs(m[5]) * box.size[1] + Math.abs(m[9]) * box.size[2]) / 2;
      assert(y - extent >= -1e-7, `${definition.id} corpse underground`);
    }
  }
});

test('logical boss damage regions use real part ancestry and authored weakpoint anchors', async () => {
  for (const definition of CONTENT.bosses.entries) {
    const { asset } = await setup(definition.id);
    for (const part of asset.parts) {
      if (part.id.startsWith('locomotion')) assert.equal(bossLogicalPart(asset, part.id), 'locomotion');
      else if (part.id === 'core') assert.equal(bossLogicalPart(asset, part.id), 'core');
    }
    for (const anchor of asset.anchors.filter((a) => a.purpose.includes('weak_point'))) assert.equal(bossLogicalPart(asset, anchor.partId), 'core');
  }
});

test('four explicit boss variants animate through their derived definitions on the preserved base rigs', async () => {
  for (const variant of CONTENT.bosses.variants) {
    const { asset, system, e, record, def } = await setup(variant.baseBossId, { contentVariantId: variant.id, tier: variant.tier });
    assert.equal(e.bossId, variant.baseBossId, 'entity identity remains the base asset ID');
    assert.equal(e.contentVariantId, variant.id);
    assert.equal(e.encounterTier, variant.tier);
    assert.equal(def.contentVariantId, variant.id);
    assert.equal(def.stats.maxHp, variant.stats.maxHp);
    assert.equal(asset.id, variant.baseBossId, 'variant reuses the authored rig');
    const originalAsset = JSON.stringify(asset), phasePoses = new Set();
    for (let i = 0; i < def.phases.length; i++) {
      e.phaseIndex = i;
      const saved = JSON.stringify(system.serialize());
      animateBossModel(record, e, system, 2.3, 1 / 60);
      finitePose(record); phasePoses.add(pose(record));
      assert.equal(JSON.stringify(system.serialize()), saved, 'variant rendering must not mutate simulation state');
    }
    assert.equal(phasePoses.size, 3, variant.id);
    const skillPoses = new Set();
    for (const skill of def.skills) {
      e.cast = { skillId: skill.id, stage: 'windup', windupS: skill.windupS, remaining: skill.windupS * .2 };
      const before = JSON.stringify(system.serialize());
      animateBossModel(record, e, system, 2.3, 1 / 60);
      finitePose(record); skillPoses.add(pose(record));
      assert.equal(JSON.stringify(system.serialize()), before, `${variant.id}:${skill.id}`);
    }
    assert.equal(skillPoses.size, 4, variant.id);
    assert.equal(JSON.stringify(asset), originalAsset);
  }
});

test('Rapier reads the same animated parent/joint matrices and omitted real parts as rendering', async () => {
  const { system, e, record, def } = await setup('observatory_sentinel');
  const runtime = { player: { x: 8, y: 0, z: 0 }, atlas: { isSolidCell: () => false, heightAt: () => 0 }, nearbyStructures: [] };
  const physics = await RuntimePhysics.create(runtime, null, { terrainRadius: 1 });
  try {
    e.phaseIndex = 1; const s = def.skills[0]; e.cast = { skillId: s.id, stage: 'windup', remaining: .5, windupS: s.windupS };
    animateBossModel(record, e, system, 2, 1 / 60); physics.synchronize(new Map([[e.id, record]]), runtime.player); physics.step(1 / 60);
    const node = record.parts.get('ring_side'), expected = node.getWorldQuaternion(new T.Quaternion());
    const actual = physics.parts.get(`${e.id}::ring_side`).entry.body.rotation();
    assert(expected.angleTo(new T.Quaternion(actual.x, actual.y, actual.z, actual.w)) < .001);
    record.desc.removedParts = ['projector']; animateBossModel(record, e, system, 2.1, .1); physics.synchronize(new Map([[e.id, record]]), runtime.player);
    assert(!record.parts.get('projector').visible); assert(!physics.parts.has(`${e.id}::projector`));
  } finally { physics.dispose(); }
});

test('death clock survives save/reload and resumed animation uses elapsed time instead of replaying the fall', async () => {
  const { system, e, record } = await setup('rootback_beast');
  system.tick(4); system.defeat(e); assert.equal(e.defeatedAt, system.time); system.tick(1.6);
  const saved = JSON.parse(JSON.stringify(system.serialize())), restored = new BossSystem(CONTENT, saved), dead = restored.get(e.id);
  assert.equal(restored.time, system.time); assert.equal(dead.defeatedAt, e.defeatedAt);
  animateBossModel(record, dead, restored, 200, .016);
  assert(Math.abs(record.parts.get('root').rotation.z - .9) < 1e-8);
});
