// Content expedition on the shared game screen: the same HUD, hotbar, bag, ledger window,
// menu, settings, notifications and controls as every other map.
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
import {MINING_PERIOD_S} from '../equipment.js';
import {FeedbackView} from './feedback-view.js';
import {FixtureEnergyPanel} from './fixture-energy-panel.js';
import {CreatureFragments} from './creature-fragments.js';
import {AnchorMarkers} from './anchor-markers.js';
import {ItemSlots,designCatalog} from './item-slots.js';
import {applyLegacyIsland} from './maps.js';
import {hitShapeFor} from './creature-animation.js';
import {VERSION} from '../version.js';
import {reasonText} from './reasons.js';
import {InventoryUI,drawHotbar} from '../inventory-ui.js';
import {HudEditor} from '../hud-editor.js';
import {installHUDArt,uiIcon} from '../ui-art.js';
import {createInput,createNotifier,showDiscovery,initSettings,bindMenuTabs,selectTab,showPauseScreen,bindBackground,installErrorScreen,mountFieldHUD,mountJourney,setJourney,setVitals,waypointText,GameWindow,renderCharacterSheet,renderMapPage,showMovementState,changeStance,changeSprint,SANDBOX_TOOLS} from '../shell.js';
const $=id=>document.getElementById(id);
const loading=window.FeralLoading??{set(){},step(){},finish(){},fail(){},timings:[]};
const notify=createNotifier($('toast'),{translate:reasonText});
let runtime,view,bossView,environmentView,equipmentView,feedbackView,machinePanel,fixtureEnergyPanel,fragments,anchorMarkers,controller,physical,saveStore,autosave,updates,slots,catalog,bag,ledger,journey,hudEditor,settings,world;
let ready=false,paused=false,last=0,accum=0,saveClock=0,hudClock=0,tabClock=0,fpsFrames=0,fpsTime=0,fps=0,sprintLatched=false,actionHeld=false,manual=false,manualDeviceId=null;
let communityTarget=null,deviceTarget=null,deviceAngleRad=0,weaponPattern='weapon_slash',weaponMaterial='wood',hitFlash=null,jobWatch={id:null,progress:0,since:0},destination=null,researchQuery='',bagSignature='';
const held={descend:false,brake:false},ledgerPointers=new Set(),discovered=new Set();
let sandboxTool=null,converted=null,minimapClock=0,buildSize=.5,miningSize=.5;const fieldLog=[];
const input=createInput({canControl:()=>ready&&!paused,isEditing:()=>hudEditor?.editing===true,rotateLook});
const energyNames={mechanical:'역학',electrical:'전기',thermal:'열',chemical:'화학',magic:'마법',divine:'신성'};
// How a blow lands follows what is held (runtime hitShapeFor); there is no manual attack style.
const HIT_SHAPES={point:'점타격 · 외피 파내기',slash:'베기 · 선·면 절단',pierce:'관통 · 공격 방향으로 깊숙이',impact:'충격 · 안쪽 뼈만'};
const heldShape=()=>hitShapeFor(runtime.armaments.loadout()?.weaponKind);
const HAZARDS={heat:'고온',acid_fluid:'산성 액체',water:'깊은 물',ecology_water:'저수조 물',crosswind:'강한 횡풍',mana_pressure:'마나 압력',moving_platform:'움직이는 운반대'};
// The frontier's ledger tabs first (여정·상태·지도·마을·기계), then the runtime's own pages.
const TABS=[
 {id:'journey',label:'여정',ariaLabel:'여정과 발견',icon:'journey'},
 {id:'status',label:'상태',ariaLabel:'캐릭터 상태',icon:'person'},
 {id:'map',label:'지도',ariaLabel:'탐험 지도',icon:'map'},
 {id:'community',label:'마을',ariaLabel:'공동체',icon:'village'},
 {id:'machine',label:'기계',ariaLabel:'기계 조립',icon:'tools'},
 {id:'research',label:'연구',icon:'research'},
 {id:'weapons',label:'무기',ariaLabel:'무기 제작',icon:'attack'},
 {id:'energy',label:'설비',ariaLabel:'설비와 에너지',icon:'energy'},
 {id:'devices',label:'장치',ariaLabel:'던전 장치',icon:'device'},
 {id:'faith',label:'신앙',ariaLabel:'신앙과 시련',icon:'faith'},
];
const TITLES={journey:'여정과 발견',status:'캐릭터 상태',map:'탐험 지도',research:'연구',weapons:'무기 제작',energy:'설비·에너지',machine:'기계 조립',community:'공동체',devices:'던전 장치',faith:'신앙·시련'};

function name(id){if(id==='hand')return '맨손';return runtime?.progression.catalog.get(id)?.name??CONTENT.creatures.entries.find(e=>e.id===id)?.name??CONTENT.bosses.entries.find(e=>e.id===id)?.name??id;}
function quantities(items){return Object.entries(items||{}).map(([id,n])=>`${name(id)} ${Number(n.toFixed(2))}`).join(' · ')||'없음';}
function report(result,success='완료했습니다.'){if(result?.ok||result===true||result?.accepted===true)notify(success);else notify(result?.reason);refreshPanels();}
function rotateLook(dx,dy){
 if(!ready||paused||hudEditor?.editing)return;const p=runtime.player;
 p.yaw-=dx*.003*settings.sensitivity;p.pitch=Math.max(-1.45,Math.min(1.45,p.pitch-dy*.003*settings.sensitivity));
}
function stopInput(){input.stop();sprintLatched=false;actionHeld=false;held.descend=held.brake=false;manual=false;manualDeviceId=null;fixtureEnergyPanel?.stopManual();physical?.objectPhysics.release();}
// The world keeps running while the bag or ledger is open (timed crafting, manual devices); the menu stops it.
function frozen(){return paused&&!ledger.isOpen&&!$('pauseScreen').classList.contains('inventoryMode');}
function pause(force,{quiet=false}={}){
 if(!ready)return;
 paused=force??!paused;stopInput();
 showPauseScreen(paused,hudEditor?.editing===true);
 if(!paused)ledger.close();
 if(paused){runtime.player.resting=false;updates?.refresh();updatePanels();if(!quiet)save();}
 else{last=performance.now();accum=0;}
}
// Opening the bag does not save: a full synchronous save of a large world would stall the tap.
function openBag(){pause(true,{quiet:true});selectTab('bag',updatePanels);}
function refreshPanels(){if(!ready)return;if(ledger?.isOpen)ledger.render();if(paused&&$('pauseScreen').classList.contains('inventoryMode'))bag.render();renderHotbar();}
function updatePanels(tab){
 if(!ready)return;
 const places=runtime.map.landmarks.length;
 $('foundCount').textContent=places?`${runtime.discoveredLandmarks.size} / ${places}`:`${runtime.nearbyStructures.filter(d=>d.visitedRooms.length).length}`;
 if(runtime.map.rules.sandbox){
  const alive=runtime.creatures.entities.filter(e=>!e.dead),count=id=>alive.filter(e=>e.speciesId===id).length,r=runtime.atlas.reactions;
  for(const [id,n]of [['herbCount',count('moss_deer')],['predCount',count('copper_fox')],['beetleCount',count('azure_beetle')],['grazed','—'],['birthDeath',`${[...(runtime.creatures.regions?.values?.()??[])].reduce((t,g)=>t+(g.births??0),0)} / ${runtime.creatures.entities.length-alive.length}`],['reactionCount',`${r.dissolvedCells} / ${r.burnedCells}`],['visibleCount',runtime.creatures.visibleEntities(runtime.player).length],['triangleCount',view.renderer.info.render.triangles.toLocaleString()],['benchFps',fps.toFixed(0)]])$(id).textContent=n;
 }
 $('elapsed').textContent=`${Math.floor(runtime.time/60)}:${String(Math.floor(runtime.time%60)).padStart(2,'0')}`;
 $('seedValue').textContent=world.seed;
 if(tab==='bag'||$('pauseScreen').classList.contains('inventoryMode'))bag.render();
 $('bagCount').textContent=slots.slots.filter(Boolean).length;
}

function selectHotbar(n){
 slots.select(n);sandboxTool=null;const id=slots.held,d=id&&runtime.progression.catalog.get(id);
 if(d?.kind==='gear_baseline'&&runtime.progression.equipped!==id){const r=runtime.progression.equip(id);if(r.ok)notify(`${d.name} 장착`);}
 renderHotbar();updateToolLabel();buttonLabels();
}
function renderHotbar(){if(slots)drawHotbar($('hotbar'),slots,catalog,selectHotbar);}
function updateToolLabel(){
 const id=slots.held,d=id&&runtime.progression.catalog.get(id),weapon=runtime.armaments.loadout(),wear=id&&catalog.durability(id);
 $('toolName').textContent=weapon?weapon.name:id?d.name:'빈 손';const gear=runtime.miningGear(id);
 $('toolHelp').textContent=weapon?`${HIT_SHAPES[hitShapeFor(weapon.weaponKind)]} · 내구 ${weapon.durability}/${weapon.maxDurability}`:wear?`도구 내구 ${wear.value}/${wear.max}`:id==='food'?'사용: 먹기':d?.kind==='station'||d?.kind==='component'?'사용: 앞에 설치':`채굴 ${miningSize>=1?'1 m':'0.5 m'} · ${gear.affinity==='rock'?'돌':gear.affinity==='wood'?'나무':'흙'}에 강함 ×${gear.power}`;
 if(sandboxTool!==null){$('toolName').textContent=SANDBOX_TOOLS[sandboxTool][0];$('toolHelp').textContent=SANDBOX_TOOLS[sandboxTool][1];}
 const block=runtime.buildableBlock(id);
 if(block&&sandboxTool===null)$('toolHelp').textContent=`보유 ${Number(runtime.progression.count(id).toFixed(2))} · 설치 ${buildSize>=1?8:1}칸 · ${CONTENT.blocks.entries.find(b=>b.id===block)?.name??block}`;
 $('rangeBtn').textContent=block?`설치 ${buildSize>=1?'1 m':'0.5 m'} ↻`:`채굴 ${miningSize>=1?'1 m':'0.5 m'} ↻`;
 syncHands(id,weapon);
}
// What the hands hold follows the hotbar, like the frontier: a tool shows its model, a block or material a
// small cube, an empty hand only the hands; an equipped weapon or gear shows while no tool is selected.
const HAND_TOOLS=new Set(['stone_pick','hand_knife','bark_cup']);
function syncHands(id,weapon){
 const g=runtime.progression,gear=g.equipped&&g.catalog.get(g.equipped)?.kind==='gear_baseline';
 runtime.heldToolId=HAND_TOOLS.has(id)?id:weapon||gear?null:'hand';
 view.setHands({armored:(g.evaluateLoadout().damageReduction??0)>0,heldId:id,showCube:!!id&&!HAND_TOOLS.has(id)});
}
// The range button sizes block placement while a buildable item is held, otherwise the mining region (frontier).
function cycleRange(){if(runtime.buildableBlock(slots.held))buildSize=buildSize>=1?.5:1;else miningSize=miningSize>=1?.5:1;updateToolLabel();buttonLabels();}

