// Rotor flight on the unified runtime (S2c2): a driven rotorcraft climbs, holds, cruises and descends by the
// pitch and throttle inputs in real Rapier, and its rotors stop when nobody steers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { MachineSystem, ROTOR_FLIGHT } from '../app/src/main/assets/content-runtime/machines.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';

const content = Object.fromEntries(['environments', 'blocks', 'creatures', 'structures', 'bosses', 'progression']
  .map((key) => [key, JSON.parse(fs.readFileSync(new URL(`../design/content/${key}.json`, import.meta.url)))]));
const flat = () => ({ revision: 0, isSolidCell: (_x, y) => y < 0, heightAt: () => 0 });

// A 3×3 wooden deck (0.1 m grid). One rotor: two batteries feed one motor and a rotor transmission in the middle.
// Two rotors: each battery feeds its own motor and rotor at opposite corners. A controller completes the craft.
const LAYOUTS = {
  one: { battery: ['0,1', '2,1'], motor: ['1,0'], rotor: ['1,1'], controller: '1,2', links: [[0, 0], [1, 0]] },
  two: { battery: ['0,1', '2,1'], motor: ['1,0', '1,2'], rotor: ['0,0', '2,2'], controller: '1,1', links: [[0, 0], [1, 1]] },
};
async function rotorcraft(layout = 'one') {
  const plan = LAYOUTS[layout], progression = new Progression(content), parts = ['battery', 'motor', 'transmission', 'controller'];
  progression.grant({ wood: 100, battery: 2, motor: plan.motor.length, transmission: plan.rotor.length, controller: 1 }, { claimId: 'flight-parts' });
  for (const part of parts) progression.discover(progression.catalog.get(progression.catalog.get(part).research).blueprint, { origin: 'discovery', claimId: `flight-research:${part}` });
  const machines = new MachineSystem(content, progression), id = machines.create({ position: [0, .02, 0], gridM: .1 }).machineId, voxel = {};
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) voxel[`${x},${z}`] = machines.attachVoxel(id, { cell: [x, 0, z], materialId: 'wood' }).voxelId;
  const install = (cell, componentId, options) => machines.installComponent(id, voxel[cell], componentId, options).componentInstanceId;
  const batteries = plan.battery.map((c) => install(c, 'battery')), motors = plan.motor.map((c) => install(c, 'motor'));
  const rotorIds = plan.rotor.map((c) => install(c, 'transmission', { legacyType: 'rotor' })), controller = install(plan.controller, 'controller');
  for (const [b, motor] of plan.links) assert.ok(machines.connect(id, batteries[b], motors[motor], 'electrical').ok);
  motors.forEach((motor, i) => assert.ok(machines.connect(id, motor, rotorIds[Math.min(i, rotorIds.length - 1)], 'mechanical').ok));
  const m = machines.machines.get(id);
  for (const c of m.components) if (c.componentId === 'battery') c.energy.electrical = 400; // prepared charge
  const rt = { atlas: flat(), player: { x: 0, y: .02, z: 0, hp: 100 }, nearbyStructures: [], machines, progression };
  const physics = await RuntimePhysics.create(rt, null, { terrainRadius: 2 }); physics.synchronize(new Map(), rt.player);
  const fly = (seconds, command) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      if (command) machines.control(id, command);
      rt.player.x = m.position.x; rt.player.z = m.position.z; physics.step(1 / 60);
    }
  };
  return { machines, m, id, physics, fly, controller, rotorIds };
}

