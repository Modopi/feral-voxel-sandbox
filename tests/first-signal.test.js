// First signal on the unified runtime (S2b): the frontier campaign as a runtime module on the frontier
// generator's region islands, with the runtime's survival rules and catalog items.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { ITEM_MAP, RECORD_WORK } from '../app/src/main/assets/content-runtime/first-signal.js';
import { REGION_STRIDE } from '../app/src/main/assets/content-runtime/maps.js';
import { CAMP, PROJECTS, SIGNAL_ROUTES, CROPS, SORTIES, channels, milestones, surveySites, newJourney } from '../app/src/main/assets/frontier/campaign.js';
import { GATHERABLES, CONTRACTS, RUINS, resourceSites, relaySites, attackHits } from '../app/src/main/assets/frontier/content.js';

const SEED = 42;
const config = (rules = {}) => ({ configVersion: 1, preset: 'frontier', seed: SEED, terrain: { generator: 'frontier' }, rules: { survival: true, dropOnDeath: false, ...rules }, modules: ['first-signal'] });
const catalog = new Map(CONTENT.progression.entries.map((e) => [e.id, e]));
const reopen = (runtime) => new ExpeditionRuntime(SEED, JSON.parse(JSON.stringify(runtime.serialize())), new Map(), { config: config(runtime.rules) });

test('every campaign item maps onto a catalog item with an outdoor source or a recipe', () => {
  const used = new Set();
  for (const def of [...PROJECTS, ...Object.values(SIGNAL_ROUTES), ...Object.values(CROPS), ...Object.values(SORTIES), ...CONTRACTS, ...Object.values(GATHERABLES), ...milestones({ regions: {}, journey: newJourney() })])
    for (const id of [...Object.keys(def.cost || {}), ...Object.keys(def.reward || {})]) used.add(id);
  for (const ruin of RUINS) for (const id of Object.keys(ruin.bonus)) used.add(id);
  for (const id of ['food', 'iron', 'wood', 'crystal', 'stone', 'sand', 'plank', 'knowledge']) used.add(id); // village trade, quarry, aid, peace
  for (const id of used) {
    if (id === 'knowledge' || id === 'relic') continue;
    const entry = catalog.get(ITEM_MAP[id]);
    assert.ok(entry && ['item', 'material'].includes(entry.kind), `${id} → ${ITEM_MAP[id]}`);
    const origin = entry.origin;
    assert.ok(origin.type === 'wild_resource' ? catalog.get(origin.source)?.kind === 'source' : catalog.get(origin.recipe)?.kind === 'recipe', `${id} has a source`);
  }
});