function attack(){
 if(!ready||paused)return;
 if(physical.objectPhysics.held){report(physical.objectPhysics.throwHeld(),'물체를 던졌습니다.');actionHeld=false;return;}
 if(runtime.drivingMachineId){const hit=view.aim({range:24,excludeOwnerId:runtime.drivingMachineId}),r=runtime.fireMachine(hit);if(r.ok&&!r.duplicate&&!r.blocked)view.flashTrace(r.packet.rayOrigin,hit.point);else if(!r.ok&&!notify.busy()&&!['cooldown','fire_cooldown'].includes(r.reason))notify(r.reason);return;}
 const type=runtime.player.attackEnergy,hit=view.aim({range:6.5});
 // Frontier: an empty hand pushes a detached piece, anything held cuts it.
 if(!type&&hit?.kind==='object'&&!slots.held&&!runtime.objects.get(hit.id)?.fragment){if(runtime.time-runtime.lastMine<MINING_PERIOD_S)return;runtime.lastMine=runtime.time;const r=physical.objectPhysics.push(hit.id,hit.point);if(r.ok)hitFlash={text:'밀기 · 질량에 따라 가속',until:performance.now()+700};return;}
 const result=type?runtime.energyStrike(hit,type,25,{magicAttribute:runtime.player.magicAttribute??null}):runtime.strike(hit,{toolId:slots.held,size:miningSize});
 if(result.mined){const got=quantities(result.items??{});hitFlash={text:got?`+ ${got}`:result.removed?'떨어져 나감':`균열 ${Math.round(result.progress*100)}%`,until:performance.now()+700};if(result.removed){renderHotbar();updateToolLabel();}return;}
 if(result.ok||result.accepted){const amount=result.hpLost??result.damage;if(result.gimmick)hitFlash={text:`장치 내구 ${Math.ceil(result.remainingHp)}`,until:performance.now()+900};else if(Number.isFinite(amount)&&amount>0)hitFlash={text:`피해 ${amount.toFixed(1)}`,until:performance.now()+700};}
 else if(!['공격 준비 중','attack_cooldown'].includes(result.reason)&&!notify.busy())notify(result.reason??'지금은 피해를 줄 수 없습니다.');
}
async function placeEquipment(id){
 const x=runtime.player.x-Math.sin(runtime.player.yaw)*3,z=runtime.player.z-Math.cos(runtime.player.yaw)*3;
 const result=await runtime.placements.place(id,{x,y:runtime.surfaceHeight(x,z),z},{actorPosition:runtime.player});report(result,'설비를 설치했습니다.');
}
// Use: the held item's own use (eat, place) first, otherwise interact with what is aimed at.
function secondary(){
 if(!ready||paused)return;
 const id=slots.held,d=id&&runtime.progression.catalog.get(id);
 if(physical.objectPhysics.held||runtime.drivingMachineId){interact();return;}
 if(sandboxTool!==null){useSandbox(sandboxTool);return;}
 // On sandbox maps an empty hand observes, like the original island; the interact button still interacts.
 if(!id&&runtime.map.rules.sandbox){observe(view.aim({range:8}));return;}
 if(id==='food'){report(runtime.eat(),'음식을 먹었습니다.');return;}
 if(runtime.buildableBlock(id)){const r=runtime.placeBlocks(view.aim({range:6.5}),id,buildSize);if(!r.ok)notify(r.reason);renderHotbar();return;}
 if(d?.kind==='station'||d?.kind==='component'){placeEquipment(id).catch(e=>notify(e.message));return;}
 interact();
}
function driveMachine(id){
 const m=runtime.machines.machines.get(id);if(!m||distance(runtime.player,m.position)>5||!m.components.some(c=>c.componentId==='controller'))return {ok:false,reason:'가까운 조종 장치가 필요합니다.'};
 runtime.drivingMachineId=id;runtime.machines.control(id,{throttle:0,steer:0,brake:false});pause(false);notify('이동 입력으로 조종합니다. 점프는 상승, 하강·제동 버튼(Shift·Ctrl)으로 조절하고 상호작용으로 내립니다.');return {ok:true};
}
function leaveMachine(){
 const m=runtime.machines.machines.get(runtime.drivingMachineId);if(m)runtime.machines.control(m.id,{throttle:0,steer:0,pitch:0,brake:true});
 runtime.drivingMachineId=null;runtime.player.vy=0;notify('조종을 마쳤습니다.');
}
function save(){
 if(!ready)return false;
 try{autosave.writeNow(snapshot());$('saveState').textContent='SAVED '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});return true;}
 catch(e){$('saveState').textContent='SAVE FAILED';notify('저장하지 못했습니다. 이전 정상 저장은 보존됩니다.');return false;}
}
function snapshot(){return {...runtime.serialize(),itemSlots:slots.serialize(),editGrid:{miningSize,buildSize}};}
function nearestNode(){return runtime.nodes.filter(n=>isResourceAvailable(runtime,n)).map(n=>({...n,distance:distance(runtime.player,n)})).sort((a,b)=>a.distance-b.distance)[0];}
const anchorPoint=a=>Array.isArray(a.position)?{x:a.position[0],y:a.position[1],z:a.position[2]}:a.position;
function nearbyAnchors(){
 const priority=a=>a.kind==='reward'&&!a.claimed?0:a.kind==='gimmick'?1:a.kind==='reward'?3:2;
 return runtime.dungeons.nearbyAnchors(runtime.player,3).filter(a=>!['spawn','producer','boss','entrance'].includes(a.kind)).sort((a,b)=>priority(a)-priority(b)||distance(runtime.player,anchorPoint(a))-distance(runtime.player,anchorPoint(b)));
}
function rewardText(result){
 const items=Object.fromEntries(Object.entries(result.items??{}).filter(([id])=>!id.startsWith('blueprint:')));
 const parts=[Object.keys(items).length?quantities(items):'',...(result.unlocked??[]).map(id=>`연구 해금: ${name(id)}`),result.energy?`신성 ${result.energy} EU`:''].filter(Boolean);
 return parts.join(' · ')||'보상 없음';
}
function interact(){
 if(!ready||paused)return;const hit=view.aim();
 if(physical.objectPhysics.held){physical.objectPhysics.release();notify('물체를 놓았습니다.');return;}
 if(runtime.drivingMachineId){leaveMachine();return;}
 if(hit?.kind==='machine'){machinePanel.selected=hit.id;ledger.open('machine');return;}
 if(hit?.kind==='fixture'&&hit.distance<5){ledger.open('energy');return;}
 if(hit?.kind==='object'&&hit.distance<4){const owner=runtime.objects.get(hit.id)?.fragment?.lootOwnerId,corpse=owner?runtime.creatures.corpses.get(`corpse:${owner}`):null;if(corpse&&!corpse.claimed){report(runtime.creatures.claimDrops(owner,runtime.progression),'전리품을 회수했습니다.');return;}report(physical.objectPhysics.grab(hit.id,hit.point),'물체를 잡았습니다. 상호작용은 놓기, 공격은 던지기입니다.');return;}
 if(hit?.kind==='resource'){const node=runtime.nodes.find(n=>n.id===hit.id);if(node){gather(node);return;}}
 if(hit?.kind==='creature'&&hit.distance<4){const e=runtime.creatures.get(hit.id);if(e?.dead){report(runtime.creatures.claimDrops(e.id,runtime.progression),'전리품을 회수했습니다.');return;}if(e?.civilization){communityTarget=e.id;ledger.open('community');return;}}
 const anchors=nearbyAnchors();
 if(anchors.length){const a=anchors[0];if(a.kind==='gimmick'){report(runtime.beginGimmick(a),'장치를 조작하고 있습니다.');return;}
  if(a.kind==='puzzle'){deviceTarget=a.instanceId;ledger.open('devices');return;}
  const result=runtime.dungeons.interact(a.instanceId,a.id,{position:runtime.player,progression:runtime.progression});
  if(result.kind==='service'){communityTarget=a.instanceId;ledger.open('community');}
  else if(a.kind==='reward')result.ok?notify(result.duplicate?'이미 회수한 보상입니다.':`${a.name} 회수 · ${rewardText(result)}`):notify(result.reason);
  else if(result.kind==='inspect')notify(`관찰 ${result.observed.length}/2${result.solved?' · 연구 기록 보관함을 열 수 있습니다.':''}`);
  else report(result,'살펴보았습니다.');return;
 }
 const n=nearestNode();if(n&&n.distance<5)gather(n);else notify('대상 가까이에서 상호작용하세요.');
}
// Gathering is immediate (frontier): the items appear at once and the node regrows.
function gather(node){const r=runtime.harvest(node);if(r.ok){notify(`${name(r.sourceId)} · ${quantities(r.items)}`);renderHotbar();}else report(r);}
// What the interact button would do right now; empty when nothing is in reach.
function interactLabel(hit){
 if(runtime.drivingMachineId)return '내리기';if(physical?.objectPhysics.held)return '놓기';
 if(hit?.kind==='machine')return '기계 패널';if(hit?.kind==='fixture'&&hit.distance<5)return '설비 패널';
 if(hit?.kind==='object'&&hit.distance<4)return '잡기';if(hit?.kind==='resource')return '채집';
 if(hit?.kind==='creature'&&hit.distance<4){const e=runtime.creatures.get(hit.id);if(e?.dead)return '전리품';if(e?.civilization)return '대화';}
 const a=nearbyAnchors()[0];if(a)return a.kind==='reward'?(a.claimed?'살펴보기':'보상 회수'):a.kind==='gimmick'?'장치 작동':a.kind==='puzzle'?'장치 패널':a.kind==='inspect'?'관찰':'이용';
 const n=nearestNode();return n&&n.distance<5?'채집':'';
}

