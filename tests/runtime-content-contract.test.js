import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { ASSETS, loadAsset, loadAssetLibrary } from '../app/src/main/assets/content-runtime/assets.generated.js';
import { compileRuntimeContent, buildRuntimeContent } from '../tools/build-runtime-content.mjs';
import { flattenAsset } from '../app/src/main/assets/content-runtime/voxel/model.js';
import { VoxelAssetBuilder, assertCreatedByTool } from '../app/src/main/assets/content-runtime/voxel/authoring.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('browser catalog preserves all six canonical documents and freezes definitions', async () => {
  for (const name of ['environments', 'blocks', 'creatures', 'structures', 'bosses', 'progression']) {
    assert.deepEqual(CONTENT[name], JSON.parse(await fs.readFile(path.join(root, `design/content/${name}.json`))));
    assert(Object.isFrozen(CONTENT[name].entries[0]));
    assert.throws(() => { CONTENT[name].entries[0].id = 'runtime_state_must_be_separate'; }, TypeError);
  }
});

test('lazy browser assets preserve every canonical model and manifest metadata', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'design/assets/manifest.json')));
  assert.equal(manifest.entries.length, 121); // 119 + wrench and grapple (0.15.7)
  const weaponPatterns = CONTENT.progression.entries.filter(entry => entry.kind === 'weapon_pattern');
  assert.equal(weaponPatterns.length, 3);
  for (const pattern of weaponPatterns) {
    assert.equal(ASSETS[pattern.id]?.category, 'equipment');
    const model = await loadAsset(pattern.id);
    assert.equal(model.equipmentKind, 'weapon_pattern');
    assert(model.anchors.some(anchor => anchor.id === 'grip'), `${pattern.id} needs a main-hand grip anchor`);
    assert(model.equipmentSlots.some(slot => slot.slot === 'main_hand' && slot.anchorId === 'grip'));
  }
  assert.equal(Object.keys(ASSETS).length, manifest.entries.length);
  for (const entry of manifest.entries) {
    assert.deepEqual(ASSETS[entry.id], entry);
    const model = await loadAsset(entry.id);
    assert.deepEqual(model, JSON.parse(await fs.readFile(path.join(root, 'design/assets', entry.model))));
    assert(Object.isFrozen(model.parts[0].boxes));
    assert.strictEqual(await loadAsset(entry.id), model);
  }
  await assert.rejects(loadAsset('missing_asset'), /Unknown asset/);
  await assert.rejects(loadAsset('toString'), /Unknown asset/);
});

test('instanced environment loads a complete reusable hierarchy with independent owner identities', async () => {
  const id = Object.values(ASSETS).find(entry => entry.category === 'environment').id;
  const library = await loadAssetLibrary(id), model = library.get(id);
  assert(library.size > 1);
  for (const item of library.values()) for (const instance of item.instances) assert(library.has(instance.assetId));
  const boxes = flattenAsset(model, library);
  assert.equal(boxes.length, ASSETS[id].boxes);
  for (const instance of model.instances) assert(boxes.some(box => box.ownerId.startsWith(`${id}/${instance.id}`)));
  assert.equal(model.collision.selfCollision, false);
  assert.equal(model.collision.externalCollision, true);
});

test('packaged authoring SDK can safely edit a copy without mutating cached source assets', async () => {
  const original = await loadAsset(Object.keys(ASSETS)[0]);
  const snapshot = JSON.stringify(original), builder = new VoxelAssetBuilder(original);
  const part = original.parts.find(part => part.boxes.length);
  builder.removeBox(part.id, part.boxes[0]);
  const output = builder.toJSON();
  assertCreatedByTool(output);
  assert.notEqual(JSON.stringify(output), snapshot);
  assert.equal(JSON.stringify(original), snapshot);
});

test('runtime package is deterministic and committed files equal canonical compilation', async () => {
  const first = await compileRuntimeContent(), second = await compileRuntimeContent();
  assert.deepEqual(first, second);
  assert.equal(first.assetCount, 121);
  assert.equal(first.files.size, 11);
  for (const [filename, source] of first.files) {
    assert(!source.includes('node:'));
    assert(!source.includes('from \'../design/'));
    assert.equal(await fs.readFile(path.join(root, 'app/src/main/assets/content-runtime', filename), 'utf8'), source);
  }
});

test('read-only package check rejects a modified generated file without repairing it', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'feral-runtime-contract-'));
  try {
    await buildRuntimeContent({ outputDirectory: temporary });
    const file = path.join(temporary, 'catalog.generated.js');
    await fs.appendFile(file, '\n// unexpected manual edit\n');
    const modified = await fs.readFile(file);
    await assert.rejects(buildRuntimeContent({ outputDirectory: temporary, check: true }), /Stale runtime package/);
    assert.deepEqual(await fs.readFile(file), modified);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('canonical source hash corruption aborts compilation before outputs are written', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'feral-runtime-source-'));
  try {
    await fs.cp(path.join(root, 'design/content'), path.join(temporary, 'design/content'), { recursive: true });
    await fs.cp(path.join(root, 'design/assets/models'), path.join(temporary, 'design/assets/models'), { recursive: true });
    await fs.copyFile(path.join(root, 'design/assets/manifest.json'), path.join(temporary, 'design/assets/manifest.json'));
    const first = Object.values(ASSETS)[0];
    await fs.appendFile(path.join(temporary, 'design/assets', first.model), ' ');
    await assert.rejects(buildRuntimeContent({ sourceRoot: temporary }), /Canonical model hash mismatch/);
    await assert.rejects(fs.access(path.join(temporary, 'app/src/main/assets/content-runtime')));
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});


test('complete browser package stays within existing native update file and byte limits', async () => {
  const native = await fs.readFile(path.join(root, 'app/src/main/java/com/kgb/feral/UpdateCore.java'), 'utf8');
  const fileLimit = Number(native.match(/MAX_FILES = (\d+);/)[1]);
  const archiveLimit = Number(native.match(/MAX_ARCHIVE = (\d+) \* 1024 \* 1024;/)[1]) * 1024 * 1024;
  const expandedLimit = Number(native.match(/MAX_EXPANDED = (\d+) \* 1024 \* 1024;/)[1]) * 1024 * 1024;
  let count = 0, expanded = 0, zipBytes = 22;
  async function visit(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name, full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full, relative + '/');
      else if (entry.isFile()) {
        const bytes = await fs.readFile(full);
        count++; expanded += bytes.length;
        // Same seekable, no-extra-field ZIP layout used by build-update.py.
        zipBytes += 30 + 46 + 2 * Buffer.byteLength(relative) + deflateRawSync(bytes, { level: 9 }).length;
      }
    }
  }
  await visit(path.join(root, 'app/src/main/assets'));
  assert(count <= fileLimit, `${count} files exceeds native ${fileLimit}`);
  assert(expanded <= expandedLimit, `${expanded} expanded bytes exceeds native ${expandedLimit}`);
  assert(zipBytes <= archiveLimit, `${zipBytes} ZIP bytes exceeds native ${archiveLimit}`);
});
