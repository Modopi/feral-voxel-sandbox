import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { CreatureSystem } from '../app/src/main/assets/content-runtime/creatures.js';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { DungeonSystem } from '../app/src/main/assets/content-runtime/dungeons.js';
import { CommunitySystem } from '../app/src/main/assets/content-runtime/community.js';

function make(state = {}) {
  const runtime = {
    creatures: new CreatureSystem(CONTENT, { seed: 37, state: state.creatures }),
    progression: new Progression(CONTENT, state.progression),
    dungeons: new DungeonSystem({ catalog: CONTENT, seed: 37, state: state.dungeons }),
    player: state.player ?? { x: 0, y: 0, z: 0, hp: 100, resting: false },
  };
  runtime.community = new CommunitySystem(runtime, state.community);
  return runtime;
}
function save(r) { return JSON.parse(JSON.stringify({ creatures: r.creatures.serialize(), progression: r.progression.serialize(), dungeons: r.dungeons.serialize(), community: r.community.serialize(), player: r.player })); }
function site(r, template = 'grove_supply_camp') { const i = r.dungeons.ensureInstance(template, 'test-' + template, [0, 0, 0]); return r.community.ensureCommunity(i.id); }
function move(r, p) { const q = Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p; Object.assign(r.player, { x: q.x, y: q.y, z: q.z }); }
function grant(r, items, claim = 'test-stock') { assert.equal(r.progression.grant(items, { claimId: claim }).ok, true); }
function option(r, id, type) { return r.community.optionsFor(id).find(o => JSON.parse(decodeURIComponent(o.id.slice(10)))[1] === type); }
function service(r, c, id) { return r.dungeons.anchors(c.id).find(a => a.serviceId === id); }

test('authored communal residents initialize once, preserve corpses, and never invent quest/trial rewards', () => {
  const r = make(), c = site(r); assert.equal(c.residentIds.length, 6);
  const count = r.creatures.entities.length;
  r.creatures.damage(c.residentIds[0], 100000);
  r.community.ensureCommunity(c.id); r.community.tick(0);
  assert.equal(r.creatures.entities.length, count);
  const loaded = make(save(r)); loaded.community.ensureCommunity(c.id); loaded.community.tick(0);
  assert.equal(loaded.creatures.entities.length, count); assert.equal(loaded.creatures.get(c.residentIds[0]).dead, true);
  assert.deepEqual(loaded.community.serialize(), r.community.serialize());
  assert.equal(r.community.optionsFor(c.id).some(o => /quest|trial/.test(o.id)), false);
  const ruin = r.dungeons.ensureInstance('communal_archive', 'ruin', [1000, 0, 0]);
  assert.equal(r.community.ensureCommunity(ruin.id), null);
});

test('trade checks civilization, actual distance, visibility, hostility and finite inventory', () => {
  const r = make(), c = site(r), e = r.creatures.get(c.residentIds[0]); grant(r, { food: 10 }); move(r, e);
  const first = option(r, e.id, 'trade'); assert.equal(first.disabled, false);
  move(r, { x: 50, y: 0, z: 0 }); assert.equal(r.community.interact(first.id).reason, 'out_of_range');
  move(r, e); r.terrain = { hasLineOfSight: () => false }; assert.equal(r.community.interact(first.id).reason, 'out_of_range'); delete r.terrain;
  e.angerUntil = 100; assert.equal(r.community.interact(first.id).reason, 'hostile'); e.angerUntil = 0;
  assert.equal(r.community.interact(first.id).ok, true); assert.equal(r.progression.count('wood'), 2);
  assert.equal(r.community.interact(first.id).duplicate, true); assert.equal(r.progression.count('food'), 9);
  for (let k = 0; k < 2; k++) assert.equal(r.community.interact(option(r, e.id, 'trade').id).ok, true);
  assert.equal(option(r, e.id, 'trade').reason, 'out_of_stock'); assert.equal(r.progression.count('wood'), 6);
  const wild = r.creatures.spawn('moss_deer', { x: 0, y: 0, z: 0 }); assert.deepEqual(r.community.optionsFor(wild.id), []);
  const loaded = make(save(r)); assert.equal(loaded.community.interact(first.id).duplicate, true); assert.equal(loaded.progression.count('wood'), 6);
});

test('feeding charges actual food once and rest only invokes calorie-based player healing state', () => {
  const r = make(), c = site(r), e = r.creatures.get(c.residentIds[0]); grant(r, { food: 2 }); move(r, e);
  e.calories = 0; const food = option(r, e.id, 'feed');
  assert.equal(r.community.interact(food.id, { requestId: 'feed-request' }).ok, true);
  assert.equal(r.community.interact(food.id, { requestId: 'feed-request' }).duplicate, true);
  assert.equal(e.calories, Math.min(r.creatures.foodCalories, r.creatures.species.get(e.speciesId).calories.maxCp)); assert.equal(r.progression.count('food'), 1);
  const rest = option(r, e.id, 'rest'), hp = r.player.hp;
  assert.equal(r.community.interact(rest.id).resting, true); r.community.tick(3);
  assert.equal(r.player.hp, hp); assert.equal(r.progression.count('food'), 1);
  assert.equal(r.community.interact(rest.id).duplicate, true); assert.equal(r.player.resting, true);
  assert.equal(r.community.interact(option(r, e.id, 'rest').id).resting, false);
});