test('a fresh frontier world finishes all chapters, all three signal routes and all sorties on the unified runtime', async () => {
  let runtime = await ExpeditionRuntime.create(SEED, null, { config: config() }), s = runtime.modules['first-signal'];
  const metrics = { gathered: 0, prepared: {}, hits: 0, regions: new Set(['0,0']), deaths: 0 };
  const at = (point) => { const w = s.world(point); Object.assign(runtime.player, { x: w.x, z: w.z, y: runtime.atlas.heightAt(w.x, w.z) + .05 }); };
  const advance = (seconds) => { for (let t = 0; t < seconds; t += .25) s.tick(Math.min(.25, seconds - t)); };
  const gatherKinds = { wood: 'wood', fiber: 'wood', seed: 'wood', berry: 'berry', herb: 'herb', scrap: 'scrap', crystal: 'crystal' };
  function obtain(id, n) {
    for (let tries = 0; s.inventory.count(id) < n; tries++) {
      assert.ok(tries < 200, `cannot obtain ${id}`);
      const sites = resourceSites(s.info).filter((p) => p.kind === gatherKinds[id] && s.region.resources[p.id] !== -1)
        .sort((a, b) => (s.region.resources[a.id] || 0) - (s.region.resources[b.id] || 0));
      if (sites.length) {
        advance(Math.max(0, (s.region.resources[sites[0].id] || 0) - s.time));
        at(sites[0]); assert.match(s.gather(sites[0].id), /채집/); metrics.gathered++;
      } else {
        // Items without a campaign gather site come from the runtime's own sources (mining, crafting),
        // which this test does not walk; they are granted and listed as prepared.
        assert.notEqual(id, 'relic', 'ruin cores only come from ruins, guardians and sorties');
        const need = n - s.inventory.count(id);
        assert.ok(s.inventory.grant(id, need)); metrics.prepared[id] = (metrics.prepared[id] || 0) + need;
      }
    }
  }
  // Frontier items that share a catalog item (food and medicine) are counted together.
  const pay = (cost) => {
    const shared = (id) => Object.entries(cost).reduce((sum, [other, n]) => sum + (ITEM_MAP[other] && ITEM_MAP[other] === ITEM_MAP[id] ? n : 0), 0);
    for (const [id, n] of Object.entries(cost)) obtain(id, ITEM_MAP[id] ? shared(id) : n);
    assert.ok(s.inventory.transaction(cost));
  };
  const action = (id, arg, point = CAMP) => { at(point); return s.campaign(id, arg); };
  const collect = () => { for (const m of milestones(s)) if (m.done && !s.journey.claimed.includes(m.id)) assert.match(action('claim', m.id), /보상 수령/); };
  const restore = () => { const before = JSON.stringify(s.serialize()); runtime = reopen(runtime); s = runtime.modules['first-signal']; assert.equal(JSON.stringify(s.serialize()), before); };
  const move = (dx, dz) => { obtain('food', 1); at(CAMP); assert.match(s.travel(dx, dz), /도착/); metrics.regions.add(s.key); restore(); };
  function fight() {
    // The runtime ticks here: guardian telegraphs hurt through runtime.hurt and HP recovers from calories.
    const b = s.activeBoss;
    for (let steps = 0, clock = 0; !b.defeated; steps++) {
      assert.ok(steps < 4000, 'fight resolves');
      let p = { x: b.x + 5, z: b.z };
      if (b.warning > 0) p = [[0, 2], [0, -5], [-5, 0], [4, 4], [-4, -4], [9, 9]].map(([x, z]) => ({ x: b.x + x, z: b.z + z, flying: false })).find((q) => !attackHits(b, q)) ?? { x: b.x + 12, z: b.z + 12 };
      at(p);
      if ((clock -= .25) <= 0 && Math.hypot(p.x - b.x, p.z - b.z) <= 6.5 && s.hitGuardian(12)) { metrics.hits++; clock = 1; }
      const before = runtime.player.hp; runtime.tick(.25);
      if (runtime.player.hp > before + 50) metrics.deaths++;
    }
  }

  for (const kind of ['wood', 'berry', 'herb']) obtain(kind, 1);
  collect();
  pay(PROJECTS[0].cost); assert.match(action('build', 'garden'), /완성/);
  obtain('seed', 1); assert.match(action('plant', [0, 'berry']), /파종/);
  advance(90); assert.match(action('harvest', 0), /수확/);
  collect();
  const v = s.region.villages[0];
  pay(CONTRACTS[0].cost); at(v); assert.match(s.deliver(v.id, CONTRACTS[0].id), /완료/);
  collect();
  for (const relay of relaySites(s.info)) { at(relay); s.activateRelay(relay.index); }
  at(s.info.dungeon); assert.match(s.claimRuin(), /유적 회수/);
  assert.equal(s.cores, 1, 'a ruin core is a campaign record');
  pay(SIGNAL_ROUTES.explorer.cost); assert.match(action('signal', 'explorer'), /복원/);
  collect();
  restore();
  move(1, 0);
  fight();
  assert.ok(s.region.boss.defeated);
  pay(SIGNAL_ROUTES.guardian.cost); assert.match(action('signal', 'guardian'), /복원/);
  move(-1, 0); move(0, -1);
  const village = s.region.villages[0];
  for (const quest of [CONTRACTS[0], CONTRACTS[2]]) { pay(quest.cost); at(village); assert.match(s.deliver(village.id, quest.id), /완료/); }
  pay({ food: 3, plank: 4 }); at(village); s.village(village.id, 'aid');
  assert.match(s.village(village.id, 'ally'), /체결/);
  pay(SIGNAL_ROUTES.community.cost); assert.match(action('signal', 'community'), /복원/);
  assert.equal(s.region.boss.defeated, false); assert.equal(s.region.cacheClaimed, false);
  collect();
  move(0, 1);
  assert.equal(channels(s).length, 3);
  for (const def of PROJECTS.slice(1)) { pay(def.cost); assert.match(action('build', def.id), /완성/); }
  pay({ iron: 8, knowledge: 6 }); assert.match(action('ignite'), /완료/);
  collect();
  assert.equal(s.journey.claimed.length, 6);
  restore();
  for (const kind of ['survey', 'supply', 'hunt']) {
    advance(Math.max(0, s.region.outpost.nextSortie - s.time));
    assert.match(action('startSortie', kind), /시작/);
    if (kind === 'survey') for (const site of surveySites(s.info)) { at(site); s.campaign('survey', site.index); }
    if (kind === 'supply') { pay(SORTIES.supply.cost); assert.match(action('deliverSortie', null, s.region.villages[0]), /전달/); }
    if (kind === 'hunt') fight();
    restore();
    assert.equal(s.region.outpost.sortie.done, true);
    assert.match(action('claimSortie'), /수령/);
    const bag = JSON.stringify(runtime.progression.inventory);
    assert.match(action('claimSortie'), /먼저/);
    assert.equal(JSON.stringify(runtime.progression.inventory), bag);
  }
  assert.equal(s.journey.sorties, 3);
  assert.equal(s.region.boss.defeated, false, 'an echo does not consume the original guardian');
  assert.ok(metrics.gathered > 0 && metrics.hits > 0);
  console.log('First signal on the unified runtime', { gathered: metrics.gathered, guardianHits: metrics.hits, deaths: metrics.deaths, regions: [...metrics.regions], prepared: metrics.prepared, simulatedSeconds: Math.ceil(s.time), cores: s.cores, researchWork: runtime.progression.workCredits });
});

