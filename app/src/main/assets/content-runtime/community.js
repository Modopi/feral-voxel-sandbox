// Plain-data interaction service. Progression owns activity time and rewards;
// CreatureSystem owns resident bodies, inventories, repair progress and deaths.
const copy = value => JSON.parse(JSON.stringify(value));
const fail = reason => ({ ok: false, reason });
const point = value => Array.isArray(value) ? { x: value[0], y: value[1], z: value[2] } : value;
const distance = (a, b) => { a = point(a); b = point(b); return a && b ? Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z) : Infinity; };
const RANGE = 3;
const validCounter = n => Number.isSafeInteger(n) && n >= 0;
const encode = (target, type, key, serial) => 'community:' + encodeURIComponent(JSON.stringify([target, type, key, serial]));

export class CommunitySystem {
  constructor(runtime, state = {}) {
    if (!runtime?.creatures || !runtime.progression || !runtime.dungeons || !runtime.player) throw Error('Community dependencies required');
    this.runtime = runtime; this.creatures = runtime.creatures; this.progression = runtime.progression; this.dungeons = runtime.dungeons;
    this.communities = new Map(); this.receipts = new Map(); this.activeRepair = null; this.events = [];
    if (state.schemaVersion != null && state.schemaVersion !== 1) throw Error('Unsupported community save');
    for (const raw of state.communities ?? []) {
      if (!raw || typeof raw.id !== 'string' || this.communities.has(raw.id) || !validCounter(raw.serial) || !validCounter(raw.contributions) || !Array.isArray(raw.residentIds) || !raw.residentIds.every(id => typeof id === 'string') || !Array.isArray(raw.activities)) throw Error('Invalid community save');
      for (const a of raw.activities) if (typeof a.jobId !== 'string' || typeof a.activityId !== 'string' || !['pending', 'completed', 'cancelled'].includes(a.status)) throw Error('Invalid community activity');
      this.communities.set(raw.id, copy(raw));
    }
    for (const receipt of state.receipts ?? []) {
      if (!Array.isArray(receipt) || typeof receipt[0] !== 'string' || !receipt[1]?.ok || this.receipts.has(receipt[0])) throw Error('Invalid community receipt');
      this.receipts.set(receipt[0], copy(receipt[1]));
    }
    if (state.activeRepair != null) {
      if (typeof state.activeRepair.targetId !== 'string' || typeof state.activeRepair.actionId !== 'string') throw Error('Invalid community repair');
      this.activeRepair = copy(state.activeRepair);
    }
  }
  get player() { return this.runtime.player; }
  _definition(instanceId) { return this.dungeons.definition(instanceId); }
  _anchors(instanceId) { return this.dungeons.anchors(instanceId).filter(a => a.kind === 'service'); }
  _civilian(e) { return Boolean(e && !e.dead && e.civilization && this.creatures.species.get(e.speciesId)?.civilization); }
  _friendly(e) { return this._civilian(e) && e.angerUntil <= this.creatures.time && !e.attack && e.targetId !== 'player'; }
  _near(position) {
    if (!(this.player.hp > 0) || distance(this.player, position) > RANGE) return false;
    const terrain = this.runtime.terrain;
    const from = { ...this.player, y: (this.player.y ?? 0) + .8 }, p = point(position), to = { ...p, y: (p.y ?? 0) + .8 };
    return !terrain?.hasLineOfSight || Boolean(terrain.hasLineOfSight(from, to));
  }
  ensureCommunity(instanceId) {
    if (this.communities.has(instanceId)) return this.communities.get(instanceId);
    const instance = this.dungeons.get(instanceId), definition = this._definition(instanceId);
    if (!instance || !definition?.community?.instanceIdRequired || !definition.community.residentBudget?.length) return null;
    const c = { id: instanceId, serial: 0, contributions: 0, residentIds: [], activities: [] };
    const anchors = this._anchors(instanceId), origin = point(instance.origin);
    // The authored residentBudget is a maximum, not an infinite replacement pool.
    // Instantiate this finite initial roster exactly once; dead residents stay dead.
    let index = 0;
    for (const budget of definition.community.residentBudget) {
      const species = this.creatures.species.get(budget.speciesId);
      if (!species?.civilization) throw Error('Community resident must be civilized');
      for (let n = 0; n < budget.maxCount; n++, index++) {
        const anchor = point(anchors[index % Math.max(1, anchors.length)]?.position) ?? origin;
        const id = `${instanceId}:resident:${budget.speciesId}:${n}`;
        const position = { x: anchor.x + (Math.floor(index / Math.max(1, anchors.length)) % 2) * 1.2, y: anchor.y, z: anchor.z + 1.2 };
        const floor = this.runtime.terrain?.groundHeight?.(position.x, position.z, anchor.y);
        if (Number.isFinite(floor)) position.y = floor;
        const e = this.creatures.spawn(budget.speciesId, position, { id, communityId: instanceId });
        c.residentIds.push(e.id);
      }
    }
    this.communities.set(instanceId, c); return c;
  }
  _communityFor(e) { return e?.communityId ? this.communities.get(e.communityId) : null; }
  _repairStation(e) {
    if (!e?.communityId) return null;
    return this._anchors(e.communityId).find(a => a.serviceId === 'repair' && this._near(a.position) && distance(e, a.position) <= RANGE) ?? null;
  }
  _option(target, type, key, serial, label, detail, cost, reason, extra = {}) {
    return { id: encode(target, type, key, serial), targetId: target, label, detail, cost: copy(cost), disabled: Boolean(reason), reason: reason ?? null, ...extra };
  }
  optionsFor(targetId) {
    const e = this.creatures.get(targetId);
    if (e) {
      if (!this._civilian(e)) return [];
      const s = this.creatures.species.get(e.speciesId), out = [];
      const unavailable = !this._near(e) ? 'out_of_range' : !this._friendly(e) ? 'hostile' : null;
      const organic = s.entityType === 'organic';
      const give = organic ? { food: 1 } : { scrap_iron: 1 }, receive = organic ? { wood: 2 } : { stone: 2 };
      const offer = organic ? 'food_for_wood' : 'iron_for_stone';
      const stock = Object.entries(receive).every(([id, n]) => (e.inventory[id] ?? 0) >= n);
      out.push(this._option(e.id, 'trade', offer, e.interactionSerial, organic ? '식량 1개를 목재 2개와 교환' : '잡철 1개를 돌 2개와 교환', '주민의 실제 보유 재고에서 교환합니다.', give, unavailable ?? (!stock ? 'out_of_stock' : !this.progression.hasItems(give) ? 'items_required' : null), { receive }));
      if (s.calories) out.push(this._option(e.id, 'feed', 'food', e.interactionSerial, '음식 건네기', `음식 1개로 최대 ${this.creatures.foodCalories} CP를 회복합니다.`, { food: 1 }, unavailable ?? (e.calories >= s.calories.maxCp ? 'not_hungry' : !this.progression.hasItems({ food: 1 }) ? 'items_required' : null)));
      if (s.repair) {
        const cost = { [s.repair.materialId]: s.repair.unitsPerAction };
        out.push(this._option(e.id, 'repair', 'repair', e.repairSerial, '주민 수리', `${s.repair.durationS}초 동안 정비소에서 작업하여 최대 ${s.repair.hpPerAction} HP를 회복합니다.`, cost, unavailable ?? (!this._repairStation(e) ? 'station_required' : e.hp >= e.maxHp ? 'already_full' : this.creatures.time - e.lastHitAt < 1 ? 'in_combat' : this.activeRepair ? 'repair_in_progress' : !this.progression.hasItems(cost) ? 'items_required' : null), { progress: e.repairProgress / s.repair.durationS }));
      }
      const c = this._communityFor(e);
      if (c) out.push(...this._serviceOptions(c, e));
      return out;
    }
    const c = this.communities.get(targetId);
    return c ? this._serviceOptions(c) : [];
  }
  _serviceOptions(c, contact = null) {
    const def = this._definition(c.id), out = [], alive = c.residentIds.map(id => this.creatures.get(id)).filter(e => this._friendly(e));
    if (!def || !alive.length) return [];
    for (const anchor of this._anchors(c.id)) {
      if (!['contribution', 'rest'].includes(anchor.serviceId)) continue;
      const near = contact ? this._near(contact) && this._friendly(contact) : this._near(anchor.position);
      const target = contact?.id ?? c.id;
      if (anchor.serviceId === 'rest') {
        out.push(this._option(target, 'rest', anchor.id, c.serial, this.player.resting ? '휴식 마치기' : '공동체에서 휴식', '보유 칼로리를 소비하는 기존 자연회복 규칙을 사용합니다.', {}, near ? null : 'out_of_range'));
      } else {
        const a = this.progression.catalog.get('community_contribution');
        if (a?.kind !== 'activity') continue;
        const pending = c.activities.some(a => a.status === 'pending');
        out.push(this._option(target, 'activity', a.id, c.serial, a.name, `${a.secondsPerRepetition}초 보급 계약. ${a.repetitions}회 완료 시 신성 ${a.outputEnergy.divine} EU. 완료 기여 ${c.contributions}회.`, a.inputs, !near ? 'out_of_range' : pending ? 'activity_in_progress' : !this.progression.hasItems(a.inputs) ? 'items_required' : null));
      }
    }
    return out;
  }
  interact(actionId, { targetId, requestId } = {}) {
    if (requestId != null && (typeof requestId !== 'string' || !requestId.length || requestId.length > 512)) return fail('invalid_request');
    if (typeof actionId !== 'string') return fail('invalid_action');
    let decoded;
    try { if (!actionId.startsWith('community:')) return fail('invalid_action'); decoded = JSON.parse(decodeURIComponent(actionId.slice(10))); } catch { return fail('invalid_action'); }
    if (!Array.isArray(decoded) || decoded.length !== 4 || typeof decoded[0] !== 'string' || !validCounter(decoded[3])) return fail('invalid_action');
    const [target, type, key] = decoded;
    if (targetId && targetId !== target) return fail('wrong_target');
    const receiptKey = requestId ? `request:${requestId}` : actionId;
    const previous = this.receipts.get(receiptKey) ?? this.receipts.get(actionId);
    if (previous) return previous.actionId && previous.actionId !== actionId ? fail('request_conflict') : { ...copy(previous), duplicate: true };
    const option = this.optionsFor(target).find(o => o.id === actionId);
    if (!option) return fail('stale_or_unknown_action');
    const recordedActivity = type === 'activity' && this.progression.activityRequests?.[actionId];
    if (option.disabled && !(recordedActivity && ['items_required', 'activity_in_progress'].includes(option.reason))) return fail(option.reason);
    const e = this.creatures.get(target), c = e ? this._communityFor(e) : this.communities.get(target);
    let result;
    if (type === 'trade' || type === 'feed') result = this.creatures.interact(target, { type, offerId: key, inventory: this.progression });
    else if (type === 'repair') {
      this.activeRepair = { targetId: target, actionId };
      result = { ok: true, pending: true, targetId: target };
    } else if (type === 'rest' && c) {
      this.player.resting = !this.player.resting; c.serial++;
      result = { ok: true, resting: this.player.resting };
    } else if (type === 'activity' && c) {
      result = this.progression.startActivity(key, { communityId: c.id, requestId: actionId });
      if (result.ok) {
        if (!c.activities.some(a => a.jobId === result.jobId)) c.activities.push({ jobId: result.jobId, activityId: key, status: 'pending' });
        c.serial++;
      }
    } else return fail('unknown_action');
    if (result.ok) { const receipt = { ...copy(result), actionId }; this.receipts.set(actionId, receipt); if (requestId) this.receipts.set(receiptKey, copy(receipt)); }
    return result;
  }
  tick(dt) {
    if (!Number.isFinite(dt) || dt < 0 || dt > 7200) return fail('invalid_dt');
    for (const instance of this.dungeons.instancesNear(this.player, 96)) this.ensureCommunity(instance.id);
    for (const c of this.communities.values()) for (const a of c.activities) {
      if (a.status !== 'pending') continue;
      if (this.progression.claims.has(`complete:${a.jobId}`)) {
        a.status = 'completed'; c.contributions++;
        this.events.push({ type: 'community_contribution_completed', communityId: c.id, jobId: a.jobId, contributions: c.contributions });
      } else if (!this.progression.jobs.some(j => j.id === a.jobId)) a.status = 'cancelled';
    }
    if (this.activeRepair) {
      const job = this.activeRepair, e = this.creatures.get(job.targetId);
      if (!this._friendly(e) || !this._near(e) || !this._repairStation(e)) {
        this.activeRepair = null; this.receipts.delete(job.actionId);
        this.events.push({ type: 'community_repair_paused', targetId: job.targetId });
      } else {
        const result = this.creatures.repair(e.id, { inventory: this.progression, atStation: true, dt });
        if (!result.ok || !result.pending) {
          this.activeRepair = null;
          if (result.ok) this.receipts.set(job.actionId, copy(result)); else this.receipts.delete(job.actionId);
          this.events.push({ type: 'community_repair_finished', targetId: e.id, ...result });
        }
      }
    }
    return { ok: true };
  }
  drainEvents() { return this.events.splice(0); }
  serialize() { return copy({ schemaVersion: 1, communities: [...this.communities.values()], receipts: [...this.receipts], activeRepair: this.activeRepair }); }
}
