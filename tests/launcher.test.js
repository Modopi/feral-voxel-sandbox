// Launcher and game session (docs/ARCHITECTURE.md §2–6): world settings live in the world list, the launcher
// makes and edits them, a session reads them, and only the session router picks an old engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  listWorlds, findWorld, worldConfig, createWorld, updateWorld, touchWorld, deleteWorld, hasSave, worldURL, saveKey,
  PRESETS, RULES, DEFAULTS, CATALOG, CONFIG_VERSION, VAULT_KEY, reconcileVault, mirrorVault, saveHash,
} from '../app/src/main/assets/world-slots.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';

const ASSETS = new URL('../app/src/main/assets/', import.meta.url);
const read = path => fs.readFileSync(new URL(path, ASSETS), 'utf8');
function store(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k),
    get length() { return map.size; }, key: i => [...map.keys()][i] ?? null,
    dump: () => Object.fromEntries([...map].filter(([k]) => k !== VAULT_KEY)),
  };
}
// The IndexedDB vault as a map: the app never swaps it when it isolates a build's `feral.*` storage.
function memoryVault() {
  const rows = new Map();
  return {
    rows, get: async k => rows.has(k) ? structuredClone(rows.get(k)) : undefined, getAll: async () => [...rows.values()].map(r => structuredClone(r)),
    apply: async (puts, removes) => { for (const p of puts) rows.set(p.key, structuredClone(p)); for (const k of removes) rows.delete(k); },
    value: k => rows.get(k)?.value,
  };
}
// What app 0.3.3 does on a version-list switch: keep this build's storage, give the chosen build its own
// last storage (or nothing if it never ran). Only `feral.*` keys are touched.
function nativeSwitch(current, snapshots, fromCode, toCode) {
  snapshots.set(fromCode, JSON.stringify(Object.fromEntries([...Array(current.length).keys()].map(i => current.key(i)).filter(k => k.startsWith('feral.')).map(k => [k, current.getItem(k)]))));
  return store(JSON.parse(snapshots.get(toCode) ?? '{}'));
}

test('worlds made before 0.15 get their preset settings; the list stays readable by older builds', () => {
  const db = store({ [CATALOG]: JSON.stringify([{ id: 'default', name: '기본 탐험 맵', type: 'island', seed: 63026 }, { id: 'w1', name: '탐험', type: 'expedition', seed: 7 }]) });
  assert.deepEqual(findWorld(db, 'default').config, { configVersion: 1, preset: 'island', seed: 63026, terrain: { generator: 'island' }, rules: { survival: false, sandbox: true, starterKit: true, dropOnDeath: true }, modules: [] });
  assert.deepEqual(findWorld(db, 'w1').config.rules, { survival: true, sandbox: false, startStructures: true, dropOnDeath: true });
  updateWorld(db, 'w1', { rules: { survival: false } });
  const row = JSON.parse(db.getItem(CATALOG)).find(w => w.id === 'w1');
  assert.deepEqual([row.id, row.name, row.type, row.seed], ['w1', '탐험', 'expedition', 7], 'the fields older builds read are unchanged');
  assert.equal(row.config.preset, row.type, 'type and preset stay equal');
  assert.equal(findWorld(db, 'missing'), null);
});

