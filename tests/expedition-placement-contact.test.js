import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { MachineSystem } from '../app/src/main/assets/content-runtime/machines.js';

const content = Object.fromEntries(['environments', 'blocks', 'progression']
  .map((key) => [key, JSON.parse(fs.readFileSync(new URL(`../design/content/${key}.json`, import.meta.url)))]));

test('settled machine cells allow ground contact but reject real 2mm overlaps before payment', async () => {
  let sideTerrain = false;
  const atlas = { revision: 0, isSolidCell: (x, y, z) => y < 9 || sideTerrain && x === 3 && y === 9 && z === 0, heightAt: () => 4.5 };
  const runtime = { atlas, player: { x: 0, y: 4.52, z: 10 }, nearbyStructures: [] };
  const progression = new Progression(content);
  assert.equal(progression.grant({ wood: 375 }, { claimId: 'contact-test-wood' }).ok, true);
  const machines = new MachineSystem(content, progression);
  const id = machines.create({ position: [0, 8, 0], gridM: .5 }).machineId;
  assert.equal(machines.attachVoxel(id, { cell: [0, 0, 0], materialId: 'wood' }).ok, true);
  Object.assign(runtime, { machines, progression });
  const physics = await RuntimePhysics.create(runtime, null, { terrainRadius: 2 });
  try {
    physics.synchronize(new Map(), runtime.player);
    for (let frame = 0; frame < 180; frame++) physics.step(1 / 60);
    const machine = machines.machines.get(id);
    assert(machine.position.y < 4.5 && machine.position.y > 4.498, `machine should settle against the 4.5m floor: ${machine.position.y}`);
    assert.equal(progression.count('wood'), 250);

    for (const cell of [[1, 0, 0], [0, 0, 1]]) assert.equal(machines.attachVoxel(id, { cell, materialId: 'wood' }).ok, true);
    assert.equal(progression.count('wood'), 0, 'both horizontally attached base cells are paid');
    assert.equal(progression.grant({ wood: 250 }, { claimId: 'contact-test-rejection-wood' }).ok, true);
    physics.step(1 / 60);
    const body = physics.machinePhysics.bodies.get(id).entry.body;

    const y = machine.position.y + .25;
    physics.adapter.addBody({ ownerId: 'external:two-millimetres', type: 'fixed', boxes: [
      { center: [1.748, y, .25], size: [.5, .5, .5] },
    ] });
    physics.adapter.step(1e-6);
    let before = progression.count('wood');
    assert.equal(machines.attachVoxel(id, { cell: [2, 0, 0], materialId: 'wood' }).reason, 'external_collision');
    assert.equal(progression.count('wood'), before, 'external overlap rejection does not debit inventory');
    physics.adapter.removeOwner('external:two-millimetres'); physics.adapter.step(1e-6);

    // The exact-terrain fallback sees this 2mm overlap even though the streamed
    // Rapier terrain cache was intentionally built before this cell appeared.
    body.setTranslation({ x: .002, y: body.translation().y, z: body.translation().z }, true);
    machine.position.x = .002; sideTerrain = true;
    before = progression.count('wood');
    assert.equal(machines.attachVoxel(id, { cell: [2, 0, 0], materialId: 'wood' }).reason, 'external_collision');
    assert.equal(progression.count('wood'), before, 'exact terrain overlap rejection does not debit inventory');
    physics.adapter.step(1 / 60);

    const tinyCenter = { x: 10 + .03125 / 2, y: 10 + .03125 / 2, z: .03125 / 2 };
    const tinyObstacleMinX = tinyCenter.x + .03125 / 2 - .002;
    physics.adapter.addBody({ ownerId: 'external:tiny-grid', type: 'fixed', boxes: [
      { center: [tinyObstacleMinX + .01, tinyCenter.y, tinyCenter.z], size: [.02, .03125, .03125] },
    ] });
    physics.adapter.step(1e-6);
    assert.equal(physics.canPlaceVoxel({ id: 'tiny-grid-machine', position: { x: 10, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      { cell: [0, 0, 0], gridM: .03125 }), false, '1mm-scale inset must not erase a real overlap in the smallest grid');

  } finally { physics.dispose(); }
});
