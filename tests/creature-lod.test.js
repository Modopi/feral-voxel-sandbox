// Distance tiers of the creature AI (P2, user decision 2026-10-18): near creatures update every 0.25 s as before,
// farther ones every 0.5 s or 1 s with the elapsed time, by the same rules and without losing time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CreatureSystem, AI_LOD } from '../app/src/main/assets/content-runtime/creatures.js';

const CONTENT = Object.fromEntries(['creatures', 'environments', 'structures', 'progression'].map(name =>
  [name, JSON.parse(readFileSync(new URL(`../design/content/${name}.json`, import.meta.url), 'utf8'))]));
const make = (options = {}) => new CreatureSystem(CONTENT, { seed: 'lod-test', ...options });
const species = CONTENT.creatures.entries.find(s => s.role === 'primary_consumer').id;
const player = { x: 0, y: 0, z: 0 };

test('the tiers: within 32 m every step, to 64 m every second step, beyond every fourth', () => {
  assert.deepEqual(AI_LOD.map(t => t.every), [1, 2, 4]);
  const sys = make();
  const near = sys.spawn(species, { x: 10, y: 0, z: 0 }), mid = sys.spawn(species, { x: 50, y: 0, z: 0 }), far = sys.spawn(species, { x: 80, y: 0, z: 0 });
  const updates = new Map([[near.id, 0], [mid.id, 0], [far.id, 0]]);
  const original = sys._metabolism.bind(sys);
  sys._metabolism = (e, s, dt) => { if (updates.has(e.id)) updates.set(e.id, updates.get(e.id) + 1); return original(e, s, dt); };
  for (let i = 0; i < 160; i++) sys.tick(1 / 20, { player });  // 8 s of steps
  const [n, m, f] = [near, mid, far].map(e => updates.get(e.id));
  assert.ok(n >= 30 && n <= 33, `near ${n} updates in 8 s`);
  assert.ok(Math.abs(m - n / 2) <= 2, `middle ${m}`);
  assert.ok(Math.abs(f - n / 4) <= 2, `far ${f}`);
  assert.deepEqual([near, mid, far].map(e => sys.updateInterval(e.id)), [.25, .5, 1]);
  assert.ok(sys.work.lodSkips > 0);
});

test('a far creature loses no time: its age and calories follow the clock like a near one', () => {
  const run = (x) => {
    const sys = make(), e = sys.spawn(species, { x, y: 0, z: 0 });
    e.state = 'idle'; const age = e.age;
    for (let i = 0; i < 400; i++) sys.tick(1 / 20, { player });  // 20 s
    return { aged: e.age - age, calories: e.calories };
  };
  const near = run(10), far = run(80);
  assert.ok(Math.abs(near.aged - far.aged) <= 1 + 1e-9, `near ${near.aged} s, far ${far.aged} s`);
  assert.ok(Math.abs(near.aged - 20) <= 1);
});

test('without a player (offline catch-up, tests) every creature keeps the full rate', () => {
  const sys = make(), e = sys.spawn(species, { x: 500, y: 0, z: 0 });
  let n = 0; const original = sys._metabolism.bind(sys);
  sys._metabolism = (c, s, dt) => { if (c === e) n++; return original(c, s, dt); };
  for (let i = 0; i < 40; i++) sys.tick(1 / 20, {});
  assert.equal(sys.updateInterval(e.id), .25);
  assert.ok(n >= 7, `full rate without a player (${n} updates in 2 s)`);
});

test('a far creature moving in coarse substeps still stops at a wall', () => {
  // A solid wall of half-metre cells at x = 85 m, open ground below y = 0.
  const terrain = { heightAt: () => 0, isSolidCell: (hx, hy) => hy < 0 || (hx === 170 && hy >= 0 && hy < 8) };
  const sys = make({ terrain }), e = sys.spawn(species, { x: 80, y: 0, z: 0 });
  for (let i = 0; i < 200; i++) { e.targetPoint = { x: 95, y: 0, z: 0 }; e.state = 'walk'; sys._move(e, e.targetPoint, 1, 6, { terrain }); }
  assert.ok(e.x < 85, `stopped before the wall at ${e.x}`);
  // With the far tier's coarse substeps (1 m) too.
  sys._substepM = 1; e.x = 80;
  for (let i = 0; i < 200; i++) sys._move(e, { x: 95, y: 0, z: 0 }, 1, 6, { terrain });
  assert.ok(e.x < 85, `coarse substeps stop before the wall at ${e.x}`);
});

test('the spatial index finds creatures on every side of the origin (numeric cell keys)', () => {
  const sys = make(), ids = [];
  for (const [x, z] of [[-70, -70], [70, -70], [-70, 70], [70, 70], [-1, 0], [0, -1]]) ids.push(sys.spawn(species, { x, y: 0, z }).id);
  const seen = new Set(sys.visibleEntities(player, 120).map(e => e.id));
  for (const id of ids) assert.ok(seen.has(id), id);
  const moved = sys.get(ids[0]); moved.x = -200; moved.z = 300;
  assert.equal(sys.visibleEntities(player, 120).some(e => e.id === ids[0]), false, 'a creature that moved away leaves its old cell');
  assert.equal(sys.visibleEntities({ x: -200, y: 0, z: 300 }, 10).some(e => e.id === ids[0]), true);
});
