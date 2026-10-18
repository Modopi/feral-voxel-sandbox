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
import {AnchorMarkers} from './anchor-markers.js';
import {VERSION} from '../version.js';
import {reasonText} from './reasons.js';
const $=id=>document.getElementById(id),keys=new Set(),panelPointers=new Set();
let anchorMarkers,toastQueue=[],hitFlash=null,jobWatch={id:null,progress:0,since:0},runtime,view,bossView,environmentView,equipmentView,feedbackView,machinePanel,fixtureEnergyPanel,fragments,controller,physical,saveStore,autosave,updates,communityTarget=null,ready=false,menuOpen=false,panelOpen=false,tab='inventory',tabClock=0,last=0,accum=0,saveClock=0,hudClock=0,toastUntil=0,manual=false;
const held={forward:0,side:0,jump:false,attack:false,sprint:false,descend:false,brake:false},angles={};
function name(id){if(id==='hand')return '맨손';return runtime?.progression.catalog.get(id)?.name??CONTENT.creatures.entries.find(e=>e.id===id)?.name??CONTENT.bosses.entries.find(e=>e.id===id)?.name??id;}
function quantities(items){return Object.entries(items||{}).map(([id,n])=>`${name(id)} ${Number(n.toFixed(2))}`).join(' · ')||'없음';}
function showToast(message){$('toast').textContent=message;toastUntil=performance.now()+(toastQueue.length?2600:4000);$('toast').classList.add('show');}
// Direct results replace the current toast; world events queue so simultaneous messages are not lost.
function notify(text,immediate=true){const message=reasonText(text);if(immediate||(performance.now()>toastUntil&&!toastQueue.length))showToast(message);else if(toastQueue.at(-1)!==message&&$('toast').textContent!==message){toastQueue.push(message);if(toastQueue.length>6)toastQueue.shift();}}
function report(result,success='완료했습니다.') {if(result?.ok||result===true||result?.accepted===true)notify(success);else notify(result?.reason);renderPanel();}
const energyNames={mechanical:'역학',electrical:'전기',thermal:'열',chemical:'화학',magic:'마법',divine:'신성'};
const attackStyles={strike:'일반 타격',pierce:'관통 찌르기',impact:'충격 전달'};
let weaponPattern='weapon_slash',weaponMaterial='wood';
let deviceTarget=null,manualDeviceId=null,deviceAngleRad=0;
function clearInput(){keys.clear();panelPointers.clear();held.forward=held.side=0;held.jump=held.attack=held.descend=held.brake=false;manual=false;manualDeviceId=null;fixtureEnergyPanel?.stopManual();physical?.objectPhysics.release();for(const id of Object.keys(angles))delete angles[id];$('stick').style.transform='';}
function attack(){
 if(!ready||panelOpen||menuOpen)return;
 if(physical.objectPhysics.held){report(physical.objectPhysics.throwHeld(),'물체를 던졌습니다.');held.attack=false;return;}
 if(runtime.drivingMachineId){const hit=view.aim({range:24,excludeOwnerId:runtime.drivingMachineId}),r=runtime.fireMachine(hit);if(r.ok&&!r.duplicate&&!r.blocked)view.flashTrace(r.packet.rayOrigin,hit.point);else if(!r.ok&&performance.now()>toastUntil&&!['cooldown','fire_cooldown'].includes(r.reason))notify(r.reason);return;}
 const type=runtime.player.attackEnergy,hit=view.aim();
 const result=type?runtime.energyStrike(hit,type,25,{magicAttribute:runtime.player.magicAttribute??null}):runtime.strike(hit);
 if(result.ok||result.accepted){const amount=result.hpLost??result.damage;if(result.gimmick)hitFlash={text:`장치 내구 ${Math.ceil(result.remainingHp)}`,until:performance.now()+900};else if(Number.isFinite(amount)&&amount>0)hitFlash={text:`피해 ${amount.toFixed(1)}`,until:performance.now()+700};}
 else if(!['공격 준비 중','attack_cooldown'].includes(result.reason)&&performance.now()>toastUntil)notify(result.reason??'지금은 피해를 줄 수 없습니다.');
}
async function placeEquipment(id){
 const x=runtime.player.x-Math.sin(runtime.player.yaw)*3,z=runtime.player.z-Math.cos(runtime.player.yaw)*3;
 const result=await runtime.placements.place(id,{x,y:runtime.surfaceHeight(x,z),z},{actorPosition:runtime.player});report(result,'설비를 설치했습니다.');
}
function driveMachine(id){
 const m=runtime.machines.machines.get(id);if(!m||distance(runtime.player,m.position)>5||!m.components.some(c=>c.componentId==='controller'))return {ok:false,reason:'가까운 조종 장치가 필요합니다.'};
 runtime.drivingMachineId=id;runtime.machines.control(id,{throttle:0,steer:0,brake:false});showPanel(false);notify('이동 입력으로 조종합니다. 점프는 상승, 하강·제동 버튼(Shift·Ctrl)으로 조절하고 사용으로 내립니다.');return {ok:true};
}
function leaveMachine(){
 const m=runtime.machines.machines.get(runtime.drivingMachineId);if(m)runtime.machines.control(m.id,{throttle:0,steer:0,pitch:0,brake:true});
 runtime.drivingMachineId=null;runtime.player.vy=0;notify('조종을 마쳤습니다.');
}
function save(){if(!ready)return false;try{autosave.writeNow(runtime.serialize());$('saveStatus').textContent='현재 탐험을 저장했습니다.';return true;}catch(e){$('saveStatus').textContent=e.message;notify('저장하지 못했습니다. 이전 정상 저장은 보존됩니다.');return false;}}
function showPanel(value){panelOpen=value;clearInput();$('panel').classList.toggle('hidden',!value);if(value){runtime.player.resting=false;renderPanel();}}
function showMenu(value){menuOpen=value;$('menu').classList.toggle('hidden',!value);clearInput();if(value){updates?.refresh();save();}}
function row(title,detail,label,callback,disabled=false,extra=[]){const el=document.createElement('article');el.className='row';const copy=document.createElement('div');copy.className='copy';const b=document.createElement('b');b.textContent=title;const p=document.createElement('p');p.textContent=detail;copy.append(b,p);el.append(copy);
 const buttons=[...(label?[[label,callback,disabled]]:[]),...extra].map(([text,onclick,off=false])=>{const button=document.createElement('button');button.textContent=text;button.disabled=off;button.onclick=onclick;return button;});
 if(buttons.length>1){const group=document.createElement('div');group.className='actions';group.append(...buttons);el.append(group);}else if(buttons.length)el.append(buttons[0]);return el;}
