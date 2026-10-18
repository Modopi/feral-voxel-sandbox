// First signal (S2, docs/ARCHITECTURE.md §6): the frontier campaign as a module of the unified runtime.
// Regions are the frontier generator's islands (maps.js regionAt); campaign data and pure rules are the
// frontier's own (frontier/campaign.js, frontier/content.js) and positions inside a region are local metres.
// Survival is the runtime's (user decision): damage goes through runtime.hurt, recovery fills the runtime's
// HP and calories, and there is no experience, level or food buff. Frontier items map onto catalog items.
import {regionInfo, regionKey} from '../frontier/terrain.js';
import {CAMP, BIOMES, PROJECTS, CROPS, newJourney, ensureOutpost, campaignAction, validateCampaign, channels, surveySites} from '../frontier/campaign.js';
import {FACTIONS, GATHERABLES, CONTRACTS, resourceSites, relaySites, ruinDefinition, ensureContent, prepareAttack, attackHits, attackZones} from '../frontier/content.js';
import {relayAsset, ruinCoreAsset, guardianAsset, villageSignAsset, villagerAsset, campCrateAsset, mastAsset, lampAsset, beamAsset, facilityAsset, FACILITY_OFFSETS, cropAsset, resourceAsset, surveyMarkerAsset} from './signal-assets.js';
import {hash, clamp} from '../world.js';
import {regionAt, onRegion, REGION_STRIDE, FRONTIER_ITEMS as ITEM_MAP, RECORD_WORK} from './maps.js';

// Frontier items map onto catalog items (maps.js FRONTIER_ITEMS, shared with the save converter): research
// records (`knowledge`) are RECORD_WORK seconds of research work, ruin cores (`relic`) the campaign's own record.
export {ITEM_MAP, RECORD_WORK};
// What the frontier gave a new expedition (food 8, medicine 2, fiber 6, wood 8, stone 8, crystal 2), in catalog items.
export const START_SUPPLIES = Object.freeze({food:8,medicine:2,fiber:6,wood:8,stone:8,crystal:2});
const CROP_ASSETS = [0, 1, 2].map(cropAsset);
const EPS = 1e-9, near = (p, q, r = 12) => Math.hypot(p.x - q.x, p.z - q.z) <= r, clone = v => JSON.parse(JSON.stringify(v));

/** The frontier inventory contract (transaction/take/grant/count) over the runtime's progression. */
class SignalInventory {
 constructor(signal){this.signal=signal;}
 get progression(){return this.signal.runtime.progression;}
 _split(map){
  const items={};let work=0,cores=0;
  for(const [id,n] of Object.entries(map||{})){
   if(!(n>0))continue;
   if(id==='knowledge')work+=n*RECORD_WORK;else if(id==='relic')cores+=n;else if(ITEM_MAP[id])items[ITEM_MAP[id]]=(items[ITEM_MAP[id]]||0)+n;else return null;
  }
  return {items,work,cores};
 }
 count(id){return id==='knowledge'?Math.floor(this.progression.workCredits/RECORD_WORK+EPS):id==='relic'?this.signal.cores:ITEM_MAP[id]?this.progression.count(ITEM_MAP[id]):0;}
 /** Pays `cost` and gives `reward` together, or changes nothing. A full bag overflows as everywhere else. */
 transaction(cost,reward={},commit=false){
  const c=this._split(cost),r=this._split(reward),p=this.progression;
  if(!c||!r||!p.hasItems(c.items)||p.workCredits+EPS<c.work||this.signal.cores<c.cores)return false;
  if(!commit)return true;
  const delta={};
  for(const [id,n] of Object.entries(c.items))delta[id]=(delta[id]||0)-n;
  for(const [id,n] of Object.entries(r.items))delta[id]=(delta[id]||0)+n;
  if(Object.keys(delta).length&&!p.apply(delta,this.signal.runtime.id('signal')).ok)return false;
  p.workCredits=Math.max(0,p.workCredits+r.work-c.work);this.signal.cores+=r.cores-c.cores;
  return true;
 }
 take(id,n=1){return this.transaction({[id]:n},{},true);}
 grant(id,n=1){return this.transaction({},{[id]:n},true);}
}

