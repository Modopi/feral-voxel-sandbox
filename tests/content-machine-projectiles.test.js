import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { MachineSystem } from '../app/src/main/assets/content-runtime/machines.js';

const CONTENT = Object.fromEntries(['progression', 'environments', 'blocks'].map(name => [name, JSON.parse(fs.readFileSync(new URL(`../design/content/${name}.json`, import.meta.url)))]));
let serial = 0;
const grant = (p, items) => assert.equal(p.grant(items, { claimId: `projectile-test:${serial++}` }).ok, true);

function machineWithArcThrower() {
  const p = new Progression(CONTENT);
  p.research.add('power');
  grant(p, { field_bench: 1, scrap_iron: 4, mana_crystal_ore: 1, plant_fiber: 2 });
  assert.equal(p.installStation('field_bench').ok, true);
  const recipe = p.catalog.get('assemble_arc_thrower');
  assert.equal(recipe.energy && Object.keys(recipe.energy).length, 0, 'forge bootstrap is the power research gate; assembly needs no electrical bootstrap');
  assert.equal(p.queueCraft(recipe.id).ok, true);
  p.tick(recipe.seconds, { manual: true });
  assert.equal(p.count('arc_thrower'), 1);

  grant(p, { heat_engine: 1, generator: 1, battery: 1, raw_timber: 2, wood: 4 });
  const machines = new MachineSystem(CONTENT, p);
  const machineId = machines.create({ gridM: .1 }).machineId;
  const voxels = [0, 1, 2, 3].map(x => machines.attachVoxel(machineId, { cell: [x, 0, 0], materialId: 'wood' }).voxelId);
  const engineId = machines.installComponent(machineId, voxels[0], 'heat_engine').componentInstanceId;
  const generatorId = machines.installComponent(machineId, voxels[1], 'generator').componentInstanceId;
  const batteryId = machines.installComponent(machineId, voxels[2], 'battery').componentInstanceId;
  const gunId = machines.installComponent(machineId, voxels[3], 'arc_thrower').componentInstanceId;
  assert.equal(machines.connect(machineId, engineId, generatorId, 'mechanical').ok, true);
  assert.equal(machines.connect(machineId, generatorId, batteryId, 'electrical').ok, true);
  assert.equal(machines.connect(machineId, batteryId, gunId, 'electrical').ok, true);
  assert.equal(machines.refuel(machineId, engineId, 2).ok, true);
  return { p, machines, machineId, batteryId, gunId, engineId };
}

function pointFromMuzzle(machines, machineId, gunId, zOffset) {
  const machine = machines.machines.get(machineId), gun = machine.components.find(c => c.id === gunId);
  const voxel = machine.voxels.find(v => v.id === gun.voxelId), offset = machines.progression.catalog.get('arc_thrower').combat.muzzleOffsetM;
  return {
    x: machine.position.x + (voxel.cell[0] + .5) * machine.gridM + offset[0],
    y: machine.position.y + (voxel.cell[1] + .5) * machine.gridM + offset[1],
    z: machine.position.z + (voxel.cell[2] + .5) * machine.gridM + offset[2] + zOffset,
  };
}

test('arc_thrower is a normally crafted explicit component, not a motor or geometry-derived function', () => {
  const { p, machines, machineId, batteryId, gunId } = machineWithArcThrower();
  assert.equal(machines.ports(machineId, gunId).functions.includes('projectile_attack'), true);
  assert.equal(machines.ports(machineId, gunId).inputs.includes('electrical'), true);
  assert.equal(machines.ports(machineId, gunId).outputs.length, 0);
  const target = { id: 'target', kind: 'creature', point: pointFromMuzzle(machines, machineId, gunId, 4) };
  assert.equal(machines.fire(machineId, batteryId, { target, claimId: 'not-a-gun' }).reason, 'projectile_component_required');
  assert.equal(p.catalog.get('motor').functions.includes('projectile_attack'), false);
});