function bar(card,percent){const track=document.createElement('div'),fill=document.createElement('span');track.className='progress-bar';fill.style.width=`${Math.max(0,Math.min(100,percent)).toFixed(1)}%`;track.append(fill);card.querySelector('.copy').append(track);}
function itemDetail(id,d,n){
 const p=runtime.progression;
 if(d.kind==='material')return `${d.tier}티어 · ${d.unit}`;if(d.kind==='gear_baseline')return '무기·방호구 장구 세트';
 if(d.kind==='tool'){const max=d.durabilityActions;if(!max)return '소지하면 해당 자원 채집에 사용합니다.';const left=p.toolWear[id]??max,spare=Math.max(0,Math.floor(n+1e-9)-1);return `채집 도구 · 사용 중인 도구 내구 ${left}/${max}${spare?` · 예비 ${spare}개`:''} · 다 닳으면 예비 도구로 바뀝니다.`;}
 if(id==='food')return `먹으면 식량이 최대 ${runtime.calorieRule.foodCalories} CP 회복됩니다.`;if(id.startsWith('blueprint:'))return '스스로 마친 연구의 기록 문서입니다. 읽어도 새 연구는 열리지 않습니다.';
 return d.unit?`단위 ${d.unit}`:'';
}
function rewardText(result){
 const items=Object.fromEntries(Object.entries(result.items??{}).filter(([id])=>!id.startsWith('blueprint:')));
 const parts=[Object.keys(items).length?quantities(items):'',...(result.unlocked??[]).map(id=>`연구 해금: ${name(id)}`),result.energy?`신성 ${result.energy} EU`:''].filter(Boolean);
 return parts.join(' · ')||'보상 없음';
}
function renderQueue(list){
 const p=runtime.progression;if(!p.jobs.length)return;
 const head=document.createElement('article');head.className='machine-card';const title=document.createElement('b'),hint=document.createElement('p');
 title.textContent=`작업 대기열 ${p.jobs.length}`;hint.textContent='맨 앞의 작업만 진행됩니다. 막힌 작업은 다른 작업을 먼저 진행하거나 취소하세요. 취소하면 재료를 돌려받지만 이미 쓴 에너지는 돌아오지 않습니다.';head.append(title,hint);list.append(head);
 p.jobs.forEach((job,index)=>{
  const s=p.jobStatus(job),label=job.type==='craft'?`${name(job.recipeId)}${job.count>1?' × '+job.count:''}`:name(job.activityId),percent=s.total?s.progress/s.total*100:0;
  const energy=Object.entries(s.energy).map(([t,n])=>`${energyNames[t]} ${n.toFixed(1)} EU/s`).join(' · '),fixture=p.worldFixtures.find(f=>f.ownerId===s.fixtureId);
  const stalled=index===0&&!s.blocked&&jobWatch.id===job.id&&performance.now()-jobWatch.since>2000;
  const state=index>0?'대기 중':s.blocked?`멈춤 · ${reasonText(s.blocked)}`:stalled?`멈춤 · ${reasonText(energy?'energy_waiting':'insufficient_resources')}`:'진행 중';
  const card=row(label,`${state} · ${percent.toFixed(0)}% (${s.progress.toFixed(1)}/${s.total}초)${energy?' · 필요 '+energy:''}${fixture?' · 설비 '+name(fixture.assetId):''}`,job.type==='craft'?'취소':'',()=>report(p.cancelJob(job.id,{claimId:runtime.id('cancel-job')}),'작업을 취소하고 재료를 돌려받았습니다.'),false,index>0?[['먼저 진행',()=>report(p.prioritizeJob(job.id),'이 작업을 먼저 진행합니다.')]]:[]);
  bar(card,percent);list.append(card);
 });
}

