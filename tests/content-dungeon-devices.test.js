import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DungeonSystem } from '../app/src/main/assets/content-runtime/dungeons.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';

const read = name => JSON.parse(readFileSync(new URL(`../design/content/${name}.json`, import.meta.url)));
const catalog = Object.fromEntries(['blocks', 'structures', 'progression', 'environments', 'bosses', 'creatures'].map(name => [name, read(name)]));
const make = (state = null) => new DungeonSystem({ catalog, seed: 714, state });
const world = (instance, local) => local.map((v, i) => v + instance.origin[i]);
let receiptNumber = 0;
const receipt = prefix => `${prefix}:${receiptNumber++}`;
const grant = (progression, items, prefix = 'device-test') => progression.grant(items, { claimId: receipt(prefix) });
function installRequired(dungeons, instance, progression) {
  for (const anchor of dungeons.definition(instance.id).puzzle.componentAnchors) {
    grant(progression, { [anchor.componentId]: 1 });
    const position = world(instance, anchor.positionM);
    const result = dungeons.devices.act(instance.id, `install:${anchor.id}`, { position, progression, claimId: receipt('install') });
    assert.equal(result.ok, true, `${anchor.componentId}: ${result.reason}`);
  }
}
const fixture = (ownerId, assetId, position) => ({ ownerId, assetId, kind: 'component', position, health: 100, maxHealth: 100, active: true });

test('root manor opens only through powered gate travel; range, pose, collision and destructive bypass persist', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('root_manor', 'gate-device', [320, 2, 160]);
  const device = d.devices, anchor = d.definition(i.id).puzzle.componentAnchors[0], position = world(i, anchor.positionM);
  const gate = device.geometry(i.id).find(box => box.partId === 'puzzle_gate');
  assert(gate?.collision && gate.devicePart && gate.role === 'dungeon_device');
  assert.equal(device.status(i.id, { progression: p }).actions.find(a => a.id === 'lift_gate').hold, true);
  grant(p, { joint: 1 });
  assert.equal(device.act(i.id, `install:${anchor.id}`, { position, progression: p, claimId: receipt('install') }).ok, true);
  assert.equal(device.act(i.id, 'lift_gate', { position: world(i, [60, 0, 0]), progression: p }).reason, 'out_of_range');
  assert.equal(device.act(i.id, 'lift_gate', { position, progression: p }).ok, true);
  device.update(.5, { manualInstanceId: i.id, position });
  assert.equal(i.deviceState.work.progressM, .5);
  const moved = device.geometry(i.id).find(box => box.partId === 'puzzle_gate');
  assert.equal(moved.center[1], gate.center[1] + .5);
  device.update(4, { manualInstanceId: i.id, position: world(i, [60, 0, 0]) });
  assert.equal(i.deviceState.work.progressM, .5, 'remote held input is ignored');
  device.update(4, { manualInstanceId: i.id, position });
  assert.equal(i.puzzle.phase, 'open');
  assert.equal(i.deviceState.solved, true);
  assert.equal(device.geometry(i.id).find(box => box.partId === 'puzzle_gate').center[1], gate.center[1] + 4.5);
  const broken = device.damage(i.id, 'puzzle_gate', 1000);
  assert.equal(broken.removed, true);
  assert.equal(i.deviceState.solved, false, 'destroying the visible gate never awards puzzle completion');
  assert.equal(device.geometry(i.id).some(box => box.partId === 'puzzle_gate'), false);
  const reloaded = make(d.serialize());
  assert.equal(reloaded.devices.geometry(i.id).some(box => box.partId === 'puzzle_gate'), false);
  assert.equal(reloaded.get(i.id).deviceState.work.progressM, 4.5);
});

test('60 Hz gate operation snaps to the clearance threshold without a floating-point stall', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('root_manor', 'gate-fixed-step', [320, 2, 160]);
  const anchor = d.definition(i.id).puzzle.componentAnchors[0], position = world(i, anchor.positionM);
  installRequired(d, i, p);
  const start = d.devices.geometry(i.id).find(box => box.partId === 'puzzle_gate');
  assert.equal(d.devices.act(i.id, 'lift_gate', { position, progression: p }).ok, true);
  for (let frame = 0; frame < 300; frame++) d.update(1 / 60, { manualInstanceId: i.id, position });
  assert.equal(i.deviceState.work.progressM, 4.5);
  assert.equal(i.puzzle.phase, 'open');
  assert.equal(d.devices.geometry(i.id).find(box => box.partId === 'puzzle_gate').center[1], start.center[1] + 4.5);
});

