#!/usr/bin/env node
// Isolated browser persistence profile, not a gameplay/FPS or mobile benchmark.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=process.env.FERAL_SAVE_FIXTURE??fileURLToPath(new URL('../verification/expedition-save/high-tier-route.json.gz',import.meta.url));
const fixtureBytes=await fs.readFile(source);
const fixtureRaw=(source.endsWith('.gz')?gunzipSync(fixtureBytes):fixtureBytes).toString('utf8'),fixture=JSON.parse(fixtureRaw);
const state={...fixture,schema:1,player:{x:0,y:10,z:0,hp:100}};
const base=process.env.FERAL_PROFILE_URL??'http://127.0.0.1:8081';
const files=['save.js','save-worker.js','autosave.js'];
const codeHashes=Object.fromEntries(await Promise.all(files.map(async name=>[name,createHash('sha256').update(await fs.readFile(new URL('../app/src/main/assets/content-runtime/'+name,import.meta.url))).digest('hex')])));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
let measured;
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  measured=await page.evaluate(async ({state,base})=>{
    const {ExpeditionSave}=await import(base+'/app/src/main/assets/content-runtime/save.js');
    const {Autosave}=await import(base+'/app/src/main/assets/content-runtime/autosave.js');
    const longTasks=[];
    const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,ms:entry.duration}))));
    observer.observe({entryTypes:['longtask']});
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const key='feral.save-profile',store=new ExpeditionSave(localStorage,key),rows=[];
    localStorage.removeItem(key+'.a');localStorage.removeItem(key+'.b');
    let resolveJob,rejectJob;
    const autosave=new Autosave(store,{onSaved:(sequence,info)=>resolveJob?.({sequence,...info}),onError:error=>rejectJob?.(error)});
    for(const mode of ['sync','worker','sync','worker','sync','worker']) {
      await sleep(70);
      let resolve,reject; const done=new Promise((a,b)=>{resolve=a;reject=b;});
      resolveJob=resolve;rejectJob=reject;
      const start=performance.now();
      let result;
      if(mode==='sync') {
        const sequence=autosave.writeNow(state);
        result={sequence,mode,elapsedMs:performance.now()-start};
      } else {
        autosave.schedule(state);
      }
      const mainCallMs=performance.now()-start;
      if(!result)result=await done;
      const end=performance.now();
      await sleep(70);
      const matching=longTasks.filter(task=>task.start>=start-1&&task.start<end);
      // Expansion/equality assertions happen after this measured phase.
      const loaded=new ExpeditionSave(localStorage,key).load();
      if(JSON.stringify(loaded)!==JSON.stringify(state))throw Error('Lossless roundtrip mismatch');
      rows.push({...result,mainCallMs,wallMs:end-start,longTasks:matching,
        longTaskTotalMs:matching.reduce((sum,task)=>sum+task.ms,0),longTaskMaxMs:Math.max(0,...matching.map(task=>task.ms))});
    }
    autosave.dispose();observer.disconnect();
    const result={rows,originalCharacters:JSON.stringify(state).length,
      generationCharacters:['a','b'].map(slot=>(localStorage.getItem(key+'.'+slot)??'').length),
      environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency},
      longTaskThresholdMs:50,roundtripExact:true};
    localStorage.removeItem(key+'.a');localStorage.removeItem(key+'.b');
    return result;
  },{state,base});
  measured.pageErrors=errors;
} finally { await browser.close(); }
const report={schemaVersion:1,generatedAt:new Date().toISOString(),fixture:{path:source,sha256:createHash('sha256').update(fixtureRaw).digest('hex'),bytes:Buffer.byteLength(fixtureRaw),keys:Object.keys(fixture)},codeHashes,
  scenario:'Immutable actual high-tier resource-consumption route snapshot, with finite player defaults added. Same snapshot saved three times synchronously and three times via a real browser module Worker.',
  limitations:['Isolated desktop Chromium persistence harness, no rendering or game loop; not Android or mobile hardware validation.','Input snapshot is already serialized by runtime. runtime.serialize() cost remains on the main thread and is excluded.','Worker main-call timing includes JSON stringify and postMessage; commit timing includes raw equality verification and localStorage writes.','50ms Long Tasks API entries measure main-thread tasks, while wall time includes background compression/validation.','Worker fallback preserves correctness but still performs compression synchronously on a deferred task.','Other agents may run browsers concurrently; elapsed times are environment observations, not device guarantees.'],...measured};
await fs.mkdir(new URL('../verification/expedition-save/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../verification/expedition-save/profile.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({rows:report.rows,generationCharacters:report.generationCharacters,pageErrors:report.pageErrors},null,2));
