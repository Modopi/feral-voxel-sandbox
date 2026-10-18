// Performance structure (docs/ARCHITECTURE.md): changes are tracked per 4 m section and every
// cache rebuilds only what changed; the frame loop bounds catch-up; creature AI is staggered.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import { WorldAtlas, SECTION_CELLS } from '../app/src/main/assets/content-runtime/atlas.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';
import { EnvironmentView } from '../app/src/main/assets/content-runtime/environment-view.js';
import { CreatureSystem } from '../app/src/main/assets/content-runtime/creatures.js';
import { fixedSteps, backgroundBudgetMs, MAX_STEPS_PER_FRAME } from '../app/src/main/assets/content-runtime/frame-profiler.js';

const content = Object.fromEntries(['environments', 'blocks', 'structures', 'creatures', 'progression']
  .map((key) => [key, JSON.parse(fs.readFileSync(new URL(`../design/content/${key}.json`, import.meta.url)))]));
const section = (h) => Math.floor(h / SECTION_CELLS);
const sectionKey = (x, y, z) => `${section(x)},${section(y)},${section(z)}`;
// A solid cell within 2.5 m below the surface, off its section's y faces (any five
// consecutive heights include a local height 2..5).
const interiorCell = (atlas, x, z) => { let y = Math.round(atlas.heightAt(x * .5 + .25, z * .5 + .25) * 2) - 1; while (![2, 3, 4, 5].includes(((y % 8) + 8) % 8)) y--; return [x, y, z]; };

test('atlas records changed sections; a face cell also marks the neighbour; a reservation resets every section', () => {
  const a = new WorldAtlas(content, { seed: 'sections' });
  let { cursor } = a.changesSince(0);
  a.setCell(3, 3, 3, 'stone');
  let changes = a.changesSince(cursor);
  assert.deepEqual([...changes.sections], ['0,0,0']);
  a.setCell(8, 3, 3, 'stone'); // x face of section 1 touches section 0
  const next = a.changesSince(changes.cursor);
  assert.deepEqual(new Set(next.sections), new Set(['1,0,0', '0,0,0']));
  assert.equal(a.changesSince(next.cursor).sections.size, 0);
  const revision = a.terrainSectionRevision(1, 0, 0);
  assert.ok(revision > 0 && a.terrainSectionRevision(5, 5, 5) === 0);
  a.reserveArea('test', { minX: 100, maxX: 110, minZ: 100, maxZ: 110, height: 4 });
  assert.equal(a.changesSince(next.cursor).sections, null);
  assert.ok(a.terrainSectionRevision(5, 5, 5) > revision);
});

test('fast cell reads equal the edit map and base terrain on loaded and unloaded chunks', () => {
  const a = new WorldAtlas(content, { seed: 'fast-reads' });
  a.loadAround(8, 8, { radiusChunks: 0, verticalRadius: 1, workBudgetMs: Infinity, maxCellsPerLoad: Infinity, chunkBudget: 8 });
  const edits = [[3, 10, 4, null], [5, 20, 6, 'stone'], [70, 10, 70, null], [-40, 5, 3, 'log']];
  for (const [x, y, z, id] of edits) a.setCell(x, y, z, id);
  let seed = 7; const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let i = 0; i < 4000; i++) {
    const x = rand(160) - 64, y = rand(64) - 16, z = rand(160) - 64, key = `${x},${y},${z}`;
    const expected = a.edits.has(key) ? a.edits.get(key) : a._baseCell(x, y, z);
    assert.equal(a.getCell(x, y, z), expected, key);
    assert.equal(a.isSolidCell(x, y, z), expected !== null && a.blocks.get(expected)?.collision !== false, key);
  }
  for (const [x, y, z, id] of edits) assert.equal(a.getCell(x, y, z), id);
});

test('greedy terrain section boxes are the exact union of solid cells', async () => {
  let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const solid = new Set(); for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) for (let z = 0; z < 8; z++) if (y < 3 || rand() < .45) solid.add(`${x},${y},${z}`);
  const atlas = { revision: 0, isSolidCell: (x, y, z) => solid.has(`${x},${y},${z}`), heightAt: () => 0 };
  const p = await RuntimePhysics.create({ atlas, player: { x: 0, y: 0, z: 0 }, nearbyStructures: [] }, null, { terrainRadius: 1 });
  try {
    const boxes = p._terrainSectionBoxes(atlas, 0, 0, 0), cover = new Map();
    for (const b of boxes) for (let x = (b.center[0] - b.size[0] / 2) * 2; x < (b.center[0] + b.size[0] / 2) * 2 - 1e-9; x++)
      for (let y = (b.center[1] - b.size[1] / 2) * 2; y < (b.center[1] + b.size[1] / 2) * 2 - 1e-9; y++)
        for (let z = (b.center[2] - b.size[2] / 2) * 2; z < (b.center[2] + b.size[2] / 2) * 2 - 1e-9; z++) { const k = `${x},${y},${z}`; cover.set(k, (cover.get(k) ?? 0) + 1); }
    assert.deepEqual(new Set(cover.keys()), solid);
    assert.ok([...cover.values()].every((n) => n === 1), 'no cell is covered twice');
    assert.ok(boxes.length < solid.size / 3, `${boxes.length} boxes for ${solid.size} cells`);
  } finally { p.dispose(); }
});

