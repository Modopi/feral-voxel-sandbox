// Loose world pieces after the 0.18.0 report "three felled trees make it unplayable" (docs/ARCHITECTURE.md §7):
// the support search after a broken cell gives the original search's result without allocating per cell, a piece's
// colliders are its cells merged into exact cuboids, its render surfaces are meshed per 2 m section with the same
// faces as the whole piece, and its physics body is rebuilt only when its cells change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { WorldObjects } from '../app/src/main/assets/content-runtime/objects.js';
import { matterShapes } from '../app/src/main/assets/content-runtime/object-physics.js';
import { SectionedSurfaces } from '../app/src/main/assets/content-runtime/render-surfaces.js';
import { surfaceGroups } from '../app/src/main/assets/content-runtime/voxel/solid.js';
import { RuntimePhysics } from '../app/src/main/assets/content-runtime/physics.js';

const BLOCKS = new Map(CONTENT.blocks.entries.map((b) => [b.id, b]));
function world(cells, anchors = new Set()) {
  const map = new Map(cells), k = (x, y, z) => `${x},${y},${z}`;
  return { getCell: (x, y, z) => map.get(k(x, y, z)) ?? null, setCell: (x, y, z, id) => { if (id === null) map.delete(k(x, y, z)); else map.set(k(x, y, z), id); return true; },
    isAnchoredCell: (x, y, z) => anchors.has(k(x, y, z)), cells: map };
}
// The search WorldObjects ran before 0.18.1, on the same world, without changing it.
function referenceSearch(atlas, cell, limit) {
  const DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]], key = (c) => c.join(','), examined = new Set(), found = [], reasons = [];
  const fixed = (c, block) => !block || block.detachesWhenUnsupported !== true || Boolean(atlas.isAnchoredCell(...c));
  for (const d of DIRS) {
    const start = cell.map((v, i) => v + d[i]);
    if (examined.has(key(start)) || atlas.getCell(...start) == null) continue;
    const queue = [start], queued = new Set([key(start)]), cells = [];let reason = null;
    for (let cursor = 0; cursor < queue.length && !reason; cursor++) {
      if (cursor >= limit) { for (const c of queue) examined.add(key(c)); reason = 'component_limit'; break; }
      const c = queue[cursor], id = atlas.getCell(...c);examined.add(key(c));
      if (id == null) continue;
      if (fixed(c, BLOCKS.get(id))) { reason = 'anchored'; break; }
      cells.push(key(c));
      for (const dd of DIRS) {
        const n = c.map((v, i) => v + dd[i]), nk = key(n);
        if (queued.has(nk)) continue;
        if (atlas.isAnchoredCell(...n)) { reason = 'anchored'; break; }
        const nid = atlas.getCell(...n);if (nid == null) continue;
        if (fixed(n, BLOCKS.get(nid))) { reason = 'anchored'; break; }
        queued.add(nk);queue.push(n);
      }
    }
    if (reason) reasons.push(reason); else if (cells.length) found.push(cells.sort());
  }
  return { found: found.map((c) => c.join(' ')).sort(), reasons: [...new Set(reasons)].sort() };
}

test('the support search after a broken cell finds what the original search found (pieces, anchors, the limit)', () => {
  let seed = 11;const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 40; round++) {
    const cells = [], anchors = new Set();
    for (let x = -4; x <= 4; x++) for (let y = 0; y < 7; y++) for (let z = -4; z <= 4; z++) if (rand() < .55) cells.push([`${x},${y},${z}`, rand() < .8 ? 'log' : 'dirt']);
    for (let i = 0; i < 3; i++) anchors.add(`${Math.floor(rand() * 9) - 4},0,${Math.floor(rand() * 9) - 4}`);
    const broken = [Math.floor(rand() * 5) - 2, Math.floor(rand() * 5) + 1, Math.floor(rand() * 5) - 2], limit = round % 3 ? 2048 : 12;
    const atlas = world(cells, anchors);atlas.setCell(...broken, null);
    const expected = referenceSearch(atlas, broken, limit);
    const objects = new WorldObjects(CONTENT, atlas);objects.maxComponentCells = limit;
    const result = objects.detachAround(broken);
    assert.deepEqual({ found: result.objects.map((o) => o.cells.map((c) => c.sourceCell.join(',')).sort().join(' ')).sort(), reasons: [...result.reasons].sort() }, expected, `round ${round}`);
  }
});

// A felled-tree-like piece: a 2 × 2 trunk 12 cells high under a 7 × 7 × 3 canopy.
function tree() {
  const cells = [];
  for (let y = 1; y <= 12; y++) for (const [x, z] of [[3, 3], [4, 3], [3, 4], [4, 4]]) cells.push([`${x},${y},${z}`, 'log']);
  for (let y = 10; y <= 12; y++) for (let x = 0; x < 7; x++) for (let z = 0; z < 7; z++) if (!cells.some(([k]) => k === `${x},${y},${z}`)) cells.push([`${x},${y},${z}`, 'leaves']);
  const atlas = world([...cells, ['3,0,3', 'log']]), objects = new WorldObjects(CONTENT, atlas);
  atlas.setCell(3, 0, 3, null);const [piece] = objects.detachAround([3, 0, 3]).objects;
  return { objects, piece };
}

