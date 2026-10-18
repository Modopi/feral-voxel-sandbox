import * as T from '../vendor/three.module.js';
import {loadAsset} from './assets.generated.js';
import {surfaceGroups} from './voxel/solid.js';
import {materialColor} from './machines.js';

const TOOL_IDS=new Set(['hand_knife','stone_pick','bark_cup']);
const TOOL_PRIORITY=['hand_knife','stone_pick','bark_cup'];
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const owned=(p,id)=>typeof id==='string'&&p.count(id)>=1;
const heldTool=(p,id)=>TOOL_IDS.has(id)&&owned(p,id)?[{assetId:id,slot:'tool_hand',hand:'right'}]:[];

/** Camera-space motion only; zero offset at both endpoints restores the declared grip. */
export function equipmentAttackOffset(style,age){
  if(!Number.isFinite(age)||age<=0||age>=.38)return {position:[0,0,0],rotation:[0,0,0]};
  const phase=age/.38,amount=Math.sin(Math.PI*phase);
  if(style==='pierce')return {position:[0,0,-.42*amount],rotation:[-.92*amount,0,0]};
  if(style==='impact'){
    const windup=phase<.35?Math.sin(Math.PI*phase/.35):0,slam=phase>=.35?Math.sin(Math.PI*(phase-.35)/.65):0;
    return {position:[0,.18*windup-.16*slam,-.06*windup-.12*slam],rotation:[-1.1*windup+1.45*slam,0,0]};
  }
  return {position:[.12*amount,-.1*amount,-.14*amount],rotation:[.95*amount,0,-.4*amount]};
}

/** Read-only visual choice. Inventory, damage, tool requirements and wear remain runtime-owned. */
export function selectHeldEquipment(runtime){
  const p=runtime.progression;if(!p||runtime.player?.hp<=0)return [];
  if(runtime.harvestAction){
    const source=p.catalog.get(runtime.harvestAction.sourceId);if(!source||source.kind!=='source')return [];
    if(source.requiredTool)return heldTool(p,source.requiredTool);
    // Optional visible hand tool never changes a bare-hand source's rules.
    return heldTool(p,runtime.heldToolId??TOOL_PRIORITY.find(id=>owned(p,id)));
  }
  if(runtime.heldToolId!=null)return heldTool(p,runtime.heldToolId);
  const weaponAsset=runtime.armaments?.equippedAsset();
  if(weaponAsset)return [{assetId:weaponAsset.shapeId,slot:'main_hand',hand:'right',materialId:weaponAsset.materialId}];
  if(owned(p,p.equipped)&&p.catalog.get(p.equipped)?.kind==='gear_baseline')return [
    {assetId:p.equipped,slot:'main_hand',hand:'right'},{assetId:p.equipped,slot:'off_hand',hand:'left'}];
  return heldTool(p,TOOL_PRIORITY.find(id=>owned(p,id)));
}