export class FirstSignal {
 constructor(runtime,state=null){
  this.runtime=runtime;this.inventory=new SignalInventory(this);
  this.x=0;this.z=0;this.time=0;this.socialClock=0;this.reputation=[0,0,0];this.diplomacy=[0,0,0];this.allies=[];this.regions={};this.cores=0;
  this.log=['첫 신호 · 주변에서 보급품을 채집하고 여정에서 다음 목표를 확인하세요.'];this.journey=newJourney();
  this.hostileClock=0;this.supportClock=0;this.fieldClock=0;this._local={x:0,z:0,flying:false};this._infoKey=null;this._info=null;
  // revision counts every change a world thing shows; the descriptor list is rebuilt only when it moves.
  this.revision=0;this._descriptors=[];this._descRevision=-1;this._guardian=null;this._crops=[];
  // A new expedition receives the frontier's starting supplies on its first step; a loaded or converted one already has its own.
  this.supplied=!!state;
  if(state)this._load(state);
  const r=regionAt(runtime.player.x,runtime.player.z);if(r&&!state){this.x=r.rx;this.z=r.rz;}
  this.ensureRegion();
 }
 // Campaign rules (frontier/campaign.js) read these names; survival maps onto the runtime player.
 get key(){if(this._kx!==this.x||this._kz!==this.z){this._key=regionKey(this.x,this.z);this._kx=this.x;this._kz=this.z;}return this._key;}
 /** This region's placement (frontier regionInfo), cached per region: callers read it, never change it. */
 get info(){
  const key=this.key,version=this.regions[key]?.terrainVersion??3;
  if(this._infoKey!==key||this._info.terrainVersion!==version){this._info=Object.freeze({...regionInfo(Number(this.runtime.seed),this.x,this.z),terrainVersion:version});this._infoKey=key;}
  return this._info;
 }
 get region(){return this.regions[this.key];}
 get activeBoss(){const run=this.region.outpost.sortie;return run?.kind==='hunt'?run.boss:this.region.boss;}
 get hp(){return this.runtime.player.hp;}
 set hp(v){const p=this.runtime.player;p.hp=clamp(v,0,p.maxHp);}
 get maxHP(){return this.runtime.player.maxHp;}
 get hunger(){const p=this.runtime.player;return 100*p.calories/p.maxCalories;}
 set hunger(v){const p=this.runtime.player;p.calories=p.maxCalories*clamp(v,0,100)/100;}
 get xp(){return 0;}
 set xp(_){}
 /** Damage from the campaign world, reduced by worn armour like a creature's bite. */
 hurt(amount,source){this.runtime.hurt(amount*(1-this.runtime.progression.evaluateLoadout().damageReduction),source);}
 note(text){this.log.unshift(text);this.log.length=Math.min(12,this.log.length);this.runtime.message(text);}
 /** The player in the current region's local metres. */
 localPlayer(out={}){
  const p=this.runtime.player;
  out.x=p.x-this.x*REGION_STRIDE;out.z=p.z-this.z*REGION_STRIDE;out.flying=p.y-this.runtime.atlas.heightAt(p.x,p.z)>2;return out;
 }
 /** A region-local point in world metres. */
 world(point){return {...point,x:point.x+this.x*REGION_STRIDE,z:point.z+this.z*REGION_STRIDE};}
 ensureRegion(){
  const i=this.info;
  if(!this.regions[i.key])this.regions[i.key]={visited:true,terrainVersion:this.runtime.atlas.regionTerrain?.get(i.key)??3,discovered:[],dungeon:0,cacheClaimed:false,
   boss:{hp:100*i.tier,maxHP:100*i.tier,defeated:false,phase:0,warning:0,cooldown:2,x:i.boss.x,z:i.boss.z,aimX:0,aimZ:0},
   villages:i.villages.map(v=>({...v,food:24,wood:18,stone:24,crystal:10,tech:0,population:6,aid:0,raidAt:-999}))};
  ensureContent(this.region);ensureOutpost(this.region);
  return this.region;
 }

