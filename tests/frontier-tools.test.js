// Frontier tools on the unified runtime (S2c3): the assembly wrench pins loose objects and anchors machines,
// the carrying grapple is the powered grip, and a held block attaches to a loose object.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { WorldObjects } from '../app/src/main/assets/content-runtime/objects.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { MachineSystem } from '../app/src/main/assets/content-runtime/machines.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';

const content = Object.fromEntries(['environments', 'blocks', 'creatures', 'structures', 'bosses', 'progression']
  .map((key) => [key, JSON.parse(fs.readFileSync(new URL(`../design/content/${key}.json`, import.meta.url)))]));
const catalog = new Map(content.progression.entries.map((e) => [e.id, e]));

// Loose cells floating above flat ground: removing the cell below a group detaches it as one object.
function world(cellsAbove) {
  const cells = new Map(cellsAbove.map(([x, y, z, id]) => [`${x},${y},${z}`, id]));
  const atlas = { revision: 0, getCell: (x, y, z) => cells.get(`${x},${y},${z}`) ?? null,
    setCell(x, y, z, id) { const key = `${x},${y},${z}`; if (id == null) cells.delete(key); else cells.set(key, id); this.revision++; return true; },
    isSolidCell: (_x, y) => y < 0, heightAt: () => 0 };
  const objects = new WorldObjects(content, atlas);
  return { atlas, objects, cells };
}

test('the wrench and grapple are craftable catalog tools with models', () => {
  for (const [tool, recipe] of [['wrench', 'make_wrench'], ['grapple', 'make_grapple']]) {
    assert.equal(catalog.get(tool)?.kind, 'tool');
    assert.equal(catalog.get(recipe)?.outputs?.[tool], 1);
    for (const id of Object.keys(catalog.get(recipe).inputs)) assert.ok(catalog.get(id), `${recipe} input ${id}`);
  }
  const manifest = JSON.parse(fs.readFileSync(new URL('../design/assets/manifest.json', import.meta.url)));
  for (const id of ['wrench', 'grapple']) assert.ok(manifest.entries.some((e) => e.id === id && e.category === 'equipment'), `${id} model`);
});

test('a pinned object is fixed in place, refuses grab and push, keeps the pin through save, and falls once freed', async () => {
  const { atlas, objects } = world([[0, 6, 0, 'log'], [0, 7, 0, 'log']]);
  const object = objects.detachAround([0, 5, 0]).objects[0];
  const rt = { atlas, player: { x: 1, y: .02, z: 0, hp: 100, yaw: 0, pitch: 0 }, nearbyStructures: [], objects };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    assert.ok(objects.setAnchored(object.id, true).anchored);
    p.synchronize(new Map(), rt.player);
    for (let i = 0; i < 60; i++) p.step(1 / 60);
    assert.ok(Math.abs(objects.get(object.id).position.y - 3) < 1e-6, 'held where it was pinned');
    assert.match(p.objectPhysics.grab(object.id, { x: .25, y: 3.25, z: .25 }).reason, /고정/);
    assert.match(p.objectPhysics.push(object.id, { x: .25, y: 3.25, z: .25 }).reason, /고정/);
    const saved = JSON.parse(JSON.stringify(objects.serialize()));
    assert.equal(new WorldObjects(content, atlas, saved).get(object.id).anchored, true);
    objects.setAnchored(object.id, false);
    for (let i = 0; i < 90; i++) p.step(1 / 60);
    assert.ok(objects.get(object.id).position.y < 1, 'falls once freed');
  } finally { p.dispose(); }
});

test('splitting a pinned object leaves the pin on the largest piece', () => {
  const { objects } = world([[0, 6, 0, 'log'], [0, 7, 0, 'log'], [0, 8, 0, 'log'], [0, 9, 0, 'log']]);
  const object = objects.detachAround([0, 5, 0]).objects[0];
  objects.setAnchored(object.id, true);
  // Break the second cell from the bottom: one cell below, two above.
  const block = content.blocks.entries.find((b) => b.id === 'log');
  let result;
  do result = objects.damageAt(object.id, { x: .25, y: 3.75, z: .25 }, block.durabilityHpPerCell); while (result.ok && !result.removed);
  assert.ok(result.removed);
  const pieces = result.objectIds.map((id) => objects.get(id));
  const largest = pieces.reduce((a, b) => (a.cells.length >= b.cells.length ? a : b));
  assert.equal(largest.cells.length, 2);
  assert.deepEqual(pieces.map((o) => !!o.anchored).sort(), [false, true]);
  assert.equal(largest.anchored, true);
});

