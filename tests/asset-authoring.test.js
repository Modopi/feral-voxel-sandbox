import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelAssetBuilder, initializeAuthoring, assertAuthoringInvariant, assertCreatedByTool } from '../tools/asset-pipeline/authoring.mjs';
import { flattenAsset } from '../tools/asset-pipeline/model.mjs';
import { overlappingPairs, overlapsAny, overlapsAdding } from '../tools/asset-pipeline/solid.mjs';
import { readFileSync } from 'node:fs';

const cube = (center = [0, 0, 0], size = [2, 2, 2], material = 'wood') => ({ center, size, material });
function source() {
  return initializeAuthoring({
    id: 'authoring_fixture', visualGridM: .5,
    materials: [{ id: 'wood', collision: true }, { id: 'metal', collision: true }],
    parts: [{ id: 'root', parent: null, translation: [0, 0, 0], role: 'root', boxes: [] }],
    anchors: [], instances: [],
  });
}
const volume = boxes => boxes.reduce((sum, box) => sum + box.size.reduce((v, n) => v * n, 1), 0);
const boxes = builder => builder.toJSON().parts.find(part => part.id === 'root').boxes;

test('SDK rejects overlapping add atomically instead of repairing the existing model', () => {
  const builder = new VoxelAssetBuilder(source());
  builder.addBox('root', cube());
  const before = builder.toJSON();
  assert.throws(() => builder.addBox('root', cube([.5, 0, 0], [2, 2, 2], 'metal')), /겹/);
  assert.deepEqual(builder.toJSON(), before);
  // Face contact is valid and must not be mistaken for occupied volume.
  builder.addBox('root', cube([2, 0, 0]));
  assert.equal(volume(boxes(builder)), 16);
  assert.equal(overlappingPairs(boxes(builder)), 0);
});

test('invalid SDK mutations leave model state unchanged', () => {
  const builder = new VoxelAssetBuilder(source());
  builder.addBox('root', cube());
  const before = builder.toJSON();
  for (const action of [
    () => builder.addBox('root', cube([NaN, 0, 0])),
    () => builder.addBox('root', cube([.1, 0, 0])),
    () => builder.addBox('root', cube([0, 0, 0], [0, 1, 1])),
    () => builder.addBox('root', cube([0, 0, 0], [1, 1, 1], 'missing')),
    () => builder.addBox('missing', cube()),
    () => builder.addBox('root', cube(), { mode: 'implicit-repair' }),
    () => builder.removeBox('root', { center: [0, 0, 0], size: [Infinity, 1, 1] }),
    () => builder.addPart({ id: 'bad', translation: [.1, 0, 0] }),
    () => builder.addPart({ id: 'root' }),
    () => builder.addPart({ id: 'orphan', parent: 'missing' }),
  ]) {
    assert.throws(action);
    assert.deepEqual(builder.toJSON(), before);
  }
});

test('explicit replace transfers only intersecting volume to the new material', () => {
  const builder = new VoxelAssetBuilder(source());
  builder.addBox('root', cube());
  builder.addBox('root', cube([1, 0, 0], [2, 2, 2], 'metal'), { mode: 'replace' });
  const result = boxes(builder);
  assert.equal(overlappingPairs(result), 0);
  assert.equal(volume(result), 12);
  assert.equal(volume(result.filter(box => box.material === 'wood')), 4);
  assert.equal(volume(result.filter(box => box.material === 'metal')), 8);
});

test('explicit fill preserves occupied material and inserts only empty volume', () => {
  const builder = new VoxelAssetBuilder(source());
  builder.addBox('root', cube());
  builder.addBox('root', cube([1, 0, 0], [2, 2, 2], 'metal'), { mode: 'fill' });
  const result = boxes(builder);
  assert.equal(overlappingPairs(result), 0);
  assert.equal(volume(result), 12);
  assert.equal(volume(result.filter(box => box.material === 'wood')), 8);
  assert.equal(volume(result.filter(box => box.material === 'metal')), 4);
  const before = builder.toJSON();
  builder.addBox('root', cube([0, 0, 0], [1, 1, 1], 'metal'), { mode: 'fill' });
  assert.deepEqual(builder.toJSON(), before);
});

test('removal creates a real cavity with conserved remaining volume and local pivot', () => {
  const builder = new VoxelAssetBuilder(source());
  builder.addPart({ id: 'joint', translation: [3, 2, -1], role: 'articulated' });
  builder.addBox('joint', cube());
  builder.removeBox('joint', cube([0, 0, 0], [1, 1, 1]));
  const result = builder.toJSON(), joint = result.parts.find(part => part.id === 'joint');
  assert.deepEqual(joint.translation, [3, 2, -1]);
  assert.equal(joint.parent, 'root');
  assert.equal(volume(joint.boxes), 7);
  assert.equal(overlappingPairs(joint.boxes), 0);
  const flattened = flattenAsset(result, new Map());
  assert(flattened.every(box => box.partId === 'joint'));
  assert(flattened.every(box => !box.center.every((v, i) => Math.abs(v - [3, 2, -1][i]) < box.size[i] / 2)));
  builder.removeBox('joint', cube());
  assert.equal(builder.toJSON().parts.find(part => part.id === 'joint').boxes.length, 0);
});

