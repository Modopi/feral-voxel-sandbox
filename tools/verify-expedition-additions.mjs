import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const web = path.join(root, 'app/src/main/assets');
const outputRoot = path.join(root, 'verification/expedition-additions');
await fs.mkdir(outputRoot, { recursive: true });
const previousAttempts = (await fs.readdir(outputRoot, { withFileTypes: true }))
  .map(entry => /^attempt-(\d+)$/.exec(entry.name)?.[1])
  .filter(Boolean)
  .map(Number);
const out = path.join(outputRoot, `attempt-${Math.max(0, ...previousAttempts) + 1}`);
await fs.mkdir(out, { recursive: true });

const seed = 63026;
const report = {
  scope: 'Prepared-save browser integration evidence only; fixtures provide starting inventory, research, and position. This is not normal-progression or mobile-device evidence.',
  environment: 'Headless Chromium / Linux / SwiftShader software WebGL',
  seed,
  preparationPolicy: 'Direct runtime setup is limited to inventory, research, player position, natural world generation, a one-time electrical test-energy escrow, and a declared saved stun on the machine shooting target. The escrow remains unclaimed until storage is installed through the UI. All crafting, delivery, attunement, device installation/operation, machine assembly/charging/firing, attacking, and saving use visible UI or keyboard/pointer input.',
  normalProgressionEvidence: false,
  mobilePerformanceEvidence: false,
  scenarios: {},
  steps: [],
  errors: [],
  consoleErrors: [],
  failedRequests: [],
  startedAt: new Date().toISOString(),
};

const jsonCopy = value => JSON.parse(JSON.stringify(value));
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const point = value => Array.isArray(value) ? { x: value[0], y: value[1], z: value[2] } : value;

function addItems(runtime, items, claimId) {
  const result = runtime.progression.grant(items, { claimId });
  if (!result.ok) throw Error(`Fixture inventory rejected: ${JSON.stringify(result)}`);
}

function addResearch(runtime, ids) {
  for (const id of ids) {
    if (!runtime.progression.catalog.has(id)) throw Error(`Fixture research is missing from catalog: ${id}`);
    runtime.progression.research.add(id);
  }
}

function setPlayer(runtime, position, yaw = Math.PI) {
  const p = point(position);
  Object.assign(runtime.player, {
    x: p.x, y: p.y, z: p.z, yaw, pitch: 0, vy: 0,
    grounded: false, stance: 'stand', resting: false,
  });
  const loadout = runtime.progression.evaluateLoadout();
  runtime.player.maxHp = loadout.maxHp;
  runtime.player.hp = loadout.maxHp;
  runtime.refreshWorld();
}

async function makeRuntime() {
  return ExpeditionRuntime.create(seed);
}

function manorAndBoss(runtime) {
  const manor = [...runtime.dungeons.instances.values()].find(i => i.templateId === 'root_manor');
  if (!manor) throw Error('Starter root_manor instance was not generated');
  const boss = runtime.dungeons.anchors(manor.id).find(a => a.kind === 'boss');
  if (!boss) throw Error('Starter root_manor boss anchor is missing');
  return { manor, boss };
}

function findNaturalInstance(runtime, templateId) {
  // Search deterministic world-generated candidate sites, then ask the normal
  // placement owner to materialize only a candidate in a 1m query radius.
  const centers = [[0, 0]];
  for (let ring = 1; ring <= 12; ring++) {
    for (let x = -ring; x <= ring; x++) centers.push([x * 1024, -ring * 1024]);
    for (let z = -ring + 1; z <= ring; z++) centers.push([ring * 1024, z * 1024]);
    for (let x = ring - 1; x >= -ring; x--) centers.push([x * 1024, ring * 1024]);
    for (let z = ring - 1; z > -ring; z--) centers.push([-ring * 1024, z * 1024]);
  }
  const seen = new Set();
  for (const [cx, cz] of centers) {
    const sites = runtime.atlas.findBuildingSites(cx, cz, 2048)
      .filter(site => site.templateId === templateId && !seen.has(site.id))
      .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz) || a.id.localeCompare(b.id));
    for (const site of sites) {
      seen.add(site.id);
      runtime.dungeons.ensureNear([site.x, site.y, site.z], 1);
      const instance = runtime.dungeons.get(`structure:${seed}:${site.id}:${templateId}`);
      if (instance) return { instance, site };
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/__prepare') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>prepared-save setup</title>');
    return;
  }
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(web, `.${pathname}`);
    if (!file.startsWith(web + path.sep)) throw Error('outside web root');
    const body = await fs.readFile(file);
    res.setHeader('Content-Type', ({
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
      '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
    })[path.extname(file)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(25000);
page.on('response', response => { if (response.status() >= 400) report.failedRequests.push({ url: response.url(), status: response.status() }); });
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() }); });

async function runtimeView(extra = {}) {
  return page.evaluate(({ instanceId, bossId, machineId, coverMachineId }) => {
    const f = window.FERAL, r = f?.runtime;
    if (!r) return null;
    const instance = instanceId ? r.dungeons.get(instanceId) : null;
    const boss = bossId ? r.bosses.get(bossId) : null;
    const machine = machineId ? r.machines.machines.get(machineId) : null;
    const cover = coverMachineId ? r.machines.machines.get(coverMachineId) : null;
    const machineSummary = m => m && ({ id: m.id, name: m.name, position: m.position, voxels: m.voxels.map(v => ({ id: v.id, cell: v.cell, hp: v.hp, maxHp: v.maxHp })),
      components: m.components.map(c => ({ id: c.id, componentId: c.componentId, voxelId: c.voxelId, energy: { ...c.energy }, shotsFired: c.shotsFired ?? null, fireLedger: c.fireLedger ?? [], fireCache: c.fireCache ?? [] })),
      damageClaims: [...m.damageClaims], metrics: { ...m.metrics } });
    const gateGeometry = instance ? r.dungeons.devices.geometry(instanceId).filter(b => b.partId === 'puzzle_gate').map(b => ({ center: b.center, size: b.size })) : [];
    return {
      time: r.time,
      player: { ...r.player },
      inventory: { ...r.progression.inventory },
      energy: { ...r.progression.energy },
      energyCapacity: Object.fromEntries(['mechanical', 'electrical', 'thermal', 'chemical', 'magic', 'divine'].map(type => [type, r.progression.energyCapacity(type)])),
      energyOverflow: { ...r.progression.energyOverflow },
      worldFixtures: r.placements.serialize().fixtures.map(fixture => ({ id: fixture.id, assetId: fixture.assetId, position: fixture.position, hp: fixture.hp })),
      research: [...r.progression.research].sort(),
      stations: { ...r.progression.stations },
      armaments: r.armaments.serialize(),
      faith: r.faith.serialize(),
      boss: boss && { id: boss.id, hp: boss.hp, maxHp: boss.maxHp, position: boss.position, defeated: boss.defeated },
      dungeon: instance && { id: instance.id, templateId: instance.templateId, puzzle: instance.puzzle, deviceState: instance.deviceState, gateGeometry,
        status: r.dungeons.devices.status(instanceId, { progression: r.progression }) },
      machine: machineSummary(machine),
      coverMachine: machineSummary(cover),
      currentAim: f.view.aim()?.kind ? { kind: f.view.aim().kind, id: f.view.aim().id, partId: f.view.aim().partId, point: f.view.aim().point, distance: f.view.aim().distance } : null,
      physicsReady: !!f.physics,
    };
  }, extra);
}

