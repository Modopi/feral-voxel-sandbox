// Impact breaking on the unified runtime (S2c4): fast loose objects and machines wear what they hit by the
// frontier rule (impact.js / impact-physics.js) — terrain cells, other objects, machine voxels and themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { impactToughness } from '../app/src/main/assets/content-runtime/maps.js';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { impactEnergy } from '../app/src/main/assets/impact.js';

const BLOCKS = new Map(CONTENT.blocks.entries.map((b) => [b.id, b]));
const make = () => new ExpeditionRuntime(7, null, new Map(), { config: { configVersion: 1, preset: 'expedition', seed: 7, terrain: { generator: 'infinite' }, rules: { survival: true } } });
// A solid ground cell under the player and the half-metre coordinates just above it.
function groundCell(runtime) {
  const p = runtime.player, x = Math.floor(p.x * 2), z = Math.floor(p.z * 2);
  let y = Math.floor(runtime.atlas.heightAt(p.x, p.z) * 2) + 2;
  while (!runtime.atlas.getCell(x, y, z)) y--;
  return [x, y, z];
}

test('impact toughness keeps the frontier values and scales design blocks by durability within their kind', () => {
  assert.deepEqual(['dirt', 'stone', 'log', 'leaves', 'basalt', 'plank'].map((id) => impactToughness(BLOCKS.get(id))), [1800, 11000, 2800, 300, 18000, 2200]);
  assert.equal(impactToughness(BLOCKS.get('clay')), 1800 * 35 / 28);
  assert.equal(impactToughness(BLOCKS.get('iron_ore')), 14000);
});

test('terrain cells wear by energy × 0.35 ÷ toughness, at most every 0.35 s, and a broken cell is knocked loose', () => {
  const runtime = make(), cell = groundCell(runtime), block = BLOCKS.get(runtime.atlas.getCell(...cell)), toughness = impactToughness(block);
  const point = { x: cell[0] * .5 + .25, y: (cell[1] + 1) * .5, z: cell[2] * .5 + .25 }, down = { x: 0, y: -1, z: 0 };
  const first = runtime.impactTerrain(point, down, toughness);
  assert.deepEqual(first.cell, cell);
  assert.ok(Math.abs(first.damage - .35) < 1e-9);
  assert.equal(runtime.impactTerrain(point, down, toughness), null, 'the same cell waits 0.35 s');
  runtime.time += .4; runtime.impactTerrain(point, down, toughness); runtime.time += .4;
  const broken = runtime.impactTerrain(point, down, toughness);
  assert.ok(broken.broken && broken.objectId);
  assert.equal(runtime.atlas.getCell(...cell), null);
  const loose = runtime.objects.get(broken.objectId);
  assert.deepEqual([loose.cells.length, loose.cells[0].blockId, loose.massKg], [1, block.id, block.massPerCellKg], 'its material stays in the world');
  assert.ok(runtime.pendingDetach.has(cell.join(',')), 'what it held up is checked for support on a later tick');
});

test('an object hit hard enough sheds the struck cell as its own piece; a single loose cell absorbs further hits', () => {
  const runtime = make(), [x, y, z] = groundCell(runtime);
  runtime.atlas.setCell(x, y + 8, z, 'log'); runtime.atlas.setCell(x, y + 9, z, 'log'); runtime.atlas.setCell(x, y + 10, z, 'log');
  const object = runtime.objects.detachAround([x, y + 7, z]).objects[0], log = BLOCKS.get('log');
  const top = { x: x * .5 + .25, y: (y + 11) * .5, z: z * .5 + .25 }, energy = impactToughness(log) / .65;
  const r = runtime.impactObject(object.id, top, energy);
  assert.ok(r.removed && r.objectIds.length === 2, JSON.stringify(r));
  const pieces = r.objectIds.map((id) => runtime.objects.get(id)), single = pieces.find((o) => o.cells.length === 1);
  assert.deepEqual(pieces.map((o) => o.cells.length).sort(), [1, 2]);
  assert.equal(Object.keys(r.items).length, 0, 'no items: the cell came off whole');
  const again = runtime.impactObject(single.id, top, energy * 10);
  assert.ok(again.rubble && runtime.objects.get(single.id), 'rubble stays one piece');
});

