// The machine field on the one runtime (S3, 0.17.0): its terrain, the field module (starting equipment, examples,
// return to the start pad), the old field page's save, and wheel drive in real Rapier physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { generatorFor, FIELD_FLOOR, FIELD_WALL, FIELD_PILLARS, FIELD_SCRAP } from '../app/src/main/assets/content-runtime/maps.js';
import { FIELD_KIT, FIELD_START, exampleDesign } from '../app/src/main/assets/content-runtime/machine-field.js';
import { WHEEL_DRIVE } from '../app/src/main/assets/content-runtime/machines.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { PRESETS, worldConfig } from '../app/src/main/assets/world-slots.js';

const config = worldConfig({ id: 'beta', name: '기계 베타 맵', type: 'machine', seed: 63026 });
const make = (state = null) => new ExpeditionRuntime(63026, state, new Map(), { config });
const fixture = () => JSON.parse(fs.readFileSync(new URL('./fixtures/machine-save-v1.json', import.meta.url), 'utf8'));
const examples = (rt) => [...rt.machines.machines.values()].filter((m) => m.fieldExample);

test('the machine field preset plays on the runtime with the field terrain and module, no survival and no wildlife', () => {
  assert.deepEqual([PRESETS.machine.terrain, PRESETS.machine.modules, config.rules], ['machine-field', ['machine-field'], {}]);
  const rt = make(), a = rt.atlas;
  assert.deepEqual([rt.generator.id, Object.keys(rt.modules), rt.rules.survival], ['machine-field', ['machine-field'], false]);
  const cell = (x, y, z) => a.getCell(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2));
  assert.equal(cell(3, FIELD_FLOOR - .25, 3), 'grass');
  assert.equal(cell(3, FIELD_FLOOR + .25, 3), null, 'the floor is flat');
  assert.equal(cell(FIELD_WALL + .25, FIELD_FLOOR + 1.75, 0), 'stone', 'a 2 m wall around the field');
  for (const p of FIELD_PILLARS) assert.equal(cell(p.x, FIELD_FLOOR + 2.75, p.z), 'basalt');
  assert.equal(cell(FIELD_SCRAP.x, FIELD_FLOOR + .25, FIELD_SCRAP.z), 'iron_scrap_block', 'scrap to mine where the ore vein was');
  assert.equal(rt.generator.region(0, 0), false, 'no creatures are placed');
});

test('the field gives its starting equipment and the light example once, and both survive a reload', () => {
  const rt = make(), g = rt.progression;
  rt.tick(.1);
  assert.deepEqual(Object.fromEntries(Object.keys(FIELD_KIT).map((id) => [id, g.count(id)])), FIELD_KIT);
  for (const id of ['heat_engine', 'transmission', 'controller']) assert.ok(g.research.has(g.catalog.get(id).research), id);
  const [light] = examples(rt);
  assert.deepEqual([light.name, light.gridM, light.voxels.length, light.components.length, light.links.length], ['경량 예제', .5, 8, 6, 4]);
  // Cell (0, 0, 0)'s centre stands on the start pad; the example faces down the field.
  assert.deepEqual([light.position.x - .25, light.position.z - .25, light.yaw], [FIELD_START.x, FIELD_START.z, Math.PI]);
  rt.tick(.1);
  assert.equal(examples(rt).length, 1);assert.equal(g.count('wood'), FIELD_KIT.wood, 'given once');
  const again = make(JSON.parse(JSON.stringify(rt.serialize())));
  again.tick(.1);
  assert.deepEqual([examples(again).length, again.progression.count('wood'), again.modules['machine-field'].equipped], [1, FIELD_KIT.wood, true]);
  assert.throws(() => make({ ...JSON.parse(JSON.stringify(rt.serialize())), modules: { 'machine-field': { equipped: 'yes' } } }), /손상/);
});

test('an example replaces the earlier one and its fragments; a machine returns to the start pad at rest', () => {
  const rt = make(), field = rt.modules['machine-field'];
  rt.tick(.1);
  const [light] = examples(rt);
  // Break the spine's front voxel: both front wheels fall off as fragments that carry the example mark.
  const wheel = light.voxels.find((v) => v.cell[0] === -1 && v.cell[2] === -1);
  rt.machines.damage(light.id, light.voxels.find((v) => v.cell[0] === 0 && v.cell[2] === -1).id, 1e6);
  assert.equal(examples(rt).length, 3, 'two front wheels fell off as fragments');
  assert.ok(examples(rt).some((m) => m.voxels.some((v) => v.id === wheel.id)));
  assert.equal(field.example(true).ok, true);
  assert.deepEqual(examples(rt).map((m) => [m.name, m.voxels.length]), [['중량 예제', 22]]);
  const [heavy] = examples(rt);
  Object.assign(heavy.position, { x: 12, y: FIELD_FLOOR + 3, z: -4 });heavy.velocity.x = 5;heavy.yaw = 1;
  assert.equal(field.recover(heavy.id).ok, true);
  assert.deepEqual([heavy.position.x, heavy.position.z, heavy.yaw, heavy.velocity.x, heavy.placed], [FIELD_START.x + .25, FIELD_START.z + .25, Math.PI, 0, 1]);
});