test('a piece collides as its cells merged into exact cuboids per block: every cell covered once, the same mass', () => {
  const { piece } = tree(), shapes = matterShapes(piece.boxes), covered = new Map();
  assert.ok(shapes.length * 5 < piece.boxes.length, `${shapes.length} colliders for ${piece.boxes.length} cells`);
  for (const s of shapes) for (let x = 0; x < s.size[0] / .5; x++) for (let y = 0; y < s.size[1] / .5; y++) for (let z = 0; z < s.size[2] / .5; z++) {
    const k = [s.center[0] - s.size[0] / 2 + (x + .5) * .5, s.center[1] - s.size[1] / 2 + (y + .5) * .5, s.center[2] - s.size[2] / 2 + (z + .5) * .5].join(',');
    covered.set(k, (covered.get(k) ?? 0) + 1);
    assert.equal(piece.boxes.find((b) => b.center.join(',') === k)?.blockId, s.blockId, `${k} keeps its block`);
  }
  assert.deepEqual([...covered.keys()].sort(), piece.boxes.map((b) => b.center.join(',')).sort());
  assert.ok([...covered.values()].every((n) => n === 1));
  assert.ok(Math.abs(shapes.reduce((n, s) => n + s.massKg, 0) - piece.massKg) < 1e-9);
  const odd = [{ center: [.1, .2, .3], size: [.3, .3, .3], massKg: 2 }];
  assert.deepEqual(matterShapes(odd).map((s) => [s.center, s.size, s.massKg]), [[[.1, .2, .3], [.3, .3, .3], 2]], 'free-form boxes stay as they are');
});

const faceSet = (groups) => new Set([...groups].flatMap(([, g]) => { const out = []; for (let i = 0; i < g.indices.length; i += 6) out.push([0, 1, 2, 3, 4, 5].map((k) => [...g.positions.slice(g.indices[i + k] * 3, g.indices[i + k] * 3 + 3)].map((v) => v.toFixed(4)).join(',')).join('|')); return out; }));
test('a piece meshed per section has the whole piece\'s faces, and breaking a cell re-meshes only nearby sections', () => {
  const { objects, piece } = tree(), surfaces = new SectionedSurfaces(), part = () => objects.get(piece.id).asset.parts[0];
  const check = () => assert.deepEqual([...faceSet(surfaces.update(part().boxes, objects.get(piece.id).asset.materials))].sort(), [...faceSet(surfaceGroups(part().boxes, objects.get(piece.id).asset.materials))].sort());
  check();const sections = surfaces.sections.size, first = surfaces.meshed;
  assert.ok(sections > 4 && first === sections);
  for (const cell of [[0, 10, 0], [3, 11, 3], [6, 12, 6], [2, 10, 5]]) {
    const o = objects.get(piece.id), c = o.cells.find((x) => x.sourceCell.join() === cell.join()), before = surfaces.meshed;
    objects.damageAt(piece.id, { x: o.position.x + (c.cell[0] + .5) * .5, y: o.position.y + (c.cell[1] + .5) * .5, z: o.position.z + (c.cell[2] + .5) * .5 }, 1e9);
    check();
    assert.ok(surfaces.meshed - before <= 4, `${surfaces.meshed - before} sections re-meshed for one broken cell`);
  }
  const unchanged = surfaces.meshed;surfaces.update(part().boxes, objects.get(piece.id).asset.materials);
  assert.equal(surfaces.meshed, unchanged, 'nothing re-meshed without a change');
});

test('in Rapier a piece\'s body is rebuilt only when its cells change, not when a cell only loses health', async () => {
  const { objects, piece } = tree(), flat = { revision: 0, isSolidCell: (_x, y) => y < 0, heightAt: () => 0 };
  const rt = { atlas: flat, terrain: flat, player: { x: 1.5, y: 0, z: 1.5 }, nearbyStructures: [], objects };
  const p = await RuntimePhysics.create(rt, null, { terrainRadius: 2 });
  try {
    p.synchronize(new Map(), rt.player);p.step(1 / 60);
    const first = p.objectPhysics.bodies.get(piece.id).entry;
    assert.ok(first.colliders.length * 5 < piece.cells.length && Math.abs(first.body.mass() - piece.massKg) < 1e-6);
    const o = objects.get(piece.id), c = o.cells.find((x) => x.blockId === 'log'), at = () => ({ x: o.position.x + (c.cell[0] + .5) * .5, y: o.position.y + (c.cell[1] + .5) * .5, z: o.position.z + (c.cell[2] + .5) * .5 });
    assert.equal(objects.damageAt(piece.id, at(), 1).removed, undefined);
    for (let i = 0; i < 3; i++) p.step(1 / 60);
    assert.equal(p.objectPhysics.bodies.get(piece.id).entry, first, 'health only: the same body');
    assert.equal(objects.damageAt(piece.id, at(), 1e9).removed, true);
    p.step(1 / 60);
    const next = p.objectPhysics.bodies.get(piece.id).entry;
    assert.notEqual(next, first, 'a broken cell: a new body');
    assert.ok(Math.abs(next.body.mass() - objects.get(piece.id).massKg) < 1e-6);
  } finally { p.dispose(); }
});