test('machine voxels take min(60, energy ÷ 180)', () => {
  const runtime = make(), g = runtime.progression, s = runtime.machines, p = runtime.player;
  g.grant({ wood: 1000 }, { claimId: 'machine-impact' });
  const id = s.create({ position: [p.x + 2, p.y + 3, p.z], gridM: .5 }).machineId, voxel = s.attachVoxel(id, { cell: [0, 0, 0], materialId: 'wood' }).voxelId;
  const v = () => s.machines.get(id).voxels.find((x) => x.id === voxel)?.hp ?? 0, before = v();
  runtime.impactMachine(id, voxel, 1800);
  assert.ok(Math.abs(before - v() - 10) < 1e-6, 'energy 1800 J → 10');
  const mid = v(); runtime.impactMachine(id, voxel, 1e9);
  assert.ok(mid - v() <= 60 + 1e-9, 'capped at 60');
});

test('in Rapier a heavy block thrown down at 12 m/s wears the ground and itself; a gentle 2 m/s drop does not', async () => {
  // Half a metre above the ground: 2 m/s lands at √(4 + 9.81) ≈ 3.7 m/s, under the 4 m/s safe speed.
  for (const [speed, expectWear] of [[2, false], [12, true]]) {
    const runtime = make(), [x, y, z] = groundCell(runtime);
    for (const [dx, dy] of [[0, 2], [1, 2], [0, 3], [1, 3]]) runtime.atlas.setCell(x + dx, y + dy, z, null);
    runtime.atlas.setCell(x, y + 2, z, 'stone'); runtime.atlas.setCell(x + 1, y + 2, z, 'stone');
    runtime.atlas.setCell(x, y + 1, z, null); runtime.atlas.setCell(x + 1, y + 1, z, null);
    const object = runtime.objects.detachAround([x, y + 1, z]).objects.find((o) => o.cells.length === 2);
    const physics = await RuntimePhysics.create(runtime, null, { terrainRadius: 2 }); runtime.physics = physics;
    try {
      physics.synchronize(new Map(), runtime.player);
      physics.objectPhysics.bodies.get(object.id).entry.body.setLinvel({ x: 0, y: -speed, z: 0 }, true);
      for (let i = 0; i < 40; i++) physics.step(1 / 60);
      const groundWear = Object.keys(runtime.terrainDamage).length > 0 || runtime.objects.objects.size > 1;
      const selfWear = [...runtime.objects.objects.values()].some((o) => o.cells.some((c) => c.hp != null)) || runtime.objects.objects.size > 1;
      assert.equal(groundWear || selfWear, expectWear, `${speed} m/s: ground ${groundWear}, self ${selfWear}`);
      if (expectWear) {
        const mass = 2 * BLOCKS.get('stone').massPerCellKg, energy = impactEnergy(mass, Infinity, speed, 4);
        assert.ok(energy > 0 && groundWear && selfWear, 'both sides wear');
      }
    } finally { physics.dispose(); }
  }
});

test('the contact point speed includes spin, and a wheel voxel judges impacts from 8 m/s', async () => {
  const runtime = make(), g = runtime.progression, s = runtime.machines, p = runtime.player;
  g.grant({ wood: 1000, transmission: 1 }, { claimId: 'wheel-impact' });
  g.discover(g.catalog.get(g.catalog.get('transmission').research).blueprint, { origin: 'discovery', claimId: 'wheel-impact-research' });
  const id = s.create({ position: [p.x + 2, p.y + 3, p.z], gridM: .5 }).machineId;
  const hull = s.attachVoxel(id, { cell: [0, 0, 0], materialId: 'wood' }).voxelId, wheel = s.attachVoxel(id, { cell: [1, 0, 0], materialId: 'wood' }).voxelId;
  assert.ok(s.installComponent(id, wheel, 'transmission', { legacyType: 'wheel' }).ok);
  const physics = await RuntimePhysics.create(runtime, null, { terrainRadius: 2 }); runtime.physics = physics;
  try {
    physics.synchronize(new Map(), runtime.player);
    // A trunk turning at 3 rad/s strikes 2 m from its centre at 6 m/s although its centre is still.
    assert.deepEqual(physics.impactVelocity({ velocity: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: -3 }, center: { x: 0, y: 0, z: 0 } }, { x: 2, y: 0, z: 0 }), { x: 0, y: -6, z: 0 });
    const side = (voxelId) => physics.impactSide(physics.machinePhysics.bodies.get(id).entry.colliders[s.machines.get(id).voxels.findIndex((v) => v.id === voxelId)]);
    assert.deepEqual([side(hull).wheel, side(wheel).wheel], [false, true]);
  } finally { physics.dispose(); }
});