// ---- Sandbox tools (maps with sandbox rules, like the basic island) ----
function selectSandboxTool(n){
 if(!runtime.map.rules.sandbox)return;
 if(n<0){sandboxTool=null;pause(false);notify('들고 있는 아이템으로 돌아왔습니다.');}
 else{sandboxTool=n;pause(false);notify(`${SANDBOX_TOOLS[n][0]} 선택 · 사용 버튼으로 실행`);}
 updateToolLabel();buttonLabels();
}
function observe(hit){
 const e=hit?.kind==='creature'?runtime.creatures.get(hit.id):null;
 if(e){notify(`${name(e.speciesId)} · HP ${Math.ceil(e.hp)}/${e.maxHp} · ${e.dead?'쓰러짐':e.state??'배회'} · 칼로리 ${Math.round(e.calories??0)}`);return;}
 if(hit?.point&&hit.distance<=8){const n=hit.normal??{x:0,y:1,z:0},cell=['x','y','z'].map(k=>Math.floor((hit.point[k]-(n[k]??0)*.001)*2)),id=hit.kind==='terrain'?runtime.atlas.getCell(...cell):null;
  notify(`지형 ${id?CONTENT.blocks.entries.find(b=>b.id===id)?.name??id:hit.kind==='structure'?'구조물':'표면'} · 0.5 m · 거리 ${hit.distance.toFixed(2)} m`);return;}
 notify('8 m 이내의 생명이나 지표를 관찰하세요.');
}
function islandSpecies(){return CONTENT.environments.entries.find(e=>e.id==='grove').spawning.rules;}
function spawnCreature(position,speciesId){
 const regionId=`${Math.floor(position.x/64)},${Math.floor(position.z/64)}`;
 return runtime.creatures.spawn(speciesId,{x:position.x,z:position.z},{regionId,environmentId:runtime.atlas.sample(position.x,position.z).environmentId});
}
function useSandbox(tool){
 const hit=view.aim({range:8});
 if(tool===0){observe(hit);return;}
 if(!hit?.point){notify('8 m 이내의 표면을 조준하세요.');return;}
 const p=hit.point,n=hit.normal??{x:0,y:1,z:0},out={x:p.x+(n.x??0)*.3,y:p.y+(n.y??0)*.3,z:p.z+(n.z??0)*.3};
 if(tool===4||tool===6){const added=runtime.atlas.pour(out.x,out.y,out.z,tool===4?.5:.3,{acidFraction:tool===6?.95:0});notify(added>0?`${tool===4?'물':'산'} ${(added*1000).toFixed(0)} L 추가`:'부을 빈 공간을 조준하세요.');}
 else if(tool===5){const cell=['x','y','z'].map(k=>Math.floor((p[k]-(n[k]??0)*.001)*2));notify(runtime.atlas.igniteCell(...cell)?'불을 붙였습니다.':'탈 수 있는 칸(나무·풀)을 조준하세요.');}
 else if(tool===8){const rules=islandSpecies(),total=rules.reduce((t,r)=>t+r.weight,0);let roll=Math.random()*total,rule=rules[0];for(const r of rules){roll-=r.weight;if(roll<=0){rule=r;break;}}
  const e=spawnCreature(out,rule.speciesId);notify(`${name(e.speciesId)} 생성`);}
}
function herd(){
 const p=runtime.player;
 for(let i=0;i<24;i++)spawnCreature({x:p.x+(Math.random()-.5)*15,z:p.z+(Math.random()-.5)*15},i%8===0?'copper_fox':'moss_deer');
 updatePanels();notify('근처에 24마리를 놓았습니다.');
}

// ---- Places, minimap and the original-save report ----
function landmarks(){
 const p=runtime.player;let closest=null;
 for(const l of runtime.map.landmarks){const d=Math.hypot(p.x-l.x,p.z-l.z);if(!closest||d<closest.d)closest={...l,d};
  if(d<13&&!runtime.discoveredLandmarks.has(l.name)){runtime.discoveredLandmarks.add(l.name);showDiscovery(runtime.discoveredLandmarks.size,l.name);notify(`새 장소 발견 · ${l.name} (${runtime.discoveredLandmarks.size}/${runtime.map.landmarks.length})`,{queue:true});}}
 return closest;
}
function drawMinimap(c=$('map')){
 if(c.id==='map'&&!document.body.classList.contains('showRadar'))return;
 const ctx=c.getContext('2d'),p=runtime.player,island=runtime.map.id==='island',size=160,origin=island?{x:0,z:0}:{x:Math.round(p.x)-80,z:Math.round(p.z)-80},k=150/size;
 for(let z=0;z<size;z+=4)for(let x=0;x<size;x+=4){const s=runtime.atlas.sample(origin.x+x+2,origin.z+z+2);
  ctx.fillStyle=s.waterLevel!==null?(s.waterType==='acid'?'#7f8a4a':'#4c7f84'):s.environmentId==='thermal'?'#7a6d63':s.environmentId==='ridge'?'#a29567':s.height>24?'#8a9474':'#55764e';ctx.fillRect(x*k,z*k,4*k+.5,4*k+.5);}
 for(const e of runtime.creatures.visibleEntities(p,160)){if(e.dead)continue;ctx.fillStyle=e.attack?.targetId==='player'?'#df9e76':'#bed39a';ctx.fillRect((e.x-origin.x)*k,(e.z-origin.z)*k,1.6,1.6);}
 for(const l of runtime.map.landmarks){ctx.strokeStyle=runtime.discoveredLandmarks.has(l.name)?'#ebce8a':'#8fa17d';ctx.strokeRect((l.x-origin.x)*k-2,(l.z-origin.z)*k-2,4,4);}
 for(const d of runtime.nearbyStructures){ctx.strokeStyle='#d6b377';ctx.strokeRect((d.origin[0]-origin.x)*k-3,(d.origin[2]-origin.z)*k-3,6,6);}
 ctx.save();ctx.translate((p.x-origin.x)*k,(p.z-origin.z)*k);ctx.rotate(-p.yaw);ctx.fillStyle='#ffe4a7';ctx.beginPath();ctx.moveTo(0,-5);ctx.lineTo(3,4);ctx.lineTo(0,2);ctx.lineTo(-3,4);ctx.closePath();ctx.fill();ctx.restore();
}
// The frontier's map page: the area map on the left, destinations on the right.
function renderMap(list){
 const p=runtime.player,e=CONTENT.environments.entries.find(e=>e.id===runtime.region.environmentId),canvas=document.createElement('canvas');
 canvas.width=canvas.height=150;canvas.className='ledgerMap';canvas.setAttribute('aria-label','주변 지도');drawMinimap(canvas);
 const spot=(name,x,z,y)=>({name,x,z,y:y??runtime.atlas.heightAt(x,z)});
 const places=[spot(runtime.map.id==='island'?'상륙 지점':'출발지',runtime.map.spawn.x,runtime.map.spawn.z),
  ...runtime.map.landmarks.map(l=>spot(`${l.name}${runtime.discoveredLandmarks.has(l.name)?'':' · 미발견'}`,l.x,l.z)),
  ...runtime.nearbyStructures.map(d=>spot(CONTENT.structures.entries.find(s=>s.id===d.templateId)?.name??'장소',d.origin[0],d.origin[2],d.origin[1])),
  ...runtime.deaths.filter(d=>!d.recovered).map(d=>spot('요정이 지키는 소지품',d.position.x,d.position.z,d.position.y))];
 renderMapPage(list,{title:runtime.map.name,subtitle:`${e?.name??''} · ${runtime.region.tier}티어 · 발견 ${discovered.size+runtime.discoveredLandmarks.size}곳`,map:canvas,
  footer:`현재 위치 ${Math.round(p.x)} / ${Math.round(p.z)}${destination?` · 목적지 ${destination.name}`:''}`,
  destinations:places.map(d=>({name:d.name,distance:distance(p,d),onSelect:()=>{destination=d;pause(false);}}))},(label,fn,id)=>ledger.button(label,fn,id));
}
function renderConversion(append){
 const c=runtime.conversion;if(!c)return;
 const items=Object.entries(c.items??{}).map(([id,n])=>`${name(id)} ${Number(n.toFixed(2))}`).join(' · ')||'없음';
 append('기존 섬 저장을 옮겼습니다',`원래 저장(${c.from})은 그대로 남아 있습니다. 위치·지형 편집·발견 장소와 다음 아이템을 옮겼습니다: ${items}`);
 for(const u of c.unmapped??[])append(`옮기지 못한 항목 · ${u.name}`,u.detail);
}

