import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { Armaments, ARMAMENT_PATTERNS } from '../app/src/main/assets/content-runtime/armaments.js';

const CONTENT = Object.fromEntries(['progression'].map(name => [name, JSON.parse(fs.readFileSync(new URL(`../design/content/${name}.json`, import.meta.url)))]));
let serial = 0;
const grant = (p, items) => assert.equal(p.grant(items, { claimId: `armament-test:${serial++}` }).ok, true);
const makeWorkbench = p => { grant(p, { field_bench: 1 }); assert.equal(p.installStation('field_bench').ok, true); };

function woodCraftFixture() {
  const p = new Progression(CONTENT);
  const beforeBaselines = Array.from({ length: 10 }, (_, i) => {
    const e = p.catalog.get(`gear_baseline_t${i + 1}`);
    return [e.hp, e.damageReduction, e.stationaryDps, e.hitDamage];
  });
  grant(p, { wood: 2, plant_fiber: 1 });
  makeWorkbench(p);
  p.research.add('material:wood');
  return { p, beforeBaselines, armaments: new Armaments(p) };
}

test('weapon patterns are separate from the 55 existing equipment results and reference only catalog materials', () => {
  const p = new Progression(CONTENT);
  const oldResults = p.entries.filter(e => ['tool', 'station', 'component', 'gear_baseline'].includes(e.kind) && e.id !== 'arc_thrower');
  const currentResults = p.entries.filter(e => ['tool', 'station', 'component', 'gear_baseline'].includes(e.kind));
  const patterns = p.entries.filter(e => e.kind === 'weapon_pattern');
  assert.equal(oldResults.length, 55); // 53 + wrench and grapple (0.15.7)
  assert.equal(currentResults.length, 56);
  assert.equal(patterns.length, 3);
  assert.deepEqual(patterns.map(e => e.id), [...ARMAMENT_PATTERNS]);
  assert.ok(patterns.every(e => !p.items.has(e.id)), 'a shape parameter must not create an inventory item');
  for (const row of patterns) {
    assert.equal(row.slot, 'main_hand');
    assert.ok(p.catalog.get(row.shapeId) === row);
    assert.ok(p._quantities(row.additionalInputs));
    assert.equal(row.origin.type, 'parameterized_craft');
    assert.equal(row.origin.recipe, 'selected material origin.recipe');
  }
  const materials = p.entries.filter(e => e.kind === 'material');
  assert.equal(materials.length, 31);
  for (const material of materials) {
    const recipe = p.catalog.get(material.origin.recipe);
    assert.equal(recipe?.kind, 'recipe', `${material.id} has a real origin recipe`);
    assert.equal(p.catalog.get(recipe.station)?.kind, 'station', `${material.id} recipe has a real station`);
    assert.ok(!Object.hasOwn(recipe.inputs, 'copper_wire'));
  }
  const arc = p.catalog.get('arc_thrower'), arcRecipe = p.catalog.get(arc.origin.recipe);
  assert.equal(arc.kind, 'component');
  assert.deepEqual(arc.functions, ['projectile_attack']);
  assert.equal(arc.capacity, 120);
  assert.equal(arc.combat.energyPerShotEu, 20);
  assert.equal(arc.combat.rangeM, 24);
  assert.equal(arc.combat.attackPeriodS, 1.25);
  assert.equal(arc.combat.damageHp, 30);
  assert.equal(arcRecipe.outputs.arc_thrower, 1);
  assert.ok(Object.keys(arcRecipe.inputs).every(id => p.items.has(id)));
});

test('quote enforces the selected material recipe research and actual station, then crafts with real costs and time', () => {
  const p = new Progression(CONTENT);
  grant(p, { wood: 2, plant_fiber: 1, field_bench: 1 });
  const armaments = new Armaments(p);
  assert.equal(armaments.quote('weapon_slash', 'wood').reason, 'research_required');
  p.research.add('material:wood');
  assert.equal(armaments.quote('weapon_slash', 'wood').reason, 'station_required');
  assert.equal(armaments.quote('weapon_slash', 'wood', 'forge').reason, 'station_required', 'a caller cannot substitute an arbitrary station');
  assert.equal(p.installStation('field_bench').ok, true);

  const q = armaments.quote('weapon_slash', 'wood');
  assert.equal(q.ok, true);
  assert.equal(q.station, 'field_bench');
  assert.equal(q.research, 'material:wood');
  assert.deepEqual(q.inputs, { wood: .65, plant_fiber: .1 });
  assert.equal(q.seconds, 25);
  assert.equal(q.attackMode, 'strike');
  assert.equal(q.range, 2.8);
  assert.equal(q.attackPeriod, .55);
  const before = [p.count('wood'), p.count('plant_fiber')];
  const started = armaments.craft(q.id, q.materialId);
  assert.equal(started.ok, true);
  assert.equal(p.count('wood'), before[0] - .65);
  assert.equal(p.count('plant_fiber'), before[1] - .1);
  assert.deepEqual(Object.keys(p.inventory).filter(id => id.startsWith('armament:')), []);
  assert.equal(armaments.craft(q.id, q.materialId).reason, 'workbench_busy');
  const saved = armaments.serialize();
  const restored = new Armaments(p, saved);
  assert.equal(restored.jobs[0].inputs.wood, .65);
  assert.equal(restored.jobs[0].seconds, 25);
  restored.tick(24.9);
  assert.equal(restored.weapons.length, 0);
  restored.tick(.1);
  assert.equal(restored.weapons.length, 1);
  assert.equal(restored.jobs.length, 0);
  const weapon = restored.weapons[0];
  const wood = p.catalog.get('wood');
  const baseline = p.catalog.get('gear_baseline_t1');
  assert.equal(weapon.materialId, 'wood');
  assert.equal(weapon.materialTier, 1);
  assert.equal(weapon.massKg, .4);
  assert.equal(weapon.maxDurability, Math.floor(wood.properties.cellHp * .45 * 1.8));
  assert.equal(weapon.hitDamage, baseline.stationaryDps * .55 * 1.05);
  assert.equal(weapon.range, 2.8);
  assert.equal(weapon.attackPeriod, .55);
  assert.equal(weapon.attackMode, 'strike');
  assert.equal(p.items.has(weapon.id), false);
  assert.equal(p.catalog.get('gear_baseline_t1').hp, 100);
  assert.equal(p.catalog.get('gear_baseline_t1').damageReduction, 0);
  const forgedStats = restored.serialize();
  forgedStats.weapons[0].massKg += 1;
  assert.throws(() => new Armaments(p, forgedStats), /Invalid saved armament/);
});