/** Keeps canonical part translations and pivots, aligns only the declared attachment anchor. */
export function createEquipmentSlot(asset,slotName,{materialId:selectedMaterialId=null}={}){
  const slot=asset.equipmentSlots?.find(s=>s.slot===slotName),anchor=asset.anchors?.find(a=>a.id===slot?.anchorId);
  if(!slot||!Array.isArray(slot.partIds)||!slot.partIds.length||!anchor||!vec(anchor.position))throw Error(`Missing equipment slot/anchor: ${asset.id}/${slotName}`);
  const sourceParts=new Map(asset.parts.map(p=>[p.id,p]));
  if(slot.partIds.some(id=>!sourceParts.has(id))||!sourceParts.has(anchor.partId))throw Error('Equipment slot references unknown part');
  const selected=new Set(slot.partIds),offsetCache=new Map();
  function selectedPart(id,trail=[]){if(selected.has(id))return true;const p=sourceParts.get(id);if(!p||p.parent===null)return false;if(trail.includes(id))throw Error('Equipment parent cycle');return selectedPart(p.parent,[...trail,id]);}
  if(!selectedPart(anchor.partId))throw Error('Equipment anchor is outside selected slot');
  function offset(id,trail=[]){if(offsetCache.has(id))return offsetCache.get(id);const p=sourceParts.get(id);if(!p||trail.includes(id)||!vec(p.translation))throw Error('Invalid equipment hierarchy');const base=p.parent===null?[0,0,0]:offset(p.parent,[...trail,id]);const position=p.translation.map((n,i)=>n+base[i]);offsetCache.set(id,position);return position;}
  const anchorPosition=anchor.position.map((n,i)=>n+offset(anchor.partId)[i]);
  const group=new T.Group(),aligned=new T.Group(),parts=new Map(),meshes=[];group.name=`held:${asset.id}:${slotName}`;group.userData={visualOnly:true,firstPersonEquipment:true,assetId:asset.id,slot:slotName};aligned.position.set(...anchorPosition.map(n=>-n));group.add(aligned);
  try{
    for(const p of asset.parts){offset(p.id);const node=new T.Group();node.name=p.id;node.position.set(...p.translation);node.userData={part:p,visualOnly:true};parts.set(p.id,node);}
    for(const p of asset.parts){const node=parts.get(p.id);(p.parent===null?aligned:parts.get(p.parent)).add(node);if(!selectedPart(p.id))continue;
      for(const [materialId,s]of surfaceGroups(p.boxes,asset.materials)){
        if(!s.positions.length)continue;const src=asset.materials.find(m=>m.id===materialId);if(!src)throw Error('Unknown equipment material');
        const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(s.positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(s.normals,3));geometry.setIndex(s.indices);
        const selected=selectedMaterialId&&asset.id.startsWith('weapon_')&&['body','edge'].includes(src.id),tint=selected?materialColor(selectedMaterialId):src.color,metallic=selected?(selectedMaterialId.includes('wood')||selectedMaterialId==='stone'?0:.65):src.metallic??0;
        const material=new T.MeshStandardMaterial({color:tint,roughness:src.roughness??.9,metalness:metallic,emissive:tint,emissiveIntensity:src.emission??0,
          opacity:src.opacity??1,transparent:(src.opacity??1)<1,depthTest:false,depthWrite:false,fog:false});
        const mesh=new T.Mesh(geometry,material);mesh.name=p.id+':'+materialId;mesh.userData={visualOnly:true,firstPersonEquipment:true,partId:p.id,assetId:asset.id};mesh.renderOrder=1000;mesh.frustumCulled=false;mesh.raycast=()=>{};
        node.add(mesh);meshes.push(mesh);
      }
    }
    if(!meshes.length)throw Error('Equipment slot has no geometry');
  }catch(error){for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}throw error;}
  let disposed=false;
  return {asset,slot:slotName,group,aligned,parts,anchor,anchorPosition,meshes,
    dispose(){if(disposed)return;disposed=true;for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}group.removeFromParent();}};
}

