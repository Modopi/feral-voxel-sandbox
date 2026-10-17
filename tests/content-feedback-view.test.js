import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import { FeedbackView,buildRecoveryFairyAsset } from '../app/src/main/assets/content-runtime/feedback-view.js';
import { assertAuthoringInvariant,assertCreatedByTool } from '../app/src/main/assets/content-runtime/voxel/authoring.mjs';

const runtime=()=>({player:{x:0,y:0,z:0,hp:100,maxHp:100,lastDamageAt:-100},progression:{inventory:{}},deaths:[],events:[]});
const death=(id,x=0,items={wood:8})=>({id,position:{x,y:0,z:0},items,recovered:false});
const create=()=>{const scene=new T.Scene();return {scene,v:new FeedbackView({scene})};};

test('reusable recovery fairy is authored through SDK with exclusive occupancy and cosmetic materials',()=>{
 const a=buildRecoveryFairyAsset();assertAuthoringInvariant(a);assertCreatedByTool(a);assert.equal(a.geometry.occupancy,'exclusive_within_part');
 assert(a.parts.some(p=>p.id==='wing_left'));assert(a.parts.some(p=>p.id==='wing_right'));assert(a.materials.every(m=>m.collision===false));
 const {scene,v}=create();assert.equal(scene.children.length,1);let disposed=0;for(const g of v.geometry)g.addEventListener('dispose',()=>disposed++);
 v.dispose();assert.equal(scene.children.length,0);assert.equal(disposed,v.geometry.length);v.dispose();assert.equal(disposed,v.geometry.length);
});

test('damage flashes and HP labels expire; loading an old damage timestamp does not replay a hit',()=>{
 const {v}=create(),r=runtime();r.player.lastDamageAt=100;assert.equal(v.sync(r,0).hitOpacity,0);
 r.player.hp=72;r.player.lastDamageAt=101;const before=JSON.stringify(r);let result=v.sync(r,.016);
 assert(result.hitOpacity>0&&result.hitOpacity<=.4);assert.match(result.hitText,/28 HP/);assert.equal(JSON.stringify(r),before);
 result=v.sync(r,1.1);assert.equal(result.hitOpacity,0);assert.equal(result.hitText,'');
 r.player.hp=80;assert.equal(v.sync(r,.1).hitOpacity,0,'healing is not damage');
 r.player.lastDamageAt=102;assert(v.sync(r,.1).hitOpacity>0,'same-frame damage and heal still produce a timestamp cue');
 v.dispose();
});

test('saved death items drive markers, partial recovery keeps its fairy and full recovery removes it',()=>{
 const {v}=create(),r=runtime();r.deaths=[death('saved',9)];const before=JSON.stringify(r);
 let status=v.sync(r,0);assert.equal(status.markers,1);assert.equal(status.fairies,2);assert.equal(status.inRecoveryRange,true);assert.equal(JSON.stringify(r),before);
 assert.equal(v.markers.get('saved').group.userData.recoveryRadiusM,10);
 r.deaths[0].items.wood=3;status=v.sync(r,.1);assert.equal(status.markers,1);assert.equal(status.flights,1);assert.match(status.recoveryText,/일부/);
 r.deaths[0].items={};r.deaths[0].recovered=true;status=v.sync(r,.1);assert.equal(status.markers,0);assert.equal(status.flights,2);assert.match(status.recoveryText,/모두/);
 status=v.sync(r,4);assert.equal(status.markers,0);assert.equal(status.flights,0);assert.equal(status.recoveryText,'');assert.equal(v.root.children.length,0);
 v.dispose();
});

test('recovery uses exact three-dimensional ten-metre boundary and describes full inventory without claiming',()=>{
 const {v}=create(),r=runtime();r.deaths=[death('boundary',10)];r.progression.inventory=Object.fromEntries(Array.from({length:36},(_,i)=>['item'+i,64]));
 assert.equal(v.sync(r,0).inRecoveryRange,true);assert.match(v.status.recoveryText,/가방에 공간/);
 r.deaths[0].position.y=.01;assert.equal(v.sync(r,.1).inRecoveryRange,false);assert.match(v.status.recoveryText,/10m 안/);
 r.deaths[0].position={x:6,y:8,z:0};assert.equal(v.sync(r,.1).inRecoveryRange,true);
 assert.deepEqual(r.deaths[0].items,{wood:8});assert.equal(r.deaths[0].recovered,false);assert.deepEqual(r.events,[]);v.dispose();
});

test('many historical deaths and repeated claims stay within visual instance caps without event accumulation',()=>{
 const {v}=create(),r=runtime();r.deaths=Array.from({length:500},(_,i)=>death('d'+i,1+i*.1));
 let status=v.sync(r,0);assert.equal(status.markers,4);assert.equal(status.fairies,8);
 for(let frame=0;frame<20;frame++){
  for(const [id]of v.markers){const d=r.deaths.find(d=>d.id===id);d.items.wood=Math.max(.01,d.items.wood-.1);}
  status=v.sync(r,.01);assert(status.flights<=4);assert(status.fairies<=12);assert(v.root.children.length<=8);
 }
 const before=JSON.stringify(r);for(let n=0;n<120;n++)v.sync(r,1/60);assert.equal(JSON.stringify(r),before);assert.equal(v.flights.length,0);
 r.player.x=1000;status=v.sync(r,1);assert.equal(status.markers,0);assert.match(status.recoveryText,/소지품/);v.dispose();
});

test('new death announces retained items, restored ledger does not manufacture recovery or mutate gameplay',()=>{
 const {v}=create(),r=runtime();v.sync(r,0);r.deaths.push(death('new',20));r.player.lastDamageAt=1;
 assert.match(v.sync(r,.1).recoveryText,/사망 지점/);
 const restored=JSON.parse(JSON.stringify(r)),other=create();const before=JSON.stringify(restored);other.v.sync(restored,0);
 assert.equal(other.v.flights.length,0);assert.equal(other.v.status.hitOpacity,0);assert.equal(JSON.stringify(restored),before);
 assert.equal(other.v.status.markers,v.status.markers);v.dispose();other.v.dispose();
});

test('owned DOM overlays are bounded, noninteractive and removed on dispose',()=>{
 const elements=[];const document={createElement:()=>{const e={style:{},children:[],setAttribute(){},appendChild(c){this.children.push(c);},remove(){this.removed=true;}};elements.push(e);return e;},body:{appendChild(e){this.child=e;}}};
 const scene=new T.Scene(),v=new FeedbackView({scene,renderer:{domElement:{ownerDocument:document}}}),r=runtime();
 assert.equal(elements.length,4);assert.equal(v.dom.overlay.style.pointerEvents,'none');v.sync(r,0);r.player.hp=90;r.player.lastDamageAt=1;v.sync(r,.1);
 assert.match(v.dom.hit.textContent,/10 HP/);assert(Number(v.dom.damage.style.opacity)>0);const overlay=v.dom.overlay;
 v.dispose();assert.equal(overlay.removed,true);assert.equal(scene.children.length,0);assert.equal(v.dom,null);
});

test('a death holding only crafted weapons still displays a fairy and recovery flight',()=>{
 const {v}=create(),r=runtime();r.deaths=[{...death('weapon-only',20),items:{},weapons:[{id:'weapon:1'}]}];
 assert.equal(v.sync(r,0).markers,1);
 r.deaths[0].weapons=[];r.deaths[0].recovered=true;
 assert.equal(v.sync(r,.1).flights,1);assert.equal(v.status.markers,0);v.dispose();
});