test('fixture supply checks a real local output store and drains finite EU into device reserve', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('root_manor', 'wired-gate', [128, 2, 64]);
  grant(p, { inertial_cell: 1, wood: 2 });
  const target = world(i, d.definition(i.id).puzzle.componentAnchors[0].positionM);
  const sourcePosition = { x: target[0] + 1, y: target[1], z: target[2] };
  const records = [fixture('store:mechanical', 'inertial_cell', sourcePosition), fixture('passive:shaft', 'transmission', { x: sourcePosition.x + 1, y: 0, z: sourcePosition.z })];
  p.supplyEnergy('mechanical', 50, { claimId: receipt('personal-energy') });
  assert.equal(p.syncWorldFixtures(records, { accessibleOwnerIds: records.map(r => r.ownerId) }).ok, true);
  assert.equal(p.fixtureEnergy.charge('store:mechanical', 'mechanical', 50, { claimId: receipt('store-charge'), fromLegacyEscrow: true }).ok, true);
  const connected = d.devices.connectSupply(i.id, 'store:mechanical', 'mechanical', { progression: p, claimId: receipt('cable') });
  assert.equal(connected.ok, true);
  assert.equal(d.devices.connectSupply(i.id, 'passive:shaft', 'mechanical', { progression: p, claimId: receipt('invalid-port') }).reason, 'output_port_required');
  const drainClaim = receipt('drain');
  const drained = d.devices.charge(i.id, 'mechanical', 25, { progression: p, claimId: drainClaim });
  assert.equal(drained.transferredEU, 25);
  assert.equal(p.fixtureEnergy.nodes.get('store:mechanical').energy.mechanical, 25);
  assert.equal(d.devices.charge(i.id, 'mechanical', 25, { progression: p, claimId: drainClaim }).duplicate, true);
  assert.equal(p.fixtureEnergy.nodes.get('store:mechanical').energy.mechanical, 25);
  const saved = make(d.serialize());
  assert.equal(saved.devices.status(i.id, { progression: p }).supplies[0].deviceEU, 25);
  assert.equal(saved.devices.status(i.id, { progression: p }).supplies[0].ownerId, 'store:mechanical');
});

test('floodworks pump conserves its separate 400L circuit and samples exactly the 4m² pool', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('floodworks', 'acid-circuit', [640, 0, 320]);
  installRequired(d, i, p);
  const start = world(i, [35, .05, 0]);
  assert.equal(d.devices.sampleAt(start).acidDps, 6);
  assert.equal(i.deviceState.ecologyBasin.volumeLiters, 48000);
  assert.equal(d.devices.act(i.id, 'start_pump', { position: world(i, [21, 0, -4]), progression: p }).ok, true);
  d.update(20, { manualInstanceId: i.id, position: world(i, [21, 0, -4]) });
  assert(Math.abs(i.deviceState.fluid.sourceLiters - 200) < 1e-8);
  assert.equal(i.deviceState.fluid.receiverLiters, 200);
  assert.equal(i.deviceState.fluid.sourceLiters + i.deviceState.fluid.receiverLiters + i.deviceState.fluid.spilledLiters, 400);
  assert.equal(i.deviceState.ecologyBasin.volumeLiters, 48000);
  assert.equal(i.puzzle.phase, 'open');
  const surface = d.devices.geometry(i.id).find(box => box.partId === 'fluid_surface');
  assert.deepEqual(surface.size, [4, .05, 1]);
  assert.equal(d.devices.sampleAt(world(i, [35, .025, 0])).acidDps, 0);
  assert.equal(d.devices.sampleAt(world(i, [35, .075, 0])), null, 'risk sampling stops at the liquid top');
});

test('60 Hz flood pumping reaches the exact 0.05 m safe-depth threshold', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('floodworks', 'flood-fixed-step', [640, 0, 320]);
  installRequired(d, i, p);
  const position = world(i, [21, 0, -4]);
  assert.equal(d.devices.act(i.id, 'start_pump', { position, progression: p }).ok, true);
  for (let frame = 0; frame < 1199; frame++) d.update(1 / 60, { manualInstanceId: i.id, position });
  assert.equal(i.deviceState.solved, false);
  d.update(1 / 60, { manualInstanceId: i.id, position });
  assert(Math.abs(i.deviceState.fluid.sourceLiters - 200) < 1e-8);
  assert.equal(i.puzzle.phase, 'open');
});

test('foundry exhausts a finite heat source but has enough finite coolant to reach the safe band', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('geothermal_foundry', 'finite-heat', [960, 0, 640]);
  installRequired(d, i, p);
  d.update(40);
  assert.equal(i.deviceState.heat.sourceEU, 0);
  assert.equal(i.deviceState.heat.pathEU, 1000);
  assert.equal(d.devices.act(i.id, 'close_valve', { position: world(i, [21, 0, -4]), progression: p }).ok, true);
  assert.equal(d.devices.act(i.id, 'start_cooling', { position: world(i, [21, 0, -4]), progression: p }).ok, true);
  d.update(14, { manualInstanceId: i.id, position: world(i, [21, 0, -4]) });
  assert(i.deviceState.heat.pathEU <= 200);
  assert.equal(i.deviceState.heat.pathEU + i.deviceState.heat.coolantHeatEU + i.deviceState.heat.sourceEU + i.deviceState.heat.lossEU, 1000);
  assert.equal(i.deviceState.heat.coolantLiters, 6);
  assert.equal(i.puzzle.phase, 'open');
  const sample = d.devices.sampleAt(world(i, [34, .04, 0]));
  assert.equal(sample?.heatC, 36);
  assert.equal(sample.safe, true, 'solved thermal state remains below the hazard threshold');
});

