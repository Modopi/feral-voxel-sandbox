// The frontier campaign rules, checked through the first-signal module on the unified runtime (moved here from
// the frontier engine's tests when that engine was removed in 0.16.0). Positions are region-local metres; items
// count through the module's inventory (frontier ids mapped onto catalog items); survival is the runtime's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpeditionRuntime } from '../app/src/main/assets/content-runtime/runtime.js';
import { CAMP, PROJECTS } from '../app/src/main/assets/frontier/campaign.js';
import { GATHERABLES, CONTRACTS, resourceSites, relaySites } from '../app/src/main/assets/frontier/content.js';

const SEED = 42;
const config = { configVersion: 1, preset: 'frontier', seed: SEED, terrain: { generator: 'frontier' }, rules: { survival: true, dropOnDeath: false }, modules: ['first-signal'] };
function world(state = null) {
  const runtime = new ExpeditionRuntime(SEED, state, new Map(), { config }), s = runtime.modules['first-signal'];
  s.supplied = true; // these checks start from an empty bag
  const at = (point) => { const w = s.world(point); Object.assign(runtime.player, { x: w.x, z: w.z, y: runtime.atlas.heightAt(w.x, w.z) + .05 }); };
  const give = (items) => { for (const [id, n] of Object.entries(items)) assert.ok(s.inventory.grant(id, n), id); };
  const bag = () => JSON.stringify([runtime.progression.inventory, runtime.progression.workCredits, s.cores]);
  const tick = (seconds) => { for (let n = 0; n < seconds * 4; n++) s.tick(.25); };
  return { runtime, s, at, give, bag, tick };
}
const reopen = (runtime) => world(JSON.parse(JSON.stringify(runtime.serialize())));

test('village trade and aid are atomic, finite and local, and lead to an alliance without a boss', () => {
  const { s, at, give, bag } = world(), v = s.region.villages[0];
  give({ wood: 8, food: 6, plank: 8 });
  at(CAMP); const initial = bag();
  assert.match(s.village(v.id, 'trade'), /접근/);
  assert.equal(bag(), initial);
  at(v);
  assert.match(s.village(v.id, 'trade'), /결정 2/);
  assert.equal(v.crystal, 8);
  s.village(v.id, 'aid'); s.village(v.id, 'aid');
  assert.equal(v.tech, 2);
  assert.equal(s.inventory.count('knowledge'), 4);
  s.village(v.id, 'ally');
  assert.deepEqual(s.allies, [v.faction]);
  const before = JSON.stringify({ v, b: bag() });
  s.village(v.id, 'aid');
  assert.equal(JSON.stringify({ v, b: bag() }), before, 'aid without goods changes nothing');
  v.crystal = 0; const wood = s.inventory.count('wood');
  s.village(v.id, 'trade');
  assert.equal(s.inventory.count('wood'), wood, 'an empty village store refuses the trade');
});

test('distant settlements produce and consume; diplomatic conflict drains their stocks', () => {
  const { s, at, give, tick } = world(), old = s.region, wood = old.villages[0].wood;
  give({ food: 10 }); at(CAMP);
  assert.match(s.travel(1, 0), /도착/);
  tick(31);
  assert.ok(old.villages[0].wood > wood);
  assert.equal(s.regions['0,0'], old);
  s.diplomacy = [-30, -30, -30];
  const food = old.villages[0].food;
  s.socialStep();
  assert.ok(old.villages[0].food < food + 2);
});

test('raiding breaks alliances and sets the guards on the player; peace restores trade', () => {
  const { runtime, s, at, give, tick } = world(), v = s.region.villages[0];
  give({ food: 20, iron: 5 }); s.allies = [v.faction]; at(v);
  s.village(v.id, 'raid');
  assert.equal(s.allies.length, 0);
  assert.ok(s.reputation[v.faction] <= -20);
  assert.match(s.village(v.id, 'trade'), /적대/);
  const hp = runtime.player.hp;
  tick(3);
  assert.ok(runtime.player.hp < hp, 'guards hit the player');
  s.village(v.id, 'peace');
  assert.equal(s.reputation[v.faction], 0);
});

test('guardian telegraphs can be dodged, hit the player on impact, and the guardian rewards only once', () => {
  const { runtime, s, at, tick } = world(), b = s.region.boss, p = { x: b.x + 3, z: b.z };
  at(p); tick(2.25);
  assert.ok(b.warning > 0);
  const hp = runtime.player.hp;
  at({ x: p.x + 10, z: p.z }); tick(1.25);
  assert.equal(runtime.player.hp, hp, 'out of the zone when it lands');
  b.cooldown = 0; b.phase = 0; // the first stomp again; other patterns have other safe zones
  at({ x: b.x + 3, z: b.z }); s.tick(.1); tick(1.25);
  assert.ok(runtime.player.hp < hp);
  s.hitGuardian(999);
  const reward = s.inventory.count('knowledge');
  assert.ok(b.defeated && reward > 0);
  s.hitGuardian(999);
  assert.equal(s.inventory.count('knowledge'), reward);
});

