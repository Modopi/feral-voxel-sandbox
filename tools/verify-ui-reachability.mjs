// Browser check for 0.12.0 UI reachability: every connected feature is used through real taps/clicks.
// Setup steps that grant items or teleport are recorded as prepared state, not as normal progression evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const out=new URL('../verification/0.12.0-ui/',import.meta.url),base=process.env.FERAL_BASE||'http://127.0.0.1:8081';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.FERAL_CHROME||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const report={scope:'Chromium SwiftShader with touch input. Prepared items/positions are listed per check; this is not Android hardware or normal-progression evidence.',expedition:[],island:[],errors:[]};
const check=(list,name,detail={})=>{list.push({name,...detail});console.log('ok',name);};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{window.AndroidApp={};if(!localStorage.getItem('feral.worlds.v1'))localStorage.setItem('feral.worlds.v1',JSON.stringify([{id:'ui-check',name:'UI 검사',type:'expedition',seed:63026}]));});
 await page.goto(`${base}/app/src/main/assets/expedition.html?world=ui-check`);
 await page.waitForFunction(()=>window.FERAL?.ready,null,{timeout:120000});
 const cdp=await context.newCDPSession(page);
 // The panel list re-renders every second, so resolve, scroll and tap again if a row is replaced mid-way.
 const tap=async selector=>{for(let attempt=0;;attempt++){try{const target=page.locator(selector).first();await target.scrollIntoViewIfNeeded({timeout:3000});const b=await target.boundingBox();assert(b,selector);await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);return;}catch(e){if(attempt>=4)throw e;await page.waitForTimeout(150);}}};
 const tapText=async text=>tap(`#panelList button:text-is("${text}")`);
 async function hold(selector,ms){const b=await page.locator(selector).boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:7}]});await page.waitForTimeout(ms);return async()=>cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 async function moveFor(ms){const pad=await page.locator('#movePad').boundingBox(),x=pad.x+pad.width/2,y=pad.y+pad.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:3}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-40,id:3}]});await page.waitForTimeout(ms);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 const player=()=>page.evaluate(()=>({...FERAL.runtime.player}));

 // 0. New touch controls stay inside the viewport at phone sizes.
 const layout=[];
 for(const [width,height]of [[390,844],[844,390],[360,640]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(500);
  const r=await page.evaluate(()=>{const b=document.getElementById('sprint').getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};});
  assert(r.x>=0&&r.y>=0&&r.x+r.w<=width+1&&r.y+r.h<=height+1&&r.w>=40&&r.h>=40,`${width}x${height} sprint ${JSON.stringify(r)}`);layout.push({width,height,sprint:r});
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);check(report.expedition,'sprint button inside viewport at three sizes',{layout});
 // 1. Sprint toggle on touch.
 let a=await player();await moveFor(900);let b=await player();const walk=Math.hypot(b.x-a.x,b.z-a.z);
 await tap('#sprint');assert.equal(await page.locator('#sprint').getAttribute('aria-pressed'),'true');
 a=await player();await moveFor(900);b=await player();const run=Math.hypot(b.x-a.x,b.z-a.z);await tap('#sprint');
 assert(run>walk*1.15,`sprint ${run} vs walk ${walk}`);check(report.expedition,'touch sprint toggle',{walkM:walk,sprintM:run});

 // 2. Machine descend/brake buttons while driving (prepared: one wood voxel machine).
 const machineId=await page.evaluate(()=>{const r=FERAL.runtime;r.progression.grant({wood:1},{claimId:'ui-check:wood'});const m=r.machines.create({name:'검사',gridM:.5,position:{x:r.player.x+2,y:r.surfaceHeight(r.player.x+2,r.player.z),z:r.player.z}});r.machines.attachVoxel(m.machineId,{cell:[0,0,0],materialId:'wood'});r.drivingMachineId=m.machineId;return m.machineId;});
 await page.waitForTimeout(400);
 for(const id of ['descend','brake']){assert(await page.locator('#'+id).isVisible(),id+' visible while driving');const r=await page.locator('#'+id).boundingBox();assert(r.y+r.height<=845&&r.width>=40,id+' inside viewport');}
 assert(!(await page.locator('#sprint').isVisible()),'sprint hidden while driving');assert.equal(await page.locator('#jump').textContent(),'상승');
 let release=await hold('#brake',350);const braking=await page.evaluate(id=>FERAL.runtime.machines.machines.get(id).command.brake,machineId);await release();
 release=await hold('#descend',350);const pitch=await page.evaluate(id=>FERAL.runtime.machines.machines.get(id).command.pitch,machineId);await release();
 assert.equal(braking,true);assert(pitch<0,`descend pitch ${pitch}`);
 await tap('#use');await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>FERAL.runtime.drivingMachineId),null);
 check(report.expedition,'touch machine descend/brake',{prepared:'machine created by script',brake:braking,pitch});

 // 3. Warning banner and toast queue.
 await page.evaluate(()=>{FERAL.runtime.warn('검사용 경고 · 정면',2);for(const t of ['첫 번째 알림','두 번째 알림','세 번째 알림'])FERAL.runtime.message(t);});
 await page.waitForTimeout(400);assert.match(await page.locator('#warning').textContent(),/검사용 경고/);
 const seen=new Set();for(let i=0;i<40&&seen.size<3;i++){const t=await page.locator('#toast').textContent();if(/알림$/.test(t))seen.add(t);await page.waitForTimeout(250);}
 assert.equal(seen.size,3,'queued messages all shown: '+[...seen]);check(report.expedition,'warning banner and toast queue',{toasts:[...seen]});

 // 4. Research pause/resume through the panel (prepared samples).
 await page.evaluate(()=>FERAL.runtime.progression.grant({raw_timber:1,loose_stone:1},{claimId:'ui-check:samples'}));
 await tap('#openBag');await tap('[data-tab=research]');await page.fill('#search','관찰');
 await tap('#panelList article:has-text("관찰") button');await page.waitForTimeout(1500);
 assert(await page.locator('#panelList button:text-is("멈추기")').count(),'pause button visible');
 await tapText('멈추기');const paused=await page.evaluate(()=>({job:FERAL.runtime.progression.researchJob,work:FERAL.runtime.progression.researchProgress.observation?.work}));
 assert.equal(paused.job,null);assert(paused.work>0);
 assert(await page.locator('#panelList button:text-is("이어서 연구")').count(),'resume offered');await tapText('이어서 연구');
 assert.equal(await page.evaluate(()=>FERAL.runtime.progression.researchJob?.id),'observation');
 await page.fill('#search','');await page.screenshot({path:new URL('research.png',out).pathname});
 check(report.expedition,'research pause and resume',{prepared:'samples granted',pausedWork:paused.work});

 // 5. Craft queue: batch, prioritize and cancel with refund (prepared inputs).
 const recipe=await page.evaluate(()=>{const p=FERAL.runtime.progression,r=p.list('recipe').find(r=>r.station==='hand'&&!r.research&&!Object.keys(r.energy).length);p.grant(Object.fromEntries(Object.entries(r.inputs).map(([id,n])=>[id,n*6])),{claimId:'ui-check:craft'});return {id:r.id,name:r.name,inputs:r.inputs};});
 await tap('[data-tab=craft]');await page.fill('#search',recipe.name);
 await tap(`#panelList article:has-text("${recipe.name}") button:text-is("제작")`);await tap(`#panelList article:has-text("${recipe.name}") button:text-is("5개")`);
 await page.fill('#search','');await page.waitForTimeout(300);
 assert.match(await page.locator('#panelList').textContent(),/작업 대기열 2/);
 await tapText('먼저 진행');const order=await page.evaluate(()=>FERAL.runtime.progression.jobs.map(j=>j.count));assert.deepEqual(order,[5,1]);
 const before=await page.evaluate(()=>({...FERAL.runtime.progression.inventory}));
 await tap('#panelList article:has-text("× 5") button:text-is("취소")');
 const after=await page.evaluate(()=>({...FERAL.runtime.progression.inventory}));
 for(const[id,n]of Object.entries(recipe.inputs))assert(Math.abs((after[id]??0)-(before[id]??0)-n*5)<1e-9,'refund '+id);
 await page.screenshot({path:new URL('craft-queue.png',out).pathname});check(report.expedition,'craft queue batch/prioritize/cancel',{prepared:'inputs granted',recipe:recipe.id});

 // 6. Inventory durability and Korean failure text.
 await page.evaluate(()=>FERAL.runtime.progression.grant({stone_pick:2},{claimId:'ui-check:pick'}));
 await tap('[data-tab=inventory]');assert.match(await page.locator('#panelList').textContent(),/내구 \d+\/\d+ · 예비 1개/);
 const english=await page.evaluate(()=>[...document.querySelectorAll('#panelList p')].map(p=>p.textContent).filter(t=>/\b[a-z]+_[a-z_]+\b/.test(t)));
 assert.deepEqual(english,[],'no raw failure codes in panel');check(report.expedition,'tool durability and translated reasons');

 // 7. Dungeon: reward marker, prompt, claim text, device details and supply disconnect (prepared teleport).
 const site=await page.evaluate(()=>{const r=FERAL.runtime;r.player.x=-1;r.refreshWorld();const inst=[...r.dungeons.instances.values()].find(i=>r.dungeons.anchors(i.id).some(a=>a.kind==='reward'&&a.channel==='salvage'&&!a.claimed)&&i.puzzle);const reward=r.dungeons.anchors(inst.id).find(a=>a.kind==='reward'&&a.channel==='salvage');const p=Array.isArray(reward.position)?{x:reward.position[0],y:reward.position[1],z:reward.position[2]}:reward.position;Object.assign(r.player,{x:p.x+.4,y:p.y+.05,z:p.z+.4,vy:0});r.refreshWorld();return {id:inst.id,template:inst.templateId};});
 await tap('#closePanel');await page.waitForTimeout(1500);
 const markers=await page.evaluate(()=>FERAL.stats().rewardMarkers);assert(markers>0,'reward marker shown');
 assert.match(await page.locator('#aimLabel').textContent(),/물자 보관함 · 사용해서 회수|물자 보관함/);
 await page.screenshot({path:new URL('reward-marker.png',out).pathname});
 await tap('#use');await page.waitForTimeout(300);assert.match(await page.locator('#toast').textContent(),/물자 보관함 회수 · /);
 await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>FERAL.stats().rewardMarkers),markers-1,'claimed marker removed');
 await tap('#openBag');await tap('[data-tab=journal]');assert.match(await page.locator('#panelList').textContent(),/물자 보관함 회수함/);
 const supply=await page.evaluate(id=>{const r=FERAL.runtime,d=r.dungeons.devices,p=d._anchorPosition(id,null);Object.assign(r.player,{x:p[0],y:p[1]+.05,z:p[2]+.6});d._state(id).supplies.electrical={ownerId:'removed-battery',type:'electrical',lengthM:2,anchorId:null,items:{}};return true;},site.id);
 await tap('#closePanel');await page.waitForTimeout(300);
 await tap('#openBag');await tap('[data-tab=devices]');await page.waitForTimeout(300);
 const devicesText=await page.locator('#panelList').textContent();assert.match(devicesText,/장치 세부/);
 await tapText('공급선 분리');assert.equal(await page.evaluate(id=>FERAL.runtime.dungeons.devices._state(id).supplies.electrical,site.id),undefined);
 await page.screenshot({path:new URL('devices.png',out).pathname});await tap('#closePanel');
 check(report.expedition,'reward marker, claim, journal, device details and supply disconnect',{prepared:'teleport to dungeon; dead supply link injected',template:site.template,supplyInjected:supply});
 await context.close();

 // Island (legacy world).
 const island=await browser.newContext({viewport:{width:900,height:412},isMobile:true,hasTouch:true,deviceScaleFactor:1});
 const ip=await island.newPage();ip.on('pageerror',e=>report.errors.push(e.message));
 await ip.addInitScript(()=>{window.AndroidApp={};localStorage.removeItem('feral.world.v1');});
 await ip.goto(`${base}/app/src/main/assets/index.html`);await ip.waitForFunction(()=>window.FERAL?.ready,null,{timeout:120000});
 await ip.click('#startBtn');await ip.waitForTimeout(1500);
 const itap=async selector=>{await ip.locator(selector).first().scrollIntoViewIfNeeded();const box=await ip.locator(selector).first().boundingBox();assert(box,selector);await ip.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);};
 const aimDown=()=>ip.evaluate(()=>{FERAL.player.pitch=-1;});
 // Empty hand: the use button observes terrain.
 await ip.evaluate(()=>{const inv=FERAL.inventory,empty=inv.slots.slice(0,9).findIndex(s=>!s);if(empty>=0)inv.select(empty);else{inv.slots[8]=null;inv.select(8);}});
 await ip.waitForTimeout(400);await aimDown();await ip.waitForTimeout(300);await itap('#useBtn');await ip.waitForTimeout(250);
 assert.match(await ip.locator('#toast').textContent(),/지형 .* m · 거리/);check(report.island,'empty-hand observe lens');
 // Sandbox water tool from the menu.
 const water=()=>ip.evaluate(()=>{let n=0;for(const f of FERAL.world.fluids.values())n+=f.v;return n;});
 const waterBefore=await water();
 await itap('#menuBtn');await itap('[data-tab=life]');await itap('[data-sandbox-tool="4"]');await ip.waitForTimeout(400);assert.equal(await ip.evaluate(()=>FERAL.stats().paused),false,'choosing a tool resumes play');
 assert.equal(await ip.locator('#toolName').textContent(),'물 붓기');await aimDown();await itap('#useBtn');await ip.waitForTimeout(600);
 const waterAfter=await water();assert(waterAfter>waterBefore,`water ${waterBefore} -> ${waterAfter}`);
 check(report.island,'sandbox water tool via menu and use button',{waterBefore,waterAfter});
 // Minimap setting and discovery toast.
 await itap('#menuBtn');await itap('[data-tab=settings]');await itap('#showRadar');await itap('#resumeBtn');await ip.waitForTimeout(400);
 assert(await ip.locator('#radar').isVisible(),'radar visible after setting');
 const landmark=await ip.evaluate(()=>{const p=FERAL.world.landmarks.at(-1);FERAL.player.x=p.x;FERAL.player.z=p.z;FERAL.player.y=FERAL.world.surface(p.x,p.z)+.05;return p.name;});
 let discovered=false;for(let i=0;i<20&&!discovered;i++){discovered=(await ip.locator('#toast').textContent()).includes('새 장소 발견');await ip.waitForTimeout(150);}
 assert(discovered,'discovery toast');await ip.screenshot({path:new URL('island.png',out).pathname});
 check(report.island,'minimap setting and discovery toast',{prepared:'teleport to landmark',landmark});
 assert.deepEqual(report.errors,[]);
}catch(e){report.failure=e.stack;process.exitCode=1;}finally{await fs.writeFile(new URL('report.json',out),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({expedition:report.expedition.length,island:report.island.length,errors:report.errors,failure:report.failure?.split('\n')[0]}));