test('a held block attaches beside the struck face, adds its mass, refuses occupied or blocked cells and refunds the block when mined', async () => {
  const runtime = new ExpeditionRuntime(7, null, new Map(), { config: { configVersion: 1, preset: 'expedition', seed: 7, terrain: { generator: 'infinite' }, rules: { survival: true } } });
  const p = runtime.player, x = Math.floor(p.x * 2), z = Math.floor(p.z * 2), y = Math.floor(runtime.atlas.heightAt(p.x, p.z) * 2) + 8;
  runtime.atlas.setCell(x, y, z, 'log'); runtime.atlas.setCell(x, y + 1, z, 'log');
  const object = runtime.objects.detachAround([x, y - 1, z]).objects[0] ?? runtime.objects.detachAround([x, y + 2, z]).objects[0];
  assert.ok(object, 'a floating log becomes an object');
  runtime.progression.grant({ loose_stone: 2 }, { claimId: 'attach-test' });
  const top = { x: object.position.x + .25, y: object.position.y + 1, z: object.position.z + .25 }, before = object.massKg;
  const hit = { kind: 'object', id: object.id, point: top, normal: { x: 0, y: 1, z: 0 }, distance: 3 };
  const r = runtime.attachToObject(hit, 'loose_stone');
  assert.ok(r.ok, JSON.stringify(r));
  const stone = content.blocks.entries.find((b) => b.id === 'stone');
  assert.ok(Math.abs(runtime.objects.get(object.id).massKg - before - stone.massPerCellKg) < 1e-9);
  assert.equal(runtime.progression.count('loose_stone'), 1);
  assert.match(runtime.attachToObject(hit, 'loose_stone').reason, /이미 칸이 있는/);
  assert.match(runtime.attachToObject({ ...hit, normal: { x: 1, y: 0, z: 0 } }, 'wrench').reason, /붙일 수 있는 블록이 아닙니다/);
  const saved = JSON.parse(JSON.stringify(runtime.objects.serialize()));
  assert.ok(new WorldObjects(content, runtime.atlas, saved).get(object.id).cells.some((c) => c.placedItem === 'loose_stone'));
  const cellTop = { x: object.position.x + .25, y: object.position.y + 1.25, z: object.position.z + .25 };
  let mined;
  do mined = runtime.objects.damageAt(object.id, cellTop, stone.durabilityHpPerCell, { progression: runtime.progression }); while (mined.ok && !mined.removed);
  assert.deepEqual(mined.items, { loose_stone: 1 }, 'the placed cell returns the block, not raw resources');
  assert.equal(runtime.progression.count('loose_stone'), 2);
  // A cell that would sit inside terrain is refused and costs nothing.
  const buried = runtime.objects.attachTarget(object.id, { x: object.position.x + .25, y: object.position.y, z: object.position.z + .25 }, { x: 0, y: -1, z: 0 });
  runtime.atlas.setCell(...[buried.center.x, buried.center.y, buried.center.z].map((v) => Math.floor(v * 2)), 'stone');
  assert.match(runtime.attachToObject({ ...hit, point: { x: object.position.x + .25, y: object.position.y, z: object.position.z + .25 }, normal: { x: 0, y: -1, z: 0 } }, 'loose_stone').reason, /막혀/);
  assert.equal(runtime.progression.count('loose_stone'), 2);
});

