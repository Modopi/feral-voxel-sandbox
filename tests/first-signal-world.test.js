// The first signal as a world of the unified runtime (S2d, 0.16.0): the frontier preset plays on the runtime with
// the first-signal module, its things stand in the shared scene, the guardian is fought through the runtime's
// attack, and an original frontier save is carried over once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { generatorFor, REGION_STRIDE } from '../app/src/main/assets/content-runtime/maps.js';
import { START_SUPPLIES, ITEM_MAP } from '../app/src/main/assets/content-runtime/first-signal.js';
import { PRESETS, worldConfig } from '../app/src/main/assets/world-slots.js';
import { assertAuthoringInvariant } from '../app/src/main/assets/content-runtime/voxel/authoring.js';

const config = worldConfig({ id: 'frontier', name: '개척 원정', type: 'frontier', seed: 63026 });
const make = (state = null, options = {}) => new ExpeditionRuntime(63026, state, new Map(), { config, ...options });
const fixture = () => JSON.parse(fs.readFileSync(new URL('./fixtures/frontier-save-v2.json', import.meta.url), 'utf8'));

test('the frontier preset plays on the runtime with the first-signal module, survival on and belongings kept on death', () => {
  assert.equal(PRESETS.frontier.terrain, 'frontier');
  assert.deepEqual([config.terrain.generator, config.modules, config.rules], ['frontier', ['first-signal'], { survival: true, dropOnDeath: false }]);
  const runtime = make();
  assert.deepEqual(Object.keys(runtime.modules), ['first-signal']);
});

test('a new expedition receives the frontier starting supplies once, as catalog items', () => {
  const runtime = make(), g = runtime.progression, signal = runtime.modules['first-signal'];
  assert.equal(g.count('food'), 0);
  runtime.tick(.1);
  const expected = {};
  for (const [id, n] of Object.entries(START_SUPPLIES)) expected[ITEM_MAP[id]] = (expected[ITEM_MAP[id]] ?? 0) + n;
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map((id) => [id, g.count(id)])), expected, 'food 8 + medicine 2 → food 10, fiber, wood, stone, crystal');
  runtime.tick(.1);
  assert.equal(g.count('food'), expected.food, 'given once');
  const reloaded = make(JSON.parse(JSON.stringify(runtime.serialize())));
  reloaded.tick(.1);
  assert.equal(reloaded.progression.count('food'), expected.food, 'a loaded expedition is not supplied again');
  assert.equal(signal.serialize().supplied, true);
});

test('campaign things stand in the shared scene as voxel assets; the list is rebuilt only when the campaign changes', () => {
  const runtime = make(), signal = runtime.modules['first-signal'];
  const rows = runtime.descriptors().filter((d) => d.kind === 'module');
  const ids = rows.map((d) => d.id);
  for (const id of ['first-signal/camp', 'first-signal/mast', 'first-signal/lamp:0', 'first-signal/relay:0', 'first-signal/relay:2', 'first-signal/ruin', 'first-signal/guardian'])
    assert.ok(ids.includes(id), id);
  assert.equal(ids.filter((id) => id.startsWith('first-signal/villager:')).length, 6, 'three people in each of the two villages');
  for (const d of rows) { assertAuthoringInvariant(d.asset); assert.ok([d.position.x, d.position.y, d.position.z].every(Number.isFinite)); }
  assert.equal(signal.descriptors(), signal.descriptors(), 'the same list while nothing changes');
  const before = signal.descriptors(), relay = rows.find((d) => d.id === 'first-signal/relay:0');
  Object.assign(runtime.player, { x: relay.position.x + 1, z: relay.position.z });
  assert.match(signal.activateRelay(0), /1\/3/);
  const after = signal.descriptors();
  assert.notEqual(after, before, 'rebuilt after the relay changed');
  assert.equal(after.find((d) => d.id === 'first-signal/relay:0').assetId, 'signal_relay_on');
});

