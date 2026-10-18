import {MACHINE_VARIANTS,materialColor} from './machines.js';
import {MATERIAL_EFFECT_RULES} from './material-effects.js';

const ENERGY_NAMES={mechanical:'역학',electrical:'전기',thermal:'열',chemical:'화학',magic:'마법',divine:'신성'};
const VARIANT_NAMES={hull:'고정 접합',wing:'날개',wheel:'바퀴',propeller:'프로펠러',rotor:'양력 로터',motor:'전동기',elevator:'승강 조종',rudder:'방향 조종'};
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

/** Ordinary inventory-backed assembly controls. Every mutation uses MachineSystem. */
export class MachinePanel {
 constructor(runtime,{report,drive,extra}={}){this.runtime=runtime;this.report=report;this.drive=drive;this.extra=extra;this.selected=null;this.draft={tool:'add',layer:0,name:'나의 구조물',grid:'.1',material:'wood',x:0,y:0,z:0,voxel:'',component:'',variant:'',from:'',to:'',energy:'mechanical',cargo:'',amount:1,fluid:'water',source:'',pump:'',destination:''};}
 name(id){return this.runtime.progression.catalog.get(id)?.name??id;}
 field(parent,key,label,options=null,type='text'){
  const wrapper=el('label',null,'machine-field');wrapper.append(el('span',label));
  const input=el(options?'select':'input');input.dataset.machineField=key;
  if(options){for(const [value,text]of options){const option=el('option',text);option.value=value;input.append(option);}if(!options.some(([v])=>String(v)===String(this.draft[key])))this.draft[key]=options[0]?.[0]??'';}
  else{input.type=type;if(type==='number'){input.step='1';input.min=key==='amount'?'1':'-128';input.max=key==='amount'?'64':'128';}}
  input.value=this.draft[key]??'';input.oninput=()=>{this.draft[key]=type==='number'?Number(input.value):input.value;};
  if(options)input.onchange=()=>{this.draft[key]=input.value;if(key==='component')this.report({ok:true},'컴포넌트를 선택했습니다.');else if(key.startsWith('fixtureSource_')||key.startsWith('fixtureDestination_'))this.report?.({ok:true},'저장 설비를 선택했습니다.');};
  wrapper.append(input);parent.append(wrapper);return input;
 }
 action(parent,label,callback,disabled=false){const b=el('button',label);b.disabled=disabled;b.onclick=()=>{try{const result=callback();if(result&&typeof result.then==='function')result.then(r=>this.report(r)).catch(e=>this.report({ok:false,reason:e.message}));else if(result)this.report(result);}catch(e){this.report({ok:false,reason:e.message});}};parent.append(b);return b;}
 card(parent,title,detail){const node=el('article',null,'machine-card');node.append(el('b',title));if(detail)node.append(el('p',detail));parent.append(node);return node;}
 /** One layer of the machine as a grid, front (+Z) up (the old machine field's assembly grid): tap an empty cell
  * to attach a voxel of the chosen material, a voxel to salvage, repair or select it for a component. */
 grid(parent,m){
  const rt=this.runtime,s=rt.machines,p=rt.progression,d=this.draft,lo=[0,0,0],hi=[0,0,0];
  m.voxels.forEach((v,i)=>{for(let k=0;k<3;k++){lo[k]=i?Math.min(lo[k],v.cell[k]):v.cell[k];hi[k]=i?Math.max(hi[k],v.cell[k]):v.cell[k];}});
  const card=this.card(parent,'격자 조립','층을 고르고 칸을 누릅니다. 위가 앞쪽(+Z)입니다. 빈 칸에 붙이려면 이웃한 복셀이 있어야 합니다.');
  const layers=[];for(let y=Math.max(-128,lo[1]-1);y<=Math.min(128,hi[1]+1);y++)layers.push([y,`${y}층`]);
  if(!layers.some(([y])=>y===Number(d.layer)))d.layer=lo[1];
  this.field(card,'tool','도구',[['add','배치'],['remove','회수'],['repair','수리'],['select','선택']]);
  this.field(card,'layer','층',layers);
  const materials=p.list('material').filter(e=>p.count(e.id)>0).map(e=>[e.id,`${e.name} · ${p.count(e.id).toFixed(2)}L`]);
  this.field(card,'material','재료',materials);
  // At most 15 × 15 cells around the machine's middle, so a long machine still fits.
  const span=k=>{const a=Math.max(lo[k]-1,Math.round((lo[k]+hi[k])/2)-7);return [a,Math.min(hi[k]+1,a+14)];};
  const [x0,x1]=span(0),[z0,z1]=span(2),y=Number(d.layer),at=new Map();
  for(const v of m.voxels)if(v.cell[1]===y)at.set(`${v.cell[0]},${v.cell[2]}`,v);
  const mount=new Map(m.components.map(c=>[c.voxelId,c])),grid=el('div',null,'machine-grid');if(grid.style)grid.style.gridTemplateColumns=`repeat(${x1-x0+1},1fr)`;
  // +X is the machine's left when it faces +Z, so left is drawn on the left: columns run from high x to low x.
  for(let z=z1;z>=z0;z--)for(let x=x1;x>=x0;x--){
   const v=at.get(`${x},${z}`),c=v&&mount.get(v.id),b=el('button',v?(c?(VARIANT_NAMES[c.legacyType]??this.name(c.componentId)).slice(0,1):'■'):'·');
   b.dataset.cell=`${x},${y},${z}`;
   if(v){if(b.style)b.style.background=materialColor(v.materialId);b.title=`${this.name(v.materialId)} · HP ${v.hp.toFixed(0)}/${v.maxHp.toFixed(0)}${c?` · ${this.name(c.componentId)}`:''}`;if(v.hp<v.maxHp)b.classList?.add('damaged');if(d.voxel===v.id)b.classList?.add('selected');}
   b.onclick=()=>{
    let result;
    if(d.tool==='add')result=v?{ok:false,reason:'occupied'}:s.attachVoxel(m.id,{cell:[x,y,z],materialId:d.material});
    else if(!v)result={ok:false,reason:'unknown_voxel'};
    else if(d.tool==='remove')result=s.removeVoxel(m.id,v.id);
    else if(d.tool==='repair')result=s.repair(m.id,v.id);
    else{d.voxel=v.id;result={ok:true};}
    this.report(result);
   };
   grid.append(b);
  }
  card.append(grid);
 }
 render(parent){
  const rt=this.runtime,s=rt.machines,p=rt.progression,d=this.draft;
  const machines=[...s.machines.values()].filter(m=>dist(m.position,rt.player)<80);
  if(!s.machines.has(this.selected))this.selected=machines[0]?.id??null;
  const choice=this.card(parent,'주변의 기계','부품의 기능을 선택하고, 복셀 재료와 연결 방식으로 구조물을 만드세요.');
  for(const m of machines)this.action(choice,`${this.selected===m.id?'● ':''}${m.name} · ${Math.round(dist(m.position,rt.player))}m`,()=>{this.selected=m.id;return {ok:true};});
  const create=this.card(parent,'새 구조물','첫 복셀부터 실제 가방의 재료를 사용합니다. 빈 구조물에는 기능과 질량이 없습니다.');
  this.field(create,'name','이름');this.field(create,'grid','복셀 크기',[['.1','10cm · 한 칸 1L'],['.5','50cm · 한 칸 125L']]);
  this.action(create,'앞에 조립 시작',()=>{
   const x=rt.player.x-Math.sin(rt.player.yaw)*2.5,z=rt.player.z-Math.cos(rt.player.yaw)*2.5;
   const result=s.create({name:d.name,gridM:Number(d.grid),position:{x,y:rt.surfaceHeight(x,z),z}});if(result.ok)this.selected=result.machineId;return result;
  });
  const m=s.machines.get(this.selected);
  // A world's own machine actions (the machine field's examples and return to the start pad).
  this.extra?.(parent,m??null);
  if(!m)return;
  const stats=s.evaluate(m.id),near=dist(m.position,rt.player)<=5;
  const info=this.card(parent,m.name,`${m.voxels.length}복셀 · ${stats.mass.toFixed(2)}kg · 출력 ${stats.powerEUPerSecond.toFixed(1)} EU/s${near?'':' · 수정하려면 5m 안으로 다가가세요.'}`);
  this.action(info,'조종하기',()=>this.drive(m.id),!near||!m.components.some(c=>c.componentId==='controller'));
  this.action(info,'동력 정지',()=>s.control(m.id,{throttle:0,steer:0,pitch:0,brake:true}),!near);
  if(!near)return;
  this.grid(parent,m);
  const shape=this.card(parent,'복셀 조립',`좌표는 구조물 내부의 칸 위치입니다. 기존 복셀의 면에 연결하며, 같은 칸은 겹쳐 놓을 수 없습니다. 한 칸 ${Number((m.gridM**3*1000).toFixed(3))}L.`);
  const materials=p.list('material').filter(e=>p.count(e.id)>0).map(e=>[e.id,`${e.name} · ${p.count(e.id).toFixed(2)}L`]);
  this.field(shape,'material','재료',materials);for(const axis of ['x','y','z'])this.field(shape,axis,axis.toUpperCase(),null,'number');
  this.action(shape,'복셀 추가',()=>s.attachVoxel(m.id,{cell:[d.x,d.y,d.z],materialId:d.material}),!materials.length);
  const voxels=m.voxels.map(v=>[v.id,`${v.cell.join(', ')} · ${this.name(v.materialId)} · HP ${v.hp.toFixed(1)}/${v.maxHp.toFixed(1)}`]);
  this.field(shape,'voxel','선택 복셀',voxels);
  this.action(shape,'선택 복셀 회수',()=>s.removeVoxel(m.id,d.voxel),!voxels.length);
  if(typeof s.repair==='function')this.action(shape,'선택 복셀 수리',()=>s.repair(m.id,d.voxel),!voxels.length);
  if(voxels.length){
   const effects=this.card(parent,'물성 부여와 축성','선택 복셀에 마법으로 새 물성을 더하거나 신성으로 기존 물성을 강화합니다. 가공 설비와 실제 에너지가 필요합니다.');
   this.field(effects,'property','물성',Object.entries(MATERIAL_EFFECT_RULES).map(([id,r])=>[id,`${r.name} · ${ENERGY_NAMES[r.kind]} ${r.energyPerLiter} EU/L`]));
   this.action(effects,'가공 시작',()=>{const r=MATERIAL_EFFECT_RULES[d.property],method=r.kind==='magic'?'queueImprint':'queueConsecrate';return rt.materialEffects[method](m.id,d.voxel,d.property,{claimId:rt.id('material-effect')});});
   for(const job of rt.materialEffects.jobs.filter(j=>m.voxels.some(v=>v.id===j.voxelId))){const line=el('p',`${MATERIAL_EFFECT_RULES[job.property].name} · ${(job.progress/job.seconds*100).toFixed(0)}% · ${job.sourceComponentId?'구조물의 가공 컴포넌트에 에너지를 공급해야 진행됩니다.':'개인 에너지로 미리 지불했습니다.'}`);effects.append(line);this.action(line,'가공 취소 (쓴 에너지는 돌아오지 않음)',()=>rt.materialEffects.cancelJob(job.claimId));}
  }
  const component=this.card(parent,'기능 컴포넌트','가방에서 제작한 컴포넌트를 선택 복셀에 설치합니다. 에너지 포트를 연결해야 동력이 전달됩니다.');
  const cores=p.list('component').filter(e=>p.count(e.id)>0).map(e=>[e.id,`${e.name} × ${p.count(e.id)}`]);
  this.field(component,'component','컴포넌트',cores);
  this.field(component,'variant','작동 형태',[['','기본 기능'],...(MACHINE_VARIANTS[d.component]??[]).map(v=>[v,VARIANT_NAMES[v]??v])]);
  this.action(component,'선택 복셀에 설치',()=>s.installComponent(m.id,d.voxel,d.component,{legacyType:d.variant||null}),!voxels.length||!cores.length);
  for(const c of m.components){
   const card=this.card(parent,`${this.name(c.componentId)} · ${VARIANT_NAMES[c.legacyType]??'기본 기능'}`,`${c.id} · ${c.active?'작동':'정지'}${c.fuelItems||c.fuel?` · 연료 ${c.fuelItems}개 + ${c.fuel.toFixed(1)} EU`:''}${Object.values(c.fluids).some(n=>n>0)?' · '+Object.entries(c.fluids).map(([f,n])=>`${this.name(f)} ${n.toFixed(2)}L`).join(', '):''}`);
   this.action(card,c.active?'끄기':'켜기',()=>s.setActive(m.id,c.id,!c.active));
   if(c.componentId==='heat_engine')this.action(card,'나무 연료 1개 넣기',()=>s.refuel(m.id,c.id,1),p.count('raw_timber')<1);
   if(c.componentId==='arc_thrower')this.action(card,rt.machineWeaponId===c.id?'선택한 무장':'조종 중 사용할 무장으로 선택',()=>{rt.machineWeaponId=c.id;return {ok:true};});
   const def=p.catalog.get(c.componentId);
   for(const type of def.stores){
    card.append(el('p',`${ENERGY_NAMES[type]} ${c.energy[type].toFixed(1)}/${def.capacity} EU`));
    if(p.fixtureEnergy?.enabled){
     const keySuffix=`${c.id.replace(/[^a-zA-Z0-9_-]/g,'_')}_${type}`;
     const sources=s.fixtureTransferCandidates(m.id,c.id,type,'from_fixture'),sourceKey=`fixtureSource_${keySuffix}`;
     this.field(card,sourceKey,'가까운 출력 저장 설비',sources.map(n=>[n.ownerId,`${this.name(n.assetId)} · ${n.ownerId} · ${n.storedEU.toFixed(1)} EU · ${n.distanceM.toFixed(1)}m`]));
     const source=sources.find(n=>n.ownerId===d[sourceKey]);
     this.action(card,'선택 설비에서 10 EU 받기',()=>d[sourceKey]?s.charge(m.id,c.id,type,10,{sourceOwnerId:d[sourceKey]}):{ok:false,reason:'fixture_source_required'},!source||source.availableEU<10);
     const destinations=s.fixtureTransferCandidates(m.id,c.id,type,'to_fixture'),destinationKey=`fixtureDestination_${keySuffix}`;
     this.field(card,destinationKey,'가까운 입력 저장 설비',destinations.map(n=>[n.ownerId,`${this.name(n.assetId)} · ${n.ownerId} · 여유 ${n.roomEU.toFixed(1)} EU · ${n.distanceM.toFixed(1)}m`]));
     const destination=destinations.find(n=>n.ownerId===d[destinationKey]);
     this.action(card,'선택 설비로 10 EU 보내기',()=>d[destinationKey]?s.drainEnergy(m.id,c.id,type,10,{destinationOwnerId:d[destinationKey]}):{ok:false,reason:'fixture_destination_required'},!destination||destination.availableEU<10);
    }else{
     this.action(card,'10 EU 충전',()=>s.charge(m.id,c.id,type,10),p.energyAvailable(type)<10||c.energy[type]+10>def.capacity);
     this.action(card,'10 EU 꺼내기',()=>s.drainEnergy(m.id,c.id,type,10),c.energy[type]<10);
    }
   }
   if(c.componentId==='fluid_container'){
    for(const fluid of def.fluidContents){this.action(card,`${this.name(fluid)} 1L 넣기`,()=>s.fillFluid(m.id,c.id,fluid,1),p.count(fluid)<1);if(c.fluids[fluid]>0)this.action(card,`${this.name(fluid)} 1L 꺼내기`,()=>s.drainFluid(m.id,c.id,fluid,Math.min(1,c.fluids[fluid])));}
   }
   this.action(card,'컴포넌트 회수',()=>s.removeComponent(m.id,c.id));
  }
  if(m.components.length>1){
   const wiring=this.card(parent,'에너지 연결','출력 포트에서 입력 포트로 연결합니다. 저장 용량과 변환 손실은 각 컴포넌트의 성능을 따릅니다.');
   const endpoints=m.components.map(c=>[c.id,`${this.name(c.componentId)} · ${c.id}`]);
   this.field(wiring,'from','출력',endpoints);this.field(wiring,'to','입력',endpoints);this.field(wiring,'energy','에너지',Object.entries(ENERGY_NAMES));
   this.action(wiring,'포트 연결',()=>s.connect(m.id,d.from,d.to,d.energy));
   for(const link of m.links){const line=el('div',`${link.from} → ${link.to} · ${ENERGY_NAMES[link.type]}`);wiring.append(line);this.action(line,'연결 해제',()=>s.disconnect(m.id,link.id));}
   const containers=m.components.filter(c=>c.componentId==='fluid_container').map(c=>[c.id,c.id]),pumps=m.components.filter(c=>c.componentId==='pump').map(c=>[c.id,c.id]);
   if(containers.length>=2&&pumps.length){const fluids=this.card(parent,'유체 배관','펌프에 동력을 연결하면 용기 사이에서 실제 액체가 이동합니다.');this.field(fluids,'source','보내는 용기',containers);this.field(fluids,'pump','펌프',pumps);this.field(fluids,'destination','받는 용기',containers);this.action(fluids,'배관 연결',()=>s.connectFluid(m.id,d.source,d.pump,d.destination));}
  }
  const cargo=this.card(parent,'화물',Object.entries(m.cargo).map(([id,n])=>`${this.name(id)} ${n}`).join(' · ')||'화물 없음');
  const items=Object.entries(p.inventory).filter(([,n])=>n>0).map(([id,n])=>[id,`${this.name(id)} × ${n}`]);this.field(cargo,'cargo','싣을 물품',items);this.field(cargo,'amount','수량',null,'number');
  this.action(cargo,'화물 싣기',()=>s.loadCargo(m.id,{[d.cargo]:d.amount}),!items.length);
  for(const[id,n]of Object.entries(m.cargo))this.action(cargo,`${this.name(id)} 모두 내리기`,()=>s.unloadCargo(m.id,{[id]:n}));
 }
}
