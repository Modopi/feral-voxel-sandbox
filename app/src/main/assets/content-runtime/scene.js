import * as T from '../vendor/three.module.js';
import {ASSETS, loadAssetLibrary} from './assets.generated.js';
import {buildPartMeshes} from './render-surfaces.js';
import {flattenAsset} from './voxel/model.mjs';
import {animateCreatureModel} from './creature-animation.js';
import {animateBossModel,bossLogicalPart} from './boss-animation.js';
export {T};
const colors = {
 grass:0x688b49,dirt:0x80644b,stone:0x858b87,sand:0xc4b483,log:0x725238,
 plank:0xa58a5c,leaf:0x54743f,leaves:0x54743f,moss:0x4c6a42,water:0x42899d,acid_water:0x8b9941,
 basalt:0x41464a,ash:0x7c776d,clay:0x9b6c52,ice:0x8cb7c5,snow:0xdce5de,
};
function colorFor(id) {
 if(colors[id])return colors[id];
 if(/mana|crystal/.test(id))return 0x7b79bd;
 if(/sacred|holy/.test(id))return 0xe0c98a;
 if(/ore|iron/.test(id))return 0x866f58;
 if(/nickel/.test(id))return 0x9ca795;
 if(/titan/.test(id))return 0x889ba0;
 if(/leaf|grass|peat/.test(id))return 0x627b45;
 if(/wood|root/.test(id))return 0x79553c;
 return 0x777e79;
}
export function chunkGeometry(atlas,chunk) {
 const dims=[chunk.size,chunk.size,chunk.size], size=chunk.size, origin=[chunk.cx*16,chunk.cy*16,chunk.cz*16];
 const p=[],n=[],c=[],mask=new Int32Array(size*size),color=new T.Color();
 const at=v=>{
   if(v.every(a=>a>=0&&a<size))return chunk.blocks[v[0]+v[2]*size+v[1]*size*size]||0;
   const id=atlas.getCell(chunk.cx*size+v[0],chunk.cy*size+v[1],chunk.cz*size+v[2]);
   return id?chunk.palette.indexOf(id):0;
 };
 for(let d=0;d<3;d++){
  const u=(d+1)%3,v=(d+2)%3,x=[0,0,0],q=[0,0,0];q[d]=1;
  for(x[d]=-1;x[d]<dims[d];){
   let idx=0;
   for(x[v]=0;x[v]<dims[v];x[v]++)for(x[u]=0;x[u]<dims[u];x[u]++){
    const a=at(x),b=at(x.map((a,i)=>a+q[i]));
    mask[idx++]=a&&!b&&x[d]>=0?a:!a&&b&&x[d]<dims[d]-1?-b:0;
   }
   x[d]++;idx=0;
   for(let j=0;j<dims[v];j++)for(let i=0;i<dims[u];){
    const m=mask[idx];if(!m){i++;idx++;continue;}
    let w=1,h=1;while(i+w<dims[u]&&mask[idx+w]===m)w++;
    scan:while(j+h<dims[v]){for(let k=0;k<w;k++)if(mask[idx+k+h*dims[u]]!==m)break scan;h++;}
    x[u]=i;x[v]=j;const du=[0,0,0],dv=[0,0,0];du[u]=w;dv[v]=h;
    const corners=[x.slice(),x.map((a,k)=>a+du[k]),x.map((a,k)=>a+du[k]+dv[k]),x.map((a,k)=>a+dv[k])];
    const order=m>0?[0,1,2,0,2,3]:[0,3,2,0,2,1], normal=[0,0,0];normal[d]=m>0?1:-1;
    color.setHex(colorFor(chunk.palette[Math.abs(m)]));
    const shade=d===1?(m>0?1:.53):d===0?.82:.7;
    for(const k of order){p.push(...corners[k].map((a,l)=>a*.5+origin[l]));n.push(...normal);c.push(color.r*shade,color.g*shade,color.b*shade);}
    for(let y=0;y<h;y++)for(let z=0;z<w;z++)mask[idx+z+y*dims[u]]=0;
    i+=w;idx+=w;
   }
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(n,3));g.setAttribute('color',new T.Float32BufferAttribute(c,3));g.computeBoundingSphere();return g;
}
function releaseModel(model){for(const mesh of model.dynamicGeometry??[]){mesh.geometry.dispose();mesh.material.dispose();}model.group.removeFromParent();}
export class ExpeditionScene {
 constructor(canvas,atlas){
  this.atlas=atlas;this.renderer=new T.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=T.SRGBColorSpace;
  this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;
  this.scene=new T.Scene();this.scene.background=new T.Color(0xb4cbbf);this.scene.fog=new T.Fog(0xb4cbbf,85,220);
  this.camera=new T.PerspectiveCamera(72,1,.05,320);this.camera.rotation.order='YXZ';
  this.scene.add(new T.HemisphereLight(0xe2f0ed,0x5f6542,2.1));
  this.sun=new T.DirectionalLight(0xffe5b4,2.4);this.sun.position.set(-50,100,40);this.scene.add(this.sun);
  this.terrainMaterial=new T.MeshStandardMaterial({vertexColors:true,roughness:1});
  this.chunks=new Map();this.models=new Map();this.pending=new Set();this.wanted=new Map();this.geometryCache=new Map();
  this.ray=new T.Raycaster();this.ray.far=7;this.telegraphs=new T.Group();this.scene.add(this.telegraphs);
  this.shots=[];
  this.resize();
 }
 resize(){const w=innerWidth,h=innerHeight;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 syncTerrain(){
  for(const[key,m]of this.chunks)if(!this.atlas.activeChunks.has(key)){this.scene.remove(m);m.geometry.dispose();this.chunks.delete(key);}
  let budget=1;
  for(const[key,chunk]of this.atlas.activeChunks){
   const old=this.chunks.get(key);if(old&&old.userData.revision===(chunk.revision??0)&&old.userData.chunk===chunk)continue;
   if(!budget--)break;
   if(old){this.scene.remove(old);old.geometry.dispose();}
   const mesh=new T.Mesh(chunkGeometry(this.atlas,chunk),this.terrainMaterial);mesh.userData={kind:'terrain',chunk,revision:chunk.revision??0};
   this.scene.add(mesh);this.chunks.set(key,mesh);
  }
 }
 async makeModel(desc){
  const library=desc.asset?new Map([[desc.asset.id,desc.asset]]):await loadAssetLibrary(desc.assetId),asset=desc.asset??library.get(desc.assetId),group=new T.Group();
  const partGroups=new Map(),dynamicGeometry=[];
  for(const p of asset.parts){const node=new T.Group();node.name=p.id;node.position.set(...p.translation);node.userData.part=p;partGroups.set(p.id,node);}
  for(const p of asset.parts){const node=partGroups.get(p.id);(p.parent===null?group:partGroups.get(p.parent)).add(node);
   const mutable=['machine','object'].includes(desc.kind),cacheKey=asset.id+':'+p.id;let cached=mutable?null:this.geometryCache.get(cacheKey);
   if(!cached){cached=buildPartMeshes(p.boxes,asset.materials);if(!mutable)this.geometryCache.set(cacheKey,cached);}
   for(const cachedMesh of cached){const mesh=new T.Mesh(cachedMesh.geometry,cachedMesh.material);mesh.userData={id:desc.id,kind:desc.kind,partId:p.id};node.add(mesh);if(mutable)dynamicGeometry.push(mesh);}
  }
  const value={group,parts:partGroups,asset,library,boxes:flattenAsset(asset,library),desc,revision:desc.revision,dynamicGeometry};
  if(desc.getBoxes)this.rebuildStructure(value,desc);
  if(this.wanted.has(desc.id)){this.models.set(desc.id,value);this.scene.add(group);}else releaseModel(value);
  this.pending.delete(desc.id);return value;
 }
 rebuildStructure(model,desc){
  if(!model.structureParts){model.group.clear();model.parts.clear();model.structureParts=new Map();}
  const boxes=desc.getBoxes(),buckets=new Map(),materials=[...model.asset.materials];
  for(const b of boxes)if(!materials.some(m=>m.id===b.material))materials.push({id:b.material,color:b.color??'#775c3e',opacity:b.opacity??1,roughness:.9,metallic:0,emission:0,collision:b.collision!==false});
  for(const b of boxes){const key=b.partId;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({...b,center:b.center.map((v,i)=>v-[desc.position.x,desc.position.y,desc.position.z][i])});}
  const discard=id=>{const old=model.structureParts.get(id);if(!old)return;for(const mesh of old.meshes){mesh.geometry.dispose();mesh.material.dispose();}old.node.removeFromParent();model.structureParts.delete(id);model.parts.delete(id);};
  for(const id of model.structureParts.keys())if(!buckets.has(id))discard(id);
  for(const[id,partBoxes]of buckets){
   const signature=JSON.stringify(partBoxes);if(model.structureParts.get(id)?.signature===signature)continue;discard(id);
   const node=new T.Group(),meshes=[];node.name=id;node.userData.part=model.asset.parts.find(p=>p.id===id);model.parts.set(id,node);model.group.add(node);
   for(const {geometry,material}of buildPartMeshes(partBoxes,materials)){
    const mesh=new T.Mesh(geometry,material);mesh.userData={id:desc.id,kind:desc.kind,partId:id};node.add(mesh);meshes.push(mesh);
   }
   model.structureParts.set(id,{signature,node,meshes});
  }
  model.dynamicGeometry=[...model.structureParts.values()].flatMap(p=>p.meshes);
  model.revision=desc.revision;model.boxes=boxes;
 }
 syncModels(descriptors,time,dt=0){
  this.wanted=new Map(descriptors.map(d=>[d.id,d]));
  for(const[id,m]of this.models)if(!this.wanted.has(id)){releaseModel(m);this.models.delete(id);}
  for(const d of descriptors){
   if(!d.asset&&!ASSETS[d.assetId])continue;
   let m=this.models.get(d.id);
   if(m&&d.asset&&m.asset!==d.asset){releaseModel(m);this.models.delete(d.id);m=null;}
   if(!m){if(!this.pending.has(d.id)){this.pending.add(d.id);this.makeModel(d).catch(e=>{this.pending.delete(d.id);this.lastError=e;});}continue;}
   m.desc=d;if(d.getBoxes&&m.revision!==d.revision)this.rebuildStructure(m,d);
   const p=d.position;m.group.position.set(p.x,p.y,p.z);
   if(d.rotation)m.group.quaternion.set(d.rotation.x,d.rotation.y,d.rotation.z,d.rotation.w);else m.group.rotation.set(0,d.yaw||0,0);
   if(d.kind==='creature'&&d.entity){animateCreatureModel(m,d.entity,time,dt);continue;}
   if(d.kind==='boss'&&d.entity){animateBossModel(m,d.entity,d.bossSystem,time,dt);continue;}
   for(const[id,node]of m.parts){
    node.visible=!d.missingParts?.includes(id);node.rotation.set(0,0,0);
    const walking=d.pose?.state==='walk'||d.pose?.speedFactor>0&&d.moving;
    if(walking&&/leg|foot|arm/.test(id))node.rotation.x=Math.sin(time*6+(id.includes('left')?0:Math.PI))*.3;
    if(/wing/.test(id)&&d.moving)node.rotation.z=Math.sin(time*9)*.5*(id.includes('left')?1:-1);
   }
  }
 }
 aim({range=7,excludeOwnerId=null}={}){this.ray.far=range;this.camera.updateMatrixWorld();this.ray.setFromCamera(new T.Vector2(0,0),this.camera);const objects=[...this.chunks.values(),...this.models.values()].map(m=>m.group??m);const hits=this.ray.intersectObjects(objects,true);for(const hit of hits){let hidden=false;for(let node=hit.object;node;node=node.parent)if(!node.visible){hidden=true;break;}if(hidden)continue;const data={...hit.object.userData};if(excludeOwnerId!=null&&data.id===excludeOwnerId)continue;if(data.kind==='boss')data.partId=bossLogicalPart(this.models.get(data.id).asset,data.partId);return {point:hit.point,normal:hit.face?.normal.clone().transformDirection(hit.object.matrixWorld),rayOrigin:this.ray.ray.origin.clone(),distance:hit.distance,...data};}return null;}
 flashTrace(from,to){
  const vector=p=>new T.Vector3(p.x??p[0],p.y??p[1],p.z??p[2]);
  const geometry=new T.BufferGeometry().setFromPoints([vector(from),vector(to)]),material=new T.LineBasicMaterial({color:0x9ce6ff,transparent:true,opacity:.8,depthTest:true});
  const line=new T.Line(geometry,material);line.raycast=()=>{};this.scene.add(line);this.shots.push({line,expires:performance.now()+140});
  while(this.shots.length>4){const old=this.shots.shift();old.line.removeFromParent();old.line.geometry.dispose();old.line.material.dispose();}
 }
 draw(player,eye=1.58){
  const now=performance.now();for(let i=this.shots.length-1;i>=0;i--)if(this.shots[i].expires<=now){const {line}=this.shots.splice(i,1)[0];line.removeFromParent();line.geometry.dispose();line.material.dispose();}
  this.camera.position.set(player.x,player.y+eye,player.z);this.camera.rotation.set(player.pitch||0,player.yaw||0,0);this.renderer.render(this.scene,this.camera);
 }
 dispose(){for(const {line}of this.shots){line.removeFromParent();line.geometry.dispose();line.material.dispose();}this.shots=[];for(const m of this.models.values())releaseModel(m);for(const m of this.chunks.values())m.geometry.dispose();for(const list of this.geometryCache.values())for(const m of list){m.geometry.dispose();m.material.dispose();}this.terrainMaterial.dispose();this.renderer.dispose();}
}