test('the grapple grips from 6.5 m with 22000 N, lifts what a hand cannot, and throws by min(8, 4200/m)', async () => {
  const { atlas, objects } = world([[0, 2, 0, 'stone'], [1, 2, 0, 'stone']]); // 650 kg
  const object = objects.detachAround([0, 1, 0]).objects[0];
  const rt = { atlas, player: { x: 5.5, y: .02, z: .5, hp: 100, yaw: Math.PI / 2, pitch: 0, bodyHeight: 1.8 }, nearbyStructures: [], objects };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    p.synchronize(new Map(), rt.player);
    for (let i = 0; i < 30; i++) p.step(1 / 60);
    const mass = p.objectPhysics.bodies.get(object.id).entry.body.mass(), point = { x: 1, y: 1.25, z: .25 };
    assert.ok(mass > 360 && 22000 / mass > 9.81, `a ${mass.toFixed(0)} kg block is beyond a hand (3500 N), not the grapple`);
    assert.match(p.objectPhysics.grab(object.id, point).reason, /가까이/, 'a hand reaches 4 m');
    assert.ok(p.objectPhysics.grab(object.id, point, { powered: true }).ok, 'the grapple reaches 6.5 m');
    assert.ok(p.objectPhysics.held.distance <= 4);
    assert.ok(Math.abs(p.objectPhysics.speedScale - Math.max(.45, 1 / (1 + mass / 12000))) < 1e-9);
    const startY = objects.get(object.id).position.y;
    for (let i = 0; i < 60; i++) p.step(1 / 60);
    assert.ok(objects.get(object.id).position.y > startY + .3, 'the grapple lifts it');
    const thrown = p.objectPhysics.throwHeld();
    assert.ok(Math.abs(thrown.speed - Math.min(8, 4200 / mass)) < 1e-9);
  } finally { p.dispose(); }
});

test('an anchored machine is fixed where it stands, saves the anchor, and falls once released', async () => {
  const progression = new Progression(content); progression.grant({ wood: 1000 }, { claimId: 'anchor-wood' });
  const machines = new MachineSystem(content, progression), id = machines.create({ position: [0, 3, 0], gridM: .5 }).machineId;
  machines.attachVoxel(id, { cell: [0, 0, 0], materialId: 'wood' });
  const m = machines.machines.get(id);
  const rt = { atlas: { revision: 0, isSolidCell: (_x, y) => y < 0, heightAt: () => 0 }, player: { x: 1, y: .02, z: 0, hp: 100 }, nearbyStructures: [], machines, progression };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    assert.ok(machines.setAnchored(id, true).anchored);
    p.synchronize(new Map(), rt.player);
    for (let i = 0; i < 60; i++) p.step(1 / 60);
    assert.ok(Math.abs(m.position.y - 3) < 1e-6, 'held in the air');
    const restored = new MachineSystem(content, progression, JSON.parse(JSON.stringify(machines.serialize())));
    assert.equal(restored.machines.get(id).anchored, true);
    assert.throws(() => new MachineSystem(content, progression, { ...machines.serialize(), machines: [{ ...machines.serialize().machines[0], anchored: 'yes' }] }), /anchor/);
    machines.setAnchored(id, false);
    for (let i = 0; i < 90; i++) p.step(1 / 60);
    assert.ok(m.position.y < 1, 'falls once released');
  } finally { p.dispose(); }
});

test('the runtime wrench toggles pins and anchors in reach and needs the tool', () => {
  const runtime = new ExpeditionRuntime(7, null, new Map(), { config: { configVersion: 1, preset: 'expedition', seed: 7, terrain: { generator: 'infinite' }, rules: { survival: true } } });
  const p = runtime.player, x = Math.floor(p.x * 2), z = Math.floor(p.z * 2), y = Math.floor(runtime.atlas.heightAt(p.x, p.z) * 2) + 8;
  runtime.atlas.setCell(x, y, z, 'log');
  const object = runtime.objects.detachAround([x, y - 1, z]).objects[0];
  const hit = { kind: 'object', id: object.id, distance: 3 };
  assert.match(runtime.useWrench(hit).reason, /렌치가 필요/);
  runtime.progression.grant({ wrench: 1, wood: 200 }, { claimId: 'wrench-test' });
  assert.equal(runtime.useWrench(hit).anchored, true);
  assert.equal(runtime.useWrench(hit).anchored, false);
  assert.match(runtime.useWrench({ ...hit, distance: 8 }).reason, /겨누세요/);
  const machine = runtime.machines.create({ position: [p.x + 2, p.y, p.z], gridM: .5 }).machineId;
  runtime.machines.attachVoxel(machine, { cell: [0, 0, 0], materialId: 'wood' });
  assert.equal(runtime.useWrench({ kind: 'machine', id: machine, distance: 2 }).anchored, true);
  runtime.drivingMachineId = machine;
  assert.match(runtime.useWrench({ kind: 'machine', id: machine, distance: 2 }).reason, /내린 뒤/);
});
