// The one runtime keeps the frontier's feel: immediate gathering, the frontier mining rule
// (0.18 s strikes, material hardness, tool power, 0.5 m / 1 m regions) on terrain and on
// detached pieces, items for every mined block, and layered creature bodies (shell bites, bone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { miningProfile, minedItem, TOOL_GEAR, BARE_GEAR } from '../app/src/main/assets/content-runtime/maps.js';
import { GEAR, miningWork, miningWorkFor, MINING_PERIOD_S } from '../app/src/main/assets/equipment.js';
import { B } from '../app/src/main/assets/world.js';

const SEED = 27182;
const blocks = new Map(CONTENT.blocks.entries.map(b => [b.id, b]));
const up = { x: 0, y: 1, z: 0 };

async function field() {
  const runtime = await ExpeditionRuntime.create(SEED, null);
  Object.assign(runtime.player, { x: 0, y: 40, z: 0 });
  return runtime;
}
// Strike until the cell is gone, the way holding the attack button does.
function strikesToRemove(runtime, cell, options = {}) {
  const hit = { kind: 'terrain', point: { x: cell[0] * .5 + .25, y: (cell[1] + 1) * .5, z: cell[2] * .5 + .25 }, normal: up, distance: 1 };
  let strikes = 0;
  while (runtime.atlas.getCell(...cell) && strikes < 40) { runtime.tick(MINING_PERIOD_S + .01); assert(runtime.mine(hit, options).ok); strikes++; }
  return strikes;
}

test('the shared mining rule is the frontier rule', () => {
  // The frontier's own numbers, unchanged by the shared helper.
  assert.equal(miningWork(B.DIRT, .5, GEAR.pick), .55 * .5);
  assert.equal(miningWork(B.WOOD, 1, GEAR.axe), 1.2 / 3);
  assert.equal(miningWork(B.ORE, .5, GEAR.stonepick), 2.4 * .5 / 2);
  assert.equal(miningWork(B.STONE, .5, GEAR.shovel), 1.6 * .5);
  // Design blocks the original island also had keep the frontier hardness.
  for (const [id, hardness] of [['grass', .55], ['dirt', .55], ['sand', .55], ['leaves', .55], ['log', 1.2], ['plank', 1.2], ['stone', 1.6], ['basalt', 1.6]])
    assert.equal(miningProfile(blocks.get(id), blocks).hardness, hardness, id);
  assert.equal(miningProfile(blocks.get('iron_ore'), blocks).hardness, 2.4);
  assert(miningProfile(blocks.get('mana_log'), blocks).hardness > 1.2, 'harder design blocks take longer');
  assert.equal(TOOL_GEAR.stone_pick, GEAR.stonepick);
  assert.equal(BARE_GEAR, GEAR.pick);
  for (const b of CONTENT.blocks.entries) assert(miningProfile(b, blocks), `${b.id} can be mined`);
  for (const id of ['grass', 'dirt', 'ash']) assert.equal(minedItem(blocks.get(id)).id, 'soil');
  assert.equal(minedItem(blocks.get('leaves')).id, 'plant_fiber');
  assert.equal(minedItem(blocks.get('plank')).id, 'wood');
});

test('gathering is immediate and nodes still deplete and regrow', async () => {
  const runtime = await field();
  const node = runtime.nodes.find(n => n.nodeId === 'fallen_branch' || n.sourceId === 'source_raw_timber');
  assert(node, 'a branch near the start');
  Object.assign(runtime.player, { x: node.x, y: runtime.atlas.heightAt(node.x, node.z), z: node.z });
  const before = runtime.progression.count('raw_timber');
  const result = runtime.harvest(node);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(runtime.progression.count('raw_timber'), before + 1, 'the item is there at once');
  assert.equal(runtime.harvest(node).reason, 'source_depleted');
  assert.equal('harvestAction' in runtime, false, 'no channel state');
});

