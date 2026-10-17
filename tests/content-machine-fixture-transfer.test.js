import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Progression} from '../app/src/main/assets/content-runtime/progression.js';
import {MachineSystem} from '../app/src/main/assets/content-runtime/machines.js';
import {MachinePanel} from '../app/src/main/assets/content-runtime/machine-panel.js';

const CONTENT={progression:JSON.parse(fs.readFileSync(new URL('../design/content/progression.json',import.meta.url)))};
let serial=0;
const receipt=label=>({claimId:`machine-fixture-transfer:${label}:${serial++}`});
const fixture=(ownerId,assetId,z)=>({ownerId,assetId,kind:CONTENT.progression.entries.find(e=>e.id===assetId).kind,position:{x:0,y:.05,z},rotation:{x:0,y:0,z:0,w:1},health:100,maxHealth:100,active:true});

function setup({batteryZ=-17.45,generate=true}={}){
 const p=new Progression(CONTENT);
 for(const row of p.list('research'))p.research.add(row.id);
 assert.equal(p.grant({wood:10,battery:1,scrap_iron:10},{claimId:`grant:${serial++}`}).ok,true);
 // Preserve a legacy pool to prove that an explicit bad fixture ID cannot fall back to it.
 assert.equal(p.supplyEnergy('electrical',20,receipt('legacy-pool')).ok,true);
 const records=[fixture('crank','field_bench',-16),fixture('shaft','transmission',-16.5),fixture('dynamo','generator',-17),fixture('fixed-battery','battery',batteryZ)];
 assert.equal(p.syncWorldFixtures(records,{accessibleOwnerIds:records.map(r=>r.ownerId)}).ok,true);
 const g=p.fixtureEnergy;
 assert.equal(g.legacyEscrow.electrical,20);
 assert.equal(g.setSource('crank','manual_crank',true).ok,true);
 for(const [from,to,type] of [['crank','shaft','mechanical'],['shaft','dynamo','mechanical'],['dynamo','fixed-battery','electrical']])
  assert.equal(g.connect(from,to,type,receipt(`link:${from}:${to}`)).ok,true);
 if(generate)p.tick(5,{manual:true});
 const s=new MachineSystem(CONTENT,p),created=s.create({position:[0,0,0],gridM:.1});assert.equal(created.ok,true);
 const machineId=created.machineId,voxel=s.attachVoxel(machineId,{cell:[99,0,0],materialId:'wood'});assert.equal(voxel.ok,true,JSON.stringify(voxel));
 const installed=s.installComponent(machineId,voxel.voxelId,'battery');assert.equal(installed.ok,true);
 const machine=s.machines.get(machineId);machine.yaw=Math.PI/2;machine.rotation={x:0,y:Math.sin(Math.PI/4),z:0,w:Math.cos(Math.PI/4)};
 return {p,s,g,machineId,componentId:installed.componentInstanceId,records};
}

test('fixed generator network transfers finite EU to and from a rotated machine host with conserved save state',()=>{
 const {p,s,g,machineId,componentId}=setup();
 const fixed=g.nodes.get('fixed-battery'),beforeFixed=fixed.energy.electrical;
 assert.ok(beforeFixed>20,'fixture generator should charge its real fixed battery');
 const candidates=s.fixtureTransferCandidates(machineId,componentId,'electrical','from_fixture');
 const chosen=candidates.find(row=>row.ownerId==='fixed-battery');
 assert.ok(chosen);
 assert.ok(Math.abs(chosen.distanceM-7.5)<1e-3,`range is measured from the rotated mounted voxel, not the machine origin (${chosen.distanceM})`);
 assert.ok(Math.hypot(s.machines.get(machineId).position.x-fixed.position.x,s.machines.get(machineId).position.z-fixed.position.z)>8);
 assert.equal(s.charge(machineId,componentId,'electrical',10,{sourceOwnerId:'missing-battery'}).ok,false);
 assert.equal(g.legacyEscrow.electrical,20,'explicit source failures never fall back to global or escrow energy');
 assert.equal(s.machines.get(machineId).components[0].energy.electrical,0);
 const legacyEscrow= g.legacyEscrow.electrical,exported=g.metrics.exported.electrical,generated=s.machines.get(machineId).metrics.generated;
 const incoming=s.charge(machineId,componentId,'electrical',10,{sourceOwnerId:'fixed-battery'});
 assert.equal(incoming.ok,true,JSON.stringify(incoming));
 assert.equal(fixed.energy.electrical,beforeFixed-10);
 assert.equal(s.machines.get(machineId).components[0].energy.electrical,10);
 assert.equal(g.metrics.exported.electrical,exported+10);
 assert.equal(s.machines.get(machineId).metrics.generated,generated+10);
 assert.equal(g.legacyEscrow.electrical,legacyEscrow);

 const outgoing=s.drainEnergy(machineId,componentId,'electrical',5,{destinationOwnerId:'fixed-battery'});
 assert.equal(outgoing.ok,true,JSON.stringify(outgoing));
 assert.equal(fixed.energy.electrical,beforeFixed-5);
 assert.equal(s.machines.get(machineId).components[0].energy.electrical,5);
 assert.equal(g.metrics.imported.electrical,5);
 assert.equal(s.machines.get(machineId).metrics.consumed,5);
 const p2=new Progression(CONTENT,p.serialize()),s2=new MachineSystem(CONTENT,p2,s.serialize());
 assert.equal(p2.fixtureEnergy.nodes.get('fixed-battery').energy.electrical,fixed.energy.electrical);
 assert.equal(s2.machines.get(machineId).components[0].energy.electrical,5);
 assert.equal(p2.fixtureEnergy.metrics.exported.electrical,exported+10);
 assert.equal(p2.fixtureEnergy.metrics.imported.electrical,5);
 assert.equal(s2.machines.get(machineId).metrics.generated,generated+10);
 assert.equal(s2.machines.get(machineId).metrics.consumed,5);
});

