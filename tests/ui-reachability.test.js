import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { WorldAtlas } from '../app/src/main/assets/content-runtime/atlas.js';
import { DungeonSystem } from '../app/src/main/assets/content-runtime/dungeons.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { REASON_TEXT, reasonText, isTranslated } from '../app/src/main/assets/content-runtime/reasons.js';

const ROOT = new URL('../app/src/main/assets/content-runtime/', import.meta.url);
const SEED = 27182;
const sources = readdirSync(ROOT).filter(name => name.endsWith('.js') && !name.includes('.generated.'));

test('every failure code a content system can return has player-facing Korean text', () => {
  const codes = new Set();
  for (const name of sources) {
    const text = readFileSync(new URL(name, ROOT), 'utf8');
    for (const pattern of [/\b(?:fail|no)\('([a-z][a-z0-9_]*)'/g, /reason ?: ?'([a-z][a-z0-9_]*)'/g, /\|\| ?'([a-z]+(?:_[a-z0-9]+)+)'\)/g])
      for (const match of text.matchAll(pattern)) codes.add(match[1]);
  }
  assert(codes.size > 200, `scanned ${codes.size} codes`);
  const missing = [...codes].filter(code => !isTranslated(code));
  assert.deepEqual(missing, []);
  for (const code of codes) assert.doesNotMatch(reasonText(code), /^[a-z0-9_]+$/, code);
  assert.equal(reasonText('research_busy'), REASON_TEXT.research_busy);
  assert.equal(reasonText('이미 사람이 읽는 문장입니다.'), '이미 사람이 읽는 문장입니다.');
  assert.match(reasonText(undefined), /할 수 없습니다/);
  const entry = readFileSync(new URL('game.js', ROOT), 'utf8');
  assert.doesNotMatch(entry, /reasonNames/, 'the screen layer translates through reasons.js only');
});

test('craft queue jobs can be cancelled for their item inputs, prioritized and explained', () => {
  const p = new Progression(CONTENT, {});
  const recipe = CONTENT.progression.entries.find(e => e.kind === 'recipe' && e.station === 'hand' && !e.research && Object.keys(e.energy).length === 0);
  assert(recipe, 'a hand recipe without research exists');
  const inputs = Object.fromEntries(Object.entries(recipe.inputs).map(([id, n]) => [id, n * 3]));
  assert.equal(p.grant(inputs, { claimId: 'ui:grant' }).ok, true);
  const first = p.queueCraft(recipe.id, { count: 2 }), second = p.queueCraft(recipe.id);
  assert.equal(first.ok && second.ok, true);
  for (const [id] of Object.entries(recipe.inputs)) assert(p.count(id) < 1e-9 || p.count(id) < inputs[id]);
  assert.equal(p.prioritizeJob(second.jobId).ok, true);
  assert.equal(p.jobs[0].id, second.jobId, 'moved job progresses first');
  const status = p.jobStatus(p.jobs[1]);
  assert.equal(status.total, recipe.seconds * 2);
  assert.equal(status.blocked, null);
  const before = { ...p.inventory };
  const cancelled = p.cancelJob(first.jobId, { claimId: 'ui:cancel' });
  assert.equal(cancelled.ok, true);
  for (const [id, n] of Object.entries(recipe.inputs)) assert(Math.abs(p.count(id) - (before[id] ?? 0) - n * 2) < 1e-9, id);
  assert.equal(p.cancelJob(first.jobId, { claimId: 'ui:cancel' }).duplicate, true, 'retrying the same request is idempotent');
  assert.equal(p.cancelJob(first.jobId, { claimId: 'ui:cancel-again' }).reason, 'job_not_found');
  assert.equal(p.jobs.length, 1);
  const station = CONTENT.progression.entries.find(e => e.kind === 'recipe' && e.station !== 'hand');
  assert.equal(p.jobStatus({ type: 'craft', recipeId: station.id, count: 1, progress: 0 }).blocked, 'research_required');
  p.research.add(station.research);
  assert.equal(p.jobStatus({ type: 'craft', recipeId: station.id, count: 1, progress: 0 }).blocked, 'station_required');
});

