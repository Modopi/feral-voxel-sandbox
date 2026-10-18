// Browser check for the launcher and the game session (docs/ARCHITECTURE.md): the launcher (index.html) makes and
// edits worlds outside the game; every world plays on play.html with the
// same HUD, hotbar, bag, ledger window, menu, settings and controls; features are used through real taps.
// By default assets are served with the Android app's MIME/CSP rules (tools/android-asset-server.mjs).
// Setup steps that grant items or teleport are recorded as prepared state, not as normal progression evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {startAndroidAssetServer} from './android-asset-server.mjs';
import {World,B} from '../app/src/main/assets/world.js';
import {Inventory} from '../app/src/main/assets/inventory.js';
import {Ecology} from '../app/src/main/assets/entities.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const VERSION=JSON.parse(await fs.readFile(new URL('../version.json',import.meta.url),'utf8')),version=VERSION.version;
const out=new URL(process.env.FERAL_UI_OUT||`../verification/${version}-ui/`,import.meta.url);
const server=process.env.FERAL_ASSETS?null:await startAndroidAssetServer();
const assets=process.env.FERAL_ASSETS||`http://127.0.0.1:${server.address().port}/assets`;
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.FERAL_CHROME||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const report={version,assets:server?'Android app MIME/CSP rules':assets,scope:'Chromium SwiftShader with touch input. Prepared items/positions are listed per check; this is not Android hardware or normal-progression evidence.',shared:[],launcher:[],expedition:[],island:[],frontier:[],errors:[]};
const check=(list,name,detail={})=>{list.push({name,...detail});console.log('ok',name);};
const WORLDS=[{id:'default',name:'기본 탐험 맵',type:'island',seed:63026},{id:'frontier',name:'개척 원정',type:'frontier',seed:63026},{id:'beta',name:'기계 베타 맵',type:'machine',seed:63026},{id:'ui-check',name:'UI 검사',type:'expedition',seed:63026},{id:'island-new',name:'새 섬',type:'island',seed:63026}];
// The HUD every map shows; the field HUD (vitals, map/status/interact, journey) is shared by the frontier and the expedition.
const SHARED_HUD=['hud','hotbar','stick','sprintBtn','crouchBtn','crawlBtn','jumpBtn','actBtn','useBtn','inventoryBtn','menuBtn','toast','warning','toolLabel','rangeBtn','crosshair'];
const FIELD_HUD=['vitals','waypoint','journalBtn','statusBtn','journeyHUD','interactBtn'];
async function open(context,url){
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${url}: ${e.message}`));
 await page.addInitScript(worlds=>{window.AndroidApp=window.AndroidApp??{};if(!localStorage.getItem('feral.worlds.v1'))localStorage.setItem('feral.worlds.v1',JSON.stringify(worlds));},WORLDS);
 await page.goto(`${assets}/${url}`);return page;
}
// An original island save (0.13.0 and earlier format) with a built platform, items and animals.
function legacyIslandSave(){
 const world=new World(63026);world.generate();for(let x=74;x<=80;x++)world.set(x,13,88,B.PLANK);
 const inventory=new Inventory();inventory.add('berry',3);inventory.add('arrow',2);const eco=new Ecology(world);eco.populate(20);
 return JSON.stringify({version:2,inventory:inventory.save(),world:world.save(),eco:eco.save(),player:{x:77.5,y:13,z:84.5,yaw:3.14,pitch:-.1},playTime:77,discovered:['초록 능선']});
}
const present=(page,ids)=>page.evaluate(ids=>ids.filter(id=>!document.getElementById(id)),ids);
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 // An old world address (index.html?world=…) forwards to the game session page.
 const page=await open(context,'index.html?world=ui-check');
 const stages=[];for(const started=Date.now();Date.now()-started<120000;){const s=await page.evaluate(()=>({stage:document.getElementById('loadStatus')?.textContent.replace(/ · \d+초$/,''),ready:!!window.FERAL?.ready}));if(s.stage&&stages.at(-1)!==s.stage)stages.push(s.stage);if(s.ready)break;await page.waitForTimeout(50);}
 assert(await page.evaluate(()=>window.FERAL?.ready),'expedition ready within 120 s');
 assert.match(page.url(),/\/play\.html\?world=ui-check$/,'old address forwards to the game session page');
 const bootTimings=await page.evaluate(()=>FERAL.bootTimings);
 assert(bootTimings.some(t=>t.stage.startsWith('건축물 모델'))&&bootTimings.some(t=>t.stage.startsWith('물리 엔진')),'loading reports its stages');
 assert(await page.locator('#titleScreen').isHidden(),'shared title/loading screen hides when ready');
 assert.deepEqual(await present(page,[...SHARED_HUD,...FIELD_HUD]),[],'expedition shows the shared HUD');
 assert.equal(await page.locator('#hotbar .slot').count(),9);
 check(report.expedition,'expedition boots on the game session page with the shared loading screen and HUD',{stages,bootTimings});
 const cdp=await context.newCDPSession(page);
 const tap=async selector=>{for(let attempt=0;;attempt++){try{const target=page.locator(selector).first();await target.scrollIntoViewIfNeeded({timeout:3000});const b=await target.boundingBox();assert(b,selector);await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);return;}catch(e){if(attempt>=4)throw e;await page.waitForTimeout(150);}}};
 const ledgerTap=text=>tap(`#frontierContent button:text-is("${text}")`);
 async function hold(selector,ms){const b=await page.locator(selector).boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:7}]});await page.waitForTimeout(ms);return async()=>cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 async function moveFor(ms){const pad=await page.locator('#stick').boundingBox(),x=pad.x+pad.width/2,y=pad.y+pad.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:3}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-40,id:3}]});await page.waitForTimeout(ms);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 const player=()=>page.evaluate(()=>({...FERAL.runtime.player}));

 // 1. Shared touch controls stay inside the viewport and move the expedition player.
 const layout=[];
 for(const [width,height]of [[390,844],[844,390],[360,640]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(500);
  const r=await page.evaluate(ids=>ids.map(id=>{const b=document.getElementById(id).getBoundingClientRect();return {id,x:b.x,y:b.y,w:b.width,h:b.height};}),['sprintBtn','actBtn','useBtn','jumpBtn','inventoryBtn']);
  for(const b of r)assert(b.x>=0&&b.y>=0&&b.x+b.w<=width+1&&b.y+b.h<=height+1&&b.w>=36&&b.h>=36,`${width}x${height} ${JSON.stringify(b)}`);layout.push({width,height,buttons:r});
 }
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(500);
 let a=await player();await moveFor(900);let b=await player();const walk=Math.hypot(b.x-a.x,b.z-a.z);
 await tap('#sprintBtn');assert.equal(await page.locator('#sprintBtn').getAttribute('aria-pressed'),'true');
 a=await player();await moveFor(900);b=await player();const run=Math.hypot(b.x-a.x,b.z-a.z);await tap('#sprintBtn');
 assert(walk>0.3&&run>walk*1.15,`sprint ${run} vs walk ${walk}`);
 check(report.expedition,'shared stick and sprint button move the expedition player',{layout,walkM:walk,sprintM:run});

 // 2. Machine descend/brake on the shared touch buttons (prepared: one wood voxel machine).
 const machineId=await page.evaluate(()=>{const r=FERAL.runtime;r.progression.grant({wood:1},{claimId:'ui-check:wood'});const m=r.machines.create({name:'검사',gridM:.5,position:{x:r.player.x+2,y:r.surfaceHeight(r.player.x+2,r.player.z),z:r.player.z}});r.machines.attachVoxel(m.machineId,{cell:[0,0,0],materialId:'wood'});r.drivingMachineId=m.machineId;return m.machineId;});
 await page.waitForTimeout(500);
 for(const id of ['descendBtn','brakeBtn']){assert(await page.locator('#'+id).isVisible(),id+' visible while driving');const r=await page.locator('#'+id).boundingBox();assert(r.y+r.height<=391&&r.width>=40,id+' inside viewport');}
 assert(!(await page.locator('#sprintBtn').isVisible()),'sprint hidden while driving');assert.equal(await page.locator('#jumpBtn small').textContent(),'상승');
 let release=await hold('#brakeBtn',350);const braking=await page.evaluate(id=>FERAL.runtime.machines.machines.get(id).command.brake,machineId);await release();
 release=await hold('#descendBtn',350);const pitch=await page.evaluate(id=>FERAL.runtime.machines.machines.get(id).command.pitch,machineId);await release();
 assert.equal(braking,true);assert(pitch<0,`descend pitch ${pitch}`);
 assert.match(await page.locator('#interactBtn').textContent(),/내리기/);
 await tap('#interactBtn');await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>FERAL.runtime.drivingMachineId),null);
 check(report.expedition,'machine descend/brake and leaving through the shared interact button',{prepared:'machine created by script',brake:braking,pitch});

 // 3. One warning line and one queued notification line.
 await page.evaluate(()=>{FERAL.runtime.warn('검사용 경고 · 정면',2);for(const t of ['첫 번째 알림','두 번째 알림','세 번째 알림'])FERAL.runtime.message(t);});
 await page.waitForFunction(()=>/검사용 경고/.test(document.getElementById('warning').textContent),null,{timeout:5000,polling:100});
 const seen=new Set();for(let i=0;i<60&&seen.size<3;i++){const t=await page.locator('#toast').textContent();if(/알림$/.test(t))seen.add(t);await page.waitForTimeout(250);}
 assert.equal(seen.size,3,'queued messages all shown: '+[...seen]);check(report.expedition,'warning line and queued notifications',{toasts:[...seen]});

 // 4. Research pause/resume in the shared ledger window (prepared samples).
 await page.evaluate(()=>FERAL.runtime.progression.grant({raw_timber:1,loose_stone:1},{claimId:'ui-check:samples'}));
 await tap('#statusBtn');assert(await page.locator('#frontierPanel').isVisible(),'ledger opens from the status button');
 await tap('[data-frontier-tab=research]');await page.fill('#researchSearch','관찰');
 await tap('#frontierContent article:has-text("관찰") button');await page.waitForTimeout(1500);
 assert(await page.locator('#frontierContent button:text-is("멈추기")').count(),'pause button visible');
 await ledgerTap('멈추기');const paused=await page.evaluate(()=>({job:FERAL.runtime.progression.researchJob,work:FERAL.runtime.progression.researchProgress.observation?.work}));
 assert.equal(paused.job,null);assert(paused.work>0);
 assert(await page.locator('#frontierContent button:text-is("이어서 연구")').count(),'resume offered');await ledgerTap('이어서 연구');
 assert.equal(await page.evaluate(()=>FERAL.runtime.progression.researchJob?.id),'observation');
 await page.screenshot({path:new URL('research.png',out).pathname});await tap('#frontierClose');
 check(report.expedition,'research pause and resume in the ledger window',{prepared:'samples granted',pausedWork:paused.work});

 // 5. Crafting in the shared bag: recipe tile, timed queue, prioritize, cancel with refund (prepared inputs).
 const recipe=await page.evaluate(()=>{const p=FERAL.runtime.progression,r=p.list('recipe').find(r=>r.station==='hand'&&!r.research&&!Object.keys(r.energy).length);p.grant(Object.fromEntries(Object.entries(r.inputs).map(([id,n])=>[id,n*6])),{claimId:'ui-check:craft'});return {id:r.id,name:r.name,inputs:r.inputs};});
 await tap('#inventoryBtn');assert(await page.locator('#pauseScreen.inventoryMode').isVisible(),'shared bag opens');
 assert.equal(await page.locator('#inventoryGrid .itemSlot').count(),27);assert.equal(await page.locator('#inventoryHotbar .itemSlot').count(),9);
 await page.fill('#recipeSearch',recipe.name);await tap(`[data-recipe="${recipe.id}"]`);await tap('#craftOutput');await tap('#craftOutput');
 await page.waitForTimeout(300);assert.match(await page.locator('#craftQueue').textContent(),/작업 대기열 2/);
 await tap('#craftQueue button:text-is("먼저 진행")');assert.equal(await page.evaluate(()=>FERAL.runtime.progression.jobs.length),2);
 const before=await page.evaluate(()=>({...FERAL.runtime.progression.inventory}));
 await tap('#craftQueue .queueJob button:text-is("취소")');
 const after=await page.evaluate(()=>({...FERAL.runtime.progression.inventory}));
 for(const[id,n]of Object.entries(recipe.inputs))assert(Math.abs((after[id]??0)-(before[id]??0)-n)<1e-9,'refund '+id);
 await page.fill('#recipeSearch','');await page.screenshot({path:new URL('bag-craft-queue.png',out).pathname});
 check(report.expedition,'crafting and the craft queue in the shared bag',{prepared:'inputs granted',recipe:recipe.id});

 // 6. Hotbar: tool wear, held item and using food from the hotbar.
 await page.evaluate(()=>{const r=FERAL.runtime;r.progression.grant({stone_pick:2,food:1},{claimId:'ui-check:pick'});r.player.calories=1000;});
 await tap('#resumeBtn');await page.waitForTimeout(1300);
 const hotbar=await page.evaluate(()=>[...document.querySelectorAll('#hotbar .slot')].map(s=>s.getAttribute('aria-label')));
 assert(hotbar.some(l=>/돌 곡괭이/.test(l)),'tool in hotbar: '+hotbar);
 assert(await page.locator('#hotbar .slot progress.durability').count()>0,'tool wear bar on the hotbar');
 const foodSlot=await page.evaluate(()=>FERAL.slots.slots.findIndex(s=>s?.id==='food'));
 if(foodSlot>8)await page.evaluate(i=>FERAL.slots.move(i,8),foodSlot);
 const slot=await page.evaluate(()=>FERAL.slots.slots.findIndex(s=>s?.id==='food'));
 await tap(`[data-hotbar="${slot}"]`);assert.equal(await page.evaluate(()=>FERAL.stats().held),'food');
 assert.equal(await page.locator('#useBtn small').textContent(),'먹기');
 const calories=await page.evaluate(()=>FERAL.runtime.player.calories);await tap('#useBtn');await page.waitForTimeout(300);
 assert(await page.evaluate(()=>FERAL.runtime.player.calories)>calories+100,'food eaten from the hotbar');
 const english=await page.evaluate(()=>[...document.querySelectorAll('#craftFeedback,#itemDetail,#frontierContent p')].map(p=>p.textContent).filter(t=>/\b[a-z]+_[a-z_]+\b/.test(t)));
 assert.deepEqual(english,[],'no raw failure codes on screen');
 check(report.expedition,'hotbar wear, held item and food use',{prepared:'pick and food granted',hotbar});

 // 7. Shared settings and the shared HUD editor apply to the expedition.
 await tap('#menuBtn');await tap('[data-tab=settings]');
 await page.selectOption('#quality','low');await page.waitForTimeout(200);
 const quality=await page.evaluate(()=>({quality:FERAL.view.quality,radius:FERAL.view.loadRadiusChunks}));assert.deepEqual(quality,{quality:'low',radius:2});
 await page.evaluate(()=>{const f=document.getElementById('fov');f.value='70';f.dispatchEvent(new Event('input'));});assert.equal(await page.evaluate(()=>FERAL.view.camera.fov),70);
 await page.selectOption('#quality','balanced');
 await tap('#editHudBtn');await page.waitForTimeout(300);
 const editor=await page.evaluate(()=>[...document.querySelectorAll('#hudElement option')].map(o=>o.value));
 for(const id of ['vitals','journeyHUD','interactBtn','hotbar','brakeBtn'])assert(editor.includes(id),'HUD editor lists '+id);
 await page.screenshot({path:new URL('hud-editor.png',out).pathname});await tap('#hudCancel');await tap('#resumeBtn');
 check(report.expedition,'shared graphics settings and HUD editor',{quality,editorElements:editor.length});

 // 8. Dungeon: reward marker, focus card, interact label, claim, journey record and device supply disconnect (prepared teleport).
 const site=await page.evaluate(()=>{const r=FERAL.runtime;r.player.x=-1;r.refreshWorld();const inst=[...r.dungeons.instances.values()].find(i=>r.dungeons.anchors(i.id).some(a=>a.kind==='reward'&&a.channel==='salvage'&&!a.claimed)&&i.puzzle);const reward=r.dungeons.anchors(inst.id).find(a=>a.kind==='reward'&&a.channel==='salvage');const p=Array.isArray(reward.position)?{x:reward.position[0],y:reward.position[1],z:reward.position[2]}:reward.position;Object.assign(r.player,{x:p.x+.4,y:p.y+.05,z:p.z+.4,vy:0,pitch:0});r.refreshWorld();return {id:inst.id,template:inst.templateId};});
 await page.waitForTimeout(1500);
 const markers=await page.evaluate(()=>FERAL.stats().rewardMarkers);assert(markers>0,'reward marker shown');
 const card=await page.evaluate(()=>({focus:FERAL.view.worldUI.labels.get('focus').data?.title,interact:document.getElementById('interactBtn').textContent}));
 assert.match(card.interact,/보상 회수/);
 await page.screenshot({path:new URL('reward-marker.png',out).pathname});
 await tap('#interactBtn');await page.waitForTimeout(300);assert.match(await page.locator('#toast').textContent(),/물자 보관함 회수 · /);
 await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>FERAL.stats().rewardMarkers),markers-1,'claimed marker removed');
 await tap('#journalBtn');assert.equal(await page.locator('#frontierTitle').textContent(),'탐험 지도','the map button opens the frontier-style map page');assert(await page.locator('#destinations button').count()>0,'destinations listed');await tap('[data-frontier-tab=journey]');assert.match(await page.locator('#frontierContent').textContent(),/물자 보관함 회수함/);await tap('#frontierClose');
 const supply=await page.evaluate(id=>{const r=FERAL.runtime,d=r.dungeons.devices,p=d._anchorPosition(id,null);Object.assign(r.player,{x:p[0],y:p[1]+.05,z:p[2]+.6});d._state(id).supplies.electrical={ownerId:'removed-battery',type:'electrical',lengthM:2,anchorId:null,items:{}};return true;},site.id);
 await page.waitForTimeout(300);await tap('#statusBtn');await tap('[data-frontier-tab=devices]');await page.waitForTimeout(300);
 assert.match(await page.locator('#frontierContent').textContent(),/장치 세부/);
 await ledgerTap('공급선 분리');assert.equal(await page.evaluate(id=>FERAL.runtime.dungeons.devices._state(id).supplies.electrical,site.id),undefined);
 await page.screenshot({path:new URL('devices.png',out).pathname});await tap('#frontierClose');
 check(report.expedition,'reward marker, interact label, claim, journey record and device supply disconnect',{prepared:'teleport to dungeon; dead supply link injected',template:site.template,focusCard:card.focus,supplyInjected:supply});
 await context.close();

 // Frontier: the same field HUD and ledger window, now from the shared modules.
 const frontier=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const fpage=await open(frontier,'play.html?world=frontier');await fpage.waitForFunction(()=>window.FERAL?.ready&&FERAL.stats().running,null,{timeout:120000});
 assert.deepEqual(await present(fpage,[...SHARED_HUD,...FIELD_HUD]),[],'frontier shows the shared HUD');
 const ftap=async selector=>{const box=await fpage.locator(selector).first().boundingBox();assert(box,selector);await fpage.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);};
 await ftap('#journalBtn');assert.equal(await fpage.locator('#frontierTitle').textContent(),'원정 지도');
 await ftap('[data-frontier-tab=journal]');assert.equal(await fpage.locator('#frontierTitle').textContent(),'캐릭터 상태');await ftap('#frontierClose');
 await ftap('#inventoryBtn');assert.equal(await fpage.locator('#inventoryGrid .itemSlot').count(),27);
 await fpage.screenshot({path:new URL('frontier-bag.png',out).pathname});await frontier.close();
 check(report.frontier,'frontier field HUD, ledger window and bag from shared modules');

 // Basic island: the same runtime and screen as the expedition (island map preset with sandbox rules).
 // An original island save is converted once; the original key stays untouched.
 const island=await browser.newContext({viewport:{width:900,height:412},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const ip=await island.newPage();ip.on('pageerror',e=>report.errors.push(e.message));
 const legacy=legacyIslandSave();
 await ip.addInitScript(legacy=>{window.AndroidApp={};if(!localStorage.getItem('feral.world.v1'))localStorage.setItem('feral.world.v1',legacy);},legacy);
 await ip.goto(`${assets}/play.html?world=default`);await ip.waitForFunction(()=>window.FERAL?.ready&&FERAL.stats().running,null,{timeout:120000});
 const converted=await ip.evaluate(()=>({map:FERAL.runtime.generator.id,platform:FERAL.runtime.atlas.getCell(150,26,176),berry:FERAL.runtime.progression.count('berry'),unmapped:FERAL.runtime.conversion?.unmapped.map(u=>u.name),original:localStorage.getItem('feral.world.v1')?.length,generation:!!(localStorage.getItem('feral.world.v1.a')||localStorage.getItem('feral.world.v1.b')),vitalsHidden:document.getElementById('vitals').hidden}));
 assert.equal(converted.map,'island');assert.equal(converted.platform,'plank','built platform carried over');assert.equal(converted.berry,3);
 assert.equal(converted.original,legacy.length,'original island save untouched');assert(converted.generation,'converted world saved in the shared format');
 assert(converted.unmapped.includes('아이템')&&converted.unmapped.includes('동물 개체'),'unmapped items listed');assert(converted.vitalsHidden,'peaceful island hides health and food');
 assert.match(await ip.locator('#toast').textContent(),/기존 섬 저장을 옮겼습니다|새 장소 발견/);
 assert.deepEqual(await present(ip,[...SHARED_HUD,...FIELD_HUD]),[],'island shows the shared HUD');
 const itap=async selector=>{await ip.locator(selector).first().scrollIntoViewIfNeeded();const box=await ip.locator(selector).first().boundingBox();assert(box,selector);await ip.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);};
 await itap('#journalBtn');assert.equal(await ip.locator('#frontierTitle').textContent(),'탐험 지도');await itap('[data-frontier-tab=journey]');const journey=await ip.locator('#frontierContent').textContent();assert.match(journey,/기존 섬 저장을 옮겼습니다/);assert.match(journey,/옮기지 못한 항목 · 아이템/);assert.match(journey,/잿빛 분화구/);
 await ip.screenshot({path:new URL('island-journey.png',out).pathname});await itap('#frontierClose');
 check(report.island,'original island save converts onto the shared runtime and lists what could not move',{prepared:'0.13.0-format island save with a plank platform',converted});
 const aimDown=()=>ip.evaluate(()=>{FERAL.runtime.player.pitch=-1;});
 const emptySlot=await ip.evaluate(()=>{const i=FERAL.slots.slots.slice(0,9).findIndex(s=>!s);FERAL.selectHotbar(i);return i;});assert(emptySlot>=0);
 await ip.waitForTimeout(300);await aimDown();await ip.waitForTimeout(400);assert.equal(await ip.locator('#useBtn small').textContent(),'관찰');await itap('#useBtn');await ip.waitForTimeout(250);
 assert.match(await ip.locator('#toast').textContent(),/지형 .* m · 거리/);check(report.island,'empty-hand observe lens');
 const water=()=>ip.evaluate(()=>FERAL.runtime.atlas.fluidTotals().volumeM3);
 const waterBefore=await water();
 await itap('#menuBtn');await itap('[data-tab=life]');await itap('[data-sandbox-tool="4"]');await ip.waitForTimeout(400);assert.equal(await ip.evaluate(()=>FERAL.stats().paused),false,'choosing a tool resumes play');
 assert.equal(await ip.locator('#toolName').textContent(),'물 붓기');await aimDown();await itap('#useBtn');await ip.waitForTimeout(600);
 const waterAfter=await water();assert(waterAfter>waterBefore,`water ${waterBefore} -> ${waterAfter}`);
 check(report.island,'sandbox water tool via menu and use button',{waterBefore,waterAfter});
 const stoneSlot=await ip.evaluate(()=>FERAL.slots.slots.slice(0,9).findIndex(s=>s?.id==='loose_stone'));
 // Face away from the poured water so the aimed cell is dry ground.
 const built=await ip.evaluate(()=>{const p=FERAL.runtime.player;p.yaw+=Math.PI;p.pitch=-.9;return FERAL.runtime.progression.count('loose_stone');});
 if(stoneSlot<0)await ip.evaluate(()=>{FERAL.runtime.progression.grant({loose_stone:2},{claimId:'ui-check:stone'});});
 const stoneHotbar=await ip.evaluate(()=>FERAL.slots.slots.slice(0,9).findIndex(s=>s?.id==='loose_stone'));
 await itap(`[data-hotbar="${stoneHotbar}"]`);await ip.waitForTimeout(300);assert.match(await ip.locator('#useBtn small').textContent(),/놓기 ×1/);
 await itap('#useBtn');await ip.waitForTimeout(400);const buildToast=await ip.locator('#toast').textContent();
 const stoneAfter=await ip.evaluate(()=>FERAL.runtime.progression.count('loose_stone'));assert(stoneAfter<Math.max(built,2),`placed a stone block (${built} -> ${stoneAfter}): ${buildToast}`);
 check(report.island,'building a block from the hotbar with mined stone',{stoneBefore:built,stoneAfter});
 await itap('#menuBtn');await itap('[data-tab=settings]');await itap('#showRadar');await itap('#resumeBtn');await ip.waitForTimeout(800);
 assert(await ip.locator('#radar').isVisible(),'radar visible after setting');
 const landmark=await ip.evaluate(()=>{const l=FERAL.runtime.generator.landmarks.find(l=>!FERAL.runtime.discoveredLandmarks.has(l.name));const r=FERAL.runtime;Object.assign(r.player,{x:l.x,z:l.z,y:r.atlas.heightAt(l.x,l.z)+.05,vy:0});return l.name;});
 let discovered=false;for(let i=0;i<30&&!discovered;i++){discovered=(await ip.locator('#toast').textContent()).includes('새 장소 발견');await ip.waitForTimeout(150);}
 assert(discovered,'discovery toast');await ip.screenshot({path:new URL('island.png',out).pathname});
 check(report.island,'minimap setting and place discovery',{prepared:'teleport to landmark',landmark});
 await island.close();
 // A new island world: the island's starting kit, the shared stick, digging with the attack button,
 // the sandbox herd button, and save → reopen keeping the island map, the dug cell and the items.
 const fresh=await browser.newContext({viewport:{width:900,height:412},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const np=await open(fresh,'play.html?world=island-new');await np.waitForFunction(()=>window.FERAL?.ready&&FERAL.stats().running,null,{timeout:120000});
 const ncdp=await fresh.newCDPSession(np);
 const ntap=async selector=>{const box=await np.locator(selector).first().boundingBox();assert(box,selector);await np.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);};
 const start=await np.evaluate(async()=>({map:FERAL.runtime.generator.id,items:FERAL.runtime.progression.inventory,starter:(await import('./content-runtime/maps.js')).STARTER_KIT,conversion:FERAL.runtime.conversion??null,x:FERAL.runtime.player.x,z:FERAL.runtime.player.z}));
 assert.equal(start.map,'island');assert.deepEqual(start.items,start.starter,'a new island starts with the island kit');assert.equal(start.conversion,null);
 const npad=await np.locator('#stick').boundingBox(),sx=npad.x+npad.width/2,sy=npad.y+npad.height/2;
 await ncdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy,id:3}]});await ncdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx,y:sy-40,id:3}]});await np.waitForTimeout(1200);await ncdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await np.waitForTimeout(300);
 const walked=await np.evaluate(s=>Math.hypot(FERAL.runtime.player.x-s.x,FERAL.runtime.player.z-s.z),start);assert(walked>1,`walked ${walked} m`);
 await np.evaluate(()=>{FERAL.runtime.player.pitch=-1.2;});await np.waitForTimeout(300);
 const dig=await np.evaluate(()=>{const h=FERAL.view.aim();const c=['x','y','z'].map(k=>Math.floor((h.point[k]-h.normal[k]*.001)*2));return {kind:h.kind,cell:c,block:FERAL.runtime.atlas.getCell(...c)};});
 assert.equal(dig.kind,'terrain');assert(dig.block,'aimed at a solid cell');
 let taps=0;for(;taps<40&&await np.evaluate(c=>FERAL.runtime.atlas.getCell(...c),dig.cell);taps++){await ntap('#actBtn');await np.waitForTimeout(250);}
 assert.equal(await np.evaluate(c=>FERAL.runtime.atlas.getCell(...c),dig.cell),null,`dug ${dig.block} with ${taps} taps`);
 assert(taps<=3,`the frontier mining rule: ${dig.block} goes in ${taps} strikes`);
 // Gathering is immediate: standing at a starter branch, one tap of the interact button gives the timber.
 const branch=await np.evaluate(()=>{const r=FERAL.runtime,n=r.nodes.find(n=>n.id.startsWith('starter:fallen_branch'));Object.assign(r.player,{x:n.x+.6,z:n.z,y:r.atlas.heightAt(n.x+.6,n.z)+.05,vy:0});return {id:n.id,timber:r.progression.count('raw_timber')};});
 await np.waitForTimeout(400);assert.match(await np.locator('#interactBtn').textContent(),/채집/);await ntap('#interactBtn');await np.waitForTimeout(150);
 const gathered=await np.evaluate(()=>FERAL.runtime.progression.count('raw_timber'));assert(gathered>branch.timber,`timber ${branch.timber} -> ${gathered} at once`);
 // Layered body: a calm deer side-on; real attack taps chip its flank and then hit the ribs under it.
 const deer=await np.evaluate(()=>{const r=FERAL.runtime,p=r.player,x=p.x,z=p.z-1.6,e=r.creatures.spawn('moss_deer',{x,z},{regionId:`${Math.floor(x/64)},${Math.floor(z/64)}`,environmentId:'grove'});
  const pin=()=>{if(!e.dead){e.state='idle';e.targetPoint=null;e.targetId=null;e.nextDecisionAt=1e9;e.nextWanderAt=1e9;e.angerUntil=0;e.attack=null;e.pose.moving=false;e.x=x;e.z=z;e.yaw=Math.PI/2;e.hp=e.maxHp;}if(window.__pinDeer)requestAnimationFrame(pin);};window.__pinDeer=true;pin();
  window.__deerFrom={x:p.x,z:p.z};return {id:e.id,core:e.parts.core.hp};});
 await np.waitForTimeout(1500);
 const swings=[];
 for(let i=0;i<5;i++){
  await np.evaluate(id=>{const r=FERAL.runtime,p=r.player,v=FERAL.view,n=v.models.get(id).parts.get('thorax');Object.assign(p,{x:window.__deerFrom.x,z:window.__deerFrom.z,vx:0,vz:0});n.updateMatrixWorld(true);const t=n.getWorldPosition(v.camera.position.clone()),c=v.camera.position;p.yaw=Math.atan2(-(t.x-c.x),-(t.z-c.z));p.pitch=Math.atan2(t.y+.02-c.y,Math.hypot(t.x-c.x,t.z-c.z));},deer.id);
  await np.waitForTimeout(250);const before=await np.evaluate(id=>FERAL.runtime.creatures.get(id).woundRevision,deer.id);
  await ntap('#actBtn');await np.waitForTimeout(1100);
  swings.push(await np.evaluate(([id,before])=>{const e=FERAL.runtime.creatures.get(id);return {wound:e.woundRevision>before,core:Math.round(e.parts.core.hp)};},[deer.id,before]));
 }
 const flank=await np.evaluate(id=>{window.__pinDeer=false;const e=FERAL.runtime.creatures.get(id);return {wounds:Object.values(e.wounds).reduce((n,l)=>n+l.length,0),core:e.parts.core.hp};},deer.id);
 assert(flank.wounds>0,'shell bites are recorded');assert(flank.core<deer.core,`ribs under the bite take the structural hit (${deer.core} -> ${flank.core})`);
 await np.screenshot({path:new URL('island-creature-wound.png',out).pathname});
 // What is held decides the blow: a prepared weapon of each kind stands in for a crafted one; real attack taps.
 const kinds={};
 for(const kind of ['slash','pierce','blunt']){
  const id=await np.evaluate(kind=>{const r=FERAL.runtime,p=r.player,x=window.__deerFrom.x+3,z=window.__deerFrom.z-1.6,e=r.creatures.spawn('moss_deer',{x,z},{regionId:`${Math.floor(x/64)},${Math.floor(z/64)}`,environmentId:'grove'});
   window.__kindDeer={id:e.id,x,z};window.__pinKind=true;const pin=()=>{if(!e.dead){e.state='idle';e.targetPoint=null;e.targetId=null;e.nextDecisionAt=1e9;e.nextWanderAt=1e9;e.angerUntil=0;e.attack=null;e.pose.moving=false;e.x=x;e.z=z;e.yaw=Math.PI/2;e.hp=e.maxHp;}if(window.__pinKind&&window.__kindDeer.id===e.id)requestAnimationFrame(pin);};pin();
   r.armaments.loadout=()=>({id:'prepared',name:kind,weaponKind:kind,attackMode:kind==='pierce'?'pierce':kind==='blunt'?'impact':'strike',hitDamage:12,attackPeriod:1,range:4.4});r.armaments.recordAttack=()=>({ok:true});return e.id;},kind);
  await np.waitForTimeout(1500);
  // Move first and let the camera follow before aiming from it.
  await np.evaluate(()=>{Object.assign(FERAL.runtime.player,{x:window.__kindDeer.x,z:window.__kindDeer.z+1.6,vx:0,vz:0});});await np.waitForTimeout(400);
  await np.evaluate(id=>{const r=FERAL.runtime,p=r.player,v=FERAL.view,n=v.models.get(id).parts.get('thorax');n.updateMatrixWorld(true);const t=n.getWorldPosition(v.camera.position.clone()),c=v.camera.position;p.yaw=Math.atan2(-(t.x-c.x),-(t.z-c.z));p.pitch=Math.atan2(t.y+.02-c.y,Math.hypot(t.x-c.x,t.z-c.z));},id);
  await np.waitForTimeout(300);const before=await np.evaluate(id=>({core:FERAL.runtime.creatures.get(id).parts.core.hp,help:document.getElementById('toolHelp').textContent}),id);
  await ntap('#actBtn');await np.waitForTimeout(1100);
  kinds[kind]=await np.evaluate(([id,before])=>{const e=FERAL.runtime.creatures.get(id),cuts=Object.values(e.wounds).flat();window.__pinKind=false;return {help:before.help,cuts:cuts.map(c=>c.slice(3)),boneHit:e.parts.core.hp<before.core};},[id,before]);
 }
 await np.evaluate(()=>{delete FERAL.runtime.armaments.loadout;delete FERAL.runtime.armaments.recordAttack;});
 assert.match(kinds.slash.help,/베기/);assert.match(kinds.pierce.help,/관통/);assert.match(kinds.blunt.help,/충격/);
 assert(kinds.slash.cuts.length===1&&Math.max(...kinds.slash.cuts[0])>=.25&&Math.min(...kinds.slash.cuts[0])<=.0625,`a sword cuts a long thin line: ${JSON.stringify(kinds)}`);
 assert(kinds.pierce.cuts.length===1&&Math.max(...kinds.pierce.cuts[0])>=.3,'a spear cuts a deep line');
 assert(kinds.pierce.boneHit,'the spear line reaches bone');
 assert(kinds.blunt.cuts.length===0&&kinds.blunt.boneHit,'a blunt blow leaves the shell closed and lands on bone');
 await ntap('#statusBtn');await np.waitForTimeout(300);
 const sheet=await np.evaluate(()=>({manual:!!document.getElementById('attackStyle'),text:document.querySelector('.combatStats')?.textContent??''}));
 assert(!sheet.manual,'no manual attack style button');assert.match(sheet.text,/타격 방식.*점타격/);await ntap('#frontierClose');
 await ntap('#menuBtn');await ntap('[data-tab=life]');const herdBefore=await np.evaluate(()=>FERAL.runtime.creatures.entities.length);
 await ntap('#herdBtn');const herdAfter=await np.evaluate(()=>FERAL.runtime.creatures.entities.length);assert(herdAfter>=herdBefore+20,`herd ${herdBefore} -> ${herdAfter}`);
 await ntap('#resumeBtn');await np.waitForTimeout(300);
 await ntap('#menuBtn');await np.waitForTimeout(200);
 const saved=await np.evaluate(()=>({x:FERAL.runtime.player.x,z:FERAL.runtime.player.z,items:FERAL.runtime.progression.inventory,places:[...FERAL.runtime.discoveredLandmarks]}));
 await np.reload();await np.waitForFunction(()=>window.FERAL?.ready&&FERAL.stats().running,null,{timeout:120000});
 const reopened=await np.evaluate(([c,deerId])=>({wounds:Object.values(FERAL.runtime.creatures.get(deerId)?.wounds??{}).reduce((n,l)=>n+l.length,0),map:FERAL.runtime.generator.id,cell:FERAL.runtime.atlas.getCell(...c),x:FERAL.runtime.player.x,z:FERAL.runtime.player.z,items:FERAL.runtime.progression.inventory,places:[...FERAL.runtime.discoveredLandmarks]}),[dig.cell,deer.id]);
 assert.equal(reopened.map,'island');assert.equal(reopened.cell,null,'the dug cell stays dug');assert.deepEqual(reopened.items,saved.items);assert.deepEqual(reopened.places,saved.places);
 assert(Math.hypot(reopened.x-saved.x,reopened.z-saved.z)<.05,'position restored');assert.equal(reopened.wounds,flank.wounds,'creature wounds survive save and reopen');
 await np.screenshot({path:new URL('island-new.png',out).pathname});
 check(report.island,'new island: starting kit, stick walk, frontier digging, instant gathering, shell bites and bone hits, automatic hit by tool and weapon kind, herd button, save and reopen',{walkedM:walked,dug:dig.block,taps,gathered:[branch.timber,gathered],swings,flank,weaponKinds:kinds,herd:[herdBefore,herdAfter],places:reopened.places,woundsAfterReopen:reopened.wounds});
 await fresh.close();

 // Launcher: the first screen, outside the game. World settings are made and changed here; the engine never starts here.
 const lc=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const lp=await lc.newPage();lp.on('pageerror',e=>report.errors.push(`launcher: ${e.message}`));
 await lp.addInitScript(()=>{window.__healthy=[];window.__runtimeFailed=0;window.AndroidApp={runtimeHealthy(code){window.__healthy.push(code);},runtimeFailed(){window.__runtimeFailed++;}};});
 const ltap=async selector=>{const l=lp.locator(selector).first();await l.scrollIntoViewIfNeeded();const box=await l.boundingBox();assert(box,selector);await lp.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);};
 await lp.goto(`${assets}/index.html`);
 await lp.waitForFunction(()=>window.FeralLauncher?.health.reported,null,{timeout:30000});
 const lstart=await lp.evaluate(()=>({landing:!document.getElementById('landing').hidden,engine:!!window.FERAL,canvas:!!document.getElementById('world'),health:{...window.FeralLauncher.health},healthy:window.__healthy,continueShown:!document.getElementById('continueWorld').hidden,version:document.querySelector('[data-game-version]').textContent}));
 assert(lstart.landing&&!lstart.engine&&!lstart.canvas,'the launcher shows its landing without the game engine');
 assert.equal(lstart.health.sessionFiles,'ok','the game session files load (not run) before the app hears healthy');assert.deepEqual(lstart.healthy,[VERSION.versionCode]);
 assert.equal(lstart.continueShown,false,'nothing to continue before any world was played');
 await lp.screenshot({path:new URL('launcher-landing.png',out).pathname});
 check(report.launcher,'app start opens the launcher landing; game files are checked, then the app is told the version started',lstart);
 await ltap('#openWorlds');
 const listed=await lp.evaluate(()=>[...document.querySelectorAll('#worlds article b')].map(b=>b.textContent));
 assert.deepEqual(listed,['기본 탐험 맵','개척 원정','기계 베타 맵'],'the default worlds are listed');
 await ltap('#newWorld');await lp.selectOption('#preset','expedition');
 const createRules=await lp.evaluate(()=>[...document.querySelectorAll('#worldRules input')].map(i=>[i.dataset.rule,i.checked,i.disabled]));
 assert.deepEqual(createRules,[['survival',true,false],['sandbox',false,false],['startStructures',true,false],['dropOnDeath',true,false]],'an expedition world offers what its session reads');
 await ltap('#worldName');await lp.fill('#worldName','평화 탐험');await ltap('#rule-survival');await ltap('#rule-sandbox');
 await lp.screenshot({path:new URL('launcher-create.png',out).pathname});
 await ltap('#worldSubmit');
 const made=await lp.evaluate(()=>JSON.parse(localStorage.getItem('feral.worlds.v1')).find(w=>w.name==='평화 탐험'));
 assert.equal(made.type,'expedition');assert.deepEqual(made.config.rules,{survival:false,sandbox:true,startStructures:true,dropOnDeath:true});assert.equal(made.config.configVersion,1);
 check(report.launcher,'a new world is made in the launcher with its own settings',{stored:made.config});
 await ltap(`article[data-world="${made.id}"] button:nth-of-type(2)`);
 const editRules=await lp.evaluate(()=>[...document.querySelectorAll('#worldRules input')].map(i=>[i.dataset.rule,i.checked,i.disabled]));
 assert.deepEqual(editRules,[['survival',false,false],['sandbox',true,false],['startStructures',true,true],['dropOnDeath',true,false]],'settings that shaped the world are fixed after creation');
 await lp.fill('#worldName','평화 탐험 1');await ltap('#rule-dropOnDeath');await ltap('#worldSubmit');
 const edited=await lp.evaluate(id=>JSON.parse(localStorage.getItem('feral.worlds.v1')).find(w=>w.id===id),made.id);
 assert.equal(edited.name,'평화 탐험 1');assert.equal(edited.config.rules.dropOnDeath,false,'the death rule can change after creation');
 check(report.launcher,'world settings are edited in the launcher; creation-only settings stay fixed',{editRules});
 await ltap('#worldsView .launcherBack');await ltap('#openSettings');await ltap('#showEvents');
 const stored=await lp.evaluate(()=>JSON.parse(localStorage.getItem('feral.settings')));assert.equal(stored.showEvents,true);
 await lp.screenshot({path:new URL('launcher-settings.png',out).pathname});
 await ltap('#settingsView .launcherBack');await ltap('#openUpdates');
 assert.equal(await lp.locator('#gameVersion').textContent(),VERSION.version);await ltap('#updatesView .launcherBack');
 check(report.launcher,'global settings and the update panel are in the launcher (the same parts as the in-game menu)',{settings:stored});
 await ltap('#openWorlds');await ltap(`article[data-world="${made.id}"] button:nth-of-type(1)`);
 await lp.waitForURL(/play\.html\?world=/);await lp.waitForFunction(()=>window.FERAL?.ready&&FERAL.stats().running,null,{timeout:120000});
 const session=await lp.evaluate(()=>({rules:FERAL.runtime.rules,vitalsHidden:document.getElementById('vitals').hidden,showEvents:document.getElementById('showEvents').checked,eventsClass:document.body.classList.contains('showEvents')}));
 assert.equal(session.rules.survival,false,'the session follows the world settings from the launcher');assert.equal(session.rules.dropOnDeath,false);assert(session.vitalsHidden);
 assert(session.showEvents&&session.eventsClass,'the session reads the global settings made in the launcher');
 // Content exploration with the sandbox setting (S1): the same life tab and tools, placing the local ecology, not the island's.
 await ltap('#menuBtn');await ltap('[data-tab=life]');
 const ecology=await lp.evaluate(async()=>{const r=FERAL.runtime,{CONTENT}=await import('./content-runtime/catalog.generated.js'),env=r.atlas.sample(r.player.x,r.player.z).environmentId;
  const species=CONTENT.environments.entries.find(e=>e.id===env).spawning.rules.map(x=>x.speciesId),grazer=CONTENT.creatures.entries.find(c=>species.includes(c.id)&&c.role==='primary_consumer');
  return {env,species,grazer:grazer?.name,before:r.creatures.entities.map(e=>e.id),panel:document.querySelector('[data-panel="world"] > p').textContent};});
 await ltap('#herdBtn');await lp.waitForTimeout(300);
 const herd=await lp.evaluate(before=>{const r=FERAL.runtime,old=new Set(before);return {placed:r.creatures.entities.filter(e=>!old.has(e.id)).map(e=>e.speciesId),count:document.getElementById('herbCount').textContent,label:document.getElementById('herbName').textContent};},ecology.before);
 assert.equal(herd.placed.length,24,'the herd button places 24 creatures');assert(herd.placed.every(id=>ecology.species.includes(id)),`placed ${[...new Set(herd.placed)]} from ${ecology.env} (${ecology.species})`);
 assert.equal(herd.label,ecology.grazer,'the life tab names the grazer of the local ecology');assert(Number(herd.count)>0);
 assert.match(ecology.panel,/평화 규칙/);assert.match(ecology.panel,/샌드박스/);
 check(report.launcher,'content exploration with the sandbox setting uses the shared life tab and places the local ecology',{environment:ecology.env,placed:[...new Set(herd.placed)],label:herd.label});
 await ltap('[data-tab=world]');await ltap('#worldListBtn');
 await lp.waitForURL(/index\.html$/);await lp.waitForFunction(()=>window.FeralLauncher?.ready,null,{timeout:30000});
 const back=await lp.evaluate(()=>({continueShown:!document.getElementById('continueWorld').hidden,name:document.getElementById('continueName').textContent}));
 assert.deepEqual(back,{continueShown:true,name:'평화 탐험 1'},'leaving saves and returns to the launcher, which offers to continue');
 await lp.screenshot({path:new URL('launcher-continue.png',out).pathname});
 check(report.launcher,'play from the launcher, session uses the world and global settings, save and return, continue',{session,back});
 // App 0.3.3 gives a build picked in its version list its own `feral.*` storage (empty if it never ran). The save vault brings the saves back.
 await lp.waitForFunction(()=>window.FeralLauncher?.vault&&!window.FeralLauncher.vault.error,null,{timeout:30000});await lp.evaluate(()=>FeralLauncher.restoring);await lp.waitForTimeout(800);
 const beforeSwitch=await lp.evaluate(id=>({keys:Object.keys(localStorage).filter(k=>k.startsWith('feral.')&&k!=='feral.vault.v1').sort(),save:localStorage.getItem(`feral.slot.${id}.a`)??localStorage.getItem(`feral.slot.${id}.b`)}),made.id);
 assert(beforeSwitch.save,'the world has a save before the switch');
 await lp.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('feral.'))localStorage.removeItem(k);});
 await lp.reload();await lp.waitForFunction(()=>window.FeralLauncher?.ready,null,{timeout:30000});await lp.evaluate(()=>FeralLauncher.restoring);
 const afterSwitch=await lp.evaluate(id=>({keys:Object.keys(localStorage).filter(k=>k.startsWith('feral.')&&k!=='feral.vault.v1').sort(),restored:FeralLauncher.vault.restored.length,status:document.getElementById('launcherStatus').textContent,continueName:document.getElementById('continueName').textContent,save:localStorage.getItem(`feral.slot.${id}.a`)??localStorage.getItem(`feral.slot.${id}.b`)}),made.id);
 assert.deepEqual(afterSwitch.keys,beforeSwitch.keys,'every saved key is back');assert.equal(afterSwitch.save,beforeSwitch.save,'the world save is the same');
 assert.match(afterSwitch.status,/이전 게임 버전의 저장 \d+개를 가져왔습니다/);assert.equal(afterSwitch.continueName,'평화 탐험 1');
 await lp.screenshot({path:new URL('launcher-vault-restored.png',out).pathname});
 await ltap('#continueWorld');await lp.waitForURL(/play\.html\?world=/);await lp.waitForFunction(()=>window.FERAL?.ready&&FERAL.stats().running,null,{timeout:120000});
 const resumed=await lp.evaluate(()=>({survival:FERAL.runtime.rules.survival,time:FERAL.runtime.time}));assert.equal(resumed.survival,false);assert(resumed.time>0,'the world resumes from its save, not a new world');
 await ltap('#menuBtn');await ltap('[data-tab=world]');await ltap('#worldListBtn');await lp.waitForURL(/index\.html$/);await lp.waitForFunction(()=>window.FeralLauncher?.ready,null,{timeout:30000});
 check(report.launcher,'a version switch that empties the app storage keeps the worlds: the launcher restores them from the save vault and the world resumes',{prepared:'all feral.* keys cleared as app 0.3.3 does for a build picked in its version list',keys:afterSwitch.keys.length,restored:afterSwitch.restored,resumed});
 await ltap('#openWorlds');await ltap('article[data-world="beta"] button:nth-of-type(1)');await lp.waitForURL(/machine\.html\?world=beta/);
 await lp.goto(`${assets}/index.html`);await ltap('#openWorlds');await ltap(`article[data-world="${made.id}"] button:nth-of-type(3)`);
 await lp.evaluate(()=>FeralNative.back());assert.equal(await lp.locator('#confirm').evaluate(d=>d.open),false,'the Android back button closes a dialog');
 await ltap(`article[data-world="${made.id}"] button:nth-of-type(3)`);await ltap('#deleteYes');
 const gone=await lp.evaluate(id=>({listed:JSON.parse(localStorage.getItem('feral.worlds.v1')).some(w=>w.id===id),saves:Object.keys(localStorage).filter(k=>k.startsWith(`feral.slot.${id}`))}),made.id);
 assert.deepEqual(gone,{listed:false,saves:[]});await lp.evaluate(()=>FeralNative.back());assert.equal(await lp.locator('#landing').isVisible(),true,'back returns to the landing');
 check(report.launcher,'the machine field opens through the same session entry; delete with confirmation; Android back',{gone});
 await lc.close();
 // A version whose game session files cannot load is reported as failed from the launcher, so the app rolls it back.
 const bc=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const bp=await bc.newPage();
 await bp.addInitScript(()=>{window.__healthy=[];window.__runtimeFailed=0;window.AndroidApp={runtimeHealthy(code){window.__healthy.push(code);},runtimeFailed(){window.__runtimeFailed++;}};});
 await bp.route('**/content-runtime/runtime.js',route=>route.fulfill({status:404,body:''}));
 await bp.goto(`${assets}/index.html`);await bp.waitForFunction(()=>window.FeralLauncher?.health.sessionFiles==='failed',null,{timeout:30000});await bp.waitForTimeout(3500);
 const broken=await bp.evaluate(()=>({failed:window.__runtimeFailed,healthy:window.__healthy,text:document.getElementById('launcherStatus').textContent}));
 assert.equal(broken.failed,1);assert.deepEqual(broken.healthy,[]);assert.match(broken.text,/되돌립니다/);await bc.close();
 check(report.launcher,'broken game files: the launcher reports a failed start instead of healthy',broken);

 // A module that cannot load must end in a visible failure with retry on the shared loading screen.
 const failing=await browser.newContext({viewport:{width:900,height:412},isMobile:true,hasTouch:true});const fp=await failing.newPage();
 await fp.addInitScript(worlds=>{window.__runtimeFailed=0;window.AndroidApp={runtimeFailed(){window.__runtimeFailed++;}};localStorage.setItem('feral.worlds.v1',JSON.stringify(worlds));},WORLDS);
 await fp.route('**/content-runtime/voxel/solid.js',route=>route.fulfill({status:200,contentType:'application/octet-stream',body:'export {}'}));
 await fp.goto(`${assets}/play.html?world=ui-check`);await fp.waitForFunction(()=>window.FeralLoading?.failed,null,{timeout:30000});
 const failure=await fp.evaluate(()=>({text:document.getElementById('loadStatus').textContent,retry:!document.getElementById('loadingRetry').hidden,backToLauncher:getComputedStyle(document.getElementById('loadingBack')).display!=='none',runtimeFailed:window.__runtimeFailed}));
 assert.match(failure.text,/불러오지 못했습니다/);assert(failure.retry);assert(failure.backToLauncher,'a failed session offers the way back to the launcher');assert.equal(failure.runtimeFailed,1);await fp.screenshot({path:new URL('loading-failure.png',out).pathname});await failing.close();
 check(report.shared,'module load failure shows retry instead of endless loading',failure);
 assert.deepEqual(report.errors,[]);
}catch(e){report.failure=e.stack;process.exitCode=1;}finally{await fs.writeFile(new URL('report.json',out),JSON.stringify(report,null,2));await browser.close();server?.close();}
console.log(JSON.stringify({launcher:report.launcher.length,shared:report.shared.length,expedition:report.expedition.length,frontier:report.frontier.length,island:report.island.length,errors:report.errors,failure:report.failure?.split('\n')[0]}));
