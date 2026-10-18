// One game screen for every map (docs/UNIFIED-GAME.md): routing, shared shell modules,
// the shared bag over count-based items, and the one notification line.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { ItemSlots, designCatalog, STACK } from '../app/src/main/assets/content-runtime/item-slots.js';
import { worldURL, DEFAULTS } from '../app/src/main/assets/world-slots.js';
import { createNotifier } from '../app/src/main/assets/shell.js';

const ASSETS = new URL('../app/src/main/assets/', import.meta.url);
const read = path => fs.readFileSync(new URL(path, ASSETS), 'utf8');

test('every world type except the machine field opens the one game screen', () => {
  for (const type of ['island', 'frontier', 'expedition'])
    assert.match(worldURL({ id: 'w1', type }), /^index\.html\?world=w1$/, type);
  assert.match(worldURL({ id: 'beta', type: 'machine' }), /^machine\.html/, 'the machine field moves in the map-preset step');
  assert.deepEqual(DEFAULTS.map(w => w.type), ['island', 'frontier', 'machine']);
  const entry = read('game.js');
  assert.match(entry, /\.\/content-runtime\/game\.js/);
  assert.match(entry, /\.\/main\.js/);
  assert.match(read('index.html'), /<script type="module" src="game\.js"><\/script>/);
  const old = read('expedition.html');
  assert.doesNotMatch(old, /stylesheet|type="module"/, 'the old expedition page only forwards to index.html');
  assert.match(old, /location\.replace\("index\.html" \+ location\.search\)/);
});

test('maps share the shell module instead of keeping their own screen code', () => {
  const expedition = read('content-runtime/game.js'), island = read('main.js'), frontier = read('frontier/view.js'), shell = read('shell.js');
  for (const name of ['createInput', 'createNotifier', 'initSettings', 'bindMenuTabs', 'showPauseScreen', 'bindBackground', 'showMovementState', 'changeStance', 'changeSprint', 'GameWindow', 'mountFieldHUD', 'setVitals'])
    assert.match(shell, new RegExp(`export (?:function|class) ${name}\\b`), `shell exports ${name}`);
  for (const name of ['createInput', 'createNotifier', 'initSettings', 'bindMenuTabs', 'showMovementState', 'changeStance'])
    assert(new RegExp(`\\b${name}\\b[^;]*from '\\.\\./shell\\.js'`, 's').test(expedition), `expedition uses ${name}`);
  for (const name of ['createInput', 'createNotifier', 'initSettings', 'bindMenuTabs', 'showMovementState', 'changeStance'])
    assert(new RegExp(`\\b${name}\\b[^;]*from "\\./shell\\.js"`, 's').test(island), `island/frontier uses ${name}`);
  for (const shared of ['inventory-ui.js', 'hud-editor.js'])
    assert(expedition.includes(`'../${shared}'`), `expedition uses ${shared}`);
  assert.match(frontier, /GameWindow[^;]*from "\.\.\/shell\.js"/s);
  assert.match(frontier, /mountFieldHUD[^;]*from "\.\.\/shell\.js"/s);
  const runtimeFiles = fs.readdirSync(new URL('content-runtime/', ASSETS));
  assert.deepEqual(runtimeFiles.filter(f => f.endsWith('.css') || f.endsWith('.html')), [], 'no map-only stylesheet or page');
  assert(!runtimeFiles.includes('entry.js'), 'the separate expedition screen is gone');
  for (const old of ['toastQueue', 'movePad', 'panelList', 'openBag\')', 'aimLabel', 'actionProgress', 'function holdButton', 'function showToast'])
    assert(!expedition.includes(old), `expedition does not rebuild ${old}`);
  assert(!island.includes('function holdButton') && !island.includes('function persistSettings'), 'island moved its controls and settings to the shell');
});

test('the update package stays under the native file limit', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(new URL(e.name + '/', dir)) : [e.name]);
  const limit = Number(/MAX_FILES = (\d+)/.exec(fs.readFileSync(new URL('../app/src/main/java/com/kgb/feral/UpdateCore.java', import.meta.url), 'utf8'))[1]);
  const count = walk(ASSETS).length;
  assert(count <= limit - 4, `${count} game files leave room under the app's ${limit}-file limit`);
});