async function writeReport() {
  report.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
}

async function record(label, extra = {}) {
  const state = await runtimeView(extra.ids ?? {});
  const step = { label, at: new Date().toISOString(), ...extra, state };
  report.steps.push(step);
  console.log(JSON.stringify({ step: label, scenario: extra.scenario ?? null, time: state?.time, hp: state?.boss?.hp, player: state?.player && { x: state.player.x, y: state.player.y, z: state.player.z } }));
  const file = `${String(report.steps.length).padStart(2, '0')}-${label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.png`;
  await page.screenshot({ path: path.join(out, file), fullPage: false });
  await writeReport();
  return state;
}

async function prepareSave(worldId, runtime, fixtureNotes) {
  const fixture = runtime.serialize();
  await fs.writeFile(path.join(out, `${worldId}-prepared-save.json`), JSON.stringify(fixture, null, 2));
  report.scenarios[worldId] = { preparation: fixtureNotes, fixturePlayer: fixture.player, actions: [], checks: {}, status: 'prepared' };
  await page.goto(`${origin}/__prepare`);
  await page.evaluate(async ({ fixture, worldId, seed }) => {
    const rows = JSON.parse(localStorage.getItem('feral.worlds.v1') || '[]').filter(row => row.id !== worldId);
    rows.push({ id: worldId, type: 'expedition', name: `prepared ${worldId}`, seed });
    localStorage.setItem('feral.worlds.v1', JSON.stringify(rows));
    const { ExpeditionSave } = await import('/content-runtime/save.js');
    const store = new ExpeditionSave(localStorage, `feral.slot.${worldId}`);
    store.write(fixture);
  }, { fixture, worldId, seed });
  await page.goto(`${origin}/expedition.html?world=${encodeURIComponent(worldId)}`);
  await page.waitForFunction(() => window.FERAL?.ready, undefined, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape').catch(() => {});
  if (await page.locator('#menu').isVisible()) await page.locator('#closeMenu').click();
  if (await page.locator('#panel').isVisible()) await page.locator('#closePanel').click();
  await page.waitForTimeout(250);
  const loaded = await runtimeView();
  if (!loaded) throw Error(`Prepared save failed to boot: ${worldId}`);
  await record(`${worldId}-loaded`, { scenario: worldId, fixtureNotes });
  return loaded;
}

async function ensurePanel(tab) {
  if (!(await page.locator('#panel').isVisible())) await page.locator('#openBag').click();
  await page.locator(`[data-tab="${tab}"]`).click();
  await page.waitForTimeout(100);
}

function row(title) {
  return page.locator('#panelList .row').filter({ has: page.locator('b').filter({ hasText: title }) }).first();
}

async function clickRowAction(title, action) {
  const target = row(title);
  await target.waitFor({ state: 'visible' });
  const button = target.getByRole('button', { name: action, exact: true });
  await button.waitFor({ state: 'visible' });
  if (await button.isDisabled()) throw Error(`UI action is disabled: ${title} → ${action}`);
  await button.click();
  await page.waitForTimeout(100);
}

async function saveReconnect(ids, compare) {
  if (await page.locator('#panel').isVisible()) await page.locator('#closePanel').click();
  if (!(await page.locator('#menu').isVisible())) await page.locator('#openMenu').click();
  await page.locator('#save').click();
  await page.waitForTimeout(300);
  const before = await runtimeView(ids);
  await page.reload();
  await page.waitForFunction(() => window.FERAL?.ready, undefined, { timeout: 90000 });
  if (!(await page.locator('#menu').isVisible())) await page.locator('#openMenu').click();
  await page.locator('#save').click();
  const after = await runtimeView(ids);
  const elapsed = after.time - before.time;
  assert(elapsed >= 0 && elapsed <= 10, `Simulation time was not monotonic or advanced unexpectedly during reconnect: ${elapsed}`);
  const systemClockDeltas = {};
  for (const field of ['faith', 'armaments']) {
    if (Number.isFinite(before[field]?.clock) && Number.isFinite(after[field]?.clock)) {
      systemClockDeltas[field] = after[field].clock - before[field].clock;
      assert(systemClockDeltas[field] >= 0 && systemClockDeltas[field] <= elapsed + 0.5,
        `${field} clock did not advance monotonically with simulation time: ${systemClockDeltas[field]} / ${elapsed}`);
    }
  }
  const beforeValue = compare(before), afterValue = compare(after);
  assert.deepEqual(afterValue, beforeValue, 'UI save and reconnect changed persisted gameplay state');
  await record('save-reconnect', { ids, preserved: true, compared: beforeValue, elapsedSimulationSeconds: elapsed, systemClockDeltas });
  await page.locator('#closeMenu').click();
  return { before, after };
}

async function mouseLookAt(target) {
  for (let step = 0; step < 8; step++) {
    // Driving updates the avatar seat on a physics frame; never aim from a
    // stale standing position or query the camera before its render update.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const p = await page.evaluate(() => ({ ...window.FERAL.runtime.player, eye: window.FERAL.controller.eye }));
    const dx = target.x - p.x, dz = target.z - p.z, dy = target.y - (p.y + p.eye);
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const delta = ((yaw - p.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const dyaw = Math.max(-900, Math.min(900, -delta / .005));
    const dpitch = Math.max(-500, Math.min(500, -(pitch - p.pitch) / .005));
    if (Math.hypot(dyaw, dpitch) < 6) break;
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(640 + dyaw, 400 + dpitch, { steps: 5 });
    await page.mouse.up();
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function walkTo(target, stop = 2.8, maxSteps = 100) {
  target = point(target);
  for (let i = 0; i < maxSteps; i++) {
    const p = await page.evaluate(() => ({ ...window.FERAL.runtime.player }));
    const distance = Math.hypot(target.x - p.x, target.z - p.z);
    if (distance <= stop) return true;
    await mouseLookAt({ x: target.x, y: p.y + .7, z: target.z });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(Math.max(90, Math.min(500, (distance - stop) / 3 * 1000)));
    await page.keyboard.up('KeyW');
  }
  return false;
}

async function waitFor(predicate, arg, timeout = 45000) {
  await page.waitForFunction(predicate, arg, { timeout, polling: 50 });
}

async function aimAtBoss(bossId, preferredHeight = 1.45) {
  const heights = [preferredHeight, 1.0, 2.0, 2.7, .6];
  for (const height of heights) {
    const b = await page.evaluate(id => {
      const q = window.FERAL.runtime.bosses.get(id);
      return q ? { x: q.position.x, y: q.position.y, z: q.position.z } : null;
    }, bossId);
    if (!b) throw Error(`Boss target missing: ${bossId}`);
    await mouseLookAt({ x: b.x, y: b.y + height, z: b.z });
    const hit = await page.evaluate(() => {
      const r=window.FERAL.runtime;
      const h = window.FERAL.view.aim(r.drivingMachineId ? {range:24,excludeOwnerId:r.drivingMachineId} : undefined);
      return h ? { kind: h.kind, id: h.id, point: h.point, distance: h.distance, partId: h.partId } : null;
    });
    if (hit?.kind === 'boss' && hit.id === bossId) return hit;
  }
  throw Error(`Normal camera aim did not resolve to boss ${bossId}: ${JSON.stringify(await page.evaluate(() => { const h = window.FERAL.view.aim(); return h && { kind: h.kind, id: h.id, distance: h.distance }; }))}`);
}

async function attackOnceUntil(weaponId, durability, actionName) {
  const button = page.locator('#attack');
  await button.hover();
  await page.mouse.down();
  try {
    await waitFor(({ id, before }) => window.FERAL.runtime.armaments.weapons.find(w => w.id === id)?.durability < before, { id: weaponId, before: durability }, 12000);
  } finally {
    await page.mouse.up();
  }
  report.scenarios[actionName].actions.push({ input: 'pointer hold on #attack', at: new Date().toISOString() });
}

async function createWeaponFixture() {
  const runtime = await makeRuntime();
  const { manor, boss } = manorAndBoss(runtime);
  addItems(runtime, { gear_baseline_t8: 1, field_bench: 1, wood: 20, plant_fiber: 10 }, 'verify-additions:weapon-kit');
  runtime.progression.equip('gear_baseline_t8');
  addResearch(runtime, ['material:wood']);
  setPlayer(runtime, { x: manor.origin[0] + 82, y: manor.origin[1] + .05, z: manor.origin[2] - 10 }, -Math.PI / 2);
  return { runtime, manor, bossId: boss.bossInstanceId };
}

async function runWeaponScenario() {
  const { runtime, manor, bossId } = await createWeaponFixture();
  const worldId = 'additions-weapon';
  const initial = await prepareSave(worldId, runtime, { allowedFixture: { items: { gear_baseline_t8: 1, field_bench: 1, wood: 20, plant_fiber: 10 }, research: ['material:wood'] }, target: bossId });
  const scenario = report.scenarios[worldId];
  scenario.actions = [];
  await ensurePanel('inventory');
  await clickRowAction('야외 작업대', '앞에 설치');
  let state = await runtimeView({ bossId });
  assert(state.stations.field_bench > 0, 'UI did not install the prepared field bench');
  scenario.checks.stationInstalledThroughUI = true;
  await record('weapon-bench-installed', { scenario: worldId, ids: { bossId } });

  await ensurePanel('weapons');
  await page.locator('select[aria-label="무기 형태"]').selectOption('weapon_pierce');
  await page.locator('select[aria-label="무기 재질"]').selectOption('wood');
  const quote = await page.evaluate(() => window.FERAL.runtime.armaments.quote('weapon_pierce', 'wood'));
  assert(quote.ok, `Prepared weapon quote was blocked: ${JSON.stringify(quote)}`);
  const beforeInventory = { ...(await runtimeView()).inventory };
  await clickRowAction(quote.name, '제작');
  await waitFor(({ before }) => window.FERAL.runtime.armaments.weapons.length > before, { before: 0 }, 180000);
  await record('weapon-crafted-through-ui', { scenario: worldId, quote, fixtureInventoryBeforeCraft: beforeInventory, ids: { bossId } });
  await ensurePanel('weapons');
  const uiRows = await page.evaluate(name => [...document.querySelectorAll('#panelList .row')]
    .filter(element => element.querySelector('b')?.textContent.includes(name))
    .map(element => ({ title: element.querySelector('b')?.textContent, buttons: [...element.querySelectorAll('button')].map(button => ({ text: button.textContent, disabled: button.disabled })) })), quote.name);
  const runtimeWeaponName = await page.evaluate(() => window.FERAL.runtime.armaments.weapons.at(-1)?.name);
  assert.equal(runtimeWeaponName, quote.name, 'Runtime crafted weapon name differed from the selected UI quote');
  const weaponRows = page.locator('#panelList .row').filter({ has: page.locator('b').filter({ hasText: quote.name }) });
  const equipButton = weaponRows.getByRole('button', { name: '장착', exact: true }).first();
  await equipButton.waitFor({ state: 'visible' });
  await equipButton.click();
  state = await runtimeView({ bossId });
  const created = state.armaments.weapons[0];
  assert.equal(state.armaments.equippedId, created.id, 'Weapon was not equipped through UI');
  assert((state.inventory.wood ?? 0) < (beforeInventory.wood ?? 0), 'Weapon crafting did not spend wood');
  assert((state.inventory.plant_fiber ?? 0) < (beforeInventory.plant_fiber ?? 0), 'Weapon crafting did not spend plant fiber');
  scenario.checks = { ...scenario.checks, actualCraftCostPaid: true, materialSelectedThroughUI: true, shapeSelectedThroughUI: true, equippedThroughUI: true, craftSeconds: quote.seconds, craftInputs: quote.inputs, runtimeWeaponName, matchingUiRows: uiRows };
  scenario.actions.push({ input: 'weapon shape/material selects and craft/equip buttons', quote: { patternId: quote.patternId, materialId: quote.materialId, inputs: quote.inputs, seconds: quote.seconds } });

  await page.locator('#closePanel').click();
  const bossBefore = (await runtimeView({ bossId })).boss;
  const target = await page.evaluate(id => { const b = window.FERAL.runtime.bosses.get(id); return b && { x: b.position.x, y: b.position.y, z: b.position.z }; }, bossId);
  const walked = await walkTo({ ...target, z: target.z - 2.3 }, 2.9, 60);
  if (!walked) throw Error('UI keyboard movement did not bring the player into weapon range');
  let hit = await aimAtBoss(bossId, 1.3);
  let current = await runtimeView({ bossId });
  if (hit.distance > created.range + .01) {
    const fresh = await page.evaluate(id => { const b = window.FERAL.runtime.bosses.get(id); return { x: b.position.x, y: b.position.y, z: b.position.z }; }, bossId);
    if (!await walkTo({ ...fresh, z: fresh.z - Math.max(1, created.range - .6) }, created.range - .35, 30)) throw Error('Player remained outside crafted weapon range');
    hit = await aimAtBoss(bossId, 1.3);
    current = await runtimeView({ bossId });
  }
  const beforeAttackHp = current.boss.hp;
  const beforeAttackWeapon = current.armaments.weapons.find(w => w.id === created.id);
  await attackOnceUntil(created.id, beforeAttackWeapon.durability, worldId);
  state = await runtimeView({ bossId });
  const afterWeapon = state.armaments.weapons.find(w => w.id === state.armaments.equippedId);
  assert(afterWeapon.durability < created.durability, 'UI attack did not reduce crafted weapon durability');
  assert(state.boss.hp < beforeAttackHp, 'UI weapon attack did not damage the aimed boss');
  scenario.checks.actualAttackWoreDurability = true;
  scenario.checks.attackTarget = { kind: hit.kind, id: hit.id, distance: hit.distance };
  scenario.checks.bossHpBefore = bossBefore.hp;
  scenario.checks.bossHpAfter = state.boss.hp;
  await record('weapon-attacked-and-worn', { scenario: worldId, ids: { bossId }, aim: hit, weaponDurabilityBefore: created.durability, weaponDurabilityAfter: afterWeapon.durability });

  const ids = { bossId };
  await saveReconnect(ids, s => {
    const armaments = { ...s.armaments };
    delete armaments.clock;
    return { armaments, inventory: s.inventory, hp: s.boss?.hp };
  });
  scenario.status = 'complete';
}

async function createFaithFixture() {
  const runtime = await makeRuntime();
  const found = findNaturalInstance(runtime, 'communal_archive');
  if (!found) throw Error('No naturally generated communal_archive found in deterministic search');
  const shrine = runtime.faith.shrine(found.instance.id);
  if (!shrine) throw Error('Natural archive has no faith shrine anchor');
  addItems(runtime, { food: 12, wood: 16 }, 'verify-additions:faith-supplies');
  setPlayer(runtime, { x: shrine.position.x, y: shrine.position.y + .05, z: shrine.position.z }, Math.PI);
  return { runtime, instance: found.instance, shrine, site: found.site };
}

async function runFaithScenario() {
  const { runtime, instance, shrine, site } = await createFaithFixture();
  const worldId = 'additions-faith';
  await prepareSave(worldId, runtime, { allowedFixture: { items: { food: 12, wood: 16 }, research: [] }, naturalSite: { id: site.id, templateId: site.templateId }, target: shrine.position });
  const scenario = report.scenarios[worldId];
  scenario.actions = [];
  const ids = { instanceId: instance.id };
  await ensurePanel('faith');
  await clickRowAction('잊힌 신의 신도 되기', '선택');
  let state = await runtimeView(ids);
  assert(state.faith.membership, 'Faith membership was not joined through UI');
  scenario.actions.push({ input: 'faith join button' });
  await clickRowAction('유적 보급 수락', '선택');
  const beforeDelivery = await runtimeView(ids);
  await clickRowAction('보급품 납품', '선택');
  let afterDelivery = await runtimeView(ids);
  assert.equal((beforeDelivery.inventory.food ?? 0) - (afterDelivery.inventory.food ?? 0), 4, 'Delivery UI did not spend exactly 4 food');
  assert.equal((beforeDelivery.inventory.wood ?? 0) - (afterDelivery.inventory.wood ?? 0), 2, 'Delivery UI did not spend exactly 2 wood');
  const energyBeforeQuestReward = afterDelivery.energy.divine ?? 0;
  await clickRowAction('유적 보급 보상 수령', '선택');
  afterDelivery = await runtimeView(ids);
  assert.equal(afterDelivery.energy.divine - energyBeforeQuestReward, 10, 'Delivery reward was not granted exactly once');
  scenario.checks = { deliveryCostsPaidThroughUI: true, questRewardDivineEU: 10, membershipJoinedThroughUI: true };
  scenario.actions.push({ input: 'accept/deliver/claim buttons', consumed: { food: 4, wood: 2 }, divineEU: 10 });
  await record('faith-delivery-and-reward', { scenario: worldId, ids });

  const beforeTrial = await runtimeView(ids);
  const trialEnergyBefore = beforeTrial.energy.divine ?? 0;
  await clickRowAction('제단 시련 시작', '선택');
  const attunements = [];
  for (const elapsed of [2.2, 6.2, 10.2]) {
    await waitFor(goal => window.FERAL.runtime.faith.trials[goal.id]?.elapsed >= goal.elapsed, { id: instance.id, elapsed }, 20000);
    const current = await runtimeView(ids);
    const before = current.faith.trials[instance.id]?.attunements ?? 0;
    await ensurePanel('faith');
    await clickRowAction('제단 조율', '선택');
    const after = await runtimeView(ids);
    assert.equal(after.faith.trials[instance.id].attunements, before + 1, `Attunement ${before + 1} was not accepted in its timed window`);
    attunements.push({ elapsed: after.faith.trials[instance.id].elapsed, count: after.faith.trials[instance.id].attunements });
  }
  await waitFor(id => window.FERAL.runtime.faith.trials[id]?.phase === 'ready', instance.id, 20000);
  await ensurePanel('faith');
  await clickRowAction('시련 보상 수령', '선택');
  state = await runtimeView(ids);
  assert.equal(state.faith.trials[instance.id].phase, 'claimed', 'Faith trial reward claim did not complete');
  assert.equal(state.energy.divine - trialEnergyBefore, 15, 'Faith trial reward was not exactly 15 divine EU');
  scenario.checks.timedAttunements = attunements;
  scenario.checks.trialCompletedAt = state.faith.trials[instance.id].elapsed;
  scenario.checks.trialRewardDivineEU = 15;
  await record('faith-trial-claimed', { scenario: worldId, ids, attunements });

  const beforeReconnect = state;
  const withoutClock = faith => { const value = { ...faith }; delete value.clock; return value; };
  const { after } = await saveReconnect(ids, s => ({ faith: withoutClock(s.faith), energy: s.energy, inventory: s.inventory }));
  assert.deepEqual(withoutClock(after.faith), withoutClock(beforeReconnect.faith), 'Faith save/reconnect changed quest or trial receipts');
  await ensurePanel('faith');
  const completed = page.locator('#panelList .row').filter({ has: page.locator('b').filter({ hasText: '유적 보급 · 수령 완료' }) }).first();
  const disabledQuest = completed.getByRole('button', { name: '선택', exact: true });
  assert(await disabledQuest.isDisabled(), 'Claimed delivery reward remained available after reconnect');
  scenario.checks.noDuplicateRewardAfterReconnect = (after.energy.divine === beforeReconnect.energy.divine) && (after.faith.quests.provisions.status === 'claimed') && (after.faith.trials[instance.id].phase === 'claimed');
  if (!scenario.checks.noDuplicateRewardAfterReconnect) throw Error('Faith reward receipt was not stable after reconnect');
  scenario.status = 'complete';
}

async function createDeviceFixture() {
  const runtime = await makeRuntime();
  const { manor } = manorAndBoss(runtime);
  addItems(runtime, { joint: 1, gear_baseline_t8: 1 }, 'verify-additions:device-kit');
  runtime.progression.equip('gear_baseline_t8');
  const component = runtime.dungeons.definition(manor.id).puzzle.componentAnchors[0];
  const target = runtime.dungeons.worldPosition(manor.id, component.positionM);
  setPlayer(runtime, { x: target[0], y: target[1] + .05, z: target[2] }, Math.PI);
  return { runtime, manor, target };
}

async function runDeviceScenario() {
  const { runtime, manor, target } = await createDeviceFixture();
  const worldId = 'additions-root-manor-device';
  const ids = { instanceId: manor.id };
  await prepareSave(worldId, runtime, { allowedFixture: { items: { joint: 1, gear_baseline_t8: 1 }, research: [] }, target });
  const scenario = report.scenarios[worldId];
  scenario.actions = [];
  await ensurePanel('devices');
  await clickRowAction('장치 설치 · joint', '조작');
  let state = await runtimeView(ids);
  assert(state.dungeon.deviceState.parts.root_manor_device_0.installed, 'Dungeon joint was not installed through UI');
  const gateBefore = state.dungeon.gateGeometry[0];
  await record('root-manor-joint-installed', { scenario: worldId, ids });

  await ensurePanel('devices');
  const hold = row('운반문 들어 올리기').getByRole('button', { name: '누르고 조작', exact: true });
  await hold.waitFor({ state: 'visible' });
  if (await hold.isDisabled()) throw Error('Root manor gate hold action is disabled after installing joint');
  await hold.hover();
  await page.mouse.down();
  let gateAtMidpoint;
  try {
    await waitFor(id => window.FERAL.runtime.dungeons.get(id)?.deviceState.work.progressM >= 2, manor.id, 12000);
    state = await runtimeView(ids);
    gateAtMidpoint = state.dungeon.gateGeometry[0];
    await record('root-manor-gate-mid-lift', { scenario: worldId, ids, progressM: state.dungeon.deviceState.work.progressM, gateBefore, gateAtMidpoint });
    await waitFor(id => window.FERAL.runtime.dungeons.get(id)?.deviceState.solved, manor.id, 15000);
  } finally {
    await page.mouse.up();
  }
  state = await runtimeView(ids);
  assert(state.dungeon.deviceState.work.progressM >= 4.5, 'Held UI did not move gate to required clearance');
  assert(state.dungeon.deviceState.solved, 'Root manor device did not solve');
  assert.equal(state.dungeon.gateGeometry.length, 1, 'Solved root manor must keep its raised gate geometry');
  const gateAfter = state.dungeon.gateGeometry[0];
  assert(gateAfter.center[1] >= gateBefore.center[1] + 4.5 - .01, 'Solved gate did not rise the full 4.5m clearance');
  assert(gateAtMidpoint && gateAtMidpoint.center[1] > gateBefore.center[1], 'Gate geometry did not physically move while held');
  scenario.checks = { jointInstalledThroughUI: true, holdInputMovedGateGeometry: true, gateClearanceM: state.dungeon.deviceState.work.progressM, gateGeometryLiftM: gateAfter.center[1] - gateBefore.center[1], raisedGatePersistsAsGeometry: true };
  scenario.actions.push({ input: 'pointer hold on 누르고 조작', simulatedSeconds: state.dungeon.deviceState.work.progressM / 1, progressM: state.dungeon.deviceState.work.progressM });
  await record('root-manor-gate-open', { scenario: worldId, ids, gateBefore, gateAtMidpoint, gateAfter });
  await saveReconnect(ids, s => ({ deviceState: s.dungeon?.deviceState, puzzle: s.dungeon?.puzzle, gateGeometry: s.dungeon?.gateGeometry }));
  scenario.status = 'complete';
}

async function setMachineField(key, value) {
  const field = page.locator(`[data-machine-field="${key}"]`);
  await field.waitFor({ state: 'visible' });
  if (await field.evaluate(el => el.tagName === 'SELECT')) await field.selectOption(String(value));
  else await field.fill(String(value));
}

async function addMachineVoxel(cell, machineId) {
  for (const [index, axis] of ['x', 'y', 'z'].entries()) await setMachineField(axis, cell[index]);
  const button = page.getByRole('button', { name: '복셀 추가', exact: true });
  await button.click();
  await page.waitForTimeout(120);
  assert(await page.evaluate(({cell,machineId}) => window.FERAL.runtime.machines.machines.get(machineId)?.voxels.some(v => v.cell.every((n,i) => n === cell[i])), {cell,machineId}), `UI voxel placement failed at ${cell.join(',')}: ${await page.locator('#toast').textContent()}`);
}

async function installMachineComponent(voxelId, componentId) {
  await setMachineField('voxel', voxelId);
  await setMachineField('component', componentId);
  await page.getByRole('button', { name: '선택 복셀에 설치', exact: true }).click();
  await page.waitForTimeout(120);
  assert(await page.evaluate(({voxelId,componentId}) => [...window.FERAL.runtime.machines.machines.values()].some(m => m.components.some(c => c.voxelId === voxelId && c.componentId === componentId)), {voxelId,componentId}), `UI component installation failed: ${componentId}`);
}

async function createMachineThroughUI(name, cellsAndComponents) {
  await setMachineField('name', name);
  await setMachineField('grid', '.5');
  await page.getByRole('button', { name: '앞에 조립 시작', exact: true }).click();
  await page.waitForTimeout(150);
  const machineId = await page.evaluate(name => [...window.FERAL.runtime.machines.machines.values()].find(m => m.name === name)?.id, name);
  if (!machineId) throw Error(`UI did not create machine ${name}`);
  const machine = await page.evaluate(id => window.FERAL.runtime.machines.machines.get(id) && ({ id, voxels: [...window.FERAL.runtime.machines.machines.get(id).voxels] }), machineId);
  if (!machine) throw Error(`Created machine is not readable: ${name}`);
  for (const cell of cellsAndComponents.cells) await addMachineVoxel(cell, machineId);
  for (const { cell, componentId } of cellsAndComponents.components) {
    const voxelId = await page.evaluate(({ id, cell }) => window.FERAL.runtime.machines.machines.get(id).voxels.find(v => v.cell.every((n, i) => n === cell[i]))?.id, { id: machineId, cell });
    if (!voxelId) throw Error(`UI voxel was not present at ${cell.join(',')}`);
    await installMachineComponent(voxelId, componentId);
  }
  return machineId;
}

async function selectMachine(machineName) {
  const button = page.locator('#panelList .machine-card button').filter({ hasText: machineName }).first();
  await button.waitFor({ state: 'visible' });
  await button.click();
  await page.waitForTimeout(100);
}

async function driveMachine(machineName) {
  await ensurePanel('machine');
  await selectMachine(machineName);
  await page.getByRole('button', { name: '조종하기', exact: true }).click();
  await waitFor(() => !!window.FERAL.runtime.drivingMachineId, undefined, 5000);
}

async function fireOnceViaUI(machineId, bossId) {
  const shotsBeforeAim = await page.evaluate(id => window.FERAL.runtime.machines.machines.get(id).components.find(c => c.componentId === 'arc_thrower').shotsFired, machineId);
  await aimAtBoss(bossId, 1.25);
  const before = await page.evaluate(({ machineId, bossId }) => {
    const m = window.FERAL.runtime.machines.machines.get(machineId), c = m.components.find(x => x.componentId === 'arc_thrower');
    return { shots: c.shotsFired, energy: c.energy.electrical, hp: window.FERAL.runtime.bosses.get(bossId)?.hp };
  }, { machineId, bossId });
  assert.equal(before.shots, shotsBeforeAim, 'Camera aiming must not accidentally fire a mouse click');
  const button = page.locator('#attack');
  await button.hover();
  await page.mouse.down();
  try {
    await waitFor(({ id, shots }) => window.FERAL.runtime.machines.machines.get(id)?.components.find(c => c.componentId === 'arc_thrower')?.shotsFired > shots, { id: machineId, shots: before.shots }, 12000);
  } finally {
    await page.mouse.up();
  }
  const after = await page.evaluate(({ machineId, bossId }) => {
    const m = window.FERAL.runtime.machines.machines.get(machineId), c = m.components.find(x => x.componentId === 'arc_thrower');
    const cache = c.fireCache.at(-1)?.result;
    return { shots: c.shotsFired, energy: c.energy.electrical, hp: window.FERAL.runtime.bosses.get(bossId)?.hp,
      packet: cache?.packet ? { rayOrigin: cache.packet.rayOrigin, targetPoint: cache.packet.targetPoint, shotId: cache.packet.shotId } : null,
      machineBlocked: cache?.blocked ?? null };
  }, { machineId, bossId });
  return { before, after };
}

async function createMachineFixture() {
  const runtime = await makeRuntime();
  const { manor, boss } = manorAndBoss(runtime);
  addItems(runtime, { gear_baseline_t8: 1, wood: 2000, battery: 1, controller: 1, arc_thrower: 1 }, 'verify-additions:machine-kit');
  runtime.progression.equip('gear_baseline_t8');
  addResearch(runtime, ['power', 'mechanisms']);
  // Test energy is a one-time prepared escrow. It remains pending until the
  // battery storage component is installed through the inventory UI.
  const supplied = runtime.progression.supplyEnergy('electrical', 60, { claimId: 'verify-additions:machine-energy' });
  if (!supplied.ok) throw Error(`Could not seed prepared test energy: ${JSON.stringify(supplied)}`);
  const bossPos = point(boss.position);
  // Keep this prepared LOS target stationary while the real UI builds cover.
  // Active boss combat is covered by the separate weapon/combat scenarios.
  setPlayer(runtime, { x: bossPos.x - 6, y: manor.origin[1] + .05, z: bossPos.z - 14 }, Math.PI / 2);
  runtime.bosses.get(boss.bossInstanceId).staggerS = 120;
  return { runtime, manor, bossId: boss.bossInstanceId, bossPos };
}

async function runMachineScenario() {
  const { runtime, manor, bossId } = await createMachineFixture();
  const worldId = 'additions-machine-fire';
  const ids = { instanceId: manor.id, bossId };
  await prepareSave(worldId, runtime, { allowedFixture: { items: { gear_baseline_t8: 1, wood: 2000, battery: 1, controller: 1, arc_thrower: 1 }, research: ['power', 'mechanisms'], initialTestEnergyEscrowEU: { electrical: 60 }, targetSavedStunS: 120 }, target: bossId });
  const scenario = report.scenarios[worldId];
  scenario.actions = [];

  await ensurePanel('inventory');
  await clickRowAction('전지 × 1', '거점에 설치');
  await waitFor(() => window.FERAL.runtime.progression.fixtureEnergy.status().nodes.some(n => n.assetId === 'battery'), undefined, 15000);
  await ensurePanel('energy');
  const fixedOwnerId = await page.evaluate(() => window.FERAL.runtime.progression.fixtureEnergy.status().nodes.find(n => n.assetId === 'battery').ownerId);
  await page.locator('#panelList label').filter({ hasText: '옮길 에너지 EU' }).locator('input').fill('60');
  await page.getByRole('button', { name: '이전 저장분 전기 → 설비', exact: true }).click();
  const fixedBefore = await page.evaluate(id => window.FERAL.runtime.progression.fixtureEnergy.nodes.get(id).energy.electrical, fixedOwnerId);
  assert.equal(fixedBefore, 60, 'UI escrow transfer did not store the declared test energy');
  let state = await runtimeView({ bossId });
  scenario.checks = { batteryPlacedThroughUI: true, escrowExplicitlyMovedToFixedBattery: true, fixedOwnerId, fixedElectricalEU: fixedBefore };
  scenario.actions.push({ input: 'inventory battery placement, explicit fixed-energy escrow transfer', initialTestEnergyEscrowEU: 60 });
  await record('machine-battery-installed-through-ui', { scenario: worldId, ids, fixedOwnerId, energyEU: fixedBefore });

  await page.locator('#closePanel').click();
  const bossPosition = await page.evaluate(id => { const b = window.FERAL.runtime.bosses.get(id); return { x: b.position.x, y: b.position.y + 1.25, z: b.position.z }; }, bossId);
  await mouseLookAt(bossPosition);
  await ensurePanel('machine');
  const machineId = await createMachineThroughUI('Verification gun', {
    cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]],
    components: [{ cell: [0, 1, 0], componentId: 'controller' }, { cell: [0, 0, 0], componentId: 'arc_thrower' }],
  });
  await page.getByRole('button', { name: '조종 중 사용할 무장으로 선택', exact: true }).click();
  await page.waitForTimeout(100);
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: '선택 설비에서 10 EU 받기', exact: true }).click();
    await page.waitForTimeout(100);
  }
  const machineState = await runtimeView({ machineId, bossId });
  const gun = machineState.machine.components.find(c => c.componentId === 'arc_thrower');
  assert.equal(gun.energy.electrical, 40, 'UI did not transfer exactly 40 EU into the mounted thrower');
  assert.equal(await page.evaluate(id => window.FERAL.runtime.progression.fixtureEnergy.nodes.get(id).energy.electrical, fixedOwnerId), 20);
  scenario.actions.push({ input: 'machine name/grid/voxel/component selectors, install and fixed-store charge buttons', chargedEUThroughUI: 40 });
  scenario.checks = { ...scenario.checks, machineCreatedThroughUI: true, controllerInstalledThroughUI: true, arcThrowerInstalledThroughUI: true, weaponSelectedThroughUI: true, initialChargeThroughUI: true };
  await record('machine-assembled-and-charged', { scenario: worldId, ids: { ...ids, machineId } });
  await page.locator('#closePanel').click();
  await driveMachine('Verification gun');
  const firstShot = await fireOnceViaUI(machineId, bossId);
  const shotDelta = firstShot.after.shots - firstShot.before.shots;
  const euDelta = firstShot.before.energy - firstShot.after.energy;
  const hpDelta = firstShot.before.hp - firstShot.after.hp;
  assert.equal(shotDelta, 1, 'UI firing did not produce exactly one arc_thrower shot');
  assert.equal(euDelta, 20, 'One arc_thrower shot did not consume exactly 20 EU');
  assert(hpDelta > 0, 'The first clear machine shot did not damage the aimed boss');
  scenario.checks.clearShot = { shots: shotDelta, electricalEUSpent: euDelta, bossDamage: hpDelta };
  await record('machine-first-shot-damaged-boss', { scenario: worldId, ids: { ...ids, machineId }, shot: firstShot });

  // Leave the gun by its visible control, then build a separate, fixed voxel
  // cover machine in the muzzle-to-boss line using the ordinary assembly UI.
  await page.locator('#use').click();
  await waitFor(() => !window.FERAL.runtime.drivingMachineId, undefined, 5000);
  await ensurePanel('machine');
  const coverId = await createMachineThroughUI('Verification cover', { cells: Array.from({length:4}, (_,y) => [-1,0,1].map(x => [x,y,0])).flat(), components: [] });
  await record('machine-cover-built-through-ui', { scenario: worldId, ids: { ...ids, machineId, coverMachineId: coverId } });
  await ensurePanel('machine');
  await driveMachine('Verification gun');
  const aimed = await aimAtBoss(bossId, 1.25);
  assert.equal(aimed.kind, 'boss', 'Camera aim did not see the boss above the voxel cover');
  const blockedShot = await fireOnceViaUI(machineId, bossId);
  const blockedDelta = blockedShot.after.shots - blockedShot.before.shots;
  const blockedEu = blockedShot.before.energy - blockedShot.after.energy;
  const blockedDamage = blockedShot.before.hp - blockedShot.after.hp;
  const lineOfSight = blockedShot.after.packet && await page.evaluate(({ machineId, bossId, packet }) => window.FERAL.physics.hasAttackLineOfSight(
    packet.rayOrigin, packet.targetPoint, { excludeOwnerId: machineId, targetOwnerId: bossId }), { machineId, bossId, packet: blockedShot.after.packet });
  await record('machine-cover-shot-measurement', { scenario: worldId, ids: { ...ids, machineId, coverMachineId: coverId }, shot: blockedShot, clearPhysicalLineOfSight: lineOfSight });
  assert.equal(blockedDelta, 1, 'Covered UI fire did not consume one shot');
  assert.equal(blockedEu, 20, 'Covered shot did not consume its 20 EU claim');
  assert.equal(blockedDamage, 0, 'Voxel cover did not prevent the second boss damage');
  assert.equal(lineOfSight, false, 'Physical collision query did not detect the voxel cover');
  scenario.checks.coveredShot = { shots: blockedDelta, electricalEUSpent: blockedEu, bossDamage: blockedDamage, clearPhysicalLineOfSight: lineOfSight };
  await record('machine-cover-blocked-damage', { scenario: worldId, ids: { ...ids, machineId, coverMachineId: coverId }, shot: blockedShot, clearPhysicalLineOfSight: lineOfSight });

  const beforeReconnect = await runtimeView({ ...ids, machineId, coverMachineId: coverId });
  const persistentMachine = m => { const {position, ...rest} = m; return rest; };
  await saveReconnect({ ...ids, machineId, coverMachineId: coverId }, s => ({ machine: persistentMachine(s.machine), cover: persistentMachine(s.coverMachine), bossHp: s.boss?.hp }));
  const afterReconnect = await runtimeView({ ...ids, machineId, coverMachineId: coverId });
  assert.deepEqual(persistentMachine(afterReconnect.machine), persistentMachine(beforeReconnect.machine), 'Machine shot ledger/energy did not persist');
  assert(near(afterReconnect.machine.position, beforeReconnect.machine.position) < .1, 'Saved machine position jumped on reconnect');
  assert.deepEqual(persistentMachine(afterReconnect.coverMachine), persistentMachine(beforeReconnect.coverMachine), 'UI-built voxel cover did not persist');
  assert(near(afterReconnect.coverMachine.position, beforeReconnect.coverMachine.position) < .1, 'Saved cover position jumped on reconnect');
  scenario.checks.machineAndShotLedgerPersisted = true;
  scenario.status = 'complete';
}