// ---- Ledger window pages ----
function row(title,detail,label,callback,disabled=false,extra=[]){const el=document.createElement('article');el.className='row';const copy=document.createElement('div');copy.className='copy';const b=document.createElement('b');b.textContent=title;const p=document.createElement('p');p.textContent=detail??'';copy.append(b,p);el.append(copy);
 const buttons=[...(label?[[label,callback,disabled]]:[]),...extra].map(([text,onclick,off=false])=>{const button=document.createElement('button');button.textContent=text;button.disabled=off;button.onclick=onclick;return button;});
 if(buttons.length>1){const group=document.createElement('div');group.className='actions';group.append(...buttons);el.append(group);}else if(buttons.length)el.append(buttons[0]);return el;}
function bar(card,percent){const track=document.createElement('div'),fill=document.createElement('span');track.className='progress-bar';fill.style.width=`${Math.max(0,Math.min(100,percent)).toFixed(1)}%`;track.append(fill);card.querySelector('.copy').append(track);}
function renderLedger(tab,list){
 if(!ready)return;const p=runtime.progression,scrollTop=list.scrollTop;list.replaceChildren();
 const append=(title,detail,label,action,disabled,extra)=>list.append(row(title,detail,label,action,disabled,extra));
 if(tab==='journey')renderJourney(list,append);
 else if(tab==='map')renderMap(list);
 else if(tab==='status')renderStatus(list,append);
 else if(tab==='research'){
  const search=document.createElement('label');search.className='ledgerSearch';const field=document.createElement('input');field.id='researchSearch';field.placeholder='연구 이름으로 찾기';field.setAttribute('aria-label','연구 검색');field.value=researchQuery;field.oninput=()=>{researchQuery=field.value;renderLedger('research',list);document.getElementById('researchSearch')?.focus();};search.append(field);list.append(search);
  const job=p.researchJob,current=job&&p.catalog.get(job.id);
  if(current){const progress=p.researchProgress[current.id]??{work:0},waiting=!p._station(current.station),card=row(`연구 중 · ${current.name}`,`${progress.work.toFixed(1)}/${current.work} 연구량${waiting?' · '+reasonText('research_station_required'):''}${p.workCredits>0?` · 작업권 ${p.workCredits.toFixed(1)}`:''} · 멈춰도 진행도는 보존됩니다.`,'멈추기',()=>report(p.pauseResearch(),'연구를 멈췄습니다. 진행도는 보존됩니다.'));bar(card,progress.work/current.work*100);list.append(card);}
  else if(p.workCredits>0)append('발견 작업권',`${p.workCredits.toFixed(1)} 연구량 · 다음 자체 연구에 먼저 사용됩니다.`);
  const term=researchQuery.trim().toLowerCase();
  for(const r of p.list('research')){if(term&&!r.name.toLowerCase().includes(term))continue;const known=p.research.has(r.id),status=p.researchStatus(r.id),progress=p.researchProgress[r.id],running=job?.id===r.id,paid=!!progress?.paid;
   const label=known?'완료':running?'진행 중':paid?(job?'전환해 이어서':'이어서 연구'):(job?'전환해 연구':'연구');
   append(r.name,`표본: ${paid?'지불 완료':quantities(r.samples)} · ${r.work} 연구량${paid&&!known?` · 진행 ${(progress.work/r.work*100).toFixed(0)}%`:''}${r.station?' · 설비: '+name(r.station):''}${r.prerequisites.length?' · 선행: '+r.prerequisites.map(name).join(', '):''}${!known&&!status.ok?' · '+reasonText(status.reason):''}`,label,()=>{if(job&&job.id!==r.id)p.pauseResearch();report(p.startResearch(r.id),paid?'연구를 이어서 진행합니다.':'표본을 사용해 연구를 시작했습니다.');},known||running||!status.ok);}
 }else if(tab==='weapons'){
  const controls=document.createElement('div');controls.className='machine-card';
  for(const [labelText,options,current,change]of [['무기 형태',runtime.armaments.patterns(),weaponPattern,value=>weaponPattern=value],['무기 재질',p.list('material'),weaponMaterial,value=>weaponMaterial=value]]){
   const label=document.createElement('label');label.className='machine-field';const span=document.createElement('span');span.textContent=labelText;const select=document.createElement('select');select.setAttribute('aria-label',labelText);
   for(const option of options){const el=document.createElement('option');el.value=option.id;el.textContent=option.name;select.append(el);}
   select.value=current;select.onchange=()=>{change(select.value);renderLedger('weapons',list);};label.append(span,select);controls.append(label);
  }list.append(controls);
  const q=runtime.armaments.quote(weaponPattern,weaponMaterial);
  append(q.name??'무기 제작',q.inputs?`${quantities(q.inputs)} · ${name(q.station)} · ${q.seconds}초\n피해 ${q.hitDamage.toFixed(1)} · 사거리 ${q.range}m · ${q.attackPeriod}초 간격${q.ok?'':' · '+reasonText(q.reason)}`:reasonText(q.reason),'제작',()=>report(runtime.armaments.craft(weaponPattern,weaponMaterial),'무기를 제작하고 있습니다.'),!q.ok);
  for(const w of runtime.armaments.weapons)append(w.name,`${name(w.materialId)} · 내구 ${w.durability}/${w.maxDurability} · 피해 ${w.hitDamage.toFixed(1)} · ${HIT_SHAPES[hitShapeFor(w.weaponKind)]}`,runtime.armaments.equippedId===w.id?'해제':'장착',()=>{report(runtime.armaments.equip(runtime.armaments.equippedId===w.id?null:w.id),'무기 장착을 변경했습니다.');updateToolLabel();});
  for(const job of runtime.armaments.jobs??[])append('무기 제작 중',`${job.name??name(job.materialId)} · 작업대에서 제작을 진행합니다.`);
 }else if(tab==='energy'){
  append('열에너지 연료',`원목 1개를 태워 열을 모읍니다. 남은 연료 ${runtime.materialEffects.thermal.fuelEU.toFixed(0)} EU`,'원목 1개 넣기',()=>report(runtime.materialEffects.loadThermalFuel(1,{claimId:runtime.id('thermal-fuel')}),'연료를 넣었습니다.'),p.count('raw_timber')<1);
  fixtureEnergyPanel.render(list);
  for(const s of p.list('station'))append(s.name,`설치 ${p.stations[s.id]||0} · ${name(s.origin.recipe)}`,'설비 제작',()=>report(p.queueCraft(s.origin.recipe),'완성된 설비를 핫바에 놓고 사용해서 설치하세요.'),!p.recipeStatus(s.origin.recipe).ok);
  for(const a of p.assemblies)append(name(a.componentId),`상태 ${Math.round(a.health*100)}% · ${a.scale}배 크기 · ${a.materialId??'기본 재질'}`);
  for(const fixture of runtime.placements.descriptors().filter(f=>distance(runtime.player,f.position)<=5)){
   const quote=runtime.placements.repairQuote(fixture.id);
   append(name(fixture.assetId),`HP ${Math.ceil(fixture.hp)}/${fixture.maxHp} · 수리 재료 ${quantities(quote.items)}`,'수리',()=>report(runtime.placements.repair(fixture.id,{actorPosition:runtime.player}),'설비를 수리했습니다.'),fixture.hp>=fixture.maxHp);
   append(`${name(fixture.assetId)} 회수`,'손상된 만큼 회수할 수 있는 재료가 줄어듭니다.','철거',()=>report(runtime.placements.dismantle(fixture.id,{actorPosition:runtime.player}),'설비를 회수했습니다.'));
  }
 }else if(tab==='machine')machinePanel.render(list);
 else if(tab==='community'){
  if(communityTarget&&runtime.community){for(const option of runtime.community.optionsFor(communityTarget))append(option.label,option.detail,option.label,()=>report(runtime.community.interact(option.id,{targetId:communityTarget,requestId:runtime.id('community')})),option.disabled);}
  if(!list.childNodes.length)list.append(row('공동체와 만나기','문명 생명체나 공동체 시설에 다가가서 상호작용하세요.'));
 }else if(tab==='devices')renderDevices(list,append);
 else if(tab==='faith'){
  for(const shrine of runtime.faith.nearbyShrines(3)){
   append(shrine.name,'이곳에서 신앙 활동과 제단 시련을 진행할 수 있습니다.');
   for(const option of runtime.faith.optionsFor(shrine.instanceId))append(option.label,option.detail,'선택',()=>report(runtime.faith.interact(option.id,{instanceId:shrine.instanceId}),'제단에 뜻을 전했습니다.'),option.disabled);
  }
  if(!list.childNodes.length)list.append(row('유적의 제단','기록 보관소의 기록대나 잊힌 수도원의 전달 장치 3m 안에서 신앙 활동과 시련을 시작할 수 있습니다.'));
 }
 list.scrollTop=scrollTop;
 const work=p.researchJob?`연구: ${name(p.researchJob.researchId??p.researchJob.id)} · `:'',energy=Object.entries(p.energy).filter(([,v])=>v>0).map(([k,v])=>`${energyNames[k]} ${v.toFixed(1)} EU`).join(' · ');
 ledger.feedback(`${work}제작 대기 ${p.jobs.length}${energy?' · '+energy:''}`);
}
function objective(){
 const g=runtime.progression,places=runtime.map.landmarks;
 if(places.length&&runtime.discoveredLandmarks.size<places.length)return [`섬의 다섯 장소 탐험 · ${runtime.discoveredLandmarks.size}/${places.length}`,'지도 버튼의 여정에서 다음 장소를 목적지로 표시할 수 있습니다.'];
 return g.research.has('joinery')?['장비와 운반 구조물을 준비하고 동쪽의 저택을 탐험하세요.','던전에서 보상과 연구 기록을 찾으세요.']:g.research.has('observation')?['식물 섬유와 나뭇가지를 모아 구조와 접합을 연구하세요.','연구 탭에서 구조와 접합을 시작하세요.']:['주변의 나뭇가지와 돌을 모아 관찰과 기록을 연구하세요.','채집한 표본으로 연구 탭에서 관찰을 시작하세요.'];
}
function renderJourney(list,append){
 const [goal,hint]=objective();append(goal,`${hint}\n연구 ${runtime.progression.research.size}/${runtime.progression.list('research').length}`);
 for(const l of runtime.map.landmarks)append(l.name,`${runtime.discoveredLandmarks.has(l.name)?'발견함':'아직 찾지 못함'} · 지금 ${Math.round(Math.hypot(runtime.player.x-l.x,runtime.player.z-l.z))}m ${runtime.directionTo({x:l.x,z:l.z})}`,'목적지',()=>{destination={...l,y:runtime.atlas.heightAt(l.x,l.z)};pause(false);});
 renderConversion(append);
 if(destination)append(`목적지 · ${destination.name}`,`${Math.round(distance(runtime.player,destination))}m ${runtime.directionTo(destination)}`,'표시 해제',()=>{destination=null;renderLedger('journey',list);});
 for(const d of runtime.nearbyStructures){const def=CONTENT.structures.entries.find(e=>e.id===d.templateId),rewards=runtime.dungeons.anchors(d.id).filter(a=>a.kind==='reward'),origin={x:d.origin[0],y:d.origin[1],z:d.origin[2]};
  append(def.name,`장소 ${d.tier}티어 · 지역 ${d.regionTier}티어 · 출발지로부터 ${Math.round(Math.hypot(d.origin[0],d.origin[2]))}m · 지금 ${Math.round(distance(runtime.player,origin))}m ${runtime.directionTo(origin)} · 탐색한 방 ${d.visitedRooms.length}/${def.rooms.length}${def.puzzle?` · ${def.puzzle.name} ${d.deviceState?.solved||d.puzzle?.phase==='open'?'해결':'미해결'}`:''}${d.boss?` · 수호자 ${d.boss.defeated?'격파':'생존'}`:''}${rewards.length?' · '+rewards.map(a=>`${a.name} ${a.claimed?'회수함':'남음'}`).join(', '):''}`,'목적지',()=>{destination={name:def.name,...origin};pause(false);});}
 for(const d of runtime.deaths.filter(d=>!d.recovered))append('요정이 지키는 소지품',`${Math.round(distance(runtime.player,d.position))}m ${runtime.directionTo(d.position)} · ${quantities(d.items)}${d.weapons?.length?' · 무기 '+d.weapons.length+'개':''} · 10m 안에 가면 돌려받습니다.`,'목적지',()=>{destination={name:'요정이 지키는 소지품',...d.position};pause(false);});
}
// The frontier's character sheet, filled from the runtime; the runtime's own attack options follow it.
function renderStatus(list,append){
 const p=runtime.player,g=runtime.progression,loadout=g.evaluateLoadout(),weapon=runtime.armaments.loadout(),held=slots.held;
 const job=g.researchJob,current=job&&g.catalog.get(job.id),progress=current?g.researchProgress[current.id]?.work??0:0;
 const toolId=['stone_pick','hand_knife','bark_cup'].find(id=>id===held)??['stone_pick','hand_knife','bark_cup'].find(id=>g.count(id)>0),gear=runtime.miningGear(held);
 const armor=g.equipped&&g.catalog.get(g.equipped),reduction=Math.round((loadout.damageReduction??0)*100);
 const bosses=[...runtime.bosses.entities.values()].filter(b=>b.defeated).length,places=discovered.size+runtime.discoveredLandmarks.size;
 const sheet=document.createElement('div');list.append(sheet);
 renderCharacterSheet(sheet,{
  name:'개척자',level:1+g.research.size,state:p.resting?'휴식 중':runtime.drivingMachineId?'조종 중':'탐험 중',armored:reduction>0,
  slots:[
   {art:weapon?catalog.art(weapon.materialId):uiIcon('attack'),label:'무기',title:weapon?weapon.name:'맨손'},
   {art:toolId?catalog.art(toolId):uiIcon('tools'),label:'도구',title:toolId?name(toolId):'도구 없음'},
   {art:armor?catalog.art(armor.id):'<b>⛨</b>',label:armor?'장구':'없음',title:armor?`${armor.name} · 피해 ${reduction}% 감소`:'장구 미착용',className:`armorSlot ${armor?'equipped':''}`},
  ],
  meters:[
   {kind:'hp',label:'체력',text:`${Math.ceil(p.hp)} / ${p.maxHp}`,value:p.hp,max:p.maxHp},
   {kind:'food',label:'식량',text:`${Math.ceil(p.calories)} / ${p.maxCalories} CP`,value:p.calories,max:p.maxCalories},
   current?{kind:'xp',label:`연구 · ${current.name}`,text:`${progress.toFixed(1)} / ${current.work}`,value:progress,max:current.work}:{kind:'xp',label:'연구',text:`${g.research.size} / ${g.list('research').length}`,value:g.research.size,max:g.list('research').length},
  ],
  stats:[[weapon?.name??'맨손',`공격 ${(weapon?.hitDamage??loadout.hitDamage).toFixed(1)} · ${weapon?.attackPeriod??loadout.attackPeriod}초`],[armor?.name??'기본 의복',`피해 감소 ${reduction}%`],[`채굴 ${miningSize>=1?'1 m':'0.5 m'}`,`${gear.affinity==='rock'?'돌':gear.affinity==='wood'?'나무':'흙'} ×${gear.power}`],['타격 방식',HIT_SHAPES[heldShape()]]],
  effects:[p.resting?'휴식 중 · 체력 회복이 빨라집니다':'',p.attackEnergy?`${energyNames[p.attackEnergy]} 에너지 공격 선택 중`:'',runtime.map.rules.survival===false?'평화 규칙 · 체력과 식량이 줄지 않습니다':''].filter(Boolean).join('<br>'),
  actions:[
   {label:'보급 식량 먹기',short:'먹기',id:'eatFood',art:catalog.art('food'),count:Number(g.count('food').toFixed(1)),disabled:g.count('food')<1,onClick:()=>{const r=runtime.eat();renderLedger('status',list);return r.ok?'음식을 먹었습니다.':reasonText(r.reason);}},
   {label:'휴식',short:'휴식',id:'campRest',icon:uiIcon('village'),onClick:rest},
   {label:'가방 · 제작',short:'가방',id:'frontierBag',icon:uiIcon('bag'),onClick:()=>{ledger.close();openBag();}},
   {label:'탐험 저장',short:'저장',id:'frontierSave',icon:uiIcon('journey'),onClick:()=>save()?'저장했습니다.':'저장 실패 · 공간을 확인하세요.'},
  ],
  milestones:[['▧',g.research.size,'연구'],['◆',bosses,'수호자'],['⚑',places,'발견'],['◈',runtime.deaths.filter(d=>!d.recovered).length,'회수 대기']],
  log:fieldLog,logTitle:'탐험 기록',
  portrait:{held,stance:p.stance},
 },(label,fn,id)=>ledger.button(label,fn,id));
 append('일반 공격','장착한 무기와 도구로 공격합니다.',p.attackEnergy?'선택':'선택 중',()=>{p.attackEnergy=null;renderLedger('status',list);});
 for(const [type,label]of Object.entries(energyNames))append(`${label} 에너지 공격`,`공격 한 번에 25 EU를 소비합니다. 현재 ${type==='thermal'?runtime.materialEffects.thermal.storedEU.toFixed(1):g.energyAvailable(type).toFixed(1)} EU`,p.attackEnergy===type?'선택 중':'선택',()=>{p.attackEnergy=type;p.magicAttribute=null;renderLedger('status',list);});
 append('마법 속성',`현재 ${p.magicAttribute==='water'?'물':p.magicAttribute==='wind'?'바람':'기본'}`,'속성 바꾸기',()=>{const a=[null,'water','wind'];p.magicAttribute=a[(a.indexOf(p.magicAttribute??null)+1)%a.length];p.attackEnergy='magic';renderLedger('status',list);});
}
function rest(){runtime.player.resting=true;pause(false);notify('휴식 중입니다. 이동하거나 공격하면 휴식을 끝냅니다.');}
function renderDevices(list,append){
 const devices=runtime.dungeons.devices,p=runtime.progression;
 const nearby=runtime.dungeons.nearbyAnchors(runtime.player,3).filter(a=>a.kind==='puzzle');
 const instances=[...new Set(nearby.map(a=>a.instanceId))];
 if(!instances.includes(deviceTarget))deviceTarget=instances[0]??null;
 if(!deviceTarget){append('던전의 장치','문 근처의 조작점 3m 안으로 다가가세요.');return;}
 for(const id of instances){const inst=runtime.dungeons.get(id),title=CONTENT.structures.entries.find(d=>d.id===inst.templateId).name;append(title,'조작할 장치',id===deviceTarget?'선택 중':'선택',()=>{deviceTarget=id;renderLedger('devices',list);});}
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
   button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);const r=devices.act(deviceTarget,a.id,{position:runtime.player,progression:p,claimId:runtime.id('device')});if(r.ok){manualDeviceId=deviceTarget;actionHeld=false;}else report(r);};
   button.onpointerup=button.onpointercancel=()=>{manualDeviceId=null;renderLedger('devices',list);};list.append(card);
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
// Craft queue inside the shared bag: progress, cancel for item refunds, and reordering.
function renderQueue(container){
 const p=runtime.progression;if(!p.jobs.length)return;
 const head=document.createElement('h4');head.textContent=`작업 대기열 ${p.jobs.length}`;const hint=document.createElement('p');hint.textContent='맨 앞의 작업만 진행됩니다. 취소하면 재료를 돌려받지만 이미 쓴 에너지는 돌아오지 않습니다.';container.append(head,hint);
 p.jobs.forEach((job,index)=>{
  const s=p.jobStatus(job),label=job.type==='craft'?`${name(job.recipeId)}${job.count>1?' × '+job.count:''}`:name(job.activityId),percent=s.total?s.progress/s.total*100:0;
  const energy=Object.entries(s.energy).map(([t,n])=>`${energyNames[t]} ${n.toFixed(1)} EU/s`).join(' · '),fixture=p.worldFixtures.find(f=>f.ownerId===s.fixtureId);
  const stalled=index===0&&!s.blocked&&jobWatch.id===job.id&&performance.now()-jobWatch.since>2000;
  const state=index>0?'대기 중':s.blocked?`멈춤 · ${reasonText(s.blocked)}`:stalled?`멈춤 · ${reasonText(energy?'energy_waiting':'insufficient_resources')}`:'진행 중';
  const el=document.createElement('div');el.className='queueJob';const title=document.createElement('b');title.textContent=label;const text=document.createElement('p');text.textContent=`${state} · ${percent.toFixed(0)}% (${s.progress.toFixed(1)}/${s.total}초)${energy?' · 필요 '+energy:''}${fixture?' · 설비 '+name(fixture.assetId):''}`;
  const track=document.createElement('div'),fill=document.createElement('span');track.className='progress-bar';fill.style.width=`${percent.toFixed(1)}%`;track.append(fill);el.append(title,text,track);
  if(job.type==='craft'){const b=document.createElement('button');b.textContent='취소';b.onclick=()=>report(p.cancelJob(job.id,{claimId:runtime.id('cancel-job')}),'작업을 취소하고 재료를 돌려받았습니다.');el.append(b);}
  if(index>0){const b=document.createElement('button');b.textContent='먼저 진행';b.onclick=()=>report(p.prioritizeJob(job.id),'이 작업을 먼저 진행합니다.');el.append(b);}
  container.append(el);
 });
}
function itemActions(id){
 const p=runtime.progression,d=p.catalog.get(id);if(!d)return [];
 if(id==='food')return [{label:'먹기',run:()=>{const r=runtime.eat();return r.ok?'음식을 먹었습니다.':reasonText(r.reason);}}];
 if(d.kind==='gear_baseline')return [{label:p.equipped===id?'장착 중':'장착',disabled:p.equipped===id,run:()=>{const r=p.equip(id);return r.ok?'장구를 장착했습니다.':reasonText(r.reason);}}];
 if(d.kind==='station'||d.kind==='component')return [{label:d.kind==='station'?'앞에 설치':'거점에 설치',run:()=>{pause(false);placeEquipment(id).catch(e=>notify(e.message));return '';}}];
 return [];
}