test('articulated children may overlap other parts while same-part additions stay exclusive', () => {
  const builder = new VoxelAssetBuilder(source());
  builder.addBox('root', cube());
  builder.addPart({ id: 'joint', translation: [.5, 0, 0] });
  builder.addBox('joint', cube());
  const output = builder.toJSON();
  assert.equal(overlappingPairs(flattenAsset(output, new Map())), 1);
  assert.equal(output.collision.selfCollision, false);
  assert.equal(output.collision.externalCollision, true);
  assertAuthoringInvariant(output);
});

test('corrupt imported occupancy is rejected and never normalized as a side effect', () => {
  const original = source();
  original.parts[0].boxes.push(cube(), cube([.5, 0, 0]));
  const snapshot = structuredClone(original);
  assert.throws(() => new VoxelAssetBuilder(original), /중복 점유/);
  assert.deepEqual(original, snapshot);
  assert.throws(() => assertAuthoringInvariant(original), /중복 점유/);
});

test('tool provenance is runtime-created identity, not a copied metadata label', () => {
  const original = source();
  assertCreatedByTool(original);
  assert.throws(() => assertCreatedByTool(structuredClone(original)));
});

test('SDK copies input and exported data to prevent accidental alias mutations', () => {
  const original = source(), builder = new VoxelAssetBuilder(original), incoming = cube();
  builder.addBox('root', incoming);
  incoming.center[0] = 100;
  original.parts[0].translation[0] = 100;
  const exported = builder.toJSON();
  exported.parts[0].boxes[0].center[0] = 100;
  assert.deepEqual(boxes(builder)[0].center, [0, 0, 0]);
  assert.deepEqual(builder.toJSON().parts[0].translation, [0, 0, 0]);
});

test('bulk add places many boxes in one checked step and rejects any overlap atomically', () => {
  const builder = new VoxelAssetBuilder(source());
  builder.addBox('root', cube([10, 0, 0]));
  const row = Array.from({ length: 6 }, (_, i) => cube([i * 2, 0, 4]));
  builder.addBoxes('root', row);
  assert.equal(volume(boxes(builder)), 7 * 8);
  const before = builder.toJSON();
  assert.throws(() => builder.addBoxes('root', [cube([0, 0, 8]), cube([1, 0, 8])]), /겹/, 'incoming boxes overlapping each other');
  assert.throws(() => builder.addBoxes('root', [cube([0, 0, 8]), cube([10.5, 0, 0])]), /겹/, 'an incoming box overlapping an existing one');
  assert.throws(() => builder.addBoxes('root', [cube([0, 0, 8]), cube([0, 0, 12], [2, 2, 2], 'missing')]), /재질/);
  assert.deepEqual(builder.toJSON(), before, 'nothing of a refused batch is kept');
});

test('sweep overlap checks give the same answers as testing every pair', () => {
  // Grid-aligned boxes of mixed sizes, many touching only by faces, some overlapping.
  let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const brute = (list) => { let n = 0; for (let i = 0; i < list.length; i++) for (let j = 0; j < i; j++) if (list[i].center.every((c, k) => Math.abs(c - list[j].center[k]) < (list[i].size[k] + list[j].size[k]) / 2 - 1e-8)) n++; return n; };
  for (let round = 0; round < 40; round++) {
    const list = Array.from({ length: 60 }, () => { const size = [1, 2, 3].map(() => .5 * (1 + Math.floor(random() * 3))); return { center: size.map((s) => Math.floor(random() * 12) * .5 + s / 2), size, material: 'wood' }; });
    assert.equal(overlappingPairs(list), brute(list));
    const [existing, incoming] = [list.slice(0, 40), list.slice(40, 42)];
    const expected = brute([...existing, ...incoming]) - brute(existing) > 0;
    assert.equal(overlapsAdding(existing, incoming), expected);
    assert.equal(overlapsAny(existing, incoming[0]), brute([...existing, incoming[0]]) - brute(existing) > 0);
  }
});

test('the runtime voxel SDK is the same code as the asset pipeline SDK', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(read('../app/src/main/assets/content-runtime/voxel/solid.js'), read('../tools/asset-pipeline/solid.mjs'));
  assert.equal(read('../app/src/main/assets/content-runtime/voxel/authoring.js').replace("'./solid.js'", "'./solid.mjs'"), read('../tools/asset-pipeline/authoring.mjs'));
});