test('rejects out-of-range, incompatible, depleted, and over-capacity transfers without partial ledger writes',()=>{
 const {p,s,g,machineId,componentId}=setup({generate:false});
 const machine=s.machines.get(machineId),battery=machine.components[0],fixed=g.nodes.get('fixed-battery');
 fixed.energy.electrical=0;
 const before={machine:battery.energy.electrical,fixed:fixed.energy.electrical,exported:g.metrics.exported.electrical,imported:g.metrics.imported.electrical,generated:machine.metrics.generated,consumed:machine.metrics.consumed};
 assert.equal(s.charge(machineId,componentId,'electrical',10,{sourceOwnerId:'fixed-battery'}).reason,'insufficient_stored_energy');
 assert.equal(s.charge(machineId,componentId,'electrical',10,{sourceOwnerId:'dynamo'}).reason,'incompatible_ports');
 fixed.energy.electrical=30;
 const batteryRecord=p.worldFixtures.find(r=>r.ownerId==='fixed-battery');
 const far={...batteryRecord,position:{x:100,y:.05,z:-17.45}};p.syncWorldFixtures([...p.worldFixtures.filter(r=>r.ownerId!=='fixed-battery'),far],{accessibleOwnerIds:['fixed-battery','crank','shaft','dynamo']});
 assert.equal(s.charge(machineId,componentId,'electrical',10,{sourceOwnerId:'fixed-battery'}).reason,'out_of_range');
 far.position={x:0,y:.05,z:-17.45};p.syncWorldFixtures([...p.worldFixtures.filter(r=>r.ownerId!=='fixed-battery'),far],{accessibleOwnerIds:['crank','shaft','dynamo']});
 assert.equal(s.charge(machineId,componentId,'electrical',10,{sourceOwnerId:'fixed-battery'}).reason,'fixture_unavailable');
 p.syncWorldFixtures([...p.worldFixtures.filter(r=>r.ownerId!=='fixed-battery'),{...far,active:true,health:100}],{accessibleOwnerIds:['fixed-battery','crank','shaft','dynamo']});
 battery.energy.electrical=395;
 assert.equal(s.charge(machineId,componentId,'electrical',10,{sourceOwnerId:'fixed-battery'}).reason,'target_capacity');
 assert.deepEqual({machine:battery.energy.electrical,fixed:fixed.energy.electrical,exported:g.metrics.exported.electrical,imported:g.metrics.imported.electrical,generated:machine.metrics.generated,consumed:machine.metrics.consumed}, {...before,machine:395,fixed:30});
});

test('machine panel selects a nearby compatible fixture and calls the explicit 10 EU transfer',()=>{
 const {p,s,machineId,g}=setup();
 const backup={...p.worldFixtures.find(r=>r.ownerId==='fixed-battery'),ownerId:'backup-battery',position:{x:0,y:.05,z:-16.45}};
 assert.equal(p.syncWorldFixtures([...p.worldFixtures,backup],{accessibleOwnerIds:[...p.fixtureAccess,'backup-battery']}).ok,true);
 const oldDocument=globalThis.document;
 const makeNode=tag=>({tag,textContent:'',className:'',dataset:{},children:[],append(...nodes){this.children.push(...nodes);},value:'',disabled:false});
 globalThis.document={createElement:makeNode};
 try{
  const reports=[],parent=makeNode('main');let panel,rerenders=0;
  const report=r=>{reports.push(r);rerenders++;parent.children=[];panel.render(parent);};
  panel=new MachinePanel({progression:p,machines:s,player:{x:0,y:0,z:0},surfaceHeight:()=>0,materialEffects:{jobs:[]}},{report,drive:()=>({ok:true})});
  panel.selected=machineId;
  panel.render(parent);
  const flatten=()=>{const all=[];const walk=node=>{all.push(node);for(const child of node.children||[])walk(child);};walk(parent);return all;};
  let all=flatten(),sourceSelect=all.find(node=>node.dataset?.machineField?.startsWith('fixtureSource_'));
  assert.ok(sourceSelect);assert.equal(sourceSelect.value,'backup-battery','nearest compatible port is selected first');
  assert.equal(all.some(node=>node.tag==='button'&&node.textContent.startsWith('레거시 개인 에너지')),false);
  const beforePrimary=g.nodes.get('fixed-battery').energy.electrical;
  sourceSelect.value='fixed-battery';sourceSelect.onchange();
  assert.equal(rerenders,1,'changing the source refreshes button eligibility');
  all=flatten();sourceSelect=all.find(node=>node.dataset?.machineField?.startsWith('fixtureSource_'));
  assert.equal(sourceSelect.value,'fixed-battery');
  const transfer=all.find(node=>node.tag==='button'&&node.textContent==='선택 설비에서 10 EU 받기');
  assert.ok(transfer);assert.equal(transfer.disabled,false);transfer.onclick();
  assert.equal(reports.at(-1).ok,true);
  assert.equal(s.machines.get(machineId).components[0].energy.electrical,10);
  assert.equal(g.nodes.get('fixed-battery').energy.electrical,beforePrimary-10);
  assert.equal(g.nodes.get('backup-battery').energy.electrical,0,'the selected second source is debited, not the first option');
  assert.equal(g.legacyEscrow.electrical,20);
 }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});