test('a world is made with its own settings; only what its session reads is accepted', () => {
  const db = store();
  const w = createWorld(db, ' 평화 섬 ', 'island', 123, { survival: true, starterKit: false });
  assert.equal(w.name, '평화 섬');
  assert.deepEqual(findWorld(db, w.id).config.rules, { survival: true, sandbox: true, starterKit: false, dropOnDeath: true });
  assert.deepEqual(createWorld(db, '탐험', 'expedition', 1, { sandbox: true }).config.rules, { survival: true, sandbox: true, startStructures: true, dropOnDeath: true }, 'content exploration reads sandbox since 0.15.2');
  assert.throws(() => createWorld(db, '탐험', 'expedition', 1, { starterKit: true }), /쓸 수 없는 설정/, 'a setting its preset does not offer');
  // The first signal runs on the runtime since 0.16.0: survival and the death rule (off by default), and its module.
  const frontier = createWorld(db, '개척', 'frontier', 1, { survival: false });
  assert.deepEqual([frontier.config.rules, findWorld(db, frontier.id).config.modules], [{ survival: false, dropOnDeath: false }, ['first-signal']]);
  assert.throws(() => createWorld(db, '개척', 'frontier', 1, { sandbox: true }), /쓸 수 없는 설정/, 'the frontier offers no sandbox');
  assert.throws(() => createWorld(db, '이상', 'island', 1, { survival: 'yes' }), /올바르지 않습니다/);
  assert.equal(listWorlds(db).length, DEFAULTS.length + 3, 'failed creations add nothing');
});

test('settings that shaped the world are fixed after creation; the name and play rules can change', () => {
  const db = store();
  const w = createWorld(db, '탐험', 'expedition', 5, { startStructures: false });
  assert.throws(() => updateWorld(db, w.id, { rules: { startStructures: true } }), /만든 뒤에는 바꿀 수 없는 설정/);
  const edited = updateWorld(db, w.id, { name: '평화 탐험', rules: { survival: false, dropOnDeath: false } });
  assert.equal(edited.name, '평화 탐험');
  assert.deepEqual(findWorld(db, w.id).config.rules, { survival: false, sandbox: false, startStructures: false, dropOnDeath: false });
  for (const [key, rule] of Object.entries(RULES)) assert(['always', 'create'].includes(rule.when), key);
});

test('a world from a newer settings format is refused instead of being misread', () => {
  const db = store({ [CATALOG]: JSON.stringify([{ id: 'w2', name: '미래', type: 'island', seed: 1, config: { configVersion: CONFIG_VERSION + 1, preset: 'island', seed: 1, rules: {} } }]) });
  assert.throws(() => findWorld(db, 'w2'), /읽을 수 없습니다/);
  assert.throws(() => worldConfig({ id: 'x', name: '어긋남', type: 'island', seed: 2, config: { configVersion: 1, preset: 'expedition', seed: 2 } }), /맞지 않습니다/);
});

test('sessions only record when a world was last played; saves and deletion keep the original keys', () => {
  const db = store({ 'feral.world.v1': 'old' });
  touchWorld(db, 'default', 1000);
  assert.equal(listWorlds(db).find(w => w.id === 'default').lastPlayedAt, 1000);
  assert.equal(hasSave(db, findWorld(db, 'default')), true);
  const w = createWorld(db, '섬', 'island');
  db.setItem(saveKey(w) + '.a', 'gen');
  assert.equal(hasSave(db, w), true);
  deleteWorld(db, w.id);
  assert.equal(db.getItem(saveKey(w) + '.a'), null);
  assert.equal(db.getItem('feral.world.v1'), 'old');
  // Every runtime world (the frontier since 0.16.0) drops its save generations with it.
  const f = createWorld(db, '원정', 'frontier');
  for (const suffix of ['', '.a', '.b']) db.setItem(saveKey(f) + suffix, 'save');
  deleteWorld(db, f.id);
  assert.deepEqual(['', '.a', '.b'].map(suffix => db.getItem(saveKey(f) + suffix)), [null, null, null]);
});

