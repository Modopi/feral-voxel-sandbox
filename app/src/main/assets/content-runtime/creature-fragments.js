import * as T from '../vendor/three.module.js';
import { VoxelAssetBuilder } from './voxel/authoring.mjs';
import { disjointBoxes } from './voxel/solid.mjs';
import { animateCreatureModel, creatureBodyPart } from './creature-animation.js';

const copy = value => structuredClone(value);
const xyz = v => ({x:v.x,y:v.y,z:v.z});
const volume = b => b.size.reduce((n,v)=>n*v,1);
const zero = () => ({x:0,y:0,z:0});
const EPS = 1e-7;
export const CREATURE_MASS_POLICY = 'authored_rest_solid_union_last_part_owns_overlap_v1';

/** Implementation assumption, not a new tissue density: distribute the species'
 * existing total mass by the authored SDK REST-pose solid union volume. Later
 * source parts own overlap volume at joints; no cubic metre is charged twice.
 * Within each part its resulting budget is spread over original solid cuboids by
 * volume. Visual joint allowances remain intact; no source shape is rewritten.
 */
export function allocateCreatureMass(asset,totalMassKg){
  if(!Number.isFinite(totalMassKg)||totalMassKg<=0)throw Error('Positive species mass required');
  new VoxelAssetBuilder(asset); // Reject invalid SDK geometry before calculating a budget.
  const material=new Map(asset.materials.map(m=>[m.id,m])),offsets=new Map(),flat=[];
  const offset=p=>{if(offsets.has(p.id))return offsets.get(p.id);const parent=p.parent===null?[0,0,0]:offset(asset.parts.find(n=>n.id===p.parent));const v=p.translation.map((n,i)=>n+parent[i]);offsets.set(p.id,v);return v;};
  const parts={};
  for(const part of asset.parts){
    const o=offset(part);parts[part.id]={massKg:0,ownedVolumeM3:0,boxMassesKg:part.boxes.map(()=>0)};
    part.boxes.forEach((box,index)=>{if(box.collision!==false&&material.get(box.material)?.collision!==false)flat.push({...box,center:box.center.map((v,i)=>v+o[i]),sourcePartId:part.id,sourceBoxIndex:index});});
  }
  const union=disjointBoxes(flat);const unionVolumeM3=union.reduce((n,b)=>n+volume(b),0);
  if(!(unionVolumeM3>0))throw Error('Species model needs a positive solid union');
  for(const b of union)parts[b.sourcePartId].ownedVolumeM3+=volume(b);
  let assigned=0;const nonempty=asset.parts.filter(p=>parts[p.id].ownedVolumeM3>0);
  for(const [i,part]of nonempty.entries()){
    const row=parts[part.id];row.massKg=i===nonempty.length-1?totalMassKg-assigned:totalMassKg*row.ownedVolumeM3/unionVolumeM3;assigned+=row.massKg;
    const solid=part.boxes.map((b,index)=>({b,index})).filter(({b})=>b.collision!==false&&material.get(b.material)?.collision!==false);
    const sum=solid.reduce((n,{b})=>n+volume(b),0);let charged=0;
    for(const [j,{b,index}]of solid.entries()){row.boxMassesKg[index]=j===solid.length-1?row.massKg-charged:row.massKg*volume(b)/sum;charged+=row.boxMassesKg[index];}
  }
  const signature=JSON.stringify([asset.id,asset.visualGridM,asset.parts.map(p=>[p.id,p.parent,p.translation,p.boxes]),asset.materials.map(m=>[m.id,m.collision]),totalMassKg]);
  let hash=2166136261;for(const c of signature)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return {schemaVersion:1,policy:CREATURE_MASS_POLICY,allocationId:`${asset.id}:${(hash>>>0).toString(16)}`,assetId:asset.id,totalMassKg,unionVolumeM3,parts};
}

/** Read the ACTUAL animated/clamped scene transform, including every parent.
 * Optional physics lookup supplies the same rigid body pose and motion velocities.
 * The result is plain serializable data; it never mutates the scene or entity. */
export function captureCreaturePose(record,entity,getPartPhysics=null){
  if(!record?.asset||!record.parts)return null;
  record.group.updateMatrixWorld(true);const parts={};
  for(const p of record.asset.parts){
    const node=record.parts.get(p.id);if(!node)continue;
    const position=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3();node.matrixWorld.decompose(position,rotation,scale);
    if([scale.x,scale.y,scale.z].some(v=>Math.abs(v-1)>EPS))throw Error('Creature fracture requires unit-scale source model');
    const physics=getPartPhysics?.(entity.id,p.id);
    parts[p.id]={position:physics?.position?copy(physics.position):xyz(position),rotation:physics?.rotation?copy(physics.rotation):{x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w},
      velocity:copy(physics?.velocity??zero()),angularVelocity:copy(physics?.angularVelocity??zero())};
  }
  return {assetId:record.asset.id,parts};
}

function simulationRecord(asset,entity,time){
  const group=new T.Group(),parts=new Map();group.position.set(entity.x,entity.y,entity.z);group.rotation.y=entity.yaw??0;
  for(const p of asset.parts){const node=new T.Group();node.userData.part=p;parts.set(p.id,node);}
  for(const p of asset.parts)(p.parent===null?group:parts.get(p.parent)).add(parts.get(p.id));
  const record={asset,group,parts};animateCreatureModel(record,entity,time,0);return record;
}

