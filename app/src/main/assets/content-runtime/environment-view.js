import * as T from '../vendor/three.module.js';

const CELL=.5, AREA=.25;
const key=(x,y,z)=>`${x},${y},${z}`;
const decode=s=>s.split(',').map(Number);
const near=(p,player,r)=>Math.abs(p[0]*CELL+.25-player.x)<=r&&Math.abs(p[2]*CELL+.25-player.z)<=r&&Math.abs(p[1]*CELL+.25-(player.y??0))<=r;
const DIRECTIONS=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];

// All reads are observational. This module never materializes a natural water cell,
// advances the simulation, or writes to the atlas. Liquid height is volume / area.
export function liquidGeometry(atlas,cells){
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
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(p,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(n,3));geometry.setAttribute('color',new T.Float32BufferAttribute(c,3));geometry.computeBoundingSphere();geometry.userData={visibleCells};return geometry;
}

export class EnvironmentView{
 constructor(scene,atlas,{radius=40,maxLiquidCells=4096,maxEffects=128,columnBudget=256}={}){
  this.scene=scene.scene??scene;this.atlas=atlas;this.radius=Math.max(8,Math.min(64,radius));this.maxLiquidCells=Math.max(1,Math.min(8192,maxLiquidCells));this.maxEffects=Math.max(1,Math.min(256,maxEffects));this.columnBudget=Math.max(1,Math.min(1024,columnBudget));
  this.group=new T.Group();this.group.name='environment';this.scene.add(this.group);
  this.liquid=new T.Mesh(new T.BufferGeometry(),new T.MeshStandardMaterial({vertexColors:true,roughness:.22,metalness:.05,transparent:true,opacity:.67,depthWrite:false,depthTest:true,side:T.DoubleSide}));this.liquid.renderOrder=1;this.liquid.userData={kind:'environment-liquid',collision:false};this.group.add(this.liquid);
  this.flame=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial({color:0xff9c32,transparent:true,opacity:.82,depthWrite:false,depthTest:true}),this.maxEffects);this.flame.count=0;this.flame.frustumCulled=false;this.flame.renderOrder=2;this.flame.userData={kind:'environment-fire',collision:false};this.group.add(this.flame);
  this.heat=new T.InstancedMesh(new T.BoxGeometry(.504,.504,.504),new T.MeshBasicMaterial({color:0xff3f12,transparent:true,opacity:.25,depthWrite:false,depthTest:true,blending:T.AdditiveBlending}),this.maxEffects);this.heat.count=0;this.heat.frustumCulled=false;this.heat.renderOrder=2;this.heat.userData={kind:'environment-heat',collision:false};this.group.add(this.heat);
  this.columns=new Map();this.natural=new Map();this.fireCandidates=new Map();this.heatCandidates=new Map();this.iterators={};this.transform=new T.Object3D();this.tint=new T.Color();this.lastRefresh=-Infinity;this.lastRevision=-1;this.stats={liquidCells:0,fireCells:0,hotCells:0,scannedColumns:0};
 }
 _scanNatural(player){
  const wanted=new Map();for(const chunk of this.atlas.activeChunks.values()){const x=chunk.cx*16+8,z=chunk.cz*16+8;if(Math.abs(x-player.x)>this.radius+16||Math.abs(z-player.z)>this.radius+16)continue;const k=`${chunk.cx},${chunk.cz}`;wanted.set(k,{cx:chunk.cx,cz:chunk.cz,distance:(x-player.x)**2+(z-player.z)**2});}
  for(const k of this.columns.keys())if(!wanted.has(k)){this.columns.delete(k);for(const [id,c]of this.natural)if(c.chunk===k)this.natural.delete(id);}
  for(const [k,c]of wanted)if(!this.columns.has(k))this.columns.set(k,{...c,cursor:0});
  const jobs=[...this.columns.entries()].filter(([,c])=>c.cursor<1024).sort((a,b)=>a[1].distance-b[1].distance);let scanned=0;
  const deadline=performance.now()+2;
  for(const [chunk,c]of jobs){while(c.cursor<1024&&scanned<this.columnBudget){if((scanned&15)===0&&performance.now()>=deadline)break;const i=c.cursor++,hx=c.cx*32+i%32,hz=c.cz*32+Math.floor(i/32),s=this.atlas.sample(hx*.5+.25,hz*.5+.25);scanned++;
    if(s.waterLevel!==null&&s.waterLevel>s.height&&this.natural.size<8192)this.natural.set(`${hx},${hz}`,{hx,hz,hy:Math.ceil(s.waterLevel*2)-1,bottom:Math.floor(s.height*2),chunk});
   }if(scanned>=this.columnBudget||performance.now()>=deadline)break;
  }this.stats.scannedColumns=scanned;return scanned>0;
 }
 _liquidCells(player){
  const cells=new Map(),r=Math.ceil(this.radius/16),cx=Math.floor(player.x/16),cy=Math.floor((player.y??0)/16),cz=Math.floor(player.z/16);
  // Spatial index avoids scanning an ever growing saved fluid map.
  const chunks=[];for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++)chunks.push({k:key(cx+dx,cy+dy,cz+dz),d:dx*dx+dy*dy+dz*dz});chunks.sort((a,b)=>a.d-b.d);let examined=0;
  scan:for(const chunk of chunks)for(const k of this.atlas._fluidChunkKeys.get(chunk.k)??[]){if(++examined>16384)break scan;const f=this.atlas.fluidCells.get(k),p=decode(k);if(f?.volumeM3>1e-9&&near(p,player,this.radius))cells.set(k,p);}
  for(const c of this.natural.values()){
   if(!near([c.hx,c.hy,c.hz],player,this.radius))continue;
   // A persisted depleted top voxel reveals the next water surface, not a new source.
   for(let hy=c.hy;hy>=c.bottom&&hy>c.hy-32;hy--){const p=[c.hx,hy,c.hz];if(this.atlas.fluidAt(c.hx*.5+.25,hy*.5+1e-10,c.hz*.5+.25)){cells.set(key(...p),p);break;}}
  }
  return [...cells.values()].sort((a,b)=>((a[0]*.5-player.x)**2+(a[1]*.5-(player.y??0))**2+(a[2]*.5-player.z)**2)-((b[0]*.5-player.x)**2+(b[1]*.5-(player.y??0))**2+(b[2]*.5-player.z)**2)).slice(0,this.maxLiquidCells);
 }
 _scanEffects(field,cache,player){
  const source=this.atlas[field];let iterator=this.iterators[field]??source.keys();
  for(let i=0;i<256;i++){const next=iterator.next();if(next.done){iterator=source.keys();break;}const p=decode(next.value);if(near(p,player,this.radius))cache.set(next.value,p);if(cache.size>this.maxEffects*2)cache.delete(cache.keys().next().value);}
  this.iterators[field]=iterator;for(const [k,p]of cache)if(!source.has(k)||!near(p,player,this.radius))cache.delete(k);
 }
 sync(player,time=0){
  const a=this.atlas;this.naturalDirty=this._scanNatural(player)||this.naturalDirty;const moved=!this.lastPlayer||Math.hypot(player.x-this.lastPlayer.x,player.z-this.lastPlayer.z)>1;
  if(time-this.lastRefresh>=.15&&(this.naturalDirty||moved||this.lastRevision!==a.environmentRevision||this.lastAtlasRevision!==a.revision)){
   const geometry=liquidGeometry(a,this._liquidCells(player));this.liquid.geometry.dispose();this.liquid.geometry=geometry;this.stats.liquidCells=geometry.userData.visibleCells;this.lastRevision=a.environmentRevision;this.lastAtlasRevision=a.revision;this.lastRefresh=time;this.lastPlayer={x:player.x,z:player.z};this.naturalDirty=false;
  }
  this._scanEffects('burning',this.fireCandidates,player);this._scanEffects('thermalCells',this.heatCandidates,player);
  let count=0;for(const [k,p]of this.fireCandidates){if(count>=this.maxEffects)break;const pulse=.85+.15*Math.sin(time*11+p[0]*1.7+p[2]);this.transform.position.set(p[0]*.5+.25,p[1]*.5+.45,p[2]*.5+.25);this.transform.scale.set(.32*pulse,.65*pulse,.32*pulse);this.transform.updateMatrix();this.flame.setMatrixAt(count++,this.transform.matrix);}this.flame.count=count;this.flame.instanceMatrix.needsUpdate=true;this.stats.fireCells=count;
  count=0;for(const [,p]of this.heatCandidates){if(count>=this.maxEffects)break;const temperature=a.temperatureAtCell(...p);if(temperature<80||!a.isSolidCell(...p))continue;this.transform.position.set(p[0]*.5+.25,p[1]*.5+.25,p[2]*.5+.25);this.transform.scale.setScalar(1);this.transform.updateMatrix();this.heat.setMatrixAt(count,this.transform.matrix);this.tint.setRGB(Math.min(1,(temperature-20)/500),Math.min(.5,(temperature-80)/1500),0);this.heat.setColorAt(count++,this.tint);}this.heat.count=count;this.heat.instanceMatrix.needsUpdate=true;if(this.heat.instanceColor)this.heat.instanceColor.needsUpdate=true;this.stats.hotCells=count;
  return {...this.stats};
 }
 dispose(){for(const mesh of [this.liquid,this.flame,this.heat]){mesh.geometry.dispose();mesh.material.dispose();}this.group.removeFromParent();this.columns.clear();this.natural.clear();}
}
