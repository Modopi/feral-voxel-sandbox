import { loadAsset } from './assets.generated.js';
import { flattenAsset, boundsOf } from './voxel/model.mjs';
import { assertAuthoringInvariant } from './voxel/authoring.mjs';

const EPS=1e-7,GRID=.03125,ACCESS_M=4,MAX_FIXTURES=256;
const clone=x=>structuredClone(x),ok=x=>({ok:true,...x}),no=reason=>({ok:false,reason});
const vec=p=>Array.isArray(p)?p.slice(0,3):[p?.x,p?.y,p?.z];
const valid=p=>p.length===3&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e9);
const xyz=p=>({x:p[0],y:p[1],z:p[2]});
const IDENTITY={x:0,y:0,z:0,w:1};
const rotate=(v,q=IDENTITY)=>{const t=[2*(q.y*v[2]-q.z*v[1]),2*(q.z*v[0]-q.x*v[2]),2*(q.x*v[1]-q.y*v[0])];return [v[0]+q.w*t[0]+q.y*t[2]-q.z*t[1],v[1]+q.w*t[1]+q.z*t[0]-q.x*t[2],v[2]+q.w*t[2]+q.x*t[1]-q.y*t[0]];};
const unrotate=(v,q=IDENTITY)=>rotate(v,{x:-q.x,y:-q.y,z:-q.z,w:q.w});
const axes=b=>[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate(v,b.rotation));
const boxBounds=b=>{const a=axes(b),half=[0,1,2].map(i=>a.reduce((n,v,j)=>n+Math.abs(v[i])*b.size[j]/2,0));return {min:b.center.map((n,i)=>n-half[i]),max:b.center.map((n,i)=>n+half[i])};};
const inBox=(b,p)=>unrotate(p.map((n,i)=>n-b.center[i]),b.rotation).every((n,i)=>n>=-b.size[i]/2&&n<b.size[i]/2);
const dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
function boxesIntersect(a,b){if(!overlap(boxBounds(a),boxBounds(b)))return false;const A=axes(a),B=axes(b),d=b.center.map((n,i)=>n-a.center[i]);const directions=[...A,...B];for(const u of A)for(const v of B)directions.push([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]);return directions.every(axis=>{if(dot(axis,axis)<1e-12)return true;const reach=A.reduce((n,u,i)=>n+Math.abs(dot(u,axis))*a.size[i]/2,0)+B.reduce((n,u,i)=>n+Math.abs(dot(u,axis))*b.size[i]/2,0);return Math.abs(dot(d,axis))<reach-EPS;});}
function motionState(value){const m=value??{mode:'fixed',rotation:{...IDENTITY},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0},settled:false};if(!['fixed','dynamic'].includes(m.mode)||!m.rotation||!['x','y','z','w'].every(k=>Number.isFinite(m.rotation[k]))||Math.abs(Math.hypot(m.rotation.x,m.rotation.y,m.rotation.z,m.rotation.w)-1)>1e-5||!valid(vec(m.velocity))||!valid(vec(m.angularVelocity))||typeof m.settled!=='boolean')throw Error('Invalid fixture motion');return clone(m);}

const overlap=(a,b)=>a.min.every((n,i)=>n<b.max[i]-EPS&&a.max[i]>b.min[i]+EPS);
const contains=(b,p)=>p.every((n,i)=>n>=b.min[i]&&n<b.max[i]);
const delta=(p,q)=>Math.hypot(...p.map((n,i)=>n-q[i]));

/** Fixed player-made machines. Ledger owns world position and health;
 * Progression receives only validated aggregates, never phantom global installs. */