test('rewards become catalog items and research work; costs are paid atomically', async () => {
  const runtime = await ExpeditionRuntime.create(SEED, null, { config: config() }), s = runtime.modules['first-signal'], g = runtime.progression;
  assert.ok(s.inventory.grant('plank', 3) && s.inventory.grant('iron', 2) && s.inventory.grant('knowledge', 4));
  assert.deepEqual([g.count('wood'), g.count('scrap_iron'), g.workCredits, s.inventory.count('knowledge')], [3, 2, 4 * RECORD_WORK, 4]);
  const bag = JSON.stringify(g.inventory);
  assert.equal(s.inventory.transaction({ plank: 3, iron: 3 }, { food: 2 }, true), false, 'one missing cost changes nothing');
  assert.equal(s.inventory.transaction({ relic: 1 }, {}, true), false);
  assert.equal(JSON.stringify(g.inventory), bag);
  assert.ok(s.inventory.transaction({ plank: 3, knowledge: 2 }, { food: 2, relic: 1 }, true));
  assert.deepEqual([g.count('wood'), g.count('food'), g.workCredits, s.cores], [0, 2, 2 * RECORD_WORK, 1]);
  assert.equal(s.inventory.transaction({ bio: 0, unknown: 1 }, {}), false, 'unknown frontier items are refused');
});

test('camp recovery and repair use the runtime body and gear; no food buff or experience', async () => {
  const runtime = await ExpeditionRuntime.create(SEED, null, { config: config() }), s = runtime.modules['first-signal'], g = runtime.progression, p = runtime.player;
  s.region.outpost.projects.push('kitchen', 'workshop');
  const camp = s.world(CAMP); Object.assign(p, { x: camp.x, z: camp.z });
  s.inventory.grant('food', 1); p.hp = 40; p.calories = 100;
  assert.match(s.campaign('rest'), /완전 회복/);
  assert.deepEqual([p.hp, p.calories, g.count('food')], [p.maxHp, p.maxCalories, 0]);
  assert.equal(s.journey.fedUntil, 0, 'rest gives no damage buff');
  assert.match(s.campaign('repair'), /손상 장비가 없습니다/);
  g.grant({ stone_pick: 1 }, { claimId: 'test:pick' }); g.toolWear.stone_pick = 3;
  assert.match(s.campaign('repair'), /필요/);
  s.inventory.grant('iron', 1); s.inventory.grant('wood', 1);
  assert.match(s.campaign('repair'), /\+60/);
  assert.equal(g.toolWear.stone_pick, Math.min(catalog.get('stone_pick').durabilityActions, 63));
  assert.deepEqual([g.count('scrap_iron'), g.count('raw_timber')], [0, 0]);
  s.inventory.grant('food', 1); Object.assign(p, { x: camp.x + 40 });
  assert.match(s.campaign('rest'), /12m/);
  assert.equal(JSON.stringify(s.serialize()).includes('"xp"'), false, 'no experience is saved');
});

