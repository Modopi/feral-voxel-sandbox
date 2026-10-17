#!/usr/bin/env node
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const base=process.env.FERAL_TEST_URL??'http://127.0.0.1:8081/app/src/main/assets/',out=new URL('../verification/expedition-energy/',import.meta.url);
await fs.mkdir(out,{recursive:true});
const relicOnly=process.env.FERAL_ENERGY_PHASE==='relic', reportFile=relicOnly?'relic-report.json':'report.json', imagePrefix=relicOnly?'relic-':'';
const files=['progression.js','fixture-energy.js','fixture-energy-panel.js','entry.js','runtime.js'];
async function hashes(){return Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await fs.readFile(new URL('../app/src/main/assets/content-runtime/'+f,import.meta.url))).digest('hex')])));}
const report={schemaVersion:1,environment:'Linux headless Chromium, SwiftShader software WebGL; not Android/mobile hardware',scope:'Prepared saved workshop, UI-only actions after setup. Inventory grants, all research, a test platform and workshop installation are setup fixtures, NOT evidence of progression from an empty inventory.',startedAt:new Date().toISOString(),codeBefore:await hashes(),pageErrors:[],consoleErrors:[],steps:[]};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1000,height:720},deviceScaleFactor:1});page.setDefaultTimeout(25000);
page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
const wait=async(fn,arg,timeout=180000)=>page.waitForFunction(fn,arg,{timeout,polling:250});
const snapshot=()=>page.evaluate(()=>{const r=window.FERAL.runtime,p=r.progression;return{time:r.time,inventory:{...p.inventory},personal:{...p.energy},network:p.fixtureEnergy.status(),jobs:structuredClone(p.jobs),player:{x:r.player.x,y:r.player.y,z:r.player.z}};});
async function record(name,extra={}){const s=await snapshot();report.steps.push({name,...extra,state:s});console.log(JSON.stringify({step:name,time:s.time,links:s.network.links.length,personal:s.personal}));await page.screenshot({path:new URL(`${imagePrefix}${String(report.steps.length).padStart(2,'0')}-${name}.png`,out).pathname});await fs.writeFile(new URL(reportFile,out),JSON.stringify(report,null,2));return s;}
const energyTab=async()=>{if(!await page.locator('#panel').isVisible())await page.locator('#openBag').click();await page.locator('[data-tab="energy"]').click();await page.locator('#search').fill('');};
const card=title=>page.locator('#panelList .machine-card').filter({has:page.getByText(title,{exact:true})});
const field=(label)=>page.locator('#panelList label.machine-field').filter({has:page.getByText(label,{exact:true})}).locator('input,select');
async function select(ownerId){await energyTab();const overview=card('설비별 에너지망');await overview.getByRole('button').filter({hasText:' · '+ownerId+' · '}).click();}
async function wire(from,to,type){await energyTab();await field('출력 설비').selectOption(from);await field('출력 채널').selectOption(type);await field('입력 설비').selectOption(to);await card('배선·배관 연결').getByRole('button',{name:'재료를 사용해 연결',exact:true}).click();await wait(({from,to,type})=>window.FERAL.runtime.progression.fixtureEnergy.links.some(l=>l.from===from&&l.to===to&&l.type===type),{from,to,type},10000);}
async function action(title,button){await card(title).getByRole('button',{name:button,exact:true}).click();}
async function queueRecipe(name){await page.locator('[data-tab="craft"]').click();await page.locator('#search').fill(name);const row=page.locator('#panelList .row').filter({has:page.getByText(name,{exact:true})});await row.getByRole('button',{name:'제작',exact:true}).click();await page.locator('#search').fill('');}
let workshop;
try{
 await page.addInitScript(()=>localStorage.setItem('feral.worlds.v1',JSON.stringify([{id:'energy-ui-fixture',type:'expedition',name:'준비된 에너지 작업장 검증',seed:63026},{id:'energy-relic-fixture',type:'expedition',name:'준비된 첫 성물 검증',seed:63026}])));
 if(!relicOnly){
 await page.goto(base+'expedition.html?world=energy-ui-fixture');await wait(()=>window.FERAL?.ready,undefined,120000);
 // Only this bounded setup phase may mutate gameplay state outside ordinary UI.
 workshop=await page.evaluate(async()=>{
  const r=window.FERAL.runtime,p=r.progression,baseY=Math.ceil(r.atlas.heightAt(0,0)+6),floorHy=baseY*2-1;
  for(let x=-14;x<=38;x++)for(let z=-12;z<=12;z++){r.atlas.setCell(x,floorHy,z,'stone');for(let y=floorHy+1;y<=floorHy+8;y++)r.atlas.setCell(x,y,z,null);}
  Object.assign(r.player,{x:0,y:baseY+.1,z:0,hp:100,maxHp:100,calories:1000,vy:0});
  for(const e of p.list('research'))p.research.add(e.id);
  const specs=[['engine','heat_engine',-2,1],['generator','generator',-2,-1],['battery','battery',0,-1],['consumer','physics_station_t6',2,-1],['condenser','mana_condenser',0,2],['tank','fluid_container',2,2],['altar','consecration_table',0,-3],['remote','fluid_container',16,0]];
  const inputs={raw_timber:3,wood:30,stone:20,clay:20,scrap_iron:20,steel:4,nickel:4,bark_cup:1,liquid_mana:3,mana_steel:3,gear_baseline_t5:1};for(const[,id]of specs)inputs[id]=(inputs[id]||0)+1;p.grant(inputs,{claimId:'browser-setup:items'});p.supplyEnergy('divine',20,{claimId:'browser-setup:divinity'});
  const ids={};for(const[key,id,x,z]of specs){const result=await r.placements.place(id,{x,y:baseY,z});if(!result.ok)throw Error('Setup placement '+key+': '+result.reason);ids[key]=result.id;}
  r.placements.syncAccess(r.player);window.FERAL.save();return{ids,baseY,names:Object.fromEntries(specs.map(([key,id])=>[key,p.catalog.get(id).name])),recipe:p.catalog.get('make_inertial_alloy').name,relicRecipe:p.catalog.get('assemble_relic').name,prepared:r.serialize()};
 });
 await fs.writeFile(new URL('prepared-save.json',out),JSON.stringify(workshop.prepared));delete workshop.prepared;report.setup=workshop;
 await page.reload();await wait(()=>window.FERAL?.ready,undefined,120000);await energyTab();const initial=await record('prepared-reloaded');
 if(initial.network.nodes.find(n=>n.ownerId===workshop.ids.battery).energy.electrical!==0)throw Error('Setup battery unexpectedly charged');
 if(initial.network.nodes.find(n=>n.ownerId===workshop.ids.tank).energy.magic!==0)throw Error('Unlinked tank receives magic');
 const ids=workshop.ids,title=k=>workshop.names[k]+' · '+ids[k];
 await select(ids.engine);await action(title('engine'),'연료 한 묶음 넣기 (미가공 목재 1)');
 await wire(ids.engine,ids.generator,'mechanical');await wire(ids.generator,ids.battery,'electrical');await wire(ids.battery,ids.consumer,'electrical');await wire(ids.engine,ids.consumer,'mechanical');
 await wait(id=>window.FERAL.runtime.progression.fixtureEnergy.nodes.get(id).energy.electrical>1,ids.battery);await record('paid-generator-battery-wiring');
 await queueRecipe(workshop.recipe);await wait(()=>window.FERAL.runtime.progression.jobs.some(j=>j.recipeId==='make_inertial_alloy'&&j.progress>.1));await energyTab();await record('consumer-progress');
 const linkRow=card('배선·배관 연결').locator('div').filter({hasText:`${ids.battery} → ${ids.consumer} · 전기`});await linkRow.getByRole('button',{name:'연결 해제'}).click();
 await wait(({from,to})=>!window.FERAL.runtime.progression.fixtureEnergy.links.some(l=>l.from===from&&l.to===to),{from:ids.battery,to:ids.consumer},10000);
 const cutTime=(await snapshot()).time;await wait(t=>window.FERAL.runtime.time>t+3,cutTime);const stopped=(await snapshot()).jobs.find(j=>j.recipeId==='make_inertial_alloy').progress;await wait(t=>window.FERAL.runtime.time>t+3,cutTime+3);const stoppedLater=(await snapshot()).jobs.find(j=>j.recipeId==='make_inertial_alloy').progress;
 if(stoppedLater-stopped>.001)throw Error('Cut electrical link still powers job');await record('link-cut-stops-work',{progressBefore:stopped,progressAfter:stoppedLater});
 // Existing queue has a deliberately paused first job. Ordinary UI has no cancel
 // button yet; first-relic work is verified in a second prepared-save scenario.
 await wire(ids.condenser,ids.tank,'magic');await select(ids.tank);await action(title('tank'),'마나 액체 넣기');
 await action('아바타의 마나 성장','재료 1L로 최대 마나 증가');await action('아바타의 마나 성장','초점 장착');await action('휴대 에너지','수피컵을 마나 용기로 사용');await field('옮길 에너지 EU').fill('10');await action(title('tank'),'마법 설비 → 개인');
 await wait(()=>window.FERAL.runtime.progression.energy.magic===10,undefined,10000);await action(title('tank'),'마법 개인 → 설비');await wait(()=>window.FERAL.runtime.progression.energy.magic===0,undefined,10000);
 await field('마나 액체 L').fill('.1');await action('휴대 에너지','가방의 마나 액체 흡수');await record('liquid-and-personal-mana');
 await wait(id=>window.FERAL.runtime.progression.fixtureEnergy.nodes.get(id).fuel.wood_fire<=1e-8,ids.engine);await record('finite-fuel-exhausted');
 const beforeReload=await snapshot();await page.locator('#closePanel').click();await page.keyboard.press('Escape');
 // Save button is a normal UI action; find its actual menu label.
 const saveButton=page.getByRole('button',{name:/저장/}).first();if(await saveButton.isVisible())await saveButton.click();else throw Error('No ordinary save control found');
 await page.reload();await wait(()=>window.FERAL?.ready,undefined,120000);await energyTab();const loaded=await record('saved-network-reloaded');
 if(loaded.network.links.length!==beforeReload.network.links.length||loaded.personal.magic!==beforeReload.personal.magic)throw Error('Saved network or personal energy changed across reload');
 if(loaded.network.nodes.find(n=>n.ownerId===ids.remote).energy.magic!==0)throw Error('Remote base received energy');
 report.primaryPassed=true;
 }else{workshop=JSON.parse(await fs.readFile(new URL('report.json',out),'utf8')).setup;report.setup=workshop;}
 const relicIds=workshop.ids,relicTitle=workshop.names.altar+' · '+relicIds.altar;
 // New scenario starts from the exact prepared file; save injection is setup again,
 // explicitly recorded and isolated from the UI-only first-relic interaction.
 const prepared=JSON.parse(await fs.readFile(new URL('prepared-save.json',out),'utf8'));
 // Leave the old runtime before setup injection; its asynchronous autosave must
 // never overwrite the next scenario. A distinct slot also isolates generations.
 await page.goto(base+'worlds.html');
 await page.evaluate(async state=>{const {ExpeditionSave}=await import('./content-runtime/save.js');const store=new ExpeditionSave(localStorage,'feral.slot.energy-relic-fixture');store.load();store.write(state);},prepared);
 await page.goto(base+'expedition.html?world=energy-relic-fixture');await wait(()=>window.FERAL?.ready,undefined,120000);await energyTab();await queueRecipe(workshop.relicRecipe);await energyTab();await select(relicIds.altar);await field('옮길 에너지 EU').fill('20');await action(relicTitle,'신성 개인 → 설비');await record('first-relic-explicit-reservation');
 await wait(()=>(window.FERAL.runtime.progression.inventory.relic||0)===1,undefined,240000);await record('first-relic-produced');report.ok=report.pageErrors.length===0;
}catch(error){report.ok=false;report.failure=error.stack;console.error(error);try{await record('blocked');}catch{}}
finally{report.finishedAt=new Date().toISOString();report.codeAfter=await hashes();report.changedFiles=files.filter(f=>report.codeBefore[f]!==report.codeAfter[f]);await fs.writeFile(new URL(reportFile,out),JSON.stringify(report,null,2));await browser.close();}
if(!report.ok)process.exitCode=1;