test('terrain takes the frontier number of strikes, faster with a matching tool', async () => {
  const runtime = await field();
  const cases = [['dirt', null, 2], ['grass', null, 2], ['log', null, 3], ['stone', null, 4], ['stone', 'stone_pick', 2], ['iron_ore', 'stone_pick', 3], ['log', 'hand_knife', 2]];
  runtime.progression.grant({ stone_pick: 1, hand_knife: 1 }, { claimId: 'feel:tools' });
  for (const [i, [blockId, toolId, expected]] of cases.entries()) {
    const cell = [i * 4, 80, 6];
    runtime.atlas.setCell(...cell, blockId);
    const profile = miningProfile(blocks.get(blockId), blocks), gear = toolId ? TOOL_GEAR[toolId] : GEAR.pick;
    assert.equal(Math.ceil(1 / (.2 / miningWorkFor(profile.hardness, profile.affinity, .5, gear)) - 1e-9), expected, `${blockId} rule`);
    assert.equal(strikesToRemove(runtime, cell, { toolId }), expected, `${blockId} with ${toolId ?? 'bare hands'}`);
  }
  assert.equal(runtime.progression.toolWear.stone_pick, CONTENT.progression.entries.find(e => e.id === 'stone_pick').durabilityActions - 2, 'the pick wears once per removal');
});

test('a 1 m strike works the whole 2×2×2 region and grass gives soil and a seed', async () => {
  const runtime = await field();
  for (let x = 0; x < 2; x++) for (let y = 80; y < 82; y++) for (let z = 0; z < 2; z++) runtime.atlas.setCell(x, y, z, 'grass');
  const hit = { kind: 'terrain', point: { x: .25, y: 41, z: .25 }, normal: up, distance: 1 };
  const soil = runtime.progression.count('soil'), seed = runtime.progression.count('seed');
  let removed = 0, strikes = 0;
  while (!removed && strikes < 10) { runtime.tick(.2); removed = runtime.mine(hit, { size: 1 }).removed; strikes++; }
  assert.equal(removed, 8);
  assert.equal(strikes, Math.ceil(1 / (.2 / (.55 * 1))), 'soil at 1 m takes three strikes');
  assert.equal(runtime.progression.count('soil'), soil + 8);
  assert.equal(runtime.progression.count('seed'), seed + 1, 'clearing four or more grass cells drops a seed');
});

test('a detached log is cut like the frontier and keeps falling as a piece', async () => {
  const runtime = await field();
  for (let y = 80; y < 83; y++) runtime.atlas.setCell(0, y, 0, 'log');
  for (let x = 0; x < 5; x++) runtime.atlas.setCell(x, 83, 0, 'log');
  strikesToRemove(runtime, [0, 80, 0]);
  const piece = [...runtime.objects.objects.values()].find(o => !o.fragment);
  assert(piece, 'the unsupported trunk detached');
  const cells = piece.cells.length, timber = runtime.progression.count('raw_timber');
  const c = piece.cells.at(-1).cell, point = { x: piece.position.x + c[0] * .5 + .25, y: piece.position.y + c[1] * .5 + .5, z: piece.position.z + c[2] * .5 + .25 };
  const hit = { kind: 'object', id: piece.id, point, normal: up, distance: 1 };
  let strikes = 0, result;
  do { runtime.time += .2; result = runtime.strike(hit); strikes++; } while (result.ok && !result.removed && strikes < 10);
  assert.equal(result.removed, true, JSON.stringify(result));
  assert.equal(strikes, 3, 'wood takes three bare-handed strikes on a piece too');
  assert.equal([...runtime.objects.objects.values()].filter(o => !o.fragment).reduce((n, o) => n + o.cells.length, 0), cells - 1);
  assert.equal(runtime.progression.count('raw_timber'), timber + 1);
});

test('saves from before 0.14 keep their terrain wounds', async () => {
  const runtime = await field();
  const state = JSON.parse(JSON.stringify(runtime.serialize()));
  state.terrainDamage = { '1,80,1': { blockId: 'stone', hp: 25 } };
  const restored = new ExpeditionRuntime(SEED, state, new Map());
  assert.deepEqual(restored.terrainDamage['1,80,1'], { blockId: 'stone', damage: .75 });
});

