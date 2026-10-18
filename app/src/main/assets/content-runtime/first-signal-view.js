// The first-signal module on the shared game screen (docs/ARCHITECTURE.md §6). game.js calls these hooks for
// every module the world names; nothing here is a map page of its own: the journey pages, villages, region
// travel, campaign markers and world things fill the shared ledger, HUD and focus cards. The pages are the
// frontier engine's journey and society pages (that engine was removed in 0.16.0), reading the module's state.
import {CAMP, BIOMES, PROJECTS, CROPS, SIGNAL_ROUTES, SORTIES, milestones, channels, nextObjective, objectiveDestination, signalEligible, surveySites, biomeIndex} from '../frontier/campaign.js';
import {FACTIONS, GATHERABLES, CONTRACTS, resourceSites, ruinDefinition} from '../frontier/content.js';
import {ITEM_MAP, RECORD_WORK} from './first-signal.js';
import {REGION_STRIDE} from './maps.js';
import {BossView} from './boss-view.js';

const ROLES = ['보급 담당', '약초사', '정비사'];
const GREETINGS = [
  '새 탐험가군요. 주변의 열매와 나무를 모아 오세요. 물자와 교환하거나 식탁 의뢰를 도와주세요.',
  '은잎 약초는 수확한 뒤 다시 자랍니다. 다친 몸은 식량으로 기운을 차리면 회복됩니다.',
  '옛 잔해는 잡철이 됩니다. 유적의 세 중계기를 해제하면 가운데 핵에서 유적 핵을 얻을 수 있어요.',
];
// Village actions and their price, as the frontier offered them (prices are the module's rules).
const VILLAGE_ACTIONS = [['trade', '교역', { wood: 4 }, { crystal: 2, food: 2 }], ['quarry', '채석 교역', { food: 2 }, { stone: 8, sand: 4 }], ['aid', '지원', { food: 3, plank: 4 }],
  ['ally', '동맹 요청 · 평판 24'], ['mediate', `집단 중재 · 연구 작업 ${2 * RECORD_WORK}초`], ['peace', '화해', { food: 6, iron: 2 }], ['raid', '약탈 · 적대 전환']];
// Where campaign materials come from in this world (module rules, not the frontier's own crafting).
const MINED = { wood: '나무 채굴', dirt: '흙 채굴', stone: '돌 채굴', sand: '모래 채굴' };
const DEFAULT_PAGE = 'journey', NO_EFFECTS = Object.freeze([]);