test('inertia brake integrates power, speed and position; platform hazard requires feet at its top', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('inertia_tower', 'inertia-state', [1280, 0, 960]);
  installRequired(d, i, p);
  const feet = world(i, [32.75, .525, 0]);
  assert.deepEqual(d.devices.sampleAt(feet).platformVelocity, { x: 1, y: 0, z: 0 });
  assert.equal(d.devices.sampleAt(world(i, [32.75, 2, 0])), null);
  assert.equal(d.devices.act(i.id, 'engage_brake', { position: world(i, [21, 0, -4]), progression: p }).ok, true);
  d.update(2.5, { manualInstanceId: i.id, position: world(i, [21, 0, -4]) });
  assert(Math.abs(i.deviceState.motion.positionM - 4) < 1e-7);
  assert.equal(i.deviceState.motion.velocityMps, 0);
  assert.equal(i.deviceState.motion.capturedEU + i.deviceState.motion.lostEU, 2.5);
  assert.equal(d.devices.act(i.id, 'lock_platform', { position: world(i, [21, 0, -4]), progression: p }).ok, true);
  assert.equal(i.puzzle.phase, 'open');
  const q = make(d.serialize());
  assert.equal(q.get(i.id).deviceState.motion.positionM, 4);
  assert.equal(q.devices.sampleAt(world(q.get(i.id), [34, .525, 0])).platformVelocity.x, 0);
});

test('damage hides persistent vane, altar and platform parts without completing or respawning them', () => {
  const d = make();
  for (const [templateId, site, partId, local] of [
    ['cliff_observatory', 'vane', 'windvane', [27, 2, -4]],
    ['forgotten_monastery', 'altar', 'altar', [25, 1, 0]],
    ['inertia_tower', 'platform', 'platform', [32.75, .35, 0]],
  ]) {
    const i = d.ensureInstance(templateId, site, [1800, 0, 1280]);
    assert(d.devices.geometry(i.id).some(box => box.partId === partId));
    assert.equal(d.devices.damage(i.id, partId, 1000).removed, true);
    assert.equal(i.deviceState.solved, false);
    assert.equal(d.devices.geometry(i.id).some(box => box.partId === partId), false);
    const loaded = make(d.serialize());
    assert.equal(loaded.devices.geometry(i.id).some(box => box.partId === partId), false);
  }
});

test('non-axis-aligned vane uses disjoint SDK-filled boxes and changes its physical pose', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('cliff_observatory', 'rotating-vane', [1800, 0, 1280]);
  installRequired(d, i, p);
  const readVane = () => d.devices.geometry(i.id).filter(box => box.partId === 'windvane');
  const before = readVane();
  const controlPosition = world(i, d.definition(i.id).puzzle.componentAnchors[0].positionM);
  assert.equal(d.devices.act(i.id, 'set_vane', { position: controlPosition, progression: p, angleRad: .73 }).ok, true);
  const after = readVane();
  assert.notDeepEqual(after.map(box => box.center), before.map(box => box.center));
  for (let a = 0; a < after.length; a++) for (let b = a + 1; b < after.length; b++) {
    const overlap = after[a].center.every((_, axis) => Math.min(after[a].center[axis] + after[a].size[axis] / 2, after[b].center[axis] + after[b].size[axis] / 2) - Math.max(after[a].center[axis] - after[a].size[axis] / 2, after[b].center[axis] - after[b].size[axis] / 2) > 1e-8);
    assert.equal(overlap, false, 'one SDK part has no duplicate occupied volume');
  }
});

test('breaking the moving platform removes its support without clearing momentum', () => {
  const d = make(), i = d.ensureInstance('inertia_tower', 'broken-platform-motion', [1800, 0, 1280]);
  assert.equal(d.devices.damage(i.id, 'platform', 1000).removed, true);
  const before = i.deviceState.motion.positionM;
  d.update(1);
  assert.equal(i.deviceState.motion.velocityMps, 1);
  assert.equal(i.deviceState.motion.positionM, before + 1);
  assert.equal(d.devices.sampleAt(world(i, [33.75, .525, 0])), null);
});

test('destroying a platform lock support releases residual motion without free braking', () => {
  const d = make(), p = new Progression(catalog), i = d.ensureInstance('inertia_tower', 'released-platform-lock', [1800, 0, 1280]);
  installRequired(d, i, p);
  const position = world(i, d.definition(i.id).puzzle.componentAnchors[0].positionM);
  assert.equal(d.devices.act(i.id, 'engage_brake', { position, progression: p }).ok, true);
  d.update(2.3, { manualInstanceId: i.id, position });
  assert(Math.abs(i.deviceState.motion.velocityMps - .08) < 1e-8);
  assert.equal(d.devices.act(i.id, 'lock_platform', { position, progression: p }).ok, true);
  const before = i.deviceState.motion.positionM;
  assert.equal(d.devices.damage(i.id, 'platform', 1000).removed, true);
  d.update(1);
  assert(Math.abs(i.deviceState.motion.velocityMps - .08) < 1e-9);
  assert(Math.abs(i.deviceState.motion.positionM - (before + .08)) < 1e-8);
});
