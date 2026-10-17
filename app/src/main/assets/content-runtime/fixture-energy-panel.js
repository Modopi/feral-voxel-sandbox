const LABELS={mechanical:'역학',electrical:'전기',thermal:'열',chemical:'화학',magic:'마법',divine:'신성'};
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
/** UI for explicit fixed-network transactions. No simulation or direct balance writes. */
export class FixtureEnergyPanel {
 constructor(runtime,{report=()=>{},onManual=null}={}){this.runtime=runtime;this.report=report;this.onManual=onManual;this.manualHeld=false;this.selected=null;this.draft={from:'',to:'',type:'magic',amount:10,liters:1};}
 name(id){return this.runtime.progression.catalog.get(id)?.name||id;}
 card(parent,title,body){const c=el('article',null,'machine-card');c.append(el('b',title));if(body)c.append(el('p',body));parent.append(c);return c;}
 action(parent,label,fn,disabled=false){const b=el('button',label);b.disabled=disabled;b.onclick=()=>{try{this.report(fn());}catch(error){this.report({ok:false,reason:error.message});}};parent.append(b);return b;}
 field(parent,key,label,options=null){const row=el('label',null,'machine-field');row.append(el('span',label));const input=el(options?'select':'input');
  if(options){for(const[value,text]of options){const option=el('option',text);option.value=value;input.append(option);}if(!options.some(([id])=>id===this.draft[key]))this.draft[key]=options[0]?.[0]||'';input.onchange=()=>{this.draft[key]=input.value;this.report({ok:true});};}
  else{input.type='number';input.min='.001';input.step='.1';input.oninput=()=>{this.draft[key]=Number(input.value);};}input.value=this.draft[key];row.append(input);parent.append(row);return input;
 }
 stopManual(){this.manualHeld=false;this.onManual?.(false);}
 render(parent){
  const rt=this.runtime,p=rt.progression,g=p.fixtureEnergy,state=g.status(),d=this.draft,claim=()=>({claimId:rt.id('fixture-energy-ui')});
  const personal=this.card(parent,'휴대 에너지','설치형 배터리와 용기는 개인 에너지에 자동 합산되지 않습니다. 현장에서 직접 옮기거나 배선을 연결하세요.');
  personal.append(el('p',Object.entries(LABELS).map(([t,label])=>`${label} ${p.energyAvailable(t).toFixed(1)}/${p.energyCapacity(t)} EU`).join(' · ')));
  const mana=p.manaStatus(),growth=this.card(parent,'아바타의 마나 성장',`내재 용량 ${mana.investedCapacity} EU · 현재 최대 ${mana.capacityEU} EU · 보존 중 ${mana.reserveEU.toFixed(1)} EU. 재료 투자는 용량만 늘리며 마나는 별도로 채웁니다. 재료 투자 최대 700 EU, 초점 포함 최대 1000 EU.`);
  const manaMaterials=p.list('material').filter(m=>p.count(m.id)>=1&&p.quoteManaInvestment(m.id,1).ok).map(m=>[m.id,`${m.name} 1L → 용량 +${p.quoteManaInvestment(m.id,1).capacityGain} EU`]);this.field(growth,'manaMaterial','투자할 마나 재료',manaMaterials);
  this.action(growth,'재료 1L로 최대 마나 증가',()=>p.investMana(d.manaMaterial,1,claim()),!manaMaterials.length||!state.enabled);
  const focuses=p.list('gear_baseline').filter(g=>g.tier>=5&&p.count(g.id)>0).map(g=>[g.id,`${g.name} · 초점 용량 +${(g.tier-4)*50} EU`]);this.field(growth,'manaFocus','마나 초점 장구',focuses);
  this.action(growth,'초점 장착',()=>p.equipManaFocus(d.manaFocus),!focuses.length||!state.enabled);this.action(growth,'초점 해제',()=>p.unequipManaFocus(),!mana.focusId);
  if(mana.focusId)growth.append(el('p',`현재 초점: ${this.name(mana.focusId)}. 해제하거나 분실하면 초과 마나는 사용할 수 없는 보존분으로 남으며 다시 장착해도 새 마나는 생기지 않습니다.`));
  personal.append(el('p',`수피컵의 외부 액체: ${mana.cupEU.toFixed(1)}/100 EU${mana.cupAccessible?'':' · 컵 선택/회수 필요'}. 아바타 용량에는 합산되지 않습니다.`));
  this.action(personal,'수피컵을 마나 용기로 사용',()=>p.useManaCup(),p.count('bark_cup')<1||!p.research.has('mana'));
  this.field(personal,'liters','마나 액체 L');this.action(personal,'가방의 마나 액체 흡수',()=>p.fillPersonalMana(Number(d.liters),claim()),!state.enabled);
  this.action(personal,'수피컵에 마나 액체 담기',()=>p.fillManaCup(Number(d.liters),claim()),!mana.cupAccessible);this.action(personal,'수피컵에서 10 EU 흡수',()=>p.absorbManaCup(10,claim()),!mana.cupAccessible||mana.cupEU<10);
  if(!state.enabled){this.card(parent,'실물 설비 설치 필요','설비와 부품을 월드에 설치하면 위치별 전력망이 활성화됩니다. 이전 무위치 설치분은 실물망 활성화 후 회수해 다시 설치할 수 있습니다.');return;}
  const overview=this.card(parent,'설비별 에너지망','출력 → 입력을 직접 연결해야 전달됩니다. 배선 한 구간 최대 8m이며 같은 에너지 포트끼리 연결합니다. 낙하·철거 시 연결이 끊어지고, 저장기를 철거하면 남은 에너지는 소실됩니다.');
  for(const n of state.nodes){const dist=Math.hypot(n.position.x-rt.player.x,n.position.y-rt.player.y,n.position.z-rt.player.z);this.action(overview,`${n.ownerId===this.selected?'● ':''}${this.name(n.assetId)} · ${n.ownerId} · ${dist.toFixed(1)}m${n.accessible?'':' · 접근 필요'}`,()=>{this.selected=n.ownerId;return {ok:true};});}
  if(!state.nodes.some(n=>n.ownerId===this.selected))this.selected=state.nodes.find(n=>n.accessible)?.ownerId||state.nodes[0]?.ownerId;
  const n=state.nodes.find(n=>n.ownerId===this.selected);
  if(n){const detail=this.card(parent,`${this.name(n.assetId)} · ${n.ownerId}`,`입력: ${n.ports.inputs.map(t=>LABELS[t]).join(', ')||'없음'} / 출력: ${n.ports.outputs.map(t=>LABELS[t]).join(', ')||'없음'} · 최대 ${n.ports.rate} EU/s · ${n.active?'작동 가능':'파손 또는 고정 필요'}`);
   for(const job of p.jobs.filter(j=>j.type==='craft'&&p.catalog.get(j.recipeId)?.station===n.assetId&&(!j.fixtureId||!p.worldFixtures.some(f=>f.ownerId===j.fixtureId))))this.action(detail,`보존된 작업 지정: ${this.name(job.recipeId)}`,()=>p.bindCraftJob(job.id,n.ownerId),!n.accessible||!n.active);
   if(n.ports.mode==='process_endpoint')detail.append(el('p','작업 설비의 충전은 현재 대기 중인 제작에만 예약됩니다. 일반 저장기처럼 다른 곳에 출력하지 않습니다.'));
   if(n.ports.mode==='passive_transmission')detail.append(el('p','전달축은 들어온 역학 에너지만 전달합니다. 발전이나 자체 대기 소모는 없습니다.'));
   this.field(detail,'amount','옮길 에너지 EU');
   for(const type of Object.keys(LABELS)){const amount=n.energy[type]||0,capacity=n.capacities[type]||0;if(!amount&&!capacity)continue;detail.append(el('p',`${LABELS[type]} ${amount.toFixed(1)}/${capacity.toFixed(1)} EU`));
    this.action(detail,`${LABELS[type]} 개인 → 설비`,()=>g.charge(n.ownerId,type,Number(d.amount),claim()),!n.accessible);
    this.action(detail,`${LABELS[type]} 설비 → 개인`,()=>g.drain(n.ownerId,type,Number(d.amount),claim()),!n.accessible||amount<=0);
    if(state.legacyEscrow[type]>0)this.action(detail,`이전 저장분 ${LABELS[type]} → 설비`,()=>g.charge(n.ownerId,type,Number(d.amount),{...claim(),fromLegacyEscrow:true}),!n.accessible);
   }
   for(const source of n.sourceOptions){const active=n.sources[source.id]??['ambient_mana','relic_divinity'].includes(source.id);detail.append(el('p',`${source.name} · ${source.power} EU/s${source.duration?` · 남은 연료 ${(n.fuel[source.id]||0).toFixed(1)}초`:''}`));
    this.action(detail,`${source.name} ${active?'끄기':'켜기'}`,()=>g.setSource(n.ownerId,source.id,!active),!n.accessible);
    if(source.duration){const cost=Object.entries(source.inputs).map(([id,q])=>`${this.name(id)} ${q}`).join(', ');this.action(detail,`연료 한 묶음 넣기 (${cost})`,()=>g.refuel(n.ownerId,source.id,1,claim()),!n.accessible);}
    if(source.id==='manual_crank'){const b=this.action(detail,'누르는 동안 손으로 돌리기',()=>({ok:true}),!n.accessible);b.onpointerdown=e=>{const enabled=g.setSource(n.ownerId,source.id,true);if(!enabled.ok){this.report(enabled);return;}this.manualHeld=true;this.onManual?.(true);b.setPointerCapture?.(e.pointerId);};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>this.stopManual();}
   }
   if(n.assetId==='fluid_container'){this.field(detail,'liters','액체 L');for(const fluid of ['liquid_mana','acid_fluid']){this.action(detail,`${this.name(fluid)}용으로 지정`,()=>g.setFluid(n.ownerId,fluid),!n.accessible||Object.values(n.energy).some(q=>q>0));this.action(detail,`${this.name(fluid)} 넣기`,()=>g.fillFluid(n.ownerId,fluid,Number(d.liters),claim()),!n.accessible||n.fluidType!==fluid);}}
  }
  const wiring=this.card(parent,'배선·배관 연결','양 끝 설비에 접근할 수 있는 곳에서 연결하세요. 배터리는 카탈로그 충전 손실을 적용합니다. 분기 출력은 나눠 전달되며, 남는 비저장 에너지는 소실됩니다.');
  this.field(wiring,'from','출력 설비',state.nodes.filter(n=>n.ports.outputs.length).map(n=>[n.ownerId,`${this.name(n.assetId)} · ${n.ownerId}`]));
  const from=state.nodes.find(n=>n.ownerId===d.from);this.field(wiring,'type','출력 채널',(from?.ports.outputs||[]).map(t=>[t,LABELS[t]]));
  this.field(wiring,'to','입력 설비',state.nodes.filter(n=>n.ownerId!==d.from&&n.ports.inputs.includes(d.type)).map(n=>[n.ownerId,`${this.name(n.assetId)} · ${n.ownerId}`]));
  const quote=g.quoteLink(d.from,d.to,d.type);if(quote.ok)wiring.append(el('p',`${quote.lengthM.toFixed(2)}m / 최대 ${quote.rateEUPerSecond} EU/s · ${Object.entries(quote.items).map(([id,q])=>`${this.name(id)} ${q}`).join(', ')}`));else wiring.append(el('p',quote.reason==='cable_too_long'?'8m를 초과합니다. 중간에 실제 전달·저장 부품을 설치하세요.':'호환되는 출력과 입력을 선택하세요.'));
  this.action(wiring,'재료를 사용해 연결',()=>g.connect(d.from,d.to,d.type,claim()),!quote.ok);
  for(const l of state.links){const row=el('div',`${l.from} → ${l.to} · ${LABELS[l.type]} · ${l.lengthM.toFixed(2)}m`);wiring.append(row);this.action(row,'연결 해제',()=>g.disconnect(l.id));}
  const old=Object.entries(state.legacyEscrow).filter(([,n])=>n>0),hasOld=old.length||p.assemblies.some(a=>!a.worldOwnerId)||Object.entries(p.stations).some(([id,count])=>count>p.worldFixtures.filter(f=>f.kind==='station'&&f.assetId===id).length);if(!hasOld)return;const legacy=this.card(parent,'이전 무위치 설비 이관',old.map(([t,n])=>`${LABELS[t]} ${n.toFixed(1)} EU 보관`).join(' · ')||'이전 공용 저장 에너지 없음');
  legacy.append(el('p','이전 무위치 설비는 회수 후 실제 위치에 다시 설치하세요. 이전 저장 에너지는 위에서 선택한 저장기나 예약된 작업으로 명시적으로 옮길 수 있습니다.'));
  this.action(legacy,'이전 무위치 설비를 가방으로 회수',()=>p.recoverUnpositionedFixtures(claim()));
 }
}