test('the launcher and the game session are separate pages; only the session router picks an engine', () => {
  for (const w of [...DEFAULTS, { id: 'w 1', type: 'expedition' }]) assert.equal(worldURL(w), `play.html?world=${encodeURIComponent(w.id)}`);
  const launcher = read('index.html'), session = read('play.html'), router = read('game.js');
  assert.match(launcher, /<script type="module" src="launcher\.js"><\/script>/);
  assert.doesNotMatch(launcher, /game\.js|id="hud"|<canvas/, 'the launcher page has no game screen');
  assert.match(launcher, /location\.replace\("play\.html" \+ location\.search\)/, 'old world links still open the session');
  assert.match(session, /<script type="module" src="game\.js"><\/script>/);
  assert.match(session, /id="settingsFields"/, 'the in-game menu builds the same settings form as the launcher');
  for (const gone of ['worlds.html', 'world-menu.js', 'expedition.html']) assert.equal(fs.existsSync(new URL(gone, ASSETS)), false, gone);
  assert.match(router, /PRESETS\[world\.type\]\.engine/);
  assert.match(router, /import\("\.\/content-runtime\/game\.js"\)\.then\(\(m\) => m\.start\(world\)\)/);
  assert.deepEqual(Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.engine])), { expedition: 'runtime', island: 'runtime', frontier: 'runtime', machine: 'machine' });
  const engineChoice = /\.engine\b/;
  for (const file of ['launcher.js', 'content-runtime/game.js', 'content-runtime/runtime.js', 'shell.js'])
    assert.doesNotMatch(read(file), engineChoice, `${file} must not pick an engine`);
});

test('session code never compares map or preset names; only the session router picks by preset', () => {
  // The session is one system: worlds differ by setting values and registered generators (docs/ARCHITECTURE.md §6).
  // Values that hold a map, preset or generator name, compared on either side ('machine' alone is also an entity kind).
  const holder = String.raw`(?:\bmap\.id|\bmapId|\bconfig\.preset|\bworld\.type|\.preset|\bgenerator\.id|\bterrain\.generator)`;
  const compare = new RegExp(String.raw`${holder}\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*${holder}|\bmapFor\(`);
  for (const line of ["island=runtime.map.id==='island'", "if(!saved&&config.terrain.generator==='island')", "if(world.config.preset==='island')", "'island'===world.type"]) assert.match(line, compare, line);
  assert.doesNotMatch("if(hit?.kind==='machine')", compare);
  const session = fs.readdirSync(new URL('content-runtime/', ASSETS)).filter(f => f.endsWith('.js') && !f.includes('.generated.')).map(f => `content-runtime/${f}`)
    .concat(['play.html', 'shell.js', 'settings.js', 'updates.js', 'inventory-ui.js', 'hud-editor.js']);
  for (const file of session) {
    const lines = read(file).split('\n'), hit = lines.findIndex(line => compare.test(line));
    assert.equal(hit, -1, `${file}:${hit + 1} compares a map name: ${lines[hit]?.trim().slice(0, 120)}`);
  }
  assert.match(read('game.js'), /PRESETS\[world\.type\]\.engine/, 'the session router still picks the old engines by preset until S3');
});

test('the runtime entry starts nothing when imported; the launcher can load it to check the files', async () => {
  const touched = () => { throw Error('DOM touched at import'); };
  globalThis.window = {};
  globalThis.document = { getElementById: touched, querySelector: touched, querySelectorAll: touched, addEventListener: touched, body: null };
  const module = await import('../app/src/main/assets/content-runtime/game.js');
  assert.deepEqual(Object.keys(module), ['start']);
  assert.equal(globalThis.window.FERAL, undefined);
  const launcher = read('launcher.js');
  assert.match(launcher, /await import\("\.\/content-runtime\/game\.js"\);[\s\S]*runtimeHealthy/, 'healthy is reported only after the session files load');
  assert.match(launcher, /runtimeFailed/);
});

