// Optional faith progression. Existing architecture supplies shrine positions;
// Progression owns costs/rewards. No research, discipline or boss access is gated here.
export const FAITH_RULES=Object.freeze({id:'unnamed_forgotten_deity',name:'잊힌 신',status:'proposed',rangeM:3,
 trialDurationS:12,trialWindowsS:[[2,4],[6,8],[10,12]],trialCost:{food:1,wood:1},trialRewardEU:15,
 quests:[{id:'provisions',name:'유적 보급',kind:'delivery',inputs:{food:4,wood:2},goal:1,rewardEU:10},
 {id:'records',name:'새로운 기록의 흔적',kind:'discovery',goal:2,rewardEU:15},
 {id:'guardian',name:'수호자의 위협',kind:'boss',goal:1,rewardEU:25}]});
const clone=v=>structuredClone(v),ok=v=>({ok:true,...v}),fail=reason=>({ok:false,reason});
const phases=new Set(['active','failed','ready','claimed']),questStates=new Set(['active','ready','claimed']);
const reasons={out_of_range:'제단에서 3m 이상 벗어났습니다.',occluded:'제단과의 사이가 막혔습니다.',dead:'사망하여 시련을 중단했습니다.',damaged:'피격되어 시련을 중단했습니다.',missed_window:'조율 시간대를 놓쳤습니다.',cancelled:'시련을 중단했습니다.',shrine_missing:'제단이 있는 유적을 찾을 수 없습니다.'};
const point=p=>Array.isArray(p)?{x:p[0],y:p[1],z:p[2]}:p;
const validPoint=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
const validId=s=>typeof s==='string'&&s.length>0&&s.length<=512;
const number=n=>Number.isFinite(n)&&n>=0;
const strings=a=>Array.isArray(a)&&a.every(validId)&&new Set(a).size===a.length;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const questById=id=>FAITH_RULES.quests.find(q=>q.id===id);
const action=(type,id)=>`faith:${type}${id?':'+id:''}`;
export class FaithSystem{
 constructor(runtime,state={}){
  if(!runtime?.progression||!runtime.dungeons||!runtime.player)throw Error('Faith runtime dependencies required');
  this.runtime=runtime;this.progression=runtime.progression;this.dungeons=runtime.dungeons;
  this.clock=state.clock??0;this.membership=clone(state.membership??null);this.quests=clone(state.quests??{});this.trials=clone(state.trials??{});
  if(state.schemaVersion!=null&&state.schemaVersion!==1)throw Error('Unsupported faith save');this._validate();
 }
 _validate(){
  if(!number(this.clock)||!this.quests||typeof this.quests!=='object'||Array.isArray(this.quests)||!this.trials||typeof this.trials!=='object'||Array.isArray(this.trials))throw Error('Invalid faith save');
  const m=this.membership;if(m&&(m.deityId!==FAITH_RULES.id||!number(m.joinedAt)||m.joinedAt>this.clock||!validId(m.shrineId)))throw Error('Invalid faith membership');
  for(const [id,q]of Object.entries(this.quests)){
   const def=questById(id);if(!def||!q||!questStates.has(q.status)||!number(q.acceptedAt)||q.acceptedAt>this.clock||!strings(q.baselineIds)||!strings(q.evidenceIds)||typeof q.delivered!=='boolean'||q.evidenceIds.length>def.goal||q.evidenceIds.some(id=>q.baselineIds.includes(id))||(q.status!=='active'&&(def.kind==='delivery'?!q.delivered:q.evidenceIds.length<def.goal)))throw Error('Invalid faith quest');
  }
  let active=0;for(const [id,t]of Object.entries(this.trials)){
   if(!validId(id)||!t||!phases.has(t.phase)||!Number.isSafeInteger(t.attempt)||t.attempt<1||!number(t.elapsed)||t.elapsed>FAITH_RULES.trialDurationS||!Number.isInteger(t.attunements)||t.attunements<0||t.attunements>3||!number(t.lastHp)||(t.damageAt!==null&&!Number.isFinite(t.damageAt))||(t.phase==='failed'&&!reasons[t.failReason])||(['ready','claimed'].includes(t.phase)&&(t.elapsed!==FAITH_RULES.trialDurationS||t.attunements!==3)))throw Error('Invalid faith trial');
   if(t.attunements>0&&t.elapsed<FAITH_RULES.trialWindowsS[t.attunements-1][0])throw Error('Invalid faith attunement timing');
   if(t.phase==='active'){const window=FAITH_RULES.trialWindowsS[t.attunements];if(window&&t.elapsed>window[1]+1e-8)throw Error('Invalid faith missed window');active++;}
  }if(active>1)throw Error('Multiple active faith trials');
  const receipts=new Set(),claims=this.progression.claims;
  const requireReceipt=(id,required,message)=>{const present=claims.has(id);if(present!==required)throw Error(message);if(present)receipts.add(id);};
  for(const def of FAITH_RULES.quests){
   const q=this.quests[def.id];
   requireReceipt(`faith:v1:delivery:${def.id}`,def.kind==='delivery'&&!!q?.delivered,'Invalid faith delivery receipt');
   requireReceipt(`faith:v1:quest:${def.id}`,q?.status==='claimed','Invalid faith reward receipt');
  }
  for(const [instanceId,t]of Object.entries(this.trials)){
   const prefix=`faith:v1:trial:${instanceId}:attempt:`,attempts=[...claims].filter(id=>id.startsWith(prefix));
   if(attempts.length!==t.attempt)throw Error('Invalid faith trial attempt receipts');
   for(let attempt=1;attempt<=attempts.length;attempt++)requireReceipt(`${prefix}${attempt}`,true,'Invalid faith trial attempt receipts');
   requireReceipt(`faith:v1:trial:${instanceId}:reward`,t.phase==='claimed','Invalid faith trial reward receipt');
  }
  for(const id of claims)if(id.startsWith('faith:v1:')&&!receipts.has(id))throw Error('Orphan faith progression receipt');
 }
 shrine(instanceId){
  const i=this.dungeons.get(instanceId);if(!i||!['communal_archive','forgotten_monastery'].includes(i.templateId))return null;
  const anchors=this.dungeons.anchors(instanceId),a=i.templateId==='communal_archive'?anchors.find(a=>a.kind==='reward'&&a.channel==='archive'):anchors.find(a=>a.kind==='puzzle');
  return a?{id:`faith:${instanceId}`,instanceId,anchorId:a.id,position:point(a.position),name:FAITH_RULES.name+'의 흔적'}:null;
 }
 nearbyShrines(radius=FAITH_RULES.rangeM){
  if(!number(radius)||radius>256)return [];const p=this.runtime.player;
  return this.dungeons.instancesNear(p,radius).map(i=>this.shrine(i.id)).filter(s=>s&&distance(p,s.position)<=radius).sort((a,b)=>distance(p,a.position)-distance(p,b.position));
 }
 _near(instanceId){
  const shrine=this.shrine(instanceId),p=this.runtime.player;
  if(!shrine)return 'shrine_missing';if(!(p.hp>0))return 'dead';if(!validPoint(p)||distance(p,shrine.position)>FAITH_RULES.rangeM)return 'out_of_range';
  const sight=this.runtime.terrain?.hasLineOfSight;
  if(sight&&!sight({...p,y:p.y+.8},{...shrine.position,y:shrine.position.y+.8}))return 'occluded';return null;
 }
 _evidence(kind){
  if(kind==='discovery')return [...this.dungeons.instances.values()].filter(i=>i.discovered&&['communal_archive','forgotten_monastery'].includes(i.templateId)).map(i=>i.id);
  if(kind==='boss')return [...new Set([...this.dungeons.instances.values()].filter(i=>i.boss?.defeated).map(i=>i.boss.instanceId).concat([...(this.runtime.bosses?.entities?.values()??[])].filter(e=>e.defeated&&e.hp===0).map(e=>e.id)))];return [];
 }
 _refresh(){for(const def of FAITH_RULES.quests){const q=this.quests[def.id];if(!q||q.status==='claimed')continue;
  if(def.kind!=='delivery')q.evidenceIds=[...new Set([...q.evidenceIds,...this._evidence(def.kind).filter(id=>!q.baselineIds.includes(id))])].slice(0,def.goal);
  if(def.kind==='delivery'?q.delivered:q.evidenceIds.length>=def.goal)q.status='ready';
 }}
 status(instanceId){
  this._refresh();const t=this.trials[instanceId],window=t&&t.attunements<3?FAITH_RULES.trialWindowsS[t.attunements]:null;
  return {faithId:FAITH_RULES.id,name:FAITH_RULES.name,member:!!this.membership,
   quests:FAITH_RULES.quests.map(d=>({id:d.id,name:d.name,phase:this.quests[d.id]?.status??'available',progress:d.kind==='delivery'?Number(!!this.quests[d.id]?.delivered):this.quests[d.id]?.evidenceIds.length??0,goal:d.goal,rewardEU:d.rewardEU})),
   trial:t?{...clone(t),durationS:FAITH_RULES.trialDurationS,requiredAttunements:3,remainingAttunements:3-t.attunements,nextWindowS:window?clone(window):null,failLabel:reasons[t.failReason]??null}:{phase:'available',elapsed:0,attunements:0,remainingAttunements:3,durationS:12,nextWindowS:[2,4]}};
 }
 optionsFor(instanceId){
  if(!this.shrine(instanceId))return [];const status=this.status(instanceId),near=this._near(instanceId),rows=[];
  const add=(id,label,detail,reason=null)=>rows.push({id,instanceId,label,detail,disabled:!!reason,reason});
  add(action(this.membership?'leave':'join'),this.membership?'신앙에서 물러나기':'잊힌 신의 신도 되기','선택 활동입니다. 가입·탈퇴해도 연구 분야와 제작법은 제한되지 않습니다.',near);
  for(const def of FAITH_RULES.quests){const q=this.quests[def.id],count=q?.evidenceIds.length??0,required=def.kind==='delivery'?'식량 4개·목재 2L 납품':def.kind==='discovery'?`수락 후 새로운 유적 2곳 방문 (${count}/2)`:`수락 후 새로운 보스 1개체 처치 (${count}/1)`,detail=`${required} · 신성 ${def.rewardEU} EU · 한 번만 수령`;
   if(!q)add(action('accept',def.id),def.name+' 수락',detail,near??(!this.membership?'membership_required':null));
   else if(q.status==='claimed')add(action('claim',def.id),def.name+' · 수령 완료',detail,'already_claimed');
   else if(q.status==='ready')add(action('claim',def.id),def.name+' 보상 수령',detail,near??(!this.membership?'membership_required':null));
   else if(def.kind==='delivery')add(action('deliver',def.id),'보급품 납품',detail,near??(!this.membership?'membership_required':!this.progression.hasItems(def.inputs)?'items_required':null));
   else add(action('claim',def.id),def.name+' 진행 중',detail,'objective_incomplete');
  }
  const t=this.trials[instanceId],active=Object.entries(this.trials).find(([,t])=>t.phase==='active'),cost='식량 1개·목재 1L 소비';
  if(!t||t.phase==='failed')add(action('start_trial'),t?'시련 재시도':'제단 시련 시작',`${cost} · 12초 동안 3m 이내, 2~4 / 6~8 / 10~12초에 조율. 피격·사망·이탈·시간 누락 시 실패. ${t?reasons[t.failReason]:''} 완료 보상 신성 15 EU, 이 제단에서 1회.`,near??(active?'trial_in_progress':!this.progression.hasItems(FAITH_RULES.trialCost)?'items_required':null));
  else if(t.phase==='active'){
   const w=status.trial.nextWindowS,ready=w&&t.elapsed>=w[0]&&t.elapsed<=w[1];
   add(action('attune'),'제단 조율',`${t.elapsed.toFixed(1)}/12초 · ${t.attunements}/3회 · 남은 ${3-t.attunements}회 · ${w?`다음 조율 ${w[0]}~${w[1]}초`:'세 번 조율 완료, 12초까지 유지하세요.'}`,near??(!ready?'outside_attunement_window':null));
   add(action('cancel_trial'),'시련 중단','지불한 보급품은 돌려받지 않습니다.',near);
  }else if(t.phase==='ready')add(action('claim_trial'),'시련 보상 수령','12초 유지·3회 조율 완료 · 신성 15 EU · 같은 제단 재수령 불가.',near);
  else add(action('claim_trial'),'시련 보상 수령 완료','이 제단의 시련은 완료했습니다.','already_claimed');
  return rows;
 }
 interact(id,{instanceId}={}){
  if(typeof id!=='string'||!validId(instanceId))return fail('invalid_faith_action');
  const near=this._near(instanceId);if(near)return fail(near);
  this._refresh();const parts=id.split(':');if(parts[0]!=='faith'||parts.length>3)return fail('invalid_faith_action');const type=parts[1],questId=parts[2],def=questById(questId),q=this.quests[questId];
  if(type==='join'&&!questId){if(this.membership)return ok({duplicate:true});this.membership={deityId:FAITH_RULES.id,joinedAt:this.clock,shrineId:instanceId};return ok({joined:true});}
  if(type==='leave'&&!questId){this.membership=null;return ok({left:true});}
  if(['accept','deliver','claim'].includes(type)){
   if(!def)return fail('unknown_quest');if(!this.membership)return fail('membership_required');
   if(type==='accept'){if(q)return ok({duplicate:true});this.quests[questId]={status:'active',acceptedAt:this.clock,baselineIds:this._evidence(def.kind),evidenceIds:[],delivered:false};return ok({accepted:questId});}
   if(!q)return fail('quest_not_accepted');
   if(type==='deliver'){
    if(def.kind!=='delivery')return fail('not_delivery_quest');if(q.delivered)return ok({duplicate:true});
    const paid=this.progression.transaction({items:def.inputs},{claimId:`faith:v1:delivery:${questId}`});if(!paid.ok)return paid;q.delivered=true;q.status='ready';return ok({delivered:questId});
   }
   if(q.status==='claimed')return ok({duplicate:true});if(q.status!=='ready')return fail('objective_incomplete');
   const reward=this.progression.grantReward({guaranteed:{},divineEnergy:def.rewardEU},{claimId:`faith:v1:quest:${questId}`});if(!reward.ok)return reward;q.status='claimed';return ok({questId,...reward});
  }
  if(questId)return fail('invalid_faith_action');const trial=this.trials[instanceId];
  if(type==='start_trial'){
   if(trial&&trial.phase!=='failed')return trial.phase==='active'?ok({duplicate:true}):fail('trial_already_completed');
   if(Object.values(this.trials).some(t=>t.phase==='active'))return fail('trial_in_progress');
   const attempt=(trial?.attempt??0)+1,paid=this.progression.transaction({items:FAITH_RULES.trialCost},{claimId:`faith:v1:trial:${instanceId}:attempt:${attempt}`});if(!paid.ok)return paid;
   this.trials[instanceId]={attempt,phase:'active',elapsed:0,attunements:0,lastHp:this.runtime.player.hp,damageAt:this.runtime.player.lastDamageAt??null,failReason:null};return ok({started:true,attempt});
  }
  if(type==='attune'){
   if(trial?.phase!=='active')return fail('trial_not_active');this._checkTrial(instanceId,trial,0);if(trial.phase!=='active')return fail(trial.failReason);
   const window=FAITH_RULES.trialWindowsS[trial.attunements];if(!window||trial.elapsed<window[0]||trial.elapsed>window[1])return fail('outside_attunement_window');
   trial.attunements++;this._checkTrial(instanceId,trial,0);return ok({attunements:trial.attunements,phase:trial.phase});
  }
  if(type==='cancel_trial'){if(trial?.phase!=='active')return fail('trial_not_active');trial.phase='failed';trial.failReason='cancelled';return ok({cancelled:true});}
  if(type==='claim_trial'){
   if(trial?.phase==='claimed')return ok({duplicate:true});if(trial?.phase!=='ready')return fail('trial_incomplete');
   const reward=this.progression.grantReward({guaranteed:{},divineEnergy:FAITH_RULES.trialRewardEU},{claimId:`faith:v1:trial:${instanceId}:reward`});if(!reward.ok)return reward;trial.phase='claimed';return ok(reward);
  }
  return fail('invalid_faith_action');
 }
 _checkTrial(id,t,dt){
  const p=this.runtime.player,near=this._near(id);let reason=near;
  if(!reason&&(p.hp<t.lastHp||(p.lastDamageAt??null)!==t.damageAt))reason='damaged';
  t.lastHp=Math.max(0,p.hp);const next=t.elapsed+dt,window=FAITH_RULES.trialWindowsS[t.attunements];
  if(!reason&&window&&next>window[1]+1e-8)reason='missed_window';
  if(reason){t.phase='failed';t.failReason=reason;return;}
  t.elapsed=Math.min(FAITH_RULES.trialDurationS,next);
  if(t.elapsed+1e-8>=FAITH_RULES.trialDurationS&&t.attunements===3){t.elapsed=FAITH_RULES.trialDurationS;t.phase='ready';}
 }
 tick(dt){
  if(!Number.isFinite(dt)||dt<0||dt>1)return fail('invalid_faith_dt');this.clock+=dt;this._refresh();
  for(const [id,t]of Object.entries(this.trials))if(t.phase==='active')this._checkTrial(id,t,dt);return ok();
 }
 serialize(){return clone({schemaVersion:1,clock:this.clock,membership:this.membership,quests:this.quests,trials:this.trials});}
}
