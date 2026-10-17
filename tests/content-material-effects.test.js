import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Progression } from '../app/src/main/assets/content-runtime/progression.js';
import { MachineSystem } from '../app/src/main/assets/content-runtime/machines.js';
import { MaterialEffects } from '../app/src/main/assets/content-runtime/material-effects.js';
const CONTENT={progression:JSON.parse(fs.readFileSync(new URL('../design/content/progression.json',import.meta.url)))};
function fixture(){
 const p=new Progression(CONTENT);p.grant({wood:500,raw_timber:2,property_imprinter:1,fluid_container:2,battery:1,inertial_cell:1},{claimId:'setup'});
 for(const id of ['property_imprinter','fluid_container','battery','inertial_cell']){p.research.add(p.catalog.get(id).research);assert.equal(p.placeComponent(id,{fluidType:id==='fluid_container'?'liquid_mana':undefined}).ok,true);}
 p.placeComponent('fluid_container',{fluidType:'acid_fluid'});p.research.add('consecration');p.stations.consecration_table=1;
 for(const type of ['magic','divine','mechanical','electrical','chemical'])p.supplyEnergy(type,100,{claimId:'paid-source:'+type});
 const machines=new MachineSystem(CONTENT,p),id=machines.create().machineId,voxelId=machines.attachVoxel(id,{materialId:'wood'}).voxelId;
 const effects=new MaterialEffects(CONTENT,p,{}, {machines});return {p,machines,id,voxelId,effects};
}
test('imprinting reserves real mana, pauses without the apparatus, and adds actual mitigation once across save',()=>{
 const {p,machines,id,voxelId,effects}=fixture(),before=p.energy.magic;
 const queued=effects.queueImprint(id,voxelId,'thermal_shield',{claimId:'imprint:1'});assert.equal(queued.ok,true);assert.equal(p.energy.magic,before-10);
 assert.equal(effects.queueImprint(id,voxelId,'thermal_shield',{claimId:'imprint:1'}).duplicate,true);assert.equal(p.energy.magic,before-10);
 const imprinter=p.assemblies.find(a=>a.componentId==='property_imprinter');p.setComponentCondition(imprinter.id,{connected:0});effects.tick(10);assert.equal(effects.jobs[0].progress,0);
 p.setComponentCondition(imprinter.id,{connected:1});effects.tick(.4);
 const q=new Progression(CONTENT,p.serialize()),s=new MachineSystem(CONTENT,q,machines.serialize()),e=new MaterialEffects(CONTENT,q,effects.serialize(),{machines:s});e.tick(.6);
 const v=s.machines.get(id).voxels[0],hp=v.hp;s.damage(id,voxelId,.1,{energyType:'thermal'});assert.ok(Math.abs(v.hp-(hp-.075))<1e-10);
 assert.equal(e.queueImprint(id,voxelId,'thermal_shield',{claimId:'new'}).reason,'property_already_applied');assert.deepEqual(s.voxelProfile(id,voxelId).functionsGranted,[]);
});
test('consecration strengthens an existing property without healing, changing mass or granting a function',()=>{
 const {p,machines,id,voxelId,effects}=fixture(),v=machines.machines.get(id).voxels[0],before={hp:v.hp,mass:v.massKg};
 assert.equal(effects.queueConsecrate(id,voxelId,'wind_affinity',{claimId:'bad'}).ok,false);assert.equal(p.energy.divine,100);
 assert.equal(effects.queueConsecrate(id,voxelId,'maxHp',{claimId:'bless'}).ok,true);effects.tick(2);
 assert.equal(v.maxHp,before.hp*1.25);assert.equal(v.hp,before.hp);assert.equal(v.massKg,before.mass);
 const materials=p.count('wood');assert.equal(machines.repair(id,voxelId).ok,true);assert.ok(Math.abs(p.count('wood')-(materials-.2))<1e-8);assert.equal(v.hp,v.maxHp);
 assert.equal(effects.queueConsecrate(id,voxelId,'maxHp',{claimId:'stack'}).reason,'property_already_applied');
});
test('all six energy attacks consume finite resources and retries never deliver damage twice',()=>{
 const {p,effects}=fixture();effects.loadThermalFuel(1,{claimId:'fire'});assert.equal(p.count('raw_timber'),1);effects.tick(1);
 let hits=0;
 for(const type of ['mechanical','electrical','thermal','chemical','magic','divine']){
  const before=type==='thermal'?effects.thermal.storedEU:p.energy[type],request={targetId:'enemy:1',energyType:type,energyEU:6,claimId:'hit:'+type};
  const result=effects.attack(request,packet=>{hits++;assert.equal(packet.amount,4);return {damage:4};});assert.equal(result.ok,true,type);
  assert.equal(type==='thermal'?effects.thermal.storedEU:p.energy[type],before-6);assert.equal(effects.attack(request,()=>hits++).duplicate,true);
 }
 assert.equal(hits,6);const saved=new MaterialEffects(CONTENT,p,effects.serialize());assert.equal(saved.attack({targetId:'enemy:1',energyType:'magic',energyEU:6,claimId:'hit:magic'},()=>hits++).duplicate,true);assert.equal(hits,6);
 assert.equal(saved.attack({targetId:'enemy:1',energyType:'divine',energyEU:100,claimId:'too-expensive'},()=>hits++).ok,false);assert.equal(hits,6);
 assert.equal(effects.thermal.generatedEU,effects.thermal.storedEU+effects.thermal.consumedEU);
});
test('water and wind are paid magical attributes; thermal work is bounded by fuel, elapsed time and capacity',()=>{
 const {p,effects}=fixture();let packet;
 assert.equal(effects.attack({targetId:'enemy',energyType:'electrical',magicAttribute:'wind',energyEU:5,claimId:'bad'},()=>{}).ok,false);
 assert.equal(effects.attack({targetId:'enemy',energyType:'magic',magicAttribute:'wind',energyEU:5,claimId:'wind'},p=>packet=p).ok,true);assert.equal(packet.damageType,'wind');assert.equal(packet.energyType,'magic');
 effects.loadThermalFuel(1,{claimId:'fuel'});assert.equal(effects.attack({targetId:'enemy',energyType:'thermal',energyEU:1,claimId:'cold'},()=>{}).reason,'thermal_heat_required');
 effects.tick(60);assert.equal(effects.thermal.storedEU,100);assert.equal(effects.thermal.fuelEU,300);
 for(let i=0;i<4;i++){assert.equal(effects.attack({targetId:'enemy',energyType:'thermal',energyEU:100,claimId:'burn:'+i},()=>{}).ok,true);effects.tick(5);}
 assert.equal(effects.thermal.fuelEU,0);assert.equal(effects.thermal.storedEU,0);assert.equal(effects.thermal.consumedEU,400);assert.equal(p.count('raw_timber'),1);
});
test('strength and acid upgrades reduce the corresponding real machine damage rather than remaining display-only stats',()=>{
 const {machines,id,voxelId,effects}=fixture(),v=machines.machines.get(id).voxels[0];
 effects.queueConsecrate(id,voxelId,'loadKn',{claimId:'strength'});effects.tick(2);const before=v.hp;machines.damage(id,voxelId,.1,{energyType:'mechanical'});assert.ok(Math.abs(v.hp-before+.08)<1e-9);
 effects.queueConsecrate(id,voxelId,'acidResistance',{claimId:'acid'});effects.tick(2);const acidBefore=v.hp;machines.damage(id,voxelId,.1,{energyType:'chemical'});assert.ok(Math.abs(v.hp-acidBefore+.075)<1e-9);
});
test('machine-mounted imprinter requires routed energy and local relic strengthens with its own finite reserve',()=>{
 const {p,machines,id,voxelId,effects}=fixture();p.grant({property_imprinter:1,mana_condenser:1,relic:1},{claimId:'local-fixtures'});
 for(const c of ['mana_condenser','relic'])p.research.add(p.catalog.get(c).research);
 const v2=machines.attachVoxel(id,{cell:[1,0,0]}).voxelId,v3=machines.attachVoxel(id,{cell:[2,0,0]}).voxelId;
 const imprint=machines.installComponent(id,voxelId,'property_imprinter').componentInstanceId,condenser=machines.installComponent(id,v2,'mana_condenser').componentInstanceId,relic=machines.installComponent(id,v3,'relic').componentInstanceId;
 const magic=p.energy.magic;assert.equal(effects.queueImprint(id,voxelId,'acid_shield',{claimId:'local:1'}).sourceComponentId,imprint);assert.equal(p.energy.magic,magic);
 machines.tick(1);effects.tick(1);assert.equal(effects.jobs[0].progress,0);
 machines.connect(id,condenser,imprint,'magic');machines.tick(3);assert.ok(effects.jobs[0].progress>0);assert.equal(machines.machines.get(id).voxels[0].materialEffects,undefined);
 const save=effects.serialize(),machineSave=machines.serialize();const restored=new MachineSystem(CONTENT,p,machineSave),fx=new MaterialEffects(CONTENT,p,save,{machines:restored});restored.tick(2.1);assert.deepEqual(restored.machines.get(id).voxels[0].materialEffects,['acid_shield']);
 assert.equal(restored.charge(id,relic,'divine',10).ok,true);const initial=p.energy.divine;
 const queued=fx.queueConsecrate(id,voxelId,'loadKn',{claimId:'local:2'});assert.equal(queued.sourceComponentId,relic);restored.tick(2.1);
 assert.ok(restored.machines.get(id).voxels[0].materialEffects.includes('loadKn'));assert.equal(p.energy.divine,initial);
 assert.ok(restored.machines.get(id).metrics.consumed>=20-1e-8);assert.equal(fx.jobs.length,0);
});