async function createOptionalVaneFixture() {
  const runtime = await makeRuntime();
  const found = findNaturalInstance(runtime, 'cliff_observatory');
  if (!found) return null;
  const anchors = runtime.dungeons.definition(found.instance.id).puzzle.componentAnchors;
  if (anchors.length < 2) return null;
  addItems(runtime, { joint: 1, controller: 1, gear_baseline_t8: 1 }, 'verify-additions:vane-kit');
  runtime.progression.equip('gear_baseline_t8');
  const target = runtime.dungeons.worldPosition(found.instance.id, anchors[0].positionM);
  setPlayer(runtime, { x: target[0], y: target[1] + .05, z: target[2] }, Math.PI);
  return { runtime, instance: found.instance, anchors };
}

async function runOptionalVaneScenario() {
  const fixture = await createOptionalVaneFixture();
  if (!fixture) {
    report.scenarios['optional-wind-vane'] = { status: 'skipped', reason: 'No naturally generated cliff_observatory site was found in the deterministic search.', checks: {} };
    return;
  }
  const { runtime, instance, anchors } = fixture;
  const worldId = 'additions-wind-vane';
  const ids = { instanceId: instance.id };
  await prepareSave(worldId, runtime, { allowedFixture: { items: { joint: 1, controller: 1, gear_baseline_t8: 1 }, research: [] }, naturalSite: instance.siteId });
  const scenario = report.scenarios[worldId];
  scenario.actions = [];
  await ensurePanel('devices');
  await clickRowAction('장치 설치 · joint', '조작');
  await page.locator('#closePanel').click();
  const secondAnchor = point(await page.evaluate(({ id, anchorId }) => window.FERAL.runtime.dungeons.anchors(id).find(a => a.componentAnchorId === anchorId)?.position, { id: instance.id, anchorId: anchors[1].id }));
  if (!await walkTo(secondAnchor, 3.7, 30)) throw Error('Keyboard movement did not reach the wind vane controller anchor');
  await ensurePanel('devices');
  await clickRowAction('장치 설치 · controller', '조작');
  await ensurePanel('devices');
  const angle = page.locator('select[aria-label="풍향판 설정 각도"]');
  await angle.selectOption({ label: '90°' });
  await clickRowAction('풍향판 각도 설정', '조작');
  await ensurePanel('devices');
  await clickRowAction('풍향판 고정', '조작');
  const state = await runtimeView(ids);
  assert(state.dungeon.deviceState.wind.locked, 'UI did not lock the wind vane');
  assert(state.dungeon.deviceState.solved, '90° wind-vane alignment did not solve the puzzle');
  scenario.checks = { angleSelectedThroughUI: '90°', jointAndControllerInstalledThroughUI: true, lockedAndSolved: true, windForceN: state.dungeon.status.wind.forceN };
  await record('wind-vane-input-and-lock', { scenario: worldId, ids });
  await saveReconnect(ids, s => ({ deviceState: s.dungeon?.deviceState, puzzle: s.dungeon?.puzzle }));
  scenario.status = 'complete';
}

