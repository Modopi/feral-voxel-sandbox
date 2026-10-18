import * as T from '../vendor/three.module.js';
import {SECTION_CELLS} from './atlas.js';

const CELL=.5, AREA=.25, S=SECTION_CELLS, SECTION_M=S*CELL;
const key=(x,y,z)=>`${x},${y},${z}`;
const decode=s=>s.split(',').map(Number);
const near=(p,player,r)=>Math.abs(p[0]*CELL+.25-player.x)<=r&&Math.abs(p[2]*CELL+.25-player.z)<=r&&Math.abs(p[1]*CELL+.25-(player.y??0))<=r;
const DIRECTIONS=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
const EMPTY=new Float32Array(0);

// All reads are observational. This module never materializes a natural water cell,
// advances the simulation, or writes to the atlas. Liquid height is volume / area.
export function liquidArrays(atlas,cells){
 const liquidCache=new Map(),solidCache=new Map();
 const fluidAt=(x,y,z)=>{const k=key(Math.floor(x*2),Math.floor(y*2),Math.floor(z*2));if(!liquidCache.has(k))liquidCache.set(k,atlas.fluidAt(x,y,z));return liquidCache.get(k);};
 const isSolidCell=(x,y,z)=>{const k=key(x,y,z);if(!solidCache.has(k))solidCache.set(k,atlas.isSolidCell(x,y,z));return solidCache.get(k);};
 const p=[],n=[],c=[],color=new T.Color(),water=new T.Color(0x438caa),acid=new T.Color(0xabb943);
 const quad=(corners,normal)=>{for(const i of [0,1,2,0,2,3]){p.push(...corners[i]);n.push(...normal);c.push(color.r,color.g,color.b);}};
 let visibleCells=0;
 for(const entry of cells){
  const [hx,hy,hz]=entry, x=hx*CELL,y=hy*CELL,z=hz*CELL;
  if(isSolidCell(hx,hy,hz))continue;
  const f=fluidAt(x+.25,y+1e-10,z+.25);if(!f||f.volumeM3<=1e-9)continue;
  const depth=Math.min(CELL,f.volumeM3/AREA),top=y+depth;
  color.copy(water).lerp(acid,Math.min(1,(f.acidFraction??0)/.45));const before=p.length;
  const above=fluidAt(x+.25,y+.5+1e-10,z+.25);
  if((depth<CELL-1e-8||!above)&&!(depth>=CELL-1e-8&&isSolidCell(hx,hy+1,hz)))quad([[x,top,z],[x,top,z+CELL],[x+CELL,top,z+CELL],[x+CELL,top,z]],[0,1,0]);
  for(const [dx,,dz]of DIRECTIONS){
   if(isSolidCell(hx+dx,hy,hz+dz))continue;
   const other=fluidAt(x+dx*CELL+.25,y+1e-10,z+dz*CELL+.25),low=y+Math.min(CELL,(other?.volumeM3??0)/AREA);if(low>=top-1e-8)continue;
   if(dx===1)quad([[x+CELL,low,z],[x+CELL,top,z],[x+CELL,top,z+CELL],[x+CELL,low,z+CELL]],[1,0,0]);
   if(dx===-1)quad([[x,low,z+CELL],[x,top,z+CELL],[x,top,z],[x,low,z]],[-1,0,0]);
   if(dz===1)quad([[x+CELL,low,z+CELL],[x+CELL,top,z+CELL],[x,top,z+CELL],[x,low,z+CELL]],[0,0,1]);
   if(dz===-1)quad([[x,low,z],[x,top,z],[x+CELL,top,z],[x+CELL,low,z]],[0,0,-1]);
  }
  // The underside matters for suspended/falling liquid and a submerged camera.
  if(!isSolidCell(hx,hy-1,hz)&&(fluidAt(x+.25,y-.5+1e-10,z+.25)?.volumeM3??0)<.125-1e-9)quad([[x,y,z+CELL],[x,y,z],[x+CELL,y,z],[x+CELL,y,z+CELL]],[0,-1,0]);
  if(p.length>before)visibleCells++;
 }
 return {position:new Float32Array(p),normal:new Float32Array(n),color:new Float32Array(c),visibleCells};
}
function geometryFrom({position,normal,color,visibleCells}){
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(position,3));geometry.setAttribute('normal',new T.BufferAttribute(normal,3));geometry.setAttribute('color',new T.BufferAttribute(color,3));geometry.computeBoundingSphere();geometry.userData={visibleCells};return geometry;
}
export function liquidGeometry(atlas,cells){return geometryFrom(liquidArrays(atlas,cells));}