/** Converts persistent severance requests into matter objects. It does NOT create
 * life, HP, calories, inventory, drops, or corpse rewards. Those remain creatures'
 * existing single ledger, addressed by sourceOwnerId on each inert fragment. */
export class CreatureFragments {
  constructor(content,creatures,objects,{getModelRecord=()=>null,getPartPhysics=null}={}){
    this.creatures=creatures;this.objects=objects;this.getModelRecord=getModelRecord;this.getPartPhysics=getPartPhysics;
    this.species=new Map(content.creatures.entries.map(e=>[e.id,e]));this.models=new Map();this.allocations=new Map();
    creatures.setFragmentBridge(this);
  }
  _record(entity){return this.getModelRecord(entity.id)??this.models.get(entity.id)??null;}
  _allocation(asset,e){const key=e.speciesId;let a=this.allocations.get(key);if(!a||a.source!==asset){a={source:asset,value:allocateCreatureMass(asset,this.species.get(key).body.massKg)};this.allocations.set(key,a);}return a.value;}
  register(entity,record){
    if(record.asset.id!==entity.speciesId)throw Error('Creature fragment model must match the species');
    const allocation=this._allocation(record.asset,entity);
    if(entity.fragmentMass){
      const ledger=entity.fragmentMass;
      if(ledger.allocationId!==allocation.allocationId)throw Error('Creature mass allocation changed; explicit save migration required');
      let remaining=0;for(const[id,p]of Object.entries(allocation.parts)){const row=ledger.parts[id];if(!row||!Number.isFinite(row.massKg)||Math.abs(row.massKg-p.massKg)>EPS)throw Error('Invalid saved part mass');if(!row.objectId)remaining+=row.massKg;}
      if(Math.abs(remaining-ledger.remainingMassKg)>EPS||Math.abs(entity.massKg-remaining)>EPS)throw Error('Creature remaining mass not conserved');
      return allocation;
    }
    entity.fragmentMass={schemaVersion:1,ownerId:entity.id,allocationId:allocation.allocationId,policy:allocation.policy,totalMassKg:allocation.totalMassKg,remainingMassKg:allocation.totalMassKg,
      parts:Object.fromEntries(Object.entries(allocation.parts).map(([id,p])=>[id,{massKg:p.massKg,objectId:null}])),claims:{}};
    entity.massKg=allocation.totalMassKg;return allocation;
  }
  capture(entity){const record=this._record(entity);if(!record)return null;this.register(entity,record);return captureCreaturePose(record,entity,this.getPartPhysics);}
  flushEntity(entity){
    const record=this._record(entity);if(!record)return {ok:true,pending:true};
    const allocation=this.register(entity,record),asset=record.asset,byId=new Map(asset.parts.map(p=>[p.id,p]));let count=0;
    for(const cut of entity.fragmentCuts??[]){
      if(cut.processed)continue;
      const logical=new Set(cut.logicalParts.filter(id=>!['core','spine'].includes(id))),hidden=new Map();
      const detached=p=>{if(hidden.has(p.id))return hidden.get(p.id);const own=creatureBodyPart(entity,p.id);const value=logical.has(own)||(p.parent!==null&&detached(byId.get(p.parent)));hidden.set(p.id,value);return value;};
      const captured=cut.captured??captureCreaturePose(simulationRecord(asset,cut.before,cut.time),cut.before);
      for(const part of asset.parts){
        const budget=allocation.parts[part.id];if(!detached(part)||budget.massKg<=0||entity.fragmentMass.parts[part.id].objectId)continue;
        const pose=captured.parts[part.id];if(!pose)throw Error('Missing captured severed-part transform');
        const base={...copy(asset),id:`fragment_${asset.id}_${part.id}`,name:`${asset.name} · ${part.id}`,category:'object',entityType:'object',status:'runtime_creature_fragment',
          parts:[{id:'root',parent:null,translation:[0,0,0],role:'detached_creature_part',boxes:[]}],anchors:[],instances:[],notes:[...asset.notes,`Mass policy: ${CREATURE_MASS_POLICY}; no extra drops or living entity.`]};
        const builder=new VoxelAssetBuilder(base);for(const box of part.boxes)builder.addBox('root',copy(box));
        const result=this.objects.spawnFragment({sourceOwnerId:entity.id,sourcePartId:part.id,claimId:`${entity.id}:fragment:${part.id}`,
          asset:builder.toJSON(),...pose,allocation:{policy:allocation.policy,allocationId:allocation.allocationId,totalMassKg:allocation.totalMassKg,massKg:budget.massKg,boxMassesKg:budget.boxMassesKg},sourceLedger:entity.fragmentMass});
        if(!result.ok)throw Error(`Fragment transfer rejected: ${result.reason}`);
        entity.massKg=entity.fragmentMass.remainingMassKg;count++;
      }
      cut.processed=true;cut.captured=null;cut.before=null;
    }
    return {ok:true,count};
  }
  sync(models){
    if(models){this.models=models instanceof Map?new Map(models):new Map(Object.entries(models));}
    let count=0;for(const entity of this.creatures.entities){if(!this._record(entity))continue;count+=this.flushEntity(entity).count??0;}return {ok:true,count};
  }
  dispose(){if(this.creatures.fragmentBridge===this)this.creatures.setFragmentBridge(null);this.models.clear();this.allocations.clear();}
}