async function runScenario(name, action) {
  try {
    await action();
  } catch (error) {
    report.errors.push(`${name}: ${error?.stack ?? String(error)}`);
    const scenario = report.scenarios[name];
    if (scenario) { scenario.status = 'failed'; scenario.failure = String(error); }
    console.error(`${name}:`, error);
    try { await record(`${name}-blocked`, { scenario: name, failure: String(error) }); } catch {}
  }
}

const scenarioActions = [
  ['additions-weapon', runWeaponScenario],
  ['additions-faith', runFaithScenario],
  ['additions-root-manor-device', runDeviceScenario],
  ['additions-machine-fire', runMachineScenario],
  ['optional-wind-vane', runOptionalVaneScenario],
];
const selectedScenarios = process.env.VERIFY_EXPEDITION_SCENARIOS
  ? new Set(process.env.VERIFY_EXPEDITION_SCENARIOS.split(',').map(name => name.trim()).filter(Boolean))
  : null;
const knownScenarios = new Set(scenarioActions.map(([name]) => name));
if (selectedScenarios && [...selectedScenarios].some(name => !knownScenarios.has(name))) {
  throw Error(`Unknown verification scenario: ${[...selectedScenarios].filter(name => !knownScenarios.has(name)).join(', ')}`);
}
report.selectedScenarios = selectedScenarios ? [...selectedScenarios] : scenarioActions.map(([name]) => name);

try {
  for (const [name, action] of scenarioActions) {
    if (selectedScenarios && !selectedScenarios.has(name)) {
      report.scenarios[name] = { status: 'not_run' };
      continue;
    }
    await runScenario(name, action);
  }
} finally {
  try {
    if (await page.locator('#panel').isVisible()) await page.locator('#closePanel').click();
    if (!(await page.locator('#menu').isVisible())) await page.locator('#openMenu').click();
    await page.locator('#save').click();
  } catch (error) {
    report.finalSaveError = String(error);
  }
  report.finishedAt = new Date().toISOString();
  await writeReport();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

const requiredScenarios = ['additions-weapon', 'additions-faith', 'additions-root-manor-device', 'additions-machine-fire'];
const requiredThisRun = selectedScenarios ? requiredScenarios.filter(id => selectedScenarios.has(id)) : requiredScenarios;
report.ok = report.errors.length === 0 && requiredThisRun.every(id => report.scenarios[id]?.status === 'complete');
await writeReport();
console.log(JSON.stringify({ ok: report.ok, scenarios: Object.fromEntries(Object.entries(report.scenarios).map(([id, value]) => [id, value.status])), errors: report.errors }));
if (!report.ok) process.exitCode = 1;