test('an old machine field save carries over: the part group on the core, health shares, turned to face +Z', () => {
  const old = fixture(), legacy = generatorFor('machine-field').legacySave;
  assert.equal(legacy.matches(old), true);
  assert.equal(legacy.matches({ version: 2, world: {} }), false);
  const rt = make(), conversion = legacy.apply(rt, old, 'feral.machine.v1');
  const machines = [...rt.machines.machines.values()];
  assert.equal(machines.length, 1, 'no example beside the carried-over machine');
  const [m] = machines, at = (x, y, z) => m.voxels.find((v) => v.cell.join() === `${x},${y},${z}`);
  // Old (x, y, z) facing -Z → (-x, y, -z): the old 50 % wheel at (1, 0, -1) is at (-1, 0, 1), the 75 % motor on top.
  assert.equal(at(-1, 0, 1).hp / at(-1, 0, 1).maxHp, .5);
  assert.equal(at(0, 1, 0).hp / at(0, 1, 0).maxHp, .75);
  assert.equal(at(0, 0, -1), undefined, 'the destroyed rear hull did not move');
  assert.deepEqual(m.components.map((c) => c.componentId).sort(), ['controller', 'heat_engine', 'transmission', 'transmission']);
  assert.equal(m.links.length, 2, 'the engine drives both front wheels');
  // The old core cell's centre stood at (3, -2) facing yaw 0.4 (forward (sin, -cos)); runtime yaw is π - 0.4.
  assert.ok(Math.abs(m.yaw - (Math.PI - .4)) < 1e-9);
  const q = m.rotation, c = { x: .25, z: .25 }, centre = { x: m.position.x + c.x * (1 - 2 * q.y * q.y) + c.z * 2 * q.y * q.w, z: m.position.z - c.x * 2 * q.y * q.w + c.z * (1 - 2 * q.y * q.y) };
  assert.ok(Math.hypot(centre.x - 3, centre.z + 2) < 1e-9, 'the core cell stands where the old body stood');
  assert.deepEqual(conversion.unmapped.map((u) => u.name), ['부서진 부품', '떨어져 나간 부품', '시험장 재료']);
  assert.deepEqual([conversion.from, conversion.extras, conversion.playTimeS], ['feral.machine.v1', ['기계 1대(부품 5개)'], 90]);
  assert.equal(rt.progression.count('wood'), FIELD_KIT.wood, 'the field kit as for a new field');
  const again = make(JSON.parse(JSON.stringify(rt.serialize())));
  again.tick(.1);
  assert.equal(again.machines.machines.size, 1, 'the converted world does not get the example later');
});

// Wheel drive in Rapier on flat ground: the example designs at the field's scale.
const flat = { revision: 0, isSolidCell: (_x, y) => y < 0, heightAt: () => 0 };
async function driving(heavy, steps, command) {
  const rt = make(), s = rt.machines;
  const id = s.importDesign({ ...exampleDesign(heavy), position: { x: 0, y: .06, z: 0 }, yaw: 0 }).machineId, m = s.machines.get(id);
  s.terrain = flat;
  const host = { atlas: flat, terrain: flat, player: { x: 0, y: 0, z: 20 }, nearbyStructures: [], machines: s, progression: rt.progression };
  const p = await RuntimePhysics.create(host, null, { terrainRadius: 4 });
  const trace = [];
  try {
    p.synchronize(new Map(), host.player);
    for (const [n, c] of command) { s.control(id, c); for (let i = 0; i < n; i++) { p.step(1 / 60); if (i % 30 === 29) trace.push({ v: Math.hypot(m.velocity.x, m.velocity.z), y: m.position.y }); } }
    return { m, trace, wheels: s.wheelsOnGround(id) };
  } finally { p.dispose(); }
}

test('wheels carry the light example on suspension and drive it like the old field: ~9 m/s, steering and braking', async () => {
  const { m, trace, wheels } = await driving(false, 0, [[360, { throttle: 1 }], [120, { throttle: 1, steer: 1 }], [120, { throttle: 0, steer: 0, brake: true }]]);
  const speedAt = (s) => trace[s * 2 - 1].v;
  assert.ok(speedAt(2) > 3.5, `quick off the line (${speedAt(2).toFixed(2)} m/s at 2 s)`);
  assert.ok(speedAt(6) > 7.5 && speedAt(6) < 11, `light top speed (${speedAt(6).toFixed(2)} m/s at 6 s)`);
  // Suspension: the voxels ride clearanceM - sagM above the ground, so they never scrape it (no seam bumps).
  for (const t of trace.slice(2, 12)) assert.ok(Math.abs(t.y - (WHEEL_DRIVE.clearanceM - WHEEL_DRIVE.sagM)) < .01, `ride height ${t.y}`);
  const yaw = 2 * Math.atan2(m.rotation.y, m.rotation.w);
  assert.ok(yaw > 1.2, `steering turns it (${yaw.toFixed(2)} rad in 2 s)`);
  assert.ok(trace.at(-1).v < .3, 'the brake stops it');
  assert.deepEqual(wheels, { count: 4, ground: 4 });
});

test('the heavy example is slower; a machine on its side has no traction', async () => {
  const heavy = await driving(true, 0, [[360, { throttle: 1 }]]);
  const top = heavy.trace.at(-1).v;
  assert.ok(top > 2.5 && top < 5, `heavy top speed ${top.toFixed(2)} m/s (old field 3.4)`);
  // Turned onto its side, the same light example cannot drive: no wheel reaches the ground.
  const rt = make(), s = rt.machines;
  const id = s.importDesign({ ...exampleDesign(false), position: { x: 0, y: .5, z: 0 }, yaw: 0 }).machineId, m = s.machines.get(id);
  s.terrain = flat;Object.assign(m.rotation, { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });
  const stats = s.evaluate(id), w = s._wheelContact(m, stats, stats.mass);
  assert.deepEqual([w.count, w.share], [4, 0]);
});
