import * as T from '../vendor/three.module.js';
import {ASSETS, loadAssetLibrary} from './assets.generated.js';
import {buildPartMeshes} from './render-surfaces.js';
import {flattenAsset} from './voxel/model.js';
import {animateCreatureModel,creatureBodyPart,creatureBones,woundedBoxes,BONE_MATERIAL} from './creature-animation.js';
import {animateBossModel,bossLogicalPart} from './boss-animation.js';
import {WorldUI} from '../world-ui.js';
import {firstPersonHands} from '../character-view.js';
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
// Reused padded volume: the chunk plus one face-adjacent cell on each side.
let PADDED=new Uint16Array(0),MASK=new Int32Array(0);
const paletteIndex=new WeakMap(),paletteColor=new WeakMap();
/** Greedy-meshed exposed faces of one chunk. Neighbour cells are read once into a
 * padded volume so the sweep is pure index arithmetic with no per-cell allocation. */
export function chunkGeometry(atlas,chunk) {
 const size=chunk.size,W=size+2,W2=W*W,origin=[chunk.cx*16,chunk.cy*16,chunk.cz*16],palette=chunk.palette,blocks=chunk.blocks;
 if(PADDED.length<W*W2)PADDED=new Uint16Array(W*W2);if(MASK.length<size*size)MASK=new Int32Array(size*size);
 const vol=PADDED,mask=MASK;vol.fill(0,0,W*W2);
 let index=paletteIndex.get(palette);if(!index){index=new Map();palette.forEach((id,i)=>{if(!index.has(id))index.set(id,i);});paletteIndex.set(palette,index);}
 let colors=paletteColor.get(palette);if(!colors){colors=new Map();paletteColor.set(palette,colors);}
 for(let y=0;y<size;y++)for(let z=0;z<size;z++){const from=z*size+y*size*size,to=1+(z+1)*W+(y+1)*W2;for(let x=0;x<size;x++)vol[to+x]=blocks[from+x];}
 const gx=chunk.cx*size,gy=chunk.cy*size,gz=chunk.cz*size,outside=(x,y,z)=>{const id=atlas.getCell(gx+x,gy+y,gz+z);vol[(x+1)+(z+1)*W+(y+1)*W2]=id?index.get(id)??0:0;};
 for(let a=0;a<size;a++)for(let b=0;b<size;b++){outside(-1,a,b);outside(size,a,b);outside(a,-1,b);outside(a,size,b);outside(a,b,-1);outside(a,b,size);}
 const stride=[1,W2,W],p=[],n=[],c=[],x=[0,0,0],corner=[0,0,0];
 for(let d=0;d<3;d++){
  const u=(d+1)%3,v=(d+2)%3,sd=stride[d],su=stride[u],sv=stride[v];
  for(let xd=-1;xd<size;xd++){
   let idx=0;
   for(let j=0;j<size;j++){let i0=(xd+1)*sd+(j+1)*sv+su;for(let i=0;i<size;i++,i0+=su){
    const a=vol[i0],b=vol[i0+sd];
    mask[idx++]=a&&!b&&xd>=0?a:!a&&b&&xd<size-1?-b:0;
   }}
   x[d]=xd+1;idx=0;
   for(let j=0;j<size;j++)for(let i=0;i<size;){
    const m=mask[idx];if(!m){i++;idx++;continue;}
    let w=1,h=1;while(i+w<size&&mask[idx+w]===m)w++;
    scan:while(j+h<size){for(let k=0;k<w;k++)if(mask[idx+k+h*size]!==m)break scan;h++;}
    x[u]=i;x[v]=j;
    const block=Math.abs(m);let rgb=colors.get(block);if(!rgb){const color=new T.Color().setHex(colorFor(palette[block]));colors.set(block,rgb=[color.r,color.g,color.b]);}
    const shade=d===1?(m>0?1:.53):d===0?.82:.7,r=rgb[0]*shade,g=rgb[1]*shade,bl=rgb[2]*shade,nd=m>0?1:-1;
    // Corners 0..3 are x, x+du, x+du+dv, x+dv; winding follows the face sign.
    for(const k of m>0?ORDER_POSITIVE:ORDER_NEGATIVE){
     corner[0]=x[0];corner[1]=x[1];corner[2]=x[2];if(k===1||k===2)corner[u]+=w;if(k===2||k===3)corner[v]+=h;
     p.push(corner[0]*.5+origin[0],corner[1]*.5+origin[1],corner[2]*.5+origin[2]);
     n.push(d===0?nd:0,d===1?nd:0,d===2?nd:0);c.push(r,g,bl);
    }
    for(let y=0;y<h;y++)for(let z=0;z<w;z++)mask[idx+z+y*size]=0;
    i+=w;idx+=w;
   }
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(n,3));g.setAttribute('color',new T.Float32BufferAttribute(c,3));g.computeBoundingSphere();return g;
}
const ORDER_POSITIVE=[0,1,2,0,2,3],ORDER_NEGATIVE=[0,3,2,0,2,1];
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
  this.shots=[];this.quality='balanced';
  // The same world-space aim and context cards as the other maps.
  this.worldUI=new WorldUI(this.scene,this.camera);
  // The frontier's first-person hands; a held block or material shows as a small cube in the right hand.
  this.hands=firstPersonHands();this.camera.add(this.hands);this.scene.add(this.camera);this.heldCube=null;this.handsArmored=false;this.heldId=null;
  this.resize();
 }
 setHands({armored=false,heldId=null,showCube=false}={}){
  if(armored!==this.handsArmored){this.camera.remove(this.hands);this.hands.children.forEach(m=>m.geometry.dispose());this.hands=firstPersonHands(armored);this.camera.add(this.hands);this.handsArmored=armored;}
  const id=showCube?heldId:null;if(id===this.heldId)return;this.heldId=id;
  if(this.heldCube){this.camera.remove(this.heldCube);this.heldCube.geometry.dispose();this.heldCube.material.dispose();this.heldCube=null;}
  if(!id)return;
  this.heldCube=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:colorFor(id),roughness:.8}));
  this.heldCube.scale.setScalar(.1);this.heldCube.position.set(.22,-.17,-.4);this.heldCube.rotation.set(.1,.6,.1);this.heldCube.raycast=()=>{};this.camera.add(this.heldCube);
 }
 resize(){const w=innerWidth,h=innerHeight;this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.quality==='low'?1:this.quality==='high'?2:1.5));this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 /** Shared graphics setting: pixel ratio, view distance and terrain streaming radius. */
 qualitySet(q){
  this.quality=['low','balanced','high'].includes(q)?q:'balanced';
  this.loadRadiusChunks=this.quality==='low'?2:this.quality==='high'?4:3;
  this.scene.fog.far=this.quality==='low'?150:this.quality==='high'?260:220;this.scene.fog.near=this.scene.fog.far*.39;
  this.camera.far=this.scene.fog.far+100;this.camera.updateProjectionMatrix();this.resize();
 }
 /** Meshes loaded chunks within a time budget. Chunks whose mesh is stale (an edit
  * the player is watching) go before newly loaded ones, nearest first; at least
  * one chunk is meshed per call so edits always appear. */
 syncTerrain(player=null,{budgetMs=3}={}){
  for(const[key,m]of this.chunks)if(!this.atlas.activeChunks.has(key)){this.scene.remove(m);m.geometry.dispose();this.chunks.delete(key);}
  let pending=null;
  for(const[key,chunk]of this.atlas.activeChunks){
   const old=this.chunks.get(key);if(old&&old.userData.revision===(chunk.revision??0)&&old.userData.chunk===chunk)continue;
   const dx=player?chunk.cx*16+8-player.x:0,dy=player?chunk.cy*16+8-(player.y??0):0,dz=player?chunk.cz*16+8-player.z:0;
   (pending??=[]).push({key,chunk,old,order:(old?0:1e9)+dx*dx+dy*dy+dz*dz});
  }
  if(!pending)return 0;
  pending.sort((a,b)=>a.order-b.order);
  const deadline=performance.now()+budgetMs;let built=0;
  for(const {key,chunk,old}of pending){
   if(built&&performance.now()>=deadline)break;
   if(old){this.scene.remove(old);old.geometry.dispose();}
   const mesh=new T.Mesh(chunkGeometry(this.atlas,chunk),this.terrainMaterial);mesh.userData={kind:'terrain',chunk,revision:chunk.revision??0};
   this.scene.add(mesh);this.chunks.set(key,mesh);built++;
  }
  return pending.length-built;
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
  if(desc.kind==='creature')for(const p of asset.parts){
   // Bones sit inside the shell and show only through wounds (frontier layered body).
   const key=`bone:${asset.id}:${p.id}`;let cached=this.geometryCache.get(key);
   if(!cached){cached=buildPartMeshes(creatureBones(p,creatureBodyPart(desc.entity??{},p.id)),[BONE_MATERIAL]);this.geometryCache.set(key,cached);}
   for(const c of cached){const mesh=new T.Mesh(c.geometry,c.material);mesh.userData={id:desc.id,kind:desc.kind,partId:p.id,layer:'bone'};partGroups.get(p.id).add(mesh);}
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
 /** Re-mesh only the wounded parts of one creature from its shell boxes minus the saved wound cubes. */
 rebuildWounds(model,e){
  model.woundRevision=e.woundRevision??0;model.woundMeshes??=new Map();
  for(const [partId,cuts]of Object.entries(e.wounds??{})){
   const node=model.parts.get(partId),part=model.asset.parts.find(p=>p.id===partId),old=model.woundMeshes.get(partId);
   if(!node||!part||old?.count===cuts.length)continue;
   for(const mesh of [...node.children])if(mesh.isMesh&&mesh.userData.layer!=='bone')mesh.removeFromParent();
   if(old){for(const mesh of old.meshes){mesh.geometry.dispose();mesh.material.dispose();}model.dynamicGeometry=model.dynamicGeometry.filter(m=>!old.meshes.includes(m));}
   const meshes=buildPartMeshes(woundedBoxes(part.boxes,cuts),model.asset.materials).map(({geometry,material})=>{const mesh=new T.Mesh(geometry,material);mesh.userData={id:e.id,kind:'creature',partId};node.add(mesh);return mesh;});
   model.dynamicGeometry.push(...meshes);model.woundMeshes.set(partId,{count:cuts.length,meshes});
  }
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
   if(d.kind==='creature'&&d.entity){
    if((m.woundRevision??0)!==(d.entity.woundRevision??0))this.rebuildWounds(m,d.entity);
    for(const[id,node]of m.parts){const broken=!!d.entity.parts?.[creatureBodyPart(d.entity,id)]?.broken;for(const mesh of node.children)if(mesh.userData.layer==='bone')mesh.visible=!broken;}
    animateCreatureModel(m,d.entity,time,dt);continue;
   }
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
  this.camera.position.set(player.x,player.y+eye,player.z);this.camera.rotation.set(player.pitch||0,player.yaw||0,0);this.camera.updateMatrixWorld();this.worldUI?.update();this.renderer.render(this.scene,this.camera);
 }
 dispose(){this.worldUI?.dispose();for(const {line}of this.shots){line.removeFromParent();line.geometry.dispose();line.material.dispose();}this.shots=[];for(const m of this.models.values())releaseModel(m);for(const m of this.chunks.values())m.geometry.dispose();for(const list of this.geometryCache.values())for(const m of list){m.geometry.dispose();m.material.dispose();}this.terrainMaterial.dispose();this.renderer.dispose();}
}