 tick(dt){
  if(!Number.isFinite(dt)||dt<=0)return;
  if(!this.supplied){this.supplied=true;this.inventory.transaction({},START_SUPPLIES,true);}
  dt=Math.min(dt,.25);this.time+=dt;this.socialClock+=dt;
  // Travel by any means (the travel button, a machine across the strait) arrives in the region below.
  // No allocation on this per-step path (docs/ARCHITECTURE.md §7) except when something happens.
  const p=this.runtime.player,on=onRegion(p.x,p.z);
  if(on){const rx=Math.floor(p.x/REGION_STRIDE),rz=Math.floor(p.z/REGION_STRIDE);if(rx!==this.x||rz!==this.z){this.x=rx;this.z=rz;this.ensureRegion();this.revision++;this.note(`${this.info.name} 도착`);}}
  while(this.socialClock>=30){this.socialClock-=30;this.socialStep();}
  if(!on)return;
  const local=this.localPlayer(this._local),region=this.region,info=this.info;this.discover(local);
  if((this.hostileClock+=dt)>=2){
   this.hostileClock=0;
   for(const v of region.villages)if(this.reputation[v.faction]<=-20&&near(local,v,10)){this.hurt(8,'village_guard');break;}
  }
  const b=this.activeBoss,d=Math.hypot(local.x-b.x,local.z-b.z);
  if(!b.defeated&&d<26){
   if(b.warning>0){
    b.warning-=dt;
    if(b.warning<=0){
     if(attackHits(b,local))this.hurt(16+info.tier*5,'guardian');
     if(b.pattern==='charge'){b.x=b.aimX;b.z=b.aimZ;}
     b.cooldown=b.hp<b.maxHP*.4?1.3:1.8;b.phase++;
    }
   }else if((b.cooldown-=dt)<=0)prepareAttack(b,info.biome,local);
   else if(d>4){b.x+=(local.x-b.x)/d*dt*1.2;b.z+=(local.z-b.z)/d*dt*1.2;}
   if(this.allies.length&&(this.supportClock+=dt)>3){this.supportClock=0;this.hitGuardian(4*this.allies.length);}
  }else b.warning=0;
  // Ruins are opened by their three relays; standing in the live field hurts, waiting alone does not solve it.
  if(!region.cacheClaimed&&region.dungeon<3&&near(local,info.dungeon,5)){if((this.fieldClock+=dt)>=.5){this.fieldClock-=.5;this.hurt(.6,'ruin_field');}}
  else this.fieldClock=0;
 }
 socialStep(){
  // All visited communities advance with one coarse 30-second tick, including distant ones.
  for(const region of Object.values(this.regions)){
   for(const v of region.villages){
    v.food=clamp(v.food+3+v.tech-Math.ceil(v.population/3),0,80);v.wood=Math.min(80,v.wood+1+v.tech);v.stone=Math.min(80,v.stone+2);v.crystal=Math.min(40,v.crystal+(v.tech>=1?1:0));
    if(!v.food)v.population=Math.max(3,v.population-1);else if(v.food>40)v.population=Math.min(10,v.population+1);
    if(v.tech<1&&v.wood>=50&&v.stone>=50){v.wood-=25;v.stone-=25;v.tech=1;}
   }
   const [a,b]=region.villages,pair=[[0,1],[1,2],[0,2]].findIndex(pair=>pair.includes(a.faction)&&pair.includes(b.faction));
   if(this.diplomacy[pair]<=-20){a.food=Math.max(0,a.food-3);b.wood=Math.max(0,b.wood-3);}
   else if(a.food>b.food+8){a.food-=2;b.food+=2;}
  }
  if(Math.floor(this.time/30)%4===0){
   const pair=Math.floor(hash(Math.floor(this.time/120),0,Number(this.runtime.seed))*3);
   this.diplomacy[pair]=clamp(this.diplomacy[pair]+(hash(pair,Math.floor(this.time),Number(this.runtime.seed))>.5?4:-4),-40,40);
  }
 }
 discover(local){
  const r=this.region,info=this.info;
  for(const v of r.villages)this._find(local,v.id,v,v.name);
  this._find(local,'ruin',info.dungeon,'옛 동력 유적');this._find(local,'boss',info.boss,'수호자 둥지');
 }
 _find(local,id,place,name){
  const r=this.region;
  if(near(local,place,15)&&!r.discovered.includes(id)){r.discovered.push(id);this.inventory.grant('knowledge',2);this.note(`${name} 발견 · 연구 작업 +${2*RECORD_WORK}초`);}
 }

