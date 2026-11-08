#!/usr/bin/env node

// Generate the legacy WebView export used by migration_integration_test.cpp.
// This deliberately imports and calls the shipped world-slot/runtime/save APIs
// so its envelopes and subsystem rows evolve with the old game.
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExpeditionRuntime } from '../../app/src/main/assets/content-runtime/runtime.js';
import { ExpeditionSave } from '../../app/src/main/assets/content-runtime/save.js';
import { PRESETS, worldConfig, saveKey } from '../../app/src/main/assets/world-slots.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = resolve(root, 'native/tests/fixtures/legacy-webview-runtime.json');
const rows = [
  { id: 'default', name: '기본 탐험 맵', type: 'island', seed: 63026 },
  { id: 'frontier', name: '개척 원정', type: 'frontier', seed: 63026 },
  { id: 'beta', name: '기계 베타 맵', type: 'machine', seed: 63026 },
  { id: 'expedition_1', name: '확장 원정', type: 'expedition', seed: 79123 },
];

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  key(index) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

function requireOk(result, operation) {
  if (!result?.ok) throw new Error(`${operation} failed: ${JSON.stringify(result)}`);
}

async function makeSave(row) {
  const config = worldConfig(row);
  const runtime = new ExpeditionRuntime(row.seed, null, new Map(), { config });
  await runtime.placements.ready;

  const progression = runtime.progression;
  requireOk(progression.grant({
    raw_timber: 30, loose_stone: 16, plant_fiber: 8,
    meat: 3, berry: 4,
  }, { claimId: `migration-fixture:${row.id}:inventory` }), 'seed inventory');
  progression.research.add('observation');
  requireOk(progression.startResearch('joinery'), 'start partial research');
  progression.researchProgress.joinery.work = 5.75;
  progression.stations.kiln = 1;
  progression.research.add('material:stone');
  requireOk(progression.queueCraft('cook_meat_food'), 'queue partial craft');
  progression.jobs[0].progress = 2.75;

  // Create a real atlas edit and detach its neighbouring plank through the
  // runtime object owner, then record the pose the physics bridge would save.
  const broken = [200, 120, 200];
  runtime.atlas.setCell(...broken, 'plank');
  runtime.atlas.setCell(201, 120, 200, 'plank');
  runtime.atlas.setCell(220, 120, 220, 'plank');
  runtime.atlas.setCell(...broken, null);
  const detached = runtime.objects.detachAround(broken);
  if (detached.detachedCells !== 1 || detached.objects.length !== 1)
    throw new Error(`expected one detached world object, got ${JSON.stringify(detached)}`);
  const object = detached.objects[0];
  if (!runtime.objects.setPhysicsPose(object.id, {
    position: { x: 4.25, y: 3.75, z: 7.5 },
    rotation: { x: 0, y: Math.sin(0.2), z: 0, w: Math.cos(0.2) },
    velocity: { x: 1.25, y: 2.5, z: -0.75 },
    angularVelocity: { x: 0.1, y: -0.2, z: 0.3 },
  })) throw new Error('could not set detached-object physics pose');

  const creatureId = `creature:migration-fixture:${row.id}`;
  const creature = runtime.creatures.spawn('moss_deer', { x: 50, y: 30, z: 60 }, { id: creatureId, tier: 2 });
  if (!runtime.creatures.wound(creature.id, 'head', [0, 0, 0, 0.08, 0.08, 0.08]))
    throw new Error('could not seed creature wound');

  const machine = runtime.machines.importDesign({
    name: `Migrated ${row.type} machine`, gridM: 0.5,
    position: [8, 12, 16], yaw: 0.5,
    voxels: [
      { cell: [0, 0, 0], materialId: 'wood' },
      { cell: [0, 0, 1], materialId: 'wood' },
    ],
    components: [{ cell: [0, 0, 0], componentId: 'heat_engine', fuelItems: 3 }],
  });
  requireOk(machine, 'assemble machine');
  const savedMachine = runtime.machines.machines.get(machine.machineId);
  savedMachine.velocity = { x: 3.5, y: -0.5, z: 7 };
  savedMachine.angularVelocity = { x: 0.15, y: 0.25, z: -0.35 };

  const signal = runtime.modules['first-signal'];
  if (signal) {
    signal.reputation[0] = 17;
    signal.cores = 2;
    signal.journey.harvests = 3;
    signal.journey.sorties = 1;
  }
  if (row.type === 'machine') runtime.modules['machine-field'].equipped = true;

  return { config, state: runtime.serialize() };
}

const localStorage = new MemoryStorage();
for (const row of rows) row.config = worldConfig(row);
localStorage.setItem('feral.worlds.v1', JSON.stringify(rows));
localStorage.setItem('feral.settings', JSON.stringify({ sensitivity: 0.003, visualAnimation: false }));
localStorage.setItem('feral.ui.layout.v1', JSON.stringify({ hotbar: 'wide', migrationFixture: true }));
localStorage.setItem('feral.vault.v1', JSON.stringify({ savedAt: 100, schema: 4, code: 1900 }));

for (const row of rows) {
  // Keep this reference so the fixture fails early if a preset disappears from
  // the shipped launcher registry.
  if (!PRESETS[row.type]) throw new Error(`missing launcher preset ${row.type}`);
  const { state } = await makeSave(row);
  const store = new ExpeditionSave(localStorage, saveKey(row));
  const sequence = store.write(state);
  if (sequence !== 1) throw new Error(`unexpected first save sequence for ${row.id}: ${sequence}`);
}

const rowsForVault = [...localStorage.values]
  .filter(([key]) => key.startsWith('feral.') && key !== 'feral.vault.v1')
  .map(([key, value]) => ({ key, value }));
const exportData = {
  localStorage: Object.fromEntries(localStorage.values),
  vault: {
    available: true,
    rows: [{ key: '@meta', value: { savedAt: 200, schema: 4, code: 1900, hashes: {} } }, ...rowsForVault],
  },
};
await mkdir(dirname(fixturePath), { recursive: true });
await writeFile(fixturePath, `${JSON.stringify(exportData, null, 2)}\n`);
await chmod(fixturePath, 0o644);
console.log(`Wrote ${fixturePath} (${(Buffer.byteLength(JSON.stringify(exportData)) / 1024).toFixed(1)} KiB)`);
