// Fixed-world energy is owner-local. No distance-based implicit pooling.
// Cable lengths/costs and fluid port flow limits below are new runtime balance
// proposals; original catalog component powers, efficiencies and capacities remain.
const TYPES=['mechanical','electrical','thermal','chemical','magic','divine'];
const EPS=1e-8,zero=()=>Object.fromEntries(TYPES.map(t=>[t,0])),copy=x=>structuredClone(x);
const ok=x=>({ok:true,...x}),no=reason=>({ok:false,reason});
const qty=n=>Number.isFinite(n)&&n>=0&&n<=1e12;
const point=p=>Array.isArray(p)?{x:p[0],y:p[1],z:p[2]}:{x:p?.x,y:p?.y,z:p?.z};
const validPoint=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=1e9);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export const FIXTURE_LINK_RULES=Object.freeze({
 maxDistanceM:8, maximumLinks:1024,
 materials:{mechanical:{wood:.25},electrical:{scrap_iron:.1},thermal:{scrap_iron:.1},chemical:{clay:.1},magic:{clay:.1},divine:{stone:.1}},
 status:'proposed',costUnit:'material L per cable metre, rounded upward to 0.001 L',
 fluidFlowLitersPerSecond:1,
});
export class FixtureEnergy {
 constructor(progression,state={}){
  this.p=progression;this.conversions=new Map(progression.entries.filter(e=>e.kind==='conversion').map(e=>[e.component,e]));this.stationInputs=new Map();for(const r of progression.entries)if(r.kind==='recipe'){const inputs=this.stationInputs.get(r.station)||new Set();for(const t of Object.keys(r.energy))inputs.add(t);this.stationInputs.set(r.station,inputs);}this.enabled=state.enabled===true;this.nodes=new Map();this.links=copy(state.links||[]);this.claims=new Set(state.claims||[]);this.nextId=state.nextId||1;
  this.legacyEscrow={...zero(),...state.legacyEscrow};this.metrics={generated:zero(),consumed:zero(),dissipated:zero(),imported:zero(),exported:zero(),conversionLoss:0,...copy(state.metrics||{})};
  if(state.schemaVersion!=null&&state.schemaVersion!==1)throw Error('Unsupported fixture energy save');
  for(const n of state.nodes||[]){if(this.nodes.has(n.ownerId)||!this.p._claim(n.ownerId)||!validPoint(n.position)||!this.p.catalog.has(n.assetId)||!Object.values(n.energy||{}).every(qty)||!Object.values(n.fuel||{}).every(qty)||!qty(n.health)||!qty(n.maxHealth)||n.maxHealth<=0||n.health>n.maxHealth||typeof n.active!=='boolean'||!TYPES.every(t=>qty(n.energy[t])))throw Error('Invalid fixture energy node');this.nodes.set(n.ownerId,copy(n));}
  if(!Number.isSafeInteger(this.nextId)||this.nextId<1||this.links.length>FIXTURE_LINK_RULES.maximumLinks||!Object.values(this.legacyEscrow).every(qty)||![...this.claims].every(id=>this.p._claim(id)))throw Error('Invalid fixture energy ledger');
  for(const l of this.links)if(!this.nodes.has(l.from)||!this.nodes.has(l.to)||!TYPES.includes(l.type)||!this.p._claim(l.id))throw Error('Invalid fixture energy link');
 }
 _definition(n){return this.p.catalog.get(n.assetId);}
 _health(n){return n.active&&n.health>0?n.health/n.maxHealth:0;}
 _access(n){return !!n&&this._health(n)>0&&this.p.fixtureAccess?.includes(n.ownerId);}
 sync(records){
  const located=records.filter(r=>validPoint(point(r.position)));
  if(!this.enabled&&!located.length)return;
  if(!this.enabled){this.enabled=true;for(const t of TYPES){const retained=t==='divine'?Math.min(100,this.p.energy[t]):0;this.legacyEscrow[t]+=this.p.energy[t]-retained;this.p.energy[t]=retained;if(t!=='divine'){this.legacyEscrow[t]+=this.p.energyOverflow[t];this.p.energyOverflow[t]=0;}}}
  const keep=new Set(located.map(r=>r.ownerId));
  for(const[id,n]of this.nodes)if(!keep.has(id)){for(const t of TYPES)this.metrics.dissipated[t]+=n.energy[t]||0;this.nodes.delete(id);}
  for(const r of located){let n=this.nodes.get(r.ownerId);if(!n){n={ownerId:r.ownerId,assetId:r.assetId,position:point(r.position),energy:zero(),fuel:{},sources:{},fluidType:r.fluidType||'liquid_mana'};this.nodes.set(r.ownerId,n);}
   const moved=distance(n.position,point(r.position))>1e-5;
   if(moved||!r.active)this.links=this.links.filter(l=>l.from!==r.ownerId&&l.to!==r.ownerId);
   Object.assign(n,{assetId:r.assetId,position:point(r.position),health:r.health,maxHealth:r.maxHealth,active:r.active});
   for(const t of TYPES){const capacity=this.capacity(n,t),excess=Math.max(0,n.energy[t]-capacity);n.energy[t]-=excess;this.metrics.dissipated[t]+=excess;}
  }
  this.links=this.links.filter(l=>this.nodes.has(l.from)&&this.nodes.has(l.to)&&distance(this.nodes.get(l.from).position,this.nodes.get(l.to).position)<=FIXTURE_LINK_RULES.maxDistanceM+EPS);
 }
 ports(ownerId){
  const n=this.nodes.get(ownerId);if(!n)return null;const d=this._definition(n);
  if(d.kind==='station'){const input=this.stationInputs.get(d.id)||new Set();
   const outputs=Object.keys(n.sources).filter(id=>n.sources[id]).map(id=>this.p.catalog.get(id)?.energy).filter(Boolean);
   return {inputs:[...input],outputs:[...new Set(outputs)],stores:[],rate:100,mode:'process_endpoint',description:'Recipe inputs only. Charged EU is reserved for queued work, never an output battery.'};}
  if(d.id==='fluid_container'){const type=n.fluidType==='acid_fluid'?'chemical':'magic';return{inputs:[type],outputs:[type],stores:[type],rate:n.fluidType==='acid_fluid'?40:100,mode:'fluid_storage',description:'Selected liquid only; 1 L/s pipe flow proposal. No conversion or generation without paid liquid.'};}
  return{inputs:[...d.inputEnergies],outputs:[...d.outputEnergies],stores:[...d.stores],rate:d.nominalPower,mode:d.id==='transmission'?'passive_transmission':d.stores.length?'storage':d.id==='mana_condenser'?'source':'component',description:d.id==='transmission'?'Transfers mechanical input only, no source and no idle drain.':'Only catalog-declared functions and ports.'};
 }
 _reservedNeed(n,type){return this.p.jobs.filter(j=>j.type==='craft'&&j.fixtureId===n.ownerId).reduce((sum,j)=>{const r=this.p.catalog.get(j.recipeId);return sum+(r.energy[type]||0)/r.seconds*Math.max(0,r.seconds*j.count-j.progress);},0);}
 capacity(nOrId,type){const n=typeof nOrId==='string'?this.nodes.get(nOrId):nOrId;if(!n)return 0;const d=this._definition(n),health=this._health(n);
  if(d.kind==='station')return this._reservedNeed(n,type);if(d.id==='fluid_container')return (n.fluidType==='acid_fluid'&&type==='chemical'?40:n.fluidType==='liquid_mana'&&type==='magic'?100:0)*d.capacityLiters*health;
  return d.stores.includes(type)?d.capacity*health:0;
 }
 quoteLink(from,to,type){
  const a=this.nodes.get(from),b=this.nodes.get(to);if(!a||!b||from===to||!TYPES.includes(type))return no('invalid_link');
  if(!this.ports(from).outputs.includes(type)||!this.ports(to).inputs.includes(type))return no('incompatible_ports');
  const length=distance(a.position,b.position);if(length>FIXTURE_LINK_RULES.maxDistanceM+EPS)return no('cable_too_long');
  const items=Object.fromEntries(Object.entries(FIXTURE_LINK_RULES.materials[type]).map(([id,q])=>[id,Math.ceil(q*Math.max(.25,length)*1000)/1000]));
  return ok({from,to,type,lengthM:length,maxDistanceM:FIXTURE_LINK_RULES.maxDistanceM,items,rateEUPerSecond:Math.min(this.ports(from).rate,this.ports(to).rate),status:'proposed'});
 }
 connect(from,to,type,{claimId}={}){
  if(!this.p._claim(claimId))return no('claim_required');if(this.claims.has(claimId))return ok({duplicate:true});
  const quote=this.quoteLink(from,to,type);if(!quote.ok)return quote;
  if(!this._access(this.nodes.get(from))||!this._access(this.nodes.get(to)))return no('out_of_range');
  if(this.links.length>=FIXTURE_LINK_RULES.maximumLinks||this.links.some(l=>l.from===from&&l.to===to&&l.type===type))return no('link_exists_or_limit');
  const paid=this.p.spend(quote.items,{claimId:`fixed-link:${claimId}`});if(!paid.ok)return paid;if(paid.duplicate)return no('link_receipt_conflict');
  const link={id:`fixed-link:${this.nextId++}`,from,to,type,lengthM:quote.lengthM,items:quote.items};this.links.push(link);this.claims.add(claimId);return ok({link:copy(link)});
 }
 disconnect(linkId){const l=this.links.find(l=>l.id===linkId);if(!l)return no('unknown_link');if(!this._access(this.nodes.get(l.from))&&!this._access(this.nodes.get(l.to)))return no('out_of_range');this.links=this.links.filter(x=>x!==l);return ok({salvage:{},reason:'Cable removal consumes the installed cut length; no automatic material refund.'});}
 sourceOptions(ownerId){const n=this.nodes.get(ownerId);if(!n)return[];const d=this._definition(n);return this.p.energySources.filter(s=>!s.activity&&((s.requiredComponent&&s.requiredComponent===d.id)||(!s.requiredComponent&&(d.kind==='station'||d.id==='heat_engine')))).map(copy);}
 setSource(ownerId,sourceId,active){const n=this.nodes.get(ownerId);if(!this._access(n)||typeof active!=='boolean'||!this.sourceOptions(ownerId).some(s=>s.id===sourceId))return no('invalid_source_or_range');if(sourceId==='manual_crank'&&active)for(const other of this.nodes.values())other.sources.manual_crank=false;n.sources[sourceId]=active;return ok();}
 refuel(ownerId,sourceId,batches=1,{claimId}={}){
  if(!this.p._claim(claimId))return no('claim_required');if(this.claims.has(claimId))return ok({duplicate:true});const n=this.nodes.get(ownerId),s=this.sourceOptions(ownerId).find(s=>s.id===sourceId);
  if(!this._access(n)||!s?.duration||!Number.isInteger(batches)||batches<1||batches>64)return no('invalid_fuel_or_range');
  const inputs=Object.fromEntries(Object.entries(s.inputs).map(([id,q])=>[id,q*batches])),paid=this.p.spend(inputs,{claimId:`fixed-fuel:${claimId}`});if(!paid.ok)return paid;if(paid.duplicate)return no('fuel_receipt_conflict');
  n.fuel[sourceId]=(n.fuel[sourceId]||0)+s.duration*batches;n.sources[sourceId]=true;this.claims.add(claimId);return ok({seconds:n.fuel[sourceId],items:inputs});
 }
 setFluid(ownerId,fluidType){const n=this.nodes.get(ownerId);if(!this._access(n)||n.assetId!=='fluid_container'||!['liquid_mana','acid_fluid'].includes(fluidType)||Object.values(n.energy).some(q=>q>EPS))return no('empty_container_required');n.fluidType=fluidType;this.links=this.links.filter(l=>l.from!==ownerId&&l.to!==ownerId);return ok();}
 fillFluid(ownerId,fluid,liters,{claimId}={}){
  const n=this.nodes.get(ownerId);if(!this.p._claim(claimId))return no('claim_required');if(this.claims.has(claimId))return ok({duplicate:true});const type=fluid==='liquid_mana'?'magic':fluid==='acid_fluid'?'chemical':null;
  if(!this._access(n)||n.assetId!=='fluid_container'||n.fluidType!==fluid||!qty(liters)||liters<=0||!type)return no('invalid_fluid');const eu=liters*(type==='magic'?100:40);
  if(n.energy[type]+eu>this.capacity(n,type)+EPS)return no('storage_capacity');const paid=this.p.spend({[fluid]:liters},{claimId:`fixed-fluid:${claimId}`});if(!paid.ok)return paid;if(paid.duplicate)return no('fluid_receipt_conflict');n.energy[type]+=eu;this.metrics.imported[type]+=eu;this.claims.add(claimId);return ok({storedEU:eu});
 }
 charge(ownerId,type,amount,{claimId,fromLegacyEscrow=false}={}){
  const n=this.nodes.get(ownerId);if(!this.p._claim(claimId))return no('claim_required');if(this.claims.has(claimId))return ok({duplicate:true});
  if(!this._access(n)||!TYPES.includes(type)||!qty(amount)||amount<=0||n.energy[type]+amount>this.capacity(n,type)+EPS)return no('capacity_or_range');
  if(fromLegacyEscrow){if(this.legacyEscrow[type]+EPS<amount)return no('legacy_escrow_empty');this.legacyEscrow[type]-=amount;}
  else {const paid=this.p.consumeEnergy(type,amount,{claimId:`fixed-charge:${claimId}`});if(!paid.ok)return paid;if(paid.duplicate)return no('charge_receipt_conflict');}
  n.energy[type]+=amount;this.metrics.imported[type]+=amount;this.claims.add(claimId);return ok({transferredEU:amount});
 }
 drain(ownerId,type,amount,{claimId}={}){
  const n=this.nodes.get(ownerId);if(!this.p._claim(claimId))return no('claim_required');if(this.claims.has(claimId))return ok({duplicate:true});
  if(!this._access(n)||!TYPES.includes(type)||!qty(amount)||amount<=0||n.energy[type]+EPS<amount||this.p.energy[type]+amount>this.p.energyCapacity(type)+EPS)return no('capacity_or_range');
  n.energy[type]-=amount;this.p.energy[type]+=amount;this.metrics.exported[type]+=amount;this.claims.add(claimId);return ok({transferredEU:amount});
 }
 step(dt,{consumerId=null,rates={},seconds=0,manual=false}={}){
  const pool=new Map(),used=new Map(),sent=new Map(),received=new Map();
  const manualOwner=[...this.nodes.values()].find(n=>n.sources.manual_crank&&this._access(n))?.ownerId;
  for(const n of this.nodes.values()){
   const q=zero();pool.set(n.ownerId,q);used.set(n.ownerId,0);sent.set(n.ownerId,0);received.set(n.ownerId,0);const health=this._health(n),ports=this.ports(n.ownerId);if(!health)continue;
   for(const t of TYPES){const amount=Math.min(n.energy[t],ports.rate*health*dt);n.energy[t]-=amount;q[t]+=amount;}
   for(const source of this.sourceOptions(n.ownerId)){
    const autonomous=['ambient_mana','relic_divinity'].includes(source.id);if(!(n.sources[source.id]??autonomous))continue;if(source.id==='manual_crank'&&(!manual||n.ownerId!==manualOwner))continue;
    let amount=0;if(source.duration){const time=Math.min(dt,n.fuel[source.id]||0);n.fuel[source.id]=(n.fuel[source.id]||0)-time;amount=time*source.power*health;}else amount=source.power*health*dt;
    if(source.storage)amount=Math.min(amount,Math.max(0,this.capacity(n,source.energy)-n.energy[source.energy]-q[source.energy]));
    q[source.energy]+=amount;this.metrics.generated[source.energy]+=amount;
   }
  }
  for(let pass=0;pass<this.nodes.size+1;pass++){
   let changed=false;
   for(const n of this.nodes.values()){const health=this._health(n);if(!health)continue;const q=pool.get(n.ownerId),conversion=this.conversions.get(n.assetId);if(!conversion)continue;
    const amount=Math.min(q[conversion.input],Math.max(0,this.ports(n.ownerId).rate*health*dt-used.get(n.ownerId)));if(amount>EPS){q[conversion.input]-=amount;q[conversion.output]+=amount*conversion.efficiency;this.metrics.conversionLoss+=amount*(1-conversion.efficiency);used.set(n.ownerId,used.get(n.ownerId)+amount);changed=true;}}
   for(const l of this.links){const a=this.nodes.get(l.from),b=this.nodes.get(l.to);if(!this._health(a)||!this._health(b))continue;const pa=this.ports(a.ownerId),pb=this.ports(b.ownerId),qa=pool.get(a.ownerId),qb=pool.get(b.ownerId);
    if(!pa.outputs.includes(l.type)||!pb.inputs.includes(l.type))continue;
    const branches=this.links.filter(other=>other.from===l.from&&other.type===l.type&&this._health(this.nodes.get(other.to))>0).length;
    let amount=Math.min(qa[l.type]/Math.max(1,branches),Math.max(0,pa.rate*this._health(a)*dt-sent.get(a.ownerId)),Math.max(0,pb.rate*this._health(b)*dt-received.get(b.ownerId)));
    if(this._definition(b).kind==='station')amount=Math.min(amount,b.ownerId===consumerId?Math.max(0,(rates[l.type]||0)*seconds-qb[l.type]):0);
    const storageEfficiency=pb.stores.includes(l.type)?(this._definition(b).efficiency||1):1;
    if(pb.stores.includes(l.type))amount=Math.min(amount,Math.max(0,this.capacity(b,l.type)-b.energy[l.type]-qb[l.type])/storageEfficiency);
    if(amount<=EPS)continue;qa[l.type]-=amount;qb[l.type]+=amount*storageEfficiency;this.metrics.dissipated[l.type]+=amount*(1-storageEfficiency);sent.set(a.ownerId,sent.get(a.ownerId)+amount);received.set(b.ownerId,received.get(b.ownerId)+amount);changed=true;
   }
   if(!changed)break;
  }
  let progressed=seconds;const consumer=consumerId&&this.nodes.get(consumerId),q=consumer&&pool.get(consumerId);
  if(Object.keys(rates).length){if(!consumer||!this._access(consumer))progressed=0;else for(const[t,rate]of Object.entries(rates))if(rate>0)progressed=Math.min(progressed,q[t]/rate);}
  if(q)for(const[t,rate]of Object.entries(rates)){const spent=rate*progressed;q[t]-=spent;this.metrics.consumed[t]+=spent;}
  for(const n of this.nodes.values()){const q=pool.get(n.ownerId);for(const t of TYPES){const room=Math.max(0,this.capacity(n,t)-n.energy[t]),keep=Math.min(room,q[t]);n.energy[t]+=keep;q[t]-=keep;this.metrics.dissipated[t]+=q[t];}}
  return {progressed};
 }
 status(){return{enabled:this.enabled,rules:copy(FIXTURE_LINK_RULES),nodes:[...this.nodes.values()].map(n=>({...copy(n),accessible:this._access(n),ports:this.ports(n.ownerId),capacities:Object.fromEntries(TYPES.map(t=>[t,this.capacity(n,t)])),sourceOptions:this.sourceOptions(n.ownerId)})),links:copy(this.links),legacyEscrow:copy(this.legacyEscrow),metrics:copy(this.metrics)};}
 serialize(){return{schemaVersion:1,enabled:this.enabled,nextId:this.nextId,nodes:[...this.nodes.values()].map(copy),links:copy(this.links),claims:[...this.claims],legacyEscrow:copy(this.legacyEscrow),metrics:copy(this.metrics)};}
}