test('the guardian is fought through the runtime attack with the held loadout and leaves the scene when it falls', () => {
  const runtime = make(), signal = runtime.modules['first-signal'], b = signal.activeBoss;
  const guardian = () => runtime.descriptors().find((d) => d.id === 'first-signal/guardian');
  const hit = { kind: 'module', id: 'first-signal/guardian', distance: 2, point: guardian().position };
  runtime.time = 10; runtime.lastStrike = 0;
  const damage = runtime.progression.evaluateLoadout().hitDamage, hp = b.hp;
  assert.deepEqual(runtime.strike(hit), { ok: true, damage });
  assert.equal(b.hp, hp - damage);
  assert.equal(runtime.strike(hit).reason, '공격 준비 중', 'the attack period applies');
  assert.equal(runtime.strike({ ...hit, id: 'first-signal/relay:0' }).ok, false, 'other things are used, not hit');
  // The guardian's model follows the guardian's position and faces the player.
  b.x += 3; assert.equal(guardian().position.x, b.x + signal.x * REGION_STRIDE);
  signal.hitGuardian(b.hp);
  assert.equal(guardian(), undefined, 'a fallen guardian leaves the scene');
});

test('the guardian telegraph zones are in world metres and kept for one wind-up', () => {
  const runtime = make(), signal = runtime.modules['first-signal'], b = signal.activeBoss;
  assert.equal(signal.guardianZones(), null, 'nothing while it is not winding up');
  b.warning = .8; b.pattern = 'ring'; b.originX = b.x; b.originZ = b.z;
  const zones = signal.guardianZones();
  assert.equal(zones.zones[0].type, 'circle');
  assert.equal(zones.zones[0].x, b.x + signal.x * REGION_STRIDE);
  assert.equal(signal.guardianZones(), zones, 'the same zones until the next attack');
  b.phase++;
  assert.notEqual(signal.guardianZones(), zones);
});

test('an original frontier save is carried over: region terrain versions and edits, campaign, items and a list of what has no counterpart', () => {
  const old = fixture(), legacy = generatorFor('frontier').legacySave;
  assert.equal(legacy.matches(old), true);
  assert.equal(legacy.matches({ version: 2, world: {} }), false, 'an island save is not a frontier save');
  const options = legacy.atlasOptions(old);
  assert.deepEqual(options.regionTerrain.find(([key]) => key === '0,0'), ['0,0', 1], 'region 0,0 was generated by terrain version 1');
  const runtime = make(null, { atlas: options }), conversion = legacy.apply(runtime, old, 'feral.slot.frontier'), signal = runtime.modules['first-signal'];
  assert.equal(runtime.atlas.regionTerrain.get('0,0'), 1);
  // The placed block at 1 m cell (70, 30, 70) of region 0,0 and the cleared cell of region 1,0.
  assert.equal(runtime.atlas.getCell(140, 60, 140), 'dirt');
  assert.ok(runtime.conversionCells >= 16, `copied ${runtime.conversionCells} half-metre cells (two 1 m edits in two regions)`);
  assert.deepEqual([signal.reputation, signal.allies, signal.cores, signal.regions['0,0'].relays, signal.supplied], [[30, -5, 0], [0], 2, [0, 2], true]);
  assert.equal(signal.log[0], '기록 테스트');
  assert.equal(runtime.progression.count('food'), 5, 'the old food, no starting supplies');
  assert.equal(runtime.progression.count('mana_crystal_ore'), 3);
  assert.equal(runtime.progression.workCredits, 20, 'research records become research work');
  assert.deepEqual(conversion.extras, ['연구 작업 20초', '유적 핵 2개']);
  assert.ok(conversion.unmapped.some((u) => u.name === '경험치·레벨'));
  assert.ok(conversion.unmapped.some((u) => u.name === '아이템' && u.detail.startsWith('stew')));
  assert.deepEqual([Math.round(runtime.player.x), Math.round(runtime.player.z)], [80, 90]);
  assert.equal(conversion.from, 'feral.slot.frontier');
  // The converted world saves and loads as a runtime world.
  const again = make(JSON.parse(JSON.stringify(runtime.serialize())));
  assert.deepEqual([again.modules['first-signal'].cores, again.atlas.regionTerrain.get('0,0'), again.atlas.getCell(140, 60, 140)], [2, 1, 'dirt']);
});

test('a campaign record the rules reject starts a new campaign and says so; the rest still carries over', () => {
  const old = fixture(), legacy = generatorFor('frontier').legacySave;
  old.campaign.journey.claimed.push('no_such_milestone');
  const runtime = make(null, { atlas: legacy.atlasOptions(old) }), conversion = legacy.apply(runtime, old, 'feral.slot.frontier');
  assert.ok(conversion.unmapped.some((u) => u.name === '첫 신호 진행'));
  assert.deepEqual([runtime.modules['first-signal'].reputation, runtime.modules['first-signal'].supplied, runtime.progression.count('food')], [[0, 0, 0], true, 5]);
});
