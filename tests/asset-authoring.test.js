import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelAssetBuilder, initializeAuthoring, assertAuthoringInvariant, assertCreatedByTool } from '../tools/asset-pipeline/authoring.mjs';
import { flattenAsset } from '../tools/asset-pipeline/model.mjs';
import { overlappingPairs } from '../tools/asset-pipeline/solid.mjs';

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
