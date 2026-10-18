// Impact damage on the unified runtime (S2c): the frontier's fall and struck-by-a-body rules (impact.js)
// through runtime.hurt, following the survival setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { impactEnergy, impactHealth } from '../app/src/main/assets/impact.js';
import * as T from '../app/src/main/assets/vendor/three.module.js';

const config = (survival = true) => ({ configVersion: 1, preset: 'expedition', seed: 7, terrain: { generator: 'infinite' }, rules: { survival } });
function fall(runtime, speed) {
  const p = runtime.player; Object.assign(p, { hp: 100, grounded: false, vy: -speed });
  runtime.tick(.05); Object.assign(p, { grounded: true, vy: 0 }); runtime.tick(.05);
  return 100 - p.hp;
}

test('landing faster than 8 m/s hurts by the frontier fall rule; slower landings, peaceful worlds and driving do not', () => {
  const runtime = new ExpeditionRuntime(7, null, new Map(), { config: config() });
  const expected = impactHealth(impactEnergy(80, Infinity, 12, 8));
  assert.ok(Math.abs(expected - 0.5 * 80 * (144 - 64) / 140) < 1e-9);
  assert.ok(Math.abs(fall(runtime, 12) - expected) < .05, 'a 12 m/s landing (about 4 m)');
  assert.match(runtime.messages.at(-1), /낙하 충격 −23/);
  assert.equal(runtime.events.at(-1).source, 'fall');
  assert.equal(fall(runtime, 7.5), 0, 'below the safe speed');
  fall(runtime, 25);
  assert.match(runtime.messages.at(-1), /깨어났습니다/, 'landing at terminal speed (25 m/s) is lethal');
  runtime.drivingMachineId = 'machine:x'; assert.equal(fall(runtime, 12), 0, 'a seat takes the landing'); runtime.drivingMachineId = null;
  const peaceful = new ExpeditionRuntime(7, null, new Map(), { config: config(false) });
  assert.equal(fall(peaceful, 20), 0);
});

test('a moving body that strikes the player hurts by its energy, once per 0.45 s; slow, held and driven bodies do not', async () => {
  const hits = [], object = { id: 'object:1', position: { x: 1.2, y: .6, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 },
    boxes: [{ center: [0, 0, 0], size: [.5, .5, .5], massKg: 20 }] };
  const rt = { atlas: { revision: 0, isSolidCell: (_x, y) => y < 0, heightAt: () => 0 }, player: { x: 0, y: .02, z: 0, hp: 100, bodyHeight: 1.8 }, nearbyStructures: [],
    strikePlayer: (energy, id) => hits.push({ energy, id }) };
  rt.objects = { physicsBodies: () => [object], setPhysicsPose: (_id, pose) => Object.assign(object, pose), get: (id) => id === object.id ? object : null };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 1 });
  try {
    p.synchronize(new Map(), rt.player);
    const body = p.objectPhysics.bodies.get(object.id).entry.body;
    const launch = (speed) => { body.setTranslation({ x: 1.2, y: .9, z: 0 }, true); body.setLinvel({ x: -speed, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true); };
    launch(2); for (let i = 0; i < 40; i++) p.step(1 / 60);
    assert.equal(hits.length, 0, 'a 2 m/s nudge is below the safe speed');
    launch(12); for (let i = 0; i < 10; i++) p.step(1 / 60);
    assert.equal(hits.length, 1, 'struck once');
    assert.equal(hits[0].id, object.id);
    assert.ok(hits[0].energy > 0 && hits[0].energy <= impactEnergy(20, 80, 12, 4) + 1e-6, `energy ${hits[0].energy}`);
    launch(12); for (let i = 0; i < 10; i++) p.step(1 / 60);
    assert.equal(hits.length, 1, 'cooldown');
    for (let i = 0; i < 30; i++) p.step(1 / 60);
    p.objectPhysics.held = { id: object.id, local: { x: 0, y: 0, z: 0 } };
    launch(12); for (let i = 0; i < 6; i++) p.step(1 / 60);
    p.objectPhysics.held = null;
    assert.equal(hits.length, 1, 'the held object never strikes its holder');
  } finally { p.dispose(); }
});