export class EnvironmentView{
 constructor(scene,atlas,{radius=40,maxLiquidCells=4096,maxEffects=128,columnBudget=256}={}){
  this.scene=scene.scene??scene;this.atlas=atlas;this.radius=Math.max(8,Math.min(64,radius));this.maxLiquidCells=Math.max(1,Math.min(8192,maxLiquidCells));this.maxEffects=Math.max(1,Math.min(256,maxEffects));this.columnBudget=Math.max(1,Math.min(1024,columnBudget));
  this.group=new T.Group();this.group.name='environment';this.scene.add(this.group);
  this.liquid=new T.Mesh(new T.BufferGeometry(),new T.MeshStandardMaterial({vertexColors:true,roughness:.22,metalness:.05,transparent:true,opacity:.67,depthWrite:false,depthTest:true,side:T.DoubleSide}));this.liquid.renderOrder=1;this.liquid.userData={kind:'environment-liquid',collision:false};this.group.add(this.liquid);
  this.flame=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial({color:0xff9c32,transparent:true,opacity:.82,depthWrite:false,depthTest:true}),this.maxEffects);this.flame.count=0;this.flame.frustumCulled=false;this.flame.renderOrder=2;this.flame.userData={kind:'environment-fire',collision:false};this.group.add(this.flame);
  this.heat=new T.InstancedMesh(new T.BoxGeometry(.504,.504,.504),new T.MeshBasicMaterial({color:0xff3f12,transparent:true,opacity:.25,depthWrite:false,depthTest:true,blending:T.AdditiveBlending}),this.maxEffects);this.heat.count=0;this.heat.frustumCulled=false;this.heat.renderOrder=2;this.heat.userData={kind:'environment-heat',collision:false};this.group.add(this.heat);
  this.columns=new Map();this.natural=new Map();this.footprints=new Map();this.surfaces=new Map();this.sections=new Map();this.included=[];this.changeCursor=0;this.playerSection=null;this.liquidDirty=true;this.fireCandidates=new Map();this.heatCandidates=new Map();this.iterators={};this.transform=new T.Object3D();this.tint=new T.Color();this.lastRefresh=-Infinity;this.stats={liquidCells:0,fireCells:0,hotCells:0,scannedColumns:0};
 }
 // Natural water columns of loaded chunks, indexed by 4 m footprint (section x,z).
 _scanNatural(player){
  const wanted=new Map();for(const chunk of this.atlas.activeChunks.values()){const x=chunk.cx*16+8,z=chunk.cz*16+8;if(Math.abs(x-player.x)>this.radius+16||Math.abs(z-player.z)>this.radius+16)continue;const k=`${chunk.cx},${chunk.cz}`;wanted.set(k,{cx:chunk.cx,cz:chunk.cz,distance:(x-player.x)**2+(z-player.z)**2});}
  let changed=false;
  for(const k of this.columns.keys())if(!wanted.has(k)){this.columns.delete(k);for(const [id,c]of this.natural)if(c.chunk===k){this.natural.delete(id);this._footprintColumn(c,false);changed=true;}}
  for(const [k,c]of wanted)if(!this.columns.has(k))this.columns.set(k,{...c,cursor:0});
  const jobs=[...this.columns.entries()].filter(([,c])=>c.cursor<1024).sort((a,b)=>a[1].distance-b[1].distance);let scanned=0;
  const deadline=performance.now()+2;
  for(const [chunk,c]of jobs){while(c.cursor<1024&&scanned<this.columnBudget){if((scanned&15)===0&&performance.now()>=deadline)break;const i=c.cursor++,hx=c.cx*32+i%32,hz=c.cz*32+Math.floor(i/32),s=this.atlas.sample(hx*.5+.25,hz*.5+.25);scanned++;
    if(s.waterLevel!==null&&s.waterLevel>s.height&&this.natural.size<8192){const column={hx,hz,hy:Math.ceil(s.waterLevel*2)-1,bottom:Math.floor(s.height*2),chunk};this.natural.set(`${hx},${hz}`,column);this._footprintColumn(column,true);changed=true;}
   }if(scanned>=this.columnBudget||performance.now()>=deadline)break;
  }this.stats.scannedColumns=scanned;return changed;
 }
 _footprintColumn(column,add){
  const fx=Math.floor(column.hx/S),fz=Math.floor(column.hz/S),k=`${fx},${fz}`;let f=this.footprints.get(k);
  if(add){if(!f)this.footprints.set(k,f={fx,fz,columns:[]});f.columns.push(column);}
  else if(f){f.columns=f.columns.filter(c=>c!==column);if(!f.columns.length)this.footprints.delete(k);}
  this._invalidateFootprint(k);
 }
 _invalidateFootprint(k){if(!this.surfaces.has(k))return;for(const sectionKey of this.surfaces.get(k).keys())this.sections.delete(sectionKey);this.surfaces.delete(k);}
 /** Visible natural surface per column: the highest cell holding water, scanned
  * down from the water level (a depleted tombstone reveals the next surface). */
 _surfaces(k){
  let bySection=this.surfaces.get(k);if(bySection)return bySection;
  bySection=new Map();
  for(const c of this.footprints.get(k)?.columns??[])for(let hy=c.hy;hy>=c.bottom&&hy>c.hy-32;hy--)if(this.atlas.fluidAt(c.hx*.5+.25,hy*.5+1e-10,c.hz*.5+.25)){
   const sk=key(Math.floor(c.hx/S),Math.floor(hy/S),Math.floor(c.hz/S));if(!bySection.has(sk))bySection.set(sk,[]);bySection.get(sk).push([c.hx,hy,c.hz]);break;
  }
  this.surfaces.set(k,bySection);return bySection;
 }
 /** Drops cached sections and surfaces the atlas reports as changed since the last call. */
 _applyChanges(){
  const {cursor,sections}=this.atlas.changesSince?this.atlas.changesSince(this.changeCursor):{cursor:0,sections:null};this.changeCursor=cursor;
  if(sections===null){this.sections.clear();this.surfaces.clear();this.liquidDirty=true;return;}
  for(const sk of sections){const [sx,,sz]=decode(sk);this.sections.delete(sk);this._invalidateFootprint(`${sx},${sz}`);}
  if(sections.size)this.liquidDirty=true;
 }
 /** Sections holding visible liquid near the player, nearest first, whole sections
  * up to maxLiquidCells. Section contents depend only on the world, so moving keeps
  * every cached section; only a changed section is meshed again. */
 _plan(player){
  const r=this.radius,reach=r+SECTION_M,candidates=new Map();
  const add=(sk,sx,sy,sz,cell)=>{let c=candidates.get(sk);if(!c){const cx=(sx+.5)*SECTION_M,cy=(sy+.5)*SECTION_M,cz=(sz+.5)*SECTION_M;if(Math.abs(cx-player.x)>reach||Math.abs(cy-(player.y??0))>reach||Math.abs(cz-player.z)>reach)return;candidates.set(sk,c={key:sk,distance:(cx-player.x)**2+(cy-(player.y??0))**2+(cz-player.z)**2,cells:new Map()});}if(cell)c.cells.set(key(...cell),cell);};
  for(const [k,f]of this.footprints){if(Math.abs((f.fx+.5)*SECTION_M-player.x)>reach||Math.abs((f.fz+.5)*SECTION_M-player.z)>reach)continue;for(const [sk,cells]of this._surfaces(k)){const [sx,sy,sz]=decode(sk);for(const cell of cells)add(sk,sx,sy,sz,cell);}}
  // Saved fluids, including water released by digging; tombstones draw nothing.
  for(const [sk,keys]of this.atlas._fluidSectionKeys??[]){const [sx,sy,sz]=decode(sk);for(const k of keys)if(this.atlas.fluidCells.get(k)?.volumeM3>1e-9)add(sk,sx,sy,sz,decode(k));}
  const ordered=[...candidates.values()].filter(c=>c.cells.size).sort((a,b)=>a.distance-b.distance||(a.key<b.key?-1:1)),plan=[];let total=0;
  for(const c of ordered){if(plan.length&&total+c.cells.size>this.maxLiquidCells)break;total+=c.cells.size;plan.push(c);}
  for(const sk of this.sections.keys())if(!candidates.has(sk))this.sections.delete(sk);
  return plan;
 }
 _liquidCells(player){this._applyChanges();return this._plan(player).flatMap(c=>[...c.cells.values()]);}
 _refreshLiquid(player){
  const plan=this._plan(player);let changed=plan.length!==this.included.length||plan.some((c,i)=>c.key!==this.included[i]);
  for(const c of plan)if(!this.sections.has(c.key)){this.sections.set(c.key,liquidArrays(this.atlas,[...c.cells.values()]));changed=true;}
  if(!changed)return;
  this.included=plan.map(c=>c.key);
  const parts=plan.map(c=>this.sections.get(c.key)),join=(name)=>{const total=parts.reduce((a,p)=>a+p[name].length,0);if(!total)return EMPTY;const out=new Float32Array(total);let o=0;for(const p of parts){out.set(p[name],o);o+=p[name].length;}return out;};
  const geometry=geometryFrom({position:join('position'),normal:join('normal'),color:join('color'),visibleCells:parts.reduce((a,p)=>a+p.visibleCells,0)});
  this.liquid.geometry.dispose();this.liquid.geometry=geometry;this.stats.liquidCells=geometry.userData.visibleCells;
 }
 _scanEffects(field,cache,player){
  const source=this.atlas[field];let iterator=this.iterators[field]??source.keys();
  for(let i=0;i<256;i++){const next=iterator.next();if(next.done){iterator=source.keys();break;}const p=decode(next.value);if(near(p,player,this.radius))cache.set(next.value,p);if(cache.size>this.maxEffects*2)cache.delete(cache.keys().next().value);}
  this.iterators[field]=iterator;for(const [k,p]of cache)if(!source.has(k)||!near(p,player,this.radius))cache.delete(k);
 }
 sync(player,time=0){
  const a=this.atlas;if(this._scanNatural(player))this.liquidDirty=true;
  const section=`${Math.floor(player.x/SECTION_M)},${Math.floor((player.y??0)/SECTION_M)},${Math.floor(player.z/SECTION_M)}`;if(section!==this.playerSection){this.playerSection=section;this.liquidDirty=true;}
  this._applyChanges();
  if(this.liquidDirty&&time-this.lastRefresh>=.15){this._refreshLiquid(player);this.liquidDirty=false;this.lastRefresh=time;}
  this._scanEffects('burning',this.fireCandidates,player);this._scanEffects('thermalCells',this.heatCandidates,player);
  let count=0;for(const [k,p]of this.fireCandidates){if(count>=this.maxEffects)break;const pulse=.85+.15*Math.sin(time*11+p[0]*1.7+p[2]);this.transform.position.set(p[0]*.5+.25,p[1]*.5+.45,p[2]*.5+.25);this.transform.scale.set(.32*pulse,.65*pulse,.32*pulse);this.transform.updateMatrix();this.flame.setMatrixAt(count++,this.transform.matrix);}this.flame.count=count;this.flame.instanceMatrix.needsUpdate=true;this.stats.fireCells=count;
  count=0;for(const [,p]of this.heatCandidates){if(count>=this.maxEffects)break;const temperature=a.temperatureAtCell(...p);if(temperature<80||!a.isSolidCell(...p))continue;this.transform.position.set(p[0]*.5+.25,p[1]*.5+.25,p[2]*.5+.25);this.transform.scale.setScalar(1);this.transform.updateMatrix();this.heat.setMatrixAt(count,this.transform.matrix);this.tint.setRGB(Math.min(1,(temperature-20)/500),Math.min(.5,(temperature-80)/1500),0);this.heat.setColorAt(count++,this.tint);}this.heat.count=count;this.heat.instanceMatrix.needsUpdate=true;if(this.heat.instanceColor)this.heat.instanceColor.needsUpdate=true;this.stats.hotCells=count;
  return {...this.stats};
 }
 dispose(){for(const mesh of [this.liquid,this.flame,this.heat]){mesh.geometry.dispose();mesh.material.dispose();}this.group.removeFromParent();this.columns.clear();this.natural.clear();this.footprints.clear();this.surfaces.clear();this.sections.clear();}
}