test('research can be paused and resumed without paying samples twice', () => {
  const p = new Progression(CONTENT, {});
  const research = CONTENT.progression.entries.find(e => e.kind === 'research' && !e.prerequisites.length && e.station === 'hand');
  assert.equal(p.grant(research.samples, { claimId: 'ui:samples' }).ok, true);
  assert.equal(p.startResearch(research.id).ok, true);
  p.tick(1, { researching: true });
  const work = p.researchProgress[research.id].work;
  assert(work > 0);
  assert.equal(p.pauseResearch().ok, true);
  p.tick(5, { researching: true });
  assert.equal(p.researchProgress[research.id].work, work, 'paused research does not advance');
  assert.equal(p.researchStatus(research.id).ok, true, 'paid research needs no new samples');
  assert.equal(p.startResearch(research.id).ok, true);
});

test('dungeon devices release dead supply links and restore destroyed puzzle structures', () => {
  const atlas = new WorldAtlas(CONTENT, { seed: SEED });
  const dungeons = new DungeonSystem({ catalog: CONTENT, seed: SEED, atlas });
  const p = new Progression(CONTENT, {});
  const tower = dungeons.ensureInstance('cliff_observatory', 'ui-observatory', [4096, 4.5, 0], 5);
  const devices = dungeons.devices, state = devices._state(tower.id), position = devices._anchorPosition(tower.id, null);
  const at = { x: position[0], y: position[1], z: position[2] };
  state.supplies.electrical = { ownerId: 'dismantled-battery', type: 'electrical', lengthM: 2, anchorId: null, items: {} };
  assert.equal(devices.disconnectSupply(tower.id, 'electrical', { progression: p }).ok, true, 'a dismantled source no longer locks the device');
  assert.equal(state.supplies.electrical, undefined);
  state.supplies.electrical = { ownerId: 'distant-battery', type: 'electrical', lengthM: 2, anchorId: null, items: {} };
  p.fixtureEnergy.nodes.set('distant-battery', { ownerId: 'distant-battery', energy: {} });
  assert.equal(devices.disconnectSupply(tower.id, 'electrical', { progression: p }).reason, 'out_of_range', 'an existing source still has to be reached');
  p.fixtureEnergy.nodes.delete('distant-battery'); delete state.supplies.electrical;

  assert.equal(devices.damage(tower.id, 'windvane', 1000).ok, true);
  assert.equal(state.structureParts.windvane.installed, false);
  assert.equal(state.wind.vaneAttached, false);
  const restore = devices.status(tower.id, { progression: p }).actions.find(a => a.id === 'restore:windvane');
  assert(restore, 'the device panel offers a restore action');
  assert.equal(devices.act(tower.id, 'restore:windvane', { position: at, progression: p, claimId: 'ui:restore' }).ok, false, 'restoring costs materials');
  p.grant({ wood: 2, stone: 2 }, { claimId: 'ui:restore-materials' });
  assert.equal(devices.act(tower.id, 'restore:windvane', { position: at, progression: p }).ok, true);
  assert.equal(state.structureParts.windvane.installed, true);
  assert.equal(state.wind.vaneAttached, true);
  assert.equal(p.count('wood'), 0);
  assert(!devices.status(tower.id, { progression: p }).actions.some(a => a.id === 'restore:windvane'));
  const restored = new DungeonSystem({ catalog: CONTENT, seed: SEED, atlas, state: dungeons.serialize() });
  assert.equal(restored.devices._state(tower.id).structureParts.windvane.installed, true, 'restoration survives save/load');
});