test('terrain colliders: a jittering loose body and distant edits rebuild nothing; an edit rebuilds only its section', async () => {
  const atlas = new WorldAtlas(content, { seed: 'collider-sections' });
  const rt = { atlas, player: { x: 1, y: atlas.heightAt(1, 1) + .02, z: 1 }, nearbyStructures: [] };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    assert.equal(p.terrainAt(rt.player), true);
    assert.equal(p.terrainAt(rt.player), false);
    const entry = p.adapter.addBody({ ownerId: 'object:test', type: 'dynamic', boxes: [{ center: [0, 0, 0], size: [1, 2, 1] }], position: [2, rt.player.y + 1, 2] });
    p.objectPhysics.bodies.set('object:test', { entry });
    p.terrainAt(rt.player); const settled = new Map(p.terrainSections);
    for (let i = 0; i < 30; i++) {
      entry.body.setTranslation({ x: 2 + Math.sin(i) * .02, y: rt.player.y + 1, z: 2 }, true);
      entry.body.setRotation({ x: Math.sin(i) * .01, y: 0, z: 0, w: 1 }, true); entry.body.setLinvel({ x: Math.sin(i) * .3, y: 0, z: 0 }, true);
      assert.equal(p.terrainAt(rt.player), false, `jitter ${i}`);
    }
    atlas.setCell(400, 10, 400, null);
    assert.equal(p.terrainAt(rt.player), false, 'an edit outside every wanted section');
    const cell = interiorCell(atlas, 3, 3), key = sectionKey(...cell);
    assert.ok(atlas.isSolidCell(...cell) && p.terrainSections.has(key));
    atlas.setCell(...cell, null);
    assert.equal(p.terrainAt(rt.player), true);
    for (const [k, value] of settled) if (k === key) assert.notEqual(p.terrainSections.get(k), value); else assert.equal(p.terrainSections.get(k), value, k);
    entry.body.setTranslation({ x: 14, y: rt.player.y + 1, z: 2 }, true);
    assert.equal(p.terrainAt(rt.player), true, 'a body moving to new sections');
    assert.ok([...p.terrainSections.keys()].some((k) => k.startsWith('3,')));
  } finally { p.dispose(); }
});

test('part shapes ignore matrix decomposition jitter in scale', async () => {
  const p = await RuntimePhysics.create({ atlas: { revision: 0, isSolidCell: () => false, heightAt: () => 0 }, player: { x: 0, y: 0, z: 0 }, nearbyStructures: [] });
  try {
    const part = { id: 'ear', role: 'ear', boxes: [{ center: [0, .09375, 0], size: [.0625, .1875, .0625], material: 'fur' }] }, model = { asset: { materials: [{ id: 'fur' }] } };
    const exact = p.partShape(model, part, { x: 1, y: 1, z: 1 }), jittered = p.partShape(model, part, { x: .9999999999999999, y: 1.0000000000000002, z: 1 });
    assert.equal(jittered, exact);
    assert.notEqual(p.partShape(model, part, { x: 2, y: 2, z: 2 }).key, exact.key);
  } finally { p.dispose(); }
});

test('liquid meshes are cached per section: distant edits and walking reuse them, a change rebuilds only its section', () => {
  const a = new WorldAtlas(content, { seed: 'liquid-sections' });
  a.pour(.25, 5.25, .25, .0625); a.pour(20.25, 5.25, .25, .0625);
  const view = new EnvironmentView(new T.Scene(), a), player = { x: 10, y: 5, z: 0 };
  view.sync(player, 0);
  const first = new Map(view.sections), left = sectionKey(0, 10, 0), right = sectionKey(40, 10, 0);
  assert.deepEqual(new Set(first.keys()), new Set([left, right]));
  assert.equal(view.stats.liquidCells, 2);
  a.setCell(400, 10, 400, 'stone');
  view.sync(player, 1); view.sync({ ...player, x: 15 }, 2);
  for (const [k, v] of first) assert.equal(view.sections.get(k), v, `${k} reused`);
  a.pour(.25, 5.25, .25, .03);
  view.sync(player, 3);
  assert.notEqual(view.sections.get(left), first.get(left));
  assert.equal(view.sections.get(right), first.get(right));
  view.dispose();
});

test('the frame loop runs at most three fixed steps and drops the backlog; background work gets what is left', () => {
  assert.deepEqual(fixedSteps(0, 1 / 60, 1 / 60), { steps: 1, accumulator: 0 });
  assert.equal(fixedSteps(0, 1 / 30 + 1e-9, 1 / 60).steps, 2);
  const late = fixedSteps(.2, .1, 1 / 60);
  assert.equal(late.steps, MAX_STEPS_PER_FRAME);
  assert.ok(late.accumulator <= 1 / 60 + 1e-12, 'a late frame does not queue more steps for the next one');
  assert.equal(backgroundBudgetMs(2), 6); assert.equal(backgroundBudgetMs(13), 3); assert.equal(backgroundBudgetMs(40), 1.5);
});

test('staggered creature AI updates every active creature once per step, a fifth at a time', () => {
  const player = { x: 0, y: 0, z: 0, hp: 100 }, counts = [];
  for (const slices of [1, 5]) {
    const sys = new CreatureSystem(content, { seed: 'stagger', slices });
    for (let i = 0; i < 10; i++) sys.spawn('moss_deer', { x: i * 2, y: 0, z: 3 }, { id: `deer:${i}` });
    const perTick = [];
    for (let i = 0; i < 30; i++) { const before = sys.work.activeEntityUpdates; sys.tick(1 / 60, { player }); perTick.push(sys.work.activeEntityUpdates - before); }
    assert.equal(perTick.reduce((a, b) => a + b, 0), 20, `${slices} slices: two steps of ten creatures`);
    counts.push(Math.max(...perTick));
    for (const e of sys.entities) assert.ok(sys.time - e.lastUpdatedAt < .25 + 1e-9, e.id);
  }
  assert.deepEqual(counts, [10, 2]);
});