test('travel costs one food from the camp or the shore, keeps every region, and arriving by any route switches region', async () => {
  let runtime = await ExpeditionRuntime.create(SEED, null, { config: config() }), s = runtime.modules['first-signal'];
  const p = runtime.player, camp = s.world(CAMP);
  assert.ok(s.info === s.info && s.key === s.key && Object.isFrozen(s.info), 'per-step reads reuse the region placement and key');
  assert.match(s.travel(1, 1), /인접/);
  Object.assign(p, { x: 120, z: 120 });
  assert.match(s.travel(1, 0), /가장자리/);
  Object.assign(p, { x: camp.x, z: camp.z });
  assert.match(s.travel(1, 0), /식량 1개/);
  s.inventory.grant('food', 2);
  s.region.villages[0].aid = 1;
  assert.match(s.travel(1, 0), /도착/);
  assert.deepEqual([s.key, p.x, p.z, runtime.progression.count('food')], ['1,0', REGION_STRIDE + CAMP.x, CAMP.z, 1]);
  assert.ok(Math.abs(p.y - runtime.atlas.heightAt(p.x, p.z) - .05) < 1e-9, 'lands on the camp ground');
  runtime = reopen(runtime); s = runtime.modules['first-signal'];
  Object.assign(runtime.player, { x: 4 + REGION_STRIDE, z: 80 });
  assert.match(s.travel(-1, 0), /도착/);
  assert.equal(s.region.villages[0].aid, 1, 'the first region kept its state');
  // A machine or a swim across the strait arrives in the region below without the button.
  Object.assign(runtime.player, { x: 77, z: REGION_STRIDE + 80 });
  s.tick(.25);
  assert.equal(s.key, '0,1');
  assert.equal(Object.keys(s.regions).length, 3);
});

test('campaign hazards hurt through the runtime: guards and guardians follow the survival setting', async () => {
  for (const survival of [true, false]) {
    const runtime = await ExpeditionRuntime.create(SEED, null, { config: config({ survival }) }), s = runtime.modules['first-signal'], p = runtime.player;
    const v = s.region.villages[0], w = s.world(v);
    s.reputation[v.faction] = -30;
    Object.assign(p, { x: w.x + 2, z: w.z, hp: 100 });
    for (let i = 0; i < 9; i++) s.tick(.25);
    assert.equal(p.hp < 100, survival, `guards at survival ${survival}`);
    if (survival) assert.ok(runtime.events.some((e) => e.type === 'player_hit' && e.source === 'village_guard'));
  }
});

test('module state lives in the runtime save; a world without the module keeps it untouched; unknown modules are refused', async () => {
  const runtime = await ExpeditionRuntime.create(SEED, null, { config: config() }), s = runtime.modules['first-signal'];
  s.reputation[1] = 12; s.cores = 2;
  const state = JSON.parse(JSON.stringify(runtime.serialize()));
  assert.deepEqual([state.modules['first-signal'].reputation[1], state.modules['first-signal'].cores], [12, 2]);
  const plain = new ExpeditionRuntime(SEED, state, new Map(), { config: { ...config(), modules: [] } });
  assert.deepEqual(plain.modules, {});
  assert.deepEqual(JSON.parse(JSON.stringify(plain.serialize())).modules, state.modules, 'kept as saved');
  assert.throws(() => new ExpeditionRuntime(SEED, null, new Map(), { config: { ...config(), modules: ['nope'] } }), /알 수 없는 모듈/);
  const broken = JSON.parse(JSON.stringify(state)); broken.modules['first-signal'].regions['0,0'].villages = [];
  assert.throws(() => new ExpeditionRuntime(SEED, broken, new Map(), { config: config() }), /지역 기록/);
  assert.equal(new ExpeditionRuntime(SEED, null, new Map()).modules['first-signal'], undefined, 'a world without the module has none');
});
