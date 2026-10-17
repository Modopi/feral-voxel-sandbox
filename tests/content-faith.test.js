import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTENT} from '../app/src/main/assets/content-runtime/catalog.generated.js';
import {DungeonSystem} from '../app/src/main/assets/content-runtime/dungeons.js';
import {Progression} from '../app/src/main/assets/content-runtime/progression.js';
import {FaithSystem,FAITH_RULES} from '../app/src/main/assets/content-runtime/faith.js';
function make(state={}){
 const r={player:state.player??{x:0,y:0,z:0,hp:100,lastDamageAt:-100},progression:new Progression(CONTENT,state.progression),dungeons:new DungeonSystem({catalog:CONTENT,seed:17,state:state.dungeons}),bosses:{entities:new Map()},terrain:{hasLineOfSight:()=>true}};
 r.faith=new FaithSystem(r,state.faith);return r;
}
function save(r){return structuredClone({player:r.player,progression:r.progression.serialize(),dungeons:r.dungeons.serialize(),faith:r.faith.serialize()});}
function shrine(r,id='test',template='communal_archive',origin=[0,0,0]){const i=r.dungeons.ensureInstance(template,id,origin);return r.faith.shrine(i.id);}
function move(r,s){Object.assign(r.player,s.position);}
function act(r,s,id){return r.faith.interact('faith:'+id,{instanceId:s.instanceId});}
function stock(r,items={food:20,wood:20}){assert(r.progression.grant(items,{claimId:'test-stock'}).ok);}
function time(r,seconds){for(let n=0;n<Math.floor(seconds);n++)assert(r.faith.tick(1).ok);if(seconds%1)assert(r.faith.tick(seconds%1).ok);}
function totalEU(r){return r.progression.energy.divine+r.progression.energyOverflow.divine;}
function finishTrial(r,s){time(r,3);assert(act(r,s,'attune').ok);time(r,4);assert(act(r,s,'attune').ok);time(r,4);assert(act(r,s,'attune').ok);time(r,1);assert.equal(r.faith.status(s.instanceId).trial.phase,'ready');}

test('faith uses real ruin/monastery anchors, proximity and visibility; membership never changes research',()=>{
 const r=make(),s=shrine(r),m=shrine(r,'sacred','forgotten_monastery',[100,0,0]),camp=r.dungeons.ensureInstance('grove_supply_camp','camp',[0,0,0]);
 assert(s);assert(m);assert.equal(r.faith.shrine(camp.id),null);assert.equal(act(r,s,'join').reason,'out_of_range');
 const before=r.progression.serialize();move(r,s);assert(r.faith.nearbyShrines().some(a=>a.instanceId===s.instanceId));
 r.terrain.hasLineOfSight=()=>false;assert.equal(act(r,s,'join').reason,'occluded');r.terrain.hasLineOfSight=()=>true;
 assert(act(r,s,'join').ok);assert.equal(act(r,s,'join').duplicate,true);assert.deepEqual(r.progression.serialize(),before);assert(act(r,s,'leave').ok);assert.deepEqual(r.progression.serialize(),before);
 assert.equal(FAITH_RULES.name,'잊힌 신');assert.equal(FAITH_RULES.status,'proposed');
});

test('delivery consumes real inputs once and quest reward is one-time across leave/rejoin and reload',()=>{
 const r=make(),s=shrine(r);move(r,s);assert.equal(act(r,s,'accept:provisions').reason,'membership_required');act(r,s,'join');act(r,s,'accept:provisions');
 assert.equal(act(r,s,'deliver:provisions').ok,false);assert.equal(act(r,s,'claim:provisions').reason,'objective_incomplete');stock(r);
 const before=r.progression.count('food');assert(act(r,s,'deliver:provisions').ok);assert.equal(r.progression.count('food'),before-4);assert.equal(act(r,s,'deliver:provisions').duplicate,true);
 assert(act(r,s,'claim:provisions').ok);assert.equal(totalEU(r),10);act(r,s,'leave');act(r,s,'join');assert.equal(act(r,s,'claim:provisions').duplicate,true);
 const loaded=make(save(r));assert.equal(act(loaded,s,'claim:provisions').duplicate,true);assert.equal(totalEU(loaded),10);assert.equal(loaded.faith.status(s.instanceId).quests[0].phase,'claimed');
});