test('every element the expedition screen reads exists on the shared page or is built by a shared module', () => {
  const expedition = read('content-runtime/game.js');
  const ids = new Set([...expedition.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map(m => m[1]));
  const provided = [read('index.html'), read('shell.js'), read('inventory-ui.js')].join('\n');
  const missing = [...ids].filter(id => !new RegExp(`id="${id}"`).test(provided));
  assert(ids.size > 30, `checked ${ids.size} ids`);
  assert.deepEqual(missing, []);
});

test('the shared bag lays count-based items into 36 slots, stacks of 64 and a 9-slot hotbar', () => {
  const p = new Progression(CONTENT, {});
  assert.equal(p.grant({ raw_timber: 130, loose_stone: 5, plant_fiber: 2.5 }, { claimId: 'slots:grant' }).ok, true);
  const slots = new ItemSlots(p);
  const filled = slots.slots.filter(Boolean);
  assert.equal(slots.slots.length, 36);
  assert.deepEqual(filled.filter(s => s.id === 'raw_timber').map(s => s.count), [STACK, STACK, 2], 'stacks follow the progression slot rule');
  assert.equal(filled.find(s => s.id === 'plant_fiber').count, 2.5, 'fractional amounts stay visible');
  const stone = slots.slots.findIndex(s => s?.id === 'loose_stone');
  assert(slots.move(stone, 20));
  assert.equal(slots.slots[20].id, 'loose_stone');
  slots.select(4);
  const restored = new ItemSlots(p, JSON.parse(JSON.stringify(slots.serialize())));
  assert.equal(restored.slots[20].id, 'loose_stone', 'arrangement survives save/load');
  assert.equal(restored.selectedSlot, 4);
  restored.select(20);
  assert.equal(restored.selectedSlot, 4, 'only hotbar slots can be held');
  assert.equal(p.spend({ raw_timber: 100 }, { claimId: 'slots:spend' }).ok, true);
  assert.deepEqual(restored.slots.filter(s => s?.id === 'raw_timber').map(s => s.count), [30], 'spent stacks free their slots');
  assert.equal(restored.slots.filter(Boolean).length, 3);
  p.overflow = { berry: 3 };
  assert.deepEqual(restored.overflow, [{ id: 'berry', count: 3 }]);
});

test('design catalog items get names, art, wear, uses and recipes for the shared bag', () => {
  const runtime = { progression: new Progression(CONTENT, {}) };
  const name = id => runtime.progression.catalog.get(id)?.name ?? id;
  const catalog = designCatalog(runtime, { name });
  const recipes = catalog.recipes();
  assert.equal(recipes.length, runtime.progression.list('recipe').length);
  for (const r of recipes) {
    assert.equal(typeof r.craftable, 'boolean');
    assert(r.cost.length <= 4 || r.cost.length > 0);
    assert(r.names.includes(r.name));
    if (!r.craftable) assert.doesNotMatch(r.blocked, /^[a-z_]+$/, `${r.id} explains why it is blocked`);
  }
  for (const id of runtime.progression.items) assert.match(catalog.art(id), /<svg class="itemIcon"/, `${id} has art`);
  assert.match(catalog.sources('raw_timber')[0], /채집/);
  assert.match(catalog.sources('wood')[0], /제작/);
  assert.deepEqual(catalog.durability('stone_pick'), { value: 120, max: 120 });
  assert.equal(catalog.durability('raw_timber'), null);
});

test('one notification line: results replace, world events queue without duplicates', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const classes = new Set(), el = { textContent: '', classList: { add: c => classes.add(c), remove: c => classes.delete(c) } };
    const notify = createNotifier(el, { translate: text => text === 'code_x' ? '번역된 안내' : text });
    notify('첫 결과');
    assert.equal(el.textContent, '첫 결과');
    notify('사건 A', { queue: true });
    notify('사건 A', { queue: true });
    notify('사건 B', { queue: true });
    assert.deepEqual(notify.pending(), ['사건 A', '사건 B']);
    notify('code_x');
    assert.equal(el.textContent, '번역된 안내', 'direct results show immediately and are translated');
    mock.timers.tick(2600);
    assert.equal(el.textContent, '사건 A');
    mock.timers.tick(2600);
    assert.equal(el.textContent, '사건 B');
    mock.timers.tick(3200);
    assert(!classes.has('show'));
    assert.equal(notify.busy(), false);
  } finally {
    mock.timers.reset();
  }
});
