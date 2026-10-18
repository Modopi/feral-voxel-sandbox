import test from 'node:test';
import assert from 'node:assert/strict';
import {LZString} from '../app/src/main/assets/vendor/lz-string.js';
import {ExpeditionSave} from '../app/src/main/assets/content-runtime/save.js';
const state = x => ({player:{x,y:2,z:3,hp:100},deaths:[],schema:1});
const memory = () => { const map = new Map(); return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}; };
test('failed or corrupted next save retains the previous complete world',()=>{
 const store=memory(), save=new ExpeditionSave(store,'feral.slot.new');
 save.write(state(1)); save.write(state(2));
 store.setItem('feral.slot.new.b','truncated');
 assert.equal(new ExpeditionSave(store,save.key).load().player.x,1);
 const restored=new ExpeditionSave(store,save.key);restored.load();
 store.setItem=()=>{throw Error('quota')};
 assert.throws(()=>restored.write(state(3)),/quota/);
 assert.equal(new ExpeditionSave(store,save.key).load().player.x,1);
});
test('saved generations preserve non-expedition legacy data and reject invalid state',()=>{
 const store=memory();store.setItem('feral.world.v1','original');
 const save=new ExpeditionSave(store,'feral.slot.new');assert.equal(save.load(),null);
 assert.throws(()=>save.write({player:{x:NaN}}));
 save.write(state(-500));save.write(state(1600));
 assert.equal(new ExpeditionSave(store,save.key).load().player.x,1600);
 assert.equal(store.getItem('feral.world.v1'),'original');
});
test('lossless compressed generations preserve large idempotency ledgers and remain backward compatible',()=>{
 const store=memory(),save=new ExpeditionSave(store,'large');
 const large={...state(-2345),name:'요정의 보관함 🧚',claims:Array.from({length:25000},(_,i)=>`harvest:63026:${i}:forest:source_raw_timber`),inventory:{wood:1.125},destroyed:[[-1,3,501]]};
 save.write(large);save.write({...large,player:{...large.player,x:9321}});
 const envelope=JSON.parse(store.getItem('large.a'));
 assert.equal(envelope.encoding,'lz-string-utf16-v1');
 assert(store.getItem('large.a').length<JSON.stringify(large).length*.4);
 assert.deepEqual(new ExpeditionSave(store,'large').load(),{...large,player:{...large.player,x:9321}});
 // Convert the first generation to the exact legacy, uncompressed envelope.
 const payload=LZString.decompressFromUTF16(envelope.payload);
 let hash=2166136261;for(let i=0;i<payload.length;i++)hash=Math.imul(hash^payload.charCodeAt(i),16777619);
 store.setItem('large.a',JSON.stringify({sequence:3,checksum:(hash>>>0).toString(16),payload}));
 assert.deepEqual(new ExpeditionSave(store,'large').load(),large);
 // A valid compressed checksum with a corrupted expansion contract is rejected.
 const corrupt=JSON.parse(store.getItem('large.b'));corrupt.sequence=4;corrupt.originalLength++;
 store.setItem('large.b',JSON.stringify(corrupt));
 assert.deepEqual(new ExpeditionSave(store,'large').load(),large);
});