test('creature bodies are layered like the frontier: bone inside the shell, wounds cut the shell', async () => {
  const { creatureBones, creatureBodyPart, woundedBoxes, woundCut, woundBox } = await import('../app/src/main/assets/content-runtime/creature-animation.js');
  const { readFileSync } = await import('node:fs');
  const deer = JSON.parse(readFileSync(new URL('../design/assets/models/moss_deer.voxel.json', import.meta.url), 'utf8'));
  const part = id => deer.parts.find(p => p.id === id), entity = { speciesId: 'moss_deer', bodyProfile: 'quadruped' };
  const inside = (b, shell) => [0, 1, 2].every(i => b.center[i] - b.size[i] / 2 >= shell.center[i] - shell.size[i] / 2 - 1e-9 && b.center[i] + b.size[i] / 2 <= shell.center[i] + shell.size[i] / 2 + 1e-9);
  const thorax = creatureBones(part('thorax'), creatureBodyPart(entity, 'thorax'));
  assert(thorax.length > 8, 'spine and rib cage');
  for (const b of thorax) assert(part('thorax').boxes.some(s => inside(b, s)), 'every bone piece is inside the shell solid');
  assert(creatureBones(part('left_foreleg'), 'limb_0').length > 0, 'leg bone');
  assert.deepEqual(creatureBones(part('antler_1'), 'head'), [], 'no bone floating inside sparse antlers');
  const cut = woundCut(4);
  assert.deepEqual(cut, { width: .125, depth: .0625 }, 'a bare-handed hit bites 12.5 cm wide and 6.25 cm deep');
  assert(woundCut(30).width > cut.width && woundCut(4, 'pierce').depth > cut.depth);
  const box = woundBox([-.156, 0, 0], [1, 0, 0], cut);
  assert.deepEqual(box, [-.125, 0, 0, .0625, .125, .125], 'the bite starts at the surface and goes along the swing');
  const volume = boxes => boxes.reduce((v, b) => v + b.size[0] * b.size[1] * b.size[2], 0);
  assert(volume(woundedBoxes(part('thorax').boxes, [box])) < volume(part('thorax').boxes), 'the shell loses the bitten volume');
});

test('a shell hit bites the shell and wears its plating; exposed bone takes the structural hit; wounds are saved', async () => {
  const runtime = await field();
  const p = runtime.player, e = runtime.creatures.spawn('moss_deer', { x: p.x, z: p.z - 1.5 }, { regionId: 'test', environmentId: 'grove' });
  // A scene-free stand-in for the rendered part frame: part-local = world minus the creature position.
  runtime.physics = { partLocalPoint: (id, partId, q) => [q.x - e.x, q.y - e.y, q.z - e.z] };
  const shellHp = e.parts.shell.hp, limb = e.parts.limb_0.hp;
  const shellHit = { kind: 'creature', id: e.id, partId: 'left_foreleg', point: { x: e.x - .1, y: e.y + .3, z: e.z }, rayOrigin: { x: e.x - 1.4, y: e.y + .3, z: e.z }, distance: 1.3 };
  const first = runtime.damageHit(shellHit, { amount: 4, energyType: 'mechanical', attackMode: 'strike' });
  assert.equal(first.ok, true);
  assert(e.parts.shell.hp < shellHp, 'the shell plating wears');
  assert.equal(e.parts.limb_0.hp, limb, 'a shell hit does not reach the leg bone');
  assert.equal(e.wounds.left_foreleg.length, 1, 'the bite is recorded on the struck part');
  runtime.damageHit({ ...shellHit, layer: 'bone' }, { amount: 4, energyType: 'mechanical', attackMode: 'strike' });
  assert(e.parts.limb_0.hp < limb, 'exposed bone takes the structural hit');
  const state = JSON.parse(JSON.stringify(runtime.serialize()));
  const restored = new ExpeditionRuntime(SEED, state, new Map());
  assert.deepEqual(restored.creatures.get(e.id).wounds, e.wounds, 'wounds survive save and load');
});