// ---- HUD ----
function bossPartLabel(entity,partId){
 const def=runtime.bosses.definitionFor(entity),part=def.parts.find(x=>x.id===partId)??def.parts.find(x=>partId&&String(partId).includes(x.id)),state=part&&entity.parts?.[part.id];
 const shell=Object.values(entity.shell??{}).reduce((n,v)=>n+Math.max(0,v),0);
 return [part?`${part.name} ${state?.broken?'파손':`${Math.min(100,(state?.damage??0)/part.breakThresholdHp*100).toFixed(0)}%`}`:'',shell>0?`외피 ${shell.toFixed(0)} EU`:'',entity.staggerS>0?'비틀거림':''].filter(Boolean).join(' · ');
}
function anchorCard(){
 const a=runtime.dungeons.nearbyAnchors(runtime.player,3).find(a=>['reward','gimmick','puzzle','inspect','service'].includes(a.kind));if(!a)return null;
 const at=anchorPoint(a),position={x:at.x,y:at.y+1.4,z:at.z};
 if(a.kind==='reward')return {title:a.name,detail:a.claimed?'회수함':'보상',hint:a.claimed?'':'상호작용: 회수',color:'#ebce8a',position};
 if(a.kind==='gimmick'){const b=runtime.bosses.get(a.bossInstanceId),g=b?.gimmicks?.[a.gimmickId];if(!b||b.defeated||!g)return null;return {title:'전장 장치',detail:g.broken||g.uses<=0?'이미 사용함':`내구 ${Math.ceil(g.hp)}`,hint:g.broken||g.uses<=0?'':'상호작용: 작동 · 공격: 파괴',color:'#f1b08f',position};}
 if(a.kind==='inspect')return {title:a.name,detail:a.observed?'관찰함':'관찰 대상',hint:a.observed?'':'상호작용: 관찰',position};
 if(a.kind==='puzzle')return {title:a.name,detail:'던전 장치',hint:'상호작용: 장치 패널',position};
 return {title:'공동체 시설',detail:'',hint:'상호작용: 이용',color:'#c9db9f',position};
}
function focusCard(hit,node){
 const flash=hitFlash&&performance.now()<hitFlash.until?hitFlash.text:'';
 if(hit?.kind==='creature'||hit?.kind==='boss'){
  const e=hit.kind==='boss'?runtime.bosses.get(hit.id):runtime.creatures.get(hit.id);
  if(e){const boss=hit.kind==='boss',def=boss?runtime.bosses.definitionFor(e):null,pos=boss?e.position:e;
   return {title:boss?`${def.name} · ${e.encounterTier}티어`:name(e.speciesId),detail:boss?`${runtime.bosses.phase(e).name}${bossPartLabel(e,hit.partId)?' · '+bossPartLabel(e,hit.partId):''}`:`HP ${Math.ceil(e.hp)}/${e.maxHp}${e.dead?' · 쓰러짐':''}`,hint:flash||(e.dead?'상호작용: 전리품':`공격: ${HIT_SHAPES[heldShape()]}`),value:Math.ceil(e.hp),max:e.maxHp,color:boss||e.attack?.targetId==='player'?'#efb484':'#b4ddbe',maxDistance:boss?28:10,follow:()=>e.dead&&!boss?{x:pos.x,y:pos.y+.8,z:pos.z}:{x:pos.x,y:(pos.y??0)+(boss?3.2:1.6),z:pos.z}};}
 }
 if(hit&&hit.distance<=6){
  if(hit.kind==='fixture'){const f=runtime.placements.records.get(hit.id);if(f)return {title:name(f.assetId),detail:`HP ${Math.ceil(f.hp)}/${f.maxHp}`,hint:flash||'상호작용: 설비 패널',value:f.hp,max:f.maxHp,position:hit.point,maxDistance:8};}
  if(hit.kind==='machine'){const m=runtime.machines.machines.get(hit.id);if(m)return {title:m.name,detail:'기계',hint:flash||'상호작용: 기계 패널',position:hit.point,maxDistance:8};}
  if(hit.kind==='object'&&hit.distance<4)return {title:'떨어진 물체',detail:flash||'',hint:slots.held?'상호작용: 잡기 · 공격: 깎기':'상호작용: 잡기 · 공격: 밀기 (아이템을 들면 깎기)',position:hit.point,maxDistance:6};
  if(hit.kind==='terrain'&&hit.normal){const cell=['x','y','z'].map(k=>Math.floor((hit.point[k]-hit.normal[k]*.001)*2)),id=runtime.atlas.getCell(...cell),wound=runtime.terrainDamage[cell.join(',')];
   if(id&&(flash||wound))return {title:CONTENT.blocks.entries.find(b=>b.id===id)?.name??'지형',detail:flash||`균열 ${Math.round((wound?.damage??0)*100)}%`,hint:`공격: 채굴 ${miningSize>=1?'1 m':'0.5 m'}`,position:hit.point,maxDistance:7,color:'#e5d6a1'};}
  if(hit.kind==='structure'&&flash)return {title:'구조물',detail:flash,hint:'',position:hit.point,maxDistance:7,color:'#e5d6a1'};
 }
 if(node&&node.distance<5)return {title:name(node.sourceId),detail:'채집물',hint:'상호작용·공격: 채집',position:{x:node.x,y:(node.y??runtime.atlas.heightAt(node.x,node.z))+.9,z:node.z},maxDistance:7,color:'#c9db9f'};
 return anchorCard();
}
function contextCard(){
 const g=runtime.progression,b=runtime.interactionAction,m=manualDeviceId?runtime.dungeons.devices.status(manualDeviceId,{progression:g}):null;
 if(b){const at=b.position;return {title:'장치 조작',detail:`${b.elapsed.toFixed(1)}/${b.seconds}초`,hint:'3m 안에 머무르세요',value:b.elapsed,max:b.seconds,color:'#f1b08f',position:{x:at.x??at[0],y:(at.y??at[1])+1.6,z:at.z??at[2]},maxDistance:9,side:-1};}
 if(m)return {title:'장치 작업',detail:m.summary??'',hint:m.work?.progressM>0?`진행 ${m.work.progressM.toFixed(2)} m`:'',position:{x:runtime.player.x-Math.sin(runtime.player.yaw)*1.5,y:runtime.player.y+1.8,z:runtime.player.z-Math.cos(runtime.player.yaw)*1.5},maxDistance:9,side:-1};
 return null;
}
function hud(){
 const p=runtime.player,g=runtime.progression,e=CONTENT.environments.entries.find(e=>e.id===runtime.region.environmentId);
 const place=landmarks();$('biome').textContent=place?place.name:`${e?.name??''} · ${runtime.region.tier}티어`;
 $('population').textContent=`생명체 ${runtime.creatures.visibleEntities(p).length}`;
 $('coords').textContent=`${Math.round(p.x)} / ${Math.round(p.z)}`;
 const job=g.researchJob,current=job&&g.catalog.get(job.id),progress=current?g.researchProgress[current.id]?.work??0:0;
 setVitals({hp:p.hp,maxHp:p.maxHp,food:p.calories/p.maxCalories*100,level:g.research.size,xp:progress,xpMax:current?.work??1,
  healthText:`체력 ${Math.ceil(p.hp)} / ${p.maxHp} · 연구 ${g.research.size}`,foodText:`식량 ${Math.ceil(p.calories/p.maxCalories*100)}% · ${p.resting?'휴식 중':runtime.drivingMachineId?'조종 중':'도보'}`,hurt:runtime.time-p.lastDamageAt<1});
 const [goal]=objective();setJourney(journey,goal,current?`연구 중 · ${current.name} ${(progress/current.work*100).toFixed(0)}%`:`연구 ${g.research.size}/${g.list('research').length} · 눌러서 여정 보기`);
 const target=destination??nearestUnexplored();$('waypoint').textContent=target?waypointText(p,target):'';
 const driving=!!runtime.drivingMachineId,hit=view.aim(),node=nearestNode(),interaction=interactLabel(hit);
 // Always on screen, like the frontier; the label names what is in reach.
 $('interactBtn').firstChild.textContent=(interaction||'상호작용')+' ';$('interactBtn').hidden=false;
 buttonLabels();
 movementHud();
 view.worldUI.set('focus',focusCard(hit,node));view.worldUI.set('context',contextCard());
 const warning=runtime.activeWarning(),hazards=runtime.dungeons.devices?.sampleAt?.(p)?.hazards??[];
 $('warning').textContent=warning?.text??(hazards.length?`위험 구역: ${hazards.map(h=>HAZARDS[h]??h).join(' · ')}`:'');
 const firstJob=g.jobs[0];if(firstJob?.id!==jobWatch.id||firstJob.progress!==jobWatch.progress)jobWatch={id:firstJob?.id??null,progress:firstJob?.progress??0,since:performance.now()};
 for(const message of runtime.messages.splice(0)){notify(message,{queue:true});fieldLog.unshift(message);fieldLog.length=Math.min(fieldLog.length,40);}
 discover();
 const h=8+runtime.time/60;$('worldTime').textContent=`DAY ${String(1+Math.floor(h/24)).padStart(2,'0')} · ${String(Math.floor(h)%24).padStart(2,'0')}:${String(Math.floor((h%1)*60)).padStart(2,'0')}`;
 updateToolLabel();
}
// Attack and use labels follow the held item and what the player is doing.
function buttonLabels(){
 const p=runtime.player,driving=!!runtime.drivingMachineId,heldItem=slots.held,d=heldItem&&runtime.progression.catalog.get(heldItem);
 // The frontier's attack button: a pick for mining and hitting, a blade with a weapon.
 const icon=runtime.armaments.loadout()||driving?'attack':'tools';if($('actBtn').dataset.icon!==icon){$('actBtn').dataset.icon=icon;$('actBtn').innerHTML=uiIcon(icon)+'<small></small>';}
 $('actBtn').querySelector('small').textContent=physical?.objectPhysics.held?'던지기':driving?'무장 발사':p.attackEnergy?`${energyNames[p.attackEnergy]} 공격`:'공격·캐기';
 $('useBtn').querySelector('small').textContent=driving?'내리기':physical?.objectPhysics.held?'놓기':sandboxTool!==null?SANDBOX_TOOLS[sandboxTool][0]:heldItem==='food'?'먹기':runtime.buildableBlock(heldItem)?`놓기 ×${buildSize>=1?8:1}`:d?.kind==='station'||d?.kind==='component'?'설치':!heldItem&&runtime.map.rules.sandbox?'관찰':'상호작용';
}
// First entry into a structure shows the same discovery banner as the island's landmarks.
function discover(){
 for(const d of runtime.nearbyStructures)if(d.discovered&&!discovered.has(d.id)){
  discovered.add(d.id);const def=CONTENT.structures.entries.find(e=>e.id===d.templateId);
  if(def){showDiscovery(discovered.size,def.name);notify(`새 장소 발견 · ${def.name}`,{queue:true});}
 }
}
function nearestUnexplored(){
 let best=null;
 for(const l of runtime.map.landmarks){if(runtime.discoveredLandmarks.has(l.name))continue;const dist=Math.hypot(runtime.player.x-l.x,runtime.player.z-l.z);if(!best||dist<best.dist)best={...l,dist};}
 if(best)return best;
 for(const d of runtime.nearbyStructures){const def=CONTENT.structures.entries.find(e=>e.id===d.templateId);if(!def||d.visitedRooms.length>=def.rooms.length)continue;const pos={x:d.origin[0],y:d.origin[1],z:d.origin[2]},dist=distance(runtime.player,pos);if(!best||dist<best.dist)best={name:def.name,...pos,dist};}
 const death=runtime.deaths.find(d=>!d.recovered);if(death)return {name:'요정이 지키는 소지품',...death.position};
 return best;
}

