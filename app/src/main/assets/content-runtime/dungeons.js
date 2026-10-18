// Runtime ownership: placement, room/anchor access, puzzle state, structure damage and
// reward claims. CreatureSystem owns populations and ecosystem resource stocks.
import { DungeonDeviceSystem } from './dungeon-devices.js';

const GRID = 0.5, VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));
const finite = value => Number.isFinite(value);
const quantize = value => Math.round(value / GRID) * GRID;
const point = value => Array.isArray(value) ? value.slice(0, 3) : [value?.x, value?.y ?? 0, value?.z];
const validPoint = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const inside = (p, lo, hi) => p.every((v, i) => v >= lo[i] && v < hi[i]);
const overlap = (a, b) => a.min.every((v, i) => v < b.max[i] && a.max[i] > b.min[i]);
const boxBounds = b => ({ min: b.center.map((v, i) => v - b.size[i] / 2), max: b.center.map((v, i) => v + b.size[i] / 2) });
function hash(text) { let n = 2166136261; for (const c of String(text)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
function cellAt(p) { return p.map(v => Math.floor(v / GRID)); }
function cellKey(c) { return c.join(','); }
function cellCenter(c) { return c.map(v => (v + 0.5) * GRID); }
function boxFromBounds(min, max, source = {}) { return { ...source, center: min.map((v, i) => (v + max[i]) / 2), size: min.map((v, i) => max[i] - v) }; }
function subtractBox(source, removed) {
  const b = boxBounds(source); if (!overlap(b, removed)) return [source];
  const lo = b.min.map((v, i) => Math.max(v, removed.min[i])), hi = b.max.map((v, i) => Math.min(v, removed.max[i]));
  const result = [], push = (min, max) => { if (min.every((v, i) => v < max[i])) result.push(boxFromBounds(min, max, source)); };
  push(b.min, [lo[0], b.max[1], b.max[2]]); push([hi[0], b.min[1], b.min[2]], b.max);
  push([lo[0], b.min[1], b.min[2]], [hi[0], lo[1], b.max[2]]); push([lo[0], hi[1], b.min[2]], [hi[0], b.max[1], b.max[2]]);
  push([lo[0], lo[1], b.min[2]], [hi[0], hi[1], lo[2]]); push([lo[0], lo[1], hi[2]], [hi[0], hi[1], b.max[2]]);
  return result;
}
export class DungeonSystem {
  constructor({ catalog, seed = 1, state = null, atlas = null, assets = null, firstStructureDistance = 160, starterStructures = true } = {}) {
    if (!catalog?.structures?.entries || !Number.isSafeInteger(seed)) throw Error('던전 카탈로그와 정수 시드가 필요합니다.');
    this.catalog = catalog; this.seed = seed; this.atlas = atlas; this.assets = assets; this.starterStructures = starterStructures;
    this.templates = new Map(catalog.structures.entries.map(e => [e.id, e]));
    this.blocks = new Map((catalog.blocks?.entries || []).map(e => [e.id, e]));
    this.rewards = new Map((catalog.progression?.entries || []).filter(e => e.kind === 'reward_pool').map(e => [e.id, e]));
    this.bossVariants = new Map((catalog.bosses?.variants || []).map(v => [v.id, v]));
    this.instances = new Map(); this.instanceBuckets = new Map(); this.models = new Map(); this.events = []; this.time = 0;
    this.rejectedSites = new Set();this.nearCandidates=new Map();this.boundsCache=new WeakMap();this.gateModels=new Map();this.queryBoundsCache=new WeakMap();
    this.firstStructureDistance = quantize(firstStructureDistance);
    if (!finite(firstStructureDistance) || firstStructureDistance < 64) throw Error('첫 건축물은 스폰에서 64m 이상 떨어져야 합니다.');
    this.devices = new DungeonDeviceSystem(this);
    if (state) this._load(state);
  }
  _load(state) {
    if (state.schemaVersion !== VERSION || state.seed !== this.seed || !Array.isArray(state.instances) || !finite(state.time) || state.time < 0) throw Error('던전 저장 버전 또는 시드가 맞지 않습니다.');
    this.time = state.time;
    for (const source of state.instances) {
      const s = clone(source), template = this.templates.get(s.templateId);
      if (!template || typeof s.id !== 'string' || this.instances.has(s.id) || !validPoint(s.origin) || !Number.isInteger(s.tier) || s.tier < 1 || s.tier > 10 || !Array.isArray(s.visitedRooms) || !s.damage || !s.claims || !s.producerStates) throw Error('건축물 저장 상태가 잘못되었습니다.');
      if (s.regionTier == null) s.regionTier = s.tier;
      if (!Number.isInteger(s.regionTier) || s.regionTier < 1 || s.regionTier > 10 || template.prototypeTier && s.tier !== template.prototypeTier) throw Error('검증하지 않은 건축물 티어 변형입니다.');
      if(s.boss){
        const variant=s.boss.contentVariantId?this.bossVariants.get(s.boss.contentVariantId):null;
        if(s.boss.definitionId!==template.bossArena?.bossId||s.boss.contentVariantId&&(!variant||variant.baseBossId!==s.boss.definitionId||variant.tier!==s.regionTier))throw Error('보스 변형 저장이 잘못되었습니다.');
        s.boss.tier??=s.tier;
        if(s.boss.tier!==(variant?.tier??s.tier))throw Error('보스 티어 저장이 잘못되었습니다.');
        if(s.boss.rewardOverride&&JSON.stringify(s.boss.rewardOverride)!==JSON.stringify(variant?.rewardOverride))throw Error('보스 보상 저장이 잘못되었습니다.');
      }
      if (s.archiveChallenge && (!Array.isArray(s.archiveChallenge.observed) || new Set(s.archiveChallenge.observed).size !== s.archiveChallenge.observed.length || s.archiveChallenge.observed.some(id => !['room_1','room_2'].includes(id)))) throw Error('유적 관찰 기록이 잘못되었습니다.');
      if (s.origin.some(v => Math.abs(v / GRID - Math.round(v / GRID)) > 1e-6)) throw Error('건축물 위치가 격자에 맞지 않습니다.');
      if (s.visitedRooms.some(id => !template.rooms.some(r => r.id === id))) throw Error('없는 방의 방문 기록입니다.');
      for (const [key, d] of Object.entries(s.damage)) if (!/^-?\d+,-?\d+,-?\d+$/.test(key) || !finite(d.hp) || d.hp < 0 || typeof d.removed !== 'boolean') throw Error('파손 저장이 잘못되었습니다.');
      if (s.puzzle && (!['locked','opening','open'].includes(s.puzzle.phase) || !finite(s.puzzle.elapsedS) || s.puzzle.elapsedS < 0)) throw Error('퍼즐 저장이 잘못되었습니다.');
      if (s.puzzle) {
        s.deviceState ??= this.devices.createState(s, template);
        this.devices.validateState(s, template);
      }
      this.instances.set(s.id, s); this._indexInstance(s); this._reserve(s);
    }
  }
  _height(x, z) { const h = this.atlas?.heightAt?.(x, z) ?? this.atlas?.sample?.(x, z)?.height ?? 0; return finite(h) ? quantize(h) : 0; }
  _bounds(instance) {
    const old=this.boundsCache.get(instance),o=instance.origin;if(old&&old.x===o[0]&&old.z===o[2])return old.bounds;
    const f=this.templates.get(instance.templateId).footprintM,bounds={minX:o[0]+f.min[0],maxX:o[0]+f.max[0],minZ:o[2]+f.min[1],maxZ:o[2]+f.max[1]};this.boundsCache.set(instance,{x:o[0],z:o[2],bounds});return bounds;
  }
  _queryBounds(instance){const model=this._model(instance.templateId),base=this._bounds(instance),old=this.queryBoundsCache.get(instance);if(old&&old.model===model&&old.base===base)return old.bounds;const b=model?.spatialBounds,o=instance.origin,bounds=b?{minX:Math.min(base.minX,o[0]+b.min[0]),maxX:Math.max(base.maxX,o[0]+b.max[0]),minZ:Math.min(base.minZ,o[2]+b.min[2]),maxZ:Math.max(base.maxZ,o[2]+b.max[2])}:base;this.queryBoundsCache.set(instance,{model,base,bounds});return bounds;}
  _indexInstance(instance) {
    this.nearCandidates.clear();
    const b=this._queryBounds(instance);for(let z=Math.floor(b.minZ/256);z<=Math.floor(b.maxZ/256);z++)for(let x=Math.floor(b.minX/256);x<=Math.floor(b.maxX/256);x++){const key=`${x},${z}`;if(!this.instanceBuckets.has(key))this.instanceBuckets.set(key,new Set());this.instanceBuckets.get(key).add(instance.id);}
  }
  _reserve(instance) {
    if (!this.atlas?.reserveArea) return;
    this.atlas.reserveArea(instance.id, { ...this._bounds(instance), height: instance.origin[1] - GRID });
    const basin=this.templates.get(instance.templateId).ecology?.water;
    if(basin){const c=add(instance.origin,basin.basinCenterM),size=basin.basinSizeM;this.atlas.reserveArea(`basin:${instance.id}`,{minX:c[0]-size[0]/2,maxX:c[0]+size[0]/2,minZ:c[2]-size[2]/2,maxZ:c[2]+size[2]/2,height:c[1]-GRID});}
  }
  ensureInstance(templateId, siteId, origin, tier = null, { variant = null } = {}) {
    const template = this.templates.get(templateId); if (!template) throw Error('없는 건축물입니다: ' + templateId);
    const id = `structure:${this.seed}:${siteId}:${templateId}`;
    if (this.instances.has(id)) return this.instances.get(id);
    const p = point(origin); if (!validPoint(p)) throw Error('유효한 건축물 좌표가 필요합니다.');
    const regionTier = tier ?? template.prototypeTier ?? 2, level = template.prototypeTier ?? regionTier; if (!Number.isInteger(regionTier) || regionTier < 1 || regionTier > 10) throw Error('건축물 티어는 1~10입니다.');
    if (variant !== null && !(variant === 'small_ruin' && templateId === 'communal_archive')) throw Error('지원하지 않는 건물 변형입니다.');
    const variantBossTemplate = ['forgotten_monastery', 'inertia_tower'].includes(templateId) && [9, 10].includes(regionTier);
    const bossVariant = variantBossTemplate
      ? [...this.bossVariants.values()].find(v => v.baseBossId === template.bossArena?.bossId && v.tier === regionTier)
      : null;
    const instance = { id, templateId, variant, archiveChallenge: variant === 'small_ruin' ? { observed: [] } : null, siteId: String(siteId), generatorVersion: VERSION, origin: p.map(quantize), tier: level, regionTier, visitedRooms: [], discovered: false,
      damage: {}, claims: {}, waterBreached: false, producerStates: Object.fromEntries((template.ecology?.producers || []).map(p => [p.id, { destroyed: false }])),
      puzzle: template.puzzle ? { phase: 'locked', elapsedS: 0, durationS: 0, paid: false } : null,
      boss: template.bossArena ? { instanceId: `${id}:boss`, definitionId: template.bossArena.bossId, tier: bossVariant?.tier ?? level, ...(bossVariant ? { contentVariantId: bossVariant.id } : {}), defeated: false } : null, revision: 0 };
    if (instance.puzzle) instance.deviceState = this.devices.createState(instance, template);
    this._reserve(instance); this.instances.set(id, instance); this._indexInstance(instance); return instance;
  }
  bootstrap() {
    // Map presets without the expedition's starter manor and supply camp (the basic island) skip them.
    if (!this.starterStructures) return [];
    const savedFirst=this.instances.get(`structure:${this.seed}:starter-manor:root_manor`);
    const y = savedFirst?.origin[1] ?? this._height(0, 0) + GRID, result = [];
    if (this.templates.has('root_manor')) {
      const first = this.ensureInstance('root_manor', 'starter-manor', [this.firstStructureDistance, y, 0], 2); result.push(first);
      // A dry, walkable approach uses the same ground height as the initial spawn.
      this.atlas?.reserveArea?.(`${first.id}:approach`, { minX: 0, maxX: first.origin[0] - 6, minZ: -4, maxZ: 4, height: y - GRID });
    }
    if (this.templates.has('grove_supply_camp')) result.push(this.ensureInstance('grove_supply_camp', 'starter-supply', [-32, y, 70], 1));
    return result;
  }
  _fitSite(site, x, z) {
    const template=this.templates.get(site.templateId), f=template.footprintM;
    const bounds={minX:x+f.min[0],maxX:x+f.max[0],minZ:z+f.min[1],maxZ:z+f.max[1]};
    if([...this.instances.values()].some(i=>{const b=this._bounds(i);return bounds.minX<b.maxX+8&&bounds.maxX>b.minX-8&&bounds.minZ<b.maxZ+8&&bounds.maxZ>b.minZ-8;}))return null;
    const center=this.atlas?.sample?.(x,z),environment=this.catalog.environments?.entries.find(e=>e.id===(site.environmentId??center?.environmentId));
    if(center&&site.environmentId&&center.environmentId!==site.environmentId)return null;
    if(Math.hypot(x,z)<(environment?.building?.minDistanceToSpawnM??160))return null;
    const tolerance=environment?.building?.terrainModificationMaxHeightM??2, heights=[];
    // Include both footprint edges and interior at <=8m spacing. Narrow roads are
    // additionally checked against reservations below, not just sampled centers.
    const nx=Math.max(1,Math.ceil((bounds.maxX-bounds.minX)/8)),nz=Math.max(1,Math.ceil((bounds.maxZ-bounds.minZ)/8));
    for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
      const px=bounds.minX+(bounds.maxX-bounds.minX)*ix/nx,pz=bounds.minZ+(bounds.maxZ-bounds.minZ)*iz/nz,s=this.atlas?.sample?.(px,pz);
      if(s&&(s.safeBypass||s.reservedBy||s.waterLevel!=null))return null;
      const h=s?.height??this._height(px,pz);if(!finite(h))return null;heights.push(h);
    }
    for(const r of this.atlas?.reservations?.values?.()??[])if(bounds.minX<r.maxX&&bounds.maxX>r.minX&&bounds.minZ<r.maxZ&&bounds.maxZ>r.minZ)return null;
    heights.sort((a,b)=>a-b);const ground=quantize(heights[Math.floor(heights.length/2)]);
    if(heights.some(h=>Math.abs(h-ground)>tolerance))return null;
    return [quantize(x),ground+GRID,quantize(z)];
  }
  ensureNear(position, radius = 384) {
    const p = point(position); if (!validPoint(p) || !finite(radius) || radius < 0) throw Error('탐색 위치와 반경이 잘못되었습니다.');
    this.bootstrap();
    const sites=[...(this.atlas?.findBuildingSites?.(p[0],p[2],radius)||[])].sort((a,b)=>a.id.localeCompare(b.id));
    const retries=Math.min(16,Math.max(1,this.catalog.environments?.world?.placement?.maxCandidateRetries??16));
    for (const site of sites) {
      if(!this.templates.has(site.templateId)||this.rejectedSites.has(site.id)||this.instances.has(`structure:${this.seed}:${site.id}:${site.templateId}`))continue;
      let origin=null;
      for(let attempt=0;attempt<retries&&!origin;attempt++){
        const x=attempt?quantize(Math.floor(site.x/512)*512+64+(hash(`${this.seed}:${site.id}:x:${attempt}`)/4294967296)*384):site.x;
        const z=attempt?quantize(Math.floor(site.z/512)*512+64+(hash(`${this.seed}:${site.id}:z:${attempt}`)/4294967296)*384):site.z;
        origin=this._fitSite(site,x,z);
      }
      if(origin)this.ensureInstance(site.templateId,site.id,origin,site.tier??null,{variant:site.variant??null});
      else this.rejectedSites.add(site.id);
    }
    return this.instancesNear(p, radius);
  }
  instancesNear(position, radius = 384) {
    const p=point(position);if(!validPoint(p)||!finite(radius)||radius<0)return [];
    const minX=Math.floor((p[0]-radius)/256),maxX=Math.floor((p[0]+radius)/256),minZ=Math.floor((p[2]-radius)/256),maxZ=Math.floor((p[2]+radius)/256),key=`${minX},${maxX},${minZ},${maxZ}`;
    let candidates=this.nearCandidates.get(key);if(!candidates){const ids=new Set();for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++)for(const id of this.instanceBuckets.get(`${x},${z}`)||[])ids.add(id);candidates=[...ids].sort().map(id=>this.instances.get(id));if(this.nearCandidates.size>=128)this.nearCandidates.delete(this.nearCandidates.keys().next().value);this.nearCandidates.set(key,candidates);}
    const result=[],r2=radius*radius;for(const i of candidates){const b=this._queryBounds(i),dx=Math.max(b.minX-p[0],0,p[0]-b.maxX),dz=Math.max(b.minZ-p[2],0,p[2]-b.maxZ);if(dx*dx+dz*dz<=r2)result.push(i);}return result;
  }
  instancesInChunk(cx, cz, chunkSize = 16) {
    if (![cx,cz,chunkSize].every(finite) || chunkSize<=0) return [];
    const minX=cx*chunkSize,minZ=cz*chunkSize;
    return this.instancesNear([minX+chunkSize/2,0,minZ+chunkSize/2],chunkSize).filter(i=>{const b=this._bounds(i);return b.minX<minX+chunkSize&&b.maxX>minX&&b.minZ<minZ+chunkSize&&b.maxZ>minZ;});
  }
  get(id) { return this.instances.get(id) || null; }
  definition(id) { const instance = this.get(id); return instance ? this.templates.get(instance.templateId) : null; }
  worldPosition(id, local) { const i=this.get(id);if(!i)throw Error('없는 건축물 인스턴스입니다.');return add(i.origin,point(local)); }
  roomAt(id, position) {
    const i=this.get(id),p=point(position);if(!i||!validPoint(p))return null;
    const local=sub(p,i.origin);return this.definition(id).rooms.find(r=>inside(local,r.minM,r.maxM))||null;
  }
  enter(id, position) {
    const i=this.get(id),r=this.roomAt(id,position);if(!i||!r)return {ok:false,reason:'outside_room'};
    const first=!i.visitedRooms.includes(r.id);if(first){i.visitedRooms.push(r.id);i.revision++;this.events.push({type:'room_entered',instanceId:id,roomId:r.id});}i.discovered=true;
    return {ok:true,first,roomId:r.id,name:r.name,bossInstanceId:r.id===this.definition(id).bossArena?.roomId?i.boss?.instanceId:null};
  }
  anchors(id) {
    const i=this.get(id),d=this.definition(id);if(!i)return [];
    const result=[],append=(kind,a,position,extra={})=>result.push({id:`${kind}:${a.id}`,kind,instanceId:id,localId:a.id,position:add(i.origin,position),...extra});
    for(const a of d.entrances)append('entrance',a,a.positionM,{roomId:a.roomId,name:'출입구'});
    for(const a of this._rewardAnchors(i))append('reward',a,a.positionM,{roomId:a.roomId,name:{salvage:'물자 보관함',archive:'연구 기록',boss:'보스 보상'}[a.channel],channel:a.channel,claimed:!!i.claims[a.channel]});
    if(d.puzzle){
      const components=d.puzzle.componentAnchors??[];
      if(components.length)for(const a of components)append('puzzle',{id:`${d.puzzle.id}:${a.id}`},a.positionM,{name:d.puzzle.name,phase:i.puzzle.phase,componentAnchorId:a.id});
      else append('puzzle',d.puzzle,d.rooms.find(r=>r.id===d.puzzle.roomId).centerM,{name:d.puzzle.name,phase:i.puzzle.phase});
    }
    if(i.archiveChallenge)for(const roomId of ['room_1','room_2']){const room=d.rooms.find(r=>r.id===roomId);append('inspect',{id:roomId},room.centerM,{roomId,name:roomId==='room_1'?'기록의 배열 관찰':'장치의 연결 관찰',observed:i.archiveChallenge.observed.includes(roomId)});}
    for(const a of d.serviceAnchors||[])append('service',a,a.positionM,{name:a.id,serviceId:a.id});
    for(const a of d.ecology?.producers||[])append('producer',a,d.rooms.find(r=>r.id===a.roomId).centerM,{roomId:a.roomId,destroyed:i.producerStates[a.id]?.destroyed||false});
    for(const room of d.rooms)for(const a of room.spawnGroups||[])append('spawn',a,a.anchorM,{roomId:room.id,speciesId:a.speciesId,initialCount:a.initialCount,maxCount:a.maxCount});
    if(d.bossArena)append('boss',{id:i.boss.instanceId},d.bossArena.bossSpawnM,{bossId:i.boss.definitionId,bossInstanceId:i.boss.instanceId,defeated:i.boss.defeated,tier:i.boss.tier,contentVariantId:i.boss.contentVariantId??null});
    for(const a of d.bossArena?.gimmickSlots||[])append('gimmick',a,a.positionM,{gimmickId:a.gimmickId,bossInstanceId:i.boss.instanceId});
    return result;
  }
  nearbyAnchors(position, radius = 3) { const p=point(position);return this.instancesNear(p,radius).flatMap(i=>this.anchors(i.id)).filter(a=>dist(a.position,p)<=radius).sort((a,b)=>dist(a.position,p)-dist(b.position,p)); }
  interact(id, anchorId, { position, progression, maxDistance = 3, services = null } = {}) {
    const instance=this.get(id);if(!instance)return {ok:false,reason:'unknown_instance'};
    const anchor=this.anchors(id).find(a=>a.id===anchorId||a.localId===anchorId);if(!anchor)return {ok:false,reason:'unknown_anchor'};
    const p=point(position);if(!validPoint(p)||!finite(maxDistance)||maxDistance<0||dist(p,anchor.position)>maxDistance)return {ok:false,reason:'out_of_range'};
    instance.discovered=true;
    if(anchor.kind==='reward')return this.claimReward(id,anchor.channel,progression);
    if(anchor.kind==='inspect'){if(!instance.archiveChallenge.observed.includes(anchor.roomId)){instance.archiveChallenge.observed.push(anchor.roomId);instance.revision++;}return {ok:true,kind:'inspect',solved:instance.archiveChallenge.observed.length===2,observed:[...instance.archiveChallenge.observed]};}
    if(anchor.kind==='puzzle')return this.operatePuzzle(id,progression);
    if(anchor.kind==='entrance')return {ok:true,kind:'entrance',roomId:anchor.roomId};
    if(anchor.kind==='service'){const fn=services?.[anchor.serviceId];return fn?fn({instanceId:id,anchor,position:p}):{ok:true,kind:'service',serviceId:anchor.serviceId,instanceId:id};}
    return {ok:false,reason:'not_interactive',kind:anchor.kind};
  }
  operatePuzzle(id, progression) {
    const i=this.get(id);if(!i?.puzzle)return {ok:false,reason:'no_puzzle'};
    return {ok:true,kind:'device',instanceId:id,phase:i.puzzle.phase,status:this.devices.status(id,{progression})};
  }
  update(dt, context={}) {
    if(!finite(dt)||dt<0)throw Error('던전 시간은 0 이상의 초여야 합니다.');this.time+=dt;
    this.devices.update(dt,context);
    // Only a previously paid timer from a legacy save can finish this way.
    // New puzzles always require their physical device state and paid power.
    for(const i of this.instances.values()){
      const s=i.deviceState;if(!s?.work.legacyPaid||s.legacySolved)continue;
      s.work.legacyProgressS=Math.min(i.puzzle.durationS,s.work.legacyProgressS+dt);i.puzzle.elapsedS=s.work.legacyProgressS;i.revision++;
      if(s.work.legacyProgressS>=i.puzzle.durationS){s.legacySolved=true;s.solved=true;s.work.active=false;if(s.structureParts?.puzzle_gate)s.structureParts.puzzle_gate.installed=false;i.puzzle.phase='open';this.events.push({type:'puzzle_opened',instanceId:i.id});}
    }
  }
  defeatBoss(id, bossInstanceId, rewardOverride=null) {
    const i=this.get(id);if(!i?.boss||i.boss.instanceId!==bossInstanceId)return {ok:false,reason:'wrong_boss'};
    if(i.boss.defeated)return {ok:true,duplicate:true};
    const variant=this.bossVariants.get(i.boss.contentVariantId);
    if(rewardOverride&&(!variant||JSON.stringify(rewardOverride)!==JSON.stringify(variant.rewardOverride)))return {ok:false,reason:'invalid_boss_reward'};
    if(variant)i.boss.rewardOverride=clone(variant.rewardOverride);
    i.boss.defeated=true;i.revision++;this.events.push({type:'boss_defeated',instanceId:id,bossInstanceId});return {ok:true};
  }
  _rewardAnchors(instance) {
    const d=this.templates.get(instance.templateId);
    if(d.rewardAnchors)return d.rewardAnchors;
    if(instance.templateId!=='communal_archive')return [];
    const pools=[...this.rewards.values()].filter(p=>p.referenceTier<=Math.max(2,instance.tier)).sort((a,b)=>a.id.localeCompare(b.id));
    if(!pools.length)return [];
    const pool=pools[hash(`${this.seed}:${instance.siteId}:archive`)%pools.length],room=d.rooms.find(r=>r.id==='room_3');
    return [{id:'archive',roomId:room.id,positionM:room.centerM,rewardPoolId:pool.id,channel:'archive'}];
  }
  claimReward(id, channel, progression) {
    const i=this.get(id),d=this.definition(id);if(!i)return {ok:false,reason:'unknown_instance'};
    const anchor=this._rewardAnchors(i).find(a=>a.channel===channel);if(!anchor)return {ok:false,reason:'unknown_channel'};
    if(i.claims[channel])return {ok:true,duplicate:true};
    if(i.archiveChallenge&&i.archiveChallenge.observed.length<2)return {ok:false,reason:'archive_observations_required'};
    if(anchor.requiresActualBossDefeat&&!i.boss?.defeated)return {ok:false,reason:'boss_alive'};
    const payload=(channel==='boss'?i.boss?.rewardOverride:null)??this.rewards.get(anchor.rewardPoolId)?.channels?.[channel];if(!payload)return {ok:false,reason:'unknown_reward_pool'};
    if(!progression?.grantReward)return {ok:false,reason:'progression_required'};
    const claimId=`${id}:reward:${channel}`,receipt=progression.grantReward(clone(payload),{claimId});
    if(!receipt?.ok)return {ok:false,reason:receipt?.reason||'reward_rejected'};
    i.claims[channel]={claimId,time:this.time};i.revision++;this.events.push({type:'reward_claimed',instanceId:id,channel,claimId});return {...receipt,claimId,channel};
  }
  setAssetModel(templateId, asset) { if(!this.templates.has(templateId)||asset?.id!==templateId)throw Error('건물 에셋 ID가 다릅니다.');this.models.delete(templateId);if(!(this.assets instanceof Map))this.assets=new Map(Object.entries(this.assets||{}));this.assets.set(templateId,asset);for(const i of this.instances.values())if(i.templateId===templateId)this._indexInstance(i); }
  _sourceAsset(templateId) {
    if(typeof this.assets==='function')return this.assets(templateId);
    if(this.assets instanceof Map)return this.assets.get(templateId);
    if(Array.isArray(this.assets))return this.assets.find(a=>a.id===templateId);
    if(this.assets?.entries&&Array.isArray(this.assets.entries))return this.assets.entries.find(a=>a.id===templateId);
    return this.assets?.[templateId];
  }
  _model(templateId) {
    if(this.models.has(templateId))return this.models.get(templateId);
    const asset=this._sourceAsset(templateId);if(!asset?.parts||!asset?.materials)return null;
    const parts=new Map(asset.parts.map(p=>[p.id,p])),materials=new Map(asset.materials.map(m=>[m.id,m])),memo=new Map(),boxes=[];
    const offset=(id,trail=[])=>{if(memo.has(id))return memo.get(id);if(trail.includes(id))throw Error('부위 부모가 순환합니다.');const p=parts.get(id);if(!p)throw Error('부위 부모가 없습니다.');const o=add(p.parent===null?[0,0,0]:offset(p.parent,[...trail,id]),p.translation);memo.set(id,o);return o;};
    for(const p of asset.parts)for(const b of p.boxes){const m=materials.get(b.material);if(!m)throw Error('건물 재질이 없습니다.');boxes.push({...b,center:add(b.center,offset(p.id)),partId:p.id,role:p.role,materialId:m.id,blockId:m.blockId||null,color:m.color,opacity:m.opacity??1,collision:m.collision!==false&&m.id!=='visual_water'});}
    const index=new Map(),bucketSize=4;
    boxes.forEach((b,bi)=>{if(!b.collision)return;const a=boxBounds(b);for(let z=Math.floor(a.min[2]/bucketSize);z<=Math.floor((a.max[2]-1e-8)/bucketSize);z++)for(let y=Math.floor(a.min[1]/bucketSize);y<=Math.floor((a.max[1]-1e-8)/bucketSize);y++)for(let x=Math.floor(a.min[0]/bucketSize);x<=Math.floor((a.max[0]-1e-8)/bucketSize);x++){const key=`${x},${y},${z}`;if(!index.has(key))index.set(key,[]);index.get(key).push(bi);}});
    const solidBounds=boxes.map(boxBounds),collidable=solidBounds.filter((_,n)=>boxes[n].collision);const spatialBounds=collidable.length?{min:[0,1,2].map(k=>Math.min(...collidable.map(b=>b.min[k]))),max:[0,1,2].map(k=>Math.max(...collidable.map(b=>b.max[k])))}:null;
    const model={boxes,index,materials,bucketSize,solidBounds,spatialBounds};this.models.set(templateId,model);return model;
  }
  solidAt(position) {
    const world=point(position);if(!validPoint(world))return null;
    // Static building ownership already indexes its complete reserved footprint.
    // Broad-phase rejection only; a hit still requires the exact authored cuboid.
    const bucket=this.instanceBuckets.get(`${Math.floor(world[0]/256)},${Math.floor(world[2]/256)}`);if(!bucket)return null;
    for(const id of bucket){const instance=this.instances.get(id),bounds=this._queryBounds(instance);if(world[0]<bounds.minX||world[0]>=bounds.maxX||world[2]<bounds.minZ||world[2]>=bounds.maxZ)continue;
      const x=world[0]-instance.origin[0],y=world[1]-instance.origin[1],z=world[2]-instance.origin[2],cell=[Math.floor(x/GRID),Math.floor(y/GRID),Math.floor(z/GRID)],damage=instance.damage[cell.join(',')];
      const device=this.devices.geometry(id).find(box=>{if(!box.collision)return false;const b=boxBounds(box);return inside(world,b.min,b.max);});
      if(device)return {instanceId:id,templateId:instance.templateId,partId:device.partId,blockId:device.blockId??this.definition(id).blockAssignments.wall,materialId:device.materialId??device.material,cell,position:world,devicePart:true,hp:device.healthHp??100,maxHp:device.maxHealthHp??100};
      if(damage?.removed)continue;
      let hit=null;const model=this._model(instance.templateId);if(model)for(const index of model.index.get(`${Math.floor(x/model.bucketSize)},${Math.floor(y/model.bucketSize)},${Math.floor(z/model.bucketSize)}`)||[]){const b=model.solidBounds[index];if(x>=b.min[0]&&x<b.max[0]&&y>=b.min[1]&&y<b.max[1]&&z>=b.min[2]&&z<b.max[2]){hit=model.boxes[index];break;}}
      if(!hit)continue;const maxHp=this.blocks.get(hit.blockId)?.durabilityHpPerCell??24;return {instanceId:instance.id,templateId:instance.templateId,partId:hit.partId,blockId:hit.blockId,materialId:hit.materialId,cell,position:add(instance.origin,cellCenter(cell)),hp:damage?.hp??maxHp,maxHp};
    }return null;
  }
  hasAssetModel(templateId) { return !!this._model(templateId); }
  fluidAt(position) {
    const p=point(position);if(!validPoint(p))return null;
    for(const i of this.instancesNear(p,0)){
      for(const box of this.devices.geometry(i.id)){if(!box.liquidType)continue;const b=boxBounds(box);if(inside(p,b.min,b.max))return {type:box.liquidType,depth:b.max[1]-p[1],instanceId:i.id};}
      const water=this.definition(i.id).ecology?.water;if(!water||i.waterBreached)continue;
      const local=sub(p,i.origin),c=water.basinCenterM,s=water.basinSizeM,basin=i.deviceState?.ecologyBasin,depth=s[1]*(basin?basin.volumeLiters/basin.initialLiters:1);
      if(local[0]>=c[0]-s[0]/2&&local[0]<c[0]+s[0]/2&&local[2]>=c[2]-s[2]/2&&local[2]<c[2]+s[2]/2&&local[1]>=c[1]&&local[1]<c[1]+depth)return {type:water.liquid,depth:c[1]+depth-local[1],instanceId:i.id};
    }
    return null;
  }
  damageAt(position, amount) {
    if(!finite(amount)||amount<=0)return {ok:false,reason:'invalid_damage'};const hit=this.solidAt(position);if(!hit)return {ok:false,reason:'no_structure'};
    if(hit.devicePart){const result=this.devices.damage(hit.instanceId,hit.partId,amount);return {...hit,...result,hp:result.healthHp??hit.hp};}
    const i=this.get(hit.instanceId),key=cellKey(hit.cell),hp=Math.max(0,hit.hp-amount),removed=hp===0;
    i.damage[key]={hp,removed};i.revision++;
    if(removed){
      this.events.push({type:'structure_cell_destroyed',instanceId:i.id,cell:hit.cell,position:hit.position,blockId:hit.blockId,entityType:'object'});
      const local=sub(hit.position,i.origin),d=this.definition(i.id);
      for(const p of d.ecology?.producers||[]){const room=d.rooms.find(r=>r.id===p.roomId),[w,depth]=p.footprintM,center=room.centerM;if(Math.abs(local[0]-center[0])<=w/2&&Math.abs(local[2]-center[2])<=depth/2&&local[1]>=-.5&&local[1]<=2&&!i.producerStates[p.id].destroyed){i.producerStates[p.id].destroyed=true;this.events.push({type:'producer_destroyed',instanceId:i.id,producerId:p.id});}}
      const water=d.ecology?.water;if(water){const c=water.basinCenterM,s=water.basinSizeM;if(local[0]>=c[0]-s[0]/2-GRID&&local[0]<=c[0]+s[0]/2+GRID&&local[2]>=c[2]-s[2]/2-GRID&&local[2]<=c[2]+s[2]/2+GRID&&local[1]<=0&&local[1]>=c[1]-GRID){i.waterBreached=true;this.devices.breachEcologyBasin(i.id);this.events.push({type:'water_basin_breached',instanceId:i.id,position:hit.position});}}
    }
    return {ok:true,...hit,hp,removed};
  }
  renderBoxes(id,{bounds=null,hideRoofs=false}={}) {
    const i=this.get(id);if(!i)return [];
    const source=this._model(i.templateId)?.boxes||[],removed=Object.entries(i.damage).filter(([,d])=>d.removed).map(([key])=>{const c=key.split(',').map(Number);return {min:c.map(v=>v*GRID),max:c.map(v=>(v+1)*GRID)};}),result=[];
    for(const box of source){
      if(hideRoofs&&box.role==='roof'||i.waterBreached&&box.materialId==='visual_water')continue;
      const original=boxBounds(box),worldBounds={min:add(original.min,i.origin),max:add(original.max,i.origin)};if(bounds&&!overlap(worldBounds,bounds))continue;
      let pieces=[box];for(const cell of removed)if(overlap(original,cell))pieces=pieces.flatMap(b=>subtractBox(b,cell));
      for(const p of pieces)result.push({...p,center:add(p.center,i.origin),ownerId:i.id,assetId:i.templateId});
    }
    for(const box of this.devices.geometry(id))if(!bounds||overlap(boxBounds(box),bounds))result.push({...box,assetId:i.templateId});
    return result;
  }
  drainEvents() { const result=this.events;this.events=[];return result; }
  serialize() { return {schemaVersion:VERSION,seed:this.seed,time:this.time,instances:[...this.instances.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(clone)}; }
}