export class FirstSignalView {
  /** host: {runtime, view, ledger, notify, pause, name(catalogId), setDestination(target|null)} from game.js. */
  constructor(signal, host) {
    this.s = signal; this.host = host; this.page = DEFAULT_PAGE; this.villageId = null; this.role = 0; this.raidVillage = null;
    this.telegraphs = host.view ? new BossView(host.view) : null;
    this._guardianSystem = { entities: new Map(), getTelegraphs: () => this._telegraphRows, getWorldEffects: () => NO_EFFECTS };
    this._telegraphRows = [];
  }
  get inv() { return this.s.inventory; }
  /** Campaign text names frontier items; the bag holds catalog items (合金 → 잡철, 원목 → 미가공 목재, 회복약 → 식량). */
  localize(text) {
    if (typeof text !== 'string') return text;
    this._names ??= { 합금: this.host.name(ITEM_MAP.iron), 원목: this.host.name(ITEM_MAP.wood), 회복약: this.host.name(ITEM_MAP.medicine) };
    return text.replace(/합금|원목|회복약/g, (word) => this._names[word]);
  }
  say(text) { if (text) this.host.notify(this.localize(text)); return text; }
  /** Items by catalog name, merged where two frontier items are one catalog item (food and medicine). */
  catalogList(items) {
    const merged = {};
    for (const [id, n] of Object.entries(items)) { const key = ITEM_MAP[id] ? this.host.name(ITEM_MAP[id]) : this.itemName(id); merged[key] = (merged[key] ?? 0) + n; }
    return Object.entries(merged).map(([name, n]) => `${name} ${n}`).join('·');
  }
  /** A frontier item id under its catalog name; research records and ruin cores are module records. */
  itemName(id) { return id === 'knowledge' ? `연구 기록(작업 ${RECORD_WORK}초)` : id === 'relic' ? '유적 핵' : this.host.name(ITEM_MAP[id] ?? id); }
  costs(items) { return Object.entries(items).map(([id, n]) => `${this.itemName(id)} ${this.inv.count(id)}/${n}`).join(' · '); }
  rewards(items) { return Object.entries(items).map(([id, n]) => `${this.itemName(id)} ${n}`).join(' · '); }
  sources(id) {
    const out = [];
    if (MINED[id]) out.push(MINED[id]);
    for (const g of Object.values(GATHERABLES)) if (g.reward[id]) out.push(`${g.name} 채집${g.regrow ? ` · ${g.regrow}초 뒤 다시 자람` : ' · 한 번'}`);
    for (const c of Object.values(CROPS)) if (c.reward[id]) out.push(`재생 텃밭 · ${c.name} 재배 (${c.seconds}초)`);
    if (['crystal', 'food'].includes(id)) out.push('마을 교역(원목 4)');
    if (['stone', 'sand'].includes(id)) out.push('마을 채석 교역(식량 2)');
    if (['knowledge', 'crystal', 'iron', 'relic'].includes(id)) out.push('유적 회수(중계기 3개 해제 뒤)');
    if (['knowledge', 'iron', 'relic'].includes(id)) out.push('수호자 격파');
    if (id === 'knowledge') out.push('마을 지원 · 장소 발견 · 생명체 관찰 기록');
    return out.length ? out : ['가방의 제작·연구'];
  }
  local() { return this.s.localPlayer(); }
  atCamp() { const p = this.local(); return Math.hypot(p.x - CAMP.x, p.z - CAMP.z) <= 12; }
  world(point) { return this.s.world(point); }
  target(point, name) { const w = this.world(point); return { name: name ?? point.name, x: w.x, z: w.z, y: this.host.runtime.atlas.heightAt(w.x, w.z) }; }

  // ---- HUD ----
  /** The journey button: the next objective or the running sortie (frontier CampaignView.hud). */
  objective() {
    const s = this.s, m = nextObjective(s), run = s.region.outpost.sortie;
    const title = run ? SORTIES[run.kind].name : m.title;
    const detail = run ? run.done ? '완료 · 야영지로 귀환' : run.kind === 'survey' ? `표석 ${run.visited.length}/3 · 여정에서 추적` : run.kind === 'hunt' ? '수호자 둥지로 이동' : '첫 마을에 보급품 전달'
      : m.done ? '달성 · 눌러서 보상 수령' : '눌러서 목표와 준비물 확인';
    return { title: this.localize(title), detail, done: m.done || !!run?.done };
  }
  /** Where the tracked objective is, in world metres (used when no destination is chosen on the map). */
  waypoint() {
    const s = this.s, run = s.region.outpost.sortie;
    let target = objectiveDestination(s);
    if (run) target = run.done ? CAMP : run.kind === 'hunt' ? { ...s.info.boss, name: '수호자 잔향' } : run.kind === 'supply' ? s.region.villages[0]
      : surveySites(s.info).find((p) => !run.visited.includes(p.index)) || CAMP;
    return target ? this.target(target, target.name ?? '목표') : null;
  }
  place() { return `${this.s.info.name} · 위험 ${this.s.info.tier}`; }
  milestones() {
    const wins = Object.values(this.s.regions).filter((r) => r.boss.defeated).length;
    return [['⚑', this.s.allies.length, '동맹'], ['◆', wins, '수호자'], ['◈', this.s.cores, '유적 핵']];
  }
  /** The guardian's wind-up zones through the shared boss telegraph view, every frame. */
  frame() {
    if (!this.telegraphs) return;
    const z = this.s.guardianZones(), rows = this._telegraphRows;
    rows.length = 0;
    if (z) {
      const y = this.host.runtime.atlas.heightAt(z.zones[0].x, z.zones[0].z) + .15;
      z.zones.forEach((zone, i) => rows.push({ bossId: `first-signal/guardian:${i}`, skillId: z.pattern, stage: 'windup', remainingS: z.warning, shape: zone.type === 'circle'
        ? zone.inner > 0 ? { kind: 'annular_cylinder', center: { x: zone.x, y, z: zone.z }, outerRadiusM: zone.outer, innerRadiusM: zone.inner, heightM: .3 }
          : { kind: 'cylinder', center: { x: zone.x, y, z: zone.z }, radiusM: zone.outer, heightM: .3 }
        : { kind: 'oriented_box', center: { x: zone.x, y, z: zone.z }, widthM: zone.width, heightM: .3, lengthM: zone.length,
          axes: [{ x: Math.cos(zone.angle), y: 0, z: -Math.sin(zone.angle) }, { x: 0, y: 1, z: 0 }, { x: Math.sin(zone.angle), y: 0, z: Math.cos(zone.angle) }] } }));
    }
    this.telegraphs.sync(this._guardianSystem);
  }

