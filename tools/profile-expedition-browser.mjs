#!/usr/bin/env node
// Evidence tool for the 0.11–0.12 separate expedition screen (expedition.html, entry.js panels).
// Since 0.13.0 every map uses the one game screen; check it with tools/verify-ui-reachability.mjs.
// Browser-only instrumentation. No gameplay method, inventory or simulation state is changed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const base=process.env.FERAL_PROFILE_URL??'http://127.0.0.1:8081';
const warmupMs=32000,sampleMs=30000;
const watched=['entry.js','runtime.js','scene.js','physics.js','atlas.js','creatures.js','progression.js','dungeons.js','placements.js','fixture-physics.js','objects.js','object-physics.js','environment-view.js','equipment-view.js'].map(p=>'app/src/main/assets/content-runtime/'+p);
async function hashes(){return Object.fromEntries(await Promise.all(watched.map(async p=>{try{return[p,createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex')];}catch{return[p,null];}})));}
function cpuSummary(profile){
  if(!profile)return null;const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map(),self=new Map(),inclusive=new Map();
  for(const n of profile.nodes)for(const id of n.children??[])parents.set(id,n.id);
  let sampledUs=0;for(let i=0;i<(profile.samples??[]).length;i++){const id=profile.samples[i],us=profile.timeDeltas?.[i]??0;sampledUs+=us;self.set(id,(self.get(id)??0)+us);let node=id,seen=new Set();while(node!=null&&!seen.has(node)){seen.add(node);inclusive.set(node,(inclusive.get(node)??0)+us);node=parents.get(node);}}
  const rows=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,35).map(([id,us])=>{const f=nodes.get(id)?.callFrame??{};return{function:f.functionName||'(anonymous)',url:f.url??'',line:(f.lineNumber??-1)+1,column:(f.columnNumber??-1)+1,ms:us/1000,percent:sampledUs?us/sampledUs*100:0};});
  return{samplingIntervalUs:1000,sampledMs:sampledUs/1000,nodeCount:nodes.size,samples:profile.samples?.length??0,topSelf:rows(self),topInclusive:rows(inclusive),note:'V8 statistical CPU samples, inclusive stacks overlap. GPU/SwiftShader worker cost is not all attributed here.'};
}
const reportPath=path.join(root,'verification/expedition-profile.json');
let baseline=null,previousReport=null;try{const prior=JSON.parse(await fs.readFile(reportPath,'utf8'));baseline=prior.baseline??prior;previousReport=prior;}catch{}
const launchOptions={headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']};
const browser=await chromium.launch(launchOptions),runs=[],selectedNames=process.env.FERAL_PROFILE_NAMES?.split(',');
try{
  for(const profile of [{name:'desktop',width:1100,height:700,isMobile:false},{name:'mobile_viewport',width:390,height:844,isMobile:true}]){
    if(selectedNames&&!selectedNames.includes(profile.name))continue;
    const measuredAt=new Date().toISOString();const codeBefore=await hashes(),context=await browser.newContext({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:1,isMobile:profile.isMobile,hasTouch:profile.isMobile});
    const page=await context.newPage(),pageErrors=[],consoleErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    await page.addInitScript(()=>localStorage.setItem('feral.worlds.v1',JSON.stringify([{id:'profile-expedition',type:'expedition',name:'성능 측정',seed:63026}])));
    const opened=Date.now();await page.goto(base+'/app/src/main/assets/expedition.html?world=profile-expedition',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.FERAL?.ready,{timeout:120000});
    const readyMs=Date.now()-opened;
    await page.evaluate(()=>{
      const f=window.FERAL,store={phase:'warmup',samples:{},frames:[],renderer:[],longTasks:[],lastDraw:null,start:0,gameStart:0};window.__expeditionProfile=store;
      const wrap=(target,key,label)=>{if(typeof target?.[key]!=='function')return;const original=target[key];target[key]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{const end=performance.now();if(store.phase==='sample'){(store.samples[label]??=[]).push(end-start);if(label==='scene.draw'){if(store.lastDraw!==null)store.frames.push(start-store.lastDraw);store.lastDraw=start;const info=f.view.renderer.info;store.renderer.push({calls:info.render.calls,triangles:info.render.triangles,points:info.render.points,lines:info.render.lines,geometries:info.memory.geometries,textures:info.memory.textures,programs:info.programs?.length??0});}}}};};
      for(const [target,key,label]of [[f.runtime,'tick','runtime.tick'],[f.runtime.atlas,'loadAround','atlas.loadAround'],[f.view,'syncTerrain','scene.syncTerrain'],[f.view,'syncModels','scene.syncModels'],[f.physics,'synchronize','physics.synchronize'],[f.physics,'step','physics.step'],[f.view,'draw','scene.draw'],[f.physics,'terrainAt','physics.terrainAt'],[f.runtime,'refreshWorld','runtime.refreshWorld'],[f.runtime,'descriptors','runtime.descriptors']])wrap(target,key,label);
      if(window.PerformanceObserver)try{const observer=new PerformanceObserver(list=>{if(store.phase==='sample')for(const e of list.getEntries())store.longTasks.push({startTime:e.startTime,duration:e.duration});});observer.observe({entryTypes:['longtask']});store.observer=observer;}catch{}
    });
    console.log(`${profile.name}: ready ${readyMs}ms; warming ${warmupMs}ms`);await page.waitForTimeout(warmupMs);
    const cdp=await context.newCDPSession(page);let cpuError=null,cpu=null;
    try{await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');}catch(e){cpuError=e.message;}
    await page.evaluate(()=>{const s=window.__expeditionProfile;s.phase='sample';s.start=performance.now();s.gameStart=window.FERAL.runtime.time;s.startStats=window.FERAL.stats();});
    console.log(`${profile.name}: sampling ${sampleMs}ms`);await page.waitForTimeout(sampleMs);
    await page.evaluate(()=>{const s=window.__expeditionProfile;s.phase='done';s.end=performance.now();s.gameEnd=window.FERAL.runtime.time;s.observer?.disconnect();});
    if(!cpuError)try{cpu=cpuSummary((await cdp.send('Profiler.stop')).profile);}catch(e){cpuError=e.message;}
    const result=await page.evaluate(()=>{
      const s=window.__expeditionProfile,end=s.end;
      function stats(values){if(!values.length)return{calls:0,totalMs:0,medianMs:0,p95Ms:0,maxMs:0};const sorted=[...values].sort((a,b)=>a-b);return{calls:values.length,totalMs:values.reduce((a,b)=>a+b,0),medianMs:sorted[Math.floor((sorted.length-1)*.5)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};}
      const gl=window.FERAL.view.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
      const renderer={};for(const key of ['calls','triangles','points','lines','geometries','textures','programs']){const a=s.renderer.map(x=>x[key]);renderer[key]={min:a.length?Math.min(...a):0,max:a.length?Math.max(...a):0,mean:a.length?a.reduce((a,b)=>a+b,0)/a.length:0,last:a.at(-1)??0};}
      return{actualSampleWallMs:end-s.start,gameTimeSeconds:s.gameEnd-s.gameStart,startStats:s.startStats,endStats:window.FERAL.stats(),stages:Object.fromEntries(Object.entries(s.samples).map(([key,v])=>[key,stats(v)])),frameIntervals:stats(s.frames),draws:s.renderer.length,renderer,longTasks:stats(s.longTasks.map(x=>x.duration)),largestLongTasks:s.longTasks.sort((a,b)=>b.duration-a.duration).slice(0,10),environment:{userAgent:navigator.userAgent,platform:navigator.platform,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemoryGiB:navigator.deviceMemory??null,dpr:devicePixelRatio,innerWidth,innerHeight,visibility:document.visibilityState,webglRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webglVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),canvasWidth:gl.drawingBufferWidth,canvasHeight:gl.drawingBufferHeight,jsHeap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null}};
    });
    const codeAfter=await hashes(),changedFiles=watched.filter(p=>codeBefore[p]!==codeAfter[p]);
    runs.push({name:profile.name,measuredAt,viewport:{width:profile.width,height:profile.height},isMobile:profile.isMobile,readyMs,warmupMs,targetSampleMs:sampleMs,...result,effectiveFps:result.draws/(result.actualSampleWallMs/1000),simulationToWallRatio:result.gameTimeSeconds/(result.actualSampleWallMs/1000),cpu,cpuError,pageErrors,consoleErrors,codeBefore,codeAfter,changedFiles});
    console.log(`${profile.name}: ${runs.at(-1).effectiveFps.toFixed(2)}fps; sample ${result.actualSampleWallMs.toFixed(0)}ms; errors ${pageErrors.length}; changed ${changedFiles.length}`);await context.close();
  }
}finally{await browser.close();}
if(selectedNames)for(const old of previousReport?.runs??[])if(!runs.some(r=>r.name===old.name))runs.push(old);
const report={schemaVersion:1,baseline,baselineCpuCaveat:'Original baseline CPU samples included post-window WebGL debug getParameter collection; exclude those samples as instrumentation overhead. Current sample stops before report collection.',generatedAt:new Date().toISOString(),url:base,seed:63026,scenario:'Fresh local storage, initial expedition scene, no input, no grants/teleports/gameplay mutations.',instrumentation:'Instance method wrappers measure synchronous inclusive elapsed time; nested stages must not be summed. 1ms V8 CPU sampling enabled only in measured window.',limitations:['Forced Chromium SwiftShader software WebGL in shared execution environment; not Android or real mobile GPU validation.','Mobile mode changes viewport/touch/user-agent behavior with DPR1; CPU/GPU host is unchanged.','Other concurrent processes and code edits may affect results; file hashes and changedFiles are recorded.','No player movement; this measures initial stationary simulation and rendering, not streaming travel or peak combat.'],runs};
await fs.mkdir(path.join(root,'verification'),{recursive:true});await fs.writeFile(path.join(root,'verification/expedition-profile.json'),JSON.stringify(report,null,2)+'\n');console.log('verification/expedition-profile.json written');
