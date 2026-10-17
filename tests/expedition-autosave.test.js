import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {ExpeditionSave, prepareSave} from '../app/src/main/assets/content-runtime/save.js';
import {Autosave} from '../app/src/main/assets/content-runtime/autosave.js';
import {prepareSaveMessage} from '../app/src/main/assets/content-runtime/save-worker.js';

const state = x => ({schema:1, player:{x,y:2,z:3,hp:100}, claims:[]});
const memory = () => {
  const map = new Map();
  return {map, getItem:key=>map.get(key)??null, setItem:(key,value)=>map.set(key,value), removeItem:key=>map.delete(key)};
};
const controlled = () => ({jobs:[], terminated:false,
  postMessage(job) { this.jobs.push(structuredClone(job)); },
  terminate() { this.terminated = true; },
  finish(index=0) { this.onmessage({data:prepareSaveMessage(this.jobs[index])}); }
});

test('worker preparations coalesce to latest immutable snapshot, preserving two generations', () => {
  const storage = memory(), store = new ExpeditionSave(storage,'world'), worker = controlled(), saved=[];
  store.write(state(1));
  const autosave = new Autosave(store,{workerFactory:()=>worker,onSaved:(sequence,info)=>saved.push({sequence,info})});
  autosave.schedule(state(2)); autosave.schedule(state(3));
  const latest=state(4); autosave.schedule(latest); latest.player.x=999;
  assert.equal(worker.jobs.length,1);
  worker.finish(); assert.equal(worker.jobs.length,2); assert.equal(saved.length,0);
  worker.finish(1);
  assert.equal(saved.length,1); assert.equal(saved[0].sequence,2); assert.equal(saved[0].info.mode,'worker');
  assert.equal(new ExpeditionSave(storage,'world').load().player.x,4);
  storage.setItem('world.b','truncated');
  assert.equal(new ExpeditionSave(storage,'world').load().player.x,1);
  autosave.dispose();
});

test('synchronous manual save cancels old worker results including queued error callbacks', () => {
  const storage=memory(),store=new ExpeditionSave(storage,'world'),workers=[];
  const autosave=new Autosave(store,{workerFactory:()=>{const w=controlled();workers.push(w);return w;}});
  autosave.schedule(state(1)); autosave.schedule(state(2));
  const obsolete=workers[0]; autosave.writeNow(state(3));
  obsolete.finish(); obsolete.onerror({preventDefault(){}});
  assert.equal(obsolete.terminated,true); assert.equal(workers[1].terminated,false);
  assert.equal(new ExpeditionSave(storage,'world').load().player.x,3);
  autosave.schedule(state(4)); workers[1].finish();
  assert.equal(new ExpeditionSave(storage,'world').load().player.x,4);
  autosave.dispose();
});

test('direct store.write also supersedes active and queued autosaves even if manual save fails', () => {
  for (const fail of [false,true]) {
    const storage=memory(),store=new ExpeditionSave(storage,'world'),worker=controlled();
    store.write(state(0));
    const autosave=new Autosave(store,{workerFactory:()=>worker});
    autosave.schedule(state(1)); autosave.schedule(state(2));
    if (fail) assert.throws(()=>store.write({player:{x:NaN}}));
    else store.write(state(3));
    worker.finish();
    assert.equal(worker.jobs.length,1);
    assert.equal(new ExpeditionSave(storage,'world').load().player.x,fail?0:3);
    autosave.dispose();
  }
});

