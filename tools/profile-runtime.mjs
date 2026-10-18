#!/usr/bin/env node
// Frame cost of the game session per scenario (docs/ARCHITECTURE.md, performance structure).
// Uses the game's own phase timing (FERAL.perf) plus V8 CPU samples, in Chromium SwiftShader
// served with the Android app's MIME/CSP rules. SwiftShader draws on the CPU, so compare JS
// phases between versions, not absolute FPS with a phone.
// Scenarios use real input (held keys, the real attack button) except the loose-object setup,
// which removes one trunk cell the way a felled tree does and is recorded as prepared state.
//   node tools/profile-runtime.mjs [island,expedition]
//   FERAL_CHROME=chrome path, FERAL_ASSETS=served assets URL (e.g. an older build), FERAL_PERF_OUT=report path
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {startAndroidAssetServer} from './android-asset-server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const VERSION=JSON.parse(await fs.readFile(new URL('../version.json',import.meta.url),'utf8'));
const only=process.argv[2]?.split(',');
const server=process.env.FERAL_ASSETS?null:await startAndroidAssetServer();
const assets=process.env.FERAL_ASSETS||`http://127.0.0.1:${server.address().port}/assets`;
const browser=await chromium.launch({executablePath:process.env.FERAL_CHROME||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const report={version:VERSION.version,versionCode:VERSION.versionCode,generatedAt:new Date().toISOString(),environment:'Chromium SwiftShader, 900×412 touch viewport, Android MIME/CSP asset server',
 note:'frameMs is the frame loop\'s own JS work (FERAL.perf), not GPU time. Phases are per frame; step.* run stepsPerFrame times.',scenarios:[]};

async function open(world,type){
 const context=await browser.newContext({viewport:{width:900,height:412},hasTouch:true,isMobile:true});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(([id,t])=>localStorage.setItem('feral.worlds.v1',JSON.stringify([{id,name:id,type:t,seed:63026}])),[world,type]);
 await page.goto(`${assets}/play.html?world=${world}`);
 await page.waitForFunction(()=>window.FERAL?.ready&&FERAL.stats().running,null,{timeout:180000});
 // Methods present in every version since 0.13 are timed from outside, so builds can be compared
 // with the same numbers; FERAL.perf (0.15.1+) adds the frame loop's own phases.
 await page.evaluate(async()=>{
  window.__frames=[];let last=performance.now();const tick=now=>{window.__frames.push(now-last);last=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
  const timing=window.__methods={},f=window.FERAL,r=f.runtime;
  const wrap=(target,key,label)=>{if(typeof target?.[key]!=='function')return;const original=target[key];target[key]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{const row=timing[label]??={ms:0,calls:0,maxMs:0},ms=performance.now()-start;row.ms+=ms;row.calls++;if(ms>row.maxMs)row.maxMs=ms;}};};
  const {EnvironmentView}=await import('./content-runtime/environment-view.js');
  for(const [target,key,label]of [[r,'tick','runtime.tick'],[r.creatures,'tick','creatures.tick'],[f.physics,'step','physics.step'],[f.physics,'movePlayer','physics.movePlayer'],[f.physics,'synchronize','physics.synchronize'],[f.physics,'terrainAt','physics.terrainAt'],
   [f.view,'syncTerrain','view.syncTerrain'],[f.view,'syncModels','view.syncModels'],[f.view,'draw','view.draw'],[r.atlas,'loadAround','atlas.loadAround'],[EnvironmentView.prototype,'sync','environment.sync']])wrap(target,key,label);
 });
 const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});
 return {context,page,cdp,errors,world,type};
}
function cpuTop(profile,count=12){
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),self=new Map();let total=0;
 profile.samples.forEach((id,i)=>{const us=profile.timeDeltas[i]??0,f=nodes.get(id).callFrame;total+=us;if(['(idle)','(program)'].includes(f.functionName))return;const k=`${f.functionName||'(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber+1}`;self.set(k,(self.get(k)??0)+us);});
 return [...self].sort((a,b)=>b[1]-a[1]).slice(0,count).map(([fn,us])=>({fn,percent:+(us/total*100).toFixed(1)}));
}
async function measure(s,name,ms,{action,prepared}={}){
 await s.page.evaluate(()=>{window.__frames.length=0;for(const k of Object.keys(window.__methods))delete window.__methods[k];FERAL.perf?.start();});
 await s.cdp.send('Profiler.start');const started=Date.now();if(action)await action();
 const left=ms-(Date.now()-started);if(left>0)await s.page.waitForTimeout(left);
 const {profile}=await s.cdp.send('Profiler.stop');
 const result=await s.page.evaluate(()=>{
  const perf=FERAL.perf?.stop()??null,f=window.__frames.splice(0),sorted=[...f].sort((a,b)=>a-b),r=FERAL.runtime,ph=FERAL.physics;
  const methods=Object.fromEntries(Object.entries(window.__methods).sort((a,b)=>b[1].ms-a[1].ms).map(([k,v])=>[k,{msPerFrame:v.ms/f.length,callsPerFrame:v.calls/f.length,maxMs:v.maxMs}]));
  return {servedVersion:`${FERAL.stats().version} / ${FERAL.stats().versionCode}`,perf,methods,interval:{mean:f.reduce((a,b)=>a+b,0)/f.length,p95:sorted[Math.floor(f.length*.95)],max:sorted.at(-1)},
   world:{objects:r.objects.objects.size,colliders:ph.world.colliders.len(),bodies:ph.world.bodies.len(),terrainSections:ph.terrainSections?.size??null,models:FERAL.view.models.size,
    liquidSections:FERAL.environment?.sections?.size,inventoryItems:Object.values(r.progression.inventory).reduce((a,b)=>a+b,0)}};
 });
 const row={map:s.type,scenario:name,prepared:prepared??null,...result,cpuTop:cpuTop(profile)};report.scenarios.push(row);
 const p=row.perf,m=row.methods,sum=Object.entries(m).filter(([k])=>!['physics.terrainAt','creatures.tick'].includes(k)).reduce((a,[,v])=>a+v.msPerFrame,0);
 console.log(`${s.type} ${name}: frame ${row.interval.mean.toFixed(1)}ms (p95 ${row.interval.p95.toFixed(1)}), timed methods ${sum.toFixed(1)}ms/frame${p?`, loop work ${p.frameMs.mean.toFixed(1)}ms, steps/frame ${p.stepsPerFrame.toFixed(2)}`:''}, objects ${row.world.objects}, colliders ${row.world.colliders}`);
 for(const [k,v]of Object.entries(m).slice(0,7))console.log(`   ${k.padEnd(20)} ${v.msPerFrame.toFixed(2)}ms/frame  calls ${v.callsPerFrame.toFixed(1)}  max ${v.maxMs.toFixed(1)}`);
 return row;
}
const walk=s=>async()=>{await s.page.keyboard.down('KeyW');await s.page.waitForTimeout(5800);await s.page.keyboard.up('KeyW');};
async function holdAttack(s,ms){
 const box=await s.page.locator('#actBtn').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await s.cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await s.page.waitForTimeout(ms);
 await s.cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
// Trees near the player, nearest first: lowest log cell per trunk column.
const trees=s=>s.page.evaluate(()=>{const r=FERAL.runtime,p=r.player,base=new Map();
 for(let x=Math.floor(p.x*2)-80;x<Math.floor(p.x*2)+80;x++)for(let z=Math.floor(p.z*2)-80;z<Math.floor(p.z*2)+80;z++)for(let y=Math.floor(p.y*2)-8;y<Math.floor(p.y*2)+30;y++)
  if(r.atlas.getCell(x,y,z)==='log'){const k=`${x},${z}`;if(!base.has(k)||base.get(k)[1]>y)base.set(k,[x,y,z]);}
 return [...base.values()].sort((a,b)=>Math.hypot(a[0]/2-p.x,a[2]/2-p.z)-Math.hypot(b[0]/2-p.x,b[2]/2-p.z));});
// The real attack button mines; only the aim is held on the tree (trunk first, then canopy).
async function aimAt(s,[bx,by,bz]){
 await s.page.evaluate(([bx,by,bz])=>{const r=FERAL.runtime,v=FERAL.view,aim=v.__aim??=v.aim.bind(v);
  v.aim=opts=>{let cell=null;
   for(let y=by-2;y<by+40&&!cell;y++)if(r.atlas.getCell(bx,y,bz)==='log')cell=[bx,y,bz];
   for(let rad=1;rad<=6&&!cell;rad++)for(let dx=-rad;dx<=rad&&!cell;dx++)for(let dz=-rad;dz<=rad&&!cell;dz++){if(Math.max(Math.abs(dx),Math.abs(dz))!==rad)continue;for(let y=by-2;y<by+40&&!cell;y++){const b=r.atlas.getCell(bx+dx,y,bz+dz);if(b==='log'||b==='leaves')cell=[bx+dx,y,bz+dz];}}
   if(!cell)return aim(opts);Object.assign(r.player,{x:cell[0]/2+1.9,z:cell[2]/2+.25,vx:0,vz:0});
   return {kind:'terrain',point:{x:cell[0]/2+.5,y:cell[1]/2+.25,z:cell[2]/2+.25},normal:{x:1,y:0,z:0},distance:1.4,cell};};},[bx,by,bz]);
}
const releaseAim=s=>s.page.evaluate(()=>{const v=FERAL.view;if(v.__aim)v.aim=v.__aim;});
const scenarios={
 async island(){
  const s=await open('profile-island','island');await s.page.waitForTimeout(4000);
  await measure(s,'idle',5000);
  await measure(s,'walk',6000,{action:walk(s)});
  const found=await trees(s);
  await aimAt(s,found[0]);for(let i=0;i<3;i++)await measure(s,`mine tree ${i+1}`,4000,{action:()=>holdAttack(s,3800)});await releaseAim(s);
  // A felled tree: cut the lowest trunk layer of the nearest tree that separates (island canopies
  // often join neighbours beyond the loose-object limit; those cuts are restored) into one loose object.
  const prepared=await s.page.evaluate(found=>{const r=FERAL.runtime,notes=[];
   for(const [x,y,z]of found.slice(1,16)){const cut=[];
    for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)if(r.atlas.getCell(x+dx,y,z+dz)==='log'){r.atlas.setCell(x+dx,y,z+dz,null);cut.push([x+dx,y,z+dz]);}
    const result=cut.length?r.objects.detachAround(cut[0]):{objects:[],reasons:['no_trunk']};
    if(result.objects.length){Object.assign(r.player,{x:x/2+2.2,z:z/2+.25,vx:0,vz:0});return `${notes.length} tree(s) skipped (${[...new Set(notes)].join(', ')||'none'}); cut ${cut.length} trunk cell(s) at ${x},${y},${z}: ${result.objects.length} loose object of ${result.detachedCells} cells; player placed 2 m away`;}
    for(const c of cut)r.atlas.setCell(...c,'log');notes.push(result.reasons.join('+'));
   }
   return `no tree separated (${[...new Set(notes)].join(', ')})`;},found);
  console.log(`prepared: ${prepared}`);
  await s.page.waitForTimeout(1500);
  await measure(s,'loose tree nearby',6000,{prepared});
  await measure(s,'loose tree, walking',6000,{prepared,action:walk(s)});
  report.errors=[...(report.errors??[]),...s.errors];await s.context.close();
 },
 async expedition(){
  const s=await open('profile-expedition','expedition');await s.page.waitForTimeout(4000);
  await measure(s,'idle',5000);
  await measure(s,'walk',6000,{action:walk(s)});
  report.errors=[...(report.errors??[]),...s.errors];await s.context.close();
 },
};
try{for(const [name,run]of Object.entries(scenarios))if(!only||only.includes(name))await run();}
finally{await browser.close();server?.close();}
const out=process.env.FERAL_PERF_OUT?new URL(process.env.FERAL_PERF_OUT,`file://${process.cwd()}/`):new URL(`../verification/${VERSION.version}-perf.json`,import.meta.url);
await fs.writeFile(out,JSON.stringify(report,null,1)+'\n');console.log(`written ${out.pathname}`);