test('equipping, cooldown, durability, serialization, death drain and recovery preserve the exact weapon record', () => {
  const { p, beforeBaselines, armaments } = woodCraftFixture();
  assert.equal(armaments.craft('weapon_pierce', 'wood').ok, true);
  armaments.tick(25);
  const weapon = armaments.weapons[0];
  const original = structuredClone(weapon);
  assert.deepEqual(armaments.equippedAsset(), null);
  assert.equal(armaments.equip(weapon.id).ok, true);
  assert.deepEqual(armaments.equippedAsset(), { id: weapon.id, shapeId: 'weapon_pierce', slot: 'main_hand', materialId: 'wood' });
  const attack = armaments.recordAttack({ distanceM: 4.4, at: 10, claimId: 'swing:1' });
  assert.equal(attack.ok, true);
  assert.equal(attack.attackMode, 'pierce');
  assert.equal(armaments.recordAttack({ distanceM: 2, at: 10.1 }).reason, 'attack_cooldown');
  assert.equal(armaments.recordAttack({ distanceM: 4.41, at: 11 }).reason, 'out_of_range');
  const afterOneSwing = weapon.durability;
  const replay = armaments.recordAttack({ distanceM: 4.4, at: 10, claimId: 'swing:1' });
  assert.equal(replay.duplicate, true);
  assert.equal(weapon.durability, afterOneSwing);
  for (let i = 0; i < 520; i++) {
    armaments.attackClaims.push({
      claimId: `archived-swing:${i}`,
      weaponId: weapon.id,
      signature: `${weapon.id}:1`,
      result: { id: weapon.id },
    });
  }

  const restored = new Armaments(p, armaments.serialize());
  assert.equal(restored.attackClaims.length, 521);
  const carried = restored.drainCarried();
  assert.equal(carried.length, 1);
  assert.equal(carried[0].id, original.id);
  assert.equal(carried[0].durability, original.maxDurability - 1);
  assert.equal(restored.equippedId, null);
  const recovery = new Armaments(p);
  assert.deepEqual(recovery.recoverCarried(carried), { acceptedIds: [weapon.id], remaining: [] });
  assert.equal(recovery.weapons[0].materialId, original.materialId);
  assert.equal(recovery.weapons[0].durability, original.maxDurability - 1);
  assert.deepEqual(recovery.recoverCarried(carried), { acceptedIds: [weapon.id], remaining: [] }, 'recovery replay does not duplicate a weapon');
  const deadSave = new Armaments(p, restored.serialize());
  const oldClaim = deadSave.recordAttack({ distanceM: 1, at: 10, claimId: 'archived-swing:0' });
  assert.equal(oldClaim.duplicate, true, 'old attack claims remain idempotent after the weapon is moved to the death ledger');
  const currentBaselines = Array.from({ length: 10 }, (_, i) => {
    const e = p.catalog.get(`gear_baseline_t${i + 1}`);
    return [e.hp, e.damageReduction, e.stationaryDps, e.hitDamage];
  });
  assert.deepEqual(currentBaselines, beforeBaselines);
});

test('rack holds eight carried weapons plus one equipped item and retains overflow for retry', () => {
  const { p, armaments } = woodCraftFixture();
  assert.equal(armaments.craft('weapon_blunt', 'wood').ok, true);
  armaments.tick(25);
  const sample = armaments.weapons[0];
  armaments.weapons = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(sample), id: `armament:${100 + i}` }));
  const ninth = { ...structuredClone(sample), id: 'armament:200' };
  let result = armaments.recoverCarried([ninth]);
  assert.equal(result.acceptedIds.length, 0);
  assert.equal(result.remaining[0].id, ninth.id);
  armaments.equip(armaments.weapons[0].id);
  result = armaments.recoverCarried([ninth]);
  assert.deepEqual(result, { acceptedIds: [ninth.id], remaining: [] });
  assert.equal(armaments.weapons.length, 9);
  assert.equal(armaments.equip(null).reason, 'rack_full');
});