export class WorldPlacements {
  constructor(content,progression,{atlas=null,dungeons=null,assets=null,state=null,externalBoxes=null,externalOverlap=null}={}) {
    this.content=content;this.progression=progression;this.atlas=atlas;this.dungeons=dungeons;this.assets=assets;this.externalBoxes=externalBoxes;this.externalOverlap=externalOverlap;
    this.catalog=new Map(content.progression.entries.map(e=>[e.id,e]));this.records=new Map();this.models=new Map();this.loading=new Map();this.geometryCache=new WeakMap();
    this.nextId=state?.nextId??1;this._syncKey=null;this._lastSyncRevision=-1;this._lastAccessKey=null;this.accessPosition=null;this.communityStations=[];this.revision=state?.revision??0;
    if(state&&(state.schemaVersion!==1||!Array.isArray(state.fixtures)))throw Error('Unsupported fixture save');
    if(!Number.isSafeInteger(this.nextId)||this.nextId<1||!Number.isSafeInteger(this.revision)||this.revision<0)throw Error('Invalid fixture counters');
    for(const source of state?.fixtures??[]){const r=clone(source),e=this.catalog.get(r.assetId);r.motion=motionState(r.motion);
      if(!e||!['station','component'].includes(e.kind)||r.kind!==e.kind||r.entityType!=='machine'||typeof r.id!=='string'||!/^fixture:\d+$/.test(r.id)||this.records.has(r.id)||!valid(r.position)||(r.motion.mode==='fixed'&&r.position.some(n=>Math.abs(n/GRID-Math.round(n/GRID))>EPS))||!Number.isFinite(r.hp)||r.hp<0||r.hp>r.maxHp||r.maxHp!==this._maxHp(e)||!Number.isSafeInteger(r.revision)||r.revision<0)throw Error('Invalid saved fixture');
      if(Number(r.id.split(':')[1])>=this.nextId)throw Error('Fixture id counter would repeat');
      this.records.set(r.id,r);
    }
    if(this.records.size>MAX_FIXTURES)throw Error('Fixture save exceeds world budget');
    this.ready=Promise.all([...new Set([...this.records.values()].map(r=>r.assetId))].map(id=>this._model(id))).then(()=>{this._sync();return this;});
  }
  _maxHp(entry){const recipe=this.catalog.get(entry.origin?.recipe);let strength=0;
    for(const [id,n] of Object.entries(recipe?.inputs??{})){const m=this.catalog.get(id);strength+=n*(m?.properties?.cellHp??25)/4;}
    return Math.max(25,Math.min(5000,Math.ceil(strength)));
  }
  async _model(id){
    if(this.models.has(id))return this.models.get(id);if(this.loading.has(id))return this.loading.get(id);
    const promise=(async()=>{let asset=typeof this.assets==='function'?await this.assets(id):this.assets instanceof Map?this.assets.get(id):this.assets?.[id];asset??=await loadAsset(id);
      if(asset.id!==id||asset.category!=='equipment'||asset.instances?.length)throw Error('Invalid fixed equipment asset');assertAuthoringInvariant(asset);
      const materials=new Map(asset.materials.map(m=>[m.id,m]));
      const boxes=flattenAsset(asset,new Map()).filter(b=>materials.get(b.material)?.collision!==false&&b.collision!==false);
      if(!boxes.length)throw Error('Equipment has no solid geometry');const bounds=boundsOf(boxes);
      if(Math.max(...bounds.size)>32||boxes.length>10000)throw Error('Fixture geometry exceeds budget');
      const bottoms=boxes.filter(b=>Math.abs(b.center[1]-b.size[1]/2-bounds.min[1])<EPS);
      const model={asset,boxes,bounds,bottoms};this.models.set(id,model);return model;})();this.loading.set(id,promise);
    try{return await promise;}finally{this.loading.delete(id);}
  }
  _geometry(record){const model=this.models.get(record.assetId),q=record.motion?.rotation??IDENTITY,p=record.position,old=this.geometryCache.get(record);if(old&&old.model===model&&old.x===p[0]&&old.y===p[1]&&old.z===p[2]&&old.qx===q.x&&old.qy===q.y&&old.qz===q.z&&old.qw===q.w)return old;
    const boxes=(model?.boxes??[]).map(b=>({...b,center:rotate(b.center,q).map((n,i)=>n+p[i]),rotation:{...q},ownerId:record.id}));
    const bounds=model?boxBounds({center:rotate(model.bounds.center,q).map((n,i)=>n+p[i]),size:model.bounds.size,rotation:q}):{min:[...p],max:[...p]};const value={model,boxes,bounds,x:p[0],y:p[1],z:p[2],qx:q.x,qy:q.y,qz:q.z,qw:q.w};this.geometryCache.set(record,value);return value;
  }
  _boxes(record){return this._geometry(record).boxes;}
  _sync(){
    const accessibleOwnerIds=[];if(this.accessPosition)for(const r of this.records.values())if(r.hp>0&&r.motion.mode==='fixed'&&this._distanceTo(r,this.accessPosition)<=ACCESS_M)accessibleOwnerIds.push(r.id);
    const accessKey=JSON.stringify([accessibleOwnerIds,this.communityStations]);if(this._lastSyncRevision===this.revision&&this._lastAccessKey===accessKey)return;
    const records=[...this.records.values()].map(r=>({ownerId:r.id,assetId:r.assetId,kind:r.kind,health:r.hp,maxHealth:r.maxHp,active:r.hp>0&&r.motion.mode==='fixed',position:xyz(r.position),rotation:{...r.motion.rotation}}));
    if(typeof this.progression.syncWorldFixtures!=='function')throw Error('Progression.syncWorldFixtures must be connected before world placement');
    const result=this.progression.syncWorldFixtures(records,{accessibleOwnerIds,communityStations:this.communityStations});if(result?.ok===false)throw Error('Invalid fixture synchronization: '+result.reason);
    this._lastSyncRevision=this.revision;this._lastAccessKey=accessKey;
  }
  _distanceTo(record,p){const b=this._geometry(record).bounds;const x=Math.max(b.min[0]-p[0],0,p[0]-b.max[0]),y=Math.max(b.min[1]-p[1],0,p[1]-b.max[1]),z=Math.max(b.min[2]-p[2],0,p[2]-b.max[2]);return Math.hypot(x,y,z);}
  syncAccess(position,{communityStations=[]}={}){
    const p=vec(position);if(!valid(p)||!Array.isArray(communityStations))return no('invalid_access_context');
    const stations=[...new Set(communityStations)].filter(id=>this.catalog.get(id)?.kind==='station');
    const changed=!this.accessPosition||p.some((n,i)=>n!==this.accessPosition[i])||JSON.stringify(stations)!==JSON.stringify(this.communityStations);
    this.accessPosition=p;this.communityStations=stations;if(changed||this._lastSyncRevision!==this.revision)this._sync();return ok();
  }
  _reachable(r,actorPosition){return !actorPosition||valid(vec(actorPosition))&&this._distanceTo(r,vec(actorPosition))<=ACCESS_M;}
  _terrainOverlap(b){if(!this.atlas?.isSolidCell)return false;const a=boxBounds(b);
    for(let x=Math.floor((a.min[0]+EPS)*2);x<=Math.floor((a.max[0]-EPS)*2);x++)for(let y=Math.floor((a.min[1]+EPS)*2);y<=Math.floor((a.max[1]-EPS)*2);y++)for(let z=Math.floor((a.min[2]+EPS)*2);z<=Math.floor((a.max[2]-EPS)*2);z++)if(this.atlas.isSolidCell(x,y,z))return true;
    return false;
  }
  _structureBoxes(bounds){if(!this.dungeons?.instancesNear)return [];
    const center=bounds.min.map((n,i)=>(n+bounds.max[i])/2),radius=Math.hypot(bounds.max[0]-bounds.min[0],bounds.max[2]-bounds.min[2])/2;
    const boxes=[];for(const r of this.dungeons.instancesNear(center,radius)){
      if(!this.dungeons.hasAssetModel(r.templateId))throw Error('Structure collision model is not loaded');
      boxes.push(...this.dungeons.renderBoxes(r.id,{bounds}).filter(b=>b.collision!==false));
    }return boxes;
  }
  solidAt(position,{ignoreOwnerId=null,stableOnly=false}={}){if(!this.records.size)return null;const p=vec(position);if(!valid(p))return null;
    for(const r of this.records.values()){if(r.id===ignoreOwnerId||stableOnly&&(r.motion.mode!=='fixed'||r.hp<=0))continue;const m=this.models.get(r.assetId);if(!m)continue;
      if(!contains(this._geometry(r).bounds,p))continue;const local=unrotate(p.map((n,i)=>n-r.position[i]),r.motion.rotation);if(!contains(m.bounds,local))continue;
      for(const b of m.boxes)if(contains(boxBounds(b),local))return {id:r.id,ownerId:r.id,kind:'fixture',assetId:r.assetId,partId:b.partId,hp:r.hp,maxHp:r.maxHp};
    }return null;
  }
  collisionBoxes(bounds=null,{fixedOnly=false}={}){const result=[];for(const r of this.records.values()){if(fixedOnly&&r.motion.mode!=='fixed')continue;for(const b of this._boxes(r))if(!bounds||overlap(boxBounds(b),bounds))result.push(b);}return result;}
  _check(record){const boxes=this._boxes(record),bounds=boundsOf(boxes);
    const structure=this._structureBoxes(bounds),others=[...this.collisionBoxes(bounds),...(this.externalBoxes?.(bounds)??[])].filter(b=>b.ownerId!==record.id);
    for(const box of boxes){if(this._terrainOverlap(box))return no('terrain_occupied');if(this.externalOverlap?.(box,{ignoreOwnerId:record.id}))return no('external_occupied');const b=boxBounds(box);if(structure.some(s=>boxesIntersect(box,s)))return no('structure_occupied');if(others.some(s=>s.collision!==false&&boxesIntersect(box,s)))return no('fixture_occupied');}
    const bottoms=boxes.filter(b=>Math.abs(b.center[1]-b.size[1]/2-bounds.min[1])<EPS);
    for(const b of bottoms){const p=[b.center[0],bounds.min[1]-.01,b.center[2]];
      const supported=this.atlas?.isSolidCell?.(...p.map(n=>Math.floor(n*2)))||this.dungeons?.solidAt?.(p)||this.solidAt(p,{stableOnly:true})||others.some(o=>!this.records.has(o.ownerId)&&inBox(o,p));
      if(!supported)return no('support_required');
    }return ok();
  }
  async place(assetId,position,{actorPosition=null}={}){
    await this.ready;const entry=this.catalog.get(assetId),p=vec(position);
    if(!entry||!['station','component'].includes(entry.kind)||!valid(p))return no('invalid_fixture');
    if(this.records.size>=MAX_FIXTURES)return no('fixture_limit');
    if(entry.kind==='component'&&!this.progression.research.has(entry.research))return no('research_required');
    try{await this._model(assetId);}catch(error){return no('asset_unavailable');}
    // A different model can finish loading while another placement fills the last slot.
    if(this.records.size>=MAX_FIXTURES)return no('fixture_limit');
    const record={id:`fixture:${this.nextId}`,assetId,kind:entry.kind,entityType:'machine',position:p.map(n=>Math.round(n/GRID)*GRID),maxHp:this._maxHp(entry),revision:0,motion:motionState()};record.hp=record.maxHp;
    if(!this._reachable(record,actorPosition))return no('out_of_range');
    let space;try{space=this._check(record);}catch{return no('collision_unavailable');}if(!space.ok)return space;
    // All awaits and geometry checks finish before this synchronous atomic commit.
    const paid=this.progression.spend({[assetId]:1},{claimId:`place:${record.id}`});if(!paid.ok)return paid;if(paid.duplicate)return no('placement_claim_conflict');
    this.nextId++;this.records.set(record.id,record);this.revision++;this._sync();return ok({id:record.id,ownerId:record.id,position:xyz(record.position),entityType:'machine'});
  }
  damage(id,amount){const r=this.records.get(id);if(!r||!Number.isFinite(amount)||amount<=0)return no('invalid_fixture_damage');
    r.hp=Math.max(0,r.hp-amount);r.revision++;this.revision++;this._sync();return ok({hp:r.hp,maxHp:r.maxHp,broken:r.hp===0});
  }
  repairQuote(id){const r=this.records.get(id);if(!r)return no('unknown_fixture');const fraction=1-r.hp/r.maxHp,entry=this.catalog.get(r.assetId),recipe=this.catalog.get(entry.origin.recipe),items={};
    if(fraction<=EPS)return ok({items,hp:0});
    for(const [item,n]of Object.entries(recipe.inputs)){const precision=this.catalog.get(item)?.kind==='material'?1000:1;const cost=Math.ceil(n*fraction*.25*precision)/precision;if(cost>0)items[item]=cost;}
    return ok({items,hp:r.maxHp-r.hp});
  }
  repair(id,{actorPosition=null}={}){const r=this.records.get(id);if(!r)return no('unknown_fixture');if(!this._reachable(r,actorPosition))return no('out_of_range');const quote=this.repairQuote(id);if(!quote.hp)return ok({duplicate:true});
    const paid=this.progression.spend(quote.items,{claimId:`repair:${id}:${r.revision}`});if(!paid.ok)return paid;if(paid.duplicate)return no('repair_claim_conflict');
    r.hp=r.maxHp;r.revision++;this.revision++;this._sync();return ok({hp:r.hp,items:quote.items});
  }
  dismantle(id,{actorPosition=null}={}){const r=this.records.get(id);if(!r)return no('unknown_fixture');if(!this._reachable(r,actorPosition))return no('out_of_range');
    for(const other of this.records.values())if(other.id!==id&&other.motion.mode==='fixed'){const boxes=this._boxes(other),bottom=boundsOf(boxes).min[1];
      for(const b of boxes)if(Math.abs(b.center[1]-b.size[1]/2-bottom)<EPS){const p=[b.center[0],bottom-.01,b.center[2]];
        if(this.solidAt(p)?.ownerId===id&&!this.atlas?.isSolidCell?.(...p.map(n=>Math.floor(n*2)))&&!this.dungeons?.solidAt?.(p)&&!this.solidAt(p,{ignoreOwnerId:id}))return no('supporting_fixture');
      }
    }
    const items={};if(r.hp===r.maxHp)items[r.assetId]=1;else {const recipe=this.catalog.get(this.catalog.get(r.assetId).origin.recipe);for(const [item,n]of Object.entries(recipe.inputs)){const precision=this.catalog.get(item)?.kind==='material'?1000:1;const salvage=Math.floor(n*(r.hp/r.maxHp)*.5*precision)/precision;if(salvage>0)items[item]=salvage;}}
    const granted=this.progression.grant(items,{claimId:`dismantle:${id}`});if(!granted.ok)return granted;if(granted.duplicate)return no('dismantle_claim_conflict');
    this.records.delete(id);this.revision++;this._sync();return ok({items});
  }
  _makeDynamic(record,reason){if(record.motion.mode==='dynamic')return false;record.motion={mode:'dynamic',rotation:{...record.motion.rotation},velocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0},settled:false,reason};record.revision++;this.revision++;return true;}
  isDynamic(id){return this.records.get(id)?.motion.mode==='dynamic';}
  checkSupports(){let changed=false;const transitioned=[];
    // Revisit stacks in the same call so a lost base cannot keep upper machines anchored.
    for(let pass=0;pass<this.records.size;pass++){let again=false;for(const r of this.records.values()){
      if(r.motion.mode!=='fixed')continue;const model=this.models.get(r.assetId),low=r.position[1]+model.bounds.min[1];
      const supported=model.bottoms.every(b=>{const point=rotate(b.center,r.motion.rotation);const p=[point[0]+r.position[0],low-.01,point[2]+r.position[2]];return this.atlas?.isSolidCell?.(...p.map(n=>Math.floor(n*2)))||this.dungeons?.solidAt?.(p)||this.solidAt(p,{ignoreOwnerId:r.id,stableOnly:true});});
      if(!supported||r.hp<=0){this._makeDynamic(r,r.hp<=0?'destroyed':'support_lost');transitioned.push(r.id);changed=again=true;}
    }if(!again)break;}
    if(changed)this._sync();return transitioned;
  }
  _mass(assetId){const recipe=this.catalog.get(this.catalog.get(assetId).origin.recipe);const mass=Object.entries(recipe.inputs).reduce((sum,[id,n])=>{const e=this.catalog.get(id),unit=e.properties?.densityKgM3/1000||e.massKgPerUnit;if(!Number.isFinite(unit)||unit<=0)throw Error('Missing authored fixture material mass: '+id);return sum+n*unit;},0);if(!(mass>0))throw Error('Invalid fixture mass');return mass;}
  physicsBodies(){return [...this.records.values()].filter(r=>r.motion.mode==='dynamic').map(r=>{const model=this.models.get(r.assetId),massKg=this._mass(r.assetId),volume=model.boxes.reduce((s,b)=>s+b.size.reduce((a,n)=>a*n,1),0);return {id:r.id,assetId:r.assetId,position:xyz(r.position),rotation:{...r.motion.rotation},velocity:{...r.motion.velocity},angularVelocity:{...r.motion.angularVelocity},settled:r.motion.settled,massKg,hp:r.hp,maxHp:r.maxHp,boxes:model.boxes.map(b=>({...b,massKg:massKg*b.size.reduce((a,n)=>a*n,1)/volume}))};});}
  setPhysicsPose(id,pose){const r=this.records.get(id);if(!r||r.motion.mode!=='dynamic')return no('not_dynamic_fixture');const position=vec(pose.position);if(!valid(position))return no('invalid_fixture_pose');let motion;try{motion=motionState({...r.motion,rotation:pose.rotation,velocity:pose.velocity,angularVelocity:pose.angularVelocity,settled:Boolean(pose.settled)});}catch{return no('invalid_fixture_pose');}
    const moved=delta(position,r.position)>1e-6||Object.keys(motion.rotation).some(k=>Math.abs(motion.rotation[k]-r.motion.rotation[k])>1e-6);r.position=position;r.motion=motion;if(moved){r.revision++;this.revision++;}return ok();
  }
  descriptors(){return [...this.records.values()].map(r=>({id:r.id,ownerId:r.id,assetId:r.assetId,kind:'fixture',entityType:'machine',fixed:r.motion.mode==='fixed',rotation:{...r.motion.rotation},position:xyz(r.position),revision:r.revision,hp:r.hp,maxHp:r.maxHp,broken:r.hp===0}));}
  serialize(){return {schemaVersion:1,nextId:this.nextId,revision:this.revision,fixtures:[...this.records.values()].map(clone)};}
}