test('a driven rotorcraft climbs, holds altitude, cruises and descends by its inputs, and drops when nobody steers', async () => {
  const { machines, m, id, physics, fly } = await rotorcraft();
  try {
    const mass = machines.evaluate(id).mass;
    assert.ok(mass > 70 && mass < 90, `craft mass ${mass}`);
    fly(.5, { throttle: 0, steer: 0, pitch: 0 });
    assert.ok(Math.abs(m.position.y - .02) < .2, 'holding with no climb input stays near the ground');
    fly(3, { throttle: 0, steer: 0, pitch: 1 });
    const climbed = m.position.y;
    assert.ok(climbed > 5, `climbs at about ${ROTOR_FLIGHT.climbMS} m/s: ${climbed.toFixed(2)} m`);
    fly(2, { throttle: 0, steer: 0, pitch: 0 });
    assert.ok(Math.abs(m.position.y - climbed) < 1.5 && Math.abs(m.velocity.y) < .5, `holds altitude: ${m.position.y.toFixed(2)} m, ${m.velocity.y.toFixed(2)} m/s`);
    const tilt = Math.hypot(m.rotation.x, m.rotation.z);
    assert.ok(tilt < .1, `stays level: ${tilt.toFixed(3)}`);
    const start = { x: m.position.x, z: m.position.z };
    fly(4, { throttle: 1, steer: 0, pitch: 0 });
    const speed = Math.hypot(m.velocity.x, m.velocity.z), travelled = Math.hypot(m.position.x - start.x, m.position.z - start.z);
    assert.ok(speed > 6 && travelled > 15, `cruises: ${speed.toFixed(1)} m/s, ${travelled.toFixed(1)} m in 4 s`);
    const braking = m.position.y;
    fly(1, { throttle: 0, steer: 0, pitch: 0, brake: true });
    assert.ok(Math.abs(m.position.y - braking) < 1.5 && Math.hypot(m.velocity.x, m.velocity.z) < 3, 'braking in the air slows the craft and keeps the rotors running');
    const high = m.position.y;
    fly(1.5, { throttle: 0, steer: 0, pitch: -1 });
    assert.ok(m.position.y < high - 2 && m.velocity.y < -1, 'descends');
    const before = m.position.y;
    fly(1);
    assert.ok(m.position.y < before - 2, 'without a steering command the rotors stop and it falls');
    assert.ok(m.metrics.consumed > 0);
  } finally { physics.dispose(); }
});

test('rotor lift is limited by rotor power, and a lost rotor tips the craft', async () => {
  const { machines, m, id, physics, fly, rotorIds } = await rotorcraft('two');
  try {
    fly(2, { throttle: 0, steer: 0, pitch: 1 });
    assert.ok(m.position.y > 1.5, `two rotors climb: ${m.position.y.toFixed(2)} m`);
    assert.ok(Math.hypot(m.rotation.x, m.rotation.z) < .1, 'balanced rotors stay level');
    const packet = machines._physicsForces(m, 1 / 60), lift = packet.forces.slice(1).reduce((n, f) => n + Math.hypot(f.force.x, f.force.y, f.force.z), 0);
    const power = m.metrics ? m.components.filter((c) => c.legacyType === 'rotor').length * 30 * .9 : 0;
    assert.ok(lift <= power * ROTOR_FLIGHT.liftNPerEU + 1e-6, `lift ${lift.toFixed(0)} N within capacity`);
    m.components.find((c) => c.id === rotorIds[0]).active = false;
    const spin = Math.hypot(m.angularVelocity.x, m.angularVelocity.z);
    fly(1, { throttle: 0, steer: 0, pitch: 0 });
    assert.ok(Math.hypot(m.angularVelocity.x, m.angularVelocity.z) > spin + .05 || Math.hypot(m.rotation.x, m.rotation.z) > .05, 'one-sided lift changes the attitude');
  } finally { physics.dispose(); }
});

test('leaving a machine steps off beside it on free ground, or above it when every side is blocked', () => {
  const runtime = new ExpeditionRuntime(7, null, new Map(), { config: { configVersion: 1, preset: 'expedition', seed: 7, terrain: { generator: 'infinite' }, rules: { survival: true } } });
  const g = runtime.progression, s = runtime.machines, p = runtime.player;
  g.grant({ wood: 100 }, { claimId: 'dismount-wood' });
  const ground = runtime.atlas.heightAt(p.x + 4, p.z), id = s.create({ position: [p.x + 4, ground + .02, p.z], gridM: .1 }).machineId;
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) s.attachVoxel(id, { cell: [x, 0, z], materialId: 'wood' });
  const m = s.machines.get(id); runtime.drivingMachineId = id; m.velocity.y = -2;
  const at = runtime.leaveMachine();
  assert.equal(runtime.drivingMachineId, null);
  const center = s.evaluate(id).center, distanceFromCenter = Math.hypot(at.x - (m.position.x + center[0]), at.z - (m.position.z + center[2]));
  assert.ok(Math.abs(distanceFromCenter - (Math.hypot(.1, .1) + .05 + .8)) < .05, `steps ${distanceFromCenter.toFixed(2)} m from the centre`);
  assert.ok(Math.abs(p.y - Math.max(runtime.atlas.heightAt(at.x, at.z), m.position.y + center[1])) < 1e-9);
  assert.equal(p.vy, -2, 'keeps the machine vertical speed');
  runtime.isSolid = () => true; runtime.drivingMachineId = id;
  const above = runtime.leaveMachine();
  assert.ok(Math.abs(above.y - (m.position.y + center[1] + 2.5)) < 1e-9 && p.vy === 0, 'emergency exit above');
  assert.equal(runtime.leaveMachine(), null, 'not driving: nothing to leave');
});
