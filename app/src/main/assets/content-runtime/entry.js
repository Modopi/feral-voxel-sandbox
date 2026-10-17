import {ExpeditionRuntime,distance} from './runtime.js';
import {ExpeditionScene,T} from './scene.js';
import {CONTENT} from './catalog.generated.js';
import {ExpeditionSave} from './save.js';
import {Autosave} from './autosave.js';
import {CharacterController,FIXED_DT} from '../physics.js';
import {currentWorld,saveKey} from '../world-slots.js';
import {initUpdates} from '../updates.js';
import {BossView} from './boss-view.js';
import {isResourceAvailable} from './props.js';
import {MachinePanel} from './machine-panel.js';
import {EnvironmentView} from './environment-view.js';
import {EquipmentView} from './equipment-view.js';
import {FeedbackView} from './feedback-view.js';
import {FixtureEnergyPanel} from './fixture-energy-panel.js';
import {CreatureFragments} from './creature-fragments.js';
import {VERSION} from '../version.js';
const $=id=>document.getElementById(id),keys=new Set();
let runtime,view,bossView,environmentView,equipmentView,feedbackView,machinePanel,fixtureEnergyPanel,fragments,controller,physical,saveStore,autosave,updates,communityTarget=null,ready=false,menuOpen=false,panelOpen=false,tab='inventory',tabClock=0,last=0,accum=0,saveClock=0,hudClock=0,toastUntil=0,manual=false;
const held={forward:0,side:0,jump:false,attack:false},angles={};
const reasonNames={research_required:'먼저 관련 연구를 완료하세요.',station_required:'작업 설비가 필요합니다.',ingredients_required:'제작 재료가 부족합니다.',prerequisite_required:'선행 연구가 필요합니다.',samples_required:'연구 표본이 부족합니다.',tool_required:'채집 도구가 필요합니다.',source_depleted:'이미 채집한 곳입니다. 다른 자원을 찾으세요.',insufficient_resources:'재료 또는 에너지가 부족합니다.',component_required:'필요한 컴포넌트를 먼저 설치하세요.',unknown_source:'에너지 원천을 찾지 못했습니다.'};
Object.assign(reasonNames,{weapon_broken:'무기의 내구도가 다했습니다. 다른 무기를 장착하세요.',weapon_not_equipped:'무기를 먼저 장착하세요.',rack_full:'무기 보관 공간이 가득 찼습니다.',workbench_busy:'다른 무기를 제작하고 있습니다.',out_of_range:'대상에 더 가까이 다가가세요.',insufficient_charge:'무장의 전력이 부족합니다.',fire_cooldown:'다음 발사를 준비하고 있습니다.',component_inactive:'컴포넌트가 꺼져 있거나 파손됐습니다.',membership_required:'먼저 신도가 되어야 합니다.',items_required:'필요한 재료가 부족합니다.',outside_attunement_window:'제단의 조율 시간이 아닙니다.',occluded:'대상까지 접근할 수 있는 통로가 필요합니다.'});
function name(id){return runtime?.progression.catalog.get(id)?.name??CONTENT.creatures.entries.find(e=>e.id===id)?.name??CONTENT.bosses.entries.find(e=>e.id===id)?.name??id;}
function quantities(items){return Object.entries(items||{}).map(([id,n])=>`${name(id)} ${Number(n.toFixed(2))}`).join(' · ')||'없음';}
function notify(text){$('toast').textContent=reasonNames[text]??text;toastUntil=performance.now()+4000;$('toast').classList.add('show');}
function report(result,success='완료했습니다.') {if(result?.ok||result===true)notify(success);else notify(reasonNames[result?.reason]??result?.reason??'지금은 사용할 수 없습니다.');renderPanel();}
const energyNames={mechanical:'역학',electrical:'전기',thermal:'열',chemical:'화학',magic:'마법',divine:'신성'};
const attackStyles={strike:'일반 타격',pierce:'관통 찌르기',impact:'충격 전달'};
let weaponPattern='weapon_slash',weaponMaterial='wood';
let deviceTarget=null,manualDeviceId=null,deviceAngleRad=0;
function clearInput(){keys.clear();held.forward=held.side=0;held.jump=held.attack=false;manual=false;manualDeviceId=null;fixtureEnergyPanel?.stopManual();physical?.objectPhysics.release();for(const id of Object.keys(angles))delete angles[id];$('stick').style.transform='';}
function attack(){
 if(!ready||panelOpen||menuOpen)return;
 if(physical.objectPhysics.held){report(physical.objectPhysics.throwHeld(),'물체를 던졌습니다.');held.attack=false;return;}
 if(runtime.drivingMachineId){const hit=view.aim({range:24,excludeOwnerId:runtime.drivingMachineId}),r=runtime.fireMachine(hit);if(r.ok&&!r.duplicate&&!r.blocked)view.flashTrace(r.packet.rayOrigin,hit.point);else if(!r.ok&&performance.now()>toastUntil&&!['cooldown','fire_cooldown'].includes(r.reason))notify(reasonNames[r.reason]??r.reason);return;}
 const type=runtime.player.attackEnergy,hit=view.aim();
 const result=type?runtime.energyStrike(hit,type,25,{magicAttribute:runtime.player.magicAttribute??null}):runtime.strike(hit);
 if(!result.ok&&!['공격 준비 중','attack_cooldown'].includes(result.reason)&&performance.now()>toastUntil)notify(reasonNames[result.reason]??result.reason);
}
async function placeEquipment(id){
 const x=runtime.player.x-Math.sin(runtime.player.yaw)*3,z=runtime.player.z-Math.cos(runtime.player.yaw)*3;
 const result=await runtime.placements.place(id,{x,y:runtime.surfaceHeight(x,z),z},{actorPosition:runtime.player});report(result,'설비를 설치했습니다.');
}
function driveMachine(id){
 const m=runtime.machines.machines.get(id);if(!m||distance(runtime.player,m.position)>5||!m.components.some(c=>c.componentId==='controller'))return {ok:false,reason:'가까운 조종 장치가 필요합니다.'};
 runtime.drivingMachineId=id;runtime.machines.control(id,{throttle:0,steer:0,brake:false});showPanel(false);notify('이동 입력으로 조종합니다. 점프는 상승, Shift는 하강, 사용은 내리기입니다.');return {ok:true};
}
function leaveMachine(){
 const m=runtime.machines.machines.get(runtime.drivingMachineId);if(m)runtime.machines.control(m.id,{throttle:0,steer:0,pitch:0,brake:true});
 runtime.drivingMachineId=null;runtime.player.vy=0;notify('조종을 마쳤습니다.');
}
function save(){if(!ready)return false;try{autosave.writeNow(runtime.serialize());$('saveStatus').textContent='현재 탐험을 저장했습니다.';return true;}catch(e){$('saveStatus').textContent=e.message;notify('저장하지 못했습니다. 이전 정상 저장은 보존됩니다.');return false;}}
function showPanel(value){panelOpen=value;clearInput();$('panel').classList.toggle('hidden',!value);if(value){runtime.player.resting=false;renderPanel();}}
function showMenu(value){menuOpen=value;$('menu').classList.toggle('hidden',!value);clearInput();if(value){updates?.refresh();save();}}
function row(title,detail,label,callback,disabled=false){const el=document.createElement('article');el.className='row';const copy=document.createElement('div');copy.className='copy';const b=document.createElement('b');b.textContent=title;const p=document.createElement('p');p.textContent=detail;copy.append(b,p);el.append(copy);if(label){const button=document.createElement('button');button.textContent=label;button.disabled=disabled;button.onclick=callback;el.append(button);}return el;}
function renderPanel(){
 if(!ready||!panelOpen)return;const p=runtime.progression,list=$('panelList'),term=$('search').value.trim().toLowerCase();list.replaceChildren();
 const append=(title,detail,label,action,disabled)=>{if(!term||title.toLowerCase().includes(term))list.append(row(title,detail,label,action,disabled));};
 document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
 if(tab==='inventory'){
  for(const[id,n]of Object.entries(p.inventory)){const d=p.catalog.get(id);let label='',action;
   if(id==='food'){label='먹기';action=()=>report(runtime.eat(),'음식을 먹었습니다.');}
   else if(d.kind==='gear_baseline'){label=p.equipped===id?'장착 중':'장착';action=()=>report(p.equip(id),'장구를 장착했습니다.');}
   else if(d.kind==='station'){label='앞에 설치';action=()=>placeEquipment(id).catch(e=>notify(e.message));}
   else if(d.kind==='component'){label='거점에 설치';action=()=>placeEquipment(id).catch(e=>notify(e.message));}
   append(`${d.name} × ${Number(n.toFixed(2))}`,d.kind==='material'?`${d.tier}티어 · ${d.unit}`:d.kind==='gear_baseline'?'무기·방호구 장구 세트':d.kind==='tool'?'소지하면 해당 자원 채집에 사용합니다.':'',label,action,p.equipped===id);
  }
  if(Object.keys(p.overflow).length)append('보관 중인 물품',quantities(p.overflow),'받기',()=>report(p.reclaim(),'가방의 빈 공간에 받았습니다.'));
  if(!list.childNodes.length)list.append(row('가방이 비어 있습니다.','주변의 나뭇가지와 돌에 가까이 가서 사용·채집을 누르세요.'));
 }else if(tab==='craft'){
  for(const r of p.list('recipe')){const status=p.recipeStatus(r.id);append(r.name,`${quantities(r.inputs)} → ${quantities(r.outputs)}\n${name(r.station)} · ${r.seconds}초${r.research?' · 연구: '+name(r.research):''}${!status.ok?' · '+(reasonNames[status.reason]??status.reason):''}`,'제작',()=>report(p.queueCraft(r.id),'제작을 시작했습니다.'),!status.ok);}
 }else if(tab==='weapons'){
  const controls=document.createElement('div');controls.className='machine-card';
  for(const [labelText,options,current,change]of [
   ['무기 형태',runtime.armaments.patterns(),weaponPattern,value=>weaponPattern=value],
   ['무기 재질',p.list('material'),weaponMaterial,value=>weaponMaterial=value]]){
   const label=document.createElement('label');label.textContent=labelText+' ';const select=document.createElement('select');select.setAttribute('aria-label',labelText);
   for(const option of options){const el=document.createElement('option');el.value=option.id;el.textContent=option.name;select.append(el);}
   select.value=current;select.onchange=()=>{change(select.value);renderPanel();};label.append(select);controls.append(label);
  }list.append(controls);
  const q=runtime.armaments.quote(weaponPattern,weaponMaterial);
  append(q.name??'무기 제작',q.inputs?`${quantities(q.inputs)} · ${name(q.station)} · ${q.seconds}초\n피해 ${q.hitDamage.toFixed(1)} · 사거리 ${q.range}m · ${q.attackPeriod}초 간격${q.ok?'':' · '+(reasonNames[q.reason]??q.reason)}`:(reasonNames[q.reason]??q.reason),'제작',()=>report(runtime.armaments.craft(weaponPattern,weaponMaterial),'무기를 제작하고 있습니다.'),!q.ok);
  for(const w of runtime.armaments.weapons)append(w.name,`${name(w.materialId)} · 내구 ${w.durability}/${w.maxDurability} · 피해 ${w.hitDamage.toFixed(1)} · ${attackStyles[w.attackMode]}`,runtime.armaments.equippedId===w.id?'해제':'장착',()=>report(runtime.armaments.equip(runtime.armaments.equippedId===w.id?null:w.id),'무기 장착을 변경했습니다.'));
  for(const job of runtime.armaments.jobs??[])append('무기 제작 중',`${job.name??name(job.materialId)} · 작업대에서 제작을 진행합니다.`);
 }else if(tab==='research'){
  for(const r of p.list('research')){const known=p.research.has(r.id),status=p.researchStatus(r.id);append(r.name,`표본: ${quantities(r.samples)} · ${r.work} 연구량${r.station?' · 설비: '+name(r.station):''}${r.prerequisites.length?' · 선행: '+r.prerequisites.map(name).join(', '):''}${!known&&!status.ok?' · '+(reasonNames[status.reason]??status.reason):''}`,known?'완료':'연구',()=>report(p.startResearch(r.id),'표본을 사용해 연구를 시작했습니다.'),known||!status.ok);}
 }else if(tab==='energy'){
  append('일반 공격','장착한 무기와 도구로 공격합니다.',runtime.player.attackEnergy?'선택':'선택 중',()=>{runtime.player.attackEnergy=null;renderPanel();});
  for(const [type,label]of Object.entries(energyNames))append(`${label} 에너지 공격`,`공격 한 번에 25 EU를 소비합니다. 현재 ${type==='thermal'?runtime.materialEffects.thermal.storedEU.toFixed(1):p.energyAvailable(type).toFixed(1)} EU`,runtime.player.attackEnergy===type?'선택 중':'선택',()=>{runtime.player.attackEnergy=type;runtime.player.magicAttribute=null;renderPanel();});
  append('마법 속성',`현재 ${runtime.player.magicAttribute==='water'?'물':runtime.player.magicAttribute==='wind'?'바람':'기본'}`,'속성 바꾸기',()=>{const a=[null,'water','wind'];runtime.player.magicAttribute=a[(a.indexOf(runtime.player.magicAttribute??null)+1)%a.length];runtime.player.attackEnergy='magic';renderPanel();});
  append('열에너지 연료',`원목 1개를 태워 열을 모읍니다. 남은 연료 ${runtime.materialEffects.thermal.fuelEU.toFixed(0)} EU`,'원목 1개 넣기',()=>report(runtime.materialEffects.loadThermalFuel(1,{claimId:runtime.id('thermal-fuel')}),'연료를 넣었습니다.'),p.count('raw_timber')<1);
  fixtureEnergyPanel.render(list);
  for(const s of p.list('station'))append(s.name,`설치 ${p.stations[s.id]||0} · ${name(s.origin.recipe)}`,'설비 제작',()=>report(p.queueCraft(s.origin.recipe),'완성된 설비를 가방에서 설치하세요.'),!p.recipeStatus(s.origin.recipe).ok);
  for(const a of p.assemblies)append(name(a.componentId),`상태 ${Math.round(a.health*100)}% · ${a.scale}배 크기 · ${a.materialId??'기본 재질'}`);
  for(const fixture of runtime.placements.descriptors().filter(f=>distance(runtime.player,f.position)<=5)){
   const quote=runtime.placements.repairQuote(fixture.id);
   append(name(fixture.assetId),`HP ${Math.ceil(fixture.hp)}/${fixture.maxHp} · 수리 재료 ${quantities(quote.items)}`,'수리',()=>report(runtime.placements.repair(fixture.id,{actorPosition:runtime.player}),'설비를 수리했습니다.'),fixture.hp>=fixture.maxHp);
   append(`${name(fixture.assetId)} 회수`,'손상된 만큼 회수할 수 있는 재료가 줄어듭니다.','철거',()=>report(runtime.placements.dismantle(fixture.id,{actorPosition:runtime.player}),'설비를 회수했습니다.'));
  }
 }else if(tab==='machine'){
  machinePanel.render(list);
 }else if(tab==='community'){
  if(communityTarget&&runtime.community){for(const option of runtime.community.optionsFor(communityTarget))append(option.label,option.detail,option.label,()=>report(runtime.community.interact(option.id,{targetId:communityTarget,requestId:runtime.id('community')})),option.disabled);}
  if(!list.childNodes.length)list.append(row('공동체와 만나기','문명 생명체나 공동체 시설에 다가가서 사용을 누르세요.'));
 }else if(tab==='devices'){
  renderDevices(list,append);
 }else if(tab==='faith'){
  for(const shrine of runtime.faith.nearbyShrines(3)){
   append(shrine.name,'이곳에서 신앙 활동과 제단 시련을 진행할 수 있습니다.');
   for(const option of runtime.faith.optionsFor(shrine.instanceId))append(option.label,option.detail,'선택',()=>report(runtime.faith.interact(option.id,{instanceId:shrine.instanceId}),'제단에 뜻을 전했습니다.'),option.disabled);
  }
  if(!list.childNodes.length)list.append(row('유적의 제단','기록 보관소의 기록대나 잊힌 수도원의 전달 장치 3m 안에서 신앙 활동과 시련을 시작할 수 있습니다.'));
 }else{
  for(const d of runtime.nearbyStructures){const def=CONTENT.structures.entries.find(e=>e.id===d.templateId);append(def.name,`장소 ${d.tier}티어 · 지역 ${d.regionTier}티어 · 출발지로부터 ${Math.round(Math.hypot(d.origin[0],d.origin[2]))}m · 탐색한 방 ${d.visitedRooms.length}/${def.rooms.length}`);}
  for(const d of runtime.deaths.filter(d=>!d.recovered))append('요정이 지키는 소지품',`${Math.round(distance(runtime.player,d.position))}m · ${quantities(d.items)}${d.weapons?.length?' · 무기 '+d.weapons.length+'개':''}`);
 }
 const work=p.researchJob?`연구: ${name(p.researchJob.researchId??p.researchJob.id)} `:'';
 $('workStatus').textContent=`${work}제작 대기 ${p.jobs.length} · ${Object.entries(p.energy).filter(([,v])=>v>0).map(([k,v])=>`${k} ${v.toFixed(1)} EU`).join(' · ')}`;
}
function renderDevices(list,append){
 const devices=runtime.dungeons.devices,p=runtime.progression;
 const nearby=runtime.dungeons.nearbyAnchors(runtime.player,3).filter(a=>a.kind==='puzzle');
 const instances=[...new Set(nearby.map(a=>a.instanceId))];
 if(!instances.includes(deviceTarget))deviceTarget=instances[0]??null;
 if(!deviceTarget){append('던전의 장치','문 근처의 조작점 3m 안으로 다가가세요.');return;}
 for(const id of instances){const inst=runtime.dungeons.get(id),title=CONTENT.structures.entries.find(d=>d.id===inst.templateId).name;append(title,'조작할 장치',id===deviceTarget?'선택 중':'선택',()=>{deviceTarget=id;renderPanel();});}
 const status=devices.status(deviceTarget,{progression:p}),inst=runtime.dungeons.get(deviceTarget);
 append('장치 상태',status.summary??(status.solved?'통로를 확보했습니다.':'장치를 수리하고 필요한 동력을 공급하세요.'));
 if(status.wind){
  const control=document.createElement('label');control.className='row';control.textContent=`풍향판 ${Math.round(status.wind.angleRad*180/Math.PI)}° · 횡풍 ${status.wind.forceN.toFixed(1)}N `;
  const select=document.createElement('select');select.setAttribute('aria-label','풍향판 설정 각도');for(const degrees of [0,45,90,135,180]){const option=document.createElement('option');option.value=degrees*Math.PI/180;option.textContent=degrees+'°';select.append(option);}
  select.value=deviceAngleRad;select.onchange=()=>deviceAngleRad=Number(select.value);control.append(select);list.append(control);
 }
 for(const a of status.actions??[]){
  if(a.hold){
   const card=row(a.label,a.detail??quantities(a.items),'누르고 조작',()=>{},a.disabled),button=card.querySelector('button');
   button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);const r=devices.act(deviceTarget,a.id,{position:runtime.player,progression:p,claimId:runtime.id('device')});if(r.ok){manualDeviceId=deviceTarget;held.attack=false;}else report(r);};
   button.onpointerup=button.onpointercancel=()=>{manualDeviceId=null;renderPanel();};list.append(card);
  }else append(a.label,typeof a.detail==='string'?a.detail:quantities(a.items),'조작',()=>report(devices.act(deviceTarget,a.id,{position:runtime.player,progression:p,claimId:runtime.id('device'),angleRad:deviceAngleRad}),'장치를 조작했습니다.'),a.disabled);
 }
 const anchor=nearby.find(a=>a.instanceId===deviceTarget);
 for(const node of p.fixtureEnergy.nodes.values()){
  const pos=Array.isArray(node.position)?{x:node.position[0],y:node.position[1],z:node.position[2]}:node.position;
  if(!pos||distance(pos,anchor.position)>8)continue;
  const ports=p.fixtureEnergy.ports(node.ownerId);
  for(const type of ports.outputs.filter(t=>ports.stores.includes(t)))append(`${energyNames[type]} 공급 연결`,`${name(node.assetId??node.definitionId??node.ownerId)} · 케이블 재료를 사용합니다.`,'연결',()=>report(devices.connectSupply(inst.id,node.ownerId,type,{progression:p,claimId:runtime.id('device-link')}),'장치에 공급선을 연결했습니다.'));
 }
 for(const supply of status.supplies??[])append(`${energyNames[supply.type]} 공급`,`${supply.valid?'연결됨':'연결 끊김'} · 공급기 ${Number(supply.storedEU??0).toFixed(1)} EU · 장치 ${Number(supply.deviceEU??0).toFixed(1)} EU`,'25 EU 전달',()=>report(devices.charge(inst.id,supply.type,25,{progression:p,claimId:runtime.id('device-charge')}),'저장된 에너지를 전달했습니다.'),!supply.valid||supply.storedEU<25);
}
function nearestNode(){return runtime.nodes.filter(n=>isResourceAvailable(runtime,n)).map(n=>({...n,distance:distance(runtime.player,n)})).sort((a,b)=>a.distance-b.distance)[0];}
function interact(){
 if(!ready||menuOpen)return;const hit=view.aim();
 if(physical.objectPhysics.held){physical.objectPhysics.release();notify('물체를 놓았습니다.');return;}
 if(runtime.drivingMachineId){leaveMachine();return;}
 if(hit?.kind==='machine'){machinePanel.selected=hit.id;tab='machine';showPanel(true);return;}
 if(hit?.kind==='fixture'&&hit.distance<5){tab='energy';showPanel(true);return;}
 if(hit?.kind==='object'&&hit.distance<4){const owner=runtime.objects.get(hit.id)?.fragment?.lootOwnerId,corpse=owner?runtime.creatures.corpses.get(`corpse:${owner}`):null;if(corpse&&!corpse.claimed){report(runtime.creatures.claimDrops(owner,runtime.progression),'전리품을 회수했습니다.');return;}report(physical.objectPhysics.grab(hit.id,hit.point),'물체를 잡았습니다. 사용은 놓기, 공격은 던지기입니다.');return;}
 if(hit?.kind==='resource'){const node=runtime.nodes.find(n=>n.id===hit.id);if(node){report(runtime.beginHarvest(node),'채집하고 있습니다.');return;}}
 if(hit?.kind==='creature'&&hit.distance<4){const e=runtime.creatures.get(hit.id);if(e?.dead){report(runtime.creatures.claimDrops(e.id,runtime.progression),'전리품을 회수했습니다.');return;}if(e?.civilization){communityTarget=e.id;tab='community';showPanel(true);return;}}
 const anchors=runtime.dungeons.nearbyAnchors(runtime.player,3).filter(a=>!['spawn','producer','boss'].includes(a.kind));
 if(anchors.length){const a=anchors[0];if(a.kind==='gimmick'){report(runtime.beginGimmick(a),'장치를 조작하고 있습니다.');return;}
  if(a.kind==='puzzle'){deviceTarget=a.instanceId;tab='devices';showPanel(true);return;}
  const result=runtime.dungeons.interact(a.instanceId,a.id,{position:runtime.player,progression:runtime.progression});
  if(result.kind==='service'){communityTarget=a.instanceId;tab='community';showPanel(true);}else report(result,'살펴보았습니다.');return;
 }
 const n=runtime.terrainResource(hit)??nearestNode();if(n&&(n.distance??distance(runtime.player,n))<5)report(runtime.beginHarvest(n),'채집하고 있습니다.');else notify('대상 가까이에서 사용하세요.');
}
function bind(){
 $('attackMode').onclick=()=>{const modes=Object.keys(attackStyles),mode=modes[(modes.indexOf(runtime.player.attackStyle??'strike')+1)%modes.length];runtime.player.attackStyle=mode;notify(mode==='pierce'?'외피를 관통해 안쪽 부위를 노립니다.':mode==='impact'?'충격을 가까운 내부 부위로 전달합니다.':'접촉한 부위를 타격합니다.');hud();};
 $('openBag').onclick=()=>showPanel(!panelOpen);$('closePanel').onclick=()=>showPanel(false);
 $('openMenu').onclick=()=>showMenu(true);$('closeMenu').onclick=()=>showMenu(false);$('save').onclick=()=>{if(save())notify('저장했습니다.');};
 $('leave').onclick=()=>{if(save())location.href='worlds.html';};$('rest').onclick=()=>{runtime.player.resting=true;showMenu(false);notify('휴식 중입니다. 이동하거나 공격하면 휴식을 끝냅니다.');};
 $('search').oninput=renderPanel;document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{manual=false;manualDeviceId=null;tab=b.dataset.tab;renderPanel();});
 $('use').onclick=interact;$('stance').onclick=()=>{const p=runtime.player;p.desiredStance=p.desiredStance==='stand'?'crouch':p.desiredStance==='crouch'?'crawl':'stand';$('stance').textContent={stand:'웅크리기',crouch:'기어가기',crawl:'일어서기'}[p.desiredStance];};
 for(const[id,property]of [['jump','jump'],['attack','attack']]){const el=$(id);el.onpointerdown=e=>{held[property]=true;angles[e.pointerId]={x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);};el.onpointermove=e=>look(e);el.onpointerup=el.onpointercancel=e=>{held[property]=false;delete angles[e.pointerId];};}
 const pad=$('movePad');let movingPointer=null;
 const move=e=>{if(e.pointerId!==movingPointer)return;const r=pad.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,length=Math.max(1,Math.hypot(x,y)/35);held.side=Math.max(-1,Math.min(1,x/35/length));held.forward=Math.max(-1,Math.min(1,-y/35/length));$('stick').style.transform=`translate(${held.side*30}px,${-held.forward*30}px)`;};
 pad.onpointerdown=e=>{movingPointer=e.pointerId;pad.setPointerCapture(e.pointerId);move(e);};pad.onpointermove=move;pad.onpointerup=pad.onpointercancel=e=>{if(e.pointerId===movingPointer){movingPointer=null;held.forward=held.side=0;$('stick').style.transform='';}};
 const canvas=$('scene');canvas.onpointerdown=e=>{angles[e.pointerId]={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=look;canvas.onpointerup=e=>{const a=angles[e.pointerId];if(a&&e.pointerType==='mouse'&&Math.hypot(e.clientX-a.startX,e.clientY-a.startY)<5)attack();delete angles[e.pointerId];};canvas.onpointercancel=e=>delete angles[e.pointerId];
 window.onkeydown=e=>{if(e.target.matches('input,select,textarea'))return;if(['Tab','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(!e.repeat){if(e.code==='Tab')showPanel(!panelOpen);if(e.code==='Escape'){if(panelOpen)showPanel(false);else showMenu(!menuOpen);}if(e.code==='KeyE')interact();}};
 window.onkeyup=e=>keys.delete(e.code);window.onblur=clearInput;
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();save();}});
 window.addEventListener('pagehide',()=>{clearInput();save();});
 window.addEventListener('resize',()=>view.resize());
}
function look(e){const old=angles[e.pointerId];if(!old||!ready||panelOpen||menuOpen)return;runtime.player.yaw-=(e.clientX-old.x)*.005;runtime.player.pitch=Math.max(-1.45,Math.min(1.45,runtime.player.pitch-(e.clientY-old.y)*.005));old.x=e.clientX;old.y=e.clientY;}
function hud(){
 const p=runtime.player,g=runtime.progression,e=CONTENT.environments.entries.find(e=>e.id===runtime.region.environmentId);
 $('region').textContent=`${e?.name??''} · ${runtime.region.tier}티어 · 출발지 ${Math.round(Math.hypot(p.x,p.z))}m`;
 $('hp').textContent=`HP ${Math.ceil(p.hp)}/${p.maxHp}`;$('calories').textContent=`식량 ${Math.ceil(p.calories/p.maxCalories*100)}%`;
 $('objective').textContent=g.research.has('joinery')?'장비와 운반 구조물을 준비하고 동쪽의 저택을 탐험하세요.':g.research.has('observation')?'식물 섬유와 나뭇가지를 모아 구조와 접합을 연구하세요.':'주변의 나뭇가지와 돌을 모아 관찰과 기록을 연구하세요.';
 $('progress').textContent=`연구 ${g.research.size}/39 · ${p.resting?'휴식 중':'내 월드에서 저장을 이어갈 수 있습니다.'}`;
 $('use').textContent=runtime.drivingMachineId?'내리기':physical?.objectPhysics.held?'놓기':'사용·채집';
 $('attack').textContent=physical?.objectPhysics.held?'던지기':runtime.drivingMachineId?'무장 발사':runtime.player.attackEnergy?`${energyNames[runtime.player.attackEnergy]} 공격`:'공격';
 const weapon=runtime.armaments.loadout();$('attackMode').textContent=`공격 방식: ${attackStyles[weapon?.attackMode??p.attackStyle??'strike']}`;$('attackMode').disabled=!!weapon;
 const hit=view.aim(),node=nearestNode(),entity=hit?.kind==='creature'?runtime.creatures.get(hit.id):hit?.kind==='boss'?runtime.bosses.get(hit.id):null;
 $('aimLabel').textContent=entity?`${hit.kind==='boss'?runtime.bosses.definitionFor(entity).name:name(entity.speciesId)} · HP ${Math.ceil(entity.hp)}/${entity.maxHp}${hit.kind==='boss'?` · ${entity.encounterTier}티어 · ${runtime.bosses.phase(entity).name}`:''}`:node?.distance<5?`${name(node.sourceId)} · 사용해서 채집`:'';
 const a=runtime.harvestAction,b=runtime.interactionAction;$('actionProgress').textContent=a?`${name(a.sourceId)} ${a.elapsed.toFixed(1)}/${g.catalog.get(a.sourceId).seconds}초`:b?`장치 조작 ${b.elapsed.toFixed(1)}/${b.seconds}초`:manualDeviceId?runtime.dungeons.devices.status(manualDeviceId,{progression:g}).summary:'';
 if(runtime.messages.length)notify(runtime.messages.splice(0).at(-1));
 if(performance.now()>toastUntil)$('toast').classList.remove('show');
}
function frame(now){
 const dt=Math.min(.1,(now-(last||now))/1000);last=now;
 if(ready&&!document.hidden){
  if(!menuOpen){accum+=dt;while(accum>=FIXED_DT){
   const input=panelOpen?{}:{forward:held.forward+Number(keys.has('KeyW'))-Number(keys.has('KeyS')),side:held.side+Number(keys.has('KeyD'))-Number(keys.has('KeyA')),jump:held.jump||keys.has('Space'),sprint:keys.has('ShiftLeft'),speedScale:runtime.bosses.targetEffects(runtime.player).speedMultiplier};
   const before={...runtime.player};if(input.forward||input.side||held.attack)runtime.player.resting=false;
   const driving=runtime.machines.machines.get(runtime.drivingMachineId);
   if(driving)runtime.machines.control(driving.id,{throttle:input.forward||0,steer:-(input.side||0),pitch:Number(!!input.jump)-Number(keys.has('ShiftLeft')),brake:keys.has('ControlLeft')});
   else{runtime.drivingMachineId=null;controller.step(FIXED_DT,input);physical?.movePlayer(before,runtime.player);}
   if(held.attack&&!panelOpen&&!manual)attack();
   runtime.tick(FIXED_DT,{manual,manualDeviceId,moving:!!(input.forward||input.side)});physical?.step(FIXED_DT);
   if(driving&&runtime.drivingMachineId===driving.id&&runtime.machines.machines.has(driving.id)&&driving.voxels.length){
    const control=driving.components.find(c=>c.componentId==='controller'),voxel=driving.voxels.find(v=>v.id===control?.voxelId);
    const offset=voxel?new T.Vector3((voxel.cell[0]+.5)*driving.gridM,(voxel.cell[1]+1)*driving.gridM+.08,(voxel.cell[2]+.5)*driving.gridM):new T.Vector3(0,Math.max(...driving.voxels.map(v=>(v.cell[1]+1)*driving.gridM))+.08,0);
    const q=driving.rotation;offset.applyQuaternion(new T.Quaternion(q.x,q.y,q.z,q.w));
    Object.assign(runtime.player,{x:driving.position.x+offset.x,y:driving.position.y+offset.y,z:driving.position.z+offset.z,vy:0});
   }
   accum-=FIXED_DT;
  }
  saveClock+=dt;if(saveClock>30){saveClock=0;autosave.schedule(runtime.serialize());}
  }
  runtime.atlas.loadAround(runtime.player.x,runtime.player.z,{radiusChunks:3,verticalRadius:1,y:runtime.player.y,chunkBudget:1});
  view.syncTerrain();view.syncModels(runtime.descriptors(),runtime.time,dt);fragments.sync(view.models);physical?.synchronize(view.models,runtime.player);bossView.sync(runtime.bosses);environmentView.sync(runtime.player,runtime.time);equipmentView.sync(runtime,dt);feedbackView.sync(runtime,dt);
  view.draw(runtime.player,controller.eye);hudClock+=dt;tabClock+=dt;if(hudClock>.2){hudClock=0;hud();}if(tabClock>1&&!manual&&!manualDeviceId){tabClock=0;if(!document.activeElement?.closest('#panelList'))renderPanel();}
  updates.frame(true,now);
 }
 requestAnimationFrame(frame);
}
async function boot(){
 const world=currentWorld(localStorage,'expedition',location.search);saveStore=new ExpeditionSave(localStorage,saveKey(world));
 runtime=await ExpeditionRuntime.create(world.seed,saveStore.load());view=new ExpeditionScene($('scene'),runtime.atlas);controller=new CharacterController(runtime.terrain,runtime.player);
 autosave=new Autosave(saveStore,{onSaved:()=>{$('saveStatus').textContent='현재 탐험을 저장했습니다.';},onError:error=>{$('saveStatus').textContent=error.message;notify('자동 저장하지 못했습니다. 이전 정상 저장은 보존됩니다.');}});
 bossView=new BossView(view);equipmentView=new EquipmentView(view);feedbackView=new FeedbackView(view);
 environmentView=new EnvironmentView(view,runtime.atlas);machinePanel=new MachinePanel(runtime,{report,drive:driveMachine});fixtureEnergyPanel=new FixtureEnergyPanel(runtime,{report,onManual:value=>{manual=value;if(value)held.attack=false;}});
 updates=initUpdates({beforeApply:save});
 const {RuntimePhysics}=await import('./physics.js');physical=await RuntimePhysics.create(runtime,view);
 runtime.physics=physical;runtime.terrain.hasAttackLineOfSight=(a,b,options)=>runtime.lineOfSight(a,b)&&(physical.hasAttackLineOfSight?.(a,b,options)??true);
 fragments=new CreatureFragments(CONTENT,runtime.creatures,runtime.objects,{getModelRecord:id=>view.models.get(id),getPartPhysics:(owner,part)=>physical.getPartPhysics?.(owner,part)});
 ready=true;bind();$('loading').classList.add('hidden');
 window.FERAL={ready:true,runtime,view,controller,physics:physical,save,stats:()=>({running:ready&&!menuOpen,version:VERSION.version,versionCode:VERSION.versionCode,player:{...runtime.player},regions:runtime.seenRegions.size,models:view.models.size,chunks:runtime.atlas.activeChunks.size})};
 window.FeralNative={save,pause:()=>showMenu(true)};
 requestAnimationFrame(frame);
}
boot().catch(e=>{$('loadingText').textContent=`세계 준비를 완료하지 못했습니다: ${e.message}`;console.error(e);window.AndroidApp?.runtimeFailed?.();});