  // ---- World things (kind 'module') ----
  thing(hit) { return hit?.kind === 'module' && typeof hit.id === 'string' && hit.id.startsWith('first-signal/') ? hit.id.slice(13) : null; }
  focusCard(hit) {
    const thing = this.thing(hit); if (!thing) return null;
    const s = this.s, [kind, a, b] = thing.split(':'), position = hit.point;
    if (kind === 'guardian') { const g = s.activeBoss; return { title: s.region.outpost.sortie?.kind === 'hunt' ? '수호자 잔향' : BIOMES[s.info.biome].boss, detail: g.warning > 0 ? `${g.pattern === 'charge' ? '돌진' : g.pattern === 'cross' ? '십자 파동' : g.pattern === 'burst' ? '연속 폭발' : g.pattern === 'ring' ? '고리 파동' : '찍기'} 예고 · 붉은 범위 밖으로` : BIOMES[s.info.biome].lesson, hint: '공격: 타격', value: g.hp, max: g.maxHP, color: '#efb484', position, maxDistance: 28 }; }
    if (kind === 'village' || kind === 'villager') {
      const v = s.region.villages.find((x) => x.id === `${a}:${b}`); if (!v) return null;
      return { title: kind === 'villager' ? `${v.name} · ${ROLES[+thing.split(':')[3]]}` : v.name, detail: `${FACTIONS[v.faction]} · 평판 ${s.reputation[v.faction]}${s.allies.includes(v.faction) ? ' · 동맹' : s.reputation[v.faction] <= -20 ? ' · 적대' : ''}`, hint: '상호작용: 대화·교역', color: '#c9db9f', position, maxDistance: 10 };
    }
    if (kind === 'relay') { const done = s.region.relays.includes(+a); return { title: '공명 중계기', detail: done ? '해제함' : `해제 ${s.region.relays.length}/3`, hint: done ? '' : '상호작용: 해제', color: '#9ee4d8', position, maxDistance: 8 }; }
    if (kind === 'ruin') return { title: `${ruinDefinition(s.info).name} · 공명 핵`, detail: s.region.dungeon >= 3 ? '방어장 해제됨' : `중계기 ${s.region.relays.length}/3`, hint: s.region.dungeon >= 3 ? '상호작용: 회수' : '세 중계기를 먼저 해제하세요', color: '#9ef0e4', position, maxDistance: 9 };
    if (kind === 'resource') { const site = resourceSites(s.info).find((x) => x.id === `${a}:${b}`); return site ? { title: GATHERABLES[site.kind].name, detail: this.rewards(GATHERABLES[site.kind].reward), hint: '상호작용: 채집', color: '#c9db9f', position, maxDistance: 7 } : null; }
    if (kind === 'camp' || kind === 'mast' || kind === 'lamp' || kind === 'beam' || kind === 'facility' || kind === 'crop') return { title: CAMP.name, detail: kind === 'crop' ? '재생 텃밭' : '시설·신호망·원정', hint: kind === 'crop' ? '상호작용: 수확' : '상호작용: 야영지', color: '#ebce8a', position, maxDistance: 9 };
    if (kind === 'survey') return { title: '측량 표석', detail: s.region.outpost.sortie?.visited.includes(+a) ? '조사함' : '측량 원정 표석', hint: '상호작용: 조사', color: '#e3cb8c', position, maxDistance: 8 };
    return null;
  }
  interactLabel(hit) {
    const thing = this.thing(hit); if (thing) {
      const kind = thing.split(':')[0];
      return { village: '대화', villager: '대화', relay: '해제', ruin: '회수', resource: '채집', crop: '수확', survey: '조사', guardian: '' }[kind] ?? '야영지';
    }
    if (hit?.kind === 'creature' && hit.distance < 8) { const e = this.host.runtime.creatures.get(hit.id); if (e && !e.dead && !e.civilization && this.studyType(e) !== null) return '관찰 기록'; }
    return '';
  }
  /** Interact with a campaign thing, or record a wild creature for research (the frontier's study). */
  interact(hit) {
    const thing = this.thing(hit), s = this.s, say = (text) => { this.say(text); this.host.refresh(); return true; };
    if (!thing) {
      if (hit?.kind === 'creature' && hit.distance < 8) { const e = this.host.runtime.creatures.get(hit.id), type = e && !e.dead && !e.civilization ? this.studyType(e) : null; if (type !== null) return say(s.study(type) ? '' : '이 지역에서 이미 기록한 생명체입니다.'); }
      return false;
    }
    const [kind, a, b, c] = thing.split(':');
    if (kind === 'village' || kind === 'villager') { this.villageId = `${a}:${b}`; this.role = kind === 'villager' ? +c : 0; this.host.ledger.open('community'); return true; }
    if (kind === 'relay') return say(s.activateRelay(+a));
    if (kind === 'ruin') return say(s.claimRuin());
    if (kind === 'resource') return say(s.gather(`${a}:${b}`));
    if (kind === 'crop') return say(s.campaign('harvest', +a));
    if (kind === 'survey') return say(s.campaign('survey', +a));
    if (kind === 'guardian') return false;
    this.page = kind === 'camp' ? 'camp' : 'network'; this.host.ledger.open('journey'); return true;
  }
  /** Frontier study types (grazer, predator, decomposer) by the creature's ecological role. */
  studyType(e) {
    const role = this.host.runtime.creatures.species.get(e.speciesId)?.role ?? null;
    return { primary_consumer: 0, predator: 1, detritivore: 2 }[role] ?? null;
  }