 /** Camp, journey and sortie commands (frontier/campaign.js) at the player's position. */
 campaign(action,arg){
  const p=this.localPlayer(),o=this.region.outpost;
  if(action==='rest'){
   if(!near(p,CAMP))return '야영지 12m 안에서 진행하세요.';
   if(!o.projects.includes('kitchen'))return '야영 취사장이 필요합니다.';
   if(!this.inventory.take('food',1))return '식량 1개가 필요합니다.';
   this.hp=this.maxHP;this.hunger=100;return '완전 회복 · 체력과 식량이 가득 찼습니다.';
  }
  if(action==='repair'){
   if(!near(p,CAMP))return '야영지 12m 안에서 진행하세요.';
   if(!o.projects.includes('workshop'))return '공동 정비소가 필요합니다.';
   const g=this.runtime.progression,tools=Object.keys(g.toolWear).filter(id=>g.count(id)>0&&g.toolWear[id]<(g.catalog.get(id)?.durabilityActions||0)),weapons=this.runtime.armaments.weapons.filter(w=>w.durability<w.maxDurability);
   if(!tools.length&&!weapons.length)return '정비할 손상 장비가 없습니다.';
   if(!this.inventory.transaction({iron:1,wood:1},{},true))return '정비에는 잡철 1·미가공 목재 1이 필요합니다.';
   for(const id of tools)g.toolWear[id]=Math.min(g.catalog.get(id).durabilityActions,g.toolWear[id]+60);
   for(const w of weapons)w.durability=Math.min(w.maxDurability,w.durability+60);
   return '모든 소지 장비 내구도 +60';
  }
  const result=campaignAction(this,action,arg,p,this.inventory);this.revision++;return result;
 }
 village(id,action){
  this.revision++;
  const v=this.region.villages.find(v=>v.id===id),p=this.localPlayer(),inv=this.inventory;
  if(!v||!near(v,p))return '마을 12m 이내로 접근하세요.';
  const f=v.faction,hostile=this.reputation[f]<=-20;
  if(action==='peace'){
   if(!inv.transaction({food:6,iron:2},{},true))return '화해에는 식량 6 · 합금 2가 필요합니다.';
   this.reputation[f]=Math.max(0,this.reputation[f]);this.note(`${FACTIONS[f]}과 화해했습니다.`);return '화해 완료';
  }
  if(hostile&&action!=='raid')return '적대 중입니다. 보급품으로 화해를 제안하세요.';
  if(action==='trade'){
   if(v.crystal<2||v.food<2)return '마을 재고가 부족합니다. 생산을 기다리세요.';
   if(!inv.transaction({wood:4},{crystal:2,food:2},true))return '원목 4개가 필요합니다.';
   v.wood=Math.min(80,v.wood+4);v.crystal-=2;v.food-=2;this.reputation[f]=Math.min(100,this.reputation[f]+2);return '원목 4 → 결정 2 · 식량 2';
  }
  if(action==='quarry'){
   if(v.stone<12)return '채석 재고가 부족합니다. 마을 생산을 기다리세요.';
   if(!inv.transaction({food:2},{stone:8,sand:4},true))return '식량 2개가 필요합니다.';
   v.stone-=12;v.food=Math.min(80,v.food+2);return '식량 2 → 돌 8 · 모래 4';
  }
  if(action==='aid'){
   if(!inv.transaction({food:3,plank:4},{knowledge:2},true))return '식량 3 · 목재 4가 필요합니다.';
   v.food=Math.min(80,v.food+3);v.aid++;v.tech=Math.min(2,Math.floor(v.aid/2)+1);this.reputation[f]=Math.min(100,this.reputation[f]+12);
   this.note(`${v.name} 지원 · 기술 ${v.tech} · 평판 +12`);return `지원 완료 · 연구 작업 +${2*RECORD_WORK}초`;
  }
  if(action==='ally'){
   if(this.allies.includes(f))return '이미 동맹입니다.';
   if(this.reputation[f]<24)return '평판 24 이상이면 동맹을 맺을 수 있습니다.';
   this.allies.push(f);this.note(`${FACTIONS[f]} 동맹 · 근처 보스 전투 지원`);return '동맹 체결 · 보스 전투에 지원 사격이 도착합니다.';
  }
  if(action==='mediate'){
   if(!inv.transaction({knowledge:2},{},true))return `연구 작업 ${2*RECORD_WORK}초가 필요합니다.`;
   this.diplomacy=this.diplomacy.map(n=>Math.min(40,n+12));return '집단 간 중재 · 모든 관계 +12';
  }
  if(action==='raid'){
   if(this.time-v.raidAt<120)return '마을이 경계 중입니다. 120초 뒤 다시 시도하세요.';
   inv.transaction({},{food:Math.min(4,v.food),crystal:Math.min(3,v.crystal)},true);
   v.food=Math.max(0,v.food-4);v.crystal=Math.max(0,v.crystal-3);v.raidAt=this.time;
   this.reputation[f]=Math.max(-100,this.reputation[f]-35);this.allies=this.allies.filter(n=>n!==f);
   this.runtime.hurt(Math.min(25,this.hp-1),'village_guard');this.diplomacy=this.diplomacy.map(n=>Math.max(-40,n-8));
   this.note(`${v.name} 약탈 · 적대와 교역 중단`);return '약탈품 확보 · 체력 -25 · 평판 -35';
  }
  return '알 수 없는 행동';
 }
 deliver(villageId,contractId){
  const v=this.region.villages.find(v=>v.id===villageId),quest=CONTRACTS.find(q=>q.id===contractId);
  if(!v||!quest||!near(v,this.localPlayer()))return '마을 12m 안에서 의뢰를 전달하세요.';
  if(this.reputation[v.faction]<=-20)return '적대 중입니다. 먼저 화해하세요.';
  const key=`${v.id}/${quest.id}`;
  if(this.region.contracts.includes(key))return '이미 완료한 의뢰입니다.';
  if(!this.inventory.transaction(quest.cost,quest.reward,true))return '의뢰 재료를 확인하세요.';
  this.region.contracts.push(key);this.revision++;this.reputation[v.faction]=Math.min(100,this.reputation[v.faction]+8);
  this.note(`${v.name} · ${quest.name} 완료 · 평판 +8`);return `${quest.name} 완료 · 보상 수령 · 평판 +8`;
 }
 gather(id){
  const site=resourceSites(this.info).find(s=>s.id===id);
  if(!site||!near(site,this.localPlayer(),4))return '채집 대상 4m 안으로 접근하세요.';
  const def=GATHERABLES[site.kind],until=this.region.resources[id];
  if(until===-1)return '모두 회수한 자원입니다.';
  if(until>this.time)return `다시 자라기까지 ${Math.ceil(until-this.time)}초`;
  this.inventory.transaction({},def.reward,true);
  this.region.resources[id]=def.regrow?this.time+def.regrow:-1;this.revision++;
  return `${def.name} 채집`;
 }
 activateRelay(index){
  const site=relaySites(this.info)[index],r=this.region;
  if(!site||!near(site,this.localPlayer(),4))return '중계기 4m 안에서 사용하세요.';
  if(r.relays.includes(index))return '이미 해제한 중계기입니다.';
  r.relays.push(index);r.dungeon=Math.max(r.dungeon,r.relays.length);this.revision++;this.note(`${site.name} 해제 · ${r.relays.length}/3`);
  return r.relays.length===3?'방어장 해제 · 가운데 회전하는 핵을 사용해 보상을 회수하세요.':`중계기 ${r.relays.length}/3 해제 · 다른 중계기를 찾으세요.`;
 }
 claimRuin(){
  const r=this.region,ruin=ruinDefinition(this.info);
  if(!near(this.info.dungeon,this.localPlayer(),6))return '유적 중심 6m 이내로 접근하세요.';
  if(r.cacheClaimed)return '이미 회수한 유적입니다.';
  if(r.dungeon<3)return `중계기 ${r.relays.length}/3 해제 · 주변의 세 중계기를 조준하고 사용하세요.`;
  const reward={knowledge:6,crystal:4,iron:3,relic:1};for(const [id,n] of Object.entries(ruin.bonus))reward[id]=(reward[id]||0)+n;
  this.inventory.transaction({},reward,true);r.cacheClaimed=true;this.revision++;this.note(ruin.lore);this.note('유적 회수 · 유적 핵 +1');
  return '유적 회수 · 연구 작업·결정·합금·유적 핵 1과 보관소 물자';
 }
 /** A hit on the guardian (or a sortie's echo) of this region. */
 hitGuardian(amount){
  const b=this.activeBoss;
  if(b.defeated||!Number.isFinite(amount)||amount<=0)return false;
  b.hp=Math.max(0,b.hp-amount);
  if(!b.hp){
   b.defeated=true;b.warning=0;this.hp+=30;this.revision++;
   if(this.region.outpost.sortie?.kind==='hunt'){this.region.outpost.sortie.done=true;this.note('수호자 잔향 격파 · 야영지에서 원정 보상을 받으세요.');return true;}
   const t=this.info.tier;this.inventory.transaction({},{relic:t,knowledge:6*t,iron:5*t},true);this.note(`수호자 격파 · 유적 핵 +${t} · 연구와 합금 획득`);
  }
  return true;
 }
 study(type){
  if(![0,1,2].includes(type)||this.region.studies.includes(type))return false;
  this.region.studies.push(type);this.inventory.grant('knowledge',2);this.note(`생태 관찰 기록 · 연구 작업 +${2*RECORD_WORK}초`);return true;
 }
 /** The travel button: one food, from the camp or the shore, to the next region's camp without reloading. */
 travel(dx,dz){
  if(!Number.isInteger(dx)||!Number.isInteger(dz)||Math.abs(dx)+Math.abs(dz)!==1)return '인접한 지역만 이동할 수 있습니다.';
  const p=this.runtime.player,at=regionAt(p.x,p.z),local=this.localPlayer();
  if(!at)return '지역 섬 위에서 이동하세요.';
  if(Math.abs(this.x+dx)>10000||Math.abs(this.z+dz)>10000)return '지원하는 탐험 좌표 범위 끝입니다.';
  if(!near(local,CAMP)&&local.x>8&&local.z>8&&local.x<152&&local.z<152)return '야영지 또는 지역 가장자리에서 이동하세요.';
  if(!this.inventory.take('food',1))return '지역 이동에 식량 1개가 필요합니다.';
  if(this.runtime.drivingMachineId){this.runtime.machines.control(this.runtime.drivingMachineId,{throttle:0,steer:0,pitch:0,brake:true});this.runtime.drivingMachineId=null;}
  this.x+=dx;this.z+=dz;const camp=this.world(CAMP);
  Object.assign(p,{x:camp.x,y:this.runtime.atlas.heightAt(camp.x,camp.z)+.05,z:camp.z,vy:0});
  this.ensureRegion();this.revision++;this.note(`${this.info.name} 도착`);
  return `${this.info.name} 도착`;
 }