test('discovery and boss quests require new accepted-time evidence and explicit nearby claim',()=>{
 const r=make(),s=shrine(r),old=shrine(r,'old');move(r,s);r.dungeons.enter(old.instanceId,r.dungeons.get(old.instanceId).origin);
 const previous=r.dungeons.ensureInstance('root_manor','previous',[200,0,0]);r.dungeons.defeatBoss(previous.id,previous.boss.instanceId);
 act(r,s,'join');act(r,s,'accept:records');act(r,s,'accept:guardian');r.faith.tick(0);assert.equal(r.faith.quests.records.evidenceIds.length,0);assert.equal(r.faith.quests.guardian.evidenceIds.length,0);
 for(const id of ['new1','new2']){const found=shrine(r,id,'communal_archive',[300,0,0]);r.dungeons.enter(found.instanceId,r.dungeons.get(found.instanceId).origin);}
 const boss=r.dungeons.ensureInstance('root_manor','newboss',[500,0,0]);r.dungeons.defeatBoss(boss.id,boss.boss.instanceId);r.faith.tick(0);assert.equal(totalEU(r),0);
 r.player.x+=10;assert.equal(act(r,s,'claim:records').reason,'out_of_range');move(r,s);assert(act(r,s,'claim:records').ok);assert(act(r,s,'claim:guardian').ok);assert.equal(totalEU(r),40);
 const restored=make(save(r));assert.equal(act(restored,s,'claim:guardian').duplicate,true);assert.equal(totalEU(restored),40);
});

test('independent trial requires paid supply, all three timed actions and 12 seconds; reload preserves progress',()=>{
 let r=make(),s=shrine(r,'trial','forgotten_monastery');move(r,s);assert.equal(act(r,s,'start_trial').ok,false);stock(r);
 assert(act(r,s,'start_trial').ok);assert.equal(r.faith.membership,null,'trial never forces faith membership');assert.equal(r.progression.count('food'),19);assert.equal(act(r,s,'start_trial').duplicate,true);assert.equal(r.progression.count('food'),19);
 assert.equal(act(r,s,'attune').reason,'outside_attunement_window');time(r,3);assert(act(r,s,'attune').ok);assert.equal(act(r,s,'attune').reason,'outside_attunement_window');
 r=make(save(r));time(r,4);assert(act(r,s,'attune').ok);time(r,4);assert(act(r,s,'attune').ok);assert.equal(act(r,s,'claim_trial').reason,'trial_incomplete');time(r,1);
 assert.equal(r.dungeons.get(s.instanceId).puzzle.phase,'locked','trial does not bypass the independent dungeon puzzle');
 assert(act(r,s,'claim_trial').ok);assert.equal(totalEU(r),15);assert.equal(act(r,s,'claim_trial').duplicate,true);assert.equal(act(r,s,'start_trial').reason,'trial_already_completed');
 const loaded=make(save(r));assert.equal(act(loaded,s,'claim_trial').duplicate,true);assert.equal(totalEU(loaded),15);assert.equal(loaded.faith.status(s.instanceId).trial.remainingAttunements,0);
});

test('failure reasons cover departure, damage, death and missed windows; each retry pays again',()=>{
 for(const reason of ['out_of_range','damaged','dead','missed_window','occluded']){
  const r=make(),s=shrine(r);move(r,s);stock(r);act(r,s,'start_trial');
  if(reason==='out_of_range')r.player.x+=3.1;
  if(reason==='damaged'){r.player.lastDamageAt=1;r.player.hp=99;}
  if(reason==='dead')r.player.hp=0;
  if(reason==='occluded')r.terrain.hasLineOfSight=()=>false;
  time(r,reason==='missed_window'?5:1);const status=r.faith.status(s.instanceId).trial;assert.equal(status.phase,'failed',reason);assert.equal(status.failReason,reason);assert(status.failLabel);assert.equal(totalEU(r),0);
  Object.assign(r.player,{hp:100,lastDamageAt:1});move(r,s);r.terrain.hasLineOfSight=()=>true;assert(act(r,s,'start_trial').ok);assert.equal(r.progression.count('food'),18);assert.equal(r.faith.trials[s.instanceId].attempt,2);
  finishTrial(r,s);assert(act(r,s,'claim_trial').ok);assert.equal(totalEU(r),15);
 }
});