test('the runtime starts from the world config: terrain generator and rules, never a map name', async () => {
  const islandConfig = worldConfig({ id: 'i', name: '섬', type: 'island', seed: 63026 });
  const runtime = await ExpeditionRuntime.create(63026, null, { config: { ...islandConfig, rules: { ...islandConfig.rules, survival: true, starterKit: false } } });
  assert.equal(runtime.generator.id, 'island');
  assert.deepEqual(runtime.rules, { survival: true, sandbox: true, startStructures: false, starterKit: false, dropOnDeath: true }, 'a rule the preset does not offer is off');
  assert.equal(runtime.progression.count('stone_pick'), 0, 'no starting kit when the world says so');
  const expeditionConfig = worldConfig({ id: 'e', name: '탐험', type: 'expedition', seed: 63026 });
  const restored = new ExpeditionRuntime(63026, runtime.serialize(), new Map(), { config: { ...expeditionConfig, rules: { survival: false } } });
  assert.equal(restored.generator.id, 'island', 'a save keeps the generator it was made with');
  assert.equal(restored.rules.survival, false, 'rules come from the world settings, not the save');
  assert.equal(JSON.stringify(runtime.serialize()).includes('"rules"'), false, 'settings are not copied into the save');
  const old = { ...runtime.serialize(), map: 'island' }; delete old.terrain;
  assert.equal(new ExpeditionRuntime(63026, old, new Map(), { config: expeditionConfig }).generator.id, 'island', 'a save from before 0.15.2 names its map');
  assert.deepEqual(new ExpeditionRuntime(63026, null, new Map()).rules, { survival: true, sandbox: false, startStructures: true, starterKit: false, dropOnDeath: true }, 'without a config the full rule set plays');
});

test('saves follow the player when a build is picked in the app version list (it starts with empty storage)', async () => {
  const vault = memoryVault(), snapshots = new Map();
  let ls = store({ 'feral.settings': '{"quality":"low"}' });
  const w = createWorld(ls, '내 섬', 'island');
  ls.setItem(saveKey(w) + '.a', 'island day 1');
  await mirrorVault(ls, vault, 2, 1500, 100);
  ls = nativeSwitch(ls, snapshots, 1500, 1501);
  assert.deepEqual(ls.dump(), {}, 'the app gives a build that never ran empty storage');
  const back = await reconcileVault(ls, vault, 2);
  assert.equal(ls.getItem(saveKey(w) + '.a'), 'island day 1', 'the world save came back');
  assert.equal(findWorld(ls, w.id).name, '내 섬');
  assert.equal(ls.getItem('feral.settings'), '{"quality":"low"}', 'settings came back too');
  assert(back.restored.includes(CATALOG));
  ls.setItem(saveKey(w) + '.a', 'island day 2');
  await mirrorVault(ls, vault, 2, 1501, 200);
  ls = nativeSwitch(ls, snapshots, 1501, 1502);
  await reconcileVault(ls, vault, 2);
  assert.equal(ls.getItem(saveKey(w) + '.a'), 'island day 2', 'the latest progress follows into the next build');
});

test('the latest copy follows back to a build that ran before; a newer save schema is never taken or overwritten', async () => {
  const vault = memoryVault(), snapshots = new Map();
  let ls = store({ 'feral.slot.w1.a': 'v1' });
  await mirrorVault(ls, vault, 2, 1500, 100);
  ls = nativeSwitch(ls, snapshots, 1500, 1501);
  await reconcileVault(ls, vault, 2);
  ls.setItem('feral.slot.w1.a', 'v2'); await mirrorVault(ls, vault, 2, 1501, 200);
  ls = nativeSwitch(ls, snapshots, 1501, 1500);
  assert.equal(ls.getItem('feral.slot.w1.a'), 'v1', 'the app hands back the old build its old storage');
  await reconcileVault(ls, vault, 2);
  assert.equal(ls.getItem('feral.slot.w1.a'), 'v2', 'the same save schema reads the latest copy');
  ls = nativeSwitch(ls, snapshots, 1500, 1600);
  await reconcileVault(ls, vault, 3);
  ls.setItem('feral.slot.w1.a', 'v3 schema 3'); await mirrorVault(ls, vault, 3, 1600, 300);
  ls = nativeSwitch(ls, snapshots, 1600, 1500);
  const old = await reconcileVault(ls, vault, 2);
  assert.equal(old.kept, 'newer-schema');
  assert.equal(ls.getItem('feral.slot.w1.a'), 'v2', 'a build of an older schema keeps its own copy');
  ls.setItem('feral.slot.w1.a', 'v2 played'); assert.equal((await mirrorVault(ls, vault, 2, 1500, 400)).skipped, 'newer-schema');
  assert.equal(vault.value('feral.slot.w1.a'), 'v3 schema 3', 'and never overwrites the newer copy');
});