// ---- Loop ----
function step(){
 const keys=input.keys,axes=input.axes(),p=runtime.player;
 const control=paused?{}:{forward:axes.forward,side:axes.side,jump:keys.has('Space'),sprint:keys.has('ShiftLeft')||keys.has('ShiftRight')||sprintLatched,speedScale:runtime.bosses.targetEffects(p).speedMultiplier};
 const before={...p};if(control.forward||control.side||actionHeld)p.resting=false;
 const driving=runtime.machines.machines.get(runtime.drivingMachineId);
 if(driving)runtime.machines.control(driving.id,{throttle:control.forward||0,steer:-(control.side||0),pitch:Number(!!control.jump)-Number(keys.has('ShiftLeft')||keys.has('KeyQ')||held.descend),brake:keys.has('ControlLeft')||held.brake});
 else{runtime.drivingMachineId=null;controller.step(FIXED_DT,control);physical?.movePlayer(before,p);}
 if(actionHeld&&!paused&&!manual)attack();
 runtime.tick(FIXED_DT,{manual,manualDeviceId,moving:!!(control.forward||control.side)});physical?.step(FIXED_DT);
 if(driving&&runtime.drivingMachineId===driving.id&&runtime.machines.machines.has(driving.id)&&driving.voxels.length){
  const c=driving.components.find(c=>c.componentId==='controller'),voxel=driving.voxels.find(v=>v.id===c?.voxelId);
  const offset=voxel?new T.Vector3((voxel.cell[0]+.5)*driving.gridM,(voxel.cell[1]+1)*driving.gridM+.08,(voxel.cell[2]+.5)*driving.gridM):new T.Vector3(0,Math.max(...driving.voxels.map(v=>(v.cell[1]+1)*driving.gridM))+.08,0);
  const q=driving.rotation;offset.applyQuaternion(new T.Quaternion(q.x,q.y,q.z,q.w));
  Object.assign(p,{x:driving.position.x+offset.x,y:driving.position.y+offset.y,z:driving.position.z+offset.z,vy:0});
 }
}
function frame(now){
 requestAnimationFrame(frame);
 const realDt=Math.max(.001,(now-(last||now))/1000||.016),dt=Math.min(.1,realDt);last=now;
 if(!ready||document.hidden)return;
 fpsFrames++;fpsTime+=realDt;if(fpsTime>1){fps=fpsFrames/fpsTime;fpsFrames=fpsTime=0;$('fps').textContent=`${fps.toFixed(0)} FPS`;}
 if(!frozen()){
  accum=Math.min(.5,accum+dt);while(accum>=FIXED_DT){step();accum-=FIXED_DT;}
  saveClock+=dt;if(saveClock>30){saveClock=0;autosave.schedule(snapshot());}
 }
 runtime.atlas.loadAround(runtime.player.x,runtime.player.z,{radiusChunks:view.loadRadiusChunks??3,verticalRadius:1,y:runtime.player.y,chunkBudget:1});
 view.syncTerrain();view.syncModels(runtime.descriptors(),runtime.time,dt);fragments.sync(view.models);physical?.synchronize(view.models,runtime.player);bossView.sync(runtime.bosses);environmentView.sync(runtime.player,runtime.time);equipmentView.sync(runtime,dt);feedbackView.sync(runtime,dt);anchorMarkers.sync(runtime,dt);
 view.draw(runtime.player,controller.eye);
 hudClock+=dt;tabClock+=dt;
 if(hudClock>.2){hudClock=0;hud();}
 minimapClock+=dt;if(minimapClock>.5){minimapClock=0;drawMinimap();}
 if(tabClock>1){tabClock=0;
  if(ledger.isOpen&&!manual&&!manualDeviceId&&!ledgerPointers.size&&!document.activeElement?.matches('#frontierContent input, #frontierContent select, #frontierContent textarea'))ledger.render();
  const signature=JSON.stringify([runtime.progression.inventory,runtime.progression.jobs.map(j=>[j.id,Math.round(j.progress)]),slots.revision]);
  if(signature!==bagSignature){bagSignature=signature;if(paused&&$('pauseScreen').classList.contains('inventoryMode')&&!document.activeElement?.matches('#recipeSearch'))bag.render();else renderHotbar();$('bagCount').textContent=slots.slots.filter(Boolean).length;}
 }
 updates.frame(true,now);
}