test('runtime turns boss, creature, dungeon and community events into screen messages', async () => {
  const runtime = await ExpeditionRuntime.create(SEED);
  const inst = runtime.dungeons.ensureInstance('mining_fort', 'ui-events', [runtime.player.x + 6, runtime.player.y, runtime.player.z + 6], 5);
  const template = CONTENT.structures.entries.find(e => e.id === 'mining_fort'), center = template.rooms.find(r => r.id === template.bossArena.roomId).centerM;
  const anchor = runtime.dungeons.anchors(inst.id).find(a => a.kind === 'boss');
  const boss = runtime.bosses.spawn(anchor.bossId, { ...runtime.player }, { id: anchor.bossInstanceId, instanceId: inst.id, tier: inst.tier, arenaOrigin: { x: inst.origin[0] + center[0], y: inst.origin[1] + center[1], z: inst.origin[2] + center[2] } });
  const def = runtime.bosses.definitionFor(boss);
  runtime.messages.length = 0;
  runtime.bossEvent({ type: 'phase', bossId: boss.id });
  assert.match(runtime.messages.at(-1), new RegExp(runtime.bosses.phase(boss).name));
  runtime.bossEvent({ type: 'partBroken', bossId: boss.id, partId: def.parts[0].id });
  assert.match(runtime.messages.at(-1), new RegExp(def.parts[0].name));
  boss.cast = { targetOwnerId: 'player' };
  runtime.bossEvent({ type: 'cast', bossId: boss.id, skillId: def.skills[0].id, windupS: 1.5 });
  assert.match(runtime.activeWarning().text, new RegExp(def.skills[0].name));
  assert.match(runtime.activeWarning().text, /정면|오른쪽|왼쪽|뒤쪽/);
  boss.cast = null;
  runtime.bossEvent({ type: 'action', bossId: boss.id, action: 'recharge' });
  assert.match(runtime.messages.at(-1), /재충전/);
  runtime.dungeonEvent({ type: 'puzzle_opened', instanceId: inst.id });
  assert.match(runtime.messages.at(-1), /통로가 열렸습니다/);
  runtime.communityEvent({ type: 'community_repair_finished', ok: false, reason: 'in_combat' });
  assert.match(runtime.messages.at(-1), /전투 중/);

  const creature = runtime.creatures.entities.find(e => !e.dead);
  Object.assign(creature, { x: runtime.player.x + 3, z: runtime.player.z, attack: { targetId: 'player' } });
  runtime.warnings.length = 0;
  runtime.creatureWarning({ type: 'attack_telegraph', entityId: creature.id, text: '몸을 낮춘다', duration: 1 });
  assert.match(runtime.activeWarning().text, /몸을 낮춘다/);
  runtime.time += 2;
  assert.equal(runtime.activeWarning(), null, 'warnings expire with their windup');
});

test('a melee swing breaks the arena gimmick the player faces, and wind pushes at most 1 m', async () => {
  const runtime = await ExpeditionRuntime.create(SEED);
  const inst = runtime.dungeons.ensureInstance('mining_fort', 'ui-gimmick', [4096, 4.5, 0], 5);
  const template = CONTENT.structures.entries.find(e => e.id === 'mining_fort'), center = template.rooms.find(r => r.id === template.bossArena.roomId).centerM;
  const arenaOrigin = { x: inst.origin[0] + center[0], y: inst.origin[1] + center[1], z: inst.origin[2] + center[2] };
  const bossAnchor = runtime.dungeons.anchors(inst.id).find(a => a.kind === 'boss');
  const boss = runtime.bosses.spawn(bossAnchor.bossId, bossAnchor.position, { id: bossAnchor.bossInstanceId, instanceId: inst.id, tier: inst.tier, arenaOrigin });
  const gimmickAnchor = runtime.dungeons.anchors(inst.id).find(a => a.kind === 'gimmick');
  const gd = runtime.bosses.definitionFor(boss).arena.gimmicks.find(g => g.id === gimmickAnchor.gimmickId);
  const point = { x: arenaOrigin.x + gd.positionM[0], y: arenaOrigin.y + gd.positionM[1], z: arenaOrigin.z + gd.positionM[2] };
  Object.assign(runtime.player, { x: point.x, y: point.y, z: point.z + 1.5, yaw: 0, pitch: 0 });
  const eye = { x: runtime.player.x, y: runtime.player.y + 1.35, z: runtime.player.z };
  runtime.player.yaw = Math.atan2(-(point.x - eye.x), -(point.z - eye.z));
  runtime.player.pitch = Math.atan2(point.y + 1 - eye.y, Math.hypot(point.x - eye.x, point.z - eye.z));
  runtime.time = 10;
  const before = boss.gimmicks[gimmickAnchor.gimmickId].hp;
  const result = runtime.strike(null);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.gimmick, true);
  assert(boss.gimmicks[gimmickAnchor.gimmickId].hp < before, 'the gimmick lost durability');
  runtime.player.yaw += Math.PI;
  runtime.time += 5;
  assert.equal(runtime.gimmickTarget(null, 4), null, 'turning away no longer targets it');

  const start = { ...runtime.player };
  runtime.playerPush = { x: 1, z: 0, remaining: .25 };
  for (let i = 0; i < 10; i++) runtime.tick(.05);
  const moved = Math.hypot(runtime.player.x - start.x, runtime.player.z - start.z);
  assert(moved <= 1 + 1e-6, `pushed ${moved} m`);
  assert.equal(runtime.playerPush, null);
});
