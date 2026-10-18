// Evidence tool for the 0.11–0.12 separate expedition screen (expedition.html, entry.js panels).
// Since 0.13.0 every map uses the one game screen; check it with tools/verify-ui-reachability.mjs.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const base=process.env.FERAL_TEST_URL??'http://127.0.0.1:8081/app/src/main/assets/',out=new URL('../verification/screenshots/',import.meta.url);
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const resume=process.env.FERAL_RESUME==='1',storagePath=new URL('browser-storage.json',out).pathname;
const resumeStorage=resume?await fs.readFile(storagePath):null;
const page=await browser.newPage({viewport:{width:1000,height:720},deviceScaleFactor:1,...(resume?{storageState:storagePath}:{})});
const report={environment:'Headless Chromium / Linux / SwiftShader software WebGL; not a mobile-device measurement',seed:63026,restriction:'Only keyboard, pointer and DOM UI actions mutate game state. FERAL reads only.',storageEvidence:{resumed:resume,inputBytes:resumeStorage?.byteLength??null,inputSha256:resumeStorage?createHash('sha256').update(resumeStorage).digest('hex'):null},consoleErrors:[],pageErrors:[],failedRequests:[],steps:[],startedAt:new Date().toISOString()};
page.on('response',r=>{if(r.status()>=400)report.failedRequests.push({url:r.url(),status:r.status()});});page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push({text:m.text(),location:m.location()});});
page.setDefaultTimeout(20000);
const state=()=>page.evaluate(()=>{const r=window.FERAL.runtime;return {player:{...r.player},inventory:{...r.progression.inventory},research:[...r.progression.research],stations:{...r.progression.stations},placements:[...r.placements.records.values()],fixtureModels:[...window.FERAL.view.models.values()].filter(m=>m.desc.kind==='fixture').map(m=>({id:m.desc.id,assetId:m.desc.assetId,position:m.desc.position})),jobs:r.progression.jobs,researchJob:r.progression.researchJob,harvest:r.harvestAction,time:r.time,stats:window.FERAL.stats(),renderFrames:window.FERAL.view.renderer.info.render.frame,browserElapsedMs:performance.now()};});
const record=async(name,extra={})=>{const s=await state();report.steps.push({name,wallTime:new Date().toISOString(),...extra,state:s});console.log(JSON.stringify({step:name,time:s.time,inventory:s.inventory,player:{x:s.player.x,y:s.player.y,z:s.player.z},...extra}));await page.screenshot({path:new URL(`${String(report.steps.length).padStart(2,'0')}-${name}.png`,out).pathname});await fs.writeFile(new URL('expedition-browser-report.json',out),JSON.stringify(report,null,2));await page.context().storageState({path:storagePath});};
const wait=async(fn,arg,timeout=120000)=>page.waitForFunction(fn,arg,{timeout,polling:250});
async function closePanel(){if(await page.locator('#panel').isVisible())await page.locator('#closePanel').click();}
async function orient(yaw,pitch){
 for(let step=0;step<6;step++){const p=(await state()).player;let delta=((yaw-p.yaw+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;const dx=Math.max(-300,Math.min(300,-delta/.005)),dy=Math.max(-140,Math.min(140,-(pitch-p.pitch)/.005));if(Math.abs(dx)+Math.abs(dy)<5)break;
  await page.mouse.move(500,350);await page.mouse.down();await page.mouse.move(500+dx,350+dy,{steps:5});await page.mouse.up();}
}
async function walkDirect(target){
 await closePanel();let stuck=0,lastDistance=Infinity;
 for(let i=0;i<400;i++){const p=(await state()).player,dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);if(d<1.8)return;
  await orient(Math.atan2(-dx,-dz),0);await page.keyboard.down('KeyW');if(stuck>3)await page.keyboard.down('Space');await page.waitForTimeout(300);await page.keyboard.up('KeyW');await page.keyboard.up('Space');
  if(d>lastDistance-.05)stuck++;else stuck=0;lastDistance=d;if(stuck>12)throw Error(`Movement blocked toward ${target.id}: distance ${d.toFixed(2)} at ${JSON.stringify(p)}`);
 }throw Error('Movement timed out: '+target.id);
}
async function moveTo(target){
 // Read the existing foundation footprint and walk around its outer edge. This
 // selects physical waypoints; every metre is still travelled with keyboard input.
 const context=await page.evaluate(()=>({player:{...window.FERAL.runtime.player},reservations:[...window.FERAL.runtime.atlas.reservations.values()]}));
 const p=context.player,hit=context.reservations.find(r=>{if(r.maxX-r.minX<80||target.x>=r.minX&&target.x<r.maxX&&target.z>=r.minZ&&target.z<r.maxZ)return false;let lo=0,hi=1;for(const [axis,min,max]of [['x',r.minX,r.maxX],['z',r.minZ,r.maxZ]]){const delta=target[axis]-p[axis];if(Math.abs(delta)<1e-8){if(p[axis]<min||p[axis]>max)return false;continue;}const a=(min-p[axis])/delta,b=(max-p[axis])/delta;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}return hi>=lo;});
 if(hit){const x=hit.minX-6,z=target.z>=hit.maxZ||p.z>=hit.maxZ?hit.maxZ+6:hit.minZ-6;await walkDirect({id:'foundation-west-bypass',x,z:p.z});await walkDirect({id:'foundation-outer-corner',x,z});}
 await walkDirect(target);
}
async function gather(sourceId,minimum){
 let attempts=0;const unreachable=new Set();
 while((await state()).inventory[sourceId.replace('source_','')] < minimum || !(sourceId.replace('source_','') in (await state()).inventory)){
  if(++attempts>30)throw Error('Harvest attempts exhausted '+sourceId);
  const target=await page.evaluate(({id,skip})=>{const r=window.FERAL.runtime,p=r.player;return r.nodes.filter(n=>n.sourceId===id&&!skip.includes(n.id)&&!Object.entries(r.progression.harvestClaims).some(([k])=>k.endsWith(':'+n.id))).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];},{id:sourceId,skip:[...unreachable]});
  if(!target)throw Error('No reachable available target '+sourceId);
  try{await moveTo(target);}catch(e){if(!/^Movement (?:blocked|timed out)/.test(e.message))throw e;unreachable.add(target.id);console.warn(`Skipping unreachable harvest node ${target.id}: ${e.message}`);continue;}
  const p=(await state()).player;await orient(Math.atan2(-(target.x-p.x),-(target.z-p.z)),Math.atan2(target.y+.2-(p.y+1.58),Math.hypot(target.x-p.x,target.z-p.z)));await page.keyboard.press('KeyE');
  await wait(()=>!!window.FERAL.runtime.harvestAction,undefined,10000);await wait(()=>!window.FERAL.runtime.harvestAction,undefined,60000);
  await record(`harvest-${sourceId.replace('source_','')}`,{node:target.id});
 }
}
async function panelAction(tab,title,button){await closePanel();await page.locator('#openBag').click();await page.locator(`[data-tab="${tab}"]`).click();await page.locator('#search').fill(title);const row=page.locator('#panelList .row').filter({has:page.locator('b',{hasText:title})}).first();await row.getByRole('button',{name:button,exact:true}).click();await page.locator('#search').fill('');}
async function returnToBench(){const bench=await page.evaluate(()=>[...window.FERAL.runtime.placements.records.values()].find(r=>r.assetId==='field_bench'));if(!bench)throw Error('No placed field bench');await moveTo({id:bench.id,x:bench.position[0]+2,y:bench.position[1],z:bench.position[2]});}
async function research(id,title){if(id==='material:wood')await returnToBench();await panelAction('research',title,'연구');await wait(id=>window.FERAL.runtime.progression.research.has(id),id);await record(`research-${id.replace(':','-')}`);}
async function craft(title,output,seconds=120000){if(output==='wood')await returnToBench();const before=(await state()).inventory[output]??0;await panelAction('craft',title,'제작');await wait(({output,before})=>(window.FERAL.runtime.progression.inventory[output]??0)>before,{output,before},seconds);await record(`craft-${output}`);}
async function saveReconnect(){
 await closePanel();await page.locator('#openMenu').click();await page.locator('#save').click();await page.waitForTimeout(500);
 const before=await state(),signature=s=>JSON.stringify({inventory:s.inventory,research:[...s.research].sort(),stations:s.stations,placements:s.placements.map(p=>({id:p.id,assetId:p.assetId,position:p.position}))});
 await page.reload();await wait(()=>window.FERAL?.ready,undefined,90000);await page.waitForTimeout(1000);
 const after=await state();if(signature(after)!==signature(before))throw Error('Menu save did not preserve progression after reconnect');
 report.uiReconnectPreserved=true;await record('menu-save-reconnect',{preserved:true});
}
try{
 await page.addInitScript(()=>localStorage.setItem('feral.worlds.v1',JSON.stringify([{id:'browser-flow-63026',type:'expedition',name:'실제 입력 초반 검증',seed:63026}])));
 await page.goto(base+'expedition.html?world=browser-flow-63026');await wait(()=>window.FERAL?.ready,undefined,90000);await page.waitForTimeout(5000);await record(resume?'resumed-ui-save':'fresh-world');
 if(!resume&&Object.keys((await state()).inventory).length)throw Error('Fresh world is not empty');if(report.pageErrors.length)throw Error('Startup browser errors: '+report.pageErrors.join(';'));
 await page.locator('#openBag').click();await record(resume?'resumed-bag':'empty-bag');await closePanel();
 if(resume&&(await state()).jobs.length)await wait(()=>window.FERAL.runtime.progression.jobs.length===0,undefined,240000);
 if(!(await state()).research.includes('observation')){await gather('source_raw_timber',1);await gather('source_loose_stone',1);await research('observation','관찰과 기록');}
 if(!(await state()).research.includes('joinery')){await gather('source_raw_timber',2);await gather('source_plant_fiber',1);await research('joinery','구조와 접합');}
 if(!(await state()).stations.field_bench){if(!(await state()).inventory.field_bench){await gather('source_raw_timber',4);await gather('source_loose_stone',2);await gather('source_plant_fiber',2);await craft('야외 작업대 구축','field_bench',240000);}
 await closePanel();await orient(0,0);await panelAction('inventory','야외 작업대','앞에 설치');await wait(()=>window.FERAL.runtime.progression.stations.field_bench>0,undefined,15000);await record('placed-field-bench');}
 if(!(await state()).research.includes('material:wood')){await gather('source_raw_timber',1);await research('material:wood','목재 가공 연구');}
 const inventory=(await state()).inventory;await gather('source_raw_timber',(inventory.stone_pick?0:1)+(inventory.wood?0:2));
 if(!(await state()).inventory.stone_pick){await gather('source_loose_stone',2);await gather('source_plant_fiber',1);await craft('돌 곡괭이 만들기','stone_pick');}
 if(!(await state()).inventory.wood)await craft('목재 가공','wood');
 await closePanel();const bench=await page.evaluate(()=>[...window.FERAL.runtime.placements.records.values()].find(r=>r.assetId==='field_bench'));if(bench){const p=(await state()).player;await orient(Math.atan2(-(bench.position[0]-p.x),-(bench.position[2]-p.z)),Math.atan2(bench.position[1]+.6-(p.y+1.58),Math.hypot(bench.position[0]-p.x,bench.position[2]-p.z)));}await record('completed-first-progression');await saveReconnect();report.ok=true;
}catch(e){report.ok=false;report.failure=e.stack;console.error(e);try{await record('blocked');}catch{}}
finally{try{await closePanel();await page.locator('#openMenu').click();await page.locator('#save').click();await page.context().storageState({path:storagePath});report.uiSavePreserved=true;const bytes=await fs.readFile(storagePath);report.storageEvidence.outputBytes=bytes.byteLength;report.storageEvidence.outputSha256=createHash('sha256').update(bytes).digest('hex');}catch(e){report.uiSaveError=e.message;}report.finishedAt=new Date().toISOString();await fs.writeFile(new URL('expedition-browser-report.json',out),JSON.stringify(report,null,2));await browser.close();}
if(!report.ok)process.exitCode=1;