 /** A blow on something this module put in the world (runtime.strike, kind 'module'): only the guardian takes it. */
 strike(hit,amount){
  if(hit?.id!=='first-signal/guardian')return {ok:false,reason:'상호작용 버튼으로 사용하세요.'};
  if(this.activeBoss.defeated)return {ok:false,reason:'이미 쓰러진 수호자입니다.'};
  this.hitGuardian(amount);return {ok:true,damage:amount};
 }
 /** The guardian's attack zones while it winds up (frontier attackZones), in world metres; empty otherwise. */
 guardianZones(){
  const b=this.activeBoss;if(b.defeated||!(b.warning>0))return null;
  // One wind-up keeps its zones (aim and pattern are fixed until the blow), so they are made once per attack.
  if(this._zones?.phase!==b.phase||this._zones.key!==this.key||this._zones.boss!==b){
   const ox=this.x*REGION_STRIDE,oz=this.z*REGION_STRIDE,zones=attackZones(b);
   for(const zone of zones){zone.x+=ox;zone.z+=oz;}
   this._zones={phase:b.phase,key:this.key,boss:b,pattern:b.pattern,zones};
  }
  this._zones.warning=b.warning;return this._zones;
 }
 /** World things of the current region for the shared scene (runtime.descriptors): kind 'module', ids '<module>/<thing>'.
  * The list is rebuilt only when `revision` or the region changes; the guardian and crops update in place. */
 descriptors(){
  if(this._descRevision!==this.revision||this._descKey!==this.key)this._buildDescriptors();
  const g=this._guardian;
  if(g){const b=this.activeBoss,p=this.runtime.player;g.position.x=b.x+this.x*REGION_STRIDE;g.position.z=b.z+this.z*REGION_STRIDE;g.position.y=this.runtime.atlas.heightAt(g.position.x,g.position.z);g.yaw=Math.atan2(p.x-g.position.x,p.z-g.position.z);}
  const plots=this.region.outpost.plots;
  for(const c of this._crops){const plot=plots[c.index];if(!plot)continue;const left=(plot.ready-this.time)/CROPS[plot.crop].seconds;c.asset=CROP_ASSETS[left<=0?2:left<.5?1:0];}
  return this._descriptors;
 }
 _buildDescriptors(){
  const info=this.info,region=this.region,o=region.outpost,rows=[],at=this.runtime.atlas;
  const add=(thing,asset,local,extra={})=>{const x=local.x+this.x*REGION_STRIDE,z=local.z+this.z*REGION_STRIDE,row={id:`first-signal/${thing}`,assetId:asset.id,asset,kind:'module',position:{x,y:at.heightAt(x,z),z},yaw:extra.yaw??0,interactable:true,...extra};rows.push(row);return row;};
  add('camp',campCrateAsset(),CAMP);
  const mast={x:CAMP.x,z:CAMP.z-3},lit=channels(this);
  add('mast',mastAsset(),mast);
  BIOMES.forEach((_,i)=>{const row=add(`lamp:${i}`,lampAsset(i,lit.includes(i)),{x:mast.x+(i-1)*.85,z:mast.z});row.position.y+=4.4;});
  if(this.journey.completedAt!==null){const row=add('beam',beamAsset(),mast);row.position.y+=4.5;}
  for(const id of o.projects){const [dx,dz]=FACILITY_OFFSETS[id];add(`facility:${id}`,facilityAsset(id),{x:CAMP.x+dx,z:CAMP.z+dz});}
  this._crops=[];
  if(o.projects.includes('garden'))o.plots.forEach((plot,index)=>{if(!plot)return;const [dx,dz]=FACILITY_OFFSETS.garden,row=add(`crop:${index}`,CROP_ASSETS[0],{x:CAMP.x+dx,z:CAMP.z+dz+index*1.5},{index});row.position.y+=.2;this._crops.push(row);});
  if(o.sortie?.kind==='survey')for(const site of surveySites(info))add(`survey:${site.index}`,surveyMarkerAsset(o.sortie.visited.includes(site.index)),site,{index:site.index});
  relaySites(info).forEach((site,index)=>add(`relay:${index}`,relayAsset(region.relays.includes(index)),site,{index}));
  if(!region.cacheClaimed)add('ruin',ruinCoreAsset(region.dungeon>=3),info.dungeon);
  for(const site of resourceSites(info)){const until=region.resources[site.id];if(until===-1||until>this.time)continue;add(`resource:${site.id}`,resourceAsset(site.kind),site,{site:site.id});}
  for(const v of region.villages){
   add(`village:${v.id}`,villageSignAsset(v.faction),v,{village:v.id});
   for(let role=0;role<3;role++){const a=role*2.1+v.x*.13;add(`villager:${v.id}:${role}`,villagerAsset(v.faction,role),{x:v.x+Math.cos(a)*2.4,z:v.z+Math.sin(a)*2.4},{village:v.id,role,yaw:Math.atan2(Math.cos(a),Math.sin(a))});} // facing out to visitors
  }
  this._guardian=this.activeBoss.defeated?null:add('guardian',guardianAsset(info.biome),this.activeBoss);
  this._descriptors=rows;this._descRevision=this.revision;this._descKey=this.key;
 }