test('the ruin needs its three relays, is claimed once and only in reach; its field hurts while sealed', () => {
  const { runtime, s, at, tick } = world(), d = s.info.dungeon;
  at(CAMP); assert.match(s.claimRuin(), /접근/);
  at(d); assert.match(s.claimRuin(), /해제/);
  tick(19);
  assert.equal(s.region.dungeon, 0, 'waiting does not open it');
  assert.ok(runtime.player.hp < 100);
  for (const relay of relaySites(s.info)) { at(relay); s.activateRelay(relay.index); }
  assert.equal(s.region.dungeon, 3);
  at(d); assert.match(s.claimRuin(), /유적 회수/);
  const iron = s.inventory.count('iron');
  s.claimRuin();
  assert.equal(s.inventory.count('iron'), iron);
});

test('the campaign state saves with the world; damaged records are refused', () => {
  const { runtime, s } = world();
  s.reputation = [10, -5, 0]; s.region.villages[0].food = 30;
  assert.deepEqual(reopen(runtime).s.serialize(), s.serialize());
  for (const mutate of [(m) => { m.regions['0,0'].boss.hp = -1; }, (m) => { m.regions['0,0'].villages[0].food = -3; }]) {
    const bad = JSON.parse(JSON.stringify(runtime.serialize()));
    mutate(bad.modules['first-signal']);
    assert.throws(() => world(bad));
  }
});

test('camp commands need the camp, their prerequisites and their goods, change nothing on failure and reward once', () => {
  const { s, at, give, bag } = world();
  for (const def of PROJECTS) give(def.cost);
  at({ x: 0, z: 0 });
  let before = JSON.stringify([s.serialize(), bag()]);
  s.campaign('build', 'garden');
  assert.equal(JSON.stringify([s.serialize(), bag()]), before, 'not at the camp');
  at(CAMP);
  s.campaign('build', 'garden');
  before = bag();
  s.campaign('build', 'garden');
  assert.equal(bag(), before, 'built once');
  assert.match(s.campaign('signal', 'explorer'), /조건/);
  assert.match(s.campaign('ignite'), /세 종류/);
  give({ seed: 1 });
  s.campaign('plant', [0, 'herb']);
  assert.match(s.campaign('harvest', 0), /수확까지/);
  s.time = 120;
  assert.match(s.campaign('harvest', 0), /수확/);
  assert.equal(s.inventory.count('seed'), 2);
  const harvested = bag();
  s.campaign('harvest', 0);
  assert.equal(bag(), harvested, 'harvested once');
  s.region.resources = { 'wood:0': 300, 'berry:0': 180, 'herb:0': 240 };
  assert.match(s.campaign('claim', 'gather'), /수령/);
  const claimed = [JSON.stringify(s.journey.claimed), bag()];
  s.campaign('claim', 'gather');
  assert.deepEqual([JSON.stringify(s.journey.claimed), bag()], claimed, 'a milestone pays once');
});

test('camp facilities and crops survive travel and a reload; older records migrate and malformed ones are refused', () => {
  const { runtime, s, at, give, tick } = world();
  give({ food: 5, wood: 6, dirt: 4, seed: 2 }); at(CAMP);
  s.campaign('build', 'garden'); s.campaign('plant', [0, 'berry']);
  s.travel(1, 0); tick(100); at(CAMP); s.travel(-1, 0);
  const loaded = reopen(runtime);
  loaded.at(CAMP);
  assert.match(loaded.s.campaign('harvest', 0), /수확/);
  assert.ok(loaded.s.region.outpost.projects.includes('garden'));
  const old = JSON.parse(JSON.stringify(runtime.serialize())), m = old.modules['first-signal'];
  delete m.journey;
  for (const r of Object.values(m.regions)) { delete r.outpost; delete r.terrainVersion; }
  const migrated = world(old).s;
  assert.deepEqual(migrated.journey.claimed, []);
  assert.equal(migrated.region.terrainVersion, 3, 'a module record without a version is the current terrain');
  for (const mutate of [(d) => { d.journey.claimed = ['fake']; }, (d) => { d.regions['0,0'].outpost.plots = [{ crop: 'fake', ready: 2 }, null]; },
    (d) => { d.regions['0,0'].outpost.signal = { channel: 3, route: 'explorer' }; }]) {
    const bad = JSON.parse(JSON.stringify(runtime.serialize()));
    mutate(bad.modules['first-signal']);
    assert.throws(() => world(bad));
  }
});