test('three paid timed contributions reward only through progression and survive each save boundary', () => {
  let r = make(), c = site(r); grant(r, { food: 12, wood: 6 }); move(r, service(r, c, 'contribution').position);
  const oldActions = [];
  for (let n = 0; n < 3; n++) {
    c = r.community.communities.get(c.id);
    const a = option(r, c.id, 'activity'); assert.equal(a.disabled, false); oldActions.push(a.id);
    const result = r.community.interact(a.id); assert.equal(result.ok, true);
    assert.equal(r.community.interact(a.id).duplicate, true); assert.equal(r.progression.jobs.length, 1);
    r.community.tick(30); assert.equal(r.progression.jobs[0].progress, 0, 'service must not tick progression twice');
    r.progression.tick(15); r = make(save(r)); r.progression.tick(15); r.community.tick(0);
    assert.equal(r.community.communities.get(c.id).contributions, n + 1);
    assert.equal(r.progression.energyAvailable('divine'), n === 2 ? 20 : 0);
    assert.equal(r.community.interact(a.id).duplicate, true);
  }
  assert.equal(r.progression.count('food'), 0); assert.equal(r.progression.count('wood'), 0);
  r = make(save(r)); for (const id of oldActions) assert.equal(r.community.interact(id).duplicate, true);
  r.community.tick(300); assert.equal(r.progression.energyAvailable('divine'), 20);
  assert.equal(r.community.communities.get(c.id).contributions, 3);
});

test('only live civilized communities accept activities and queued cancellations grant no contribution', () => {
  const r = make(), c = site(r); grant(r, { food: 8, wood: 4 }); move(r, service(r, c, 'contribution').position);
  const a = option(r, c.id, 'activity'); assert.equal(r.community.interact(a.id).ok, true);
  assert.equal(option(r, c.id, 'activity').reason, 'activity_in_progress');
  r.progression.jobs = []; r.community.tick(0);
  assert.equal(c.contributions, 0); assert.equal(c.activities[0].status, 'cancelled'); assert.equal(r.progression.energyAvailable('divine'), 0);
  for (const id of c.residentIds) r.creatures.damage(id, 100000);
  assert.deepEqual(r.community.optionsFor(c.id), []);
  assert.equal(r.community.interact(option(r, c.id, 'activity')?.id).ok, false);
});

test('repair consumes finite material after elapsed work, pauses out of range and restores without replay', () => {
  let r = make(), c = site(r, 'ridge_repair_station'); grant(r, { scrap_iron: 2 });
  const e = c.residentIds.map(id => r.creatures.get(id)).find(e => e.entityType === 'inorganic');
  const station = service(r, c, 'repair'); Object.assign(e, { x: station.position[0], y: station.position[1], z: station.position[2] }); move(r, e);
  r.creatures.damage(e.id, 60); r.creatures.time += 2; e.angerUntil = 0;
  const hp = e.hp, a = option(r, e.id, 'repair'); assert.equal(a.disabled, false);
  assert.equal(r.community.interact(a.id).pending, true); r.community.tick(4); assert.equal(r.progression.count('scrap_iron'), 2);
  r = make(save(r)); move(r, { x: 50, y: 0, z: 0 }); r.community.tick(4);
  assert.equal(r.community.activeRepair, null); assert.equal(r.creatures.get(e.id).hp, hp);
  move(r, r.creatures.get(e.id)); assert.equal(r.community.interact(option(r, e.id, 'repair').id).pending, true);
  r.community.tick(4); assert.equal(r.creatures.get(e.id).hp, hp + 40); assert.equal(r.progression.count('scrap_iron'), 1);
  r = make(save(r)); assert.equal(r.community.interact(a.id).duplicate, true); r.community.tick(8);
  assert.equal(r.creatures.get(e.id).hp, hp + 40); assert.equal(r.progression.count('scrap_iron'), 1);
});

test('invalid actions and invalid time cannot mutate balances', () => {
  const r = make(); site(r); const before = r.community.serialize();
  for (const action of [null, '', 'community:%', 'community:%7B%7D', 'unknown']) assert.equal(r.community.interact(action).ok, false);
  for (const dt of [-1, Infinity, NaN, 7201]) assert.equal(r.community.tick(dt).ok, false);
  assert.deepEqual(r.community.serialize(), before);
  assert.throws(() => new CommunitySystem(r, { schemaVersion: 2 }));
});

test('activity request survives independently newer progression save without paying or rewarding twice', () => {
  let r = make(), c = site(r); grant(r, { food: 4, wood: 2 }); move(r, service(r, c, 'contribution').position);
  const a = option(r, c.id, 'activity'), before = save(r);
  const started = r.community.interact(a.id); assert.equal(started.ok, true);
  r.progression.tick(30);
  before.progression = r.progression.serialize(); r = make(before);
  assert.equal(r.progression.count('food'), 0);
  const retry = r.community.interact(a.id); assert.equal(retry.duplicate, true); assert.equal(retry.jobId, started.jobId);
  assert.equal(r.progression.jobs.length, 0); r.community.tick(0);
  assert.equal(r.community.communities.get(c.id).contributions, 1);
  assert.equal(r.progression.activityProgress.community_contribution, 1);
  assert.equal(r.progression.energyAvailable('divine'), 0);
});

test('explicit request IDs cannot be reused for different actions', () => {
  const r = make(), c = site(r), e = r.creatures.get(c.residentIds[0]); grant(r, { food: 2 }); move(r, e); e.calories = 0;
  const trade = option(r, e.id, 'trade'); assert.equal(r.community.interact(trade.id, { requestId: 'one-click' }).ok, true);
  const feed = option(r, e.id, 'feed'); assert.equal(r.community.interact(feed.id, { requestId: 'one-click' }).reason, 'request_conflict');
  assert.equal(r.progression.count('food'), 1); assert.equal(e.calories, 0);
});
