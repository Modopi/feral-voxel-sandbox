import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';

const grant = (progression, items, claimId) => {
  const result = progression.grant(items, { claimId });
  assert.equal(result.ok, true, result.reason);
};

function muzzleOf(machine, gun, offset) {
  const voxel = machine.voxels.find(row => row.id === gun.voxelId);
  assert.ok(voxel, 'the arc thrower is mounted to a real host voxel');
  // This fixture keeps the machine at identity rotation, so the mount-cell
  // center and component-authored local muzzle offset can be checked exactly.
  return {
    x: machine.position.x + (voxel.cell[0] + .5) * machine.gridM + offset[0],
    y: machine.position.y + (voxel.cell[1] + .5) * machine.gridM + offset[1],
    z: machine.position.z + (voxel.cell[2] + .5) * machine.gridM + offset[2],
  };
}

test('runtime arc thrower spends and damages once across save retry; LOS is controlled, not physical proof', async () => {
  const progression = new Progression(CONTENT);
  // The fixture starts with explicit power knowledge and paid inventory. The
  // component is still made through its normal field-bench recipe.
  progression.research.add('power');
  grant(progression, {
    field_bench: 1,
    scrap_iron: 4,
    mana_crystal_ore: 1,
    plant_fiber: 2,
  }, 'machine-fire:prepared-arc-thrower');
  assert.equal(progression.installStation('field_bench').ok, true);
  const recipe = progression.catalog.get('assemble_arc_thrower');
  assert.deepEqual(recipe.energy, {});
  assert.equal(progression.queueCraft(recipe.id).ok, true);
  progression.tick(recipe.seconds, { manual: true });
  assert.equal(progression.count('arc_thrower'), 1);

  grant(progression, {
    heat_engine: 1,
    generator: 1,
    battery: 1,
    raw_timber: 2,
    wood: 8,
  }, 'machine-fire:prepared-finite-power-network');

  const seed = 88231;
  const bootstrap = await ExpeditionRuntime.create(seed);
  const state = bootstrap.serialize();
  state.progression = progression.serialize();
  let runtime = await ExpeditionRuntime.create(seed, state);

  const built = runtime.machines.create({ position: [100, 100, 100], gridM: .1 });
  assert.equal(built.ok, true);
  const machineId = built.machineId;
  const hostIds = [0, 1, 2, 3].map(x => runtime.machines.attachVoxel(machineId, {
    cell: [x, 0, 0], materialId: 'wood',
  }).voxelId);
  const engineId = runtime.machines.installComponent(machineId, hostIds[0], 'heat_engine').componentInstanceId;
  const generatorId = runtime.machines.installComponent(machineId, hostIds[1], 'generator').componentInstanceId;
  const batteryId = runtime.machines.installComponent(machineId, hostIds[2], 'battery').componentInstanceId;
  const gunId = runtime.machines.installComponent(machineId, hostIds[3], 'arc_thrower').componentInstanceId;
  assert.equal(runtime.machines.connect(machineId, engineId, generatorId, 'mechanical').ok, true);
  assert.equal(runtime.machines.connect(machineId, generatorId, batteryId, 'electrical').ok, true);
  assert.equal(runtime.machines.connect(machineId, batteryId, gunId, 'electrical').ok, true);
  assert.equal(runtime.machines.refuel(machineId, engineId, 2).ok, true);
  runtime.machines.tick(30);

  const machine = runtime.machines.machines.get(machineId);
  const gun = machine.components.find(row => row.id === gunId);
  const combat = runtime.progression.catalog.get('arc_thrower').combat;
  assert.equal(gun.energy.electrical, 120, 'finite engine fuel charges the mounted component through the real links');
  const muzzle = muzzleOf(machine, gun, combat.muzzleOffsetM);
  const targetPoint = { x: muzzle.x, y: muzzle.y, z: muzzle.z + 4 };
  const creature = runtime.creatures.spawn('moss_deer', targetPoint, { id: 'runtime-fire-target' });
  const target = { id: creature.id, kind: 'creature', point: targetPoint };

  const lineChecks = [];
  let lineOfSight = true;
  runtime.physics = {
    hasAttackLineOfSight(from, to, options) {
      lineChecks.push({ from: { ...from }, to: { ...to }, options: { ...options } });
      return lineOfSight;
    },
  };
  runtime.drivingMachineId = machineId;
  const shotClaim = 'runtime-machine-shot:replay-me';
  const realId = runtime.id.bind(runtime);
  runtime.id = prefix => prefix === 'machine-shot' ? shotClaim : realId(prefix);

  const hpBefore = creature.hp;
  const first = runtime.fireMachine(target);
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.packet.amount, 30);
  assert.equal(first.packet.sourceId, machineId);
  assert.equal(first.packet.excludeOwnerId, machineId);
  assert.deepEqual(first.packet.rayOrigin, muzzle, 'the combat origin is the mounted muzzle, not the player or caller');
  assert.equal(first.damage.ok, true);
  assert.equal(creature.hp, hpBefore - first.damage.hpLost, 'the first shot applies one reported HP delta');
  assert.ok(first.damage.hpLost > 0 && first.damage.hpLost <= first.packet.amount);
  assert.equal(gun.energy.electrical, 100, 'one valid shot debits exactly 20 EU');
  assert.deepEqual(lineChecks[0].from, muzzle);
  assert.deepEqual(lineChecks[0].to, targetPoint);
  assert.deepEqual(lineChecks[0].options, { excludeOwnerId: machineId, targetOwnerId: creature.id });

  // Runtime state save includes the component receipt and already-applied HP.
  // Returning the historical claim through runtime.id simulates retrying the
  // same operation after reload; it must bypass both debit and damage.
  const saved = runtime.serialize();
  runtime = await ExpeditionRuntime.create(seed, saved);
  runtime.drivingMachineId = machineId;
  const resumedCreature = runtime.creatures.get(creature.id);
  const resumedGun = runtime.machines.machines.get(machineId).components.find(row => row.id === gunId);
  const hpAfterFirst = resumedCreature.hp;
  const energyAfterFirst = resumedGun.energy.electrical;
  runtime.physics = {
    hasAttackLineOfSight(from, to, options) {
      lineChecks.push({ from: { ...from }, to: { ...to }, options: { ...options } });
      return lineOfSight;
    },
  };
  const resumedId = runtime.id.bind(runtime);
  runtime.id = prefix => prefix === 'machine-shot' ? shotClaim : resumedId(prefix);
  lineChecks.length = 0;
  const retry = runtime.fireMachine(target);
  assert.equal(retry.duplicate, true);
  assert.equal(resumedCreature.hp, hpAfterFirst, 'saved replay cannot apply HP twice');
  assert.equal(resumedGun.energy.electrical, energyAfterFirst, 'saved replay cannot charge the same shot twice');
  assert.equal(lineChecks.length, 0, 'a replay does not retrace or reapply its packet');

  // The next distinct shot is paid even when a controlled physics LOS result
  // blocks delivery. This verifies runtime handoff behavior, not Rapier geometry.
  runtime.machines.tick(1.25);
  const beforeBlockedHp = resumedCreature.hp;
  const beforeBlockedEnergy = resumedGun.energy.electrical;
  lineOfSight = false;
  runtime.id = prefix => prefix === 'machine-shot' ? 'runtime-machine-shot:blocked' : resumedId(prefix);
  const blocked = runtime.fireMachine(target);
  assert.equal(blocked.ok, true);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.damage, undefined);
  assert.equal(resumedCreature.hp, beforeBlockedHp, 'blocked delivery does not change target HP');
  assert.equal(resumedGun.energy.electrical, beforeBlockedEnergy - 20, 'a valid but blocked shot spends one 20-EU budget');
  assert.deepEqual(lineChecks[0].options, { excludeOwnerId: machineId, targetOwnerId: creature.id });
});