test('a single region renews timber and building stone without a guardian', () => {
  const { s, at } = world(), v = s.region.villages[0], wood = resourceSites(s.info).find((n) => n.kind === 'wood');
  at(wood);
  for (let n = 0; n < 5; n++) { s.time = n * 300; s.gather(wood.id); }
  assert.equal(s.inventory.count('wood'), 20);
  at(v);
  const stock = v.stone;
  s.inventory.grant('food', 2);
  assert.match(s.village(v.id, 'quarry'), /돌 8/);
  assert.equal(v.stone, stock - 12);
  for (let n = 0; n < 6; n++) s.socialStep();
  assert.ok(v.stone >= stock);
  assert.equal(s.region.boss.defeated, false);
});

test('gathering sites are fixed, in reach only, regrow or run out, and keep their state through a reload', () => {
  const { runtime, s, at } = world(), sites = resourceSites(s.info);
  assert.deepEqual(sites, resourceSites(s.info));
  const berry = sites.find((n) => n.kind === 'berry'), scrap = sites.find((n) => n.kind === 'scrap');
  at({ x: 0, z: 0 }); assert.match(s.gather(berry.id), /접근/);
  at(berry); s.gather(berry.id);
  assert.equal(s.inventory.count('berry'), 3);
  s.gather(berry.id);
  assert.equal(s.inventory.count('berry'), 3, 'regrowing');
  s.time += GATHERABLES.berry.regrow;
  s.gather(berry.id);
  assert.equal(s.inventory.count('berry'), 6);
  at(scrap); s.gather(scrap.id); s.time += 9999; s.gather(scrap.id);
  assert.equal(s.inventory.count('scrap'), 3, 'wreckage is taken once');
  const r = reopen(runtime).s;
  assert.equal(r.region.resources[scrap.id], -1);
  assert.ok(r.region.resources[berry.id] > 0);
});

test('relays, the ruin cache, observations and contracts count once and persist', () => {
  const { runtime, s, at, give } = world(), v = s.region.villages[0];
  give({ berry: 6, herb: 4, bio: 2, scrap: 6 }); at(v);
  for (const q of CONTRACTS) {
    assert.match(s.deliver(v.id, q.id), /완료/);
    const saved = JSON.stringify(runtime.progression.inventory);
    s.deliver(v.id, q.id);
    assert.equal(JSON.stringify(runtime.progression.inventory), saved);
  }
  assert.equal(s.reputation[v.faction], 24);
  assert.equal(s.study(0), true);
  const notes = s.inventory.count('knowledge');
  assert.equal(s.study(0), false);
  assert.equal(s.inventory.count('knowledge'), notes);
  const sites = relaySites(s.info);
  at({ x: 0, z: 0 }); assert.match(s.activateRelay(0), /4m/);
  at(sites[0]); s.activateRelay(0); s.activateRelay(0);
  const reloaded = reopen(runtime), r = reloaded.s;
  assert.deepEqual([r.region.relays, r.region.contracts.length, r.region.studies], [[0], 3, [0]]);
  for (const site of sites.slice(1)) { reloaded.at(site); r.activateRelay(site.index); }
  reloaded.at(r.info.dungeon);
  assert.match(r.claimRuin(), /유적 회수/);
  const after = reloaded.bag();
  r.claimRuin();
  assert.equal(reloaded.bag(), after);
  assert.equal(r.cores, 1);
});

test('older ruin progress migrates; duplicate relays, observations or contracts are refused', () => {
  const { runtime } = world(), old = JSON.parse(JSON.stringify(runtime.serialize())), region = old.modules['first-signal'].regions['0,0'];
  region.dungeon = 2.5;
  for (const key of ['relays', 'contracts', 'studies', 'resources']) delete region[key];
  const { s, at } = world(old);
  assert.deepEqual(s.region.relays, [0, 1]);
  assert.equal(s.region.dungeon, 2.5);
  const last = relaySites(s.info)[2];
  at(last); s.activateRelay(2);
  assert.equal(s.region.dungeon, 3);
  for (const [key, value] of [['relays', [0, 0]], ['relays', [5]], ['studies', [1, 1]], ['contracts', ['a', 'a']]]) {
    const bad = JSON.parse(JSON.stringify(runtime.serialize()));
    bad.modules['first-signal'].regions['0,0'][key] = value;
    assert.throws(() => world(bad), /탐사 콘텐츠/, `${key} ${JSON.stringify(value)}`);
  }
});
