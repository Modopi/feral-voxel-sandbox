import {CONTENT} from './catalog.generated.js';
import {ASSETS,loadAsset} from './assets.generated.js';
import {WorldAtlas} from './atlas.js';
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
const clone = value => JSON.parse(JSON.stringify(value));
export const distance = (a,b) => Math.hypot(a.x-b.x,(a.y||0)-(b.y||0),a.z-b.z);
export class ExpeditionRuntime {
 static async create(seed,state=null){
  const assets=new Map();
  await Promise.all(CONTENT.structures.entries.map(async e=>assets.set(e.id,await loadAsset(e.id))));
  const runtime=new ExpeditionRuntime(seed,state,assets);await runtime.placements.ready;runtime.placements.syncAccess(runtime.player);return runtime;
 }
 constructor(seed,state,assets){
  this.calorieRule=CONTENT.progression.entries.find(e=>e.id==='calorie_baseline');
  this.seed=seed;this.time=state?.time||0;this.nextId=state?.nextId||1;
  this.atlas=new WorldAtlas(CONTENT,{seed,state:state?.atlas,maxActiveChunks:96});
  this.progression=new Progression(CONTENT,state?.progression||{});
  this.armaments=new Armaments(this.progression,state?.armaments||{});
  this.creatures=new CreatureSystem(CONTENT,{seed,state:state?.creatures,terrain:this.atlas});
  this.bosses=new BossSystem(CONTENT,state?.bosses);
  this.dungeons=new DungeonSystem({catalog:CONTENT,seed,state:state?.dungeons,atlas:this.atlas,assets});
  this.player=state?.player?clone(state.player):{x:0,y:this.atlas.heightAt(0,0)+.05,z:0,yaw:Math.PI,pitch:0,hp:100,maxHp:100,calories:this.calorieRule.capacity,maxCalories:this.calorieRule.capacity,vy:0,grounded:false,stance:'stand',lastDamageAt:-100,resting:false};
  this.deaths=clone(state?.deaths||[]);this.seenRegions=new Set(state?.seenRegions||[]);
  this.messages=[];this.events=[];this.harvestAction=null;this.lastStrike=0;this.populationClock=Infinity;
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
  this.terrainDamage=clone(state?.terrainDamage||{});
  this.equipmentExposureProfiles=new Map();
  this.nodes=[];this.nearbyStructures=[];this.refreshWorld();
 }
 id(prefix){return `${prefix}:${this.seed}:${this.nextId++}`;}
 message(text){this.messages.push(String(text));if(this.messages.length>30)this.messages.shift();}
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
   this.creatures.ensureRegion(regionId,{environmentId:s.environmentId,x,z,tier:s.tier,safeBypass:s.safeBypass||s.hostileSpawnsAllowed===false||Math.hypot(x,z)<96});this.seenRegions.add(regionId);
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
  this.progression.tick(dt,{researching:true,manual});this.dungeons.update(dt,{progression:this.progression,manualInstanceId:manualDeviceId,position:this.player});this.atlas.tick?.(dt);this.machines.tick(dt);this.materialEffects.tick(dt);this.community.tick(dt);
  if(this.pendingDetach.size){const key=this.pendingDetach.values().next().value;this.pendingDetach.delete(key);this.objects.detachAround(key.split(',').map(Number));}
  for(const event of this.dungeons.drainEvents()){
   if(event.type==='producer_destroyed')this.creatures.setProducerState(event.instanceId,event.producerId,{enabled:false});
   if(event.type==='water_basin_breached')this.creatures.setWater(event.instanceId,0);
  }
  const loadout=this.progression.evaluateLoadout(),p=this.player;p.maxHp=loadout.maxHp;p.hp=Math.min(p.hp,p.maxHp);
  const rule=this.calorieRule;
  p.calories=Math.max(0,p.calories-dt*(moving ? rule.activeDrainPerSecond : rule.idleDrainPerSecond));
  if(p.hp<p.maxHp&&p.calories>0&&(p.resting||this.time-p.lastDamageAt>=rule.noHitDelaySeconds)){
   const heal=Math.min(p.maxHp-p.hp,dt*rule.hpRegenPerSecond*(p.resting?rule.restMultiplier:1),p.calories/rule.caloriesPerHp);p.hp+=heal;p.calories-=heal*rule.caloriesPerHp;
  }
  this.creatures.tick(dt,{player:p,terrain:this.terrain,damagePlayer:amount=>this.hurt(amount*(1-loadout.damageReduction),'creature')});
  const active=[...this.bosses.entities.values()].filter(e=>distance(p,e.position)<180).map(e=>e.id);
  this.bosses.tick(dt,{activeIds:active,targets:[{id:'player',ownerId:'player',position:p,radius:.28,height:p.bodyHeight??1.5,armorReduction:loadout.damageReduction},...(this.physics?.machineTargets?.()??[])],terrain:this.terrain,
   damage:e=>{if(e.targetId==='player')this.hurt(e.damage??e.amount??e.hpDamage,'boss');else this.physics?.damageMachineTarget?.(e);},
   onDefeat:e=>{const b=this.bosses.get(e.bossId);if(b)this.dungeons.defeatBoss(b.instanceId,b.id,b.reward?.bossChannelOverride);this.message('수호자를 쓰러뜨렸습니다. 보상을 회수할 수 있습니다.');}});
  this.faith.tick(dt);
  this.armaments.tick(dt);
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
  if(this.harvestAction){
   if(distance(p,this.harvestAction.position)>5){this.harvestAction=null;this.message('너무 멀어 채집을 멈췄습니다.');}
   else{this.harvestAction.elapsed+=dt;const source=this.progression.catalog.get(this.harvestAction.sourceId);
    if(this.harvestAction.elapsed>=source.seconds){const a=this.harvestAction;
     const intact=!a.cell||this.atlas.getCell(...a.cell)===a.blockId;
     const result=intact?this.progression.harvest(a.sourceId,{environmentId:a.environmentId,nodeId:a.nodeId,nodeType:a.nodeType,elapsed:a.elapsed,claimId:a.claimId}):{ok:false,reason:'채집할 자원이 이미 사라졌습니다.'};
     if(result.ok&&a.cell){this.atlas.setCell(...a.cell,null);delete this.terrainDamage[a.cell.join(',')];this.objects?.detachAround(a.cell);}
     this.harvestAction=null;this.message(result.ok?`${source.name} 완료`:result.reason);}}
  }
  if(this.interactionAction){const a=this.interactionAction;
   if(distance(p,a.position)>3){this.interactionAction=null;this.message('장치에서 멀어져 조작을 멈췄습니다.');}
   else if((a.elapsed+=dt)>=a.seconds){this.interactionAction=null;const result=this.bosses.interactGimmick(a.bossId,a.gimmickId,{actorPosition:p,progressS:a.elapsed});this.message(result?'장치를 조작했습니다.':'장치를 조작하지 못했습니다.');}
  }
  for(const death of this.deaths)if(!death.recovered&&distance(p,death.position)<=10){
   this.recoverDeath(death);
  }
  if(p.hp<=0)this.die();
 }
 hurt(amount,source){if(!Number.isFinite(amount)||amount<=0)return;this.player.hp=Math.max(0,this.player.hp-amount);this.player.lastDamageAt=this.time;this.player.resting=false;this.events.push({type:'player_hit',amount,source});if(this.events.length>64)this.events.shift();}
 die(){
  const p=this.player,inventory=this.progression.inventory,overflow=this.progression.overflow,items={...inventory};
  if(this.drivingMachineId)this.machines.control(this.drivingMachineId,{throttle:0,steer:0,pitch:0,brake:true});
  for(const[id,n]of Object.entries(overflow))items[id]=(items[id]||0)+n;
  this.deaths.push({id:this.id('death'),position:{x:p.x,y:p.y,z:p.z},items,weapons:this.armaments.drainCarried(),recovered:false});
  this.progression.inventory={};this.progression.overflow={};this.progression.equipped=null;
  Object.assign(p,{x:0,y:this.atlas.heightAt(0,0)+.05,z:0,hp:100,maxHp:100,calories:600,vy:0,lastDamageAt:this.time});
  this.harvestAction=null;this.interactionAction=null;this.drivingMachineId=null;this.player.resting=false;this.message('출발지에서 깨어났습니다. 사망 장소 10m 안에 가면 요정이 소지품을 돌려줍니다.');
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
 eat(id='food'){
  if(id!=='food')return {ok:false,reason:'먹을 수 있는 음식이 아닙니다.'};
  const result=this.progression.spend({[id]:1},{claimId:this.id('eat')});if(result.ok)this.player.calories=Math.min(this.player.maxCalories,this.player.calories+this.calorieRule.foodCalories);return result;
 }
 beginHarvest(node){
  const position=node.position??{x:node.x,y:node.y??this.atlas.heightAt(node.x,node.z),z:node.z};
  if(distance(this.player,position)>5)return {ok:false,reason:'가까이 다가가세요.'};
  const sourceId=node.sourceId??node.progressionSourceId;
  if(!this.progression.catalog.has(sourceId))return {ok:false,reason:'채집 원천을 찾지 못했습니다.'};
  const source=this.progression.catalog.get(sourceId);
  if(source.requiredTool&&!this.progression.count(source.requiredTool))return {ok:false,reason:'tool_required'};
  if(!isResourceAvailable(this,{...node,...position,sourceId}))return {ok:false,reason:'source_depleted'};
  if(this.harvestAction?.nodeId===node.id)return {ok:true};
  this.interactionAction=null;this.harvestAction={sourceId,nodeId:node.id,nodeType:node.nodeId,environmentId:this.atlas.sample(position.x,position.z).environmentId,position,elapsed:0,claimId:this.id('harvest'),cell:node.cell,blockId:node.blockId};return {ok:true};
 }
 beginGimmick(anchor){
  const boss=this.bosses.get(anchor?.bossInstanceId),g=boss?.gimmicks[anchor.gimmickId];
  if(!boss||boss.defeated||!g||g.broken||g.uses<=0||distance(this.player,anchor.position)>3)return {ok:false,reason:'지금은 이 장치를 조작할 수 없습니다.'};
  if(this.interactionAction?.anchorId===anchor.id)return {ok:true};
  const seconds=this.bosses.definitionFor(boss).arena.gimmickInteractionS;
  this.harvestAction=null;this.interactionAction={anchorId:anchor.id,bossId:boss.id,gimmickId:anchor.gimmickId,position:clone(anchor.position),elapsed:0,seconds};return {ok:true};
 }
 terrainResource(hit){
  if(hit?.kind!=='terrain'||hit.distance>5||!hit.normal)return null;
  const cell=['x','y','z'].map(k=>Math.floor((hit.point[k]-hit.normal[k]*.001)*2));
  const blockId=this.atlas.getCell(...cell),block=CONTENT.blocks.entries.find(e=>e.id===blockId);
  if(!block?.rawResourceId)return null;
  const source=this.progression.list('source').find(e=>e.outputs[block.rawResourceId]);if(!source)return null;
  return {id:`terrain:${cell.join(',')}`,sourceId:source.id,blockId,cell,x:cell[0]*.5+.25,y:cell[1]*.5+.25,z:cell[2]*.5+.25};
 }
 strike(hit){
  const weapon=this.armaments.loadout(),loadout=weapon??this.progression.evaluateLoadout();if(this.time-this.lastStrike<loadout.attackPeriod)return {ok:false,reason:'공격 준비 중'};
  if(!hit||hit.distance>(weapon?.range??4))return {ok:false,reason:'대상이 멉니다.'};
  if(hit.kind==='resource'){const node=this.nodes.find(n=>n.id===hit.id);return node?this.beginHarvest(node):{ok:false};}
  if(hit.kind==='terrain'){
   const resource=this.terrainResource(hit);if(resource)return this.beginHarvest(resource);
  }
  if(weapon){const worn=this.armaments.recordAttack({distanceM:hit.distance,at:this.time});if(!worn.ok)return worn;}
  this.lastStrike=this.time;this.lastAttackMode=weapon?.attackMode??this.player.attackStyle??'strike';
  return this.damageHit(hit,{amount:loadout.hitDamage,energyType:'mechanical',energyEU:loadout.hitDamage*1.5,attackMode:this.lastAttackMode});
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
  const attackMode=packet.attackMode??this.player.attackStyle??'strike';
  if(['creature','boss'].includes(hit.kind)&&this.physics?.traceCombat&&hit.point){
   const from=hit.rayOrigin??{x:this.player.x,y:this.player.y+(this.player.bodyHeight??1.5)*.9,z:this.player.z};
   const length=distance(from,hit.point),depth=attackMode==='pierce'?1.201:attackMode==='impact'?.601:.002;
   if(length<1e-6)return {ok:false,reason:'대상을 겨누세요.'};
   const to={};for(const k of ['x','y','z'])to[k]=hit.point[k]+(hit.point[k]-from[k])/length*depth;
   const trace=this.physics.traceCombat({from,to,ownerId:hit.id,excludeOwnerId:packet.sourceId??'player',mode:attackMode,energyEU:packet.energyEU,amount});
   if(trace.blocked||trace.effectiveAmount<=0)return {ok:false,reason:'대상이 다른 물체에 가려졌습니다.'};
   amount=trace.effectiveAmount;packet={...packet,amount,attackMode,structuralHits:trace.hits};
  }
  if(hit.kind==='creature')return this.creatures.damage(hit.id,amount,packet.structuralHits?'body':hit.partId,{...packet,sourceId:packet.sourceId??'player',attackMode,energyType});
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
   const old=this.terrainDamage[key],hp=Math.max(0,(old?.blockId===block.id?old.hp:block.durabilityHpPerCell)-response.amount);
   if(hp===0){this.atlas.setCell(...cell,null);delete this.terrainDamage[key];this.objects.detachAround(cell);}
   else this.terrainDamage[key]={blockId:block.id,hp};return {ok:true,hp};
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
 serialize(){return {schema:1,seed:this.seed,time:this.time,nextId:this.nextId,player:clone(this.player),atlas:this.atlas.serialize(),progression:this.progression.serialize(),armaments:this.armaments.serialize(),creatures:this.creatures.serialize(),dungeons:this.dungeons.serialize(),bosses:this.bosses.serialize(),machines:this.machines.serialize(),materialEffects:this.materialEffects.serialize(),objects:this.objects.serialize(),pendingDetach:[...this.pendingDetach],placements:this.placements.serialize(),community:this.community.serialize(),faith:this.faith.serialize(),terrainDamage:clone(this.terrainDamage),deaths:clone(this.deaths),seenRegions:[...this.seenRegions]};}
}
