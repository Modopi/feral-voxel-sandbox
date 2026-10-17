import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertAuthoringInvariant, assertCreatedByTool, VoxelAssetBuilder } from './asset-pipeline/authoring.mjs';
import { validateAsset } from './asset-pipeline/model.mjs';
import { exportGlb } from './asset-pipeline/glb.mjs';

// Read-only reproducibility gate: never rebuild over the evidence being checked.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'design/assets');
const kinds = [['creatures', 'creature'], ['bosses', 'boss'], ['structures', 'structure'], ['environments', 'environment']];
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
async function namesIn(folder) {
  try { return await fs.readdir(path.join(directory, folder)); }
  catch (error) { if (error.code === 'ENOENT' && folder === 'authored') return []; throw error; }
}
async function compare(relative, expected) {
  const actual = await fs.readFile(path.join(directory, relative));
  if (!actual.equals(expected)) fail(`${relative}: checked-in bytes differ from the authoring tool; run npm run build:assets and review its outputs`);
}
function checkAuthoredHeader(asset, generated) {
  if (asset.id !== generated.id || asset.category !== generated.category
    || asset.contentRef?.id !== generated.contentRef.id || asset.contentRef?.file !== generated.contentRef.file) {
    fail(`Authored source identity does not match ${generated.id}`);
  }
}

try {
  const content = Object.fromEntries(await Promise.all([...kinds.map(([name]) => name), 'blocks'].map(async name => [
    name, JSON.parse(await fs.readFile(path.join(root, `design/content/${name}.json`), 'utf8')),
  ])));
  const assets = [];
  for (const [name, category] of kinds) {
    const { generate } = await import(new URL(`../design/assets/generators/${name}.mjs`, import.meta.url));
    const generated = generate(content);
    const expected = new Set(content[name].entries.map(entry => entry.id));
    for (const asset of generated) {
      if (!/^[a-z0-9_-]+$/.test(asset.id) || !expected.delete(asset.id) || asset.category !== category) {
        fail(`${name}: unexpected or duplicate generated asset ${asset.id}`);
      }
      assertCreatedByTool(asset);
      assertAuthoringInvariant(asset);
      assets.push(asset);
    }
    if (expected.size) fail(`${name}: missing generated assets: ${[...expected].join(', ')}`);
  }
  const library = new Map(assets.map(asset => [asset.id, asset]));
  if (library.size !== assets.length) fail('Duplicate asset IDs across categories');
  const authoredNames = (await namesIn('authored')).filter(name => name.endsWith('.json'));
  let authoredCount = 0;
  for (const filename of authoredNames) {
    if (!filename.endsWith('.voxel.json')) fail(`Unexpected authored JSON filename: ${filename}`);
    const id = filename.slice(0, -'.voxel.json'.length), generated = library.get(id);
    if (!generated) fail(`Authored source has no matching content/generator: ${filename}`);
    const manual = JSON.parse(await fs.readFile(path.join(directory, 'authored', filename), 'utf8'));
    checkAuthoredHeader(manual, generated);
    // Validate before tool import: never repair invalid occupancy or collisions.
    assertAuthoringInvariant(manual);
    const authored = new VoxelAssetBuilder(manual).toJSON();
    assertCreatedByTool(authored);
    assets[assets.findIndex(asset => asset.id === id)] = authored;
    library.set(id, authored);
    authoredCount++;
  }
  for (const [folder, suffix] of [['models', '.voxel.json'], ['exports', '.glb']]) {
    const files = (await namesIn(folder)).filter(name => name.endsWith(suffix));
    const expected = new Set(assets.map(asset => asset.id + suffix));
    for (const filename of files) if (!expected.delete(filename)) fail(`${folder}/${filename}: orphaned generated file`);
    if (expected.size) fail(`${folder}: missing outputs: ${[...expected].join(', ')}`);
  }
  const counts = {}, entries = [];
  for (const asset of assets) {
    assertAuthoringInvariant(asset);
    const stats = validateAsset(asset, library, content);
    const model = jsonBytes(asset), glb = exportGlb(asset, library);
    await compare(`models/${asset.id}.voxel.json`, model);
    await compare(`exports/${asset.id}.glb`, glb);
    counts[asset.category] = (counts[asset.category] ?? 0) + 1;
    entries.push({
      id: asset.id, name: asset.name, category: asset.category, contentRef: asset.contentRef,
      model: `models/${asset.id}.voxel.json`, glb: `exports/${asset.id}.glb`, preview: `previews/${asset.id}.png`,
      sha256: hash(model), glbSha256: hash(glb), ...stats,
    });
  }
  await compare('manifest.json', jsonBytes({
    schemaVersion: 1, status: 'art_prototype', units: 'm',
    sourceOfTruth: 'authored/*.voxel.json (if present), otherwise generators/*.mjs + design/content/*.json',
    counts, entries,
  }));
  console.log(JSON.stringify({ valid: true, assets: assets.length, authoredOverrides: authoredCount, counts,
    checks: ['tool provenance', 'exclusive occupancy per part', 'collision contract', 'content and hierarchy', 'model/GLB/manifest exact bytes'] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ valid: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
