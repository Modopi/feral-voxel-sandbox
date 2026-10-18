import { VoxelAssetBuilder } from './voxel/authoring.js';
import { components as connectedGroups, massProperties } from '../structure.js';
import { TYPES as LEGACY_PARTS } from '../machine/model.js';
import { MATERIAL_EFFECT_RULES } from './material-effects.js';
import { panelForce } from '../machine/aerodynamics.js';
import { FIXTURE_LINK_RULES } from './fixture-energy.js';

const ENERGY = ['mechanical', 'electrical', 'thermal', 'chemical', 'magic', 'divine'];
const zero = () => Object.fromEntries(ENERGY.map(k => [k, 0]));
const clone = x => structuredClone(x);
const ok = x => ({ ok: true, ...x });
const no = reason => ({ ok: false, reason });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = n => Number.isFinite(n) && Math.abs(n) <= 1e9;
const position = p => Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 };
const pointOK = p => ['x','y','z'].every(k => finite(p[k]));
const cellKey = c => c.join(',');
const quaternion = yaw => ({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)});
const rotate = (v,q) => { const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)}; return {x:v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:v.z+q.w*t.z+q.x*t.y-q.y*t.x}; };

// Explicit manufactured variants: silhouette never infers these capabilities.
export const MACHINE_VARIANTS = Object.freeze({
 joint: ['hull','wing'], transmission: ['wheel','propeller','rotor'], motor: ['motor'],
 controller: ['elevator','rudder'], heat_engine: [], generator: [], battery: [],
 inertial_cell: [], fluid_container: [], pump: [], mana_condenser: [], property_imprinter: [], relic: [],
});
// Provisional gameplay calibration, not a claim that the design EU already had an SI definition.
export const MACHINE_MOTION = Object.freeze({ joulesPerEU: 100, maxAcceleration: 12, maxSpeed: 50, physicsStep: 1/60 });
// Rotor flight (S2c2): lift per useful mechanical EU/s at a rotor, climb rate at full up/down input, the share of
// lift that pushes forward, air damping while rotors carry the craft, and how long a control command keeps them running.
export const ROTOR_FLIGHT = Object.freeze({ liftNPerEU: 50, climbMS: 3, forwardShare: .3, airDrag: .35, engagedS: .25 });
export const materialColor = id => ({wood:'#96724D',stone:'#8A9088',scrap_iron:'#7B7770',steel:'#849A9B',titanium:'#B2C1C8',nickel:'#A8A58C'}[id] || (id.includes('wood')?'#657F63':id.includes('holy')?'#D5C98E':id.includes('mana')?'#718CA9':'#8B8E9F'));
const color = materialColor;

