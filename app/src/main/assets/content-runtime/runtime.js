import {CONTENT} from './catalog.generated.js';
import {ASSETS,loadAsset} from './assets.generated.js';
import {Progression} from './progression.js';
import {CreatureSystem} from './creatures.js';
import {DungeonSystem} from './dungeons.js';
import {BossSystem} from './bosses.js';
import {MachineSystem} from './machines.js';
import {getResourceDescriptors,isResourceAvailable} from './props.js';
import {WorldPlacements} from './placements.js';
import {CommunitySystem} from './community.js';
import {MaterialEffects,resolveSurfaceDamage,equipmentExposureProfile} from './material-effects.js';
import {WorldObjects} from './objects.js';
import {FaithSystem} from './faith.js';
import {Armaments} from './armaments.js';
import {reasonText} from './reasons.js';
import {mapFor,BUILD_BLOCKS,miningProfile,minedItem,TOOL_GEAR,BARE_GEAR} from './maps.js';
import {miningWorkFor,MINING_PERIOD_S} from '../equipment.js';
import {hitShapeFor,hitShapeForMode,shapeCut,IMPACT_REACH_M} from './creature-animation.js';
const clone = value => JSON.parse(JSON.stringify(value));
export const distance = (a,b) => Math.hypot(a.x-b.x,(a.y||0)-(b.y||0),a.z-b.z);
const asPoint = v => Array.isArray(v) ? {x:v[0],y:v[1],z:v[2]} : v;
const firstSentence = text => String(text||'').split(/(?<=[.。])\s/)[0].trim();
const SPECIES = new Map(CONTENT.creatures.entries.map(e=>[e.id,e]));
const BLOCKS = new Map(CONTENT.blocks.entries.map(e=>[e.id,e]));
const BOSS_ACTIONS = {repair:'수리',rest:'휴식',recharge:'재충전'};
export class ExpeditionRuntime {
 /** onProgress(step,done,total) reports loading steps; pause lets the screen repaint before synchronous construction. */
 static async create(seed,state=null,{onProgress=()=>{},pause=null,map='expedition',rules={},starter=true}={}){
  const assets=new Map(),total=CONTENT.structures.entries.length;let done=0;
  await Promise.all(CONTENT.structures.entries.map(async e=>{assets.set(e.id,await loadAsset(e.id));onProgress('assets',++done,total);}));
  onProgress('world',0,1);if(pause)await pause();
  const runtime=new ExpeditionRuntime(seed,state,assets,map,{rules,starter});
  onProgress('placements',0,1);if(pause)await pause();
  await runtime.placements.ready;runtime.placements.syncAccess(runtime.player);return runtime;
 }
 constructor(seed,state,assets,mapId='expedition',{rules={},starter=true}={}){
  this.calorieRule=CONTENT.progression.entries.find(e=>e.id==='calorie_baseline');
  // A map preset only picks terrain, rules, start and places; every system below is shared.
  // The world's own settings (kept by the launcher) override the preset's rules.
  const preset=mapFor(state?.map??mapId);this.map={...preset,rules:{...preset.rules,...rules}};
  this.seed=seed;this.time=state?.time||0;this.nextId=state?.nextId||1;
  this.atlas=new this.map.atlas(CONTENT,{seed,state:state?.atlas,maxActiveChunks:96});
  this.progression=new Progression(CONTENT,state?.progression||{});
  this.armaments=new Armaments(this.progression,state?.armaments||{});
  this.creatures=new CreatureSystem(CONTENT,{seed,state:state?.creatures,terrain:this.atlas});
  this.bosses=new BossSystem(CONTENT,state?.bosses);
  this.dungeons=new DungeonSystem({catalog:CONTENT,seed,state:state?.dungeons,atlas:this.atlas,assets,starterStructures:this.map.rules.structures!==false});
  const spawn=this.map.spawn;
  this.player=state?.player?clone(state.player):{x:spawn.x,y:this.atlas.heightAt(spawn.x,spawn.z)+.05,z:spawn.z,yaw:spawn.yaw,pitch:0,hp:100,maxHp:100,calories:this.calorieRule.capacity,maxCalories:this.calorieRule.capacity,vy:0,grounded:false,stance:'stand',lastDamageAt:-100,resting:false};
  this.deaths=clone(state?.deaths||[]);this.seenRegions=new Set(state?.seenRegions||[]);
  this.discoveredLandmarks=new Set(state?.discoveredLandmarks||[]);this.conversion=state?.conversion?clone(state.conversion):null;
  this.messages=[];this.warnings=[];this.events=[];this.playerPush=null;this.lastStrike=0;this.lastMine=-Infinity;this.populationClock=Infinity;
  this.terrain={unbounded:true,getCell:(x,y,z)=>this.isSolid(x*.5+.25,y*.5+.25,z*.5+.25)?1:0,
   isSolidCell:(x,y,z)=>this.isSolid(x*.5+.25,y*.5+.25,z*.5+.25),heightAt:(x,z,y)=>this.surfaceHeight(x,z,y),
   groundHeight:(x,z,y)=>this.surfaceHeight(x,z,y),fluidAt:(x,y,z)=>this.dungeons.fluidAt({x,y,z})??this.atlas.fluidAt(x,y,z),
   hasLineOfSight:(a,b)=>this.lineOfSight(a,b),canMove:(a,b)=>!this.isSolid(b.x,b.y+.5,b.z)};
  this.creatures.terrain=this.terrain;
  this.machines=new MachineSystem(CONTENT,this.progression,state?.machines||{},{terrain:this.terrain});
  this.placements=new WorldPlacements(CONTENT,this.progression,{atlas:this.atlas,dungeons:this.dungeons,state:state?.placements,externalOverlap:(box,options)=>this.physics?.externalOverlap(box,options)??false});
  this.materialEffects=new MaterialEffects(CONTENT,this.progression,state?.materialEffects||{},{machines:this.machines});
  this.objects=new WorldObjects(CONTENT,this.atlas,state?.objects);
  this.pendingDetach=new Set(state?.pendingDetach||[]);
  this.atlas.onCellDestroyed=cell=>this.pendingDetach.add(cell.join(','));
  this.atlas.isAnchoredCell=(x,y,z)=>{const p={x:x*.5+.25,y:y*.5+.25,z:z*.5+.25};return !!this.dungeons.solidAt(p)||!!this.placements.solidAt(p);};
  this.community=new CommunitySystem(this,state?.community||{});
  this.faith=new FaithSystem(this,state?.faith||{});
  // Terrain wounds are the mined fraction of a cell (frontier rule); saves before 0.14 stored remaining HP.
  this.terrainDamage=Object.fromEntries(Object.entries(clone(state?.terrainDamage||{})).map(([key,d])=>[key,d.hp==null?d:{blockId:d.blockId,damage:Math.min(.99,Math.max(0,1-d.hp/(BLOCKS.get(d.blockId)?.durabilityHpPerCell||1)))}]));
  this.equipmentExposureProfiles=new Map();
  this.nodes=[];this.nearbyStructures=[];
  // A converted original save brings its own items instead of the new-world kit.
  if(!state&&starter&&Object.keys(this.map.starter).length)this.progression.grant(this.map.starter,{claimId:`map-start:${this.map.id}`});
  this.refreshWorld();
 }
 id(prefix){return `${prefix}:${this.seed}:${this.nextId++}`;}
 message(text){this.messages.push(String(text));if(this.messages.length>30)this.messages.shift();}
 warn(text,seconds=1.5){this.warnings.push({text:String(text),until:this.time+Math.max(.8,seconds)});if(this.warnings.length>8)this.warnings.shift();}
 activeWarning(){this.warnings=this.warnings.filter(w=>w.until>this.time);return this.warnings.at(-1)??null;}
 /** Screen-relative direction for a world position, matching the player's yaw convention. */
 directionTo(position){
  const p=this.player,dx=position.x-p.x,dz=position.z-p.z,forward=-Math.sin(p.yaw)*dx-Math.cos(p.yaw)*dz,right=Math.cos(p.yaw)*dx-Math.sin(p.yaw)*dz;
  const angle=Math.atan2(right,forward)*180/Math.PI;return Math.abs(angle)<=45?'정면':Math.abs(angle)>=135?'뒤쪽':angle>0?'오른쪽':'왼쪽';
 }
 creatureWarning(event){
  const e=this.creatures.get(event.entityId);if(!e||e.dead||e.attack?.targetId!=='player'||distance(this.player,e)>30)return;
  this.warn(`${SPECIES.get(e.speciesId)?.name??'생명체'}: ${event.text??'공격 준비'} · ${this.directionTo(e)}`,event.duration);
 }
 bossEvent(event){
  const b=this.bosses.get(event.bossId);if(!b||distance(this.player,b.position)>90)return;
  const def=this.bosses.definitionFor(b),skill=id=>def.skills.find(s=>s.id===id);
  if(event.type==='phase'){const phase=this.bosses.phase(b);this.message(`${def.name} · ${phase.name} 단계`);}
  else if(event.type==='partBroken'){const part=def.parts.find(p=>p.id===event.partId);this.message(`${def.name}의 ${part?.name??'부위'} 파손${part?.onBreak?' · '+firstSentence(part.onBreak):''}`);}
  else if(event.type==='gimmick')this.message(`${event.action!=='damage'?'장치를 작동했습니다':['root_charge','mine_charge'].includes(b.cast?.skillId)?'수호자가 장치에 부딪혔습니다':'장치를 파괴했습니다'} · ${firstSentence(def.arena.gimmickEffect)}`);
  else if(event.type==='cast'&&b.cast?.targetOwnerId==='player')this.warn(`${def.name} · ${skill(event.skillId)?.name??'공격'} ${Number(event.windupS).toFixed(1)}초 · ${this.directionTo(b.position)}`,event.windupS);
  else if(event.type==='castCancelled')this.message(`${skill(event.skillId)?.name??'기술'} 취소 · 장치 효과`);
  else if(event.type==='action')this.message(event.action==='recharge'?`${def.name} 재충전 중 · 받는 피해가 늘어납니다.`:`${def.name} ${BOSS_ACTIONS[event.action]??event.action} 중 · 공격하면 멈춥니다.`);
  else if(event.type==='actionInterrupted')this.message(`${def.name}의 ${BOSS_ACTIONS[event.action]??'행동'}을 끊었습니다.`);
 }
 dungeonEvent(event){
  const name=this.dungeons.definition(event.instanceId)?.puzzle?.name;
  if(event.type==='puzzle_opened')this.message(`${name??'장치'}: 통로가 열렸습니다.`);
  else if(event.type==='producer_destroyed')this.message('생산 시설을 파괴했습니다. 이 던전의 개체가 더 늘지 않습니다.');
  else if(event.type==='water_basin_breached')this.message('저수조가 터져 물이 빠졌습니다.');
 }
 communityEvent(event){
  if(event.type==='community_contribution_completed')this.message(`보급 계약을 마쳤습니다. 누적 기여 ${event.contributions}회.`);
  else if(event.type==='community_repair_paused')this.message('주민 수리를 멈췄습니다. 주민과 함께 정비소 근처에서 다시 시작하세요.');
  else if(event.type==='community_repair_finished')this.message(event.ok?`주민 수리를 마쳤습니다. HP +${Math.round(event.restored??0)}`:`주민 수리를 끝내지 못했습니다. ${reasonText(event.reason)}`);
 }
 /** Arena gimmicks have no aim geometry, so a melee swing hits the one the player faces within reach. */
 gimmickTarget(hit,range=4){
  const p=this.player,eye={x:p.x,y:p.y+(p.bodyHeight??1.5)*.9,z:p.z},look={x:-Math.sin(p.yaw)*Math.cos(p.pitch),y:Math.sin(p.pitch),z:-Math.cos(p.yaw)*Math.cos(p.pitch)};
  let best=null;
  for(const a of this.dungeons.nearbyAnchors(p,3).filter(a=>a.kind==='gimmick')){
   const b=this.bosses.get(a.bossInstanceId),g=b?.gimmicks?.[a.gimmickId];if(!b||b.defeated||!g||g.broken||g.uses<=0)continue;
   const gd=this.bosses.definitionFor(b).arena.gimmicks.find(x=>x.id===a.gimmickId);if(!gd)continue;
   const origin=asPoint(b.arenaOrigin),point={x:origin.x+gd.positionM[0],y:origin.y+gd.positionM[1]+1,z:origin.z+gd.positionM[2]},d=distance(eye,point);
   if(d>Math.max(3,range)+1||d<1e-6)continue;
   const cos=((point.x-eye.x)*look.x+(point.y-eye.y)*look.y+(point.z-eye.z)*look.z)/d;if(cos<Math.cos(30*Math.PI/180))continue;
   if(hit&&Number.isFinite(hit.distance)&&hit.distance<d-1&&hit.kind!=='structure'&&hit.kind!=='terrain')continue;
   if(!best||d<best.distance)best={bossInstanceId:b.id,gimmickId:a.gimmickId,distance:d,hp:g.hp};
  }
  return best;
 }
 isSolid(x,y,z){return this.atlas.isSolidCell(Math.floor(x*2),Math.floor(y*2),Math.floor(z*2))||!!this.dungeons.solidAt({x,y,z})||!!this.placements?.solidAt({x,y,z})||this.bosses.isSolidAt(x,y,z);}
 surfaceHeight(x,z,nearY=this.atlas.heightAt(x,z)){
  const start=Math.floor((nearY+1.5)*2);
  for(let hy=start;hy>=start-16;hy--)if(this.isSolid(x,hy*.5+.25,z)&&!this.isSolid(x,hy*.5+.75,z))return (hy+1)*.5;
  return this.atlas.heightAt(x,z);
 }
 lineOfSight(a,b){const n=Math.ceil(distance(a,b)/.25);for(let i=1;i<n;i++){const t=i/n;if(this.isSolid(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t))return false;}return true;}
 refreshWorld(){
  const p=this.player;this.nearbyStructures=this.dungeons.ensureNear(p,220);
  const sample=this.atlas.sample(p.x,p.z);this.region=sample;
  this.nodes=this.atlas.harvestNodesAround(p.x,p.z,48);
  const cx=Math.floor(p.x/64),cz=Math.floor(p.z/64);
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
   const x=(cx+dx)*64+32,z=(cz+dz)*64+32,s=this.atlas.sample(x,z),regionId=`${cx+dx},${cz+dz}`;
   if(!this.map.region(x,z))continue;
   const nearSpawn=this.map.rules.survival&&Math.hypot(x-this.map.spawn.x,z-this.map.spawn.z)<96;
   this.creatures.ensureRegion(regionId,{environmentId:s.environmentId,x,z,tier:s.tier,safeBypass:s.safeBypass||s.hostileSpawnsAllowed===false||nearSpawn});this.seenRegions.add(regionId);
  }
  for(const inst of this.nearbyStructures){
   const template=CONTENT.structures.entries.find(e=>e.id===inst.templateId);
   if(!template)continue;const origin=inst.origin??inst.position;
   const pos=Array.isArray(origin)?{x:origin[0],y:origin[1],z:origin[2]}:origin;
   if(pos&&distance(p,pos)<160){
    this.creatures.ensureDungeon(inst.id,{structureId:inst.templateId,...pos,tier:inst.tier});
    const bossAnchor=this.dungeons.anchors(inst.id).find(a=>a.kind==='boss');
    if(bossAnchor&&!bossAnchor.defeated&&!this.bosses.get(bossAnchor.bossInstanceId)){
     const center=template.rooms.find(r=>r.id===template.bossArena.roomId).centerM;
     const arenaOrigin={x:pos.x+center[0],y:pos.y+center[1],z:pos.z+center[2]};
     this.bosses.spawn(bossAnchor.bossId,bossAnchor.position,{id:bossAnchor.bossInstanceId,instanceId:inst.id,tier:bossAnchor.tier??inst.tier,contentVariantId:bossAnchor.contentVariantId??null,arenaOrigin});
    }
   }
   const entered=this.dungeons.enter(inst.id,p);if(entered.first)this.message(entered.name);
   this.community.ensureCommunity(inst.id);
  }
 }
 tick(dt,{manual=false,moving=false,manualDeviceId=null}={}){
  if(!Number.isFinite(dt)||dt<=0||dt>.25)return;
  this.time+=dt;this.populationClock+=dt;
  if(this.populationClock>=2){this.populationClock=0;this.refreshWorld();}
  this.placements.syncAccess(this.player);
  this.progression.tick(dt,{researching:true,manual});this.dungeons.update(dt,{progression:this.progression,manualInstanceId:manualDeviceId,position:this.player});this.atlas.tick?.(dt);this.machines.tick(dt);this.materialEffects.tick(dt);this.community.tick(dt);for(const event of this.community.drainEvents())this.communityEvent(event);
  if(this.pendingDetach.size){const key=this.pendingDetach.values().next().value;this.pendingDetach.delete(key);this.objects.detachAround(key.split(',').map(Number));}
  for(const event of this.dungeons.drainEvents()){
   if(event.type==='producer_destroyed')this.creatures.setProducerState(event.instanceId,event.producerId,{enabled:false});
   if(event.type==='water_basin_breached')this.creatures.setWater(event.instanceId,0);
   this.dungeonEvent(event);
  }
  const loadout=this.progression.evaluateLoadout(),p=this.player;p.maxHp=loadout.maxHp;p.hp=Math.min(p.hp,p.maxHp);
  const rule=this.calorieRule;
  // Peaceful maps (the basic island) keep food and health full; the rules are otherwise the same.
  if(!this.map.rules.survival){p.calories=p.maxCalories;p.hp=p.maxHp;}
  p.calories=Math.max(0,p.calories-dt*(!this.map.rules.survival?0:moving ? rule.activeDrainPerSecond : rule.idleDrainPerSecond));
  if(p.hp<p.maxHp&&p.calories>0&&(p.resting||this.time-p.lastDamageAt>=rule.noHitDelaySeconds)){
   const heal=Math.min(p.maxHp-p.hp,dt*rule.hpRegenPerSecond*(p.resting?rule.restMultiplier:1),p.calories/rule.caloriesPerHp);p.hp+=heal;p.calories-=heal*rule.caloriesPerHp;
  }
  for(const event of this.creatures.tick(dt,{player:p,terrain:this.terrain,damagePlayer:amount=>this.hurt(amount*(1-loadout.damageReduction),'creature')})??[])if(event.type==='attack_telegraph')this.creatureWarning(event);
  const active=[...this.bosses.entities.values()].filter(e=>distance(p,e.position)<180).map(e=>e.id);
  const bossEvents=this.bosses.tick(dt,{activeIds:active,targets:[{id:'player',ownerId:'player',position:p,radius:.28,height:p.bodyHeight??1.5,armorReduction:loadout.damageReduction},...(this.physics?.machineTargets?.()??[])],terrain:this.terrain,
   damage:e=>{if(e.targetId==='player'){this.hurt(e.damage??e.amount??e.hpDamage,'boss');if(e.impulse&&!this.drivingMachineId)this.playerPush={x:e.impulse.x,z:e.impulse.z,remaining:.25};}else this.physics?.damageMachineTarget?.(e);},
   onDefeat:e=>{const b=this.bosses.get(e.bossId);if(b)this.dungeons.defeatBoss(b.instanceId,b.id,b.reward?.bossChannelOverride);this.message('수호자를 쓰러뜨렸습니다. 아레나 중앙의 빛나는 표식에서 보스 보상을 회수하세요.');}});
  for(const event of bossEvents??[])this.bossEvent(event);
  this.faith.tick(dt);
  this.armaments.tick(dt);
  if(this.playerPush){
   // Catalog counterplay: the wind pushes back at most 1 m (4 m/s for 0.25 s), never through solid cells.
   const step=Math.min(dt,this.playerPush.remaining),before={...p};p.x+=this.playerPush.x*4*step;p.z+=this.playerPush.z*4*step;this.playerPush.remaining-=step;
   if(this.physics)this.physics.movePlayer(before,p);else if(this.isSolid(p.x,p.y+.5,p.z))Object.assign(p,{x:before.x,z:before.z});
   if(this.playerPush.remaining<=1e-9||this.drivingMachineId)this.playerPush=null;
  }
  const environment=this.dungeons.devices?.sampleAt(p);
  if(environment){
   const heatDps=Math.max(0,(environment.heatC??20)-45)*.05;
   if(heatDps>0||environment.acidDps>0)this.hurt((heatDps+(environment.acidDps??0))*dt*(1-loadout.damageReduction),'dungeon_environment');
   if(!this.drivingMachineId){
    const before={...p},wind=environment.windVelocity??{},platform=p.grounded?environment.platformVelocity??{}:{};
    for(const k of ['x','y','z'])p[k]+=((wind[k]??0)+(platform[k]??0))*dt;
    if(this.physics)this.physics.movePlayer(before,p);else if(this.isSolid(p.x,p.y+.5,p.z))Object.assign(p,{x:before.x,y:before.y,z:before.z});
   }
  }
  if(this.interactionAction){const a=this.interactionAction;
   if(distance(p,a.position)>3){this.interactionAction=null;this.message('장치에서 멀어져 조작을 멈췄습니다.');}
   else if((a.elapsed+=dt)>=a.seconds){this.interactionAction=null;const result=this.bosses.interactGimmick(a.bossId,a.gimmickId,{actorPosition:p,progressS:a.elapsed});if(!result)this.message('장치를 조작하지 못했습니다.');}
  }
  for(const death of this.deaths)if(!death.recovered&&distance(p,death.position)<=10){
   this.recoverDeath(death);
  }
  if(p.hp<=0)this.die();
 }
 hurt(amount,source){if(!Number.isFinite(amount)||amount<=0||!this.map.rules.survival)return;this.player.hp=Math.max(0,this.player.hp-amount);this.player.lastDamageAt=this.time;this.player.resting=false;this.events.push({type:'player_hit',amount,source});if(this.events.length>64)this.events.shift();}
 die(){
  const p=this.player,inventory=this.progression.inventory,overflow=this.progression.overflow,items={...inventory};
  if(this.drivingMachineId)this.machines.control(this.drivingMachineId,{throttle:0,steer:0,pitch:0,brake:true});
  for(const[id,n]of Object.entries(overflow))items[id]=(items[id]||0)+n;
  this.deaths.push({id:this.id('death'),position:{x:p.x,y:p.y,z:p.z},items,weapons:this.armaments.drainCarried(),recovered:false});
  this.progression.inventory={};this.progression.overflow={};this.progression.equipped=null;
  const spawn=this.map.spawn;
  Object.assign(p,{x:spawn.x,y:this.atlas.heightAt(spawn.x,spawn.z)+.05,z:spawn.z,hp:100,maxHp:100,calories:600,vy:0,lastDamageAt:this.time});
  this.interactionAction=null;this.drivingMachineId=null;this.player.resting=false;this.message('출발지에서 깨어났습니다. 사망 장소 10m 안에 가면 요정이 소지품을 돌려줍니다.');
 }
 recoverDeath(death){
  const items={},virtual={...this.progression.inventory};
  for(const[id,count]of Object.entries(death.items)){
   const slots=Object.values(virtual).reduce((n,v)=>n+Math.ceil(v/64),0),held=virtual[id]||0;
   const available=Math.max(0,(36-slots+Math.ceil(held/64))*64-held),take=Math.min(count,available);
   if(take>0){items[id]=take;virtual[id]=held+take;}
  }
  const recoveredWeapons=this.armaments.recoverCarried(death.weapons??[]);death.weapons=recoveredWeapons.remaining;
  const result=Object.keys(items).length?this.progression.grant(items,{claimId:this.id(death.id+':recover')}):{ok:false};
  if(result.ok)for(const[id,count]of Object.entries(items)){death.items[id]-=count;if(death.items[id]<=1e-8)delete death.items[id];}
  death.recovered=!Object.keys(death.items).length&&!death.weapons.length;
  const changed=result.ok||recoveredWeapons.acceptedIds.length>0;
  if(changed)this.message(death.recovered?'요정이 남겨 둔 소지품을 가져왔습니다.':'요정이 가방에 들어가는 소지품을 돌려줬습니다. 남은 물품은 현장에 보관합니다.');
  return changed;
 }
 /** Block a held item places on sandbox maps (the basic island), or null. */
 buildableBlock(itemId){return this.map.rules.sandbox?BUILD_BLOCKS[itemId]??null:null;}
 /** Place 0.5 m or 1 m of terrain on the aimed face, one unit of the item per 0.5 m cell. */
 placeBlocks(hit,itemId,size=.5){
  const blockId=this.buildableBlock(itemId);if(!blockId)return {ok:false,reason:'not_buildable'};
  if(!hit?.normal||!hit.point||hit.distance>6.5)return {ok:false,reason:'6.5 m 안의 표면을 조준하세요.'};
  const n=size>=1?2:1,face=['x','y','z'].map(k=>Math.floor((hit.point[k]+hit.normal[k]*.01)*2)),start=n===1?face:face.map(v=>Math.floor(v/2)*2),cells=[];
  for(let dy=0;dy<n;dy++)for(let dz=0;dz<n;dz++)for(let dx=0;dx<n;dx++)cells.push([start[0]+dx,start[1]+dy,start[2]+dz]);
  if(cells.some(c=>this.atlas.getCell(...c)!==null||this.dungeons.solidAt({x:c[0]*.5+.25,y:c[1]*.5+.25,z:c[2]*.5+.25})))return {ok:false,reason:'빈 공간을 조준하세요.'};
  const p=this.player,top=p.y+(p.bodyHeight??1.5);
  if(cells.some(([x,y,z])=>x*.5<p.x+.28&&x*.5+.5>p.x-.28&&z*.5<p.z+.28&&z*.5+.5>p.z-.28&&y*.5<top&&y*.5+.5>p.y))return {ok:false,reason:'캐릭터와 겹치는 곳에는 설치할 수 없습니다.'};
  if(this.progression.count(itemId)+1e-9<cells.length)return {ok:false,reason:`${this.progression.catalog.get(itemId)?.name??itemId} ${cells.length}개가 필요합니다.`};
  const paid=this.progression.spend({[itemId]:cells.length},{claimId:this.id('place-block')});if(!paid.ok)return paid;
  // Water or acid in a placed cell is pushed up above the new blocks instead of disappearing.
  let displaced=0,lost=0;const topY=(start[1]+n)*.5+.25;
  for(const [x,y,z]of cells){
   const at={x:x*.5+.25,y:y*.5+.25,z:z*.5+.25},f=this.atlas._fluidState(x,y,z);if(f.volumeM3<=1e-9)continue;
   const out=this.atlas.takeFluid(at.x,at.y,at.z,f.volumeM3);displaced+=out.volumeM3;let left=out.volumeM3;
   for(const lift of [0,.5,1]){if(left<=1e-9)break;left-=this.atlas.pour(at.x,topY+lift,at.z,left,{acidFraction:out.acidFraction,temperatureC:Math.max(20,out.temperatureC)});}
   lost+=Math.max(0,left);
  }
  for(const c of cells)this.atlas.setCell(...c,blockId);
  return {ok:true,blockId,cells:cells.length,displacedM3:displaced,lostM3:lost};
 }
 eat(id='food'){
  if(id!=='food')return {ok:false,reason:'먹을 수 있는 음식이 아닙니다.'};
  const result=this.progression.spend({[id]:1},{claimId:this.id('eat')});if(result.ok)this.player.calories=Math.min(this.player.maxCalories,this.player.calories+this.calorieRule.foodCalories);return result;
 }
 /** Gathering is immediate, like the frontier's: no channel time. */
 harvest(node){
  const position=node.position??{x:node.x,y:node.y??this.atlas.heightAt(node.x,node.z),z:node.z};
  if(distance(this.player,position)>5)return {ok:false,reason:'가까이 다가가세요.'};
  const sourceId=node.sourceId??node.progressionSourceId;
  if(!this.progression.catalog.has(sourceId))return {ok:false,reason:'채집 원천을 찾지 못했습니다.'};
  const source=this.progression.catalog.get(sourceId);
  if(source.requiredTool&&!this.progression.count(source.requiredTool))return {ok:false,reason:'tool_required'};
  if(!isResourceAvailable(this,{...node,...position,sourceId}))return {ok:false,reason:'source_depleted'};
  const result=this.progression.harvest(sourceId,{environmentId:this.atlas.sample(position.x,position.z).environmentId,nodeId:node.id,nodeType:node.nodeId,elapsed:source.seconds,claimId:this.id('harvest')});
  return result.ok?{...result,sourceId}:result;
 }
 beginGimmick(anchor){
  const boss=this.bosses.get(anchor?.bossInstanceId),g=boss?.gimmicks[anchor.gimmickId];
  if(!boss||boss.defeated||!g||g.broken||g.uses<=0||distance(this.player,anchor.position)>3)return {ok:false,reason:'지금은 이 장치를 조작할 수 없습니다.'};
  if(this.interactionAction?.anchorId===anchor.id)return {ok:true};
  const seconds=this.bosses.definitionFor(boss).arena.gimmickInteractionS;
  this.interactionAction={anchorId:anchor.id,bossId:boss.id,gimmickId:anchor.gimmickId,position:clone(anchor.position),elapsed:0,seconds};return {ok:true};
 }
 /** Attack: terrain and loose world pieces are mined (frontier rule), resources gathered, everything else hit. */
 strike(hit,{toolId=null,size=.5}={}){
  if(hit&&!this.gimmickTarget(hit,4)){
   if(hit.kind==='terrain')return this.mine(hit,{toolId,size});
   if(hit.kind==='object'&&!this.objects.get(hit.id)?.fragment)return this.mineObject(hit,{toolId});
  }
  const weapon=this.armaments.loadout(),loadout=weapon??this.progression.evaluateLoadout();if(this.time-this.lastStrike<loadout.attackPeriod)return {ok:false,reason:'공격 준비 중'};
  const gimmick=this.gimmickTarget(hit,weapon?.range??4);
  if(!gimmick){
   if(!hit||hit.distance>(weapon?.range??4))return {ok:false,reason:'대상이 멉니다.'};
   if(hit.kind==='resource'){const node=this.nodes.find(n=>n.id===hit.id);return node?this.harvest(node):{ok:false};}
  }
  if(weapon){const worn=this.armaments.recordAttack({distanceM:gimmick?gimmick.distance:hit.distance,at:this.time});if(!worn.ok)return worn;}
  if(gimmick){this.lastStrike=this.time;const ok=this.bosses.interactGimmick(gimmick.bossInstanceId,gimmick.gimmickId,{action:'damage',amount:loadout.hitDamage,actorPosition:this.player});return ok?{ok:true,gimmick:true,remainingHp:this.bosses.get(gimmick.bossInstanceId)?.gimmicks[gimmick.gimmickId]?.hp??0}:{ok:false,reason:'gimmick'};}
  this.lastStrike=this.time;this.lastAttackMode=weapon?.attackMode??'strike';
  return this.damageHit(hit,{amount:loadout.hitDamage,energyType:'mechanical',energyEU:loadout.hitDamage*1.5,attackMode:this.lastAttackMode,hitShape:hitShapeFor(weapon?.weaponKind)});
 }
 /** The frontier tool table entry for a held design tool; a broken or missing tool mines bare-handed. */
 miningGear(toolId){
  const gear=TOOL_GEAR[toolId],max=this.progression.catalog.get(toolId)?.durabilityActions;
  if(!gear||this.progression.count(toolId)<1||(max&&(this.progression.toolWear[toolId]??max)<=0&&this.progression.count(toolId)<2))return BARE_GEAR;
  return gear;
 }
 wearTool(toolId){
  const max=this.progression.catalog.get(toolId)?.durabilityActions;if(!TOOL_GEAR[toolId]||!max||this.progression.count(toolId)<1)return;
  if(this.progression.toolWear[toolId]===0&&this.progression.count(toolId)>=2){this.progression.spend({[toolId]:1},{claimId:this.id('tool-worn')});this.progression.toolWear[toolId]=max;}
  this.progression.toolWear[toolId]=Math.max(0,(this.progression.toolWear[toolId]??max)-1);
 }
 /** Frontier mining: every 0.18 s a strike removes 0.2 / work of each cell in the 0.5 m or 1 m region. */
 mine(hit,{toolId=null,size=.5}={}){
  if(!hit?.normal||!hit.point)return {ok:false,reason:'6.5 m 이내의 표면을 조준하세요.'};
  if(hit.distance>6.5)return {ok:false,reason:'6.5m 안에서 채굴하세요.'};
  if(this.time-this.lastMine<MINING_PERIOD_S)return {ok:false,reason:'공격 준비 중'};
  const n=size>=1?2:1,cell=['x','y','z'].map(k=>Math.floor((hit.point[k]-hit.normal[k]*.001)*2)),start=n===1?cell:cell.map(v=>Math.floor(v/2)*2);
  const gear=this.miningGear(toolId),edit=n*.5,removed=[];let struck=0,progress=0;
  for(let dy=0;dy<n;dy++)for(let dz=0;dz<n;dz++)for(let dx=0;dx<n;dx++){
   const c=[start[0]+dx,start[1]+dy,start[2]+dz],blockId=this.atlas.getCell(...c),profile=miningProfile(BLOCKS.get(blockId),BLOCKS);if(!profile)continue;
   const key=c.join(','),old=this.terrainDamage[key],damage=(old?.blockId===blockId?old.damage??0:0)+.2/miningWorkFor(profile.hardness,profile.affinity,edit,gear);struck++;
   if(damage>=1-1e-9){this.atlas.setCell(...c,null);delete this.terrainDamage[key];removed.push({cell:c,blockId});}
   else{this.terrainDamage[key]={blockId,damage};progress=Math.max(progress,damage);}
  }
  if(!struck)return {ok:false,reason:'채굴할 수 있는 지형을 조준하세요.'};
  this.lastMine=this.time;
  const items=this.minedItems(removed.map(r=>r.blockId));
  if(Object.keys(items).length){const r=this.progression.grant(items,{claimId:this.id('mine')});if(!r.ok)return r;}
  for(const r of removed)this.objects.detachAround(r.cell);
  if(removed.length&&toolId)this.wearTool(toolId);
  return {ok:true,mined:true,struck,removed:removed.length,items,progress,size:edit};
 }
 /** Items for mined cells; the frontier's bonus seed for clearing four grass cells at once. */
 minedItems(blockIds){
  const items={};for(const id of blockIds){const y=minedItem(BLOCKS.get(id));if(y)items[y.id]=(items[y.id]??0)+y.count;}
  if(blockIds.filter(id=>id==='grass').length>=4)items.seed=(items.seed??0)+1;
  return items;
 }
 /** Cutting a detached piece uses the same rule at 0.5 m; the rest of the piece stays a physical object. */
 mineObject(hit,{toolId=null}={}){
  if(!hit?.point||hit.distance>6.5)return {ok:false,reason:'6.5m 안에서 깎으세요.'};
  if(this.time-this.lastMine<MINING_PERIOD_S)return {ok:false,reason:'공격 준비 중'};
  const point={};for(const k of ['x','y','z'])point[k]=hit.point[k]-(hit.normal?.[k]||0)*.001;
  const cell=this.objects.cellAt(hit.id,point);if(!cell)return {ok:false,reason:'target_missing'};
  const block=BLOCKS.get(cell.blockId),profile=miningProfile(block,BLOCKS);if(!profile)return {ok:false,reason:'target_missing'};
  this.lastMine=this.time;
  const fraction=.2/miningWorkFor(profile.hardness,profile.affinity,.5,this.miningGear(toolId));
  const result=this.objects.damageAt(hit.id,point,fraction*block.durabilityHpPerCell,{progression:this.progression,yieldOf:minedItem});
  if(result.ok&&result.removed&&toolId)this.wearTool(toolId);
  return result.ok?{...result,mined:true,progress:result.removed?1:1-result.hp/block.durabilityHpPerCell}:result;
 }
 machineVoxelAt(hit){
  const m=this.machines.machines.get(hit.id);if(!m||!hit.point)return null;
  const q=m.rotation,v={};for(const k of ['x','y','z'])v[k]=hit.point[k]-(hit.normal?.[k]||0)*.001-m.position[k];
  const x=-q.x,y=-q.y,z=-q.z,w=q.w,tx=2*(y*v.z-z*v.y),ty=2*(z*v.x-x*v.z),tz=2*(x*v.y-y*v.x);
  const cell=[v.x+w*tx+y*tz-z*ty,v.y+w*ty+z*tx-x*tz,v.z+w*tz+x*ty-y*tx].map(n=>Math.floor(n/m.gridM));
  return m.voxels.find(voxel=>voxel.cell.every((n,i)=>n===cell[i]))??null;
 }
 fireMachine(hit){
  const machine=this.machines.machines.get(this.drivingMachineId);
  if(!machine)return {ok:false,reason:'기계를 조종해야 무장을 사용할 수 있습니다.'};
  const gun=machine.components.find(c=>c.id===this.machineWeaponId&&c.componentId==='arc_thrower')??machine.components.find(c=>c.componentId==='arc_thrower');
  if(!gun)return {ok:false,reason:'사용할 무장이 없습니다.'};
  if(!hit||hit.id===machine.id)return {ok:false,reason:'대상을 겨누세요.'};
  const result=this.machines.fire(machine.id,gun.id,{target:{id:hit.id??'terrain',kind:hit.kind,point:hit.point},claimId:this.id('machine-shot')});
  if(!result.ok||result.duplicate)return result;
  this.lastStrike=this.time;this.lastAttackMode=result.packet.attackMode;
  if(result.blocked||this.physics&&!this.physics.hasAttackLineOfSight(result.packet.rayOrigin,hit.point,{excludeOwnerId:machine.id,targetOwnerId:hit.id}))return {...result,blocked:true};
  return {...result,damage:this.damageHit({...hit,rayOrigin:result.packet.rayOrigin},result.packet)};
 }
 damageHit(hit,packet){
  let {amount,energyType}=packet;
  const attackMode=packet.attackMode??'strike';
  if(['creature','boss'].includes(hit.kind)&&this.physics?.traceCombat&&hit.point){
   const from=hit.rayOrigin??{x:this.player.x,y:this.player.y+(this.player.bodyHeight??1.5)*.9,z:this.player.z};
   const length=distance(from,hit.point),depth=attackMode==='pierce'?1.201:attackMode==='impact'?.601:.002;
   if(length<1e-6)return {ok:false,reason:'대상을 겨누세요.'};
   const to={};for(const k of ['x','y','z'])to[k]=hit.point[k]+(hit.point[k]-from[k])/length*depth;
   const trace=this.physics.traceCombat({from,to,ownerId:hit.id,excludeOwnerId:packet.sourceId??'player',mode:attackMode,energyEU:packet.energyEU,amount});
   if(trace.blocked||trace.effectiveAmount<=0)return {ok:false,reason:'대상이 다른 물체에 가려졌습니다.'};
   amount=trace.effectiveAmount;packet={...packet,amount,attackMode,structuralHits:trace.hits};
  }
  if(hit.kind==='creature'){
   // Frontier layered body; what is held decides how the blow lands (hitShapeFor). A point bite or a slash
   // wears the shell plating and reaches bone only where the cut meets it; a spear's line splits between the
   // shell and every bone it passes; a blunt blow leaves the shell closed and lands on the bone one cell in.
   // Bone already exposed by earlier wounds takes the blow directly.
   const shape=packet.hitShape??hitShapeForMode(attackMode),o=hit.rayOrigin,d=o&&hit.point?['x','y','z'].map(k=>hit.point[k]-o[k]):null,l=d?Math.hypot(...d)||1:1;
   const ahead=m=>({x:hit.point.x+d[0]/l*m,y:hit.point.y+d[1]/l*m,z:hit.point.z+d[2]/l*m});
   let structuralHits=[{partId:'shell',amount}];
   if(hit.layer==='bone')structuralHits=[{partId:hit.partId,amount}];
   else if(shape==='impact')structuralHits=[{partId:(d&&this.physics?.traceBones?.(hit.id,hit.point,ahead(IMPACT_REACH_M))?.[0]?.partId)||hit.partId,amount}];
   else{
    const local=d&&hit.partId?this.physics?.partLocalPoint?.(hit.id,hit.partId,hit.point):null,origin=local?this.physics.partLocalPoint(hit.id,hit.partId,o):null;
    const cut=local&&origin?shapeCut(shape,amount,local,local.map((v,i)=>v-origin[i])):null;
    if(cut){
     this.creatures.wound(hit.id,hit.partId,cut);
     if(shape==='pierce'){const bones=this.physics.traceBones?.(hit.id,hit.point,ahead(Math.max(...cut.slice(3))))??[];if(bones.length)structuralHits=[{partId:'shell',amount:amount*.3},...bones.map(b=>({partId:b.partId,amount:amount*.7/bones.length}))];}
     else if(this.physics.cutReachesBone?.(hit.id,hit.partId,cut))structuralHits=[{partId:'shell',amount:amount*.5},{partId:hit.partId,amount:amount*.5}];
    }else if(shape==='pierce'&&hit.partId)structuralHits=[{partId:'shell',amount:amount*.3},{partId:hit.partId,amount:amount*.7}]; // no rendered frame: the line reaches the struck part's bone
   }
   return this.creatures.damage(hit.id,amount,'body',{...packet,structuralHits,sourceId:packet.sourceId??'player',attackMode,energyType});
  }
  if(hit.kind==='boss')return this.bosses.hit(hit.id,{...packet,attackMode,partId:hit.partId,attackerPosition:packet.attackerPosition??this.player});
  if(hit.kind==='object'){
   const point={};for(const k of ['x','y','z'])point[k]=hit.point[k]-(hit.normal?.[k]||0)*.001;
   return this.objects.damageAt(hit.id,point,amount,{energyType,progression:this.progression});
  }
  if(hit.kind==='structure'){
   const point={};for(const k of ['x','y','z'])point[k]=hit.point[k]-(hit.normal?.[k]||0)*.001;
   const target=this.dungeons.solidAt(point);if(!target)return {ok:false,reason:'target_missing'};
   const profile=CONTENT.blocks.entries.find(e=>e.id===target.blockId)??this.progression.catalog.get(target.materialId)?.properties;
   const response=resolveSurfaceDamage(profile,amount,energyType);
   return response.ok?{...this.dungeons.damageAt(point,response.amount),energyType,absorbed:response.absorbed}:response;
  }
  if(hit.kind==='fixture'){
   const fixture=this.placements.records.get(hit.id);if(!fixture)return {ok:false,reason:'target_missing'};
   let profile=this.equipmentExposureProfiles.get(fixture.assetId);if(!profile){profile=equipmentExposureProfile(CONTENT,fixture.assetId);this.equipmentExposureProfiles.set(fixture.assetId,profile);}
   const response=resolveSurfaceDamage(profile,amount,energyType);
   return response.ok?{...this.placements.damage(hit.id,response.amount),energyType,absorbed:response.absorbed}:response;
  }
  if(hit.kind==='machine'){const voxel=this.machineVoxelAt(hit);return voxel?this.machines.damage(hit.id,voxel.id,amount,{energyType}):{ok:false,reason:'target_missing'};}
  if(hit.kind==='terrain'&&hit.normal){
   const cell=['x','y','z'].map(k=>Math.floor((hit.point[k]-hit.normal[k]*.001)*2)),key=cell.join(',');
   const block=CONTENT.blocks.entries.find(e=>e.id===this.atlas.getCell(...cell));if(!block||block.collision===false)return {ok:false};
   if(energyType==='thermal')return {ok:true,thermalEU:this.atlas.applyThermalEnergy(...cell,packet.energyEU)};
   const response=resolveSurfaceDamage(block,amount,energyType);if(!response.ok)return response;
   const old=this.terrainDamage[key],damage=(old?.blockId===block.id?old.damage??0:0)+response.amount/block.durabilityHpPerCell;
   if(damage>=1-1e-9){this.atlas.setCell(...cell,null);delete this.terrainDamage[key];this.objects.detachAround(cell);return {ok:true,hp:0};}
   this.terrainDamage[key]={blockId:block.id,damage};return {ok:true,hp:block.durabilityHpPerCell*(1-damage)};
  }
  return {ok:false,reason:'공격할 수 있는 대상을 겨누세요.'};
 }
 energyStrike(hit,energyType,energyEU,{magicAttribute=null}={}){
  const loadout=this.progression.evaluateLoadout();
  if(this.time-this.lastStrike<loadout.attackPeriod)return {ok:false,reason:'공격 준비 중'};
  if(!hit||!Number.isFinite(hit.distance)||hit.distance>6||!['creature','boss','object','structure','fixture','machine','terrain'].includes(hit.kind))return {ok:false,reason:'공격할 수 있는 대상을 겨누세요.'};
  if(hit.kind==='creature'&&!this.creatures.get(hit.id)||hit.kind==='boss'&&!this.bosses.get(hit.id)||hit.kind==='fixture'&&!this.placements.records.has(hit.id)||hit.kind==='machine'&&!this.machineVoxelAt(hit)||hit.kind==='object'&&(!this.objects.get(hit.id)||this.objects.get(hit.id).fragment))return {ok:false,reason:'target_missing'};
  const result=this.materialEffects.attack({targetId:hit.id??`terrain:${hit.point.x},${hit.point.y},${hit.point.z}`,energyType,energyEU,magicAttribute,claimId:this.id('energy-attack')},packet=>this.damageHit(hit,packet));
  if(result.ok)this.lastStrike=this.time;return result;
 }
 descriptors(){
  const p=this.player,rows=[];
  for(const e of this.creatures.visibleEntities(p))rows.push({id:e.id,assetId:e.assetId??e.speciesId,kind:'creature',position:e,yaw:e.yaw,pose:e.pose,missingParts:e.pose?.missingParts,moving:['walk','hunt','flee','forage'].includes(e.state),entity:e});
  for(const e of this.bosses.entities.values())if((!e.defeated||Number.isFinite(e.defeatedAt)&&this.bosses.time-e.defeatedAt<1.6)&&distance(p,e.position)<220)rows.push({id:e.id,assetId:e.bossId,kind:'boss',position:e.position,yaw:Math.atan2(e.facing.x,e.facing.z),entity:e,bossSystem:this.bosses});
  for(const e of this.nearbyStructures){const origin=e.origin??e.position;if(!origin)continue;rows.push({id:e.id,assetId:e.templateId,kind:'structure',position:Array.isArray(origin)?{x:origin[0],y:origin[1],z:origin[2]}:origin,revision:e.revision,getBoxes:()=>this.dungeons.renderBoxes(e.id)});}
  rows.push(...getResourceDescriptors(this),...this.machines.sceneModels().filter(e=>distance(p,e.position)<160),...this.objects.sceneModels().filter(e=>distance(p,e.position)<160),...this.placements.descriptors().filter(e=>distance(p,e.position)<160));
  return rows;
 }
 serialize(){return {schema:1,map:this.map.id,seed:this.seed,time:this.time,nextId:this.nextId,player:clone(this.player),atlas:this.atlas.serialize(),progression:this.progression.serialize(),armaments:this.armaments.serialize(),creatures:this.creatures.serialize(),dungeons:this.dungeons.serialize(),bosses:this.bosses.serialize(),machines:this.machines.serialize(),materialEffects:this.materialEffects.serialize(),objects:this.objects.serialize(),pendingDetach:[...this.pendingDetach],placements:this.placements.serialize(),community:this.community.serialize(),faith:this.faith.serialize(),terrainDamage:clone(this.terrainDamage),deaths:clone(this.deaths),seenRegions:[...this.seenRegions],discoveredLandmarks:[...this.discoveredLandmarks],conversion:this.conversion?clone(this.conversion):null};}
}