test('struck damage follows the survival setting and worn armour, with a message', () => {
  const runtime = new ExpeditionRuntime(7, null, new Map(), { config: config() }), energy = impactEnergy(20, 80, 12, 4);
  runtime.player.hp = 100;
  const amount = runtime.strikePlayer(energy, 'object:1');
  assert.ok(Math.abs(amount - impactHealth(energy)) < 1e-9 && amount > 0);
  assert.ok(Math.abs(100 - runtime.player.hp - amount * (1 - runtime.progression.evaluateLoadout().damageReduction)) < 1e-9);
  assert.match(runtime.messages.at(-1), /물체 충돌/);
  const peaceful = new ExpeditionRuntime(7, null, new Map(), { config: config(false) });
  assert.equal(peaceful.strikePlayer(energy, 'object:1'), 0);
  assert.equal(peaceful.player.hp, 100);
});

test('a thrown object that hits a creature part strikes that creature once by the two masses', async () => {
  const strikes = [], object = { id: 'object:2', position: { x: 0, y: .9, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 },
    boxes: [{ center: [0, 0, 0], size: [.5, .5, .5], massKg: 20 }] };
  const rt = { atlas: { revision: 0, isSolidCell: (_x, y) => y < 0, heightAt: () => 0 }, player: { x: -8, y: .02, z: 0, hp: 100 }, nearbyStructures: [],
    creatures: { get: (id) => id === 'creature:deer' ? { id, massKg: 85 } : null }, strikeCreature: (...args) => strikes.push(args) };
  rt.objects = { physicsBodies: () => [object], setPhysicsPose: (_id, pose) => Object.assign(object, pose), get: (id) => id === object.id ? object : null };
  const group = new T.Group(), body = new T.Group(); group.position.set(2.5, 0, 0); group.add(body);
  const deer = { group, parts: new Map([['torso', body]]), asset: { parts: [{ id: 'torso', parent: null, translation: [0, 0, 0], role: 'body', boxes: [{ center: [0, .9, 0], size: [1, 1.2, 1], material: 'fur' }] }], materials: [{ id: 'fur', collision: true }] },
    desc: { id: 'creature:deer', kind: 'creature', position: { x: 2.5, y: 0, z: 0 } } };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 1 });
  try {
    p.synchronize(new Map([['creature:deer', deer]]), rt.player);
    const b = p.objectPhysics.bodies.get(object.id).entry.body;
    b.setTranslation({ x: 0, y: .9, z: 0 }, true); b.setLinvel({ x: 12, y: 0, z: 0 }, true);
    for (let i = 0; i < 20; i++) p.step(1 / 60);
    assert.equal(strikes.length, 1, `strikes ${strikes.length}`);
    const [id, partId, energy, point, source] = strikes[0];
    assert.deepEqual([id, partId, source], ['creature:deer', 'torso', object.id]);
    assert.ok(energy > 0 && energy <= impactEnergy(20, 85, 12, 4) + 1e-6 && Number.isFinite(point.x));
  } finally { p.dispose(); }
});

test('a struck creature takes the frontier collision damage on its struck part', () => {
  const runtime = new ExpeditionRuntime(7, null, new Map(), { config: config() });
  const deer = runtime.creatures.spawn('moss_deer', { x: runtime.player.x + 3, y: runtime.player.y, z: runtime.player.z }, { id: 'creature:test' });
  const before = runtime.creatures.get(deer.id).hp, result = runtime.strikeCreature(deer.id, 'torso', 3000, { x: 0, y: 0, z: 0 }, 'object:1');
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(runtime.creatures.get(deer.id).hp < before, 'the deer is hurt');
  assert.equal(runtime.strikeCreature(deer.id, 'torso', 0, { x: 0, y: 0, z: 0 }, 'object:1'), null);
});