/** Pure, deterministic machine model. Rendering and Rapier integration consume sceneModels(). */
export class MachineSystem {
 constructor(content, progression, state = {}, { terrain = null } = {}) {
  this.content=content;this.progression=progression;this.physicsDriver=null;this.terrain=terrain;this.machines=new Map();this.fireLedgerIndex=new WeakMap();this.nextId=state.nextId??1;this.clock=state.clock??0;this.commandClocks=new Map();
  if(state.schemaVersion!=null&&state.schemaVersion!==1)throw Error('Unsupported machine save');
  if(!Number.isSafeInteger(this.nextId)||this.nextId<1||!finite(this.clock)||this.clock<0)throw Error('Invalid machine counters');
  for(const saved of state.machines||[]){const m=clone(saved);this._validate(m);if(this.machines.has(m.id))throw Error('Duplicate machine');this.machines.set(m.id,m);this._rebuild(m);}
 }
 _entry(id){return this.progression.catalog.get(id);}
 _id(prefix){return `${prefix}:${this.nextId++}`;}
 create({position:where=[0,0,0],name='조립 구조물',gridM=.1}={}){
  const p=position(where);if(!pointOK(p)||![.03125,.1,.5].includes(gridM)||typeof name!=='string'||name.length>100)return no('invalid_machine');
  const id=this._id('machine');const m={id,name,entityType:'machine',gridM,position:p,velocity:{x:0,y:0,z:0},yaw:0,pitch:0,rotation:quaternion(0),angularVelocity:{x:0,y:0,z:0},damageClaims:[],voxels:[],components:[],links:[],fluidLinks:[],cargo:{},command:{throttle:0,steer:0,pitch:0,brake:false,push:0},revision:0,metrics:{generated:0,consumed:0,loss:0},lastPower:0};
  this.machines.set(id,m);return ok({machineId:id});
 }
 attachVoxel(id,{cell=[0,0,0],materialId='wood'}={}){
  const m=this.machines.get(id);if(!m||!Array.isArray(cell)||cell.length!==3||!cell.every(v=>Number.isInteger(v)&&Math.abs(v)<=128)||m.voxels.length>=2048)return no('invalid_voxel');
  if(m.voxels.some(v=>cellKey(v.cell)===cellKey(cell)))return no('occupied');
  const collision=this.physicsDriver?.canPlaceVoxel?.(m,{cell,gridM:m.gridM,materialId});if(collision===false||collision?.ok===false)return no(collision?.reason||'external_collision');
  if(m.voxels.length&&!m.voxels.some(v=>v.cell.reduce((sum,n,i)=>sum+Math.abs(n-cell[i]),0)===1))return no('attachment_required');
  const liters=Math.round(m.gridM**3*1000*1e9)/1e9, evaluation=this.progression.evaluateMaterial(materialId,{volumeLiters:liters});
  if(!evaluation.ok)return evaluation;
  const voxel={id:`voxel:${this.nextId}`,cell:[...cell],materialId,volumeLiters:liters,massKg:evaluation.massKg,hp:evaluation.maxHp,maxHp:evaluation.maxHp};
  // Validate the SDK geometry before the inventory commit, avoiding paid failed placement.
  const candidate=clone({...m,asset:undefined});candidate.voxels.push(voxel);this._rebuild(candidate);
  const paid=this.progression.spend({[materialId]:liters},{claimId:`machine-place:${m.id}:${voxel.id}`});if(!paid.ok)return paid;
  this.nextId++;m.voxels.push(voxel);m.asset=candidate.asset;m.revision++;return ok({voxelId:voxel.id,costLiters:liters});
 }
 removeVoxel(id,voxelId){
  const m=this.machines.get(id),v=m?.voxels.find(x=>x.id===voxelId);if(!v)return no('unknown_voxel');
  if(m.components.some(c=>c.voxelId===voxelId))return no('remove_component_first');
  const oldCenter=this.evaluate(m.id).center;const builder=new VoxelAssetBuilder(m.asset);builder.removeBox('root',{center:v.cell.map(n=>(n+.5)*m.gridM),size:[m.gridM,m.gridM,m.gridM]});m.asset=builder.toJSON();
  const salvaged=v.volumeLiters*(v.hp/v.maxHp);this.progression.grant({[v.materialId]:salvaged},{claimId:`machine-remove:${m.id}:${v.id}`});
  m.voxels=m.voxels.filter(x=>x!==v);m.revision++;this._split(m,oldCenter);this._rebuild(m);return ok({salvaged});
 }
 _coreMass(componentId){const c=this._entry(componentId),r=this._entry(c.origin.recipe);return Object.entries(r.inputs).reduce((sum,[id,n])=>sum+this._itemMass(id)*n,0);}
 _itemMass(id){const e=this._entry(id);return e?.properties?.densityKgM3/1000||e?.massKgPerUnit||0;}
 installComponent(id,voxelId,componentId,{legacyType=null}={}){
  const m=this.machines.get(id),v=m?.voxels.find(v=>v.id===voxelId),c=this._entry(componentId);
  if(!v||c?.kind!=='component'||!this.progression.research.has(c.research))return no('component_or_research_required');
  if(m.components.some(x=>x.voxelId===voxelId))return no('mount_occupied');
  if(legacyType!=null&&(!(MACHINE_VARIANTS[componentId]||[]).includes(legacyType)||!LEGACY_PARTS[legacyType]))return no('unsupported_variant');
  const component={id:`mounted:${this.nextId}`,voxelId,componentId,legacyType,energy:zero(),fuel:0,fuelItems:0,fluids:{},massKg:this._coreMass(componentId),active:true};
  if(componentId==='arc_thrower'){component.nextFireAt=0;component.shotsFired=0;component.fireLedger=[];component.fireCache=[];}
  const paid=this.progression.spend({[componentId]:1},{claimId:`mount:${m.id}:${component.id}`});if(!paid.ok)return paid;
  this.nextId++;m.components.push(component);this._rebuild(m);m.revision++;return ok({componentInstanceId:component.id,ports:this.ports(id,component.id)});
 }
 removeComponent(id,componentId){
  const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId);if(!c)return no('unknown_component');
  if(c.fuel>1e-8||c.fuelItems||Object.values(c.energy).some(n=>n>1e-8)||Object.values(c.fluids).some(n=>n>1e-8))return no('empty_component_first');
  const v=m.voxels.find(v=>v.id===c.voxelId);if(v.hp<v.maxHp-1e-8)return no('damaged_component_requires_repair');
  this.progression.grant({[c.componentId]:1},{claimId:`unmount:${m.id}:${c.id}`});m.components=m.components.filter(x=>x!==c);this._trimLinks(m);this._rebuild(m);m.revision++;return ok();
 }
 ports(id,componentId){const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId),d=c&&this._entry(c.componentId);return d?{inputs:[...d.inputEnergies],outputs:[...d.outputEnergies],stores:[...d.stores],functions:[...d.functions],legacyType:c.legacyType}:null;}
 connect(id,fromId,toId,type){
  const m=this.machines.get(id),a=this.ports(id,fromId),b=this.ports(id,toId);
  if(!m||fromId===toId||!ENERGY.includes(type)||!a?.outputs.includes(type)||!b?.inputs.includes(type))return no('incompatible_ports');
  if(m.links.some(l=>l.from===fromId&&l.to===toId&&l.type===type))return no('already_connected');
  m.links.push({id:this._id('link'),from:fromId,to:toId,type});m.revision++;return ok();
 }
 disconnect(id,linkId){const m=this.machines.get(id);if(!m)return no('unknown_machine');const before=m.links.length;m.links=m.links.filter(l=>l.id!==linkId);m.revision++;return before!==m.links.length?ok():no('unknown_link');}
 refuel(id,componentId,count=1){
  const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId);if(c?.componentId!=='heat_engine'||!Number.isInteger(count)||count<1||count>64)return no('invalid_fuel');
  const paid=this.progression.spend({raw_timber:count},{claimId:this._id('fuel')});if(!paid.ok)return paid;c.fuelItems+=count;return ok();
 }
 _fixtureTransferContext(id,componentId,type,direction){
  const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId),d=c&&this._entry(c.componentId),v=c&&m.voxels.find(v=>v.id===c.voxelId),g=this.progression.fixtureEnergy;
  if(!g?.enabled)return {error:'fixture_network_unavailable'};
  if(!m||!c||!d||!v||this._condition(m,c)<=0)return {error:'component_inactive'};
  if(!ENERGY.includes(type)||!d.stores.includes(type))return {error:'incompatible_ports'};
  const machinePorts={inputs:d.inputEnergies,outputs:d.outputEnergies,stores:d.stores};
  const compatible=direction==='from_fixture'
   ? machinePorts.inputs.includes(type)&&machinePorts.stores.includes(type)
   : direction==='to_fixture'&&machinePorts.outputs.includes(type)&&machinePorts.stores.includes(type);
  if(!compatible)return {error:'incompatible_ports'};
  const local={x:(v.cell[0]+.5)*m.gridM,y:(v.cell[1]+.5)*m.gridM,z:(v.cell[2]+.5)*m.gridM},rotated=rotate(local,m.rotation);
  return {m,c,d,v,g,hostPosition:{x:m.position.x+rotated.x,y:m.position.y+rotated.y,z:m.position.z+rotated.z}};
 }
 _fixtureNode(ownerId,type,direction,ctx){
  const g=ctx.g,n=g.nodes.get(ownerId),record=this.progression.worldFixtures?.find(row=>row.ownerId===ownerId);
  if(!n||!record||record.kind!=='component'||record.active!==true||record.health<=0||n.active!==true||n.health<=0||!this.progression.fixtureAccess?.includes(ownerId)||!g._access(n))return {error:'fixture_unavailable'};
  const ports=g.ports(ownerId),compatible=direction==='from_fixture'
   ? ports?.outputs.includes(type)&&ports?.stores.includes(type)
   : ports?.inputs.includes(type)&&ports?.stores.includes(type);
  if(!compatible)return {error:'incompatible_ports'};
  const distanceM=Math.hypot(n.position.x-ctx.hostPosition.x,n.position.y-ctx.hostPosition.y,n.position.z-ctx.hostPosition.z);
  if(!Number.isFinite(distanceM)||distanceM>FIXTURE_LINK_RULES.maxDistanceM+1e-8)return {error:'out_of_range'};
  const storedEU=n.energy?.[type],capacityEU=g.capacity(n,type);
  if(!finite(storedEU)||storedEU<0||!finite(capacityEU)||capacityEU<0||storedEU>capacityEU+1e-8)return {error:'invalid_fixture_storage'};
  return {node:n,distanceM,storedEU,capacityEU,ports};
 }
 fixtureTransferCandidates(id,componentId,type,direction='from_fixture'){
  const ctx=this._fixtureTransferContext(id,componentId,type,direction);if(ctx.error)return [];
  const c=ctx.c,d=ctx.d,g=ctx.g;
  return [...g.nodes.keys()].map(ownerId=>{
   const fixed=this._fixtureNode(ownerId,type,direction,ctx);if(fixed.error)return null;
   const machineStored=c.energy[type],machineRoom=Math.max(0,d.capacity-machineStored),fixtureRoom=Math.max(0,fixed.capacityEU-fixed.storedEU);
   const availableEU=direction==='from_fixture'?Math.min(fixed.storedEU,machineRoom):Math.min(machineStored,fixtureRoom);
   return {ownerId,assetId:fixed.node.assetId,distanceM:fixed.distanceM,storedEU:fixed.storedEU,roomEU:fixtureRoom,availableEU};
  }).filter(Boolean).sort((a,b)=>a.distanceM-b.distanceM||a.ownerId.localeCompare(b.ownerId));
 }
 _transferFixtureEnergy(id,componentId,type,amount,ownerId,direction){
  if(!finite(amount)||amount<=0)return no('invalid_amount');
  const ctx=this._fixtureTransferContext(id,componentId,type,direction);if(ctx.error)return no(ctx.error);
  const fixed=this._fixtureNode(ownerId,type,direction,ctx);if(fixed.error)return no(fixed.error);
  const {m,c,d,g}=ctx,{node,storedEU,capacityEU}=fixed;
  const machineEnergy=c.energy[type],machineCapacity=d.capacity;
  if(!finite(machineEnergy)||machineEnergy<0||machineEnergy>machineCapacity+1e-8)return no('invalid_machine_storage');
  const sourceEU=direction==='from_fixture'?storedEU:machineEnergy;
  const targetRoomEU=direction==='from_fixture'?Math.max(0,machineCapacity-machineEnergy):Math.max(0,capacityEU-storedEU);
  if(sourceEU+1e-8<amount)return no('insufficient_stored_energy');
  if(targetRoomEU+1e-8<amount)return no('target_capacity');
  if(!g.metrics?.exported||!g.metrics?.imported||!finite(g.metrics.exported[type])||!finite(g.metrics.imported[type])||!finite(m.metrics.generated)||!finite(m.metrics.consumed))return no('energy_ledger_unavailable');
  // All checks finish before this synchronous debit/credit and its paired receipts.
  if(direction==='from_fixture'){
   node.energy[type]=Math.max(0,storedEU-amount);c.energy[type]+=amount;g.metrics.exported[type]+=amount;m.metrics.generated+=amount;
  }else{
   c.energy[type]=Math.max(0,machineEnergy-amount);node.energy[type]+=amount;g.metrics.imported[type]+=amount;m.metrics.consumed+=amount;
  }
  m.revision++;
  return ok({transferredEU:amount,ownerId,direction,distanceM:fixed.distanceM});
 }
 /** With sourceOwnerId, atomically move stored EU from an accessible fixed
  * fixture into this mounted store. Omitting options preserves legacy pooling. */
 charge(id,componentId,type,amount,options={}){
  options??={};
  if(Object.prototype.hasOwnProperty.call(options,'sourceOwnerId'))return this._transferFixtureEnergy(id,componentId,type,amount,options.sourceOwnerId,'from_fixture');
  const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId),d=c&&this._entry(c.componentId);
  if(!d?.stores.includes(type)||!finite(amount)||amount<=0||c.energy[type]+amount>d.capacity+1e-8)return no('invalid_charge');
  const paid=this.progression.consumeEnergy(type,amount,{claimId:this._id('charge')});if(!paid.ok)return paid;
  c.energy[type]+=amount;m.metrics.generated+=amount;return ok({stored:amount});
 }
 /** Fire the explicit arc_thrower capability. The muzzle is derived from the
  * mounted host voxel and machine pose; callers cannot supply a free origin. */
 fire(id,componentId,{target,claimId}={}){
  const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId),d=c&&this._entry(c.componentId),combat=d?.combat;
  if(c?.componentId!=='arc_thrower'||!d.functions?.includes('projectile_attack')||!combat)return no('projectile_component_required');
  if(typeof claimId!=='string'||!claimId.length||claimId.length>512)return no('claim_required');
  const targetId=target?.id,kind=target?.kind;
  if(typeof targetId!=='string'||!targetId.length||targetId.length>512||typeof kind!=='string'||!pointOK(target?.point)||
    targetId===m.id||target?.ownerId===m.id||target?.excludeOwnerId===m.id)return no('invalid_target');
  const point=position(target.point);
  const signature=JSON.stringify({targetId,kind,point});
  let claimIndex=this.fireLedgerIndex.get(c);
  if(!claimIndex){claimIndex=new Map(c.fireLedger.map(row=>[row.claimId,row]));this.fireLedgerIndex.set(c,claimIndex);}
  const prior=claimIndex.get(claimId);
  if(prior){
   if(prior.signature!==signature)return no('claim_conflict');
   const cached=c.fireCache.find(row=>row.claimId===claimId);
   return cached?{...clone(cached.result),duplicate:true}:{ok:true,duplicate:true,expired:true,shotId:prior.shotId};
  }
  const health=this._condition(m,c);if(health<=0)return no('component_inactive');
  if(this.clock+1e-8<c.nextFireAt)return no('fire_cooldown');
  const voxel=m.voxels.find(v=>v.id===c.voxelId);if(!voxel)return no('host_missing');
  const local=voxel.cell.map(n=>(n+.5)*m.gridM);
  for(let i=0;i<3;i++)local[i]+=combat.muzzleOffsetM[i];
  const rotated=rotate({x:local[0],y:local[1],z:local[2]},m.rotation);
  const origin={x:m.position.x+rotated.x,y:m.position.y+rotated.y,z:m.position.z+rotated.z};
  const distanceM=Math.hypot(point.x-origin.x,point.y-origin.y,point.z-origin.z);
  if(distanceM>combat.rangeM+1e-8)return no('out_of_range');
  if(c.energy.electrical+1e-8<combat.energyPerShotEu)return no('insufficient_charge');
  const los=this.terrain?.hasLineOfSight?.(origin,point)??this.terrain?.lineOfSight?.(origin,point)??true;
  const shotId=`machine-shot:${m.id}:${componentId}:${c.shotsFired+1}`;
  c.energy.electrical=Math.max(0,c.energy.electrical-combat.energyPerShotEu);
  c.nextFireAt=this.clock+combat.attackPeriodS;c.shotsFired++;
  m.metrics.consumed+=combat.energyPerShotEu;
  const packet={
   amount:combat.damageHp,energyType:combat.energyType,energyEU:combat.energyPerShotEu,attackMode:combat.attackMode,
   sourceId:m.id,attackerPosition:origin,excludeOwnerId:m.id,rayOrigin:origin,
   targetId,targetKind:kind,targetPoint:point,distanceM,range:combat.rangeM,attackPeriod:combat.attackPeriodS,shotId,
  };
  const result={ok:true,duplicate:false,blocked:!los,shotId,packet};
  // Keep every compact claim receipt for exact retry protection, but only a
  // short tail of full packets. Old replays are acknowledged as expired and
  // never apply damage a second time.
  c.fireLedger.push({claimId,signature,shotId});
  claimIndex.set(claimId,c.fireLedger.at(-1));
  c.fireCache.push({claimId,result:clone(result)});
  if(c.fireCache.length>32)c.fireCache.splice(0,c.fireCache.length-32);
  return result;
 }
 fillFluid(id,componentId,fluid,liters){
  const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId),d=c&&this._entry(c.componentId);
  if(c?.componentId!=='fluid_container'||!d.fluidContents.includes(fluid)||!finite(liters)||liters<=0)return no('invalid_fluid');
  if(Object.entries(c.fluids).some(([f,n])=>f!==fluid&&n>0)||Object.values(c.fluids).reduce((a,b)=>a+b,0)+liters>d.capacityLiters)return no('container_capacity');
  const paid=this.progression.spend({[fluid]:liters},{claimId:this._id('fluid-fill')});if(!paid.ok)return paid;c.fluids[fluid]=(c.fluids[fluid]||0)+liters;return ok();
 }
 connectFluid(id,sourceId,pumpId,targetId){
  const m=this.machines.get(id),get=x=>m?.components.find(c=>c.id===x);if(sourceId===targetId||get(sourceId)?.componentId!=='fluid_container'||get(targetId)?.componentId!=='fluid_container'||get(pumpId)?.componentId!=='pump')return no('invalid_fluid_route');
  if(m.fluidLinks.some(l=>l.pump===pumpId))return no('pump_route_exists');m.fluidLinks.push({id:this._id('fluid-link'),source:sourceId,pump:pumpId,target:targetId});return ok();
 }
 setActive(id,componentId,active){const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId);if(!c||typeof active!=='boolean')return no('invalid_component');c.active=active;return ok();}
 control(id,command={}){
  const m=this.machines.get(id);if(!m)return no('unknown_machine');for(const k of ['throttle','steer','pitch','push'])if(command[k]!=null&&!finite(command[k]))return no('invalid_control');
  for(const k of ['throttle','steer','pitch','push'])m.command[k]=clamp(command[k]??m.command[k],-1,1);m.command.brake=command.brake??m.command.brake;
  // Rotors run while someone keeps steering (each fixed step) and spin down engagedS after the last command.
  this.commandClocks.set(id,this.clock);return ok();
 }
 /** Wrench anchor (frontier): an anchored machine is held fixed where it stands; driving it releases it. */
 setAnchored(id,anchored){const m=this.machines.get(id);if(!m)return no('unknown_machine');m.anchored=!!anchored;if(m.anchored){m.velocity={x:0,y:0,z:0};m.angularVelocity={x:0,y:0,z:0};}return ok({anchored:m.anchored});}
 loadCargo(id,items){const m=this.machines.get(id);if(!m||!this.progression.hasItems(items))return no('invalid_cargo');const paid=this.progression.spend(items,{claimId:this._id('cargo-load')});if(!paid.ok)return paid;for(const[k,n]of Object.entries(items))m.cargo[k]=(m.cargo[k]||0)+n;return ok();}
 unloadCargo(id,items){const m=this.machines.get(id);if(!m||!items||!Object.entries(items).every(([k,n])=>finite(n)&&n>0&&(m.cargo[k]||0)>=n))return no('invalid_cargo');const paid=this.progression.grant(items,{claimId:this._id('cargo-unload')});if(!paid.ok)return paid;for(const[k,n]of Object.entries(items)){m.cargo[k]-=n;if(!m.cargo[k])delete m.cargo[k];}return ok();}
 voxelProfile(id,voxelId){const v=this.machines.get(id)?.voxels.find(v=>v.id===voxelId);return v?(this.materialEffects?.profile(v)||this.progression.evaluateMaterial(v.materialId,{volumeLiters:v.volumeLiters})):null;}
 evaluate(id){
  const m=this.machines.get(id);if(!m)return null;
  const cells=m.voxels.map(v=>({x:(v.cell[0]+.5)*m.gridM,y:(v.cell[1]+.5)*m.gridM,z:(v.cell[2]+.5)*m.gridM,mass:v.massKg,size:m.gridM}));
  for(const c of m.components){const v=m.voxels.find(v=>v.id===c.voxelId);cells.push({x:(v.cell[0]+.5)*m.gridM,y:(v.cell[1]+.5)*m.gridM,z:(v.cell[2]+.5)*m.gridM,mass:c.massKg+c.fuelItems*.6+c.fuel/400*.6+Object.entries(c.fluids).reduce((s,[id,n])=>s+this._itemMass(id)*n,0),size:m.gridM});}
  cells.push({x:0,y:0,z:0,mass:Object.entries(m.cargo).reduce((s,[id,n])=>s+this._itemMass(id)*n,0),size:m.gridM});
  return {...massProperties(cells),entityType:'machine',voxels:m.voxels.length,components:m.components.length,powerEUPerSecond:m.lastPower};
 }
 _condition(m,c){const v=m.voxels.find(v=>v.id===c.voxelId);return c.active&&v?clamp(v.hp/v.maxHp,0,1):0;}
 _network(m,dt){
  const packets=new Map(),limits=new Map(),spent=new Map(),rotors=[],engaged=this.clock-(this.commandClocks.get(m.id)??-Infinity)<=ROTOR_FLIGHT.engagedS;let motive=0,lift=0;
  for(const c of m.components){const d=this._entry(c.componentId),health=this._condition(m,c),q=zero();packets.set(c.id,q);limits.set(c.id,d.nominalPower*health*dt);spent.set(c.id,0);
   // arc_thrower reserve is a paid projectile budget, not an idle network
   // output. It drains only through one recorded shot, while links may charge it.
   for(const t of ENERGY)if(d.stores.includes(t)&&c.componentId!=='arc_thrower'){const n=Math.min(c.energy[t],d.nominalPower*health*dt);c.energy[t]-=n;q[t]+=n;}
   if(c.componentId==='heat_engine'&&health>0){if(c.fuel<=1e-8&&c.fuelItems>0){c.fuelItems--;c.fuel=400;}const thermal=Math.min(c.fuel,20*health*dt);c.fuel-=thermal;q.mechanical+=thermal*d.efficiency;m.metrics.generated+=thermal;m.metrics.loss+=thermal*(1-d.efficiency);}
   if(c.componentId==='mana_condenser'&&health>0){q.magic+=2*health*dt;m.metrics.generated+=2*health*dt;}
   if(c.componentId==='relic'&&health>0){const n=Math.min(.1*health*dt,d.capacity-c.energy.divine);c.energy.divine+=n;m.metrics.generated+=n;}
  }
  // Bounded relaxation carries energy through a chain; per-component throughput is shared
  // across all passes, and every conversion debits its input before crediting output.
  for(let pass=0;pass<m.components.length+1;pass++){
   let moved=false;
   for(const c of m.components){const d=this._entry(c.componentId),q=packets.get(c.id);if(this._condition(m,c)<=0)continue;
    const conversion={motor:['electrical','mechanical'],generator:['mechanical','electrical'],transmission:['mechanical','mechanical']}[c.componentId];
    if(conversion&&c.componentId!=='transmission'){const input=Math.min(q[conversion[0]],Math.max(0,limits.get(c.id)-spent.get(c.id)));if(input>0){q[conversion[0]]-=input;q[conversion[1]]+=input*d.efficiency;spent.set(c.id,spent.get(c.id)+input);m.metrics.loss+=input*(1-d.efficiency);moved=true;}}
   }
   for(const link of m.links){const a=m.components.find(c=>c.id===link.from),b=m.components.find(c=>c.id===link.to);if(!a||!b||this._condition(m,a)<=0||this._condition(m,b)<=0)continue;
    const qa=packets.get(a.id),qb=packets.get(b.id),def=this._entry(a.componentId),recipient=this._entry(b.componentId);
    const outputLimit=Math.max(0,limits.get(a.id)-(a.sentEU||0));let n=Math.min(qa[link.type],outputLimit);if(n<=0)continue;
    if(recipient.stores.includes(link.type))n=Math.min(n,Math.max(0,(recipient.capacity-b.energy[link.type])/(recipient.efficiency||1)));
    qa[link.type]-=n;a.sentEU=(a.sentEU||0)+n;
    if(recipient.stores.includes(link.type)){b.energy[link.type]+=n*recipient.efficiency;m.metrics.loss+=n*(1-recipient.efficiency);}
    else qb[link.type]+=n;moved=true;
   }
   if(!moved)break;
  }
  for(const c of m.components){const d=this._entry(c.componentId),q=packets.get(c.id),health=this._condition(m,c);
   if(['wheel','propeller','rotor'].includes(c.legacyType)&&health>0){const rotor=c.legacyType==='rotor',n=Math.min(q.mechanical,d.nominalPower*health*dt)*(rotor?Number(engaged):Math.abs(m.command.throttle));q.mechanical-=n;const useful=n*d.efficiency;m.metrics.consumed+=useful;m.metrics.loss+=n-useful;if(rotor){lift+=useful/dt;if(useful>0)rotors.push({component:c,power:useful/dt});}else motive+=useful/dt;}
   if(c.componentId==='pump'&&health>0){const route=m.fluidLinks.find(l=>l.pump===c.id),source=m.components.find(x=>x.id===route?.source),target=m.components.find(x=>x.id===route?.target);if(source&&target){const fluid=Object.keys(source.fluids).find(k=>source.fluids[k]>0),targetDef=this._entry(target.componentId);if(fluid&&!Object.entries(target.fluids).some(([f,n])=>f!==fluid&&n>0)){const room=targetDef.capacityLiters-Object.values(target.fluids).reduce((a,b)=>a+b,0);const moved=Math.max(0,Math.min(source.fluids[fluid],room,d.flowLitersPerSecond*health*dt,q.mechanical/d.nominalPower));source.fluids[fluid]-=moved;target.fluids[fluid]=(target.fluids[fluid]||0)+moved;const consumed=moved*d.nominalPower;q.mechanical-=consumed;m.metrics.consumed+=consumed;}}}
   const propertyWork=this.materialEffects?.acceptMachineEnergy(m.id,c.id,q,dt)||{};for(const[t,n]of Object.entries(propertyWork)){q[t]-=n;m.metrics.consumed+=n;}
   for(const t of ENERGY){if(d.stores.includes(t)){const n=Math.min(q[t],Math.max(0,d.capacity-c.energy[t]));c.energy[t]+=n;q[t]-=n;}m.metrics.loss+=q[t];}
   delete c.sentEU;
  }
  m.lastPower=motive+lift;return {motive,lift,rotors};
 }
 _ground(x,z){return this.terrain?.heightAt?.(x,z)??this.terrain?.surface?.(x,z)??0;}
 _solid(x,y,z){if(this.terrain?.isSolidCell)return this.terrain.isSolidCell(Math.floor(x*2),Math.floor(y*2),Math.floor(z*2));return y<this._ground(x,z)-1e-6;}
 setPhysicsDriver(driver=null){this.physicsDriver=driver;return ok();}
 physicsMasses(id){
  const m=this.machines.get(id);if(!m)return null;const voxelMasses=Object.fromEntries(m.voxels.map(v=>[v.id,v.massKg]));
  for(const c of m.components)voxelMasses[c.voxelId]+=c.massKg+c.fuelItems*.6+c.fuel/400*.6+Object.entries(c.fluids).reduce((s,[id,n])=>s+this._itemMass(id)*n,0);
  return {voxelMasses,cargoMassKg:Object.entries(m.cargo).reduce((s,[id,n])=>s+this._itemMass(id)*n,0)};
 }
 acceptPhysicsState(id,state){
  const m=this.machines.get(id);if(!m||!state||!pointOK(state.position||{})||!pointOK(state.velocity||{})||!pointOK(state.angularVelocity||{})||!['x','y','z','w'].every(k=>finite(state.rotation?.[k])))return no('invalid_physics_state');
  const length=Math.hypot(...['x','y','z','w'].map(k=>state.rotation[k]));if(length<1e-9)return no('invalid_rotation');
  Object.assign(m.position,state.position);Object.assign(m.velocity,state.velocity);Object.assign(m.angularVelocity,state.angularVelocity);
  for(const k of ['x','y','z','w'])m.rotation[k]=state.rotation[k]/length;
  m.yaw=Math.atan2(2*(m.rotation.w*m.rotation.y+m.rotation.x*m.rotation.z),1-2*(m.rotation.y*m.rotation.y+m.rotation.x*m.rotation.x));return ok();
 }
 preparePhysicsStep(dt,{activeIds=null}={}){
  if(!finite(dt)||dt<=0||dt>.1)throw Error('Physics step must be in (0,0.1]');
  const active=activeIds?new Set(activeIds):null,packets=[];
  for(const m of this.machines.values())if(m.voxels.length&&(!active||active.has(m.id)))packets.push(this._physicsForces(m,dt));
  this.clock+=dt;return packets;
 }
 _physicsForces(m,dt){
  const output=this._network(m,dt),stats=this.evaluate(m.id),mass=Math.max(.01,stats.mass),cmd=m.command,q=m.rotation;
  const forward=rotate({x:0,y:0,z:1},q),up=rotate({x:0,y:1,z:0},q),speed=m.velocity.x*forward.x+m.velocity.y*forward.y+m.velocity.z*forward.z;
  const wheels=m.components.filter(c=>c.legacyType==='wheel'&&this._condition(m,c)>0).length;
  const controller=m.components.some(c=>c.componentId==='controller'&&this._condition(m,c)>0);
  // EU remains a channel-specific game unit. Only mechanical work is calibrated to SI.
  const thrust=clamp(output.motive*MACHINE_MOTION.joulesPerEU/Math.max(1,Math.abs(speed)),-mass*MACHINE_MOTION.maxAcceleration,mass*MACHINE_MOTION.maxAcceleration)*Math.sign(cmd.throttle);
  let pushForce=0;const manualEU=Math.abs(cmd.push)*.5*dt;
  if(manualEU>0&&this.progression.energyAvailable('mechanical')+1e-8>=manualEU){const paid=this.progression.consumeEnergy('mechanical',manualEU,{claimId:this._id('manual-work')});if(paid.ok){pushForce=Math.sign(cmd.push)*manualEU/dt*MACHINE_MOTION.joulesPerEU/Math.max(1,Math.abs(speed));m.metrics.generated+=manualEU;m.metrics.consumed+=manualEU;}}
  const flying=output.rotors.length>0,drag=cmd.brake?8:wheels?.35:flying?ROTOR_FLIGHT.airDrag:1.2,force={x:forward.x*(thrust+pushForce)-m.velocity.x*drag*mass,y:forward.y*(thrust+pushForce),z:forward.z*(thrust+pushForce)-m.velocity.z*drag*mass},torque={x:0,y:0,z:0};
  let forces=null;
  if(flying){
   // Rotor flight: each powered rotor can lift liftNPerEU per useful EU/s. Together they hold the climb rate the
   // pitch input asks for (up, hold, down). Each rotor pushes at its offset from the centre of all built rotors,
   // placed on the centre of mass: balanced rotors add no torque however the deck's weight sits, and a stopped
   // rotor tips the craft. A share of the lift pushes along the heading, steering yaws, and the rotors keep it level.
   const capacity=output.rotors.reduce((n,r)=>n+r.power,0)*ROTOR_FLIGHT.liftNPerEU,center=rotate({x:stats.center[0],y:stats.center[1],z:stats.center[2]},q);
   const lift=clamp(mass*(9.81+4*(ROTOR_FLIGHT.climbMS*cmd.pitch-m.velocity.y))/Math.max(.5,up.y),0,capacity),heading=Math.hypot(forward.x,forward.z)||1;
   const push=cmd.throttle*capacity*ROTOR_FLIGHT.forwardShare;force.x+=forward.x/heading*push;force.z+=forward.z/heading*push;
   const cellOf=c=>m.voxels.find(v=>v.id===c.voxelId)?.cell,built=m.components.filter(c=>c.legacyType==='rotor').map(cellOf).filter(Boolean),hub=[0,1,2].map(i=>built.reduce((n,cell)=>n+cell[i],0)/built.length);
   forces=[{force:null,point:{x:m.position.x+center.x,y:m.position.y+center.y,z:m.position.z+center.z}}];
   for(const r of output.rotors){
    const cell=cellOf(r.component),at=rotate({x:(cell[0]-hub[0])*m.gridM,y:(cell[1]-hub[1])*m.gridM,z:(cell[2]-hub[2])*m.gridM},q),share=lift*r.power*ROTOR_FLIGHT.liftNPerEU/capacity;
    const f={x:up.x*share,y:up.y*share,z:up.z*share};forces.push({force:f,point:{x:forces[0].point.x+at.x,y:forces[0].point.y+at.y,z:forces[0].point.z+at.z}});for(const k of ['x','y','z'])force[k]+=f[k];
   }
   torque.y+=cmd.steer*mass*1.5;
   torque.x+=(-up.z*8-m.angularVelocity.x*4)*stats.inertia[0];torque.z+=(up.x*8-m.angularVelocity.z*4)*stats.inertia[2];
  }
  const local=rotate(m.velocity,{x:-q.x,y:-q.y,z:-q.z,w:q.w});
  for(const c of m.components)if(['wing','elevator','rudder'].includes(c.legacyType)&&this._condition(m,c)>0){
   const v=m.voxels.find(v=>v.id===c.voxelId),r=rotate({x:(v.cell[0]+.5)*m.gridM-stats.center[0],y:(v.cell[1]+.5)*m.gridM-stats.center[1],z:(v.cell[2]+.5)*m.gridM-stats.center[2]},q);
   const f=panelForce(c.legacyType,{x:local.x,y:local.y,z:-local.z},this._condition(m,c),{pitch:controller?cmd.pitch:0,turn:controller?cmd.steer:0},r.x),ratio=m.gridM*m.gridM/.25,world=rotate({x:f.force.x*ratio,y:f.force.y*ratio,z:-f.force.z*ratio},q);
   for(const k of ['x','y','z'])force[k]+=world[k];torque.x+=r.y*world.z-r.z*world.y;torque.y+=r.z*world.x-r.x*world.z;torque.z+=r.x*world.y-r.y*world.x;
  }
  // Steering redirects powered traction; it cannot spin a stationary unpowered craft.
  if(controller&&wheels&&output.motive>0)torque.y+=cmd.steer*Math.min(Math.abs(thrust)*m.gridM,Math.abs(speed)*mass)*Math.sign(speed);
  // With rotors the physics bridge applies point forces: the rest of the force at the centre of mass.
  if(forces){const rest={...force};for(let i=1;i<forces.length;i++)for(const k of ['x','y','z'])rest[k]-=forces[i].force[k];forces[0].force=rest;return {id:m.id,force,forces,torque,mass};}
  return {id:m.id,force,torque,mass};
 }
 _step(m,dt){
  if(!m.voxels.length)return;
  const {force,torque,mass}=this._physicsForces(m,dt);
  for(const k of ['x','y','z'])m.velocity[k]+=force[k]/mass*dt;m.velocity.y-=9.81*dt;
  const stats=this.evaluate(m.id);m.angularVelocity.y+=torque.y/Math.max(.01,stats.inertia[1])*dt;m.angularVelocity.y*=Math.exp(-dt*3);m.yaw+=m.angularVelocity.y*dt;Object.assign(m.rotation,quaternion(m.yaw));
  const magnitude=Math.hypot(m.velocity.x,m.velocity.y,m.velocity.z);if(magnitude>MACHINE_MOTION.maxSpeed)for(const k of ['x','y','z'])m.velocity[k]*=MACHINE_MOTION.maxSpeed/magnitude;
  const before={...m.position},distance=Math.hypot(m.velocity.x,m.velocity.y,m.velocity.z)*dt,steps=Math.max(1,Math.ceil(distance/(m.gridM*.4)));
  for(let s=0;s<steps;s++){
   const next={x:m.position.x+m.velocity.x*dt/steps,y:m.position.y+m.velocity.y*dt/steps,z:m.position.z+m.velocity.z*dt/steps};
   const lowY=Math.min(...m.voxels.map(v=>v.cell[1]*m.gridM));const floor=this._ground(next.x,next.z)-lowY;
   if(next.y<floor){next.y=floor;m.velocity.y=Math.max(0,m.velocity.y);}
   let blocked=false;
   for(const v of m.voxels){const lx=(v.cell[0]+.5)*m.gridM,lz=(v.cell[2]+.5)*m.gridM;const wx=next.x+lx*Math.cos(m.yaw)+lz*Math.sin(m.yaw),wz=next.z-lx*Math.sin(m.yaw)+lz*Math.cos(m.yaw),wy=next.y+(v.cell[1]+.5)*m.gridM;if(this._solid(wx,wy,wz)){blocked=true;break;}}
   if(blocked){m.velocity.x=0;m.velocity.z=0;break;}Object.assign(m.position,next);
  }
 }
 tick(dt){if(!finite(dt)||dt<0||dt>60)return no('invalid_dt');if(this.physicsDriver)return ok({physicsDriven:true});let remaining=dt;while(remaining>1e-9){const step=Math.min(MACHINE_MOTION.physicsStep,remaining);for(const m of this.machines.values())this._step(m,step);this.clock+=step;remaining-=step;}return ok();}
 /** With destinationOwnerId, atomically move stored EU into an accessible fixed
  * fixture. Omitting options preserves the legacy personal-energy route. */
 drainEnergy(id,componentId,type,amount,options={}){
  options??={};
  if(Object.prototype.hasOwnProperty.call(options,'destinationOwnerId'))return this._transferFixtureEnergy(id,componentId,type,amount,options.destinationOwnerId,'to_fixture');
  const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId),d=c&&this._entry(c.componentId);
  if(!d?.stores.includes(type)||!finite(amount)||amount<=0||c.energy[type]+1e-8<amount)return no('invalid_energy_drain');
  const received=this.progression.supplyEnergy(type,amount,{claimId:this._id('machine-discharge')});if(!received.ok)return received;c.energy[type]=Math.max(0,c.energy[type]-amount);m.metrics.consumed+=amount;return ok({transferred:amount});
 }
 drainFluid(id,componentId,fluid,liters){
  const m=this.machines.get(id),c=m?.components.find(c=>c.id===componentId);if(c?.componentId!=='fluid_container'||!finite(liters)||liters<=0||(c.fluids[fluid]||0)+1e-8<liters)return no('invalid_fluid_drain');
  const given=this.progression.grant({[fluid]:liters},{claimId:this._id('machine-fluid-drain')});if(!given.ok)return given;c.fluids[fluid]=Math.max(0,c.fluids[fluid]-liters);return ok({liters});
 }
 applyDamageEvent(id,claimId,voxelAmounts,{energyType='mechanical'}={}){
  const m=this.machines.get(id);if(!m||typeof claimId!=='string'||!claimId.length||claimId.length>512)return no('invalid_damage_event');if(m.damageClaims.includes(claimId))return ok({duplicate:true});if(!voxelAmounts||!Object.entries(voxelAmounts).every(([id,n])=>m.voxels.some(v=>v.id===id)&&finite(n)&&n>0))return no('invalid_damage_event');
  if(!ENERGY.includes(energyType))return no('invalid_energy_type');if(m.damageClaims.includes(claimId))return ok({duplicate:true});m.damageClaims.push(claimId);
  // A hit can split the owner; resolve the remaining original voxel IDs across fragments.
  for(const [voxelId,n]of Object.entries(voxelAmounts)){const owner=[...this.machines.values()].find(x=>x.voxels.some(v=>v.id===voxelId));if(owner)this.damage(owner.id,voxelId,n,{energyType});}
  return ok({duplicate:false});
 }
 repair(id,voxelId){
  const m=this.machines.get(id),v=m?.voxels.find(v=>v.id===voxelId);if(!v)return no('unknown_voxel');
  const missing=1-v.hp/v.maxHp;if(missing<=1e-8)return no('already_intact');
  const amount=v.volumeLiters*missing,paid=this.progression.spend({[v.materialId]:amount},{claimId:this._id('machine-repair')});if(!paid.ok)return paid;
  v.hp=v.maxHp;return ok({restoredHp:v.maxHp*missing,materialCost:{[v.materialId]:amount}});
 }
 damage(id,voxelId,amount,{energyType='mechanical'}={}){
  const m=this.machines.get(id),v=m?.voxels.find(v=>v.id===voxelId);if(!v||!finite(amount)||amount<=0||!ENERGY.includes(energyType))return no('invalid_damage');if(this.materialEffects)amount=this.materialEffects.resolveDamage(v,amount,energyType).amount;v.hp=Math.max(0,v.hp-amount);m.revision++;
  for(const c of m.components.filter(c=>c.voxelId===voxelId)){const def=this._entry(c.componentId);for(const t of ENERGY){const maximum=def.stores.includes(t)?def.capacity*(v.hp/v.maxHp):0;const loss=Math.max(0,c.energy[t]-maximum);c.energy[t]-=loss;m.metrics.loss+=loss;}}
  if(!v.hp){const oldCenter=this.evaluate(m.id).center;const builder=new VoxelAssetBuilder(m.asset);builder.removeBox('root',{center:v.cell.map(n=>(n+.5)*m.gridM),size:[m.gridM,m.gridM,m.gridM]});m.asset=builder.toJSON();m.voxels=m.voxels.filter(x=>x!==v);m.components=m.components.filter(c=>c.voxelId!==v.id);this._trimLinks(m);this._split(m,oldCenter);this._rebuild(m);}return ok({destroyed:v.hp===0});
 }
 _trimLinks(m){const ids=new Set(m.components.map(c=>c.id));m.links=m.links.filter(l=>ids.has(l.from)&&ids.has(l.to));m.fluidLinks=m.fluidLinks.filter(l=>ids.has(l.source)&&ids.has(l.pump)&&ids.has(l.target));}
 _split(m,oldCenter=null){const groups=connectedGroups(m.voxels.map(v=>({...v,x:v.cell[0],y:v.cell[1],z:v.cell[2]})));if(groups.length<2)return;
  const originalCenter=oldCenter||this.evaluate(m.id).center,originalVelocity={...m.velocity},originalMetrics={...m.metrics},originalMass=this.evaluate(m.id).mass,parts=[m];
  const keep=new Set(groups[0].map(v=>v.id));const originalComponents=m.components,originalLinks=m.links,originalFluids=m.fluidLinks;
  for(const group of groups.slice(1)){const ids=new Set(group.map(v=>v.id)),fragment=clone({...m,asset:undefined});fragment.id=this._id('machine');fragment.name=m.name+' 조각';fragment.voxels=m.voxels.filter(v=>ids.has(v.id));fragment.components=originalComponents.filter(c=>ids.has(c.voxelId));fragment.links=clone(originalLinks);fragment.fluidLinks=clone(originalFluids);fragment.cargo={};fragment.command={throttle:0,steer:0,pitch:0,brake:false,push:0};this._trimLinks(fragment);this._rebuild(fragment);this.machines.set(fragment.id,fragment);parts.push(fragment);}
  m.voxels=m.voxels.filter(v=>keep.has(v.id));m.components=originalComponents.filter(c=>keep.has(c.voxelId));this._trimLinks(m);
  for(const fragment of parts){const stat=this.evaluate(fragment.id),r=rotate({x:stat.center[0]-originalCenter[0],y:stat.center[1]-originalCenter[1],z:stat.center[2]-originalCenter[2]},m.rotation),w=m.angularVelocity;
   Object.assign(fragment.velocity,{x:originalVelocity.x+w.y*r.z-w.z*r.y,y:originalVelocity.y+w.z*r.x-w.x*r.z,z:originalVelocity.z+w.x*r.y-w.y*r.x});
   for(const k of ['generated','consumed','loss'])fragment.metrics[k]=originalMetrics[k]*stat.mass/originalMass;
  }
 }
 _rebuild(m){
  const materialIds=[...new Set(m.voxels.map(v=>v.materialId))],base={schemaVersion:1,id:m.id,name:m.name,category:'machine',status:'runtime_player_assembly',units:'m',upAxis:'Y',forwardAxis:'+Z',visualGridM:m.gridM,materials:materialIds.map(id=>({id,color:color(id),roughness:.85,metallic:id.includes('wood')||id==='stone'?0:.65,emission:0,opacity:1,collision:true})),parts:[{id:'root',parent:null,translation:[0,0,0],role:'root',boxes:[]}],anchors:[],instances:[],notes:['Player machine; functions come only from explicitly installed components.']};
  const builder=new VoxelAssetBuilder(base);for(const v of m.voxels)builder.addBox('root',{center:v.cell.map(n=>(n+.5)*m.gridM),size:[m.gridM,m.gridM,m.gridM],material:v.materialId});m.asset=builder.toJSON();m.asset.anchors=m.components.map(c=>{const v=m.voxels.find(v=>v.id===c.voxelId);return{id:c.id,partId:'root',position:v.cell.map(n=>(n+.5)*m.gridM),purpose:`Explicit ${c.componentId} mount; ${c.legacyType||'catalog ports'}`};});
 }
 sceneModels(){return [...this.machines.values()].filter(m=>m.voxels.length).map(m=>({id:m.id,ownerId:m.id,kind:'machine',entityType:'machine',model:m.asset,asset:m.asset,position:m.position,velocity:m.velocity,rotation:m.rotation,angularVelocity:m.angularVelocity,yaw:m.yaw,revision:m.revision,components:m.components.map(c=>({id:c.id,componentId:c.componentId,legacyType:c.legacyType,voxelId:c.voxelId,position:m.voxels.find(v=>v.id===c.voxelId).cell.map(n=>(n+.5)*m.gridM)})),mass:this.evaluate(m.id).mass}));}
 serialize(){return {schemaVersion:1,nextId:this.nextId,clock:this.clock,machines:[...this.machines.values()].map(m=>{const s=clone(m);delete s.asset;return s;})};}
 _validate(m){
  m.rotation??=quaternion(m.yaw);m.angularVelocity??={x:0,y:0,z:0};m.damageClaims??=[];
  if(m.anchored!=null&&typeof m.anchored!=='boolean')throw Error('Invalid machine anchor');
  if(!pointOK(m.angularVelocity)||!['x','y','z','w'].every(k=>finite(m.rotation[k]))||Math.abs(Math.hypot(...Object.values(m.rotation))-1)>1e-5||!Array.isArray(m.damageClaims)||m.damageClaims.some(id=>typeof id!=='string'||id.length>512))throw Error('Invalid machine physics state');
  if(typeof m.id!=='string'||m.entityType!=='machine'||![.03125,.1,.5].includes(m.gridM)||!pointOK(m.position)||!pointOK(m.velocity)||!finite(m.yaw)||!Array.isArray(m.voxels)||m.voxels.length>2048||!Array.isArray(m.components)||!Array.isArray(m.links))throw Error('Invalid machine state');
  const ids=new Set(),cells=new Set();for(const v of m.voxels){if(v.materialEffects&&(!Array.isArray(v.materialEffects)||new Set(v.materialEffects).size!==v.materialEffects.length||v.materialEffects.some(id=>!MATERIAL_EFFECT_RULES[id])))throw Error('Invalid material effects');if(ids.has(v.id)||cells.has(cellKey(v.cell))||!v.cell.every(Number.isInteger)||this._entry(v.materialId)?.kind!=='material'||!finite(v.hp)||v.hp<=0||!finite(v.maxHp)||v.maxHp<=0||v.hp>v.maxHp||!finite(v.massKg)||v.massKg<=0||!finite(v.volumeLiters)||Math.abs(v.volumeLiters-m.gridM**3*1000)>1e-6)throw Error('Invalid machine voxel');ids.add(v.id);cells.add(cellKey(v.cell));}
  const compIds=new Set();for(const c of m.components){const d=this._entry(c.componentId);if(c.componentId==='arc_thrower'){c.nextFireAt??=0;c.shotsFired??=0;c.fireLedger??=[];c.fireCache??=[];}if(compIds.has(c.id)||!ids.has(c.voxelId)||d?.kind!=='component'||(c.legacyType&&!MACHINE_VARIANTS[c.componentId].includes(c.legacyType))||!finite(c.fuel)||c.fuel<0||c.fuel>400||!Number.isInteger(c.fuelItems)||c.fuelItems<0)throw Error('Invalid mounted component');compIds.add(c.id);for(const t of ENERGY)if(!finite(c.energy?.[t])||c.energy[t]<0||c.energy[t]>(d.stores.includes(t)?d.capacity:0))throw Error('Invalid component energy');if(c.componentId==='arc_thrower'&&(!finite(c.nextFireAt)||!Number.isSafeInteger(c.shotsFired)||c.shotsFired<0||!Array.isArray(c.fireLedger)||!Array.isArray(c.fireCache)||c.fireCache.length>32))throw Error('Invalid projectile ledger');if(c.componentId==='arc_thrower'){const claims=new Set();for(const row of c.fireLedger){if(!row||typeof row.claimId!=='string'||!row.claimId.length||row.claimId.length>512||claims.has(row.claimId)||typeof row.signature!=='string'||row.signature.length>2048||!/^machine-shot:.+/.test(row.shotId||''))throw Error('Invalid projectile ledger entry');claims.add(row.claimId);}const cached=new Set();for(const row of c.fireCache){if(!row||!claims.has(row.claimId)||cached.has(row.claimId)||!row.result?.packet||row.result.packet.shotId!==row.result.shotId)throw Error('Invalid projectile result cache');cached.add(row.claimId);}this.fireLedgerIndex.set(c,new Map(c.fireLedger.map(row=>[row.claimId,row])));}}
  for(const l of m.links){const from=m.components.find(c=>c.id===l.from),to=m.components.find(c=>c.id===l.to);if(!from||!to||from===to||!this._entry(from.componentId).outputEnergies.includes(l.type)||!this._entry(to.componentId).inputEnergies.includes(l.type))throw Error('Invalid machine link');}
  for(const c of m.components)for(const [f,q]of Object.entries(c.fluids))if(c.componentId!=='fluid_container'||!this._entry(c.componentId).fluidContents.includes(f)||!finite(q)||q<0||q>10)throw Error('Invalid stored fluid');
  if(!m.command||!['throttle','steer','pitch','push'].every(k=>finite(m.command[k])&&Math.abs(m.command[k])<=1))throw Error('Invalid machine control');
  for(const [k,q]of Object.entries(m.cargo||{}))if(!this.progression.items.has(k)||!finite(q)||q<0)throw Error('Invalid cargo');
  const identifiers=[m.id,...m.voxels.map(v=>v.id),...m.components.map(c=>c.id),...m.links.map(l=>l.id),...(m.fluidLinks||[]).map(l=>l.id)];
  if(identifiers.some(id=>!/:\d+$/.test(id)||Number(id.split(':').at(-1))>=this.nextId))throw Error('Invalid machine sequence');
 }
}
export default MachineSystem;