test('corruption, storage quota and malformed worker response keep previous valid generation', () => {
  for (const failure of ['quota','truncated','substituted','malformed']) {
    const storage=memory(),store=new ExpeditionSave(storage,'world'),worker=controlled(),errors=[];
    store.write(state(1)); store.write(state(2));
    const original=storage.setItem;
    let writes=0;
    storage.setItem=(key,raw)=>{
      if (++writes===1) {
        if (failure==='quota') throw Error('quota');
        if (failure==='truncated') return original(key,raw.slice(0,30));
        if (failure==='substituted') return original(key,prepareSave(state(999),3));
      }
      return original(key,raw);
    };
    const autosave=new Autosave(store,{workerFactory:()=>worker,onError:e=>errors.push(e)});
    autosave.schedule(state(3));
    if (failure==='malformed') worker.onmessage({data:{id:worker.jobs[0].id,raw:'bad'}});
    else worker.finish();
    assert.equal(errors.length,1); assert.equal(store.sequence,2);
    assert.equal(new ExpeditionSave(storage,'world').load().player.x,2);
    autosave.dispose();
  }
});

test('worker unavailable or startup failure safely falls back, disposed requests never write', async () => {
  for (const mode of ['missing','throws','error','messageerror','postMessage']) {
    const storage=memory(),store=new ExpeditionSave(storage,'world'),worker=controlled();
    if (mode==='postMessage') worker.postMessage=()=>{throw Error('blocked');};
    let finish;
    const done=new Promise(resolve=>finish=resolve);
    const autosave=new Autosave(store,{workerFactory:()=>{
      if(mode==='missing')return null;
      if(mode==='throws')throw Error('blocked');
      return worker;
    },onSaved:(_,info)=>finish(info)});
    autosave.schedule(state(1));
    if(mode==='error')worker.onerror({preventDefault(){}});
    if(mode==='messageerror')worker.onmessageerror();
    assert.equal((await done).mode,'fallback');
    assert.equal(new ExpeditionSave(storage,'world').load().player.x,1);
    autosave.schedule(state(2)); autosave.dispose();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(new ExpeditionSave(storage,'world').load().player.x,1);
    assert.equal(autosave.schedule(state(3)),false);
    assert.throws(()=>autosave.writeNow(state(3)),/종료/);
  }
});

test('worker validation rejects invalid player data without overwriting saved state', () => {
  const storage=memory(),store=new ExpeditionSave(storage,'world'),worker=controlled(),errors=[];
  store.write(state(1));
  const autosave=new Autosave(store,{workerFactory:()=>worker,onError:e=>errors.push(e)});
  autosave.schedule({player:{x:NaN}}); worker.finish();
  assert.equal(errors.length,1); assert.equal(store.sequence,1);
  assert.equal(new ExpeditionSave(storage,'world').load().player.x,1);
  autosave.dispose();
});

test('real background worker roundtrip preserves large Unicode and fractional world data', async () => {
  const storage=memory(),store=new ExpeditionSave(storage,'world');
  const moduleUrl=new URL('../app/src/main/assets/content-runtime/save-worker.js',import.meta.url).href;
  let finish,reject;
  const done=new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
  const autosave=new Autosave(store,{workerFactory:()=>{
    const nodeWorker=new Worker(`const {parentPort}=require('node:worker_threads');
      import(${JSON.stringify(moduleUrl)}).then(({prepareSaveMessage})=>parentPort.on('message',message=>parentPort.postMessage(prepareSaveMessage(message))));`,{eval:true});
    const adapter={postMessage:message=>nodeWorker.postMessage(message),terminate:()=>nodeWorker.terminate()};
    nodeWorker.on('message',data=>adapter.onmessage?.({data}));
    nodeWorker.on('error',error=>{reject(error);adapter.onerror?.({preventDefault(){}});});
    return adapter;
  },onSaved:(sequence,info)=>finish({sequence,info}),onError:reject});
  const value={...state(-6400.125),name:'요정 🧚',claims:Array.from({length:25000},(_,i)=>`harvest:63026:${i}:forest:source_raw_timber`)};
  try {
    autosave.schedule(value);
    const result=await done;
    assert.equal(result.sequence,1);assert.equal(result.info.mode,'worker');
    assert.deepEqual(new ExpeditionSave(storage,'world').load(),value);
    assert.equal(JSON.parse(storage.getItem('world.a')).encoding,'lz-string-utf16-v1');
  } finally { autosave.dispose(); }
});