test('cannot pass from afar, use large dt, start parallel trials or repeat a reward after failed delivery',()=>{
 const r=make(),s=shrine(r),other=shrine(r,'other','communal_archive',[100,0,0]);move(r,s);stock(r);act(r,s,'start_trial');
 assert.equal(r.faith.tick(12).reason,'invalid_faith_dt');assert.equal(r.faith.trials[s.instanceId].elapsed,0);
 move(r,other);assert.equal(act(r,other,'start_trial').reason,'trial_in_progress');assert.equal(act(r,s,'attune').reason,'out_of_range');move(r,s);finishTrial(r,s);
 const original=r.progression.grantReward.bind(r.progression);r.progression.grantReward=()=>({ok:false,reason:'blocked'});assert.equal(act(r,s,'claim_trial').reason,'blocked');assert.equal(r.faith.trials[s.instanceId].phase,'ready');
 r.progression.grantReward=original;assert(act(r,s,'claim_trial').ok);assert.equal(totalEU(r),15);
});

test('save validation rejects fabricated completed trials, unsupported versions and duplicate active attempts',()=>{
 const r=make(),s=shrine(r);move(r,s);stock(r);act(r,s,'start_trial');const state=save(r);
 const bad=structuredClone(state);bad.faith.trials[s.instanceId].phase='ready';assert.throws(()=>make(bad),/Invalid faith trial/);
 const fabricated=structuredClone(state);fabricated.faith.trials[s.instanceId].attunements=3;assert.throws(()=>make(fabricated),/Invalid faith attunement timing/);
 const missed=structuredClone(state);missed.faith.trials[s.instanceId].elapsed=5;assert.throws(()=>make(missed),/Invalid faith missed window/);
 const future=structuredClone(state);future.faith.schemaVersion=2;assert.throws(()=>make(future),/Unsupported faith save/);
 const twice=structuredClone(state);twice.faith.trials.other=structuredClone(twice.faith.trials[s.instanceId]);assert.throws(()=>make(twice),/Multiple active faith trials/);
 const outside=make(state);outside.player.x+=5;outside.faith.tick(0);assert.equal(outside.faith.trials[s.instanceId].phase,'failed');
});

test('save validation keeps faith phases aligned with paid and claimed progression receipts',()=>{
 const r=make(),s=shrine(r,'receipts');move(r,s);stock(r);act(r,s,'join');act(r,s,'accept:provisions');
 const accepted=save(r),fabricatedDelivery=structuredClone(accepted);
 fabricatedDelivery.faith.quests.provisions.delivered=true;fabricatedDelivery.faith.quests.provisions.status='ready';
 assert.throws(()=>make(fabricatedDelivery),/Invalid faith delivery receipt/);
 const orphanDelivery=structuredClone(accepted);orphanDelivery.progression.claims.push('faith:v1:delivery:provisions');
 assert.throws(()=>make(orphanDelivery),/Invalid faith delivery receipt/);

 assert(act(r,s,'deliver:provisions').ok);assert(act(r,s,'claim:provisions').ok);const claimed=save(r);
 const missingReward=structuredClone(claimed);missingReward.progression.claims=missingReward.progression.claims.filter(id=>id!=='faith:v1:quest:provisions');
 assert.throws(()=>make(missingReward),/Invalid faith reward receipt/);
 const staleReward=structuredClone(claimed);staleReward.faith.quests.provisions.status='ready';
 assert.throws(()=>make(staleReward),/Invalid faith reward receipt/);

 const trialRuntime=make(),trial=shrine(trialRuntime,'receipt-trial','forgotten_monastery');move(trialRuntime,trial);stock(trialRuntime);assert(act(trialRuntime,trial,'start_trial').ok);
 const active=save(trialRuntime),missingPayment=structuredClone(active);
 missingPayment.progression.claims=missingPayment.progression.claims.filter(id=>id!==`faith:v1:trial:${trial.instanceId}:attempt:1`);
 assert.throws(()=>make(missingPayment),/Invalid faith trial attempt receipts/);
 const orphanPayment=structuredClone(active);orphanPayment.faith.trials={};
 assert.throws(()=>make(orphanPayment),/Orphan faith progression receipt/);
 finishTrial(trialRuntime,trial);assert(act(trialRuntime,trial,'claim_trial').ok);
 const claimedTrial=save(trialRuntime),missingTrialReward=structuredClone(claimedTrial);
 missingTrialReward.progression.claims=missingTrialReward.progression.claims.filter(id=>id!==`faith:v1:trial:${trial.instanceId}:reward`);
 assert.throws(()=>make(missingTrialReward),/Invalid faith trial reward receipt/);
});