  /** The supply sortie names its goods in catalog items (medicine is food here); the others keep their text. */
  sortieText(kind) { return kind === 'supply' ? `첫 마을에 ${this.catalogList(SORTIES.supply.cost)}을 전달하고 돌아오세요.` : this.localize(SORTIES[kind].text); }

  // ---- Ledger pages ----
  /** The journey tab: objective, camp, signal network and sorties (frontier CampaignView.render). */
  renderJourney(root) {
    const s = this.s, o = s.region.outpost, j = s.journey, atCamp = this.atCamp(), ledger = this.host.ledger;
    root.classList.add('journeyContent');
    const pages = document.createElement('div'); pages.className = 'journeyPages'; pages.setAttribute('aria-label', '여정 세부 화면');
    for (const [id, label] of [['journey', '목표'], ['camp', '야영지'], ['network', '신호망'], ['sorties', '원정']]) {
      const b = ledger.button(label, () => { this.page = id; ledger.render(); root.scrollTop = 0; });
      b.dataset.campaignPage = id; b.setAttribute('aria-pressed', String(this.page === id)); pages.append(b);
    }
    root.append(pages);
    const section = (title, text, page = 'journey') => { const el = document.createElement('section'); el.className = 'journeySection'; el.hidden = this.page !== page; el.innerHTML = `<h3>${title}</h3><p>${text}</p>`; root.append(el); return el; };
    const button = (host, label, action, arg, disabled = false) => {
      const b = ledger.button(label, () => { const scroll = root.scrollTop, result = s.campaign(action, arg); this.say(result); ledger.render(); root.scrollTop = scroll; return this.localize(result); });
      b.dataset.campaign = action; b.dataset.arg = Array.isArray(arg) ? arg.join(':') : (arg ?? ''); b.disabled = disabled; host.append(b); return b;
    };
    const head = section(j.completedAt === null ? '첫 신호' : '첫 신호 · 전송 완료', j.completedAt === null
      ? '세 공동체가 남긴 신호를 다시 연결하세요. 탐사·전투·협력 중 자신에게 맞는 방법으로 준비하고 돌아옵니다.'
      : `흩어진 공동체가 응답했습니다. 자유 탐험과 세 종류의 원정을 계속할 수 있습니다. 원정 완료 ${j.sorties}회`);
    const diagram = document.createElement('div'); diagram.className = 'signalNetwork';
    const known = channels(s);
    BIOMES.forEach((bio, i) => { const n = document.createElement('span'); n.className = known.includes(i) ? 'lit' : ''; n.textContent = `${known.includes(i) ? '◆' : '◇'} ${bio.signal}\n${['출발지 [0,0]', '동쪽 [1,0]', '북쪽 [0,-1]'][i]}`; diagram.append(n); });
    head.append(diagram);
    head.append(ledger.button('현재 목표 추적 · 월드로', () => { this.host.setDestination(null); this.host.pause(false); }));
    const steps = section('여정', '완료한 목표의 보상은 한 번만 받습니다. 활동 순서는 자유입니다.');
    for (const m of milestones(s)) {
      const done = j.claimed.includes(m.id), row = document.createElement('div');
      row.className = 'journeyStep' + (done ? ' completed' : '');
      row.innerHTML = `<strong>${done ? '✓ ' : ''}${this.localize(m.title)}</strong><p>${this.localize(m.text)}</p><small>보상 · ${this.rewards(m.reward)}</small>`;
      if (!done) button(row, m.done ? '보상 받기' : '진행 중', 'claim', m.id, !m.done);
      steps.append(row);
    }
    const camp = section('야영지 시설', `${s.info.name} · ${atCamp ? '건설·정비 가능' : '야영지 12m 안에서 이용'}. 시설은 지역마다 남습니다. 출발지의 세 시설을 완성해야 송신탑을 점화할 수 있습니다.`, 'camp');
    for (const def of PROJECTS) {
      const row = document.createElement('div'), built = o.projects.includes(def.id);
      // The kitchen restores fully; food buffs are not part of the runtime rules (user decision).
      const text = def.id === 'kitchen' ? '식량 1개로 체력과 식량을 가득 채웁니다.' : this.localize(def.text);
      row.className = 'projectRow'; row.innerHTML = `<strong>${built ? '✓ ' : ''}${def.name}</strong><p>${text}</p>${built ? '' : `<small>${this.costs(def.cost)}</small>`}`;
      if (!built) button(row, '시설 건설', 'build', def.id, !atCamp);
      if (built && def.id === 'kitchen') button(row, '식량 1 · 완전 회복', 'rest', null, !atCamp);
      if (built && def.id === 'workshop') button(row, `${this.catalogList({ iron: 1, wood: 1 })} · 장비 정비`, 'repair', null, !atCamp);
      if (built && def.id === 'garden') o.plots.forEach((plot, index) => {
        const bed = document.createElement('div'); bed.className = 'cropRow';
        if (plot) { const remaining = Math.max(0, Math.ceil(plot.ready - s.time)); bed.innerHTML = `<span>밭 ${index + 1} · ${CROPS[plot.crop].name} · ${remaining ? `${remaining}초 후 수확` : '수확 가능'}</span>`; button(bed, '수확', 'harvest', index, !atCamp || remaining > 0); }
        else { bed.innerHTML = `<span>밭 ${index + 1} · 빈 밭 · 씨앗 ${this.inv.count('seed')}</span>`; for (const [id, crop] of Object.entries(CROPS)) button(bed, `${crop.name} 심기 · 씨앗 1`, 'plant', [index, id], !atCamp); }
        row.append(bed);
      });
      camp.append(row);
    }
    const signal = section(`${BIOMES[s.info.biome].signal} 신호 복원`, o.signal ? `복원 완료 · ${SIGNAL_ROUTES[o.signal.route].name}` : '세 경로 중 하나를 선택하세요. 보스 처치는 필수 조건이 아닙니다.', 'network');
    if (!o.signal) for (const [id, route] of Object.entries(SIGNAL_ROUTES)) {
      const row = document.createElement('div'); row.className = 'signalRoute';
      row.innerHTML = `<strong>${route.name} · ${signalEligible(s, id) ? '조건 달성' : '준비 중'}</strong><p>${this.localize(route.text)}<br>${this.costs(route.cost)}</p>`;
      button(row, '이 경로로 복원', 'signal', id, !atCamp || !signalEligible(s, id)); signal.append(row);
    }
    if (j.completedAt === null) {
      const final = section('송신탑 점화', `출발지 [0,0]에서 세 신호와 세 시설을 연결합니다. ${this.costs({ iron: 8, knowledge: 6 })}`, 'network');
      button(final, '첫 신호 전송', 'ignite', null, !atCamp || s.key !== '0,0' || known.length < 3);
    }
    const sorties = section('신호 너머 · 반복 원정', j.completedAt === null
      ? '첫 신호를 전송하면 열립니다. 측량·보급·수호자 잔향을 번갈아 즐기며 유적 핵과 연구·정비 물자를 얻습니다.'
      : `이 지역 원정 완료 ${o.rounds}회 · ${o.nextSortie > s.time ? `재출발까지 ${Math.ceil(o.nextSortie - s.time)}초` : '출발 가능'}`, 'sorties');
    if (o.sortie) {
      const run = o.sortie;
      sorties.append(Object.assign(document.createElement('p'), { textContent: `${SORTIES[run.kind].name} · ${run.done ? '목표 달성' : this.sortieText(run.kind)}` }));
      button(sorties, '원정 보상 수령', 'claimSortie', null, !atCamp || !run.done);
      button(sorties, '원정 포기 · 투입 물자 반환 없음', 'abandonSortie', null, !atCamp);
    } else for (const [id, def] of Object.entries(SORTIES)) {
      const row = document.createElement('div'); row.className = 'sortieRow';
      row.innerHTML = `<strong>${def.name}</strong><p>${this.sortieText(id)}<br>보상 · ${this.rewards(def.reward)}</p>`;
      button(row, '원정 출발', 'startSortie', id, !atCamp || j.completedAt === null || !o.signal || o.nextSortie > s.time); sorties.append(row);
    }
    const guide = document.createElement('details'); guide.className = 'journeySources'; guide.hidden = !['camp', 'network'].includes(this.page);
    guide.innerHTML = '<summary>시설·신호 복원 재료를 얻는 곳</summary>';
    for (const id of ['wood', 'dirt', 'plank', 'stone', 'iron', 'crystal', 'relic', 'knowledge', 'seed', 'food']) { const p = document.createElement('p'); p.textContent = `${this.itemName(id)}: ${this.sources(id).join(' / ')}`; guide.append(p); }
    root.append(guide);
    const log = section('원정 기록', s.log.slice(0, 6).map((line) => line.replace(/[<>&]/g, '')).join('<br>'));
    log.hidden = this.page !== 'journey';
    return true;
  }
  /** The village tab: the region's villages, their actions and contracts (frontier society page). */
  renderCommunity(root) {
    const s = this.s, p = this.local(), ledger = this.host.ledger, distanceTo = (v) => Math.hypot(p.x - v.x, p.z - v.z);
    const intro = document.createElement('section'); intro.className = 'journeySection';
    intro.innerHTML = '<h3>공동체와 관계</h3><p>마을 12m 안에서 교역·지원·외교가 가능합니다. 다른 지역의 마을도 30초마다 생산·소비합니다.</p>';
    root.append(intro);
    const talking = s.region.villages.find((v) => v.id === this.villageId);
    if (talking && distanceTo(talking) <= 14) { const greeting = document.createElement('p'); greeting.className = 'npcSpeech'; greeting.textContent = `${talking.name} · ${ROLES[this.role]} — ${GREETINGS[this.role]}`; root.append(greeting); }
    const villages = [...s.region.villages].sort((a, b) => Number(b.id === this.villageId) - Number(a.id === this.villageId));
    for (const v of villages) {
      const row = document.createElement('section'), far = distanceTo(v) > 12, rep = s.reputation[v.faction];
      row.className = 'villageRow'; row.dataset.village = v.id;
      row.innerHTML = `<h3></h3><p>주민 ${v.population} · 기술 ${v.tech} · 평판 ${rep}${s.allies.includes(v.faction) ? ' · 동맹' : rep <= -20 ? ' · 적대' : ''}<br>재고 식량 ${v.food} · 목재 ${v.wood} · 돌 ${v.stone} · 결정 ${v.crystal}</p><div class="frontierButtons"></div>`;
      row.querySelector('h3').textContent = `${v.name} · ${FACTIONS[v.faction]} · ${Math.round(distanceTo(v))} m`;
      for (const [action, title, cost, gain] of VILLAGE_ACTIONS) {
        const label = cost ? `${title} · ${this.catalogList(cost)}${gain ? ` → ${this.catalogList(gain)}` : ''}` : title;
        const b = ledger.button(label, () => {
          if (action === 'raid' && this.raidVillage !== v.id) { this.raidVillage = v.id; this.host.notify(`${v.name}을 약탈하면 평판이 35 떨어지고 동맹·교역이 끊깁니다. 다시 누르면 진행합니다.`); ledger.render(); return ''; }
          this.raidVillage = null; const result = s.village(v.id, action); this.say(result); ledger.render(); return this.localize(result);
        });
        b.dataset.action = action; b.disabled = far; if (action === 'raid' && this.raidVillage === v.id) b.textContent = '약탈 확인 · 다시 누르면 진행';
        row.querySelector('div').append(b);
      }
      if (v.id === s.region.villages[0].id && s.region.outpost.sortie?.kind === 'supply') {
        const delivery = ledger.button(`원정 보급 전달 · ${this.catalogList(SORTIES.supply.cost)}`, () => { const result = s.campaign('deliverSortie'); this.say(result); ledger.render(); return this.localize(result); });
        delivery.dataset.campaign = 'deliverSortie'; delivery.disabled = far || s.region.outpost.sortie.done; row.append(delivery);
      }
      const quests = document.createElement('div'); quests.className = 'villageContracts'; quests.innerHTML = '<h4>주민 의뢰 · 재료를 모아 전달</h4>';
      for (const quest of CONTRACTS) {
        const done = s.region.contracts.includes(`${v.id}/${quest.id}`), entry = document.createElement('section');
        entry.className = 'contractEntry'; entry.innerHTML = `<strong>${quest.name}${done ? ' · 완료' : ''}</strong><p>${quest.text}<br>${this.costs(quest.cost)}<br>보상: ${this.rewards(quest.reward)} · 평판 8</p>`;
        const b = ledger.button(done ? '전달 완료' : '의뢰 전달', () => { const scroll = root.scrollTop, result = s.deliver(v.id, quest.id); this.say(result); ledger.render(); root.scrollTop = scroll; return this.localize(result); });
        b.dataset.contract = quest.id; b.disabled = done || far || rep <= -20; entry.append(b); quests.append(entry);
      }
      row.append(quests); root.append(row);
    }
    return true;
  }
  /** Map page additions: the region travel grid (one food, from the camp or the shore) and campaign places. */
  mapInfo() {
    const s = this.s;
    return { title: s.info.name, subtitle: `위험 ${s.info.tier} · ${Object.keys(s.regions).length}개 지역 발견`,
      destinations: [{ ...CAMP }, ...s.region.villages, { name: `${ruinDefinition(s.info).name} · 중계기 ${s.region.relays.length}/3`, ...s.info.dungeon },
        ...resourceSites(s.info).filter((site) => site.id.endsWith(':0')).map((site) => ({ ...site, name: GATHERABLES[site.kind].name })),
        { name: s.activeBoss.defeated ? '수호자 둥지 · 격파' : '수호자 둥지', ...s.info.boss }].map((d) => this.target(d, d.name)) };
  }
  renderTravel(root) {
    const s = this.s, ledger = this.host.ledger, grid = document.createElement('div');
    grid.className = 'routeGrid';
    const cell = (dx, dz, arrow) => {
      const bio = BIOMES[biomeIndex(s.x + dx, s.z + dz)], b = ledger.button('', () => { const result = s.travel(dx, dz); this.say(result); this.host.pause(false); return result; });
      b.dataset.route = `${dx},${dz}`; b.innerHTML = `${arrow}<small>${bio.name} · ${bio.signal}</small>`; return b;
    };
    const here = document.createElement('span'); here.innerHTML = `<b>⌂</b><small>${s.x}, ${s.z}</small>`;
    // North, west, here, east, south: the shared .routeGrid places them as a compass.
    grid.append(cell(0, -1, '↑'), cell(-1, 0, '←'), here, cell(1, 0, '→'), cell(0, 1, '↓'));
    const section = document.createElement('section'); section.className = 'journeySection';
    section.innerHTML = `<h3>지역 이동</h3><p>야영지나 지역 섬 가장자리에서 이웃 지역의 야영지로 이동합니다. 식량 1개 필요 · 보유 ${this.inv.count('food')}. 기계로 바다(약 ${REGION_STRIDE - 160} m)를 날아 건널 수도 있습니다.</p>`;
    section.append(grid); root.append(section);
  }
}