test('forge-to-power bootstrap needs no electrical assembly input; the real engine-generator-battery network charges 120 EU', () => {
  const { p, machines, machineId, batteryId, gunId } = machineWithArcThrower();
  const gun = () => machines.machines.get(machineId).components.find(c => c.id === gunId);
  machines.tick(30);
  assert.ok(Math.abs(gun().energy.electrical - 120) < 1e-6, 'two finite timber fuels drive heat_engine → generator → battery → arc_thrower');
  const far = { id: 'far-target', kind: 'creature', point: pointFromMuzzle(machines, machineId, gunId, 25) };
  const beforeRangeFailure = gun().energy.electrical;
  assert.equal(machines.fire(machineId, gunId, { target: far, claimId: 'far-shot' }).reason, 'out_of_range');
  assert.equal(gun().energy.electrical, beforeRangeFailure);
  const target = { id: 'creature:one', kind: 'creature', point: pointFromMuzzle(machines, machineId, gunId, 4) };
  const shot = machines.fire(machineId, gunId, { target, claimId: 'shot:one' });
  assert.equal(shot.ok, true);
  assert.equal(shot.blocked, false);
  assert.equal(shot.packet.amount, 30);
  assert.equal(shot.packet.energyEU, 20);
  assert.equal(shot.packet.attackMode, 'pierce');
  assert.equal(shot.packet.sourceId, machineId);
  assert.equal(shot.packet.excludeOwnerId, machineId);
  assert.deepEqual(shot.packet.rayOrigin, pointFromMuzzle(machines, machineId, gunId, 0));
  assert.ok(Math.abs(gun().energy.electrical - 100) < 1e-6);
  assert.equal(machines.fire(machineId, gunId, { target: { ...target, id: 'creature:two' }, claimId: 'shot:cooldown' }).reason, 'fire_cooldown');
  assert.ok(Math.abs(gun().energy.electrical - 100) < 1e-6);

  const saved = machines.serialize(), savedProgression = p.serialize();
  const resumed = new MachineSystem(CONTENT, new Progression(CONTENT, savedProgression), saved);
  const resumedGun = resumed.machines.get(machineId).components.find(c => c.id === gunId);
  const replay = resumed.fire(machineId, gunId, { target, claimId: 'shot:one' });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.packet.shotId, shot.packet.shotId);
  assert.ok(Math.abs(resumedGun.energy.electrical - 100) < 1e-6, 'save/retry cannot debit the same shot twice');
  assert.equal(resumed.fire(machineId, gunId, { target: { ...target, point: { ...target.point, z: target.point.z + .1 } }, claimId: 'shot:one' }).reason, 'claim_conflict');
});

test('shielded shots spend once, preserve blocked receipts, and do not consume reserve while idle', () => {
  const { machines, machineId, gunId } = machineWithArcThrower();
  const gun = () => machines.machines.get(machineId).components.find(c => c.id === gunId);
  machines.terrain = { hasLineOfSight: () => false };
  machines.tick(6);
  const target = { id: 'creature:shielded', kind: 'creature', point: pointFromMuzzle(machines, machineId, gunId, 4) };
  const beforeShot = gun().energy.electrical;
  const shot = machines.fire(machineId, gunId, { target, claimId: 'shot:shielded' });
  assert.equal(shot.ok, true);
  assert.equal(shot.blocked, true);
  const afterShot = gun().energy.electrical;
  assert.ok(afterShot >= 0 && afterShot < 10);
  assert.ok(Math.abs(beforeShot - afterShot - 20) < 1e-8);
  const idle = gun().energy.electrical;
  machines.tick(.5);
  assert.ok(Math.abs(gun().energy.electrical - idle - 2.12625) < .03, 'battery link charges the reserve; arc_thrower does not idle-drain it');
  const replay = machines.fire(machineId, gunId, { target, claimId: 'shot:shielded' });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.blocked, true);
  assert.ok(Math.abs(gun().energy.electrical - idle - 2.12625) < .03);
});

test('projectile receipts remain compact and retry-safe past the former 4096-shot limit', () => {
  const { p, machines, machineId, gunId } = machineWithArcThrower();
  machines.tick(30);
  const target = { id: 'long-run-target', kind: 'creature', point: pointFromMuzzle(machines, machineId, gunId, 4) };
  const signature = JSON.stringify({ targetId: target.id, kind: target.kind, point: target.point });
  const state = machines.serialize();
  const savedMachine = state.machines.find(row => row.id === machineId);
  const savedGun = savedMachine.components.find(row => row.id === gunId);
  savedGun.energy.electrical = 120;
  savedGun.nextFireAt = state.clock;
  savedGun.shotsFired = 4100;
  savedGun.fireLedger = Array.from({ length: 4100 }, (_, i) => ({
    claimId: `old-shot:${i}`,
    signature,
    shotId: `machine-shot:${machineId}:${gunId}:${i + 1}`,
  }));
  savedGun.fireCache = [];

  const resumed = new MachineSystem(CONTENT, new Progression(CONTENT, p.serialize()), state);
  const expiredReplay = resumed.fire(machineId, gunId, { target, claimId: 'old-shot:0' });
  assert.equal(expiredReplay.duplicate, true);
  assert.equal(expiredReplay.expired, true);
  const nextShot = resumed.fire(machineId, gunId, { target, claimId: 'new-shot:4101' });
  assert.equal(nextShot.ok, true);
  assert.equal(nextShot.packet.shotId, `machine-shot:${machineId}:${gunId}:4101`);
  assert.equal(resumed.machines.get(machineId).components.find(row => row.id === gunId).fireLedger.length, 4101);
});