// ---- Screen wiring ----
function bind(){
 document.body.classList.add('field','expedition');
 $('flyBtn').hidden=true;$('rangeBtn').classList.remove('hidden');
 const map=runtime.map;
 document.querySelector('[data-tab="life"]').hidden=!map.rules.sandbox;
 document.querySelector('[data-panel="world"] > p').textContent=map.description;
 $('vitals').hidden=!map.rules.survival;
 if(map.rules.sandbox){
  for(const b of document.querySelectorAll('[data-sandbox-tool]'))b.onclick=()=>selectSandboxTool(+b.dataset.sandboxTool);
  $('herdBtn').onclick=herd;$('stressBtn').hidden=true;
  $('benchmarkText').textContent='샌드박스 도구는 재료 없이 실행합니다. 생명체는 섬의 생태 규칙(먹이·번식·포식)을 따릅니다.';
 }
 $('homeBtn').textContent='휴식하기';$('homeBtn').onclick=rest;
 $('hint').textContent=map.rules.sandbox?'1–9 핫바 · I 가방 · R 상호작용 · 빈 손 사용: 관찰':'1–9 핫바 · I 가방 · R 상호작용 · J 여정';
 $('inventoryBtn').onclick=openBag;
 $('menuBtn').onclick=()=>{pause(true);selectTab('world',updatePanels);};
 $('resumeBtn').onclick=$('backToGame').onclick=$('resumeWorld').onclick=()=>pause(false);
 $('worldListBtn').onclick=e=>{if(!save())e.preventDefault();};
 $('saveBtn').onclick=()=>{if(save())notify('탐험을 저장했습니다.');};
 $('newBtn').onclick=()=>$('resetConfirm').classList.remove('hidden');$('cancelReset').onclick=()=>$('resetConfirm').classList.add('hidden');
 $('confirmReset').onclick=()=>{ready=false;for(const suffix of ['','.a','.b'])localStorage.removeItem(saveKey(world)+suffix);location.reload();};
 $('rangeBtn').onclick=cycleRange;
 $('sprintBtn').onclick=()=>{if(!ready||paused||runtime.drivingMachineId)return;sprintLatched=changeSprint(controller,runtime.player,sprintLatched,notify);movementHud();};
 $('crouchBtn').onclick=()=>toggleStance('crouch');$('crawlBtn').onclick=()=>toggleStance('crawl');
 input.holdButton($('actBtn'),()=>{actionHeld=true;attack();},()=>actionHeld=false);
 input.holdButton($('useBtn'),secondary,()=>{});
 input.holdButton($('jumpBtn'),()=>{const p=runtime.player;if(p.stance!=='stand'&&!runtime.drivingMachineId)toggleStance(p.stance);else input.keys.add('Space');},()=>input.keys.delete('Space'));
 input.holdButton($('descendBtn'),()=>held.descend=true,()=>held.descend=false);
 input.holdButton($('brakeBtn'),()=>held.brake=true,()=>held.brake=false);
 input.bindStick($('stick'),$('knob'));
 input.bindCanvas($('world'),{primary:pressed=>{actionHeld=pressed;if(pressed)attack();},secondary,wheel:direction=>selectHotbar((slots.selectedSlot+(direction>0?1:8))%9),lockFailed:()=>notify('클릭 후 마우스 시점을 사용할 수 있습니다.')});
 input.bindKeyboard({isRunning:()=>ready,toggleBag:()=>paused?pause(false):openBag(),togglePause:()=>pause(),onKey:e=>{
  if(!e.repeat&&(e.code==='KeyC'||e.code==='KeyZ')){toggleStance(e.code==='KeyC'?'crouch':'crawl');return;}
  if(!e.repeat&&e.code==='Space'&&runtime.player.stance!=='stand'&&!runtime.drivingMachineId){toggleStance(runtime.player.stance);return;}
  if(!e.repeat&&(e.code==='KeyE'||e.code==='KeyR')){interact();return;}
  if(!e.repeat&&e.code==='KeyJ'){ledger.open('journey');return;}
  if(!e.repeat&&e.code==='KeyB'){cycleRange();return;}
  input.keys.add(e.code);
  if(/^Digit[1-9]$/.test(e.code))selectHotbar(+e.code.slice(-1)-1);
 }});
 document.getElementById('frontierContent').addEventListener('pointerdown',e=>ledgerPointers.add(e.pointerId));
 for(const type of ['pointerup','pointercancel'])window.addEventListener(type,e=>ledgerPointers.delete(e.pointerId));
 bindMenuTabs(updatePanels);
 bindBackground({onHide:()=>{if(ready){save();if(!paused)pause(true,{quiet:true});}},onUnload:()=>{if(ready)save();},onBlur:stopInput});
 window.addEventListener('resize',()=>view.resize());
}
function toggleStance(stance){
 if(!ready||paused||runtime.drivingMachineId)return;sprintLatched=false;changeStance(controller,runtime.player,stance,notify);movementHud();
}
function movementHud(){
 const p=runtime.player,driving=!!runtime.drivingMachineId;
 showMovementState({riding:driving,flying:driving,brake:driving,stance:p.stance,stanceBlocked:p.stanceBlocked,sprinting:!!p.sprinting,sprintLatched});
}