function renderPanel(){
 if(!ready||!panelOpen)return;const p=runtime.progression,list=$('panelList'),term=$('search').value.trim().toLowerCase(),scrollTop=list.scrollTop;list.replaceChildren();
 const append=(title,detail,label,action,disabled,extra)=>{if(!term||title.toLowerCase().includes(term))list.append(row(title,detail,label,action,disabled,extra));};
 document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
 if(tab==='inventory'){
  for(const[id,n]of Object.entries(p.inventory)){const d=p.catalog.get(id);let label='',action;
   if(id==='food'){label='먹기';action=()=>report(runtime.eat(),'음식을 먹었습니다.');}
   else if(d.kind==='gear_baseline'){label=p.equipped===id?'장착 중':'장착';action=()=>report(p.equip(id),'장구를 장착했습니다.');}
   else if(d.kind==='station'){label='앞에 설치';action=()=>placeEquipment(id).catch(e=>notify(e.message));}
   else if(d.kind==='component'){label='거점에 설치';action=()=>placeEquipment(id).catch(e=>notify(e.message));}
   append(`${d.name} × ${Number(n.toFixed(2))}`,itemDetail(id,d,n),label,action,p.equipped===id);
  }
  if(Object.keys(p.overflow).length)append('보관 중인 물품',quantities(p.overflow),'받기',()=>report(p.reclaim(),'가방의 빈 공간에 받았습니다.'));
  if(!list.childNodes.length)list.append(row('가방이 비어 있습니다.','주변의 나뭇가지와 돌에 가까이 가서 사용·채집을 누르세요.'));
 }else if(tab==='craft'){
  renderQueue(list);
  for(const r of p.list('recipe')){const status=p.recipeStatus(r.id),batch=Object.fromEntries(Object.entries(r.inputs).map(([id,n])=>[id,n*5]));append(r.name,`${quantities(r.inputs)} → ${quantities(r.outputs)}\n${name(r.station)} · ${r.seconds}초${r.research?' · 연구: '+name(r.research):''}${!status.ok?' · '+reasonText(status.reason):''}`,'제작',()=>report(p.queueCraft(r.id),'제작을 시작했습니다.'),!status.ok,[['5개',()=>report(p.queueCraft(r.id,{count:5}),'5개 제작을 대기열에 넣었습니다.'),!status.ok||!p.hasItems(batch)]]);}
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
  append(q.name??'무기 제작',q.inputs?`${quantities(q.inputs)} · ${name(q.station)} · ${q.seconds}초\n피해 ${q.hitDamage.toFixed(1)} · 사거리 ${q.range}m · ${q.attackPeriod}초 간격${q.ok?'':' · '+reasonText(q.reason)}`:reasonText(q.reason),'제작',()=>report(runtime.armaments.craft(weaponPattern,weaponMaterial),'무기를 제작하고 있습니다.'),!q.ok);
  for(const w of runtime.armaments.weapons)append(w.name,`${name(w.materialId)} · 내구 ${w.durability}/${w.maxDurability} · 피해 ${w.hitDamage.toFixed(1)} · ${attackStyles[w.attackMode]}`,runtime.armaments.equippedId===w.id?'해제':'장착',()=>report(runtime.armaments.equip(runtime.armaments.equippedId===w.id?null:w.id),'무기 장착을 변경했습니다.'));
  for(const job of runtime.armaments.jobs??[])append('무기 제작 중',`${job.name??name(job.materialId)} · 작업대에서 제작을 진행합니다.`);
 }else if(tab==='research'){
  const job=p.researchJob,current=job&&p.catalog.get(job.id);
  if(current){const progress=p.researchProgress[current.id]??{work:0},waiting=!p._station(current.station),card=row(`연구 중 · ${current.name}`,`${progress.work.toFixed(1)}/${current.work} 연구량${waiting?' · '+reasonText('research_station_required'):''}${p.workCredits>0?` · 작업권 ${p.workCredits.toFixed(1)}`:''} · 멈춰도 진행도는 보존됩니다.`,'멈추기',()=>report(p.pauseResearch(),'연구를 멈췄습니다. 진행도는 보존됩니다.'));bar(card,progress.work/current.work*100);list.append(card);}
  else if(p.workCredits>0)append('발견 작업권',`${p.workCredits.toFixed(1)} 연구량 · 다음 자체 연구에 먼저 사용됩니다.`);
  for(const r of p.list('research')){const known=p.research.has(r.id),status=p.researchStatus(r.id),progress=p.researchProgress[r.id],running=job?.id===r.id,paid=!!progress?.paid;
   const label=known?'완료':running?'진행 중':paid?(job?'전환해 이어서':'이어서 연구'):(job?'전환해 연구':'연구');
   append(r.name,`표본: ${paid?'지불 완료':quantities(r.samples)} · ${r.work} 연구량${paid&&!known?` · 진행 ${(progress.work/r.work*100).toFixed(0)}%`:''}${r.station?' · 설비: '+name(r.station):''}${r.prerequisites.length?' · 선행: '+r.prerequisites.map(name).join(', '):''}${!known&&!status.ok?' · '+reasonText(status.reason):''}`,label,()=>{if(job&&job.id!==r.id)p.pauseResearch();report(p.startResearch(r.id),paid?'연구를 이어서 진행합니다.':'표본을 사용해 연구를 시작했습니다.');},known||running||!status.ok);}
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
  for(const d of runtime.nearbyStructures){const def=CONTENT.structures.entries.find(e=>e.id===d.templateId),rewards=runtime.dungeons.anchors(d.id).filter(a=>a.kind==='reward'),origin={x:d.origin[0],y:d.origin[1],z:d.origin[2]};
   append(def.name,`장소 ${d.tier}티어 · 지역 ${d.regionTier}티어 · 출발지로부터 ${Math.round(Math.hypot(d.origin[0],d.origin[2]))}m · 지금 ${Math.round(distance(runtime.player,origin))}m ${runtime.directionTo(origin)} · 탐색한 방 ${d.visitedRooms.length}/${def.rooms.length}${def.puzzle?` · ${def.puzzle.name} ${d.deviceState?.solved||d.puzzle?.phase==='open'?'해결':'미해결'}`:''}${d.boss?` · 수호자 ${d.boss.defeated?'격파':'생존'}`:''}${rewards.length?' · '+rewards.map(a=>`${a.name} ${a.claimed?'회수함':'남음'}`).join(', '):''}`);}
  for(const d of runtime.deaths.filter(d=>!d.recovered))append('요정이 지키는 소지품',`${Math.round(distance(runtime.player,d.position))}m ${runtime.directionTo(d.position)} · ${quantities(d.items)}${d.weapons?.length?' · 무기 '+d.weapons.length+'개':''} · 10m 안에 가면 돌려받습니다.`);
 }
 list.scrollTop=scrollTop;
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
 const details=[];
 if(status.work&&(status.work.progressM>0||status.work.progressEU>0))details.push(`작업 진행 ${status.work.progressM.toFixed(2)} m · ${status.work.progressEU.toFixed(1)} EU`);
 if(status.altar)details.push(`제단 ${status.altar.aligned?'정렬됨':'정렬 필요'}${Number.isFinite(status.altar.healthHp)?` · 내구 ${Math.ceil(status.altar.healthHp)}/${status.altar.maxHealthHp}`:''}`);
 if(status.fluid)details.push(`${name(status.fluid.type)} 원천 ${status.fluid.sourceLiters.toFixed(1)} L · 수신 ${status.fluid.receiverLiters.toFixed(1)} L${status.fluid.spilledLiters>0?` · 유출 ${status.fluid.spilledLiters.toFixed(1)} L`:''} · ${status.fluid.route==='receiver'?'수신조로 흐름':'기본 경로'}`);
 if(status.heat)details.push(`통로 ${Math.round(status.heat.temperatureC)}°C · 냉각수 ${status.heat.coolantLiters.toFixed(1)} L · 밸브 ${status.heat.valveOpen?'열림':'닫힘'}`);
 if(status.wind)details.push(`풍향판 ${status.wind.locked?'고정됨':'고정 안 됨'}`);
 if(status.motion)details.push(`운반대 목표 ${Number(status.motion.targetM??4).toFixed(1)} m`);
 for(const part of status.parts??[])details.push(`${name(part.componentId)} ${part.installed?`내구 ${Math.ceil(part.healthHp)}/${part.maxHealthHp}`:'미설치'}`);
 if(details.length)append('장치 세부',details.join('\n'));
 if(status.wind){
  const control=document.createElement('label');control.className='row';control.textContent=`풍향판 ${Math.round(status.wind.angleRad*180/Math.PI)}° · 횡풍 ${status.wind.forceN.toFixed(1)}N `;
  const select=document.createElement('select');select.setAttribute('aria-label','풍향판 설정 각도');for(const degrees of [0,45,90,135,180]){const option=document.createElement('option');option.value=degrees*Math.PI/180;option.textContent=degrees+'°';select.append(option);}
  select.value=deviceAngleRad;select.onchange=()=>deviceAngleRad=Number(select.value);control.append(select);list.append(control);
 }
 for(const a of status.actions??[]){
  if(a.hold){
   const card=row(a.label,typeof a.detail==='string'?a.detail:quantities(a.items),'누르고 조작',()=>{},a.disabled),button=card.querySelector('button');
   button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);const r=devices.act(deviceTarget,a.id,{position:runtime.player,progression:p,claimId:runtime.id('device')});if(r.ok){manualDeviceId=deviceTarget;held.attack=false;}else report(r);};
   button.onpointerup=button.onpointercancel=()=>{manualDeviceId=null;renderPanel();};list.append(card);
  }else append(typeof a.detail==='string'&&p.catalog.has(a.detail)?a.label.replace(a.detail,name(a.detail)):a.label,a.id==='set_vane'?'위의 풍향판 설정 각도로 맞춥니다.':typeof a.detail==='string'&&!p.catalog.has(a.detail)?a.detail:quantities(a.items),'조작',()=>report(devices.act(deviceTarget,a.id,{position:runtime.player,progression:p,claimId:runtime.id('device'),angleRad:deviceAngleRad}),'장치를 조작했습니다.'),a.disabled);
 }
 const anchor=nearby.find(a=>a.instanceId===deviceTarget);
 for(const node of p.fixtureEnergy.nodes.values()){
  const pos=Array.isArray(node.position)?{x:node.position[0],y:node.position[1],z:node.position[2]}:node.position;
  if(!pos||distance(pos,anchor.position)>8)continue;
  const ports=p.fixtureEnergy.ports(node.ownerId);
  for(const type of ports.outputs.filter(t=>ports.stores.includes(t)))append(`${energyNames[type]} 공급 연결`,`${name(node.assetId??node.definitionId??node.ownerId)} · 케이블 재료를 사용합니다.`,'연결',()=>report(devices.connectSupply(inst.id,node.ownerId,type,{progression:p,claimId:runtime.id('device-link')}),'장치에 공급선을 연결했습니다.'));
 }
 for(const supply of status.supplies??[])append(`${energyNames[supply.type]} 공급`,`${supply.valid?'연결됨':'연결 끊김 · 분리한 뒤 다시 연결하세요.'} · 공급기 ${Number(supply.storedEU??0).toFixed(1)} EU · 장치 ${Number(supply.deviceEU??0).toFixed(1)} EU`,'25 EU 전달',()=>report(devices.charge(inst.id,supply.type,25,{progression:p,claimId:runtime.id('device-charge')}),'저장된 에너지를 전달했습니다.'),!supply.valid||supply.storedEU<25,[['공급선 분리',()=>report(devices.disconnectSupply(inst.id,supply.type,{progression:p}),'공급선을 분리했습니다. 케이블 재료는 돌아오지 않습니다.')]]);
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
 const priority=a=>a.kind==='reward'&&!a.claimed?0:a.kind==='gimmick'?1:a.kind==='reward'?3:2;
 const at=a=>Array.isArray(a.position)?{x:a.position[0],y:a.position[1],z:a.position[2]}:a.position;
 const anchors=runtime.dungeons.nearbyAnchors(runtime.player,3).filter(a=>!['spawn','producer','boss','entrance'].includes(a.kind)).sort((a,b)=>priority(a)-priority(b)||distance(runtime.player,at(a))-distance(runtime.player,at(b)));
 if(anchors.length){const a=anchors[0];if(a.kind==='gimmick'){report(runtime.beginGimmick(a),'장치를 조작하고 있습니다.');return;}
  if(a.kind==='puzzle'){deviceTarget=a.instanceId;tab='devices';showPanel(true);return;}
  const result=runtime.dungeons.interact(a.instanceId,a.id,{position:runtime.player,progression:runtime.progression});
  if(result.kind==='service'){communityTarget=a.instanceId;tab='community';showPanel(true);}
  else if(a.kind==='reward')result.ok?notify(result.duplicate?'이미 회수한 보상입니다.':`${a.name} 회수 · ${rewardText(result)}`):notify(result.reason);
  else if(result.kind==='inspect')notify(`관찰 ${result.observed.length}/2${result.solved?' · 연구 기록 보관함을 열 수 있습니다.':''}`);
  else report(result,'살펴보았습니다.');return;
 }
 const n=runtime.terrainResource(hit)??nearestNode();if(n&&(n.distance??distance(runtime.player,n))<5)report(runtime.beginHarvest(n),'채집하고 있습니다.');else notify('대상 가까이에서 사용하세요.');
}
function bind(){
 $('attackMode').onclick=()=>{const modes=Object.keys(attackStyles),mode=modes[(modes.indexOf(runtime.player.attackStyle??'strike')+1)%modes.length];runtime.player.attackStyle=mode;notify(mode==='pierce'?'외피를 관통해 안쪽 부위를 노립니다.':mode==='impact'?'충격을 가까운 내부 부위로 전달합니다.':'접촉한 부위를 타격합니다.');hud();};
 $('openBag').onclick=()=>showPanel(!panelOpen);$('closePanel').onclick=()=>showPanel(false);
 $('openMenu').onclick=()=>showMenu(true);$('closeMenu').onclick=()=>showMenu(false);$('save').onclick=()=>{if(save())notify('저장했습니다.');};
 $('leave').onclick=()=>{if(save())location.href='worlds.html';};$('rest').onclick=()=>{runtime.player.resting=true;showMenu(false);notify('휴식 중입니다. 이동하거나 공격하면 휴식을 끝냅니다.');};
 $('panelList').addEventListener('pointerdown',e=>panelPointers.add(e.pointerId));
 for(const type of ['pointerup','pointercancel'])window.addEventListener(type,e=>panelPointers.delete(e.pointerId));
 $('search').oninput=renderPanel;document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{manual=false;manualDeviceId=null;tab=b.dataset.tab;$('panelList').scrollTop=0;renderPanel();});
 $('use').onclick=interact;$('stance').onclick=()=>{const p=runtime.player;p.desiredStance=p.desiredStance==='stand'?'crouch':p.desiredStance==='crouch'?'crawl':'stand';$('stance').textContent={stand:'웅크리기',crouch:'기어가기',crawl:'일어서기'}[p.desiredStance];};
 $('sprint').onclick=()=>{held.sprint=!held.sprint;$('sprint').setAttribute('aria-pressed',String(held.sprint));};
 for(const[id,property]of [['jump','jump'],['attack','attack'],['descend','descend'],['brake','brake']]){const el=$(id);el.onpointerdown=e=>{held[property]=true;angles[e.pointerId]={x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);};el.onpointermove=e=>look(e);el.onpointerup=el.onpointercancel=e=>{held[property]=false;delete angles[e.pointerId];};}
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
const HAZARDS={heat:'고온',acid_fluid:'산성 액체',water:'깊은 물',ecology_water:'저수조 물',crosswind:'강한 횡풍',mana_pressure:'마나 압력',moving_platform:'움직이는 운반대'};
function bossPartLabel(entity,partId){
 const def=runtime.bosses.definitionFor(entity),part=def.parts.find(x=>x.id===partId)??def.parts.find(x=>partId&&String(partId).includes(x.id)),state=part&&entity.parts?.[part.id];
 const shell=Object.values(entity.shell??{}).reduce((n,v)=>n+Math.max(0,v),0);
 return `${part?` · ${part.name} ${state?.broken?'파손':`${Math.min(100,(state?.damage??0)/part.breakThresholdHp*100).toFixed(0)}%`}`:''}${shell>0?` · 외피 ${shell.toFixed(0)} EU`:''}${entity.staggerS>0?' · 비틀거림':''}`;
}
function aimTargetLabel(hit){
 if(!hit||hit.distance>6)return '';
 if(hit.kind==='fixture'){const f=runtime.placements.records.get(hit.id);return f?`${name(f.assetId)} · HP ${Math.ceil(f.hp)}/${f.maxHp} · 사용: 설비 패널`:'';}
 if(hit.kind==='machine'){const m=runtime.machines.machines.get(hit.id);return m?`${m.name} · 사용: 기계 패널`:'';}
 if(hit.kind==='object'&&hit.distance<4)return '떨어진 물체 · 사용: 잡기 · 공격: 깎기';
 return '';
}
function anchorPrompt(){
 const a=runtime.dungeons.nearbyAnchors(runtime.player,3).find(a=>['reward','gimmick','puzzle','inspect','service'].includes(a.kind));if(!a)return '';
 if(a.kind==='reward')return `${a.name} · ${a.claimed?'회수함':'사용해서 회수'}`;
 if(a.kind==='gimmick'){const b=runtime.bosses.get(a.bossInstanceId),g=b?.gimmicks?.[a.gimmickId];if(!b||b.defeated||!g)return '';return g.broken||g.uses<=0?'전장 장치 · 이미 사용함':`전장 장치 · 사용: 작동 · 공격: 파괴 (내구 ${Math.ceil(g.hp)})`;}
 if(a.kind==='inspect')return `${a.name} · ${a.observed?'관찰함':'사용해서 관찰'}`;
 if(a.kind==='puzzle')return `${a.name} · 사용: 장치 패널`;
 return '공동체 시설 · 사용해서 이용';
}
function hud(){
 const p=runtime.player,g=runtime.progression,e=CONTENT.environments.entries.find(e=>e.id===runtime.region.environmentId);
 $('region').textContent=`${e?.name??''} · ${runtime.region.tier}티어 · 출발지 ${Math.round(Math.hypot(p.x,p.z))}m`;
 $('hp').textContent=`HP ${Math.ceil(p.hp)}/${p.maxHp}`;$('calories').textContent=`식량 ${Math.ceil(p.calories/p.maxCalories*100)}%`;
 $('objective').textContent=g.research.has('joinery')?'장비와 운반 구조물을 준비하고 동쪽의 저택을 탐험하세요.':g.research.has('observation')?'식물 섬유와 나뭇가지를 모아 구조와 접합을 연구하세요.':'주변의 나뭇가지와 돌을 모아 관찰과 기록을 연구하세요.';
 $('progress').textContent=`연구 ${g.research.size}/39 · ${p.resting?'휴식 중':'내 월드에서 저장을 이어갈 수 있습니다.'}`;
 $('use').textContent=runtime.drivingMachineId?'내리기':physical?.objectPhysics.held?'놓기':'사용·채집';
 const driving=!!runtime.drivingMachineId;$('jump').textContent=driving?'상승':'점프';
 for(const[id,visible]of [['descend',driving],['brake',driving],['sprint',!driving],['stance',!driving]])$(id).classList.toggle('hidden',!visible);
 $('attack').textContent=physical?.objectPhysics.held?'던지기':runtime.drivingMachineId?'무장 발사':runtime.player.attackEnergy?`${energyNames[runtime.player.attackEnergy]} 공격`:'공격';
 const weapon=runtime.armaments.loadout();$('attackMode').textContent=`공격 방식: ${attackStyles[weapon?.attackMode??p.attackStyle??'strike']}`;$('attackMode').disabled=!!weapon;
 const hit=view.aim(),node=nearestNode(),entity=hit?.kind==='creature'?runtime.creatures.get(hit.id):hit?.kind==='boss'?runtime.bosses.get(hit.id):null;
 $('aimLabel').textContent=entity?`${hit.kind==='boss'?runtime.bosses.definitionFor(entity).name:name(entity.speciesId)} · HP ${Math.ceil(entity.hp)}/${entity.maxHp}${hit.kind==='boss'?` · ${entity.encounterTier}티어 · ${runtime.bosses.phase(entity).name}${bossPartLabel(entity,hit.partId)}`:''}`:aimTargetLabel(hit)||(node?.distance<5?`${name(node.sourceId)} · 사용해서 채집`:'')||anchorPrompt();
 const warning=runtime.activeWarning(),hazards=runtime.dungeons.devices?.sampleAt?.(p)?.hazards??[];
 $('warning').textContent=warning?.text??(hazards.length?`위험 구역: ${hazards.map(h=>HAZARDS[h]??h).join(' · ')}`:'');
 const a=runtime.harvestAction,b=runtime.interactionAction,manualStatus=manualDeviceId?runtime.dungeons.devices.status(manualDeviceId,{progression:g}):null;
 $('actionProgress').textContent=a?`${name(a.sourceId)} ${a.elapsed.toFixed(1)}/${g.catalog.get(a.sourceId).seconds}초`:b?`장치 조작 ${b.elapsed.toFixed(1)}/${b.seconds}초`:manualStatus?`${manualStatus.summary}${manualStatus.work?.progressM>0?` · 진행 ${manualStatus.work.progressM.toFixed(2)} m`:''}`:hitFlash&&performance.now()<hitFlash.until?hitFlash.text:'';
 const firstJob=g.jobs[0];if(firstJob?.id!==jobWatch.id||firstJob.progress!==jobWatch.progress)jobWatch={id:firstJob?.id??null,progress:firstJob?.progress??0,since:performance.now()};
 for(const message of runtime.messages.splice(0))notify(message,false);
 if(performance.now()>toastUntil){if(toastQueue.length)showToast(toastQueue.shift());else $('toast').classList.remove('show');}
}
function frame(now){
 const dt=Math.min(.1,(now-(last||now))/1000);last=now;
 if(ready&&!document.hidden){
  if(!menuOpen){accum+=dt;while(accum>=FIXED_DT){
   const input=panelOpen?{}:{forward:held.forward+Number(keys.has('KeyW'))-Number(keys.has('KeyS')),side:held.side+Number(keys.has('KeyD'))-Number(keys.has('KeyA')),jump:held.jump||keys.has('Space'),sprint:keys.has('ShiftLeft')||held.sprint,speedScale:runtime.bosses.targetEffects(runtime.player).speedMultiplier};
   const before={...runtime.player};if(input.forward||input.side||held.attack)runtime.player.resting=false;
   const driving=runtime.machines.machines.get(runtime.drivingMachineId);
   if(driving)runtime.machines.control(driving.id,{throttle:input.forward||0,steer:-(input.side||0),pitch:Number(!!input.jump)-Number(keys.has('ShiftLeft')||held.descend),brake:keys.has('ControlLeft')||held.brake});
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
  view.syncTerrain();view.syncModels(runtime.descriptors(),runtime.time,dt);fragments.sync(view.models);physical?.synchronize(view.models,runtime.player);bossView.sync(runtime.bosses);environmentView.sync(runtime.player,runtime.time);equipmentView.sync(runtime,dt);feedbackView.sync(runtime,dt);anchorMarkers.sync(runtime,dt);
  view.draw(runtime.player,controller.eye);hudClock+=dt;tabClock+=dt;if(hudClock>.2){hudClock=0;hud();}if(tabClock>1&&!manual&&!manualDeviceId&&!panelPointers.size){tabClock=0;if(!document.activeElement?.matches('#panelList input, #panelList select, #panelList textarea'))renderPanel();}
  updates.frame(true,now);
 }
 requestAnimationFrame(frame);
}
const loading=window.FeralLoading??{set(){},step(){},finish(){},fail(){},timings:[]};
// Yield one frame so each stage label paints before the next synchronous step runs.
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
async function stage(text,percent){loading.set(text,percent);await paint();}
const LOAD_STEPS={world:['세계와 생태계를 구성하는 중',55],placements:['설치한 설비를 불러오는 중',65]};
async function boot(){
 await stage('저장을 확인하는 중',6);
 const world=currentWorld(localStorage,'expedition',location.search);saveStore=new ExpeditionSave(localStorage,saveKey(world));const saved=saveStore.load();
 await stage('건축물 모델을 불러오는 중',10);
 runtime=await ExpeditionRuntime.create(world.seed,saved,{pause:paint,onProgress:(step,done,total)=>step==='assets'?loading.step(`건축물 모델을 불러오는 중 ${done}/${total}`,10+40*done/total):loading.set(...LOAD_STEPS[step])});
 await stage('장면을 준비하는 중',72);
 view=new ExpeditionScene($('scene'),runtime.atlas);controller=new CharacterController(runtime.terrain,runtime.player);
 autosave=new Autosave(saveStore,{onSaved:()=>{$('saveStatus').textContent='현재 탐험을 저장했습니다.';},onError:error=>{$('saveStatus').textContent=error.message;notify('자동 저장하지 못했습니다. 이전 정상 저장은 보존됩니다.');}});
 bossView=new BossView(view);equipmentView=new EquipmentView(view);feedbackView=new FeedbackView(view);anchorMarkers=new AnchorMarkers(view);
 environmentView=new EnvironmentView(view,runtime.atlas);machinePanel=new MachinePanel(runtime,{report,drive:driveMachine});fixtureEnergyPanel=new FixtureEnergyPanel(runtime,{report,onManual:value=>{manual=value;if(value)held.attack=false;}});
 updates=initUpdates({beforeApply:save});
 await stage('물리 엔진을 준비하는 중',82);
 const {RuntimePhysics}=await import('./physics.js');physical=await RuntimePhysics.create(runtime,view);
 await stage('탐험을 시작하는 중',95);
 runtime.physics=physical;runtime.terrain.hasAttackLineOfSight=(a,b,options)=>runtime.lineOfSight(a,b)&&(physical.hasAttackLineOfSight?.(a,b,options)??true);
 fragments=new CreatureFragments(CONTENT,runtime.creatures,runtime.objects,{getModelRecord:id=>view.models.get(id),getPartPhysics:(owner,part)=>physical.getPartPhysics?.(owner,part)});
 ready=true;bind();loading.finish();$('loading').classList.add('hidden');
 window.FERAL={ready:true,bootTimings:loading.timings,runtime,view,controller,physics:physical,save,stats:()=>({running:ready&&!menuOpen,rewardMarkers:anchorMarkers.markers.size,warning:$('warning').textContent,toast:$('toast').textContent,version:VERSION.version,versionCode:VERSION.versionCode,player:{...runtime.player},regions:runtime.seenRegions.size,models:view.models.size,chunks:runtime.atlas.activeChunks.size})};
 window.FeralNative={save,pause:()=>showMenu(true)};
 requestAnimationFrame(frame);
}
boot().catch(e=>{loading.fail(`세계 준비를 완료하지 못했습니다: ${e.message}`);$('loadingText').textContent=`세계 준비를 완료하지 못했습니다: ${e.message}`;console.error(e);window.AndroidApp?.runtimeFailed?.();});