test('storage from a build before the vault stays where the player left off and replaces the copy whole', async () => {
  const vault = memoryVault();
  let first = store({ 'feral.world.v1.a': 'fresh island', 'feral.slot.only-in-vault': 'x' });
  await mirrorVault(first, vault, 2, 1500, 100);
  const ls = store({ 'feral.world.v1.a': 'played in 0.14.1', 'feral.world.v1': 'legacy' });
  const r = await reconcileVault(ls, vault, 2);
  assert.equal(r.kept, 'unvaulted');
  assert.equal(ls.getItem('feral.slot.only-in-vault'), null, 'the two builds never mix');
  await mirrorVault(ls, vault, 2, 1500, 200);
  assert.equal(vault.value('feral.world.v1.a'), 'played in 0.14.1');
  assert.equal(vault.rows.has('feral.slot.only-in-vault'), false, 'the copy is replaced as a whole');
  const w = createWorld(ls, '지울 월드', 'expedition');
  ls.setItem(saveKey(w) + '.b', 'save');
  await mirrorVault(ls, vault, 2, 1500, 300);
  assert.equal(vault.value(saveKey(w) + '.b'), 'save');
  deleteWorld(ls, w.id);
  await mirrorVault(ls, vault, 2, 1500, 400);
  assert.equal(vault.rows.has(saveKey(w) + '.b'), false, 'a deleted world leaves the vault');
  const fresh = store();
  await reconcileVault(fresh, vault, 2);
  assert.equal(fresh.getItem(saveKey(w) + '.b'), null, 'and does not come back');
  assert.equal(fresh.getItem('feral.world.v1'), 'legacy');
});

test('copying unchanged data writes nothing; a build that never saved leaves the vault as it was', async () => {
  const vault = memoryVault(), ls = store({ 'feral.slot.w1.a': 'same' });
  assert.deepEqual((await mirrorVault(ls, vault, 2, 1500, 100)).written, ['feral.slot.w1.a']);
  assert.deepEqual((await mirrorVault(ls, vault, 2, 1501, 200)).written, [], 'same content, no new copy');
  assert.equal(vault.rows.get('@meta').code, 1500, 'the copy keeps the build that wrote it');
  assert.equal(JSON.parse(ls.getItem(VAULT_KEY)).savedAt, 100);
  ls.setItem('feral.slot.w2.a', 'big'); await mirrorVault(ls, vault, 2, 1501, 300);
  const full = store({ 'feral.slot.w1.a': 'old' });
  full.setItem(VAULT_KEY, JSON.stringify({ savedAt: 50, schema: 2, code: 1400 }));
  const setItem = full.setItem; full.setItem = (k, v) => { if (k === 'feral.slot.w2.a') throw Error('quota'); setItem(k, v); };
  await assert.rejects(reconcileVault(full, vault, 2), /quota/);
  full.setItem = setItem;
  assert.equal(full.getItem('feral.slot.w1.a'), 'old', 'a failed restore puts the previous storage back');
});

test('every engine copies its saves into the vault; the launcher restores before anything reads', () => {
  assert.match(read('content-runtime/game.js'), /autosave\.writeNow\(snapshot\(\)\);syncVault\(\)/);
  assert.match(read('content-runtime/game.js'), /onSaved:\(\)=>\{syncVault\(\);/);
  assert.match(read('machine/view.js'), /localStorage\.setItem\(storage, serialize\(state\)\);\n    syncVault\(\);/);
  const launcher = read('launcher.js');
  assert.match(launcher, /const restoring = restoreFromVault\(\)/);
  assert.match(launcher, /restoring\.finally\(\(\) => \(location\.href = worldURL\(w\)\)\)/, 'a world opens only after the restore');
});