const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
async function stage(text,percent){loading.set(text,percent);await paint();}
const LOAD_STEPS={world:['세계와 생태계를 구성하는 중',55],placements:['설치한 설비를 불러오는 중',65]};
async function boot(){
 $('startBtn').hidden=true;$('continueBtn').hidden=true;
 await stage('저장을 확인하는 중',6);
 world=currentWorld(localStorage,['island','expedition'],location.search);saveStore=new ExpeditionSave(localStorage,saveKey(world));const saved=saveStore.load();
 const mapId=world.type==='island'?'island':'expedition';
 let legacyIsland=null;
 if(!saved&&mapId==='island'){try{const old=JSON.parse(localStorage.getItem(saveKey(world))??'null');if([1,2].includes(old?.version)&&old.world)legacyIsland=old;}catch(e){console.warn('기존 섬 저장을 읽지 못했습니다',e);}}
 await stage('건축물 모델을 불러오는 중',10);
 runtime=await ExpeditionRuntime.create(world.seed,saved,{map:mapId,starter:!legacyIsland,pause:paint,onProgress:(step,done,total)=>step==='assets'?loading.step(`건축물 모델을 불러오는 중 ${done}/${total}`,10+40*done/total):loading.set(...LOAD_STEPS[step])});
 // An original island save (same key, without the .a/.b generations) is carried over once; the original stays.
 if(legacyIsland){await stage('기존 섬 저장을 옮기는 중',70);converted=applyLegacyIsland(runtime,legacyIsland);}
 await stage('장면을 준비하는 중',72);
 view=new ExpeditionScene($('world'),runtime.atlas);controller=new CharacterController(runtime.terrain,runtime.player);
 settings=initSettings({view,onLeftHand:()=>hudEditor?.apply()});view.camera.fov=+$('fov').value;view.camera.updateProjectionMatrix();if(!view.loadRadiusChunks)view.qualitySet($('quality').value);
 autosave=new Autosave(saveStore,{onSaved:()=>{$('saveState').textContent='SAVED '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});},onError:error=>{$('saveState').textContent='SAVE FAILED';console.warn(error);notify('자동 저장하지 못했습니다. 이전 정상 저장은 보존됩니다.');}});
 bossView=new BossView(view);equipmentView=new EquipmentView(view);feedbackView=new FeedbackView(view);anchorMarkers=new AnchorMarkers(view);
 environmentView=new EnvironmentView(view,runtime.atlas);machinePanel=new MachinePanel(runtime,{report,drive:driveMachine});fixtureEnergyPanel=new FixtureEnergyPanel(runtime,{report,onManual:value=>{manual=value;if(value)actionHeld=false;}});
 slots=new ItemSlots(runtime.progression,saved?.itemSlots);
 if(saved?.editGrid){miningSize=saved.editGrid.miningSize===1?1:.5;buildSize=saved.editGrid.buildSize===1?1:.5;}
 catalog=designCatalog(runtime,{name,actions:itemActions,queue:renderQueue});
 bag=new InventoryUI({get inventory(){return slots;},frontier:false,catalog,craft:id=>report(runtime.progression.queueCraft(id),'제작을 시작했습니다. 진행은 가방의 작업 대기열에서 확인하세요.'),toast:notify,changed:()=>{renderHotbar();updateToolLabel();},renderHotbar});
 mountFieldHUD({journalLabel:'탐험 지도',onJournal:()=>ledger.open('map'),onStatus:()=>ledger.open('status'),onInteract:interact});
 journey=mountJourney(()=>ledger.open('journey'));
 ledger=new GameWindow({tabs:TABS,titles:TITLES,label:'탐험 장부',canOpen:()=>ready,onOpen:()=>pause(true,{quiet:true}),onClose:()=>pause(false),render:renderLedger});
 installHUDArt();
 hudEditor=new HudEditor({open:()=>{pause(true);ledger.close();$('pauseScreen').classList.add('hidden');},close:()=>{stopInput();pause(true);selectTab('settings',updatePanels);}});
 $('editHudBtn').onclick=()=>hudEditor.open();$('editHudShortcut').onclick=()=>hudEditor.open();
 window.FeralUpdates=updates=initUpdates({beforeApply:save});
 await stage('물리 엔진을 준비하는 중',82);
 const {RuntimePhysics}=await import('./physics.js');physical=await RuntimePhysics.create(runtime,view);
 await stage('탐험을 시작하는 중',95);
 runtime.physics=physical;runtime.terrain.hasAttackLineOfSight=(a,b,options)=>runtime.lineOfSight(a,b)&&(physical.hasAttackLineOfSight?.(a,b,options)??true);
 fragments=new CreatureFragments(CONTENT,runtime.creatures,runtime.objects,{getModelRecord:id=>view.models.get(id),getPartPhysics:(owner,part)=>physical.getPartPhysics?.(owner,part)});
 for(const d of runtime.dungeons.instances.values())if(d.discovered)discovered.add(d.id);
 ready=true;bind();renderHotbar();updateToolLabel();
 if(converted){save();notify(`기존 섬 저장을 옮겼습니다${converted.unmapped.length?` · 옮기지 못한 항목 ${converted.unmapped.length}개는 지도 버튼의 여정에서 확인하세요.`:'.'}`);}
 loading.finish();$('titleScreen').classList.add('hidden');$('hud').classList.remove('hidden');hudEditor.apply();
 installErrorScreen();
 window.FERAL={ready:true,map:'expedition',bootTimings:loading.timings,runtime,view,controller,physics:physical,slots,bag,ledger,save,pause,interact,openBag,selectHotbar,stats:()=>({running:ready&&!paused,paused,rewardMarkers:anchorMarkers.markers.size,warning:$('warning').textContent,toast:$('toast').textContent,version:VERSION.version,versionCode:VERSION.versionCode,player:{...runtime.player},regions:runtime.seenRegions.size,models:view.models.size,chunks:runtime.atlas.activeChunks.size,held:slots.held})};
 window.FeralNative={save,pause:()=>{save();if(!paused)pause(true,{quiet:true});},back:()=>{if(hudEditor.editing)hudEditor.cancel();else if(ledger.isOpen)pause(false);else pause();}};
 requestAnimationFrame(frame);
}
boot().catch(e=>{console.error(e);loading.fail(`세계 준비를 완료하지 못했습니다: ${e.message}`);});