/** Camera-local visuals only. No descriptor is registered with world or physics ownership. */
export class EquipmentView {
  constructor(expeditionScene,{load=loadAsset}={}){
    if(!expeditionScene?.camera||!expeditionScene?.scene)throw Error('EquipmentView needs an expedition scene');
    this.scene=expeditionScene;this.load=load;this.root=new T.Group();this.root.name='first_person_equipment';this.root.userData={visualOnly:true,firstPersonEquipment:true};
    expeditionScene.camera.add(this.root);if(!expeditionScene.camera.parent)expeditionScene.scene.add(expeditionScene.camera);
    this.models=[];this.key='';this.generation=0;this.disposed=false;this.ready=Promise.resolve([]);this.lastError=null;
    this.clock=0;this.strikeAge=Infinity;this.strikeStyle='strike';this.lastStrike=null;this.lastPosition=null;this.speed=0;
  }
  _clear(){for(const m of this.models)m.dispose();this.models=[];}
  _request(descriptors){
    const key=JSON.stringify(descriptors);if(key===this.key)return;this.key=key;const generation=++this.generation;this._clear();this.lastError=null;
    this.ready=(async()=>{
      const assets=await Promise.all(descriptors.map(d=>this.load(d.assetId)));if(this.disposed||generation!==this.generation)return [];
      const models=[];
      try{for(let i=0;i<descriptors.length;i++){const d=descriptors[i],asset=assets[i];if(asset.id!==d.assetId||asset.category!=='equipment')throw Error('Equipment asset identity mismatch');const model=createEquipmentSlot(asset,d.slot,{materialId:d.materialId});model.hand=d.hand;models.push(model);}}
      catch(error){for(const m of models)m.dispose();throw error;}
      if(this.disposed||generation!==this.generation){for(const m of models)m.dispose();return [];}
      this.models=models;for(const model of models)this.root.add(model.group);this._pose(this.lastRuntime??{},0);return models;
    })().catch(error=>{if(!this.disposed&&generation===this.generation){this.lastError=error;this._clear();}return [];});
  }
  _pose(runtime,dt){
    const resting=Boolean(runtime.player?.resting),harvesting=Boolean(runtime.harvestAction),elapsed=runtime.harvestAction?.elapsed??0;
    const attack=equipmentAttackOffset(this.strikeStyle,this.strikeAge);
    const chop=harvesting?Math.max(0,Math.sin(elapsed*Math.PI*2*1.35)):0;
    const bob=Math.sin(this.clock*8)*Math.min(.018,this.speed*.003),breath=Math.sin(this.clock*1.7)*.004;
    for(const model of this.models){const right=model.hand==='right',tool=model.slot==='tool_hand',cup=model.asset.id==='bark_cup',sign=right?1:-1;
      const move=right?attack.position:[0,0,0],turn=right?attack.rotation:[0,0,0],work=right?chop:0;
      // Held in the frontier's right hand, low and to the side so the crosshair stays clear.
      const base=right?[.42,-.4,-.68]:[-.46,-.4,-.9];model.group.scale.setScalar(right&&tool?.72:1);
      model.group.position.set(base[0]+move[0],base[1]+bob+breath+(resting?-.2:0)+move[1]+work*.025,base[2]+move[2]+(resting?.1:0));
      model.group.rotation.set((right?(cup?-.12:-.65):-.08)+turn[0]+work*(cup?.12:.55),(right?-.16:.32)+turn[1],sign*(right?-.18:.08)+turn[2]+(resting?sign*.18:0));
      if(tool&&cup)model.group.position.y+=.08;
      model.group.visible=runtime.player?.hp!==0;
    }
  }
  sync(runtime,dt=0){
    if(this.disposed)return;if(!Number.isFinite(dt)||dt<0)throw Error('Invalid equipment view time');dt=Math.min(dt,.1);this.clock+=dt;this.lastRuntime=runtime;
    // Weapon hits and mining strikes both swing the held tool.
    const strike=Math.max(runtime.lastStrike??-Infinity,runtime.lastMine??-Infinity);if(this.lastStrike===null)this.lastStrike=strike;else if(Number.isFinite(strike)&&strike!==this.lastStrike){this.strikeAge=0;this.strikeStyle=runtime.lastAttackMode??runtime.player?.attackStyle??'strike';this.lastStrike=strike;}this.strikeAge+=dt;
    const p=runtime.player;if(p&&this.lastPosition&&dt>0){const speed=Math.hypot(p.x-this.lastPosition.x,p.z-this.lastPosition.z)/dt;this.speed+=(Math.min(8,speed)-this.speed)*Math.min(1,dt*12);}if(p)this.lastPosition={x:p.x,z:p.z};
    this._request(selectHeldEquipment(runtime));this._pose(runtime,dt);return this.ready;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.generation++;this._clear();this.root.removeFromParent();}
}
