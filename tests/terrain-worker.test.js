// Off-thread terrain generation (P2, docs/ARCHITECTURE.md §7): a worker copy of the atlas builds chunks that
// equal the main thread's, with edits, reservations and region terrain versions, drops results of an older
// base terrain, and the atlas falls back to building chunks itself when the worker fails or is not ready.
// The worker runs on a MessageChannel in this thread with the same handler the browser worker installs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTENT} from '../app/src/main/assets/content-runtime/catalog.generated.js';
import {generatorFor} from '../app/src/main/assets/content-runtime/maps.js';
import {terrainWorker, createTerrainGenerator} from '../app/src/main/assets/content-runtime/terrain-worker.js';

const make = (id, options = {}) => new (generatorFor(id).atlas)(CONTENT, { seed: 63026, ...options });
const LOAD = { radiusChunks: 0, verticalRadius: 1, chunkBudget: 4, workBudgetMs: Infinity, maxCellsPerLoad: Infinity };
const turn = () => new Promise((resolve) => setImmediate(resolve));
function channel() {
  const { port1, port2 } = new MessageChannel(), handle = terrainWorker((message, transfer) => port2.postMessage(message, transfer ?? []));
  port2.onmessage = (event) => handle(event.data);
  return { port: port1, close: () => { port1.close(); port2.close(); } };
}
async function ready(atlas) { for (let i = 0; i < 200 && !atlas._generator?.ready; i++) await turn(); assert.ok(atlas._generator?.ready, 'the worker reports ready'); }
/** Streams (x, z) through the worker only: no cell is built on the main thread. */
async function streamWorker(atlas, x, z) {
  for (let i = 0; i < 400; i++) {
    atlas.loadAround(x, z, LOAD);
    assert.equal(atlas.lastLoadWork.processedCells, 0, 'no main-thread cells while the worker generates');
    if (!atlas.pendingChunkCount) return;
    await turn();
  }
  assert.fail('the worker did not finish the chunks');
}
function streamMain(atlas, x, z) { for (let i = 0; i < 16 && (i === 0 || atlas.pendingChunkCount); i++) atlas.loadAround(x, z, LOAD); }
function sameChunks(worker, main) {
  assert.ok(main.activeChunks.size >= 2);
  assert.deepEqual([...worker.activeChunks.keys()].sort(), [...main.activeChunks.keys()].sort());
  for (const [key, chunk] of main.activeChunks) assert.ok(Buffer.from(worker.activeChunks.get(key).blocks.buffer).equals(Buffer.from(chunk.blocks.buffer)), `chunk ${key}`);
}

for (const [id, x, z, options] of [['infinite', 8, 8], ['island', 77.5, 84.5], ['frontier', 77.5, 84.5], ['frontier', 88, 104, { regionTerrain: [['0,0', 2]] }], ['machine-field', 0, 0]]) {
  test(`worker chunks equal main-thread chunks: ${id}${options ? ' (region terrain version 2)' : ''}`, async () => {
    const main = make(id, options), atlas = make(id, options), { port, close } = channel();
    try {
      streamMain(main, x, z);
      atlas.attachGenerator(port);await ready(atlas);
      await streamWorker(atlas, x, z);
      sameChunks(atlas, main);
    } finally { atlas.detachGenerator(); close(); }
  });
}

test('the region terrain version reaches the worker copy (version 3 adds the workyard playground)', () => {
  const v2 = createTerrainGenerator({ generatorId: 'frontier-v1', seed: '63026', options: { regionTerrain: [['0,0', 2]] } }), v3 = createTerrainGenerator({ generatorId: 'frontier-v1', seed: '63026' });
  assert.notDeepEqual(v2._generateChunk(5, 0, 6).blocks, v3._generateChunk(5, 0, 6).blocks);
  assert.throws(() => createTerrainGenerator({ generatorId: 'nope', seed: '1' }), /지형 생성기/);
});

test('edits made while a chunk is in flight and a reservation that drops its result both reach the installed chunk', async () => {
  const reservation = { minX: 2, maxX: 12, minZ: 2, maxZ: 12, height: 9 }, edit = [10, 12, 10, null];  // a dug cell under the 9 m pad
  const main = make('infinite');main.reserveArea('test-site', reservation);main.setCell(...edit);streamMain(main, 8, 8);
  const atlas = make('infinite'), { port, close } = channel();
  try {
    atlas.attachGenerator(port);await ready(atlas);
    atlas.loadAround(8, 8, LOAD);
    const g = atlas._generator, generation = atlas.generationRevision;
    assert.ok(g.waiting > 0 && g.requested.size > 0, 'requests are in flight');
    atlas.setCell(...edit);
    atlas.reserveArea('test-site', reservation);
    assert.deepEqual([atlas.generationRevision, g.requested.size, g.arrived.size], [generation + 1, 0, 0], 'the base terrain changed: earlier requests are void');
    await streamWorker(atlas, 8, 8);
    sameChunks(atlas, main);
    assert.equal(atlas.getCell(...edit.slice(0, 3)), null);assert.notEqual(atlas.getCell(10, 11, 10), null, 'the pad around it is solid');
    assert.equal(g.waiting, 0, 'every reply, stale ones included, was counted');
  } finally { atlas.detachGenerator(); close(); }
});

test('until the worker is ready, and after it fails, the atlas builds chunks itself', async () => {
  // A worker that loads slowly: chunks come from the main thread meanwhile.
  const silent = { posted: [], postMessage(m) { this.posted.push(m.type); } }, atlas = make('infinite');
  atlas.attachGenerator(silent);
  streamMain(atlas, 8, 8);
  assert.ok(atlas.activeChunks.size >= 2 && !atlas.pendingChunkCount);
  assert.deepEqual(silent.posted, ['init'], 'no chunk was requested before ready');
  // A worker that fails on its first chunk: the atlas detaches it, records why and carries on alone.
  const failing = { postMessage(m) { queueMicrotask(() => this.onmessage?.({ data: m.type === 'init' ? { type: 'ready' } : m.type === 'chunk' ? { type: 'error', error: 'boom' } : {} })); }, terminated: false, terminate() { this.terminated = true; } };
  const other = make('infinite');other.attachGenerator(failing);await turn();
  other.loadAround(8, 8, LOAD);await turn();
  assert.deepEqual([other._generator, other.generatorFailure, failing.terminated], [null, 'boom', true]);
  streamMain(other, 8, 8);
  sameChunks(other, atlas);
});