 serialize(){return clone({schema:1,x:this.x,z:this.z,time:this.time,socialClock:this.socialClock,reputation:this.reputation,diplomacy:this.diplomacy,allies:this.allies,regions:this.regions,log:this.log,journey:this.journey,cores:this.cores,supplied:this.supplied});}
 _load(data){
  const finite=(n,min=0)=>Number.isFinite(n)&&n>=min;
  if(!data||data.schema!==1||!Number.isInteger(data.x)||!Number.isInteger(data.z)||Math.abs(data.x)>10000||Math.abs(data.z)>10000)throw Error('첫 신호 저장 형식을 읽을 수 없습니다.');
  if(!finite(data.time)||!finite(data.socialClock)||!Number.isInteger(data.cores)||data.cores<0)throw Error('첫 신호 상태가 손상되었습니다.');
  for(const name of ['reputation','diplomacy'])if(!Array.isArray(data[name])||data[name].length!==3||data[name].some(n=>!Number.isFinite(n)||Math.abs(n)>100))throw Error('공동체 관계가 손상되었습니다.');
  if(!Array.isArray(data.allies)||data.allies.some(n=>![0,1,2].includes(n))||!Array.isArray(data.log)||data.log.some(n=>typeof n!=='string'))throw Error('원정 기록이 손상되었습니다.');
  if(!data.regions||typeof data.regions!=='object'||!data.regions[regionKey(data.x,data.z)])throw Error('지역 저장이 없습니다.');
  for(const [key,r] of Object.entries(data.regions)){
   if(!/^-?\d+,-?\d+$/.test(key)||!r||!Array.isArray(r.villages)||r.villages.length!==2||!Array.isArray(r.discovered)||r.discovered.some(n=>typeof n!=='string'))throw Error('지역 기록이 손상되었습니다.');
   if(!r.boss||!finite(r.boss.hp)||r.boss.hp>r.boss.maxHP||!['x','z','aimX','aimZ','cooldown','warning','maxHP','phase'].every(n=>Number.isFinite(r.boss[n]))||!finite(r.dungeon)||r.dungeon>3)throw Error('수호자 기록이 손상되었습니다.');
   for(const v of r.villages)if(!['x','z','food','wood','stone','crystal','tech','population','aid','raidAt'].every(n=>Number.isFinite(v[n]))||![0,1,2].includes(v.faction)||['food','wood','stone','crystal'].some(n=>v[n]<0||v[n]>80))throw Error('마을 상태가 손상되었습니다.');
   if(!Array.isArray(r.relays??[])||!Array.isArray(r.contracts??[])||!Array.isArray(r.studies??[])||(r.resources&&(typeof r.resources!=='object'||Array.isArray(r.resources)||Object.values(r.resources).some(n=>!Number.isFinite(n)||n<-1))))throw Error('탐사 콘텐츠 기록이 손상되었습니다.');
  }
  const clean=clone(data);
  for(const key of ['x','z','time','socialClock','reputation','diplomacy','allies','regions','log','cores'])this[key]=clean[key];
  this.journey=clean.journey||newJourney();this.supplied=clean.supplied!==false;
  for(const r of Object.values(this.regions)){
   ensureContent(r);ensureOutpost(r);r.terrainVersion??=3;
   // After migration each relay, observation and contract counts once (the frontier loader's rule).
   if(new Set(r.relays).size!==r.relays.length||r.relays.some(n=>![0,1,2].includes(n))||r.studies.some(n=>![0,1,2].includes(n))||new Set(r.studies).size!==r.studies.length
    ||r.contracts.some(n=>typeof n!=='string')||new Set(r.contracts).size!==r.contracts.length)throw Error('탐사 콘텐츠 기록이 손상되었습니다.');
   r.dungeon=Math.max(r.dungeon,r.relays.length);
  }
  validateCampaign(this);
 }
}
